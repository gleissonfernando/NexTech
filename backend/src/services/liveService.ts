import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoLiveDetectionSettings } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";

export type LiveEventDto = {
  id: string;
  botId: string | null;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  userId?: string | null;
  title?: string;
  url?: string;
  roleId?: string | null;
  roleApplied?: boolean;
  roleRemoved?: boolean;
  durationMs?: number | null;
  error?: string | null;
  createdAt: string;
};

export type LiveDetectionSettingsDto = {
  botId: string | null;
  guildId: string;
  enabled: boolean;
  liveRoleId: string | null;
  logChannelId: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type SaveLiveDetectionSettingsInput = {
  enabled?: boolean;
  liveRoleId?: string | null;
  logChannelId?: string | null;
};

const liveEvents: LiveEventDto[] = [];

export function createLiveEvent(input: Omit<LiveEventDto, "id" | "createdAt">) {
  const event: LiveEventDto = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
    botId: normalizeBotId(input.botId)
  };

  liveEvents.unshift(event);
  return event;
}

export function listLiveEvents(guildId?: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  return liveEvents
    .filter((event) => (!guildId || event.guildId === guildId) && event.botId === normalizedBotId)
    .slice(0, 50);
}

export async function getLiveDetectionSettings(botId: string | null | undefined, guildId: string) {
  const normalizedBotId = normalizeBotId(botId);
  const { liveDetectionSettings } = await getMongoCollections();
  const document = await liveDetectionSettings.findOne({ botId: normalizedBotId, guildId });

  if (document) {
    return toLiveDetectionSettingsDto(document);
  }

  const now = new Date().toISOString();

  return {
    botId: normalizedBotId,
    guildId,
    enabled: false,
    liveRoleId: null,
    logChannelId: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null
  } satisfies LiveDetectionSettingsDto;
}

export async function saveLiveDetectionSettings(
  botId: string | null | undefined,
  guildId: string,
  input: SaveLiveDetectionSettingsInput,
  updatedBy: string | null | undefined
) {
  const normalizedBotId = normalizeBotId(botId);
  const { liveDetectionSettings } = await getMongoCollections();
  const now = new Date();

  await liveDetectionSettings.updateOne(
    { botId: normalizedBotId, guildId },
    {
      $set: {
        enabled: Boolean(input.enabled),
        liveRoleId: normalizeOptionalId(input.liveRoleId),
        logChannelId: normalizeOptionalId(input.logChannelId),
        updatedAt: now,
        updatedBy: normalizeOptionalId(updatedBy)
      },
      $setOnInsert: {
        botId: normalizedBotId,
        guildId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  const settings = await getLiveDetectionSettings(normalizedBotId, guildId);
  emitLiveDetectionSettingsUpdated(settings);
  return settings;
}

export async function removeLiveDetectionSettings(botId: string | null | undefined, guildId: string, updatedBy?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { liveDetectionSettings } = await getMongoCollections();
  await liveDetectionSettings.deleteOne({ botId: normalizedBotId, guildId });

  const settings = await getLiveDetectionSettings(normalizedBotId, guildId);
  emitLiveDetectionSettingsUpdated({ ...settings, updatedBy: normalizeOptionalId(updatedBy) });
  return settings;
}

export function emitLiveDetectionSettingsUpdated(settings: LiveDetectionSettingsDto) {
  emitRealtime("live-detection:settings_updated", settings);

  if (settings.botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "live-detection:settings_updated", settings);
  }
}

function toLiveDetectionSettingsDto(document: MongoLiveDetectionSettings): LiveDetectionSettingsDto {
  return {
    botId: normalizeBotId(document.botId),
    guildId: document.guildId,
    enabled: Boolean(document.enabled),
    liveRoleId: document.liveRoleId ?? null,
    logChannelId: document.logChannelId ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    updatedBy: document.updatedBy ?? null
  };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
