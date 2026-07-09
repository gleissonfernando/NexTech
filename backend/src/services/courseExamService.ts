import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoCourseExamAnswer, type MongoCourseExamAttempt, type MongoCourseExamQuestion, type MongoCourseExamSettings } from "../database/mongo";
import { logCourseAction } from "./courseService";

const DEFAULT_INITIAL = "Bem-vindo à prova do curso. Leia cada pergunta com atenção e responda uma etapa por vez.";
const DEFAULT_FINAL = "Sua prova foi concluída. Clique abaixo para finalizar.";
const DEFAULT_APPROVAL = "Você foi aprovado na prova do curso.";
const DEFAULT_REJECTION = "Você foi reprovado na prova do curso.";

export type CourseExamSettingsDto = ReturnType<typeof mapSettings>;
export type CourseExamQuestionDto = ReturnType<typeof mapQuestion>;
export type CourseExamAttemptDto = ReturnType<typeof mapAttempt>;
export type CourseExamAnswerDto = ReturnType<typeof mapAnswer>;

export async function getCourseExamDashboard(botId: string | null, guildId: string, courseId: string) {
  const collections = await getMongoCollections();
  const [settings, questions, attempts] = await Promise.all([
    getCourseExamSettings(botId, guildId, courseId),
    collections.courseExamQuestions.find({ ...scope(botId, guildId), courseId }).sort({ order: 1, createdAt: 1 }).toArray(),
    collections.courseExamAttempts.find({ ...scope(botId, guildId), courseId }).sort({ startedAt: -1 }).limit(50).toArray()
  ]);
  return { attempts: attempts.map(mapAttempt), questions: questions.map(mapQuestion), settings };
}

export async function getCourseExamRuntime(botId: string | null, guildId: string, courseId: string) {
  const collections = await getMongoCollections();
  const [settings, questions] = await Promise.all([
    getCourseExamSettings(botId, guildId, courseId),
    collections.courseExamQuestions.find({ ...scope(botId, guildId), courseId, active: true }).sort({ order: 1, createdAt: 1 }).toArray()
  ]);
  return { questions: questions.map(mapQuestion), settings };
}

export async function getCourseExamSettings(botId: string | null, guildId: string, courseId: string) {
  const { courseExamSettings } = await getMongoCollections();
  const existing = await courseExamSettings.findOne({ ...scope(botId, guildId), courseId });
  if (existing) return mapSettings(existing);
  const now = new Date();
  const doc: MongoCourseExamSettings = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId,
    enabled: false,
    minScore: 7,
    maxTimeMinutes: null,
    correctionChannelId: null,
    logChannelId: null,
    deleteWrittenAnswers: false,
    allowCurrentQuestionReview: true,
    initialMessage: DEFAULT_INITIAL,
    finalMessage: DEFAULT_FINAL,
    approvalMessage: DEFAULT_APPROVAL,
    rejectionMessage: DEFAULT_REJECTION,
    manualQuestionMaxScore: 10,
    manualApproval: true,
    automaticApproval: false,
    updatedAt: now,
    updatedBy: null
  };
  await courseExamSettings.insertOne(doc);
  return mapSettings(doc);
}

export async function saveCourseExamSettings(botId: string | null, guildId: string, courseId: string, input: Partial<Omit<CourseExamSettingsDto, "id" | "botId" | "guildId" | "courseId" | "updatedAt">>, actorId: string | null) {
  const { courseExamSettings } = await getMongoCollections();
  const now = new Date();
  await courseExamSettings.updateOne({ ...scope(botId, guildId), courseId }, {
    $set: { ...cleanSettings(input), updatedAt: now, updatedBy: actorId },
    $setOnInsert: { _id: randomUUID(), botId, guildId, courseId }
  }, { upsert: true });
  await logCourseAction(botId, guildId, "course.exam_settings_saved", actorId, courseId, null, input);
  return getCourseExamSettings(botId, guildId, courseId);
}

export async function createCourseExamQuestion(botId: string | null, guildId: string, courseId: string, input: any, actorId: string | null) {
  const { courseExamQuestions } = await getMongoCollections();
  const total = await courseExamQuestions.countDocuments({ ...scope(botId, guildId), courseId });
  const now = new Date();
  const doc: MongoCourseExamQuestion = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId,
    order: Number.isFinite(input.order) ? Number(input.order) : total,
    questionNumber: Number.isFinite(input.questionNumber) ? Number(input.questionNumber) : total + 1,
    type: input.type === "written" ? "written" : "selection",
    prompt: input.prompt?.trim() || "Nova pergunta",
    title: input.title?.trim() || input.prompt?.trim() || "Nova pergunta",
    description: input.description?.trim() || null,
    points: Math.max(0, Number(input.points) || 1),
    alternatives: normalizeAlternatives(input.alternatives, input.type === "written" ? "written" : "selection"),
    correctAlternativeId: input.type === "written" ? null : normalizeCorrect(input.correctAlternativeId),
    placeholder: input.placeholder?.trim() || null,
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
    updatedBy: actorId
  };
  await courseExamQuestions.insertOne(doc);
  await logCourseAction(botId, guildId, "course.exam_question_created", actorId, courseId, null, { questionId: doc._id });
  return mapQuestion(doc);
}

export async function updateCourseExamQuestion(botId: string | null, guildId: string, courseId: string, questionId: string, input: any, actorId: string | null) {
  const patch: Partial<MongoCourseExamQuestion> = {};
  if (input.order !== undefined) patch.order = Number(input.order) || 0;
  if (input.questionNumber !== undefined) patch.questionNumber = Math.max(1, Math.min(9, Number(input.questionNumber) || 1));
  if (input.type !== undefined) patch.type = input.type === "written" ? "written" : "selection";
  if (input.prompt !== undefined) patch.prompt = input.prompt.trim() || "Pergunta";
  if (input.title !== undefined) patch.title = input.title?.trim() || input.prompt?.trim() || "Pergunta";
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.points !== undefined) patch.points = Math.max(0, Number(input.points) || 0);
  if (input.alternatives !== undefined) patch.alternatives = normalizeAlternatives(input.alternatives, patch.type ?? input.type ?? "selection");
  if (input.correctAlternativeId !== undefined) patch.correctAlternativeId = patch.type === "written" || input.type === "written" ? null : normalizeCorrect(input.correctAlternativeId);
  if (input.placeholder !== undefined) patch.placeholder = input.placeholder?.trim() || null;
  if (input.active !== undefined) patch.active = input.active !== false;
  patch.updatedAt = new Date();
  patch.updatedBy = actorId;
  const { courseExamQuestions } = await getMongoCollections();
  await courseExamQuestions.updateOne({ _id: questionId, ...scope(botId, guildId), courseId }, { $set: patch });
  const question = await courseExamQuestions.findOne({ _id: questionId, ...scope(botId, guildId), courseId });
  if (!question) return null;
  await logCourseAction(botId, guildId, "course.exam_question_updated", actorId, courseId, null, { questionId });
  return mapQuestion(question);
}

export async function deleteCourseExamQuestion(botId: string | null, guildId: string, courseId: string, questionId: string, actorId: string | null) {
  const { courseExamQuestions } = await getMongoCollections();
  const deleted = await courseExamQuestions.findOneAndDelete({ _id: questionId, ...scope(botId, guildId), courseId });
  if (!deleted) return null;
  await logCourseAction(botId, guildId, "course.exam_question_deleted", actorId, courseId, null, { questionId });
  return mapQuestion(deleted);
}

export async function duplicateCourseExamQuestion(botId: string | null, guildId: string, courseId: string, questionId: string, actorId: string | null) {
  const { courseExamQuestions } = await getMongoCollections();
  const question = await courseExamQuestions.findOne({ _id: questionId, ...scope(botId, guildId), courseId });
  if (!question) return null;
  return createCourseExamQuestion(botId, guildId, courseId, { ...mapQuestion(question), prompt: `${question.prompt} (copia)`, order: question.order + 1 }, actorId);
}

export async function reorderCourseExamQuestions(botId: string | null, guildId: string, courseId: string, questionIds: string[], actorId: string | null) {
  const { courseExamQuestions } = await getMongoCollections();
  await Promise.all(questionIds.map((questionId, order) => courseExamQuestions.updateOne({ _id: questionId, ...scope(botId, guildId), courseId }, { $set: { order, updatedAt: new Date(), updatedBy: actorId } })));
  await logCourseAction(botId, guildId, "course.exam_questions_reordered", actorId, courseId, null, { questionIds });
  const questions = await courseExamQuestions.find({ ...scope(botId, guildId), courseId }).sort({ order: 1, createdAt: 1 }).toArray();
  return questions.map(mapQuestion);
}

export async function createOrResumeCourseExamAttempt(botId: string | null, guildId: string, input: { channelId: string; courseId: string; instructorId: string; publicationId: string; studentId: string }) {
  const collections = await getMongoCollections();
  const existing = await collections.courseExamAttempts.findOne({ ...scope(botId, guildId), channelId: input.channelId, status: "in_progress", studentId: input.studentId });
  if (existing) return mapAttempt(existing);
  const now = new Date();
  const doc: MongoCourseExamAttempt = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    publicationId: input.publicationId,
    channelId: input.channelId,
    studentId: input.studentId,
    instructorId: input.instructorId,
    status: "in_progress",
    startedAt: now,
    finishedAt: null,
    correctedAt: null,
    correctedBy: null,
    currentQuestionIndex: 0,
    objectiveCorrect: 0,
    objectiveWrong: 0,
    writtenCount: 0,
    score: 0,
    maxScore: 0,
    percent: 0,
    correctionMessageId: null,
    rejectionReason: null,
    updatedAt: now
  };
  await collections.courseExamAttempts.insertOne(doc);
  await logCourseAction(botId, guildId, "course.exam_started", input.studentId, input.courseId, input.publicationId, { attemptId: doc._id });
  return mapAttempt(doc);
}

export async function getCourseExamAttemptByChannel(botId: string | null, guildId: string, channelId: string) {
  const { courseExamAttempts } = await getMongoCollections();
  const attempt = await courseExamAttempts.findOne({ ...scope(botId, guildId), channelId, status: "in_progress" });
  return attempt ? mapAttempt(attempt) : null;
}

export async function getCourseExamAttemptBundle(botId: string | null, guildId: string, attemptId: string) {
  const collections = await getMongoCollections();
  const [attempt, answers] = await Promise.all([
    collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) }),
    collections.courseExamAnswers.find({ ...scope(botId, guildId), attemptId }).sort({ questionOrder: 1 }).toArray()
  ]);
  return attempt ? { answers: answers.map(mapAnswer), attempt: mapAttempt(attempt) } : null;
}

export async function saveCourseExamAnswer(botId: string | null, guildId: string, attemptId: string, question: CourseExamQuestionDto, input: { selectedAlternativeId?: string | null; writtenAnswer?: string | null }) {
  const collections = await getMongoCollections();
  const attempt = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" });
  if (!attempt) return null;
  const selectedAlternativeId = question.type === "selection" ? normalizeCorrect(input.selectedAlternativeId) : null;
  const selectedAlternative = question.alternatives.find((alternative) => alternative.id === selectedAlternativeId);
  const correct = question.type === "selection" ? Boolean(selectedAlternative?.isCorrect ?? selectedAlternativeId === question.correctAlternativeId) : null;
  const pointsEarned = question.type === "selection" ? Math.max(0, Number(selectedAlternative?.score ?? (correct ? question.points : 0)) || 0) : 0;
  const now = new Date();
  const doc: MongoCourseExamAnswer = {
    _id: randomUUID(),
    botId,
    guildId,
    attemptId,
    courseId: attempt.courseId,
    questionId: question.id,
    questionOrder: question.order,
    type: question.type,
    selectedAlternativeId,
    writtenAnswer: question.type === "written" ? input.writtenAnswer?.trim().slice(0, 3000) || "" : null,
    correct,
    pointsEarned,
    maxScore: question.points,
    answeredAt: now
  };
  await collections.courseExamAnswers.updateOne({ ...scope(botId, guildId), attemptId, questionId: question.id }, { $set: doc }, { upsert: true });
  await collections.courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId) }, { $set: { currentQuestionIndex: attempt.currentQuestionIndex + 1, updatedAt: now } });
  await logCourseAction(botId, guildId, "course.exam_question_answered", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, questionId: question.id });
  return mapAnswer(doc);
}

export async function finalizeCourseExamAttempt(botId: string | null, guildId: string, attemptId: string) {
  const collections = await getMongoCollections();
  const [attempt, questions, answers] = await Promise.all([
    collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) }),
    collections.courseExamQuestions.find({ ...scope(botId, guildId) }).toArray(),
    collections.courseExamAnswers.find({ ...scope(botId, guildId), attemptId }).toArray()
  ]);
  if (!attempt) return null;
  const relevantQuestions = questions.filter((question) => question.courseId === attempt.courseId && question.active);
  const maxScore = relevantQuestions.reduce((total, question) => total + question.points, 0);
  const score = answers.filter((answer) => answer.type === "selection").reduce((total, answer) => total + answer.pointsEarned, 0);
  const objectiveCorrect = answers.filter((answer) => answer.type === "selection" && answer.correct === true).length;
  const objectiveWrong = answers.filter((answer) => answer.type === "selection" && answer.correct === false).length;
  const writtenCount = answers.filter((answer) => answer.type === "written").length;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
  const now = new Date();
  await collections.courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId) }, {
    $set: { automaticScore: score, finishedAt: now, maxScore, objectiveCorrect, objectiveWrong, percent, score, status: "awaiting_review", updatedAt: now, writtenCount }
  });
  const updated = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.exam_finished", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, percent, score });
  return updated ? { answers: answers.map(mapAnswer), attempt: mapAttempt(updated), questions: relevantQuestions.map(mapQuestion) } : null;
}

export async function reviewCourseExamAttempt(botId: string | null, guildId: string, attemptId: string, reviewerId: string, status: "approved" | "rejected", rejectionReason?: string | null) {
  const { courseExamAttempts } = await getMongoCollections();
  const now = new Date();
  await courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId), status: { $in: ["finished", "awaiting_review", "manual_reviewed"] } }, {
    $set: { correctedAt: now, correctedBy: reviewerId, rejectionReason: rejectionReason || null, result: status, status, updatedAt: now }
  });
  const attempt = await courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) });
  if (!attempt) return null;
  await logCourseAction(botId, guildId, `course.exam_${status}`, reviewerId, attempt.courseId, attempt.publicationId, { attemptId });
  return mapAttempt(attempt);
}

export async function setCourseExamCorrectionMessage(botId: string | null, guildId: string, attemptId: string, messageId: string) {
  const { courseExamAttempts } = await getMongoCollections();
  await courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId) }, { $set: { correctionMessageId: messageId, updatedAt: new Date() } });
}

function mapSettings(settings: MongoCourseExamSettings) {
  return {
    id: settings._id,
    botId: settings.botId,
    guildId: settings.guildId,
    courseId: settings.courseId,
    enabled: settings.enabled,
    minScore: settings.minScore,
    maxTimeMinutes: settings.maxTimeMinutes,
    correctionChannelId: settings.correctionChannelId,
    logChannelId: settings.logChannelId,
    deleteWrittenAnswers: settings.deleteWrittenAnswers,
    allowCurrentQuestionReview: settings.allowCurrentQuestionReview,
    initialMessage: settings.initialMessage,
    finalMessage: settings.finalMessage,
    approvalMessage: settings.approvalMessage,
    rejectionMessage: settings.rejectionMessage,
    manualQuestionMaxScore: settings.manualQuestionMaxScore ?? 10,
    manualApproval: settings.manualApproval ?? true,
    automaticApproval: settings.automaticApproval ?? false,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy
  };
}

function mapQuestion(question: MongoCourseExamQuestion) {
  return {
    id: question._id,
    botId: question.botId,
    guildId: question.guildId,
    courseId: question.courseId,
    order: question.order,
    questionNumber: question.questionNumber ?? question.order + 1,
    type: question.type,
    prompt: question.prompt,
    title: question.title ?? question.prompt,
    description: question.description,
    points: question.points,
    alternatives: question.alternatives,
    correctAlternativeId: question.correctAlternativeId,
    placeholder: question.placeholder,
    active: question.active,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
    updatedBy: question.updatedBy
  };
}

function mapAttempt(attempt: MongoCourseExamAttempt) {
  return {
    id: attempt._id,
    botId: attempt.botId,
    guildId: attempt.guildId,
    courseId: attempt.courseId,
    publicationId: attempt.publicationId,
    channelId: attempt.channelId,
    studentId: attempt.studentId,
    instructorId: attempt.instructorId,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    correctedAt: attempt.correctedAt?.toISOString() ?? null,
    correctedBy: attempt.correctedBy,
    currentQuestionIndex: attempt.currentQuestionIndex,
    objectiveCorrect: attempt.objectiveCorrect,
    objectiveWrong: attempt.objectiveWrong,
    writtenCount: attempt.writtenCount,
    score: attempt.score,
    automaticScore: attempt.automaticScore ?? attempt.score,
    manualScore: attempt.manualScore ?? null,
    finalScore: attempt.finalScore ?? null,
    manualObservation: attempt.manualObservation ?? null,
    result: attempt.result ?? null,
    maxScore: attempt.maxScore,
    percent: attempt.percent,
    correctionMessageId: attempt.correctionMessageId,
    rejectionReason: attempt.rejectionReason,
    updatedAt: attempt.updatedAt.toISOString()
  };
}

function mapAnswer(answer: MongoCourseExamAnswer) {
  return {
    id: answer._id,
    botId: answer.botId,
    guildId: answer.guildId,
    attemptId: answer.attemptId,
    courseId: answer.courseId,
    questionId: answer.questionId,
    questionOrder: answer.questionOrder,
    type: answer.type,
    selectedAlternativeId: answer.selectedAlternativeId,
    writtenAnswer: answer.writtenAnswer,
    correct: answer.correct,
    pointsEarned: answer.pointsEarned,
    maxScore: answer.maxScore ?? answer.pointsEarned,
    answeredAt: answer.answeredAt.toISOString()
  };
}

function cleanSettings(input: Partial<CourseExamSettingsDto>) {
  return {
    ...input,
    correctionChannelId: input.correctionChannelId || null,
    logChannelId: input.logChannelId || null,
    maxTimeMinutes: input.maxTimeMinutes ? Math.max(1, Number(input.maxTimeMinutes)) : null,
    minScore: Math.max(0, Number(input.minScore ?? 7)),
    manualQuestionMaxScore: Math.max(0, Number(input.manualQuestionMaxScore ?? 10)),
    manualApproval: input.manualApproval ?? true,
    automaticApproval: input.automaticApproval ?? false
  };
}

function normalizeAlternatives(value: unknown, type: "selection" | "written") {
  if (type === "written") return [];
  const source = Array.isArray(value) ? value : [];
  return source
    .slice(0, 10)
    .map((item, index) => {
      const option = item as { id?: unknown; text?: unknown; value?: unknown; score?: unknown; isCorrect?: unknown; order?: unknown };
      const id = String(option.id ?? ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"][index] ?? randomUUID()).trim();
      return {
        id,
        text: String(option.text ?? item ?? "").trim(),
        value: String(option.value ?? id).trim(),
        score: Math.max(0, Number(option.score ?? 0) || 0),
        isCorrect: option.isCorrect === true,
        order: Number.isFinite(option.order) ? Number(option.order) : index
      };
    })
    .filter((item) => item.text);
}

function normalizeCorrect(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 80) : null;
}

function scope(botId: string | null, guildId: string) {
  return { botId, guildId };
}
