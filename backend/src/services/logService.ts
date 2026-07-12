import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoLogEntry } from "../database/mongo";
import {
  devBotRealtimeRoom,
  emitRealtimeToRoom
} from "../realtime/events";
import { getGuildSettings, type LogCategory } from "./settingsService";

export type LogEntryDto = {
  id: string;
  botId: string;
  guildId: string;
  userId?: string | null;
  executorId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  module?: string | null;
  action?: string | null;
  caseId?: string | null;
  status?: string | null;
  transcriptId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateLogInput = {
  botId: string;
  guildId: string;
  userId?: string | null;
  executorId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  module?: string | null;
  action?: string | null;
  caseId?: string | null;
  status?: string | null;
  transcriptId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

export type CreateSystemLogInput = Omit<CreateLogInput, "type" | "message"> & {
  module: string;
  action: string;
  message?: string;
  type?: string;
  transcript?: {
    id?: string | null;
    enabled?: boolean;
    generateWebsite?: boolean;
    generateText?: boolean;
    passwordProtected?: boolean;
  };
};

const memoryLogs: LogEntryDto[] = [];

export async function createLog(input: CreateLogInput) {
  const botId = requireBotId(input.botId);
  const log: LogEntryDto = {
    id: randomUUID(),
    botId,
    guildId: input.guildId,
    userId: input.userId,
    executorId: input.executorId ?? null,
    channelId: input.channelId ?? null,
    logChannelId: input.logChannelId ?? null,
    module: input.module ?? moduleNameFromType(input.type),
    action: input.action ?? actionNameFromType(input.type),
    caseId: input.caseId ?? null,
    status: input.status ?? statusFromType(input.type),
    transcriptId: input.transcriptId ?? null,
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
      botId,
      guildId: input.guildId,
      userId: input.userId ?? null,
      executorId: input.executorId ?? null,
      channelId: input.channelId ?? null,
      logChannelId: input.logChannelId ?? null,
      module: input.module ?? moduleNameFromType(input.type),
      action: input.action ?? actionNameFromType(input.type),
      caseId: input.caseId ?? null,
      status: input.status ?? statusFromType(input.type),
      transcriptId: input.transcriptId ?? null,
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
      botId: requireBotId(doc.botId),
      userId: doc.userId,
      executorId: doc.executorId ?? null,
      channelId: doc.channelId ?? null,
      logChannelId: doc.logChannelId ?? null,
      module: doc.module ?? null,
      action: doc.action ?? null,
      caseId: doc.caseId ?? null,
      status: doc.status ?? null,
      transcriptId: doc.transcriptId ?? null,
      createdAt: doc.createdAt.toISOString()
    };

    dispatchDiscordLog(persistedLog);
    return persistedLog;
  } catch (error) {
    console.warn("[mongo] log mantido em memória:", error instanceof Error ? error.message : error);
    dispatchDiscordLog(log);
    return log;
  }
}

export async function listLogs(guildId: string, botId: string) {
  const normalizedBotId = requireBotId(botId);

  try {
    const { logEntries } = await getMongoCollections();
    const logs = await logEntries
      .find(scopedQuery(guildId, normalizedBotId))
      .sort({
        createdAt: -1
      })
      .limit(250)
      .toArray();

    const entries = logs.map((log) => ({
      id: log._id,
      botId: requireBotId(log.botId),
      guildId: log.guildId,
      userId: log.userId,
      executorId: log.executorId ?? null,
      channelId: log.channelId ?? null,
      logChannelId: log.logChannelId ?? null,
      module: log.module ?? null,
      action: log.action ?? null,
      caseId: log.caseId ?? null,
      status: log.status ?? null,
      transcriptId: log.transcriptId ?? null,
      type: log.type,
      message: log.message,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    }));

    return filterSiteLogs(entries, guildId, normalizedBotId);
  } catch {
    const entries = memoryLogs
      .filter((log) => log.guildId === guildId && log.botId === normalizedBotId)
      .slice(0, 250);

    return filterSiteLogs(entries, guildId, normalizedBotId);
  }
}

export async function createSystemLog(input: CreateSystemLogInput) {
  const type = input.type ?? `${slug(input.module)}.${slug(input.action)}`;
  const status = input.status ?? "info";
  const message = input.message ?? formatSystemLogMessage(input.module, input.action, status, input.caseId);
  const transcriptId = input.transcriptId ?? input.transcript?.id ?? null;

  return createLog({
    ...input,
    action: input.action,
    metadata: {
      ...(isRecord(input.metadata) ? input.metadata : { value: input.metadata }),
      transcript: input.transcript ?? null
    },
    message,
    module: input.module,
    status,
    transcriptId,
    type
  });
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

async function filterSiteLogs(entries: LogEntryDto[], guildId: string, botId: string) {
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
  emitRealtimeToRoom(devBotRealtimeRoom(log.botId), "logs:discord_dispatch", log);
}

function requireBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  if (!normalized) {
    throw new Error("botId obrigatorio para registrar ou consultar logs.");
  }

  return normalized;
}

function scopedQuery(guildId: string, botId: string) {
  return { botId, guildId };
}

function moduleNameFromType(type: string) {
  return type.split(".").at(0) || "system";
}

function actionNameFromType(type: string) {
  return type.split(".").slice(1).join(".") || type;
}

function statusFromType(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("error") || normalized.includes("failed") || normalized.includes("falha")) return "error";
  if (normalized.includes("denied") || normalized.includes("rejected")) return "denied";
  if (normalized.includes("warning") || normalized.includes("warn")) return "warning";
  if (normalized.includes("success") || normalized.includes("completed")) return "success";
  return "info";
}

function formatSystemLogMessage(moduleName: string, action: string, status: string, caseId?: string | null) {
  return `Log ${moduleName}/${action}${caseId ? ` caso ${caseId}` : ""} registrado com status ${status}.`;
}

function slug(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
