import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText } from "../config/systemEmojis";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemGoalCorrectionRequest,
  type MongoFivemGoalConfig,
  type MongoFivemGoalEntry,
  type MongoFivemGoalLog,
  type MongoFivemGoalSettings,
  type MongoFivemGoalSubmission,
  type MongoFivemGoalUserChannel
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom, emitRealtimeToRoomWithAck } from "../realtime/events";

export const FIVEM_GOALS_MODULE_ID = "fivem-goals";
const WEEKLY_RANKING_LIMIT = 10;

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
  createdAt: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
  requiredAmount: number;
  type: "required" | "additional" | "optional";
  updatedAt: string | null;
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
  rankingChannelId: string | null;
  rankingMessageId: string | null;
  requestPanelChannelId: string | null;
  requestPanelDescription: string;
  requestPanelEnabled: boolean;
  requestPanelMessageId: string | null;
  requestPanelTitle: string;
  requestRequiresApproval: boolean;
  updatedAt: string | null;
  viewRoleId: string | null;
  version: number;
  roomRequestEnabled: boolean;
  setRequestEnabled: boolean;
  automaticImageCaptureEnabled: boolean;
  absenceEnabled: boolean;
  weeklySummaryEnabled: boolean;
  directMessagesEnabled: boolean;
  memberCleanupEnabled: boolean;
  automaticNicknameEnabled: boolean;
  automaticRoleEnabled: boolean;
  timezone: string;
  approvalChannelId: string | null;
  summaryChannelId: string | null;
  auditChannelId: string | null;
  verificationRoleId: string | null;
  managerRoleIds: string[];
  viewerRoleIds: string[];
  categoryRules: Array<{ id: string; name: string; sourceRoleId: string; categoryId: string; grantedRoleId: string | null; buttonLabel: string; priority: number; active: boolean }>;
  approvalTypes: Array<{ id: string; name: string; buttonLabel: string; roleId: string | null; categoryId: string | null; nicknameTemplate: string | null; active: boolean; displayOrder: number }>;
  setFormFields: Array<{ id: string; label: string; placeholder: string | null; required: boolean; maxLength: number; showInLogs: boolean; order: number }>;
  commandPermissions: { visibleRoleIds: string[]; executableRoleIds: string[]; visibleUserIds: string[]; executableUserIds: string[]; allowAdministrators: boolean; allowOwner: boolean };
  actionPermissions: Record<string, string[]>;
  cycle: { startDay: number; startTime: string; endDay: number; endTime: string; firstExecution: string | null; frequency: "weekly" | "custom"; absencePolicy: "none" | "daily" | "full" | "manual"; latePolicy: "accept" | "reject" | "flag" };
  panelVisual: { title: string; description: string; footer: string | null; imageUrl: string | null; mediaUrl: string | null; mediaType: "image" | "gif" | "video" | "none"; loopVideo: boolean; color: string };
  notificationSettings: { mentionUserOnFailure: boolean; mentionManagerOnFailure: boolean; approvalDm: string; rejectionDm: string; farewellDm: string };
  correctionManagement: {
    allowAdministrators: boolean;
    allowClosedPeriods: boolean;
    defaultDeadline: "none" | "12h" | "24h" | "48h" | "weekly_close" | "custom";
    customDeadlineHours: number | null;
    logChannelId: string | null;
    managerRoleId: string | null;
    maxCorrectionsPerPeriod: number | null;
    notifyResponsibleTeam: boolean;
    notifyUser: boolean;
    requireReason: boolean;
    allowRestoreOriginal: boolean;
  };
  cooldownSeconds: number;
  tutorial: { completedBy: string[]; skippedBy: string[] };
};

export type FivemGoalEntryDto = {
  attachmentId: string | null;
  botId: string | null;
  channelId: string;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  imageUrl: string;
  itemId: string | null;
  metaId: string | null;
  quantity: number | null;
  status: "confirmed" | "correction_requested" | "corrected" | "correction_expired" | "invalidated";
  correctionRequestId: string | null;
  replacedByRegistrationId: string | null;
  replacementForRegistrationId: string | null;
  sourceMessageId: string | null;
  updatedAt: string;
  userId: string;
};

export type FivemGoalCorrectionRequestDto = {
  botId: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  correctedAt: string | null;
  expiresAt: string | null;
  guildId: string;
  id: string;
  originalRegistration: FivemGoalEntryDto | null;
  originalRegistrationId: string;
  reason: string;
  replacementRegistrationId: string | null;
  requestedAt: string;
  requestedByName: string | null;
  requestedByUserId: string;
  restoreOriginalOnCancel: boolean | null;
  roomId: string;
  status: "pending" | "corrected" | "cancelled" | "expired";
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
  status: "pending" | "approved" | "refused" | "correction_requested";
  registrationId: string | null;
  correctionRequestId: string | null;
  replacementForRegistrationId: string | null;
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

export type FivemGoalRankingMemberDto = {
  firstFarmAt: string;
  items: Array<{ emoji: string | null; itemId: string | null; name: string; quantity: number }>;
  rank: number;
  registeredName: string;
  targetValue: number;
  total: number;
  userId: string;
};

export type FivemGoalRankingRuntimeDto = {
  generatedAt: string;
  members: FivemGoalRankingMemberDto[];
  periodEnd: string;
  periodStart: string;
  settings: Pick<FivemGoalSettingsDto, "rankingChannelId" | "rankingMessageId" | "summaryChannelId">;
  totalPlayers: number;
};

const DEFAULT_ITEMS: FivemGoalItemDto[] = [
  { category: "Dinheiro", color: "#22c55e", createdAt: null, emoji: fixedSystemEmojiText("dinheiro"), enabled: true, id: "euro-sujo", name: "Euro Sujo", order: 1, requiredAmount: 100000, type: "required", updatedAt: null },
  { category: "Itens", color: "#38bdf8", createdAt: null, emoji: fixedSystemEmojiText("caixa"), enabled: true, id: "diamante", name: "Diamante", order: 2, requiredAmount: 1, type: "additional", updatedAt: null },
  { category: "Armas", color: "#f97316", createdAt: null, emoji: fixedSystemEmojiText("arma"), enabled: true, id: "armas", name: "Armas", order: 3, requiredAmount: 1, type: "additional", updatedAt: null },
  { category: "Itens", color: "#a855f7", createdAt: null, emoji: fixedSystemEmojiText("caixa"), enabled: true, id: "contrabando", name: "Contrabando", order: 4, requiredAmount: 1, type: "additional", updatedAt: null }
];

export function defaultFivemGoalSettings(guildId: string, botId: string | null = null): FivemGoalSettingsDto {
  return {
    autoCreateWithManualRegistration: true,
    botId,
    categoryId: null,
    channelNameTemplate: "meta-{username}",
    enabled: false,
    fields: [],
    guildId,
    items: DEFAULT_ITEMS.map((item) => ({ ...item })),
    logChannelId: null,
    managerRoleId: null,
    rankingChannelId: null,
    rankingMessageId: null,
    requestPanelChannelId: null,
    requestPanelDescription: "Solicite seu canal individual de meta para enviar comprovantes, acompanhar sua produção semanal e visualizar seu progresso.",
    requestPanelEnabled: true,
    requestPanelMessageId: null,
    requestPanelTitle: "Sistema de Metas FiveM",
    requestRequiresApproval: false,
    updatedAt: null,
    viewRoleId: null
    ,version: 1
    ,roomRequestEnabled: true
    ,setRequestEnabled: false
    ,automaticImageCaptureEnabled: true
    ,absenceEnabled: false
    ,weeklySummaryEnabled: true
    ,directMessagesEnabled: true
    ,memberCleanupEnabled: true
    ,automaticNicknameEnabled: true
    ,automaticRoleEnabled: true
    ,timezone: "America/Sao_Paulo"
    ,approvalChannelId: null
    ,summaryChannelId: null
    ,auditChannelId: null
    ,verificationRoleId: null
    ,managerRoleIds: []
    ,viewerRoleIds: []
    ,categoryRules: []
    ,approvalTypes: []
    ,setFormFields: [
      { id: "nome", label: "Nome", placeholder: "Seu nome", required: true, maxLength: 80, showInLogs: true, order: 1 },
      { id: "nome_jogo", label: "Nome no jogo", placeholder: "Seu nome no jogo", required: true, maxLength: 80, showInLogs: true, order: 2 },
      { id: "id", label: "ID", placeholder: "Seu ID", required: true, maxLength: 40, showInLogs: true, order: 3 },
      { id: "telefone", label: "Telefone", placeholder: "Seu telefone", required: true, maxLength: 40, showInLogs: true, order: 4 }
    ]
    ,commandPermissions: { visibleRoleIds: [], executableRoleIds: [], visibleUserIds: [], executableUserIds: [], allowAdministrators: true, allowOwner: true }
    ,actionPermissions: {}
    ,cycle: { startDay: 1, startTime: "00:00", endDay: 0, endTime: "23:59", firstExecution: null, frequency: "weekly", absencePolicy: "none", latePolicy: "flag" }
    ,panelVisual: { title: "Sistema de Metas", description: "Solicite sua sala ou envie seu cadastro para análise.", footer: null, imageUrl: null, mediaUrl: null, mediaType: "none", loopVideo: false, color: "#22c55e" }
    ,notificationSettings: { mentionUserOnFailure: true, mentionManagerOnFailure: true, approvalDm: "Bem-vindo ao {nome_servidor}! Sua solicitação foi aprovada como {tipo_aprovacao}.", rejectionDm: "Sua solicitação para entrar no {nome_servidor} não foi aprovada neste momento.", farewellDm: "Obrigado por fazer parte do {nome_servidor}." }
    ,correctionManagement: { allowAdministrators: false, allowClosedPeriods: false, defaultDeadline: "weekly_close", customDeadlineHours: null, logChannelId: null, managerRoleId: null, maxCorrectionsPerPeriod: null, notifyResponsibleTeam: true, notifyUser: true, requireReason: true, allowRestoreOriginal: true }
    ,cooldownSeconds: 30
    ,tutorial: { completedBy: [], skippedBy: [] }
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
  if (typeof input.version === "number" && input.version !== current.version) {
    throw Object.assign(new Error("Esta configuração foi alterada por outra pessoa. Atualize a página antes de salvar novamente."), { status: 409 });
  }
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId, version: current.version + 1 });
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
  if (normalizedBotId && saved.enabled && saved.rankingChannelId && saved.rankingChannelId !== current.rankingChannelId) {
    emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:goals:panel_publish", { botId: normalizedBotId, guildId, settings: saved });
  }
  return saved;
}

export async function requestFivemGoalPanelPublish(guildId: string, botId: string, actorId: string | null) {
  const settings = await getFivemGoalSettings(guildId, botId);
  if (!settings.enabled) throw new Error("Ative o sistema de metas antes de publicar o painel.");
  if (!settings.requestPanelChannelId && !settings.rankingChannelId) throw new Error("Configure o canal do painel de solicitação ou o canal do ranking de metas.");

  await writeFivemGoalLog({
    action: "request_panel.publish_requested",
    botId,
    details: { channelId: settings.requestPanelChannelId, rankingChannelId: settings.rankingChannelId },
    guildId,
    metaId: null,
    userId: actorId
  });

  const responses = await emitRealtimeToRoomWithAck<
    { botId: string; guildId: string; settings: FivemGoalSettingsDto },
    { error?: string; ok: boolean; rankingMessageId?: string | null; requestPanelMessageId?: string | null }
  >(devBotRealtimeRoom(botId), "fivem:goals:panel_publish", { botId, guildId, settings }, 30_000);
  const success = responses.find((response) => response?.ok);
  if (!success) {
    const errorMessage = responses.find((response) => response?.error)?.error
      ?? "O bot DEV não confirmou a publicação. Verifique se ele está online e com permissão no canal configurado.";
    await writeFivemGoalLog({
      action: "request_panel.publish_failed",
      botId,
      details: { error: errorMessage, responses },
      guildId,
      metaId: null,
      userId: actorId
    });
    throw Object.assign(new Error(errorMessage), { statusCode: 409 });
  }

  return settings;
}

export async function updateFivemGoalRequestPanelState(guildId: string, botId: string | null, messageId: string | null, channelId?: string | null) {
  const patch: Partial<FivemGoalSettingsDto> = { requestPanelMessageId: messageId };
  if (channelId !== undefined) patch.requestPanelChannelId = channelId;
  const settings = await saveFivemGoalSettings(guildId, botId, patch, null);
  await writeFivemGoalLog({
    action: "request_panel.state_updated",
    botId: normalizeBotId(botId),
    details: { channelId: channelId ?? settings.requestPanelChannelId, messageId },
    guildId,
    metaId: null,
    userId: null
  });
  return settings;
}

export async function updateFivemGoalRankingPanelState(guildId: string, botId: string | null, messageId: string | null, channelId?: string | null) {
  const patch: Partial<FivemGoalSettingsDto> = { rankingMessageId: messageId };
  if (channelId !== undefined) patch.rankingChannelId = channelId;
  return saveFivemGoalSettings(guildId, botId, patch, null);
}

export async function getFivemGoalRankingRuntime(guildId: string, botId?: string | null): Promise<FivemGoalRankingRuntimeDto> {
  const normalizedBotId = normalizeBotId(botId);
  const { start, end } = currentSaoPauloWeek();
  const { fivemGoalEntries, manualRegistrationSubmissions } = await getMongoCollections();
  const [settings, entries, registrations] = await Promise.all([
    getFivemGoalSettings(guildId, normalizedBotId),
    fivemGoalEntries.find({
      ...scopeQuery(guildId, normalizedBotId),
      createdAt: { $gte: start, $lt: end },
      $or: [{ status: "confirmed" }, { status: { $exists: false } }]
    }).sort({ createdAt: 1 }).limit(10000).toArray(),
    manualRegistrationSubmissions.find({
      ...scopeQuery(guildId, normalizedBotId),
      status: "approved"
    }).sort({ approvedAt: -1, createdAt: -1 }).limit(5000).toArray()
  ]);
  const registeredNames = new Map<string, string>();
  for (const registration of registrations) {
    if (!registeredNames.has(registration.userId)) registeredNames.set(registration.userId, manualRegistrationDisplayName(registration.fields, registration.requestedName ?? registration.username));
  }
  const items = new Map(settings.items.map((item) => [item.id, item]));
  const targetValue = Math.max(1, settings.items.filter((item) => item.enabled !== false).reduce((sum, item) => sum + Math.max(0, item.requiredAmount || 0), 0));
  const members = new Map<string, Omit<FivemGoalRankingMemberDto, "rank">>();
  for (const entry of entries) {
    const quantity = typeof entry.quantity === "number" && Number.isFinite(entry.quantity) ? entry.quantity : 0;
    if (quantity <= 0) continue;
    const current = members.get(entry.userId) ?? {
      firstFarmAt: entry.createdAt.toISOString(),
      items: [],
      registeredName: registeredNames.get(entry.userId) ?? "Sem cadastro no Set",
      targetValue,
      total: 0,
      userId: entry.userId
    };
    current.total += quantity;
    if (entry.createdAt.toISOString() < current.firstFarmAt) current.firstFarmAt = entry.createdAt.toISOString();
    const item = entry.itemId ? items.get(entry.itemId) : null;
    const itemName = item?.name ?? entry.fields.find((field) => /item|tipo|meta/i.test(`${field.id} ${field.label}`))?.value ?? "Farm";
    const existingItem = current.items.find((row) => row.itemId === (entry.itemId ?? itemName));
    if (existingItem) existingItem.quantity += quantity;
    else current.items.push({ emoji: item?.emoji ?? null, itemId: entry.itemId ?? null, name: itemName, quantity });
    members.set(entry.userId, current);
  }
  const ranked = [...members.values()]
    .sort((a, b) => b.total - a.total || Date.parse(a.firstFarmAt) - Date.parse(b.firstFarmAt) || a.userId.localeCompare(b.userId))
    .map((member, index) => ({ ...member, items: member.items.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)), rank: index + 1 }));
  return {
    generatedAt: new Date().toISOString(),
    members: ranked,
    periodEnd: end.toISOString(),
    periodStart: start.toISOString(),
    settings: {
      rankingChannelId: settings.rankingChannelId,
      rankingMessageId: settings.rankingMessageId,
      summaryChannelId: settings.summaryChannelId
    },
    totalPlayers: ranked.length
  };
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

export async function finalizeCurrentFivemGoalPeriod(input: {
  actorId: string | null;
  botId?: string | null;
  finalizationType?: "manual" | "automatic";
  guildId: string;
}) {
  const normalizedBotId = normalizeBotId(input.botId);
  const report = await getCurrentWeekFivemGoalReport(input.guildId, normalizedBotId);
  const { fivemGoalLogs } = await getMongoCollections();
  const existing = await fivemGoalLogs.findOne({
    action: "period.finalized",
    ...scopeQuery(input.guildId, normalizedBotId),
    "details.periodEnd": report.periodEnd,
    "details.periodStart": report.periodStart
  });

  if (existing) {
    return {
      alreadyFinalized: true,
      finalized: false,
      logId: existing._id,
      report
    };
  }

  await writeFivemGoalLog({
    action: "period.finalized",
    botId: normalizedBotId,
    details: {
      approvedCount: report.approvedCount,
      finalizationType: input.finalizationType ?? "manual",
      participantCount: report.participantCount,
      pendingCount: report.pendingCount,
      periodEnd: report.periodEnd,
      periodStart: report.periodStart,
      refusedCount: report.refusedCount,
      totalApprovedValue: report.totalApprovedValue,
      totalPendingValue: report.totalPendingValue,
      totalRecords: report.totalRecords
    },
    guildId: input.guildId,
    metaId: null,
    userId: input.actorId
  });

  return {
    alreadyFinalized: false,
    finalized: true,
    logId: null,
    report
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
    throw new Error("Metas com histórico não podem ser apagadas fisicamente. Desative ou arquive a meta.");
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

export async function deleteFivemGoalUserChannelByChannel(channelId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemGoalUserChannels } = await getMongoCollections();
  const row = await fivemGoalUserChannels.findOne({ botId: normalizedBotId, channelId });
  if (!row) return null;
  await fivemGoalUserChannels.deleteOne({ _id: row._id, botId: normalizedBotId });
  await writeFivemGoalLog({
    action: "room.closed",
    botId: normalizedBotId,
    details: { channelId },
    guildId: row.guildId,
    metaId: null,
    userId: row.userId
  });
  if (normalizedBotId) {
    emitRealtimeToRoom(dashboardLogRealtimeRoom(row.guildId, normalizedBotId), "fivem:goals:updated", { botId: normalizedBotId, guildId: row.guildId });
  }
  return toUserChannelDto(row);
}

export async function createFivemGoalEntry(input: {
  attachmentId?: string | null;
  botId?: string | null;
  channelId: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  imageUrl: string;
  idempotencyKey?: string | null;
  itemId?: string | null;
  metaId?: string | null;
  quantity?: number | null;
  correctionRequestId?: string | null;
  replacementForRegistrationId?: string | null;
  roleIdsSnapshot?: string[];
  sourceMessageId?: string | null;
  userId: string;
}) {
  const now = new Date();
  const normalizedBotId = normalizeBotId(input.botId);
  const sourceMessageId = normalizeSnowflake(input.sourceMessageId);
  const attachmentId = normalizeText(input.attachmentId, 120);
  const itemId = normalizeText(input.itemId, 80);
  const idempotencyKey = normalizeText(input.idempotencyKey, 240)
    ?? (sourceMessageId && attachmentId ? `${input.guildId}:${input.channelId}:${sourceMessageId}:${attachmentId}:${itemId ?? "default"}` : null);
  const { fivemGoalEntries } = await getMongoCollections();
  const existing = idempotencyKey
    ? await fivemGoalEntries.findOne({ ...scopeQuery(input.guildId, normalizedBotId), idempotencyKey })
    : sourceMessageId && attachmentId
      ? await fivemGoalEntries.findOne({ ...scopeQuery(input.guildId, normalizedBotId), sourceMessageId, attachmentId })
      : null;
  if (existing) return toEntryDto(existing);

  const doc: MongoFivemGoalEntry = {
    _id: randomUUID(),
    attachmentId,
    botId: normalizedBotId,
    channelId: input.channelId,
    createdAt: now,
    fields: input.fields.map((field) => ({ id: field.id, label: field.label.slice(0, 100), value: field.value.slice(0, 1500) })),
    guildId: input.guildId,
    imageUrl: input.imageUrl.slice(0, 2048),
    idempotencyKey,
    itemId,
    metaId: input.metaId ?? null,
    quantity: typeof input.quantity === "number" && Number.isFinite(input.quantity) ? input.quantity : null,
    status: "confirmed",
    correctionRequestId: normalizeText(input.correctionRequestId, 120),
    replacementForRegistrationId: normalizeText(input.replacementForRegistrationId, 120),
    replacedByRegistrationId: null,
    sourceMessageId,
    updatedAt: now,
    userId: input.userId
  };
  await fivemGoalEntries.insertOne(doc);
  await createFivemGoalSubmission({
    botId: input.botId,
    description: input.fields.find((field) => /obs|descricao|descri/i.test(field.id))?.value ?? null,
    fields: input.fields,
    guildId: input.guildId,
    metaId: input.metaId ?? null,
    proofUrl: input.imageUrl,
    idempotencyKey,
    registrationId: doc._id,
    correctionRequestId: doc.correctionRequestId,
    replacementForRegistrationId: doc.replacementForRegistrationId,
    roleIdsSnapshot: input.roleIdsSnapshot ?? [],
    userId: input.userId,
    value: doc.quantity ?? 0
  }).catch(() => null);
  if (doc.correctionRequestId && doc.replacementForRegistrationId) {
    await completeFivemGoalCorrectionRequest(input.guildId, normalizedBotId, doc.correctionRequestId, doc.replacementForRegistrationId, doc._id, input.userId);
  }
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

export async function listCurrentFivemGoalCorrectionCandidates(guildId: string, botId: string | null, userId: string) {
  const normalizedBotId = normalizeBotId(botId);
  const { start, end } = currentSaoPauloWeek();
  const { fivemGoalEntries } = await getMongoCollections();
  const rows = await fivemGoalEntries.find({
    ...scopeQuery(guildId, normalizedBotId),
    userId,
    createdAt: { $gte: start, $lt: end },
    $or: [{ status: "confirmed" }, { status: { $exists: false } }]
  }).sort({ createdAt: -1 }).limit(25).toArray();
  return rows.map(toEntryDto);
}

export async function listPendingFivemGoalCorrections(guildId: string, botId: string | null, userId: string, roomId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemGoalCorrectionRequests, fivemGoalEntries } = await getMongoCollections();
  const rows = await fivemGoalCorrectionRequests.find({
    ...scopeQuery(guildId, normalizedBotId),
    userId,
    status: "pending",
    ...(roomId ? { roomId } : {})
  }).sort({ requestedAt: 1 }).limit(25).toArray();
  const originals = rows.length
    ? await fivemGoalEntries.find({ ...scopeQuery(guildId, normalizedBotId), _id: { $in: rows.map((row) => row.originalRegistrationId) } }).toArray()
    : [];
  const originalsById = new Map(originals.map((row) => [row._id, toEntryDto(row)]));
  return rows.map((row) => toCorrectionRequestDto(row, originalsById.get(row.originalRegistrationId) ?? null));
}

export async function requestFivemGoalCorrection(input: {
  botId?: string | null;
  guildId: string;
  originalRegistrationId: string;
  reason: string;
  requestedByName?: string | null;
  requestedByUserId: string;
}) {
  const normalizedBotId = normalizeBotId(input.botId);
  const reason = normalizeText(input.reason, 1000);
  if (!reason || reason.length < 8) {
    throw Object.assign(new Error("O motivo da correção deve ter pelo menos 8 caracteres."), { status: 400 });
  }
  const now = new Date();
  const settings = await getFivemGoalSettings(input.guildId, normalizedBotId);
  const { fivemGoalEntries, fivemGoalCorrectionRequests, fivemGoalSubmissions } = await getMongoCollections();
  const original = await fivemGoalEntries.findOne({
    _id: input.originalRegistrationId,
    ...scopeQuery(input.guildId, normalizedBotId),
    $or: [{ status: "confirmed" }, { status: { $exists: false } }]
  });
  if (!original) {
    throw Object.assign(new Error("Registro confirmado não encontrado ou já está em correção."), { status: 404 });
  }
  const deadline = resolveCorrectionDeadline(settings, now);
  const doc: MongoFivemGoalCorrectionRequest = {
    _id: randomUUID(),
    botId: normalizedBotId,
    guildId: input.guildId,
    userId: original.userId,
    roomId: original.channelId,
    originalRegistrationId: original._id,
    replacementRegistrationId: null,
    requestedByUserId: input.requestedByUserId,
    requestedByName: normalizeText(input.requestedByName, 120),
    reason,
    status: "pending",
    restoreOriginalOnCancel: null,
    requestedAt: now,
    expiresAt: deadline,
    correctedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    originalState: { ...original, _id: original._id, createdAt: original.createdAt.toISOString(), updatedAt: original.updatedAt.toISOString() }
  };
  try {
    await fivemGoalCorrectionRequests.insertOne(doc);
  } catch (error) {
    throw Object.assign(new Error("Este registro já possui uma solicitação de correção em andamento."), { status: 409 });
  }
  await fivemGoalEntries.updateOne({ _id: original._id, ...scopeQuery(input.guildId, normalizedBotId) }, { $set: { status: "correction_requested", correctionRequestId: doc._id, updatedAt: now } });
  await fivemGoalSubmissions.updateMany(
    { ...scopeQuery(input.guildId, normalizedBotId), $or: [{ registrationId: original._id }, ...(original.idempotencyKey ? [{ idempotencyKey: original.idempotencyKey }] : []), { proofUrl: original.imageUrl, userId: original.userId }] },
    { $set: { status: "correction_requested", correctionRequestId: doc._id, updatedAt: now } }
  );
  await writeFivemGoalLog({ action: "correction.requested", botId: normalizedBotId, details: { originalRegistrationId: original._id, reason, quantity: original.quantity, roomId: original.channelId }, guildId: input.guildId, metaId: original.metaId ?? null, userId: input.requestedByUserId });
  if (normalizedBotId) emitRealtimeToRoom(dashboardLogRealtimeRoom(input.guildId, normalizedBotId), "fivem:goals:updated", { botId: normalizedBotId, guildId: input.guildId });
  return toCorrectionRequestDto(doc, toEntryDto({ ...original, status: "correction_requested", correctionRequestId: doc._id, updatedAt: now }));
}

export async function completeFivemGoalCorrectionRequest(guildId: string, botId: string | null, correctionRequestId: string, originalRegistrationId: string, replacementRegistrationId: string, userId: string) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();
  const { fivemGoalCorrectionRequests, fivemGoalEntries } = await getMongoCollections();
  const row = await fivemGoalCorrectionRequests.findOneAndUpdate(
    { _id: correctionRequestId, ...scopeQuery(guildId, normalizedBotId), originalRegistrationId, userId, status: "pending" },
    { $set: { replacementRegistrationId, correctedAt: now, status: "corrected" } },
    { returnDocument: "after" }
  );
  if (!row) throw Object.assign(new Error("Solicitação de correção pendente não encontrada."), { status: 404 });
  const original = await fivemGoalEntries.findOne({ _id: originalRegistrationId, ...scopeQuery(guildId, normalizedBotId), userId });
  await fivemGoalEntries.updateOne(
    { _id: originalRegistrationId, ...scopeQuery(guildId, normalizedBotId), userId },
    { $set: { status: "corrected", replacedByRegistrationId: replacementRegistrationId, updatedAt: now } }
  );
  await writeFivemGoalLog({ action: "correction.corrected", botId: normalizedBotId, details: { correctionRequestId, originalRegistrationId, replacementRegistrationId }, guildId, metaId: original?.metaId ?? null, userId });
  if (normalizedBotId) emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, normalizedBotId), "fivem:goals:updated", { botId: normalizedBotId, guildId });
  return toCorrectionRequestDto(row, null);
}

export async function cancelFivemGoalCorrectionRequest(input: {
  botId?: string | null;
  cancelledByUserId: string;
  cancellationReason: string;
  guildId: string;
  originalRegistrationId: string;
  restoreOriginalOnCancel: boolean;
}) {
  const normalizedBotId = normalizeBotId(input.botId);
  const reason = normalizeText(input.cancellationReason, 1000);
  if (!reason || reason.length < 8) throw Object.assign(new Error("O motivo do cancelamento deve ter pelo menos 8 caracteres."), { status: 400 });
  const now = new Date();
  const { fivemGoalCorrectionRequests, fivemGoalEntries, fivemGoalSubmissions } = await getMongoCollections();
  const row = await fivemGoalCorrectionRequests.findOneAndUpdate(
    { ...scopeQuery(input.guildId, normalizedBotId), originalRegistrationId: input.originalRegistrationId, status: "pending" },
    { $set: { cancelledAt: now, cancelledByUserId: input.cancelledByUserId, cancellationReason: reason, restoreOriginalOnCancel: input.restoreOriginalOnCancel, status: "cancelled" } },
    { returnDocument: "after" }
  );
  if (!row) throw Object.assign(new Error("Correção pendente não encontrada para este registro."), { status: 404 });
  const nextEntryStatus = input.restoreOriginalOnCancel ? "confirmed" as const : "invalidated" as const;
  const original = await fivemGoalEntries.findOne({ _id: input.originalRegistrationId, ...scopeQuery(input.guildId, normalizedBotId), userId: row.userId });
  await fivemGoalEntries.updateOne(
    { _id: input.originalRegistrationId, ...scopeQuery(input.guildId, normalizedBotId), userId: row.userId },
    input.restoreOriginalOnCancel
      ? { $set: { status: nextEntryStatus, updatedAt: now }, $unset: { correctionRequestId: "" } }
      : { $set: { status: nextEntryStatus, updatedAt: now } }
  );
  await fivemGoalSubmissions.updateMany(
    { ...scopeQuery(input.guildId, normalizedBotId), correctionRequestId: row._id },
    { $set: { status: input.restoreOriginalOnCancel ? "approved" : "refused", updatedAt: now, refusalReason: input.restoreOriginalOnCancel ? null : reason } }
  );
  await writeFivemGoalLog({ action: "correction.cancelled", botId: normalizedBotId, details: { originalRegistrationId: input.originalRegistrationId, reason, restoreOriginalOnCancel: input.restoreOriginalOnCancel, status: "cancelled" }, guildId: input.guildId, metaId: original?.metaId ?? null, userId: input.cancelledByUserId });
  if (normalizedBotId) emitRealtimeToRoom(dashboardLogRealtimeRoom(input.guildId, normalizedBotId), "fivem:goals:updated", { botId: normalizedBotId, guildId: input.guildId });
  return toCorrectionRequestDto(row, null);
}

export async function createFivemGoalSubmission(input: {
  botId?: string | null;
  description?: string | null;
  fields?: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  metaId?: string | null;
  proofUrl?: string | null;
  roleIdsSnapshot?: string[];
  registrationId?: string | null;
  correctionRequestId?: string | null;
  replacementForRegistrationId?: string | null;
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
    registrationId: normalizeText(input.registrationId, 120),
    correctionRequestId: normalizeText(input.correctionRequestId, 120),
    replacementForRegistrationId: normalizeText(input.replacementForRegistrationId, 120),
    updatedAt: now,
    userId: input.userId,
    value: input.value
  };
  await fivemGoalSubmissions.insertOne(doc);
  await writeFivemGoalLog({ action: status === "approved" ? "submission.auto_approved" : "submission.created", botId: normalizedBotId, details: { proofUrl: doc.proofUrl, value: doc.value }, guildId: input.guildId, metaId: meta.id, userId: input.userId });
  if (normalizedBotId) {
    emitRealtimeToRoom(dashboardLogRealtimeRoom(input.guildId, normalizedBotId), "fivem:goals:updated", {
      botId: normalizedBotId,
      guildId: input.guildId
    });
  }
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
  const ranking = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, WEEKLY_RANKING_LIMIT).map(([rankedUserId, total], index) => ({ rank: index + 1, total, userId: rankedUserId }));
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
  if (normalizedBotId) {
    emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, normalizedBotId), "fivem:goals:updated", { botId: normalizedBotId, guildId });
  }
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
      description: "Meta migrada automaticamente da configuração antiga.",
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
  const defaults = defaultFivemGoalSettings(settings.guildId, settings.botId);
  return {
    ...settings,
    categoryId: normalizeSnowflake(settings.categoryId),
    channelNameTemplate: normalizeText(settings.channelNameTemplate, 80) || "meta-{username}",
    fields: normalizeFields(settings.fields),
    items: normalizeItems(settings.items),
    logChannelId: normalizeSnowflake(settings.logChannelId),
    managerRoleId: normalizeSnowflake(settings.managerRoleId),
    rankingChannelId: normalizeSnowflake(settings.rankingChannelId),
    rankingMessageId: normalizeSnowflake(settings.rankingMessageId),
    requestPanelChannelId: normalizeSnowflake(settings.requestPanelChannelId),
    requestPanelDescription: normalizeText(settings.requestPanelDescription, 900) || "Solicite seu canal individual de meta para enviar comprovantes, acompanhar sua produção semanal e visualizar seu progresso.",
    requestPanelEnabled: settings.requestPanelEnabled !== false,
    requestPanelMessageId: normalizeSnowflake(settings.requestPanelMessageId),
    requestPanelTitle: normalizeText(settings.requestPanelTitle, 120) || "Sistema de Metas FiveM",
    requestRequiresApproval: settings.requestRequiresApproval === true,
    autoCreateWithManualRegistration: settings.autoCreateWithManualRegistration !== false,
    viewRoleId: normalizeSnowflake(settings.viewRoleId),
    version: Number.isInteger(settings.version) && settings.version > 0 ? settings.version : 1,
    roomRequestEnabled: settings.roomRequestEnabled !== false,
    setRequestEnabled: settings.setRequestEnabled === true,
    automaticImageCaptureEnabled: settings.automaticImageCaptureEnabled !== false,
    absenceEnabled: settings.absenceEnabled === true,
    weeklySummaryEnabled: settings.weeklySummaryEnabled !== false,
    directMessagesEnabled: settings.directMessagesEnabled !== false,
    memberCleanupEnabled: settings.memberCleanupEnabled !== false,
    automaticNicknameEnabled: settings.automaticNicknameEnabled !== false,
    automaticRoleEnabled: settings.automaticRoleEnabled !== false,
    timezone: normalizeTimezone(settings.timezone),
    approvalChannelId: normalizeSnowflake(settings.approvalChannelId),
    summaryChannelId: normalizeSnowflake(settings.summaryChannelId),
    auditChannelId: normalizeSnowflake(settings.auditChannelId),
    verificationRoleId: normalizeSnowflake(settings.verificationRoleId),
    managerRoleIds: normalizeRoleIds(settings.managerRoleIds ?? (settings.managerRoleId ? [settings.managerRoleId] : [])),
    viewerRoleIds: normalizeRoleIds(settings.viewerRoleIds ?? (settings.viewRoleId ? [settings.viewRoleId] : [])),
    categoryRules: normalizeCategoryRules(settings.categoryRules),
    approvalTypes: normalizeApprovalTypes(settings.approvalTypes),
    setFormFields: normalizeSetFormFields(settings.setFormFields),
    commandPermissions: normalizeCommandPermissions(settings.commandPermissions),
    actionPermissions: normalizeActionPermissions(settings.actionPermissions),
    cycle: normalizeCycle(settings.cycle),
    panelVisual: normalizePanelVisual(settings.panelVisual, defaults.panelVisual),
    notificationSettings: normalizeNotifications(settings.notificationSettings, defaults.notificationSettings),
    correctionManagement: normalizeCorrectionManagement(settings.correctionManagement, defaults.correctionManagement),
    cooldownSeconds: typeof settings.cooldownSeconds === "number" && Number.isFinite(settings.cooldownSeconds) ? Math.min(3600, Math.max(3, Math.trunc(settings.cooldownSeconds))) : 30,
    tutorial: {
      completedBy: normalizeRoleIds(settings.tutorial?.completedBy ?? []),
      skippedBy: normalizeRoleIds(settings.tutorial?.skippedBy ?? [])
    }
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
  return normalized;
}

function normalizeItems(items: FivemGoalItemDto[]) {
  const now = new Date().toISOString();
  const normalized = (Array.isArray(items) ? items : []).map((item, index) => {
    const name = normalizeText(item.name, 80) || `Item ${index + 1}`;
    const createdAt = normalizeIsoDate(item.createdAt) ?? now;
    return {
      category: normalizeText(item.category, 80),
      color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color : null,
      createdAt,
      emoji: normalizeText(item.emoji, 80) || fixedSystemEmojiText("caixa"),
      enabled: item.enabled !== false,
      id: normalizeText(item.id, 80) || slug(name) || `item-${index + 1}`,
      name,
      order: Number.isFinite(item.order) ? Math.trunc(item.order) : index + 1,
      requiredAmount: normalizeTargetValue(item.requiredAmount),
      type: normalizeGoalItemType(item.type),
      updatedAt: normalizeIsoDate(item.updatedAt) ?? createdAt
    };
  }).slice(0, 100);
  return normalized.length ? normalized : DEFAULT_ITEMS.map((item) => ({ ...item }));
}

function toSettingsDto(settings: MongoFivemGoalSettings): FivemGoalSettingsDto {
  const defaults = defaultFivemGoalSettings(settings.guildId, normalizeBotId(settings.botId));
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
    rankingChannelId: settings.rankingChannelId ?? null,
    rankingMessageId: settings.rankingMessageId ?? null,
    requestPanelChannelId: settings.requestPanelChannelId ?? null,
    requestPanelDescription: settings.requestPanelDescription ?? "Solicite seu canal individual de meta para enviar comprovantes, acompanhar sua produção semanal e visualizar seu progresso.",
    requestPanelEnabled: settings.requestPanelEnabled !== false,
    requestPanelMessageId: settings.requestPanelMessageId ?? null,
    requestPanelTitle: settings.requestPanelTitle ?? "Sistema de Metas FiveM",
    requestRequiresApproval: settings.requestRequiresApproval === true,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    viewRoleId: settings.viewRoleId,
    version: settings.version ?? 1,
    roomRequestEnabled: settings.roomRequestEnabled ?? defaults.roomRequestEnabled,
    setRequestEnabled: settings.setRequestEnabled ?? defaults.setRequestEnabled,
    automaticImageCaptureEnabled: settings.automaticImageCaptureEnabled ?? defaults.automaticImageCaptureEnabled,
    absenceEnabled: settings.absenceEnabled ?? defaults.absenceEnabled,
    weeklySummaryEnabled: settings.weeklySummaryEnabled ?? defaults.weeklySummaryEnabled,
    directMessagesEnabled: settings.directMessagesEnabled ?? defaults.directMessagesEnabled,
    memberCleanupEnabled: settings.memberCleanupEnabled ?? defaults.memberCleanupEnabled,
    automaticNicknameEnabled: settings.automaticNicknameEnabled ?? defaults.automaticNicknameEnabled,
    automaticRoleEnabled: settings.automaticRoleEnabled ?? defaults.automaticRoleEnabled,
    timezone: settings.timezone ?? defaults.timezone,
    approvalChannelId: settings.approvalChannelId ?? null,
    summaryChannelId: settings.summaryChannelId ?? null,
    auditChannelId: settings.auditChannelId ?? null,
    verificationRoleId: settings.verificationRoleId ?? null,
    managerRoleIds: settings.managerRoleIds ?? [],
    viewerRoleIds: settings.viewerRoleIds ?? [],
    categoryRules: settings.categoryRules ?? [],
    approvalTypes: settings.approvalTypes ?? [],
    setFormFields: settings.setFormFields ?? defaults.setFormFields,
    commandPermissions: settings.commandPermissions ?? defaults.commandPermissions,
    actionPermissions: settings.actionPermissions ?? {},
    cycle: settings.cycle ?? defaults.cycle,
    panelVisual: settings.panelVisual ?? defaults.panelVisual,
    notificationSettings: settings.notificationSettings ?? defaults.notificationSettings,
    correctionManagement: normalizeCorrectionManagement(settings.correctionManagement, defaults.correctionManagement),
    cooldownSeconds: settings.cooldownSeconds ?? defaults.cooldownSeconds,
    tutorial: settings.tutorial ?? defaults.tutorial
  });
}

function toUserChannelDto(row: MongoFivemGoalUserChannel): FivemGoalUserChannelDto {
  return { botId: normalizeBotId(row.botId), channelId: row.channelId, createdAt: row.createdAt.toISOString(), guildId: row.guildId, updatedAt: row.updatedAt.toISOString(), userId: row.userId };
}

function toEntryDto(row: MongoFivemGoalEntry): FivemGoalEntryDto {
  return {
    attachmentId: row.attachmentId ?? null,
    botId: normalizeBotId(row.botId),
    channelId: row.channelId,
    correctionRequestId: row.correctionRequestId ?? null,
    createdAt: row.createdAt.toISOString(),
    fields: row.fields,
    guildId: row.guildId,
    id: row._id,
    imageUrl: row.imageUrl,
    itemId: row.itemId,
    metaId: row.metaId ?? null,
    quantity: row.quantity,
    replacedByRegistrationId: row.replacedByRegistrationId ?? null,
    replacementForRegistrationId: row.replacementForRegistrationId ?? null,
    sourceMessageId: row.sourceMessageId ?? null,
    status: row.status ?? "confirmed",
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId
  };
}

function toCorrectionRequestDto(row: MongoFivemGoalCorrectionRequest, originalRegistration: FivemGoalEntryDto | null): FivemGoalCorrectionRequestDto {
  return {
    botId: normalizeBotId(row.botId),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByUserId: row.cancelledByUserId ?? null,
    cancellationReason: row.cancellationReason ?? null,
    correctedAt: row.correctedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    guildId: row.guildId,
    id: row._id,
    originalRegistration,
    originalRegistrationId: row.originalRegistrationId,
    reason: row.reason,
    replacementRegistrationId: row.replacementRegistrationId ?? null,
    requestedAt: row.requestedAt.toISOString(),
    requestedByName: row.requestedByName ?? null,
    requestedByUserId: row.requestedByUserId,
    restoreOriginalOnCancel: row.restoreOriginalOnCancel ?? null,
    roomId: row.roomId,
    status: row.status,
    userId: row.userId
  };
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
    registrationId: row.registrationId ?? null,
    correctionRequestId: row.correctionRequestId ?? null,
    replacementForRegistrationId: row.replacementForRegistrationId ?? null,
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
    fields: normalizeFields(input.fields ?? []),
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

function normalizeCategoryRules(value: FivemGoalSettingsDto["categoryRules"] | undefined) {
  return (Array.isArray(value) ? value : []).slice(0, 50).map((rule, index) => ({
    id: normalizeText(rule.id, 80) || randomUUID(),
    name: normalizeText(rule.name, 80) || `Regra ${index + 1}`,
    sourceRoleId: normalizeSnowflake(rule.sourceRoleId) || "",
    categoryId: normalizeSnowflake(rule.categoryId) || "",
    grantedRoleId: normalizeSnowflake(rule.grantedRoleId),
    buttonLabel: normalizeText(rule.buttonLabel, 80) || normalizeText(rule.name, 80) || `Opção ${index + 1}`,
    priority: Number.isFinite(rule.priority) ? Math.max(0, Math.trunc(rule.priority)) : index,
    active: rule.active !== false
  })).filter((rule) => rule.sourceRoleId && rule.categoryId).sort((a, b) => a.priority - b.priority);
}

function normalizeApprovalTypes(value: FivemGoalSettingsDto["approvalTypes"] | undefined) {
  return (Array.isArray(value) ? value : []).slice(0, 20).map((item, index) => ({
    id: normalizeText(item.id, 80) || randomUUID(),
    name: normalizeText(item.name, 80) || `Tipo ${index + 1}`,
    buttonLabel: normalizeText(item.buttonLabel, 80) || normalizeText(item.name, 80) || `Aprovar ${index + 1}`,
    roleId: normalizeSnowflake(item.roleId),
    categoryId: normalizeSnowflake(item.categoryId),
    nicknameTemplate: normalizeText(item.nicknameTemplate, 80),
    active: item.active !== false,
    displayOrder: Number.isFinite(item.displayOrder) ? Math.max(0, Math.trunc(item.displayOrder)) : index
  })).sort((a, b) => a.displayOrder - b.displayOrder);
}

function normalizeSetFormFields(value: FivemGoalSettingsDto["setFormFields"] | undefined) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map((field, index) => ({
    id: normalizeText(field.id, 80) || `campo-${index + 1}`,
    label: normalizeText(field.label, 45) || `Campo ${index + 1}`,
    placeholder: normalizeText(field.placeholder, 100),
    required: field.required !== false,
    maxLength: Number.isFinite(field.maxLength) ? Math.min(1500, Math.max(1, Math.trunc(field.maxLength))) : 100,
    showInLogs: field.showInLogs !== false,
    order: Number.isFinite(field.order) ? Math.max(0, Math.trunc(field.order)) : index
  })).sort((a, b) => a.order - b.order);
}

function normalizeCommandPermissions(value: FivemGoalSettingsDto["commandPermissions"] | undefined) {
  return {
    visibleRoleIds: normalizeRoleIds(value?.visibleRoleIds ?? []), executableRoleIds: normalizeRoleIds(value?.executableRoleIds ?? []),
    visibleUserIds: normalizeRoleIds(value?.visibleUserIds ?? []), executableUserIds: normalizeRoleIds(value?.executableUserIds ?? []),
    allowAdministrators: value?.allowAdministrators !== false, allowOwner: value?.allowOwner !== false
  };
}

function normalizeActionPermissions(value: Record<string, string[]> | undefined) {
  const result: Record<string, string[]> = {};
  for (const [key, roleIds] of Object.entries(value ?? {}).slice(0, 50)) {
    const normalizedKey = normalizeText(key, 80);
    if (normalizedKey) result[normalizedKey] = normalizeRoleIds(roleIds);
  }
  return result;
}

function normalizeCycle(value: FivemGoalSettingsDto["cycle"] | undefined) {
  const time = (candidate: string | undefined, fallback: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate ?? "") ? candidate! : fallback;
  const day = (candidate: number | undefined, fallback: number) => Number.isInteger(candidate) && candidate! >= 0 && candidate! <= 6 ? candidate! : fallback;
  return { startDay: day(value?.startDay, 1), startTime: time(value?.startTime, "00:00"), endDay: day(value?.endDay, 0), endTime: time(value?.endTime, "23:59"), firstExecution: /^\d{4}-\d{2}-\d{2}$/.test(value?.firstExecution ?? "") ? value!.firstExecution : null, frequency: value?.frequency === "custom" ? "custom" as const : "weekly" as const, absencePolicy: value?.absencePolicy === "daily" || value?.absencePolicy === "full" || value?.absencePolicy === "manual" ? value.absencePolicy : "none" as const, latePolicy: value?.latePolicy === "accept" || value?.latePolicy === "reject" ? value.latePolicy : "flag" as const };
}

function normalizePanelVisual(value: FivemGoalSettingsDto["panelVisual"] | undefined, fallback: FivemGoalSettingsDto["panelVisual"]) {
  const mediaType = value?.mediaType === "image" || value?.mediaType === "gif" || value?.mediaType === "video" ? value.mediaType : "none" as const;
  return { title: normalizeText(value?.title, 120) || fallback.title, description: normalizeText(value?.description, 1200) || fallback.description, footer: normalizeText(value?.footer, 200), imageUrl: normalizeText(value?.imageUrl, 2048), mediaUrl: normalizeText(value?.mediaUrl, 2048), mediaType, loopVideo: value?.loopVideo === true, color: /^#[0-9a-f]{6}$/i.test(value?.color ?? "") ? value!.color : fallback.color };
}

function normalizeNotifications(value: FivemGoalSettingsDto["notificationSettings"] | undefined, fallback: FivemGoalSettingsDto["notificationSettings"]) {
  return { mentionUserOnFailure: value?.mentionUserOnFailure !== false, mentionManagerOnFailure: value?.mentionManagerOnFailure !== false, approvalDm: normalizeText(value?.approvalDm, 1500) || fallback.approvalDm, rejectionDm: normalizeText(value?.rejectionDm, 1500) || fallback.rejectionDm, farewellDm: normalizeText(value?.farewellDm, 1500) || fallback.farewellDm };
}

function normalizeCorrectionManagement(value: FivemGoalSettingsDto["correctionManagement"] | undefined, fallback: FivemGoalSettingsDto["correctionManagement"]): FivemGoalSettingsDto["correctionManagement"] {
  const defaultDeadline = value?.defaultDeadline === "none" || value?.defaultDeadline === "12h" || value?.defaultDeadline === "24h" || value?.defaultDeadline === "48h" || value?.defaultDeadline === "custom"
    ? value.defaultDeadline
    : "weekly_close";
  return {
    allowAdministrators: value?.allowAdministrators === true,
    allowClosedPeriods: value?.allowClosedPeriods === true,
    defaultDeadline,
    customDeadlineHours: clamp(value?.customDeadlineHours, 1, 24 * 30),
    logChannelId: normalizeSnowflake(value?.logChannelId) ?? normalizeSnowflake(fallback.logChannelId),
    managerRoleId: normalizeSnowflake(value?.managerRoleId) ?? normalizeSnowflake(fallback.managerRoleId),
    maxCorrectionsPerPeriod: clamp(value?.maxCorrectionsPerPeriod, 1, 1000),
    notifyResponsibleTeam: value?.notifyResponsibleTeam !== false,
    notifyUser: value?.notifyUser !== false,
    requireReason: value?.requireReason !== false,
    allowRestoreOriginal: value?.allowRestoreOriginal !== false
  };
}

function resolveCorrectionDeadline(settings: FivemGoalSettingsDto, now: Date) {
  const mode = settings.correctionManagement.defaultDeadline;
  if (mode === "none") return null;
  if (mode === "weekly_close") return currentSaoPauloWeek(now).end;
  const hours = mode === "12h" ? 12 : mode === "24h" ? 24 : mode === "48h" ? 48 : settings.correctionManagement.customDeadlineHours;
  return hours ? new Date(now.getTime() + hours * 60 * 60 * 1000) : null;
}

function normalizeTimezone(value: string | null | undefined) {
  const candidate = normalizeText(value, 80) || "America/Sao_Paulo";
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: candidate }).format(); return candidate; } catch { return "America/Sao_Paulo"; }
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

function normalizeGoalItemType(value: unknown): "required" | "additional" | "optional" {
  return value === "additional" || value === "optional" ? value : "required";
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
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

function manualRegistrationDisplayName(fields: Array<{ id: string; label: string; value: string }>, fallback: string) {
  const aliases = new Set(["nome_personagem", "personagem", "nome_do_personagem", "requested_name", "nome"].map(normalizeFieldKey));
  const field = fields.find((item) => aliases.has(normalizeFieldKey(item.id)) || aliases.has(normalizeFieldKey(item.label)));
  if (!field) return fallback;
  const value = field?.value?.trim();
  return value && value !== "-" ? field.value : fallback;
}

function normalizeFieldKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function clamp(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
