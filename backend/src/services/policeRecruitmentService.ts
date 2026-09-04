import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoPoliceRecruitmentQuestion, type MongoPoliceRecruitmentQuestionType, type MongoPoliceRecruitmentSettings, type MongoPoliceRecruitmentSession, type MongoPoliceRecruitmentAnswer, type MongoPoliceRecruitmentResult } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtimeToRoomWithAck } from "../realtime/events";

export const POLICE_REPORTS_MODULE_ID = "police_reports";
export const POLICE_RECRUITMENT_MODULE_ID = POLICE_REPORTS_MODULE_ID;
export const POLICE_RECRUITMENT_LEGACY_MODULE_ID = "police-recruitment";

/**
 * Formulário padrão do relatório F.T.O., espelhando o formulário que a
 * corporação usava fora do bot.
 *
 * Só é aplicado quando o servidor ainda não tem NENHUMA pergunta cadastrada
 * (ver `ensureDefaultQuestions`): quem já configurou o próprio formulário não é
 * afetado. Tudo aqui é editável pela dashboard — nenhuma pergunta é fixa no
 * código.
 */
export const POLICE_RECRUITMENT_DEFAULT_QUESTIONS: Array<
  Pick<MongoPoliceRecruitmentQuestion, "title" | "description" | "type" | "required" | "options">
> = [
  { title: "Data do recrutamento", description: "Use o formato dd/mm/aaaa.", type: "DATE", required: true, options: [] },
  { title: "Horário de início", description: "Use o formato HH:MM.", type: "TIME", required: true, options: [] },
  { title: "Horário de término", description: "Use o formato HH:MM.", type: "TIME", required: true, options: [] },
  { title: "Recrutador responsável", description: "Exemplo: SO. Duckky Fahur", type: "TEXT", required: true, options: [] },
  { title: "Recrutadores auxiliares", description: "Liste os recrutadores que participaram.", type: "LONG_TEXT", required: true, options: [] },
  { title: "Quantidade total de candidatos", description: "Liste os candidatos que participaram.", type: "LONG_TEXT", required: true, options: [] },
  { title: "Quantidade de aprovados, reprovados e desistentes", description: "Informe no formato A=9 R=7 D=1.", type: "TEXT", required: true, options: [] },
  {
    title: "Quais etapas foram realizadas?",
    description: "Marque todas as etapas concluídas.",
    type: "MULTI_SELECT",
    required: true,
    options: [
      "Apresentação inicial",
      "Formação",
      "Revista e teste residual",
      "Treinamento físico militar",
      "Teste teórico e entrevista",
      "Apresentação ao responsável e ao corpo de recrutadores",
      "Apresentação ao Departamento de Polícia do Norte",
      "Armá-los e Fardá-los",
      "Juramento",
      "Convidá-los para o intra da NPD",
      "Apresentação do tablet policial e instruções básicas",
      "Não houve conscritos (marcar somente no caso descrito)"
    ]
  },
  { title: "O recrutamento seguiu o padrão estabelecido?", description: null, type: "SELECT", required: true, options: ["Sim", "Parcialmente", "Não"] },
  { title: "Houve problemas durante o recrutamento?", description: "Se sim, descreva. Caso contrário, deixe em branco.", type: "LONG_TEXT", required: false, options: [] },
  { title: "Preenchimento do relatório", description: "Cargo, data do preenchimento e por quem foi preenchido.", type: "TEXT", required: true, options: [] }
];

type SettingsInput = Partial<Pick<MongoPoliceRecruitmentSettings, "enabled" | "configured" | "corporationName" | "authorizedRoleIds" | "adminRoleIds" | "viewerRoleIds" | "deleteRoleIds" | "editorRoleIds" | "supervisorRoleIds" | "recruiterRoleIds" | "createReportRoleIds" | "editReportRoleIds" | "deleteReportRoleIds" | "viewAllReportsRoleIds" | "manageQuestionsRoleIds" | "manageConfigurationRoleIds" | "forumChannelId" | "reportsForumChannelId" | "temporaryCategoryId" | "logChannelId" | "sessionExpirationHours" | "sessionExpirationMinutes" | "deleteDelaySeconds" | "panelChannelId" | "panelMessageId" | "panelColor">>;
type RecruiterInput = { avatar: string | null; displayName: string; discordId: string; policeId?: string | null; username: string };
type RecruitedInput = { avatar: string | null; discordId: string; displayName: string; username: string };
type QuestionInput = Partial<Pick<MongoPoliceRecruitmentQuestion, "description" | "enabled" | "options" | "required" | "title" | "type">>;

export async function getPoliceRecruitmentSettings(botId: string, guildId: string) {
  const { policeRecruitmentSettings } = await getMongoCollections();
  const found = await policeRecruitmentSettings.findOne({ botId, guildId });
  if (found) return settingsDto(found);
  const now = new Date();
  const settings: MongoPoliceRecruitmentSettings = {
    _id: randomUUID(), adminRoleIds: [], authorizedRoleIds: [], botId, corporationName: "Corporação Policial", createdAt: now,
    configured: false, deleteDelaySeconds: 8, deleteRoleIds: [], editorRoleIds: [], enabled: false, forumChannelId: null, guildId, logChannelId: null,
    recruiterRoleIds: [], createReportRoleIds: [], editReportRoleIds: [], deleteReportRoleIds: [], viewAllReportsRoleIds: [], manageQuestionsRoleIds: [], manageConfigurationRoleIds: [],
    panelChannelId: null, panelColor: "#22c55e", panelMessageId: null, sessionExpirationHours: 12, supervisorRoleIds: [],
    reportsForumChannelId: null, sessionExpirationMinutes: 720, temporaryCategoryId: null, updatedAt: now, updatedBy: null, viewerRoleIds: []
  };
  await policeRecruitmentSettings.updateOne({ botId, guildId }, { $setOnInsert: settings }, { upsert: true });
  await ensureDefaultQuestions(botId, guildId);
  return settingsDto((await policeRecruitmentSettings.findOne({ botId, guildId })) ?? settings);
}

export async function savePoliceRecruitmentSettings(botId: string, guildId: string, input: SettingsInput, actorId: string | null) {
  const before = await getPoliceRecruitmentSettings(botId, guildId);
  const { policeRecruitmentSettings } = await getMongoCollections();
  const normalizedInput = normalizeSettingsInput(input);
  const now = new Date();
  const lifecycle = typeof normalizedInput.enabled === "boolean" && normalizedInput.enabled !== before.enabled
    ? normalizedInput.enabled
      ? { enabledAt: now, enabledBy: actorId, disabledAt: null, disabledBy: null }
      : { disabledAt: now, disabledBy: actorId }
    : {};
  await policeRecruitmentSettings.updateOne({ botId, guildId }, { $set: { ...normalizedInput, ...lifecycle, updatedAt: now, updatedBy: actorId } });
  if (normalizedInput.enabled === false) {
    const { policeRecruitmentSessions } = await getMongoCollections();
    await policeRecruitmentSessions.updateMany({ botId, guildId, status: "IN_PROGRESS" }, { $set: { status: "SUSPENDED", updatedAt: now }, $unset: { openKey: "" } });
  }
  await audit(botId, guildId, null, null, actorId, "configuration_changed", diffSettings(before, normalizedInput));

  // Ativou o módulo e ainda não há fórum escolhido: o bot cria um automaticamente.
  // Falha aqui (bot offline, sem permissão) não pode derrubar o salvamento — o
  // cliente continua podendo selecionar o fórum à mão.
  if (normalizedInput.enabled === true && before.enabled !== true) {
    await ensurePoliceRecruitmentForum(botId, guildId, actorId).catch((error) => {
      console.warn(
        `[police-reports] não foi possível criar o fórum automaticamente para o bot ${botId} no servidor ${guildId}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    });
  }

  return settingsDto((await policeRecruitmentSettings.findOne({ botId, guildId }))!);
}

/**
 * Garante o fórum de relatórios do módulo. Só age quando ainda não existe um
 * fórum configurado, para nunca sobrescrever a escolha do cliente.
 */
export async function ensurePoliceRecruitmentForum(botId: string, guildId: string, actorId: string | null) {
  const settings = await getPoliceRecruitmentSettings(botId, guildId);
  const currentForumId = settings.reportsForumChannelId ?? settings.forumChannelId ?? null;

  if (currentForumId) {
    return { created: false, forumChannelId: currentForumId, settings };
  }

  const responses = await emitRealtimeToRoomWithAck<
    { botId: string; guildId: string; name: string | null },
    { created?: boolean; error?: string; forumChannelId?: string | null; ok: boolean }
  >(
    devBotRealtimeRoom(botId),
    "police-recruitment:forum_ensure",
    { botId, guildId, name: "relatorios-policiais" },
    20_000
  );
  const response = responses.find((item) => item?.ok);

  if (!response?.ok || !response.forumChannelId) {
    throw serviceError(response?.error ?? "Não foi possível criar o fórum de relatórios.", 409);
  }

  const { policeRecruitmentSettings } = await getMongoCollections();
  await policeRecruitmentSettings.updateOne(
    { botId, guildId },
    { $set: { forumChannelId: response.forumChannelId, reportsForumChannelId: response.forumChannelId, updatedAt: new Date(), updatedBy: actorId } }
  );
  await audit(botId, guildId, null, null, actorId, "configuration_changed", {
    changedKeys: ["reportsForumChannelId"],
    previousValue: { reportsForumChannelId: null },
    newValue: { reportsForumChannelId: response.forumChannelId },
    source: response.created ? "forum_auto_created" : "forum_auto_reused"
  });

  return {
    created: response.created === true,
    forumChannelId: response.forumChannelId,
    settings: settingsDto((await policeRecruitmentSettings.findOne({ botId, guildId }))!)
  };
}

export async function requestPoliceRecruitmentPanelPublish(botId: string, guildId: string, actorId: string | null) {
  const settings = await getPoliceRecruitmentSettings(botId, guildId);
  if (!settings.enabled) throw serviceError("O módulo ainda não foi liberado.", 400);
  if (!settings.configured) throw serviceError("O módulo ainda não foi configurado.", 400);
  if (!settings.panelChannelId) throw serviceError("Canal do painel não configurado.", 400);
  const responses = await emitRealtimeToRoomWithAck<{ botId: string; guildId: string }, { error?: string; messageId?: string | null; ok: boolean }>(
    devBotRealtimeRoom(botId),
    "police-recruitment:panel_publish",
    { botId, guildId },
    20_000
  );
  const response = responses.find((item) => item?.ok);
  const messageId = response?.messageId ?? null;
  if (!response?.ok) {
    throw serviceError(response?.error ?? "Não foi possível publicar o painel.", 409);
  }
  await audit(botId, guildId, null, null, actorId, "panel_published", { messageId });
  return { messageId, settings };
}

export async function listPoliceRecruitmentQuestions(botId: string, guildId: string, includeDisabled = false) {
  if (!includeDisabled) await ensureDefaultQuestions(botId, guildId);
  const { policeRecruitmentQuestions } = await getMongoCollections();
  return (await policeRecruitmentQuestions.find({ botId, guildId, ...(includeDisabled ? {} : { enabled: true }) }).sort({ order: 1 }).toArray()).map(questionDto);
}

export async function createPoliceRecruitmentQuestion(botId: string, guildId: string, input: QuestionInput, actorId: string | null) {
  const { policeRecruitmentQuestions } = await getMongoCollections();
  const now = new Date();
  const last = await policeRecruitmentQuestions.find({ botId, guildId }).sort({ order: -1 }).limit(1).next();
  const question: MongoPoliceRecruitmentQuestion = {
    _id: randomUUID(),
    botId,
    description: cleanString(input.description, 600),
    enabled: input.enabled !== false,
    guildId,
    options: sanitizeOptions(input.options),
    order: (last?.order ?? 0) + 1,
    required: input.required !== false,
    title: cleanString(input.title, 120) || "Nova pergunta",
    type: normalizeQuestionType(input.type),
    createdAt: now,
    updatedAt: now,
    updatedBy: actorId
  };
  await policeRecruitmentQuestions.insertOne(question);
  await audit(botId, guildId, null, null, actorId, "question_created", { questionId: question._id, title: question.title });
  return questionDto(question);
}

export async function updatePoliceRecruitmentQuestion(botId: string, guildId: string, questionId: string, input: QuestionInput, actorId: string | null) {
  const patch: Partial<MongoPoliceRecruitmentQuestion> = {};
  if ("description" in input) patch.description = cleanString(input.description, 600);
  if ("enabled" in input) patch.enabled = input.enabled !== false;
  if ("options" in input) patch.options = sanitizeOptions(input.options);
  if ("required" in input) patch.required = input.required !== false;
  if ("title" in input) patch.title = cleanString(input.title, 120) || "Pergunta";
  if ("type" in input) patch.type = normalizeQuestionType(input.type);
  const { policeRecruitmentQuestions } = await getMongoCollections();
  const before = await policeRecruitmentQuestions.findOne({ _id: questionId, botId, guildId });
  if (!before) throw serviceError("Pergunta não encontrada.", 404);
  await policeRecruitmentQuestions.updateOne({ _id: questionId, botId, guildId }, { $set: { ...patch, updatedAt: new Date(), updatedBy: actorId } });
  await audit(botId, guildId, null, null, actorId, "question_updated", { questionId, previousValue: questionDto(before), newValue: patch });
  return questionDto((await policeRecruitmentQuestions.findOne({ _id: questionId, botId, guildId }))!);
}

export async function deletePoliceRecruitmentQuestion(botId: string, guildId: string, questionId: string, actorId: string | null) {
  const { policeRecruitmentQuestions } = await getMongoCollections();
  const before = await policeRecruitmentQuestions.findOne({ _id: questionId, botId, guildId });
  if (!before) return null;
  await policeRecruitmentQuestions.updateOne({ _id: questionId, botId, guildId }, { $set: { enabled: false, updatedAt: new Date(), updatedBy: actorId } });
  await audit(botId, guildId, null, null, actorId, "question_removed", { questionId, previousValue: questionDto(before) });
  return questionDto((await policeRecruitmentQuestions.findOne({ _id: questionId, botId, guildId }))!);
}

export async function reorderPoliceRecruitmentQuestion(botId: string, guildId: string, questionId: string, direction: "up" | "down", actorId: string | null) {
  const { policeRecruitmentQuestions } = await getMongoCollections();
  const questions = await policeRecruitmentQuestions.find({ botId, guildId }).sort({ order: 1 }).toArray();
  const index = questions.findIndex((item) => item._id === questionId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= questions.length) throw serviceError("Não foi possível mover esta pergunta.", 400);
  const current = questions[index]!;
  const other = questions[swapIndex]!;
  await Promise.all([
    policeRecruitmentQuestions.updateOne({ _id: current._id, botId, guildId }, { $set: { order: other.order, updatedAt: new Date(), updatedBy: actorId } }),
    policeRecruitmentQuestions.updateOne({ _id: other._id, botId, guildId }, { $set: { order: current.order, updatedAt: new Date(), updatedBy: actorId } })
  ]);
  await audit(botId, guildId, null, null, actorId, "question_reordered", { questionId, direction });
  return listPoliceRecruitmentQuestions(botId, guildId, true);
}

export async function getPoliceReportsDashboard(botId: string, guildId: string) {
  const [settings, questions, reports] = await Promise.all([
    getPoliceRecruitmentSettings(botId, guildId),
    listPoliceRecruitmentQuestions(botId, guildId, true),
    listPoliceRecruitmentReports(botId, guildId)
  ]);
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const { policeRecruiters, policeRecruitmentSessions, policeRecruitmentAudits } = await getMongoCollections();
  const [responsibles, inProgress, logs] = await Promise.all([
    policeRecruiters.find({ botId, guildId }).sort({ updatedAt: -1 }).limit(200).toArray(),
    policeRecruitmentSessions.countDocuments({ botId, guildId, status: { $in: ["IN_PROGRESS", "PROCESSING", "SUSPENDED"] } }),
    policeRecruitmentAudits.find({ botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);
  const validation = validatePoliceReportsConfiguration(settings, questions);
  return {
    logs: logs.map(auditDto),
    questions,
    reports,
    responsibles: responsibles.map(recruiterDto),
    settings: { ...settings, systemReady: validation.ready, status: policeReportsStatus(settings, validation.ready) },
    stats: {
      inProgress,
      reports: reports.length,
      responsibles: responsibles.length,
      thisMonth: reports.filter((item) => item.createdAt.startsWith(month)).length
    },
    validation
  };
}

export function validatePoliceReportsConfiguration(settings: any, questions: Array<{ enabled: boolean }>) {
  const checks = [
    check("enabled", "Módulo liberado", settings.enabled === true),
    check("temporaryCategoryId", "Categoria temporária", Boolean(settings.temporaryCategoryId)),
    check("panelChannelId", "Canal do painel", Boolean(settings.panelChannelId)),
    check("reportsForumChannelId", "Fórum dos relatórios", Boolean(settings.reportsForumChannelId ?? settings.forumChannelId)),
    check("logChannelId", "Canal de logs", Boolean(settings.logChannelId)),
    check("recruiterRoleIds", "Cargo de recrutador", roleList(settings.recruiterRoleIds, settings.authorizedRoleIds, settings.createReportRoleIds).length > 0),
    check("supervisorRoleIds", "Cargo supervisor", roleList(settings.supervisorRoleIds).length > 0),
    check("questions", "Perguntas configuradas", questions.some((item) => item.enabled !== false))
  ];
  return { checks, ready: checks.every((item) => item.ok) };
}

export async function createPoliceRecruitmentSession(input: { botId: string; guildId: string; recruiter: RecruiterInput; channelId?: string | null; panelMessageId?: string | null }) {
  const settings = await getPoliceRecruitmentSettings(input.botId, input.guildId);
  const questions = await listPoliceRecruitmentQuestions(input.botId, input.guildId);
  const validation = validatePoliceReportsConfiguration(settings, questions);
  if (!settings.enabled) throw serviceError("Relatórios Policiais não está liberado.", 403);
  if (!validation.ready) throw serviceError("O módulo ainda não foi configurado.", 409);
  const { policeRecruitmentSessions } = await getMongoCollections();
  const openKey = `${input.botId}:${input.guildId}:${input.recruiter.discordId}`;
  const existing = await policeRecruitmentSessions.findOne({ openKey });
  if (existing) return sessionDto(existing);
  const now = new Date();
  const session: MongoPoliceRecruitmentSession = {
    _id: randomUUID(), answers: [], botId: input.botId, cancelledAt: null, channelId: input.channelId ?? null, completedAt: null,
    createdAt: now, currentQuestion: 0, expiresAt: new Date(now.getTime() + sessionExpirationMinutes(settings) * 60_000), guildId: input.guildId,
    openKey, panelMessageId: input.panelMessageId ?? null, recruitedAvatar: null, recruitedDiscordId: null, recruitedDisplayName: null,
    recruitedUsername: null, recruiterAvatar: input.recruiter.avatar, recruiterDiscordId: input.recruiter.discordId, recruiterDisplayName: input.recruiter.displayName,
    recruiterPoliceId: input.recruiter.policeId ?? null, recruiterUsername: input.recruiter.username, reportId: null, status: "IN_PROGRESS", updatedAt: now
  };
  try {
    await policeRecruitmentSessions.insertOne(session);
  } catch (error: any) {
    if (error?.code === 11000) {
      const duplicate = await policeRecruitmentSessions.findOne({ openKey });
      if (duplicate) return sessionDto(duplicate);
    }
    throw error;
  }
  await audit(input.botId, input.guildId, session._id, null, input.recruiter.discordId, "session_started", {});
  return sessionDto(session);
}

export async function setPoliceRecruitmentSessionChannel(botId: string, sessionId: string, channelId: string, panelMessageId: string) {
  const { policeRecruitmentSessions } = await getMongoCollections();
  await policeRecruitmentSessions.updateOne({ _id: sessionId, botId }, { $set: { channelId, panelMessageId, updatedAt: new Date() } });
  return requireSession(botId, sessionId);
}

export async function selectPoliceRecruitmentUser(botId: string, sessionId: string, actorId: string, recruited: RecruitedInput) {
  const session = await rawSession(botId, sessionId);
  if (session.recruiterDiscordId !== actorId) throw serviceError("Somente o recrutador pode alterar este relatório.", 403);
  const { policeRecruitmentSessions } = await getMongoCollections();
  await policeRecruitmentSessions.updateOne({ _id: sessionId, botId, status: "IN_PROGRESS" }, { $set: { recruitedAvatar: recruited.avatar, recruitedDiscordId: recruited.discordId, recruitedDisplayName: recruited.displayName, recruitedUsername: recruited.username, updatedAt: new Date() } });
  await audit(botId, session.guildId, sessionId, null, actorId, "recruited_selected", { recruitedDiscordId: recruited.discordId });
  return requireSession(botId, sessionId);
}

export async function savePoliceRecruitmentAnswer(botId: string, sessionId: string, actorId: string, questionId: string, value: string | string[] | boolean | number | null, move: "stay" | "next" | "previous" = "next") {
  const session = await rawSession(botId, sessionId);
  if (session.recruiterDiscordId !== actorId) throw serviceError("Somente o recrutador pode responder este relatório.", 403);
  if (session.status !== "IN_PROGRESS") throw serviceError("Este relatório não está em preenchimento.", 409);
  const questions = await listPoliceRecruitmentQuestions(botId, session.guildId);
  const question = questions.find((item) => item.id === questionId);
  if (!question) throw serviceError("Pergunta não encontrada.", 404);
  const answer: MongoPoliceRecruitmentAnswer = { questionId, title: question.title, type: question.type, value: normalizeAnswer(question.type, value) };
  const answers = [...session.answers.filter((item) => item.questionId !== questionId), answer].sort((a, b) => questions.findIndex((q) => q.id === a.questionId) - questions.findIndex((q) => q.id === b.questionId));
  const index = Math.max(0, questions.findIndex((item) => item.id === questionId));
  const nextIndex = move === "previous" ? Math.max(0, index - 1) : move === "next" ? Math.min(questions.length, index + 1) : index;
  const { policeRecruitmentSessions } = await getMongoCollections();
  await policeRecruitmentSessions.updateOne({ _id: sessionId, botId, status: "IN_PROGRESS" }, { $set: { answers, currentQuestion: nextIndex, updatedAt: new Date() } });
  await audit(botId, session.guildId, sessionId, null, actorId, "answer_saved", { questionId });
  return requireSession(botId, sessionId);
}

export async function movePoliceRecruitmentQuestion(botId: string, sessionId: string, actorId: string, direction: "next" | "previous") {
  const session = await rawSession(botId, sessionId);
  if (session.recruiterDiscordId !== actorId) throw serviceError("Somente o recrutador pode navegar neste relatório.", 403);
  const questions = await listPoliceRecruitmentQuestions(botId, session.guildId);
  const currentQuestion = direction === "previous" ? Math.max(0, session.currentQuestion - 1) : Math.min(questions.length, session.currentQuestion + 1);
  const { policeRecruitmentSessions } = await getMongoCollections();
  await policeRecruitmentSessions.updateOne({ _id: sessionId, botId, status: "IN_PROGRESS" }, { $set: { currentQuestion, updatedAt: new Date() } });
  return requireSession(botId, sessionId);
}

export async function finishPoliceRecruitmentSession(botId: string, sessionId: string, actorId: string, publish?: { forumThreadId?: string | null; forumMessageId?: string | null } | null) {
  const { policeRecruitmentReports, policeRecruitmentSessions, policeRecruiters } = await getMongoCollections();
  const session = await rawSession(botId, sessionId);
  if (session.recruiterDiscordId !== actorId) throw serviceError("Somente o recrutador pode finalizar este relatório.", 403);
  const settings = await getPoliceRecruitmentSettings(botId, session.guildId);
  if (!settings.enabled) throw serviceError("Relatórios Policiais não está liberado.", 403);
  if (session.status === "COMPLETED" && session.reportId) return getPoliceRecruitmentReport(botId, session.reportId);
  const claimed = await policeRecruitmentSessions.findOneAndUpdate({ _id: sessionId, botId, status: "IN_PROGRESS" }, { $set: { status: "PROCESSING", updatedAt: new Date() } }, { returnDocument: "after" });
  if (!claimed) throw serviceError("Este relatório já está sendo processado ou foi encerrado.", 409);
  const reportCode = await nextReportCode(botId, session.guildId);
  const now = new Date();
  const theoreticalScore = numericAnswer(session.answers, /te[oó]rica/i);
  const practicalScore = numericAnswer(session.answers, /pr[aá]tica/i);
  const result = resultAnswer(session.answers);
  const observations = stringAnswer(session.answers, /observa/i);
  const report = {
    _id: randomUUID(), answers: session.answers, botId, createdAt: now, deleted: false, deletedAt: null, deletedBy: null, editedAt: null, editedBy: null,
    forumMessageId: publish?.forumMessageId ?? null, forumThreadId: publish?.forumThreadId ?? null, guildId: session.guildId, previousValues: [],
    practicalScore, recruitedDiscordId: session.recruitedDiscordId, recruitedName: session.recruitedDisplayName, recruitedPoliceId: stringAnswer(session.answers, /^ID do personagem$/i),
    recruiterDiscordId: session.recruiterDiscordId, recruiterName: session.recruiterDisplayName, recruiterPoliceId: session.recruiterPoliceId, reportCode,
    result, sessionId, theoreticalScore, updatedAt: now, observations
  };
  await policeRecruitmentReports.insertOne(report);
  await policeRecruitmentSessions.updateOne({ _id: sessionId, botId }, { $set: { status: "COMPLETED", reportId: report._id, completedAt: now, updatedAt: now }, $unset: { openKey: "" } });
  const statPatch = statIncrement(result);
  const recruiterKey = { botId, guildId: session.guildId, discordId: session.recruiterDiscordId };
  await policeRecruiters.updateOne(recruiterKey, {
    $set: { active: true, avatar: session.recruiterAvatar, displayName: session.recruiterDisplayName, forumThreadId: publish?.forumThreadId ?? null, lastRecruitment: now, policeId: session.recruiterPoliceId, updatedAt: now, username: session.recruiterUsername },
    $setOnInsert: { _id: randomUUID(), approvalRate: 0, botId, createdAt: now, discordId: session.recruiterDiscordId, guildId: session.guildId, roleName: null, totalRecruitments: 0, approved: 0, rejected: 0, pending: 0 },
    $inc: { totalRecruitments: 1, ...statPatch }
  }, { upsert: true });
  await refreshRecruiterApprovalRate(botId, session.guildId, session.recruiterDiscordId);
  await audit(botId, session.guildId, sessionId, report._id, actorId, "report_completed", { reportCode });
  return getPoliceRecruitmentReport(botId, report._id);
}

export async function updatePoliceRecruitmentReportPublication(botId: string, reportId: string, forumThreadId: string, forumMessageId: string | null) {
  const { policeRecruitmentReports, policeRecruiters } = await getMongoCollections();
  const report = await rawReport(botId, reportId);
  await policeRecruitmentReports.updateOne({ _id: reportId, botId }, { $set: { forumThreadId, forumMessageId, updatedAt: new Date() } });
  await policeRecruiters.updateOne({ botId, guildId: report.guildId, discordId: report.recruiterDiscordId }, { $set: { forumThreadId, updatedAt: new Date() } });
  return getPoliceRecruitmentReport(botId, reportId);
}

export async function cancelPoliceRecruitmentSession(botId: string, sessionId: string, actorId: string, status: "CANCELLED" | "EXPIRED" = "CANCELLED") {
  const session = await rawSession(botId, sessionId);
  if (status === "CANCELLED" && session.recruiterDiscordId !== actorId) throw serviceError("Somente o recrutador pode cancelar este relatório.", 403);
  const { policeRecruitmentSessions } = await getMongoCollections();
  const now = new Date();
  await policeRecruitmentSessions.updateOne({ _id: sessionId, botId, status: "IN_PROGRESS" }, { $set: { status, cancelledAt: now, updatedAt: now }, $unset: { openKey: "" } });
  await audit(botId, session.guildId, sessionId, null, actorId, status === "EXPIRED" ? "session_expired" : "session_cancelled", {});
  return requireSession(botId, sessionId);
}

export async function getPoliceRecruitmentSession(botId: string, sessionId: string) {
  return requireSession(botId, sessionId);
}

export async function getPoliceRecruitmentSessionByChannel(botId: string, channelId: string) {
  const { policeRecruitmentSessions } = await getMongoCollections();
  const session = await policeRecruitmentSessions.findOne({ botId, channelId, status: { $in: ["IN_PROGRESS", "PROCESSING"] } });
  return session ? sessionDto(session) : null;
}

export async function listPoliceRecruitmentExpiredSessions(botId: string) {
  const { policeRecruitmentSessions } = await getMongoCollections();
  return (await policeRecruitmentSessions.find({ botId, status: "IN_PROGRESS", expiresAt: { $lte: new Date() } }).limit(100).toArray()).map(sessionDto);
}

export async function listPoliceRecruitmentReports(botId: string, guildId: string, filters: { query?: string | null; recruiterDiscordId?: string | null; recruitedDiscordId?: string | null } = {}) {
  const query = { botId, guildId, deleted: false, ...(filters.recruiterDiscordId ? { recruiterDiscordId: filters.recruiterDiscordId } : {}), ...(filters.recruitedDiscordId ? { recruitedDiscordId: filters.recruitedDiscordId } : {}) } as Record<string, unknown>;
  if (filters.query) {
    const pattern = new RegExp(escapeRegExp(filters.query), "i");
    query.$or = [{ reportCode: pattern }, { recruitedName: pattern }, { recruiterName: pattern }, { recruitedPoliceId: pattern }, { recruiterPoliceId: pattern }];
  }
  const { policeRecruitmentReports } = await getMongoCollections();
  return (await policeRecruitmentReports.find(query).sort({ createdAt: -1 }).limit(500).toArray()).map(reportDto);
}

export async function getPoliceRecruitmentReport(botId: string, reportId: string) {
  return reportDto(await rawReport(botId, reportId));
}

export async function getPoliceRecruitmentRecruiter(botId: string, guildId: string, discordId: string) {
  const { policeRecruiters } = await getMongoCollections();
  const recruiter = await policeRecruiters.findOne({ botId, guildId, discordId });
  return recruiter ? recruiterDto(recruiter) : null;
}

async function ensureDefaultQuestions(botId: string, guildId: string) {
  const { policeRecruitmentQuestions } = await getMongoCollections();
  if (await policeRecruitmentQuestions.findOne({ botId, guildId })) return;
  const now = new Date();
  const baseQuestions = POLICE_RECRUITMENT_DEFAULT_QUESTIONS;
  const defaults: MongoPoliceRecruitmentQuestion[] = baseQuestions.map((question, index) => ({ _id: randomUUID(), botId, guildId, ...question, order: index + 1, enabled: true, createdAt: now, updatedAt: now, updatedBy: null }));
  await policeRecruitmentQuestions.insertMany(defaults);
}

async function nextReportCode(botId: string, guildId: string) {
  const { policeRecruitmentCounters } = await getMongoCollections();
  const counter = await policeRecruitmentCounters.findOneAndUpdate({ botId, guildId }, { $inc: { seq: 1 }, $set: { updatedAt: new Date() }, $setOnInsert: { _id: randomUUID(), botId, guildId } }, { upsert: true, returnDocument: "after" });
  return `REC-${String(counter?.seq ?? 1).padStart(6, "0")}`;
}

async function rawSession(botId: string, sessionId: string) {
  const { policeRecruitmentSessions } = await getMongoCollections();
  const session = await policeRecruitmentSessions.findOne({ _id: sessionId, botId });
  if (!session) throw serviceError("Sessão de recrutamento não encontrada.", 404);
  return session;
}

async function requireSession(botId: string, sessionId: string) {
  return sessionDto(await rawSession(botId, sessionId));
}

async function rawReport(botId: string, reportId: string) {
  const { policeRecruitmentReports } = await getMongoCollections();
  const report = await policeRecruitmentReports.findOne({ _id: reportId, botId });
  if (!report) throw serviceError("Relatório não encontrado.", 404);
  return report;
}

async function refreshRecruiterApprovalRate(botId: string, guildId: string, discordId: string) {
  const { policeRecruiters } = await getMongoCollections();
  const recruiter = await policeRecruiters.findOne({ botId, guildId, discordId });
  if (!recruiter) return;
  const approvalRate = recruiter.totalRecruitments ? Number(((recruiter.approved / recruiter.totalRecruitments) * 100).toFixed(2)) : 0;
  await policeRecruiters.updateOne({ _id: recruiter._id }, { $set: { approvalRate } });
}

async function audit(botId: string, guildId: string, sessionId: string | null, reportId: string | null, actorId: string | null, action: string, metadata: Record<string, unknown>) {
  const { policeRecruitmentAudits } = await getMongoCollections();
  await policeRecruitmentAudits.insertOne({ _id: randomUUID(), action, actorId, botId, createdAt: new Date(), guildId, metadata, reportId, sessionId });
}

export function normalizeAnswer(type: string, value: unknown) {
  if (type === "NUMBER") {
    const parsed = Number(String(value).replace(",", "."));
    if (!Number.isFinite(parsed)) throw serviceError("Informe um número válido.", 400);
    return parsed;
  }
  if (type === "BOOLEAN") return value === true || String(value).toLowerCase() === "sim" || String(value).toLowerCase() === "true";
  if (type === "DATE") return normalizeDateAnswer(value);
  if (type === "TIME") return normalizeTimeAnswer(value);
  if (Array.isArray(value)) return value.map(String);
  return value === null || value === undefined ? null : String(value).trim().slice(0, 1800);
}

/**
 * Aceita o que o recrutador digita no Discord (não há seletor de data nativo):
 * dd/mm/aaaa, dd-mm-aaaa ou aaaa-mm-dd. Guarda sempre em dd/mm/aaaa.
 */
export function normalizeDateAnswer(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const brMatch = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);

  const [day, month, year] = isoMatch
    ? [Number(isoMatch[3]), Number(isoMatch[2]), Number(isoMatch[1])]
    : brMatch
      ? [Number(brMatch[1]), Number(brMatch[2]), Number(brMatch[3]!.length === 2 ? `20${brMatch[3]}` : brMatch[3])]
      : [Number.NaN, Number.NaN, Number.NaN];

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    throw serviceError("Informe a data no formato dd/mm/aaaa.", 400);
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) {
    throw serviceError("Data inexistente. Confira dia e mês.", 400);
  }

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** Aceita HH:MM ou HH:MM:SS (com `:` ou `h`) e guarda em HH:MM. */
export function normalizeTimeAnswer(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const match = /^(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*[:m]\s*\d{2})?$/i.exec(text);
  if (!match) throw serviceError("Informe o horário no formato HH:MM.", 400);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw serviceError("Horário inválido. Use de 00:00 até 23:59.", 400);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function daysInMonth(month: number, year: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function numericAnswer(answers: MongoPoliceRecruitmentAnswer[], pattern: RegExp) {
  const value = answers.find((item) => pattern.test(item.title))?.value;
  return typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : null;
}

function stringAnswer(answers: MongoPoliceRecruitmentAnswer[], pattern: RegExp) {
  const value = answers.find((item) => pattern.test(item.title))?.value;
  return typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? null : String(value);
}

function resultAnswer(answers: MongoPoliceRecruitmentAnswer[]): MongoPoliceRecruitmentResult {
  const value = stringAnswer(answers, /resultado/i)?.toLowerCase() ?? "";
  if (value.includes("reprov")) return "REJECTED";
  if (value.includes("pend")) return "PENDING";
  return "APPROVED";
}

function statIncrement(result: MongoPoliceRecruitmentResult) {
  return result === "APPROVED" ? { approved: 1 } : result === "REJECTED" ? { rejected: 1 } : { pending: 1 };
}

function normalizeSettingsInput(input: SettingsInput) {
  const next: any = { ...input };
  if ("reportsForumChannelId" in next) next.forumChannelId = next.reportsForumChannelId;
  if ("forumChannelId" in next) next.reportsForumChannelId = next.forumChannelId;
  if ("sessionExpirationMinutes" in next) next.sessionExpirationHours = Math.max(1, Math.ceil(Number(next.sessionExpirationMinutes) / 60));
  if ("sessionExpirationHours" in next) next.sessionExpirationMinutes = Math.max(1, Number(next.sessionExpirationHours) * 60);
  if ("recruiterRoleIds" in next) next.authorizedRoleIds = next.recruiterRoleIds;
  if ("authorizedRoleIds" in next) next.recruiterRoleIds = next.authorizedRoleIds;
  if ("createReportRoleIds" in next) next.authorizedRoleIds = next.createReportRoleIds;
  if ("viewerRoleIds" in next) next.viewAllReportsRoleIds = next.viewerRoleIds;
  if ("viewAllReportsRoleIds" in next) next.viewerRoleIds = next.viewAllReportsRoleIds;
  if ("editorRoleIds" in next) next.editReportRoleIds = next.editorRoleIds;
  if ("editReportRoleIds" in next) next.editorRoleIds = next.editReportRoleIds;
  if ("deleteRoleIds" in next) next.deleteReportRoleIds = next.deleteRoleIds;
  if ("deleteReportRoleIds" in next) next.deleteRoleIds = next.deleteReportRoleIds;
  return next;
}
function sessionExpirationMinutes(settings: any) { return Number(settings.sessionExpirationMinutes ?? ((settings.sessionExpirationHours ?? 12) * 60)); }
function roleList(...lists: Array<unknown>) { return [...new Set(lists.flatMap((list) => Array.isArray(list) ? list : []).filter((id): id is string => typeof id === "string" && /^\d{5,32}$/.test(id)))]; }
function policeReportsStatus(settings: any, ready: boolean) { if (!settings.enabled) return "not_released"; if (!settings.configured || !ready) return "configuration_required"; return "operational"; }
function check(id: string, label: string, ok: boolean) { return { id, label, ok }; }
function cleanString(value: unknown, max: number) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
function sanitizeOptions(values: unknown) { return Array.isArray(values) ? [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 25))] : []; }
function normalizeQuestionType(value: unknown): MongoPoliceRecruitmentQuestionType { return ["TEXT", "LONG_TEXT", "NUMBER", "USER_SELECT", "ROLE_SELECT", "SELECT", "BOOLEAN"].includes(String(value)) ? value as MongoPoliceRecruitmentQuestionType : "TEXT"; }
function diffSettings(before: any, patch: Record<string, unknown>) { return { changedKeys: Object.keys(patch), previousValue: Object.fromEntries(Object.keys(patch).map((key) => [key, before[key]])), newValue: patch }; }
function settingsDto(value: any) {
  const reportsForumChannelId = value.reportsForumChannelId ?? value.forumChannelId ?? null;
  const sessionExpirationMinutesValue = value.sessionExpirationMinutes ?? (value.sessionExpirationHours ?? 12) * 60;
  return {
    ...value,
    id: value._id,
    configured: value.configured === true,
    createReportRoleIds: roleList(value.createReportRoleIds, value.recruiterRoleIds, value.authorizedRoleIds),
    editReportRoleIds: roleList(value.editReportRoleIds, value.editorRoleIds),
    deleteReportRoleIds: roleList(value.deleteReportRoleIds, value.deleteRoleIds),
    forumChannelId: reportsForumChannelId,
    manageConfigurationRoleIds: roleList(value.manageConfigurationRoleIds, value.adminRoleIds),
    manageQuestionsRoleIds: roleList(value.manageQuestionsRoleIds, value.adminRoleIds),
    recruiterRoleIds: roleList(value.recruiterRoleIds, value.authorizedRoleIds, value.createReportRoleIds),
    reportsForumChannelId,
    sessionExpirationMinutes: sessionExpirationMinutesValue,
    viewAllReportsRoleIds: roleList(value.viewAllReportsRoleIds, value.viewerRoleIds),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    enabledAt: value.enabledAt?.toISOString?.() ?? null,
    disabledAt: value.disabledAt?.toISOString?.() ?? null
  };
}
function questionDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function sessionDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), expiresAt: value.expiresAt.toISOString(), completedAt: value.completedAt?.toISOString() ?? null, cancelledAt: value.cancelledAt?.toISOString() ?? null }; }
function reportDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), deletedAt: value.deletedAt?.toISOString() ?? null, editedAt: value.editedAt?.toISOString() ?? null }; }
function recruiterDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), lastRecruitment: value.lastRecruitment?.toISOString() ?? null }; }
function auditDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString() }; }
function serviceError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
