import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../database/prisma";
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
    const notifications = await prisma.socialNotification.findMany({
      where: {
        guildId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return notifications.map(toDto);
  } catch {
    return [...memoryNotifications.values()].filter((notification) => notification.guildId === guildId);
  }
}

export async function listActiveTwitchNotifications() {
  try {
    const notifications = await prisma.socialNotification.findMany({
      where: {
        platform: "twitch",
        enabled: true
      },
      orderBy: {
        updatedAt: "asc"
      }
    });

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
    throw createServiceError("Canal da Twitch não encontrado.", 404);
  }

  await ensureGuild(guildId);

  const payload = {
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
    enabled: input.enabled
  };

  try {
    const created = await prisma.socialNotification.create({
      data: payload
    });
    const dto = toDto(created);
    await writeActionLog("social.twitch.created", "Cadastrou canal Twitch", dto, input.userId);
    return dto;
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw createServiceError("Este canal da Twitch já está cadastrado neste servidor.", 409);
    }

    const now = new Date().toISOString();
    const dto: SocialNotificationDto = {
      id: randomUUID(),
      ...payload,
      platform: "twitch",
      isLive: false,
      lastStreamId: null,
      lastMessageId: null,
      createdAt: now,
      updatedAt: now
    };
    memoryNotifications.set(dto.id, dto);
    await writeActionLog("social.twitch.created", "Cadastrou canal Twitch", dto, input.userId);
    return dto;
  }
}

export async function updateTwitchNotification(guildId: string, id: string, input: UpdateTwitchNotificationInput) {
  try {
    const current = await prisma.socialNotification.findUnique({
      where: {
        id
      }
    });

    if (!current || current.guildId !== guildId) {
      throw createServiceError("Notificação não encontrada.", 404);
    }

    const updated = await prisma.socialNotification.update({
      where: {
        id
      },
      data: {
        discordChannelId: input.discordChannelId,
        mentionRoleId: input.mentionRoleId,
        customMessage: input.customMessage,
        enabled: input.enabled
      }
    });

    const dto = toDto(updated);
    await writeActionLog("social.twitch.updated", "Editou canal Twitch", dto, dto.userId);
    return dto;
  } catch (error) {
    if ((error as ServiceError).statusCode) {
      throw error;
    }

    const current = memoryNotifications.get(id);
    if (!current || current.guildId !== guildId) {
      throw createServiceError("Notificação não encontrada.", 404);
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
    const updated = await prisma.socialNotification.update({
      where: {
        id
      },
      data: input
    });

    return toDto(updated);
  } catch {
    const current = memoryNotifications.get(id);
    if (!current) {
      throw createServiceError("Notificação não encontrada.", 404);
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
    const current = await prisma.socialNotification.findUnique({
      where: {
        id
      }
    });

    if (!current || current.guildId !== guildId) {
      throw createServiceError("Notificação não encontrada.", 404);
    }

    await prisma.socialNotification.delete({
      where: {
        id
      }
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
      throw createServiceError("Notificação não encontrada.", 404);
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
    throw createServiceError("Você atingiu o limite de 5 canais Twitch neste servidor.", 400);
  }
}

async function ensureGuild(guildId: string) {
  await prisma.guild
    .upsert({
      where: {
        id: guildId
      },
      create: {
        id: guildId,
        name: `Guild ${guildId}`
      },
      update: {}
    })
    .catch(() => undefined);
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

function toDto(notification: {
  id: string;
  guildId: string;
  userId: string;
  platform: string;
  twitchChannelName: string;
  twitchChannelUrl: string;
  twitchUserId: string | null;
  twitchAvatar: string | null;
  discordChannelId: string;
  mentionRoleId: string | null;
  customMessage: string | null;
  enabled: boolean;
  isLive: boolean;
  lastStreamId: string | null;
  lastMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SocialNotificationDto {
  return {
    id: notification.id,
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
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
