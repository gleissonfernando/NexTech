import { randomUUID } from "node:crypto";
import type { MongoBoosterHistory, MongoBoosterHistoryStatus, MongoBoosterSettings } from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export const BOOSTER_MODULE_ID = "boosters";

export type BoosterSettingsDto = Omit<MongoBoosterSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type BoosterHistoryDto = Omit<MongoBoosterHistory, "_id" | "createdAt"> & {
  id: string;
  createdAt: string;
};

export type BoosterDashboardDto = {
  history: BoosterHistoryDto[];
  settings: BoosterSettingsDto;
  stats: {
    activeBoosters: number;
    lastBooster: BoosterHistoryDto | null;
    month: number;
    today: number;
    topBooster: BoosterHistoryDto | null;
    total: number;
    week: number;
  };
};

export type SaveBoosterSettingsInput = Partial<{
  announcementChannelId: string | null;
  bannerEnabled: boolean;
  bannerUrl: string | null;
  benefitsMessage: string;
  boosterRoleId: string | null;
  embedColor: string;
  enabled: boolean;
  logChannelId: string | null;
  message: string;
  messageEnabled: boolean;
  showAvatar: boolean;
  showTimestamp: boolean;
}>;

export type ClaimBoosterEventInput = {
  avatarUrl?: string | null;
  boostCount: number;
  boostLevel: number;
  dedupeKey?: string | null;
  userId: string;
  username: string;
};

export type CompleteBoosterHistoryInput = {
  announcementChannelId?: string | null;
  bannerSent?: boolean;
  error?: string | null;
  logChannelId?: string | null;
  messageId?: string | null;
  messageSent?: boolean;
  roleGiven?: boolean;
  roleId?: string | null;
  status: MongoBoosterHistoryStatus;
};

const DEFAULT_MESSAGE = [
  "Obrigado {mencao}!",
  "",
  "Você acabou de fortalecer o servidor **{servidor}**.",
  "Agora somos **{boosts} boosts** no nível **{nivel}**.",
  "",
  "Agradecemos demais pelo apoio."
].join("\n");

const DEFAULT_BENEFITS = [
  "Obrigado por impulsionar nosso servidor!",
  "",
  "Você desbloqueou:",
  "- Cargo Booster",
  "- Área exclusiva",
  "- Benefícios VIP",
  "- Sorteios exclusivos"
].join("\n");

export async function getBoosterDashboard(botId: string, guildId: string): Promise<BoosterDashboardDto> {
  const { boosterHistory } = await getMongoCollections();
  const settings = await ensureBoosterSettings(botId, guildId, null);
  const history = await boosterHistory.find({ botId, guildId }).sort({ createdAt: -1 }).limit(200).toArray();

  return {
    history: history.map(toHistoryDto),
    settings: toSettingsDto(settings),
    stats: buildStats(history)
  };
}

export async function getBoosterRuntime(botId: string, guildId: string) {
  const settings = await ensureBoosterSettings(botId, guildId, null);
  return { settings: toSettingsDto(settings) };
}

export async function saveBoosterSettings(botId: string, guildId: string, input: SaveBoosterSettingsInput, actorId: string) {
  const current = await ensureBoosterSettings(botId, guildId, actorId);
  const now = new Date();
  const patch: Partial<MongoBoosterSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };

  for (const key of ["enabled", "bannerEnabled", "messageEnabled", "showAvatar", "showTimestamp"] as const) {
    if (input[key] !== undefined) patch[key] = Boolean(input[key]);
  }

  if (input.boosterRoleId !== undefined) patch.boosterRoleId = normalizeSnowflake(input.boosterRoleId);
  if (input.announcementChannelId !== undefined) patch.announcementChannelId = normalizeSnowflake(input.announcementChannelId);
  if (input.logChannelId !== undefined) patch.logChannelId = normalizeSnowflake(input.logChannelId);
  if (input.bannerUrl !== undefined) patch.bannerUrl = normalizeImageUrl(input.bannerUrl);
  if (input.embedColor !== undefined) patch.embedColor = normalizeColor(input.embedColor, current.embedColor);
  if (input.message !== undefined) patch.message = normalizeLongText(input.message, 1800, DEFAULT_MESSAGE);
  if (input.benefitsMessage !== undefined) patch.benefitsMessage = normalizeLongText(input.benefitsMessage, 1800, DEFAULT_BENEFITS);

  const { boosterSettings } = await getMongoCollections();
  await boosterSettings.updateOne({ botId, guildId }, { $set: patch });
  const saved = await boosterSettings.findOne({ botId, guildId });
  const settings = toSettingsDto(saved ?? { ...current, ...patch });

  emitBoosterUpdated(botId, guildId, "booster:settings_updated", { botId, guildId, settings });
  await createLog({
    action: "settings_updated",
    botId,
    guildId,
    module: BOOSTER_MODULE_ID,
    type: "booster.settings_updated",
    userId: actorId,
    message: "Configurações do Sistema Booster atualizadas.",
    metadata: { settings }
  });

  return settings;
}

export async function claimBoosterEvent(botId: string, guildId: string, input: ClaimBoosterEventInput) {
  const { boosterHistory } = await getMongoCollections();
  const now = new Date();
  const dedupeKey = normalizeDedupeKey(input.dedupeKey, input.userId, input.boostCount);
  const doc: MongoBoosterHistory = {
    _id: randomUUID(),
    announcementChannelId: null,
    avatarUrl: normalizeNullableText(input.avatarUrl, 2048),
    bannerSent: false,
    boostCount: Math.max(0, Math.trunc(input.boostCount || 0)),
    boostLevel: Math.max(0, Math.trunc(input.boostLevel || 0)),
    botId,
    createdAt: now,
    dedupeKey,
    error: null,
    guildId,
    logChannelId: null,
    messageId: null,
    messageSent: false,
    roleGiven: false,
    roleId: null,
    status: "skipped",
    userId: input.userId,
    username: normalizeLongText(input.username, 100, `Usuário ${input.userId}`)
  };

  try {
    await boosterHistory.insertOne(doc);
    await writeBoosterLog(botId, guildId, doc._id, input.userId, null, "claim_created", "Evento de boost reservado para processamento.", { dedupeKey });
    return { claimed: true, history: toHistoryDto(doc) };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existing = await boosterHistory.findOne({ botId, guildId, dedupeKey });
    return { claimed: false, history: existing ? toHistoryDto(existing) : null };
  }
}

export async function completeBoosterHistory(botId: string, guildId: string, historyId: string, input: CompleteBoosterHistoryInput) {
  const { boosterHistory } = await getMongoCollections();
  const patch: Partial<MongoBoosterHistory> = {
    announcementChannelId: normalizeSnowflake(input.announcementChannelId),
    bannerSent: Boolean(input.bannerSent),
    error: normalizeNullableText(input.error, 1000),
    logChannelId: normalizeSnowflake(input.logChannelId),
    messageId: normalizeSnowflake(input.messageId),
    messageSent: Boolean(input.messageSent),
    roleGiven: Boolean(input.roleGiven),
    roleId: normalizeSnowflake(input.roleId),
    status: input.status
  };

  await boosterHistory.updateOne({ _id: historyId, botId, guildId }, { $set: patch });
  const updated = await boosterHistory.findOne({ _id: historyId, botId, guildId });
  if (!updated) throw Object.assign(new Error("Histórico de boost não encontrado."), { statusCode: 404 });
  const dto = toHistoryDto(updated);

  emitBoosterUpdated(botId, guildId, "booster:history_updated", { botId, guildId, history: dto });
  await writeBoosterLog(botId, guildId, historyId, updated.userId, updated.announcementChannelId, "history_completed", "Processamento do boost finalizado.", { status: updated.status, error: updated.error });
  await createLog({
    action: "boost_processed",
    botId,
    guildId,
    module: BOOSTER_MODULE_ID,
    status: updated.status,
    type: "booster.boost_processed",
    userId: updated.userId,
    channelId: updated.announcementChannelId,
    message: `Boost de ${updated.username} processado com status ${updated.status}.`,
    metadata: dto
  });

  return dto;
}

export async function writeBoosterLog(botId: string, guildId: string, historyId: string | null, userId: string | null, channelId: string | null, type: string, message: string, metadata?: unknown) {
  const { boosterLogs } = await getMongoCollections();
  const log = {
    _id: randomUUID(),
    botId,
    channelId,
    createdAt: new Date(),
    guildId,
    historyId,
    message,
    metadata,
    type,
    userId
  };
  await boosterLogs.insertOne(log);
  emitBoosterUpdated(botId, guildId, "booster:log_created", { ...log, id: log._id, createdAt: log.createdAt.toISOString() });
}

export async function ensureBoosterSettings(botId: string, guildId: string, actorId: string | null) {
  const { boosterSettings } = await getMongoCollections();
  const existing = await boosterSettings.findOne({ botId, guildId });
  if (existing) return normalizeSettings(existing);

  const now = new Date();
  const settings: MongoBoosterSettings = {
    _id: randomUUID(),
    announcementChannelId: null,
    bannerEnabled: true,
    bannerUrl: null,
    benefitsMessage: DEFAULT_BENEFITS,
    boosterRoleId: null,
    botId,
    createdAt: now,
    embedColor: "#FFD500",
    enabled: false,
    guildId,
    logChannelId: null,
    message: DEFAULT_MESSAGE,
    messageEnabled: true,
    showAvatar: true,
    showTimestamp: true,
    updatedAt: now,
    updatedBy: actorId
  };

  await boosterSettings.insertOne(settings);
  return settings;
}

function buildStats(history: MongoBoosterHistory[]): BoosterDashboardDto["stats"] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const processed = history.filter((item) => item.status === "processed");
  const topBooster = processed.reduce<MongoBoosterHistory | null>((best, item) => (!best || item.boostCount > best.boostCount ? item : best), null);

  return {
    activeBoosters: new Set(processed.map((item) => item.userId)).size,
    lastBooster: processed[0] ? toHistoryDto(processed[0]) : null,
    month: processed.filter((item) => item.createdAt >= monthStart).length,
    today: processed.filter((item) => item.createdAt >= todayStart).length,
    topBooster: topBooster ? toHistoryDto(topBooster) : null,
    total: processed.length,
    week: processed.filter((item) => item.createdAt >= weekStart).length
  };
}

function normalizeSettings(settings: MongoBoosterSettings): MongoBoosterSettings {
  return {
    ...settings,
    benefitsMessage: settings.benefitsMessage || DEFAULT_BENEFITS,
    embedColor: normalizeColor(settings.embedColor, "#FFD500"),
    message: settings.message || DEFAULT_MESSAGE
  };
}

function toSettingsDto(settings: MongoBoosterSettings): BoosterSettingsDto {
  return {
    ...normalizeSettings(settings),
    id: settings._id,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toHistoryDto(history: MongoBoosterHistory): BoosterHistoryDto {
  return {
    ...history,
    id: history._id,
    createdAt: history.createdAt.toISOString()
  };
}

function emitBoosterUpdated(botId: string, guildId: string, event: string, payload: unknown) {
  emitRealtimeToRoom(devBotRealtimeRoom(botId), event, payload);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), event, payload);
}

function normalizeDedupeKey(value: string | null | undefined, userId: string, boostCount: number) {
  const normalized = typeof value === "string" ? value.trim().slice(0, 180) : "";
  return normalized || `${userId}:${Math.max(0, Math.trunc(boostCount || 0))}`;
}

function normalizeSnowflake(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeColor(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function normalizeImageUrl(value: unknown) {
  const normalized = normalizeNullableText(value, 2048);
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("/api/persistent-images/") || normalized.startsWith("/uploads/")) return normalized;
  return null;
}

function normalizeNullableText(value: unknown, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return normalized || null;
}

function normalizeLongText(value: unknown, maxLength: number, fallback: string) {
  const normalized = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return normalized || fallback;
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}
