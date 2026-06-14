import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoMissionToolsClearMode,
  type MongoMissionToolsFeatureId,
  type MongoMissionToolsRichPresenceActivityType,
  type MongoMissionToolsRichPresenceConfig,
  type MongoMissionToolsRichPresenceStatus,
  type MongoMissionToolsSettings,
  type MongoMissionToolsStatus,
  type MongoMissionToolsToken,
  type MongoMissionToolsUserPanel,
  type MongoMissionToolsUsernameCheckerOptions,
  type MongoMissionToolsUsernameCheckerStats,
  type MongoMissionToolsVoiceStatus
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";
import { decryptSecret, encryptSecret } from "./secretCryptoService";

export type MissionToolsSettingsDto = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleIds: string[];
  allowedRoleIds: string[];
  enabledFeatures: MongoMissionToolsFeatureId[];
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsUserPanelDto = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  dmChannelId: string | null;
  clearMessageId: string | null;
  missionMessageId: string | null;
  voiceMessageId: string | null;
  richPresenceMessageId: string | null;
  usernameCheckerMessageId: string | null;
  tokenConfigured: boolean;
  clearStatus: MongoMissionToolsStatus;
  clearMode: MongoMissionToolsClearMode;
  clearTargetUserId: string | null;
  missionStatus: MongoMissionToolsStatus;
  voiceStatus: MongoMissionToolsVoiceStatus;
  richPresenceStatus: MongoMissionToolsRichPresenceStatus;
  usernameCheckerStatus: MongoMissionToolsStatus;
  currentMission: string | null;
  missionDetail: string | null;
  voiceGuildId: string | null;
  voiceGuildName: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  voiceConnectedAt: string | null;
  richPresenceConfig: MongoMissionToolsRichPresenceConfig;
  richPresenceUpdatedAt: string | null;
  usernameCheckerOptions: MongoMissionToolsUsernameCheckerOptions;
  usernameCheckerStats: MongoMissionToolsUsernameCheckerStats;
  usernameCheckerLastEvent: string | null;
  usernameCheckerUpdatedAt: string | null;
  completedCount: number;
  totalMissions: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsStatsDto = {
  configuredUsers: number;
  usersWithToken: number;
  runningMissions: number;
  runningCleanups: number;
  activeVoiceSessions: number;
  activeRichPresence: number;
  usernameHits: number;
};

export type MissionToolsDashboardDto = {
  settings: MissionToolsSettingsDto;
  users: MissionToolsUserPanelDto[];
  stats: MissionToolsStatsDto;
};

export type SaveMissionToolsSettingsInput = {
  enabled?: boolean;
  panelChannelId?: string | null;
  logChannelId?: string | null;
  managerRoleIds?: string[];
  allowedRoleIds?: string[];
  enabledFeatures?: string[];
};

export type SaveMissionToolsUserInput = Partial<{
  username: string | null;
  dmChannelId: string | null;
  clearMessageId: string | null;
  missionMessageId: string | null;
  voiceMessageId: string | null;
  richPresenceMessageId: string | null;
  usernameCheckerMessageId: string | null;
  tokenConfigured: boolean;
  clearStatus: MongoMissionToolsStatus;
  clearMode: MongoMissionToolsClearMode;
  clearTargetUserId: string | null;
  missionStatus: MongoMissionToolsStatus;
  voiceStatus: MongoMissionToolsVoiceStatus;
  richPresenceStatus: MongoMissionToolsRichPresenceStatus;
  usernameCheckerStatus: MongoMissionToolsStatus;
  currentMission: string | null;
  missionDetail: string | null;
  voiceGuildId: string | null;
  voiceGuildName: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  voiceConnectedAt: string | null;
  richPresenceConfig: MongoMissionToolsRichPresenceConfig;
  richPresenceUpdatedAt: string | null;
  usernameCheckerOptions: MongoMissionToolsUsernameCheckerOptions;
  usernameCheckerStats: Partial<MongoMissionToolsUsernameCheckerStats>;
  usernameCheckerLastEvent: string | null;
  usernameCheckerUpdatedAt: string | null;
  completedCount: number;
  totalMissions: number;
  progress: number;
}>;

const MODULE_ID = "mission-tools";
const FEATURE_IDS: MongoMissionToolsFeatureId[] = [
  "mission",
  "clear",
  "voice",
  "rich-presence",
  "username-checker"
];
const STATUS_IDS: MongoMissionToolsStatus[] = [
  "active",
  "inactive",
  "deactivated",
  "waiting",
  "running",
  "completed",
  "error"
];
const VOICE_STATUS_IDS: MongoMissionToolsVoiceStatus[] = ["connected", "disconnected", "reconnecting"];
const RICH_STATUS_IDS: MongoMissionToolsRichPresenceStatus[] = ["active", "inactive"];
const CLEAR_MODE_IDS: MongoMissionToolsClearMode[] = ["bulk", "userDm"];
const ACTIVITY_TYPES: MongoMissionToolsRichPresenceActivityType[] = [0, 1, 2, 3, 5];
const DEFAULT_USERNAME_CHECKER_OPTIONS: MongoMissionToolsUsernameCheckerOptions = {
  requestDelay: 2000,
  usernameLength: 4
};
const DEFAULT_USERNAME_CHECKER_STATS: MongoMissionToolsUsernameCheckerStats = {
  activeProxies: 0,
  bannedProxies: 0,
  deadProxies: 0,
  errors: 0,
  hits: 0,
  taken: 0,
  workersRunning: 0
};

export function defaultMissionToolsSettings(botId: string, guildId: string): MissionToolsSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    panelChannelId: null,
    panelMessageId: null,
    logChannelId: null,
    managerRoleIds: [],
    allowedRoleIds: [],
    enabledFeatures: [...FEATURE_IDS],
    lastPanelRequestedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export function defaultMissionToolsUserPanel(botId: string, guildId: string, userId: string): MissionToolsUserPanelDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    userId,
    username: null,
    dmChannelId: null,
    clearMessageId: null,
    missionMessageId: null,
    voiceMessageId: null,
    richPresenceMessageId: null,
    usernameCheckerMessageId: null,
    tokenConfigured: false,
    clearStatus: "deactivated",
    clearMode: "bulk",
    clearTargetUserId: null,
    missionStatus: "inactive",
    voiceStatus: "disconnected",
    richPresenceStatus: "inactive",
    usernameCheckerStatus: "inactive",
    currentMission: null,
    missionDetail: null,
    voiceGuildId: null,
    voiceGuildName: null,
    voiceChannelId: null,
    voiceChannelName: null,
    voiceConnectedAt: null,
    richPresenceConfig: {},
    richPresenceUpdatedAt: null,
    usernameCheckerOptions: { ...DEFAULT_USERNAME_CHECKER_OPTIONS },
    usernameCheckerStats: { ...DEFAULT_USERNAME_CHECKER_STATS },
    usernameCheckerLastEvent: null,
    usernameCheckerUpdatedAt: null,
    completedCount: 0,
    totalMissions: 0,
    progress: 0,
    createdAt: now,
    updatedAt: now
  };
}

export async function getMissionToolsDashboard(guildId: string, botId: string): Promise<MissionToolsDashboardDto> {
  const { missionToolsUsers } = await getMongoCollections();
  const [settings, users] = await Promise.all([
    getMissionToolsSettings(guildId, botId),
    missionToolsUsers
      .find({ botId, guildId })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray()
  ]);
  const userDtos = users.map(toUserDto);

  return {
    settings,
    users: userDtos,
    stats: missionToolsStats(userDtos)
  };
}

export async function getMissionToolsSettings(guildId: string, botId: string): Promise<MissionToolsSettingsDto> {
  const { missionToolsSettings } = await getMongoCollections();
  const settings = await missionToolsSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultMissionToolsSettings(botId, guildId);
}

export async function listActiveMissionToolsSettings(botId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const settings = await missionToolsSettings
    .find({
      enabled: true,
      ...(botId ? { botId } : {})
    })
    .sort({ updatedAt: -1 })
    .toArray();

  return settings.map(toSettingsDto);
}

export async function saveMissionToolsSettings(guildId: string, botId: string, input: SaveMissionToolsSettingsInput, actorId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const current = await getMissionToolsSettings(guildId, botId);
  const now = new Date();
  const next = {
    allowedRoleIds: input.allowedRoleIds ? normalizeSnowflakes(input.allowedRoleIds) : current.allowedRoleIds,
    enabled: input.enabled ?? current.enabled,
    enabledFeatures: input.enabledFeatures ? normalizeFeatureIds(input.enabledFeatures) : current.enabledFeatures,
    logChannelId: normalizeNullableSnowflake(input.logChannelId, current.logChannelId),
    managerRoleIds: input.managerRoleIds ? normalizeSnowflakes(input.managerRoleIds) : current.managerRoleIds,
    panelChannelId: normalizeNullableSnowflake(input.panelChannelId, current.panelChannelId)
  };

  await ensureGuild(guildId);
  await missionToolsSettings.updateOne(
    {
      botId,
      guildId
    },
    {
      $set: {
        ...next,
        botId,
        guildId,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now,
        createdBy: actorId,
        lastPanelRequestedAt: null,
        panelMessageId: null
      }
    },
    {
      upsert: true
    }
  );

  const saved = await getMissionToolsSettings(guildId, botId);
  const log = await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.settings_updated",
    userId: actorId,
    message: "Mission Tools atualizado.",
    metadata: {
      action: "settings_updated",
      changedKeys: Object.keys(input),
      module: MODULE_ID,
      status: saved.enabled ? "enabled" : "disabled"
    }
  });

  emitMissionSettings(saved);
  if (saved.enabled && saved.panelChannelId && saved.panelMessageId) {
    emitMissionPanelPublish(saved);
  }
  if (log) {
    emitRealtime("logs:new", log);
  }

  return saved;
}

export async function requestMissionToolsPanelPublish(guildId: string, botId: string, actorId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const settings = await getMissionToolsSettings(guildId, botId);

  validateSettingsReady(settings);

  const requestedAt = new Date();
  await missionToolsSettings.updateOne(
    {
      botId,
      guildId
    },
    {
      $set: {
        lastPanelRequestedAt: requestedAt,
        updatedAt: requestedAt,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: requestedAt,
        createdBy: actorId
      }
    },
    {
      upsert: true
    }
  );

  const nextSettings = await getMissionToolsSettings(guildId, botId);
  emitMissionPanelPublish(nextSettings);

  await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.panel_publish_requested",
    userId: actorId,
    message: "Publicacao do painel Mission Tools solicitada.",
    metadata: {
      action: "panel_publish_requested",
      module: MODULE_ID,
      panelChannelId: nextSettings.panelChannelId
    }
  });

  return nextSettings;
}

export async function updateMissionToolsPanelMessageState(botId: string, guildId: string, messageId: string | null) {
  const { missionToolsSettings } = await getMongoCollections();
  const now = new Date();

  await missionToolsSettings.updateOne(
    {
      botId,
      guildId
    },
    {
      $set: {
        panelMessageId: normalizeNullableSnowflake(messageId, null),
        updatedAt: now
      }
    }
  );

  return getMissionToolsSettings(guildId, botId);
}

export async function getMissionToolsUserPanel(guildId: string, botId: string, userId: string) {
  const { missionToolsUsers } = await getMongoCollections();
  const user = await missionToolsUsers.findOne({ botId, guildId, userId });

  return user ? toUserDto(user) : defaultMissionToolsUserPanel(botId, guildId, userId);
}

export async function saveMissionToolsUserPanel(guildId: string, botId: string, userId: string, input: SaveMissionToolsUserInput) {
  const { missionToolsUsers } = await getMongoCollections();
  const current = await getMissionToolsUserPanel(guildId, botId, userId);
  const now = new Date();
  const next = normalizeUserInput(input, current);

  await ensureGuild(guildId);
  await missionToolsUsers.updateOne(
    {
      botId,
      guildId,
      userId
    },
    {
      $set: {
        ...next,
        botId,
        guildId,
        userId,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );

  const saved = await getMissionToolsUserPanel(guildId, botId, userId);
  emitMissionUserUpdated(saved);
  return saved;
}

export async function saveMissionToolsToken(guildId: string, botId: string, userId: string, token: string) {
  const { missionToolsTokens } = await getMongoCollections();
  const normalized = token.trim();

  if (normalized.length < 10) {
    throw createMissionError("Token invalido.", 400);
  }

  const now = new Date();
  await missionToolsTokens.updateOne(
    {
      botId,
      guildId,
      userId
    },
    {
      $set: {
        botId,
        guildId,
        tokenEncrypted: encryptSecret(normalized),
        tokenLast4: tokenLast4(normalized),
        updatedAt: now,
        userId
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );

  await saveMissionToolsUserPanel(guildId, botId, userId, {
    tokenConfigured: true
  });

  return {
    tokenConfigured: true,
    tokenLast4: tokenLast4(normalized)
  };
}

export async function deleteMissionToolsToken(guildId: string, botId: string, userId: string) {
  const { missionToolsTokens } = await getMongoCollections();

  await missionToolsTokens.deleteOne({ botId, guildId, userId });
  await saveMissionToolsUserPanel(guildId, botId, userId, {
    tokenConfigured: false,
    voiceStatus: "disconnected",
    richPresenceStatus: "inactive"
  });

  return {
    tokenConfigured: false
  };
}

export async function getMissionToolsUserToken(guildId: string, botId: string, userId: string) {
  const { missionToolsTokens } = await getMongoCollections();
  const token = await missionToolsTokens.findOne({ botId, guildId, userId });

  return token ? toTokenDto(token) : null;
}

function missionToolsStats(users: MissionToolsUserPanelDto[]): MissionToolsStatsDto {
  return {
    activeRichPresence: users.filter((user) => user.richPresenceStatus === "active").length,
    activeVoiceSessions: users.filter((user) => user.voiceStatus === "connected" || user.voiceStatus === "reconnecting").length,
    configuredUsers: users.length,
    runningCleanups: users.filter((user) => user.clearStatus === "running" || user.clearStatus === "waiting").length,
    runningMissions: users.filter((user) => user.missionStatus === "running" || user.missionStatus === "waiting").length,
    usernameHits: users.reduce((total, user) => total + user.usernameCheckerStats.hits, 0),
    usersWithToken: users.filter((user) => user.tokenConfigured).length
  };
}

function validateSettingsReady(settings: MissionToolsSettingsDto) {
  if (!settings.enabled) {
    throw createMissionError("O Mission Tools nao esta ativo na dashboard.", 403);
  }

  if (!settings.panelChannelId) {
    throw createMissionError("Configure o canal do painel antes de usar o Mission Tools.", 400);
  }
}

function normalizeUserInput(input: SaveMissionToolsUserInput, current: MissionToolsUserPanelDto): Partial<MongoMissionToolsUserPanel> {
  return {
    clearMessageId: normalizeNullableSnowflake(input.clearMessageId, current.clearMessageId),
    clearMode: normalizeClearMode(input.clearMode, current.clearMode),
    clearStatus: normalizeStatus(input.clearStatus, current.clearStatus),
    clearTargetUserId: normalizeNullableSnowflake(input.clearTargetUserId, current.clearTargetUserId),
    completedCount: normalizeCount(input.completedCount, current.completedCount),
    currentMission: normalizeOptionalText(input.currentMission, current.currentMission, 256),
    dmChannelId: normalizeNullableSnowflake(input.dmChannelId, current.dmChannelId),
    missionDetail: normalizeOptionalText(input.missionDetail, current.missionDetail, 1000),
    missionMessageId: normalizeNullableSnowflake(input.missionMessageId, current.missionMessageId),
    missionStatus: normalizeStatus(input.missionStatus, current.missionStatus),
    progress: normalizePercent(input.progress, current.progress),
    richPresenceConfig: normalizeRichPresenceConfig(input.richPresenceConfig ?? current.richPresenceConfig),
    richPresenceMessageId: normalizeNullableSnowflake(input.richPresenceMessageId, current.richPresenceMessageId),
    richPresenceStatus: normalizeRichStatus(input.richPresenceStatus, current.richPresenceStatus),
    richPresenceUpdatedAt: normalizeOptionalText(input.richPresenceUpdatedAt, current.richPresenceUpdatedAt, 80),
    tokenConfigured: input.tokenConfigured ?? current.tokenConfigured,
    totalMissions: normalizeCount(input.totalMissions, current.totalMissions),
    username: normalizeOptionalText(input.username, current.username, 120),
    usernameCheckerLastEvent: normalizeOptionalText(input.usernameCheckerLastEvent, current.usernameCheckerLastEvent, 500),
    usernameCheckerMessageId: normalizeNullableSnowflake(input.usernameCheckerMessageId, current.usernameCheckerMessageId),
    usernameCheckerOptions: normalizeUsernameCheckerOptions(input.usernameCheckerOptions ?? current.usernameCheckerOptions),
    usernameCheckerStats: normalizeUsernameCheckerStats(input.usernameCheckerStats ?? current.usernameCheckerStats),
    usernameCheckerStatus: normalizeStatus(input.usernameCheckerStatus, current.usernameCheckerStatus),
    usernameCheckerUpdatedAt: normalizeOptionalText(input.usernameCheckerUpdatedAt, current.usernameCheckerUpdatedAt, 80),
    voiceChannelId: normalizeNullableSnowflake(input.voiceChannelId, current.voiceChannelId),
    voiceChannelName: normalizeOptionalText(input.voiceChannelName, current.voiceChannelName, 120),
    voiceConnectedAt: normalizeOptionalText(input.voiceConnectedAt, current.voiceConnectedAt, 80),
    voiceGuildId: normalizeNullableSnowflake(input.voiceGuildId, current.voiceGuildId),
    voiceGuildName: normalizeOptionalText(input.voiceGuildName, current.voiceGuildName, 120),
    voiceMessageId: normalizeNullableSnowflake(input.voiceMessageId, current.voiceMessageId),
    voiceStatus: normalizeVoiceStatus(input.voiceStatus, current.voiceStatus)
  };
}

function normalizeFeatureIds(values: string[]) {
  const allowed = new Set(FEATURE_IDS);
  const features = [...new Set(values.filter((value): value is MongoMissionToolsFeatureId => allowed.has(value as MongoMissionToolsFeatureId)))];

  return features.length ? features : [...FEATURE_IDS];
}

function normalizeRichPresenceConfig(input: MongoMissionToolsRichPresenceConfig): MongoMissionToolsRichPresenceConfig {
  return {
    activityType: ACTIVITY_TYPES.includes(input.activityType as MongoMissionToolsRichPresenceActivityType) ? input.activityType : 0,
    applicationId: normalizePlainText(input.applicationId, 32),
    buttonLabel: normalizePlainText(input.buttonLabel, 80),
    buttonUrl: normalizePlainText(input.buttonUrl, 512),
    description: normalizePlainText(input.description, 256),
    details: normalizePlainText(input.details, 128),
    largeImage: normalizePlainText(input.largeImage, 1024),
    largeText: normalizePlainText(input.largeText, 128),
    name: normalizePlainText(input.name, 128),
    smallImage: normalizePlainText(input.smallImage, 1024),
    smallText: normalizePlainText(input.smallText, 128),
    startTimestamp: normalizePlainText(input.startTimestamp, 64),
    state: normalizePlainText(input.state, 128)
  };
}

function normalizeUsernameCheckerOptions(input: MongoMissionToolsUsernameCheckerOptions): MongoMissionToolsUsernameCheckerOptions {
  return {
    concurrency: normalizeOptionalNumber(input.concurrency, 1, 1, 5),
    requestDelay: normalizeOptionalNumber(input.requestDelay, 2000, 1500, 60_000),
    usernameLength: normalizeOptionalNumber(input.usernameLength, 4, 2, 20)
  };
}

function normalizeUsernameCheckerStats(input: Partial<MongoMissionToolsUsernameCheckerStats>): MongoMissionToolsUsernameCheckerStats {
  return {
    activeProxies: normalizeCount(input.activeProxies, 0),
    bannedProxies: normalizeCount(input.bannedProxies, 0),
    deadProxies: normalizeCount(input.deadProxies, 0),
    errors: normalizeCount(input.errors, 0),
    hits: normalizeCount(input.hits, 0),
    taken: normalizeCount(input.taken, 0),
    workersRunning: normalizeCount(input.workersRunning, 0)
  };
}

function normalizeStatus(value: MongoMissionToolsStatus | undefined, fallback: MongoMissionToolsStatus) {
  return value && STATUS_IDS.includes(value) ? value : fallback;
}

function normalizeVoiceStatus(value: MongoMissionToolsVoiceStatus | undefined, fallback: MongoMissionToolsVoiceStatus) {
  return value && VOICE_STATUS_IDS.includes(value) ? value : fallback;
}

function normalizeRichStatus(value: MongoMissionToolsRichPresenceStatus | undefined, fallback: MongoMissionToolsRichPresenceStatus) {
  return value && RICH_STATUS_IDS.includes(value) ? value : fallback;
}

function normalizeClearMode(value: MongoMissionToolsClearMode | undefined, fallback: MongoMissionToolsClearMode) {
  return value && CLEAR_MODE_IDS.includes(value) ? value : fallback;
}

function normalizeOptionalText(value: unknown, fallback: string | null, maxLength: number) {
  if (value === undefined) {
    return fallback;
  }

  return normalizePlainText(value, maxLength) ?? null;
}

function normalizePlainText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeOptionalNumber(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(normalized)));
}

function normalizeCount(value: unknown, fallback: number) {
  return normalizeOptionalNumber(value, fallback, 0, 1_000_000);
}

function normalizePercent(value: unknown, fallback: number) {
  return normalizeOptionalNumber(value, fallback, 0, 100);
}

function normalizeNullableSnowflake(value: unknown, fallback: string | null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "string" && /^\d{5,32}$/.test(value.trim())) {
    return value.trim();
  }

  throw createMissionError("Um dos IDs informados nao e valido.", 400);
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => normalizeNullableSnowflake(value, null)).filter((value): value is string => Boolean(value)))];
}

async function createMissionLog(input: Parameters<typeof createLog>[0]) {
  return createLog(input).catch((error) => {
    console.warn("[mission-tools] nao foi possivel registrar log:", error instanceof Error ? error.message : error);
    return null;
  });
}

function emitMissionSettings(settings: MissionToolsSettingsDto) {
  const payload = {
    botId: settings.botId,
    guildId: settings.guildId,
    settings
  };

  emitRealtime("mission-tools:settings_updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "mission-tools:settings_updated", payload);
}

function emitMissionPanelPublish(settings: MissionToolsSettingsDto) {
  const payload = {
    botId: settings.botId,
    guildId: settings.guildId,
    settings
  };

  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "mission-tools:panel_publish", payload);
}

function emitMissionUserUpdated(user: MissionToolsUserPanelDto) {
  const payload = {
    botId: user.botId,
    guildId: user.guildId,
    user
  };

  emitRealtime("mission-tools:user_updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(user.botId), "mission-tools:user_updated", payload);
}

function toSettingsDto(settings: MongoMissionToolsSettings): MissionToolsSettingsDto {
  const legacySettings = settings as Partial<MongoMissionToolsSettings>;

  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled === true,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    logChannelId: settings.logChannelId ?? null,
    managerRoleIds: normalizeSnowflakes(settings.managerRoleIds ?? []),
    allowedRoleIds: normalizeSnowflakes(settings.allowedRoleIds ?? []),
    enabledFeatures: normalizeFeatureIds(settings.enabledFeatures ?? FEATURE_IDS),
    lastPanelRequestedAt: legacySettings.lastPanelRequestedAt?.toISOString?.() ?? null,
    createdAt: settings.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: settings.updatedAt?.toISOString?.() ?? new Date().toISOString()
  };
}

function toUserDto(user: MongoMissionToolsUserPanel): MissionToolsUserPanelDto {
  const defaults = defaultMissionToolsUserPanel(user.botId, user.guildId, user.userId);

  return {
    ...defaults,
    id: user._id,
    botId: user.botId,
    guildId: user.guildId,
    userId: user.userId,
    username: user.username ?? null,
    dmChannelId: user.dmChannelId ?? null,
    clearMessageId: user.clearMessageId ?? null,
    missionMessageId: user.missionMessageId ?? null,
    voiceMessageId: user.voiceMessageId ?? null,
    richPresenceMessageId: user.richPresenceMessageId ?? null,
    usernameCheckerMessageId: user.usernameCheckerMessageId ?? null,
    tokenConfigured: user.tokenConfigured === true,
    clearStatus: normalizeStatus(user.clearStatus, defaults.clearStatus),
    clearMode: normalizeClearMode(user.clearMode, defaults.clearMode),
    clearTargetUserId: user.clearTargetUserId ?? null,
    missionStatus: normalizeStatus(user.missionStatus, defaults.missionStatus),
    voiceStatus: normalizeVoiceStatus(user.voiceStatus, defaults.voiceStatus),
    richPresenceStatus: normalizeRichStatus(user.richPresenceStatus, defaults.richPresenceStatus),
    usernameCheckerStatus: normalizeStatus(user.usernameCheckerStatus, defaults.usernameCheckerStatus),
    currentMission: user.currentMission ?? null,
    missionDetail: user.missionDetail ?? null,
    voiceGuildId: user.voiceGuildId ?? null,
    voiceGuildName: user.voiceGuildName ?? null,
    voiceChannelId: user.voiceChannelId ?? null,
    voiceChannelName: user.voiceChannelName ?? null,
    voiceConnectedAt: user.voiceConnectedAt ?? null,
    richPresenceConfig: normalizeRichPresenceConfig(user.richPresenceConfig ?? {}),
    richPresenceUpdatedAt: user.richPresenceUpdatedAt ?? null,
    usernameCheckerOptions: normalizeUsernameCheckerOptions(user.usernameCheckerOptions ?? {}),
    usernameCheckerStats: normalizeUsernameCheckerStats(user.usernameCheckerStats ?? DEFAULT_USERNAME_CHECKER_STATS),
    usernameCheckerLastEvent: user.usernameCheckerLastEvent ?? null,
    usernameCheckerUpdatedAt: user.usernameCheckerUpdatedAt ?? null,
    completedCount: normalizeCount(user.completedCount, 0),
    totalMissions: normalizeCount(user.totalMissions, 0),
    progress: normalizePercent(user.progress, 0),
    createdAt: user.createdAt?.toISOString?.() ?? defaults.createdAt,
    updatedAt: user.updatedAt?.toISOString?.() ?? defaults.updatedAt
  };
}

function toTokenDto(token: MongoMissionToolsToken) {
  return {
    token: decryptSecret(token.tokenEncrypted),
    tokenConfigured: true,
    tokenLast4: token.tokenLast4 ?? null,
    updatedAt: token.updatedAt.toISOString()
  };
}

function tokenLast4(token: string) {
  return token.trim().slice(-4) || null;
}

function createMissionError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
