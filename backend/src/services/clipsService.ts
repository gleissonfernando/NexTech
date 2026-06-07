import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { env } from "../config/env";
import { emitRealtime } from "../realtime/events";
import {
  ensureGuild,
  getMongoCollections,
  type MongoClipMentionType,
  type MongoClipsConfig,
  type MongoClipSent
} from "../database/mongo";
import { createLog } from "./logService";
import { areGuildRoles, isGuildTextChannel } from "./discordOptionsService";
import { getTwitchUser, normalizeTwitchChannel } from "./twitchService";

export type ClipMentionType = MongoClipMentionType;

export type ClipsConfigDto = {
  id: string;
  guildId: string;
  botId: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName: string | null;
  twitchAvatar: string | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  checkInterval: number;
  lastCheckAt: string | null;
  totalSent: number;
  createdAt: string;
  updatedAt: string;
};

export type ClipSentDto = {
  id: string;
  guildId: string;
  botId: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  createdAtTwitch: string;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: string;
};

export type SaveClipsConfigInput = {
  twitchChannelInput: string;
  discordChannelId: string | null;
  allowedRoleIds?: string[];
  mentionType?: ClipMentionType;
  mentionRoleId?: string | null;
  embedColor?: string | null;
  customMessage?: string | null;
  enabled?: boolean;
};

export type RecordClipSentInput = {
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail?: string | null;
  clipCreatorName?: string | null;
  createdAtTwitch: string;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
};

const DEFAULT_EMBED_COLOR = "#9146FF";
const CLIPS_CHECK_INTERVAL = 30_000;

export async function validateTwitchClipChannel(input: string) {
  const twitchChannelName = normalizeAndValidateChannel(input);
  const twitchUser = await getTwitchUser(twitchChannelName).catch((error) => {
    throw createClipsError(error instanceof Error ? error.message : "Erro ao consultar Twitch API.", 503);
  });

  if (!twitchUser) {
    throw createClipsError("Canal da Twitch nao encontrado.", 404);
  }

  return {
    twitchId: twitchUser.id,
    twitchUsername: twitchUser.login,
    twitchDisplayName: twitchUser.displayName,
    twitchAvatar: twitchUser.profileImageUrl,
    twitchUrl: `https://www.twitch.tv/${twitchUser.login}`
  };
}

export async function getClipsConfig(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { clipsConfig } = await getMongoCollections();
  const config = await clipsConfig.findOne(scopeQuery(guildId, normalizedBotId));

  return config ? toConfigDto(config, await countClipsSent(guildId, normalizedBotId)) : null;
}

export async function saveClipsConfig(
  guildId: string,
  input: SaveClipsConfigInput,
  userId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const twitchPreview = await validateTwitchClipChannel(input.twitchChannelInput);
  const discordChannelId = input.discordChannelId?.trim() || null;

  if (discordChannelId && !(await isGuildTextChannel(guildId, discordChannelId, botToken))) {
    throw createClipsError("O canal selecionado nao pertence a este servidor.", 400);
  }

  const allowedRoleIds = sanitizeRoleIds(input.allowedRoleIds);
  const mentionType = normalizeMentionType(input.mentionType);
  const mentionRoleId = mentionType === "role" ? input.mentionRoleId?.trim() || null : null;
  const roleIdsToValidate = [...allowedRoleIds, mentionRoleId].filter((roleId): roleId is string => Boolean(roleId));

  if (roleIdsToValidate.length && !(await areGuildRoles(guildId, [...new Set(roleIdsToValidate)], botToken))) {
    throw createClipsError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }

  if (mentionType === "role" && !mentionRoleId) {
    throw createClipsError("Selecione o cargo que sera mencionado.", 400);
  }

  const { clipsConfig } = await getMongoCollections();
  const now = new Date();
  const current = await clipsConfig.findOne(scopeQuery(guildId, normalizedBotId));
  const nextEnabled = input.enabled ?? current?.enabled ?? false;

  if (nextEnabled && !discordChannelId) {
    throw createClipsError("Selecione o canal do Discord antes de ativar os clips.", 400);
  }

  const shouldResetLastCheck = nextEnabled && !current?.enabled;
  const docPatch: Partial<MongoClipsConfig> = {
    guildId,
    botId: normalizedBotId,
    twitchChannelName: twitchPreview.twitchUsername,
    twitchBroadcasterId: twitchPreview.twitchId,
    twitchDisplayName: twitchPreview.twitchDisplayName,
    twitchAvatar: twitchPreview.twitchAvatar,
    discordChannelId,
    enabled: nextEnabled,
    allowedRoleIds,
    mentionType,
    mentionRoleId,
    embedColor: normalizeEmbedColor(input.embedColor),
    customMessage: normalizeMessage(input.customMessage),
    checkInterval: CLIPS_CHECK_INTERVAL,
    lastCheckAt: shouldResetLastCheck ? now : current?.lastCheckAt ?? null,
    updatedAt: now
  };

  await ensureGuild(guildId);

  const saved = await clipsConfig.findOneAndUpdate(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: docPatch,
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    {
      returnDocument: "after",
      upsert: true
    }
  );

  if (!saved) {
    throw createClipsError("Nao foi possivel salvar a configuracao de clips.", 500);
  }

  await writeConfigLogs(current, saved, userId);
  return toConfigDto(saved, await countClipsSent(guildId, normalizedBotId));
}

export async function enableClipsConfig(guildId: string, userId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { clipsConfig } = await getMongoCollections();
  const current = await clipsConfig.findOne(scopeQuery(guildId, normalizedBotId));

  if (!current?.twitchBroadcasterId) {
    throw createClipsError("Configure o canal da Twitch antes de ativar.", 400);
  }

  if (!current.discordChannelId) {
    throw createClipsError("Configure o canal do Discord antes de ativar.", 400);
  }

  const updated = await clipsConfig.findOneAndUpdate(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: {
        enabled: true,
        lastCheckAt: new Date(),
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createClipsError("Configuracao de clips nao encontrada.", 404);
  }

  await writeClipLog(updated, "clips.enabled", userId, "Sistema de clips ativado.");
  return toConfigDto(updated, await countClipsSent(guildId, normalizedBotId));
}

export async function disableClipsConfig(guildId: string, userId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { clipsConfig } = await getMongoCollections();
  const updated = await clipsConfig.findOneAndUpdate(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: {
        enabled: false,
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!updated) {
    throw createClipsError("Configuracao de clips nao encontrada.", 404);
  }

  await writeClipLog(updated, "clips.disabled", userId, "Sistema de clips desativado.");
  return toConfigDto(updated, await countClipsSent(guildId, normalizedBotId));
}

export async function listClipsHistory(guildId: string, botId?: string | null, limit = 20) {
  const normalizedBotId = normalizeBotId(botId);
  const { clipsSent } = await getMongoCollections();
  const sent = await clipsSent
    .find(scopeQuery(guildId, normalizedBotId))
    .sort({
      sentAt: -1
    })
    .limit(Math.max(1, Math.min(limit, 50)))
    .toArray();

  return sent.map(toSentDto);
}

export async function listActiveClipsConfigs(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { clipsConfig } = await getMongoCollections();
  const configs = await clipsConfig
    .find({
      enabled: true,
      ...botScopeQuery(normalizedBotId)
    })
    .sort({
      updatedAt: 1
    })
    .toArray();

  return Promise.all(configs.map(async (config) => toConfigDto(config, await countClipsSent(config.guildId, normalizeBotId(config.botId)))));
}

export async function updateClipsConfigLastCheck(configId: string, botId: string | null | undefined, checkedAt = new Date()) {
  const { clipsConfig } = await getMongoCollections();
  await clipsConfig.updateOne(
    {
      _id: configId,
      ...botScopeQuery(normalizeBotId(botId))
    },
    {
      $set: {
        lastCheckAt: checkedAt,
        updatedAt: new Date()
      }
    }
  );
}

export async function isClipSent(configId: string, clipId: string, botId?: string | null) {
  const config = await getClipConfigById(configId, botId);

  if (!config) {
    throw createClipsError("Configuracao de clips nao encontrada.", 404);
  }

  const { clipsSent } = await getMongoCollections();
  return Boolean(await clipsSent.findOne({
    guildId: config.guildId,
    clipId,
    ...botScopeQuery(normalizeBotId(config.botId))
  }, {
    projection: {
      _id: 1
    }
  }));
}

export async function recordClipSent(configId: string, input: RecordClipSentInput, botId?: string | null) {
  const config = await getClipConfigById(configId, botId);

  if (!config) {
    throw createClipsError("Configuracao de clips nao encontrada.", 404);
  }

  const now = new Date();
  const doc: MongoClipSent = {
    _id: randomUUID(),
    guildId: config.guildId,
    botId: normalizeBotId(config.botId),
    twitchChannelName: config.twitchChannelName,
    twitchBroadcasterId: config.twitchBroadcasterId,
    clipId: input.clipId,
    clipTitle: input.clipTitle,
    clipUrl: input.clipUrl,
    clipThumbnail: input.clipThumbnail ?? null,
    clipCreatorName: input.clipCreatorName ?? null,
    createdAtTwitch: new Date(input.createdAtTwitch),
    discordChannelId: input.discordChannelId ?? config.discordChannelId ?? null,
    discordMessageId: input.discordMessageId ?? null,
    sentAt: now
  };

  try {
    const { clipsSent } = await getMongoCollections();
    await clipsSent.insertOne(doc);
    const clip = toSentDto(doc);

    emitRealtime("clips:new", clip);
    await writeClipLog(
      config,
      doc.discordMessageId ? "clips.sent" : "clips.detected",
      null,
      doc.discordMessageId
        ? `Novo clip enviado: ${input.clipTitle || input.clipId}`
        : `Novo clip registrado na aba de clips: ${input.clipTitle || input.clipId}`
    );
    return clip;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      await writeClipLog(config, "clips.duplicate", null, `Clip ignorado por ja ter sido enviado: ${input.clipId}`);
      throw createClipsError("Clip ja enviado.", 409);
    }

    throw error;
  }
}

export async function sendClipsTest(guildId: string, userId: string, botId?: string | null, botToken?: string | null) {
  const config = await getClipsConfig(guildId, botId);

  if (!config?.discordChannelId) {
    throw createClipsError("Configure o canal de envio antes de testar.", 400);
  }

  if (!(await isGuildTextChannel(guildId, config.discordChannelId, botToken))) {
    throw createClipsError("O canal configurado nao pertence a este servidor.", 400);
  }

  const messageId = await sendDiscordClipMessage({
    botToken,
    config,
    guildName: `Servidor ${guildId}`,
    clip: {
      title: "Melhor momento da live",
      creatorName: "NomeDaPessoa",
      url: "https://clips.twitch.tv/example",
      thumbnailUrl: config.twitchAvatar || "https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg",
      createdAt: new Date().toISOString()
    }
  });

  await writeClipLog(fromDto(config), "clips.test", userId, "Enviou teste do sistema de clips.");
  return {
    messageId
  };
}

async function sendDiscordClipMessage(input: {
  botToken?: string | null;
  config: ClipsConfigDto;
  guildName: string;
  clip: {
    title: string;
    creatorName: string;
    url: string;
    thumbnailUrl: string | null;
    createdAt: string;
  };
}) {
  const token = input.botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw createClipsError("DISCORD_BOT_TOKEN nao configurado.", 503);
  }

  const mention = formatMention(input.config);
  const customMessage = renderClipMessage(input.config.customMessage, input.config.twitchDisplayName || input.config.twitchChannelName);
  const response = await fetch(`https://discord.com/api/v10/channels/${input.config.discordChannelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content: [mention.content, customMessage].filter(Boolean).join("\n") || undefined,
      allowed_mentions: mention.allowedMentions,
      embeds: [
        {
          title: "Novo clipe criado!",
          color: parseEmbedColor(input.config.embedColor),
          description: `Um novo corte foi criado na live de ${input.config.twitchDisplayName || input.config.twitchChannelName}.`,
          fields: [
            {
              name: "Titulo",
              value: input.clip.title || "Sem titulo"
            },
            {
              name: "Criado por",
              value: input.clip.creatorName || "Desconhecido",
              inline: true
            },
            {
              name: "Canal",
              value: input.config.twitchDisplayName || input.config.twitchChannelName,
              inline: true
            },
            {
              name: "Assistir",
              value: input.clip.url
            }
          ],
          image: input.clip.thumbnailUrl ? { url: input.clip.thumbnailUrl } : undefined,
          footer: {
            text: `Sistema de Clips - ${input.guildName}`
          },
          timestamp: input.clip.createdAt
        }
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Assistir Clipe",
              url: input.clip.url
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw createClipsError(`Discord API respondeu ${response.status} ao enviar clip.`, 400);
  }

  const data = await response.json().catch(() => null) as { id?: string } | null;
  return data?.id ?? null;
}

async function getClipConfigById(configId: string, botId?: string | null) {
  const { clipsConfig } = await getMongoCollections();
  return clipsConfig.findOne({
    _id: configId,
    ...botScopeQuery(normalizeBotId(botId))
  });
}

async function writeConfigLogs(current: MongoClipsConfig | null, saved: MongoClipsConfig, userId: string) {
  if (!current) {
    await writeClipLog(saved, "clips.config.created", userId, "Configuracao de clips criada.");
    return;
  }

  if (current.enabled !== saved.enabled) {
    await writeClipLog(saved, saved.enabled ? "clips.enabled" : "clips.disabled", userId, saved.enabled ? "Sistema de clips ativado." : "Sistema de clips desativado.");
  }

  if (current.twitchChannelName !== saved.twitchChannelName) {
    await writeClipLog(saved, "clips.twitch.updated", userId, "Canal da Twitch alterado.");
  }

  if (current.discordChannelId !== saved.discordChannelId) {
    await writeClipLog(saved, "clips.discord.updated", userId, "Canal do Discord alterado.");
  }

  if (current.embedColor !== saved.embedColor || current.customMessage !== saved.customMessage || current.mentionType !== saved.mentionType || current.mentionRoleId !== saved.mentionRoleId) {
    await writeClipLog(saved, "clips.embed.updated", userId, "Embed personalizado alterado.");
  }
}

export async function writeClipLog(config: MongoClipsConfig, action: string, userId: string | null, message: string) {
  const now = new Date();
  const { clipsLogs } = await getMongoCollections();
  await clipsLogs.insertOne({
    _id: randomUUID(),
    guildId: config.guildId,
    botId: normalizeBotId(config.botId),
    action,
    userId,
    message,
    createdAt: now
  });
  await createLog({
    botId: normalizeBotId(config.botId),
    guildId: config.guildId,
    userId,
    type: action,
    message,
    metadata: {
      module: "clips",
      twitchChannelName: config.twitchChannelName
    }
  });
}

async function countClipsSent(guildId: string, botId: string | null) {
  const { clipsSent } = await getMongoCollections();
  return clipsSent.countDocuments(scopeQuery(guildId, botId));
}

function toConfigDto(config: MongoClipsConfig, totalSent = 0): ClipsConfigDto {
  return {
    id: config._id,
    guildId: config.guildId,
    botId: normalizeBotId(config.botId),
    twitchChannelName: config.twitchChannelName,
    twitchBroadcasterId: config.twitchBroadcasterId,
    twitchDisplayName: config.twitchDisplayName ?? null,
    twitchAvatar: config.twitchAvatar ?? null,
    discordChannelId: config.discordChannelId ?? null,
    enabled: config.enabled,
    allowedRoleIds: config.allowedRoleIds ?? [],
    mentionType: normalizeMentionType(config.mentionType),
    mentionRoleId: config.mentionRoleId ?? null,
    embedColor: normalizeEmbedColor(config.embedColor),
    customMessage: config.customMessage ?? null,
    checkInterval: normalizeCheckInterval(),
    lastCheckAt: config.lastCheckAt?.toISOString?.() ?? null,
    totalSent,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function toSentDto(sent: MongoClipSent): ClipSentDto {
  return {
    id: sent._id,
    guildId: sent.guildId,
    botId: normalizeBotId(sent.botId),
    twitchChannelName: sent.twitchChannelName,
    twitchBroadcasterId: sent.twitchBroadcasterId,
    clipId: sent.clipId,
    clipTitle: sent.clipTitle,
    clipUrl: sent.clipUrl,
    clipThumbnail: sent.clipThumbnail ?? null,
    clipCreatorName: sent.clipCreatorName ?? null,
    createdAtTwitch: sent.createdAtTwitch.toISOString(),
    discordChannelId: sent.discordChannelId,
    discordMessageId: sent.discordMessageId ?? null,
    sentAt: sent.sentAt.toISOString()
  };
}

function fromDto(config: ClipsConfigDto): MongoClipsConfig {
  return {
    _id: config.id,
    guildId: config.guildId,
    botId: config.botId,
    twitchChannelName: config.twitchChannelName,
    twitchBroadcasterId: config.twitchBroadcasterId,
    twitchDisplayName: config.twitchDisplayName,
    twitchAvatar: config.twitchAvatar,
    discordChannelId: config.discordChannelId,
    enabled: config.enabled,
    allowedRoleIds: config.allowedRoleIds,
    mentionType: config.mentionType,
    mentionRoleId: config.mentionRoleId,
    embedColor: config.embedColor,
    customMessage: config.customMessage,
    checkInterval: config.checkInterval,
    lastCheckAt: config.lastCheckAt ? new Date(config.lastCheckAt) : null,
    createdAt: new Date(config.createdAt),
    updatedAt: new Date(config.updatedAt)
  };
}

function normalizeAndValidateChannel(input: string) {
  const channel = normalizeTwitchChannel(input);

  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) {
    throw createClipsError("Informe um canal ou link valido da Twitch.", 400);
  }

  return channel;
}

function sanitizeRoleIds(roleIds?: string[]) {
  return [...new Set((roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean))];
}

function normalizeMentionType(value?: string | null): ClipMentionType {
  return value === "everyone" || value === "role" ? value : "none";
}

function normalizeMessage(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

function normalizeCheckInterval() {
  return CLIPS_CHECK_INTERVAL;
}

function normalizeEmbedColor(value?: string | null) {
  const color = value?.trim();
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : DEFAULT_EMBED_COLOR;
}

function parseEmbedColor(value?: string | null) {
  return Number.parseInt(normalizeEmbedColor(value).replace("#", ""), 16);
}

function renderClipMessage(message: string | null, streamer: string) {
  return message?.replace(/\{streamer\}/gi, streamer) ?? null;
}

function formatMention(config: Pick<ClipsConfigDto, "guildId" | "mentionRoleId" | "mentionType">) {
  if (config.mentionType === "everyone") {
    return {
      content: "@everyone",
      allowedMentions: {
        parse: ["everyone"]
      }
    };
  }

  if (config.mentionType === "role" && config.mentionRoleId) {
    return {
      content: `<@&${config.mentionRoleId}>`,
      allowedMentions: {
        parse: [],
        roles: [config.mentionRoleId]
      }
    };
  }

  return {
    content: null,
    allowedMentions: {
      parse: []
    }
  };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
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

export function createClipsError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
