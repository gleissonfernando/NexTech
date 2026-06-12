import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import {
  ensureGuild,
  getMongoCollections,
  type MongoImageAntiSpamIncident,
  type MongoImageAntiSpamSettings,
  type MongoImageAntiSpamUser
} from "../database/mongo";

export type ImageAntiSpamSettingsDto = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  immuneRoleIds: string[];
  ignoredChannelIds: string[];
  maxImages: number;
  windowSeconds: number;
  warningsEnabled: boolean;
  progressiveTimeoutEnabled: boolean;
  autoKickEnabled: boolean;
  maxWarnings: number;
  ignoreAdministrators: boolean;
  warningResetDays: number;
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamUserDto = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  warningCount: number;
  totalImagesRemoved: number;
  lastInfractionAt: string | null;
  lastPunishment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamIncidentDto = {
  id: string;
  botId: string;
  guildId: string;
  incidentKey: string;
  userId: string;
  username: string | null;
  channelId: string;
  removedImages: number;
  warningCount: number;
  timeoutMs: number;
  action: MongoImageAntiSpamIncident["action"];
  actionSucceeded: boolean | null;
  actionError: string | null;
  reason: string;
  status: MongoImageAntiSpamIncident["status"];
  createdAt: string;
  updatedAt: string;
};

export type SaveImageAntiSpamSettingsInput = Partial<Pick<
  ImageAntiSpamSettingsDto,
  | "enabled"
  | "logChannelId"
  | "immuneRoleIds"
  | "ignoredChannelIds"
  | "maxImages"
  | "windowSeconds"
  | "warningsEnabled"
  | "progressiveTimeoutEnabled"
  | "autoKickEnabled"
  | "maxWarnings"
  | "ignoreAdministrators"
  | "warningResetDays"
>>;

export type RecordImageAntiSpamIncidentInput = {
  botId: string;
  guildId: string;
  incidentKey: string;
  userId: string;
  username?: string | null;
  channelId: string;
  removedImages: number;
};

export type RecordImageAntiSpamIncidentResult = {
  duplicate: boolean;
  incident: ImageAntiSpamIncidentDto;
  settings: ImageAntiSpamSettingsDto;
  user: ImageAntiSpamUserDto;
};

const KICK_REASON = "Spam de imagens recorrente ap\u00f3s atingir o limite m\u00e1ximo de advert\u00eancias.";
const INCIDENT_REASON = "Spam de imagens detectado acima do limite configurado.";

export function defaultImageAntiSpamSettings(guildId: string, botId: string): ImageAntiSpamSettingsDto {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    logChannelId: null,
    immuneRoleIds: [],
    ignoredChannelIds: [],
    maxImages: 1,
    windowSeconds: 10,
    warningsEnabled: true,
    progressiveTimeoutEnabled: true,
    autoKickEnabled: true,
    maxWarnings: 5,
    ignoreAdministrators: true,
    warningResetDays: 30,
    createdAt: now,
    updatedAt: now
  };
}

export async function getImageAntiSpamDashboard(guildId: string, botId: string) {
  const { imageAntiSpamIncidents, imageAntiSpamUsers } = await getMongoCollections();
  const [settings, users, incidents] = await Promise.all([
    getImageAntiSpamSettings(guildId, botId),
    imageAntiSpamUsers
      .find({ botId, guildId })
      .sort({ warningCount: -1, lastInfractionAt: -1 })
      .limit(25)
      .toArray(),
    imageAntiSpamIncidents
      .find({ botId, guildId })
      .sort({ createdAt: -1 })
      .limit(25)
      .toArray()
  ]);

  return {
    settings,
    users: users.map(toUserDto),
    incidents: incidents.map(toIncidentDto)
  };
}

export async function getImageAntiSpamSettings(guildId: string, botId: string) {
  const { imageAntiSpamSettings } = await getMongoCollections();
  const settings = await imageAntiSpamSettings.findOne({ botId, guildId });

  return settings ? toSettingsDto(settings) : defaultImageAntiSpamSettings(guildId, botId);
}

export async function saveImageAntiSpamSettings(
  guildId: string,
  botId: string,
  input: SaveImageAntiSpamSettingsInput,
  actorId: string | null
) {
  const current = await getImageAntiSpamSettings(guildId, botId);
  const now = new Date();
  const next = normalizeSettings({
    ...current,
    ...input,
    botId,
    guildId
  });

  await ensureGuild(guildId);
  const { imageAntiSpamSettings } = await getMongoCollections();
  await imageAntiSpamSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        botId,
        guildId,
        enabled: next.enabled,
        logChannelId: next.logChannelId,
        immuneRoleIds: next.immuneRoleIds,
        ignoredChannelIds: next.ignoredChannelIds,
        maxImages: next.maxImages,
        windowSeconds: next.windowSeconds,
        warningsEnabled: next.warningsEnabled,
        progressiveTimeoutEnabled: next.progressiveTimeoutEnabled,
        autoKickEnabled: next.autoKickEnabled,
        maxWarnings: next.maxWarnings,
        ignoreAdministrators: next.ignoreAdministrators,
        warningResetDays: next.warningResetDays,
        updatedBy: actorId,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdBy: actorId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  return getImageAntiSpamSettings(guildId, botId);
}

export async function recordImageAntiSpamIncident(
  input: RecordImageAntiSpamIncidentInput
): Promise<RecordImageAntiSpamIncidentResult> {
  const settings = await getImageAntiSpamSettings(input.guildId, input.botId);

  if (!settings.enabled) {
    throw createServiceError("O Anti-Spam de Imagens esta desativado para este servidor.", 409);
  }

  const { imageAntiSpamIncidents, imageAntiSpamUsers } = await getMongoCollections();
  const now = new Date();
  const incidentId = randomUUID();
  const baseIncident: MongoImageAntiSpamIncident = {
    _id: incidentId,
    botId: input.botId,
    guildId: input.guildId,
    incidentKey: input.incidentKey,
    userId: input.userId,
    username: normalizeText(input.username),
    channelId: input.channelId,
    removedImages: input.removedImages,
    warningCount: 0,
    timeoutMs: 0,
    action: "none",
    actionSucceeded: null,
    actionError: null,
    reason: INCIDENT_REASON,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

  try {
    await imageAntiSpamIncidents.insertOne(baseIncident);
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000) {
      throw error;
    }

    const duplicate = await imageAntiSpamIncidents.findOneAndUpdate(
      {
        botId: input.botId,
        guildId: input.guildId,
        incidentKey: input.incidentKey
      },
      {
        $inc: {
          removedImages: input.removedImages
        },
        $set: {
          channelId: input.channelId,
          username: normalizeText(input.username),
          updatedAt: now
        }
      },
      {
        returnDocument: "after"
      }
    );
    const { user } = await getOrCreateImageAntiSpamUser(input, settings, false);

    if (!duplicate) {
      throw createServiceError("Nao foi possivel recuperar o incidente de Anti-Spam.", 500);
    }

    await imageAntiSpamUsers.updateOne(
      {
        botId: input.botId,
        guildId: input.guildId,
        userId: input.userId
      },
      {
        $inc: {
          totalImagesRemoved: input.removedImages
        },
        $set: {
          lastInfractionAt: now,
          updatedAt: now,
          username: normalizeText(input.username)
        }
      }
    );

    return {
      duplicate: true,
      incident: toIncidentDto(duplicate),
      settings,
      user: {
        ...user,
        totalImagesRemoved: user.totalImagesRemoved + input.removedImages,
        lastInfractionAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    };
  }

  const { shouldKick, user } = await getOrCreateImageAntiSpamUser(input, settings, true);
  const action = resolvePunishment(settings, user.warningCount, shouldKick);
  const reason = action.action === "kick" ? KICK_REASON : INCIDENT_REASON;

  await imageAntiSpamIncidents.updateOne(
    { _id: incidentId },
    {
      $set: {
        action: action.action,
        reason,
        timeoutMs: action.timeoutMs,
        warningCount: user.warningCount,
        updatedAt: now
      }
    }
  );

  return {
    duplicate: false,
    incident: toIncidentDto({
      ...baseIncident,
      action: action.action,
      reason,
      timeoutMs: action.timeoutMs,
      warningCount: user.warningCount
    }),
    settings,
    user
  };
}

export async function completeImageAntiSpamIncident(
  incidentId: string,
  botId: string,
  input: {
    actionSucceeded: boolean;
    actionError?: string | null;
  }
) {
  const { imageAntiSpamIncidents, imageAntiSpamUsers } = await getMongoCollections();
  const incident = await imageAntiSpamIncidents.findOneAndUpdate(
    {
      _id: incidentId,
      botId
    },
    {
      $set: {
        actionSucceeded: input.actionSucceeded,
        actionError: normalizeText(input.actionError),
        status: input.actionSucceeded ? "completed" : "failed",
        updatedAt: new Date()
      }
    },
    {
      returnDocument: "after"
    }
  );

  if (!incident) {
    throw createServiceError("Incidente de Anti-Spam nao encontrado.", 404);
  }

  await imageAntiSpamUsers.updateOne(
    {
      botId: incident.botId,
      guildId: incident.guildId,
      userId: incident.userId
    },
    {
      $set: {
        lastPunishment: input.actionSucceeded ? incident.action : `${incident.action}:failed`,
        updatedAt: new Date()
      }
    }
  );

  return toIncidentDto(incident);
}

async function getOrCreateImageAntiSpamUser(
  input: RecordImageAntiSpamIncidentInput,
  settings: ImageAntiSpamSettingsDto,
  newIncident: boolean
) {
  const { imageAntiSpamUsers } = await getMongoCollections();
  const now = new Date();
  const current = await imageAntiSpamUsers.findOne({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId
  });
  const warningsExpired = Boolean(
    current?.lastInfractionAt
    && now.getTime() - current.lastInfractionAt.getTime() >= settings.warningResetDays * 86_400_000
  );
  const previousWarnings = warningsExpired ? 0 : current?.warningCount ?? 0;
  const shouldKick = settings.warningsEnabled
    && settings.autoKickEnabled
    && previousWarnings >= settings.maxWarnings;
  const warningCount = newIncident && settings.warningsEnabled && !shouldKick
    ? Math.min(settings.maxWarnings, previousWarnings + 1)
    : previousWarnings;
  const totalImagesRemoved = (current?.totalImagesRemoved ?? 0) + (newIncident ? input.removedImages : 0);
  const createdAt = current?.createdAt ?? now;
  const doc: MongoImageAntiSpamUser = {
    _id: current?._id ?? randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    username: normalizeText(input.username),
    warningCount,
    totalImagesRemoved,
    lastInfractionAt: now,
    lastPunishment: current?.lastPunishment ?? null,
    createdAt,
    updatedAt: now
  };

  await imageAntiSpamUsers.updateOne(
    {
      botId: input.botId,
      guildId: input.guildId,
      userId: input.userId
    },
    {
      $set: {
        username: doc.username,
        warningCount: doc.warningCount,
        totalImagesRemoved: doc.totalImagesRemoved,
        lastInfractionAt: doc.lastInfractionAt,
        updatedAt: now
      },
      $setOnInsert: {
        _id: doc._id,
        botId: doc.botId,
        guildId: doc.guildId,
        userId: doc.userId,
        lastPunishment: null,
        createdAt
      }
    },
    { upsert: true }
  );

  return {
    shouldKick,
    user: toUserDto(doc)
  };
}

function resolvePunishment(
  settings: ImageAntiSpamSettingsDto,
  warningCount: number,
  shouldKick: boolean
) {
  if (!settings.warningsEnabled) {
    return {
      action: "none" as const,
      timeoutMs: 0
    };
  }

  if (shouldKick) {
    return {
      action: "kick" as const,
      timeoutMs: 0
    };
  }

  const timeoutMs = settings.progressiveTimeoutEnabled ? timeoutForWarning(warningCount) : 0;

  return {
    action: timeoutMs > 0 ? "timeout" as const : "warning" as const,
    timeoutMs
  };
}

function timeoutForWarning(warningCount: number) {
  if (warningCount <= 1) return 0;
  if (warningCount === 2) return 60_000;
  if (warningCount === 3) return 5 * 60_000;
  if (warningCount === 4) return 15 * 60_000;
  return 60 * 60_000;
}

function normalizeSettings(settings: ImageAntiSpamSettingsDto): ImageAntiSpamSettingsDto {
  return {
    ...settings,
    logChannelId: normalizeSnowflake(settings.logChannelId),
    immuneRoleIds: normalizeSnowflakes(settings.immuneRoleIds),
    ignoredChannelIds: normalizeSnowflakes(settings.ignoredChannelIds),
    maxImages: clampInteger(settings.maxImages, 1, 20, 1),
    windowSeconds: clampInteger(settings.windowSeconds, 1, 3_600, 10),
    maxWarnings: clampInteger(settings.maxWarnings, 1, 20, 5),
    warningResetDays: clampInteger(settings.warningResetDays, 1, 3_650, 30)
  };
}

function toSettingsDto(settings: MongoImageAntiSpamSettings): ImageAntiSpamSettingsDto {
  return normalizeSettings({
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    enabled: settings.enabled,
    logChannelId: settings.logChannelId,
    immuneRoleIds: settings.immuneRoleIds ?? [],
    ignoredChannelIds: settings.ignoredChannelIds ?? [],
    maxImages: settings.maxImages,
    windowSeconds: settings.windowSeconds,
    warningsEnabled: settings.warningsEnabled,
    progressiveTimeoutEnabled: settings.progressiveTimeoutEnabled,
    autoKickEnabled: settings.autoKickEnabled,
    maxWarnings: settings.maxWarnings,
    ignoreAdministrators: settings.ignoreAdministrators,
    warningResetDays: settings.warningResetDays,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  });
}

function toUserDto(user: MongoImageAntiSpamUser): ImageAntiSpamUserDto {
  return {
    id: user._id,
    botId: user.botId,
    guildId: user.guildId,
    userId: user.userId,
    username: user.username,
    warningCount: user.warningCount,
    totalImagesRemoved: user.totalImagesRemoved,
    lastInfractionAt: user.lastInfractionAt?.toISOString() ?? null,
    lastPunishment: user.lastPunishment,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function toIncidentDto(incident: MongoImageAntiSpamIncident): ImageAntiSpamIncidentDto {
  return {
    id: incident._id,
    botId: incident.botId,
    guildId: incident.guildId,
    incidentKey: incident.incidentKey,
    userId: incident.userId,
    username: incident.username,
    channelId: incident.channelId,
    removedImages: incident.removedImages,
    warningCount: incident.warningCount,
    timeoutMs: incident.timeoutMs,
    action: incident.action,
    actionSucceeded: incident.actionSucceeded,
    actionError: incident.actionError,
    reason: incident.reason,
    status: incident.status,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString()
  };
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))];
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 500) : null;
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function createServiceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
