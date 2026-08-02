import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText } from "../config/systemEmojis";
import { ensureGuild, getMongoCollections, type MongoManualRegistrationLog, type MongoManualRegistrationSettings, type MongoManualRegistrationSubmission } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

export type ManualRegistrationFieldDto = {
  enabled: boolean;
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  name: string;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type ManualRegistrationSetRoleDto = {
  categoryId: string | null;
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
  requestable: boolean;
  roleId: string;
};

export type ManualRegistrationSettingsDto = {
  approvalChannelId: string | null;
  allowOnlyOneRequest: boolean;
  allowResubmit: boolean;
  approvalMessage: string;
  approverRoleIds: string[];
  approvedRoleId: string | null;
  manualRegistrationRoleIds: string[];
  requestCategoryId: string | null;
  automaticApproval: boolean;
  autoRoleIds: string[];
  bannerPosition: "top" | "bottom" | "none";
  botId: string | null;
  color: string;
  description: string | null;
  cooldownMinutes: number;
  dmNotifications: boolean;
  enabled: boolean;
  emoji: string | null;
  fields: ManualRegistrationFieldDto[];
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  logMentionRoleId: string | null;
  name: string;
  panelCategoryId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelImage: PanelImageSettingsDto | null;
  rejectionMessage: string;
  removeRoleIds: string[];
  setRoles: ManualRegistrationSetRoleDto[];
  staffRoleIds: string[];
  successMessage: string;
  thumbnailUrl: string | null;
  title: string;
  tutorial: string;
  updatedAt: string | null;
};

export type ManualRegistrationSubmissionDto = {
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string | null;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  channelId: string | null;
  logError: string | null;
  logMessageId: string | null;
  logStatus: "pending" | "sent" | "failed" | null;
  requestedName: string;
  registrationType: "request" | "manual";
  removedAt: string | null;
  removedBy: string | null;
  removalReason: string | null;
  id: string;
  messageId: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  requestedRoleId: string | null;
  status: "pending" | "processing" | "approved" | "failed" | "rejected" | "removed";
  updatedAt: string;
  userAvatar: string | null;
  userId: string;
  username: string;
};

export type ManualRegistrationRemovableStatus = "pending" | "failed" | "approved";

export type ManualRegistrationLogDto = {
  action: string;
  botId: string | null;
  createdAt: string;
  data: Record<string, unknown>;
  executorId: string | null;
  guildId: string;
  id: string;
  submissionId: string | null;
  targetUserId: string | null;
};

export type SaveManualRegistrationSettingsInput = Partial<Omit<ManualRegistrationSettingsDto, "botId" | "guildId" | "updatedAt">>;

const DEFAULT_FIELDS: ManualRegistrationFieldDto[] = [
  { enabled: true, id: "nome_personagem", label: "Nome do personagem", maxLength: 80, minLength: 2, name: "nome_personagem", placeholder: "Nome e sobrenome no RP", required: true, style: "short" },
  { enabled: true, id: "id_fivem", label: "ID in-game", maxLength: 32, minLength: 1, name: "id_fivem", placeholder: "Seu ID no servidor", required: true, style: "short" },
  { enabled: true, id: "telefone", label: "Telefone in-game", maxLength: 32, minLength: 1, name: "telefone", placeholder: "Número do personagem", required: false, style: "short" }
];

export function defaultManualRegistrationSettings(guildId: string, botId: string | null = null): ManualRegistrationSettingsDto {
  return {
    approvalChannelId: null,
    allowOnlyOneRequest: true,
    allowResubmit: true,
    approvalMessage: "Seu pedido de set foi aprovado.",
    approverRoleIds: [],
    approvedRoleId: null,
    manualRegistrationRoleIds: [],
    requestCategoryId: null,
    automaticApproval: false,
    autoRoleIds: [],
    bannerPosition: "top",
    botId,
    color: "#7c3aed",
    description: "Clique no botão abaixo para solicitar seu set. Preencha as informações corretamente para a equipe analisar.",
    cooldownMinutes: 60,
    dmNotifications: true,
    enabled: false,
    emoji: fixedSystemEmojiText("prancheta_caneta"),
    fields: DEFAULT_FIELDS.map((field) => ({ ...field })),
    footerText: "Cadastro enviado para analise da equipe.",
    guildId,
    logChannelId: null,
    logMentionRoleId: null,
    name: "Pedido de Set",
    panelCategoryId: null,
    panelChannelId: null,
    panelMessageId: null,
    panelImage: null,
    rejectionMessage: "Seu pedido de set foi recusado.",
    removeRoleIds: [],
    setRoles: [],
    staffRoleIds: [],
    successMessage: "Seu pedido de set foi enviado para analise.",
    thumbnailUrl: null,
    title: "Pedido de Set",
    tutorial: "**Como funciona**\n• Clique em Solicitar Set.\n• Escolha o set desejado.\n• Preencha corretamente todas as informações.\n• Aguarde a analise da equipe.",
    updatedAt: null
  };
}

export async function getManualRegistrationSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { manualRegistrationSettings } = await getMongoCollections();
  const settings = await manualRegistrationSettings.findOne(scopeQuery(guildId, normalizedBotId));
  const dto = settings ? toSettingsDto(settings) : defaultManualRegistrationSettings(guildId, normalizedBotId);
  return withPanelImage(dto);
}

export async function saveManualRegistrationSettings(
  guildId: string,
  botId: string | null,
  input: SaveManualRegistrationSettingsInput,
  actorId: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getManualRegistrationSettings(guildId, normalizedBotId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId });
  const now = new Date();
  const { manualRegistrationSettings } = await getMongoCollections();

  await ensureGuild(guildId);
  await manualRegistrationSettings.updateOne(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: {
        ...next,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: randomUUID()
      }
    },
    { upsert: true }
  );

  await writeManualRegistrationLog({
    action: current.updatedAt ? "settings.updated" : "settings.created",
    botId: normalizedBotId,
    data: { after: settingsLogSnapshot(next), before: settingsLogSnapshot(current) },
    executorId: actorId,
    guildId,
    submissionId: null,
    targetUserId: null
  });
  if (current.enabled !== next.enabled) {
    await writeManualRegistrationLog({ action: next.enabled ? "system.enabled" : "system.disabled", botId: normalizedBotId, data: {}, executorId: actorId, guildId, submissionId: null, targetUserId: null });
  }
  const currentSets = new Map(current.setRoles.map((item) => [item.id, item]));
  const nextSets = new Map(next.setRoles.map((item) => [item.id, item]));
  for (const item of next.setRoles) {
    const previous = currentSets.get(item.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(item)) {
      await writeManualRegistrationLog({ action: previous ? "set.updated" : "set.created", botId: normalizedBotId, data: { after: item, before: previous ?? null }, executorId: actorId, guildId, submissionId: null, targetUserId: null });
    }
  }
  for (const item of current.setRoles) {
    if (!nextSets.has(item.id)) await writeManualRegistrationLog({ action: "set.removed", botId: normalizedBotId, data: { before: item }, executorId: actorId, guildId, submissionId: null, targetUserId: null });
  }
  emitManualRegistrationUpdated(guildId, normalizedBotId);
  if (normalizedBotId && next.enabled && next.panelMessageId) {
    emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "manual-registration:panel_publish", { botId: normalizedBotId, guildId });
  }

  return getManualRegistrationSettings(guildId, normalizedBotId);
}

export async function requestManualRegistrationPanelPublish(guildId: string, botId: string, actorId: string | null) {
  const settings = await getManualRegistrationSettings(guildId, botId);
  if (!settings.enabled) throw Object.assign(new Error("Ative o Pedido de Set antes de publicar o painel."), { statusCode: 400 });
  if (!settings.panelChannelId) throw Object.assign(new Error("Configure o canal do painel de Set."), { statusCode: 400 });
  if (!settings.requestCategoryId) throw Object.assign(new Error("Configure a categoria dos pedidos privados."), { statusCode: 400 });
  if (!settings.approvedRoleId) throw Object.assign(new Error("Configure o cargo atribuido ao aprovar."), { statusCode: 400 });
  if (!settings.approverRoleIds.length) throw Object.assign(new Error("Configure ao menos um cargo de aprovação e recusa."), { statusCode: 400 });
  await writeManualRegistrationLog({ action: "panel.publish_requested", botId, data: { categoryId: settings.panelCategoryId, channelId: settings.panelChannelId }, executorId: actorId, guildId, submissionId: null, targetUserId: null });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "manual-registration:panel_publish", { botId, guildId });
  return settings;
}

export async function createManualRegistrationSubmission(input: {
  botId?: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  messageId?: string | null;
  registrationType?: "request" | "manual";
  requestedRoleId?: string | null;
  userAvatar?: string | null;
  userId: string;
  username: string;
}) {
  const now = new Date();
  const normalizedBotId = normalizeBotId(input.botId);
  const settings = await getManualRegistrationSettings(input.guildId, normalizedBotId);
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const active = await manualRegistrationSubmissions.findOne({ ...scopeQuery(input.guildId, normalizedBotId), userId: input.userId, status: { $in: ["pending", "processing", "failed", "approved"] } });
  if (active?.status === "pending") throw conflict("Você já possui um pedido de set pendente.");
  if (active?.status === "processing") throw conflict("Seu pedido de set já está sendo processado.");
  if (active?.status === "failed") throw conflict("Seu pedido de set precisa ser revisado pela equipe antes de enviar outro.");
  if (active?.status === "approved") throw conflict("Você já possui um cadastro de set ativo.");
  const latest = settings.allowResubmit ? null : await manualRegistrationSubmissions.findOne(
    { ...scopeQuery(input.guildId, normalizedBotId), userId: input.userId },
    { sort: { createdAt: -1 } }
  );
  if (!settings.allowResubmit && latest?.status === "rejected") throw conflict("Um novo pedido não está liberado após uma recusa.");
  const requestedRoleId = normalizeSnowflake(input.requestedRoleId);
  if (settings.setRoles.length && !settings.setRoles.some((item) => item.enabled && item.requestable && item.roleId === requestedRoleId)) {
    throw Object.assign(new Error("O set selecionado não está disponível."), { statusCode: 400 });
  }
  const requestedName = manualRegistrationRequestedName(input.fields) ?? input.username;
  const submission: MongoManualRegistrationSubmission = {
    _id: randomUUID(),
    approvedAt: null,
    approvedBy: null,
    botId: normalizedBotId,
    createdAt: now,
    fields: input.fields.map((field) => ({
      id: field.id,
      label: field.label.slice(0, 100),
      value: field.value.slice(0, 1500)
    })),
    guildId: input.guildId,
    channelId: null,
    logError: null,
    logMessageId: null,
    logStatus: "pending",
    requestedName,
    registrationType: input.registrationType ?? "request",
    registrationVersion: 2,
    removedAt: null,
    removedBy: null,
    removalReason: null,
    messageId: input.messageId ?? null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    requestedRoleId: requestedRoleId ?? settings.approvedRoleId ?? settings.setRoles.find((item) => item.enabled && item.requestable)?.roleId ?? settings.autoRoleIds[0] ?? null,
    status: "pending",
    updatedAt: now,
    userAvatar: input.userAvatar ?? null,
    userId: input.userId,
    username: input.username
  };

  await ensureGuild(input.guildId);
  try { await manualRegistrationSubmissions.insertOne(submission); } catch (error) { if (typeof error === "object" && error && "code" in error && error.code === 11000) throw conflict("Você já possui um pedido ou cadastro ativo."); throw error; }
  await writeManualRegistrationLog({ action: "submission.created", botId: normalizedBotId, data: { requestedRoleId: submission.requestedRoleId }, executorId: input.userId, guildId: input.guildId, submissionId: submission._id, targetUserId: input.userId });
  emitManualRegistrationUpdated(input.guildId, normalizedBotId);
  return toSubmissionDto(submission);
}

export async function createManualRegistrationDashboardSubmission(input: {
  actorId: string;
  botId: string;
  characterName: string;
  gameId: string;
  goalCategoryId: string;
  guildId: string;
  requestedRoleId: string;
  userAvatar?: string | null;
  userId: string;
  username: string;
}) {
  const now = new Date();
  const submission: MongoManualRegistrationSubmission = {
    _id: randomUUID(), approvedAt: null, approvedBy: null, botId: input.botId, createdAt: now,
    fields: [
      { id: "nome_personagem", label: "Nome do personagem", value: input.characterName },
      { id: "id_fivem", label: "ID in-game", value: input.gameId }
    ],
    guildId: input.guildId, messageId: null, rejectedAt: null, rejectedBy: null, rejectionReason: null,
    channelId: null, logError: null, logMessageId: null, logStatus: "pending", requestedName: input.characterName, registrationType: "manual", registrationVersion: 2, removedAt: null, removedBy: null, removalReason: null,
    requestedRoleId: input.requestedRoleId, status: "pending", updatedAt: now,
    userAvatar: input.userAvatar ?? null, userId: input.userId, username: input.username
  };
  const { manualRegistrationSubmissions } = await getMongoCollections();
  await ensureGuild(input.guildId);
  await manualRegistrationSubmissions.insertOne(submission);
  await writeManualRegistrationLog({ action: "submission.manual_created", botId: input.botId, data: { requestedRoleId: input.requestedRoleId }, executorId: input.actorId, guildId: input.guildId, submissionId: submission._id, targetUserId: input.userId });
  emitManualRegistrationUpdated(input.guildId, input.botId);
  emitRealtimeToRoom(devBotRealtimeRoom(input.botId), "manual-registration:execute", {
    botId: input.botId, goalCategoryId: input.goalCategoryId, guildId: input.guildId, requestedRoleId: input.requestedRoleId,
    submissionId: submission._id, userId: input.userId, username: input.characterName
  });
  return toSubmissionDto(submission);
}

export async function updateManualRegistrationSubmissionMessage(id: string, botId: string | null, messageId: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  await manualRegistrationSubmissions.updateOne(
    { _id: id, botId: normalizeBotId(botId) },
    { $set: { messageId, updatedAt: new Date() } }
  );
}

export async function updateManualRegistrationSubmissionChannel(id: string, botId: string | null, channelId: string | null, messageId: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate({ _id: id, botId: normalizeBotId(botId), status: "pending", $or: [{ channelId: null }, { channelId: { $exists: false } }, { channelId }] }, { $set: { channelId, messageId, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!saved) throw conflict("Este pedido já possui outro canal ativo ou foi processado.");
  emitManualRegistrationUpdated(saved.guildId, normalizeBotId(botId));
  return toSubmissionDto(saved);
}

export async function updateManualRegistrationSubmissionLogState(id: string, botId: string | null, input: { logError?: string | null; logMessageId?: string | null; logStatus: "pending" | "sent" | "failed" }) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: id, botId: normalizeBotId(botId) },
    {
      $set: {
        logError: normalizeText(input.logError, 800),
        logMessageId: normalizeSnowflake(input.logMessageId),
        logStatus: input.logStatus,
        updatedAt: new Date()
      }
    },
    { returnDocument: "after" }
  );
  if (!saved) throw Object.assign(new Error("Pedido de set não encontrado."), { statusCode: 404 });
  emitManualRegistrationUpdated(saved.guildId, normalizeBotId(botId));
  return toSubmissionDto(saved);
}

export async function updateManualRegistrationSubmissionRole(input: { actorId: string; botId?: string | null; guildId: string; id: string; requestedRoleId: string }) {
  const botId = normalizeBotId(input.botId);
  const settings = await getManualRegistrationSettings(input.guildId, botId);
  if (!settings.setRoles.some((item) => item.enabled && item.roleId === input.requestedRoleId)) throw Object.assign(new Error("O set selecionado não está ativo."), { statusCode: 400 });
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, ...scopeQuery(input.guildId, botId), status: { $in: ["pending", "failed"] } },
    { $set: { requestedRoleId: input.requestedRoleId, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!saved) throw Object.assign(new Error("Pedido pendente não encontrado."), { statusCode: 404 });
  await writeManualRegistrationLog({ action: "submission.role_updated", botId, data: { requestedRoleId: input.requestedRoleId }, executorId: input.actorId, guildId: input.guildId, submissionId: input.id, targetUserId: saved.userId });
  emitManualRegistrationUpdated(input.guildId, botId);
  return toSubmissionDto(saved);
}

export async function beginManualRegistrationApproval(input: {
  actorId: string;
  actorRoleIds?: string[];
  actorIsAdministrator?: boolean;
  botId?: string | null;
  guildId: string;
  id: string;
}) {
  const botId = normalizeBotId(input.botId);
  const pendingSubmission = await (await getMongoCollections()).manualRegistrationSubmissions.findOne({ _id: input.id, ...scopeQuery(input.guildId, botId), status: { $in: ["pending", "failed"] } });
  if (!pendingSubmission) throw conflict("Pedido já está sendo processado, já foi aprovado ou não existe.");
  const settings = await getManualRegistrationSettings(pendingSubmission.guildId, botId);
  const authorizedRoles = pendingSubmission.registrationType === "manual" ? settings.manualRegistrationRoleIds : settings.approverRoleIds;
  if (!input.actorIsAdministrator && !input.actorRoleIds?.some((roleId) => authorizedRoles.includes(roleId))) throw Object.assign(new Error("O responsável não possui um cargo autorizado."), { statusCode: 403 });
  const now = new Date();
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, ...scopeQuery(input.guildId, botId), status: { $in: ["pending", "failed"] } },
    { $set: { status: "processing", rejectionReason: null, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!saved) throw conflict("Este pedido já está sendo processado por outro responsável.");
  await writeManualRegistrationLog({ action: "submission.approval_processing", botId, data: {}, executorId: input.actorId, guildId: saved.guildId, submissionId: saved._id, targetUserId: saved.userId });
  emitManualRegistrationUpdated(saved.guildId, botId);
  return toSubmissionDto(saved);
}

export async function completeManualRegistrationApproval(input: {
  actorId: string;
  botId?: string | null;
  guildId: string;
  id: string;
  metaChannelId?: string | null;
  farmChannelId?: string | null;
  roleIds?: string[];
}) {
  const botId = normalizeBotId(input.botId);
  const now = new Date();
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, ...scopeQuery(input.guildId, botId), status: "processing" },
    { $set: { status: "approved", approvedAt: now, approvedBy: input.actorId, rejectedAt: null, rejectedBy: null, rejectionReason: null, updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!saved) throw conflict("Pedido não está mais em processamento.");
  await writeManualRegistrationLog({
    action: "submission.approved",
    botId,
    data: { farmChannelId: input.farmChannelId ?? null, metaChannelId: input.metaChannelId ?? null, requestedRoleId: saved.requestedRoleId ?? null, roleIds: input.roleIds ?? [] },
    executorId: input.actorId,
    guildId: saved.guildId,
    submissionId: saved._id,
    targetUserId: saved.userId
  });
  emitManualRegistrationUpdated(saved.guildId, botId);
  return toSubmissionDto(saved);
}

export async function failManualRegistrationApproval(input: {
  actorId: string;
  botId?: string | null;
  guildId: string;
  id: string;
  reason: string;
}) {
  const botId = normalizeBotId(input.botId);
  const now = new Date();
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, ...scopeQuery(input.guildId, botId), status: "processing" },
    { $set: { status: "failed", rejectionReason: normalizeText(input.reason, 800), updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!saved) throw conflict("Pedido não está mais em processamento.");
  await writeManualRegistrationLog({ action: "submission.approval_failed", botId, data: { reason: saved.rejectionReason ?? null }, executorId: input.actorId, guildId: saved.guildId, submissionId: saved._id, targetUserId: saved.userId });
  emitManualRegistrationUpdated(saved.guildId, botId);
  return toSubmissionDto(saved);
}

export async function updateManualRegistrationSubmissionStatus(input: {
  actorId: string;
  actorRoleIds?: string[];
  actorIsAdministrator?: boolean;
  botId?: string | null;
  id: string;
  rejectionReason?: string | null;
  status: "approved" | "rejected";
}) {
  const pendingSubmission = await (await getMongoCollections()).manualRegistrationSubmissions.findOne({ _id: input.id, botId: normalizeBotId(input.botId), status: input.status === "approved" ? "processing" : { $in: ["pending", "failed"] } });
  if (!pendingSubmission) throw Object.assign(new Error("Pedido já processado ou inexistente."), { statusCode: 409 });
  const settings = await getManualRegistrationSettings(pendingSubmission.guildId, input.botId);
  const authorizedRoles = pendingSubmission.registrationType === "manual" ? settings.manualRegistrationRoleIds : settings.approverRoleIds;
  if (!input.actorIsAdministrator && !input.actorRoleIds?.some((roleId) => authorizedRoles.includes(roleId))) throw Object.assign(new Error("O responsável não possui um cargo autorizado."), { statusCode: 403 });
  const now = new Date();
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const update = input.status === "approved"
    ? { status: input.status, approvedAt: now, approvedBy: input.actorId, rejectedAt: null, rejectedBy: null, updatedAt: now }
    : { status: input.status, rejectedAt: now, rejectedBy: input.actorId, rejectionReason: normalizeText(input.rejectionReason, 800), approvedAt: null, approvedBy: null, updatedAt: now };
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, botId: normalizeBotId(input.botId), status: input.status === "approved" ? "processing" : { $in: ["pending", "failed"] } },
    { $set: update },
    { returnDocument: "after" }
  );

  if (!saved) {
    throw Object.assign(new Error("Solicitação não encontrada."), { statusCode: 404 });
  }

  await writeManualRegistrationLog({ action: input.status === "approved" ? "submission.approved" : "submission.rejected", botId: normalizeBotId(input.botId), data: { rejectionReason: saved.rejectionReason ?? null, requestedRoleId: saved.requestedRoleId ?? null }, executorId: input.actorId, guildId: saved.guildId, submissionId: saved._id, targetUserId: saved.userId });
  emitManualRegistrationUpdated(saved.guildId, normalizeBotId(input.botId));

  return toSubmissionDto(saved);
}

export async function listManualRegistrationSubmissions(guildId: string, botId?: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const rows = await manualRegistrationSubmissions
    .find({ ...scopeQuery(guildId, normalizeBotId(botId)), status: { $ne: "removed" } })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return rows.map(toSubmissionDto);
}

export async function deleteManualRegistrationSubmission(guildId: string, botId: string | null, id: string, actorId: string | null, reason = "Removido pela dashboard") {
  const normalizedBotId = normalizeBotId(botId);
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const current = await manualRegistrationSubmissions.findOne({ _id: id, ...scopeQuery(guildId, normalizedBotId) });
  if (!current || !isManualRegistrationRemovableStatus(current.status)) {
    throw Object.assign(new Error("Cadastro ativo ou pendente não encontrado."), { statusCode: 404 });
  }

  const now = new Date();
  const deleted = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: id, ...scopeQuery(guildId, normalizedBotId), status: current.status },
    { $set: { status: "removed", removedAt: now, removedBy: actorId, removalReason: normalizeText(reason, 800), updatedAt: now } },
    { returnDocument: "after" }
  );
  if (!deleted) throw Object.assign(new Error("Cadastro já foi alterado por outra ação."), { statusCode: 409 });

  await writeManualRegistrationLog({
    action: current.status === "pending" ? "submission.removed" : "registration.removed",
    botId: normalizedBotId,
    data: { channelId: deleted.channelId ?? null, messageId: deleted.messageId ?? null, previousStatus: current.status, requestedRoleId: deleted.requestedRoleId ?? null, reason },
    executorId: actorId,
    guildId,
    submissionId: id,
    targetUserId: deleted.userId
  });
  if (normalizedBotId) {
    emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "manual-registration:remove", {
      botId: normalizedBotId,
      channelId: deleted.channelId ?? null,
      guildId,
      messageId: deleted.messageId ?? null,
      previousStatus: current.status,
      roleId: current.status === "approved" ? deleted.requestedRoleId ?? null : null,
      submissionId: id,
      userId: deleted.userId
    });
  }
  emitManualRegistrationUpdated(guildId, normalizedBotId);
  return toSubmissionDto(deleted);
}

export async function getLatestManualRegistrationSubmission(guildId: string, userId: string, botId?: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const row = await manualRegistrationSubmissions.findOne({ ...scopeQuery(guildId, normalizeBotId(botId)), userId }, { sort: { createdAt: -1 } });
  return row ? toSubmissionDto(row) : null;
}

export async function listManualRegistrationLogs(guildId: string, botId?: string | null) {
  const { manualRegistrationLogs } = await getMongoCollections();
  const rows = await manualRegistrationLogs.find(scopeQuery(guildId, normalizeBotId(botId))).sort({ createdAt: -1 }).limit(100).toArray();
  return rows.map(toLogDto);
}

function normalizeSettings(settings: ManualRegistrationSettingsDto): ManualRegistrationSettingsDto {
  return {
    ...settings,
    approvalChannelId: normalizeSnowflake(settings.approvalChannelId),
    allowOnlyOneRequest: settings.allowOnlyOneRequest !== false,
    allowResubmit: settings.allowResubmit !== false,
    approvalMessage: normalizeText(settings.approvalMessage, 500) || "Seu pedido de set foi aprovado.",
    approverRoleIds: normalizeSnowflakes(settings.approverRoleIds).slice(0, 20),
    approvedRoleId: normalizeSnowflake(settings.approvedRoleId),
    manualRegistrationRoleIds: normalizeSnowflakes(settings.manualRegistrationRoleIds).slice(0, 20),
    requestCategoryId: normalizeSnowflake(settings.requestCategoryId),
    automaticApproval: false,
    autoRoleIds: normalizeSnowflakes(settings.autoRoleIds).slice(0, 20),
    bannerPosition: ["top", "bottom", "none"].includes(settings.bannerPosition) ? settings.bannerPosition : "top",
    color: /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : "#7c3aed",
    description: normalizeText(settings.description, 1200),
    cooldownMinutes: clamp(settings.cooldownMinutes, 0, 10080) ?? 60,
    dmNotifications: settings.dmNotifications !== false,
    emoji: normalizeText(settings.emoji, 80),
    fields: normalizeFields(settings.fields),
    footerText: normalizeText(settings.footerText, 180),
    logChannelId: normalizeSnowflake(settings.logChannelId),
    logMentionRoleId: normalizeSnowflake(settings.logMentionRoleId),
    name: normalizeText(settings.name, 80) || "Pedido de Set",
    panelCategoryId: normalizeSnowflake(settings.panelCategoryId),
    panelChannelId: normalizeSnowflake(settings.panelChannelId),
    panelMessageId: normalizeSnowflake(settings.panelMessageId),
    panelImage: settings.panelImage ?? null,
    rejectionMessage: normalizeText(settings.rejectionMessage, 500) || "Seu pedido de set foi recusado.",
    removeRoleIds: normalizeSnowflakes(settings.removeRoleIds).slice(0, 20),
    setRoles: normalizeSetRoles(settings.setRoles),
    staffRoleIds: normalizeSnowflakes(settings.staffRoleIds).slice(0, 20),
    successMessage: normalizeText(settings.successMessage, 500) || "Seu pedido de set foi enviado para analise.",
    thumbnailUrl: normalizeUrl(settings.thumbnailUrl),
    title: normalizeText(settings.title, 120) || "Pedido de Set",
    tutorial: normalizeText(settings.tutorial, 1500) || defaultManualRegistrationSettings(settings.guildId, settings.botId).tutorial
  };
}

function normalizeSetRoles(values: ManualRegistrationSetRoleDto[]) {
  return (Array.isArray(values) ? values : []).map((item, index) => ({
    categoryId: normalizeSnowflake(item.categoryId),
    description: normalizeText(item.description, 200),
    emoji: normalizeText(item.emoji, 80),
    enabled: item.enabled !== false,
    id: normalizeText(item.id, 80) || `set-${index + 1}`,
    name: normalizeText(item.name, 80) || `Set ${index + 1}`,
    order: clamp(item.order, 0, 1000) ?? index + 1,
    requestable: item.requestable !== false,
    roleId: normalizeSnowflake(item.roleId) ?? ""
  })).filter((item) => item.roleId).sort((a, b) => a.order - b.order).slice(0, 25);
}

function normalizeFields(fields: ManualRegistrationFieldDto[]) {
  const items = Array.isArray(fields) ? fields : [];
  const normalized = items.map((field, index) => {
    const label = normalizeText(field.label, 80) || `Campo ${index + 1}`;
    const id = normalizeText(field.id, 80) || slug(label) || `campo-${index + 1}`;
    return {
      enabled: field.enabled !== false,
      id,
      label,
      maxLength: clamp(field.maxLength, 1, 1500),
      minLength: clamp(field.minLength, 0, 1500),
      name: normalizeText(field.name, 80) || id,
      placeholder: normalizeText(field.placeholder, 100),
      required: field.required !== false,
      style: field.style === "paragraph" ? "paragraph" as const : "short" as const
    };
  }).filter((field) => field.label).slice(0, 100);

  if (!normalized.length) return DEFAULT_FIELDS.map((field) => ({ ...field }));
  if (isLegacyDefaultSetFields(normalized)) return normalized.slice(0, 3);
  return normalized;
}

function isLegacyDefaultSetFields(fields: ManualRegistrationFieldDto[]) {
  const legacyIds = ["nome_personagem", "id_fivem", "telefone", "recrutador", "observacoes"];
  return fields.length === legacyIds.length && legacyIds.every((id, index) => fields[index]?.id === id);
}

function toSettingsDto(settings: MongoManualRegistrationSettings): ManualRegistrationSettingsDto {
  return normalizeSettings({
    approvalChannelId: settings.approvalChannelId,
    allowOnlyOneRequest: settings.allowOnlyOneRequest !== false,
    allowResubmit: settings.allowResubmit !== false,
    approvalMessage: settings.approvalMessage ?? "Seu pedido de set foi aprovado.",
    approverRoleIds: settings.approverRoleIds ?? [],
    approvedRoleId: settings.approvedRoleId ?? settings.autoRoleIds?.[0] ?? null,
    manualRegistrationRoleIds: settings.manualRegistrationRoleIds ?? settings.staffRoleIds ?? [],
    requestCategoryId: settings.requestCategoryId ?? settings.panelCategoryId ?? null,
    automaticApproval: settings.automaticApproval === true,
    autoRoleIds: settings.autoRoleIds ?? [],
    bannerPosition: settings.bannerPosition ?? "top",
    botId: normalizeBotId(settings.botId),
    color: settings.color ?? "#7c3aed",
    description: settings.description,
    cooldownMinutes: settings.cooldownMinutes ?? 60,
    dmNotifications: settings.dmNotifications !== false,
    enabled: settings.enabled === true,
    emoji: settings.emoji,
    fields: (settings.fields ?? []) as ManualRegistrationFieldDto[],
    footerText: settings.footerText,
    guildId: settings.guildId,
    logChannelId: settings.logChannelId ?? null,
    logMentionRoleId: settings.logMentionRoleId ?? null,
    name: settings.name,
    panelCategoryId: settings.panelCategoryId ?? null,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    panelImage: null,
    rejectionMessage: settings.rejectionMessage ?? "Seu pedido de set foi recusado.",
    removeRoleIds: settings.removeRoleIds ?? [],
    setRoles: (settings.setRoles ?? []).map((item) => ({ ...item, categoryId: item.categoryId ?? null })),
    staffRoleIds: settings.staffRoleIds ?? [],
    successMessage: settings.successMessage ?? "Seu pedido de set foi enviado para analise.",
    thumbnailUrl: settings.thumbnailUrl,
    title: settings.title,
    tutorial: settings.tutorial ?? defaultManualRegistrationSettings(settings.guildId, normalizeBotId(settings.botId)).tutorial,
    updatedAt: settings.updatedAt?.toISOString() ?? null
  });
}

async function withPanelImage(settings: ManualRegistrationSettingsDto): Promise<ManualRegistrationSettingsDto> {
  if (!settings.botId) return settings;
  const panelImage = await getPanelImageSettings(settings.guildId, settings.botId, "manual-registration").catch(() => null);
  return {
    ...settings,
    panelImage: panelImage?.imageEnabled ? panelImage : null
  };
}

function toSubmissionDto(submission: MongoManualRegistrationSubmission): ManualRegistrationSubmissionDto {
  return {
    approvedAt: submission.approvedAt?.toISOString() ?? null,
    approvedBy: submission.approvedBy ?? null,
    botId: normalizeBotId(submission.botId),
    createdAt: submission.createdAt.toISOString(),
    fields: submission.fields,
    guildId: submission.guildId,
    channelId: submission.channelId ?? null,
    logError: submission.logError ?? null,
    logMessageId: submission.logMessageId ?? null,
    logStatus: submission.logStatus ?? null,
    requestedName: manualRegistrationRequestedName(submission.fields) ?? submission.requestedName ?? submission.username,
    registrationType: submission.registrationType ?? "request",
    removedAt: submission.removedAt?.toISOString() ?? null,
    removedBy: submission.removedBy ?? null,
    removalReason: submission.removalReason ?? null,
    id: submission._id,
    messageId: submission.messageId ?? null,
    rejectedAt: submission.rejectedAt?.toISOString() ?? null,
    rejectedBy: submission.rejectedBy ?? null,
    rejectionReason: submission.rejectionReason ?? null,
    requestedRoleId: submission.requestedRoleId ?? null,
    status: submission.status,
    updatedAt: submission.updatedAt.toISOString(),
    userAvatar: submission.userAvatar ?? null,
    userId: submission.userId,
    username: submission.username
  };
}

function toLogDto(log: MongoManualRegistrationLog): ManualRegistrationLogDto {
  return { action: log.action, botId: normalizeBotId(log.botId), createdAt: log.createdAt.toISOString(), data: log.data ?? {}, executorId: log.executorId ?? null, guildId: log.guildId, id: log._id, submissionId: log.submissionId ?? null, targetUserId: log.targetUserId ?? null };
}

async function writeManualRegistrationLog(input: Omit<MongoManualRegistrationLog, "_id" | "createdAt">) {
  const { manualRegistrationLogs } = await getMongoCollections();
  await manualRegistrationLogs.insertOne({ _id: randomUUID(), createdAt: new Date(), ...input, botId: normalizeBotId(input.botId) });
}

function emitManualRegistrationUpdated(guildId: string, botId: string | null) {
  if (!botId) return;
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "manual-registration:updated", { botId, guildId });
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export function isManualRegistrationRemovableStatus(status: MongoManualRegistrationSubmission["status"]): status is ManualRegistrationRemovableStatus {
  return status === "pending" || status === "failed" || status === "approved";
}

function settingsLogSnapshot(settings: ManualRegistrationSettingsDto) {
  return {
    approvalChannelId: settings.approvalChannelId,
    automaticApproval: settings.automaticApproval,
    enabled: settings.enabled,
    logChannelId: settings.logChannelId,
    panelChannelId: settings.panelChannelId,
    setRoleIds: settings.setRoles.map((item) => item.roleId),
    staffRoleIds: settings.staffRoleIds
  };
}

function scopeQuery(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = normalizeText(value, 2048);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? normalized : null;
  } catch {
    return normalized.startsWith("/uploads/") ? normalized : null;
  }
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set((values ?? []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))];
}

function manualRegistrationRequestedName(fields: Array<{ id: string; label: string; value: string }>) {
  const aliases = new Set(["nome_personagem", "personagem", "nome_do_personagem", "requested_name", "nome"].map(normalizeManualRegistrationFieldKey));
  const field = fields.find((item) => aliases.has(normalizeManualRegistrationFieldKey(item.id)) || aliases.has(normalizeManualRegistrationFieldKey(item.label)));
  if (!field) return null;
  const normalized = field.value.trim();
  return normalized && normalized !== "-" ? field.value : null;
}

function normalizeManualRegistrationFieldKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function clamp(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
