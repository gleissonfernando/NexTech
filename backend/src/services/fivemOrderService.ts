import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemOrderFamily,
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
export type FivemOrderFamilyDto = Omit<MongoFivemOrderFamily, "_id" | "createdAt" | "updatedAt"> & { createdAt: string; id: string; updatedAt: string };

export function defaultFivemOrderSettings(guildId: string, botId: string | null = null): FivemOrderSettingsDto {
  return {
    adminRoleIds: [],
    allowAnonymous: false,
    allowAttachments: true,
    allowCustomNotes: true,
    approvalChannelId: null,
    approvalRequired: false,
    approveRoleIds: [],
    botId,
    cancelRoleIds: [],
    color: "#22c55e",
    createRoleIds: [],
    deliveryChannelId: null,
    enabled: false,
    errorMessage: "Nao foi possivel criar a encomenda. Confira os dados e tente novamente.",
    finishRoleIds: [],
    editValueRoleIds: [],
    footerText: "Encomendas registradas e acompanhadas pela equipe.",
    guildId,
    logChannelId: null,
    maxOpenHours: 72,
    enabledOrderModules: ["washing", "ammo", "drug", "weapon", "custom"],
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

export async function listFivemOrderFamilies(guildId: string, botId?: string | null, activeOnly = false) {
  const { fivemOrderFamilies } = await getMongoCollections();
  const rows = await fivemOrderFamilies.find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(activeOnly ? { active: true } : {}) }).sort({ active: -1, name: 1 }).limit(250).toArray();
  return rows.map(toFamilyDto);
}

export async function createFivemOrderFamily(guildId: string, botId: string | null, input: Partial<FivemOrderFamilyDto>, actorId: string | null) {
  const now = new Date();
  const doc: MongoFivemOrderFamily = { _id: randomUUID(), ...normalizeFamily(input, guildId, normalizeBotId(botId)), createdAt: now, updatedAt: now };
  const { fivemOrderFamilies } = await getMongoCollections();
  await fivemOrderFamilies.insertOne(doc);
  await writeLog({ action: "family.created", actorId, botId: doc.botId, data: { familyId: doc._id, name: doc.name }, guildId, orderId: null, productId: null });
  emitUpdated(guildId, doc.botId);
  return toFamilyDto(doc);
}

export async function updateFivemOrderFamily(guildId: string, botId: string | null, familyId: string, input: Partial<FivemOrderFamilyDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemOrderFamilies } = await getMongoCollections();
  const current = await fivemOrderFamilies.findOne({ _id: familyId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  const next = { ...normalizeFamily({ ...toFamilyDto(current), ...input }, guildId, normalizedBotId), updatedAt: new Date() };
  await fivemOrderFamilies.updateOne({ _id: familyId, ...scopeQuery(guildId, normalizedBotId) }, { $set: next });
  await writeLog({ action: "family.updated", actorId, botId: normalizedBotId, data: { familyId, name: next.name }, guildId, orderId: null, productId: null });
  emitUpdated(guildId, normalizedBotId);
  return toFamilyDto({ ...current, ...next });
}

export async function deleteFivemOrderFamily(guildId: string, botId: string | null, familyId: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemOrderFamilies, fivemOrders } = await getMongoCollections();
  if (await fivemOrders.findOne({ ...scopeQuery(guildId, normalizedBotId), familyId })) throw orderError("A familia possui encomendas e deve ser desativada em vez de excluida.", 409);
  const row = await fivemOrderFamilies.findOneAndDelete({ _id: familyId, ...scopeQuery(guildId, normalizedBotId) });
  if (!row) return null;
  await writeLog({ action: "family.deleted", actorId, botId: normalizedBotId, data: { familyId, name: row.name }, guildId, orderId: null, productId: null });
  emitUpdated(guildId, normalizedBotId);
  return toFamilyDto(row);
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
  await writeLog({ action: "product.updated", actorId, botId: normalizedBotId, data: { name: next.name }, guildId, orderId: null, productId });
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
  familyId: string;
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
  const { fivemOrderFamilies, fivemOrderProducts, fivemOrders } = await getMongoCollections();
  if (input.sourceId) {
    const duplicate = await fivemOrders.findOne({ ...scopeQuery(input.guildId, botId), sourceId: input.sourceId });
    if (duplicate) return toOrderDto(duplicate);
  }
  let product = await fivemOrderProducts.findOne({ _id: input.productId, ...scopeQuery(input.guildId, botId), active: true });
  if (!product) throw orderError("Produto indisponivel.", 404);
  if (product.type === "washing") {
    const gross = clampNumber(input.grossValue, 0, 1_000_000_000_000, 0);
    const matchingRule = await findWashingRuleForGrossValue(input.guildId, botId, gross);
    if (matchingRule) product = matchingRule;
  }
  const moduleId = product.type === "standard" ? "custom" : product.type;
  const family = await fivemOrderFamilies.findOne({ _id: input.familyId, ...scopeQuery(input.guildId, botId), active: true });
  if (!family) throw orderError("Selecione uma familia ativa para criar a encomenda.", 400);
  const familyModules = normalizeOrderModules(family.orderModules ?? []);
  if (familyModules.length && !familyModules.includes(moduleId as "washing" | "ammo" | "drug" | "weapon" | "custom")) throw orderError("Esta familia nao atende este tipo de encomenda.", 403);
  if (!settings.enabledOrderModules.includes(moduleId as "washing" | "ammo" | "drug" | "weapon" | "custom")) throw orderError("Este modulo de encomenda esta desativado.", 403);
  const quantity = product.type === "washing" ? 1 : clampNumber(input.quantity, product.minimumQuantity ?? 1, product.maximumQuantity ?? 1_000_000, product.defaultQuantity ?? 1);
  if (product.type !== "washing" && (input.quantity < (product.minimumQuantity ?? 1) || input.quantity > (product.maximumQuantity ?? 1_000_000))) throw orderError(`A quantidade deve ficar entre ${product.minimumQuantity ?? 1} e ${product.maximumQuantity ?? 1_000_000}.`, 400);
  const washingPercentage = product.type === "washing" ? resolveWashingPercentage(product, input.washingPercentage) : null;
  const totals = calculateTotals(product, quantity, input.grossValue, washingPercentage);
  const effectiveSettings = mergeProductSettings(settings, product);
  const now = new Date();
  const status: MongoFivemOrderStatus = effectiveSettings.approvalRequired ? "pending_approval" : "open";
  const orderNumber = await nextOrderNumber(input.guildId, botId);
  const doc: MongoFivemOrder = {
    _id: randomUUID(), botId, category: product.category, clientName: normalizeText(input.clientName, 120) || "Cliente nao informado", costTotal: totals.costTotal,
    createdAt: now, expectedDelivery: normalizeDate(input.expectedDelivery), familyId: family._id, familyName: family.name, finalValue: totals.finalValue, grossValue: totals.grossValue, guildId: input.guildId,
    history: [{ actorId: input.userId, at: now, from: null, note: null, to: status }], notes: effectiveSettings.allowCustomNotes ? normalizeText(input.notes, 1000) : null,
    orderNumber, productId: product._id, productName: product.name, profit: totals.profit, proofUrl: effectiveSettings.allowAttachments ? normalizeUrl(input.proofUrl) : null,
    quantity, responsibleId: null, sourceId: normalizeText(input.sourceId, 120), status, unitPrice: totals.unitPrice, updatedAt: now, userId: input.userId, washingPercentage
  };
  await fivemOrders.insertOne(doc);
  await writeLog({ action: "order.created", actorId: input.userId, botId, data: { familyId: family._id, familyName: family.name, finalValue: doc.finalValue, orderNumber, product: product.name, quantity }, guildId: input.guildId, orderId: doc._id, productId: product._id });
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
  const { fivemOrders } = await getMongoCollections();
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
  await writeLog({ action: `order.${status}`, actorId, botId: normalizedBotId, data: { familyId: current.familyId, familyName: current.familyName, from: current.status, note: normalizeText(note, 500), orderNumber: current.orderNumber, orderType: current.category, to: status, totalValue: current.finalValue }, guildId, orderId, productId: current.productId });
  emitUpdated(guildId, normalizedBotId);
  const dto = toOrderDto(updated);
  if (normalizedBotId) {
    emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:orders:status_updated", { actorId, botId: normalizedBotId, guildId, order: dto });
  }
  return dto;
}

export async function listFivemOrderLogs(guildId: string, botId?: string | null) {
  const { fivemOrderLogs } = await getMongoCollections();
  const rows = await fivemOrderLogs.find(scopeQuery(guildId, normalizeBotId(botId))).sort({ createdAt: -1 }).limit(300).toArray();
  return rows.map(toLogDto);
}

export async function getFivemOrderDashboard(guildId: string, botId?: string | null) {
  const [settings, families, products, orders, logs] = await Promise.all([getFivemOrderSettings(guildId, botId), listFivemOrderFamilies(guildId, botId), listFivemOrderProducts(guildId, botId), listFivemOrders(guildId, botId), listFivemOrderLogs(guildId, botId)]);
  const delivered = orders.filter((order) => order.status === "delivered");
  const productTotals = new Map<string, { name: string; quantity: number; total: number }>();
  const familyTotals = new Map<string, { familyId: string; name: string; orders: number; total: number }>();
  const typeTotals = new Map<string, { orders: number; total: number }>();
  for (const order of delivered) {
    const item = productTotals.get(order.productId) ?? { name: order.productName, quantity: 0, total: 0 };
    item.quantity += order.quantity; item.total += order.finalValue; productTotals.set(order.productId, item);
    const family = familyTotals.get(order.familyId) ?? { familyId: order.familyId, name: order.familyName, orders: 0, total: 0 }; family.orders += 1; family.total += order.finalValue; familyTotals.set(order.familyId, family);
    const type = typeTotals.get(order.category) ?? { orders: 0, total: 0 }; type.orders += 1; type.total += order.finalValue; typeTotals.set(order.category, type);
  }
  return {
    families, logs, orders, products,
    report: {
      cancelled: orders.filter((order) => order.status === "cancelled").length,
      delivered: delivered.length,
      familyTotals: [...familyTotals.values()].sort((a, b) => b.total - a.total),
      open: orders.filter((order) => ["open", "pending_approval", "approved"].includes(order.status)).length,
      productTotals: [...productTotals.entries()].map(([productId, value]) => ({ productId, ...value })).sort((a, b) => b.quantity - a.quantity),
      production: orders.filter((order) => ["in_production", "ready"].includes(order.status)).length,
      totalProfit: delivered.reduce((sum, order) => sum + order.profit, 0),
      totalRevenue: delivered.reduce((sum, order) => sum + order.finalValue, 0)
      ,typeTotals: [...typeTotals.entries()].map(([type, value]) => ({ type, ...value })).sort((a, b) => b.total - a.total)
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

async function findWashingRuleForGrossValue(guildId: string, botId: string | null, grossValue: number) {
  const { fivemOrderProducts } = await getMongoCollections();
  const rules = await fivemOrderProducts.find({ ...scopeQuery(guildId, botId), active: true, type: "washing" }).sort({ minimumQuantity: -1, order: 1, createdAt: 1 }).limit(250).toArray();
  return rules.find((rule) => grossValue >= (rule.minimumQuantity ?? 1) && grossValue <= (rule.maximumQuantity ?? 1_000_000_000_000)) ?? null;
}

function normalizeSettings(value: FivemOrderSettingsDto): FivemOrderSettingsDto {
  return {
    ...value,
    adminRoleIds: normalizeSnowflakes(value.adminRoleIds), approvalChannelId: normalizeSnowflake(value.approvalChannelId), botId: normalizeBotId(value.botId),
    approveRoleIds: normalizeSnowflakes(value.approveRoleIds), editValueRoleIds: normalizeSnowflakes(value.editValueRoleIds),
    cancelRoleIds: normalizeSnowflakes(value.cancelRoleIds), color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#22c55e", createRoleIds: normalizeSnowflakes(value.createRoleIds),
    deliveryChannelId: normalizeSnowflake(value.deliveryChannelId), errorMessage: normalizeText(value.errorMessage, 500) || "Nao foi possivel criar a encomenda.", finishRoleIds: normalizeSnowflakes(value.finishRoleIds),
    enabledOrderModules: normalizeOrderModules(value.enabledOrderModules), footerText: normalizeText(value.footerText, 200), logChannelId: normalizeSnowflake(value.logChannelId), maxOpenHours: clampNumber(value.maxOpenHours, 1, 8760, 72),
    orderCancelledMessage: normalizeText(value.orderCancelledMessage, 500) || "Encomenda cancelada.", orderCreatedMessage: normalizeText(value.orderCreatedMessage, 500) || "Encomenda criada.",
    orderDeliveredMessage: normalizeText(value.orderDeliveredMessage, 500) || "Encomenda entregue.", panelChannelId: normalizeSnowflake(value.panelChannelId), panelDescription: normalizeText(value.panelDescription, 1500) || "Escolha um produto para criar uma encomenda.",
    panelMessageId: normalizeSnowflake(value.panelMessageId), panelTitle: normalizeText(value.panelTitle, 120) || "Encomendas RP"
  };
}

function normalizeProduct(value: Partial<FivemOrderProductDto>, guildId: string, botId: string | null): Omit<MongoFivemOrderProduct, "_id" | "createdAt" | "updatedAt"> {
  const type = ["washing", "ammo", "drug", "weapon", "custom"].includes(value.type ?? "") ? value.type as MongoFivemOrderProduct["type"] : "standard";
  return {
    active: value.active !== false, allowCustomQuantity: value.allowCustomQuantity !== false, allowNotes: value.allowNotes !== false, botId,
    category: normalizeText(value.category, 80) || (type === "washing" ? "Lavagem" : type === "ammo" ? "Municao" : type === "weapon" ? "Armas" : "Outros"),
    config: normalizeProductConfig(value.config),
    cost: money(value.cost), description: normalizeText(value.description, 500), emoji: normalizeText(value.emoji, 80), factionPercentage: clampNumber(value.factionPercentage, 0, 100, type === "washing" ? 20 : 0),
    defaultQuantity: clampNumber(value.defaultQuantity, 1, 1_000_000, 1), featured: value.featured === true, guildId, maximumQuantity: clampNumber(value.maximumQuantity, 1, 1_000_000, 1_000_000), minimumQuantity: clampNumber(value.minimumQuantity, 1, 1_000_000, 1), name: normalizeText(value.name, 100) || "Novo produto",
    order: clampNumber(value.order, 0, 10000, 0), price: money(value.price), sellerPercentage: clampNumber(value.sellerPercentage, 0, 100, 0),
    type,
    washingPercentages: normalizePercentages(value.washingPercentages, value.factionPercentage, type)
  };
}

function normalizeProductConfig(value: MongoFivemOrderProduct["config"] | undefined): MongoFivemOrderProduct["config"] {
  if (!value) return undefined;
  const config = {
    adminRoleIds: normalizeSnowflakes(value.adminRoleIds),
    allowAttachments: value.allowAttachments ?? null,
    allowCustomNotes: value.allowCustomNotes ?? null,
    approvalChannelId: normalizeSnowflake(value.approvalChannelId),
    approvalRequired: value.approvalRequired ?? null,
    approveRoleIds: normalizeSnowflakes(value.approveRoleIds),
    cancelRoleIds: normalizeSnowflakes(value.cancelRoleIds),
    color: value.color && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : null,
    createRoleIds: normalizeSnowflakes(value.createRoleIds),
    deliveryChannelId: normalizeSnowflake(value.deliveryChannelId),
    finishRoleIds: normalizeSnowflakes(value.finishRoleIds),
    footerText: normalizeText(value.footerText, 200),
    logChannelId: normalizeSnowflake(value.logChannelId),
    orderCancelledMessage: normalizeText(value.orderCancelledMessage, 500),
    orderCreatedMessage: normalizeText(value.orderCreatedMessage, 500),
    orderDeliveredMessage: normalizeText(value.orderDeliveredMessage, 500)
  };
  return config;
}

function mergeProductSettings(settings: FivemOrderSettingsDto, product: MongoFivemOrderProduct): FivemOrderSettingsDto {
  const config = product.config;
  if (!config) return settings;
  return {
    ...settings,
    adminRoleIds: config.adminRoleIds?.length ? config.adminRoleIds : settings.adminRoleIds,
    allowAttachments: config.allowAttachments ?? settings.allowAttachments,
    allowCustomNotes: config.allowCustomNotes ?? settings.allowCustomNotes,
    approvalChannelId: config.approvalChannelId ?? settings.approvalChannelId,
    approvalRequired: config.approvalRequired ?? settings.approvalRequired,
    approveRoleIds: config.approveRoleIds?.length ? config.approveRoleIds : settings.approveRoleIds,
    cancelRoleIds: config.cancelRoleIds?.length ? config.cancelRoleIds : settings.cancelRoleIds,
    color: config.color ?? settings.color,
    createRoleIds: config.createRoleIds?.length ? config.createRoleIds : settings.createRoleIds,
    deliveryChannelId: config.deliveryChannelId ?? settings.deliveryChannelId,
    finishRoleIds: config.finishRoleIds?.length ? config.finishRoleIds : settings.finishRoleIds,
    footerText: config.footerText ?? settings.footerText,
    logChannelId: config.logChannelId ?? settings.logChannelId,
    orderCancelledMessage: config.orderCancelledMessage ?? settings.orderCancelledMessage,
    orderCreatedMessage: config.orderCreatedMessage ?? settings.orderCreatedMessage,
    orderDeliveredMessage: config.orderDeliveredMessage ?? settings.orderDeliveredMessage
  };
}

function toSettingsDto(row: MongoFivemOrderSettings): FivemOrderSettingsDto { const { _id: _id, updatedAt, ...rest } = row; return { ...defaultFivemOrderSettings(row.guildId, row.botId), ...rest, approveRoleIds: row.approveRoleIds ?? [], editValueRoleIds: row.editValueRoleIds ?? [], enabledOrderModules: normalizeOrderModules(row.enabledOrderModules), panelImage: null, updatedAt: updatedAt?.toISOString() ?? null }; }
function toFamilyDto(row: MongoFivemOrderFamily): FivemOrderFamilyDto { const { _id, createdAt, updatedAt, ...rest } = row; return { ...rest, orderModules: normalizeOrderModules(row.orderModules ?? []), createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() }; }
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
function normalizeFamily(value: Partial<FivemOrderFamilyDto>, guildId: string, botId: string | null): Omit<MongoFivemOrderFamily, "_id" | "createdAt" | "updatedAt"> { return { active: value.active !== false, botId, guildId, logChannelId: normalizeSnowflake(value.logChannelId), name: normalizeText(value.name, 100) || "Nova familia", notes: normalizeText(value.notes, 1000), orderModules: normalizeOrderModules(value.orderModules ?? []), responsibleId: normalizeSnowflake(value.responsibleId) ?? "", roleId: normalizeSnowflake(value.roleId) ?? "" }; }
function normalizeOrderModules(values: FivemOrderSettingsDto["enabledOrderModules"] | undefined) { const allowed = new Set(["washing", "ammo", "drug", "weapon", "custom"]); const result = [...new Set(values ?? ["washing", "ammo", "drug", "weapon", "custom"])].filter((value): value is "washing" | "ammo" | "drug" | "weapon" | "custom" => allowed.has(value)); return result; }
function clampNumber(value: number | null | undefined, min: number, max: number, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function money(value: number | null | undefined) { return roundMoney(clampNumber(value, 0, 1_000_000_000_000, 0)); }
function roundMoney(value: number) { return Math.round(value * 100) / 100; }
function normalizePercentages(values: number[] | undefined, fallback: number | undefined, type: MongoFivemOrderProduct["type"]) { if (type !== "washing") return []; const normalized = [...new Set([...(values ?? []), clampNumber(fallback, 0, 100, 20)].map((item) => clampNumber(item, 0, 100, 0)))].sort((a, b) => a - b).slice(0, 25); return normalized.length ? normalized : [20]; }
function resolveWashingPercentage(product: MongoFivemOrderProduct, requested: number | null | undefined) { const allowed = normalizePercentages(product.washingPercentages, product.factionPercentage, "washing"); const selected = requested ?? product.factionPercentage ?? allowed[0] ?? 20; if (!allowed.includes(selected)) throw orderError("Percentual de lavagem nao permitido.", 400); return selected; }
function orderError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
