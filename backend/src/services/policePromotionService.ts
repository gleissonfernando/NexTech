import { randomUUID } from "node:crypto";
import axios from "axios";
import {
  getMongoCollections,
  type MongoPolicePromotionAnswer,
  type MongoPolicePromotionDefinition,
  type MongoPolicePromotionQuestion,
  type MongoPolicePromotionQuestionType,
  type MongoPolicePromotionRequest,
  type MongoPolicePromotionSettings
} from "../database/mongo";
import { FIXED_SYSTEM_EMOJI_BY_KEY, fixedSystemEmojiText, normalizeFixedSystemEmojiText, type SystemEmojiKey } from "../config/systemEmojis";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom, emitRealtimeToRoomWithAck } from "../realtime/events";
import { getDevBotToken } from "./devBotService";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

export const POLICE_PROMOTIONS_MODULE_ID = "police-promotions";
const DISCORD_API = "https://discord.com/api/v10";
const COMPONENTS_V2_FLAG = 1 << 15;
const PANEL_SELECT_ID = "police_promotions:choose";

export type PolicePromotionSettingsDto = Omit<MongoPolicePromotionSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type PolicePromotionRequestDto = Omit<MongoPolicePromotionRequest, "_id" | "approvedAt" | "createdAt" | "evaluationEndedAt" | "evaluationStartedAt" | "history" | "updatedAt"> & {
  approvedAt: string | null;
  createdAt: string;
  evaluationEndedAt: string | null;
  evaluationStartedAt: string | null;
  history: Array<Omit<MongoPolicePromotionRequest["history"][number], "at"> & { at: string }>;
  id: string;
  updatedAt: string;
};

export type PolicePromotionDashboardDto = {
  logs: Array<{ action: string; actorId: string | null; actorName: string | null; createdAt: string; id: string; requestId: string | null }>;
  requests: PolicePromotionRequestDto[];
  settings: PolicePromotionSettingsDto;
  stats: {
    approved: number;
    pending: number;
    rejected: number;
    total: number;
  };
};

export type SavePolicePromotionSettingsInput = Partial<Pick<
  MongoPolicePromotionSettings,
  "defaultApprovalChannelId" | "defaultCategoryId" | "defaultHistoryChannelId" | "defaultLogChannelId" | "defaultPanelChannelId" | "enabled" | "promotions"
>>;

export type CreatePolicePromotionRequestInput = {
  answers: MongoPolicePromotionAnswer[];
  guildId: string;
  previousRequestId?: string | null;
  promotionId: string;
  requesterId: string;
  requesterName: string;
};

type ActorInput = { actorId?: string | null; actorName?: string | null };

export async function getPolicePromotionDashboard(botId: string, guildId: string): Promise<PolicePromotionDashboardDto> {
  const [settings, requests, logs] = await Promise.all([
    getPolicePromotionSettings(botId, guildId),
    listPolicePromotionRequests(botId, guildId, 100),
    listPolicePromotionLogs(botId, guildId, 50)
  ]);
  return {
    logs,
    requests,
    settings,
    stats: {
      approved: requests.filter((item) => item.status === "approved").length,
      pending: requests.filter((item) => ["submitted", "ticket_open", "in_evaluation", "pending_approval"].includes(item.status)).length,
      rejected: requests.filter((item) => item.status === "rejected").length,
      total: requests.length
    }
  };
}

export async function getPolicePromotionSettings(botId: string, guildId: string) {
  const { policePromotionSettings } = await getMongoCollections();
  const current = await policePromotionSettings.findOne({ botId, guildId });
  if (current) return settingsDto(current);

  const row = defaultSettings(botId, guildId);
  await policePromotionSettings.insertOne(row);
  return settingsDto(row);
}

export async function savePolicePromotionSettings(botId: string, guildId: string, input: SavePolicePromotionSettingsInput, actorId: string | null) {
  const { policePromotionSettings } = await getMongoCollections();
  const current = await getPolicePromotionSettings(botId, guildId);
  const now = new Date();
  const next: MongoPolicePromotionSettings = {
    ...current,
    _id: current.id,
    createdAt: new Date(current.createdAt),
    updatedAt: now,
    updatedBy: actorId,
    ...sanitizeSettingsInput(input)
  };

  await policePromotionSettings.updateOne({ _id: next._id }, { $set: next }, { upsert: true });
  const dto = settingsDto(next);
  emitRealtime("police-promotions:settings_updated", { botId, guildId, settings: dto });
  return dto;
}

export async function requestPolicePromotionPanelPublish(botId: string, guildId: string, actorId: string | null) {
  const settings = await getPolicePromotionSettings(botId, guildId);
  if (!settings.enabled) throw Object.assign(new Error("Ative o Sistema de Promoções antes de publicar o painel."), { statusCode: 400 });
  if (!settings.defaultPanelChannelId) throw Object.assign(new Error("Configure o canal padrão do painel antes de publicar."), { statusCode: 400 });

  let messageId: string | null = null;
  const responses = await emitRealtimeToRoomWithAck<
    { botId: string; guildId: string; settings: PolicePromotionSettingsDto },
    { error?: string; messageId?: string | null; ok: boolean }
  >(devBotRealtimeRoom(botId), "police-promotions:panel_publish", { botId, guildId, settings }, 20_000);
  const success = responses.find((response) => response?.ok);
  if (success) {
    messageId = success.messageId ?? null;
  } else {
    const error = responses.find((response) => response?.error)?.error;
    messageId = await publishPolicePromotionPanelToDiscord(settings, await getDevBotToken(botId))
      .catch((directError) => {
        const directMessage = directError instanceof Error ? directError.message : String(directError);
        const socketMessage = error ? `${error} ` : "";
        throw Object.assign(new Error(`${socketMessage}Falha na publicação direta: ${directMessage}`.trim()), { statusCode: 409 });
      });
  }

  await createPolicePromotionLog(botId, guildId, {
    action: "promotion.panel_published",
    actorId,
    metadata: { channelId: settings.defaultPanelChannelId, messageId }
  });
  return settings;
}

export async function createPolicePromotionRequest(botId: string, input: CreatePolicePromotionRequestInput) {
  const { policePromotionRequests } = await getMongoCollections();
  const settings = await getPolicePromotionSettings(botId, input.guildId);
  const promotion = settings.promotions.find((item) => item.id === input.promotionId && item.active);
  if (!promotion) throw Object.assign(new Error("Promoção não encontrada ou desativada."), { statusCode: 404 });

  const answers = sanitizeAnswers(input.answers, promotion.questions);
  const now = new Date();
  const row: MongoPolicePromotionRequest = {
    _id: randomUUID(),
    approvalChannelId: null,
    approvalMessageId: null,
    approvalReason: null,
    approvalResult: null,
    approvedAt: null,
    approvedById: null,
    approvedByName: null,
    answers,
    botId,
    channelId: null,
    channelMessageId: null,
    createdAt: now,
    currentRank: answerValue(answers, "current_rank") || "Não informado",
    evaluationEndedAt: null,
    evaluationNotes: null,
    evaluationResult: null,
    evaluationStartedAt: null,
    evaluatorId: null,
    evaluatorName: null,
    guildId: input.guildId,
    history: [historyEntry("request.created", input.requesterId, input.requesterName, { promotionId: promotion.id })],
    inGameId: answerValue(answers, "ingame_id") || "Não informado",
    logChannelId: null,
    previousRequestId: input.previousRequestId ?? null,
    promotionId: promotion.id,
    promotionName: promotion.name,
    requesterId: input.requesterId,
    requesterName: normalizeText(input.requesterName, 100),
    requestedDate: answerValue(answers, "desired_date") || "Não informado",
    requestedTime: answerValue(answers, "desired_time") || "Não informado",
    status: "submitted",
    targetRank: promotion.receivedRankName || promotion.name,
    updatedAt: now
  };

  await policePromotionRequests.insertOne(row);
  await createPolicePromotionLog(botId, input.guildId, { action: "promotion.request_created", actorId: input.requesterId, actorName: input.requesterName, metadata: { promotionId: promotion.id }, requestId: row._id });
  emitRealtime("police-promotions:request_created", { botId, guildId: input.guildId, request: requestDto(row) });
  return requestDto(row);
}

export async function clonePolicePromotionRequest(botId: string, requestId: string, actor: ActorInput) {
  const current = await getPolicePromotionRequest(botId, requestId);
  return createPolicePromotionRequest(botId, {
    answers: current.answers,
    guildId: current.guildId,
    previousRequestId: current.id,
    promotionId: current.promotionId,
    requesterId: current.requesterId,
    requesterName: current.requesterName
  }).then(async (request) => {
    await createPolicePromotionLog(botId, request.guildId, { action: "promotion.new_evaluation_requested", actorId: actor.actorId, actorName: actor.actorName, metadata: { previousRequestId: current.id }, requestId: request.id });
    return request;
  });
}

export async function updatePolicePromotionTicketState(botId: string, requestId: string, input: { channelId?: string | null; channelMessageId?: string | null; logChannelId?: string | null }, actor: ActorInput = {}) {
  return updateRequest(botId, requestId, {
    ...(input.channelId !== undefined ? { channelId: input.channelId, status: input.channelId ? "ticket_open" as const : undefined } : {}),
    ...(input.channelMessageId !== undefined ? { channelMessageId: input.channelMessageId } : {}),
    ...(input.logChannelId !== undefined ? { logChannelId: input.logChannelId } : {})
  }, "request.ticket_updated", actor, input);
}

export async function assignPolicePromotionEvaluator(botId: string, requestId: string, input: { evaluatorId: string; evaluatorName: string }) {
  return updateRequest(botId, requestId, {
    evaluationStartedAt: new Date(),
    evaluatorId: input.evaluatorId,
    evaluatorName: normalizeText(input.evaluatorName, 100),
    status: "in_evaluation"
  }, "request.assigned", { actorId: input.evaluatorId, actorName: input.evaluatorName }, {});
}

export async function finishPolicePromotionEvaluation(botId: string, requestId: string, input: { evaluatorId: string; evaluationNotes: string; evaluationResult: "approved" | "rejected" }) {
  return updateRequest(botId, requestId, {
    evaluationEndedAt: new Date(),
    evaluationNotes: normalizeText(input.evaluationNotes, 6000),
    evaluationResult: input.evaluationResult,
    status: "pending_approval"
  }, "request.evaluation_finished", { actorId: input.evaluatorId }, { evaluationResult: input.evaluationResult });
}

export async function updatePolicePromotionApprovalMessage(botId: string, requestId: string, input: { approvalChannelId?: string | null; approvalMessageId?: string | null }) {
  return updateRequest(botId, requestId, {
    ...(input.approvalChannelId !== undefined ? { approvalChannelId: input.approvalChannelId } : {}),
    ...(input.approvalMessageId !== undefined ? { approvalMessageId: input.approvalMessageId } : {})
  }, "request.approval_message_updated", {}, input);
}

export async function decidePolicePromotionRequest(botId: string, requestId: string, input: { actorId: string; actorName: string; approvalReason?: string | null; result: "approved" | "rejected" }) {
  const current = await getPolicePromotionRequest(botId, requestId);
  if (current.status !== "pending_approval") throw Object.assign(new Error("Esta solicitação não está aguardando aprovação."), { statusCode: 409 });
  return updateRequest(botId, requestId, {
    approvalReason: normalizeText(input.approvalReason ?? "", 1000) || null,
    approvalResult: input.result,
    approvedAt: new Date(),
    approvedById: input.actorId,
    approvedByName: normalizeText(input.actorName, 100),
    status: input.result
  }, input.result === "approved" ? "request.approved" : "request.rejected", { actorId: input.actorId, actorName: input.actorName }, { result: input.result });
}

export async function closePolicePromotionRequest(botId: string, requestId: string, actor: ActorInput, status: "cancelled" | "closed" = "closed") {
  return updateRequest(botId, requestId, { status }, status === "cancelled" ? "request.cancelled" : "request.closed", actor, {});
}

export async function getPolicePromotionRequest(botId: string, requestId: string) {
  const { policePromotionRequests } = await getMongoCollections();
  const row = await policePromotionRequests.findOne({ _id: requestId, botId });
  if (!row) throw Object.assign(new Error("Solicitação de promoção não encontrada."), { statusCode: 404 });
  return requestDto(row);
}

export async function findPolicePromotionRequestByChannel(botId: string, channelId: string) {
  const { policePromotionRequests } = await getMongoCollections();
  const row = await policePromotionRequests.findOne({ botId, channelId, status: { $in: ["ticket_open", "in_evaluation", "pending_approval"] } });
  return row ? requestDto(row) : null;
}

export async function addPolicePromotionHistory(botId: string, requestId: string, action: string, actor: ActorInput, metadata: Record<string, unknown> = {}) {
  return updateRequest(botId, requestId, {}, action, actor, metadata);
}

export async function listPolicePromotionRequests(botId: string, guildId: string, limit = 50) {
  const { policePromotionRequests } = await getMongoCollections();
  return (await policePromotionRequests.find({ botId, guildId }).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray()).map(requestDto);
}

export async function createPolicePromotionLog(botId: string, guildId: string, input: { action: string; actorId?: string | null; actorName?: string | null; metadata?: Record<string, unknown>; requestId?: string | null }) {
  const { policePromotionLogs } = await getMongoCollections();
  const row = {
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
  await policePromotionLogs.insertOne(row);
  emitRealtime("police-promotions:log_created", { botId, guildId, log: { ...row, id: row._id, createdAt: row.createdAt.toISOString() } });
}

async function updateRequest(botId: string, requestId: string, patch: Partial<MongoPolicePromotionRequest>, action: string, actor: ActorInput, metadata: Record<string, unknown>) {
  const { policePromotionRequests } = await getMongoCollections();
  const now = new Date();
  const history = historyEntry(action, actor.actorId ?? null, actor.actorName ?? null, metadata);
  const cleanedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const updated = await policePromotionRequests.findOneAndUpdate(
    { _id: requestId, botId },
    { $set: { ...cleanedPatch, updatedAt: now }, $push: { history } },
    { returnDocument: "after" }
  );
  if (!updated) throw Object.assign(new Error("Solicitação de promoção não encontrada."), { statusCode: 404 });
  await createPolicePromotionLog(botId, updated.guildId, { action, actorId: actor.actorId, actorName: actor.actorName, metadata, requestId });
  return requestDto(updated);
}

async function listPolicePromotionLogs(botId: string, guildId: string, limit = 50) {
  const { policePromotionLogs } = await getMongoCollections();
  return (await policePromotionLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(limit).toArray()).map((log) => ({
    action: log.action,
    actorId: log.actorId,
    actorName: log.actorName,
    createdAt: log.createdAt.toISOString(),
    id: log._id,
    requestId: log.requestId
  }));
}

function defaultSettings(botId: string, guildId: string): MongoPolicePromotionSettings {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    botId,
    createdAt: now,
    defaultApprovalChannelId: null,
    defaultCategoryId: null,
    defaultHistoryChannelId: null,
    defaultLogChannelId: null,
    defaultPanelChannelId: null,
    enabled: false,
    guildId,
    promotions: [defaultPromotion()],
    updatedAt: now,
    updatedBy: null
  };
}

function defaultPromotion(): MongoPolicePromotionDefinition {
  return {
    id: randomUUID(),
    active: true,
    approvalRoleIds: [],
    categoryId: null,
    color: "#2563eb",
    description: "Solicitação de avaliação para promoção de patente.",
    emoji: fixedSystemEmojiText("prancheta"),
    evaluatorRoleIds: [],
    grantedRoleId: null,
    historyChannelId: null,
    logChannelId: null,
    name: "Cadete para Officer",
    panelChannelId: null,
    panelDescription: "Preencha o formulário para solicitar sua avaliação de promoção.",
    panelMessageId: null,
    panelTitle: "Solicitação de Avaliação - Officer",
    receivedRankName: "Officer",
    rejectedRoleIds: [],
    removedRoleId: null,
    requestNewEvaluationEnabled: true,
    questions: defaultQuestions()
  };
}

function defaultQuestions(): MongoPolicePromotionQuestion[] {
  return [
    question("full_name", "Nome Completo", "short", 1, { required: true }),
    question("current_rank", "Patente Atual", "short", 2, { required: true }),
    question("ingame_id", "ID In Game", "short", 3, { required: true }),
    question("desired_date", "Data desejada da avaliação", "date", 4, { required: true, placeholder: "15/07/2026" }),
    question("desired_time", "Horário", "time", 5, { required: true, placeholder: "15:47" }),
    question("minimum_days", "Possui os dias mínimos exigidos?", "select", 6, { options: ["Sim", "Não"], required: true }),
    question("required_courses", "Possui os cursos obrigatórios?", "select", 7, { options: ["Sim", "Não"], required: true })
  ];
}

function question(id: string, label: string, type: MongoPolicePromotionQuestionType, order: number, extra: Partial<MongoPolicePromotionQuestion> = {}): MongoPolicePromotionQuestion {
  return {
    active: true,
    defaultValue: null,
    description: null,
    id,
    label,
    maxLength: type === "paragraph" ? 1000 : 120,
    options: [],
    order,
    placeholder: null,
    required: false,
    type,
    ...extra
  };
}

function settingsDto(row: MongoPolicePromotionSettings): PolicePromotionSettingsDto {
  const { _id, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    id: _id,
    createdAt: createdAt.toISOString(),
    promotions: sanitizePromotions(row.promotions),
    updatedAt: updatedAt.toISOString()
  };
}

function requestDto(row: MongoPolicePromotionRequest): PolicePromotionRequestDto {
  const { _id, approvedAt, createdAt, evaluationEndedAt, evaluationStartedAt, history, updatedAt, ...rest } = row;
  return {
    ...rest,
    approvedAt: approvedAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    evaluationEndedAt: evaluationEndedAt?.toISOString() ?? null,
    evaluationStartedAt: evaluationStartedAt?.toISOString() ?? null,
    history: (history ?? []).map((entry) => ({ ...entry, at: entry.at.toISOString() })),
    id: _id,
    updatedAt: updatedAt.toISOString()
  };
}

async function publishPolicePromotionPanelToDiscord(settings: PolicePromotionSettingsDto, botToken: string | null) {
  if (!botToken) throw new Error("Token do bot não configurado.");
  if (!settings.defaultPanelChannelId) throw new Error("Canal padrão do painel não configurado.");

  const panelImage = await getPanelImageSettings(settings.guildId, settings.botId, "police-promotions").catch(() => null);
  const payload = buildPolicePromotionPanelPayload(settings, panelImage?.imageEnabled ? panelImage : null);
  const { data } = await axios.post<{ id: string }>(
    `${DISCORD_API}/channels/${settings.defaultPanelChannelId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      timeout: 12_000
    }
  ).catch((error) => {
    throw new Error(discordErrorMessage(error));
  });

  return data.id;
}

function buildPolicePromotionPanelPayload(settings: PolicePromotionSettingsDto, panelImage: PanelImageSettingsDto | null = null) {
  const promotions = settings.promotions.filter((item) => item.active);
  const options = promotions.slice(0, 25).map((promotion) => ({
    description: clipText(promotion.description, 90),
    emoji: fixedDiscordEmoji("prancheta"),
    label: clipText(promotion.name, 80),
    value: promotion.id.slice(0, 100)
  }));

  const contentComponents: unknown[] = [];
  const banner = panelImage?.imageUrl ? resolveDiscordImageUrl(panelImage.imageUrl) : null;
  if (banner && ["banner", "top"].includes(panelImage?.imagePosition ?? "none")) {
    contentComponents.push(mediaGallery(banner, "Sistema de Promoções"));
  }
  contentComponents.push({
    type: 10,
    content: [
      `# ${fixedSystemEmojiText("prancheta_acertos")} Sistema de Promoções`,
      "Solicite sua avaliação de promoção pelo seletor abaixo.",
      "",
      promotions.map((item) => `• ${fixedSystemEmojiText("prancheta")} **${escapeMarkdown(item.name)}** -> ${escapeMarkdown(item.receivedRankName)}`).join("\n") || "Nenhuma promoção ativa configurada."
    ].join("\n")
  });
  if (banner && !["banner", "top"].includes(panelImage?.imagePosition ?? "none")) {
    contentComponents.push(mediaGallery(banner, "Sistema de Promoções"));
  }
  if (options.length) {
    contentComponents.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: PANEL_SELECT_ID,
        placeholder: "Selecione a promoção desejada",
        min_values: 0,
        max_values: 1,
        options
      }]
    });
  }

  return {
    allowed_mentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: parseColor(promotions[0]?.color ?? "#2563eb"),
      components: contentComponents
    }],
    flags: COMPONENTS_V2_FLAG
  };
}

function sanitizeSettingsInput(input: SavePolicePromotionSettingsInput) {
  const next: SavePolicePromotionSettingsInput = { ...input };
  if (next.defaultApprovalChannelId !== undefined) next.defaultApprovalChannelId = normalizeSnowflake(next.defaultApprovalChannelId);
  if (next.defaultCategoryId !== undefined) next.defaultCategoryId = normalizeSnowflake(next.defaultCategoryId);
  if (next.defaultHistoryChannelId !== undefined) next.defaultHistoryChannelId = normalizeSnowflake(next.defaultHistoryChannelId);
  if (next.defaultLogChannelId !== undefined) next.defaultLogChannelId = normalizeSnowflake(next.defaultLogChannelId);
  if (next.defaultPanelChannelId !== undefined) next.defaultPanelChannelId = normalizeSnowflake(next.defaultPanelChannelId);
  if (next.promotions !== undefined) next.promotions = sanitizePromotions(next.promotions).slice(0, 50);
  return next;
}

function sanitizePromotions(promotions: MongoPolicePromotionDefinition[]) {
  return promotions.map((promotion, index) => ({
    id: promotion.id || randomUUID(),
    active: promotion.active !== false,
    approvalRoleIds: uniqueSnowflakes(promotion.approvalRoleIds),
    categoryId: normalizeSnowflake(promotion.categoryId),
    color: /^#[0-9a-f]{6}$/i.test(promotion.color) ? promotion.color : "#2563eb",
    description: normalizeText(promotion.description, 1200) || "Solicitação de avaliação para promoção de patente.",
    emoji: normalizePromotionEmoji(promotion.emoji),
    evaluatorRoleIds: uniqueSnowflakes(promotion.evaluatorRoleIds),
    grantedRoleId: normalizeSnowflake(promotion.grantedRoleId),
    historyChannelId: normalizeSnowflake(promotion.historyChannelId),
    logChannelId: normalizeSnowflake(promotion.logChannelId),
    name: normalizeText(promotion.name, 120) || `Promoção ${index + 1}`,
    panelChannelId: normalizeSnowflake(promotion.panelChannelId),
    panelDescription: normalizeText(promotion.panelDescription, 1200) || "Preencha o formulário para solicitar sua avaliação de promoção.",
    panelMessageId: normalizeSnowflake(promotion.panelMessageId),
    panelTitle: normalizeText(promotion.panelTitle, 200) || `Solicitação de Avaliação - ${promotion.receivedRankName || promotion.name || "Patente"}`,
    receivedRankName: normalizeText(promotion.receivedRankName, 100) || normalizeText(promotion.name, 100) || "Patente",
    rejectedRoleIds: uniqueSnowflakes(promotion.rejectedRoleIds),
    removedRoleId: normalizeSnowflake(promotion.removedRoleId),
    requestNewEvaluationEnabled: promotion.requestNewEvaluationEnabled !== false,
    questions: sanitizeQuestions(promotion.questions).slice(0, 100)
  }));
}

function sanitizeQuestions(questions: MongoPolicePromotionQuestion[]) {
  const rows = questions.length ? questions : defaultQuestions();
  return rows.map((question, index) => {
    const type = isQuestionType(question.type) ? question.type : "short";
    return {
      active: question.active !== false,
      defaultValue: normalizeText(question.defaultValue ?? "", 500) || null,
      description: normalizeText(question.description ?? "", 300) || null,
      id: question.id || randomUUID(),
      label: normalizeText(question.label, 120) || `Pergunta ${index + 1}`,
      maxLength: question.maxLength ? Math.min(Math.max(Math.round(question.maxLength), 1), type === "paragraph" ? 1000 : 300) : null,
      options: (question.options ?? []).map((option) => normalizeText(option, 80)).filter(Boolean).slice(0, 25),
      order: Number.isFinite(question.order) ? Math.round(question.order) : index + 1,
      placeholder: normalizeText(question.placeholder ?? "", 120) || null,
      required: question.required === true,
      type
    };
  }).sort((a, b) => a.order - b.order);
}

function sanitizeAnswers(answers: MongoPolicePromotionAnswer[], questions: MongoPolicePromotionQuestion[]) {
  const questionById = new Map(questions.map((item) => [item.id, item]));
  return answers
    .map((answer) => {
      const question = questionById.get(answer.questionId);
      if (!question) return null;
      const value = Array.isArray(answer.value)
        ? answer.value.map((item) => normalizeText(item, 200)).filter(Boolean).slice(0, 25)
        : normalizeText(String(answer.value ?? ""), question.maxLength ?? (question.type === "paragraph" ? 1000 : 300));
      return { questionId: question.id, label: question.label, type: question.type, value };
    })
    .filter((item): item is MongoPolicePromotionAnswer => Boolean(item));
}

function answerValue(answers: MongoPolicePromotionAnswer[], questionId: string) {
  const value = answers.find((answer) => answer.questionId === questionId)?.value;
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function historyEntry(action: string, actorId: string | null | undefined, actorName: string | null | undefined, metadata: Record<string, unknown>) {
  return { action, actorId: actorId ?? null, actorName: actorName ?? null, at: new Date(), metadata };
}

function normalizePromotionEmoji(value: unknown) {
  const raw = normalizeFixedSystemEmojiText(normalizeText(String(value ?? ""), 120));
  if (!raw) return null;

  const custom = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/.exec(raw);
  if (custom) {
    const animatedPrefix = custom[1] ? "a" : "";
    return `<${animatedPrefix}:${custom[2]}:${custom[3]}>`;
  }

  const token = /^:?([a-zA-Z0-9_]{2,64}):?$/.exec(raw)?.[1];
  if (token) {
    const normalized = normalizeFixedSystemEmojiText(`:${token}:`);
    return normalized !== `:${token}:` ? normalized : null;
  }

  return normalizeFixedSystemEmojiText(raw).slice(0, 120) || null;
}

function parseDiscordEmoji(value: string) {
  const custom = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/.exec(value.trim());
  if (custom) {
    return {
      animated: Boolean(custom[1]),
      id: custom[3],
      name: custom[2]
    };
  }

  return { name: value.trim() || "📋" };
}

function fixedDiscordEmoji(key: SystemEmojiKey) {
  const emoji = FIXED_SYSTEM_EMOJI_BY_KEY[key];
  return emoji
    ? { animated: emoji.animated, id: emoji.emojiId, name: emoji.name }
    : parseDiscordEmoji(fixedSystemEmojiText(key));
}

function mediaGallery(imageUrl: string, description: string) {
  return { type: 12, items: [{ media: { url: imageUrl }, description }] };
}

function resolveDiscordImageUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const origin = process.env.APP_BASE_URL || process.env.FRONTEND_URL || process.env.BACKEND_API_URL || "";
  if (!origin) return value;
  return `${origin.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
}

function discordErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { message?: string } | string | undefined;
    const detail = typeof data === "string" ? data : data?.message;
    if (status === 401) return "Token do bot inválido.";
    if (status === 403) return "O bot não tem permissão para enviar mensagens nesse canal.";
    if (status === 404) return "Canal do painel não encontrado pelo bot.";
    return [status ? `Discord ${status}` : "Discord", detail].filter(Boolean).join(": ");
  }

  return error instanceof Error ? error.message : String(error);
}

function clipText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength - 1) : value;
}

function parseColor(value: string) {
  const hex = value.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0x2563eb;
}

function escapeMarkdown(value: string) {
  return String(value ?? "").replace(/([\\*_`~|])/g, "\\$1");
}

function normalizeText(value: string, maxLength: number) {
  return String(value ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function normalizeSnowflake(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return /^\d{5,32}$/.test(text) ? text : null;
}

function uniqueSnowflakes(values: string[]) {
  return [...new Set((values ?? []).map((value) => normalizeSnowflake(value)).filter((value): value is string => Boolean(value)))].slice(0, 100);
}

function isQuestionType(value: string): value is MongoPolicePromotionQuestionType {
  return ["short", "paragraph", "number", "date", "time", "select", "checkbox", "radio"].includes(value);
}
