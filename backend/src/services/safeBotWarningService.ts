import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoSafeBotWarningAction,
  type MongoSafeBotWarningLevel,
  type MongoSafeBotWarningRecord,
  type MongoSafeBotWarningSettings
} from "../database/mongo";

export const SAFE_BOT_WARNING_ACTIONS: MongoSafeBotWarningAction[] = [
  "record_only", "dm", "channel_message", "add_role", "remove_role", "timeout",
  "kick", "ban", "notify_staff", "open_ticket", "block_channels", "custom"
];

export type SafeBotWarningLevel = MongoSafeBotWarningLevel;
export type SafeBotWarningSettings = Omit<MongoSafeBotWarningSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export function defaultSafeBotWarningSettings(botId: string, guildId: string): SafeBotWarningSettings {
  const now = new Date().toISOString();
  return {
    id: "",
    botId,
    guildId,
    enabled: false,
    authorizedRoleIds: [],
    defaultLogChannelId: null,
    overflowMode: "record_only",
    finalLevel: null,
    levels: [],
    createdBy: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now
  };
}

export async function getSafeBotWarningSettings(guildId: string, botId: string) {
  const { safeBotWarningSettings } = await getMongoCollections();
  const settings = await safeBotWarningSettings.findOne({ botId, guildId });
  return settings ? toSettingsDto(settings) : defaultSafeBotWarningSettings(botId, guildId);
}

export async function saveSafeBotWarningSettings(
  guildId: string,
  botId: string,
  input: Partial<Pick<SafeBotWarningSettings, "enabled" | "authorizedRoleIds" | "defaultLogChannelId" | "overflowMode" | "finalLevel" | "levels">>,
  actorId: string
) {
  const { safeBotWarningSettings } = await getMongoCollections();
  const current = await getSafeBotWarningSettings(guildId, botId);
  const now = new Date();
  const levels = input.levels === undefined ? current.levels : normalizeLevels(input.levels);
  await safeBotWarningSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        botId,
        guildId,
        enabled: input.enabled ?? current.enabled,
        authorizedRoleIds: normalizeIds(input.authorizedRoleIds ?? current.authorizedRoleIds),
        defaultLogChannelId: normalizeOptionalId(input.defaultLogChannelId, current.defaultLogChannelId),
        overflowMode: normalizeOverflowMode(input.overflowMode ?? current.overflowMode),
        finalLevel: input.finalLevel === undefined ? current.finalLevel : input.finalLevel ? normalizeLevel(input.finalLevel, 1) : null,
        levels,
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
  return getSafeBotWarningSettings(guildId, botId);
}

export async function getSafeBotWarningPreview(guildId: string, botId: string, userId: string) {
  const { safeBotWarningUsers } = await getMongoCollections();
  const [settings, user] = await Promise.all([
    getSafeBotWarningSettings(guildId, botId),
    safeBotWarningUsers.findOne({ botId, guildId, userId })
  ]);
  const currentWarnings = user?.totalWarnings ?? 0;
  const nextWarningNumber = currentWarnings + 1;
  const resolution = resolveLevel(settings, nextWarningNumber);
  return {
    enabled: settings.enabled,
    configuredLevels: settings.levels.length,
    authorizedRoleIds: settings.authorizedRoleIds,
    currentWarnings,
    nextWarningNumber,
    level: resolution.level,
    blocked: resolution.blocked,
    action: resolution.level?.action ?? "record_only",
    note: resolution.note
  };
}

export async function issueSafeBotWarning(input: {
  botId: string;
  guildId: string;
  userId: string;
  username?: string | null;
  staffId: string;
  staffName?: string | null;
  reason?: string | null;
}) {
  const { safeBotWarningRecords, safeBotWarningUsers } = await getMongoCollections();
  const settings = await getSafeBotWarningSettings(input.guildId, input.botId);
  if (!settings.enabled) throw warningError("The Safe Bot warning system is disabled.", 409);
  if (!settings.levels.length) throw warningError("No warning levels are configured.", 409);

  const now = new Date();
  const user = await safeBotWarningUsers.findOneAndUpdate(
    { botId: input.botId, guildId: input.guildId, userId: input.userId },
    {
      $inc: { totalWarnings: 1 },
      $set: { username: input.username ?? null, updatedAt: now },
      $setOnInsert: { _id: randomUUID(), botId: input.botId, guildId: input.guildId, userId: input.userId, internalNote: "", createdAt: now }
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!user) throw warningError("The warning counter could not be updated.", 500);

  const resolution = resolveLevel(settings, user.totalWarnings);
  if (resolution.blocked) {
    await safeBotWarningUsers.updateOne({ _id: user._id }, { $inc: { totalWarnings: -1 }, $set: { updatedAt: new Date() } });
    throw warningError("New warnings are blocked after the last configured level.", 409);
  }

  const level = resolution.level;
  const reason = cleanText(input.reason, 500) || level?.defaultReason || "No reason provided.";
  const configuredAction = level?.enabled === true ? level.action : null;
  const validationError = validateLevelExecution(level, settings.defaultLogChannelId);
  const record: MongoSafeBotWarningRecord = {
    _id: randomUUID(),
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    username: input.username ?? null,
    staffId: input.staffId,
    staffName: input.staffName ?? null,
    reason,
    warningNumber: user.totalWarnings,
    level: level ?? null,
    configuredAction,
    executedAction: null,
    status: configuredAction && configuredAction !== "record_only" && !validationError ? "pending" : validationError ? "failed" : "recorded",
    error: validationError,
    removedBy: null,
    removedAt: null,
    createdAt: now,
    updatedAt: now
  };
  try {
    await safeBotWarningRecords.insertOne(record);
  } catch (error) {
    await safeBotWarningUsers.updateOne({ _id: user._id }, { $inc: { totalWarnings: -1 }, $set: { updatedAt: new Date() } });
    throw error;
  }
  return toRecordDto(record);
}

export async function completeSafeBotWarning(
  botId: string,
  guildId: string,
  warningId: string,
  input: { success: boolean; executedAction?: string | null; error?: string | null }
) {
  const { safeBotWarningRecords } = await getMongoCollections();
  await safeBotWarningRecords.updateOne(
    { _id: warningId, botId, guildId, status: "pending" },
    { $set: { executedAction: cleanText(input.executedAction, 500), error: cleanText(input.error, 500), status: input.success ? "success" : "failed", updatedAt: new Date() } }
  );
  const record = await safeBotWarningRecords.findOne({ _id: warningId, botId, guildId });
  if (!record) throw warningError("Warning not found.", 404);
  return toRecordDto(record);
}

export async function getSafeBotWarningDashboard(guildId: string, botId: string) {
  const { safeBotWarningRecords, safeBotWarningUsers } = await getMongoCollections();
  const [settings, users, warnings] = await Promise.all([
    getSafeBotWarningSettings(guildId, botId),
    safeBotWarningUsers.find({ botId, guildId }).sort({ totalWarnings: -1, updatedAt: -1 }).limit(100).toArray(),
    safeBotWarningRecords.find({ botId, guildId }).sort({ createdAt: -1 }).limit(250).toArray()
  ]);
  return {
    settings,
    users: users.map((user) => ({ ...user, id: user._id, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() })),
    warnings: warnings.map(toRecordDto)
  };
}

export async function getSafeBotWarningUserHistory(guildId: string, botId: string, userId: string) {
  const { safeBotWarningRecords, safeBotWarningUsers } = await getMongoCollections();
  const [user, warnings] = await Promise.all([
    safeBotWarningUsers.findOne({ botId, guildId, userId }),
    safeBotWarningRecords.find({ botId, guildId, userId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);
  return {
    totalWarnings: user?.totalWarnings ?? 0,
    internalNote: user?.internalNote ?? "",
    warnings: warnings.map(toRecordDto)
  };
}

export async function setSafeBotWarningUserNote(guildId: string, botId: string, userId: string, note: string) {
  const { safeBotWarningUsers } = await getMongoCollections();
  const now = new Date();
  await safeBotWarningUsers.updateOne(
    { botId, guildId, userId },
    { $set: { internalNote: cleanText(note, 2000) ?? "", updatedAt: now }, $setOnInsert: { _id: randomUUID(), botId, guildId, userId, username: null, totalWarnings: 0, createdAt: now } },
    { upsert: true }
  );
}

export async function removeSafeBotWarning(guildId: string, botId: string, warningId: string, actorId: string) {
  const { safeBotWarningRecords, safeBotWarningUsers } = await getMongoCollections();
  const record = await safeBotWarningRecords.findOneAndUpdate(
    { _id: warningId, botId, guildId, status: { $ne: "removed" } },
    { $set: { status: "removed", removedBy: actorId, removedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "before" }
  );
  if (!record) throw warningError("Warning not found.", 404);
  await safeBotWarningUsers.updateOne(
    { botId, guildId, userId: record.userId },
    [{ $set: { totalWarnings: { $max: [0, { $subtract: ["$totalWarnings", 1] }] }, updatedAt: new Date() } }]
  );
}

export async function resetSafeBotWarnings(guildId: string, botId: string, userId: string, actorId: string) {
  const { safeBotWarningRecords, safeBotWarningUsers } = await getMongoCollections();
  const now = new Date();
  await Promise.all([
    safeBotWarningUsers.updateOne({ botId, guildId, userId }, { $set: { totalWarnings: 0, updatedAt: now } }),
    safeBotWarningRecords.updateMany({ botId, guildId, userId, status: { $ne: "removed" } }, { $set: { status: "removed", removedBy: actorId, removedAt: now, updatedAt: now } })
  ]);
}

function resolveLevel(settings: SafeBotWarningSettings, warningNumber: number) {
  const exact = settings.levels.find((level) => level.number === warningNumber && level.enabled);
  if (exact) return { level: exact, blocked: false, note: null };
  const enabled = settings.levels.filter((level) => level.enabled).sort((a, b) => a.number - b.number);
  const last = enabled.at(-1);
  if (!last || warningNumber <= last.number) return { level: null, blocked: false, note: "No enabled configuration exists for this warning number; it will only be recorded." };
  if (settings.overflowMode === "block") return { level: null, blocked: true, note: "Warnings are blocked after the last configured level." };
  if (settings.overflowMode === "repeat_last") return { level: last, blocked: false, note: "The last configured level will be repeated." };
  if (settings.overflowMode === "final_action") return { level: settings.finalLevel?.enabled ? settings.finalLevel : null, blocked: false, note: settings.finalLevel?.enabled ? "The configured final action will be used." : "No final action is enabled; the warning will only be recorded." };
  return { level: null, blocked: false, note: "The warning exceeds the configured levels and will only be recorded." };
}

function validateLevelExecution(level: SafeBotWarningLevel | null, defaultLogChannelId: string | null) {
  if (!level?.enabled || !level.action || level.action === "record_only") return null;
  if (!(level.logChannelId || defaultLogChannelId)) return "No warning log channel is configured; no automatic action was executed.";
  if ((level.action === "dm") && !level.userMessage) return "The private user message is not configured.";
  if (level.action === "channel_message" && !level.userMessage) return "The channel message is not configured.";
  if (["notify_staff", "open_ticket"].includes(level.action) && !level.staffMessage) return "The staff message is not configured.";
  if (["channel_message", "notify_staff", "open_ticket", "custom"].includes(level.action) && !level.channelId) return "The action channel is not configured.";
  if (["add_role", "remove_role"].includes(level.action) && !level.roleId) return "The action role is not configured.";
  if (level.action === "timeout" && (!level.durationSeconds || level.durationSeconds < 5)) return "The timeout duration is invalid or missing.";
  if (level.action === "block_channels" && !level.targetChannelIds.length) return "No channels are configured to be blocked.";
  if (level.action === "custom" && !level.customAction) return "The custom punishment description is not configured.";
  return null;
}

function normalizeLevels(levels: SafeBotWarningLevel[]) {
  const seen = new Set<number>();
  return levels.slice(0, 50)
    .map((level, index) => normalizeLevel(level, index + 1))
    .sort((a, b) => a.number - b.number)
    .filter((level) => seen.has(level.number) ? false : (seen.add(level.number), true));
}

function normalizeLevel(level: SafeBotWarningLevel, fallbackNumber: number): SafeBotWarningLevel {
  const action = level.action && SAFE_BOT_WARNING_ACTIONS.includes(level.action) ? level.action : null;
  return {
    id: cleanText(level.id, 80) || randomUUID(),
    number: Math.max(1, Math.min(1000, Number(level.number) || fallbackNumber)),
    name: cleanText(level.name, 120) || `Warning ${fallbackNumber}`,
    description: cleanText(level.description, 500) || "",
    defaultReason: cleanText(level.defaultReason, 500) || "",
    action,
    durationSeconds: level.durationSeconds ? Math.max(5, Math.min(2_419_200, Number(level.durationSeconds))) : null,
    roleId: normalizeOptionalId(level.roleId, null),
    channelId: normalizeOptionalId(level.channelId, null),
    targetChannelIds: normalizeIds(level.targetChannelIds ?? []),
    logChannelId: normalizeOptionalId(level.logChannelId, null),
    userMessage: cleanText(level.userMessage, 1000) || "",
    staffMessage: cleanText(level.staffMessage, 1000) || "",
    customAction: cleanText(level.customAction, 500) || "",
    enabled: level.enabled === true
  };
}

function toSettingsDto(settings: MongoSafeBotWarningSettings): SafeBotWarningSettings {
  return { ...settings, id: settings._id, levels: normalizeLevels(settings.levels ?? []), finalLevel: settings.finalLevel ? normalizeLevel(settings.finalLevel, 1) : null, createdAt: settings.createdAt.toISOString(), updatedAt: settings.updatedAt.toISOString() };
}

function toRecordDto(record: MongoSafeBotWarningRecord) {
  return { ...record, id: record._id, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), removedAt: record.removedAt?.toISOString() ?? null };
}

function normalizeIds(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))]; }
function normalizeOptionalId(value: unknown, fallback: string | null) { return value === undefined ? fallback : typeof value === "string" && /^\d{5,32}$/.test(value.trim()) ? value.trim() : null; }
function normalizeOverflowMode(value: unknown): SafeBotWarningSettings["overflowMode"] { return ["repeat_last", "record_only", "block", "final_action"].includes(String(value)) ? value as SafeBotWarningSettings["overflowMode"] : "record_only"; }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) || null : null; }
function warningError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
