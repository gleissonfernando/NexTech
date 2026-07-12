import { randomUUID } from "node:crypto";
import { MongoServerError, type Filter } from "mongodb";
import { env } from "../config/env";
import { emitRealtime } from "../realtime/events";
import {
  ensureGuild,
  getMongoCollections,
  type MongoClipMentionType,
  type MongoClipPlatform,
  type MongoClipRewardRole,
  type MongoClipsConfig,
  type MongoClipSent
} from "../database/mongo";
import { createLog } from "./logService";
import { areGuildRoles, isGuildTextChannel } from "./discordOptionsService";
import { getKickChannel, normalizeKickChannel } from "./kickService";
import { resolveKickApiCredentials } from "./kickNotificationService";
import { getTwitchUser, normalizeTwitchChannel } from "./twitchService";
import { encryptSecret } from "./secretCryptoService";

export type ClipMentionType = MongoClipMentionType;
export type ClipPlatform = MongoClipPlatform;
export type ClipDateFilter = "today" | "yesterday" | "7d" | "30d" | "all";

export type ClipRewardRoleDto = {
  clipCount: number;
  label: string;
  roleId: string;
};

export type ClipRewardAssignmentDto = ClipRewardRoleDto & {
  userId: string;
};

export type ClipsConfigDto = {
  id: string;
  guildId: string;
  botId: string | null;
  platform: ClipPlatform;
  channelName: string;
  broadcasterId: string;
  displayName: string | null;
  avatar: string | null;
  channelUrl: string | null;
  followers: number | null;
  captureAvailable: boolean;
  providerStatus: string;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName: string | null;
  twitchAvatar: string | null;
  kickChannelName: string | null;
  kickChannelUrl: string | null;
  kickChannelId: string | null;
  kickUserId: string | null;
  kickDisplayName: string | null;
  kickAvatar: string | null;
  kickFollowers: number | null;
  kickApiTokenConfigured: boolean;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  clipRewards: ClipRewardRoleDto[];
  checkInterval: number;
  lastCheckAt: string | null;
  activeLiveSessionId: string | null;
  activeLiveStartedAt: string | null;
  activeLiveTitle: string | null;
  activeLiveThumbnail: string | null;
  totalSent: number;
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClipSentDto = {
  id: string;
  guildId: string;
  botId: string | null;
  configId: string | null;
  platform: ClipPlatform;
  channelName: string;
  broadcasterId: string;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  kickChannelName: string | null;
  kickUserId: string | null;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  clipDuration: number | null;
  createdAtTwitch: string;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: string;
};

export type ClipRankingDto = {
  username: string;
  count: number;
};

export type ClipStatsDto = {
  total: number;
  today: number;
  week: number;
  month: number;
  topCreator: ClipRankingDto | null;
  dailyAverage: number;
  clipsByDay: Array<{ label: string; value: number }>;
  clipsByWeek: Array<{ label: string; value: number }>;
  clipsByMonth: Array<{ label: string; value: number }>;
};

export type PublicKickClipsDto = {
  channel: ClipsConfigDto;
  clips: ClipSentDto[];
  ranking: ClipRankingDto[];
  stats: ClipStatsDto;
};

export type SaveClipsConfigInput = {
  configId?: string | null;
  platform?: ClipPlatform | string | null;
  twitchChannelInput?: string | null;
  kickChannelInput?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickApiToken?: string | null;
  discordChannelId: string | null;
  allowedRoleIds?: string[];
  mentionType?: ClipMentionType;
  mentionRoleId?: string | null;
  embedColor?: string | null;
  customMessage?: string | null;
  clipRewards?: ClipRewardRoleDto[];
  enabled?: boolean;
};

export type RecordClipSentInput = {
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail?: string | null;
  clipCreatorName?: string | null;
  clipDuration?: number | null;
  createdAtTwitch: string;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
};

export type UpdateClipLiveSessionInput = {
  isLive: boolean;
  streamId?: string | null;
  startedAt?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
};

const DEFAULT_EMBED_COLOR_BY_PLATFORM: Record<ClipPlatform, string> = {
  twitch: "#9146FF",
  kick: "#53FC18"
};
const CLIPS_CHECK_INTERVAL = 30_000;
const KICK_CLIP_PROVIDER_STATUS = "A API oficial da Kick ainda nao disponibiliza endpoint/evento de clipes. O provider ja monitora live e fica pronto para captura assim que o endpoint existir.";

export async function validateTwitchClipChannel(input: string) {
  const twitchChannelName = normalizeAndValidateTwitchChannel(input);
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

export async function validateKickClipChannel(input: string, guildId?: string | null, botId?: string | null) {
  const kickChannelName = normalizeAndValidateKickChannel(input);
  const credentials = guildId ? await resolveKickApiCredentials(guildId, botId) : null;
  const channel = await getKickChannel(kickChannelName, credentials).catch((error) => {
    throw createClipsError(error instanceof Error ? error.message : "Erro ao consultar Kick API.", 503);
  });

  if (!channel) {
    throw createClipsError("Canal da Kick nao encontrado.", 404);
  }

  return {
    kickChannelId: channel.channelId,
    kickUserId: channel.broadcasterUserId,
    kickUsername: channel.slug,
    kickDisplayName: channel.displayName,
    kickAvatar: channel.avatar,
    kickBanner: channel.banner,
    kickFollowers: channel.followers,
    kickVerified: channel.verified,
    kickUrl: `https://kick.com/${channel.slug}`,
    isLive: channel.isLive,
    streamTitle: channel.title,
    thumbnailUrl: channel.thumbnailUrl
  };
}

export async function getClipsConfig(guildId: string, botId?: string | null, platformInput?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(platformInput);
  const { clipsConfig } = await getMongoCollections();
  const config = await clipsConfig.findOne(scopeQuery(guildId, normalizedBotId, platform), {
    sort: {
      updatedAt: -1
    }
  });

  return config ? toConfigDto(config, await countClipsSentForConfig(config)) : null;
}

export async function listClipsConfigs(
  guildId: string,
  botId?: string | null,
  options: {
    limit?: number;
    page?: number;
    platform?: string | null;
    query?: string | null;
  } = {}
) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(options.platform);
  const pageSize = Math.max(1, Math.min(options.limit ?? 25, 100));
  const page = Math.max(1, options.page ?? 1);
  const search = options.query?.trim();
  const clauses: Array<Filter<MongoClipsConfig>> = [
    { guildId },
    botScopeClause(normalizedBotId) as Filter<MongoClipsConfig>,
    platformClause(platform) as Filter<MongoClipsConfig>,
    activeConfigClause() as Filter<MongoClipsConfig>
  ];

  if (search) {
    clauses.push({
      $or: [
        { twitchChannelName: { $regex: escapeRegExp(search), $options: "i" } },
        { twitchDisplayName: { $regex: escapeRegExp(search), $options: "i" } },
        { kickChannelName: { $regex: escapeRegExp(search), $options: "i" } },
        { kickDisplayName: { $regex: escapeRegExp(search), $options: "i" } }
      ]
    } as Filter<MongoClipsConfig>);
  }

  const { clipsConfig } = await getMongoCollections();
  const query = { $and: clauses };
  const [configs, total] = await Promise.all([
    clipsConfig
      .find(query)
      .sort({ enabled: -1, updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    clipsConfig.countDocuments(query)
  ]);
  const items = await Promise.all(configs.map(async (config) => toConfigDto(config, await countClipsSentForConfig(config))));

  return {
    configs: items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function saveClipsConfig(
  guildId: string,
  input: SaveClipsConfigInput,
  userId: string,
  botId?: string | null,
  botToken?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(input.platform);
  const channelPatch = platform === "kick"
    ? await resolveKickConfigPatch(guildId, input, normalizedBotId)
    : await resolveTwitchConfigPatch(input);
  const discordChannelId = input.discordChannelId?.trim() || null;

  if (discordChannelId && !(await isGuildTextChannel(guildId, discordChannelId, botToken))) {
    throw createClipsError("O canal selecionado nao pertence a este servidor.", 400);
  }

  const allowedRoleIds = sanitizeRoleIds(input.allowedRoleIds);
  const mentionType = normalizeMentionType(input.mentionType);
  const mentionRoleId = mentionType === "role" ? input.mentionRoleId?.trim() || null : null;
  const clipRewards = sanitizeRewardRoles(input.clipRewards);
  const roleIdsToValidate = [
    ...allowedRoleIds,
    mentionRoleId,
    ...clipRewards.map((reward) => reward.roleId)
  ].filter((roleId): roleId is string => Boolean(roleId));

  if (roleIdsToValidate.length && !(await areGuildRoles(guildId, [...new Set(roleIdsToValidate)], botToken))) {
    throw createClipsError("Um dos cargos selecionados nao pertence a este servidor.", 400);
  }

  if (mentionType === "role" && !mentionRoleId) {
    throw createClipsError("Selecione o cargo que sera mencionado.", 400);
  }

  const { clipsConfig } = await getMongoCollections();
  const now = new Date();
  const current = await findCurrentClipsConfig(guildId, normalizedBotId, platform, input.configId, channelPatch);
  const nextEnabled = input.enabled ?? current?.enabled ?? false;

  if (nextEnabled && !discordChannelId) {
    throw createClipsError("Selecione o canal de logs do Discord antes de ativar os clipes.", 400);
  }

  const kickApiToken = input.kickApiToken?.trim();
  const shouldResetLastCheck = nextEnabled && !current?.enabled;
  const docPatch: Partial<MongoClipsConfig> = {
    guildId,
    botId: normalizedBotId,
    platform,
    ...channelPatch,
    discordChannelId,
    enabled: nextEnabled,
    allowedRoleIds,
    mentionType,
    mentionRoleId,
    embedColor: normalizeEmbedColor(input.embedColor, platform),
    customMessage: normalizeMessage(input.customMessage),
    clipRewards,
    checkInterval: CLIPS_CHECK_INTERVAL,
    lastCheckAt: shouldResetLastCheck ? now : current?.lastCheckAt ?? null,
    deletedAt: null,
    updatedAt: now
  };

  if (platform === "kick") {
    docPatch.kickApiTokenEncrypted = kickApiToken ? encryptSecret(kickApiToken) : current?.kickApiTokenEncrypted ?? null;
  }

  await ensureGuild(guildId);

  const saved = await clipsConfig.findOneAndUpdate(
    current ? { _id: current._id, ...botScopeQuery(normalizedBotId) } : channelScopeQuery(guildId, normalizedBotId, platform, channelPatch),
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
    throw createClipsError("Nao foi possivel salvar a configuracao de clipes.", 500);
  }

  await writeConfigLogs(current, saved, userId);
  return toConfigDto(saved, await countClipsSentForConfig(saved));
}

export async function enableClipsConfig(guildId: string, userId: string, botId?: string | null, platformInput?: string | null, configId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(platformInput);
  const { clipsConfig } = await getMongoCollections();
  const current = await getClipConfigForGuildAction(guildId, normalizedBotId, platform, configId);

  if (platform === "kick" && !current?.kickUserId) {
    throw createClipsError("Configure o canal da Kick antes de ativar.", 400);
  }

  if (platform === "twitch" && !current?.twitchBroadcasterId) {
    throw createClipsError("Configure o canal da Twitch antes de ativar.", 400);
  }

  if (!current?.discordChannelId) {
    throw createClipsError("Configure o canal do Discord antes de ativar.", 400);
  }

  const updated = await clipsConfig.findOneAndUpdate(
    { _id: current._id, ...botScopeQuery(normalizedBotId) },
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
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  await writeClipLog(updated, "clips.enabled", userId, `Sistema de clipes ${platformLabel(platform)} ativado.`);
  return toConfigDto(updated, await countClipsSentForConfig(updated));
}

export async function disableClipsConfig(guildId: string, userId: string, botId?: string | null, platformInput?: string | null, configId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(platformInput);
  const { clipsConfig } = await getMongoCollections();
  const current = await getClipConfigForGuildAction(guildId, normalizedBotId, platform, configId);
  const updated = await clipsConfig.findOneAndUpdate(
    { _id: current._id, ...botScopeQuery(normalizedBotId) },
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
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  await writeClipLog(updated, "clips.disabled", userId, `Sistema de clipes ${platformLabel(platform)} desativado.`);
  return toConfigDto(updated, await countClipsSentForConfig(updated));
}

export async function deleteClipsConfig(guildId: string, userId: string, botId?: string | null, platformInput?: string | null, configId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(platformInput);
  const current = await getClipConfigForGuildAction(guildId, normalizedBotId, platform, configId);
  const { clipsConfig } = await getMongoCollections();
  const now = new Date();
  const updated = await clipsConfig.findOneAndUpdate(
    { _id: current._id, ...botScopeQuery(normalizedBotId) },
    {
      $set: {
        deletedAt: now,
        enabled: false,
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  await writeClipLog(updated, "clips.config.deleted", userId, `Canal de clipes ${platformLabel(platform)} removido: ${displayNameForConfig(updated)}.`);
  return toConfigDto(updated, await countClipsSentForConfig(updated));
}

export async function listClipsHistory(
  guildId: string,
  botId?: string | null,
  options: {
    filter?: ClipDateFilter;
    limit?: number;
    platform?: string | null;
  } = {}
) {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(options.platform);
  const { clipsSent } = await getMongoCollections();
  const query = sentQuery(guildId, normalizedBotId, platform, dateFilter(options.filter));
  const sent = await clipsSent
    .find(query)
    .sort({
      sentAt: -1
    })
    .limit(Math.max(1, Math.min(options.limit ?? 50, 100)))
    .toArray();

  return sent.map(toSentDto);
}

export async function listClipsRanking(
  guildId: string,
  botId?: string | null,
  options: {
    filter?: ClipDateFilter;
    limit?: number;
    platform?: string | null;
  } = {}
): Promise<ClipRankingDto[]> {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(options.platform);
  const { clipsSent } = await getMongoCollections();
  const ranking = await clipsSent.aggregate<ClipRankingDto>([
    {
      $match: sentQuery(guildId, normalizedBotId, platform, dateFilter(options.filter))
    },
    {
      $group: {
        _id: {
          $ifNull: ["$clipCreatorName", "Desconhecido"]
        },
        count: {
          $sum: 1
        }
      }
    },
    {
      $sort: {
        count: -1,
        _id: 1
      }
    },
    {
      $limit: Math.max(1, Math.min(options.limit ?? 20, 100))
    },
    {
      $project: {
        _id: 0,
        username: "$_id",
        count: 1
      }
    }
  ]).toArray();

  return ranking;
}

export async function getClipsStats(guildId: string, botId?: string | null, platformInput?: string | null): Promise<ClipStatsDto> {
  const normalizedBotId = normalizeBotId(botId);
  const platform = normalizePlatform(platformInput);
  const { clipsSent } = await getMongoCollections();
  const now = new Date();
  const todayRange = rangeForFilter("today", now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const totalQuery = sentQuery(guildId, normalizedBotId, platform);
  const [total, today, week, month, topCreator, recentClips] = await Promise.all([
    clipsSent.countDocuments(totalQuery),
    clipsSent.countDocuments(sentQuery(guildId, normalizedBotId, platform, todayRange)),
    clipsSent.countDocuments(sentQuery(guildId, normalizedBotId, platform, { start: weekStart })),
    clipsSent.countDocuments(sentQuery(guildId, normalizedBotId, platform, { start: monthStart })),
    listClipsRanking(guildId, botId, { platform, limit: 1 }),
    clipsSent
      .find(sentQuery(guildId, normalizedBotId, platform, { start: monthStart }))
      .project<{ sentAt: Date }>({ sentAt: 1 })
      .sort({ sentAt: 1 })
      .toArray()
  ]);

  return {
    total,
    today,
    week,
    month,
    topCreator: topCreator[0] ?? null,
    dailyAverage: Number((month / Math.max(1, now.getDate())).toFixed(2)),
    clipsByDay: buildSeries(recentClips.map((clip) => clip.sentAt), "day"),
    clipsByWeek: buildSeries(recentClips.map((clip) => clip.sentAt), "week"),
    clipsByMonth: buildSeries(recentClips.map((clip) => clip.sentAt), "month")
  };
}

export async function getPublicKickClips(channelInput: string): Promise<PublicKickClipsDto> {
  const channel = normalizeAndValidateKickChannel(channelInput);
  const { clipsConfig } = await getMongoCollections();
  const config = await clipsConfig.findOne(
    {
      platform: "kick",
      kickChannelName: channel
    },
    {
      sort: {
        updatedAt: -1
      }
    }
  );

  if (!config) {
    throw createClipsError("Painel publico de clipes Kick nao encontrado.", 404);
  }

  const botId = normalizeBotId(config.botId);
  const [clips, ranking, stats, configDto] = await Promise.all([
    listClipsHistory(config.guildId, botId, { platform: "kick", limit: 30 }),
    listClipsRanking(config.guildId, botId, { platform: "kick", limit: 10 }),
    getClipsStats(config.guildId, botId, "kick"),
    toConfigDto(config, await countClipsSentForConfig(config))
  ]);

  return {
    channel: configDto,
    clips,
    ranking,
    stats
  };
}

export async function listActiveClipsConfigs(botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { clipsConfig } = await getMongoCollections();
  const configs = await clipsConfig
    .find({
      enabled: true,
      ...activeConfigClause(),
      ...botScopeQuery(normalizedBotId)
    })
    .sort({
      updatedAt: 1
    })
    .toArray();

  return Promise.all(configs.map(async (config) => {
    const platform = normalizePlatform(config.platform);
    return toConfigDto(config, await countClipsSentForConfig(config));
  }));
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

export async function updateClipLiveSession(configId: string, input: UpdateClipLiveSessionInput, botId?: string | null) {
  const config = await getClipConfigById(configId, botId);

  if (!config) {
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  const normalizedBotId = normalizeBotId(config.botId);
  const platform = normalizePlatform(config.platform);
  const { clipLiveSessions, clipsConfig } = await getMongoCollections();

  if (!input.isLive) {
    if (!config.activeLiveSessionId) {
      return;
    }

    const endedAt = new Date();
    await clipLiveSessions.updateOne(
      {
        _id: config.activeLiveSessionId,
        ...botScopeQuery(normalizedBotId)
      },
      {
        $set: {
          endedAt,
          status: "ended",
          updatedAt: endedAt
        }
      }
    );
    await clipsConfig.updateOne(
      {
        _id: config._id,
        ...botScopeQuery(normalizedBotId)
      },
      {
        $set: {
          activeLiveSessionId: null,
          activeLiveStartedAt: null,
          activeLiveTitle: null,
          activeLiveThumbnail: null,
          updatedAt: endedAt
        }
      }
    );
    await writeClipLog(config, "clips.live.ended", null, `Live de ${displayNameForConfig(config)} encerrada.`);
    return;
  }

  const streamId = input.streamId?.trim();

  if (!streamId) {
    return;
  }

  const now = new Date();
  const startedAt = input.startedAt ? new Date(input.startedAt) : now;
  const channelName = channelNameForConfig(config);
  const existing = await clipLiveSessions.findOne({
    configId: config._id,
    streamId,
    ...botScopeQuery(normalizedBotId)
  });
  const sessionId = existing?._id ?? randomUUID();

  if (config.activeLiveSessionId && config.activeLiveSessionId !== sessionId) {
    await clipLiveSessions.updateOne(
      {
        _id: config.activeLiveSessionId,
        ...botScopeQuery(normalizedBotId)
      },
      {
        $set: {
          endedAt: now,
          status: "ended",
          updatedAt: now
        }
      }
    );
  }

  await clipLiveSessions.updateOne(
    {
      _id: sessionId
    },
    {
      $set: {
        guildId: config.guildId,
        botId: normalizedBotId,
        configId: config._id,
        platform,
        streamId,
        channelName,
        title: input.title?.trim() || null,
        thumbnailUrl: input.thumbnailUrl?.trim() || null,
        startedAt,
        endedAt: null,
        status: "active",
        updatedAt: now
      },
      $setOnInsert: {
        _id: sessionId,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );
  await clipsConfig.updateOne(
    {
      _id: config._id,
      ...botScopeQuery(normalizedBotId)
    },
    {
      $set: {
        activeLiveSessionId: sessionId,
        activeLiveStartedAt: startedAt,
        activeLiveTitle: input.title?.trim() || null,
        activeLiveThumbnail: input.thumbnailUrl?.trim() || null,
        updatedAt: now
      }
    }
  );

  if (config.activeLiveSessionId !== sessionId) {
    await writeClipLog(config, "clips.live.started", null, `Live de ${displayNameForConfig(config)} iniciada.`);
  }
}

export async function isClipSent(configId: string, clipId: string, botId?: string | null) {
  const config = await getClipConfigById(configId, botId);

  if (!config) {
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  const platform = normalizePlatform(config.platform);
  const { clipsSent } = await getMongoCollections();
  return Boolean(await clipsSent.findOne({
    configId: config._id,
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
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  const platform = normalizePlatform(config.platform);
  const now = new Date();
  const doc: MongoClipSent = {
    _id: randomUUID(),
    guildId: config.guildId,
    botId: normalizeBotId(config.botId),
    configId: config._id,
    platform,
    twitchChannelName: config.twitchChannelName ?? null,
    twitchBroadcasterId: config.twitchBroadcasterId ?? null,
    kickChannelName: config.kickChannelName ?? null,
    kickUserId: config.kickUserId ?? null,
    clipId: input.clipId,
    clipTitle: input.clipTitle,
    clipUrl: input.clipUrl,
    clipThumbnail: input.clipThumbnail ?? null,
    clipCreatorName: input.clipCreatorName ?? null,
    clipDuration: normalizeDuration(input.clipDuration),
    createdAtTwitch: new Date(input.createdAtTwitch),
    discordChannelId: input.discordChannelId ?? config.discordChannelId ?? null,
    discordMessageId: input.discordMessageId ?? null,
    sentAt: now
  };

  try {
    const { clipsSent } = await getMongoCollections();
    await clipsSent.insertOne(doc);
    const clip = toSentDto(doc);
    const rewards = await resolveClipRewards(config, input.clipCreatorName ?? null);

    emitRealtime("clips:new", clip);
    await writeClipLog(
      config,
      doc.discordMessageId ? "clips.sent" : "clips.detected",
      null,
      doc.discordMessageId
        ? `Novo clipe ${platformLabel(platform)} enviado: ${input.clipTitle || input.clipId}`
        : `Novo clipe ${platformLabel(platform)} registrado: ${input.clipTitle || input.clipId}`
    );
    return {
      clip,
      rewards
    };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      await writeClipLog(config, "clips.duplicate", null, `Clipe ignorado por ja ter sido registrado: ${input.clipId}`);
      throw createClipsError("Clipe ja registrado.", 409);
    }

    throw error;
  }
}

export async function sendClipsTest(guildId: string, userId: string, botId?: string | null, botToken?: string | null, platformInput?: string | null) {
  const platform = normalizePlatform(platformInput);
  const config = await getClipsConfig(guildId, botId, platform);

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
      url: platform === "kick" ? `https://kick.com/${config.kickChannelName ?? "canal"}?clip=example` : "https://clips.twitch.tv/example",
      thumbnailUrl: config.avatar || "https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg",
      createdAt: new Date().toISOString()
    }
  });

  await writeClipLog(fromDto(config), "clips.test", userId, `Enviou teste do sistema de clipes ${platformLabel(platform)}.`);
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
  const streamerName = input.config.displayName || input.config.channelName;
  const customMessage = renderClipMessage(input.config.customMessage, streamerName);
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
          title: "Novo Clipe Detectado",
          color: parseEmbedColor(input.config.embedColor, input.config.platform),
          description: `Um novo corte foi criado na live de ${streamerName}.`,
          fields: [
            {
              name: "Canal",
              value: streamerName,
              inline: true
            },
            {
              name: "Nome do Clipe",
              value: input.clip.title || "Sem titulo"
            },
            {
              name: "Criador",
              value: input.clip.creatorName || "Desconhecido",
              inline: true
            },
            {
              name: "Data",
              value: new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short"
              }).format(new Date(input.clip.createdAt)),
              inline: true
            },
            {
              name: "Link",
              value: input.clip.url
            }
          ],
          image: input.clip.thumbnailUrl ? { url: input.clip.thumbnailUrl } : undefined,
          footer: {
            text: `Sistema de Clips ${platformLabel(input.config.platform)} - ${input.guildName}`
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
    throw createClipsError(`Discord API respondeu ${response.status} ao enviar clipe.`, 400);
  }

  const data = await response.json().catch(() => null) as { id?: string } | null;
  return data?.id ?? null;
}

async function resolveTwitchConfigPatch(input: SaveClipsConfigInput): Promise<Partial<MongoClipsConfig>> {
  const twitchPreview = await validateTwitchClipChannel(input.twitchChannelInput ?? "");

  return {
    twitchChannelName: twitchPreview.twitchUsername,
    twitchBroadcasterId: twitchPreview.twitchId,
    twitchDisplayName: twitchPreview.twitchDisplayName,
    twitchAvatar: twitchPreview.twitchAvatar,
    kickChannelName: null,
    kickChannelUrl: null,
    kickChannelId: null,
    kickUserId: null,
    kickDisplayName: null,
    kickAvatar: null,
    kickFollowers: null,
    kickApiTokenEncrypted: null
  };
}

async function resolveKickConfigPatch(guildId: string, input: SaveClipsConfigInput, botId: string | null): Promise<Partial<MongoClipsConfig>> {
  const kickInput = input.kickChannelInput || input.kickChannelUrl || "";
  const kickPreview = await validateKickClipChannel(kickInput, guildId, botId);

  return {
    twitchChannelName: null,
    twitchBroadcasterId: null,
    twitchDisplayName: null,
    twitchAvatar: null,
    kickChannelName: kickPreview.kickUsername,
    kickChannelUrl: kickPreview.kickUrl,
    kickChannelId: input.kickChannelId?.trim() || kickPreview.kickChannelId,
    kickUserId: kickPreview.kickUserId,
    kickDisplayName: kickPreview.kickDisplayName,
    kickAvatar: kickPreview.kickAvatar,
    kickFollowers: kickPreview.kickFollowers
  };
}

async function getClipConfigById(configId: string, botId?: string | null) {
  const { clipsConfig } = await getMongoCollections();
  return clipsConfig.findOne({
    _id: configId,
    ...activeConfigClause(),
    ...botScopeQuery(normalizeBotId(botId))
  });
}

async function writeConfigLogs(current: MongoClipsConfig | null, saved: MongoClipsConfig, userId: string) {
  const platform = normalizePlatform(saved.platform);

  if (!current) {
    await writeClipLog(saved, "clips.config.created", userId, `Configuracao de clipes ${platformLabel(platform)} criada.`);
    return;
  }

  if (current.enabled !== saved.enabled) {
    await writeClipLog(saved, saved.enabled ? "clips.enabled" : "clips.disabled", userId, saved.enabled ? `Sistema de clipes ${platformLabel(platform)} ativado.` : `Sistema de clipes ${platformLabel(platform)} desativado.`);
  }

  if (channelNameForConfig(current) !== channelNameForConfig(saved)) {
    await writeClipLog(saved, platform === "kick" ? "clips.kick.updated" : "clips.twitch.updated", userId, `Canal de clipes ${platformLabel(platform)} alterado.`);
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
  const platform = normalizePlatform(config.platform);
  const { clipsLogs } = await getMongoCollections();
  await clipsLogs.insertOne({
    _id: randomUUID(),
    guildId: config.guildId,
    botId: normalizeBotId(config.botId),
    platform,
    action,
    userId,
    message,
    createdAt: now
  });
  const botId = normalizeBotId(config.botId);
  if (!botId) {
    return;
  }

  await createLog({
    botId,
    guildId: config.guildId,
    userId,
    type: action,
    message,
    metadata: {
      module: platform === "kick" ? "kick-clips" : "clips",
      platform,
      channelName: channelNameForConfig(config)
    }
  });
}

async function countClipsSent(guildId: string, botId: string | null, platform: ClipPlatform) {
  const { clipsSent } = await getMongoCollections();
  return clipsSent.countDocuments(sentQuery(guildId, botId, platform));
}

async function countClipsSentForConfig(config: MongoClipsConfig) {
  const { clipsSent } = await getMongoCollections();
  return clipsSent.countDocuments({
    configId: config._id,
    ...botScopeQuery(normalizeBotId(config.botId))
  });
}

async function resolveClipRewards(config: MongoClipsConfig, creatorName: string | null): Promise<ClipRewardAssignmentDto[]> {
  const rewards = sanitizeRewardRoles(config.clipRewards ?? []);

  if (!creatorName?.trim() || !rewards.length) {
    return [];
  }

  const platform = normalizePlatform(config.platform);
  const { clipsSent } = await getMongoCollections();
  const creatorRegex = new RegExp(`^${escapeRegExp(creatorName.trim())}$`, "i");
  const creatorClipCount = await clipsSent.countDocuments({
    ...sentQuery(config.guildId, normalizeBotId(config.botId), platform),
    clipCreatorName: creatorRegex
  });
  const earnedRewards = rewards.filter((reward) => creatorClipCount >= reward.clipCount);

  if (!earnedRewards.length) {
    return [];
  }

  const discordUserId = await findDiscordUserIdForClipCreator(config, creatorName);

  if (!discordUserId) {
    return [];
  }

  return earnedRewards.map((reward) => ({
    ...reward,
    userId: discordUserId
  }));
}

async function findDiscordUserIdForClipCreator(config: MongoClipsConfig, creatorName: string) {
  const platform = normalizePlatform(config.platform);
  const normalizedCreator = normalizeIdentity(creatorName);
  const { socialMembers } = await getMongoCollections();
  const members = await socialMembers
    .find({
      guildId: config.guildId,
      ...botScopeQuery(normalizeBotId(config.botId))
    })
    .toArray();

  for (const member of members) {
    const platformValue = platform === "kick" ? member.kick : member.twitch;
    const candidates = [member.name, platformValue]
      .map((value) => normalizeIdentity(value ?? ""))
      .filter(Boolean);

    if (candidates.includes(normalizedCreator)) {
      return member.discordId || member.userId || null;
    }
  }

  return null;
}

function toConfigDto(config: MongoClipsConfig, totalSent = 0): ClipsConfigDto {
  const platform = normalizePlatform(config.platform);
  const channelName = channelNameForConfig(config);
  const displayName = displayNameForConfig(config);
  const avatar = avatarForConfig(config);
  const channelUrl = platform === "kick"
    ? config.kickChannelUrl ?? (config.kickChannelName ? `https://kick.com/${config.kickChannelName}` : null)
    : config.twitchChannelName ? `https://www.twitch.tv/${config.twitchChannelName}` : null;

  return {
    id: config._id,
    guildId: config.guildId,
    botId: normalizeBotId(config.botId),
    platform,
    channelName,
    broadcasterId: broadcasterIdForConfig(config),
    displayName,
    avatar,
    channelUrl,
    followers: platform === "kick" ? config.kickFollowers ?? null : null,
    captureAvailable: platform === "twitch",
    providerStatus: platform === "kick" ? KICK_CLIP_PROVIDER_STATUS : "Captura oficial via Twitch Helix ativa.",
    twitchChannelName: config.twitchChannelName ?? "",
    twitchBroadcasterId: config.twitchBroadcasterId ?? "",
    twitchDisplayName: config.twitchDisplayName ?? null,
    twitchAvatar: config.twitchAvatar ?? null,
    kickChannelName: config.kickChannelName ?? null,
    kickChannelUrl: config.kickChannelUrl ?? null,
    kickChannelId: config.kickChannelId ?? null,
    kickUserId: config.kickUserId ?? null,
    kickDisplayName: config.kickDisplayName ?? null,
    kickAvatar: config.kickAvatar ?? null,
    kickFollowers: config.kickFollowers ?? null,
    kickApiTokenConfigured: Boolean(config.kickApiTokenEncrypted),
    discordChannelId: config.discordChannelId ?? null,
    enabled: config.enabled,
    allowedRoleIds: config.allowedRoleIds ?? [],
    mentionType: normalizeMentionType(config.mentionType),
    mentionRoleId: config.mentionRoleId ?? null,
    embedColor: normalizeEmbedColor(config.embedColor, platform),
    customMessage: config.customMessage ?? null,
    clipRewards: sanitizeRewardRoles(config.clipRewards ?? []),
    checkInterval: normalizeCheckInterval(),
    lastCheckAt: config.lastCheckAt?.toISOString?.() ?? null,
    activeLiveSessionId: config.activeLiveSessionId ?? null,
    activeLiveStartedAt: config.activeLiveStartedAt?.toISOString?.() ?? null,
    activeLiveTitle: config.activeLiveTitle ?? null,
    activeLiveThumbnail: config.activeLiveThumbnail ?? null,
    totalSent,
    publicUrl: platform === "kick" && config.kickChannelName ? `${env.SITE_ORIGIN.replace(/\/+$/, "")}/clipes/kick/${encodeURIComponent(config.kickChannelName)}` : null,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function toSentDto(sent: MongoClipSent): ClipSentDto {
  const platform = normalizePlatform(sent.platform);
  const channelName = platform === "kick" ? sent.kickChannelName ?? "" : sent.twitchChannelName ?? "";

  return {
    id: sent._id,
    guildId: sent.guildId,
    botId: normalizeBotId(sent.botId),
    configId: sent.configId ?? null,
    platform,
    channelName,
    broadcasterId: platform === "kick" ? sent.kickUserId ?? "" : sent.twitchBroadcasterId ?? "",
    twitchChannelName: sent.twitchChannelName ?? "",
    twitchBroadcasterId: sent.twitchBroadcasterId ?? "",
    kickChannelName: sent.kickChannelName ?? null,
    kickUserId: sent.kickUserId ?? null,
    clipId: sent.clipId,
    clipTitle: sent.clipTitle,
    clipUrl: sent.clipUrl,
    clipThumbnail: sent.clipThumbnail ?? null,
    clipCreatorName: sent.clipCreatorName ?? null,
    clipDuration: normalizeDuration(sent.clipDuration),
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
    platform: config.platform,
    twitchChannelName: config.twitchChannelName || null,
    twitchBroadcasterId: config.twitchBroadcasterId || null,
    twitchDisplayName: config.twitchDisplayName,
    twitchAvatar: config.twitchAvatar,
    kickChannelName: config.kickChannelName,
    kickChannelUrl: config.kickChannelUrl,
    kickChannelId: config.kickChannelId,
    kickUserId: config.kickUserId,
    kickDisplayName: config.kickDisplayName,
    kickAvatar: config.kickAvatar,
    kickFollowers: config.kickFollowers,
    discordChannelId: config.discordChannelId,
    enabled: config.enabled,
    allowedRoleIds: config.allowedRoleIds,
    mentionType: config.mentionType,
    mentionRoleId: config.mentionRoleId,
    embedColor: config.embedColor,
    customMessage: config.customMessage,
    clipRewards: config.clipRewards,
    checkInterval: config.checkInterval,
    lastCheckAt: config.lastCheckAt ? new Date(config.lastCheckAt) : null,
    activeLiveSessionId: config.activeLiveSessionId,
    activeLiveStartedAt: config.activeLiveStartedAt ? new Date(config.activeLiveStartedAt) : null,
    activeLiveTitle: config.activeLiveTitle,
    activeLiveThumbnail: config.activeLiveThumbnail,
    createdAt: new Date(config.createdAt),
    updatedAt: new Date(config.updatedAt)
  };
}

function normalizeAndValidateTwitchChannel(input: string) {
  const channel = normalizeTwitchChannel(input);

  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) {
    throw createClipsError("Informe um canal ou link valido da Twitch.", 400);
  }

  return channel;
}

function normalizeAndValidateKickChannel(input: string) {
  const channel = normalizeKickChannel(input);

  if (!channel || !/^[a-z0-9][a-z0-9_-]{1,24}$/i.test(channel)) {
    throw createClipsError("Informe um canal ou link valido da Kick.", 400);
  }

  return channel;
}

function sanitizeRoleIds(roleIds?: string[]) {
  return [...new Set((roleIds ?? []).map((roleId) => roleId.trim()).filter(Boolean))];
}

function sanitizeRewardRoles(rewards?: ClipRewardRoleDto[] | MongoClipRewardRole[]) {
  return [...(rewards ?? [])]
    .map((reward) => ({
      clipCount: Math.max(1, Math.min(100_000, Math.floor(Number(reward.clipCount || 0)))),
      label: reward.label?.trim().slice(0, 60) || `${reward.clipCount} clipes`,
      roleId: reward.roleId?.trim() || ""
    }))
    .filter((reward) => reward.clipCount > 0 && reward.roleId)
    .sort((left, right) => left.clipCount - right.clipCount);
}

function normalizePlatform(value?: string | null): ClipPlatform {
  return value === "kick" ? "kick" : "twitch";
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

function normalizeEmbedColor(value?: string | null, platform: ClipPlatform = "twitch") {
  const color = value?.trim();
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : DEFAULT_EMBED_COLOR_BY_PLATFORM[platform];
}

function parseEmbedColor(value?: string | null, platform: ClipPlatform = "twitch") {
  return Number.parseInt(normalizeEmbedColor(value, platform).replace("#", ""), 16);
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

function scopeQuery(guildId: string, botId: string | null, platform: ClipPlatform): Filter<MongoClipsConfig> {
  return {
    $and: [
      { guildId },
      botScopeClause(botId) as Filter<MongoClipsConfig>,
      platformClause(platform) as Filter<MongoClipsConfig>,
      activeConfigClause() as Filter<MongoClipsConfig>
    ]
  };
}

async function findCurrentClipsConfig(
  guildId: string,
  botId: string | null,
  platform: ClipPlatform,
  configId: string | null | undefined,
  channelPatch: Partial<MongoClipsConfig>
) {
  const { clipsConfig } = await getMongoCollections();

  if (configId?.trim()) {
    const current = await clipsConfig.findOne({
      _id: configId.trim(),
      guildId,
      ...botScopeQuery(botId),
      ...activeConfigClause()
    });

    if (!current) {
      throw createClipsError("Configuracao de clipes nao encontrada.", 404);
    }

    return current;
  }

  return clipsConfig.findOne(channelScopeQuery(guildId, botId, platform, channelPatch));
}

async function getClipConfigForGuildAction(guildId: string, botId: string | null, platform: ClipPlatform, configId?: string | null) {
  const { clipsConfig } = await getMongoCollections();
  const config = configId?.trim()
    ? await clipsConfig.findOne({
        _id: configId.trim(),
        guildId,
        ...botScopeQuery(botId),
        ...activeConfigClause()
      })
    : await clipsConfig.findOne(scopeQuery(guildId, botId, platform), {
        sort: {
          updatedAt: -1
        }
      });

  if (!config) {
    throw createClipsError("Configuracao de clipes nao encontrada.", 404);
  }

  return config;
}

function channelScopeQuery(guildId: string, botId: string | null, platform: ClipPlatform, patch: Partial<MongoClipsConfig>): Filter<MongoClipsConfig> {
  const channelClause = platform === "kick"
    ? { kickUserId: patch.kickUserId ?? "" }
    : { twitchBroadcasterId: patch.twitchBroadcasterId ?? "" };

  return {
    $and: [
      { guildId },
      botScopeClause(botId) as Filter<MongoClipsConfig>,
      { platform },
      channelClause as Filter<MongoClipsConfig>,
      activeConfigClause() as Filter<MongoClipsConfig>
    ]
  };
}

function activeConfigClause() {
  return {
    $or: [
      { deletedAt: null },
      { deletedAt: { $exists: false } }
    ]
  };
}

function sentQuery(
  guildId: string,
  botId: string | null,
  platform: ClipPlatform,
  range?: { end?: Date; start?: Date } | null,
  clipId?: string
): Filter<MongoClipSent> {
  const clauses: Array<Filter<MongoClipSent>> = [
    { guildId },
    botScopeClause(botId) as Filter<MongoClipSent>,
    platformClause(platform) as Filter<MongoClipSent>
  ];

  if (range?.start || range?.end) {
    clauses.push({
      sentAt: {
        ...(range.start ? { $gte: range.start } : {}),
        ...(range.end ? { $lt: range.end } : {})
      }
    });
  }

  if (clipId) {
    clauses.push({ clipId });
  }

  return {
    $and: clauses
  };
}

function botScopeQuery(botId: string | null) {
  if (!botId) {
    return {
      $or: [
        { botId: null },
        { botId: { $exists: false } }
      ]
    };
  }

  // Also match null-scoped configs (created before multi-bot support) so existing
  // configs remain accessible when a specific bot is selected in the dashboard.
  return {
    $or: [
      { botId },
      { botId: null },
      { botId: { $exists: false } }
    ]
  };
}

function botScopeClause(botId: string | null) {
  return botScopeQuery(botId);
}

function platformClause(platform: ClipPlatform) {
  if (platform === "twitch") {
    return {
      $or: [
        {
          platform: "twitch"
        },
        {
          platform: {
            $exists: false
          }
        }
      ]
    };
  }

  return {
    platform
  };
}

function dateFilter(filter: ClipDateFilter = "all") {
  return rangeForFilter(filter);
}

function rangeForFilter(filter: ClipDateFilter, baseDate = new Date()) {
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);

  if (filter === "today") {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  if (filter === "yesterday") {
    const end = new Date(start);
    start.setDate(start.getDate() - 1);
    return { start, end };
  }

  if (filter === "7d") {
    start.setDate(start.getDate() - 6);
    return { start };
  }

  if (filter === "30d") {
    start.setDate(start.getDate() - 29);
    return { start };
  }

  return null;
}

function buildSeries(dates: Date[], unit: "day" | "month" | "week") {
  const counts = new Map<string, number>();

  for (const date of dates) {
    const label = seriesLabel(date, unit);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()].map(([label, value]) => ({
    label,
    value
  }));
}

function seriesLabel(date: Date, unit: "day" | "month" | "week") {
  if (unit === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  if (unit === "week") {
    const firstDay = new Date(date);
    firstDay.setHours(0, 0, 0, 0);
    firstDay.setDate(firstDay.getDate() - firstDay.getDay());
    return `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, "0")}-${String(firstDay.getDate()).padStart(2, "0")}`;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function channelNameForConfig(config: Pick<MongoClipsConfig, "kickChannelName" | "platform" | "twitchChannelName">) {
  const platform = normalizePlatform(config.platform);
  return platform === "kick" ? config.kickChannelName ?? "" : config.twitchChannelName ?? "";
}

function broadcasterIdForConfig(config: Pick<MongoClipsConfig, "kickUserId" | "platform" | "twitchBroadcasterId">) {
  const platform = normalizePlatform(config.platform);
  return platform === "kick" ? config.kickUserId ?? "" : config.twitchBroadcasterId ?? "";
}

function displayNameForConfig(config: Pick<MongoClipsConfig, "kickChannelName" | "kickDisplayName" | "platform" | "twitchChannelName" | "twitchDisplayName">) {
  const platform = normalizePlatform(config.platform);
  return platform === "kick"
    ? config.kickDisplayName ?? config.kickChannelName ?? ""
    : config.twitchDisplayName ?? config.twitchChannelName ?? "";
}

function avatarForConfig(config: Pick<MongoClipsConfig, "kickAvatar" | "platform" | "twitchAvatar">) {
  return normalizePlatform(config.platform) === "kick" ? config.kickAvatar ?? null : config.twitchAvatar ?? null;
}

function platformLabel(platform: ClipPlatform) {
  return platform === "kick" ? "Kick" : "Twitch";
}

function normalizeDuration(value?: number | null) {
  const duration = Number(value ?? 0);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
}

function normalizeIdentity(value: string) {
  return (
    value
      .trim()
      .replace(/^https?:\/\/(www\.)?(kick|twitch)\.com\//i, "")
      .replace(/^@+/, "")
      .split(/[/?#]/)[0] ?? ""
  ).toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createClipsError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
