import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoLogEntry } from "../database/mongo";
import {
  botRealtimeRoom,
  devBotRealtimeRoom,
  emitRealtimeToRoom
} from "../realtime/events";
import { getGuildSettings, type LogCategory } from "./settingsService";

export type LogEntryDto = {
  id: string;
  botId: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateLogInput = {
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

const memoryLogs: LogEntryDto[] = [];

export async function createLog(input: CreateLogInput) {
  const log: LogEntryDto = {
    id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    userId: input.userId,
    type: input.type,
    message: input.message,
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };

  memoryLogs.unshift(log);

  try {
    await ensureGuild(input.guildId);

    const { logEntries } = await getMongoCollections();
    const doc: MongoLogEntry = {
      _id: randomUUID(),
      botId: normalizeBotId(input.botId),
      guildId: input.guildId,
      userId: input.userId ?? null,
      type: input.type,
      message: input.message,
      createdAt: new Date()
    };

    if (input.metadata !== undefined) {
      doc.metadata = input.metadata;
    }

    await logEntries.insertOne(doc);

    const persistedLog = {
      ...log,
      id: doc._id,
      botId: normalizeBotId(doc.botId),
      userId: doc.userId,
      createdAt: doc.createdAt.toISOString()
    };

    dispatchDiscordLog(persistedLog);
    return persistedLog;
  } catch (error) {
    console.warn("[mongo] log mantido em memoria:", error instanceof Error ? error.message : error);
    dispatchDiscordLog(log);
    return log;
  }
}

export async function listLogs(guildId?: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { logEntries } = await getMongoCollections();
    const logs = await logEntries
      .find(scopedQuery(guildId, normalizedBotId))
      .sort({
        createdAt: -1
      })
      .limit(guildId ? 250 : 50)
      .toArray();

    const entries = logs.map((log) => ({
      id: log._id,
      botId: normalizeBotId(log.botId),
      guildId: log.guildId,
      userId: log.userId,
      type: log.type,
      message: log.message,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    }));

    return filterSiteLogs(entries, guildId, normalizedBotId);
  } catch {
    const entries = memoryLogs
      .filter((log) => (!guildId || log.guildId === guildId) && log.botId === normalizedBotId)
      .slice(0, guildId ? 250 : 50);

    return filterSiteLogs(entries, guildId, normalizedBotId);
  }
}

export function logCategoryForType(type: string): LogCategory {
  const normalized = type.trim().toLowerCase();

  if (normalized.startsWith("member.")) return "members";
  if (normalized.startsWith("message.")) return "messages";
  if (normalized.startsWith("roles.")) return "roles";
  if (
    normalized.startsWith("moderation.")
    || normalized.startsWith("security.")
    || normalized.startsWith("image_anti_spam.")
    || normalized.startsWith("self_bot_protection.")
  ) {
    return "moderation";
  }
  if (
    normalized.startsWith("dashboard.")
    || normalized.startsWith("audit.")
    || normalized.startsWith("access.")
  ) {
    return "dashboard";
  }

  return "automation";
}

async function filterSiteLogs(entries: LogEntryDto[], guildId: string | undefined, botId: string | null) {
  if (!guildId) {
    return entries.slice(0, 50);
  }

  const settings = await getGuildSettings(guildId, botId).catch(() => null);

  if (!settings?.siteLogsEnabled) {
    return [];
  }

  const allowedCategories = new Set(settings.siteLogCategories);
  return entries
    .filter((entry) => allowedCategories.has(logCategoryForType(entry.type)))
    .slice(0, 50);
}

function dispatchDiscordLog(log: LogEntryDto) {
  const room = log.botId ? devBotRealtimeRoom(log.botId) : botRealtimeRoom();
  emitRealtimeToRoom(room, "logs:discord_dispatch", log);
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function scopedQuery(guildId: string | undefined, botId: string | null) {
  const botScope = botId
    ? { botId }
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

  return guildId ? { guildId, ...botScope } : botScope;
}
