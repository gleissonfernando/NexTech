import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoManualRegistrationLog, type MongoManualRegistrationSettings, type MongoManualRegistrationSubmission } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { deleteUserLinks } from "./databaseMaintenanceService";
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
  id: string;
  messageId: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  requestedRoleId: string | null;
  status: "pending" | "approved" | "rejected";
  updatedAt: string;
  userAvatar: string | null;
  userId: string;
  username: string;
};

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
  { enabled: true, id: "telefone", label: "Telefone in-game", maxLength: 32, minLength: 1, name: "telefone", placeholder: "Numero do personagem", required: false, style: "short" },
  { enabled: true, id: "recrutador", label: "Quem recrutou", maxLength: 80, minLength: 2, name: "recrutador", placeholder: "Nome do recrutador", required: false, style: "short" },
  { enabled: true, id: "observacoes", label: "Observacoes", maxLength: 1000, minLength: null, name: "observacoes", placeholder: "Informacoes adicionais", required: false, style: "paragraph" }
];

export function defaultManualRegistrationSettings(guildId: string, botId: string | null = null): ManualRegistrationSettingsDto {
  return {
    approvalChannelId: null,
    allowOnlyOneRequest: true,
    allowResubmit: true,
    approvalMessage: "Seu pedido de set foi aprovado.",
    approverRoleIds: [],
    automaticApproval: false,
    autoRoleIds: [],
    bannerPosition: "top",
    botId,
    color: "#7c3aed",
    description: "Clique no botao abaixo para solicitar seu set. Preencha as informacoes corretamente para a equipe analisar.",
    cooldownMinutes: 60,
    dmNotifications: true,
    enabled: false,
    emoji: "📝",
    fields: DEFAULT_FIELDS.map((field) => ({ ...field })),
    footerText: "Cadastro enviado para analise da equipe.",
    guildId,
    logChannelId: null,
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
    tutorial: "**Como funciona**\n• Clique em Solicitar Set.\n• Escolha o set desejado.\n• Preencha corretamente todas as informacoes.\n• Aguarde a analise da equipe.",
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
  if (!settings.panelChannelId && !settings.panelCategoryId) throw Object.assign(new Error("Configure o canal ou a categoria do painel de Pedido de Set."), { statusCode: 400 });
  await writeManualRegistrationLog({ action: "panel.publish_requested", botId, data: { categoryId: settings.panelCategoryId, channelId: settings.panelChannelId }, executorId: actorId, guildId, submissionId: null, targetUserId: null });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "manual-registration:panel_publish", { botId, guildId });
  return settings;
}

export async function createManualRegistrationSubmission(input: {
  botId?: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  messageId?: string | null;
  requestedRoleId?: string | null;
  userAvatar?: string | null;
  userId: string;
  username: string;
}) {
  const now = new Date();
  const normalizedBotId = normalizeBotId(input.botId);
  const settings = await getManualRegistrationSettings(input.guildId, normalizedBotId);
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const latest = await manualRegistrationSubmissions.findOne(
    { ...scopeQuery(input.guildId, normalizedBotId), userId: input.userId },
    { sort: { createdAt: -1 } }
  );
  if (latest?.status === "pending") throw conflict("Voce ja possui um pedido de set pendente.");
  if (settings.allowOnlyOneRequest && latest?.status === "approved") throw conflict("Voce ja recebeu um set neste servidor.");
  if (!settings.allowResubmit && latest?.status === "rejected") throw conflict("Um novo pedido nao esta liberado apos uma recusa.");
  if (latest && settings.cooldownMinutes > 0 && now.getTime() - latest.createdAt.getTime() < settings.cooldownMinutes * 60_000) {
    const availableAt = new Date(latest.createdAt.getTime() + settings.cooldownMinutes * 60_000);
    throw conflict(`Aguarde ate ${availableAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} para solicitar novamente.`);
  }
  const requestedRoleId = normalizeSnowflake(input.requestedRoleId);
  if (settings.setRoles.length && !settings.setRoles.some((item) => item.enabled && item.requestable && item.roleId === requestedRoleId)) {
    throw Object.assign(new Error("O set selecionado nao esta disponivel."), { statusCode: 400 });
  }
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
    messageId: input.messageId ?? null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    requestedRoleId: requestedRoleId ?? settings.setRoles.find((item) => item.enabled && item.requestable)?.roleId ?? settings.autoRoleIds[0] ?? null,
    status: "pending",
    updatedAt: now,
    userAvatar: input.userAvatar ?? null,
    userId: input.userId,
    username: input.username
  };

  await ensureGuild(input.guildId);
  await manualRegistrationSubmissions.insertOne(submission);
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

export async function updateManualRegistrationSubmissionRole(input: { actorId: string; botId?: string | null; guildId: string; id: string; requestedRoleId: string }) {
  const botId = normalizeBotId(input.botId);
  const settings = await getManualRegistrationSettings(input.guildId, botId);
  if (!settings.setRoles.some((item) => item.enabled && item.roleId === input.requestedRoleId)) throw Object.assign(new Error("O set selecionado nao esta ativo."), { statusCode: 400 });
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, ...scopeQuery(input.guildId, botId), status: "pending" },
    { $set: { requestedRoleId: input.requestedRoleId, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!saved) throw Object.assign(new Error("Pedido pendente nao encontrado."), { statusCode: 404 });
  await writeManualRegistrationLog({ action: "submission.role_updated", botId, data: { requestedRoleId: input.requestedRoleId }, executorId: input.actorId, guildId: input.guildId, submissionId: input.id, targetUserId: saved.userId });
  emitManualRegistrationUpdated(input.guildId, botId);
  return toSubmissionDto(saved);
}

export async function updateManualRegistrationSubmissionStatus(input: {
  actorId: string;
  botId?: string | null;
  id: string;
  rejectionReason?: string | null;
  status: "approved" | "rejected";
}) {
  const now = new Date();
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const update = input.status === "approved"
    ? { status: input.status, approvedAt: now, approvedBy: input.actorId, rejectedAt: null, rejectedBy: null, updatedAt: now }
    : { status: input.status, rejectedAt: now, rejectedBy: input.actorId, rejectionReason: normalizeText(input.rejectionReason, 800), approvedAt: null, approvedBy: null, updatedAt: now };
  const saved = await manualRegistrationSubmissions.findOneAndUpdate(
    { _id: input.id, botId: normalizeBotId(input.botId), status: "pending" },
    { $set: update },
    { returnDocument: "after" }
  );

  if (!saved) {
    throw Object.assign(new Error("Solicitacao nao encontrada."), { statusCode: 404 });
  }

  await writeManualRegistrationLog({ action: input.status === "approved" ? "submission.approved" : "submission.rejected", botId: normalizeBotId(input.botId), data: { rejectionReason: saved.rejectionReason ?? null, requestedRoleId: saved.requestedRoleId ?? null }, executorId: input.actorId, guildId: saved.guildId, submissionId: saved._id, targetUserId: saved.userId });
  emitManualRegistrationUpdated(saved.guildId, normalizeBotId(input.botId));

  return toSubmissionDto(saved);
}

export async function listManualRegistrationSubmissions(guildId: string, botId?: string | null) {
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const rows = await manualRegistrationSubmissions
    .find(scopeQuery(guildId, normalizeBotId(botId)))
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return rows.map(toSubmissionDto);
}

export async function deleteManualRegistrationSubmission(guildId: string, botId: string | null, id: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { manualRegistrationSubmissions } = await getMongoCollections();
  const deleted = await manualRegistrationSubmissions.findOneAndDelete({ _id: id, ...scopeQuery(guildId, normalizedBotId) });
  if (!deleted) throw Object.assign(new Error("Cadastro nao encontrado."), { statusCode: 404 });
  await writeManualRegistrationLog({ action: "submission.deleted", botId: normalizedBotId, data: { status: deleted.status }, executorId: actorId, guildId, submissionId: id, targetUserId: deleted.userId });
  await deleteUserLinks({ actorId, botId: normalizedBotId, guildId, reason: "registration_cleanup", userId: deleted.userId });
  emitManualRegistrationUpdated(guildId, normalizedBotId);
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
    automaticApproval: settings.automaticApproval === true,
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

  return normalized.length ? normalized : DEFAULT_FIELDS.map((field) => ({ ...field }));
}

function toSettingsDto(settings: MongoManualRegistrationSettings): ManualRegistrationSettingsDto {
  return normalizeSettings({
    approvalChannelId: settings.approvalChannelId,
    allowOnlyOneRequest: settings.allowOnlyOneRequest !== false,
    allowResubmit: settings.allowResubmit !== false,
    approvalMessage: settings.approvalMessage ?? "Seu pedido de set foi aprovado.",
    approverRoleIds: settings.approverRoleIds ?? [],
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
    name: settings.name,
    panelCategoryId: settings.panelCategoryId ?? null,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    panelImage: null,
    rejectionMessage: settings.rejectionMessage ?? "Seu pedido de set foi recusado.",
    removeRoleIds: settings.removeRoleIds ?? [],
    setRoles: settings.setRoles ?? [],
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
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "manual-registration:updated", { botId, guildId });
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
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

function clamp(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
