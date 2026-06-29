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
  type MongoMissionToolsTokenStatus,
  type MongoMissionToolsUserPanel,
  type MongoMissionToolsUsernameCheckerOptions,
  type MongoMissionToolsUsernameCheckerStats,
  type MongoMissionToolsVoiceStatus
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

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
  tokenStatus: MongoMissionToolsTokenStatus;
  tokenLast4: string | null;
  tokenUpdatedAt: string | null;
  tokenLastValidatedAt: string | null;
  tokenInvalidReason: string | null;
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
    tokenStatus: "disconnected",
    tokenLast4: null,
    tokenUpdatedAt: null,
    tokenLastValidatedAt: null,
    tokenInvalidReason: null,
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
  const { missionToolsTokens, missionToolsUsers } = await getMongoCollections();
  const [settings, users] = await Promise.all([
    getMissionToolsSettings(guildId, botId),
    missionToolsUsers
      .find({ botId, guildId })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray()
  ]);
  const userIds = users.map((user) => user.userId);
  const tokens = userIds.length
    ? await missionToolsTokens.find({ botId, guildId, userId: { $in: userIds } }).toArray()
    : [];
  const tokensByUserId = new Map(tokens.map((token) => [token.userId, token]));
  const userDtos = users.map((user) => toUserDto(user, tokensByUserId.get(user.userId)));

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
    message: "Mission Tools updated.",
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
    message: "Mission Tools panel publication requested.",
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
  const { missionToolsTokens, missionToolsUsers } = await getMongoCollections();
  const [user, token] = await Promise.all([
    missionToolsUsers.findOne({ botId, guildId, userId }),
    missionToolsTokens.findOne({ botId, guildId, userId })
  ]);

  return user ? toUserDto(user, token ?? undefined) : defaultMissionToolsUserPanel(botId, guildId, userId);
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

export async function classifyMissionToolsTokenAsFake(
  guildId: string,
  botId: string,
  userId: string,
  username?: string | null
) {
  const { missionToolsTokens } = await getMongoCollections();

  // Token-shaped input is deliberately never retained. Removing a legacy record also
  // guarantees that older encrypted user tokens cannot be returned to a bot runtime.
  await missionToolsTokens.deleteOne({ botId, guildId, userId });
  const user = await saveMissionToolsUserPanel(guildId, botId, userId, {
    tokenConfigured: false,
    voiceStatus: "disconnected",
    richPresenceStatus: "inactive",
    ...(username !== undefined ? { username } : {})
  });
  const fakeUser = {
    ...user,
    tokenConfigured: false,
    tokenStatus: "fake" as const,
    tokenLast4: null,
    tokenUpdatedAt: null,
    tokenLastValidatedAt: null,
    tokenInvalidReason: "Fake token detected. Discord user-account tokens are never stored or executed."
  };

  await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.fake_token_detected",
    userId,
    message: "Mission Tools identified token-shaped input as a fake token.",
    metadata: {
      action: "fake_token_detected",
      module: MODULE_ID,
      tokenStatus: "fake"
    }
  });

  return {
    accepted: false,
    fake: true,
    tokenConfigured: false,
    tokenLast4: null,
    tokenStatus: "fake" satisfies MongoMissionToolsTokenStatus,
    user: fakeUser
  };
}

export async function deleteMissionToolsToken(guildId: string, botId: string, userId: string) {
  const { missionToolsTokens } = await getMongoCollections();

  await missionToolsTokens.deleteOne({ botId, guildId, userId });
  const user = await saveMissionToolsUserPanel(guildId, botId, userId, {
    tokenConfigured: false,
    voiceStatus: "disconnected",
    richPresenceStatus: "inactive"
  });
  await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.token_deleted",
    userId,
    message: "Mission Tools token state disconnected.",
    metadata: {
      action: "token_deleted",
      module: MODULE_ID,
      tokenStatus: "disconnected"
    }
  });

  return {
    tokenConfigured: false,
    tokenLast4: null,
    tokenStatus: "disconnected" satisfies MongoMissionToolsTokenStatus,
    user
  };
}

export type MissionToolsTokenAuthFailureInput = {
  reason?: string | null;
  source?: string | null;
  statusCode?: number | null;
};

export async function markMissionToolsTokenAuthFailure(
  guildId: string,
  botId: string,
  userId: string,
  input: MissionToolsTokenAuthFailureInput
) {
  const { missionToolsTokens } = await getMongoCollections();
  const now = new Date();
  const tokenStatus = tokenStatusFromAuthFailure(input.statusCode ?? null, input.reason ?? null);
  const invalidReason = sanitizeAuthFailureReason(input.reason) ?? tokenStatusReason(tokenStatus);
  const update = await missionToolsTokens.updateOne(
    {
      botId,
      guildId,
      userId
    },
    {
      $inc: {
        authFailureCount: 1
      },
      $set: {
        invalidReason,
        lastAuthFailureAt: now,
        statusUpdatedAt: now,
        tokenStatus,
        updatedAt: now
      }
    }
  );
  const user = await saveMissionToolsUserPanel(guildId, botId, userId, {
    currentMission: "Fake token detected",
    missionDetail: "Discord user-account token classified as fake and blocked for safety.",
    missionStatus: "error",
    richPresenceStatus: "inactive",
    voiceStatus: "disconnected"
  });

  await createMissionLog({
    botId,
    guildId,
    type: "mission_tools.token_auth_failed",
    userId,
    message: "Mission Tools token authentication failed.",
    metadata: {
      action: "token_auth_failed",
      module: MODULE_ID,
      reason: invalidReason,
      source: normalizePlainText(input.source, 80) ?? "runtime",
      statusCode: input.statusCode ?? null,
      tokenFound: update.matchedCount > 0,
      tokenStatus
    }
  });

  return {
    tokenStatus,
    user
  };
}

function missionToolsStats(users: MissionToolsUserPanelDto[]): MissionToolsStatsDto {
  return {
    activeRichPresence: users.filter((user) => user.richPresenceStatus === "active").length,
    activeVoiceSessions: users.filter((user) => user.voiceStatus === "connected" || user.voiceStatus === "reconnecting").length,
    configuredUsers: users.length,
    runningCleanups: users.filter((user) => user.clearStatus === "running" || user.clearStatus === "waiting").length,
    runningMissions: users.filter((user) => user.missionStatus === "running" || user.missionStatus === "waiting").length,
    usernameHits: users.reduce((total, user) => total + user.usernameCheckerStats.hits, 0),
    usersWithToken: users.filter((user) => user.tokenStatus === "connected").length
  };
}

function validateSettingsReady(settings: MissionToolsSettingsDto) {
  if (!settings.enabled) {
    throw createMissionError("Mission Tools is not enabled in the dashboard.", 403);
  }

  if (!settings.panelChannelId) {
    throw createMissionError("Configure the panel channel before using Mission Tools.", 400);
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

  throw createMissionError("One of the supplied IDs is invalid.", 400);
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => normalizeNullableSnowflake(value, null)).filter((value): value is string => Boolean(value)))];
}

async function createMissionLog(input: Parameters<typeof createLog>[0]) {
  return createLog(input).catch((error) => {
    console.warn("[mission-tools] log entry could not be recorded:", error instanceof Error ? error.message : error);
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

function toUserDto(user: MongoMissionToolsUserPanel, token?: MongoMissionToolsToken): MissionToolsUserPanelDto {
  const defaults = defaultMissionToolsUserPanel(user.botId, user.guildId, user.userId);
  const tokenStatus: MongoMissionToolsTokenStatus = token ? "fake" : "disconnected";

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
    tokenConfigured: false,
    tokenStatus,
    tokenLast4: null,
    tokenUpdatedAt: null,
    tokenLastValidatedAt: null,
    tokenInvalidReason: token ? "Legacy token data was classified as fake and is unavailable to the runtime." : null,
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

const TOKEN_STATUS_IDS: MongoMissionToolsTokenStatus[] = ["connected", "invalid", "expired", "disconnected", "fake"];

function normalizeTokenStatus(
  value: MongoMissionToolsTokenStatus | undefined,
  fallback: MongoMissionToolsTokenStatus
): MongoMissionToolsTokenStatus {
  return value && TOKEN_STATUS_IDS.includes(value) ? value : fallback;
}

function tokenStatusFromAuthFailure(statusCode: number | null, reason: string | null): MongoMissionToolsTokenStatus {
  void statusCode;
  void reason;
  return "fake";
}

function tokenStatusReason(status: MongoMissionToolsTokenStatus) {
  if (status === "expired") {
    return "Token expired or revoked. Discord user-account tokens are classified as fake and blocked for safety.";
  }

  if (status === "invalid") {
    return "Token rejected by Discord. Discord user-account tokens are classified as fake and blocked for safety.";
  }

  if (status === "fake") {
    return "Fake token detected. Discord user-account tokens are never stored or executed.";
  }

  return "Token disconnected.";
}

function sanitizeAuthFailureReason(value: unknown) {
  const normalized = normalizePlainText(value, 240);
  if (!normalized) {
    return null;
  }

  return normalized.replace(/[A-Za-z0-9._-]{10,}/g, "[masked-token]");
}

function createMissionError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
