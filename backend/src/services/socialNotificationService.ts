import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { ensureGuild, getMongoCollections, type MongoSocialNotification } from "../database/mongo";
import { createLog } from "./logService";
import { getTwitchUser, normalizeTwitchChannel } from "./twitchService";

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
  enabled: boolean;
  isLive: boolean;
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
  enabled: boolean;
  userId: string;
};

export type UpdateTwitchNotificationInput = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  enabled?: boolean;
};

export type UpdateTwitchNotificationStateInput = {
  isLive?: boolean;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  twitchAvatar?: string | null;
};

type ServiceError = Error & {
  statusCode?: number;
};

const TWITCH_LIMIT = 5;
const memoryNotifications = new Map<string, SocialNotificationDto>();

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
    enabled: input.enabled,
    isLive: false,
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
      updatedAt: new Date().toISOString()
    };
    memoryNotifications.set(id, updated);
    return updated;
  }
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

  if (!channel) {
    throw createServiceError("Informe o link ou nome do canal da Twitch.", 400);
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
    enabled: notification.enabled,
    isLive: notification.isLive,
    lastStreamId: notification.lastStreamId,
    lastMessageId: notification.lastMessageId,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString()
  };
}

function isUniqueConstraint(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}
