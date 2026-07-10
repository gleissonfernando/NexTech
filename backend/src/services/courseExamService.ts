import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoCourseExamAnswer, type MongoCourseExamAttempt, type MongoCourseExamQuestion, type MongoCourseExamSettings } from "../database/mongo";
import { logCourseAction } from "./courseService";

const DEFAULT_INITIAL = "Bem-vindo à prova do curso. Leia cada pergunta com atenção e responda uma etapa por vez.";
const DEFAULT_FINAL = "Sua prova foi concluída. Clique abaixo para finalizar.";
const DEFAULT_APPROVAL = "Você foi aprovado na prova do curso.";
const DEFAULT_REJECTION = "Você foi reprovado na prova do curso.";
const DEFAULT_EXTERNAL_LINK_TEXT = "Acessar material da prova";

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
    resultChannelId: null,
    temporaryCategoryId: null,
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
    externalLinkEnabled: false,
    externalLinkText: DEFAULT_EXTERNAL_LINK_TEXT,
    externalLinkUrl: null,
    externalLinkDescription: null,
    externalLinkEmoji: null,
    updatedAt: now,
    updatedBy: null
  };
  await courseExamSettings.insertOne(doc);
  return mapSettings(doc);
}

export async function saveCourseExamSettings(botId: string | null, guildId: string, courseId: string, input: Partial<Omit<CourseExamSettingsDto, "id" | "botId" | "guildId" | "courseId" | "updatedAt">>, actorId: string | null) {
  const { courseExamSettings } = await getMongoCollections();
  const now = new Date();
  await getCourseExamSettings(botId, guildId, courseId);
  await courseExamSettings.updateOne({ ...scope(botId, guildId), courseId }, {
    $set: { ...cleanSettings(input), updatedAt: now, updatedBy: actorId }
  });
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
  if (input.questionNumber !== undefined) patch.questionNumber = Math.max(1, Math.min(100, Number(input.questionNumber) || 1));
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

export async function createOrResumeCourseExamAttempt(botId: string | null, guildId: string, input: {
  channelId: string;
  courseId: string;
  instructorId: string;
  publicationId: string;
  questionsSnapshot?: CourseExamQuestionDto[];
  studentId: string;
}) {
  const collections = await getMongoCollections();
  const existing = await collections.courseExamAttempts.findOne({
    ...scope(botId, guildId),
    courseId: input.courseId,
    publicationId: input.publicationId,
    status: "in_progress",
    studentId: input.studentId
  });
  if (existing) {
    if (existing.channelId !== input.channelId) {
      await collections.courseExamAttempts.updateOne({ _id: existing._id, ...scope(botId, guildId) }, { $set: { channelId: input.channelId, updatedAt: new Date() } });
      const updated = await collections.courseExamAttempts.findOne({ _id: existing._id, ...scope(botId, guildId) });
      return mapAttempt(updated ?? existing);
    }
    return mapAttempt(existing);
  }
  const now = new Date();
  let questionsSnapshot = normalizeQuestionSnapshot(input.questionsSnapshot);
  if (!questionsSnapshot.length) {
    const questions = await collections.courseExamQuestions.find({ ...scope(botId, guildId), courseId: input.courseId, active: true }).sort({ order: 1, createdAt: 1 }).toArray();
    questionsSnapshot = questions.map((question) => ({ ...question, alternatives: normalizeAlternatives(question.alternatives, question.type) }));
  }
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
    questionsSnapshot,
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
  const attempt = await courseExamAttempts.findOne({ ...scope(botId, guildId), channelId }, { sort: { updatedAt: -1 } });
  return attempt ? mapAttempt(attempt) : null;
}

export async function getCourseExamAttemptBundle(botId: string | null, guildId: string, attemptId: string) {
  const collections = await getMongoCollections();
  const [attempt, answers] = await Promise.all([
    collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) }),
    collections.courseExamAnswers.find({ ...scope(botId, guildId), attemptId }).sort({ questionOrder: 1 }).toArray()
  ]);
  return attempt ? { answers: answers.map(mapAnswer), attempt: mapAttempt(attempt), questions: attemptQuestions(attempt).map(mapQuestion) } : null;
}

export async function saveCourseExamAnswer(botId: string | null, guildId: string, attemptId: string, input: { questionId?: string | null; questionIndex?: number | null; selectedAlternativeId?: string | null; writtenAnswer?: string | null }) {
  const collections = await getMongoCollections();
  const attempt = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" });
  if (!attempt) return null;
  const questions = attemptQuestions(attempt);
  const questionIndex = Number.isInteger(input.questionIndex) ? Number(input.questionIndex) : attempt.currentQuestionIndex;
  if (questionIndex !== attempt.currentQuestionIndex) return null;
  const question = questions[questionIndex];
  if (!question) return null;
  if (input.questionId && input.questionId !== question._id) return null;
  const selectedAlternativeId = question.type === "selection" ? normalizeCorrect(input.selectedAlternativeId) : null;
  const selectedAlternative = question.alternatives.find((alternative) => alternative.id === selectedAlternativeId);
  if (question.type === "selection" && !selectedAlternative) return null;
  const writtenAnswer = question.type === "written" ? input.writtenAnswer?.trim().slice(0, 3000) || "" : null;
  if (question.type === "written" && !writtenAnswer) return null;
  const correct = question.type === "selection" ? Boolean(selectedAlternative?.isCorrect ?? selectedAlternativeId === question.correctAlternativeId) : null;
  const pointsEarned = question.type === "selection" ? Math.max(0, Number(selectedAlternative?.score ?? (correct ? question.points : 0)) || 0) : 0;
  const now = new Date();
  const doc: MongoCourseExamAnswer = {
    _id: randomUUID(),
    botId,
    guildId,
    attemptId,
    courseId: attempt.courseId,
    questionId: question._id,
    questionOrder: question.order,
    questionText: question.prompt,
    type: question.type,
    selectedAlternativeId,
    selectedAlternativeText: selectedAlternative?.text ?? null,
    alternativesSnapshot: question.type === "selection" ? question.alternatives : [],
    writtenAnswer,
    correct,
    pointsEarned,
    maxScore: question.points,
    answeredAt: now
  };
  const progress = await collections.courseExamAttempts.updateOne(
    { _id: attemptId, ...scope(botId, guildId), status: "in_progress", currentQuestionIndex: questionIndex },
    { $set: { currentQuestionIndex: questionIndex + 1, updatedAt: now } }
  );
  if (progress.matchedCount === 0) return null;
  await collections.courseExamAnswers.updateOne({ ...scope(botId, guildId), attemptId, questionId: question._id }, { $setOnInsert: doc }, { upsert: true });
  await logCourseAction(botId, guildId, "course.exam_question_answered", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, questionId: question._id, questionIndex });
  return mapAnswer(doc);
}

export async function finalizeCourseExamAttempt(botId: string | null, guildId: string, attemptId: string) {
  const collections = await getMongoCollections();
  const [attempt, answers] = await Promise.all([
    collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" }),
    collections.courseExamAnswers.find({ ...scope(botId, guildId), attemptId }).toArray()
  ]);
  if (!attempt) return null;
  const relevantQuestions = attemptQuestions(attempt);
  if (!relevantQuestions.length) return null;
  const answeredQuestionIds = new Set(answers.map((answer) => answer.questionId));
  if (!relevantQuestions.every((question) => answeredQuestionIds.has(question._id))) return null;
  const maxScore = relevantQuestions.reduce((total, question) => total + question.points, 0);
  const score = answers.filter((answer) => answer.type === "selection").reduce((total, answer) => total + answer.pointsEarned, 0);
  const objectiveCorrect = answers.filter((answer) => answer.type === "selection" && answer.correct === true).length;
  const objectiveWrong = answers.filter((answer) => answer.type === "selection" && answer.correct === false).length;
  const writtenCount = answers.filter((answer) => answer.type === "written").length;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
  const now = new Date();
  const updatedStatus = await collections.courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" }, {
    $set: { automaticScore: score, finishedAt: now, maxScore, objectiveCorrect, objectiveWrong, percent, score, status: "awaiting_review", updatedAt: now, writtenCount }
  });
  if (updatedStatus.matchedCount === 0) return null;
  const updated = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.exam_finished", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, percent, score });
  return updated ? { answers: answers.map(mapAnswer), attempt: mapAttempt(updated), questions: relevantQuestions.map(mapQuestion) } : null;
}

export async function reviewCourseExamAttempt(botId: string | null, guildId: string, attemptId: string, reviewerId: string, status: "approved" | "rejected", rejectionReason?: string | null, manualScoreInput?: number | null) {
  const { courseExamAttempts } = await getMongoCollections();
  const now = new Date();
  const reviewableStatuses: MongoCourseExamAttempt["status"][] = ["finished", "awaiting_review", "manual_reviewed"];
  const reviewableFilter = {
    _id: attemptId,
    ...scope(botId, guildId),
    $or: [{ result: null }, { result: { $exists: false } }],
    status: { $in: reviewableStatuses }
  };
  const existing = await courseExamAttempts.findOne(reviewableFilter);
  if (!existing) return null;
  const automaticScore = Number(existing.automaticScore ?? existing.score ?? 0) || 0;
  const manualScore = Math.max(0, Number(manualScoreInput ?? existing.manualScore ?? 0) || 0);
  const finalScore = automaticScore + manualScore;
  const percent = existing.maxScore > 0 ? Math.round((finalScore / existing.maxScore) * 10000) / 100 : 0;
  const decided = await courseExamAttempts.updateOne(reviewableFilter, {
    $set: { automaticScore, correctedAt: now, correctedBy: reviewerId, finalScore, manualScore, percent, rejectionReason: rejectionReason || null, result: status, score: finalScore, status, updatedAt: now }
  });
  if (decided.matchedCount === 0) return null;
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
    resultChannelId: settings.resultChannelId ?? null,
    temporaryCategoryId: settings.temporaryCategoryId ?? null,
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
    externalLinkEnabled: settings.externalLinkEnabled ?? false,
    externalLinkText: settings.externalLinkText ?? DEFAULT_EXTERNAL_LINK_TEXT,
    externalLinkUrl: settings.externalLinkUrl ?? null,
    externalLinkDescription: settings.externalLinkDescription ?? null,
    externalLinkEmoji: settings.externalLinkEmoji ?? null,
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
    questionText: answer.questionText ?? null,
    type: answer.type,
    selectedAlternativeId: answer.selectedAlternativeId,
    selectedAlternativeText: answer.selectedAlternativeText ?? null,
    alternativesSnapshot: answer.alternativesSnapshot ?? [],
    writtenAnswer: answer.writtenAnswer,
    correct: answer.correct,
    pointsEarned: answer.pointsEarned,
    maxScore: answer.maxScore ?? answer.pointsEarned,
    answeredAt: answer.answeredAt.toISOString()
  };
}

function cleanSettings(input: Partial<CourseExamSettingsDto>) {
  const patch: Partial<CourseExamSettingsDto> = { ...input };
  if ("correctionChannelId" in input) patch.correctionChannelId = input.correctionChannelId || null;
  if ("resultChannelId" in input) patch.resultChannelId = input.resultChannelId || null;
  if ("temporaryCategoryId" in input) patch.temporaryCategoryId = input.temporaryCategoryId || null;
  if ("logChannelId" in input) patch.logChannelId = input.logChannelId || null;
  if ("maxTimeMinutes" in input) patch.maxTimeMinutes = input.maxTimeMinutes ? Math.max(1, Number(input.maxTimeMinutes)) : null;
  if ("minScore" in input) patch.minScore = Math.max(0, Number(input.minScore ?? 7));
  if ("manualQuestionMaxScore" in input) patch.manualQuestionMaxScore = Math.max(0, Number(input.manualQuestionMaxScore ?? 10));
  if ("manualApproval" in input) patch.manualApproval = input.manualApproval ?? true;
  if ("automaticApproval" in input) patch.automaticApproval = input.automaticApproval ?? false;
  if ("externalLinkEnabled" in input) patch.externalLinkEnabled = input.externalLinkEnabled === true;
  if ("externalLinkText" in input) patch.externalLinkText = input.externalLinkText?.trim().slice(0, 80) || DEFAULT_EXTERNAL_LINK_TEXT;
  if ("externalLinkUrl" in input) patch.externalLinkUrl = sanitizeExternalUrl(input.externalLinkUrl);
  if ("externalLinkDescription" in input) patch.externalLinkDescription = input.externalLinkDescription?.trim().slice(0, 300) || null;
  if ("externalLinkEmoji" in input) patch.externalLinkEmoji = input.externalLinkEmoji?.trim().slice(0, 80) || null;
  return patch;
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

function normalizeQuestionSnapshot(value: unknown): MongoCourseExamQuestion[] {
  const source = Array.isArray(value) ? value : [];
  const normalized: MongoCourseExamQuestion[] = [];
  source.forEach((item, index) => {
    const question = item as Partial<CourseExamQuestionDto> & Partial<MongoCourseExamQuestion> & { id?: string };
    const id = String(question.id ?? question._id ?? "").trim();
    const prompt = String(question.prompt ?? "").trim();
    const type = question.type === "written" ? "written" : "selection";
    if (!id || !prompt) return;
    const now = new Date();
    normalized.push({
      _id: id,
      active: question.active !== false,
      alternatives: normalizeAlternatives(question.alternatives, type),
      botId: question.botId ?? null,
      correctAlternativeId: type === "written" ? null : normalizeCorrect(question.correctAlternativeId),
      courseId: String(question.courseId ?? ""),
      createdAt: question.createdAt ? new Date(question.createdAt) : now,
      description: question.description ?? null,
      guildId: String(question.guildId ?? ""),
      order: Number.isFinite(question.order) ? Number(question.order) : index,
      placeholder: question.placeholder ?? null,
      points: Math.max(0, Number(question.points ?? 0) || 0),
      prompt,
      questionNumber: Number.isFinite(question.questionNumber) ? Number(question.questionNumber) : index + 1,
      title: question.title ?? prompt,
      type,
      updatedAt: question.updatedAt ? new Date(question.updatedAt) : now,
      updatedBy: question.updatedBy ?? null
    });
  });
  return normalized.sort((a, b) => (a.order - b.order) || ((a.questionNumber ?? 0) - (b.questionNumber ?? 0)));
}

function attemptQuestions(attempt: MongoCourseExamAttempt): MongoCourseExamQuestion[] {
  return normalizeQuestionSnapshot(attempt.questionsSnapshot ?? []);
}

function sanitizeExternalUrl(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function scope(botId: string | null, guildId: string) {
  return { botId, guildId };
}
