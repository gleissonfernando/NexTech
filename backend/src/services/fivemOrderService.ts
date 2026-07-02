import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemOrder,
  type MongoFivemOrderLog,
  type MongoFivemOrderProduct,
  type MongoFivemOrderSettings,
  type MongoFivemOrderStatus
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

export const FIVEM_ORDERS_MODULE_ID = "fivem-orders";

export type FivemOrderSettingsDto = Omit<MongoFivemOrderSettings, "_id" | "updatedAt"> & { panelImage: PanelImageSettingsDto | null; updatedAt: string | null };
export type FivemOrderProductDto = Omit<MongoFivemOrderProduct, "_id" | "createdAt" | "updatedAt"> & { createdAt: string; id: string; updatedAt: string };
export type FivemOrderDto = Omit<MongoFivemOrder, "_id" | "createdAt" | "history" | "updatedAt"> & {
  createdAt: string;
  history: Array<{ actorId: string | null; at: string; from: MongoFivemOrderStatus | null; note: string | null; to: MongoFivemOrderStatus }>;
  id: string;
  updatedAt: string;
};
export type FivemOrderLogDto = Omit<MongoFivemOrderLog, "_id" | "createdAt"> & { createdAt: string; id: string };

export function defaultFivemOrderSettings(guildId: string, botId: string | null = null): FivemOrderSettingsDto {
  return {
    adminRoleIds: [],
    allowAnonymous: false,
    allowAttachments: true,
    allowCustomNotes: true,
    approvalChannelId: null,
    approvalRequired: false,
    botId,
    cancelRoleIds: [],
    color: "#22c55e",
    createRoleIds: [],
    deliveryChannelId: null,
    enabled: false,
    errorMessage: "Nao foi possivel criar a encomenda. Confira os dados e tente novamente.",
    finishRoleIds: [],
    footerText: "Encomendas registradas e acompanhadas pela equipe.",
    guildId,
    logChannelId: null,
    maxOpenHours: 72,
    orderCancelledMessage: "Encomenda cancelada.",
    orderCreatedMessage: "Encomenda criada com sucesso.",
    orderDeliveredMessage: "Encomenda entregue com sucesso.",
    panelChannelId: null,
    panelDescription: "Escolha um produto, informe os dados do pedido e acompanhe o andamento pelo painel.",
    panelImage: null,
    panelMessageId: null,
    panelTitle: "Encomendas RP",
    updatedAt: null
  };
}

export async function getFivemOrderSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemOrderSettings } = await getMongoCollections();
  const row = await fivemOrderSettings.findOne(scopeQuery(guildId, normalizedBotId));
  return withPanelImage(row ? toSettingsDto(row) : defaultFivemOrderSettings(guildId, normalizedBotId));
}

export async function saveFivemOrderSettings(guildId: string, botId: string | null, input: Partial<FivemOrderSettingsDto>, actorId: string | null) {
  const current = await getFivemOrderSettings(guildId, botId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizeBotId(botId), guildId });
  const { panelImage: _panelImage, ...persisted } = next;
  const now = new Date();
  const { fivemOrderSettings } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemOrderSettings.updateOne(scopeQuery(guildId, next.botId), { $set: { ...persisted, updatedAt: now, updatedBy: actorId }, $setOnInsert: { _id: randomUUID() } }, { upsert: true });
  await writeLog({ action: current.updatedAt ? "settings.updated" : "settings.created", actorId, botId: next.botId, data: { enabled: next.enabled }, guildId, orderId: null, productId: null });
  if (current.enabled !== next.enabled) await writeLog({ action: next.enabled ? "system.enabled" : "system.disabled", actorId, botId: next.botId, data: {}, guildId, orderId: null, productId: null });
  emitUpdated(guildId, next.botId);
  return getFivemOrderSettings(guildId, next.botId);
}

export async function listFivemOrderProducts(guildId: string, botId?: string | null, activeOnly = false) {
  const { fivemOrderProducts } = await getMongoCollections();
  const rows = await fivemOrderProducts.find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(activeOnly ? { active: true } : {}) }).sort({ featured: -1, order: 1, createdAt: 1 }).limit(250).toArray();
  return rows.map(toProductDto);
}

export async function createFivemOrderProduct(guildId: string, botId: string | null, input: Partial<FivemOrderProductDto>, actorId: string | null) {
  const now = new Date();
  const doc: MongoFivemOrderProduct = { _id: randomUUID(), ...normalizeProduct(input, guildId, normalizeBotId(botId)), createdAt: now, updatedAt: now };
  const { fivemOrderProducts } = await getMongoCollections();
  await fivemOrderProducts.insertOne(doc);
  await writeLog({ action: "product.created", actorId, botId: doc.botId, data: { name: doc.name }, guildId, orderId: null, productId: doc._id });
  emitUpdated(guildId, doc.botId);
  return toProductDto(doc);
}

export async function updateFivemOrderProduct(guildId: string, botId: string | null, productId: string, input: Partial<FivemOrderProductDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemOrderProducts } = await getMongoCollections();
  const current = await fivemOrderProducts.findOne({ _id: productId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  const next = { ...normalizeProduct({ ...toProductDto(current), ...input }, guildId, normalizedBotId), updatedAt: new Date() };
  await fivemOrderProducts.updateOne({ _id: productId, ...scopeQuery(guildId, normalizedBotId) }, { $set: next });
  await writeLog({ action: current.stock !== next.stock ? "stock.updated" : "product.updated", actorId, botId: normalizedBotId, data: { name: next.name, stock: next.stock }, guildId, orderId: null, productId });
  emitUpdated(guildId, normalizedBotId);
  return toProductDto({ ...current, ...next });
}

export async function deleteFivemOrderProduct(guildId: string, botId: string | null, productId: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemOrderProducts } = await getMongoCollections();
  const row = await fivemOrderProducts.findOneAndDelete({ _id: productId, ...scopeQuery(guildId, normalizedBotId) });
  if (!row) return null;
  await writeLog({ action: "product.deleted", actorId, botId: normalizedBotId, data: { name: row.name }, guildId, orderId: null, productId });
  emitUpdated(guildId, normalizedBotId);
  return toProductDto(row);
}

export async function createFivemOrder(input: {
  botId?: string | null;
  clientName: string;
  expectedDelivery?: string | null;
  grossValue?: number | null;
  guildId: string;
  notes?: string | null;
  productId: string;
  proofUrl?: string | null;
  quantity: number;
  sourceId?: string | null;
  userId: string;
  washingPercentage?: number | null;
}) {
  const botId = normalizeBotId(input.botId);
  const settings = await getFivemOrderSettings(input.guildId, botId);
  if (!settings.enabled) throw orderError("O sistema de encomendas esta desativado.", 403);
  const { fivemOrderProducts, fivemOrders } = await getMongoCollections();
  if (input.sourceId) {
    const duplicate = await fivemOrders.findOne({ ...scopeQuery(input.guildId, botId), sourceId: input.sourceId });
    if (duplicate) return toOrderDto(duplicate);
  }
  const product = await fivemOrderProducts.findOne({ _id: input.productId, ...scopeQuery(input.guildId, botId), active: true });
  if (!product) throw orderError("Produto indisponivel.", 404);
  const quantity = product.type === "washing" ? 1 : clampNumber(input.quantity, 1, 1_000_000, 1);
  const washingPercentage = product.type === "washing" ? resolveWashingPercentage(product, input.washingPercentage) : null;
  const totals = calculateTotals(product, quantity, input.grossValue, washingPercentage);
  if (product.useStock) {
    const stockUpdate = await fivemOrderProducts.updateOne({ _id: product._id, ...scopeQuery(input.guildId, botId), stock: { $gte: quantity } }, { $inc: { stock: -quantity }, $set: { updatedAt: new Date() } });
    if (!stockUpdate.modifiedCount) throw orderError("Estoque insuficiente para este produto.", 409);
  }
  const now = new Date();
  const status: MongoFivemOrderStatus = settings.approvalRequired ? "pending_approval" : "open";
  const orderNumber = await nextOrderNumber(input.guildId, botId);
  const doc: MongoFivemOrder = {
    _id: randomUUID(), botId, category: product.category, clientName: normalizeText(input.clientName, 120) || "Cliente nao informado", costTotal: totals.costTotal,
    createdAt: now, expectedDelivery: normalizeDate(input.expectedDelivery), finalValue: totals.finalValue, grossValue: totals.grossValue, guildId: input.guildId,
    history: [{ actorId: input.userId, at: now, from: null, note: null, to: status }], notes: settings.allowCustomNotes ? normalizeText(input.notes, 1000) : null,
    orderNumber, productId: product._id, productName: product.name, profit: totals.profit, proofUrl: settings.allowAttachments ? normalizeUrl(input.proofUrl) : null,
    quantity, responsibleId: null, sourceId: normalizeText(input.sourceId, 120), status, unitPrice: totals.unitPrice, updatedAt: now, userId: input.userId, washingPercentage
  };
  try {
    await fivemOrders.insertOne(doc);
  } catch (error) {
    if (product.useStock) await fivemOrderProducts.updateOne({ _id: product._id, ...scopeQuery(input.guildId, botId) }, { $inc: { stock: quantity } });
    throw error;
  }
  await writeLog({ action: "order.created", actorId: input.userId, botId, data: { finalValue: doc.finalValue, orderNumber, product: product.name, quantity }, guildId: input.guildId, orderId: doc._id, productId: product._id });
  emitUpdated(input.guildId, botId);
  return toOrderDto(doc);
}

export async function listFivemOrders(guildId: string, botId?: string | null, filters: { status?: MongoFivemOrderStatus | null; userId?: string | null } = {}) {
  const { fivemOrders } = await getMongoCollections();
  const rows = await fivemOrders.find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(filters.status ? { status: filters.status } : {}), ...(filters.userId ? { userId: filters.userId } : {}) }).sort({ createdAt: -1 }).limit(1000).toArray();
  return rows.map(toOrderDto);
}

export async function getFivemOrderByNumber(guildId: string, botId: string | null, orderNumber: number, userId?: string | null) {
  const { fivemOrders } = await getMongoCollections();
  const row = await fivemOrders.findOne({ ...scopeQuery(guildId, normalizeBotId(botId)), orderNumber, ...(userId ? { userId } : {}) });
  return row ? toOrderDto(row) : null;
}

export async function updateFivemOrderStatus(guildId: string, botId: string | null, orderId: string, status: MongoFivemOrderStatus, actorId: string | null, note?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemOrderProducts, fivemOrders } = await getMongoCollections();
  const current = await fivemOrders.findOne({ _id: orderId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  if (current.status === status) return toOrderDto(current);
  assertTransition(current.status, status);
  const now = new Date();
  const responsibleId = ["approved", "in_production", "ready", "delivered"].includes(status) ? actorId : current.responsibleId;
  const updated = await fivemOrders.findOneAndUpdate(
    { _id: orderId, ...scopeQuery(guildId, normalizedBotId), status: current.status },
    { $push: { history: { actorId, at: now, from: current.status, note: normalizeText(note, 500), to: status } }, $set: { responsibleId, status, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!updated) throw orderError("A encomenda foi atualizada por outra pessoa. Tente novamente.", 409);
  if (["cancelled", "rejected"].includes(status) && !["cancelled", "rejected", "delivered"].includes(current.status)) {
    const product = await fivemOrderProducts.findOne({ _id: current.productId, ...scopeQuery(guildId, normalizedBotId) });
    if (product?.useStock) await fivemOrderProducts.updateOne({ _id: product._id }, { $inc: { stock: current.quantity }, $set: { updatedAt: now } });
  }
  await writeLog({ action: `order.${status}`, actorId, botId: normalizedBotId, data: { from: current.status, note: normalizeText(note, 500), orderNumber: current.orderNumber, to: status }, guildId, orderId, productId: current.productId });
  emitUpdated(guildId, normalizedBotId);
  return toOrderDto(updated);
}

export async function listFivemOrderLogs(guildId: string, botId?: string | null) {
  const { fivemOrderLogs } = await getMongoCollections();
  const rows = await fivemOrderLogs.find(scopeQuery(guildId, normalizeBotId(botId))).sort({ createdAt: -1 }).limit(300).toArray();
  return rows.map(toLogDto);
}

export async function getFivemOrderDashboard(guildId: string, botId?: string | null) {
  const [settings, products, orders, logs] = await Promise.all([getFivemOrderSettings(guildId, botId), listFivemOrderProducts(guildId, botId), listFivemOrders(guildId, botId), listFivemOrderLogs(guildId, botId)]);
  const delivered = orders.filter((order) => order.status === "delivered");
  const productTotals = new Map<string, { name: string; quantity: number; total: number }>();
  for (const order of delivered) {
    const item = productTotals.get(order.productId) ?? { name: order.productName, quantity: 0, total: 0 };
    item.quantity += order.quantity; item.total += order.finalValue; productTotals.set(order.productId, item);
  }
  return {
    logs, orders, products,
    report: {
      cancelled: orders.filter((order) => order.status === "cancelled").length,
      delivered: delivered.length,
      open: orders.filter((order) => ["open", "pending_approval", "approved"].includes(order.status)).length,
      productTotals: [...productTotals.entries()].map(([productId, value]) => ({ productId, ...value })).sort((a, b) => b.quantity - a.quantity),
      production: orders.filter((order) => ["in_production", "ready"].includes(order.status)).length,
      totalProfit: delivered.reduce((sum, order) => sum + order.profit, 0),
      totalRevenue: delivered.reduce((sum, order) => sum + order.finalValue, 0)
    },
    settings
  };
}

export async function requestFivemOrderPanelPublish(guildId: string, botId: string, actorId: string | null) {
  const settings = await getFivemOrderSettings(guildId, botId);
  if (!settings.enabled) throw orderError("Ative o sistema de encomendas antes de publicar.", 400);
  if (!settings.panelChannelId) throw orderError("Configure o canal do painel de encomendas.", 400);
  await writeLog({ action: "panel.publish_requested", actorId, botId, data: { channelId: settings.panelChannelId }, guildId, orderId: null, productId: null });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:orders:panel_publish", { botId, guildId });
  return settings;
}

function calculateTotals(product: MongoFivemOrderProduct, quantity: number, grossValue?: number | null, washingPercentage?: number | null) {
  if (product.type === "washing") {
    const gross = clampNumber(grossValue, 0, 1_000_000_000_000, 0);
    const discount = roundMoney(gross * (washingPercentage ?? product.factionPercentage) / 100);
    return { costTotal: roundMoney(gross - discount), finalValue: roundMoney(gross - discount), grossValue: gross, profit: discount, unitPrice: gross };
  }
  const gross = roundMoney(product.price * quantity);
  const costTotal = roundMoney(product.cost * quantity);
  return { costTotal, finalValue: gross, grossValue: gross, profit: roundMoney(gross - costTotal), unitPrice: product.price };
}

function normalizeSettings(value: FivemOrderSettingsDto): FivemOrderSettingsDto {
  return {
    ...value,
    adminRoleIds: normalizeSnowflakes(value.adminRoleIds), approvalChannelId: normalizeSnowflake(value.approvalChannelId), botId: normalizeBotId(value.botId),
    cancelRoleIds: normalizeSnowflakes(value.cancelRoleIds), color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#22c55e", createRoleIds: normalizeSnowflakes(value.createRoleIds),
    deliveryChannelId: normalizeSnowflake(value.deliveryChannelId), errorMessage: normalizeText(value.errorMessage, 500) || "Nao foi possivel criar a encomenda.", finishRoleIds: normalizeSnowflakes(value.finishRoleIds),
    footerText: normalizeText(value.footerText, 200), logChannelId: normalizeSnowflake(value.logChannelId), maxOpenHours: clampNumber(value.maxOpenHours, 1, 8760, 72),
    orderCancelledMessage: normalizeText(value.orderCancelledMessage, 500) || "Encomenda cancelada.", orderCreatedMessage: normalizeText(value.orderCreatedMessage, 500) || "Encomenda criada.",
    orderDeliveredMessage: normalizeText(value.orderDeliveredMessage, 500) || "Encomenda entregue.", panelChannelId: normalizeSnowflake(value.panelChannelId), panelDescription: normalizeText(value.panelDescription, 1500) || "Escolha um produto para criar uma encomenda.",
    panelMessageId: normalizeSnowflake(value.panelMessageId), panelTitle: normalizeText(value.panelTitle, 120) || "Encomendas RP"
  };
}

function normalizeProduct(value: Partial<FivemOrderProductDto>, guildId: string, botId: string | null): Omit<MongoFivemOrderProduct, "_id" | "createdAt" | "updatedAt"> {
  const type = value.type === "washing" || value.type === "ammo" || value.type === "weapon" ? value.type : "standard";
  return {
    active: value.active !== false, allowCustomQuantity: value.allowCustomQuantity !== false, allowNotes: value.allowNotes !== false, botId,
    category: normalizeText(value.category, 80) || (type === "washing" ? "Lavagem" : type === "ammo" ? "Municao" : type === "weapon" ? "Armas" : "Outros"),
    cost: money(value.cost), description: normalizeText(value.description, 500), emoji: normalizeText(value.emoji, 80), factionPercentage: clampNumber(value.factionPercentage, 0, 100, type === "washing" ? 20 : 0),
    featured: value.featured === true, guildId, minimumStock: clampNumber(value.minimumStock, 0, 1_000_000_000, 0), name: normalizeText(value.name, 100) || "Novo produto",
    order: clampNumber(value.order, 0, 10000, 0), price: money(value.price), sellerPercentage: clampNumber(value.sellerPercentage, 0, 100, 0), stock: value.useStock ? clampNumber(value.stock, 0, 1_000_000_000, 0) : null,
    type, useStock: value.useStock === true,
    washingPercentages: normalizePercentages(value.washingPercentages, value.factionPercentage, type)
  };
}

function toSettingsDto(row: MongoFivemOrderSettings): FivemOrderSettingsDto { const { _id: _id, updatedAt, ...rest } = row; return { ...rest, panelImage: null, updatedAt: updatedAt?.toISOString() ?? null }; }
async function withPanelImage(settings: FivemOrderSettingsDto) { if (!settings.botId) return settings; const image = await getPanelImageSettings(settings.guildId, settings.botId, "fivem-orders").catch(() => null); return { ...settings, panelImage: image?.imageEnabled ? image : null }; }
function toProductDto(row: MongoFivemOrderProduct): FivemOrderProductDto { const { _id, createdAt, updatedAt, ...rest } = row; return { ...rest, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() }; }
function toOrderDto(row: MongoFivemOrder): FivemOrderDto { const { _id, createdAt, history, updatedAt, ...rest } = row; return { ...rest, createdAt: createdAt.toISOString(), history: history.map((item) => ({ ...item, at: item.at.toISOString() })), id: _id, updatedAt: updatedAt.toISOString() }; }
function toLogDto(row: MongoFivemOrderLog): FivemOrderLogDto { const { _id, createdAt, ...rest } = row; return { ...rest, createdAt: createdAt.toISOString(), id: _id }; }
async function writeLog(input: Omit<MongoFivemOrderLog, "_id" | "createdAt">) { const { fivemOrderLogs } = await getMongoCollections(); await fivemOrderLogs.insertOne({ _id: randomUUID(), createdAt: new Date(), ...input, botId: normalizeBotId(input.botId) }); }
function emitUpdated(guildId: string, botId: string | null) { emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:orders:updated", { botId, guildId }); }
async function nextOrderNumber(guildId: string, botId: string | null) { const { fivemOrders } = await getMongoCollections(); const last = await fivemOrders.find(scopeQuery(guildId, botId)).sort({ orderNumber: -1 }).limit(1).next(); return (last?.orderNumber ?? 0) + 1; }
function assertTransition(from: MongoFivemOrderStatus, to: MongoFivemOrderStatus) { const allowed: Record<MongoFivemOrderStatus, MongoFivemOrderStatus[]> = { open: ["approved", "in_production", "cancelled", "rejected"], pending_approval: ["approved", "cancelled", "rejected"], approved: ["in_production", "cancelled"], in_production: ["ready", "cancelled"], ready: ["delivered", "cancelled"], delivered: [], cancelled: [], rejected: [] }; if (!allowed[from].includes(to)) throw orderError(`Nao e permitido alterar de ${from} para ${to}.`, 409); }
function scopeQuery(guildId: string, botId: string | null) { return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] }; }
function normalizeBotId(value: string | null | undefined) { return value?.trim() || null; }
function normalizeSnowflake(value: string | null | undefined) { return /^\d{5,32}$/.test(value?.trim() ?? "") ? value!.trim() : null; }
function normalizeSnowflakes(values: string[] | undefined) { return [...new Set((values ?? []).map(normalizeSnowflake).filter((item): item is string => Boolean(item)))].slice(0, 100); }
function normalizeText(value: string | null | undefined, max: number) { return value?.trim().slice(0, max) || null; }
function normalizeUrl(value: string | null | undefined) { const text = normalizeText(value, 2048); if (!text) return null; try { const url = new URL(text); return ["http:", "https:"].includes(url.protocol) ? text : null; } catch { return null; } }
function normalizeDate(value: string | null | undefined) { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value! : null; }
function clampNumber(value: number | null | undefined, min: number, max: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function money(value: number | null | undefined) { return roundMoney(clampNumber(value, 0, 1_000_000_000_000, 0)); }
function roundMoney(value: number) { return Math.round(value * 100) / 100; }
function normalizePercentages(values: number[] | undefined, fallback: number | undefined, type: MongoFivemOrderProduct["type"]) { if (type !== "washing") return []; const normalized = [...new Set([...(values ?? []), clampNumber(fallback, 0, 100, 20)].map((item) => clampNumber(item, 0, 100, 0)))].sort((a, b) => a - b).slice(0, 25); return normalized.length ? normalized : [20]; }
function resolveWashingPercentage(product: MongoFivemOrderProduct, requested: number | null | undefined) { const allowed = normalizePercentages(product.washingPercentages, product.factionPercentage, "washing"); const selected = requested ?? allowed[0] ?? 20; if (!allowed.includes(selected)) throw orderError("Percentual de lavagem nao permitido.", 400); return selected; }
function orderError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
