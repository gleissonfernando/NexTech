import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText } from "../config/systemEmojis";
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
const transactionQueues = new Map<string, Promise<unknown>>();
const DEFAULT_FACTION_ID = "default";
const DEFAULT_FACTION_NAME = "Caixa da Facção";

export type FivemFinanceSettingsDto = Omit<MongoFivemFinanceSettings, "_id" | "updatedAt"> & { panelImage: PanelImageSettingsDto | null; updatedAt: string | null };
export type FivemFinanceTransactionDto = Omit<MongoFivemFinanceTransaction, "_id" | "createdAt" | "updatedAt"> & { createdAt: string; id: string; updatedAt: string };
export type FivemFinanceLogDto = Omit<MongoFivemFinanceLog, "_id" | "createdAt"> & { createdAt: string; id: string };

export function defaultFivemFinanceSettings(guildId: string, botId: string | null = null): FivemFinanceSettingsDto {
  return {
    adminRoleIds: [],
    addRoleIds: [],
    allowBalanceQuery: true,
    allowNegativeBalance: false,
    balanceCents: 0,
    configureRoleIds: [],
    confirmAdd: false,
    confirmRemove: true,
    confirmWithdraw: true,
    defaultOperationRoleId: null,
    factionId: DEFAULT_FACTION_ID,
    factionName: DEFAULT_FACTION_NAME,
    factionRoleId: null,
    refundRoleIds: [],
    removeRoleIds: [],
    totalInCents: 0,
    totalOutCents: 0,
    transactionCount: 0,
    lastTransactionAt: null,
    viewerRoleIds: [],
    withdrawRoleIds: [],
    historyRoleIds: [],
    historyEnabled: true,
    historyPageSize: 10,
    maxTransactionAmount: 1_000_000_000,
    requireReason: true,
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
    panelDescription: "Gerencie entradas e saidas de dinheiro da FAC de forma automática, segura e organizada. Toda movimentação exige comprovante por imagem e e registrada nas logs financeiras.",
    panelImage: null,
    panelMessageId: null,
    panelTitle: `${fixedSystemEmojiText("dinheiro")} Controle Financeiro da FAC`,
    tempCategoryId: null,
    updatedAt: null,
    useRoleIds: []
  };
}

export async function getFivemFinanceDashboard(guildId: string, botId?: string | null, factionId?: string | null) {
  const normalizedFactionId = normalizeFactionId(factionId);
  const settings = await getFivemFinanceSettings(guildId, botId, normalizedFactionId);
  const transactions = await listFivemFinanceTransactions(guildId, botId, 1000, normalizedFactionId);
  return { report: buildReport(transactions), settings, transactions };
}

export async function getFivemFinanceSettings(guildId: string, botId?: string | null, factionId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const normalizedFactionId = normalizeFactionId(factionId);
  const { fivemFinanceSettings } = await getMongoCollections();
  const row = await fivemFinanceSettings.findOne(scopeQuery(guildId, normalizedBotId, normalizedFactionId));
  return withPanelImage(row ? toSettingsDto(row) : { ...defaultFivemFinanceSettings(guildId, normalizedBotId), factionId: normalizedFactionId });
}

export async function saveFivemFinanceSettings(guildId: string, botId: string | null, input: Partial<FivemFinanceSettingsDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const normalizedFactionId = normalizeFactionId(input.factionId);
  const current = await getFivemFinanceSettings(guildId, normalizedBotId, normalizedFactionId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId, factionId: normalizedFactionId });
  const now = new Date();
  const { fivemFinanceSettings } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemFinanceSettings.updateOne(scopeQuery(guildId, normalizedBotId, normalizedFactionId), { $set: { ...next, updatedAt: now, updatedBy: actorId }, $setOnInsert: { _id: randomUUID() } }, { upsert: true });
  await writeLog({ action: current.updatedAt ? "settings.updated" : "settings.created", actorId, botId: normalizedBotId, data: { enabled: next.enabled, factionId: normalizedFactionId }, guildId, transactionId: null });
  if (current.enabled !== next.enabled) await writeLog({ action: next.enabled ? "system.enabled" : "system.disabled", actorId, botId: normalizedBotId, data: { factionId: normalizedFactionId }, guildId, transactionId: null });
  emitUpdated(guildId, normalizedBotId, normalizedFactionId);
  if (normalizedBotId && Object.keys(input).some((key) => key !== "panelMessageId")) emitPanelRefresh(guildId, normalizedBotId, normalizedFactionId);
  return getFivemFinanceSettings(guildId, normalizedBotId, normalizedFactionId);
}

export async function requestFivemFinancePanelPublish(guildId: string, botId: string | null, factionId?: string | null) {
  const settings = await getFivemFinanceSettings(guildId, botId, factionId);
  if (settings.botId) emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "fivem:finance:panel_publish", { botId: settings.botId, guildId });
  return settings;
}

export async function updateFivemFinancePanelState(guildId: string, botId: string | null, messageId: string | null, factionId?: string | null) {
  return saveFivemFinanceSettings(guildId, botId, { factionId: normalizeFactionId(factionId), panelMessageId: messageId }, null);
}

export async function listFivemFinanceTransactions(guildId: string, botId?: string | null, limit = 250, factionId?: string | null) {
  const { fivemFinanceTransactions } = await getMongoCollections();
  const rows = await fivemFinanceTransactions.find(scopeQuery(guildId, normalizeBotId(botId), normalizeFactionId(factionId))).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 1000)).toArray();
  return rows.map(toTransactionDto);
}

export async function createFivemFinanceTransaction(input: {
  amount: number;
  amountCents?: number;
  factionId?: string | null;
  factionName?: string | null;
  guildId: string;
  logChannelId?: string | null;
  logMessageId?: string | null;
  proofImageUrl: string;
  proofMessageId?: string | null;
  tempChannelId?: string | null;
  type: "add" | "remove" | "withdraw";
  userAvatar?: string | null;
  userId: string;
  username: string;
  managerId?: string;
  managerName?: string;
  metadata?: Record<string, unknown>;
  personName?: string;
  reason?: string;
  targetUserId?: string;
}, botId?: string | null) {
  const key = `${normalizeBotId(botId) ?? "legacy"}:${input.guildId}:${normalizeFactionId(input.factionId)}`;
  return enqueueTransaction(key, () => createFivemFinanceTransactionLocked(input, botId));
}

async function createFivemFinanceTransactionLocked(input: {
  amount: number; amountCents?: number; factionId?: string | null; factionName?: string | null; guildId: string; logChannelId?: string | null; logMessageId?: string | null; proofImageUrl: string;
  proofMessageId?: string | null; tempChannelId?: string | null; type: "add" | "remove" | "withdraw"; userAvatar?: string | null;
  userId: string; username: string; managerId?: string; managerName?: string; metadata?: Record<string, unknown>; personName?: string; reason?: string; targetUserId?: string;
}, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const factionId = normalizeFactionId(input.factionId);
  const settings = await getFivemFinanceSettings(input.guildId, normalizedBotId, factionId);
  if (!settings.enabled) throw financeError("Sistema financeiro desativado.", 409);
  const amountCents = normalizeCents(input.amountCents ?? reaisToCents(input.amount));
  const amount = centsToReais(amountCents);
  if (amountCents <= 0) throw financeError("Valor inválido.", 400);
  if (amount > settings.maxTransactionAmount) throw financeError("Valor acima do limite configurado.", 409);
  const reason = normalizeText(input.reason, 1000);
  if (settings.requireReason && !reason) throw financeError("O motivo e obrigatório.", 400);
  const { fivemFinanceSettings, fivemFinanceTransactions } = await getMongoCollections();
  const scope = scopeQuery(input.guildId, normalizedBotId, factionId);
  if (input.tempChannelId && await fivemFinanceTransactions.findOne({ ...scope, tempChannelId: input.tempChannelId, status: { $ne: "cancelled" } })) throw financeError("Este canal já possui movimentação registrada.", 409);
  const laundryOrderId = typeof input.metadata?.laundryOrderId === "string" ? input.metadata.laundryOrderId : null;
  if (laundryOrderId) {
    const duplicate = await fivemFinanceTransactions.findOne({ ...scope, "metadata.laundryOrderId": laundryOrderId, status: { $ne: "cancelled" } });
    if (duplicate) return toTransactionDto(duplicate);
  }
  const currentBalanceCents = typeof settings.balanceCents === "number" ? settings.balanceCents : reaisToCents(await getBalance(input.guildId, normalizedBotId, factionId));
  const multiplier = input.type === "add" ? 1 : -1;
  const newBalanceCents = currentBalanceCents + (multiplier * amountCents);
  if (input.type !== "add" && newBalanceCents < 0) throw financeError("Saldo insuficiente.", 409);
  const now = new Date();
  await ensureGuild(input.guildId);
  const updatedCash = await fivemFinanceSettings.findOneAndUpdate(
    input.type === "add" ? scope : { ...scope, balanceCents: { $gte: amountCents } },
    {
      $inc: {
        balanceCents: multiplier * amountCents,
        totalInCents: input.type === "add" ? amountCents : 0,
        totalOutCents: input.type === "add" ? 0 : amountCents,
        transactionCount: 1
      },
      $set: {
        botId: normalizedBotId,
        factionId,
        factionName: normalizeText(input.factionName, 120) ?? settings.factionName ?? DEFAULT_FACTION_NAME,
        guildId: input.guildId,
        lastTransactionAt: now,
        updatedAt: now
      },
      $setOnInsert: { _id: randomUUID() }
    },
    { returnDocument: "after", upsert: input.type === "add" }
  );
  if (!updatedCash) throw financeError("Saldo insuficiente.", 409);
  const persistedNewBalanceCents = normalizeCents(updatedCash.balanceCents ?? newBalanceCents);
  const persistedOldBalanceCents = normalizeCents(persistedNewBalanceCents - (multiplier * amountCents));
  const doc: MongoFivemFinanceTransaction = {
    _id: randomUUID(),
    amount,
    amountCents,
    botId: normalizedBotId,
    createdAt: now,
    factionId,
    factionName: normalizeText(input.factionName, 120) ?? settings.factionName ?? DEFAULT_FACTION_NAME,
    guildId: input.guildId,
    logChannelId: normalizeSnowflake(input.logChannelId ?? settings.logChannelId),
    logMessageId: normalizeSnowflake(input.logMessageId),
    newBalance: centsToReais(persistedNewBalanceCents),
    newBalanceCents: persistedNewBalanceCents,
    notes: reason,
    managerId: normalizeSnowflake(input.managerId) ?? input.userId,
    managerName: normalizeText(input.managerName, 120) ?? input.username,
    metadata: input.metadata ?? {},
    personName: normalizeText(input.personName, 120) ?? input.username,
    reason: reason ?? "Sem motivo informado",
    targetUserId: normalizeSnowflake(input.targetUserId) ?? input.userId,
    oldBalance: centsToReais(persistedOldBalanceCents),
    oldBalanceCents: persistedOldBalanceCents,
    proofImageUrl: normalizeUrl(input.proofImageUrl) ?? "",
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
  await writeLog({ action: "transaction.created", actorId: input.userId, botId: normalizedBotId, data: { amount, amountCents, factionId, newBalance: doc.newBalance, newBalanceCents: doc.newBalanceCents, oldBalance: doc.oldBalance, oldBalanceCents: doc.oldBalanceCents, type: input.type }, guildId: input.guildId, transactionId: doc.transactionId });
  emitUpdated(input.guildId, normalizedBotId, factionId);
  if (normalizedBotId) emitPanelRefresh(input.guildId, normalizedBotId, factionId);
  return toTransactionDto(doc);
}

export async function updateFivemFinanceTransaction(guildId: string, botId: string | null, id: string, input: { amount?: number; notes?: string | null; status?: MongoFivemFinanceTransactionStatus }, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemFinanceTransactions } = await getMongoCollections();
  const current = await fivemFinanceTransactions.findOne({ _id: id, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  const amount = input.amount === undefined ? current.amount : money(input.amount);
  if (amount <= 0) throw financeError("Valor inválido.", 400);
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
  if (normalizedBotId) emitPanelRefresh(guildId, normalizedBotId);
  return toTransactionDto({ ...current, ...next });
}

export async function updateFivemFinanceTransactionLog(guildId: string, botId: string | null, id: string, input: { logChannelId?: string | null; logMessageId?: string | null }) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemFinanceTransactions } = await getMongoCollections();
  const next = { logChannelId: normalizeSnowflake(input.logChannelId), logMessageId: normalizeSnowflake(input.logMessageId), updatedAt: new Date() };
  const row = await fivemFinanceTransactions.findOneAndUpdate({ _id: id, ...scopeQuery(guildId, normalizedBotId) }, { $set: next }, { returnDocument: "after" });
  return row ? toTransactionDto(row) : null;
}

async function getBalance(guildId: string, botId: string | null, factionId?: string | null) {
  const transactions = await listFivemFinanceTransactions(guildId, botId, 1000, factionId);
  return transactions.filter((item) => item.status !== "cancelled").reduce((total, item) => total + (item.type === "add" ? item.amount : -item.amount), 0);
}

function buildReport(transactions: FivemFinanceTransactionDto[]) {
  const active = transactions.filter((item) => item.status !== "cancelled");
  const totalIn = active.filter((item) => item.type === "add").reduce((sum, item) => sum + item.amount, 0);
  const totalOut = active.filter((item) => item.type !== "add").reduce((sum, item) => sum + item.amount, 0);
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

function topUsers(transactions: FivemFinanceTransactionDto[], type: "add" | "remove" | "withdraw") {
  const map = new Map<string, { amount: number; count: number; userId: string; username: string }>();
  for (const item of transactions.filter((transaction) => transaction.type === type)) {
    const current = map.get(item.userId) ?? { amount: 0, count: 0, userId: item.userId, username: item.username };
    current.amount += item.amount; current.count += 1; map.set(item.userId, current);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 5).map((item) => ({ ...item, amount: money(item.amount) }));
}

function toSettingsDto(row: MongoFivemFinanceSettings): FivemFinanceSettingsDto { const { _id, updatedAt, ...rest } = row; return { ...defaultFivemFinanceSettings(row.guildId, row.botId), ...rest, updatedAt: updatedAt?.toISOString() ?? null, panelImage: null }; }
function toTransactionDto(row: MongoFivemFinanceTransaction): FivemFinanceTransactionDto { const { _id, createdAt, updatedAt, ...rest } = row; return { ...rest, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() }; }
function normalizeSettings(value: Partial<FivemFinanceSettingsDto>): Omit<MongoFivemFinanceSettings, "_id" | "updatedAt"> {
  return {
    adminRoleIds: normalizeSnowflakes(value.adminRoleIds),
    addRoleIds: normalizeSnowflakes(value.addRoleIds),
    allowBalanceQuery: value.allowBalanceQuery !== false,
    allowNegativeBalance: value.allowNegativeBalance === true,
    balanceCents: normalizeCents(value.balanceCents ?? 0),
    configureRoleIds: normalizeSnowflakes(value.configureRoleIds),
    confirmAdd: value.confirmAdd === true,
    confirmRemove: value.confirmRemove !== false,
    confirmWithdraw: value.confirmWithdraw !== false,
    defaultOperationRoleId: normalizeSnowflake(value.defaultOperationRoleId),
    factionId: normalizeFactionId(value.factionId),
    factionName: normalizeText(value.factionName, 120) ?? DEFAULT_FACTION_NAME,
    factionRoleId: normalizeSnowflake(value.factionRoleId),
    refundRoleIds: normalizeSnowflakes(value.refundRoleIds),
    removeRoleIds: normalizeSnowflakes(value.removeRoleIds),
    totalInCents: normalizeCents(value.totalInCents ?? 0),
    totalOutCents: normalizeCents(value.totalOutCents ?? 0),
    transactionCount: clamp(value.transactionCount, 0, Number.MAX_SAFE_INTEGER, 0),
    lastTransactionAt: value.lastTransactionAt instanceof Date ? value.lastTransactionAt : null,
    viewerRoleIds: normalizeSnowflakes(value.viewerRoleIds),
    withdrawRoleIds: normalizeSnowflakes(value.withdrawRoleIds),
    historyRoleIds: normalizeSnowflakes(value.historyRoleIds),
    historyEnabled: value.historyEnabled !== false,
    historyPageSize: clamp(value.historyPageSize, 5, 25, 10),
    maxTransactionAmount: clamp(value.maxTransactionAmount, 1, 1_000_000_000_000, 1_000_000_000),
    requireReason: value.requireReason !== false,
    autoCloseMinutes: clamp(value.autoCloseMinutes, 1, 1440, 10),
    bannerMode: ["above", "inside", "below", "none"].includes(value.bannerMode ?? "") ? value.bannerMode as MongoFivemFinanceSettings["bannerMode"] : "inside",
    botId: normalizeBotId(value.botId),
    color: /^#[0-9a-f]{6}$/i.test(value.color ?? "") ? value.color! : "#22c55e",
    enabled: value.enabled === true,
    footerImageUrl: normalizeUrl(value.footerImageUrl),
    footerText: normalizeText(value.footerText, 200),
    guildId: value.guildId ?? "",
    logChannelId: normalizeSnowflake(value.logChannelId),
    panelChannelId: normalizeSnowflake(value.panelChannelId),
    panelDescription: normalizeText(value.panelDescription, 1500) || defaultFivemFinanceSettings(value.guildId ?? "", normalizeBotId(value.botId)).panelDescription,
    panelMessageId: normalizeSnowflake(value.panelMessageId),
    panelTitle: normalizeText(value.panelTitle, 120) || `${fixedSystemEmojiText("dinheiro")} Sistema Financeiro`,
    tempCategoryId: normalizeSnowflake(value.tempCategoryId),
    useRoleIds: normalizeSnowflakes(value.useRoleIds),
    updatedBy: value.updatedBy ?? null
  };
}
async function withPanelImage(settings: FivemFinanceSettingsDto) { if (!settings.botId) return settings; const image = await getPanelImageSettings(settings.guildId, settings.botId, "fivem-finance").catch(() => null); return { ...settings, panelImage: image?.imageEnabled ? image : null }; }
async function writeLog(input: Omit<MongoFivemFinanceLog, "_id" | "createdAt">) { const { fivemFinanceLogs } = await getMongoCollections(); await fivemFinanceLogs.insertOne({ _id: randomUUID(), createdAt: new Date(), ...input, botId: normalizeBotId(input.botId) }); }
function emitUpdated(guildId: string, botId: string | null, factionId?: string | null) { if (!botId) return; emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:finance:updated", { botId, factionId: normalizeFactionId(factionId), guildId }); }
function emitPanelRefresh(guildId: string, botId: string, factionId?: string | null) { emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:finance:panel_publish", { botId, factionId: normalizeFactionId(factionId), guildId }); }
function scopeQuery(guildId: string, botId: string | null, factionId: string | null = DEFAULT_FACTION_ID) {
  const factionScope = { factionId: normalizeFactionId(factionId) };
  return botId ? { botId, guildId, ...factionScope } : { guildId, ...factionScope, $or: [{ botId: null }, { botId: { $exists: false } }] };
}
function normalizeBotId(value: string | null | undefined) { return value?.trim() || null; }
function normalizeFactionId(value: string | null | undefined) { return normalizeText(value, 120) ?? DEFAULT_FACTION_ID; }
function normalizeSnowflake(value: string | null | undefined) { return /^\d{5,32}$/.test(value?.trim() ?? "") ? value!.trim() : null; }
function normalizeSnowflakes(values: string[] | undefined) { return [...new Set((values ?? []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))]; }
function normalizeText(value: string | null | undefined, max: number) { return value?.trim().slice(0, max) || null; }
function normalizeUrl(value: string | null | undefined) { const text = normalizeText(value, 2048); if (!text) return null; try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) ? text : null; } catch { return null; } }
function clamp(value: number | null | undefined, min: number, max: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function money(value: number) { return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100; }
function reaisToCents(value: number) { return normalizeCents(Math.round(money(value) * 100)); }
function centsToReais(value: number) { return money(normalizeCents(value) / 100); }
function normalizeCents(value: number) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function financeError(message: string, status = 400) { const error = new Error(message) as Error & { status?: number }; error.status = status; return error; }
async function enqueueTransaction<T>(key: string, task: () => Promise<T>): Promise<T> { const previous = transactionQueues.get(key) ?? Promise.resolve(); const current = previous.catch(() => undefined).then(task); transactionQueues.set(key, current); try { return await current; } finally { if (transactionQueues.get(key) === current) transactionQueues.delete(key); } }
