import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoGlobalBlacklistEntry, type MongoGlobalBlacklistHistory, type MongoGlobalBlacklistSafeBotSettings } from "../database/mongo";

export type GlobalBlacklistSafeBotSettingsDto = {
  autoBlacklistOnSafeBotBan: boolean;
  botId: string | null;
  directActions: string[];
  enabledSafeBotModules: string[];
  guildId: string;
  infractionLimit: number;
  kickMode: "history_only" | "alert" | "blacklist";
  logChannelId: string | null;
  requireApprovalAfterRemoval: boolean;
  updatedAt: string | null;
};

export type GlobalBlacklistEntryDto = {
  active: boolean;
  addedAt: string;
  addedBy: string | null;
  addedByType: "safebot" | "staff";
  botId: string | null;
  evidence: Record<string, unknown>;
  guildId: string;
  id: string;
  reason: string;
  removedAt: string | null;
  removedBy: string | null;
  removedReason: string | null;
  requiresApprovalAfterRemoval: boolean;
  safeBotModule: string | null;
  updatedAt: string;
  userId: string;
};

export type GlobalBlacklistHistoryDto = {
  action: MongoGlobalBlacklistHistory["action"];
  actorId: string | null;
  botId: string | null;
  createdAt: string;
  evidence: Record<string, unknown>;
  guildId: string;
  id: string;
  infractionType: string;
  reason: string;
  safeBotModule: string | null;
  userId: string;
};

const DEFAULT_SAFE_BOT_MODULES = ["safe-bot", "anti-abuse", "anti-bot", "anti-fake", "anti-link", "anti-spam", "anti-flood", "anti-raid", "anti-role", "anti-ban", "anti-kick", "anti-channel-delete", "anti-role-delete", "anti-permissions"];
const DEFAULT_DIRECT_ACTIONS = ["ban", "admin_abuse", "anti_raid", "permission_bypass", "role_delete", "channel_delete"];

export function defaultGlobalBlacklistSettings(guildId: string, botId: string | null = null): GlobalBlacklistSafeBotSettingsDto {
  return {
    autoBlacklistOnSafeBotBan: true,
    botId,
    directActions: [...DEFAULT_DIRECT_ACTIONS],
    enabledSafeBotModules: [...DEFAULT_SAFE_BOT_MODULES],
    guildId,
    infractionLimit: 3,
    kickMode: "alert",
    logChannelId: null,
    requireApprovalAfterRemoval: true,
    updatedAt: null
  };
}

export async function getGlobalBlacklistDashboard(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { globalBlacklistEntries, globalBlacklistHistory } = await getMongoCollections();
  const [settings, entries, history] = await Promise.all([
    getGlobalBlacklistSettings(guildId, normalizedBotId),
    globalBlacklistEntries.find(scopeQuery(guildId, normalizedBotId)).sort({ updatedAt: -1 }).limit(200).toArray(),
    globalBlacklistHistory.find(scopeQuery(guildId, normalizedBotId)).sort({ createdAt: -1 }).limit(250).toArray()
  ]);
  return { settings, entries: entries.map(toEntryDto), history: history.map(toHistoryDto) };
}

export async function getGlobalBlacklistSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { globalBlacklistSettings } = await getMongoCollections();
  const settings = await globalBlacklistSettings.findOne(scopeQuery(guildId, normalizedBotId));
  return settings ? toSettingsDto(settings) : defaultGlobalBlacklistSettings(guildId, normalizedBotId);
}

export async function saveGlobalBlacklistSettings(guildId: string, botId: string | null, input: Partial<GlobalBlacklistSafeBotSettingsDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getGlobalBlacklistSettings(guildId, normalizedBotId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId });
  const now = new Date();
  const { globalBlacklistSettings } = await getMongoCollections();
  await globalBlacklistSettings.updateOne(
    scopeQuery(guildId, normalizedBotId),
    { $set: { ...next, updatedAt: now, updatedBy: actorId }, $setOnInsert: { _id: randomUUID() } },
    { upsert: true }
  );
  return getGlobalBlacklistSettings(guildId, normalizedBotId);
}

export async function recordSafeBotInfraction(input: {
  actionTaken?: string | null;
  actorId?: string | null;
  botId?: string | null;
  evidence?: Record<string, unknown>;
  guildId: string;
  infractionType: string;
  reason: string;
  safeBotModule?: string | null;
  userId: string;
}) {
  const botId = normalizeBotId(input.botId);
  const settings = await getGlobalBlacklistSettings(input.guildId, botId);
  const safeBotModule = input.safeBotModule || "safe-bot";
  const actionTaken = normalizeText(input.actionTaken, 80) ?? "record_only";
  const reason = normalizeText(input.reason, 1000) ?? "Infração detectada pelo SafeBot.";
  const evidence = input.evidence ?? {};

  if (!settings.enabledSafeBotModules.includes(safeBotModule)) {
    return { blacklisted: false, reason: "module_not_enabled" };
  }

  await insertHistory({
    action: "infraction",
    actorId: input.actorId ?? null,
    botId,
    evidence: { ...evidence, actionTaken },
    guildId: input.guildId,
    infractionType: input.infractionType,
    reason,
    safeBotModule,
    userId: input.userId
  });

  const shouldBlacklist = await shouldBlacklistFromSafeBot(input.guildId, botId, input.userId, settings, actionTaken, input.infractionType);

  if (!shouldBlacklist) {
    return { blacklisted: false, reason: "history_only" };
  }

  await addGlobalBlacklistEntry({
    addedBy: input.actorId ?? null,
    addedByType: "safebot",
    botId,
    evidence: { ...evidence, actionTaken },
    guildId: input.guildId,
    reason,
    safeBotModule,
    userId: input.userId
  });
  return { blacklisted: true, reason: "safebot_rule" };
}

export async function addGlobalBlacklistEntry(input: {
  addedBy: string | null;
  addedByType: "safebot" | "staff";
  botId?: string | null;
  evidence?: Record<string, unknown>;
  guildId: string;
  reason: string;
  safeBotModule?: string | null;
  userId: string;
}) {
  const botId = normalizeBotId(input.botId);
  const settings = await getGlobalBlacklistSettings(input.guildId, botId);
  const now = new Date();
  const doc: MongoGlobalBlacklistEntry = {
    _id: randomUUID(),
    active: true,
    addedAt: now,
    addedBy: input.addedBy,
    addedByType: input.addedByType,
    botId,
    evidence: input.evidence ?? {},
    guildId: input.guildId,
    reason: normalizeText(input.reason, 1000) ?? "Blacklist Global",
    removedAt: null,
    removedBy: null,
    removedReason: null,
    requiresApprovalAfterRemoval: settings.requireApprovalAfterRemoval,
    safeBotModule: input.safeBotModule ?? null,
    updatedAt: now,
    userId: input.userId
  };
  const { globalBlacklistEntries } = await getMongoCollections();
  await globalBlacklistEntries.updateMany({ userId: input.userId, active: true }, { $set: { active: false, removedAt: now, removedReason: "substituido por novo registro", updatedAt: now } });
  await globalBlacklistEntries.insertOne(doc);
  await insertHistory({ action: "blacklisted", actorId: input.addedBy, botId, evidence: input.evidence ?? {}, guildId: input.guildId, infractionType: "blacklist", reason: doc.reason, safeBotModule: doc.safeBotModule, userId: input.userId });
  return toEntryDto(doc);
}

export async function removeGlobalBlacklistEntry(guildId: string, botId: string | null, userId: string, actorId: string, reason: string) {
  const now = new Date();
  const { globalBlacklistEntries } = await getMongoCollections();
  const saved = await globalBlacklistEntries.findOneAndUpdate(
    { userId, active: true },
    { $set: { active: false, removedAt: now, removedBy: actorId, removedReason: normalizeText(reason, 1000), updatedAt: now } },
    { returnDocument: "after" }
  );
  await insertHistory({ action: "removed", actorId, botId: normalizeBotId(botId), evidence: {}, guildId, infractionType: "manual_remove", reason: normalizeText(reason, 1000) ?? "Removido manualmente", safeBotModule: null, userId });
  if (!saved) throw Object.assign(new Error("Usuario nao esta ativo na Blacklist Global."), { statusCode: 404 });
  return toEntryDto(saved);
}

async function shouldBlacklistFromSafeBot(guildId: string, botId: string | null, userId: string, settings: GlobalBlacklistSafeBotSettingsDto, actionTaken: string, infractionType: string) {
  if (settings.autoBlacklistOnSafeBotBan && actionTaken.toLowerCase().includes("ban")) return true;
  if (settings.kickMode === "blacklist" && actionTaken.toLowerCase().includes("kick")) return true;
  if (settings.directActions.includes(infractionType) || settings.directActions.includes(actionTaken)) return true;
  const { globalBlacklistHistory } = await getMongoCollections();
  const count = await globalBlacklistHistory.countDocuments({ ...scopeQuery(guildId, botId), userId, action: "infraction" });
  return count >= settings.infractionLimit;
}

async function insertHistory(input: Omit<MongoGlobalBlacklistHistory, "_id" | "createdAt">) {
  const { globalBlacklistHistory } = await getMongoCollections();
  await globalBlacklistHistory.insertOne({ ...input, _id: randomUUID(), createdAt: new Date() });
}

function normalizeSettings(settings: GlobalBlacklistSafeBotSettingsDto): GlobalBlacklistSafeBotSettingsDto {
  return {
    ...settings,
    directActions: normalizeList(settings.directActions).length ? normalizeList(settings.directActions) : [...DEFAULT_DIRECT_ACTIONS],
    enabledSafeBotModules: normalizeList(settings.enabledSafeBotModules).length ? normalizeList(settings.enabledSafeBotModules) : [...DEFAULT_SAFE_BOT_MODULES],
    infractionLimit: Math.max(1, Math.min(100, Math.trunc(settings.infractionLimit || 3))),
    kickMode: ["history_only", "alert", "blacklist"].includes(settings.kickMode) ? settings.kickMode : "alert",
    logChannelId: normalizeSnowflake(settings.logChannelId)
  };
}

function toSettingsDto(settings: MongoGlobalBlacklistSafeBotSettings): GlobalBlacklistSafeBotSettingsDto {
  return normalizeSettings({ ...settings, botId: normalizeBotId(settings.botId), updatedAt: settings.updatedAt?.toISOString() ?? null });
}

function toEntryDto(entry: MongoGlobalBlacklistEntry): GlobalBlacklistEntryDto {
  return { ...entry, id: entry._id, botId: normalizeBotId(entry.botId), addedAt: entry.addedAt.toISOString(), removedAt: entry.removedAt?.toISOString() ?? null, removedBy: entry.removedBy ?? null, removedReason: entry.removedReason ?? null, requiresApprovalAfterRemoval: entry.requiresApprovalAfterRemoval === true, updatedAt: entry.updatedAt.toISOString() };
}

function toHistoryDto(history: MongoGlobalBlacklistHistory): GlobalBlacklistHistoryDto {
  return { ...history, id: history._id, botId: normalizeBotId(history.botId), createdAt: history.createdAt.toISOString() };
}

function scopeQuery(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function normalizeList(values: string[]) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 100))];
}
