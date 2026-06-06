import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import { ensureGuild, getMongoCollections, type MongoSocialNotification } from "../database/mongo";
import { createLog } from "./logService";
import { getTwitchStream, getTwitchUser, normalizeTwitchChannel } from "./twitchService";

export type SocialNotificationDto = {
  id: string;
  guildId: string;
  userId: string;
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

type ServiceError = Error & {
  statusCode?: number;
};

const TWITCH_LIMIT = 5;
const DEFAULT_EMBED_COLOR = "#9146FF";
const memoryNotifications = new Map<string, SocialNotificationDto>();

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

export async function listSocialNotifications(guildId: string) {
  try {
    const { socialNotifications } = await getMongoCollections();
    const notifications = await socialNotifications
      .find({
        guildId
      })
      .sort({
        createdAt: -1
      })
      .toArray();

    return notifications.map(toDto);
  } catch {
    return [...memoryNotifications.values()].filter((notification) => notification.guildId === guildId);
  }
}

export async function listActiveTwitchNotifications() {
  try {
    const { socialNotifications } = await getMongoCollections();
    const notifications = await socialNotifications
      .find({
        platform: "twitch",
        enabled: true
      })
      .sort({
        updatedAt: 1
      })
      .toArray();

    return notifications.map(toDto);
  } catch {
    return [...memoryNotifications.values()].filter((notification) => notification.platform === "twitch" && notification.enabled);
  }
}

export async function createTwitchNotification(guildId: string, input: CreateTwitchNotificationInput) {
  const twitchChannelName = normalizeAndValidateChannel(input.twitchChannelInput);
  await assertGuildLimit(guildId);

  const twitchUser = await getTwitchUser(twitchChannelName).catch((error) => {
    throw createServiceError(error instanceof Error ? error.message : "Erro ao consultar Twitch API.", 503);
  });

  if (!twitchUser) {
    throw createServiceError("Canal da Twitch nao encontrado.", 404);
  }

  const now = new Date();
  const doc: MongoSocialNotification = {
    _id: randomUUID(),
    guildId,
    userId: input.userId,
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

export async function updateTwitchNotification(guildId: string, id: string, input: UpdateTwitchNotificationInput) {
  try {
    const { socialNotifications } = await getMongoCollections();
    const current = await socialNotifications.findOne({
      _id: id
    });

    if (!current || current.guildId !== guildId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id
      },
      {
        $set: buildNotificationPatch(input)
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const dto = toDto(updated);
    await writeActionLog("social.twitch.updated", "Editou canal Twitch", dto, dto.userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (!current || current.guildId !== guildId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    const updated: SocialNotificationDto = {
      ...current,
      discordChannelId: input.discordChannelId ?? current.discordChannelId,
      mentionRoleId: input.mentionRoleId === undefined ? current.mentionRoleId : input.mentionRoleId,
      customMessage: input.customMessage === undefined ? current.customMessage : input.customMessage,
      embedColor: input.embedColor === undefined ? current.embedColor : normalizeEmbedColor(input.embedColor),
      enabled: input.enabled ?? current.enabled,
      updatedAt: new Date().toISOString()
    };
    memoryNotifications.set(id, updated);
    await writeActionLog("social.twitch.updated", "Editou canal Twitch", updated, updated.userId);
    return updated;
  }
}

export async function updateTwitchNotificationState(id: string, input: UpdateTwitchNotificationStateInput) {
  try {
    const { socialNotifications } = await getMongoCollections();
    const updated = await socialNotifications.findOneAndUpdate(
      {
        _id: id
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
    if (!current) {
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

export async function sendTwitchNotificationTest(guildId: string, id: string, userId: string) {
  const notification = await findTwitchNotification(guildId, id);
  const stream = await getTwitchStream(notification.twitchChannelName).catch(() => null);
  const title = stream?.title ?? "Live de teste iniciada pelo painel";
  const gameName = stream?.gameName || "Grand Theft Auto V";
  const viewerCount = stream?.viewerCount ?? 78;
  const thumbnailUrl =
    stream?.thumbnailUrl?.replace("{width}", "1280").replace("{height}", "720") ??
    "https://static-cdn.jtvnw.net/previews-ttv/live_user_twitch-1280x720.jpg";
  const channelUrl = stream?.userLogin
    ? `https://www.twitch.tv/${stream.userLogin}`
    : notification.twitchChannelUrl;

  await sendDiscordLivePanel({
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

export async function deleteTwitchNotification(guildId: string, id: string, userId: string) {
  try {
    const { socialNotifications } = await getMongoCollections();
    const current = await socialNotifications.findOne({
      _id: id
    });

    if (!current || current.guildId !== guildId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    await socialNotifications.deleteOne({
      _id: id
    });

    const dto = toDto(current);
    await writeActionLog("social.twitch.deleted", "Removeu canal Twitch", dto, userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (!current || current.guildId !== guildId) {
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

async function assertGuildLimit(guildId: string) {
  const notifications = await listSocialNotifications(guildId);
  const count = notifications.filter((notification) => notification.platform === "twitch").length;

  if (count >= TWITCH_LIMIT) {
    throw createServiceError("Voce atingiu o limite de 5 canais Twitch neste servidor.", 400);
  }
}

async function writeActionLog(type: string, action: string, notification: SocialNotificationDto, userId: string) {
  await createLog({
    guildId: notification.guildId,
    userId,
    type,
    message: `${action}: ${notification.twitchChannelName}`,
    metadata: {
      usuario: userId,
      servidor: notification.guildId,
      acao: action,
      canalTwitch: notification.twitchChannelName,
      canalDiscord: notification.discordChannelId,
      data: new Date().toISOString()
    }
  });
}

function buildNotificationPatch(input: UpdateTwitchNotificationInput): Partial<MongoSocialNotification> {
  const patch: Partial<MongoSocialNotification> = {
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
  return {
    id: notification._id,
    guildId: notification.guildId,
    userId: notification.userId,
    platform: "twitch",
    twitchChannelName: notification.twitchChannelName,
    twitchChannelUrl: notification.twitchChannelUrl,
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

async function findTwitchNotification(guildId: string, id: string) {
  try {
    const { socialNotifications } = await getMongoCollections();
    const notification = await socialNotifications.findOne({
      _id: id
    });

    if (!notification || notification.guildId !== guildId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    return toDto(notification);
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const notification = memoryNotifications.get(id);

    if (!notification || notification.guildId !== guildId) {
      throw createServiceError("Notificacao nao encontrada.", 404);
    }

    return notification;
  }
}

async function sendDiscordLivePanel(input: {
  notification: SocialNotificationDto;
  streamerName: string;
  title: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string;
  channelUrl: string;
}) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw createServiceError("DISCORD_BOT_TOKEN nao configurado.", 503);
  }

  const mention = formatMention(input.notification);
  const content = [mention.content, input.notification.customMessage].filter(Boolean).join("\n") || undefined;
  const response = await fetch(`https://discord.com/api/v10/channels/${input.notification.discordChannelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
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
          description: `[@${input.notification.twitchChannelName}](${input.channelUrl}) esta ao vivo!`,
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
            text: `Ricardinn98 lives • Hoje as ${formatTime(new Date())}`
          },
          timestamp: new Date().toISOString()
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
