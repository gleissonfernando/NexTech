import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoPoliceRankUpLog,
  type MongoPoliceRankUpPermission,
  type MongoPoliceRankUpRank,
  type MongoPoliceRankUpRequest,
  type MongoPoliceRankUpSettings
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoomWithAck } from "../realtime/events";
import { authorizeBotRuntimeModule } from "./devBotService";

export const POLICE_RANK_UP_MODULE_ID = "police-rank-up";
const REQUEST_PREFIX = "UP";

export type PoliceRankUpSettingsDto = Omit<MongoPoliceRankUpSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type PoliceRankUpRequestDto = Omit<MongoPoliceRankUpRequest, "_id" | "createdAt" | "reviewedAt" | "completedAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  reviewedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type PoliceRankUpDashboardDto = {
  logs: Array<{ action: string; actorId: string | null; actorName: string | null; createdAt: string; id: string; requestId: string | null }>;
  requests: PoliceRankUpRequestDto[];
  settings: PoliceRankUpSettingsDto;
  stats: {
    approved: number;
    pending: number;
    ranks: number;
    rejected: number;
    total: number;
  };
};

export type SavePoliceRankUpSettingsInput = Partial<Pick<
  MongoPoliceRankUpSettings,
  | "adminChannelId"
  | "adminRoleIds"
  | "adminUserIds"
  | "allowRequesterCancel"
  | "approvedDeleteSeconds"
  | "autoDeleteChannels"
  | "blockDemotions"
  | "blockMultipleRanks"
  | "enabled"
  | "logChannelId"
  | "mentionResponsibles"
  | "minRequestIntervalHours"
  | "notifyByDm"
  | "onlyNextRank"
  | "panelChannelId"
  | "panelMessageId"
  | "panelMessage"
  | "permissions"
  | "ranks"
  | "rejectedDeleteSeconds"
  | "requireApprovalForInitialRank"
  | "responsibleRoleIds"
  | "responsibleUserIds"
  | "temporaryCategoryId"
  | "temporaryChannelName"
>>;

export type CreatePoliceRankUpRequestInput = {
  currentRankId?: string | null;
  currentRoleId?: string | null;
  guildId: string;
  requestedRankId: string;
  temporaryChannelId?: string | null;
  userDisplayName: string;
  userId: string;
  username: string;
};

export async function getPoliceRankUpDashboard(botId: string, guildId: string): Promise<PoliceRankUpDashboardDto> {
  const [settings, requests, logs] = await Promise.all([
    getPoliceRankUpSettings(botId, guildId),
    listPoliceRankUpRequests(botId, guildId, 100),
    listPoliceRankUpLogs(botId, guildId, 50)
  ]);

  return {
    logs,
    requests,
    settings,
    stats: {
      approved: requests.filter((item) => item.status === "approved").length,
      pending: requests.filter((item) => item.status === "pending").length,
      ranks: settings.ranks.length,
      rejected: requests.filter((item) => item.status === "rejected").length,
      total: requests.length
    }
  };
}

export async function getPoliceRankUpSettings(botId: string, guildId: string) {
  const { policeRankUpSettings } = await getMongoCollections();
  const current = await policeRankUpSettings.findOne({ botId, guildId });
  if (current) return settingsDto(current);

  const row = defaultSettings(botId, guildId);
  await policeRankUpSettings.insertOne(row);
  return settingsDto(row);
}

export async function savePoliceRankUpSettings(botId: string, guildId: string, input: SavePoliceRankUpSettingsInput, actorId: string | null) {
  const { policeRankUpSettings } = await getMongoCollections();
  const current = await getPoliceRankUpSettings(botId, guildId);
  const now = new Date();
  const next: MongoPoliceRankUpSettings = {
    ...current,
    _id: current.id,
    createdAt: new Date(current.createdAt),
    updatedAt: now,
    updatedBy: actorId,
    ...sanitizeSettingsInput(input)
  };

  await policeRankUpSettings.updateOne({ _id: next._id }, { $set: next }, { upsert: true });
  const dto = settingsDto(next);
  await createPoliceRankUpLog(botId, guildId, { action: "rank_up.settings_updated", actorId, metadata: changedKeys(input) });
  emitRealtime("police-rank-up:settings_updated", { botId, guildId, settings: dto });
  return dto;
}

export async function requestPoliceRankUpPanelPublish(botId: string, guildId: string, actorId: string | null) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: POLICE_RANK_UP_MODULE_ID });
  if (!authorization.allowed) throw routeError(authorization.reason, 403);

  const settings = await getPoliceRankUpSettings(botId, guildId);
  if (!settings.enabled) throw routeError("Ative o Sistema de UP antes de publicar o painel.", 400);
  if (!settings.panelChannelId) throw routeError("Configure o canal do painel antes de publicar.", 400);
  if (!settings.ranks.some((rank) => rank.enabled && rank.roleId)) throw routeError("Cadastre pelo menos uma patente ativa com cargo.", 400);

  const responses = await emitRealtimeToRoomWithAck<
    { botId: string; guildId: string; settings: PoliceRankUpSettingsDto },
    { error?: string; messageId?: string | null; ok: boolean }
  >(devBotRealtimeRoom(botId), "police-rank-up:panel_publish", { botId, guildId, settings }, 20_000);
  const success = responses.find((response) => response?.ok);
  if (!success) {
    const error = responses.find((response) => response?.error)?.error ?? "Bot runtime não confirmou a publicação do painel.";
    throw routeError(error, 409);
  }

  const saved = await savePoliceRankUpSettings(botId, guildId, { panelMessageId: success.messageId ?? null }, actorId);
  await createPoliceRankUpLog(botId, guildId, { action: "rank_up.panel_published", actorId, metadata: { channelId: settings.panelChannelId, messageId: success.messageId ?? null } });
  return saved;
}

export async function createPoliceRankUpRequest(botId: string, input: CreatePoliceRankUpRequestInput) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId: input.guildId, moduleId: POLICE_RANK_UP_MODULE_ID });
  if (!authorization.allowed) throw routeError(authorization.reason, 403);

  const { policeRankUpRequests } = await getMongoCollections();
  const settings = await getPoliceRankUpSettings(botId, input.guildId);
  if (!settings.enabled) throw routeError("Sistema de UP desativado neste servidor.", 403);

  const rank = settings.ranks.find((item) => item.id === input.requestedRankId && item.enabled);
  if (!rank) throw routeError("Patente não encontrada ou desativada.", 404);
  const currentRank = input.currentRankId ? settings.ranks.find((item) => item.id === input.currentRankId) ?? null : null;
  validateRankProgression(settings, currentRank, rank);

  const pending = await policeRankUpRequests.findOne({ botId, guildId: input.guildId, status: "pending", userId: input.userId });
  if (pending) throw routeError("Você já possui uma solicitação de patente aguardando análise.", 409);

  const now = new Date();
  const row: MongoPoliceRankUpRequest = {
    _id: randomUUID(),
    botId,
    completedAt: null,
    createdAt: now,
    currentRankId: currentRank?.id ?? null,
    currentRoleId: input.currentRoleId ?? currentRank?.roleId ?? null,
    errorReason: null,
    guildId: input.guildId,
    messageId: null,
    protocol: await nextProtocol(botId, input.guildId),
    requestedRankId: rank.id,
    requestedRoleId: rank.roleId,
    reviewReason: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedByName: null,
    status: "pending",
    temporaryChannelId: input.temporaryChannelId ?? null,
    tenantId: botId,
    updatedAt: now,
    userDisplayName: normalizeText(input.userDisplayName, 120),
    userId: input.userId,
    username: normalizeText(input.username, 120)
  };

  await policeRankUpRequests.insertOne(row);
  await createPoliceRankUpLog(botId, input.guildId, { action: "rank_up.request_created", actorId: input.userId, actorName: input.username, metadata: { protocol: row.protocol, requestedRankId: rank.id }, requestId: row._id });
  emitRealtime("police-rank-up:request_created", { botId, guildId: input.guildId, request: requestDto(row) });
  return requestDto(row);
}

export async function updatePoliceRankUpRequestChannel(botId: string, requestId: string, input: { messageId?: string | null; temporaryChannelId?: string | null }) {
  const { policeRankUpRequests } = await getMongoCollections();
  const saved = await policeRankUpRequests.findOneAndUpdate(
    { _id: requestId, botId },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!saved) throw routeError("Solicitação de UP não encontrada.", 404);
  return requestDto(saved);
}

export async function decidePoliceRankUpRequest(botId: string, requestId: string, input: {
  actorId: string;
  actorName?: string | null;
  errorReason?: string | null;
  reason?: string | null;
  result: "approved" | "rejected" | "cancelled" | "error";
}) {
  const { policeRankUpRequests } = await getMongoCollections();
  const current = await policeRankUpRequests.findOne({ _id: requestId, botId });
  if (!current) throw routeError("Solicitação de UP não encontrada.", 404);
  if (current.status !== "pending" && input.result !== "error") throw routeError("Esta solicitação já foi finalizada.", 409);

  const now = new Date();
  const completed = input.result === "error" ? null : now;
  const saved = await policeRankUpRequests.findOneAndUpdate(
    { _id: requestId, botId },
    {
      $set: {
        completedAt: completed,
        errorReason: input.errorReason ?? null,
        reviewReason: input.reason ?? null,
        reviewedAt: now,
        reviewedBy: input.actorId,
        reviewedByName: normalizeText(input.actorName ?? "", 120) || null,
        status: input.result,
        updatedAt: now
      }
    },
    { returnDocument: "after" }
  );
  if (!saved) throw routeError("Solicitação de UP não encontrada.", 404);

  await createPoliceRankUpLog(botId, current.guildId, {
    action: `rank_up.request_${input.result}`,
    actorId: input.actorId,
    actorName: input.actorName ?? null,
    metadata: { protocol: current.protocol, reason: input.reason ?? null, errorReason: input.errorReason ?? null },
    requestId
  });
  emitRealtime("police-rank-up:request_updated", { botId, guildId: current.guildId, request: requestDto(saved) });
  return requestDto(saved);
}

export async function getPoliceRankUpRequest(botId: string, requestId: string) {
  const { policeRankUpRequests } = await getMongoCollections();
  const request = await policeRankUpRequests.findOne({ _id: requestId, botId });
  if (!request) throw routeError("Solicitação de UP não encontrada.", 404);
  return requestDto(request);
}

export async function findPoliceRankUpRequestByChannel(botId: string, channelId: string) {
  const { policeRankUpRequests } = await getMongoCollections();
  const request = await policeRankUpRequests.findOne({ botId, temporaryChannelId: channelId });
  return request ? requestDto(request) : null;
}

export async function createPoliceRankUpLog(botId: string, guildId: string, input: {
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}) {
  const { policeRankUpLogs } = await getMongoCollections();
  const row: MongoPoliceRankUpLog = {
    _id: randomUUID(),
    action: input.action,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    botId,
    createdAt: new Date(),
    guildId,
    metadata: input.metadata ?? {},
    requestId: input.requestId ?? null
  };
  await policeRankUpLogs.insertOne(row);
  emitRealtime("police-rank-up:log_created", { botId, guildId, log: logDto(row) });
}

async function listPoliceRankUpRequests(botId: string, guildId: string, limit: number) {
  const { policeRankUpRequests } = await getMongoCollections();
  return (await policeRankUpRequests.find({ botId, guildId }).sort({ createdAt: -1 }).limit(limit).toArray()).map(requestDto);
}

async function listPoliceRankUpLogs(botId: string, guildId: string, limit: number) {
  const { policeRankUpLogs } = await getMongoCollections();
  return (await policeRankUpLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(limit).toArray()).map(logDto);
}

async function nextProtocol(botId: string, guildId: string) {
  const { policeRankUpRequests } = await getMongoCollections();
  const count = await policeRankUpRequests.countDocuments({ botId, guildId });
  return `${REQUEST_PREFIX}-${String(count + 1).padStart(6, "0")}`;
}

function validateRankProgression(settings: PoliceRankUpSettingsDto, currentRank: MongoPoliceRankUpRank | null, requestedRank: MongoPoliceRankUpRank) {
  if (currentRank?.id === requestedRank.id) throw routeError("Você já possui a patente solicitada.", 409);
  if (currentRank && settings.blockDemotions && requestedRank.hierarchyPosition < currentRank.hierarchyPosition) {
    throw routeError("Não é permitido solicitar uma patente inferior.", 400);
  }
  if (settings.onlyNextRank && currentRank && requestedRank.hierarchyPosition !== currentRank.hierarchyPosition + 1 && !requestedRank.allowSkip) {
    throw routeError("Este servidor permite solicitar apenas a próxima patente.", 400);
  }
  if (requestedRank.allowedPreviousRanks.length && (!currentRank || !requestedRank.allowedPreviousRanks.includes(currentRank.id))) {
    throw routeError("Sua patente atual não permite solicitar esta patente.", 400);
  }
}

function defaultSettings(botId: string, guildId: string): MongoPoliceRankUpSettings {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    adminChannelId: null,
    adminRoleIds: [],
    adminUserIds: [],
    allowRequesterCancel: true,
    approvedDeleteSeconds: 10,
    autoDeleteChannels: true,
    blockDemotions: true,
    blockMultipleRanks: true,
    botId,
    createdAt: now,
    enabled: false,
    guildId,
    logChannelId: null,
    mentionResponsibles: true,
    minRequestIntervalHours: 0,
    notifyByDm: true,
    onlyNextRank: true,
    panelChannelId: null,
    panelMessage: "Solicitações inadequadas poderão resultar em reprovação.\nSua solicitação será analisada por um responsável presente no canal configurado.\nSelecione apenas a patente que realmente deseja solicitar.",
    panelMessageId: null,
    permissions: { roles: {}, users: {} },
    ranks: defaultRanks(now),
    rejectedDeleteSeconds: 10,
    requireApprovalForInitialRank: true,
    responsibleRoleIds: [],
    responsibleUserIds: [],
    temporaryCategoryId: null,
    temporaryChannelName: "up-{user}",
    updatedAt: now,
    updatedBy: null
  };
}

function defaultRanks(now: Date): MongoPoliceRankUpRank[] {
  return ["Recruta", "Soldado", "Cabo", "Terceiro Sargento", "Segundo Sargento", "Primeiro Sargento", "Tenente", "Coronel"].map((name, index) => ({
    id: slugId(name),
    allowSkip: false,
    allowedPreviousRanks: [],
    createdAt: now,
    description: null,
    emoji: null,
    enabled: true,
    hierarchyPosition: index + 1,
    name,
    roleId: "",
    updatedAt: now
  }));
}

function sanitizeSettingsInput(input: SavePoliceRankUpSettingsInput): SavePoliceRankUpSettingsInput {
  const output: SavePoliceRankUpSettingsInput = {};
  if (input.enabled !== undefined) output.enabled = input.enabled;
  if (input.panelChannelId !== undefined) output.panelChannelId = nullableId(input.panelChannelId);
  if (input.panelMessageId !== undefined) output.panelMessageId = nullableId(input.panelMessageId);
  if (input.temporaryCategoryId !== undefined) output.temporaryCategoryId = nullableId(input.temporaryCategoryId);
  if (input.logChannelId !== undefined) output.logChannelId = nullableId(input.logChannelId);
  if (input.adminChannelId !== undefined) output.adminChannelId = nullableId(input.adminChannelId);
  if (input.approvedDeleteSeconds !== undefined) output.approvedDeleteSeconds = clampInt(input.approvedDeleteSeconds, 0, 3600, 10);
  if (input.rejectedDeleteSeconds !== undefined) output.rejectedDeleteSeconds = clampInt(input.rejectedDeleteSeconds, 0, 3600, 10);
  if (input.minRequestIntervalHours !== undefined) output.minRequestIntervalHours = clampInt(input.minRequestIntervalHours, 0, 8760, 0);
  if (input.requireApprovalForInitialRank !== undefined) output.requireApprovalForInitialRank = input.requireApprovalForInitialRank;
  if (input.onlyNextRank !== undefined) output.onlyNextRank = input.onlyNextRank;
  if (input.blockDemotions !== undefined) output.blockDemotions = input.blockDemotions;
  if (input.allowRequesterCancel !== undefined) output.allowRequesterCancel = input.allowRequesterCancel;
  if (input.notifyByDm !== undefined) output.notifyByDm = input.notifyByDm;
  if (input.mentionResponsibles !== undefined) output.mentionResponsibles = input.mentionResponsibles;
  if (input.autoDeleteChannels !== undefined) output.autoDeleteChannels = input.autoDeleteChannels;
  if (input.blockMultipleRanks !== undefined) output.blockMultipleRanks = input.blockMultipleRanks;
  if (input.panelMessage !== undefined) output.panelMessage = normalizeText(input.panelMessage, 1500);
  if (input.temporaryChannelName !== undefined) output.temporaryChannelName = normalizeText(input.temporaryChannelName, 80) || "up-{user}";
  if (input.responsibleUserIds !== undefined) output.responsibleUserIds = uniqueIds(input.responsibleUserIds);
  if (input.responsibleRoleIds !== undefined) output.responsibleRoleIds = uniqueIds(input.responsibleRoleIds);
  if (input.adminUserIds !== undefined) output.adminUserIds = uniqueIds(input.adminUserIds);
  if (input.adminRoleIds !== undefined) output.adminRoleIds = uniqueIds(input.adminRoleIds);
  if (input.permissions !== undefined) output.permissions = sanitizePermissions(input.permissions);
  if (input.ranks !== undefined) output.ranks = input.ranks.slice(0, 100).map(sanitizeRank).sort((a, b) => a.hierarchyPosition - b.hierarchyPosition);
  return output;
}

function sanitizeRank(rank: MongoPoliceRankUpRank): MongoPoliceRankUpRank {
  const now = new Date();
  const name = normalizeText(rank.name, 100) || "Patente";
  return {
    id: normalizeText(rank.id, 80) || slugId(name),
    allowSkip: rank.allowSkip === true,
    allowedPreviousRanks: uniqueIds(rank.allowedPreviousRanks ?? []),
    createdAt: rank.createdAt ? new Date(rank.createdAt) : now,
    description: rank.description ? normalizeText(rank.description, 100) : null,
    emoji: rank.emoji ? normalizeText(rank.emoji, 80) : null,
    enabled: rank.enabled !== false,
    hierarchyPosition: clampInt(rank.hierarchyPosition, 1, 1000, 1),
    name,
    roleId: normalizeText(rank.roleId, 32),
    updatedAt: now
  };
}

function sanitizePermissions(input: MongoPoliceRankUpSettings["permissions"]) {
  return {
    roles: sanitizePermissionMap(input.roles ?? {}),
    users: sanitizePermissionMap(input.users ?? {})
  };
}

function sanitizePermissionMap(input: Record<string, MongoPoliceRankUpPermission[]>) {
  const allowed = new Set<MongoPoliceRankUpPermission>(["view", "approve", "reject", "cancel", "manage_ranks", "manage_channels", "publish_panel", "view_logs", "manage_responsibles"]);
  return Object.fromEntries(Object.entries(input).map(([id, values]) => [
    id,
    [...new Set((values ?? []).filter((permission) => allowed.has(permission)))]
  ]).filter(([id, values]) => /^\d{5,32}$/.test(String(id)) && Array.isArray(values) && values.length));
}

function settingsDto(settings: MongoPoliceRankUpSettings): PoliceRankUpSettingsDto {
  return {
    ...settings,
    id: settings._id,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

function requestDto(request: MongoPoliceRankUpRequest): PoliceRankUpRequestDto {
  return {
    ...request,
    id: request._id,
    createdAt: request.createdAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    updatedAt: request.updatedAt.toISOString()
  };
}

function logDto(log: MongoPoliceRankUpLog) {
  return {
    action: log.action,
    actorId: log.actorId,
    actorName: log.actorName,
    createdAt: log.createdAt.toISOString(),
    id: log._id,
    requestId: log.requestId
  };
}

function nullableId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function uniqueIds(values: string[]) {
  return [...new Set(values.filter((value) => /^\d{5,32}$/.test(value)))];
}

function normalizeText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function slugId(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
}

function changedKeys(input: Record<string, unknown>) {
  return { keys: Object.keys(input).sort() };
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
