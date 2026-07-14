import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoCourseExamAnswer, type MongoCourseExamAttempt, type MongoCourseExamQuestion, type MongoCourseExamSettings } from "../database/mongo";
import { getCourseSettings, logCourseAction } from "./courseService";
import { emitRealtime } from "../realtime/events";

const DEFAULT_INITIAL = "Bem-vindo à prova do curso. Leia cada pergunta com atenção e responda uma etapa por vez.";
const DEFAULT_FINAL = "Sua prova foi concluída. Clique abaixo para finalizar.";
const DEFAULT_APPROVAL = "Você foi aprovado na prova do curso.";
const DEFAULT_REJECTION = "Você foi reprovado na prova do curso.";
const DEFAULT_EXTERNAL_LINK_TEXT = "Acessar material da prova";
const DEFAULT_RELEASE_MODE = "immediate";
const MAX_EXAM_ALTERNATIVES = 25;

type StudentRank = "CADET" | "OFFICER" | "SENIOR_OFFICER";

type IdentificationInput = {
  discordDisplayName?: string | null;
  discordUsername?: string | null;
  guildNickname?: string | null;
  rpFullName?: string | null;
  currentRank?: StudentRank | null;
  rpId?: string | null;
  confirm?: boolean;
};

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
    releaseMode: DEFAULT_RELEASE_MODE,
    releaseAt: null,
    attemptLimit: 1,
    allowAnswerChange: false,
    showAnswersAfterExam: false,
    version: 1,
    examKey: null,
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
  const patch = await cleanSettings(botId, guildId, courseId, input);
  await courseExamSettings.updateOne({ ...scope(botId, guildId), courseId }, {
    $set: { ...patch, updatedAt: now, updatedBy: actorId }
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
    type: normalizeQuestionType(input.type),
    prompt: input.prompt?.trim() || "Nova pergunta",
    title: input.title?.trim() || input.prompt?.trim() || "Nova pergunta",
    description: input.description?.trim() || null,
    points: Math.max(0, parseDecimalNumber(input.points, 1)),
    alternatives: normalizeAlternatives(input.alternatives, normalizeQuestionType(input.type)),
    correctAlternativeId: normalizeQuestionType(input.type) === "written" ? null : normalizeCorrect(input.correctAlternativeId),
    correctAlternativeIds: normalizeQuestionType(input.type) === "multiple" ? normalizeCorrectList(input.correctAlternativeIds ?? input.correctAlternativeId ?? input.alternatives) : [],
    correctText: normalizeQuestionType(input.type) === "written" ? normalizeNullableText(input.correctText, 1000) : null,
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
  if (input.type !== undefined) patch.type = normalizeQuestionType(input.type);
  if (input.prompt !== undefined) patch.prompt = input.prompt.trim() || "Pergunta";
  if (input.title !== undefined) patch.title = input.title?.trim() || input.prompt?.trim() || "Pergunta";
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.points !== undefined) patch.points = Math.max(0, parseDecimalNumber(input.points, 0));
  if (input.alternatives !== undefined) patch.alternatives = normalizeAlternatives(input.alternatives, patch.type ?? normalizeQuestionType(input.type));
  if (input.correctAlternativeId !== undefined) patch.correctAlternativeId = patch.type === "written" || input.type === "written" ? null : normalizeCorrect(input.correctAlternativeId);
  if (input.correctAlternativeIds !== undefined || input.alternatives !== undefined || input.type !== undefined) {
    const type = patch.type ?? normalizeQuestionType(input.type);
    patch.correctAlternativeIds = type === "multiple" ? normalizeCorrectList(input.correctAlternativeIds ?? input.correctAlternativeId ?? input.alternatives) : [];
  }
  if (input.correctText !== undefined || input.type !== undefined) {
    const type = patch.type ?? normalizeQuestionType(input.type);
    patch.correctText = type === "written" ? normalizeNullableText(input.correctText, 1000) : null;
  }
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
  const publication = await collections.coursePublications.findOne({
    _id: input.publicationId,
    ...scope(botId, guildId),
    courseId: input.courseId,
    status: { $in: ["started", "proof"] },
    students: input.studentId
  });
  if (!publication) throw new Error("Aluno não inscrito, turma inativa ou curso divergente.");
  const examSettings = await collections.courseExamSettings.findOne({ ...scope(botId, guildId), courseId: input.courseId, enabled: true });
  if (!examSettings) throw new Error("A prova vinculada a este curso não foi encontrada ou está desativada.");
  const completed = await collections.courseExamAttempts.findOne({
    ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId,
    status: { $in: ["finished", "awaiting_review", "manual_reviewed", "approved", "rejected"] }
  });
  if (completed) throw new Error("Esta prova já foi finalizada e não pode ser iniciada novamente.");
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
      await collections.courseEnrollments.updateOne(
        { ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId, examStatus: "STARTING", examChannelId: input.channelId },
        { $set: { examId: examSettings._id, examStatus: "IN_PROGRESS", attemptId: existing._id, updatedAt: new Date() } }
      );
      const updated = await collections.courseExamAttempts.findOne({ _id: existing._id, ...scope(botId, guildId) });
      return mapAttempt(updated ?? existing);
    }
    await collections.courseEnrollments.updateOne(
      { ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId, examStatus: "STARTING", examChannelId: input.channelId },
      { $set: { examId: examSettings._id, examStatus: "IN_PROGRESS", attemptId: existing._id, updatedAt: new Date() } }
    );
    return mapAttempt(existing);
  }
  const now = new Date();
  const previousAttempts = await collections.courseExamAttempts.countDocuments({ ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId });
  const enrollment = await collections.courseEnrollments.findOne({
    ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId, enrollmentStatus: "ENROLLED", examStatus: "STARTING", examChannelId: input.channelId
  });
  if (!enrollment) throw new Error("A tentativa não foi reservada para este canal.");
  const questions = await collections.courseExamQuestions.find({ ...scope(botId, guildId), courseId: input.courseId, active: true }).sort({ order: 1, createdAt: 1 }).toArray();
  const questionsSnapshot = questions.map((question) => ({ ...question, alternatives: normalizeAlternatives(question.alternatives, question.type) }));
  if (!questionsSnapshot.length) {
    await collections.courseEnrollments.updateOne(
      { ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId, examStatus: "STARTING" },
      { $set: { examStatus: "AVAILABLE", updatedAt: new Date() } }
    );
    throw new Error("A prova vinculada a este curso não foi encontrada.");
  }
  const doc: MongoCourseExamAttempt = {
    _id: randomUUID(),
    botId,
    guildId,
    courseId: input.courseId,
    examId: examSettings._id,
    publicationId: input.publicationId,
    channelId: input.channelId,
    studentId: input.studentId,
    instructorId: publication.instructorId,
    status: "in_progress",
    questionsSnapshot,
    examVersion: examSettings.version ?? 1,
    attemptNumber: previousAttempts + 1,
    studentIdentification: null,
    identificationConfirmedAt: null,
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
  try {
    await collections.courseExamAttempts.insertOne(doc);
    await collections.courseEnrollments.updateOne(
      { ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId, enrollmentStatus: "ENROLLED", examStatus: "STARTING" },
      { $set: { examId: examSettings._id, examStatus: "IN_PROGRESS", attemptId: doc._id, examChannelId: input.channelId, updatedAt: now } }
    );
  } catch (error) {
    await collections.courseEnrollments.updateOne(
      { ...scope(botId, guildId), publicationId: input.publicationId, studentId: input.studentId, examStatus: "STARTING" },
      { $set: { examStatus: "AVAILABLE", updatedAt: new Date() } }
    ).catch(() => null);
    throw error;
  }
  await logCourseAction(botId, guildId, "course.exam_started", input.studentId, input.courseId, input.publicationId, { attemptId: doc._id });
  emitRealtime("courses:publication", { botId, guildId, publicationId: input.publicationId });
  return mapAttempt(doc);
}

export async function updateCourseExamIdentification(botId: string | null, guildId: string, attemptId: string, input: IdentificationInput) {
  const collections = await getMongoCollections();
  const attempt = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" });
  if (!attempt) return null;
  const now = new Date();
  const current = attempt.studentIdentification ?? {
    discordUserId: attempt.studentId,
    discordUsername: "",
    discordDisplayName: "",
    guildNickname: null,
    rpFullName: "",
    currentRank: null,
    rpId: "",
    guildId,
    courseId: attempt.courseId,
    examId: attempt.examId ?? "",
    attemptId: attempt._id,
    temporaryChannelId: attempt.channelId,
    startedAt: attempt.startedAt,
    identificationCompletedAt: null
  };
  const next = {
    ...current,
    discordUsername: normalizeText(input.discordUsername ?? current.discordUsername, 100),
    discordDisplayName: normalizeText(input.discordDisplayName ?? current.discordDisplayName, 100),
    guildNickname: normalizeNullableText(input.guildNickname ?? current.guildNickname, 100),
    rpFullName: input.rpFullName !== undefined ? normalizeFullName(input.rpFullName) : current.rpFullName,
    currentRank: input.currentRank !== undefined ? normalizeRank(input.currentRank) : current.currentRank,
    rpId: input.rpId !== undefined ? normalizeRpId(input.rpId) : current.rpId
  };
  const completed = Boolean(next.rpFullName && next.currentRank && next.rpId);
  const shouldConfirm = input.confirm === true;
  if (shouldConfirm && !completed) {
    throw Object.assign(new Error("Preencha nome completo, patente e ID antes de confirmar."), { statusCode: 400 });
  }
  next.identificationCompletedAt = shouldConfirm ? now : completed ? next.identificationCompletedAt : null;
  await collections.courseExamAttempts.updateOne(
    { _id: attemptId, ...scope(botId, guildId), status: "in_progress" },
    {
      $set: {
        studentIdentification: next,
        identificationConfirmedAt: shouldConfirm ? now : attempt.identificationConfirmedAt ?? null,
        updatedAt: now
      }
    }
  );
  await logCourseAction(botId, guildId, shouldConfirm ? "course.exam_identification_confirmed" : "course.exam_identification_saved", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId });
  const updated = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) });
  return updated ? mapAttempt(updated) : null;
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

export async function saveCourseExamAnswer(botId: string | null, guildId: string, attemptId: string, input: { questionId?: string | null; questionIndex?: number | null; selectedAlternativeId?: string | null; selectedAlternativeIds?: string[] | null; writtenAnswer?: string | null }) {
  const collections = await getMongoCollections();
  const attempt = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" });
  if (!attempt) return null;
  if (!attempt.identificationConfirmedAt) return null;
  const examSettings = await collections.courseExamSettings.findOne({ _id: attempt.examId ?? "", ...scope(botId, guildId) })
    ?? await collections.courseExamSettings.findOne({ ...scope(botId, guildId), courseId: attempt.courseId });
  if (!isExamReleased(examSettings)) return null;
  const questions = attemptQuestions(attempt);
  const questionIndex = Number.isInteger(input.questionIndex) ? Number(input.questionIndex) : attempt.currentQuestionIndex;
  if (questionIndex !== attempt.currentQuestionIndex) return null;
  const question = questions[questionIndex];
  if (!question) return null;
  if (input.questionId && input.questionId !== question._id) return null;
  const selectedAlternativeIds = question.type === "multiple"
    ? normalizeCorrectList(input.selectedAlternativeIds ?? input.selectedAlternativeId)
    : [];
  const selectedAlternativeId = question.type === "selection" ? normalizeCorrect(input.selectedAlternativeId) : null;
  const selectedAlternative = question.alternatives.find((alternative) => alternative.id === selectedAlternativeId);
  const selectedAlternatives = question.type === "multiple" ? question.alternatives.filter((alternative) => selectedAlternativeIds.includes(alternative.id)) : [];
  if (question.type === "selection" && !selectedAlternative) return null;
  if (question.type === "multiple" && (!selectedAlternativeIds.length || selectedAlternativeIds.length !== selectedAlternatives.length)) return null;
  const writtenAnswer = question.type === "written" ? input.writtenAnswer?.trim().slice(0, 3000) || "" : null;
  if (question.type === "written" && !writtenAnswer) return null;
  const correct = question.type === "selection"
    ? Boolean(selectedAlternative && isExpectedAlternative(question, selectedAlternative))
    : question.type === "multiple"
      ? sameSet(selectedAlternativeIds, correctIds(question))
      : question.correctText
        ? normalizeWrittenAnswerForCompare(writtenAnswer) === normalizeWrittenAnswerForCompare(question.correctText)
        : null;
  const pointsEarned = question.type === "multiple"
    ? calculateMultipleChoiceScore(question, selectedAlternativeIds)
    : question.type === "selection"
      ? calculateSelectionScore(question, selectedAlternative)
      : correct === true
        ? question.points
        : 0;
  const maxScore = questionMaxScore(question);
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
    selectedAlternativeIds,
    selectedAlternativeText: question.type === "multiple" ? selectedAlternatives.map((item) => item.text).join("; ") : selectedAlternative?.text ?? null,
    alternativesSnapshot: question.type === "selection" || question.type === "multiple" ? question.alternatives : [],
    writtenAnswer,
    correct,
    pointsEarned,
    maxScore,
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
  await logCourseAction(botId, guildId, "course.exam_finalize_started", null, null, null, { attemptId });
  const [attempt, answers] = await Promise.all([
    collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" }),
    collections.courseExamAnswers.find({ ...scope(botId, guildId), attemptId }).toArray()
  ]);
  if (!attempt) {
    await logCourseAction(botId, guildId, "course.exam_finalize_blocked", null, null, null, { attemptId, reason: "attempt_not_in_progress_or_not_found" });
    return null;
  }
  await logCourseAction(botId, guildId, "course.exam_correction_started", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId });
  const relevantQuestions = attemptQuestions(attempt);
  if (!relevantQuestions.length) {
    await logCourseAction(botId, guildId, "course.exam_finalize_blocked", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, reason: "questions_snapshot_empty" });
    return null;
  }
  const answeredQuestionIds = new Set(answers.map((answer) => answer.questionId));
  const missingQuestionIds = relevantQuestions.filter((question) => !answeredQuestionIds.has(question._id)).map((question) => question._id);
  if (missingQuestionIds.length) {
    await logCourseAction(botId, guildId, "course.exam_finalize_blocked", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, answered: answers.length, missingQuestionIds, reason: "pending_answers" });
    return null;
  }
  const maxScore = roundScore(relevantQuestions.reduce((total, question) => total + questionMaxScore(question), 0));
  const score = roundScore(answers.reduce((total, answer) => total + answer.pointsEarned, 0));
  const objectiveCorrect = answers.filter((answer) => answer.correct === true).length;
  const objectiveWrong = answers.filter((answer) => answer.correct === false).length;
  const writtenCount = answers.filter((answer) => answer.type === "written").length;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
  const nextStatus = "awaiting_review";
  const now = new Date();
  await logCourseAction(botId, guildId, "course.exam_score_calculated", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, maxScore, objectiveCorrect, objectiveWrong, percent, score, result: null });
  const updatedStatus = await collections.courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId), status: "in_progress" }, {
    $set: {
      automaticScore: score,
      correctedAt: null,
      correctedBy: null,
      finalScore: null,
      finishedAt: now,
      maxScore,
      objectiveCorrect,
      objectiveWrong,
      percent,
      result: null,
      score,
      status: nextStatus,
      updatedAt: now,
      writtenCount
    }
  });
  if (updatedStatus.matchedCount === 0) {
    await logCourseAction(botId, guildId, "course.exam_finalize_blocked", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, reason: "status_update_race" });
    return null;
  }
  const updated = await collections.courseExamAttempts.findOne({ _id: attemptId, ...scope(botId, guildId) });
  await logCourseAction(botId, guildId, "course.exam_result_saved", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, maxScore, percent, result: null, score });
  await logCourseAction(botId, guildId, "course.exam_finished", attempt.studentId, attempt.courseId, attempt.publicationId, { attemptId, percent, score });
  await collections.courseEnrollments.updateOne(
    { ...scope(botId, guildId), publicationId: attempt.publicationId, studentId: attempt.studentId },
    { $set: { examStatus: "COMPLETED", attemptId, examChannelId: attempt.channelId, score, correctAnswers: objectiveCorrect, completedAt: now, result: null, updatedAt: now } }
  );
  emitRealtime("courses:publication", { botId, guildId, publicationId: attempt.publicationId });
  return updated ? { answers: answers.map(mapAnswer), attempt: mapAttempt(updated), questions: relevantQuestions.map(mapQuestion) } : null;
}

export async function reviewCourseExamAttempt(botId: string | null, guildId: string, attemptId: string, reviewerId: string, status: "approved" | "rejected", rejectionReason?: string | null, manualScoreInput?: number | null) {
  const { courseExamAttempts, courseEnrollments } = await getMongoCollections();
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
  await courseEnrollments.updateOne(
    { ...scope(botId, guildId), publicationId: attempt.publicationId, studentId: attempt.studentId },
    { $set: { examStatus: status === "approved" ? "APPROVED" : "FAILED", score: finalScore, result: status, correctedBy: reviewerId, completedAt: attempt.finishedAt ?? now, updatedAt: now } }
  );
  emitRealtime("courses:publication", { botId, guildId, publicationId: attempt.publicationId });
  return mapAttempt(attempt);
}

export async function setCourseExamCorrectionMessage(botId: string | null, guildId: string, attemptId: string, messageId: string) {
  const { courseExamAttempts } = await getMongoCollections();
  await courseExamAttempts.updateOne({ _id: attemptId, ...scope(botId, guildId) }, { $set: { correctionMessageId: messageId, updatedAt: new Date() } });
}

export async function setCourseExamCorrectionDelivery(botId: string | null, guildId: string, attemptId: string, input: { channelId: string; messageId: string }) {
  const { courseExamAttempts } = await getMongoCollections();
  await courseExamAttempts.updateOne(
    { _id: attemptId, ...scope(botId, guildId) },
    { $set: { correctionChannelId: input.channelId, correctionMessageId: input.messageId, correctionSentAt: new Date(), updatedAt: new Date() } }
  );
  await logCourseAction(botId, guildId, "course.exam_correction_panel_delivered", null, null, null, { attemptId, channelId: input.channelId, messageId: input.messageId });
}

export async function setCourseExamResultDelivery(botId: string | null, guildId: string, attemptId: string, input: { channelId: string; messageId: string }) {
  const { courseExamAttempts } = await getMongoCollections();
  await courseExamAttempts.updateOne(
    { _id: attemptId, ...scope(botId, guildId) },
    { $set: { resultChannelId: input.channelId, resultMessageId: input.messageId, resultSentAt: new Date(), updatedAt: new Date() } }
  );
  await logCourseAction(botId, guildId, "course.exam_result_panel_delivered", null, null, null, { attemptId, channelId: input.channelId, messageId: input.messageId });
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
    correctionChannelId: null,
    resultChannelId: null,
    temporaryCategoryId: null,
    logChannelId: null,
    deleteWrittenAnswers: settings.deleteWrittenAnswers,
    allowCurrentQuestionReview: settings.allowCurrentQuestionReview,
    initialMessage: settings.initialMessage,
    finalMessage: settings.finalMessage,
    approvalMessage: settings.approvalMessage,
    rejectionMessage: settings.rejectionMessage,
    manualQuestionMaxScore: settings.manualQuestionMaxScore ?? 10,
    manualApproval: true,
    automaticApproval: false,
    releaseMode: settings.releaseMode ?? DEFAULT_RELEASE_MODE,
    releaseAt: settings.releaseAt?.toISOString() ?? null,
    attemptLimit: settings.attemptLimit ?? null,
    allowAnswerChange: settings.allowAnswerChange ?? false,
    showAnswersAfterExam: settings.showAnswersAfterExam ?? false,
    version: settings.version ?? 1,
    examKey: settings.examKey ?? null,
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
    correctAlternativeIds: question.correctAlternativeIds?.length ? question.correctAlternativeIds : correctIds(question),
    correctText: question.correctText ?? null,
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
    examId: attempt.examId ?? null,
    publicationId: attempt.publicationId,
    channelId: attempt.channelId,
    studentId: attempt.studentId,
    instructorId: attempt.instructorId,
    status: attempt.status,
    examVersion: attempt.examVersion ?? 1,
    attemptNumber: attempt.attemptNumber ?? 1,
    studentIdentification: attempt.studentIdentification ? {
      ...attempt.studentIdentification,
      startedAt: attempt.studentIdentification.startedAt.toISOString(),
      identificationCompletedAt: attempt.studentIdentification.identificationCompletedAt?.toISOString() ?? null
    } : null,
    identificationConfirmedAt: attempt.identificationConfirmedAt?.toISOString() ?? null,
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
    correctionChannelId: attempt.correctionChannelId ?? null,
    correctionMessageId: attempt.correctionMessageId,
    correctionSentAt: attempt.correctionSentAt?.toISOString() ?? null,
    resultChannelId: attempt.resultChannelId ?? null,
    resultMessageId: attempt.resultMessageId ?? null,
    resultSentAt: attempt.resultSentAt?.toISOString() ?? null,
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
    selectedAlternativeIds: answer.selectedAlternativeIds ?? (answer.selectedAlternativeId ? [answer.selectedAlternativeId] : []),
    selectedAlternativeText: answer.selectedAlternativeText ?? null,
    alternativesSnapshot: answer.alternativesSnapshot ?? [],
    writtenAnswer: answer.writtenAnswer,
    correct: answer.correct,
    pointsEarned: answer.pointsEarned,
    maxScore: answer.maxScore ?? answer.pointsEarned,
    answeredAt: answer.answeredAt.toISOString()
  };
}

async function cleanSettings(botId: string | null, guildId: string, courseId: string, input: Partial<CourseExamSettingsDto>) {
  const patch: Record<string, unknown> = { ...input };
  delete patch.correctionChannelId;
  delete patch.resultChannelId;
  delete patch.temporaryCategoryId;
  delete patch.logChannelId;
  if ("maxTimeMinutes" in input) patch.maxTimeMinutes = input.maxTimeMinutes ? Math.max(1, Number(input.maxTimeMinutes)) : null;
  if ("minScore" in input) patch.minScore = Math.max(0, Number(input.minScore ?? 7));
  if ("manualQuestionMaxScore" in input) patch.manualQuestionMaxScore = Math.max(0, Number(input.manualQuestionMaxScore ?? 10));
  patch.manualApproval = true;
  patch.automaticApproval = false;
  if ("releaseMode" in input) patch.releaseMode = input.releaseMode === "scheduled" || input.releaseMode === "instructor" ? input.releaseMode : "immediate";
  if ("releaseAt" in input) {
    const releaseAt = input.releaseAt ? new Date(input.releaseAt) : null;
    patch.releaseAt = releaseAt && !Number.isNaN(releaseAt.getTime()) ? releaseAt : null;
  }
  if ("attemptLimit" in input) patch.attemptLimit = input.attemptLimit ? Math.max(1, Math.min(20, Number(input.attemptLimit))) : null;
  if ("allowAnswerChange" in input) patch.allowAnswerChange = input.allowAnswerChange === true;
  if ("showAnswersAfterExam" in input) patch.showAnswersAfterExam = input.showAnswersAfterExam === true;
  if ("version" in input) patch.version = Math.max(1, Number(input.version ?? 1) || 1);
  if ("examKey" in input) patch.examKey = input.examKey?.trim().slice(0, 120) || null;
  if (input.enabled === true) {
    const validation = await validateCourseExamActivation(botId, guildId, courseId, patch);
    if (!validation.ok) throw Object.assign(new Error(`Não é possível ativar esta prova: ${validation.errors.slice(0, 6).join(" | ")}${validation.errors.length > 6 ? ` | mais ${validation.errors.length - 6} pendência(s)` : ""}`), { statusCode: 400 });
  }
  if ("externalLinkEnabled" in input) patch.externalLinkEnabled = input.externalLinkEnabled === true;
  if ("externalLinkText" in input) patch.externalLinkText = input.externalLinkText?.trim().slice(0, 80) || DEFAULT_EXTERNAL_LINK_TEXT;
  if ("externalLinkUrl" in input) patch.externalLinkUrl = sanitizeExternalUrl(input.externalLinkUrl);
  if ("externalLinkDescription" in input) patch.externalLinkDescription = input.externalLinkDescription?.trim().slice(0, 300) || null;
  if ("externalLinkEmoji" in input) patch.externalLinkEmoji = input.externalLinkEmoji?.trim().slice(0, 80) || null;
  return patch;
}

function normalizeAlternatives(value: unknown, type: MongoCourseExamQuestion["type"]) {
  if (type === "written") return [];
  const source = Array.isArray(value) ? value : [];
  return source
    .slice(0, MAX_EXAM_ALTERNATIVES)
    .map((item, index) => {
      const option = item as { id?: unknown; text?: unknown; value?: unknown; score?: unknown; isCorrect?: unknown; order?: unknown };
      const id = String(option.id ?? defaultAlternativeId(index)).trim();
      return {
        id,
        text: String(option.text ?? item ?? "").trim(),
        value: String(option.value ?? id).trim(),
        score: Math.max(0, parseDecimalNumber(option.score, 0)),
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

function normalizeCorrectList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(source.flatMap((item) => {
    if (typeof item === "string") return [item.trim()];
    const option = item as { id?: unknown; isCorrect?: unknown; score?: unknown };
    return option.isCorrect === true || parseDecimalNumber(option.score, 0) > 0 ? [String(option.id ?? "").trim()] : [];
  }).filter(Boolean).map((item) => item.slice(0, 80)))];
}

function normalizeQuestionType(value: unknown): MongoCourseExamQuestion["type"] {
  return value === "written" || value === "multiple" ? value : "selection";
}

function correctIds(question: Pick<MongoCourseExamQuestion, "alternatives" | "correctAlternativeId" | "correctAlternativeIds">) {
  const fromList = question.correctAlternativeIds?.filter(Boolean) ?? [];
  if (fromList.length) return [...new Set(fromList)];
  const fromAlternatives = question.alternatives.filter((alternative) => alternative.isCorrect || Number(alternative.score ?? 0) > 0).map((alternative) => alternative.id);
  if (fromAlternatives.length) return [...new Set(fromAlternatives)];
  return question.correctAlternativeId ? [question.correctAlternativeId] : [];
}

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((item) => expected.has(item));
}

function calculateMultipleChoiceScore(question: MongoCourseExamQuestion, selectedAlternativeIds: string[]) {
  const expectedIds = correctIds(question);
  if (!expectedIds.length) return 0;
  const selected = new Set(selectedAlternativeIds);
  const fallbackPoints = question.points / expectedIds.length;
  const points = expectedIds.reduce((total, id) => {
    if (!selected.has(id)) return total;
    const alternative = question.alternatives.find((item) => item.id === id);
    return total + alternativePointValue(alternative, fallbackPoints);
  }, 0);
  return Math.min(questionMaxScore(question), roundScore(points));
}

function calculateSelectionScore(question: MongoCourseExamQuestion, selectedAlternative: MongoCourseExamQuestion["alternatives"][number] | undefined) {
  if (!selectedAlternative || !isExpectedAlternative(question, selectedAlternative)) return 0;
  return Math.min(questionMaxScore(question), alternativePointValue(selectedAlternative, question.points));
}

function questionMaxScore(question: MongoCourseExamQuestion) {
  if (question.type === "written") return roundScore(question.points);
  const expectedIds = correctIds(question);
  if (!expectedIds.length) return roundScore(question.points);
  if (question.type === "selection") {
    return roundScore(Math.max(...expectedIds.map((id) => alternativePointValue(question.alternatives.find((item) => item.id === id), question.points))));
  }
  const fallbackPoints = question.points / expectedIds.length;
  return roundScore(expectedIds.reduce((total, id) => total + alternativePointValue(question.alternatives.find((item) => item.id === id), fallbackPoints), 0));
}

function alternativePointValue(alternative: MongoCourseExamQuestion["alternatives"][number] | undefined, fallback: number) {
  const score = parseDecimalNumber(alternative?.score, 0);
  return score > 0 ? score : fallback;
}

function isExpectedAlternative(question: Pick<MongoCourseExamQuestion, "alternatives" | "correctAlternativeId" | "correctAlternativeIds">, alternative: MongoCourseExamQuestion["alternatives"][number]) {
  return alternative.isCorrect === true
    || parseDecimalNumber(alternative.score, 0) > 0
    || alternative.id === question.correctAlternativeId
    || question.correctAlternativeIds?.includes(alternative.id);
}

function parseDecimalNumber(value: unknown, fallback: number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundScore(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function defaultAlternativeId(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[index] ?? randomUUID();
}

function isExamReleased(settings: Pick<MongoCourseExamSettings, "releaseMode" | "releaseAt"> | null | undefined) {
  if (!settings) return true;
  if (settings.releaseMode === "instructor") return false;
  if (settings.releaseMode === "scheduled" && settings.releaseAt && settings.releaseAt.getTime() > Date.now()) return false;
  return true;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeNullableText(value: string | null | undefined, maxLength: number) {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

function normalizeWrittenAnswerForCompare(value: string | null | undefined) {
  return normalizeText(value, 1000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeFullName(value: string | null | undefined) {
  const normalized = normalizeText(value, 120);
  if (normalized.length < 3) throw Object.assign(new Error("Nome completo RP deve ter pelo menos 3 caracteres."), { statusCode: 400 });
  return normalized;
}

function normalizeRpId(value: string | null | undefined) {
  const normalized = String(value ?? "").replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized)) throw Object.assign(new Error("ID RP deve conter apenas números."), { statusCode: 400 });
  return normalized.slice(0, 100);
}

function normalizeRank(value: StudentRank | null | undefined) {
  return value === "CADET" || value === "OFFICER" || value === "SENIOR_OFFICER" ? value : null;
}

async function validateCourseExamActivation(botId: string | null, guildId: string, courseId: string, settingsPatch: Record<string, unknown>) {
  const collections = await getMongoCollections();
  const [settings, course, questions, courseSettings] = await Promise.all([
    collections.courseExamSettings.findOne({ ...scope(botId, guildId), courseId }),
    collections.courses.findOne({ _id: courseId, ...scope(botId, guildId) }),
    collections.courseExamQuestions.find({ ...scope(botId, guildId), courseId, active: true }).sort({ order: 1, createdAt: 1 }).toArray(),
    getCourseSettings(botId, guildId)
  ]);
  const merged = { ...(settings ? mapSettings(settings) : {}), ...settingsPatch } as Partial<CourseExamSettingsDto>;
  const errors: string[] = [];
  if (!course) errors.push("Curso não encontrado.");
  if (!questions.length) errors.push("A prova precisa ter pelo menos 1 pergunta ativa configurada.");
  if (!Number(merged.minScore)) errors.push("Nota mínima não configurada.");
  if (!(courseSettings.tempProofCategoryId || courseSettings.temporaryCategoryId)) errors.push("Categoria de canais temporários não configurada na Configuração de Canais.");
  if (!courseSettings.evaluationChannelId) errors.push("Canal de avaliação/correção não configurado na Configuração de Canais.");
  if (!courseSettings.resultChannelId) errors.push("Canal de resultados não configurado na Configuração de Canais.");
  if (!(courseSettings.proofLogChannelId || courseSettings.adminLogChannelId || courseSettings.logChannelId)) errors.push("Canal de logs não configurado na Configuração de Canais.");
  const orders = new Set<number>();
  questions.forEach((question, index) => {
    const label = `Questão ${String(question.questionNumber ?? index + 1).padStart(2, "0")}`;
    if (!question.prompt.trim()) errors.push(`${label} sem enunciado configurado.`);
    if (orders.has(question.order)) errors.push(`${label} possui ordem duplicada.`);
    orders.add(question.order);
    if (!question.points || question.points <= 0) errors.push(`${label} sem pontuação configurada.`);
    if (question.type === "written") {
      if (!normalizeNullableText(question.correctText, 1000)) errors.push(`${label} sem resposta correta configurada.`);
    } else {
      if (question.alternatives.length < 2) errors.push(`${label} precisa ter pelo menos duas alternativas.`);
      question.alternatives.forEach((alternative) => {
        if (!alternative.text.trim()) errors.push(`${label} possui alternativa ${alternative.id} sem texto.`);
      });
      const duplicateAlternative = hasDuplicate(question.alternatives.map((item) => item.text.toLowerCase().trim()));
      if (duplicateAlternative) errors.push(`${label} possui alternativas duplicadas.`);
      if (!correctIds(question).length) errors.push(`${label} sem gabarito configurado.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

function hasDuplicate(values: string[]) {
  const seen = new Set<string>();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}

function normalizeQuestionSnapshot(value: unknown): MongoCourseExamQuestion[] {
  const source = Array.isArray(value) ? value : [];
  const normalized: MongoCourseExamQuestion[] = [];
  source.forEach((item, index) => {
    const question = item as Partial<CourseExamQuestionDto> & Partial<MongoCourseExamQuestion> & { id?: string };
    const id = String(question.id ?? question._id ?? "").trim();
    const prompt = String(question.prompt ?? "").trim();
    const type = normalizeQuestionType(question.type);
    if (!id || !prompt) return;
    const now = new Date();
    normalized.push({
      _id: id,
      active: question.active !== false,
      alternatives: normalizeAlternatives(question.alternatives, type),
      botId: question.botId ?? null,
      correctAlternativeId: type === "written" ? null : normalizeCorrect(question.correctAlternativeId),
      correctAlternativeIds: type === "multiple" ? normalizeCorrectList(question.correctAlternativeIds ?? question.alternatives) : [],
      correctText: type === "written" ? normalizeNullableText(question.correctText, 1000) : null,
      courseId: String(question.courseId ?? ""),
      createdAt: question.createdAt ? new Date(question.createdAt) : now,
      description: question.description ?? null,
      guildId: String(question.guildId ?? ""),
      order: Number.isFinite(question.order) ? Number(question.order) : index,
      placeholder: question.placeholder ?? null,
      points: Math.max(0, parseDecimalNumber(question.points, 0)),
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
