import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { MongoZtkWebhookClan, MongoZtkWebhookEventType, MongoZtkWebhookLog, MongoZtkWebhookPlayerStat, MongoZtkWebhookReward } from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoomWithAck } from "../realtime/events";
import { createLog } from "./logService";

export const ZTK_WEBHOOK_MODULE_ID = "ztk-webhook";
const ZTK_RANKING_LIMIT = 10;

export type ZtkRankingType = "domination" | "recruitment" | "online";

export type SaveZtkClanInput = Partial<{
  active: boolean;
  clanName: string;
  dominationChannelId: string | null;
  discordWebhookUrl: string | null;
  onlineChannelId: string | null;
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
  dominationRankings: ZtkDominationRankingsDto;
  logs: ZtkLogDto[];
  recruitmentRankings: ZtkRecruitmentRankingsDto;
  rankings: Record<ZtkRankingType, ZtkPlayerStatDto[]>;
  rewards: ZtkRewardDto[];
  selectedClan: ZtkClanDto | null;
};

export type ZtkDominationGangRankingDto = {
  dominations: number;
  gangName: string;
  lastDominatedAt: string | null;
  lastZone: string | null;
  normalizedGangName: string;
  participantTotal: number;
  zoneCount: number;
};

export type ZtkDominationParticipantRankingDto = {
  avatarUrl: string | null;
  firstDominatedAt: string | null;
  lastDominatedAt: string | null;
  lastZone: string | null;
  gangName: string | null;
  monthlyDominations: number;
  normalizedPlayerName: string;
  participations: number;
  playerId: string | null;
  playerName: string;
  positionChange: "down" | "same" | "up";
  todayDominations: number;
  weeklyDominations: number;
};

export type ZtkDominationRankingsDto = {
  gangs: ZtkDominationGangRankingDto[];
  participants: ZtkDominationParticipantRankingDto[];
  stats: {
    averageDaily: number;
    dailySeries: Array<{ date: string; total: number }>;
    leaderName: string | null;
    monthTotal: number;
    todayTotal: number;
    total: number;
    updatedAt: string | null;
    weekTotal: number;
  };
};

export type ZtkRecruitmentRankingDto = {
  avatarUrl: string | null;
  firstRecruitmentAt: string | null;
  lastRecruitmentAt: string | null;
  normalizedRecruiterName: string;
  recentRecruits: Array<{
    recruitedName: string;
    recruitedPlayerId: string | null;
    recruitedAt: string;
  }>;
  recruiterId: string | null;
  recruiterName: string;
  roleName: string | null;
  todayRecruitments: number;
  totalRecruitments: number;
  weeklyRecruitments: number;
  monthlyRecruitments: number;
};

export type ZtkRecruitmentRankingsDto = {
  recruiters: ZtkRecruitmentRankingDto[];
  stats: {
    dailySeries: Array<{ date: string; total: number }>;
    lastRecruitmentAt: string | null;
    lastRecruiterName: string | null;
    monthTotal: number;
    todayTotal: number;
    topRecruiterName: string | null;
    total: number;
    weekTotal: number;
  };
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
    ? await ztkWebhookLogs.find({ botId: resolvedBotId, guildId, clanId: selectedClanId }).sort({ createdAt: -1 }).limit(300).toArray()
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
  const dominationRankings = selectedClanId
    ? await buildDominationRankings(ztkWebhookLogs, resolvedBotId, guildId, selectedClanId)
    : emptyDominationRankings();
  const recruitmentRankings = selectedClanId
    ? await buildRecruitmentRankings(ztkWebhookLogs, resolvedBotId, guildId, selectedClanId)
    : emptyRecruitmentRankings();

  return {
    clans: clans.map(toClanDto),
    dominationRankings,
    logs: logs.map(toLogDto),
    recruitmentRankings,
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
    onlineChannelId: null,
    onlineRankingMessageId: null,
    ownerUserId: input.ownerUserId,
    participationRankingMessageId: null,
    rankingChannelId: null,
    rankingMessageId: null,
    recruitmentChannelId: null,
    recruitmentRankingMessageId: null,
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
  const { ztkWebhookClans } = await getMongoCollections();
  const before = await ztkWebhookClans.findOne({ _id: clanId, botId: resolvedBotId, guildId });
  if (!before) return null;
  const patch: Partial<MongoZtkWebhookClan> = {
    updatedAt: new Date()
  };
  if (input.active !== undefined) patch.active = input.active;
  if (input.clanName !== undefined) patch.clanName = clean(input.clanName, 80) || "Clan FiveM";
  if (input.rankingChannelId !== undefined) {
    patch.rankingChannelId = normalizeNullable(input.rankingChannelId);
    if (patch.rankingChannelId !== before.rankingChannelId) {
      if (!before.onlineChannelId) patch.onlineRankingMessageId = null;
      patch.participationRankingMessageId = null;
      patch.rankingMessageId = null;
      if (!before.recruitmentChannelId) patch.recruitmentRankingMessageId = null;
    }
  }
  if (input.recruitmentChannelId !== undefined) {
    patch.recruitmentChannelId = normalizeNullable(input.recruitmentChannelId);
    if (patch.recruitmentChannelId !== before.recruitmentChannelId) patch.recruitmentRankingMessageId = null;
  }
  if (input.dominationChannelId !== undefined) patch.dominationChannelId = normalizeNullable(input.dominationChannelId);
  if (input.onlineChannelId !== undefined) {
    patch.onlineChannelId = normalizeNullable(input.onlineChannelId);
    if (patch.onlineChannelId !== before.onlineChannelId) patch.onlineRankingMessageId = null;
  }
  if (input.rewardChannelId !== undefined) patch.rewardChannelId = normalizeNullable(input.rewardChannelId);
  if (input.settingsChannelId !== undefined) patch.settingsChannelId = normalizeNullable(input.settingsChannelId);
  if (input.discordWebhookUrl !== undefined) {
    const webhookUrl = normalizeNullable(input.discordWebhookUrl);
    if (!webhookUrl) {
      patch.discordWebhookChannelId = null;
      patch.discordWebhookId = null;
      patch.discordWebhookUrl = null;
      patch.webhookCreatedAt = null;
      patch.webhookEnabled = false;
      patch.webhookToken = null;
    } else {
      const webhookId = discordWebhookIdFromUrl(webhookUrl);
      if (!webhookId) {
        throw Object.assign(new Error("Informe uma URL de webhook Discord válida."), { statusCode: 400 });
      }
      const existing = await ztkWebhookClans.findOne({ botId: resolvedBotId, guildId, discordWebhookId: webhookId });
      if (existing && existing._id !== before._id) {
        throw Object.assign(new Error("Essa webhook Discord já está cadastrada em outro clã ZTK."), { statusCode: 409 });
      }
      patch.discordWebhookChannelId = patch.settingsChannelId ?? before?.settingsChannelId ?? null;
      patch.discordWebhookId = webhookId;
      patch.discordWebhookUrl = webhookUrl;
      patch.webhookCreatedAt = new Date();
      patch.webhookEnabled = true;
      patch.webhookToken = null;
    }
  }

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
    channelId: parsed.channelId,
    clanId: clan._id,
    clanName: parsed.clanName || clan.clanName,
    createdAt: now,
    dedupeKey,
    eventTimestamp: parsed.timestamp,
    eventType: parsed.eventType,
    guildId: clan.guildId,
    hash: parsed.hash,
    location: parsed.location,
    messageId: parsed.messageId,
    normalizedGangName: parsed.normalizedGangName,
    normalizedZoneName: parsed.normalizedZoneName,
    onlineSeconds: parsed.onlineSeconds,
    participantCount: parsed.participantCount,
    participants: parsed.participants,
    playerId: parsed.playerId,
    playerName: parsed.playerName,
    processingStatus: parsed.eventType === "unknown" ? "unknown" : "processed",
    rawPayload,
    rawText: parsed.rawText,
    recruiterId: parsed.recruiterId,
    recruiterName: parsed.recruiterName,
    rivalGangs: parsed.rivalGangs,
    totalPlayersInZone: parsed.totalPlayersInZone,
    webhookId: parsed.webhookId
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
  const dominationRankings = await buildDominationRankings(ztkWebhookLogs, clan.botId, clan.guildId, clan._id);
  const recruitmentRankings = await buildRecruitmentRankings(ztkWebhookLogs, clan.botId, clan.guildId, clan._id);
  emitRealtime("ztk-webhook:event_received", {
    botId: clan.botId,
    clan: toClanDto({ ...clan, lastEventAt: now, updatedAt: now }),
    dominationRankings,
    event: toLogDto(log),
    guildId: clan.guildId,
    recruitmentRankings,
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
  return ingestParsedZtkEvent(clan, {
    channelId: input.channelId,
    content: input.content ?? "",
    embeds: input.embeds ?? [],
    eventId: input.messageId,
    messageId: input.messageId,
    webhookId: input.webhookId
  }, input.content ?? "");
}

export async function listZtkWebhookClansForBot(guildId: string, botId: string | null) {
  const resolvedBotId = requireBotId(botId);
  const { ztkWebhookClans } = await getMongoCollections();
  const clans = await ztkWebhookClans.find({ active: true, botId: resolvedBotId, guildId, webhookEnabled: true }).sort({ updatedAt: -1 }).limit(200).toArray();
  return clans.map(toClanDto);
}

export async function updateZtkRankingMessageState(
  guildId: string,
  botId: string | null,
  clanId: string,
  input: { channelId: string | null; kind: "online" | "participation" | "ranking" | "recruitment"; messageId: string | null }
) {
  const resolvedBotId = requireBotId(botId);
  const messageField = input.kind === "online"
    ? "onlineRankingMessageId"
    : input.kind === "recruitment"
      ? "recruitmentRankingMessageId"
      : input.kind === "participation"
        ? "participationRankingMessageId"
        : "rankingMessageId";
  const { ztkWebhookClans } = await getMongoCollections();
  const patch: Partial<MongoZtkWebhookClan> = {
    [messageField]: normalizeNullable(input.messageId),
    updatedAt: new Date()
  };
  await ztkWebhookClans.updateOne({ _id: clanId, botId: resolvedBotId, guildId }, { $set: patch });
}

async function ingestParsedZtkEvent(clan: MongoZtkWebhookClan, rawPayload: unknown, rawBody: string) {
  const { ztkWebhookClans, ztkWebhookLogs, ztkWebhookPlayerStats } = await getMongoCollections();
  const parsed = parseZtkPayload(rawPayload, rawBody, clan.clanName);
  const dedupeKey = parsed.externalId || parsed.hash;
  const now = new Date();
  const log: MongoZtkWebhookLog = {
    _id: randomUUID(),
    botId: clan.botId,
    channelId: parsed.channelId,
    clanId: clan._id,
    clanName: parsed.clanName || clan.clanName,
    createdAt: now,
    dedupeKey,
    eventTimestamp: parsed.timestamp,
    eventType: parsed.eventType,
    guildId: clan.guildId,
    hash: parsed.hash,
    location: parsed.location,
    messageId: parsed.messageId,
    normalizedGangName: parsed.normalizedGangName,
    normalizedZoneName: parsed.normalizedZoneName,
    onlineSeconds: parsed.onlineSeconds,
    participantCount: parsed.participantCount,
    participants: parsed.participants,
    playerId: parsed.playerId,
    playerName: parsed.playerName,
    processingStatus: parsed.eventType === "unknown" ? "unknown" : "processed",
    rawPayload,
    rawText: parsed.rawText,
    recruiterId: parsed.recruiterId,
    recruiterName: parsed.recruiterName,
    rivalGangs: parsed.rivalGangs,
    totalPlayersInZone: parsed.totalPlayersInZone,
    webhookId: parsed.webhookId
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
  const dominationRankings = await buildDominationRankings(ztkWebhookLogs, clan.botId, clan.guildId, clan._id);
  const recruitmentRankings = await buildRecruitmentRankings(ztkWebhookLogs, clan.botId, clan.guildId, clan._id);
  emitRealtime("ztk-webhook:event_received", {
    botId: clan.botId,
    clan: toClanDto({ ...clan, lastEventAt: now, updatedAt: now }),
    dominationRankings,
    event: toLogDto(log),
    guildId: clan.guildId,
    recruitmentRankings,
    rankings
  });
  return { duplicate: false, event: toLogDto(log), message: "Evento registrado." };
}

async function updatePlayerStats(collection: Awaited<ReturnType<typeof getMongoCollections>>["ztkWebhookPlayerStats"], clan: MongoZtkWebhookClan, log: MongoZtkWebhookLog) {
  if (log.eventType === "domination" && log.participants?.length) {
    const now = new Date();
    await collection.bulkWrite(log.participants.map((participant) => ({
      updateOne: {
        filter: { botId: clan.botId, guildId: clan.guildId, clanId: clan._id, playerName: participant.name },
        update: {
          $inc: { dominations: 1 },
          $set: {
            clanName: log.clanName || clan.clanName,
            lastSeenAt: log.eventTimestamp,
            playerId: participant.id,
            updatedAt: now
          },
          $setOnInsert: {
            _id: randomUUID(),
            botId: clan.botId,
            clanId: clan._id,
            guildId: clan.guildId,
            onlineSeconds: 0,
            playerName: participant.name,
            recruitments: 0
          }
        },
        upsert: true
      }
    })), { ordered: false });
    return;
  }

  const playerName = clean(log.eventType === "recruitment" ? log.recruiterName ?? log.playerName : log.playerName ?? log.recruiterName, 100);
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
  return (await collection.find({ botId, guildId, clanId }).sort({ [field]: -1, updatedAt: -1 }).limit(ZTK_RANKING_LIMIT).toArray()).map(toPlayerStatDto);
}

function emptyDominationRankings(): ZtkDominationRankingsDto {
  return {
    gangs: [],
    participants: [],
    stats: {
      averageDaily: 0,
      dailySeries: [],
      leaderName: null,
      monthTotal: 0,
      todayTotal: 0,
      total: 0,
      updatedAt: null,
      weekTotal: 0
    }
  };
}

function emptyRecruitmentRankings(): ZtkRecruitmentRankingsDto {
  return {
    recruiters: [],
    stats: {
      dailySeries: [],
      lastRecruitmentAt: null,
      lastRecruiterName: null,
      monthTotal: 0,
      todayTotal: 0,
      topRecruiterName: null,
      total: 0,
      weekTotal: 0
    }
  };
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function buildDominationRankings(
  collection: Awaited<ReturnType<typeof getMongoCollections>>["ztkWebhookLogs"],
  botId: string,
  guildId: string,
  clanId: string
): Promise<ZtkDominationRankingsDto> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const seriesStart = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const gangs = await collection.aggregate<{
    dominations: number;
    gangName: string;
    lastDominatedAt: Date | null;
    lastZone: string | null;
    normalizedGangName: string;
    participantTotal: number;
    zoneCount: number;
  }>([
    { $match: { botId, clanId, eventType: "domination", guildId } },
    {
      $set: {
        rankingGangName: { $ifNull: ["$normalizedGangName", "$clanName"] },
        rankingZoneName: { $ifNull: ["$normalizedZoneName", "$location"] }
      }
    },
    { $sort: { eventTimestamp: 1, _id: 1 } },
    {
      $group: {
        _id: "$rankingGangName",
        dominations: { $sum: 1 },
        gangName: { $last: "$clanName" },
        lastDominatedAt: { $last: "$eventTimestamp" },
        lastZone: { $last: "$location" },
        participantTotal: { $sum: { $ifNull: ["$participantCount", 0] } },
        zones: { $addToSet: "$rankingZoneName" }
      }
    },
    {
      $project: {
        _id: 0,
        dominations: 1,
        gangName: { $ifNull: ["$gangName", "$_id"] },
        lastDominatedAt: 1,
        lastZone: 1,
        normalizedGangName: "$_id",
        participantTotal: 1,
        zoneCount: { $size: "$zones" }
      }
    },
    { $sort: { dominations: -1, zoneCount: -1, participantTotal: -1, lastDominatedAt: -1, gangName: 1 } },
    { $limit: ZTK_RANKING_LIMIT }
  ]).toArray();

  const participants = await collection.aggregate<{
    avatarUrl: string | null;
    firstDominatedAt: Date | null;
    gangName: string | null;
    lastDominatedAt: Date | null;
    lastZone: string | null;
    monthlyDominations: number;
    normalizedPlayerName: string;
    participations: number;
    playerId: string | null;
    playerName: string;
    positionChange: "down" | "same" | "up";
    todayDominations: number;
    weeklyDominations: number;
  }>([
    { $match: { botId, clanId, eventType: "domination", guildId, participants: { $type: "array" } } },
    { $unwind: "$participants" },
    { $sort: { eventTimestamp: -1, _id: -1 } },
    {
      $group: {
        _id: { $ifNull: ["$participants.id", "$participants.normalizedName"] },
        avatarUrl: { $first: null },
        firstDominatedAt: { $last: "$eventTimestamp" },
        gangName: { $first: "$clanName" },
        lastDominatedAt: { $first: "$eventTimestamp" },
        lastZone: { $first: "$location" },
        monthlyDominations: { $sum: { $cond: [{ $gte: ["$eventTimestamp", monthStart] }, 1, 0] } },
        normalizedPlayerName: { $first: "$participants.normalizedName" },
        participations: { $sum: 1 },
        playerId: { $first: "$participants.id" },
        playerName: { $first: "$participants.name" },
        positionChange: { $first: "same" },
        todayDominations: { $sum: { $cond: [{ $gte: ["$eventTimestamp", todayStart] }, 1, 0] } },
        weeklyDominations: { $sum: { $cond: [{ $gte: ["$eventTimestamp", weekStart] }, 1, 0] } }
      }
    },
    { $project: { _id: 0, avatarUrl: 1, firstDominatedAt: 1, gangName: 1, lastDominatedAt: 1, lastZone: 1, monthlyDominations: 1, normalizedPlayerName: 1, participations: 1, playerId: 1, playerName: 1, positionChange: 1, todayDominations: 1, weeklyDominations: 1 } },
    { $sort: { participations: -1, lastDominatedAt: -1, playerName: 1 } },
    { $limit: ZTK_RANKING_LIMIT }
  ]).toArray();

  const [statsDoc] = await collection.aggregate<{
    monthTotal: number;
    todayTotal: number;
    total: number;
    updatedAt: Date | null;
    weekTotal: number;
  }>([
    { $match: { botId, clanId, eventType: "domination", guildId, participants: { $type: "array" } } },
    { $unwind: "$participants" },
    {
      $group: {
        _id: null,
        monthTotal: { $sum: { $cond: [{ $gte: ["$eventTimestamp", monthStart] }, 1, 0] } },
        todayTotal: { $sum: { $cond: [{ $gte: ["$eventTimestamp", todayStart] }, 1, 0] } },
        total: { $sum: 1 },
        updatedAt: { $max: "$eventTimestamp" },
        weekTotal: { $sum: { $cond: [{ $gte: ["$eventTimestamp", weekStart] }, 1, 0] } }
      }
    }
  ]).toArray();
  const dailySeries = await collection.aggregate<{ date: string; total: number }>([
    { $match: { botId, clanId, eventType: "domination", eventTimestamp: { $gte: seriesStart }, guildId, participants: { $type: "array" } } },
    { $unwind: "$participants" },
    {
      $group: {
        _id: { $dateToString: { date: "$eventTimestamp", format: "%Y-%m-%d", timezone: "America/Sao_Paulo" } },
        total: { $sum: 1 }
      }
    },
    { $project: { _id: 0, date: "$_id", total: 1 } },
    { $sort: { date: 1 } }
  ]).toArray();
  const stats = statsDoc
    ? {
        averageDaily: dailySeries.length ? Math.round((statsDoc.total / dailySeries.length) * 10) / 10 : statsDoc.total,
        dailySeries,
        leaderName: participants[0]?.playerName ?? null,
        monthTotal: statsDoc.monthTotal,
        todayTotal: statsDoc.todayTotal,
        total: statsDoc.total,
        updatedAt: statsDoc.updatedAt?.toISOString?.() ?? null,
        weekTotal: statsDoc.weekTotal
      }
    : emptyDominationRankings().stats;

  return {
    gangs: gangs.map((item) => ({
      ...item,
      lastDominatedAt: item.lastDominatedAt?.toISOString?.() ?? null
    })),
    participants: participants.map((item) => ({
      ...item,
      firstDominatedAt: item.firstDominatedAt?.toISOString?.() ?? null,
      lastDominatedAt: item.lastDominatedAt?.toISOString?.() ?? null
    })),
    stats
  };
}

async function buildRecruitmentRankings(
  collection: Awaited<ReturnType<typeof getMongoCollections>>["ztkWebhookLogs"],
  botId: string,
  guildId: string,
  clanId: string
): Promise<ZtkRecruitmentRankingsDto> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const seriesStart = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const recruiters = await collection.aggregate<{
    avatarUrl: string | null;
    firstRecruitmentAt: Date | null;
    lastRecruitmentAt: Date | null;
    monthlyRecruitments: number;
    normalizedRecruiterName: string;
    recentRecruits: Array<{
      recruitedName: string;
      recruitedPlayerId: string | null;
      recruitedAt: Date;
    }>;
    recruiterId: string | null;
    recruiterName: string;
    roleName: string | null;
    todayRecruitments: number;
    totalRecruitments: number;
    weeklyRecruitments: number;
  }>([
    { $match: { botId, clanId, eventType: "recruitment", guildId, recruiterName: { $type: "string", $ne: "" } } },
    { $sort: { eventTimestamp: -1, _id: -1 } },
    {
      $group: {
        _id: { $ifNull: ["$recruiterId", { $toLower: "$recruiterName" }] },
        avatarUrl: { $first: null },
        firstRecruitmentAt: { $last: "$eventTimestamp" },
        lastRecruitmentAt: { $first: "$eventTimestamp" },
        monthlyRecruitments: { $sum: { $cond: [{ $gte: ["$eventTimestamp", monthStart] }, 1, 0] } },
        recentRecruits: {
          $push: {
            recruitedAt: "$eventTimestamp",
            recruitedName: { $ifNull: ["$playerName", "Não identificado"] },
            recruitedPlayerId: "$playerId"
          }
        },
        recruiterId: { $first: "$recruiterId" },
        recruiterName: { $first: "$recruiterName" },
        roleName: { $first: null },
        todayRecruitments: { $sum: { $cond: [{ $gte: ["$eventTimestamp", todayStart] }, 1, 0] } },
        totalRecruitments: { $sum: 1 },
        weeklyRecruitments: { $sum: { $cond: [{ $gte: ["$eventTimestamp", weekStart] }, 1, 0] } }
      }
    },
    {
      $project: {
        _id: 0,
        avatarUrl: 1,
        firstRecruitmentAt: 1,
        lastRecruitmentAt: 1,
        monthlyRecruitments: 1,
        normalizedRecruiterName: "$_id",
        recentRecruits: { $slice: ["$recentRecruits", 50] },
        recruiterId: 1,
        recruiterName: 1,
        roleName: 1,
        todayRecruitments: 1,
        totalRecruitments: 1,
        weeklyRecruitments: 1
      }
    },
    { $sort: { totalRecruitments: -1, lastRecruitmentAt: -1, recruiterName: 1 } },
    { $limit: ZTK_RANKING_LIMIT }
  ]).toArray();

  const [statsDoc] = await collection.aggregate<{
    lastRecruitmentAt: Date | null;
    lastRecruiterName: string | null;
    monthTotal: number;
    todayTotal: number;
    total: number;
    weekTotal: number;
  }>([
    { $match: { botId, clanId, eventType: "recruitment", guildId } },
    { $sort: { eventTimestamp: -1, _id: -1 } },
    {
      $group: {
        _id: null,
        lastRecruitmentAt: { $first: "$eventTimestamp" },
        lastRecruiterName: { $first: "$recruiterName" },
        monthTotal: { $sum: { $cond: [{ $gte: ["$eventTimestamp", monthStart] }, 1, 0] } },
        todayTotal: { $sum: { $cond: [{ $gte: ["$eventTimestamp", todayStart] }, 1, 0] } },
        total: { $sum: 1 },
        weekTotal: { $sum: { $cond: [{ $gte: ["$eventTimestamp", weekStart] }, 1, 0] } }
      }
    }
  ]).toArray();
  const dailySeries = await collection.aggregate<{ date: string; total: number }>([
    { $match: { botId, clanId, eventType: "recruitment", eventTimestamp: { $gte: seriesStart }, guildId } },
    {
      $group: {
        _id: { $dateToString: { date: "$eventTimestamp", format: "%Y-%m-%d", timezone: "America/Sao_Paulo" } },
        total: { $sum: 1 }
      }
    },
    { $project: { _id: 0, date: "$_id", total: 1 } },
    { $sort: { date: 1 } }
  ]).toArray();
  const stats = statsDoc
    ? {
        dailySeries,
        lastRecruitmentAt: statsDoc.lastRecruitmentAt?.toISOString?.() ?? null,
        lastRecruiterName: statsDoc.lastRecruiterName ?? null,
        monthTotal: statsDoc.monthTotal,
        todayTotal: statsDoc.todayTotal,
        topRecruiterName: recruiters[0]?.recruiterName ?? null,
        total: statsDoc.total,
        weekTotal: statsDoc.weekTotal
      }
    : emptyRecruitmentRankings().stats;

  return {
    recruiters: recruiters.map((item) => ({
      ...item,
      firstRecruitmentAt: item.firstRecruitmentAt?.toISOString?.() ?? null,
      lastRecruitmentAt: item.lastRecruitmentAt?.toISOString?.() ?? null,
      normalizedRecruiterName: normalizeEntity(item.normalizedRecruiterName),
      recentRecruits: item.recentRecruits.map((recruit) => ({
        ...recruit,
        recruitedAt: recruit.recruitedAt.toISOString()
      }))
    })),
    stats
  };
}

function parseZtkPayload(rawPayload: unknown, rawBody: string, fallbackClanName: string) {
  const rawText = collectText(rawPayload) || rawBody || "";
  const normalized = normalize(rawText);
  const fields = collectLabelMap(rawPayload);
  const gangSection = readSection(rawText, ["gang", "clã", "clan", "família", "familia"]);
  const zoneSection = readSection(rawText, ["zona dominada", "território dominado", "territorio dominado", "local dominado", "local"]);
  const participantCountSection = readSection(rawText, ["participantes da gang", "participantes"]);
  const recruitedSection = readSection(rawText, ["novo membro", "membro recrutado", "recrutado"]);
  const recruiterSection = readSection(rawText, ["recrutador", "quem recrutou", "recrutou"]);
  const totalPlayersSection = readSection(rawText, ["total de jogadores na zona", "jogadores na zona", "total na zona"]);
  const rivalGangSection = readSection(rawText, ["outras gangs presentes", "gangs presentes", "outras facções presentes", "outras faccoes presentes"]);
  const participantSection = readSection(rawText, ["membros participantes", "participantes da dominação", "participantes da dominacao"]);
  const dateOnlyValue = readField(fields, ["data"]) ?? readSection(rawText, ["data"])[0] ?? null;
  const timeOnlyValue = readField(fields, ["horario", "horário", "hora"]) ?? readSection(rawText, ["horário", "horario", "hora"])[0] ?? null;
  const timestampSection = readSection(rawText, ["data e horário", "data e horario", "horário", "horario", "data"]);
  const eventType: MongoZtkWebhookEventType = hasAny(normalized, ["novo membro", "novo integrante", "recrutamento", "recrutado", "recrutou"])
    ? "recruitment"
    : hasAny(normalized, ["dominacao concluida", "dominacao finalizada", "dominacao realizada", "dominação concluída", "dominação realizada", "dominado", "territorio dominado", "território dominado"])
      ? "domination"
      : hasAny(normalized, ["player connected", "player connect", "jogador conectado", "entrou no servidor"])
        ? "player_connected"
        : hasAny(normalized, ["player disconnected", "player disconnect", "jogador desconectado", "saiu do servidor"])
          ? "player_disconnected"
          : "unknown";
  const timestampValue = readStringDeep(rawPayload, ["timestamp", "time", "date", "createdAt"])
    ?? readField(fields, ["data", "horario", "horário", "hora", "timestamp"])
    ?? (dateOnlyValue && timeOnlyValue ? `${dateOnlyValue} ${timeOnlyValue}` : null)
    ?? timestampSection[0]
    ?? regex(rawText, /(?:data|hor[aá]rio|timestamp)[:\s]+([0-9/:\-\sTZ.]+)/i);
  const playerName = readStringDeep(rawPayload, ["player", "playerName", "jogador", "responsavel", "responsável", "member", "nome", "author", "autor", "dominator"])
    ?? readField(fields, ["jogador", "player", "responsavel", "responsável", "membro", "novo membro", "nome", "autor", "dominator"])
    ?? recruitedSection[0]
    ?? regex(rawText, /(?:jogador|respons[aá]vel|novo membro|membro|player|nome)[:\s*]+([^\n|]+)/i);
  const playerId = readStringDeep(rawPayload, ["playerId", "id", "source", "userId", "passport", "passaporte"])
    ?? readField(fields, ["id", "player id", "id do jogador", "source", "passaporte", "passport"])
    ?? regex(rawText, /\b(?:id|source|passaporte|passport)[:\s#]+([0-9A-Za-z_-]+)/i);
  const recruiterName = readStringDeep(rawPayload, ["recruiter", "recrutador", "quemRecrutou", "recrutou", "recruitedBy"])
    ?? readField(fields, ["quem recrutou", "recrutador", "recrutou", "recruited by", "responsavel recrutamento"])
    ?? recruiterSection[0]
    ?? regex(rawText, /(?:quem recrutou|recrutador|recrutou)[:\s*]+([^\n|]+)/i);
  const recruiterId = readStringDeep(rawPayload, ["recruiterId", "recrutadorId"])
    ?? readField(fields, ["id recrutador", "recruiter id", "id de quem recrutou"]);
  const clanName = readStringDeep(rawPayload, ["clan", "clã", "gang", "faction", "facção", "organizacao", "organização", "org"])
    ?? readField(fields, ["clan", "clã", "gang", "facção", "faccao", "organizacao", "organização", "org"])
    ?? gangSection[0]
    ?? regex(rawText, /(?:cl[aã]|gang|fac[cç][aã]o)[:\s*]+([^\n|]+)/i)
    ?? fallbackClanName;
  const location = readStringDeep(rawPayload, ["location", "local", "territory", "territorio", "território", "area", "zona"])
    ?? readField(fields, ["local", "territorio", "território", "dominado", "zona", "area", "área"])
    ?? zoneSection[0]
    ?? regex(rawText, /(?:local|territ[oó]rio|dominado)[:\s*]+([^\n|]+)/i);
  const onlineSeconds = Number(readStringDeep(rawPayload, ["onlineSeconds", "durationSeconds", "seconds"]) ?? readField(fields, ["online seconds", "segundos online"]) ?? "") || parseDurationSeconds(readField(fields, ["tempo online", "duração", "duracao", "duration", "tempo"]) ?? rawText);
  const externalId = readStringDeep(rawPayload, ["eventId", "event_id", "messageId", "logId"])
    ?? readField(fields, ["event id", "id do evento", "log id", "message id"]);
  const messageId = readStringDeep(rawPayload, ["messageId"]);
  const webhookId = readStringDeep(rawPayload, ["webhookId"]);
  const channelId = readStringDeep(rawPayload, ["channelId"]);
  const participantCount = parseFirstNumber(readField(fields, ["participantes da gang", "participantes"]) ?? participantCountSection[0] ?? "");
  const totalPlayersInZone = parseFirstNumber(readField(fields, ["total de jogadores na zona", "total na zona"]) ?? totalPlayersSection[0] ?? "");
  const rivalGangs = parseRivalGangs(rivalGangSection.length ? rivalGangSection : splitFieldLines(readField(fields, ["outras gangs presentes", "gangs presentes"]) ?? ""));
  const participants = parseParticipants(participantSection.length ? participantSection : splitFieldLines(readField(fields, ["membros participantes", "participantes"]) ?? ""));
  const cleanedPlayerName = clean(playerName, 100) || null;
  const cleanedPlayerId = clean(playerId, 80) || null;
  const rankingParticipants = participants.length || eventType !== "domination" || !cleanedPlayerName
    ? participants
    : [{ id: cleanedPlayerId, name: cleanedPlayerName, normalizedName: normalizeEntity(cleanedPlayerName) }];
  const cleanedClanName = clean(stripBullet(clanName), 100);
  const cleanedLocation = clean(stripBullet(location ?? ""), 120);
  const hash = createHash("sha256").update(`${eventType}|${rawText}|${JSON.stringify(rawPayload ?? {})}`).digest("hex");

  return {
    channelId: clean(channelId, 80) || null,
    clanName: cleanedClanName,
    eventType,
    externalId: externalId ? clean(externalId, 160) : null,
    hash,
    location: cleanedLocation || null,
    messageId: clean(messageId, 80) || null,
    normalizedGangName: normalizeEntity(cleanedClanName),
    normalizedZoneName: cleanedLocation ? normalizeEntity(cleanedLocation) : null,
    onlineSeconds,
    participantCount,
    participants: rankingParticipants,
    playerId: cleanedPlayerId,
    playerName: cleanedPlayerName,
    rawText: rawText.slice(0, 6000),
    recruiterId: clean(recruiterId, 80) || null,
    recruiterName: clean(recruiterName, 100) || null,
    rivalGangs,
    totalPlayersInZone,
    webhookId: clean(webhookId, 80) || null,
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

function parseFirstNumber(value: string) {
  const match = /(\d+)/.exec(value);
  return match ? Number(match[1]) : null;
}

function parseRivalGangs(lines: string[]) {
  return lines
    .map((line) => {
      const cleaned = stripBullet(line);
      if (!cleaned || /^nenhum/i.test(cleaned)) return null;
      const match = /^(.+?)(?:[:\-–—]\s*|\s+)(\d+)\s*(?:jogador|jogadores|players)?/i.exec(cleaned);
      const name = clean(match?.[1] ?? cleaned.replace(/\d+\s*(?:jogador|jogadores|players)?/i, ""), 100);
      const players = match ? Number(match[2]) : parseFirstNumber(cleaned) ?? 0;
      return name ? { name, normalizedName: normalizeEntity(name), players } : null;
    })
    .filter((item): item is { name: string; normalizedName: string; players: number } => Boolean(item));
}

function parseParticipants(lines: string[]) {
  return lines
    .map((line) => {
      const cleaned = stripBullet(line);
      if (!cleaned) return null;
      const idMatch = /(?:id|passaporte|passport)[:#\s-]*([0-9A-Za-z_-]+)/i.exec(cleaned) ?? /\(([0-9A-Za-z_-]{2,})\)/.exec(cleaned);
      const name = clean(cleaned
        .replace(/(?:id|passaporte|passport)[:#\s-]*[0-9A-Za-z_-]+/ig, "")
        .replace(/\([0-9A-Za-z_-]{2,}\)/g, ""), 100);
      return name ? { id: idMatch?.[1] ?? null, name, normalizedName: normalizeEntity(name) } : null;
    })
    .filter((item): item is { id: string | null; name: string; normalizedName: string } => Boolean(item));
}

function splitFieldLines(value: string) {
  return value.split(/\n|•/g).map(stripBullet).filter(Boolean);
}

function readSection(rawText: string, labels: string[]) {
  const normalizedLabels = new Set(labels.map(normalizeKey));
  const lines = rawText.split(/\r?\n/g);
  const values: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collecting && values.length) break;
      continue;
    }

    const [rawLabel, ...sameLineValue] = trimmed.split(":");
    const lineLabel = normalizeKey(rawLabel ?? "");
    const labelOnly = normalizeKey(stripBullet(trimmed).replace(/:$/, ""));
    const isLabel = trimmed.includes(":")
      ? normalizedLabels.has(lineLabel)
      : normalizedLabels.has(labelOnly);
    const nextLabel = collecting && isKnownZtkSectionLabel(trimmed) && !isLabel;

    if (isLabel) {
      collecting = true;
      const inline = stripBullet(sameLineValue.join(":"));
      if (inline) values.push(inline);
      continue;
    }

    if (nextLabel) break;
    if (collecting) values.push(stripBullet(trimmed));
  }

  return values.filter(Boolean);
}

function isKnownZtkSectionLabel(value: string) {
  const normalized = normalizeKey(stripBullet(value).replace(/:$/, ""));
  return ZTK_SECTION_LABELS.has(normalized);
}

const ZTK_SECTION_LABELS = new Set([
  "clan",
  "clã",
  "data",
  "data e horario",
  "data e horário",
  "familia",
  "família",
  "gang",
  "gangs presentes",
  "hora",
  "horario",
  "horário",
  "jogadores na zona",
  "local",
  "local dominado",
  "membro recrutado",
  "membros participantes",
  "novo membro",
  "outras faccoes presentes",
  "outras facções presentes",
  "outras gangs presentes",
  "participantes",
  "participantes da dominacao",
  "participantes da dominação",
  "participantes da gang",
  "quem recrutou",
  "recrutado",
  "recrutador",
  "recrutou",
  "territorio dominado",
  "território dominado",
  "total de jogadores na zona",
  "total na zona",
  "zona dominada"
].map(normalizeKey));

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

function normalizeEntity(value: string) {
  return normalize(stripBullet(value)).replace(/[^a-z0-9]+/g, " ").trim();
}

function stripBullet(value: string) {
  return clean(value, 300).replace(/^[•\-–—*]+\s*/, "").trim();
}

function regex(value: string, pattern: RegExp) {
  return clean(pattern.exec(value)?.[1], 200) || null;
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(normalize(needle)));
}

function discordWebhookIdFromUrl(value: string) {
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{5,32})\/[-_.a-zA-Z0-9]+/i.exec(value.trim())?.[1] ?? null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (br) {
    const parsed = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 0), Number(br[5] ?? 0), Number(br[6] ?? 0));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function num(value: string | undefined) {
  return Number(String(value ?? "0").replace(",", ".")) || 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStringDeep(value: unknown, keys: string[]) {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  let found: string | null = null;
  const visit = (item: unknown) => {
    if (found) return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;
    for (const [key, fieldValue] of Object.entries(item)) {
      if (normalizedKeys.has(normalizeKey(key)) && (typeof fieldValue === "string" || typeof fieldValue === "number")) {
        found = clean(fieldValue, 200);
        return;
      }
      visit(fieldValue);
      if (found) return;
    }
  };
  visit(value);
  return found;
}

function collectLabelMap(value: unknown) {
  const labels = new Map<string, string[]>();
  const add = (key: unknown, fieldValue: unknown) => {
    const normalizedKey = normalizeKey(String(key ?? ""));
    const normalizedValue = clean(fieldValue, 300);
    if (!normalizedKey || !normalizedValue) return;
    labels.set(normalizedKey, [...(labels.get(normalizedKey) ?? []), normalizedValue]);
  };
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;
    if ("name" in item && "value" in item) add(item.name, item.value);
    for (const [key, fieldValue] of Object.entries(item)) {
      if (typeof fieldValue === "string" || typeof fieldValue === "number") {
        add(key, fieldValue);
      } else {
        visit(fieldValue);
      }
    }
  };
  visit(value);
  return labels;
}

function readField(fields: Map<string, string[]>, keys: string[]) {
  for (const key of keys) {
    const value = fields.get(normalizeKey(key))?.[0];
    if (value) return clean(value, 200);
  }
  return null;
}

function normalizeKey(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
}
