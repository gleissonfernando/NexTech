import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemExpenseAmountMode,
  type MongoFivemExpenseCashOperation,
  type MongoFivemExpenseConfig,
  type MongoFivemExpenseItem,
  type MongoFivemExpenseModuleType,
  type MongoFivemExpenseReleaseStatus,
  type MongoFivemExpenseRecord,
  type MongoFivemExpenseTransactionType
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { getDevBot, updateDevBotModules } from "./devBotService";
import { createFivemFinanceTransaction, getFivemFinanceSettings } from "./fivemFinanceService";

export const FIVEM_EXPENSE_MODULE_ID = "fivem-expenses";
export const FIVEM_EXPENSE_MODULE_TYPE: MongoFivemExpenseModuleType = "EXPENSES";
export const FIVEM_EXPENSE_TRANSACTION_TYPE: MongoFivemExpenseTransactionType = "OUTFLOW";
export const FIVEM_EXPENSE_CASH_OPERATION: MongoFivemExpenseCashOperation = "DEBIT";
const DEFAULT_ORGANIZATION_ID = "default";
const DEFAULT_ORGANIZATION_NAME = "Caixa da FAC";

const DEFAULT_ITEMS = [
  { emoji: "🔫", name: "Armas", description: "Compra de armamentos para a organização" },
  { emoji: "📦", name: "Munição", description: "Compra de munições para a organização" },
  { emoji: "🧪", name: "Drogas", description: "Compra de insumos ou drogas da organização" },
  { emoji: "💸", name: "Pagamentos", description: "Pagamentos operacionais da organização" }
];

export type FivemExpenseConfigDto = Omit<MongoFivemExpenseConfig, "_id" | "releasedAt" | "updatedAt"> & {
  id: string;
  releasedAt: string | null;
  updatedAt: string | null;
};
export type FivemExpenseItemDto = Omit<MongoFivemExpenseItem, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  id: string;
  updatedAt: string;
};
export type FivemExpenseRecordDto = Omit<MongoFivemExpenseRecord, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  id: string;
  updatedAt: string;
};

export function defaultFivemExpenseConfig(guildId: string, botId: string | null, organizationId = DEFAULT_ORGANIZATION_ID): FivemExpenseConfigDto {
  const organizationName = organizationId === DEFAULT_ORGANIZATION_ID ? DEFAULT_ORGANIZATION_NAME : organizationId;
  return {
    adminRoleIds: [],
    allowAdministrators: false,
    allowNegativeBalance: false,
    authorizedRoleIds: [],
    botId: normalizeBotId(botId),
    clientId: null,
    color: "#ef4444",
    enabled: false,
    footerText: "Gasto integrado ao Caixa da FAC.",
    guildId,
    id: "",
    imageUrl: null,
    logsChannelId: null,
    moduleType: FIVEM_EXPENSE_MODULE_TYPE,
    moduleId: FIVEM_EXPENSE_MODULE_ID,
    organizationId: normalizeOrganizationId(organizationId),
    organizationName,
    panelChannelId: null,
    panelDescription: "Utilize o menu abaixo para registrar ou consultar gastos da organização.",
    panelMessageId: null,
    panelName: `Painel de Gastos ${organizationName}`,
    panelTitle: `💰 PAINEL DE GASTOS ${organizationName.toUpperCase()}`,
    releaseStatus: "disabled",
    releasedAt: null,
    releasedBy: null,
    summaryChannelId: null,
    thumbnailUrl: null,
    updatedAt: null,
    updatedBy: null
  };
}

export async function getFivemExpenseDashboard(guildId: string, botId: string | null, organizationId?: string | null) {
  const config = await getFivemExpenseConfig(guildId, botId, organizationId);
  if (!isExpenseReleaseActive(config)) {
    return {
      config,
      finance: await getFivemFinanceSettings(guildId, botId, config.organizationId),
      items: [],
      records: [],
      report: buildExpenseReport([], 0)
    };
  }
  const [items, records, finance] = await Promise.all([
    listFivemExpenseItems(guildId, botId, config.organizationId),
    listFivemExpenseRecords(guildId, botId, config.organizationId, 250),
    getFivemFinanceSettings(guildId, botId, config.organizationId)
  ]);
  return {
    config,
    finance,
    items,
    records,
    report: buildExpenseReport(records, finance.balanceCents ?? 0)
  };
}

export async function getFivemExpenseRuntime(guildId: string, botId: string | null, organizationId?: string | null) {
  const config = await getFivemExpenseConfig(guildId, botId, organizationId);
  assertExpenseReleaseActive(config);
  const [items, records, finance] = await Promise.all([
    listFivemExpenseItems(guildId, botId, config.organizationId),
    listFivemExpenseRecords(guildId, botId, config.organizationId, 1000),
    getFivemFinanceSettings(guildId, botId, config.organizationId)
  ]);
  return { config, finance, items, records, report: buildExpenseReport(records, finance.balanceCents ?? 0) };
}

export async function getFivemExpenseConfig(guildId: string, botId: string | null, organizationId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  const { fivemExpenseConfigs } = await getMongoCollections();
  const row = await fivemExpenseConfigs.findOne(scope(guildId, normalizedBotId, normalizedOrganizationId));
  const config = row ? toConfigDto(row) : defaultFivemExpenseConfig(guildId, normalizedBotId, normalizedOrganizationId);
  await ensureDefaultItems(guildId, normalizedBotId, config.organizationId);
  return config;
}

export async function saveFivemExpenseConfig(guildId: string, botId: string | null, input: Partial<FivemExpenseConfigDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const organizationId = normalizeOrganizationId(input.organizationId);
  const current = await getFivemExpenseConfig(guildId, normalizedBotId, organizationId);
  assertExpenseReleaseActive(current);
  const now = new Date();
  const next = normalizeConfig({ ...current, ...input, botId: normalizedBotId, guildId, organizationId });
  const { fivemExpenseConfigs } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemExpenseConfigs.updateOne(
    scope(guildId, normalizedBotId, organizationId),
    {
      $set: { ...next, updatedAt: now, updatedBy: actorId },
      $setOnInsert: { _id: randomUUID(), releasedAt: current.releasedAt ? new Date(current.releasedAt) : now, releasedBy: current.releasedBy ?? actorId }
    },
    { upsert: true }
  );
  await ensureDefaultItems(guildId, normalizedBotId, organizationId);
  emitUpdated(guildId, normalizedBotId, organizationId);
  if (normalizedBotId) emitPanelRefresh(guildId, normalizedBotId, organizationId);
  return getFivemExpenseConfig(guildId, normalizedBotId, organizationId);
}

export type SaveFivemExpenseReleaseInput = {
  botId: string;
  clientId?: string | null;
  guildId: string;
  imageUrl?: string | null;
  organizationId: string;
  organizationName?: string | null;
  panelName?: string | null;
  releaseStatus?: MongoFivemExpenseReleaseStatus;
};

export async function listFivemExpenseReleases(botId?: string | null) {
  const { fivemExpenseConfigs } = await getMongoCollections();
  const rows = await fivemExpenseConfigs.find({
    moduleId: FIVEM_EXPENSE_MODULE_ID,
    ...(botId ? { botId: normalizeBotId(botId) } : {})
  }).sort({ updatedAt: -1 }).limit(500).toArray();

  return rows.map(toConfigDto);
}

export async function saveFivemExpenseRelease(input: SaveFivemExpenseReleaseInput, actorId: string | null) {
  const bot = await getDevBot(input.botId);
  if (!bot) throw expenseError("Bot não encontrado.", 404);

  const normalizedBotId = normalizeBotId(input.botId);
  const organizationId = normalizeOrganizationId(input.organizationId);
  const organizationName = normalizeText(input.organizationName, 120) ?? organizationId;
  const now = new Date();
  const current = await getFivemExpenseConfig(input.guildId, normalizedBotId, organizationId);
  const releaseStatus = normalizeReleaseStatus(input.releaseStatus);
  const next = normalizeConfig({
    ...current,
    botId: normalizedBotId,
    clientId: normalizeText(input.clientId, 120) ?? bot.clientId,
    enabled: releaseStatus === "active" ? current.enabled : false,
    guildId: input.guildId,
    imageUrl: input.imageUrl ?? current.imageUrl,
    organizationId,
    organizationName,
    panelName: input.panelName ?? current.panelName ?? `Painel de Gastos ${organizationName}`,
    panelTitle: current.panelTitle || `💰 PAINEL DE GASTOS ${organizationName.toUpperCase()}`,
    releaseStatus,
    releasedBy: current.releasedBy ?? actorId,
    updatedBy: actorId
  });

  const { fivemExpenseConfigs } = await getMongoCollections();
  await ensureGuild(input.guildId);
  await fivemExpenseConfigs.updateOne(
    scope(input.guildId, normalizedBotId, organizationId),
    {
      $set: { ...next, updatedAt: now },
      $setOnInsert: { _id: randomUUID(), releasedAt: now, releasedBy: actorId }
    },
    { upsert: true }
  );

  if (!bot.enabledModules.includes(FIVEM_EXPENSE_MODULE_ID)) {
    await updateDevBotModules(bot.id, [...bot.enabledModules, FIVEM_EXPENSE_MODULE_ID], { actorId });
  }

  await ensureDefaultItems(input.guildId, normalizedBotId, organizationId);
  emitUpdated(input.guildId, normalizedBotId, organizationId);
  return getFivemExpenseConfig(input.guildId, normalizedBotId, organizationId);
}

export async function listFivemExpenseItems(guildId: string, botId: string | null, organizationId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const normalizedOrganizationId = normalizeOrganizationId(organizationId);
  await ensureDefaultItems(guildId, normalizedBotId, normalizedOrganizationId);
  const { fivemExpenseItems } = await getMongoCollections();
  const rows = await fivemExpenseItems.find(scope(guildId, normalizedBotId, normalizedOrganizationId)).sort({ position: 1, name: 1 }).limit(100).toArray();
  return rows.map(toItemDto);
}

export async function saveFivemExpenseItem(guildId: string, botId: string | null, input: Partial<FivemExpenseItemDto> & { id?: string | null; name: string; organizationId?: string | null }) {
  const normalizedBotId = normalizeBotId(botId);
  const organizationId = normalizeOrganizationId(input.organizationId);
  await ensureDefaultItems(guildId, normalizedBotId, organizationId);
  const now = new Date();
  const id = input.id?.trim() || randomUUID();
  const doc = normalizeItem({ ...input, _id: id, botId: normalizedBotId, guildId, organizationId, createdAt: now, updatedAt: now });
  const { fivemExpenseItems } = await getMongoCollections();
  await fivemExpenseItems.updateOne(
    { _id: id, ...scope(guildId, normalizedBotId, organizationId) },
    { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  emitUpdated(guildId, normalizedBotId, organizationId);
  return toItemDto((await fivemExpenseItems.findOne({ _id: id, ...scope(guildId, normalizedBotId, organizationId) }))!);
}

export async function listFivemExpenseRecords(guildId: string, botId: string | null, organizationId?: string | null, limit = 250, includeArchived = false) {
  const { fivemExpenseRecords } = await getMongoCollections();
  const rows = await fivemExpenseRecords.find({
    ...scope(guildId, normalizeBotId(botId), normalizeOrganizationId(organizationId)),
    ...(includeArchived ? {} : { archived: { $ne: true } })
  }).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 1000)).toArray();
  return rows.map(toRecordDto);
}

export async function requestFivemExpensePanelPublish(guildId: string, botId: string | null, organizationId?: string | null) {
  const config = await getFivemExpenseConfig(guildId, botId, organizationId);
  assertExpenseReleaseActive(config);
  if (config.botId) emitRealtimeToRoom(devBotRealtimeRoom(config.botId), "fivem:expenses:panel_publish", { botId: config.botId, guildId, organizationId: config.organizationId });
  return config;
}

export async function updateFivemExpensePanelState(guildId: string, botId: string | null, messageId: string | null, organizationId?: string | null) {
  return saveFivemExpenseConfig(guildId, botId, { organizationId: normalizeOrganizationId(organizationId), panelMessageId: messageId }, null);
}

export async function registerFivemExpense(input: {
  channelId: string;
  description?: string | null;
  guildId: string;
  interactionId: string;
  itemId: string;
  organizationId?: string | null;
  quantity?: number | null;
  totalAmountCents: number;
  unitAmountCents?: number | null;
  userAvatar?: string | null;
  userDisplayName: string;
  userId: string;
}, botId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const organizationId = normalizeOrganizationId(input.organizationId);
  const config = await getFivemExpenseConfig(input.guildId, normalizedBotId, organizationId);
  assertExpenseReleaseActive(config);
  if (!config.enabled) throw expenseError("Sistema de Gastos desativado.", 403);
  if (!config.logsChannelId) throw expenseError("Canal de logs de gastos não configurado.", 409);
  const finance = await getFivemFinanceSettings(input.guildId, normalizedBotId, organizationId);
  if (!finance.enabled) throw expenseError("Caixa da FAC vinculado não está ativo.", 409);
  const item = (await listFivemExpenseItems(input.guildId, normalizedBotId, organizationId)).find((entry) => entry.id === input.itemId && entry.enabled);
  if (!item) throw expenseError("Item de gasto indisponível.", 404);
  const totalAmountCents = normalizeCents(input.totalAmountCents);
  if (item.requiresAmount && totalAmountCents <= 0) throw expenseError("Valor inválido.", 400);
  const quantity = item.requiresQuantity ? normalizeQuantity(input.quantity) : input.quantity ? normalizeQuantity(input.quantity) : null;
  if (item.requiresQuantity && !quantity) throw expenseError("Quantidade inválida.", 400);
  const description = normalizeText(input.description, 1000);
  if (item.requiresDescription && !description) throw expenseError("Observação obrigatória.", 400);
  if (!config.allowNegativeBalance && (finance.balanceCents ?? 0) < totalAmountCents) {
    throw expenseError("Saldo insuficiente.", 409, { currentBalanceCents: finance.balanceCents ?? 0, requestedCents: totalAmountCents });
  }
  const { fivemExpenseRecords } = await getMongoCollections();
  const existing = await fivemExpenseRecords.findOne({ ...scope(input.guildId, normalizedBotId, organizationId), interactionId: input.interactionId });
  if (existing?.status === "COMPLETED") return toRecordDto(existing);
  const now = new Date();
  const recordId = existing?._id ?? randomUUID();
  const transactionId = existing?.transactionId ?? `GAS-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const pending: MongoFivemExpenseRecord = {
    _id: recordId,
    archived: false,
    balanceAfterCents: 0,
    balanceBeforeCents: finance.balanceCents ?? 0,
    botId: normalizedBotId,
    cashOperation: FIVEM_EXPENSE_CASH_OPERATION,
    cashTransactionId: null,
    channelId: input.channelId,
    createdAt: existing?.createdAt ?? now,
    description,
    errorMessage: null,
    guildId: input.guildId,
    interactionId: input.interactionId,
    itemEmoji: item.emoji,
    itemId: item.id,
    itemName: item.name,
    messageId: null,
    moduleType: FIVEM_EXPENSE_MODULE_TYPE,
    organizationId,
    organizationName: config.organizationName,
    quantity,
    resetBatchId: null,
    status: "PENDING",
    totalAmountCents,
    transactionId,
    transactionType: FIVEM_EXPENSE_TRANSACTION_TYPE,
    unitAmountCents: normalizeOptionalCents(input.unitAmountCents),
    updatedAt: now,
    userAvatar: normalizeText(input.userAvatar, 2048),
    userDisplayName: normalizeText(input.userDisplayName, 120) ?? input.userId,
    userId: input.userId
  };
  await fivemExpenseRecords.updateOne(
    { ...scope(input.guildId, normalizedBotId, organizationId), interactionId: input.interactionId },
    { $set: pending, $setOnInsert: { _id: recordId, createdAt: pending.createdAt } },
    { upsert: true }
  );
  try {
    let balanceBeforeCents = finance.balanceCents ?? 0;
    let balanceAfterCents = balanceBeforeCents;
    let cashTransactionId: string | null = null;
    const cash = await createFivemFinanceTransaction({
      amount: centsToReais(totalAmountCents),
      amountCents: totalAmountCents,
      factionId: organizationId,
      factionName: config.organizationName,
      guildId: input.guildId,
      proofImageUrl: "",
      type: "remove",
      userAvatar: input.userAvatar ?? null,
      userId: input.userId,
      username: input.userDisplayName,
      managerId: input.userId,
      managerName: input.userDisplayName,
      metadata: {
        cashOperation: FIVEM_EXPENSE_CASH_OPERATION,
        expenseCategoryId: item.id,
        expenseOperationId: recordId,
        expenseTransactionId: transactionId,
        interactionId: input.interactionId,
        moduleType: FIVEM_EXPENSE_MODULE_TYPE,
        transactionType: FIVEM_EXPENSE_TRANSACTION_TYPE
      },
      personName: input.userDisplayName,
      reason: `Saída — Sistema de Gastos — Compra de ${item.name}`,
      targetUserId: input.userId
    }, normalizedBotId);
    balanceBeforeCents = cash.oldBalanceCents ?? reaisToCents(cash.oldBalance);
    balanceAfterCents = cash.newBalanceCents ?? reaisToCents(cash.newBalance);
    cashTransactionId = cash.transactionId;
    const completed = await fivemExpenseRecords.findOneAndUpdate(
      { _id: recordId, ...scope(input.guildId, normalizedBotId, organizationId) },
      { $set: { balanceAfterCents, balanceBeforeCents, cashTransactionId, errorMessage: null, status: "COMPLETED", updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    emitUpdated(input.guildId, normalizedBotId, organizationId);
    return toRecordDto(completed!);
  } catch (error) {
    await fivemExpenseRecords.updateOne({ _id: recordId }, { $set: { errorMessage: error instanceof Error ? error.message : String(error), status: "FAILED", updatedAt: new Date() } });
    throw error;
  }
}

export async function resetFivemExpenses(guildId: string, botId: string | null, input: { actorId: string; organizationId?: string | null; reason?: string | null }) {
  const normalizedBotId = normalizeBotId(botId);
  const organizationId = normalizeOrganizationId(input.organizationId);
  const resetBatchId = `RST-GAS-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const { fivemExpenseRecords } = await getMongoCollections();
  const result = await fivemExpenseRecords.updateMany(
    { ...scope(guildId, normalizedBotId, organizationId), archived: { $ne: true } },
    { $set: { archived: true, resetBatchId, updatedAt: new Date() } }
  );
  emitUpdated(guildId, normalizedBotId, organizationId);
  return { affected: result.modifiedCount, resetBatchId };
}

function buildExpenseReport(records: FivemExpenseRecordDto[], balanceCents: number) {
  const completed = records.filter((record) => record.status === "COMPLETED" && !record.archived);
  const totalCents = completed.filter((record) => record.moduleType === FIVEM_EXPENSE_MODULE_TYPE && record.transactionType === FIVEM_EXPENSE_TRANSACTION_TYPE).reduce((sum, record) => sum + record.totalAmountCents, 0);
  const biggest = [...completed].sort((a, b) => b.totalAmountCents - a.totalAmountCents)[0] ?? null;
  const byItem = new Map<string, { itemName: string; totalAmountCents: number; count: number }>();
  for (const record of completed) {
    const current = byItem.get(record.itemId) ?? { itemName: record.itemName, totalAmountCents: 0, count: 0 };
    current.totalAmountCents += record.totalAmountCents;
    current.count += 1;
    byItem.set(record.itemId, current);
  }
  return {
    balanceCents,
    biggest,
    byItem: [...byItem.values()].sort((a, b) => b.totalAmountCents - a.totalAmountCents),
    count: completed.length,
    last: completed[0] ?? null,
    totalCents
  };
}

async function ensureDefaultItems(guildId: string, botId: string | null, organizationId: string) {
  const { fivemExpenseItems } = await getMongoCollections();
  if (await fivemExpenseItems.countDocuments(scope(guildId, botId, organizationId))) return;
  const now = new Date();
  await fivemExpenseItems.insertMany(DEFAULT_ITEMS.map((item, index) => ({
    _id: randomUUID(),
    amountMode: "TOTAL",
    botId,
    createdAt: now,
    deductFromCash: true,
    defaultUnitAmountCents: null,
    description: item.description,
    emoji: item.emoji,
    enabled: true,
    guildId,
    maxQuantity: null,
    minQuantity: null,
    name: item.name,
    organizationId,
    position: index + 1,
    requiresAmount: true,
    requiresDescription: false,
    requiresQuantity: item.name !== "Pagamentos",
    transactionType: FIVEM_EXPENSE_TRANSACTION_TYPE,
    updatedAt: now
  })));
}

function toConfigDto(row: MongoFivemExpenseConfig): FivemExpenseConfigDto {
  const { _id, releasedAt, updatedAt, ...rest } = row;
  return { ...rest, moduleType: FIVEM_EXPENSE_MODULE_TYPE, id: _id, releasedAt: releasedAt?.toISOString() ?? null, updatedAt: updatedAt?.toISOString() ?? null };
}

function toItemDto(row: MongoFivemExpenseItem): FivemExpenseItemDto {
  const { _id, createdAt, updatedAt, ...rest } = row;
  return { ...rest, transactionType: FIVEM_EXPENSE_TRANSACTION_TYPE, createdAt: createdAt.toISOString(), id: _id, updatedAt: updatedAt.toISOString() };
}

function toRecordDto(row: MongoFivemExpenseRecord): FivemExpenseRecordDto {
  const { _id, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    cashOperation: FIVEM_EXPENSE_CASH_OPERATION,
    createdAt: createdAt.toISOString(),
    id: _id,
    moduleType: FIVEM_EXPENSE_MODULE_TYPE,
    transactionType: FIVEM_EXPENSE_TRANSACTION_TYPE,
    updatedAt: updatedAt.toISOString()
  };
}

function normalizeConfig(value: Partial<FivemExpenseConfigDto>): Omit<MongoFivemExpenseConfig, "_id" | "releasedAt" | "updatedAt"> {
  return {
    adminRoleIds: normalizeSnowflakes(value.adminRoleIds),
    allowAdministrators: value.allowAdministrators === true,
    allowNegativeBalance: value.allowNegativeBalance === true,
    authorizedRoleIds: normalizeSnowflakes(value.authorizedRoleIds),
    botId: normalizeBotId(value.botId),
    clientId: normalizeText(value.clientId, 120),
    color: /^#[0-9a-f]{6}$/i.test(value.color ?? "") ? value.color! : "#ef4444",
    enabled: value.enabled === true,
    footerText: normalizeText(value.footerText, 200),
    guildId: value.guildId ?? "",
    imageUrl: normalizeText(value.imageUrl, 2048),
    logsChannelId: normalizeSnowflake(value.logsChannelId),
    moduleType: FIVEM_EXPENSE_MODULE_TYPE,
    moduleId: FIVEM_EXPENSE_MODULE_ID,
    organizationId: normalizeOrganizationId(value.organizationId),
    organizationName: normalizeText(value.organizationName, 120) ?? DEFAULT_ORGANIZATION_NAME,
    panelChannelId: normalizeSnowflake(value.panelChannelId),
    panelDescription: normalizeText(value.panelDescription, 1500) ?? "Utilize o menu abaixo para registrar ou consultar gastos da organização.",
    panelMessageId: normalizeSnowflake(value.panelMessageId),
    panelName: normalizeText(value.panelName, 120) ?? "Painel de Gastos",
    panelTitle: normalizeText(value.panelTitle, 120) ?? "💰 PAINEL DE GASTOS",
    releaseStatus: normalizeReleaseStatus(value.releaseStatus),
    releasedBy: normalizeText(value.releasedBy, 64),
    summaryChannelId: normalizeSnowflake(value.summaryChannelId),
    thumbnailUrl: normalizeText(value.thumbnailUrl, 2048),
    updatedBy: normalizeText(value.updatedBy, 64)
  };
}

function isExpenseReleaseActive(config: FivemExpenseConfigDto) {
  return Boolean(config.releasedAt) && config.releaseStatus === "active";
}

function assertExpenseReleaseActive(config: FivemExpenseConfigDto) {
  if (!isExpenseReleaseActive(config)) {
    throw expenseError("Sistema de Gastos não liberado pelo desenvolvedor para esta organização.", 403);
  }
}

function normalizeItem(value: Partial<MongoFivemExpenseItem> & { _id: string; botId: string | null; guildId: string; organizationId: string; name: string }): MongoFivemExpenseItem {
  return {
    _id: value._id,
    amountMode: normalizeAmountMode(value.amountMode),
    botId: normalizeBotId(value.botId),
    createdAt: value.createdAt instanceof Date ? value.createdAt : new Date(),
    deductFromCash: true,
    defaultUnitAmountCents: normalizeOptionalCents(value.defaultUnitAmountCents),
    description: normalizeText(value.description, 200),
    emoji: normalizeText(value.emoji, 32),
    enabled: value.enabled !== false,
    guildId: value.guildId,
    maxQuantity: value.maxQuantity === null || value.maxQuantity === undefined ? null : Math.max(1, Math.floor(Number(value.maxQuantity))),
    minQuantity: value.minQuantity === null || value.minQuantity === undefined ? null : Math.max(1, Math.floor(Number(value.minQuantity))),
    name: normalizeText(value.name, 80) ?? "Item",
    organizationId: normalizeOrganizationId(value.organizationId),
    position: Math.max(1, Math.floor(Number(value.position ?? 1))),
    requiresAmount: value.requiresAmount !== false,
    requiresDescription: value.requiresDescription === true,
    requiresQuantity: value.requiresQuantity !== false,
    transactionType: FIVEM_EXPENSE_TRANSACTION_TYPE,
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt : new Date()
  };
}

function emitUpdated(guildId: string, botId: string | null, organizationId: string) {
  if (botId) emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:expenses:updated", { botId, guildId, organizationId });
}

function emitPanelRefresh(guildId: string, botId: string, organizationId: string) {
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:expenses:panel_publish", { botId, guildId, organizationId });
}

function scope(guildId: string, botId: string | null, organizationId: string) {
  return { botId: normalizeBotId(botId), guildId, organizationId: normalizeOrganizationId(organizationId) };
}

function normalizeOrganizationId(value?: string | null) {
  const text = normalizeText(value, 120);
  return text || DEFAULT_ORGANIZATION_ID;
}
function normalizeBotId(value?: string | null) { return normalizeText(value, 80); }
function normalizeText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
function normalizeSnowflake(value: unknown) {
  const text = normalizeText(value, 32);
  return text && /^\d{5,32}$/.test(text) ? text : null;
}
function normalizeSnowflakes(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(normalizeSnowflake).filter((item): item is string => Boolean(item)))].slice(0, 100) : [];
}
function normalizeAmountMode(value: unknown): MongoFivemExpenseAmountMode {
  return value === "UNIT_PRICE" || value === "BOTH" ? value : "TOTAL";
}
function normalizeReleaseStatus(value: unknown): MongoFivemExpenseReleaseStatus {
  return value === "active" || value === "suspended" ? value : "disabled";
}
function normalizeCents(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
function normalizeOptionalCents(value: unknown) {
  const cents = normalizeCents(value);
  return cents > 0 ? cents : null;
}
function normalizeQuantity(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function centsToReais(value: number) { return Math.round(value) / 100; }
function reaisToCents(value: number) { return Math.round(value * 100); }

function expenseError(message: string, status = 400, details?: Record<string, unknown>) {
  const error = new Error(message) as Error & { details?: Record<string, unknown>; status?: number };
  error.status = status;
  error.details = details;
  return error;
}
