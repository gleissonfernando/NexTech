import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { env } from "../config/env";
import {
  ensureGuild,
  getMongoCollections,
  type MongoGiveaway,
  type MongoGiveawayParticipant,
  type MongoGiveawayParticipantMode,
  type MongoGiveawayStatus,
  type MongoGiveawayWinner
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { getDevBotToken } from "./devBotService";
import { isGuildTextChannel } from "./discordOptionsService";
import {
  buildSyncedGiveawayParticipants,
  getConnectedGiveawayAccounts,
  verifyConnectedAccountForGiveaway,
  type RecordedKickGiveawayWebhookEvent,
  type GiveawayConnectedAccountDto,
  type GiveawayEntryVerification
} from "./giveawayIdentityService";
import { ensureKickWebhookEventSubscriptions, getKickChannel, normalizeKickChannel } from "./kickService";
import { resolveKickApiCredentials } from "./kickNotificationService";
import { createLog } from "./logService";
import { getGuildSettings } from "./settingsService";
import { getTwitchStream, getTwitchUser, normalizeTwitchChannel } from "./twitchService";

export type GiveawayParticipantDto = {
  id: string;
  accountId: string | null;
  platform: "twitch" | "kick";
  platformUserId: string;
  username: string;
  displayName: string;
  subscriber: boolean;
  follower: boolean;
  source: "twitch" | "kick";
  subTier: string | null;
  subTierLabel: string | null;
  subMonths: number | null;
  isPrime: boolean;
  isVip: boolean;
  isModerator: boolean;
  isEditor: boolean;
  tickets: number;
  eligible: boolean;
  invalidReason: string | null;
  validatedAt: string;
};

export type GiveawayWinnerDto = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: string;
};

export type GiveawayDto = {
  id: string;
  botId: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch" | "kick" | "multi";
  twitchBroadcasterId: string;
  twitchChannelName: string | null;
  kickChannelName: string | null;
  kickUserId: string | null;
  kickChannelId: string | null;
  participantMode: MongoGiveawayParticipantMode;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  prizeName: string;
  participants: GiveawayParticipantDto[];
  winners: GiveawayWinnerDto[];
  status: MongoGiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  customMessage: string | null;
  schedulerError: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
};

export type GiveawayLivePreviewDto = {
  avatar: string | null;
  category: string | null;
  channelId: string | null;
  channelName: string;
  displayName: string;
  followers: number | null;
  isLive: boolean;
  platform: "twitch" | "kick";
  platformUserId: string;
  startedAt: string | null;
  status: "online" | "offline";
  thumbnailUrl: string | null;
  title: string | null;
  url: string;
  verified: boolean | null;
  viewerCount: number | null;
  warning: string | null;
};

export type SaveGiveawayInput = {
  allowRepeatWinners?: boolean;
  customMessage?: string | null;
  discordChannelId?: string | null;
  endDelayMinutes?: number | null;
  kickChannelInput?: string | null;
  liveUrl: string;
  participantMode?: MongoGiveawayParticipantMode | null;
  prizeName: string;
  startDelayMinutes?: number | null;
  title: string;
  winnerCount?: number | null;
};

export type GiveawaySpinResult = {
  giveaway: GiveawayDto;
  winner: GiveawayWinnerDto;
};

export type GiveawayIdentityDto = {
  accounts: GiveawayConnectedAccountDto[];
  entries: GiveawayParticipantDto[];
};

export type GiveawayEntryResult = {
  giveaway: GiveawayDto;
  identity: GiveawayIdentityDto;
  verifications: Array<{
    account: GiveawayConnectedAccountDto;
    eligible: boolean;
    participant: GiveawayParticipantDto;
    reason: string | null;
  }>;
};

const GIVEAWAY_MODULE_ID = "giveaway";
const DEFAULT_WINNER_COUNT = 1;
const MAX_WINNER_COUNT = 50;
const MAX_DELAY_MINUTES = 60 * 24 * 30;
let schedulerStarted = false;
let schedulerRunning = false;

export function giveawayModuleId() {
  return GIVEAWAY_MODULE_ID;
}

export async function listGiveaways(guildId: string, botId?: string | null, limit = 50) {
  const { giveaways } = await getMongoCollections();
  const docs = await giveaways
    .find(scopeQuery(guildId, normalizeBotId(botId)))
    .sort({
      createdAt: -1
    })
    .limit(Math.max(1, Math.min(limit, 100)))
    .toArray();

  return docs.map(toGiveawayDto);
}

export async function listBotGiveaways(botId?: string | null) {
  const { giveaways } = await getMongoCollections();
  const normalizedBotId = normalizeBotId(botId);
  const docs = await giveaways
    .find({
      discordChannelId: {
        $ne: null
      },
      $and: [
        botScopeQuery(normalizedBotId),
        {
          $or: [
            {
              status: {
                $in: ["waiting", "running"]
              }
            },
            {
              panelMessageId: {
                $ne: null
              }
            }
          ]
        }
      ]
    })
    .sort({
      updatedAt: -1
    })
    .limit(100)
    .toArray();

  return docs.map(toGiveawayDto);
}

export async function getGiveaway(giveawayId: string, botId?: string | null) {
  const giveaway = await findGiveawayById(giveawayId, normalizeBotId(botId));
  return giveaway ? toGiveawayDto(giveaway) : null;
}

export async function getRouletteGiveaway(token: string) {
  const giveaway = await findGiveawayByToken(token);

  if (!giveaway) {
    throw createGiveawayError("Roleta nao encontrada.", 404);
  }

  return toGiveawayDto(giveaway);
}

export async function previewGiveawayLive(guildId: string, liveUrl: string, botId?: string | null): Promise<GiveawayLivePreviewDto> {
  const live = await resolveGiveawayLive(liveUrl, guildId, normalizeBotId(botId));
  return live.preview;
}

export async function createGiveaway(
  guildId: string,
  input: SaveGiveawayInput,
  ownerId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();
  const discordChannelId = normalizeDiscordChannelId(input.discordChannelId);

  if (!discordChannelId) {
    throw createGiveawayError("Selecione um canal do Discord antes de criar o sorteio.", 400);
  }

  if (discordChannelId && !(await isGuildTextChannel(guildId, discordChannelId, botToken))) {
    throw createGiveawayError("O canal selecionado nao pertence a este servidor.", 400);
  }

  const live = await resolveGiveawayLive(input.liveUrl, guildId, normalizedBotId);
  const extraKick = live.platform === "twitch" && input.kickChannelInput
    ? await resolveKickGiveawayChannel(input.kickChannelInput, guildId, normalizedBotId)
    : null;
  const rouletteToken = randomBytes(24).toString("base64url");
  const startDelayMinutes = normalizeDelay(input.startDelayMinutes);
  const endDelayMinutes = normalizeDelay(input.endDelayMinutes);
  const participantMode = normalizeParticipantMode(input.participantMode, extraKick ? "multi" : live.platform);
  const doc: MongoGiveaway = {
    _id: randomUUID(),
    botId: normalizedBotId,
    guildId,
    ownerId,
    discordChannelId,
    title: normalizeTitle(input.title),
    liveName: live.displayName,
    liveUrl: live.url,
    livePlatform: extraKick ? "multi" : live.platform,
    twitchBroadcasterId: live.platform === "twitch" ? live.platformUserId : "",
    twitchChannelName: live.platform === "twitch" ? live.channelName : null,
    kickChannelName: extraKick?.slug ?? (live.platform === "kick" ? live.channelName : null),
    kickUserId: extraKick?.broadcasterUserId ?? (live.platform === "kick" ? live.platformUserId : null),
    kickChannelId: extraKick?.channelId ?? (live.platform === "kick" ? live.channelId : null),
    participantMode,
    lastSyncedAt: null,
    lastSyncError: null,
    prizeName: normalizePrize(input.prizeName),
    participants: [],
    winners: [],
    status: "waiting",
    rouletteToken,
    rouletteUrl: buildRouletteUrl(rouletteToken),
    panelMessageId: null,
    winnerCount: normalizeWinnerCount(input.winnerCount),
    allowRepeatWinners: input.allowRepeatWinners === true,
    startDelayMinutes,
    endDelayMinutes,
    scheduledStartAt: startDelayMinutes > 0 ? addMinutes(now, startDelayMinutes) : null,
    scheduledEndAt: null,
    customMessage: normalizeMessage(input.customMessage),
    schedulerError: null,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    updatedAt: now
  };

  await ensureGuild(guildId);
  const { giveaways } = await getMongoCollections();
  await giveaways.insertOne(doc);
  await writeGiveawayLog(doc, "giveaway.created", ownerId, `Sorteio criado: ${doc.title}.`);
  const synced = await syncGiveawayForPanel(doc, ownerId, normalizedBotId);
  emitGiveawayUpdated(synced);

  return toGiveawayDto(synced);
}

export async function updateGiveaway(
  giveawayId: string,
  input: SaveGiveawayInput,
  actorId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await findGiveawayById(giveawayId, normalizedBotId);

  if (!current) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  if (current.status === "ended") {
    throw createGiveawayError("Sorteios encerrados nao podem ser editados.", 400);
  }

  const discordChannelId = normalizeDiscordChannelId(input.discordChannelId);

  if (!discordChannelId) {
    throw createGiveawayError("Selecione um canal do Discord antes de criar o sorteio.", 400);
  }

  if (discordChannelId && !(await isGuildTextChannel(current.guildId, discordChannelId, botToken))) {
    throw createGiveawayError("O canal selecionado nao pertence a este servidor.", 400);
  }

  const live = await resolveGiveawayLive(input.liveUrl, current.guildId, normalizedBotId);
  const extraKick = live.platform === "twitch" && input.kickChannelInput
    ? await resolveKickGiveawayChannel(input.kickChannelInput, current.guildId, normalizedBotId)
    : null;
  const now = new Date();
  const startDelayMinutes = normalizeDelay(input.startDelayMinutes);
  const endDelayMinutes = normalizeDelay(input.endDelayMinutes);
  const participantMode = normalizeParticipantMode(input.participantMode, extraKick ? "multi" : live.platform);
  const patch: Partial<MongoGiveaway> = {
    discordChannelId,
    title: normalizeTitle(input.title),
    liveName: live.displayName,
    liveUrl: live.url,
    livePlatform: extraKick ? "multi" : live.platform,
    twitchBroadcasterId: live.platform === "twitch" ? live.platformUserId : "",
    twitchChannelName: live.platform === "twitch" ? live.channelName : null,
    kickChannelName: extraKick?.slug ?? (live.platform === "kick" ? live.channelName : null),
    kickUserId: extraKick?.broadcasterUserId ?? (live.platform === "kick" ? live.platformUserId : null),
    kickChannelId: extraKick?.channelId ?? (live.platform === "kick" ? live.channelId : null),
    participantMode,
    prizeName: normalizePrize(input.prizeName),
    winnerCount: normalizeWinnerCount(input.winnerCount),
    allowRepeatWinners: input.allowRepeatWinners === true,
    startDelayMinutes,
    endDelayMinutes,
    scheduledStartAt: current.status === "waiting" && startDelayMinutes > 0 ? addMinutes(now, startDelayMinutes) : null,
    scheduledEndAt: current.status === "running" && endDelayMinutes > 0 ? addMinutes(now, endDelayMinutes) : current.scheduledEndAt,
    customMessage: normalizeMessage(input.customMessage),
    schedulerError: null,
    updatedAt: now
  };

  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveawayId,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: patch
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  await writeGiveawayLog(updated, "giveaway.updated", actorId, `Sorteio atualizado: ${updated.title}.`);
  const synced = await syncGiveawayForPanel(updated, actorId, normalizedBotId);
  emitGiveawayUpdated(synced);
  requestGiveawayPanelUpdate(synced, "update");

  return toGiveawayDto(synced);
}

export async function publishGiveawayPanel(giveawayId: string, actorId: string, botId?: string | null) {
  const giveaway = await findGiveawayById(giveawayId, normalizeBotId(botId));

  if (!giveaway) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  if (!giveaway.discordChannelId) {
    throw createGiveawayError("Selecione o canal do Discord antes de criar o painel.", 400);
  }

  await writeGiveawayLog(giveaway, "giveaway.panel_requested", actorId, `Painel do sorteio solicitado: ${giveaway.title}.`);
  requestGiveawayPanelUpdate(giveaway, "publish");

  return toGiveawayDto(giveaway);
}

export async function startGiveaway(giveawayId: string, actorId: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const giveaway = await findGiveawayById(giveawayId, normalizedBotId);

  if (!giveaway) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  if (giveaway.status === "ended") {
    throw createGiveawayError("Sorteio encerrado nao pode ser iniciado.", 400);
  }

  if (!giveaway.liveUrl || !giveawayHasResolvedChannel(giveaway)) {
    throw createGiveawayError("Cadastre a live antes de iniciar o sorteio.", 400);
  }

  const sync = await syncGiveawayParticipantsForDocument(giveaway, actorId, "start");
  const participants = sync.participants;

  if (!participants.length) {
    throw createGiveawayError("Nenhum participante elegivel foi encontrado para este sorteio.", 400);
  }

  const now = new Date();
  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveaway._id,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        participants,
        status: "running",
        startedAt: giveaway.startedAt ?? now,
        scheduledStartAt: null,
        scheduledEndAt: giveaway.endDelayMinutes > 0 ? addMinutes(now, giveaway.endDelayMinutes) : giveaway.scheduledEndAt,
        schedulerError: null,
        updatedAt: now
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  await writeGiveawayLog(updated, "giveaway.started", actorId, `Sorteio iniciado com ${participants.length} participante(s): ${updated.title}.`);
  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  return toGiveawayDto(updated);
}

export async function endGiveaway(giveawayId: string, actorId: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { giveaways } = await getMongoCollections();
  const now = new Date();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveawayId,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        status: "ended",
        scheduledStartAt: null,
        scheduledEndAt: null,
        endedAt: now,
        schedulerError: null,
        updatedAt: now
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  await writeGiveawayLog(updated, "giveaway.ended", actorId, `Sorteio encerrado: ${updated.title}.`);
  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  return toGiveawayDto(updated);
}

export async function syncGiveawayParticipants(giveawayId: string, actorId: string | null, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const giveaway = await findGiveawayById(giveawayId, normalizedBotId);

  if (!giveaway) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  const sync = await syncGiveawayParticipantsForDocument(giveaway, actorId, "manual");
  const updated = await findGiveawayById(giveaway._id, normalizedBotId);

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado apos sincronizar.", 404);
  }

  await writeGiveawayLog(
    updated,
    "giveaway.sync.completed",
    actorId,
    `Participantes sincronizados: ${sync.participants.length} elegivel(is), ${sync.removed.length} removido(s).`
  );
  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  return toGiveawayDto(updated);
}

export async function syncGiveawaysFromKickWebhook(input: {
  eventType: string;
  events: RecordedKickGiveawayWebhookEvent[];
}) {
  const userIds = [...new Set(input.events.map((event) => event.broadcasterUserId).filter((value): value is string => Boolean(value)))];
  const channelSlugs = [...new Set(input.events.map((event) => event.channelSlug).filter((value): value is string => Boolean(value)))];

  if (!userIds.length && !channelSlugs.length) {
    return {
      failed: 0,
      matched: 0,
      synced: 0
    };
  }

  const { giveaways } = await getMongoCollections();
  const docs = await giveaways
    .find({
      status: {
        $ne: "ended"
      },
      $or: [
        ...(userIds.length
          ? [{
              kickUserId: {
                $in: userIds
              }
            }]
          : []),
        ...(channelSlugs.length
          ? [{
              kickChannelName: {
                $in: channelSlugs
              }
            }]
          : [])
      ]
    })
    .limit(100)
    .toArray();
  let synced = 0;
  let failed = 0;

  for (const giveaway of docs) {
    try {
      await syncGiveawayParticipantsForDocument(giveaway, null, "webhook");
      const updated = await findGiveawayById(giveaway._id, normalizeBotId(giveaway.botId));

      if (updated) {
        emitGiveawayUpdated(updated);
        requestGiveawayPanelUpdate(updated, "update");
      }

      synced += 1;
    } catch (error) {
      failed += 1;
      console.warn("[giveaway:kick] falha ao sincronizar sorteio por webhook:", {
        error: error instanceof Error ? error.message : String(error),
        eventType: input.eventType,
        giveawayId: giveaway._id
      });
    }
  }

  return {
    failed,
    matched: docs.length,
    synced
  };
}

export async function getGiveawayIdentity(token: string, accountIds?: { kick?: string; twitch?: string }): Promise<GiveawayIdentityDto> {
  const giveaway = await findGiveawayByToken(token);

  if (!giveaway) {
    throw createGiveawayError("Roleta nao encontrada.", 404);
  }

  const accounts = await getConnectedGiveawayAccounts(accountIds);
  const accountIdSet = new Set(accounts.map((account) => account.id));
  const entries = (giveaway.participants ?? [])
    .filter((participant) => participant.accountId && accountIdSet.has(participant.accountId))
    .map(toParticipantDto);

  return {
    accounts,
    entries
  };
}

export async function enterGiveaway(token: string, accountIds: { kick?: string; twitch?: string }): Promise<GiveawayEntryResult> {
  const giveaway = await findGiveawayByToken(token);

  if (!giveaway) {
    throw createGiveawayError("Roleta nao encontrada.", 404);
  }

  if (giveaway.status === "ended") {
    throw createGiveawayError("Este sorteio ja foi encerrado.", 400);
  }

  const ids = [accountIds.twitch, accountIds.kick].filter((id): id is string => Boolean(id));

  if (!ids.length) {
    throw createGiveawayError("Conecte sua Twitch ou Kick antes de entrar no sorteio.", 400);
  }

  const verifications: GiveawayEntryVerification[] = [];
  const participantsById = new Map((giveaway.participants ?? []).map((participant) => [participant.id, participant]));

  for (const accountId of ids) {
    const verification = await verifyConnectedAccountForGiveaway(giveaway, accountId);
    verifications.push(verification);

    await writeGiveawayLog(
      giveaway,
      verification.participant.source === "twitch" ? "giveaway.twitch.verification" : "giveaway.kick.verification",
      verification.participant.platformUserId ?? verification.participant.id,
      `${verification.participant.displayName}: ${verification.eligible ? "verificacao aprovada" : verification.reason ?? "verificacao recusada"}.`
    );

    if (verification.eligible) {
      participantsById.set(verification.participant.id, verification.participant);
    } else {
      participantsById.delete(verification.participant.id);
    }
  }

  const participants = [...participantsById.values()].filter((participant) => participant.eligible !== false);
  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveaway._id
    },
    {
      $set: {
        participants,
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado apos entrar.", 404);
  }

  for (const verification of verifications) {
    if (verification.eligible) {
      await writeGiveawayLog(
        updated,
        "giveaway.participant.joined",
        verification.participant.platformUserId ?? verification.participant.id,
        `${verification.participant.displayName} entrou no sorteio com ${verification.participant.tickets ?? 1} ticket(s).`
      );
    } else {
      await writeGiveawayLog(
        updated,
        "giveaway.participant.removed",
        verification.participant.platformUserId ?? verification.participant.id,
        `${verification.participant.displayName} removido do sorteio: ${verification.reason ?? "nao elegivel"}.`
      );
    }
  }

  emitGiveawayUpdated(updated);
  requestGiveawayPanelUpdate(updated, "update");

  const identity = await getGiveawayIdentity(token, accountIds);

  return {
    giveaway: toGiveawayDto(updated),
    identity,
    verifications: verifications.map((verification) => ({
      account: verification.account,
      eligible: verification.eligible,
      participant: toParticipantDto(verification.participant),
      reason: verification.reason
    }))
  };
}

export async function spinGiveawayRoulette(token: string): Promise<GiveawaySpinResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const giveaway = await findGiveawayByToken(token);

    if (!giveaway) {
      throw createGiveawayError("Roleta nao encontrada.", 404);
    }

    if (giveaway.status !== "running") {
      throw createGiveawayError(giveaway.status === "ended" ? "Esta roleta ja foi encerrada." : "O sorteio ainda nao foi iniciado.", 400);
    }

    if (giveaway.winners.length >= giveaway.winnerCount) {
      const ended = await endGiveaway(giveaway._id, null, giveaway.botId);
      throw createGiveawayError(`Limite de ${ended.winnerCount} ganhador(es) ja foi atingido.`, 400);
    }

    const freshParticipants = (giveaway.participants ?? []).filter((participant) => participant.eligible !== false);
    const previousWinnerIds = new Set(giveaway.winners.map((winner) => winner.participantId));
    const eligibleParticipants = freshParticipants.filter((participant) => (
      giveaway.allowRepeatWinners || !previousWinnerIds.has(participant.id)
    ));

    if (!eligibleParticipants.length) {
      throw createGiveawayError("Nao existem participantes elegiveis para sortear.", 400);
    }

    const participant = pickWeightedParticipant(eligibleParticipants);

    if (!participant) {
      throw createGiveawayError("Nao foi possivel selecionar um participante.", 500);
    }

    const now = new Date();
    const winner: MongoGiveawayWinner = {
      participantId: participant.id,
      username: participant.username,
      displayName: participant.displayName,
      wonAt: now
    };
    const willEnd = giveaway.winners.length + 1 >= giveaway.winnerCount;
    const updateQuery: Record<string, unknown> = {
      _id: giveaway._id,
      status: "running",
      $expr: {
        $lt: [
          {
            $size: "$winners"
          },
          "$winnerCount"
        ]
      }
    };

    if (!giveaway.allowRepeatWinners) {
      updateQuery["winners.participantId"] = {
        $ne: winner.participantId
      };
    }

    const { giveaways } = await getMongoCollections();
    const result = await giveaways.updateOne(updateQuery, {
      $push: {
        winners: winner
      },
      $set: {
        participants: freshParticipants,
        status: willEnd ? "ended" : "running",
        endedAt: willEnd ? now : giveaway.endedAt,
        scheduledEndAt: willEnd ? null : giveaway.scheduledEndAt,
        schedulerError: null,
        updatedAt: now
      }
    });

    if (!result.modifiedCount) {
      continue;
    }

    const updated = await findGiveawayById(giveaway._id, normalizeBotId(giveaway.botId));

    if (!updated) {
      throw createGiveawayError("Sorteio nao encontrado apos girar a roleta.", 404);
    }

    await writeGiveawayLog(updated, "giveaway.winner", null, `Ganhador sorteado: ${winner.displayName}.`);
    emitGiveawayUpdated(updated);
    requestGiveawayPanelUpdate(updated, "update");

    return {
      giveaway: toGiveawayDto(updated),
      winner: toWinnerDto(winner)
    };
  }

  throw createGiveawayError("Nao foi possivel confirmar o vencedor. Tente girar novamente.", 409);
}

export async function updateGiveawayPanelState(
  giveawayId: string,
  input: {
    panelMessageId?: string | null;
  },
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const { giveaways } = await getMongoCollections();
  const updated = await giveaways.findOneAndUpdate(
    {
      _id: giveawayId,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        panelMessageId: input.panelMessageId ?? null,
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createGiveawayError("Sorteio nao encontrado.", 404);
  }

  emitGiveawayUpdated(updated);
  return toGiveawayDto(updated);
}

export function startGiveawayScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  const interval = setInterval(() => {
    void runScheduledGiveaways().catch((error) => {
      console.warn("[giveaway] scheduler falhou:", error instanceof Error ? error.message : error);
    });
  }, 30_000);

  interval.unref();
  void runScheduledGiveaways().catch((error) => {
    console.warn("[giveaway] scheduler inicial falhou:", error instanceof Error ? error.message : error);
  });
}

async function runScheduledGiveaways() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;

  try {
    const now = new Date();
    const { giveaways } = await getMongoCollections();
    const [toStart, toEnd] = await Promise.all([
      giveaways
        .find({
          status: "waiting",
          scheduledStartAt: {
            $ne: null,
            $lte: now
          }
        })
        .limit(20)
        .toArray(),
      giveaways
        .find({
          status: "running",
          scheduledEndAt: {
            $ne: null,
            $lte: now
          }
        })
        .limit(20)
        .toArray()
    ]);

    for (const giveaway of toStart) {
      await startGiveaway(giveaway._id, null, giveaway.botId).catch((error) => markSchedulerError(giveaway._id, error));
    }

    for (const giveaway of toEnd) {
      await endGiveaway(giveaway._id, null, giveaway.botId).catch((error) => markSchedulerError(giveaway._id, error));
    }
  } finally {
    schedulerRunning = false;
  }
}

async function markSchedulerError(giveawayId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const { giveaways } = await getMongoCollections();
  await giveaways.updateOne(
    {
      _id: giveawayId
    },
    {
      $set: {
        schedulerError: message,
        updatedAt: new Date()
      }
    }
  );
}

async function findGiveawayById(giveawayId: string, botId: string | null) {
  const { giveaways } = await getMongoCollections();
  return giveaways.findOne({
    _id: giveawayId,
    ...botScopeQuery(botId)
  });
}

async function findGiveawayByToken(token: string) {
  const { giveaways } = await getMongoCollections();
  return giveaways.findOne({
    rouletteToken: token
  });
}

async function resolveGiveawayLive(value: string, guildId: string, botId: string | null) {
  const platform = detectGiveawayPlatform(value);

  if (platform === "youtube") {
    throw createGiveawayError("YouTube ainda nao esta disponivel para sorteios. Informe uma URL valida da Twitch ou Kick.", 400);
  }

  if (platform === "kick") {
    return resolveKickGiveawayChannel(value, guildId, botId);
  }

  return resolveTwitchLive(value);
}

async function resolveTwitchLive(value: string) {
  const channel = normalizeTwitchChannel(value);

  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) {
    throw createGiveawayError("Informe uma URL valida da Twitch ou Kick.", 400);
  }

  const user = await getTwitchUser(channel).catch((error) => {
    throw createGiveawayError(error instanceof Error ? error.message : "Nao foi possivel consultar a Twitch.", 503);
  });

  if (!user) {
    throw createGiveawayError("Canal da Twitch nao encontrado.", 404);
  }

  const stream = await getTwitchStream(user.login).catch(() => null);

  return {
    channelId: null,
    channelName: user.login,
    displayName: user.displayName || user.login,
    platform: "twitch" as const,
    platformUserId: user.id,
    preview: {
      avatar: user.profileImageUrl,
      category: stream?.gameName || null,
      channelId: null,
      channelName: user.login,
      displayName: user.displayName || user.login,
      followers: null,
      isLive: Boolean(stream),
      platform: "twitch" as const,
      platformUserId: user.id,
      startedAt: stream?.startedAt ?? null,
      status: stream ? "online" as const : "offline" as const,
      thumbnailUrl: stream?.thumbnailUrl ?? null,
      title: stream?.title || null,
      url: `https://www.twitch.tv/${user.login}`,
      verified: null,
      viewerCount: stream?.viewerCount ?? null,
      warning: null
    },
    url: `https://www.twitch.tv/${user.login}`
  };
}

async function resolveKickGiveawayChannel(value: string, guildId: string, botId: string | null) {
  const channel = normalizeKickChannel(value);

  if (!channel || !/^[a-z0-9_-]{3,25}$/i.test(channel)) {
    throw createGiveawayError("Informe uma URL valida da Twitch ou Kick.", 400);
  }

  const credentials = await resolveKickApiCredentials(guildId, botId);
  const kick = await getKickChannel(channel, credentials).catch((error) => {
    throw createGiveawayError(error instanceof Error ? error.message : "Nao foi possivel consultar a Kick.", 503);
  });

  if (!kick) {
    throw createGiveawayError("Canal da Kick nao encontrado.", 404);
  }

  await ensureKickWebhookEventSubscriptions(kick.broadcasterUserId, credentials).catch((error) => {
    throw createGiveawayError(
      `Canal Kick encontrado, mas nao foi possivel ativar o webhook: ${error instanceof Error ? error.message : String(error)}`,
      503
    );
  });

  return {
    ...kick,
    channelName: kick.slug,
    displayName: kick.displayName || kick.slug,
    platform: "kick" as const,
    platformUserId: kick.broadcasterUserId,
    preview: {
      avatar: kick.avatar,
      category: kick.categoryName,
      channelId: kick.channelId,
      channelName: kick.slug,
      displayName: kick.displayName || kick.slug,
      followers: kick.followers,
      isLive: kick.isLive,
      platform: "kick" as const,
      platformUserId: kick.broadcasterUserId,
      startedAt: kick.startedAt,
      status: kick.isLive ? "online" as const : "offline" as const,
      thumbnailUrl: kick.thumbnailUrl,
      title: kick.title,
      url: `https://kick.com/${kick.slug}`,
      verified: kick.verified,
      viewerCount: kick.viewerCount,
      warning: "A Kick pode limitar a verificacao automatica de subs nesta conta/API. Se nao encontrar participantes, confira os eventos/webhook da Kick ou atualize pelo painel."
    },
    url: `https://kick.com/${kick.slug}`
  };
}

async function syncGiveawayParticipantsForDocument(
  giveaway: MongoGiveaway,
  actorId: string | null,
  reason: "manual" | "panel" | "start" | "webhook"
) {
  try {
    const sync = await buildSyncedGiveawayParticipants(giveaway);
    const now = new Date();
    const { giveaways } = await getMongoCollections();
    const previousIds = new Set((giveaway.participants ?? []).map((participant) => participant.id));
    const added = sync.participants.filter((participant) => !previousIds.has(participant.id));

    await giveaways.updateOne(
      {
        _id: giveaway._id
      },
      {
        $set: {
          lastSyncedAt: now,
          lastSyncError: null,
          participants: sync.participants,
          updatedAt: now
        }
      }
    );

    await writeGiveawayLog(
      giveaway,
      syncLogType(reason),
      actorId,
      `Sincronizacao Twitch/Kick concluida: ${sync.participants.length} participante(s).`
    );

    if (added.length) {
      await writeGiveawayLog(
        giveaway,
        "giveaway.participant.added",
        actorId,
        `${added.length} participante(s) adicionado(s): ${summarizeParticipantNames(added)}.`
      );
    }

    for (const removed of sync.removed) {
      await writeGiveawayLog(
        giveaway,
        "giveaway.participant.removed",
        removed.platformUserId ?? removed.id,
        `${removed.displayName} removido da lista final.`
      );
    }

    return sync;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel sincronizar participantes.";
    const { giveaways } = await getMongoCollections();

    await giveaways.updateOne(
      {
        _id: giveaway._id
      },
      {
        $set: {
          lastSyncError: message,
          updatedAt: new Date()
        }
      }
    );

    await writeGiveawayLog(giveaway, "giveaway.sync.failed", actorId, `Falha ao sincronizar participantes: ${message}.`);
    throw createGiveawayError(message, 503);
  }
}

function syncLogType(reason: "manual" | "panel" | "start" | "webhook") {
  if (reason === "manual") return "giveaway.sync.manual";
  if (reason === "start") return "giveaway.sync.start";
  if (reason === "webhook") return "giveaway.sync.webhook";
  return "giveaway.sync.panel";
}

function summarizeParticipantNames(participants: MongoGiveawayParticipant[]) {
  const names = participants.slice(0, 8).map((participant) => participant.displayName || participant.username);
  const suffix = participants.length > names.length ? ` e mais ${participants.length - names.length}` : "";

  return `${names.join(", ")}${suffix}`;
}

async function syncGiveawayForPanel(giveaway: MongoGiveaway, actorId: string | null, botId: string | null) {
  try {
    await syncGiveawayParticipantsForDocument(giveaway, actorId, "panel");
  } catch {
    // The giveaway remains saved; the sync routine persists the actionable error for the panel.
  }

  return (await findGiveawayById(giveaway._id, botId)) ?? giveaway;
}

function emitGiveawayUpdated(giveaway: MongoGiveaway) {
  emitRealtime("giveaway:updated", toGiveawayDto(giveaway));
}

function requestGiveawayPanelUpdate(giveaway: MongoGiveaway, action: "publish" | "update") {
  const payload = {
    action,
    botId: normalizeBotId(giveaway.botId),
    giveawayId: giveaway._id,
    guildId: giveaway.guildId
  };

  if (payload.botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(payload.botId), "giveaway:panel_update", payload);
    return;
  }

  emitRealtime("giveaway:panel_update", payload);
}

async function writeGiveawayLog(giveaway: MongoGiveaway, type: string, userId: string | null, message: string) {
  const log = await createLog({
    botId: normalizeBotId(giveaway.botId),
    guildId: giveaway.guildId,
    userId,
    type,
    message,
    metadata: {
      giveawayId: giveaway._id,
      module: GIVEAWAY_MODULE_ID,
      status: giveaway.status
    }
  });
  await sendDiscordGiveawayLog(giveaway, type, message).catch(() => undefined);
  return log;
}

async function sendDiscordGiveawayLog(giveaway: MongoGiveaway, type: string, message: string) {
  const botId = normalizeBotId(giveaway.botId);
  const settings = await getGuildSettings(giveaway.guildId, botId);

  if (!settings.logChannelId) {
    return;
  }

  const token = botId ? await getDevBotToken(botId) : env.DISCORD_BOT_TOKEN;

  if (!token) {
    return;
  }

  await fetch(`https://discord.com/api/v10/channels/${settings.logChannelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      allowed_mentions: {
        parse: []
      },
      embeds: [
        {
          color: 0x22c55e,
          title: "Log de Sorteio",
          description: message,
          fields: [
            {
              name: "Tipo",
              value: type,
              inline: true
            },
            {
              name: "Sorteio",
              value: giveaway.title,
              inline: true
            }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    })
  });
}

function toGiveawayDto(giveaway: MongoGiveaway): GiveawayDto {
  return {
    id: giveaway._id,
    botId: normalizeBotId(giveaway.botId),
    guildId: giveaway.guildId,
    ownerId: giveaway.ownerId,
    discordChannelId: giveaway.discordChannelId ?? null,
    title: giveaway.title,
    liveName: giveaway.liveName,
    liveUrl: giveaway.liveUrl,
    livePlatform: giveaway.livePlatform ?? "twitch",
    twitchBroadcasterId: giveaway.twitchBroadcasterId,
    twitchChannelName: giveaway.twitchChannelName ?? null,
    kickChannelName: giveaway.kickChannelName ?? null,
    kickUserId: giveaway.kickUserId ?? null,
    kickChannelId: giveaway.kickChannelId ?? null,
    participantMode: giveaway.participantMode ?? "twitch_subs",
    lastSyncedAt: giveaway.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: giveaway.lastSyncError ?? null,
    prizeName: giveaway.prizeName,
    participants: (giveaway.participants ?? []).map(toParticipantDto),
    winners: (giveaway.winners ?? []).map(toWinnerDto),
    status: giveaway.status,
    rouletteToken: giveaway.rouletteToken,
    rouletteUrl: giveaway.rouletteUrl,
    panelMessageId: giveaway.panelMessageId ?? null,
    winnerCount: giveaway.winnerCount,
    allowRepeatWinners: giveaway.allowRepeatWinners,
    startDelayMinutes: giveaway.startDelayMinutes,
    endDelayMinutes: giveaway.endDelayMinutes,
    scheduledStartAt: giveaway.scheduledStartAt?.toISOString() ?? null,
    scheduledEndAt: giveaway.scheduledEndAt?.toISOString() ?? null,
    customMessage: giveaway.customMessage ?? null,
    schedulerError: giveaway.schedulerError ?? null,
    createdAt: giveaway.createdAt.toISOString(),
    startedAt: giveaway.startedAt?.toISOString() ?? null,
    endedAt: giveaway.endedAt?.toISOString() ?? null,
    updatedAt: giveaway.updatedAt.toISOString()
  };
}

function toParticipantDto(participant: MongoGiveawayParticipant): GiveawayParticipantDto {
  return {
    id: participant.id,
    accountId: participant.accountId ?? null,
    platform: participant.platform ?? participant.source,
    platformUserId: participant.platformUserId ?? participant.id,
    username: participant.username,
    displayName: participant.displayName,
    subscriber: participant.subscriber === true,
    follower: participant.follower === true,
    source: participant.source,
    subTier: participant.subTier ?? null,
    subTierLabel: participant.subTierLabel ?? null,
    subMonths: participant.subMonths ?? null,
    isPrime: participant.isPrime === true,
    isVip: participant.isVip === true,
    isModerator: participant.isModerator === true,
    isEditor: participant.isEditor === true,
    tickets: participant.tickets ?? 1,
    eligible: participant.eligible !== false,
    invalidReason: participant.invalidReason ?? null,
    validatedAt: participant.validatedAt.toISOString()
  };
}

function toWinnerDto(winner: MongoGiveawayWinner): GiveawayWinnerDto {
  return {
    participantId: winner.participantId,
    username: winner.username,
    displayName: winner.displayName,
    wonAt: winner.wonAt.toISOString()
  };
}

function normalizeTitle(value: string) {
  const title = value.trim().slice(0, 120);

  if (!title) {
    throw createGiveawayError("Informe o nome do sorteio.", 400);
  }

  return title;
}

function normalizePrize(value: string) {
  const prize = value.trim().slice(0, 160);

  if (!prize) {
    throw createGiveawayError("Informe o premio do sorteio.", 400);
  }

  return prize;
}

function normalizeMessage(value?: string | null) {
  const message = value?.trim();
  return message ? message.slice(0, 1200) : null;
}

function normalizeDiscordChannelId(value?: string | null) {
  const channelId = value?.trim();
  return channelId && /^\d{5,32}$/.test(channelId) ? channelId : null;
}

function normalizeWinnerCount(value?: number | null) {
  const count = Math.floor(Number(value ?? DEFAULT_WINNER_COUNT));
  return Math.max(1, Math.min(Number.isFinite(count) ? count : DEFAULT_WINNER_COUNT, MAX_WINNER_COUNT));
}

function normalizeDelay(value?: number | null) {
  const minutes = Math.floor(Number(value ?? 0));
  return Math.max(0, Math.min(Number.isFinite(minutes) ? minutes : 0, MAX_DELAY_MINUTES));
}

function normalizeParticipantMode(value?: MongoGiveawayParticipantMode | null, platform: "twitch" | "kick" | "multi" = "twitch"): MongoGiveawayParticipantMode {
  const requested = value ?? "all";
  const allModes: MongoGiveawayParticipantMode[] = [
    "all",
    "kick_followers",
    "kick_subs",
    "twitch_followers",
    "twitch_kick",
    "twitch_subs",
    "twitch_subs_followers"
  ];

  if (!allModes.includes(requested)) {
    return "all";
  }

  if (platform === "kick") {
    return ["all", "kick_followers", "kick_subs"].includes(requested) ? requested : "all";
  }

  if (platform === "multi") {
    return requested;
  }

  return ["all", "twitch_followers", "twitch_kick", "twitch_subs", "twitch_subs_followers"].includes(requested) ? requested : "all";
}

function detectGiveawayPlatform(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw createGiveawayError("Informe uma URL valida da Twitch ou Kick.", 400);
  }

  if (/(^|\/\/|www\.)kick\.com\//i.test(normalized) || /^kick\.com\//i.test(normalized)) {
    return "kick" as const;
  }

  if (/(^|\/\/|www\.)twitch\.tv\//i.test(normalized) || /^twitch\.tv\//i.test(normalized)) {
    return "twitch" as const;
  }

  if (/(^|\/\/|www\.)(youtube\.com|youtu\.be)\//i.test(normalized) || /^(youtube\.com|youtu\.be)\//i.test(normalized)) {
    return "youtube" as const;
  }

  return "twitch" as const;
}

function giveawayHasResolvedChannel(giveaway: MongoGiveaway) {
  if (giveaway.livePlatform === "kick") {
    return Boolean(giveaway.kickChannelName || giveaway.kickUserId);
  }

  if (giveaway.livePlatform === "multi") {
    return Boolean(giveaway.twitchBroadcasterId || giveaway.kickChannelName || giveaway.kickUserId);
  }

  return Boolean(giveaway.twitchBroadcasterId);
}

function pickWeightedParticipant(participants: MongoGiveawayParticipant[]) {
  const totalTickets = participants.reduce((total, participant) => total + Math.max(1, Math.floor(participant.tickets ?? 1)), 0);
  let cursor = randomInt(Math.max(1, totalTickets));

  for (const participant of participants) {
    cursor -= Math.max(1, Math.floor(participant.tickets ?? 1));

    if (cursor < 0) {
      return participant;
    }
  }

  const fallback = participants[participants.length - 1];

  if (!fallback) {
    throw createGiveawayError("Nao foi possivel selecionar um participante.", 500);
  }

  return fallback;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function buildRouletteUrl(token: string) {
  const origin = env.SITE_ORIGIN || env.FRONTEND_URL;

  if (!origin) {
    throw createGiveawayError("SITE_ORIGIN ou FRONTEND_URL precisa estar configurada para gerar o link publico da roleta.", 503);
  }

  return `${origin}/roulette/${encodeURIComponent(token)}`;
}

function scopeQuery(guildId: string, botId: string | null) {
  return {
    guildId,
    ...botScopeQuery(botId)
  };
}

function botScopeQuery(botId: string | null) {
  return botId
    ? {
        botId
      }
    : {
        $or: [
          {
            botId: null
          },
          {
            botId: {
              $exists: false
            }
          }
        ]
      };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

export function createGiveawayError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
