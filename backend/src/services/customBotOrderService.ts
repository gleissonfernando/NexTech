import { randomUUID } from "node:crypto";
import type {
  MongoCustomBotOrder,
  MongoCustomBotOrderLog,
  MongoCustomBotOrderNote,
  MongoCustomBotOrderSettings,
  MongoCustomBotOrderStatus,
  MongoCustomBotOrderStatusDefinition
} from "../database/mongo";
import { fixedSystemEmojiText, normalizeFixedSystemEmojiText } from "../config/systemEmojis";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export const CUSTOM_BOT_ORDERS_MODULE_ID = "custom-bot-orders";
const FINAL_STATUSES = new Set(["FINISHED", "CANCELLED"]);

export type CustomBotOrderSettingsDto = Omit<MongoCustomBotOrderSettings, "_id" | "updatedAt"> & {
  id: string;
  updatedAt: string;
};

export type CustomBotOrderDto = Omit<MongoCustomBotOrder, "_id" | "assignedAt" | "closedAt" | "createdAt" | "lastNoticeAt" | "updatedAt"> & {
  assignedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  id: string;
  lastNoticeAt: string | null;
  updatedAt: string;
};

export type CustomBotOrderLogDto = Omit<MongoCustomBotOrderLog, "_id" | "createdAt"> & {
  id: string;
  createdAt: string;
};

export type CustomBotOrderNoteDto = Omit<MongoCustomBotOrderNote, "_id" | "createdAt"> & {
  id: string;
  createdAt: string;
};

export type SaveCustomBotOrderSettingsInput = Partial<Omit<MongoCustomBotOrderSettings, "_id" | "botId" | "guildId" | "panelMessageId" | "updatedAt" | "updatedBy">>;

export type CreateCustomBotOrderInput = {
  budget?: string | null;
  customerId: string;
  customerName?: string | null;
  deadline?: string | null;
  description: string;
  features: string;
  notes?: string | null;
  projectName: string;
  references?: string | null;
  type: string;
};

export type UpdateCustomBotOrderInput = Partial<{
  action: string;
  actorId: string | null;
  actorName: string | null;
  assignedStaffId: string | null;
  channelId: string | null;
  closeReason: string | null;
  closedById: string | null;
  notice: boolean;
  panelMessageId: string | null;
  result: string | null;
  status: MongoCustomBotOrderStatus | string;
  transcriptAdminText: string | null;
  transcriptChannelMessageId: string | null;
  transcriptCustomerText: string | null;
}>;

const DEFAULT_STATUSES: MongoCustomBotOrderStatusDefinition[] = [
  { color: "#facc15", dmEnabled: false, emoji: fixedSystemEmojiText("relogio"), id: "WAITING_STAFF", locked: true, name: "Aguardando atendimento", order: 1 },
  { color: "#3b82f6", dmEnabled: false, emoji: fixedSystemEmojiText("homem"), id: "IN_SERVICE", locked: true, name: "Em atendimento", order: 2 },
  { color: "#a855f7", dmEnabled: false, emoji: fixedSystemEmojiText("prancheta"), id: "ANALYZING", locked: true, name: "Analisando projeto", order: 3 },
  { color: "#f97316", dmEnabled: true, emoji: fixedSystemEmojiText("interrogacao"), id: "WAITING_CUSTOMER", locked: true, name: "Aguardando cliente", order: 4 },
  { color: "#22c55e", dmEnabled: true, emoji: fixedSystemEmojiText("dinheiro"), id: "WAITING_PAYMENT", locked: true, name: "Aguardando pagamento", order: 5 },
  { color: "#6366f1", dmEnabled: false, emoji: fixedSystemEmojiText("engrenagem"), id: "IN_DEVELOPMENT", locked: true, name: "Em desenvolvimento", order: 6 },
  { color: "#06b6d4", dmEnabled: false, emoji: fixedSystemEmojiText("visto"), id: "TESTING", locked: true, name: "Em testes", order: 7 },
  { color: "#22c55e", dmEnabled: true, emoji: fixedSystemEmojiText("visto"), id: "FINISHED", locked: true, name: "Finalizado", order: 8 },
  { color: "#ef4444", dmEnabled: true, emoji: fixedSystemEmojiText("exclamacao"), id: "CANCELLED", locked: true, name: "Cancelado", order: 9 }
];

export async function getCustomBotOrdersDashboard(guildId: string, botId: string | null) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  const { customBotOrderLogs, customBotOrderNotes, customBotOrders } = await getMongoCollections();
  const [orders, logs, notes] = await Promise.all([
    customBotOrders.find({ botId: settings.botId, guildId }).sort({ createdAt: -1 }).limit(200).toArray(),
    customBotOrderLogs.find({ botId: settings.botId, guildId }).sort({ createdAt: -1 }).limit(200).toArray(),
    customBotOrderNotes.find({ botId: settings.botId, guildId }).sort({ createdAt: -1 }).limit(200).toArray()
  ]);
  return {
    logs: logs.map(toLogDto),
    metrics: buildMetrics(orders),
    notes: notes.map(toNoteDto),
    orders: orders.map(toOrderDto),
    settings: toSettingsDto(settings)
  };
}

export async function getCustomBotOrderRuntime(guildId: string, botId: string | null) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  const { customBotOrders } = await getMongoCollections();
  const orders = await customBotOrders
    .find({ botId: settings.botId, guildId, status: { $nin: [...FINAL_STATUSES] } })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return {
    orders: orders.map(toOrderDto),
    settings: toSettingsDto(settings)
  };
}

export async function ensureCustomBotOrderSettings(guildId: string, botId: string | null) {
  const resolvedBotId = botId ?? "default";
  const { customBotOrderSettings } = await getMongoCollections();
  const existing = await customBotOrderSettings.findOne({ botId: resolvedBotId, guildId });
  if (existing) return existing;

  const now = new Date();
  const settings: MongoCustomBotOrderSettings = {
    _id: randomUUID(),
    adminRoleIds: [],
    allowMultipleActiveOrders: false,
    assignRoleIds: [],
    bannerUrl: null,
    botId: resolvedBotId,
    buttonEmoji: fixedSystemEmojiText("caixa"),
    buttonLabel: "Faça o seu pedido!",
    categoryId: null,
    closeRoleIds: [],
    color: "#8b5cf6",
    description: "Transforme sua ideia em um sistema completo, profissional e desenvolvido especialmente para o seu projeto.",
    enabled: false,
    footerImageUrl: null,
    footerText: "NexTech © Todos os direitos reservados.",
    guildId,
    introText: "Clique no botão abaixo, explique como deseja seu bot e aguarde o atendimento da nossa equipe.",
    logChannelId: null,
    maxActiveOrdersPerUser: 1,
    mentionRoleId: null,
    noticeCooldownMinutes: 5,
    panelChannelId: null,
    panelEmoji: fixedSystemEmojiText("robo"),
    panelMessageId: null,
    responsibleRoleIds: [],
    reviewChannelId: null,
    staffRoleIds: [],
    statusDefinitions: DEFAULT_STATUSES.map((status) => ({ ...status })),
    subtitle: "Desenvolvimento de Bots Personalizados",
    thumbnailUrl: null,
    title: "Bots Personalizados",
    transcriptChannelId: null,
    updatedAt: now,
    updatedBy: null
  };
  await customBotOrderSettings.insertOne(settings);
  return settings;
}

export async function saveCustomBotOrderSettings(guildId: string, botId: string | null, input: SaveCustomBotOrderSettingsInput, actorId: string | null) {
  const current = await ensureCustomBotOrderSettings(guildId, botId);
  const patch = normalizeSettingsInput(input);
  const { customBotOrderSettings } = await getMongoCollections();
  await customBotOrderSettings.updateOne({ _id: current._id }, { $set: { ...patch, updatedAt: new Date(), updatedBy: actorId } });
  const settings = (await customBotOrderSettings.findOne({ _id: current._id })) ?? current;
  await writeLog(settings, null, "settings_updated", "Configuração de pedidos de bots personalizados alterada.", actorId, null, { changedKeys: Object.keys(input) });
  emitUpdated(settings.botId, guildId);
  return toSettingsDto(settings);
}

export async function requestCustomBotOrderPanelPublish(guildId: string, botId: string | null, actorId: string | null) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "custom-bot-orders:panel_publish", { botId: settings.botId, guildId });
  await writeLog(settings, null, "panel_publish_requested", "Publicação do painel de pedidos de bots solicitada.", actorId, null);
  return toSettingsDto(settings);
}

export async function requestCustomBotOrderPanelDelete(guildId: string, botId: string | null, actorId: string | null) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  emitRealtimeToRoom(devBotRealtimeRoom(settings.botId), "custom-bot-orders:panel_delete", { botId: settings.botId, guildId });
  await writeLog(settings, null, "panel_delete_requested", "Exclusão do painel de pedidos de bots solicitada.", actorId, null);
  return toSettingsDto(settings);
}

export async function updateCustomBotOrderPanelState(guildId: string, botId: string | null, messageId: string | null) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  const { customBotOrderSettings } = await getMongoCollections();
  await customBotOrderSettings.updateOne({ _id: settings._id }, { $set: { panelMessageId: messageId, updatedAt: new Date() } });
  const updated = (await customBotOrderSettings.findOne({ _id: settings._id })) ?? settings;
  emitUpdated(updated.botId, guildId);
  return toSettingsDto(updated);
}

export async function deleteCustomBotOrderPanelState(guildId: string, botId: string | null) {
  return updateCustomBotOrderPanelState(guildId, botId, null);
}

export async function createCustomBotOrder(guildId: string, botId: string | null, input: CreateCustomBotOrderInput) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  if (!settings.enabled) throw httpError("Sistema de pedidos de bots personalizados desativado.", 403);

  const { customBotOrders } = await getMongoCollections();
  const activeCount = await customBotOrders.countDocuments({
    botId: settings.botId,
    customerId: input.customerId,
    guildId,
    status: { $nin: [...FINAL_STATUSES] }
  });
  const maxActive = settings.allowMultipleActiveOrders ? Math.max(1, settings.maxActiveOrdersPerUser) : 1;
  if (activeCount >= maxActive) {
    const active = await customBotOrders.findOne({
      botId: settings.botId,
      customerId: input.customerId,
      guildId,
      status: { $nin: [...FINAL_STATUSES] }
    }, { sort: { createdAt: -1 } });
    throw Object.assign(new Error("Você já possui um pedido em andamento."), {
      activeOrder: active ? toOrderDto(active) : null,
      statusCode: 409
    });
  }

  const now = new Date();
  const orderNumber = await nextOrderNumber(settings.botId, guildId);
  const order: MongoCustomBotOrder = {
    _id: randomUUID(),
    assignedAt: null,
    assignedStaffId: null,
    botId: settings.botId,
    budget: normalizeNullable(input.budget, 180),
    channelId: null,
    closedAt: null,
    closedById: null,
    closeReason: null,
    createdAt: now,
    customerId: input.customerId,
    customerName: normalizeNullable(input.customerName, 100),
    deadline: normalizeNullable(input.deadline, 180),
    description: normalizeText(input.description, 1800),
    features: normalizeText(input.features, 1500),
    guildId,
    lastNoticeAt: null,
    notes: normalizeNullable(input.notes, 800),
    orderNumber,
    panelMessageId: null,
    projectName: normalizeText(input.projectName, 120),
    references: normalizeNullable(input.references, 800),
    result: null,
    status: "WAITING_STAFF",
    ticketId: `PED-${String(orderNumber).padStart(4, "0")}`,
    type: normalizeText(input.type, 120),
    updatedAt: now
  };

  await customBotOrders.insertOne(order);
  await writeLog(settings, order, "order_created", "Pedido de bot personalizado aberto.", input.customerId, input.customerName ?? null);
  emitUpdated(settings.botId, guildId);
  return toOrderDto(order);
}

export async function updateCustomBotOrder(guildId: string, botId: string | null, orderId: string, input: UpdateCustomBotOrderInput) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  const { customBotOrders } = await getMongoCollections();
  const current = await customBotOrders.findOne({ _id: orderId, botId: settings.botId, guildId });
  if (!current) return null;

  const now = new Date();
  const patch: Partial<MongoCustomBotOrder> = {
    updatedAt: now
  };

  if ("assignedStaffId" in input) {
    patch.assignedStaffId = input.assignedStaffId ?? null;
    patch.assignedAt = input.assignedStaffId ? now : null;
    if (input.assignedStaffId && current.status === "WAITING_STAFF") patch.status = "IN_SERVICE";
  }
  if ("channelId" in input) patch.channelId = input.channelId ?? null;
  if ("panelMessageId" in input) patch.panelMessageId = input.panelMessageId ?? null;
  if ("status" in input && input.status) patch.status = input.status;
  if (input.notice) patch.lastNoticeAt = now;
  if ("closeReason" in input) patch.closeReason = normalizeNullable(input.closeReason, 800);
  if ("result" in input) patch.result = normalizeNullable(input.result, 800);
  if ("closedById" in input) patch.closedById = input.closedById ?? null;
  if ("transcriptCustomerText" in input) patch.transcriptCustomerText = normalizeNullable(input.transcriptCustomerText, 200_000);
  if ("transcriptAdminText" in input) patch.transcriptAdminText = normalizeNullable(input.transcriptAdminText, 250_000);
  if ("transcriptChannelMessageId" in input) patch.transcriptChannelMessageId = input.transcriptChannelMessageId ?? null;
  if ((patch.status && FINAL_STATUSES.has(String(patch.status))) || input.closedById) patch.closedAt = now;

  await customBotOrders.updateOne({ _id: current._id }, { $set: patch });
  const updated = (await customBotOrders.findOne({ _id: current._id })) ?? current;
  await writeLog(settings, updated, input.action ?? "order_updated", logMessageForAction(input.action, current.status, updated.status), input.actorId ?? null, input.actorName ?? null, {
    newStatus: updated.status,
    oldStatus: current.status
  });
  emitUpdated(settings.botId, guildId);
  return toOrderDto(updated);
}

export async function addCustomBotOrderNote(guildId: string, botId: string | null, orderId: string, input: { authorId: string; authorName?: string | null; content: string }) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  const { customBotOrderNotes, customBotOrders } = await getMongoCollections();
  const order = await customBotOrders.findOne({ _id: orderId, botId: settings.botId, guildId });
  if (!order) return null;
  const note: MongoCustomBotOrderNote = {
    _id: randomUUID(),
    authorId: input.authorId,
    authorName: normalizeNullable(input.authorName, 100),
    botId: settings.botId,
    content: normalizeText(input.content, 1500),
    createdAt: new Date(),
    guildId,
    orderId: order._id,
    ticketId: order.ticketId
  };
  await customBotOrderNotes.insertOne(note);
  await writeLog(settings, order, "internal_note_added", "Observação interna adicionada.", input.authorId, input.authorName ?? null);
  emitUpdated(settings.botId, guildId);
  return toNoteDto(note);
}

export async function listCustomBotOrderNotes(guildId: string, botId: string | null, orderId: string) {
  const settings = await ensureCustomBotOrderSettings(guildId, botId);
  const { customBotOrderNotes } = await getMongoCollections();
  const notes = await customBotOrderNotes.find({ botId: settings.botId, guildId, orderId }).sort({ createdAt: -1 }).toArray();
  return notes.map(toNoteDto);
}

function buildMetrics(orders: MongoCustomBotOrder[]) {
  const now = Date.now();
  const closed = orders.filter((order) => order.closedAt);
  const avgMs = closed.length
    ? Math.round(closed.reduce((sum, order) => sum + ((order.closedAt?.getTime() ?? now) - order.createdAt.getTime()), 0) / closed.length)
    : 0;
  return {
    cancelled: orders.filter((order) => order.status === "CANCELLED").length,
    finished: orders.filter((order) => order.status === "FINISHED").length,
    inDevelopment: orders.filter((order) => ["IN_DEVELOPMENT", "TESTING"].includes(String(order.status))).length,
    open: orders.filter((order) => !FINAL_STATUSES.has(String(order.status))).length,
    waitingCustomer: orders.filter((order) => order.status === "WAITING_CUSTOMER").length,
    waitingStaff: orders.filter((order) => order.status === "WAITING_STAFF").length,
    averageServiceMinutes: Math.round(avgMs / 60_000)
  };
}

async function nextOrderNumber(botId: string, guildId: string) {
  const { customBotOrders } = await getMongoCollections();
  const latest = await customBotOrders.find({ botId, guildId }).sort({ orderNumber: -1 }).limit(1).next();
  return (latest?.orderNumber ?? 0) + 1;
}

async function writeLog(
  settings: MongoCustomBotOrderSettings,
  order: MongoCustomBotOrder | null,
  event: string,
  message: string,
  actorId: string | null,
  actorName: string | null,
  metadata?: Record<string, unknown>
) {
  const log: MongoCustomBotOrderLog = {
    _id: randomUUID(),
    actorId,
    actorName: normalizeNullable(actorName, 100),
    botId: settings.botId,
    channelId: order?.channelId ?? null,
    createdAt: new Date(),
    customerId: order?.customerId ?? null,
    event,
    guildId: settings.guildId,
    message,
    metadata,
    orderId: order?._id ?? null,
    ticketId: order?.ticketId ?? null
  };
  const { customBotOrderLogs } = await getMongoCollections();
  await customBotOrderLogs.insertOne(log);
  await createLog({
    botId: settings.botId,
    channelId: order?.channelId ?? null,
    guildId: settings.guildId,
    message,
    metadata: { ...metadata, ticketId: order?.ticketId ?? null },
    module: CUSTOM_BOT_ORDERS_MODULE_ID,
    type: `custom_bot_orders.${event}`,
    userId: actorId
  }).catch(() => null);
  return log;
}

function emitUpdated(botId: string, guildId: string) {
  const payload = { botId, guildId };
  emitRealtime("custom-bot-orders:updated", payload);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "custom-bot-orders:updated", payload);
}

function normalizeSettingsInput(input: SaveCustomBotOrderSettingsInput): SaveCustomBotOrderSettingsInput {
  return {
    ...input,
    adminRoleIds: normalizeSnowflakes(input.adminRoleIds),
    assignRoleIds: normalizeSnowflakes(input.assignRoleIds),
    bannerUrl: normalizeNullable(input.bannerUrl, 2048),
    buttonEmoji: normalizeSystemEmoji(input.buttonEmoji) ?? undefined,
    buttonLabel: normalizeNullable(input.buttonLabel, 80) ?? undefined,
    categoryId: normalizeSnowflake(input.categoryId),
    closeRoleIds: normalizeSnowflakes(input.closeRoleIds),
    color: normalizeColor(input.color),
    description: normalizeNullable(input.description, 1800) ?? undefined,
    footerImageUrl: normalizeNullable(input.footerImageUrl, 2048),
    footerText: normalizeNullable(input.footerText, 180) ?? undefined,
    introText: normalizeNullable(input.introText, 1000) ?? undefined,
    logChannelId: normalizeSnowflake(input.logChannelId),
    maxActiveOrdersPerUser: clamp(input.maxActiveOrdersPerUser, 1, 10, 1),
    mentionRoleId: normalizeSnowflake(input.mentionRoleId),
    noticeCooldownMinutes: clamp(input.noticeCooldownMinutes, 1, 1440, 5),
    panelChannelId: normalizeSnowflake(input.panelChannelId),
    panelEmoji: normalizeSystemEmoji(input.panelEmoji) ?? undefined,
    responsibleRoleIds: normalizeSnowflakes(input.responsibleRoleIds),
    reviewChannelId: normalizeSnowflake(input.reviewChannelId),
    staffRoleIds: normalizeSnowflakes(input.staffRoleIds),
    statusDefinitions: normalizeStatuses(input.statusDefinitions),
    subtitle: normalizeNullable(input.subtitle, 160) ?? undefined,
    thumbnailUrl: normalizeNullable(input.thumbnailUrl, 2048),
    title: normalizeNullable(input.title, 120) ?? undefined,
    transcriptChannelId: normalizeSnowflake(input.transcriptChannelId)
  };
}

function normalizeStatuses(statuses: unknown): MongoCustomBotOrderStatusDefinition[] | undefined {
  if (!Array.isArray(statuses)) return undefined;
  const seen = new Set<string>();
  const next = statuses
    .map((item, index): MongoCustomBotOrderStatusDefinition | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = normalizeNullable(record.id, 80) ?? `custom-${index + 1}`;
      const name = normalizeNullable(record.name, 80);
      if (!name || seen.has(id)) return null;
      seen.add(id);
      return {
        color: normalizeColor(String(record.color ?? "#8b5cf6")) ?? "#8b5cf6",
        dmEnabled: record.dmEnabled === true,
        emoji: normalizeSystemEmoji(record.emoji) ?? fixedSystemEmojiText("prancheta"),
        id,
        locked: record.locked === true,
        name,
        order: clamp(Number(record.order ?? index + 1), 1, 1000, index + 1)
      };
    })
    .filter((item): item is MongoCustomBotOrderStatusDefinition => Boolean(item))
    .sort((left, right) => left.order - right.order)
    .slice(0, 25)
    .map((item, index) => ({ ...item, order: index + 1 }));
  return next.length ? next : DEFAULT_STATUSES.map((status) => ({ ...status }));
}

function toSettingsDto(settings: MongoCustomBotOrderSettings): CustomBotOrderSettingsDto {
  return {
    ...settings,
    id: settings._id,
    statusDefinitions: normalizeStatuses(settings.statusDefinitions) ?? DEFAULT_STATUSES.map((status) => ({ ...status })),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function toOrderDto(order: MongoCustomBotOrder): CustomBotOrderDto {
  return {
    ...order,
    assignedAt: order.assignedAt?.toISOString() ?? null,
    closedAt: order.closedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    id: order._id,
    lastNoticeAt: order.lastNoticeAt?.toISOString() ?? null,
    updatedAt: order.updatedAt.toISOString()
  };
}

function toLogDto(log: MongoCustomBotOrderLog): CustomBotOrderLogDto {
  return { ...log, createdAt: log.createdAt.toISOString(), id: log._id };
}

function toNoteDto(note: MongoCustomBotOrderNote): CustomBotOrderNoteDto {
  return { ...note, createdAt: note.createdAt.toISOString(), id: note._id };
}

function logMessageForAction(action: string | undefined, oldStatus: string, newStatus: string) {
  if (action === "ticket_claimed") return "Ticket de bot personalizado assumido.";
  if (action === "notice_sent") return "Aviso enviado ao cliente.";
  if (action === "ticket_closed") return "Ticket de bot personalizado fechado.";
  if (oldStatus !== newStatus) return "Status do pedido de bot personalizado alterado.";
  return "Pedido de bot personalizado atualizado.";
}

function normalizeSnowflake(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{5,32}$/.test(text) ? text : null;
}

function normalizeSnowflakes(values: unknown) {
  return Array.isArray(values) ? [...new Set(values.map(normalizeSnowflake).filter((value): value is string => Boolean(value)))] : [];
}

function normalizeNullable(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return text || null;
}

function normalizeSystemEmoji(value: unknown) {
  const text = normalizeNullable(value, 80);
  return text ? normalizeFixedSystemEmojiText(text) : null;
}

function normalizeText(value: unknown, maxLength: number) {
  return normalizeNullable(value, maxLength) ?? "";
}

function normalizeColor(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(text) ? text : undefined;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
