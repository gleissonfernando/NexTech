import { createCipheriv, createDecipheriv, createHash, createVerify, randomBytes, randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import { ensureGuild, getMongoCollections, type MongoKickApiConfig, type MongoSocialNotification } from "../database/mongo";
import { createLog } from "./logService";
import { isGuildTextChannel } from "./discordOptionsService";
import type { LivePanelPreviewDto } from "./livePanelPreviewService";
import {
  getKickChannel,
  getKickLivestreamByUserId,
  getKickLivestreamsByUserIds,
  kickApiConfigured,
  normalizeKickChannel,
  validateKickApiCredentials,
  type KickApiCredentials,
  type KickChannelDto,
  type KickStreamDto
} from "./kickService";

export type KickNotificationDto = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  createdBy: string;
  updatedBy: string | null;
  platform: "kick";
  kickChannelName: string;
  kickChannelUrl: string;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickBanner?: string | null;
  kickFollowers?: number | null;
  kickVerified?: boolean | null;
  kickCategory?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastEndedAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  peakViewers?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateKickNotificationInput = {
  kickChannelInput: string;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  userId: string;
  botId?: string | null;
};

export type UpdateKickNotificationInput = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled?: boolean;
};

export type UpdateKickNotificationStateInput = {
  isLive?: boolean;
  kickAvatar?: string | null;
  kickCategory?: string | null;
  lastEndedAt?: string | null;
  lastLiveAt?: string | null;
  lastMessageId?: string | null;
  lastStreamId?: string | null;
  peakViewers?: number | null;
};

export type KickStatusPayload = {
  apiConfigured: boolean;
  apiStatus: "not_configured" | "ok" | "error";
  apiMessage: string;
  apiConfig: KickApiConfigDto | null;
  connectedAccount: KickNotificationDto | null;
  totalChannels: number;
  activeChannels: number;
  totalLivesMonitored: number;
  lastLiveAt: string | null;
};

export type KickApiConfigDto = {
  id: string;
  botId: string | null;
  guildId: string;
  clientId: string;
  redirectUri: string | null;
  secretConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SaveKickApiConfigInput = {
  clientId: string;
  clientSecret?: string | null;
  redirectUri?: string | null;
};

type ServiceError = Error & {
  statusCode?: number;
};

type KickWebhookStatusPayload = {
  broadcaster?: {
    user_id?: number | string | null;
    username?: string | null;
    profile_picture?: string | null;
    channel_slug?: string | null;
    is_verified?: boolean | null;
  } | null;
  ended_at?: string | null;
  is_live?: boolean | null;
  started_at?: string | null;
  title?: string | null;
};

export const KICK_NOTIFICATION_LIMIT = 10_000;
export const KICK_MODULE_ID = "kick-integration";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DEFAULT_EMBED_COLOR = "#53FC18";
const KICK_WEBHOOK_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8",
  "6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2",
  "MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ",
  "L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY",
  "6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF",
  "BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e",
  "twIDAQAB",
  "-----END PUBLIC KEY-----"
].join("\n");
const memoryNotifications = new Map<string, KickNotificationDto>();

export async function getKickIntegrationStatus(guildId: string, botId?: string | null): Promise<KickStatusPayload> {
  const apiConfig = await getKickApiConfig(guildId, botId);
  const credentials = await resolveKickApiCredentials(guildId, botId);
  const list = await listKickNotifications(guildId, botId, {
    page: 1,
    pageSize: 1
  });
  const all = await listKickNotifications(guildId, botId, {
    page: 1,
    pageSize: KICK_NOTIFICATION_LIMIT
  });
  const connectedAccount = all.notifications[0] ?? null;
  const lastLiveAt = all.notifications
    .map((notification) => notification.lastLiveAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  let apiStatus: KickStatusPayload["apiStatus"] = credentials ? "ok" : "not_configured";
  let apiMessage = credentials ? "API Kick configurada." : "KICK_CLIENT_ID e KICK_CLIENT_SECRET nao configurados.";

  if (credentials) {
    try {
      await validateKickApiCredentials(credentials);
      apiMessage = "API conectada com sucesso.";
    } catch (error) {
      apiStatus = "error";
      apiMessage = error instanceof Error ? error.message : "Credenciais invalidas.";
    }
  }

  return {
    apiConfigured: Boolean(credentials),
    apiStatus,
    apiMessage,
    apiConfig,
    connectedAccount,
    totalChannels: list.total,
    activeChannels: all.notifications.filter((notification) => notification.enabled).length,
    totalLivesMonitored: all.notifications.filter((notification) => notification.lastLiveAt).length,
    lastLiveAt
  };
}

export async function saveKickApiConfig(
  guildId: string,
  input: SaveKickApiConfigInput,
  userId: string,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await findRawKickApiConfig(guildId, normalizedBotId);
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret?.trim() || (current ? decryptSecret(current.clientSecretEncrypted) : "");
  const redirectUri = input.redirectUri?.trim() || null;

  if (!clientId || !clientSecret) {
    throw createServiceError("Client ID e Client Secret da Kick sao obrigatorios.", 400);
  }

  await validateKickApiCredentials({
    clientId,
    clientSecret
  }).catch((error) => {
    throw createServiceError(error instanceof Error ? error.message : "Credenciais invalidas.", 400);
  });

  const now = new Date();
  const doc: MongoKickApiConfig = {
    _id: current?._id ?? randomUUID(),
    botId: normalizedBotId,
    guildId,
    clientId,
    clientSecretEncrypted: encryptSecret(clientSecret),
    redirectUri,
    createdBy: current?.createdBy ?? userId,
    updatedBy: userId,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };

  const { kickApiConfigs } = await getMongoCollections();
  await kickApiConfigs.updateOne(
    {
      botId: normalizedBotId,
      guildId
    },
    {
      $set: {
        clientId: doc.clientId,
        clientSecretEncrypted: doc.clientSecretEncrypted,
        redirectUri: doc.redirectUri,
        updatedBy: doc.updatedBy,
        updatedAt: doc.updatedAt
      },
      $setOnInsert: {
        _id: doc._id,
        botId: doc.botId,
        guildId: doc.guildId,
        createdBy: doc.createdBy,
        createdAt: doc.createdAt
      }
    },
    {
      upsert: true
    }
  );

  const saved = await getKickApiConfig(guildId, normalizedBotId);
  await createLog({
    botId: normalizedBotId,
    guildId,
    userId,
    type: "social.kick.api_saved",
    message: "Configuracao da API Kick salva.",
    metadata: {
      module: KICK_MODULE_ID,
      clientId
    }
  }).catch(() => undefined);

  return saved;
}

export async function getKickApiConfig(guildId: string, botId?: string | null) {
  const config = await findRawKickApiConfig(guildId, normalizeBotId(botId));
  return config ? toKickApiConfigDto(config) : null;
}

export async function previewKickChannel(input: string, guildId?: string, botId?: string | null) {
  const credentials = guildId ? await resolveKickApiCredentials(guildId, botId) : null;
  const kickChannelName = normalizeAndValidateKickChannel(input);
  const channel = await getKickChannel(kickChannelName, credentials).catch((error) => {
    throw createServiceError(error instanceof Error ? error.message : "Erro ao consultar Kick API.", 503);
  });

  if (!channel) {
    throw createServiceError("Canal da Kick nao encontrado.", 404);
  }

  return kickChannelPreview(channel);
}

export async function listKickNotifications(
  guildId: string,
  botId?: string | null,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}
) {
  const normalizedBotId = normalizeBotId(botId);
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE));
  const search = options.search?.trim() ?? "";
  const query = {
    ...notificationScopeQuery(guildId, normalizedBotId),
    platform: "kick" as const,
    ...(search
      ? {
          kickChannelName: {
            $regex: escapeRegex(search),
            $options: "i"
          }
        }
      : {})
  };

  try {
    const { socialNotifications } = await getMongoCollections();
    const filteredTotalPromise = socialNotifications.countDocuments(query);
    const [notifications, filteredTotal, total] = await Promise.all([
      socialNotifications
        .find(query)
        .sort({
          createdAt: -1
        })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      filteredTotalPromise,
      search
        ? socialNotifications.countDocuments({
            ...notificationScopeQuery(guildId, normalizedBotId),
            platform: "kick"
          })
        : filteredTotalPromise
    ]);

    return {
      notifications: notifications.map(toDto),
      page,
      pageSize,
      total,
      filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize))
    };
  } catch {
    const scopedNotifications = [...memoryNotifications.values()]
      .filter(
        (notification) =>
          notification.guildId === guildId
          && normalizeBotId(notification.botId) === normalizedBotId
          && notification.platform === "kick"
      );
    const allNotifications = scopedNotifications
      .filter((notification) => !search || notification.kickChannelName.toLowerCase().includes(search.toLowerCase()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const filteredTotal = allNotifications.length;

    return {
      notifications: allNotifications.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: scopedNotifications.length,
      filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize))
    };
  }
}

export async function listActiveKickNotifications(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const notifications = await socialNotifications
      .find({
        platform: "kick",
        enabled: true,
        ...(normalizedBotId
          ? { botId: normalizedBotId }
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
            })
      })
      .sort({
        updatedAt: 1
      })
      .toArray();

    return notifications.map(toDto);
  } catch {
    return [...memoryNotifications.values()].filter(
      (notification) =>
        notification.platform === "kick"
        && notification.enabled
        && normalizeBotId(notification.botId) === normalizedBotId
    );
  }
}

export async function createKickNotification(guildId: string, input: CreateKickNotificationInput) {
  const botId = normalizeBotId(input.botId);
  const credentials = await resolveKickApiCredentials(guildId, botId);
  const kickChannelName = normalizeAndValidateKickChannel(input.kickChannelInput);
  await assertGuildLimit(guildId, botId);

  const channel = await getKickChannel(kickChannelName, credentials).catch((error) => {
    throw createServiceError(error instanceof Error ? error.message : "Erro ao consultar Kick API.", 503);
  });

  if (!channel) {
    throw createServiceError("Canal da Kick nao encontrado.", 404);
  }

  const now = new Date();
  const doc: MongoSocialNotification = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: input.userId,
    createdBy: input.userId,
    updatedBy: input.userId,
    platform: "kick",
    kickChannelName: channel.slug,
    kickChannelUrl: `https://kick.com/${channel.slug}`,
    kickChannelId: channel.channelId,
    kickUserId: channel.broadcasterUserId,
    kickDisplayName: channel.displayName,
    kickAvatar: channel.avatar,
    kickBanner: channel.banner,
    kickFollowers: channel.followers,
    kickVerified: channel.verified,
    kickCategory: channel.categoryName,
    discordChannelId: input.discordChannelId,
    mentionRoleId: input.mentionRoleId || null,
    customMessage: input.customMessage || null,
    embedColor: normalizeEmbedColor(input.embedColor),
    enabled: input.enabled,
    isLive: false,
    lastLiveAt: null,
    lastEndedAt: null,
    lastStreamId: null,
    lastMessageId: null,
    peakViewers: null,
    createdAt: now,
    updatedAt: now
  };

  try {
    await ensureGuild(guildId);

    const { socialNotifications } = await getMongoCollections();
    const existing = await socialNotifications.findOne({
      guildId,
      botId,
      platform: "kick",
      kickChannelName: channel.slug
    });

    if (existing) {
      throw createServiceError("Este canal da Kick ja esta cadastrado neste servidor.", 409);
    }

    await socialNotifications.insertOne(doc);

    const dto = toDto(doc);
    await writeActionLog("social.kick.created", "Cadastrou canal Kick", dto, input.userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    if (isUniqueConstraint(error)) {
      throw createServiceError("Este canal da Kick ja esta cadastrado neste servidor.", 409);
    }

    const dto = toDto(doc);
    memoryNotifications.set(dto.id, dto);
    await writeActionLog("social.kick.created", "Cadastrou canal Kick", dto, input.userId);
    return dto;
  }
}

export async function updateKickNotification(
  guildId: string,
  id: string,
  input: UpdateKickNotificationInput,
  userId: string,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const current = await socialNotifications.findOne({
      _id: id
    });

    if (!current || current.guildId !== guildId || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id,
        ...notificationScopeQuery(guildId, normalizedBotId),
        platform: "kick"
      },
      {
        $set: buildNotificationPatch(input, userId)
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    const dto = toDto(updated);
    await writeActionLog("social.kick.updated", "Editou canal Kick", dto, userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (!current || current.guildId !== guildId || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    const updated: KickNotificationDto = {
      ...current,
      discordChannelId: input.discordChannelId ?? current.discordChannelId,
      mentionRoleId: input.mentionRoleId === undefined ? current.mentionRoleId : input.mentionRoleId,
      customMessage: input.customMessage === undefined ? current.customMessage : input.customMessage,
      embedColor: input.embedColor === undefined ? current.embedColor : normalizeEmbedColor(input.embedColor),
      enabled: input.enabled ?? current.enabled,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    };
    memoryNotifications.set(id, updated);
    await writeActionLog("social.kick.updated", "Editou canal Kick", updated, userId);
    return updated;
  }
}

export async function updateKickNotificationState(
  id: string,
  input: UpdateKickNotificationStateInput,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id,
        platform: "kick",
        ...notificationBotScopeQuery(normalizedBotId)
      },
      {
        $set: buildNotificationStatePatch(input)
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    return toDto(updated);
  } catch {
    const current = memoryNotifications.get(id);
    if (!current || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    const updated: KickNotificationDto = {
      ...current,
      ...input,
      lastEndedAt: input.lastEndedAt === undefined ? current.lastEndedAt : input.lastEndedAt,
      lastLiveAt: input.lastLiveAt === undefined ? current.lastLiveAt : input.lastLiveAt,
      peakViewers: input.peakViewers === undefined ? current.peakViewers : input.peakViewers,
      updatedAt: new Date().toISOString()
    };
    memoryNotifications.set(id, updated);
    return updated;
  }
}

export async function sendKickNotificationTest(
  guildId: string,
  id: string,
  userId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const notification = await findKickNotification(guildId, id, botId);
  const credentials = await resolveKickApiCredentials(guildId, botId);
  const stream = notification.kickUserId ? await getKickLivestreamByUserId(notification.kickUserId, credentials).catch(() => null) : null;
  const simulatedStream = stream ?? simulatedKickStream(notification);

  if (!(await isGuildTextChannel(guildId, notification.discordChannelId, botToken))) {
    throw createServiceError("O canal configurado nao pertence a este servidor.", 400);
  }

  await sendDiscordKickLiveStart({
    botToken,
    notification,
    stream: simulatedStream
  });

  await writeActionLog("social.kick.tested", "Testou painel Kick", notification, userId);
}

export async function previewKickNotificationPanel(
  guildId: string,
  id: string,
  botId?: string | null
): Promise<LivePanelPreviewDto> {
  const notification = await findKickNotification(guildId, id, botId);
  const credentials = await resolveKickApiCredentials(guildId, botId);
  const stream = notification.kickUserId
    ? await getKickLivestreamByUserId(notification.kickUserId, credentials).catch(() => null)
    : null;
  const resolvedStream = stream ?? simulatedKickStream(notification);
  const variables = kickVariables(notification, resolvedStream);

  return {
    platform: "kick",
    dataSource: stream ? "live" : "simulated",
    mention: formatMention(notification).content,
    color: normalizeEmbedColor(notification.embedColor),
    authorName: `${variables.streamer} iniciou uma transmissao na Kick`,
    authorIconUrl: resolvedStream.avatar ?? notification.kickAvatar ?? null,
    title: "AO VIVO AGORA",
    url: resolvedStream.url,
    description: renderKickDescription(notification, variables),
    fields: [
      {
        name: "Streamer",
        value: variables.streamer,
        inline: true
      },
      {
        name: "Categoria",
        value: variables.category,
        inline: true
      },
      {
        name: "Viewers",
        value: variables.viewers,
        inline: true
      },
      {
        name: "Titulo",
        value: variables.title,
        inline: false
      }
    ],
    imageUrl: resolvedStream.thumbnailUrl ? appendCacheBuster(resolvedStream.thumbnailUrl) : null,
    footer: "Sistema Kick Integration",
    buttonLabel: "Assistir Agora"
  };
}

export async function deleteKickNotification(guildId: string, id: string, userId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const current = await socialNotifications.findOne({
      _id: id
    });

    if (!current || current.guildId !== guildId || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    await socialNotifications.deleteOne({
      _id: id,
      ...notificationScopeQuery(guildId, normalizedBotId),
      platform: "kick"
    });

    const dto = toDto(current);
    await writeActionLog("social.kick.deleted", "Removeu canal Kick", dto, userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (!current || current.guildId !== guildId || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    memoryNotifications.delete(id);
    await writeActionLog("social.kick.deleted", "Removeu canal Kick", current, userId);
    return current;
  }
}

export async function processKickWebhookStatus(
  payload: KickWebhookStatusPayload,
  sendInputForNotification: (notification: KickNotificationDto, stream: KickStreamDto | null) => Promise<string | null>
) {
  const broadcaster = payload.broadcaster ?? null;
  const userId = broadcaster?.user_id === undefined || broadcaster.user_id === null ? null : String(broadcaster.user_id);
  const channelSlug = normalizeKickChannel(String(broadcaster?.channel_slug || broadcaster?.username || ""));

  if (!userId && !channelSlug) {
    throw createServiceError("Webhook Kick sem broadcaster valido.", 400);
  }

  const notifications = await findKickNotificationsByBroadcaster({
    channelSlug,
    userId
  });
  const isLive = Boolean(payload.is_live);
  const startedAt = payload.started_at || new Date().toISOString();
  const streamId = `${userId || channelSlug}:${startedAt}`;
  const results: Array<{ notificationId: string; state: "ignored" | "started" | "ended" }> = [];

  for (const notification of notifications) {
    if (isLive) {
      if (notification.lastStreamId === streamId && notification.isLive) {
        results.push({
          notificationId: notification.id,
          state: "ignored"
        });
        continue;
      }

      const credentials = await resolveKickApiCredentials(notification.guildId, notification.botId);
      const stream = await getKickLivestreamByUserId(notification.kickUserId ?? userId ?? "", credentials).catch(() => null);
      const fallbackStream = stream ?? simulatedKickStream(notification, {
        startedAt,
        title: payload.title ?? null,
        userId
      });
      const messageId = await sendInputForNotification(notification, fallbackStream);
      await updateKickNotificationState(notification.id, {
        isLive: true,
        kickAvatar: fallbackStream.avatar ?? notification.kickAvatar ?? null,
        kickCategory: fallbackStream.categoryName,
        lastLiveAt: fallbackStream.startedAt,
        lastMessageId: messageId,
        lastStreamId: fallbackStream.id,
        peakViewers: Math.max(notification.peakViewers ?? 0, fallbackStream.viewerCount)
      }, notification.botId);
      results.push({
        notificationId: notification.id,
        state: "started"
      });
    } else if (notification.isLive) {
      await sendInputForNotification(notification, null);
      await updateKickNotificationState(notification.id, {
        isLive: false,
        lastEndedAt: payload.ended_at || new Date().toISOString()
      }, notification.botId);
      results.push({
        notificationId: notification.id,
        state: "ended"
      });
    } else {
      results.push({
        notificationId: notification.id,
        state: "ignored"
      });
    }
  }

  return {
    matched: notifications.length,
    results
  };
}

export async function findKickNotification(guildId: string, id: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const notification = await socialNotifications.findOne({
      _id: id,
      platform: "kick",
      ...notificationScopeQuery(guildId, normalizedBotId)
    });

    if (!notification) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    return toDto(notification);
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const notification = memoryNotifications.get(id);

    if (!notification || notification.guildId !== guildId || normalizeBotId(notification.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao Kick nao encontrada.", 404);
    }

    return notification;
  }
}

export async function getKickStreamsForBot(botId?: string | null) {
  const notifications = await listActiveKickNotifications(botId);
  const streamsByUserId = new Map<string, KickStreamDto>();
  const notificationsByScope = new Map<string, KickNotificationDto[]>();

  for (const notification of notifications) {
    if (!notification.kickUserId) {
      continue;
    }

    const key = `${notification.botId ?? ""}:${notification.guildId}`;
    const scopedNotifications = notificationsByScope.get(key) ?? [];
    scopedNotifications.push(notification);
    notificationsByScope.set(key, scopedNotifications);
  }

  for (const scopedNotifications of notificationsByScope.values()) {
    const firstNotification = scopedNotifications[0];

    if (!firstNotification) {
      continue;
    }

    const credentials = await resolveKickApiCredentials(firstNotification.guildId, firstNotification.botId);
    const userIds = scopedNotifications
      .map((notification) => notification.kickUserId)
      .filter((userId): userId is string => Boolean(userId));

    if (!credentials || !userIds.length) {
      continue;
    }

    const streams = await getKickLivestreamsByUserIds(userIds, credentials).catch(() => new Map<string, KickStreamDto>());

    for (const [userId, stream] of streams) {
      streamsByUserId.set(userId, stream);
    }
  }

  return [...streamsByUserId.values()];
}

export function createServiceError(message: string, statusCode: number) {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

export async function resolveKickApiCredentials(guildId: string, botId?: string | null): Promise<KickApiCredentials | null> {
  const config = await findRawKickApiConfig(guildId, normalizeBotId(botId));

  if (config) {
    return {
      clientId: config.clientId,
      clientSecret: decryptSecret(config.clientSecretEncrypted)
    };
  }

  if (kickApiConfigured()) {
    return {
      clientId: env.KICK_CLIENT_ID,
      clientSecret: env.KICK_CLIENT_SECRET || env.KICK_API_KEY
    };
  }

  return null;
}

async function findRawKickApiConfig(guildId: string, botId: string | null) {
  try {
    const { kickApiConfigs } = await getMongoCollections();
    return kickApiConfigs.findOne(notificationScopeQuery(guildId, botId));
  } catch {
    return null;
  }
}

function toKickApiConfigDto(config: MongoKickApiConfig): KickApiConfigDto {
  return {
    id: config._id,
    botId: normalizeBotId(config.botId),
    guildId: config.guildId,
    clientId: config.clientId,
    redirectUri: config.redirectUri ?? null,
    secretConfigured: Boolean(config.clientSecretEncrypted),
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Segredo Kick protegido invalido.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  return createHash("sha256").update(env.JWT_SECRET || env.SESSION_SECRET).digest();
}

export function verifyKickWebhookSignature(input: {
  messageId?: string | null;
  rawBody: Buffer;
  signature?: string | null;
  timestamp?: string | null;
}) {
  if (!input.messageId || !input.signature || !input.timestamp) {
    return false;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${input.messageId}.${input.timestamp}.${input.rawBody.toString("utf8")}`);
  verifier.end();

  return verifier.verify(env.KICK_WEBHOOK_PUBLIC_KEY || KICK_WEBHOOK_PUBLIC_KEY, input.signature, "base64");
}

export async function sendDiscordKickLiveStart(input: {
  botToken?: string | null;
  notification: KickNotificationDto;
  stream: KickStreamDto;
}) {
  const token = input.botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw createServiceError("DISCORD_BOT_TOKEN nao configurado.", 503);
  }

  const mention = formatMention(input.notification);
  const variables = kickVariables(input.notification, input.stream);
  const content = mention.content ?? undefined;
  const response = await fetch(`https://discord.com/api/v10/channels/${input.notification.discordChannelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content,
      allowed_mentions: mention.allowedMentions,
      embeds: [
        {
          color: parseEmbedColor(input.notification.embedColor),
          author: {
            name: `${variables.streamer} iniciou uma transmissao na Kick`,
            icon_url: input.stream.avatar ?? input.notification.kickAvatar ?? undefined,
            url: input.stream.url
          },
          title: "AO VIVO AGORA",
          url: input.stream.url,
          description: renderKickDescription(input.notification, variables),
          fields: [
            {
              name: "Streamer",
              value: variables.streamer,
              inline: true
            },
            {
              name: "Categoria",
              value: variables.category,
              inline: true
            },
            {
              name: "Viewers",
              value: variables.viewers,
              inline: true
            },
            {
              name: "Titulo",
              value: variables.title,
              inline: false
            }
          ],
          image: input.stream.thumbnailUrl
            ? {
                url: appendCacheBuster(input.stream.thumbnailUrl)
              }
            : undefined,
          footer: {
            text: "Sistema Kick Integration"
          }
        }
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Assistir Agora",
              url: input.stream.url
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw createServiceError(`Discord API respondeu ${response.status} ao enviar painel Kick.`, 400);
  }

  const data = await response.json().catch(() => null) as { id?: string } | null;
  return data?.id ?? null;
}

export async function sendDiscordKickLiveEnd(input: {
  botToken?: string | null;
  notification: KickNotificationDto;
  endedAt?: string | null;
}) {
  const token = input.botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw createServiceError("DISCORD_BOT_TOKEN nao configurado.", 503);
  }

  const startedAt = input.notification.lastLiveAt ? new Date(input.notification.lastLiveAt) : null;
  const endedAt = input.endedAt ? new Date(input.endedAt) : new Date();
  const duration = startedAt ? formatDuration(Math.max(0, endedAt.getTime() - startedAt.getTime())) : "Nao registrado";
  const response = await fetch(`https://discord.com/api/v10/channels/${input.notification.discordChannelId}/messages`, {
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
          color: parseEmbedColor(input.notification.embedColor),
          title: "Live Encerrada",
          url: input.notification.kickChannelUrl,
          description: `${input.notification.kickDisplayName ?? input.notification.kickChannelName} encerrou a transmissao na Kick.`,
          fields: [
            {
              name: "Duracao",
              value: duration,
              inline: true
            },
            {
              name: "Pico de viewers",
              value: String(input.notification.peakViewers ?? 0),
              inline: true
            },
            {
              name: "Categoria",
              value: input.notification.kickCategory || "Sem categoria",
              inline: true
            }
          ],
          footer: {
            text: "Sistema Kick Integration"
          }
        }
      ]
    })
  });

  if (!response.ok) {
    throw createServiceError(`Discord API respondeu ${response.status} ao enviar encerramento Kick.`, 400);
  }
}

function normalizeAndValidateKickChannel(input: string) {
  const channel = normalizeKickChannel(input);

  if (!channel || !/^[a-z0-9_-]{3,25}$/i.test(channel)) {
    throw createServiceError("Informe uma URL valida da Kick.", 400);
  }

  return channel;
}

async function assertGuildLimit(guildId: string, botId: string | null) {
  let count: number;

  try {
    const { socialNotifications } = await getMongoCollections();
    count = await socialNotifications.countDocuments({
      ...notificationScopeQuery(guildId, botId),
      platform: "kick"
    });
  } catch {
    count = [...memoryNotifications.values()].filter(
      (notification) =>
        notification.guildId === guildId
        && normalizeBotId(notification.botId) === botId
        && notification.platform === "kick"
    ).length;
  }

  if (count >= KICK_NOTIFICATION_LIMIT) {
    throw createServiceError(
      `Voce atingiu o limite de ${KICK_NOTIFICATION_LIMIT.toLocaleString("pt-BR")} canais Kick neste servidor.`,
      400
    );
  }
}

async function writeActionLog(type: string, action: string, notification: KickNotificationDto, userId: string) {
  await createLog({
    botId: notification.botId,
    guildId: notification.guildId,
    userId,
    type,
    message: `${action}: ${notification.kickChannelName}`,
    metadata: {
      usuario: userId,
      servidor: notification.guildId,
      botId: notification.botId,
      module: KICK_MODULE_ID,
      acao: action,
      canalKick: notification.kickChannelName,
      canalDiscord: notification.discordChannelId,
      data: new Date().toISOString()
    }
  });
}

function buildNotificationPatch(input: UpdateKickNotificationInput, updatedBy: string): Partial<MongoSocialNotification> {
  const patch: Partial<MongoSocialNotification> = {
    updatedBy,
    updatedAt: new Date()
  };

  if (input.discordChannelId !== undefined) {
    patch.discordChannelId = input.discordChannelId;
  }

  if (input.mentionRoleId !== undefined) {
    patch.mentionRoleId = input.mentionRoleId;
  }

  if (input.customMessage !== undefined) {
    patch.customMessage = input.customMessage;
  }

  if (input.embedColor !== undefined) {
    patch.embedColor = normalizeEmbedColor(input.embedColor);
  }

  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;
  }

  return patch;
}

function buildNotificationStatePatch(input: UpdateKickNotificationStateInput): Partial<MongoSocialNotification> {
  const patch: Partial<MongoSocialNotification> = {
    updatedAt: new Date()
  };

  if (input.isLive !== undefined) {
    patch.isLive = input.isLive;
  }

  if (input.kickAvatar !== undefined) {
    patch.kickAvatar = input.kickAvatar;
  }

  if (input.kickCategory !== undefined) {
    patch.kickCategory = input.kickCategory;
  }

  if (input.lastEndedAt !== undefined) {
    patch.lastEndedAt = input.lastEndedAt ? new Date(input.lastEndedAt) : null;
  }

  if (input.lastLiveAt !== undefined) {
    patch.lastLiveAt = input.lastLiveAt ? new Date(input.lastLiveAt) : null;
  }

  if (input.lastMessageId !== undefined) {
    patch.lastMessageId = input.lastMessageId;
  }

  if (input.lastStreamId !== undefined) {
    patch.lastStreamId = input.lastStreamId;
  }

  if (input.peakViewers !== undefined) {
    patch.peakViewers = input.peakViewers;
  }

  return patch;
}

function toDto(notification: MongoSocialNotification): KickNotificationDto {
  const kickChannelName = notification.kickChannelName ?? "";

  return {
    id: notification._id,
    botId: normalizeBotId(notification.botId),
    guildId: notification.guildId,
    userId: notification.userId,
    createdBy: notification.createdBy ?? notification.userId,
    updatedBy: notification.updatedBy ?? null,
    platform: "kick",
    kickChannelName,
    kickChannelUrl: notification.kickChannelUrl ?? `https://kick.com/${kickChannelName}`,
    kickChannelId: notification.kickChannelId,
    kickUserId: notification.kickUserId,
    kickDisplayName: notification.kickDisplayName ?? kickChannelName,
    kickAvatar: notification.kickAvatar,
    kickBanner: notification.kickBanner,
    kickFollowers: notification.kickFollowers ?? 0,
    kickVerified: Boolean(notification.kickVerified),
    kickCategory: notification.kickCategory,
    discordChannelId: notification.discordChannelId,
    mentionRoleId: notification.mentionRoleId,
    customMessage: notification.customMessage,
    embedColor: notification.embedColor ?? DEFAULT_EMBED_COLOR,
    enabled: notification.enabled,
    isLive: notification.isLive,
    lastLiveAt: notification.lastLiveAt?.toISOString?.() ?? null,
    lastEndedAt: notification.lastEndedAt?.toISOString?.() ?? null,
    lastStreamId: notification.lastStreamId,
    lastMessageId: notification.lastMessageId,
    peakViewers: notification.peakViewers ?? 0,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString()
  };
}

async function findKickNotificationsByBroadcaster(input: {
  channelSlug: string;
  userId: string | null;
}) {
  try {
    const { socialNotifications } = await getMongoCollections();
    const notifications = await socialNotifications
      .find({
        platform: "kick",
        enabled: true,
        $or: [
          ...(input.userId ? [{ kickUserId: input.userId }] : []),
          ...(input.channelSlug ? [{ kickChannelName: input.channelSlug }] : [])
        ]
      })
      .toArray();

    return notifications.map(toDto);
  } catch {
    return [...memoryNotifications.values()].filter(
      (notification) =>
        notification.enabled
        && (
          (input.userId && notification.kickUserId === input.userId)
          || (input.channelSlug && notification.kickChannelName === input.channelSlug)
        )
    );
  }
}

function isUniqueConstraint(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notificationScopeQuery(guildId: string, botId: string | null) {
  if (botId) {
    return {
      guildId,
      botId
    };
  }

  return {
    guildId,
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

function notificationBotScopeQuery(botId: string | null) {
  if (botId) {
    return {
      botId
    };
  }

  return {
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

function normalizeEmbedColor(value?: string | null) {
  if (!value) {
    return DEFAULT_EMBED_COLOR;
  }

  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : DEFAULT_EMBED_COLOR;
}

function parseEmbedColor(value?: string | null) {
  return Number.parseInt(normalizeEmbedColor(value).replace("#", ""), 16);
}

function kickChannelPreview(channel: KickChannelDto) {
  return {
    kickChannelId: channel.channelId,
    kickUserId: channel.broadcasterUserId,
    kickUsername: channel.slug,
    kickDisplayName: channel.displayName,
    kickAvatar: channel.avatar,
    kickBanner: channel.banner,
    kickFollowers: channel.followers,
    kickVerified: channel.verified,
    kickUrl: `https://kick.com/${channel.slug}`
  };
}

function simulatedKickStream(
  notification: KickNotificationDto,
  overrides: {
    startedAt?: string | null;
    title?: string | null;
    userId?: string | null;
  } = {}
): KickStreamDto {
  const startedAt = overrides.startedAt || new Date().toISOString();
  const userId = overrides.userId || notification.kickUserId || notification.kickChannelName;

  return {
    id: `${userId}:${startedAt}`,
    broadcasterUserId: userId,
    channelId: notification.kickChannelId ?? null,
    slug: notification.kickChannelName,
    displayName: notification.kickDisplayName || notification.kickChannelName,
    categoryName: notification.kickCategory || "Grand Theft Auto V",
    title: overrides.title || "Live de teste iniciada pelo painel",
    viewerCount: 0,
    thumbnailUrl: notification.kickBanner ?? null,
    startedAt,
    avatar: notification.kickAvatar ?? null,
    url: notification.kickChannelUrl
  };
}

function kickVariables(notification: KickNotificationDto, stream: KickStreamDto) {
  return {
    streamer: stream.displayName || notification.kickDisplayName || notification.kickChannelName,
    title: stream.title || "Live ao vivo",
    category: stream.categoryName || notification.kickCategory || "Sem categoria",
    viewers: String(stream.viewerCount || 0),
    url: stream.url,
    followers: String(notification.kickFollowers ?? 0),
    live_started: formatDateTime(new Date(stream.startedAt))
  };
}

function renderKickDescription(notification: KickNotificationDto, variables: ReturnType<typeof kickVariables>) {
  const customMessage = notification.customMessage?.trim();

  if (customMessage) {
    return replaceVariables(customMessage, variables);
  }

  return `${variables.streamer} iniciou uma transmissao ao vivo.\nEntre agora para acompanhar.`;
}

function replaceVariables(template: string, variables: ReturnType<typeof kickVariables>) {
  return template.replace(/\{(streamer|title|category|viewers|url|followers|live_started)\}/g, (_, key: keyof typeof variables) => {
    return variables[key] ?? "";
  });
}

function formatMention(notification: KickNotificationDto) {
  if (!notification.mentionRoleId) {
    return {
      content: null,
      allowedMentions: {
        parse: []
      }
    };
  }

  if (notification.mentionRoleId === "everyone" || notification.mentionRoleId === notification.guildId) {
    return {
      content: "@everyone",
      allowedMentions: {
        parse: ["everyone"]
      }
    };
  }

  return {
    content: `<@&${notification.mentionRoleId}>`,
    allowedMentions: {
      parse: [],
      roles: [notification.mentionRoleId]
    }
  };
}

function appendCacheBuster(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(value);
}

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${minutes} min`;
  }

  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}
