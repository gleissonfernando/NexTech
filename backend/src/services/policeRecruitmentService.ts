import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoPoliceRecruitmentQuestion, type MongoPoliceRecruitmentSettings, type MongoPoliceRecruitmentSession, type MongoPoliceRecruitmentAnswer, type MongoPoliceRecruitmentResult } from "../database/mongo";

export const POLICE_RECRUITMENT_MODULE_ID = "police-recruitment";

type SettingsInput = Partial<Pick<MongoPoliceRecruitmentSettings, "enabled" | "corporationName" | "authorizedRoleIds" | "adminRoleIds" | "viewerRoleIds" | "deleteRoleIds" | "editorRoleIds" | "supervisorRoleIds" | "forumChannelId" | "temporaryCategoryId" | "logChannelId" | "sessionExpirationHours" | "deleteDelaySeconds" | "panelChannelId" | "panelMessageId" | "panelColor">>;
type RecruiterInput = { avatar: string | null; displayName: string; discordId: string; policeId?: string | null; username: string };
type RecruitedInput = { avatar: string | null; discordId: string; displayName: string; username: string };

export async function getPoliceRecruitmentSettings(botId: string, guildId: string) {
  const { policeRecruitmentSettings } = await getMongoCollections();
  const found = await policeRecruitmentSettings.findOne({ botId, guildId });
  if (found) return settingsDto(found);
  const now = new Date();
  const settings: MongoPoliceRecruitmentSettings = {
    _id: randomUUID(), adminRoleIds: [], authorizedRoleIds: [], botId, corporationName: "Corporação Policial", createdAt: now,
    deleteDelaySeconds: 8, deleteRoleIds: [], editorRoleIds: [], enabled: false, forumChannelId: null, guildId, logChannelId: null,
    panelChannelId: null, panelColor: "#22c55e", panelMessageId: null, sessionExpirationHours: 12, supervisorRoleIds: [],
    temporaryCategoryId: null, updatedAt: now, updatedBy: null, viewerRoleIds: []
  };
  await policeRecruitmentSettings.updateOne({ botId, guildId }, { $setOnInsert: settings }, { upsert: true });
  await ensureDefaultQuestions(botId, guildId);
  return settingsDto((await policeRecruitmentSettings.findOne({ botId, guildId })) ?? settings);
}

export async function savePoliceRecruitmentSettings(botId: string, guildId: string, input: SettingsInput, actorId: string | null) {
  await getPoliceRecruitmentSettings(botId, guildId);
  const { policeRecruitmentSettings } = await getMongoCollections();
  await policeRecruitmentSettings.updateOne({ botId, guildId }, { $set: { ...input, updatedAt: new Date(), updatedBy: actorId } });
  return settingsDto((await policeRecruitmentSettings.findOne({ botId, guildId }))!);
}

export async function listPoliceRecruitmentQuestions(botId: string, guildId: string) {
  await ensureDefaultQuestions(botId, guildId);
  const { policeRecruitmentQuestions } = await getMongoCollections();
  return (await policeRecruitmentQuestions.find({ botId, guildId, enabled: true }).sort({ order: 1 }).toArray()).map(questionDto);
}

export async function createPoliceRecruitmentSession(input: { botId: string; guildId: string; recruiter: RecruiterInput; channelId?: string | null; panelMessageId?: string | null }) {
  const settings = await getPoliceRecruitmentSettings(input.botId, input.guildId);
  const { policeRecruitmentSessions } = await getMongoCollections();
  const openKey = `${input.botId}:${input.guildId}:${input.recruiter.discordId}`;
  const existing = await policeRecruitmentSessions.findOne({ openKey });
  if (existing) return sessionDto(existing);
  const now = new Date();
  const session: MongoPoliceRecruitmentSession = {
    _id: randomUUID(), answers: [], botId: input.botId, cancelledAt: null, channelId: input.channelId ?? null, completedAt: null,
    createdAt: now, currentQuestion: 0, expiresAt: new Date(now.getTime() + settings.sessionExpirationHours * 3_600_000), guildId: input.guildId,
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
    $set: { avatar: session.recruiterAvatar, displayName: session.recruiterDisplayName, forumThreadId: publish?.forumThreadId ?? null, lastRecruitment: now, policeId: session.recruiterPoliceId, updatedAt: now, username: session.recruiterUsername },
    $setOnInsert: { _id: randomUUID(), approvalRate: 0, botId, createdAt: now, discordId: session.recruiterDiscordId, guildId: session.guildId, totalRecruitments: 0, approved: 0, rejected: 0, pending: 0 },
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
  const baseQuestions: Array<Pick<MongoPoliceRecruitmentQuestion, "title" | "description" | "type" | "required" | "options">> = [
    { title: "Nome do personagem.", description: "Informe nome e sobrenome do personagem.", type: "TEXT", required: true, options: [] },
    { title: "ID do personagem.", description: "ID policial/RP do recrutado.", type: "TEXT", required: true, options: [] },
    { title: "Discord do recrutado.", description: "Confirme o Discord do recrutado.", type: "TEXT", required: true, options: [] },
    { title: "Idade do personagem.", description: null, type: "NUMBER", required: true, options: [] },
    { title: "Experiência anterior na polícia.", description: null, type: "LONG_TEXT", required: false, options: [] },
    { title: "Nota da prova teórica.", description: "Use 0 a 10.", type: "NUMBER", required: true, options: [] },
    { title: "Nota da prova prática.", description: "Use 0 a 10.", type: "NUMBER", required: true, options: [] },
    { title: "Comportamento durante o recrutamento.", description: null, type: "LONG_TEXT", required: true, options: [] },
    { title: "Conhecimento dos códigos da corporação.", description: null, type: "LONG_TEXT", required: true, options: [] },
    { title: "Conhecimento sobre procedimentos policiais.", description: null, type: "LONG_TEXT", required: true, options: [] },
    { title: "Comunicação.", description: null, type: "TEXT", required: true, options: [] },
    { title: "Disciplina.", description: null, type: "TEXT", required: true, options: [] },
    { title: "Trabalho em equipe.", description: null, type: "TEXT", required: true, options: [] },
    { title: "Houve alguma advertência durante o recrutamento?", description: null, type: "BOOLEAN", required: true, options: ["Sim", "Não"] },
    { title: "Observações gerais.", description: null, type: "LONG_TEXT", required: false, options: [] },
    { title: "Resultado final.", description: null, type: "SELECT", required: true, options: ["Aprovado", "Reprovado", "Pendente"] }
  ];
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

function normalizeAnswer(type: string, value: unknown) {
  if (type === "NUMBER") {
    const parsed = Number(String(value).replace(",", "."));
    if (!Number.isFinite(parsed)) throw serviceError("Informe um número válido.", 400);
    return parsed;
  }
  if (type === "BOOLEAN") return value === true || String(value).toLowerCase() === "sim" || String(value).toLowerCase() === "true";
  if (Array.isArray(value)) return value.map(String);
  return value === null || value === undefined ? null : String(value).trim().slice(0, 1800);
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

function settingsDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function questionDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
function sessionDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), expiresAt: value.expiresAt.toISOString(), completedAt: value.completedAt?.toISOString() ?? null, cancelledAt: value.cancelledAt?.toISOString() ?? null }; }
function reportDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), deletedAt: value.deletedAt?.toISOString() ?? null, editedAt: value.editedAt?.toISOString() ?? null }; }
function recruiterDto(value: any) { return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), lastRecruitment: value.lastRecruitment?.toISOString() ?? null }; }
function serviceError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
