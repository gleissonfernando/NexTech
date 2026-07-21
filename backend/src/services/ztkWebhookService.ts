import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MongoZtkWebhookClan, MongoZtkWebhookEventType, MongoZtkWebhookLog, MongoZtkWebhookPlayerStat, MongoZtkWebhookReward } from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoomWithAck } from "../realtime/events";
import { createLog } from "./logService";

export const ZTK_WEBHOOK_MODULE_ID = "ztk-webhook";

export type ZtkRankingType = "domination" | "recruitment" | "online";

export type SaveZtkClanInput = Partial<{
  active: boolean;
  clanName: string;
  dominationChannelId: string | null;
  rankingChannelId: string | null;
  recruitmentChannelId: string | null;
  rewardChannelId: string | null;
  settingsChannelId: string | null;
}>;

export type SaveZtkRewardInput = {
  active?: boolean;
  name?: string;
  rankingType?: ZtkRankingType;
  rewardDate?: string | null;
  winners?: Array<{ place: number; value: string }>;
};

export type ZtkWebhookDashboard = {
  clans: ZtkClanDto[];
  logs: ZtkLogDto[];
  rankings: Record<ZtkRankingType, ZtkPlayerStatDto[]>;
  rewards: ZtkRewardDto[];
  selectedClan: ZtkClanDto | null;
};

export type ZtkClanDto = Omit<MongoZtkWebhookClan, "_id" | "createdAt" | "lastEventAt" | "updatedAt" | "webhookCreatedAt"> & {
  createdAt: string;
  id: string;
  lastEventAt: string | null;
  updatedAt: string;
  webhookCreatedAt: string | null;
  webhookUrl: string | null;
};

export type ZtkDiscordWebhookManageResponse = {
  channelId?: string | null;
  error?: string;
  id?: string | null;
  ok: boolean;
  url?: string | null;
};

export type ZtkLogDto = Omit<MongoZtkWebhookLog, "_id" | "createdAt" | "eventTimestamp"> & {
  createdAt: string;
  eventTimestamp: string;
  id: string;
};

export type ZtkPlayerStatDto = Omit<MongoZtkWebhookPlayerStat, "_id" | "activeSessionStartedAt" | "lastSeenAt" | "updatedAt"> & {
  activeSessionStartedAt: string | null;
  id: string;
  lastSeenAt: string | null;
  updatedAt: string;
};

export type ZtkRewardDto = Omit<MongoZtkWebhookReward, "_id" | "createdAt" | "rewardDate" | "updatedAt"> & {
  createdAt: string;
  id: string;
  rewardDate: string | null;
  updatedAt: string;
};

export async function getZtkWebhookDashboard(guildId: string, botId: string | null, userId: string | null, canManage: boolean, requestedClanId?: string | null): Promise<ZtkWebhookDashboard> {
  const resolvedBotId = requireBotId(botId);
  const { ztkWebhookClans, ztkWebhookLogs, ztkWebhookPlayerStats, ztkWebhookRewards } = await getMongoCollections();
  const clanFilter = canManage ? { botId: resolvedBotId, guildId } : { botId: resolvedBotId, guildId, ownerUserId: userId ?? "" };
  const clans = await ztkWebhookClans.find(clanFilter).sort({ updatedAt: -1 }).limit(canManage ? 100 : 20).toArray();
  const selectedClan = clans.find((clan) => clan._id === requestedClanId) ?? clans[0] ?? null;
  const clanIds = clans.map((clan) => clan._id);
  const selectedClanId = selectedClan?._id ?? clanIds[0] ?? null;
  const logs = selectedClanId
    ? await ztkWebhookLogs.find({ botId: resolvedBotId, guildId, clanId: selectedClanId }).sort({ createdAt: -1 }).limit(50).toArray()
    : [];
  const rewards = selectedClanId
    ? await ztkWebhookRewards.find({ botId: resolvedBotId, guildId, clanId: selectedClanId }).sort({ createdAt: -1 }).limit(25).toArray()
    : [];
  const rankings = selectedClanId
    ? {
        domination: await topPlayers(ztkWebhookPlayerStats, resolvedBotId, guildId, selectedClanId, "dominations"),
        online: await topPlayers(ztkWebhookPlayerStats, resolvedBotId, guildId, selectedClanId, "onlineSeconds"),
        recruitment: await topPlayers(ztkWebhookPlayerStats, resolvedBotId, guildId, selectedClanId, "recruitments")
      }
    : { domination: [], online: [], recruitment: [] };

  return {
    clans: clans.map(toClanDto),
    logs: logs.map(toLogDto),
    rankings,
    rewards: rewards.map(toRewardDto),
    selectedClan: selectedClan ? toClanDto(selectedClan) : null
  };
}

export async function createZtkClan(guildId: string, botId: string | null, input: { clanName: string; ownerUserId: string }) {
  const resolvedBotId = requireBotId(botId);
  const now = new Date();
  const clan: MongoZtkWebhookClan = {
    _id: randomUUID(),
    active: true,
    botId: resolvedBotId,
    clanName: clean(input.clanName, 80) || "Clan FiveM",
    createdAt: now,
    discordWebhookChannelId: null,
    discordWebhookId: null,
    discordWebhookUrl: null,
    dominationChannelId: null,
    guildId,
    lastEventAt: null,
    ownerUserId: input.ownerUserId,
    rankingChannelId: null,
    recruitmentChannelId: null,
    rewardChannelId: null,
    settingsChannelId: null,
    updatedAt: now,
    webhookCreatedAt: null,
    webhookEnabled: false,
    webhookToken: null
  };
  const { ztkWebhookClans } = await getMongoCollections();
  await ztkWebhookClans.insertOne(clan);
  await audit(clan, input.ownerUserId, "clan_created", `Clã ZTK criado: ${clan.clanName}.`);
  return toClanDto(clan);
}

export async function updateZtkClan(guildId: string, botId: string | null, clanId: string, input: SaveZtkClanInput, actorId: string | null) {
  const resolvedBotId = requireBotId(botId);
  const patch: Partial<MongoZtkWebhookClan> = {
    updatedAt: new Date()
  };
  if (input.active !== undefined) patch.active = input.active;
  if (input.clanName !== undefined) patch.clanName = clean(input.clanName, 80) || "Clan FiveM";
  if (input.rankingChannelId !== undefined) patch.rankingChannelId = normalizeNullable(input.rankingChannelId);
  if (input.recruitmentChannelId !== undefined) patch.recruitmentChannelId = normalizeNullable(input.recruitmentChannelId);
  if (input.dominationChannelId !== undefined) patch.dominationChannelId = normalizeNullable(input.dominationChannelId);
  if (input.rewardChannelId !== undefined) patch.rewardChannelId = normalizeNullable(input.rewardChannelId);
  if (input.settingsChannelId !== undefined) patch.settingsChannelId = normalizeNullable(input.settingsChannelId);

  const { ztkWebhookClans } = await getMongoCollections();
  const before = await ztkWebhookClans.findOne({ _id: clanId, botId: resolvedBotId, guildId });
  if (!before) return null;
  await ztkWebhookClans.updateOne({ _id: before._id }, { $set: patch });
  const clan = (await ztkWebhookClans.findOne({ _id: before._id })) ?? before;
  await audit(clan, actorId, "clan_updated", `Configuração ZTK atualizada: ${clan.clanName}.`);
  return toClanDto(clan);
}

export async function updateZtkWebhookState(guildId: string, botId: string | null, clanId: string, action: "create" | "regenerate" | "disable" | "delete", actorId: string | null) {
  const resolvedBotId = requireBotId(botId);
  const { ztkWebhookClans } = await getMongoCollections();
  const current = await ztkWebhookClans.findOne({ _id: clanId, botId: resolvedBotId, guildId });
  if (!current) return null;
  const now = new Date();
  const patch: Partial<MongoZtkWebhookClan> = { updatedAt: now };
  if (action === "create" || action === "regenerate") {
    const webhookChannelId = current.settingsChannelId ?? current.rankingChannelId ?? current.recruitmentChannelId ?? current.dominationChannelId ?? null;
    if (!webhookChannelId) {
      throw Object.assign(new Error("Configure um canal em Canais antes de criar a webhook Discord do ZTK."), { statusCode: 400 });
    }
    const [response] = await emitRealtimeToRoomWithAck<{
      action: "create" | "regenerate";
      channelId: string;
      clanId: string;
      clanName: string;
      currentWebhookId?: string | null;
      currentWebhookUrl?: string | null;
      guildId: string;
    }, ZtkDiscordWebhookManageResponse>(
      devBotRealtimeRoom(resolvedBotId),
      "ztk-webhook:webhook_manage",
      {
        action,
        channelId: webhookChannelId,
        clanId,
        clanName: current.clanName,
        currentWebhookId: current.discordWebhookId ?? null,
        currentWebhookUrl: current.discordWebhookUrl ?? null,
        guildId
      },
      30_000
    );
    if (!response?.ok || !response.url || !response.id) {
      throw Object.assign(new Error(response?.error ?? "O bot não conseguiu criar a webhook Discord. Verifique se ele está online e tem permissão Gerenciar Webhooks."), { statusCode: 502 });
    }
    patch.discordWebhookChannelId = response.channelId ?? webhookChannelId;
    patch.discordWebhookId = response.id;
    patch.discordWebhookUrl = response.url;
    patch.webhookCreatedAt = now;
    patch.webhookEnabled = true;
    patch.webhookToken = newWebhookToken();
  } else if (action === "disable") {
    patch.webhookEnabled = false;
  } else {
    await emitRealtimeToRoomWithAck<{
      action: "delete";
      channelId: string | null;
      clanId: string;
      clanName: string;
      currentWebhookId?: string | null;
      currentWebhookUrl?: string | null;
      guildId: string;
    }, ZtkDiscordWebhookManageResponse>(
      devBotRealtimeRoom(resolvedBotId),
      "ztk-webhook:webhook_manage",
      {
        action,
        channelId: current.discordWebhookChannelId ?? current.settingsChannelId ?? current.rankingChannelId ?? null,
        clanId,
        clanName: current.clanName,
        currentWebhookId: current.discordWebhookId ?? null,
        currentWebhookUrl: current.discordWebhookUrl ?? null,
        guildId
      },
      15_000
    );
    patch.discordWebhookChannelId = null;
    patch.discordWebhookId = null;
    patch.discordWebhookUrl = null;
    patch.webhookCreatedAt = null;
    patch.webhookEnabled = false;
    patch.webhookToken = null;
  }
  await ztkWebhookClans.updateOne({ _id: current._id }, { $set: patch });
  const clan = (await ztkWebhookClans.findOne({ _id: current._id })) ?? current;
  await audit(clan, actorId, `webhook_${action}`, `Webhook ZTK ${action} para ${clan.clanName}.`);
  return toClanDto(clan);
}

export async function createZtkReward(guildId: string, botId: string | null, clanId: string, input: SaveZtkRewardInput, actorId: string | null) {
  const resolvedBotId = requireBotId(botId);
  const { ztkWebhookClans, ztkWebhookRewards } = await getMongoCollections();
  const clan = await ztkWebhookClans.findOne({ _id: clanId, botId: resolvedBotId, guildId });
  if (!clan) return null;
  const now = new Date();
  const reward: MongoZtkWebhookReward = {
    _id: randomUUID(),
    active: input.active !== false,
    botId: resolvedBotId,
    clanId,
    createdAt: now,
    guildId,
    name: clean(input.name, 100) || "Premiação Mensal",
    rankingType: input.rankingType ?? "domination",
    rewardDate: input.rewardDate ? new Date(input.rewardDate) : null,
    updatedAt: now,
    winners: normalizeWinners(input.winners)
  };
  await ztkWebhookRewards.insertOne(reward);
  await audit(clan, actorId, "reward_created", `Premiação ZTK criada: ${reward.name}.`);
  emitRealtime("ztk-webhook:reward_updated", { botId: resolvedBotId, clan: toClanDto(clan), clanId, guildId, reward: toRewardDto(reward) });
  return toRewardDto(reward);
}

export async function ingestZtkWebhookEvent(clanId: string, token: string, rawPayload: unknown, rawBody: string) {
  const { ztkWebhookClans, ztkWebhookLogs, ztkWebhookPlayerStats } = await getMongoCollections();
  const clan = await ztkWebhookClans.findOne({ _id: clanId, webhookToken: token, webhookEnabled: true, active: true });
  if (!clan) {
    throw Object.assign(new Error("Webhook ZTK inválida, desativada ou não encontrada."), { statusCode: 404 });
  }

  const parsed = parseZtkPayload(rawPayload, rawBody, clan.clanName);
  const dedupeKey = parsed.externalId || parsed.hash;
  const now = new Date();
  const log: MongoZtkWebhookLog = {
    _id: randomUUID(),
    botId: clan.botId,
    clanId: clan._id,
    clanName: parsed.clanName || clan.clanName,
    createdAt: now,
    dedupeKey,
    eventTimestamp: parsed.timestamp,
    eventType: parsed.eventType,
    guildId: clan.guildId,
    hash: parsed.hash,
    location: parsed.location,
    onlineSeconds: parsed.onlineSeconds,
    playerId: parsed.playerId,
    playerName: parsed.playerName,
    rawPayload,
    rawText: parsed.rawText,
    recruiterId: parsed.recruiterId,
    recruiterName: parsed.recruiterName
  };

  const inserted = await ztkWebhookLogs.updateOne(
    { botId: clan.botId, guildId: clan.guildId, clanId: clan._id, dedupeKey },
    { $setOnInsert: log },
    { upsert: true }
  );
  if (!inserted.upsertedId) {
    return { duplicate: true, message: "Evento já registrado. Ignorado." };
  }

  await ztkWebhookClans.updateOne({ _id: clan._id }, { $set: { lastEventAt: now, updatedAt: now } });
  await updatePlayerStats(ztkWebhookPlayerStats, clan, log);
  const rankings = {
    domination: await topPlayers(ztkWebhookPlayerStats, clan.botId, clan.guildId, clan._id, "dominations"),
    online: await topPlayers(ztkWebhookPlayerStats, clan.botId, clan.guildId, clan._id, "onlineSeconds"),
    recruitment: await topPlayers(ztkWebhookPlayerStats, clan.botId, clan.guildId, clan._id, "recruitments")
  };
  emitRealtime("ztk-webhook:event_received", {
    botId: clan.botId,
    clan: toClanDto({ ...clan, lastEventAt: now, updatedAt: now }),
    event: toLogDto(log),
    guildId: clan.guildId,
    rankings
  });
  return { duplicate: false, event: toLogDto(log), message: "Evento registrado." };
}

export async function ingestZtkDiscordWebhookMessage(botId: string | null, guildId: string, input: { channelId: string; content?: string | null; embeds?: unknown[]; messageId: string; webhookId: string }) {
  const resolvedBotId = requireBotId(botId);
  const { ztkWebhookClans } = await getMongoCollections();
  const clan = await ztkWebhookClans.findOne({
    active: true,
    botId: resolvedBotId,
    discordWebhookId: input.webhookId,
    guildId,
    webhookEnabled: true
  });
  if (!clan) return { duplicate: false, ignored: true, message: "Webhook Discord não vinculada ao ZTK." };
  if (clan.discordWebhookChannelId && clan.discordWebhookChannelId !== input.channelId) {
    return { duplicate: false, ignored: true, message: "Webhook ZTK recebida fora do canal configurado." };
  }
  return ingestParsedZtkEvent(clan, { content: input.content ?? "", embeds: input.embeds ?? [], eventId: input.messageId, messageId: input.messageId }, input.content ?? "");
}

export async function listZtkWebhookClansForBot(guildId: string, botId: string | null) {
  const resolvedBotId = requireBotId(botId);
  const { ztkWebhookClans } = await getMongoCollections();
  const clans = await ztkWebhookClans.find({ active: true, botId: resolvedBotId, guildId, webhookEnabled: true }).sort({ updatedAt: -1 }).limit(200).toArray();
  return clans.map(toClanDto);
}

async function ingestParsedZtkEvent(clan: MongoZtkWebhookClan, rawPayload: unknown, rawBody: string) {
  const { ztkWebhookClans, ztkWebhookLogs, ztkWebhookPlayerStats } = await getMongoCollections();
  const parsed = parseZtkPayload(rawPayload, rawBody, clan.clanName);
  const dedupeKey = parsed.externalId || parsed.hash;
  const now = new Date();
  const log: MongoZtkWebhookLog = {
    _id: randomUUID(),
    botId: clan.botId,
    clanId: clan._id,
    clanName: parsed.clanName || clan.clanName,
    createdAt: now,
    dedupeKey,
    eventTimestamp: parsed.timestamp,
    eventType: parsed.eventType,
    guildId: clan.guildId,
    hash: parsed.hash,
    location: parsed.location,
    onlineSeconds: parsed.onlineSeconds,
    playerId: parsed.playerId,
    playerName: parsed.playerName,
    rawPayload,
    rawText: parsed.rawText,
    recruiterId: parsed.recruiterId,
    recruiterName: parsed.recruiterName
  };

  const inserted = await ztkWebhookLogs.updateOne(
    { botId: clan.botId, guildId: clan.guildId, clanId: clan._id, dedupeKey },
    { $setOnInsert: log },
    { upsert: true }
  );
  if (!inserted.upsertedId) {
    return { duplicate: true, message: "Evento já registrado. Ignorado." };
  }

  await ztkWebhookClans.updateOne({ _id: clan._id }, { $set: { lastEventAt: now, updatedAt: now } });
  await updatePlayerStats(ztkWebhookPlayerStats, clan, log);
  const rankings = {
    domination: await topPlayers(ztkWebhookPlayerStats, clan.botId, clan.guildId, clan._id, "dominations"),
    online: await topPlayers(ztkWebhookPlayerStats, clan.botId, clan.guildId, clan._id, "onlineSeconds"),
    recruitment: await topPlayers(ztkWebhookPlayerStats, clan.botId, clan.guildId, clan._id, "recruitments")
  };
  emitRealtime("ztk-webhook:event_received", {
    botId: clan.botId,
    clan: toClanDto({ ...clan, lastEventAt: now, updatedAt: now }),
    event: toLogDto(log),
    guildId: clan.guildId,
    rankings
  });
  return { duplicate: false, event: toLogDto(log), message: "Evento registrado." };
}

async function updatePlayerStats(collection: Awaited<ReturnType<typeof getMongoCollections>>["ztkWebhookPlayerStats"], clan: MongoZtkWebhookClan, log: MongoZtkWebhookLog) {
  const playerName = clean(log.playerName ?? log.recruiterName, 100);
  if (!playerName) return;
  const now = new Date();
  const key = { botId: clan.botId, guildId: clan.guildId, clanId: clan._id, playerName };
  const inc: Partial<Record<"dominations" | "onlineSeconds" | "recruitments", number>> = {};
  const set: Partial<MongoZtkWebhookPlayerStat> = {
    clanName: clan.clanName,
    lastSeenAt: log.eventTimestamp,
    playerId: log.playerId,
    updatedAt: now
  };
  if (log.eventType === "domination") inc.dominations = 1;
  if (log.eventType === "recruitment") inc.recruitments = 1;
  if (log.eventType === "player_connected") set.activeSessionStartedAt = log.eventTimestamp;
  if (log.eventType === "player_disconnected") {
    const current = await collection.findOne(key);
    const sessionStartedAt = current?.activeSessionStartedAt;
    const seconds = log.onlineSeconds || (sessionStartedAt ? Math.max(0, Math.round((log.eventTimestamp.getTime() - sessionStartedAt.getTime()) / 1000)) : 0);
    if (seconds > 0) inc.onlineSeconds = seconds;
    set.activeSessionStartedAt = null;
  }

  await collection.updateOne(
    key,
    {
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
      $set: set,
      $setOnInsert: {
        _id: randomUUID(),
        botId: clan.botId,
        clanId: clan._id,
        clanName: clan.clanName,
        dominations: 0,
        guildId: clan.guildId,
        onlineSeconds: 0,
        playerId: log.playerId,
        playerName,
        recruitments: 0
      }
    },
    { upsert: true }
  );
}

async function topPlayers(
  collection: Awaited<ReturnType<typeof getMongoCollections>>["ztkWebhookPlayerStats"],
  botId: string,
  guildId: string,
  clanId: string,
  field: "dominations" | "onlineSeconds" | "recruitments"
) {
  return (await collection.find({ botId, guildId, clanId }).sort({ [field]: -1, updatedAt: -1 }).toArray()).map(toPlayerStatDto);
}

function parseZtkPayload(rawPayload: unknown, rawBody: string, fallbackClanName: string) {
  const rawText = collectText(rawPayload) || rawBody || "";
  const normalized = normalize(rawText);
  const eventType: MongoZtkWebhookEventType = normalized.includes("novo membro")
    ? "recruitment"
    : normalized.includes("dominacao concluida") || normalized.includes("dominação concluída")
      ? "domination"
      : normalized.includes("player connected")
        ? "player_connected"
        : normalized.includes("player disconnected")
          ? "player_disconnected"
          : "unknown";
  const object = isRecord(rawPayload) ? rawPayload : {};
  const timestampValue = readString(object, ["timestamp", "time", "date", "createdAt"]) ?? regex(rawText, /(?:data|hor[aá]rio|timestamp)[:\s]+([0-9/:\-\sTZ.]+)/i);
  const playerName = readString(object, ["player", "playerName", "jogador", "responsavel", "responsável", "member", "nome"])
    ?? regex(rawText, /(?:jogador|respons[aá]vel|novo membro|membro|player|nome)[:\s*]+([^\n|]+)/i);
  const playerId = readString(object, ["playerId", "id", "source", "userId"])
    ?? regex(rawText, /\b(?:id|source)[:\s#]+([0-9A-Za-z_-]+)/i);
  const recruiterName = readString(object, ["recruiter", "recrutador", "quemRecrutou", "recrutou"])
    ?? regex(rawText, /(?:quem recrutou|recrutador|recrutou)[:\s*]+([^\n|]+)/i);
  const recruiterId = readString(object, ["recruiterId", "recrutadorId"]);
  const clanName = readString(object, ["clan", "clã", "gang", "faction", "facção"])
    ?? regex(rawText, /(?:cl[aã]|gang|fac[cç][aã]o)[:\s*]+([^\n|]+)/i)
    ?? fallbackClanName;
  const location = readString(object, ["location", "local", "territory", "territorio", "território"])
    ?? regex(rawText, /(?:local|territ[oó]rio|dominado)[:\s*]+([^\n|]+)/i);
  const onlineSeconds = Number(readString(object, ["onlineSeconds", "durationSeconds", "seconds"]) ?? "") || parseDurationSeconds(rawText);
  const externalId = readString(object, ["eventId", "event_id", "id", "messageId", "logId"]);
  const hash = createHash("sha256").update(`${eventType}|${rawText}|${JSON.stringify(rawPayload ?? {})}`).digest("hex");

  return {
    clanName: clean(clanName, 100),
    eventType,
    externalId: externalId ? clean(externalId, 160) : null,
    hash,
    location: clean(location, 120) || null,
    onlineSeconds,
    playerId: clean(playerId, 80) || null,
    playerName: clean(playerName, 100) || null,
    rawText: rawText.slice(0, 6000),
    recruiterId: clean(recruiterId, 80) || null,
    recruiterName: clean(recruiterName, 100) || null,
    timestamp: parseDate(timestampValue) ?? new Date()
  };
}

function collectText(value: unknown): string {
  const chunks: string[] = [];
  const visit = (item: unknown) => {
    if (chunks.join("\n").length > 8000) return;
    if (typeof item === "string" || typeof item === "number") {
      chunks.push(String(item));
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (isRecord(item)) {
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return chunks.filter(Boolean).join("\n");
}

function parseDurationSeconds(value: string) {
  const hourMatch = /(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)/i.exec(value);
  const minuteMatch = /(\d+(?:[.,]\d+)?)\s*(?:m|min|minuto|minutos)/i.exec(value);
  const secondMatch = /(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundo|segundos)/i.exec(value);
  return Math.round((num(hourMatch?.[1]) * 3600) + (num(minuteMatch?.[1]) * 60) + num(secondMatch?.[1]));
}

function toClanDto(value: MongoZtkWebhookClan): ZtkClanDto {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    id: value._id,
    lastEventAt: value.lastEventAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString(),
    webhookCreatedAt: value.webhookCreatedAt?.toISOString() ?? null,
    webhookUrl: value.discordWebhookUrl ?? null
  };
}

function toLogDto(value: MongoZtkWebhookLog): ZtkLogDto {
  return { ...value, createdAt: value.createdAt.toISOString(), eventTimestamp: value.eventTimestamp.toISOString(), id: value._id };
}

function toPlayerStatDto(value: MongoZtkWebhookPlayerStat): ZtkPlayerStatDto {
  return {
    ...value,
    activeSessionStartedAt: value.activeSessionStartedAt?.toISOString() ?? null,
    id: value._id,
    lastSeenAt: value.lastSeenAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString()
  };
}

function toRewardDto(value: MongoZtkWebhookReward): ZtkRewardDto {
  return { ...value, createdAt: value.createdAt.toISOString(), id: value._id, rewardDate: value.rewardDate?.toISOString() ?? null, updatedAt: value.updatedAt.toISOString() };
}

function newWebhookToken() {
  return randomBytes(24).toString("base64url");
}

function requireBotId(botId: string | null) {
  if (!botId) throw Object.assign(new Error("Escopo do bot é obrigatório para ZTK Webhook."), { statusCode: 400 });
  return botId;
}

function normalizeWinners(value: SaveZtkRewardInput["winners"]) {
  const fallback = [
    { place: 1, value: "R$100" },
    { place: 2, value: "R$50" },
    { place: 3, value: "R$25" }
  ];
  const source = value?.length ? value : fallback;
  return source.slice(0, 10).map((winner, index) => ({
    place: Number.isInteger(winner.place) && winner.place > 0 ? winner.place : index + 1,
    value: clean(winner.value, 40) || "A definir"
  }));
}

async function audit(clan: MongoZtkWebhookClan, actorId: string | null, action: string, message: string) {
  await createLog({
    botId: clan.botId,
    guildId: clan.guildId,
    message,
    metadata: { action, clanId: clan._id },
    type: `ztk_webhook.${action}`,
    userId: actorId
  }).catch(() => undefined);
}

function clean(value: unknown, limit: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function regex(value: string, pattern: RegExp) {
  return clean(pattern.exec(value)?.[1], 200) || null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function num(value: string | undefined) {
  return Number(String(value ?? "0").replace(",", ".")) || 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(object: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" || typeof value === "number") return clean(value, 200);
  }
  return null;
}
