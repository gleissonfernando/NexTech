import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import { ensureGuild, getMongoCollections, type MongoSocialNotification } from "../database/mongo";
import { createLog } from "./logService";
import { isGuildTextChannel } from "./discordOptionsService";
import { getTwitchStream, getTwitchUser, normalizeTwitchChannel } from "./twitchService";
import type { LivePanelPreviewDto } from "./livePanelPreviewService";

export type SocialNotificationDto = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  createdBy: string;
  updatedBy: string | null;
  platform: "twitch";
  twitchChannelName: string;
  twitchChannelUrl: string;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTwitchNotificationInput = {
  twitchChannelInput: string;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  userId: string;
  botId?: string | null;
};

export type UpdateTwitchNotificationInput = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled?: boolean;
};

export type UpdateTwitchNotificationStateInput = {
  isLive?: boolean;
  lastLiveAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  twitchAvatar?: string | null;
};

export type ClaimTwitchLiveStartInput = {
  lastLiveAt: string;
  streamId: string;
};

type ServiceError = Error & {
  statusCode?: number;
};

export const TWITCH_NOTIFICATION_LIMIT = 10_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DEFAULT_EMBED_COLOR = "#9146FF";
const LIVE_PANEL_BRAND = "vortex lives";
const memoryNotifications = new Map<string, SocialNotificationDto>();
let legacyTwitchClaimWarningEmitted = false;

export async function previewTwitchChannel(input: string) {
  const twitchChannelName = normalizeAndValidateChannel(input);
  const twitchUser = await getTwitchUser(twitchChannelName).catch((error) => {
    throw createServiceError(error instanceof Error ? error.message : "Erro ao consultar Twitch API.", 503);
  });

  if (!twitchUser) {
    throw createServiceError("Canal da Twitch nao encontrado.", 404);
  }

  return {
    twitchId: twitchUser.id,
    twitchUsername: twitchUser.login,
    twitchDisplayName: twitchUser.displayName,
    twitchAvatar: twitchUser.profileImageUrl,
    twitchUrl: `https://www.twitch.tv/${twitchUser.login}`
  };
}

export async function listSocialNotifications(
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

  try {
    const { botGuildConfigs, devBots, socialNotifications } = await getMongoCollections();
    await claimLegacyTwitchNotifications(guildId, normalizedBotId);
    const scopeQuery = normalizedBotId
      ? notificationScopeQuery(guildId, normalizedBotId)
      : await notificationReadScopeQuery(guildId, devBots, botGuildConfigs);
    const query = {
      ...scopeQuery,
      platform: "twitch" as const,
      ...(search
        ? {
            twitchChannelName: {
              $regex: escapeRegex(search),
              $options: "i"
            }
          }
        : {})
    };
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
            ...scopeQuery,
            platform: "twitch"
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
        && notification.platform === "twitch"
      );
    const allNotifications = scopedNotifications
      .filter(
        (notification) => !search || notification.twitchChannelName.toLowerCase().includes(search.toLowerCase())
      )
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

export async function listActiveTwitchNotifications(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    await claimLegacyTwitchNotificationsForBot(normalizedBotId);
    const notifications = await socialNotifications
      .find({
        platform: "twitch",
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
        notification.platform === "twitch" &&
        notification.enabled &&
        normalizeBotId(notification.botId) === normalizedBotId
    );
  }
}

export async function createTwitchNotification(guildId: string, input: CreateTwitchNotificationInput) {
  const botId = normalizeBotId(input.botId);
  const twitchChannelName = normalizeAndValidateChannel(input.twitchChannelInput);
  await claimLegacyTwitchNotifications(guildId, botId);
  await assertGuildLimit(guildId, botId);

  const twitchUser = await getTwitchUser(twitchChannelName).catch((error) => {
    throw createServiceError(error instanceof Error ? error.message : "Erro ao consultar Twitch API.", 503);
  });

  if (!twitchUser) {
    throw createServiceError("Canal da Twitch nao encontrado.", 404);
  }

  const now = new Date();
  const doc: MongoSocialNotification = {
    _id: randomUUID(),
    botId,
    guildId,
    userId: input.userId,
    createdBy: input.userId,
    updatedBy: input.userId,
    platform: "twitch",
    twitchChannelName,
    twitchChannelUrl: `https://www.twitch.tv/${twitchChannelName}`,
    twitchUserId: twitchUser.id,
    twitchAvatar: twitchUser.profileImageUrl,
    discordChannelId: input.discordChannelId,
    mentionRoleId: input.mentionRoleId || null,
    customMessage: input.customMessage || null,
    embedColor: normalizeEmbedColor(input.embedColor),
    enabled: input.enabled,
    isLive: false,
    lastLiveAt: null,
    lastStreamId: null,
    lastMessageId: null,
    createdAt: now,
    updatedAt: now
  };

  try {
    await ensureGuild(guildId);

    const { socialNotifications } = await getMongoCollections();
    const existing = await socialNotifications.findOne({
      guildId,
      botId,
      platform: "twitch",
      twitchChannelName
    });

    if (existing) {
      throw createServiceError("Este canal da Twitch ja esta cadastrado neste servidor.", 409);
    }

    await socialNotifications.insertOne(doc);

    const dto = toDto(doc);
    await writeActionLog("social.twitch.created", "Cadastrou canal Twitch", dto, input.userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    if (isUniqueConstraint(error)) {
      throw createServiceError("Este canal da Twitch ja esta cadastrado neste servidor.", 409);
    }

    const dto = toDto(doc);
    memoryNotifications.set(dto.id, dto);
    await writeActionLog("social.twitch.created", "Cadastrou canal Twitch", dto, input.userId);
    return dto;
  }
}

export async function updateTwitchNotification(
  guildId: string,
  id: string,
  input: UpdateTwitchNotificationInput,
  userId: string,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const current = await socialNotifications.findOne({
      _id: id
    });

    if (
      !current
      || current.guildId !== guildId
      || normalizeBotId(current.botId) !== normalizedBotId
    ) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id,
        ...notificationScopeQuery(guildId, normalizedBotId)
      },
      {
        $set: buildNotificationPatch(input, userId)
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const dto = toDto(updated);
    await writeActionLog("social.twitch.updated", "Editou canal Twitch", dto, userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (
      !current
      || current.guildId !== guildId
      || normalizeBotId(current.botId) !== normalizedBotId
    ) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const updated: SocialNotificationDto = {
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
    await writeActionLog("social.twitch.updated", "Editou canal Twitch", updated, userId);
    return updated;
  }
}

export async function updateTwitchNotificationState(
  id: string,
  input: UpdateTwitchNotificationStateInput,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id,
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
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    return toDto(updated);
  } catch {
    const current = memoryNotifications.get(id);
    if (!current || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const updated: SocialNotificationDto = {
      ...current,
      ...input,
      lastLiveAt: input.lastLiveAt === undefined ? current.lastLiveAt : input.lastLiveAt,
      updatedAt: new Date().toISOString()
    };
    memoryNotifications.set(id, updated);
    return updated;
  }
}

export async function claimTwitchLiveStart(
  id: string,
  input: ClaimTwitchLiveStartInput,
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();

  try {
    const { socialNotifications } = await getMongoCollections();
    const scopeQuery = notificationBotScopeQuery(normalizedBotId);
    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id,
        platform: "twitch",
        $and: [
          scopeQuery,
          {
            $or: [
              { lastStreamId: { $ne: input.streamId } },
              { lastStreamId: null },
              { lastStreamId: { $exists: false } }
            ]
          }
        ]
      },
      {
        $set: {
          isLive: true,
          lastLiveAt: new Date(input.lastLiveAt),
          lastStreamId: input.streamId,
          updatedAt: now
        },
        $unset: {
          lastMessageId: ""
        }
      },
      {
        returnDocument: "after"
      }
    );

    return {
      claimed: Boolean(updated),
      notification: updated ? toDto(updated) : null
    };
  } catch {
    const current = memoryNotifications.get(id);
    if (!current || normalizeBotId(current.botId) !== normalizedBotId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    if (current.lastStreamId === input.streamId) {
      return {
        claimed: false,
        notification: current
      };
    }

    const updated: SocialNotificationDto = {
      ...current,
      isLive: true,
      lastLiveAt: input.lastLiveAt,
      lastMessageId: null,
      lastStreamId: input.streamId,
      updatedAt: now.toISOString()
    };
    memoryNotifications.set(id, updated);
    return {
      claimed: true,
      notification: updated
    };
  }
}

export async function sendTwitchNotificationTest(
  guildId: string,
  id: string,
  userId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const notification = await findTwitchNotification(guildId, id, botId);
  const stream = await getTwitchStream(notification.twitchChannelName).catch(() => null);
  const title = stream?.title ?? "Live de teste iniciada pelo painel";
  const gameName = stream?.gameName || "Grand Theft Auto V";
  const viewerCount = stream?.viewerCount ?? 0;
  const thumbnailUrl = buildLivePreviewImageUrl(
    stream?.thumbnailUrl,
    stream?.userLogin || notification.twitchChannelName
  );
  const channelUrl = stream?.userLogin
    ? `https://www.twitch.tv/${stream.userLogin}`
    : notification.twitchChannelUrl;

  if (!(await isGuildTextChannel(guildId, notification.discordChannelId, botToken))) {
    throw createServiceError("O canal configurado nao pertence a este servidor.", 400);
  }

  await sendDiscordLivePanel({
    botToken,
    notification,
    title,
    gameName,
    viewerCount,
    thumbnailUrl,
    channelUrl,
    streamerName: stream?.userName || notification.twitchChannelName
  });

  await writeActionLog("social.twitch.tested", "Testou painel Twitch", notification, userId);
}

export async function previewTwitchNotificationPanel(
  guildId: string,
  id: string,
  botId?: string | null
): Promise<LivePanelPreviewDto> {
  const notification = await findTwitchNotification(guildId, id, botId);
  const stream = await getTwitchStream(notification.twitchChannelName).catch(() => null);
  const channelName = stream?.userLogin || notification.twitchChannelName;
  const channelUrl = stream?.userLogin
    ? `https://www.twitch.tv/${stream.userLogin}`
    : notification.twitchChannelUrl;
  const streamerName = stream?.userName || notification.twitchChannelName;

  return {
    platform: "twitch",
    dataSource: stream ? "live" : "simulated",
    mention: formatMention(notification).content,
    color: normalizeEmbedColor(notification.embedColor),
    authorName: `${streamerName} is now live on Twitch!`,
    authorIconUrl: notification.twitchAvatar ?? null,
    title: formatLiveTitle(stream?.title ?? "Live de teste iniciada pelo painel"),
    url: channelUrl,
    description: renderLiveDescription(notification, channelUrl),
    fields: [
      {
        name: "Game",
        value: stream?.gameName || "Grand Theft Auto V",
        inline: true
      },
      {
        name: "Viewers",
        value: String(stream?.viewerCount ?? 0),
        inline: true
      }
    ],
    imageUrl: buildLivePreviewImageUrl(stream?.thumbnailUrl, channelName),
    footer: livePanelFooter(new Date()),
    buttonLabel: "Watch Stream"
  };
}

export async function deleteTwitchNotification(guildId: string, id: string, userId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const current = await socialNotifications.findOne({
      _id: id
    });

    if (
      !current
      || current.guildId !== guildId
      || normalizeBotId(current.botId) !== normalizedBotId
    ) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    await socialNotifications.deleteOne({
      _id: id,
      ...notificationScopeQuery(guildId, normalizedBotId)
    });

    const dto = toDto(current);
    await writeActionLog("social.twitch.deleted", "Removeu canal Twitch", dto, userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (
      !current
      || current.guildId !== guildId
      || normalizeBotId(current.botId) !== normalizedBotId
    ) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    memoryNotifications.delete(id);
    await writeActionLog("social.twitch.deleted", "Removeu canal Twitch", current, userId);
    return current;
  }
}

export function createServiceError(message: string, statusCode: number) {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

function normalizeAndValidateChannel(input: string) {
  const channel = normalizeTwitchChannel(input);

  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) {
    throw createServiceError("Informe uma URL valida da Twitch.", 400);
  }

  return channel;
}

async function assertGuildLimit(guildId: string, botId: string | null) {
  let count: number;

  try {
    const { socialNotifications } = await getMongoCollections();
    count = await socialNotifications.countDocuments({
      ...notificationScopeQuery(guildId, botId),
      platform: "twitch"
    });
  } catch {
    count = [...memoryNotifications.values()].filter(
      (notification) =>
        notification.guildId === guildId
        && normalizeBotId(notification.botId) === botId
        && notification.platform === "twitch"
    ).length;
  }

  if (count >= TWITCH_NOTIFICATION_LIMIT) {
    throw createServiceError(
      `Voce atingiu o limite de ${TWITCH_NOTIFICATION_LIMIT.toLocaleString("pt-BR")} canais Twitch neste servidor.`,
      400
    );
  }
}

async function writeActionLog(type: string, action: string, notification: SocialNotificationDto, userId: string) {
  if (!notification.botId) {
    return;
  }

  await createLog({
    botId: notification.botId,
    guildId: notification.guildId,
    userId,
    type,
    message: `${action}: ${notification.twitchChannelName}`,
    metadata: {
      usuario: userId,
      servidor: notification.guildId,
      botId: notification.botId,
      module: "lives",
      acao: action,
      canalTwitch: notification.twitchChannelName,
      canalDiscord: notification.discordChannelId,
      data: new Date().toISOString()
    }
  });
}

function buildNotificationPatch(input: UpdateTwitchNotificationInput, updatedBy: string): Partial<MongoSocialNotification> {
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

function buildNotificationStatePatch(input: UpdateTwitchNotificationStateInput): Partial<MongoSocialNotification> {
  const patch: Partial<MongoSocialNotification> = {
    updatedAt: new Date()
  };

  if (input.isLive !== undefined) {
    patch.isLive = input.isLive;
  }

  if (input.lastLiveAt !== undefined) {
    patch.lastLiveAt = input.lastLiveAt ? new Date(input.lastLiveAt) : null;
  }

  if (input.lastStreamId !== undefined) {
    patch.lastStreamId = input.lastStreamId;
  }

  if (input.lastMessageId !== undefined) {
    patch.lastMessageId = input.lastMessageId;
  }

  if (input.twitchAvatar !== undefined) {
    patch.twitchAvatar = input.twitchAvatar;
  }

  return patch;
}

function toDto(notification: MongoSocialNotification): SocialNotificationDto {
  const twitchChannelName = notification.twitchChannelName ?? "";

  return {
    id: notification._id,
    botId: normalizeBotId(notification.botId),
    guildId: notification.guildId,
    userId: notification.userId,
    createdBy: notification.createdBy ?? notification.userId,
    updatedBy: notification.updatedBy ?? null,
    platform: "twitch",
    twitchChannelName,
    twitchChannelUrl: notification.twitchChannelUrl ?? `https://www.twitch.tv/${twitchChannelName}`,
    twitchUserId: notification.twitchUserId,
    twitchAvatar: notification.twitchAvatar,
    discordChannelId: notification.discordChannelId,
    mentionRoleId: notification.mentionRoleId,
    customMessage: notification.customMessage,
    embedColor: notification.embedColor ?? DEFAULT_EMBED_COLOR,
    enabled: notification.enabled,
    isLive: notification.isLive,
    lastLiveAt: notification.lastLiveAt?.toISOString?.() ?? null,
    lastStreamId: notification.lastStreamId,
    lastMessageId: notification.lastMessageId,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString()
  };
}

function isUniqueConstraint(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

async function findTwitchNotification(guildId: string, id: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { socialNotifications } = await getMongoCollections();
    const notification = await socialNotifications.findOne({
      _id: id,
      ...notificationScopeQuery(guildId, normalizedBotId)
    });

    if (
      !notification
    ) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    return toDto(notification);
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const notification = memoryNotifications.get(id);

    if (
      !notification
      || notification.guildId !== guildId
      || normalizeBotId(notification.botId) !== normalizedBotId
    ) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    return notification;
  }
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

async function claimLegacyTwitchNotifications(guildId: string, botId: string | null) {
  if (!botId) {
    return;
  }

  try {
    const { botGuildConfigs, devBots, socialNotifications } = await getMongoCollections();
    const bot = await devBots.findOne(
      {
        _id: botId
      },
      {
        projection: {
          _id: 1,
          mainGuildId: 1
        }
      }
    );

    if (!bot) {
      return;
    }

    const botUsesGuild = bot.mainGuildId === guildId || Boolean(await botGuildConfigs.findOne(
      {
        botId,
        guildId
      },
      {
        projection: {
          _id: 1
        }
      }
    ));

    if (!botUsesGuild) {
      return;
    }

    const [mainGuildBots, configuredGuildBots] = await Promise.all([
      devBots.find(
        {
          mainGuildId: guildId
        },
        {
          projection: {
            _id: 1
          }
        }
      ).toArray(),
      botGuildConfigs.find(
        {
          guildId
        },
        {
          projection: {
            botId: 1
          }
        }
      ).toArray()
    ]);
    const botIdsForGuild = new Set<string>([
      ...mainGuildBots.map((item) => item._id),
      ...configuredGuildBots.map((item) => item.botId)
    ]);

    if (botIdsForGuild.size !== 1 || !botIdsForGuild.has(botId)) {
      return;
    }

    await socialNotifications.updateMany(
      {
        guildId,
        platform: "twitch",
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
      },
      {
        $set: {
          botId,
          updatedAt: new Date()
        }
      }
    );
  } catch (error) {
    warnLegacyTwitchClaimFailure(error);
  }
}

async function claimLegacyTwitchNotificationsForBot(botId: string | null) {
  if (!botId) {
    return;
  }

  try {
    const { botGuildConfigs, devBots } = await getMongoCollections();
    const bot = await devBots.findOne(
      {
        _id: botId
      },
      {
        projection: {
          mainGuildId: 1
        }
      }
    );

    if (!bot) {
      return;
    }

    const configs = await botGuildConfigs.find(
      {
        botId
      },
      {
        projection: {
          guildId: 1
        }
      }
    ).toArray();
    const guildIds = [...new Set([bot.mainGuildId, ...configs.map((config) => config.guildId)])];

    await Promise.all(guildIds.map((guildId) => claimLegacyTwitchNotifications(guildId, botId)));
  } catch (error) {
    console.warn("[social-notifications] nao foi possivel revisar lives antigas do bot:", error instanceof Error ? error.message : error);
  }
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

async function notificationReadScopeQuery(
  guildId: string,
  devBots: Awaited<ReturnType<typeof getMongoCollections>>["devBots"],
  botGuildConfigs: Awaited<ReturnType<typeof getMongoCollections>>["botGuildConfigs"]
) {
  const [mainGuildBots, configuredGuildBots] = await Promise.all([
    devBots.find({ mainGuildId: guildId }, { projection: { _id: 1 } }).toArray(),
    botGuildConfigs.find({ guildId }, { projection: { botId: 1 } }).toArray()
  ]);
  const botIds = [...new Set([
    ...mainGuildBots.map((bot) => bot._id),
    ...configuredGuildBots.map((config) => config.botId)
  ])];

  if (botIds.length !== 1) {
    return notificationScopeQuery(guildId, null);
  }

  return {
    guildId,
    $or: [
      { botId: null },
      { botId: { $exists: false } },
      { botId: botIds[0] }
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

async function sendDiscordLivePanel(input: {
  botToken?: string | null;
  notification: SocialNotificationDto;
  streamerName: string;
  title: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string;
  channelUrl: string;
}) {
  const token = input.botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw createServiceError("DISCORD_BOT_TOKEN nao configurado.", 503);
  }

  const mention = formatMention(input.notification);
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
            name: `${input.streamerName} is now live on Twitch!`,
            icon_url: input.notification.twitchAvatar ?? undefined,
            url: input.channelUrl
          },
          title: formatLiveTitle(input.title),
          url: input.channelUrl,
          description: renderLiveDescription(input.notification, input.channelUrl),
          fields: [
            {
              name: "Game",
              value: input.gameName || "Sem categoria",
              inline: true
            },
            {
              name: "Viewers",
              value: String(input.viewerCount || 0),
              inline: true
            }
          ],
          image: {
            url: input.thumbnailUrl
          },
          footer: {
            text: livePanelFooter(new Date())
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
              label: "Watch Stream",
              url: input.channelUrl
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw createServiceError(`Discord API respondeu ${response.status} ao testar o painel Twitch.`, 400);
  }
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

function renderLiveDescription(notification: SocialNotificationDto, channelUrl: string) {
  const channelLine = `[@${notification.twitchChannelName}](${channelUrl})`;
  const customMessage = notification.customMessage?.trim();

  if (!customMessage) {
    return `${channelLine} esta ao vivo!`;
  }

  return `${channelLine} ${customMessage}`;
}

function formatLiveTitle(title?: string | null) {
  const normalizedTitle = title?.trim();
  return normalizedTitle || "Live ao vivo";
}

function buildLivePreviewImageUrl(thumbnailUrl: string | null | undefined, channelName: string) {
  const normalizedChannelName = channelName.trim().toLowerCase();
  const sizedThumbnailUrl = thumbnailUrl?.trim()
    .replace("{width}", "1280")
    .replace("{height}", "720");
  const previewUrl = sizedThumbnailUrl || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${normalizedChannelName}-1280x720.jpg`;

  return appendCacheBuster(previewUrl);
}

function appendCacheBuster(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`;
}

function formatMention(notification: SocialNotificationDto) {
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

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
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

function livePanelFooter(value: Date) {
  return `${LIVE_PANEL_BRAND} - Hoje \u00e0s ${formatTime(value)} - ${formatDateTime(value)}`;
}

function warnLegacyTwitchClaimFailure(error: unknown) {
  const message = readErrorMessage(error);

  if (isMongoWriteBlockedMessage(message)) {
    if (!legacyTwitchClaimWarningEmitted) {
      legacyTwitchClaimWarningEmitted = true;
      console.warn("[social-notifications] MongoDB bloqueou escritas por quota; vinculo legado de lives sera retomado quando o Atlas liberar escrita.");
    }
    return;
  }

  console.warn("[social-notifications] nao foi possivel vincular lives antigas ao bot:", message);
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMongoWriteBlockedMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("over your space quota") || normalized.includes("writes are blocked");
}
