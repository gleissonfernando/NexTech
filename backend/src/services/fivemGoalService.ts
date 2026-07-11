import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemGoalConfig,
  type MongoFivemGoalEntry,
  type MongoFivemGoalLog,
  type MongoFivemGoalSettings,
  type MongoFivemGoalSubmission,
  type MongoFivemGoalUserChannel
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const FIVEM_GOALS_MODULE_ID = "fivem-goals";

export type FivemGoalFieldDto = {
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type FivemGoalItemDto = {
  category: string | null;
  color: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
};

export type FivemGoalSettingsDto = {
  autoCreateWithManualRegistration: boolean;
  botId: string | null;
  categoryId: string | null;
  channelNameTemplate: string;
  enabled: boolean;
  fields: FivemGoalFieldDto[];
  guildId: string;
  items: FivemGoalItemDto[];
  logChannelId: string | null;
  managerRoleId: string | null;
  requestPanelChannelId: string | null;
  requestPanelDescription: string;
  requestPanelEnabled: boolean;
  requestPanelMessageId: string | null;
  requestPanelTitle: string;
  requestRequiresApproval: boolean;
  updatedAt: string | null;
  viewRoleId: string | null;
};

export type FivemGoalEntryDto = {
  botId: string | null;
  channelId: string;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  imageUrl: string;
  itemId: string | null;
  quantity: number | null;
  updatedAt: string;
  userId: string;
};

export type FivemGoalUserChannelDto = {
  botId: string | null;
  channelId: string;
  createdAt: string;
  guildId: string;
  updatedAt: string;
  userId: string;
};

export type FivemGoalConfigStatus = "active" | "paused" | "finished";
export type FivemGoalConfigPeriod = "daily" | "weekly" | "monthly" | "custom";

export type FivemGoalConfigDto = {
  approverRoleIds: string[];
  botId: string | null;
  createdAt: string;
  createdBy: string | null;
  currentValue: number;
  deleteRoleIds: string[];
  description: string | null;
  deletedAt?: string | null;
  editRoleIds: string[];
  fields: FivemGoalFieldDto[];
  guildId: string;
  id: string;
  logChannelId: string | null;
  managerRoleIds: string[];
  name: string;
  order: number;
  panelChannelId: string | null;
  panelMessageId: string | null;
  participantRoleIds: string[];
  period: FivemGoalConfigPeriod;
  requiresApproval: boolean;
  requiresProof: boolean;
  resetConfig: {
    customDate: string | null;
    enabled: boolean;
    frequency: "none" | "daily" | "weekly" | "monthly" | "custom";
  };
  rules: string | null;
  status: FivemGoalConfigStatus;
  targetValue: number;
  totalParticipants: number;
  type: string;
  unit: string;
  updatedAt: string;
  updatedBy?: string | null;
  viewerRoleIds: string[];
};

export type FivemGoalSubmissionDto = {
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string | null;
  createdAt: string;
  description: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  metaId: string;
  proofUrl: string | null;
  refusedAt: string | null;
  refusedBy: string | null;
  refusalReason: string | null;
  roleIdsSnapshot: string[];
  status: "pending" | "approved" | "refused";
  updatedAt: string;
  userId: string;
  value: number;
};

export type FivemGoalLogDto = {
  action: string;
  botId: string | null;
  createdAt: string;
  details: Record<string, unknown>;
  guildId: string;
  id: string;
  metaId: string | null;
  userId: string | null;
};

export type FivemGoalReportDto = {
  approvedCount: number;
  members: Array<{
    approvedCount: number;
    pendingCount: number;
    refusedCount: number;
    totalApprovedValue: number;
    totalPendingValue: number;
    userId: string;
  }>;
  participantCount: number;
  pendingCount: number;
  periodEnd: string;
  periodStart: string;
  refusedCount: number;
  totalApprovedValue: number;
  totalPendingValue: number;
  totalRecords: number;
  types: Array<{
    approvedCount: number;
    metaId: string;
    name: string;
    totalApprovedValue: number;
    type: string;
  }>;
};

const DEFAULT_FIELDS: FivemGoalFieldDto[] = [
  { id: "euro_sujo", label: "Euro Sujo", maxLength: 80, minLength: 1, placeholder: "Ex: 100000", required: true, style: "short" },
  { id: "itens", label: "Itens", maxLength: 300, minLength: 1, placeholder: "Ex: 5 Diamantes", required: true, style: "short" },
  { id: "quantidade", label: "Quantidade", maxLength: 80, minLength: 1, placeholder: "Ex: 5", required: true, style: "short" },
  { id: "observacao", label: "Observacao", maxLength: 1000, minLength: null, placeholder: "Detalhes extras", required: false, style: "paragraph" }
];

const DEFAULT_ITEMS: FivemGoalItemDto[] = [
  { category: "Dinheiro", color: "#22c55e", emoji: "💰", enabled: true, id: "euro-sujo", name: "Euro Sujo", order: 1 },
  { category: "Itens", color: "#38bdf8", emoji: "💎", enabled: true, id: "diamante", name: "Diamante", order: 2 },
  { category: "Armas", color: "#f97316", emoji: "🔫", enabled: true, id: "armas", name: "Armas", order: 3 },
  { category: "Itens", color: "#a855f7", emoji: "📦", enabled: true, id: "contrabando", name: "Contrabando", order: 4 }
];

export function defaultFivemGoalSettings(guildId: string, botId: string | null = null): FivemGoalSettingsDto {
  return {
    autoCreateWithManualRegistration: true,
    botId,
    categoryId: null,
    channelNameTemplate: "📈・{username}",
    enabled: false,
    fields: DEFAULT_FIELDS.map((field) => ({ ...field })),
    guildId,
    items: DEFAULT_ITEMS.map((item) => ({ ...item })),
    logChannelId: null,
    managerRoleId: null,
    requestPanelChannelId: null,
    requestPanelDescription: "Solicite seu canal individual de meta para enviar comprovantes, acompanhar sua producao semanal e visualizar seu progresso.",
    requestPanelEnabled: true,
    requestPanelMessageId: null,
    requestPanelTitle: "Sistema de Metas FiveM",
    requestRequiresApproval: false,
    updatedAt: null,
    viewRoleId: null
  };
}

export async function getFivemGoalSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemGoalSettings } = await getMongoCollections();
  const settings = await fivemGoalSettings.findOne(scopeQuery(guildId, normalizedBotId));
  return settings ? toSettingsDto(settings) : defaultFivemGoalSettings(guildId, normalizedBotId);
}

export async function saveFivemGoalSettings(guildId: string, botId: string | null, input: Partial<FivemGoalSettingsDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getFivemGoalSettings(guildId, normalizedBotId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId });
  const now = new Date();
  const { fivemGoalSettings } = await getMongoCollections();

  await ensureGuild(guildId);
  await fivemGoalSettings.updateOne(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: {
        ...next,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: { _id: randomUUID() }
    },
    { upsert: true }
  );

  const saved = await getFivemGoalSettings(guildId, normalizedBotId);
  await ensureDefaultGoalConfigFromLegacy(saved, actorId);
  return saved;
}

export async function requestFivemGoalPanelPublish(guildId: string, botId: string, actorId: string | null) {
  const settings = await getFivemGoalSettings(guildId, botId);
  if (!settings.enabled) throw new Error("Ative o sistema de metas antes de publicar o painel.");
  if (!settings.requestPanelChannelId) throw new Error("Configure o canal do painel de solicitacao de meta.");

  await writeFivemGoalLog({
    action: "request_panel.publish_requested",
    botId,
    details: { channelId: settings.requestPanelChannelId },
    guildId,
    metaId: null,
    userId: actorId
  });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:goals:panel_publish", { botId, guildId, settings });
  return settings;
}

export async function updateFivemGoalRequestPanelState(guildId: string, botId: string | null, messageId: string | null) {
  const settings = await saveFivemGoalSettings(guildId, botId, { requestPanelMessageId: messageId }, null);
  await writeFivemGoalLog({
    action: "request_panel.state_updated",
    botId: normalizeBotId(botId),
    details: { messageId },
    guildId,
    metaId: null,
    userId: null
  });
  return settings;
}

export async function getFivemGoalDashboard(guildId: string, botId?: string | null) {
  const settings = await getFivemGoalSettings(guildId, botId);
  const configs = await listFivemGoalConfigs(guildId, botId, true);

  return {
    configs,
    entries: await listFivemGoalEntries(guildId, botId),
    logs: await listFivemGoalLogs(guildId, botId),
    report: await getCurrentWeekFivemGoalReport(guildId, botId, configs),
    settings,
    submissions: await listFivemGoalSubmissions(guildId, botId)
  };
}

export async function getCurrentWeekFivemGoalReport(
  guildId: string,
  botId?: string | null,
  knownConfigs?: FivemGoalConfigDto[]
): Promise<FivemGoalReportDto> {
  const normalizedBotId = normalizeBotId(botId);
  const { start, end } = currentSaoPauloWeek();
  const { fivemGoalSubmissions } = await getMongoCollections();
  const [rows, configs] = await Promise.all([
    fivemGoalSubmissions.find({
      ...scopeQuery(guildId, normalizedBotId),
      createdAt: { $gte: start, $lt: end }
    }).sort({ createdAt: -1 }).limit(5000).toArray(),
    knownConfigs ? Promise.resolve(knownConfigs) : listFivemGoalConfigs(guildId, normalizedBotId, true)
  ]);
  const configsById = new Map(configs.map((config) => [config.id, config]));
  const members = new Map<string, FivemGoalReportDto["members"][number]>();
  const types = new Map<string, FivemGoalReportDto["types"][number]>();
  let approvedCount = 0;
  let pendingCount = 0;
  let refusedCount = 0;
  let totalApprovedValue = 0;
  let totalPendingValue = 0;
  const approvedParticipants = new Set<string>();

  for (const row of rows) {
    const value = resolveGoalSubmissionValue(row);
    const member = members.get(row.userId) ?? {
      approvedCount: 0,
      pendingCount: 0,
      refusedCount: 0,
      totalApprovedValue: 0,
      totalPendingValue: 0,
      userId: row.userId
    };
    if (row.status === "approved") {
      approvedCount += 1;
      approvedParticipants.add(row.userId);
      totalApprovedValue += value;
      member.approvedCount += 1;
      member.totalApprovedValue += value;
      const config = configsById.get(row.metaId);
      const type = types.get(row.metaId) ?? {
        approvedCount: 0,
        metaId: row.metaId,
        name: config?.name ?? "Meta removida",
        totalApprovedValue: 0,
        type: config?.type ?? "personalizada"
      };
      type.approvedCount += 1;
      type.totalApprovedValue += value;
      types.set(row.metaId, type);
    } else if (row.status === "pending") {
      pendingCount += 1;
      totalPendingValue += value;
      member.pendingCount += 1;
      member.totalPendingValue += value;
    } else {
      refusedCount += 1;
      member.refusedCount += 1;
    }
    members.set(row.userId, member);
  }

  return {
    approvedCount,
    members: [...members.values()].sort((a, b) => b.totalApprovedValue - a.totalApprovedValue || a.userId.localeCompare(b.userId)),
    participantCount: approvedParticipants.size,
    pendingCount,
    periodEnd: end.toISOString(),
    periodStart: start.toISOString(),
    refusedCount,
    totalApprovedValue,
    totalPendingValue,
    totalRecords: rows.length,
    types: [...types.values()].sort((a, b) => b.totalApprovedValue - a.totalApprovedValue)
  };
}

export async function listFivemGoalConfigs(guildId: string, botId?: string | null, ensureLegacy = false) {
  const normalizedBotId = normalizeBotId(botId);
  if (ensureLegacy) {
    await ensureDefaultGoalConfigFromLegacy(await getFivemGoalSettings(guildId, normalizedBotId), null);
  }
  const { fivemGoalConfigs, fivemGoalSubmissions } = await getMongoCollections();
  const [rows, progress] = await Promise.all([
    fivemGoalConfigs.find({ ...scopeQuery(guildId, normalizedBotId), deletedAt: null }).sort({ order: 1, createdAt: 1 }).limit(100).toArray(),
    fivemGoalSubmissions.aggregate<{ _id: string; currentValue: number; totalParticipants: number }>([
      { $match: { ...scopeQuery(guildId, normalizedBotId), status: "approved" } },
      { $group: { _id: "$metaId", currentValue: { $sum: "$value" }, participants: { $addToSet: "$userId" } } },
      { $project: { _id: 1, currentValue: 1, totalParticipants: { $size: "$participants" } } }
    ]).toArray()
  ]);
  const progressByMeta = new Map(progress.map((item) => [item._id, item]));
  return rows.map((row) => toConfigDto(row, progressByMeta.get(row._id)));
}

export async function getFivemGoalConfig(guildId: string, metaId: string, botId?: string | null) {
  const { fivemGoalConfigs } = await getMongoCollections();
  const row = await fivemGoalConfigs.findOne({ _id: metaId, ...scopeQuery(guildId, normalizeBotId(botId)) });
  return row ? toConfigDto(row) : null;
}

export async function createFivemGoalConfig(guildId: string, botId: string | null, input: Partial<FivemGoalConfigDto>, actorId: string | null) {
  const now = new Date();
  const normalizedBotId = normalizeBotId(botId);
  const doc: MongoFivemGoalConfig = {
    ...normalizeConfigInput(input, guildId, normalizedBotId),
    _id: randomUUID(),
    botId: normalizedBotId,
    createdAt: now,
    createdBy: actorId,
    guildId,
    panelMessageId: null,
    updatedAt: now,
    updatedBy: actorId
  };
  const { fivemGoalConfigs } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemGoalConfigs.insertOne(doc);
  await writeFivemGoalLog({ action: "meta.created", botId: normalizedBotId, details: { name: doc.name }, guildId, metaId: doc._id, userId: actorId });
  return toConfigDto(doc);
}

export async function updateFivemGoalConfig(guildId: string, botId: string | null, metaId: string, input: Partial<FivemGoalConfigDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemGoalConfigs } = await getMongoCollections();
  const current = await fivemGoalConfigs.findOne({ _id: metaId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  const now = new Date();
  const next = {
    ...normalizeConfigInput({ ...toConfigDto(current), ...input }, guildId, normalizedBotId),
    panelMessageId: normalizeSnowflake(input.panelMessageId ?? current.panelMessageId),
    updatedAt: now,
    updatedBy: actorId
  };
  await fivemGoalConfigs.updateOne({ _id: metaId, ...scopeQuery(guildId, normalizedBotId) }, { $set: next });
  await writeFivemGoalLog({ action: "meta.updated", botId: normalizedBotId, details: { name: next.name }, guildId, metaId, userId: actorId });
  return getFivemGoalConfig(guildId, metaId, normalizedBotId);
}

export async function deleteFivemGoalConfig(guildId: string, botId: string | null, metaId: string, actorId: string | null, deleteHistory = false) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemGoalConfigs, fivemGoalSubmissions } = await getMongoCollections();
  const current = await fivemGoalConfigs.findOne({ _id: metaId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  const historyCount = await fivemGoalSubmissions.countDocuments({ ...scopeQuery(guildId, normalizedBotId), metaId });
  if (deleteHistory && historyCount > 0) {
    throw new Error("Metas com historico nao podem ser apagadas fisicamente. Desative ou arquive a meta.");
  }
  if (deleteHistory) await fivemGoalConfigs.deleteOne({ _id: metaId, ...scopeQuery(guildId, normalizedBotId) });
  else await fivemGoalConfigs.updateOne(
    { _id: metaId, ...scopeQuery(guildId, normalizedBotId) },
    { $set: { deletedAt: new Date(), deletedBy: actorId, status: "finished", updatedAt: new Date(), updatedBy: actorId } }
  );
  await writeFivemGoalLog({ action: deleteHistory ? "meta.deleted_empty" : "meta.soft_deleted", botId: normalizedBotId, details: { historyCount, name: current.name }, guildId, metaId, userId: actorId });
  return toConfigDto(current);
}

export async function upsertFivemGoalUserChannel(input: { botId?: string | null; channelId: string; guildId: string; userId: string }) {
  const now = new Date();
  const botId = normalizeBotId(input.botId);
  const { fivemGoalUserChannels } = await getMongoCollections();
  await fivemGoalUserChannels.updateOne(
    { botId, guildId: input.guildId, userId: input.userId },
    {
      $set: { botId, channelId: input.channelId, guildId: input.guildId, updatedAt: now, userId: input.userId },
      $setOnInsert: { _id: randomUUID(), createdAt: now }
    },
    { upsert: true }
  );
  return getFivemGoalUserChannelByUser(input.guildId, input.userId, botId);
}

export async function getFivemGoalUserChannelByUser(guildId: string, userId: string, botId?: string | null) {
  const { fivemGoalUserChannels } = await getMongoCollections();
  const row = await fivemGoalUserChannels.findOne({ botId: normalizeBotId(botId), guildId, userId });
  return row ? toUserChannelDto(row) : null;
}

export async function getFivemGoalUserChannelByChannel(channelId: string, botId?: string | null) {
  const { fivemGoalUserChannels } = await getMongoCollections();
  const row = await fivemGoalUserChannels.findOne({ botId: normalizeBotId(botId), channelId });
  return row ? toUserChannelDto(row) : null;
}

export async function createFivemGoalEntry(input: {
  botId?: string | null;
  channelId: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  imageUrl: string;
  itemId?: string | null;
  metaId?: string | null;
  quantity?: number | null;
  roleIdsSnapshot?: string[];
  userId: string;
}) {
  const now = new Date();
  const doc: MongoFivemGoalEntry = {
    _id: randomUUID(),
    botId: normalizeBotId(input.botId),
    channelId: input.channelId,
    createdAt: now,
    fields: input.fields.map((field) => ({ id: field.id, label: field.label.slice(0, 100), value: field.value.slice(0, 1500) })),
    guildId: input.guildId,
    imageUrl: input.imageUrl.slice(0, 2048),
    itemId: input.itemId ?? null,
    quantity: typeof input.quantity === "number" && Number.isFinite(input.quantity) ? input.quantity : null,
    updatedAt: now,
    userId: input.userId
  };
  const { fivemGoalEntries } = await getMongoCollections();
  await fivemGoalEntries.insertOne(doc);
  await createFivemGoalSubmission({
    botId: input.botId,
    description: input.fields.find((field) => /obs|descricao|descri/i.test(field.id))?.value ?? null,
    fields: input.fields,
    guildId: input.guildId,
    metaId: input.metaId ?? null,
    proofUrl: input.imageUrl,
    roleIdsSnapshot: input.roleIdsSnapshot ?? [],
    userId: input.userId,
    value: doc.quantity ?? 0
  }).catch(() => null);
  return toEntryDto(doc);
}

export async function listFivemGoalEntries(guildId: string, botId?: string | null, userId?: string | null) {
  const { fivemGoalEntries } = await getMongoCollections();
  const rows = await fivemGoalEntries
    .find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(userId ? { userId } : {}) })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return rows.map(toEntryDto);
}

export async function createFivemGoalSubmission(input: {
  botId?: string | null;
  description?: string | null;
  fields?: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  metaId?: string | null;
  proofUrl?: string | null;
  roleIdsSnapshot?: string[];
  userId: string;
  value: number;
  idempotencyKey?: string | null;
}) {
  const normalizedBotId = normalizeBotId(input.botId);
  const configs = await listFivemGoalConfigs(input.guildId, normalizedBotId, true);
  const meta = input.metaId ? configs.find((config) => config.id === input.metaId) : configs.find((config) => config.status === "active") ?? configs[0];
  if (!meta) return null;
  if (!Number.isFinite(input.value) || input.value <= 0) throw new Error("O valor da meta deve ser maior que zero.");
  const now = new Date();
  const idempotencyKey = normalizeText(input.idempotencyKey, 200)
    ?? (input.proofUrl ? `${input.userId}:${meta.id}:${input.proofUrl}`.slice(0, 200) : null);
  const { fivemGoalSubmissions } = await getMongoCollections();
  if (idempotencyKey) {
    const existing = await fivemGoalSubmissions.findOne({ ...scopeQuery(input.guildId, normalizedBotId), idempotencyKey });
    if (existing) return toSubmissionDto(existing);
  }
  const status = meta.requiresApproval ? "pending" as const : "approved" as const;
  const doc: MongoFivemGoalSubmission = {
    _id: randomUUID(),
    approvedAt: status === "approved" ? now : null,
    approvedBy: status === "approved" ? "system" : null,
    botId: normalizedBotId,
    createdAt: now,
    description: normalizeText(input.description, 1000),
    fields: (input.fields ?? []).map((field) => ({ id: normalizeText(field.id, 80) || "campo", label: normalizeText(field.label, 100) || "Campo", value: normalizeText(field.value, 1500) || "" })).slice(0, 10),
    guildId: input.guildId,
    idempotencyKey,
    metaId: meta.id,
    proofUrl: normalizeText(input.proofUrl, 2048),
    refusedAt: null,
    refusedBy: null,
    refusalReason: null,
    roleIdsSnapshot: normalizeRoleIds(input.roleIdsSnapshot ?? []),
    status,
    updatedAt: now,
    userId: input.userId,
    value: input.value
  };
  await fivemGoalSubmissions.insertOne(doc);
  await writeFivemGoalLog({ action: status === "approved" ? "submission.auto_approved" : "submission.created", botId: normalizedBotId, details: { proofUrl: doc.proofUrl, value: doc.value }, guildId: input.guildId, metaId: meta.id, userId: input.userId });
  emitRealtimeToRoom(dashboardLogRealtimeRoom(input.guildId, normalizedBotId), "fivem:goals:updated", {
    botId: normalizedBotId,
    guildId: input.guildId
  });
  return toSubmissionDto(doc);
}

export async function listFivemGoalSubmissions(guildId: string, botId?: string | null, metaId?: string | null) {
  const { fivemGoalSubmissions } = await getMongoCollections();
  const rows = await fivemGoalSubmissions
    .find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(metaId ? { metaId } : {}) })
    .sort({ createdAt: -1 })
    .limit(300)
    .toArray();
  return rows.map(toSubmissionDto);
}

export async function getFivemGoalUserRuntime(guildId: string, userId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const [configs, submissions] = await Promise.all([
    listFivemGoalConfigs(guildId, normalizedBotId, true),
    listFivemGoalSubmissions(guildId, normalizedBotId)
  ]);
  const approved = submissions.filter((item) => item.status === "approved");
  const totals = new Map<string, number>();
  for (const item of approved) totals.set(item.userId, (totals.get(item.userId) ?? 0) + item.value);
  const ranking = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([rankedUserId, total], index) => ({ rank: index + 1, total, userId: rankedUserId }));
  return {
    configs,
    ranking,
    submissions: submissions.filter((item) => item.userId === userId),
    userId
  };
}

export async function moderateFivemGoalSubmission(guildId: string, botId: string | null, submissionId: string, actorId: string | null, status: "approved" | "refused", refusalReason?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();
  const { fivemGoalSubmissions } = await getMongoCollections();
  const update = status === "approved"
    ? { approvedAt: now, approvedBy: actorId, refusedAt: null, refusedBy: null, refusalReason: null, status, updatedAt: now }
    : { refusedAt: now, refusedBy: actorId, refusalReason: normalizeText(refusalReason, 800), status, updatedAt: now };
  const row = await fivemGoalSubmissions.findOneAndUpdate(
    { _id: submissionId, ...scopeQuery(guildId, normalizedBotId), status: "pending" },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!row) return null;
  await writeFivemGoalLog({ action: status === "approved" ? "submission.approved" : "submission.refused", botId: normalizedBotId, details: { refusalReason: update.refusalReason ?? null, value: row.value }, guildId, metaId: row.metaId, userId: actorId });
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, normalizedBotId), "fivem:goals:updated", { botId: normalizedBotId, guildId });
  return toSubmissionDto(row);
}

export async function listFivemGoalLogs(guildId: string, botId?: string | null, metaId?: string | null) {
  const { fivemGoalLogs } = await getMongoCollections();
  const rows = await fivemGoalLogs
    .find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(metaId ? { metaId } : {}) })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return rows.map(toLogDto);
}

async function ensureDefaultGoalConfigFromLegacy(settings: FivemGoalSettingsDto, actorId: string | null) {
  const { fivemGoalConfigs } = await getMongoCollections();
  const exists = await fivemGoalConfigs.findOne(scopeQuery(settings.guildId, normalizeBotId(settings.botId)));
  if (exists || (!settings.enabled && !settings.updatedAt)) return;
  const now = new Date();
  const doc: MongoFivemGoalConfig = {
    _id: randomUUID(),
    ...normalizeConfigInput({
      description: "Meta migrada automaticamente da configuracao antiga.",
      fields: settings.fields,
      logChannelId: settings.logChannelId,
      managerRoleIds: settings.managerRoleId ? [settings.managerRoleId] : [],
      name: "Meta Principal",
      participantRoleIds: settings.viewRoleId ? [settings.viewRoleId] : [],
      requiresApproval: false,
      requiresProof: true,
      status: settings.enabled ? "active" : "paused",
      targetValue: 1,
      type: "farm"
    }, settings.guildId, normalizeBotId(settings.botId)),
    botId: normalizeBotId(settings.botId),
    createdAt: now,
    createdBy: actorId,
    guildId: settings.guildId,
    panelMessageId: null,
    updatedAt: now,
    updatedBy: actorId
  };
  await fivemGoalConfigs.insertOne(doc);
}

function normalizeSettings(settings: FivemGoalSettingsDto): FivemGoalSettingsDto {
  return {
    ...settings,
    categoryId: normalizeSnowflake(settings.categoryId),
    channelNameTemplate: normalizeText(settings.channelNameTemplate, 80) || "📈・{username}",
    fields: normalizeFields(settings.fields),
    items: normalizeItems(settings.items),
    logChannelId: normalizeSnowflake(settings.logChannelId),
    managerRoleId: normalizeSnowflake(settings.managerRoleId),
    requestPanelChannelId: normalizeSnowflake(settings.requestPanelChannelId),
    requestPanelDescription: normalizeText(settings.requestPanelDescription, 900) || "Solicite seu canal individual de meta para enviar comprovantes, acompanhar sua producao semanal e visualizar seu progresso.",
    requestPanelEnabled: settings.requestPanelEnabled !== false,
    requestPanelMessageId: normalizeSnowflake(settings.requestPanelMessageId),
    requestPanelTitle: normalizeText(settings.requestPanelTitle, 120) || "Sistema de Metas FiveM",
    requestRequiresApproval: settings.requestRequiresApproval === true,
    autoCreateWithManualRegistration: settings.autoCreateWithManualRegistration !== false,
    viewRoleId: normalizeSnowflake(settings.viewRoleId)
  };
}

function normalizeFields(fields: FivemGoalFieldDto[]) {
  const normalized = (Array.isArray(fields) ? fields : []).map((field, index) => {
    const label = normalizeText(field.label, 80) || `Campo ${index + 1}`;
    return {
      id: normalizeText(field.id, 80) || slug(label) || `campo-${index + 1}`,
      label,
      maxLength: clamp(field.maxLength, 1, 1500),
      minLength: clamp(field.minLength, 0, 1500),
      placeholder: normalizeText(field.placeholder, 100),
      required: field.required !== false,
      style: field.style === "paragraph" ? "paragraph" as const : "short" as const
    };
  }).slice(0, 5);
  return normalized.length ? normalized : DEFAULT_FIELDS.map((field) => ({ ...field }));
}

function normalizeItems(items: FivemGoalItemDto[]) {
  const normalized = (Array.isArray(items) ? items : []).map((item, index) => {
    const name = normalizeText(item.name, 80) || `Item ${index + 1}`;
    return {
      category: normalizeText(item.category, 80),
      color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color : null,
      emoji: normalizeText(item.emoji, 80),
      enabled: item.enabled !== false,
      id: normalizeText(item.id, 80) || slug(name) || `item-${index + 1}`,
      name,
      order: Number.isFinite(item.order) ? Math.trunc(item.order) : index + 1
    };
  }).slice(0, 100);
  return normalized.length ? normalized : DEFAULT_ITEMS.map((item) => ({ ...item }));
}

function toSettingsDto(settings: MongoFivemGoalSettings): FivemGoalSettingsDto {
  return normalizeSettings({
    autoCreateWithManualRegistration: settings.autoCreateWithManualRegistration !== false,
    botId: normalizeBotId(settings.botId),
    categoryId: settings.categoryId,
    channelNameTemplate: settings.channelNameTemplate,
    enabled: settings.enabled === true,
    fields: settings.fields as FivemGoalFieldDto[],
    guildId: settings.guildId,
    items: settings.items as FivemGoalItemDto[],
    logChannelId: settings.logChannelId,
    managerRoleId: settings.managerRoleId,
    requestPanelChannelId: settings.requestPanelChannelId ?? null,
    requestPanelDescription: settings.requestPanelDescription ?? "Solicite seu canal individual de meta para enviar comprovantes, acompanhar sua producao semanal e visualizar seu progresso.",
    requestPanelEnabled: settings.requestPanelEnabled !== false,
    requestPanelMessageId: settings.requestPanelMessageId ?? null,
    requestPanelTitle: settings.requestPanelTitle ?? "Sistema de Metas FiveM",
    requestRequiresApproval: settings.requestRequiresApproval === true,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    viewRoleId: settings.viewRoleId
  });
}

function toUserChannelDto(row: MongoFivemGoalUserChannel): FivemGoalUserChannelDto {
  return { botId: normalizeBotId(row.botId), channelId: row.channelId, createdAt: row.createdAt.toISOString(), guildId: row.guildId, updatedAt: row.updatedAt.toISOString(), userId: row.userId };
}

function toEntryDto(row: MongoFivemGoalEntry): FivemGoalEntryDto {
  return { botId: normalizeBotId(row.botId), channelId: row.channelId, createdAt: row.createdAt.toISOString(), fields: row.fields, guildId: row.guildId, id: row._id, imageUrl: row.imageUrl, itemId: row.itemId, quantity: row.quantity, updatedAt: row.updatedAt.toISOString(), userId: row.userId };
}

function toConfigDto(row: MongoFivemGoalConfig, progress?: { currentValue: number; totalParticipants: number }): FivemGoalConfigDto {
  return {
    approverRoleIds: row.approverRoleIds ?? [],
    botId: normalizeBotId(row.botId),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ?? null,
    currentValue: progress?.currentValue ?? 0,
    deleteRoleIds: row.deleteRoleIds ?? [],
    description: row.description ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    editRoleIds: row.editRoleIds ?? [],
    fields: normalizeFields(row.fields as FivemGoalFieldDto[]),
    guildId: row.guildId,
    id: row._id,
    logChannelId: row.logChannelId ?? null,
    managerRoleIds: row.managerRoleIds ?? [],
    name: row.name,
    order: Number.isFinite(row.order) ? row.order! : 0,
    panelChannelId: row.panelChannelId ?? null,
    panelMessageId: row.panelMessageId ?? null,
    participantRoleIds: row.participantRoleIds ?? [],
    period: normalizePeriod(row.period),
    requiresApproval: row.requiresApproval === true,
    requiresProof: row.requiresProof !== false,
    resetConfig: normalizeResetConfig(row.resetConfig),
    rules: row.rules ?? null,
    status: normalizeStatus(row.status),
    targetValue: Number.isFinite(row.targetValue) ? row.targetValue : 1,
    totalParticipants: progress?.totalParticipants ?? 0,
    type: normalizeText(row.type, 80) || "personalizada",
    unit: normalizeText(row.unit, 40) || "Unidades",
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? null,
    viewerRoleIds: row.viewerRoleIds ?? []
  };
}

function toSubmissionDto(row: MongoFivemGoalSubmission): FivemGoalSubmissionDto {
  return {
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedBy: row.approvedBy ?? null,
    botId: normalizeBotId(row.botId),
    createdAt: row.createdAt.toISOString(),
    description: row.description ?? null,
    fields: row.fields ?? [],
    guildId: row.guildId,
    id: row._id,
    metaId: row.metaId,
    proofUrl: row.proofUrl ?? null,
    refusedAt: row.refusedAt?.toISOString() ?? null,
    refusedBy: row.refusedBy ?? null,
    refusalReason: row.refusalReason ?? null,
    roleIdsSnapshot: row.roleIdsSnapshot ?? [],
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
    value: row.value
  };
}

function toLogDto(row: MongoFivemGoalLog): FivemGoalLogDto {
  return {
    action: row.action,
    botId: normalizeBotId(row.botId),
    createdAt: row.createdAt.toISOString(),
    details: row.details ?? {},
    guildId: row.guildId,
    id: row._id,
    metaId: row.metaId ?? null,
    userId: row.userId ?? null
  };
}

function normalizeConfigInput(input: Partial<FivemGoalConfigDto>, guildId: string, botId: string | null): Omit<MongoFivemGoalConfig, "_id" | "createdAt" | "createdBy" | "guildId" | "panelMessageId" | "updatedAt" | "updatedBy"> {
  return {
    approverRoleIds: normalizeRoleIds(input.approverRoleIds ?? []),
    botId,
    deleteRoleIds: normalizeRoleIds(input.deleteRoleIds ?? []),
    description: normalizeText(input.description, 1000),
    editRoleIds: normalizeRoleIds(input.editRoleIds ?? []),
    fields: normalizeFields(input.fields ?? DEFAULT_FIELDS),
    logChannelId: normalizeSnowflake(input.logChannelId),
    managerRoleIds: normalizeRoleIds(input.managerRoleIds ?? []),
    name: normalizeText(input.name, 100) || "Nova Meta",
    order: Number.isFinite(input.order) ? Math.max(0, Math.trunc(input.order!)) : 0,
    panelChannelId: normalizeSnowflake(input.panelChannelId),
    participantRoleIds: normalizeRoleIds(input.participantRoleIds ?? []),
    period: normalizePeriod(input.period),
    requiresApproval: input.requiresApproval === true,
    requiresProof: input.requiresProof === true,
    resetConfig: normalizeResetConfig(input.resetConfig),
    rules: normalizeText(input.rules, 2000),
    status: normalizeStatus(input.status),
    targetValue: normalizeTargetValue(input.targetValue),
    type: normalizeText(input.type, 80) || "personalizada",
    unit: normalizeText(input.unit, 40) || "Unidades",
    viewerRoleIds: normalizeRoleIds(input.viewerRoleIds ?? [])
  };
}

async function writeFivemGoalLog(input: Omit<MongoFivemGoalLog, "_id" | "createdAt">) {
  const { fivemGoalLogs } = await getMongoCollections();
  await fivemGoalLogs.insertOne({
    _id: randomUUID(),
    action: input.action,
    botId: normalizeBotId(input.botId),
    createdAt: new Date(),
    details: input.details ?? {},
    guildId: input.guildId,
    metaId: input.metaId ?? null,
    userId: input.userId ?? null
  });
}

function normalizeRoleIds(values: string[]) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))].slice(0, 100);
}

function normalizeStatus(value: unknown): FivemGoalConfigStatus {
  return value === "paused" || value === "finished" ? value : "active";
}

function normalizePeriod(value: unknown): FivemGoalConfigPeriod {
  return value === "daily" || value === "monthly" || value === "custom" ? value : "weekly";
}

function normalizeResetConfig(value: FivemGoalConfigDto["resetConfig"] | undefined) {
  const frequency: "none" | "daily" | "weekly" | "monthly" | "custom" = value?.frequency === "daily" || value?.frequency === "weekly" || value?.frequency === "monthly" || value?.frequency === "custom" ? value.frequency : "none";
  return {
    customDate: /^\d{4}-\d{2}-\d{2}$/.test(value?.customDate ?? "") ? value?.customDate ?? null : null,
    enabled: value?.enabled === true && frequency !== "none",
    frequency
  };
}

function normalizeTargetValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function resolveGoalSubmissionValue(row: MongoFivemGoalSubmission) {
  const valueField = row.fields.find((field) => /giro|euro|dinheiro|valor|money/i.test(`${field.id} ${field.label}`))
    ?? row.fields.find((field) => /quantidade|qtd/i.test(`${field.id} ${field.label}`));
  const parsedFieldValue = valueField ? parseGoalNumericValue(valueField.value) : null;
  if (parsedFieldValue !== null) return parsedFieldValue;
  return Number.isFinite(row.value) ? Math.max(0, row.value) : 0;
}

function parseGoalNumericValue(value: string) {
  const normalized = value.trim().replace(/[^\d.,-]/g, "");
  if (!normalized || normalized === "-") return null;
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/-/g, "");
  const comma = unsigned.lastIndexOf(",");
  const dot = unsigned.lastIndexOf(".");
  let numeric: string;

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    numeric = unsigned.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(unsigned)) {
    numeric = unsigned.replace(/[.,]/g, "");
  } else if (comma >= 0) {
    numeric = unsigned.replace(/\./g, "").replace(",", ".");
  } else {
    numeric = unsigned.replace(/,/g, "");
  }

  const parsed = Number(`${negative ? "-" : ""}${numeric}`);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currentSaoPauloWeek(now = new Date()) {
  const saoPauloOffsetMs = -3 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + saoPauloOffsetMs);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - daysSinceMonday);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() - saoPauloOffsetMs);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { end, start };
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

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}

function clamp(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
