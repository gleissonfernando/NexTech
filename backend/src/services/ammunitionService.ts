import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoAmmunitionConfig,
  type MongoAmmunitionMessageLog,
  type MongoAmmunitionOrder,
  type MongoAmmunitionOrderItem,
  type MongoAmmunitionPermissionType,
  type MongoAmmunitionRole,
  type MongoAmmunitionType,
  type MongoFivemFinanceSettings
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { authorizeBotRuntimeModule } from "./devBotService";
import { createFivemFinanceTransaction, getFivemFinanceSettings } from "./fivemFinanceService";

export const AMMUNITION_MODULE_ID = "fivem-ammunition";
const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const DEFAULT_COMPLETED_DELETE_DELAY_SECONDS = 300;
const DEFAULT_CANCELLED_DELETE_DELAY_SECONDS = 300;
const MAX_QUANTITY = 1_000_000;

export type AmmunitionConfigDto = Omit<MongoAmmunitionConfig, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  id: string;
  roles: Record<MongoAmmunitionPermissionType, string[]>;
  updatedAt: string;
};

export type AmmunitionFactionDto = {
  emoji: string | null;
  id: string;
  name: string;
};

export type AmmunitionTypeDto = Omit<MongoAmmunitionType, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  id: string;
  updatedAt: string;
};

export type AmmunitionOrderDto = Omit<MongoAmmunitionOrder, "_id" | "createdAt" | "updatedAt" | "completedAt" | "cancelledAt" | "processingStartedAt" | "items"> & {
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  id: string;
  items: Array<Omit<MongoAmmunitionOrderItem, "updatedAt"> & { updatedAt: string }>;
  processingStartedAt: string | null;
  updatedAt: string;
};

export type SaveAmmunitionConfigInput = Partial<{
  cancelledChannelDeleteDelaySeconds: number;
  completedChannelDeleteDelaySeconds: number;
  enabled: boolean;
  logChannelId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  roles: Partial<Record<MongoAmmunitionPermissionType, string[]>>;
  sellerFactionId: string | null;
  temporaryCategoryId: string | null;
  timezone: string | null;
  unitPriceInCents: number | null;
  ammunitionTypes: Array<{ active?: boolean; aliases?: string[]; id?: string; name: string; unitPriceInCents?: number | null }>;
}>;

export type CreateAmmunitionOrderInput = {
  buyerFactionId: string;
  openedByUserId: string;
  quantity?: number;
  sellerUserId: string;
};

export type ApplyAmmunitionOrderItemsInput = {
  actorId: string;
  items: Array<{ ammunitionTypeId: string; quantity: number }>;
  messageContent?: string | null;
  messageId?: string | null;
};

export async function getAmmunitionDashboard(guildId: string, botId: string | null) {
  const [config, factions, orders, ammunitionTypes] = await Promise.all([
    getAmmunitionConfig(guildId, botId),
    listAmmunitionFactions(guildId, botId),
    listAmmunitionOrders(guildId, botId, 100),
    listAmmunitionTypes(guildId, botId, false)
  ]);
  return { ammunitionTypes, config, factions, orders, weeklySummary: await getAmmunitionWeeklySummary(guildId, botId) };
}

export async function getAmmunitionRuntime(guildId: string, botId: string | null) {
  if (botId) await authorizeBotRuntimeModule({ botId, guildId, moduleId: AMMUNITION_MODULE_ID });
  const [config, factions, orders, ammunitionTypes] = await Promise.all([
    getAmmunitionConfig(guildId, botId),
    listAmmunitionFactions(guildId, botId),
    listAmmunitionOrders(guildId, botId, 50),
    listAmmunitionTypes(guildId, botId, false)
  ]);
  return { ammunitionTypes, config, factions, orders };
}

export async function getAmmunitionConfig(guildId: string, botId: string | null) {
  const { ammunitionConfigs, ammunitionRoles } = await getMongoCollections();
  const row = await ammunitionConfigs.findOne(scope(guildId, botId));
  const config = row ?? defaultConfig(guildId, botId);
  const roles = await ammunitionRoles.find(scope(guildId, botId)).toArray();
  return toConfigDto(config, roles);
}

export async function saveAmmunitionConfig(guildId: string, botId: string | null, input: SaveAmmunitionConfigInput, actorId: string | null, origin: "DASHBOARD" | "DISCORD" | "SYSTEM") {
  const current = await getAmmunitionConfig(guildId, botId);
  const now = new Date();
  const next = normalizeConfig({ ...current, ...input, botId, guildId, timezone: input.timezone ?? current.timezone }, now, actorId);
  const { ammunitionConfigs, ammunitionRoles } = await getMongoCollections();
  await ensureGuild(guildId);
  await ammunitionConfigs.updateOne(scope(guildId, botId), {
    $set: next,
    $setOnInsert: { _id: current.id, createdAt: now }
  }, { upsert: true });

  if (input.roles) {
    for (const permissionType of permissionTypes()) {
      if (!input.roles[permissionType]) continue;
      await ammunitionRoles.deleteMany({ ...scope(guildId, botId), permissionType });
      const roleIds = normalizeSnowflakes(input.roles[permissionType]);
      if (roleIds.length) {
        await ammunitionRoles.insertMany(roleIds.map((roleId): MongoAmmunitionRole => ({
          _id: randomUUID(),
          botId,
          createdAt: now,
          guildId,
          permissionType,
          roleId
        })), { ordered: false }).catch((error) => {
          if (!isDuplicateKeyError(error)) throw error;
        });
      }
    }
  }

  if (input.ammunitionTypes) {
    await saveAmmunitionTypes(guildId, botId, input.ammunitionTypes);
  }

  await audit("config.updated", guildId, botId, null, actorId, origin, { input });
  emitAmmunitionUpdated(guildId, botId);
  return getAmmunitionConfig(guildId, botId);
}

export async function listAmmunitionTypes(guildId: string, botId: string | null, activeOnly = true): Promise<AmmunitionTypeDto[]> {
  const { ammunitionTypes } = await getMongoCollections();
  const rows = await ammunitionTypes.find({ ...scope(guildId, botId), ...(activeOnly ? { active: true } : {}) }).sort({ name: 1 }).toArray();
  return rows.map(toTypeDto);
}

export async function updateAmmunitionPanelState(guildId: string, botId: string | null, messageId: string | null) {
  return saveAmmunitionConfig(guildId, botId, { panelMessageId: normalizeSnowflake(messageId) }, null, "SYSTEM");
}

export async function requestAmmunitionPanelPublish(guildId: string, botId: string | null) {
  const config = await getAmmunitionConfig(guildId, botId);
  if (botId) emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:ammunition:panel_publish", { botId, guildId });
  return config;
}

export async function listAmmunitionFactions(guildId: string, botId: string | null): Promise<AmmunitionFactionDto[]> {
  const { fivemFinanceSettings } = await getMongoCollections();
  const rows = await fivemFinanceSettings.find({ guildId, ...(botId ? { botId } : {}), enabled: true }).sort({ factionName: 1 }).toArray();
  return rows.map((row) => ({
    emoji: null,
    id: row.factionId || "default",
    name: row.factionName || "Caixa da Facção"
  }));
}

export async function listAmmunitionOrders(guildId: string, botId: string | null, limit = 100) {
  const { ammunitionOrders } = await getMongoCollections();
  const rows = await ammunitionOrders.find(scope(guildId, botId)).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 250)).toArray();
  return rows.map(toOrderDto);
}

export async function createAmmunitionOrder(guildId: string, botId: string | null, input: CreateAmmunitionOrderInput) {
  const config = await getAmmunitionConfig(guildId, botId);
  assertConfigReady(config);
  const seller = await getFivemFinanceSettings(guildId, botId, config.sellerFactionId);
  assertSellerCashReady(seller);
  const buyer = (await listAmmunitionFactions(guildId, botId)).find((item) => item.id === input.buyerFactionId);
  if (!buyer) throw serviceError("FAC compradora não encontrada ou sem caixa ativo.", 400);
  const now = new Date();
  const { ammunitionOrders } = await getMongoCollections();
  const last = await ammunitionOrders.findOne(scope(guildId, botId), { sort: { orderNumber: -1 } });
  const orderNumber = (last?.orderNumber ?? 0) + 1;
  const orderId = randomUUID();
  const unitPriceInCents = config.unitPriceInCents ?? 0;
  const quantity = input.quantity ? normalizeQuantity(input.quantity) : 0;
  const totalValueInCents = unitPriceInCents * quantity;
  const order: MongoAmmunitionOrder = {
    _id: orderId,
    botId,
    buyerFactionId: buyer.id,
    buyerFactionName: buyer.name,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelReason: null,
    cashIdempotencyKey: `municao:${guildId}:${orderId}`,
    cashTransactionId: null,
    completedAt: null,
    completedByUserId: null,
    createdAt: now,
    guildId,
    openedByUserId: input.openedByUserId,
    orderNumber,
    panelMessageId: null,
    itemEditingLocked: false,
    items: [],
    processingStartedAt: null,
    quantity,
    sellerFactionId: seller.factionId || config.sellerFactionId || "default",
    sellerFactionName: seller.factionName || "Caixa da Facção",
    sellerUserId: input.sellerUserId,
    status: "PENDING",
    temporaryChannelId: null,
    totalValueInCents,
    unitPriceInCents,
    updatedAt: now
  };
  await ammunitionOrders.insertOne(order);
  await audit("order.created", guildId, botId, order._id, input.openedByUserId, "DISCORD", { quantity, totalValueInCents });
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(order);
}

export async function findPendingAmmunitionOrderByChannel(guildId: string, botId: string | null, channelId: string) {
  const { ammunitionOrders } = await getMongoCollections();
  const row = await ammunitionOrders.findOne({ ...scope(guildId, botId), temporaryChannelId: channelId, status: "PENDING" });
  return row ? toOrderDto(row) : null;
}

export async function applyAmmunitionOrderItems(guildId: string, botId: string | null, orderId: string, input: ApplyAmmunitionOrderItemsInput) {
  const { ammunitionOrders } = await getMongoCollections();
  const order = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId), status: "PENDING" });
  if (!order) throw serviceError("Encomenda pendente não encontrada.", 404);
  if (order.itemEditingLocked) throw serviceError("A edição de itens está bloqueada.", 409);
  const types = await listAmmunitionTypes(guildId, botId, true);
  const typeById = new Map(types.map((type) => [type.id, type]));
  const now = new Date();
  const items = new Map((order.items ?? []).map((item) => [item.ammunitionTypeId, item]));
  for (const requested of input.items) {
    const type = typeById.get(requested.ammunitionTypeId);
    if (!type) continue;
    const quantity = normalizeQuantity(requested.quantity);
    const unitPriceInCents = type.unitPriceInCents ?? order.unitPriceInCents;
    const current = items.get(type.id);
    const nextQuantity = (current?.quantity ?? 0) + quantity;
    items.set(type.id, buildOrderItem(type, nextQuantity, unitPriceInCents, now));
  }
  const nextItems = [...items.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const totals = calculateOrderTotals(nextItems);
  const updated = await ammunitionOrders.findOneAndUpdate(
    { _id: orderId, ...scope(guildId, botId), status: "PENDING", itemEditingLocked: false },
    { $set: { items: nextItems, quantity: totals.quantity, totalValueInCents: totals.totalValueInCents, updatedAt: now } },
    { returnDocument: "after" }
  );
  await logOrderMessage(guildId, botId, order, input.messageId, input.actorId, input.messageContent, "ADD_ITEMS", { items: input.items });
  await audit("order.items_added", guildId, botId, orderId, input.actorId, "DISCORD", { items: input.items });
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(updated ?? order);
}

export async function removeAmmunitionOrderItem(guildId: string, botId: string | null, orderId: string, actorId: string, ammunitionTypeId: string, messageId?: string | null, content?: string | null) {
  const { ammunitionOrders } = await getMongoCollections();
  const order = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId), status: "PENDING" });
  if (!order) throw serviceError("Encomenda pendente não encontrada.", 404);
  if (order.itemEditingLocked) throw serviceError("A edição de itens está bloqueada.", 409);
  const nextItems = (order.items ?? []).filter((item) => item.ammunitionTypeId !== ammunitionTypeId);
  const totals = calculateOrderTotals(nextItems);
  const updated = await ammunitionOrders.findOneAndUpdate(
    { _id: orderId, ...scope(guildId, botId), status: "PENDING", itemEditingLocked: false },
    { $set: { items: nextItems, quantity: totals.quantity, totalValueInCents: totals.totalValueInCents, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  await logOrderMessage(guildId, botId, order, messageId, actorId, content, "REMOVE_ITEM", { ammunitionTypeId });
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(updated ?? order);
}

export async function clearAmmunitionOrderItems(guildId: string, botId: string | null, orderId: string, actorId: string, messageId?: string | null, content?: string | null) {
  const { ammunitionOrders } = await getMongoCollections();
  const order = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId), status: "PENDING" });
  if (!order) throw serviceError("Encomenda pendente não encontrada.", 404);
  if (order.itemEditingLocked) throw serviceError("A edição de itens está bloqueada.", 409);
  const updated = await ammunitionOrders.findOneAndUpdate(
    { _id: orderId, ...scope(guildId, botId), status: "PENDING", itemEditingLocked: false },
    { $set: { items: [], quantity: 0, totalValueInCents: 0, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  await logOrderMessage(guildId, botId, order, messageId, actorId, content, "CLEAR_ITEMS", {});
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(updated ?? order);
}

export async function setAmmunitionOrderItemLock(guildId: string, botId: string | null, orderId: string, actorId: string, locked: boolean, messageId?: string | null, content?: string | null) {
  const { ammunitionOrders } = await getMongoCollections();
  const order = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId), status: "PENDING" });
  if (!order) throw serviceError("Encomenda pendente não encontrada.", 404);
  if (locked && calculateOrderTotals(order.items ?? []).quantity <= 0) throw serviceError("Adicione ao menos uma munição válida antes de finalizar.", 409);
  const updated = await ammunitionOrders.findOneAndUpdate(
    { _id: orderId, ...scope(guildId, botId), status: "PENDING" },
    { $set: { itemEditingLocked: locked, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  await logOrderMessage(guildId, botId, order, messageId, actorId, content, locked ? "FINALIZE_ORDER" : "REOPEN_ORDER", {});
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(updated ?? order);
}

export async function recordAmmunitionOrderMessage(guildId: string, botId: string | null, orderId: string, input: { action: MongoAmmunitionMessageLog["action"]; actorId: string; messageContent?: string | null; messageId?: string | null; metadata?: Record<string, unknown> }) {
  const { ammunitionOrders } = await getMongoCollections();
  const order = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId) });
  if (!order) throw serviceError("Encomenda não encontrada.", 404);
  await logOrderMessage(guildId, botId, order, input.messageId, input.actorId, input.messageContent, input.action, input.metadata ?? {});
  return toOrderDto(order);
}

export async function updateAmmunitionOrderChannel(guildId: string, botId: string | null, orderId: string, input: { panelMessageId?: string | null; temporaryChannelId?: string | null }) {
  const { ammunitionOrders } = await getMongoCollections();
  const update = {
    ...(input.panelMessageId !== undefined ? { panelMessageId: normalizeSnowflake(input.panelMessageId) } : {}),
    ...(input.temporaryChannelId !== undefined ? { temporaryChannelId: normalizeSnowflake(input.temporaryChannelId) } : {}),
    updatedAt: new Date()
  };
  const row = await ammunitionOrders.findOneAndUpdate({ _id: orderId, ...scope(guildId, botId) }, { $set: update }, { returnDocument: "after" });
  if (!row) throw serviceError("Encomenda não encontrada.", 404);
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(row);
}

export async function completeAmmunitionOrder(guildId: string, botId: string | null, orderId: string, actor: { id: string; name: string; avatarUrl?: string | null }) {
  const { ammunitionOrders } = await getMongoCollections();
  const now = new Date();
  const processing = await ammunitionOrders.findOneAndUpdate(
    { _id: orderId, ...scope(guildId, botId), status: "PENDING" },
    { $set: { processingStartedAt: now, status: "PROCESSING", updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!processing) {
    const existing = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId) });
    if (!existing) throw serviceError("Encomenda não encontrada.", 404);
    if (existing.status === "DELIVERED") return toOrderDto(existing);
    throw serviceError(`Encomenda não está pendente (status atual: ${existing.status}).`, 409);
  }
  if (!processing.itemEditingLocked || calculateOrderTotals(processing.items ?? []).quantity <= 0) {
    await ammunitionOrders.updateOne({ _id: orderId, ...scope(guildId, botId), status: "PROCESSING" }, {
      $set: { processingStartedAt: null, status: "PENDING", updatedAt: new Date() }
    });
    throw serviceError("Finalize o pedido com ao menos uma munição válida antes da entrega.", 409);
  }

  try {
    const transaction = await createFivemFinanceTransaction({
      amount: processing.totalValueInCents / 100,
      amountCents: processing.totalValueInCents,
      factionId: processing.sellerFactionId,
      factionName: processing.sellerFactionName,
      guildId,
      metadata: {
        ammunitionOrderId: processing._id,
        ammunitionOrderNumber: processing.orderNumber,
        origin: "VENDA_MUNICAO",
        reference: processing.cashIdempotencyKey
      },
      personName: actor.name,
      proofImageUrl: "",
      reason: `Venda de munição - encomenda #${processing.orderNumber}`,
      targetUserId: processing.openedByUserId,
      type: "add",
      userAvatar: actor.avatarUrl ?? null,
      userId: actor.id,
      username: actor.name,
      managerId: actor.id,
      managerName: actor.name
    }, botId);
    const completedAt = new Date();
    const completed = await ammunitionOrders.findOneAndUpdate(
      { _id: orderId, ...scope(guildId, botId), status: "PROCESSING" },
      {
        $set: {
          cashTransactionId: transaction.transactionId,
          completedAt,
          completedByUserId: actor.id,
          status: "DELIVERED",
          updatedAt: completedAt
        }
      },
      { returnDocument: "after" }
    );
    await audit("order.delivered", guildId, botId, orderId, actor.id, "DISCORD", { cashTransactionId: transaction.transactionId });
    emitAmmunitionUpdated(guildId, botId);
    return toOrderDto(completed ?? processing);
  } catch (error) {
    await ammunitionOrders.updateOne({ _id: orderId, ...scope(guildId, botId), status: "PROCESSING" }, {
      $set: { processingStartedAt: null, status: "PENDING", updatedAt: new Date() }
    });
    await audit("order.cash_failed", guildId, botId, orderId, actor.id, "SYSTEM", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function cancelAmmunitionOrder(guildId: string, botId: string | null, orderId: string, actorId: string, reason: string | null = null) {
  const { ammunitionOrders } = await getMongoCollections();
  const now = new Date();
  const row = await ammunitionOrders.findOneAndUpdate(
    { _id: orderId, ...scope(guildId, botId), status: "PENDING" },
    { $set: { cancelledAt: now, cancelledByUserId: actorId, cancelReason: normalizeText(reason, 500), status: "CANCELLED", updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!row) {
    const existing = await ammunitionOrders.findOne({ _id: orderId, ...scope(guildId, botId) });
    if (!existing) throw serviceError("Encomenda não encontrada.", 404);
    throw serviceError(`Encomenda não pode ser cancelada no status ${existing.status}.`, 409);
  }
  await audit("order.cancelled", guildId, botId, orderId, actorId, "DISCORD", { reason });
  emitAmmunitionUpdated(guildId, botId);
  return toOrderDto(row);
}

export async function getAmmunitionWeeklySummary(guildId: string, botId: string | null, reference = new Date()) {
  const config = await getAmmunitionConfig(guildId, botId);
  const { start, end } = weekWindow(reference, config.timezone || DEFAULT_TIMEZONE);
  const { ammunitionOrders } = await getMongoCollections();
  const rows = await ammunitionOrders.find({
    ...scope(guildId, botId),
    completedAt: { $gte: start, $lte: end },
    status: "DELIVERED"
  }).sort({ completedAt: -1 }).toArray();
  return summarizeAmmunitionOrders(rows, config, start, end);
}

export function summarizeAmmunitionOrders(rows: MongoAmmunitionOrder[], config: Pick<AmmunitionConfigDto, "sellerFactionId">, start: Date, end: Date) {
  const byBuyer = group(rows, (row) => row.buyerFactionId, (row) => row.buyerFactionName);
  const bySeller = group(rows, (row) => row.sellerUserId, (row) => row.sellerUserId);
  return {
    buyers: byBuyer,
    end: end.toISOString(),
    orderCount: rows.length,
    sellerFactionId: config.sellerFactionId,
    sellerFactionName: rows[0]?.sellerFactionName ?? null,
    sellers: bySeller,
    start: start.toISOString(),
    totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalValueInCents: rows.reduce((sum, row) => sum + row.totalValueInCents, 0)
  };
}

function assertConfigReady(config: AmmunitionConfigDto) {
  if (!config.enabled) throw serviceError("Sistema de Venda de Munição desativado.", 403);
  if (!config.sellerFactionId) throw serviceError("Configure a FAC vendedora.", 409);
  if (!config.temporaryCategoryId) throw serviceError("Configure a categoria dos canais temporários.", 409);
  if (!config.logChannelId) throw serviceError("Configure o canal de logs.", 409);
  if (!config.unitPriceInCents || config.unitPriceInCents <= 0) throw serviceError("Configure o valor unitário da munição.", 409);
}

function assertSellerCashReady(settings: Awaited<ReturnType<typeof getFivemFinanceSettings>>) {
  if (!settings.enabled) throw serviceError("Sistema de Caixa da FAC vendedora está desativado.", 409);
}

function defaultConfig(guildId: string, botId: string | null): MongoAmmunitionConfig {
  const now = new Date();
  return {
    _id: randomUUID(),
    botId,
    cancelledChannelDeleteDelaySeconds: DEFAULT_CANCELLED_DELETE_DELAY_SECONDS,
    completedChannelDeleteDelaySeconds: DEFAULT_COMPLETED_DELETE_DELAY_SECONDS,
    createdAt: now,
    currency: "BRL",
    enabled: false,
    guildId,
    logChannelId: null,
    panelChannelId: null,
    panelMessageId: null,
    sellerFactionId: null,
    temporaryCategoryId: null,
    timezone: DEFAULT_TIMEZONE,
    unitPriceInCents: null,
    updatedAt: now,
    updatedBy: null
  };
}

function normalizeConfig(input: SaveAmmunitionConfigInput & Pick<AmmunitionConfigDto,
  "botId" | "cancelledChannelDeleteDelaySeconds" | "completedChannelDeleteDelaySeconds" | "enabled" | "guildId" | "logChannelId" | "panelChannelId" | "panelMessageId" | "sellerFactionId" | "temporaryCategoryId" | "unitPriceInCents"
> & { timezone?: string | null }, now: Date, actorId: string | null): Omit<MongoAmmunitionConfig, "_id" | "createdAt"> {
  return {
    botId: input.botId,
    cancelledChannelDeleteDelaySeconds: clamp(input.cancelledChannelDeleteDelaySeconds, 0, 86_400, DEFAULT_CANCELLED_DELETE_DELAY_SECONDS),
    completedChannelDeleteDelaySeconds: clamp(input.completedChannelDeleteDelaySeconds, 0, 86_400, DEFAULT_COMPLETED_DELETE_DELAY_SECONDS),
    currency: "BRL",
    enabled: input.enabled === true,
    guildId: input.guildId,
    logChannelId: normalizeSnowflake(input.logChannelId),
    panelChannelId: normalizeSnowflake(input.panelChannelId),
    panelMessageId: normalizeSnowflake(input.panelMessageId),
    sellerFactionId: normalizeFactionId(input.sellerFactionId),
    temporaryCategoryId: normalizeSnowflake(input.temporaryCategoryId),
    timezone: normalizeText(input.timezone, 80) ?? DEFAULT_TIMEZONE,
    unitPriceInCents: normalizeNullableCents(input.unitPriceInCents),
    updatedAt: now,
    updatedBy: actorId
  };
}

function toConfigDto(config: MongoAmmunitionConfig, roles: MongoAmmunitionRole[]): AmmunitionConfigDto {
  return {
    botId: config.botId,
    cancelledChannelDeleteDelaySeconds: config.cancelledChannelDeleteDelaySeconds,
    completedChannelDeleteDelaySeconds: config.completedChannelDeleteDelaySeconds,
    createdAt: config.createdAt.toISOString(),
    currency: config.currency,
    enabled: config.enabled,
    guildId: config.guildId,
    id: config._id,
    logChannelId: config.logChannelId,
    panelChannelId: config.panelChannelId,
    panelMessageId: config.panelMessageId,
    roles: Object.fromEntries(permissionTypes().map((type) => [type, roles.filter((role) => role.permissionType === type).map((role) => role.roleId)])) as AmmunitionConfigDto["roles"],
    sellerFactionId: config.sellerFactionId,
    temporaryCategoryId: config.temporaryCategoryId,
    timezone: config.timezone,
    unitPriceInCents: config.unitPriceInCents,
    updatedAt: config.updatedAt.toISOString(),
    updatedBy: config.updatedBy
  };
}

function toTypeDto(type: MongoAmmunitionType): AmmunitionTypeDto {
  const { _id, createdAt, updatedAt, ...rest } = type;
  return { ...rest, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() };
}

function toOrderDto(order: MongoAmmunitionOrder): AmmunitionOrderDto {
  const { _id, createdAt, updatedAt, completedAt, cancelledAt, processingStartedAt, ...rest } = order;
  return {
    ...rest,
    cancelledAt: cancelledAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    id: _id,
    itemEditingLocked: order.itemEditingLocked === true,
    items: (order.items ?? []).map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
    processingStartedAt: processingStartedAt?.toISOString() ?? null,
    updatedAt: updatedAt.toISOString()
  };
}

async function saveAmmunitionTypes(guildId: string, botId: string | null, input: SaveAmmunitionConfigInput["ammunitionTypes"]) {
  if (!input) return;
  const { ammunitionTypes } = await getMongoCollections();
  const now = new Date();
  const seen = new Set<string>();
  for (const raw of input) {
    const name = normalizeText(raw.name, 80);
    if (!name) continue;
    const normalizedName = normalizeLookup(name);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const aliases = [...new Set((raw.aliases ?? []).map((alias) => normalizeText(alias, 80)).filter((alias): alias is string => Boolean(alias)))];
    const existing = raw.id ? await ammunitionTypes.findOne({ _id: raw.id, ...scope(guildId, botId) }) : await ammunitionTypes.findOne({ ...scope(guildId, botId), normalizedName });
    const id = existing?._id ?? randomUUID();
    await ammunitionTypes.updateOne({ _id: id, ...scope(guildId, botId) }, {
      $set: {
        active: raw.active !== false,
        aliases,
        botId,
        guildId,
        name,
        normalizedName,
        updatedAt: now,
        unitPriceInCents: normalizeNullableCents(raw.unitPriceInCents)
      },
      $setOnInsert: { _id: id, createdAt: now }
    }, { upsert: true });
  }
}

function buildOrderItem(type: AmmunitionTypeDto, quantity: number, unitPriceInCents: number, updatedAt: Date): MongoAmmunitionOrderItem {
  return {
    ammunitionTypeId: type.id,
    name: type.name,
    quantity,
    subtotalInCents: quantity * unitPriceInCents,
    unitPriceInCents,
    updatedAt
  };
}

function calculateOrderTotals(items: MongoAmmunitionOrderItem[]) {
  return {
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalValueInCents: items.reduce((sum, item) => sum + item.subtotalInCents, 0)
  };
}

async function logOrderMessage(guildId: string, botId: string | null, order: MongoAmmunitionOrder, messageId: string | null | undefined, actorId: string, content: string | null | undefined, action: MongoAmmunitionMessageLog["action"], metadata: Record<string, unknown>) {
  if (!messageId || !order.temporaryChannelId) return;
  const { ammunitionMessageLogs } = await getMongoCollections();
  await ammunitionMessageLogs.insertOne({
    _id: randomUUID(),
    action,
    authorId: actorId,
    botId,
    channelId: order.temporaryChannelId,
    content: normalizeText(content, 1000) ?? "",
    createdAt: new Date(),
    guildId,
    metadata,
    messageId,
    orderId: order._id
  }).catch((error) => {
    if (!isDuplicateKeyError(error)) throw error;
  });
}

function group(rows: MongoAmmunitionOrder[], idOf: (row: MongoAmmunitionOrder) => string, nameOf: (row: MongoAmmunitionOrder) => string) {
  const values = new Map<string, { count: number; id: string; name: string; totalUnits: number; totalValueInCents: number }>();
  for (const row of rows) {
    const id = idOf(row);
    const current = values.get(id) ?? { count: 0, id, name: nameOf(row), totalUnits: 0, totalValueInCents: 0 };
    current.count += 1;
    current.totalUnits += row.quantity;
    current.totalValueInCents += row.totalValueInCents;
    values.set(id, current);
  }
  return [...values.values()].sort((a, b) => b.totalValueInCents - a.totalValueInCents);
}

function weekWindow(reference: Date, timeZone: string) {
  const local = new Date(reference.toLocaleString("en-US", { timeZone }));
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff);
  local.setHours(0, 0, 0, 0);
  const start = new Date(local);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function audit(action: string, guildId: string, botId: string | null, orderId: string | null, actorId: string | null, origin: "DASHBOARD" | "DISCORD" | "SYSTEM", metadata: Record<string, unknown>) {
  const { ammunitionAuditLogs } = await getMongoCollections();
  await ammunitionAuditLogs.insertOne({ _id: randomUUID(), action, actorId, botId, createdAt: new Date(), guildId, metadata, orderId, origin });
}

function emitAmmunitionUpdated(guildId: string, botId: string | null) {
  if (!botId) return;
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:ammunition:updated", { botId, guildId });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:ammunition:updated", { botId, guildId });
}

function permissionTypes(): MongoAmmunitionPermissionType[] {
  return ["CREATE_ORDER", "VIEW_CHANNEL", "COMPLETE_ORDER", "CANCEL_ORDER", "VIEW_REPORT", "MANAGE_CONFIG"];
}

function scope(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function normalizeQuantity(value: number) {
  const quantity = Math.trunc(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) throw serviceError(`Quantidade inválida. Informe um inteiro entre 1 e ${MAX_QUANTITY}.`, 400);
  return quantity;
}

function normalizeNullableCents(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const cents = Math.trunc(value);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function normalizeSnowflake(value: string | null | undefined) {
  return /^\d{5,32}$/.test(value?.trim() ?? "") ? value!.trim() : null;
}

function normalizeSnowflakes(values: string[] | undefined) {
  return [...new Set((values ?? []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))];
}

function normalizeFactionId(value: string | null | undefined) {
  return normalizeText(value, 120);
}

function normalizeText(value: string | null | undefined, max: number) {
  return value?.trim().slice(0, max) || null;
}

function normalizeLookup(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clamp(value: number | null | undefined, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function serviceError(message: string, status = 400) {
  const error = new Error(message) as Error & { status?: number; statusCode?: number };
  error.status = status;
  error.statusCode = status;
  return error;
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}
