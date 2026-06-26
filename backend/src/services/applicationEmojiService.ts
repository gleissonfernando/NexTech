import { randomUUID, createHash } from "node:crypto";
import type { Sort } from "mongodb";
import {
  ensureGuild,
  getMongoCollections,
  type MongoApplicationEmojiItem,
  type MongoApplicationEmojiJob,
  type MongoApplicationEmojiSettings
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog } from "./logService";
import { getDevBot, getDevBotToken } from "./devBotService";

const DISCORD_API = "https://discord.com/api/v10";
const APPLICATION_EMOJI_LIMIT = 2000;
const MAX_EMOJI_BYTES = 256 * 1024;

type DiscordEmoji = {
  animated?: boolean;
  id: string;
  name: string;
};

type ApplicationEmojiDto = {
  animated: boolean;
  applicationEmojiId: string;
  applicationName: string;
  botId: string;
  hash: string | null;
  id: string;
  originalEmojiId: string;
  originalName: string;
  size: number;
  sourceGuildId: string | null;
  syncedAt: string;
  type: "Animado" | "Estatico";
  updatedAt: string;
  url: string;
};

export async function getApplicationEmojiPage(input: {
  animated?: boolean | null;
  botId: string;
  query?: string | null;
  sort?: "name" | "date" | "size";
}) {
  const { applicationEmojiItems, applicationEmojiSettings } = await getMongoCollections();
  const query: Record<string, unknown> = { botId: input.botId };
  const search = input.query?.trim();

  if (typeof input.animated === "boolean") {
    query.animated = input.animated;
  }

  if (search) {
    query.applicationName = { $regex: escapeRegex(search), $options: "i" };
  }

  const sort: Sort = input.sort === "name"
    ? { applicationName: 1 }
    : input.sort === "size"
      ? { size: -1 }
      : { syncedAt: -1 };

  const [items, total, autoSyncGuilds] = await Promise.all([
    applicationEmojiItems.find(query).sort(sort).limit(500).toArray(),
    applicationEmojiItems.countDocuments({ botId: input.botId }),
    applicationEmojiSettings.find({ botId: input.botId, autoSync: true }).toArray()
  ]);

  return {
    autoSyncGuildIds: autoSyncGuilds.map((setting) => setting.guildId),
    items: items.map(toApplicationEmojiDto),
    limit: APPLICATION_EMOJI_LIMIT,
    remaining: Math.max(0, APPLICATION_EMOJI_LIMIT - total),
    total
  };
}

export async function getApplicationEmojiSettings(botId: string, guildId: string) {
  const { applicationEmojiSettings } = await getMongoCollections();
  const existing = await applicationEmojiSettings.findOne({ botId, guildId });
  return toSettingsDto(existing ?? defaultApplicationEmojiSettings(botId, guildId, null));
}

export async function saveApplicationEmojiSettings(input: {
  autoSync: boolean;
  botId: string;
  guildId: string;
  userId: string;
}) {
  const { applicationEmojiSettings } = await getMongoCollections();
  const now = new Date();

  await applicationEmojiSettings.updateOne(
    { botId: input.botId, guildId: input.guildId },
    {
      $set: {
        autoSync: input.autoSync,
        updatedAt: now,
        updatedBy: input.userId
      },
      $setOnInsert: {
        _id: randomUUID(),
        botId: input.botId,
        createdAt: now,
        createdBy: input.userId,
        guildId: input.guildId
      }
    },
    { upsert: true }
  );

  const saved = await applicationEmojiSettings.findOne({ botId: input.botId, guildId: input.guildId });
  return toSettingsDto(saved ?? defaultApplicationEmojiSettings(input.botId, input.guildId, input.userId));
}

export async function refreshApplicationEmojis(input: {
  botId: string;
  userId: string;
}) {
  const bot = await resolveBotAndToken(input.botId);
  const remote = await listApplicationEmojis(bot.clientId, bot.token);
  const { applicationEmojiItems } = await getMongoCollections();
  const now = new Date();

  for (const emoji of remote) {
    await applicationEmojiItems.updateOne(
      { botId: input.botId, applicationEmojiId: emoji.id },
      {
        $set: {
          animated: Boolean(emoji.animated),
          applicationId: bot.clientId,
          applicationName: emoji.name,
          botId: input.botId,
          updatedAt: now,
          url: applicationEmojiUrl(emoji)
        },
        $setOnInsert: {
          _id: randomUUID(),
          hash: null,
          originalEmojiId: `application:${emoji.id}`,
          originalName: emoji.name,
          size: 0,
          sourceGuildId: null,
          syncedAt: now,
          userId: input.userId
        }
      },
      { upsert: true }
    );
  }

  return getApplicationEmojiPage({ botId: input.botId });
}

export async function syncGuildEmojisToApplication(input: {
  botId: string;
  guildId: string;
  userId: string;
}) {
  const startedAt = new Date();
  const job: MongoApplicationEmojiJob = {
    _id: randomUUID(),
    botId: input.botId,
    error: null,
    failed: 0,
    finishedAt: null,
    guildId: input.guildId,
    removed: 0,
    sent: 0,
    skipped: 0,
    startedAt,
    status: "running",
    total: 0,
    updated: 0,
    userId: input.userId
  };
  const { applicationEmojiJobs } = await getMongoCollections();
  await applicationEmojiJobs.insertOne(job);

  try {
    await ensureGuild(input.guildId);
    const bot = await resolveBotAndToken(input.botId);
    const [guildEmojis, applicationEmojis] = await Promise.all([
      listGuildEmojis(input.guildId, bot.token),
      listApplicationEmojis(bot.clientId, bot.token)
    ]);
    const existingAppNames = new Set(applicationEmojis.map((emoji) => emoji.name.toLowerCase()));
    const existingAppIds = new Set(applicationEmojis.map((emoji) => emoji.id));
    const { applicationEmojiItems } = await getMongoCollections();
    const savedItems = await applicationEmojiItems.find({ botId: input.botId }).toArray();
    const savedByOriginal = new Map(savedItems.map((item) => [`${item.sourceGuildId ?? ""}:${item.originalEmojiId}`, item]));

    job.total = guildEmojis.length;
    await applicationEmojiJobs.updateOne({ _id: job._id }, { $set: { total: job.total } });
    emitProgress(input, job, 0, "Sincronizando emojis...");
    await createApplicationEmojiLog(input, "application_emoji.sync.started", `Sincronizacao iniciada: ${guildEmojis.length} emoji(s).`);

    for (const [index, emoji] of guildEmojis.entries()) {
      try {
        const sourceUrl = guildEmojiUrl(emoji);
        const image = await downloadEmoji(sourceUrl);
        const hash = sha256(image.buffer);
        const saved = savedByOriginal.get(`${input.guildId}:${emoji.id}`);

        if (saved && saved.hash === hash && existingAppIds.has(saved.applicationEmojiId)) {
          job.skipped += 1;
          await createApplicationEmojiLog(input, "application_emoji.skipped", `Emoji ignorado: ${emoji.name}.`);
        } else {
          if (saved?.applicationEmojiId && existingAppIds.has(saved.applicationEmojiId)) {
            await deleteApplicationEmoji(bot.clientId, saved.applicationEmojiId, bot.token).catch(() => undefined);
            existingAppIds.delete(saved.applicationEmojiId);
            existingAppNames.delete(saved.applicationName.toLowerCase());
            job.updated += 1;
          }

          if (existingAppIds.size >= APPLICATION_EMOJI_LIMIT) {
            job.failed += 1;
            await createApplicationEmojiLog(input, "application_emoji.limit", `Limite de ${APPLICATION_EMOJI_LIMIT} emojis atingido.`);
          } else {
            const name = uniqueEmojiName(sanitizeEmojiName(emoji.name), existingAppNames);
            const created = await createApplicationEmoji(bot.clientId, bot.token, {
              image: `data:${image.contentType};base64,${image.buffer.toString("base64")}`,
              name
            });
            existingAppIds.add(created.id);
            existingAppNames.add(created.name.toLowerCase());
            job.sent += saved ? 0 : 1;
            await saveApplicationEmoji({
              animated: Boolean(created.animated ?? emoji.animated),
              applicationEmojiId: created.id,
              applicationId: bot.clientId,
              applicationName: created.name,
              botId: input.botId,
              hash,
              originalEmojiId: emoji.id,
              originalName: emoji.name,
              size: image.buffer.length,
              sourceGuildId: input.guildId,
              url: sourceUrl,
              userId: input.userId
            });
            await createApplicationEmojiLog(input, saved ? "application_emoji.updated" : "application_emoji.sent", `${saved ? "Emoji atualizado" : "Emoji enviado"}: ${created.name}.`);
          }
        }
      } catch (error) {
        job.failed += 1;
        await createApplicationEmojiLog(input, "application_emoji.error", `Erro em ${emoji.name}: ${friendlyError(error)}.`);
      }

      emitProgress(input, job, index + 1, `Sincronizando... ${index + 1}/${guildEmojis.length}`);
      await wait(750);
    }

    job.status = "completed";
    job.finishedAt = new Date();
    await applicationEmojiJobs.updateOne({ _id: job._id }, { $set: job });
    await createApplicationEmojiLog(input, "application_emoji.sync.completed", `Sincronizacao concluida: ${job.sent} enviados, ${job.updated} atualizados, ${job.skipped} ignorados, ${job.failed} erros.`);
    emitProgress(input, job, job.total, "Sincronizacao concluida.");

    return {
      job: toJobDto(job),
      ...(await getApplicationEmojiPage({ botId: input.botId }))
    };
  } catch (error) {
    job.status = "failed";
    job.error = friendlyError(error);
    job.finishedAt = new Date();
    await applicationEmojiJobs.updateOne({ _id: job._id }, { $set: job });
    await createApplicationEmojiLog(input, "application_emoji.sync.failed", job.error);
    emitProgress(input, job, job.total, job.error);
    throw error;
  }
}

export async function removeAllApplicationEmojis(input: {
  botId: string;
  userId: string;
}) {
  const bot = await resolveBotAndToken(input.botId);
  const remote = await listApplicationEmojis(bot.clientId, bot.token);
  let removed = 0;

  for (const emoji of remote) {
    await deleteApplicationEmoji(bot.clientId, emoji.id, bot.token);
    removed += 1;
    await wait(350);
  }

  const { applicationEmojiItems } = await getMongoCollections();
  await applicationEmojiItems.deleteMany({ botId: input.botId });
  await createApplicationEmojiLog({ botId: input.botId, guildId: "application", userId: input.userId }, "application_emoji.removed_all", `${removed} emoji(s) removidos da aplicacao.`);

  return {
    removed,
    ...(await getApplicationEmojiPage({ botId: input.botId }))
  };
}

export async function handleApplicationEmojiGuildEvent(input: {
  action: "created" | "deleted" | "updated";
  animated: boolean;
  botId: string;
  emojiId: string;
  guildId: string;
  name: string;
}) {
  const { applicationEmojiItems, applicationEmojiSettings } = await getMongoCollections();
  const settings = await applicationEmojiSettings.findOne({
    autoSync: true,
    botId: input.botId,
    guildId: input.guildId
  });

  if (!settings) {
    return {
      skipped: true,
      reason: "Sincronizacao automatica desativada."
    };
  }

  if (input.action === "deleted") {
    const bot = await resolveBotAndToken(input.botId);
    const existing = await applicationEmojiItems.findOne({
      botId: input.botId,
      originalEmojiId: input.emojiId,
      sourceGuildId: input.guildId
    });

    if (existing) {
      await deleteApplicationEmoji(bot.clientId, existing.applicationEmojiId, bot.token).catch(() => undefined);
      await applicationEmojiItems.deleteOne({ _id: existing._id });
      await createApplicationEmojiLog(
        { botId: input.botId, guildId: input.guildId, userId: "bot:auto-sync" },
        "application_emoji.auto_removed",
        `Emoji removido automaticamente: ${existing.applicationName}.`
      );
    }

    return {
      removed: Boolean(existing),
      skipped: false
    };
  }

  return syncGuildEmojisToApplication({
    botId: input.botId,
    guildId: input.guildId,
    userId: "bot:auto-sync"
  });
}

export async function createApplicationEmojiZip(input: {
  botId: string;
  guildId?: string | null;
}) {
  const { applicationEmojiItems } = await getMongoCollections();
  const query: Record<string, unknown> = { botId: input.botId };

  if (input.guildId?.trim()) {
    query.sourceGuildId = input.guildId.trim();
  }

  const items = await applicationEmojiItems.find(query).sort({ syncedAt: -1 }).limit(2000).toArray();
  const files: Array<{ name: string; data: Buffer }> = [];

  for (const item of items) {
    const data = await fetchEmojiBuffer(item.url).catch(() => null);
    if (!data) continue;
    const folder = item.animated ? "Emojis/GIF" : "Emojis/PNG";
    const extension = item.animated ? "gif" : "png";
    files.push({
      data,
      name: `${folder}/${safeFileName(`${item.applicationName}.${extension}`)}`
    });
  }

  return {
    buffer: createStoredZip(files),
    count: files.length
  };
}

async function resolveBotAndToken(botId: string) {
  const [bot, token] = await Promise.all([getDevBot(botId), getDevBotToken(botId)]);

  if (!bot?.clientId || !token) {
    throw Object.assign(new Error("Bot sem token valido cadastrado no DEV."), { statusCode: 400 });
  }

  return {
    clientId: bot.clientId,
    token
  };
}

async function listGuildEmojis(guildId: string, token: string) {
  return discordJson<DiscordEmoji[]>(`/guilds/${guildId}/emojis`, token, { label: "listar emojis do servidor" });
}

async function listApplicationEmojis(applicationId: string, token: string) {
  const payload = await discordJson<DiscordEmoji[] | { items?: DiscordEmoji[] }>(`/applications/${applicationId}/emojis`, token, { label: "listar emojis da aplicacao" });
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

async function createApplicationEmoji(applicationId: string, token: string, body: { image: string; name: string }) {
  return discordJson<DiscordEmoji>(`/applications/${applicationId}/emojis`, token, {
    body,
    label: `criar application emoji ${body.name}`,
    method: "POST"
  });
}

async function deleteApplicationEmoji(applicationId: string, emojiId: string, token: string) {
  await discordJson<unknown>(`/applications/${applicationId}/emojis/${emojiId}`, token, {
    label: `remover application emoji ${emojiId}`,
    method: "DELETE"
  });
}

async function saveApplicationEmoji(input: Omit<MongoApplicationEmojiItem, "_id" | "syncedAt" | "updatedAt">) {
  const { applicationEmojiItems } = await getMongoCollections();
  const now = new Date();

  await applicationEmojiItems.updateOne(
    {
      botId: input.botId,
      sourceGuildId: input.sourceGuildId,
      originalEmojiId: input.originalEmojiId
    },
    {
      $set: {
        ...input,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        syncedAt: now
      }
    },
    { upsert: true }
  );
}

async function discordJson<T>(
  path: string,
  token: string,
  options: {
    body?: unknown;
    label: string;
    method?: "DELETE" | "GET" | "PATCH" | "POST";
  }
) {
  let attempt = 0;

  while (true) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: {
        Authorization: `Bot ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      method: options.method ?? "GET"
    });
    const raw = await response.text();
    const payload = safeJson(raw) as { message?: string; retry_after?: number } | null;

    if (response.status === 429 && attempt < 6) {
      const retryAfterMs = Math.ceil((payload?.retry_after ?? 1) * 1000);
      await wait(Math.min(30_000, retryAfterMs + attempt * 500));
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      throw Object.assign(new Error(payload?.message ?? `Discord HTTP ${response.status} em ${options.label}`), {
        statusCode: response.status,
        discordStatus: response.status
      });
    }

    return (payload ?? {}) as T;
  }
}

async function downloadEmoji(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Nao foi possivel baixar emoji.");
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!/^image\/(png|gif|webp|jpe?g)$/.test(contentType)) {
    throw new Error("Formato de emoji invalido.");
  }

  if (!buffer.length || buffer.length > MAX_EMOJI_BYTES) {
    throw new Error("Emoji maior que 256 KiB.");
  }

  return { buffer, contentType };
}

async function fetchEmojiBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

function emitProgress(input: { botId: string; guildId: string; userId: string }, job: MongoApplicationEmojiJob, current: number, message: string) {
  emitRealtime("application-emojis:progress", {
    botId: input.botId,
    current,
    failed: job.failed,
    guildId: input.guildId,
    jobId: job._id,
    message,
    sent: job.sent,
    skipped: job.skipped,
    total: job.total,
    updated: job.updated,
    userId: input.userId
  });
}

async function createApplicationEmojiLog(input: { botId: string; guildId: string; userId: string }, type: string, message: string) {
  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    message,
    metadata: {
      botId: input.botId,
      guildId: input.guildId
    },
    type,
    userId: input.userId
  }).catch(() => undefined);
}

function toApplicationEmojiDto(item: MongoApplicationEmojiItem): ApplicationEmojiDto {
  return {
    id: item._id,
    animated: item.animated,
    applicationEmojiId: item.applicationEmojiId,
    applicationName: item.applicationName,
    botId: item.botId,
    hash: item.hash,
    originalEmojiId: item.originalEmojiId,
    originalName: item.originalName,
    size: item.size,
    sourceGuildId: item.sourceGuildId,
    syncedAt: item.syncedAt.toISOString(),
    type: item.animated ? "Animado" : "Estatico",
    updatedAt: item.updatedAt.toISOString(),
    url: item.url
  };
}

function toSettingsDto(settings: MongoApplicationEmojiSettings) {
  return {
    autoSync: settings.autoSync,
    botId: settings.botId,
    guildId: settings.guildId,
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toJobDto(job: MongoApplicationEmojiJob) {
  return {
    id: job._id,
    failed: job.failed,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    removed: job.removed,
    sent: job.sent,
    skipped: job.skipped,
    startedAt: job.startedAt.toISOString(),
    status: job.status,
    total: job.total,
    updated: job.updated
  };
}

function defaultApplicationEmojiSettings(botId: string, guildId: string, userId: string | null): MongoApplicationEmojiSettings {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    autoSync: false,
    botId,
    createdAt: now,
    createdBy: userId,
    guildId,
    updatedAt: now,
    updatedBy: userId
  };
}

function guildEmojiUrl(emoji: DiscordEmoji) {
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=128&quality=lossless`;
}

function applicationEmojiUrl(emoji: DiscordEmoji) {
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=128&quality=lossless`;
}

function sanitizeEmojiName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "emoji";
}

function uniqueEmojiName(baseName: string, existingNames: Set<string>) {
  const base = sanitizeEmojiName(baseName).slice(0, 28) || "emoji";
  let name = base;
  let suffix = 2;

  while (existingNames.has(name.toLowerCase())) {
    name = `${base.slice(0, Math.max(1, 31 - String(suffix).length))}_${suffix}`;
    suffix += 1;
  }

  return name;
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeJson(value: string) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.\/-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "emoji.png";
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : "falha desconhecida";
  const status = typeof error === "object" && error && "discordStatus" in error ? Number((error as { discordStatus?: unknown }).discordStatus) : 0;
  if (status === 401) return "Token do bot invalido.";
  if (status === 403) return "O bot precisa de acesso a aplicacao/servidor e permissao para gerenciar emojis.";
  if (status === 404) return "Servidor, aplicacao ou emoji nao encontrado.";
  if (status === 429) return "Rate limit do Discord. A sincronizacao sera retomada com pausa automatica.";
  return message;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStoredZip(files: Array<{ name: string; data: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
