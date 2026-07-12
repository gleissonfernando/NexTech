import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureGuild,
  getMongoCollections,
  type MongoEmojiCloneItem,
  type MongoEmojiCloneJob,
  type MongoEmojiLibraryItem
} from "../database/mongo";
import { emitRealtime } from "../realtime/events";
import { createLog } from "./logService";

export type RecordEmojiCloneJobInput = {
  botId?: string | null;
  guildId: string;
  userId: string;
  sourceGuildId?: string | null;
  status: MongoEmojiCloneJob["status"];
  total: number;
  success: number;
  failed: number;
  prefix?: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
  items: Array<{
    originalEmojiId: string;
    originalName: string;
    originalUrl?: string | null;
    newEmojiId?: string | null;
    newName?: string | null;
    animated: boolean;
    status: MongoEmojiCloneItem["status"];
    errorReason?: string | null;
  }>;
};

export async function recordEmojiCloneJob(input: RecordEmojiCloneJobInput) {
  const now = new Date();
  const job: MongoEmojiCloneJob = {
    _id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    userId: input.userId,
    sourceGuildId: normalizeBotId(input.sourceGuildId),
    status: input.status,
    total: input.total,
    success: input.success,
    failed: input.failed,
    prefix: input.prefix?.trim() || null,
    createdAt: input.createdAt ? new Date(input.createdAt) : now,
    finishedAt: input.finishedAt ? new Date(input.finishedAt) : now
  };
  const items: MongoEmojiCloneItem[] = input.items.map((item) => ({
    _id: randomUUID(),
    jobId: job._id,
    originalEmojiId: item.originalEmojiId,
    originalName: item.originalName,
    newEmojiId: item.newEmojiId ?? null,
    newName: item.newName ?? null,
    animated: item.animated,
    status: item.status,
    errorReason: item.errorReason ?? null
  }));

  await ensureGuild(job.guildId);
  const { emojiCloneItems, emojiCloneJobs } = await getMongoCollections();
  await emojiCloneJobs.insertOne(job);
  if (items.length) {
    await emojiCloneItems.insertMany(items);
  }

  const libraryItems = await upsertEmojiLibraryItems(job, input.items);

  if (job.botId) {
    await createLog({
      botId: job.botId,
      guildId: job.guildId,
      userId: job.userId,
      type: "emoji_clone.completed",
      message: `Clonagem de emojis finalizada: ${job.success}/${job.total} com sucesso.`,
      metadata: {
        failed: job.failed,
        jobId: job._id,
        prefix: job.prefix,
        sourceGuildId: job.sourceGuildId,
        total: job.total
      }
    }).catch(() => undefined);
  }

  emitRealtime("emoji-cloner:job_recorded", {
    botId: job.botId,
    guildId: job.guildId,
    job: {
      id: job._id,
      failed: job.failed,
      success: job.success,
      total: job.total
    },
    libraryItems,
    userId: job.userId
  });

  return {
    ...job,
    id: job._id,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    items: items.map((item) => ({ ...item, id: item._id }))
  };
}

export async function listEmojiLibrary(input: {
  animated?: boolean | null;
  botId: string;
  query?: string | null;
  userId: string;
}) {
  const { emojiLibrary } = await getMongoCollections();
  const query: Record<string, unknown> = {
    botId: input.botId,
    userId: input.userId
  };
  const search = input.query?.trim();

  if (typeof input.animated === "boolean") {
    query.animated = input.animated;
  }

  if (search) {
    query.name = {
      $regex: escapeRegex(search),
      $options: "i"
    };
  }

  const items = await emojiLibrary
    .find(query)
    .sort({ importedAt: -1 })
    .limit(250)
    .toArray();

  return items.map(toLibraryDto);
}

export async function createEmojiLibraryZip(input: {
  botId: string;
  guildId?: string | null;
  signal?: AbortSignal;
  userId: string;
}) {
  const { emojiLibrary } = await getMongoCollections();
  const query: Record<string, unknown> = {
    botId: input.botId,
    userId: input.userId
  };

  if (input.guildId?.trim()) {
    query.destinationGuildId = input.guildId.trim();
  }

  const items = await emojiLibrary
    .find(query)
    .sort({ importedAt: -1 })
    .limit(500)
    .toArray();
  const usedNames = new Set<string>();
  const results = await mapWithConcurrency(items, 8, async (item) => {
    const localPath = item.localFilePath ? path.resolve(item.localFilePath) : null;
    let data: Buffer | null = null;

    if (localPath) {
      data = await fs.readFile(localPath).catch(() => null);
    }

    if (!data && item.url.startsWith("data:image/")) {
      data = Buffer.from(item.url.split(",", 2)[1] ?? "", "base64");
    }

    if (!data && /^https?:\/\//i.test(item.url)) {
      data = await fetchEmojiBuffer(item.url, input.signal).catch(() => null);
    }

    if (input.signal?.aborted) throw new DOMException("Download cancelado", "AbortError");

    if (!data?.length) {
      console.warn(`[emoji-download] Emoji indisponivel: ${item.name || item.originalEmojiId}`);
      return null;
    }

    const extension = detectEmojiExtension(data, item.animated);
    const fileName = uniqueFileName(safeFileName(`${item.name || item.originalEmojiId}.${extension}`), usedNames);
    return { name: `emojis/${fileName}`, data };
  });
  const files = results.filter((file): file is NonNullable<typeof file> => file !== null);

  return {
    buffer: createStoredZip([{ name: "emojis/", data: Buffer.alloc(0) }, ...files]),
    count: files.length,
    failed: items.length - files.length,
    total: items.length
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function uniqueFileName(fileName: string, usedNames: Set<string>) {
  let candidate = fileName;
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  let suffix = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}_${suffix}${extension}`;
    suffix += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function detectEmojiExtension(data: Buffer, animated: boolean) {
  if (data.subarray(0, 6).toString("ascii").startsWith("GIF")) return "gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return animated ? "gif" : "png";
}

async function upsertEmojiLibraryItems(job: MongoEmojiCloneJob, items: RecordEmojiCloneJobInput["items"]) {
  const botId = normalizeBotId(job.botId);

  if (!botId) {
    return [];
  }

  const successfulItems = items.filter((item) => item.status === "success" && item.newEmojiId && item.originalUrl);

  if (!successfulItems.length) {
    return [];
  }

  const { emojiLibrary } = await getMongoCollections();
  const now = new Date();
  const ids: string[] = [];

  for (const item of successfulItems) {
    const id = randomUUID();
    const localFilePath = await persistEmojiFile(job.guildId, item).catch(() => null);
    ids.push(item.originalEmojiId);
    await emojiLibrary.updateOne(
      {
        botId,
        originalEmojiId: item.originalEmojiId,
        userId: job.userId
      },
      {
        $set: {
          animated: item.animated,
          category: inferEmojiCategory(item.newName ?? item.originalName),
          destinationGuildId: job.guildId,
          lastUpdatedAt: now,
          localFilePath,
          name: item.newName ?? item.originalName,
          originalEmojiId: item.originalEmojiId,
          sourceGuildId: job.sourceGuildId,
          targetEmojiId: item.newEmojiId ?? null,
          targetEmojiName: item.newName ?? null,
          url: item.originalUrl ?? "",
          userId: job.userId
        },
        $setOnInsert: {
          _id: id,
          botId,
          importedAt: job.finishedAt ?? now
        }
      },
      {
        upsert: true
      }
    );

    await createLog({
      botId,
      guildId: job.guildId,
      userId: job.userId,
      type: "emoji_clone.library_saved",
      message: `Emoji salvo na Biblioteca: ${item.newName ?? item.originalName}.`,
      metadata: {
        animated: item.animated,
        originalEmojiId: item.originalEmojiId,
        sourceGuildId: job.sourceGuildId,
        targetEmojiId: item.newEmojiId
      }
    }).catch(() => undefined);
  }

  const saved = await emojiLibrary.find({
    botId,
    originalEmojiId: { $in: ids },
    userId: job.userId
  }).toArray();

  return saved.map(toLibraryDto);
}

function toLibraryDto(item: MongoEmojiLibraryItem) {
  return {
    id: item._id,
    animated: item.animated,
    botId: item.botId,
    category: item.category ?? "Sistema",
    destinationGuildId: item.destinationGuildId,
    importedAt: item.importedAt.toISOString(),
    lastUpdatedAt: item.lastUpdatedAt.toISOString(),
    name: item.name,
    originalEmojiId: item.originalEmojiId,
    sourceGuildId: item.sourceGuildId,
    targetEmojiId: item.targetEmojiId,
    targetEmojiName: item.targetEmojiName,
    url: item.url,
    userId: item.userId
  };
}

async function persistEmojiFile(guildId: string, item: RecordEmojiCloneJobInput["items"][number]) {
  if (!item.originalUrl) {
    return null;
  }

  const extension = item.animated ? "gif" : imageExtensionFromUrl(item.originalUrl);
  const directory = path.resolve(process.cwd(), "downloads", "emojis", guildId);
  const filePath = path.join(directory, safeFileName(`${item.newName ?? item.originalName}.${extension}`));
  const data = item.originalUrl.startsWith("data:image/")
    ? Buffer.from(item.originalUrl.split(",", 2)[1] ?? "", "base64")
    : await fetchEmojiBuffer(item.originalUrl);

  if (!data.length || data.length > 512 * 1024) {
    return null;
  }

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, data);
  return filePath;
}

async function fetchEmojiBuffer(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error("Nao foi possivel baixar emoji.");
  }

  return Buffer.from(await response.arrayBuffer());
}

function imageExtensionFromUrl(url: string) {
  const match = url.match(/\.(png|gif|webp|jpe?g)(?:\?|$)/i);
  const extension = match?.[1]?.toLowerCase();
  return extension === "jpg" || extension === "jpeg" || extension === "webp" ? "png" : extension || "png";
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/_+/g, "_").slice(0, 96) || "emoji.png";
}

function inferEmojiCategory(name: string) {
  const normalized = name.toLowerCase();
  if (/success|check|ok|certo|sim/.test(normalized)) return "Sucesso";
  if (/error|erro|fail|x|no/.test(normalized)) return "Erro";
  if (/warn|aviso|alert/.test(normalized)) return "Aviso";
  if (/info|help/.test(normalized)) return "Informacao";
  if (/config|gear|setting/.test(normalized)) return "Configuracao";
  if (/safe|shield|security/.test(normalized)) return "Seguranca";
  if (/bot|robot/.test(normalized)) return "Bot";
  if (/server|guild/.test(normalized)) return "Servidor";
  if (/user|member/.test(normalized)) return "Usuario";
  if (/dash|panel/.test(normalized)) return "Dashboard";
  return "Sistema";
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBotId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}
