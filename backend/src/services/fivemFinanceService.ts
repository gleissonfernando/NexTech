import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemFinanceLog,
  type MongoFivemFinanceSettings,
  type MongoFivemFinanceTransaction,
  type MongoFivemFinanceTransactionStatus
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

export const FIVEM_FINANCE_MODULE_ID = "fivem-finance";

export type FivemFinanceSettingsDto = Omit<MongoFivemFinanceSettings, "_id" | "updatedAt"> & { panelImage: PanelImageSettingsDto | null; updatedAt: string | null };
export type FivemFinanceTransactionDto = Omit<MongoFivemFinanceTransaction, "_id" | "createdAt" | "updatedAt"> & { createdAt: string; id: string; updatedAt: string };
export type FivemFinanceLogDto = Omit<MongoFivemFinanceLog, "_id" | "createdAt"> & { createdAt: string; id: string };

export function defaultFivemFinanceSettings(guildId: string, botId: string | null = null): FivemFinanceSettingsDto {
  return {
    adminRoleIds: [],
    allowBalanceQuery: true,
    allowNegativeBalance: false,
    autoCloseMinutes: 10,
    bannerMode: "inside",
    botId,
    color: "#22c55e",
    enabled: false,
    footerImageUrl: null,
    footerText: "Financeiro da FAC registrado automaticamente.",
    guildId,
    logChannelId: null,
    panelChannelId: null,
    panelDescription: "Gerencie entradas e saidas de dinheiro da FAC de forma automatica, segura e organizada. Toda movimentacao exige comprovante por imagem e e registrada nas logs financeiras.",
    panelImage: null,
    panelMessageId: null,
    panelTitle: "Controle Financeiro da FAC",
    tempCategoryId: null,
    updatedAt: null,
    useRoleIds: []
  };
}

export async function getFivemFinanceDashboard(guildId: string, botId?: string | null) {
  const settings = await getFivemFinanceSettings(guildId, botId);
  const transactions = await listFivemFinanceTransactions(guildId, botId, 300);
  return { report: buildReport(transactions), settings, transactions };
}

export async function getFivemFinanceSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemFinanceSettings } = await getMongoCollections();
  const row = await fivemFinanceSettings.findOne(scopeQuery(guildId, normalizedBotId));
  return withPanelImage(row ? toSettingsDto(row) : defaultFivemFinanceSettings(guildId, normalizedBotId));
}

export async function saveFivemFinanceSettings(guildId: string, botId: string | null, input: Partial<FivemFinanceSettingsDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getFivemFinanceSettings(guildId, normalizedBotId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId });
  const now = new Date();
  const { fivemFinanceSettings } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemFinanceSettings.updateOne(scopeQuery(guildId, normalizedBotId), { $set: { ...next, updatedAt: now, updatedBy: actorId }, $setOnInsert: { _id: randomUUID() } }, { upsert: true });
  await writeLog({ action: current.updatedAt ? "settings.updated" : "settings.created", actorId, botId: normalizedBotId, data: { enabled: next.enabled }, guildId, transactionId: null });
  if (current.enabled !== next.enabled) await writeLog({ action: next.enabled ? "system.enabled" : "system.disabled", actorId, botId: normalizedBotId, data: {}, guildId, transactionId: null });
  emitUpdated(guildId, normalizedBotId);
  return getFivemFinanceSettings(guildId, normalizedBotId);
}

export async function requestFivemFinancePanelPublish(guildId: string, botId: string | null) {
  const settings = await getFivemFinanceSettings(guildId, botId);
  if (settings.botId) emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "fivem:finance:panel_publish", { botId: settings.botId, guildId });
  return settings;
}

export async function updateFivemFinancePanelState(guildId: string, botId: string | null, messageId: string | null) {
  return saveFivemFinanceSettings(guildId, botId, { panelMessageId: messageId }, null);
}

export async function listFivemFinanceTransactions(guildId: string, botId?: string | null, limit = 250) {
  const { fivemFinanceTransactions } = await getMongoCollections();
  const rows = await fivemFinanceTransactions.find(scopeQuery(guildId, normalizeBotId(botId))).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 1000)).toArray();
  return rows.map(toTransactionDto);
}

export async function createFivemFinanceTransaction(input: {
  amount: number;
  guildId: string;
  logChannelId?: string | null;
  logMessageId?: string | null;
  proofImageUrl: string;
  proofMessageId?: string | null;
  tempChannelId?: string | null;
  type: "add" | "remove";
  userAvatar?: string | null;
  userId: string;
  username: string;
}, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const settings = await getFivemFinanceSettings(input.guildId, normalizedBotId);
  if (!settings.enabled) throw financeError("Sistema financeiro desativado.", 409);
  const amount = money(input.amount);
  if (amount <= 0) throw financeError("Valor invalido.", 400);
  if (!normalizeUrl(input.proofImageUrl)) throw financeError("Comprovante por imagem e obrigatorio.", 400);
  const { fivemFinanceTransactions } = await getMongoCollections();
  if (input.tempChannelId && await fivemFinanceTransactions.findOne({ ...scopeQuery(input.guildId, normalizedBotId), tempChannelId: input.tempChannelId, status: { $ne: "cancelled" } })) throw financeError("Este canal ja possui movimentacao registrada.", 409);
  const currentBalance = await getBalance(input.guildId, normalizedBotId);
  const newBalance = money(input.type === "add" ? currentBalance + amount : currentBalance - amount);
  if (input.type === "remove" && !settings.allowNegativeBalance && newBalance < 0) throw financeError("Saldo insuficiente.", 409);
  const now = new Date();
  const doc: MongoFivemFinanceTransaction = {
    _id: randomUUID(),
    amount,
    botId: normalizedBotId,
    createdAt: now,
    guildId: input.guildId,
    logChannelId: normalizeSnowflake(input.logChannelId ?? settings.logChannelId),
    logMessageId: normalizeSnowflake(input.logMessageId),
    newBalance,
    notes: null,
    oldBalance: money(currentBalance),
    proofImageUrl: input.proofImageUrl.trim(),
    proofMessageId: normalizeSnowflake(input.proofMessageId),
    status: "completed",
    tempChannelId: normalizeSnowflake(input.tempChannelId),
    transactionId: `FIN-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
    type: input.type,
    updatedAt: now,
    userAvatar: normalizeUrl(input.userAvatar),
    userId: input.userId,
    username: normalizeText(input.username, 120) || input.userId
  };
  await fivemFinanceTransactions.insertOne(doc);
  await writeLog({ action: "transaction.created", actorId: input.userId, botId: normalizedBotId, data: { amount, newBalance, type: input.type }, guildId: input.guildId, transactionId: doc.transactionId });
  emitUpdated(input.guildId, normalizedBotId);
  return toTransactionDto(doc);
}

export async function updateFivemFinanceTransaction(guildId: string, botId: string | null, id: string, input: { amount?: number; notes?: string | null; status?: MongoFivemFinanceTransactionStatus }, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemFinanceTransactions } = await getMongoCollections();
  const current = await fivemFinanceTransactions.findOne({ _id: id, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  const amount = input.amount === undefined ? current.amount : money(input.amount);
  if (amount <= 0) throw financeError("Valor invalido.", 400);
  const delta = (current.type === "add" ? amount : -amount) - (current.type === "add" ? current.amount : -current.amount);
  const next = {
    amount,
    newBalance: money(current.newBalance + delta),
    notes: normalizeText(input.notes ?? current.notes, 1000),
    status: input.status ?? current.status,
    updatedAt: new Date()
  };
  await fivemFinanceTransactions.updateOne({ _id: id, ...scopeQuery(guildId, normalizedBotId) }, { $set: next });
  await writeLog({ action: "transaction.corrected", actorId, botId: normalizedBotId, data: { amount: { from: current.amount, to: amount }, status: { from: current.status, to: next.status } }, guildId, transactionId: current.transactionId });
  emitUpdated(guildId, normalizedBotId);
  return toTransactionDto({ ...current, ...next });
}

export async function updateFivemFinanceTransactionLog(guildId: string, botId: string | null, id: string, input: { logChannelId?: string | null; logMessageId?: string | null }) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemFinanceTransactions } = await getMongoCollections();
  const next = { logChannelId: normalizeSnowflake(input.logChannelId), logMessageId: normalizeSnowflake(input.logMessageId), updatedAt: new Date() };
  const row = await fivemFinanceTransactions.findOneAndUpdate({ _id: id, ...scopeQuery(guildId, normalizedBotId) }, { $set: next }, { returnDocument: "after" });
  return row ? toTransactionDto(row) : null;
}

async function getBalance(guildId: string, botId: string | null) {
  const transactions = await listFivemFinanceTransactions(guildId, botId, 1000);
  return transactions.filter((item) => item.status !== "cancelled").reduce((total, item) => total + (item.type === "add" ? item.amount : -item.amount), 0);
}

function buildReport(transactions: FivemFinanceTransactionDto[]) {
  const active = transactions.filter((item) => item.status !== "cancelled");
  const totalIn = active.filter((item) => item.type === "add").reduce((sum, item) => sum + item.amount, 0);
  const totalOut = active.filter((item) => item.type === "remove").reduce((sum, item) => sum + item.amount, 0);
  return {
    balance: money(totalIn - totalOut),
    lastUpdatedAt: transactions[0]?.updatedAt ?? null,
    topAdders: topUsers(active, "add"),
    topRemovers: topUsers(active, "remove"),
    totalIn: money(totalIn),
    totalOut: money(totalOut),
    transactions: active.length
  };
}

function topUsers(transactions: FivemFinanceTransactionDto[], type: "add" | "remove") {
  const map = new Map<string, { amount: number; count: number; userId: string; username: string }>();
  for (const item of transactions.filter((transaction) => transaction.type === type)) {
    const current = map.get(item.userId) ?? { amount: 0, count: 0, userId: item.userId, username: item.username };
    current.amount += item.amount; current.count += 1; map.set(item.userId, current);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 5).map((item) => ({ ...item, amount: money(item.amount) }));
}

function toSettingsDto(row: MongoFivemFinanceSettings): FivemFinanceSettingsDto { const { _id, updatedAt, ...rest } = row; return { ...rest, updatedAt: updatedAt?.toISOString() ?? null, panelImage: null }; }
function toTransactionDto(row: MongoFivemFinanceTransaction): FivemFinanceTransactionDto { const { _id, createdAt, updatedAt, ...rest } = row; return { ...rest, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() }; }
function normalizeSettings(value: Partial<FivemFinanceSettingsDto>): Omit<MongoFivemFinanceSettings, "_id" | "updatedAt"> { return { adminRoleIds: normalizeSnowflakes(value.adminRoleIds), allowBalanceQuery: value.allowBalanceQuery !== false, allowNegativeBalance: value.allowNegativeBalance === true, autoCloseMinutes: clamp(value.autoCloseMinutes, 1, 1440, 10), bannerMode: ["above", "inside", "below", "none"].includes(value.bannerMode ?? "") ? value.bannerMode as MongoFivemFinanceSettings["bannerMode"] : "inside", botId: normalizeBotId(value.botId), color: /^#[0-9a-f]{6}$/i.test(value.color ?? "") ? value.color! : "#22c55e", enabled: value.enabled === true, footerImageUrl: normalizeUrl(value.footerImageUrl), footerText: normalizeText(value.footerText, 200), guildId: value.guildId ?? "", logChannelId: normalizeSnowflake(value.logChannelId), panelChannelId: normalizeSnowflake(value.panelChannelId), panelDescription: normalizeText(value.panelDescription, 1500) || defaultFivemFinanceSettings(value.guildId ?? "", normalizeBotId(value.botId)).panelDescription, panelMessageId: normalizeSnowflake(value.panelMessageId), panelTitle: normalizeText(value.panelTitle, 120) || "Controle Financeiro da FAC", tempCategoryId: normalizeSnowflake(value.tempCategoryId), useRoleIds: normalizeSnowflakes(value.useRoleIds), updatedBy: value.updatedBy ?? null }; }
async function withPanelImage(settings: FivemFinanceSettingsDto) { if (!settings.botId) return settings; const image = await getPanelImageSettings(settings.guildId, settings.botId, "fivem-finance").catch(() => null); return { ...settings, panelImage: image?.imageEnabled ? image : null }; }
async function writeLog(input: Omit<MongoFivemFinanceLog, "_id" | "createdAt">) { const { fivemFinanceLogs } = await getMongoCollections(); await fivemFinanceLogs.insertOne({ _id: randomUUID(), createdAt: new Date(), ...input, botId: normalizeBotId(input.botId) }); }
function emitUpdated(guildId: string, botId: string | null) { emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:finance:updated", { botId, guildId }); }
function scopeQuery(guildId: string, botId: string | null) { return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] }; }
function normalizeBotId(value: string | null | undefined) { return value?.trim() || null; }
function normalizeSnowflake(value: string | null | undefined) { return /^\d{5,32}$/.test(value?.trim() ?? "") ? value!.trim() : null; }
function normalizeSnowflakes(values: string[] | undefined) { return [...new Set((values ?? []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))]; }
function normalizeText(value: string | null | undefined, max: number) { return value?.trim().slice(0, max) || null; }
function normalizeUrl(value: string | null | undefined) { const text = normalizeText(value, 2048); if (!text) return null; try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) ? text : null; } catch { return null; } }
function clamp(value: number | null | undefined, min: number, max: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function money(value: number) { return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100; }
function financeError(message: string, status = 400) { const error = new Error(message) as Error & { status?: number }; error.status = status; return error; }
