import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  COURSES_MODULE_ID,
  createCourse,
  createCoursePublication,
  createCourseReport,
  createScheduleRequest,
  deleteCourse,
  expireCourseEnrollmentChannel,
  getCourse,
  getCoursePublication,
  getCoursePublicationEnrollments,
  getCoursesDashboard,
  getCourseSettings,
  getManageableCourses,
  getScheduleRequest,
  joinCoursePublication,
  leaveCoursePublication,
  listCoursePublications,
  requestCoursePanelPublish,
  reserveCourseExamStart,
  releaseCourseExamStart,
  saveCourseSettings,
  setCoursePublicationStatus,
  setCourseEnrollmentExamChannel,
  updateCourse,
  updateCoursePanelMessage,
  updateCoursePublicationMessage,
  updateScheduleRequest
} from "../services/courseService";
import {
  createCourseExamQuestion,
  createOrResumeCourseExamAttempt,
  deleteCourseExamQuestion,
  duplicateCourseExamQuestion,
  finalizeCourseExamAttempt,
  getCourseExamAttemptBundle,
  getCourseExamAttemptByChannel,
  getCourseExamDashboard,
  getCourseExamRuntime,
  reorderCourseExamQuestions,
  reviewCourseExamAttempt,
  saveCourseExamAnswer,
  saveCourseExamSettings,
  setCourseExamCorrectionMessage,
  updateCourseExamIdentification,
  updateCourseExamQuestion
} from "../services/courseExamService";

export const coursesRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = snowflake.nullable().optional().or(z.literal(""));
const courseSchema = z.object({
  active: z.boolean().optional(),
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  proofBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  buttonLabels: z.object({
    cancel: z.string().min(1).max(40),
    enter: z.string().min(1).max(40),
    leave: z.string().min(1).max(40),
    start: z.string().min(1).max(40)
  }).optional(),
  cancelledText: z.string().max(900).nullable().optional().or(z.literal("")),
  color: z.string().max(24).optional(),
  code: z.string().max(40).nullable().optional().or(z.literal("")),
  description: z.string().max(1200).nullable().optional().or(z.literal("")),
  emoji: z.string().max(80).nullable().optional().or(z.literal("")),
  footerImageUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  imagePosition: z.enum(["top", "bottom", "side", "footer"]).optional(),
  instructorRoleIds: z.array(snowflake).optional(),
  instructorUserIds: z.array(snowflake).optional(),
  allowGeneralInstructorRoles: z.boolean().optional(),
  maxStudents: z.number().int().min(1).max(500).optional(),
  location: z.string().max(120).nullable().optional().or(z.literal("")),
  name: z.string().min(1).max(120),
  defaultSchedule: z.string().max(120).nullable().optional().or(z.literal("")),
  publishChannelId: optionalSnowflake,
  publishText: z.string().max(1200).nullable().optional().or(z.literal("")),
  proofInstructionText: z.string().max(1200).nullable().optional().or(z.literal("")),
  startedText: z.string().max(900).nullable().optional().or(z.literal("")),
  thumbnailUrl: z.string().max(2048).nullable().optional().or(z.literal(""))
});
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).optional(),
  adminUserIds: z.array(snowflake).optional(),
  buttonEmojis: z.object({
    cancel: z.string().max(80),
    course: z.string().max(80).optional(),
    enter: z.string().max(80),
    error: z.string().max(80).optional(),
    full: z.string().max(80).optional(),
    instructor: z.string().max(80).optional(),
    leave: z.string().max(80),
    location: z.string().max(80).optional(),
    logs: z.string().max(80).optional(),
    participants: z.string().max(80).optional(),
    save: z.string().max(80).optional(),
    start: z.string().max(80),
    status: z.string().max(80).optional(),
    success: z.string().max(80).optional(),
    time: z.string().max(80).optional(),
    vacancies: z.string().max(80).optional()
  }).optional(),
  cancelledMessage: z.string().max(900).optional(),
  scheduleLogChannelId: optionalSnowflake,
  proofLogChannelId: optionalSnowflake,
  resultChannelId: optionalSnowflake,
  evaluationChannelId: optionalSnowflake,
  adminLogChannelId: optionalSnowflake,
  tempProofCategoryId: optionalSnowflake,
  evaluatorMentionRoleId: optionalSnowflake,
  resultMentionRoleId: optionalSnowflake,
  defaultExpirationHours: z.number().int().min(1).max(720).nullable().optional(),
  globalBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  generalInstructorRoleIds: z.array(snowflake).optional(),
  globalInstructorUserIds: z.array(snowflake).optional(),
  globalInstructorRoleIds: z.array(snowflake).optional(),
  evaluatorUserIds: z.array(snowflake).optional(),
  evaluatorRoleIds: z.array(snowflake).optional(),
  configUserIds: z.array(snowflake).optional(),
  configRoleIds: z.array(snowflake).optional(),
  permissionMatrix: z.record(z.object({ userIds: z.array(snowflake).default([]), roleIds: z.array(snowflake).default([]) })).optional(),
  images: z.array(z.object({
    id: z.string().optional(),
    _id: z.string().optional(),
    botId: z.string().nullable().optional(),
    guildId: z.string().optional(),
    name: z.string().min(1).max(120),
    type: z.enum(["main_banner", "proof_banner", "logs_banner", "approved_result", "rejected_result", "module"]),
    url: z.string().min(1).max(2048),
    createdAt: z.string().optional(),
    createdBy: z.string().nullable().optional(),
    active: z.boolean().optional(),
    default: z.boolean().optional()
  })).optional(),
  logChannelId: optionalSnowflake,
  managerRoleIds: z.array(snowflake).optional(),
  managerUserIds: z.array(snowflake).optional(),
  noPermissionMessage: z.string().max(900).optional(),
  publishChannelId: optionalSnowflake,
  reportChannelId: optionalSnowflake,
  reportImageUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  scheduleChannelId: optionalSnowflake,
  startedMessage: z.string().max(900).optional(),
  temporaryCategoryId: optionalSnowflake
});
const manageableSchema = z.object({
  isAdministrator: z.boolean().optional(),
  roleIds: z.array(snowflake).default([]),
  userId: snowflake
});
const publicationSchema = z.object({
  capacity: z.number().int().min(1).max(500),
  channelId: snowflake,
  courseId: z.string().min(1),
  instructorId: snowflake,
  location: z.string().min(1).max(120),
  notes: z.string().max(900).nullable().optional().or(z.literal("")),
  scheduledFor: z.string().min(1).max(120)
});
const joinSchema = z.object({ userId: snowflake, studentName: z.string().trim().min(1).max(100) });
const leaveSchema = z.object({ userId: snowflake });
const enrollmentChannelSchema = z.object({ channelId: snowflake, studentId: snowflake, studentName: z.string().trim().min(1).max(100) });
const studentExamSchema = z.object({ studentId: snowflake });
const statusSchema = z.object({ actorId: snowflake, status: z.enum(["started", "cancelled", "closed", "proof", "finished"]) });
const publicationListSchema = z.object({ status: z.enum(["open", "started", "cancelled", "closed", "proof", "finished"]).nullable().optional() });
const messageStateSchema = z.object({ messageId: optionalSnowflake });
const scheduleSchema = z.object({
  channelId: optionalSnowflake,
  courseId: z.string().min(1),
  instructorId: snowflake,
  location: z.string().min(1).max(120),
  notes: z.string().max(900).nullable().optional().or(z.literal("")),
  requestedDate: z.string().min(1).max(40),
  requestedTime: z.string().min(1).max(40)
});
const scheduleDecisionSchema = z.object({
  actorId: snowflake,
  status: z.enum(["approved", "rejected"])
});
const reportSchema = z.object({
  channelId: optionalSnowflake,
  courseId: z.string().min(1),
  instructorId: snowflake,
  messageId: optionalSnowflake,
  reportDate: z.string().min(1).max(40),
  reportTime: z.string().min(1).max(40),
  students: z.array(z.object({
    note: z.string().regex(/^(10(?:\.0)?|[0-9](?:\.[0-9])?)$/),
    observation: z.string().max(500).nullable().optional().or(z.literal("")),
    userId: snowflake
  })).min(1).max(50)
});
const decimalNumber = (schema: z.ZodNumber) => z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
}, schema);
const secureExternalUrl = z.string().max(2048).refine((value) => !value || value.startsWith("https://"), "Use uma URL iniciada por https://").nullable().optional().or(z.literal(""));
const examSettingsSchema = z.object({
  allowCurrentQuestionReview: z.boolean().optional(),
  approvalMessage: z.string().max(1200).optional(),
  correctionChannelId: optionalSnowflake,
  deleteWrittenAnswers: z.boolean().optional(),
  enabled: z.boolean().optional(),
  externalLinkDescription: z.string().max(300).nullable().optional().or(z.literal("")),
  externalLinkEmoji: z.string().max(80).nullable().optional().or(z.literal("")),
  externalLinkEnabled: z.boolean().optional(),
  externalLinkText: z.string().min(1).max(80).optional(),
  externalLinkUrl: secureExternalUrl,
  finalMessage: z.string().max(1200).optional(),
  initialMessage: z.string().max(1200).optional(),
  logChannelId: optionalSnowflake,
  resultChannelId: optionalSnowflake,
  temporaryCategoryId: optionalSnowflake,
  maxTimeMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  minScore: decimalNumber(z.number().min(0).max(1000)).optional(),
  rejectionMessage: z.string().max(1200).optional()
  , manualQuestionMaxScore: decimalNumber(z.number().min(0).max(1000)).optional()
  , manualApproval: z.boolean().optional()
  , automaticApproval: z.boolean().optional()
  , releaseMode: z.enum(["immediate", "scheduled", "instructor"]).optional()
  , releaseAt: z.string().datetime().nullable().optional().or(z.literal(""))
  , attemptLimit: z.number().int().min(1).max(20).nullable().optional()
  , allowAnswerChange: z.boolean().optional()
  , showAnswersAfterExam: z.boolean().optional()
  , version: z.number().int().min(1).max(1000).optional()
  , examKey: z.string().max(120).nullable().optional().or(z.literal(""))
});
const examQuestionSchema = z.object({
  active: z.boolean().optional(),
  alternatives: z.array(z.object({ id: z.string().max(80).optional(), text: z.string().max(500), value: z.string().max(120).optional(), score: decimalNumber(z.number().min(0).max(1000)).optional(), isCorrect: z.boolean().optional(), order: z.number().int().min(0).optional() })).max(10).optional(),
  correctAlternativeId: z.string().max(80).nullable().optional(),
  correctAlternativeIds: z.array(z.string().max(80)).max(10).optional(),
  correctText: z.string().max(1000).nullable().optional().or(z.literal("")),
  description: z.string().max(1200).nullable().optional().or(z.literal("")),
  order: z.number().int().min(0).optional(),
  questionNumber: z.number().int().min(1).max(100).optional(),
  placeholder: z.string().max(300).nullable().optional().or(z.literal("")),
  points: decimalNumber(z.number().min(0).max(1000)).optional(),
  prompt: z.string().min(1).max(1200),
  title: z.string().max(1200).optional(),
  type: z.enum(["selection", "multiple", "written"])
});
const reorderExamQuestionsSchema = z.object({ questionIds: z.array(z.string().min(1)).max(500) });
const attemptSchema = z.object({ channelId: snowflake, courseId: z.string().min(1), instructorId: snowflake, publicationId: z.string().min(1), questionsSnapshot: z.array(z.any()).max(100).optional(), studentId: snowflake });
const answerSchema = z.object({
  question: examQuestionSchema.extend({ id: z.string().min(1), botId: z.string().nullable().optional(), guildId: z.string(), courseId: z.string(), createdAt: z.string().optional(), updatedAt: z.string().optional(), updatedBy: z.string().nullable().optional() }).optional(),
  questionId: z.string().min(1).nullable().optional(),
  questionIndex: z.number().int().min(0).nullable().optional(),
  selectedAlternativeId: z.string().min(1).max(80).nullable().optional(),
  selectedAlternativeIds: z.array(z.string().min(1).max(80)).max(10).nullable().optional(),
  writtenAnswer: z.string().max(3000).nullable().optional()
});
const identificationSchema = z.object({
  discordUsername: z.string().max(100).nullable().optional(),
  discordDisplayName: z.string().max(100).nullable().optional(),
  guildNickname: z.string().max(100).nullable().optional(),
  rpFullName: z.string().max(120).nullable().optional(),
  currentRank: z.enum(["CADET", "OFFICER", "SENIOR_OFFICER"]).nullable().optional(),
  rpId: z.string().max(32).nullable().optional(),
  confirm: z.boolean().optional()
});
const reviewSchema = z.object({ actorId: snowflake, manualScore: decimalNumber(z.number().min(0).max(1000)).nullable().optional(), rejectionReason: z.string().max(1000).nullable().optional(), status: z.enum(["approved", "rejected"]) });
const correctionMessageSchema = z.object({ messageId: snowflake });

coursesRouter.use(requireAuthOrBot);

coursesRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para ver cursos." });
    return res.json(await getCoursesDashboard(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

coursesRouter.patch("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para configurar cursos." });
    const settings = await saveCourseSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para publicar painel de cursos." });
    const settings = await requestCoursePanelPublish(botId, guildId, res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/:guildId/courses", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para cadastrar cursos." });
    const parsed = courseSchema.parse(req.body ?? {});
    const course = await createCourse(botId, guildId, { ...sanitizeCourse(parsed), name: parsed.name }, res.locals.dashboardAuth.user.discordId);
    return res.status(201).json({ course });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.patch("/:guildId/courses/:courseId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para editar cursos." });
    const parsed = courseSchema.partial({ name: true }).parse(req.body ?? {});
    const course = await updateCourse(botId, guildId, routeParam(req, "courseId"), sanitizeCourse(parsed), res.locals.dashboardAuth.user.discordId);
    if (!course) return res.status(404).json({ message: "Curso nao encontrado." });
    return res.json({ course });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.delete("/:guildId/courses/:courseId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para excluir cursos." });
    const course = await deleteCourse(botId, guildId, routeParam(req, "courseId"), res.locals.dashboardAuth.user.discordId);
    if (!course) return res.status(404).json({ message: "Curso nao encontrado." });
    return res.json({ course });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/:guildId/courses/:courseId/exam", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para ver provas." });
    return res.json(await getCourseExamDashboard(botId, guildId, routeParam(req, "courseId")));
  } catch (error) { return next(error); }
});

coursesRouter.patch("/:guildId/courses/:courseId/exam/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para configurar provas." });
    const settings = await saveCourseExamSettings(botId, guildId, routeParam(req, "courseId"), examSettingsSchema.parse(req.body ?? {}), res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) { return next(error); }
});

coursesRouter.post("/:guildId/courses/:courseId/exam/questions", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para criar perguntas." });
    const question = await createCourseExamQuestion(botId, guildId, routeParam(req, "courseId"), examQuestionSchema.parse(req.body ?? {}), res.locals.dashboardAuth.user.discordId);
    return res.status(201).json({ question });
  } catch (error) { return next(error); }
});

coursesRouter.patch("/:guildId/courses/:courseId/exam/questions/:questionId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para editar perguntas." });
    const question = await updateCourseExamQuestion(botId, guildId, routeParam(req, "courseId"), routeParam(req, "questionId"), examQuestionSchema.partial({ prompt: true }).parse(req.body ?? {}), res.locals.dashboardAuth.user.discordId);
    if (!question) return res.status(404).json({ message: "Pergunta nao encontrada." });
    return res.json({ question });
  } catch (error) { return next(error); }
});

coursesRouter.delete("/:guildId/courses/:courseId/exam/questions/:questionId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para excluir perguntas." });
    const question = await deleteCourseExamQuestion(botId, guildId, routeParam(req, "courseId"), routeParam(req, "questionId"), res.locals.dashboardAuth.user.discordId);
    if (!question) return res.status(404).json({ message: "Pergunta nao encontrada." });
    return res.json({ question });
  } catch (error) { return next(error); }
});

coursesRouter.post("/:guildId/courses/:courseId/exam/questions/:questionId/duplicate", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para duplicar perguntas." });
    const question = await duplicateCourseExamQuestion(botId, guildId, routeParam(req, "courseId"), routeParam(req, "questionId"), res.locals.dashboardAuth.user.discordId);
    if (!question) return res.status(404).json({ message: "Pergunta nao encontrada." });
    return res.status(201).json({ question });
  } catch (error) { return next(error); }
});

coursesRouter.post("/:guildId/courses/:courseId/exam/questions/reorder", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para reordenar perguntas." });
    const { questionIds } = reorderExamQuestionsSchema.parse(req.body ?? {});
    return res.json({ questions: await reorderCourseExamQuestions(botId, guildId, routeParam(req, "courseId"), questionIds, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

coursesRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json({ settings: await getCourseSettings(botId, guildId) });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/bot/:guildId/courses/:courseId/exam", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json(await getCourseExamRuntime(botId, guildId, routeParam(req, "courseId")));
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/exam-attempts", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.status(201).json({ attempt: await createOrResumeCourseExamAttempt(botId, guildId, attemptSchema.parse(req.body ?? {})) });
  } catch (error) { return next(error); }
});

coursesRouter.get("/bot/:guildId/exam-attempts/channel/:channelId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json({ attempt: await getCourseExamAttemptByChannel(botId, guildId, snowflake.parse(req.params.channelId)) });
  } catch (error) { return next(error); }
});

coursesRouter.get("/bot/:guildId/exam-attempts/:attemptId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const bundle = await getCourseExamAttemptBundle(botId, guildId, routeParam(req, "attemptId"));
    if (!bundle) return res.status(404).json({ message: "Tentativa nao encontrada." });
    return res.json(bundle);
  } catch (error) { return next(error); }
});

coursesRouter.patch("/bot/:guildId/exam-attempts/:attemptId/identification", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const attempt = await updateCourseExamIdentification(botId, guildId, routeParam(req, "attemptId"), identificationSchema.parse(req.body ?? {}));
    if (!attempt) return res.status(404).json({ message: "Tentativa nao encontrada." });
    return res.json({ attempt });
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/exam-attempts/:attemptId/answers", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const parsed = answerSchema.parse(req.body ?? {});
    const answer = await saveCourseExamAnswer(botId, guildId, routeParam(req, "attemptId"), {
      questionId: parsed.questionId ?? parsed.question?.id ?? null,
      questionIndex: parsed.questionIndex ?? parsed.question?.order ?? null,
      selectedAlternativeId: parsed.selectedAlternativeId,
      selectedAlternativeIds: parsed.selectedAlternativeIds,
      writtenAnswer: parsed.writtenAnswer
    });
    if (!answer) return res.status(409).json({ message: "Esta questão já foi respondida ou não está mais ativa." });
    return res.status(201).json({ answer });
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/exam-attempts/:attemptId/finalize", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const result = await finalizeCourseExamAttempt(botId, guildId, routeParam(req, "attemptId"));
    if (!result) return res.status(404).json({ message: "Tentativa nao encontrada." });
    return res.json(result);
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/exam-attempts/:attemptId/review", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const parsed = reviewSchema.parse(req.body ?? {});
    const attempt = await reviewCourseExamAttempt(botId, guildId, routeParam(req, "attemptId"), parsed.actorId, parsed.status, parsed.rejectionReason, parsed.manualScore);
    if (!attempt) return res.status(404).json({ message: "Tentativa nao encontrada." });
    return res.json({ attempt });
  } catch (error) { return next(error); }
});

coursesRouter.patch("/bot/:guildId/exam-attempts/:attemptId/correction-message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const { messageId } = correctionMessageSchema.parse(req.body ?? {});
    await setCourseExamCorrectionMessage(botId, guildId, routeParam(req, "attemptId"), messageId);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const settings = await saveCourseSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), req.get("x-actor-id") ?? null);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.patch("/bot/:guildId/panel-message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const { messageId } = messageStateSchema.parse(req.body ?? {});
    return res.json({ settings: await updateCoursePanelMessage(botId, guildId, messageId || null) });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/courses", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const parsed = courseSchema.parse(req.body ?? {});
    const course = await createCourse(botId, guildId, { ...sanitizeCourse(parsed), name: parsed.name }, req.get("x-actor-id") ?? null);
    return res.status(201).json({ course });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.patch("/bot/:guildId/courses/:courseId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const course = await updateCourse(botId, guildId, routeParam(req, "courseId"), sanitizeCourse(courseSchema.partial({ name: true }).parse(req.body ?? {})), req.get("x-actor-id") ?? null);
    if (!course) return res.status(404).json({ message: "Curso nao encontrado." });
    return res.json({ course });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/manageable", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = manageableSchema.parse(req.body ?? {});
    return res.json({ courses: await getManageableCourses(botId, guildId, input.userId, input.roleIds, input.isAdministrator) });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/bot/:guildId/courses/:courseId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const course = await getCourse(botId, guildId, routeParam(req, "courseId"));
    if (!course) return res.status(404).json({ message: "Curso nao encontrado." });
    return res.json({ course });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/publications", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const publication = await createCoursePublication(botId, guildId, sanitizePublication(publicationSchema.parse(req.body ?? {})));
    return res.status(201).json({ publication });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/bot/:guildId/publications", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = publicationListSchema.parse(req.query ?? {});
    return res.json({ publications: await listCoursePublications(botId, guildId, input.status ?? null) });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/bot/:guildId/publications/:publicationId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const publication = await getCoursePublication(botId, guildId, routeParam(req, "publicationId"));
    if (!publication) return res.status(404).json({ message: "Publicacao nao encontrada." });
    return res.json({ publication });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/bot/:guildId/publications/:publicationId/enrollments", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json({ enrollments: await getCoursePublicationEnrollments(botId, guildId, routeParam(req, "publicationId")) });
  } catch (error) { return next(error); }
});

coursesRouter.patch("/bot/:guildId/publications/:publicationId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = messageStateSchema.parse(req.body ?? {});
    return res.json({ publication: await updateCoursePublicationMessage(botId, guildId, routeParam(req, "publicationId"), input.messageId || null) });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/publications/:publicationId/join", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const result = await joinCoursePublication(botId, guildId, routeParam(req, "publicationId"), joinSchema.parse(req.body ?? {}));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

coursesRouter.patch("/bot/:guildId/publications/:publicationId/enrollment-channel", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const enrollment = await setCourseEnrollmentExamChannel(botId, guildId, routeParam(req, "publicationId"), enrollmentChannelSchema.parse(req.body ?? {}));
    if (!enrollment) return res.status(409).json({ message: "Inscrição, turma ou prova vinculada inválida." });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/publications/:publicationId/exam-reservation", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json(await reserveCourseExamStart(botId, guildId, routeParam(req, "publicationId"), studentExamSchema.parse(req.body ?? {}).studentId));
  } catch (error) { return next(error); }
});

coursesRouter.delete("/bot/:guildId/publications/:publicationId/exam-reservation", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    await releaseCourseExamStart(botId, guildId, routeParam(req, "publicationId"), studentExamSchema.parse(req.body ?? {}).studentId);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

coursesRouter.delete("/bot/:guildId/exam-channels/:channelId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    await expireCourseEnrollmentChannel(botId, guildId, snowflake.parse(req.params.channelId));
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

coursesRouter.post("/bot/:guildId/publications/:publicationId/leave", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const result = await leaveCoursePublication(botId, guildId, routeParam(req, "publicationId"), leaveSchema.parse(req.body ?? {}).userId);
    if (result.error === "not_found") return res.status(404).json({ message: "Publicacao nao encontrada." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/publications/:publicationId/status", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = statusSchema.parse(req.body ?? {});
    const publication = await setCoursePublicationStatus(botId, guildId, routeParam(req, "publicationId"), input.status, input.actorId);
    if (!publication) return res.status(404).json({ message: "Publicacao nao encontrada." });
    return res.json({ publication });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/schedules", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const request = await createScheduleRequest(botId, guildId, sanitizeSchedule(scheduleSchema.parse(req.body ?? {})));
    return res.status(201).json({ request });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.get("/bot/:guildId/schedules/:requestId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const request = await getScheduleRequest(botId, guildId, routeParam(req, "requestId"));
    if (!request) return res.status(404).json({ message: "Solicitacao nao encontrada." });
    return res.json({ request });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/schedules/:requestId/decision", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = scheduleDecisionSchema.parse(req.body ?? {});
    const request = await updateScheduleRequest(botId, guildId, routeParam(req, "requestId"), { decidedAt: new Date(), decidedBy: input.actorId, status: input.status });
    if (!request) return res.status(404).json({ message: "Solicitacao nao encontrada." });
    return res.json({ request });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.patch("/bot/:guildId/schedules/:requestId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = messageStateSchema.parse(req.body ?? {});
    const request = await updateScheduleRequest(botId, guildId, routeParam(req, "requestId"), { messageId: input.messageId || null });
    if (!request) return res.status(404).json({ message: "Solicitacao nao encontrada." });
    return res.json({ request });
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/reports", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = reportSchema.parse(req.body ?? {});
    const report = await createCourseReport(botId, guildId, {
      ...input,
      channelId: input.channelId || null,
      messageId: input.messageId || null,
      students: input.students.map((student) => ({ ...student, observation: student.observation || null }))
    });
    return res.status(201).json({ report });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string) {
  return (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, COURSES_MODULE_ID))
    || canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManage(req: Request, guildId: string, botId: string) {
  return (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, COURSES_MODULE_ID))
    || canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const validGuildId = snowflake.parse(guildId);
  if (!botId) throw Object.assign(new Error("Bot nao identificado."), { statusCode: 403 });
  const authorization = await authorizeBotRuntimeModule({ botId, guildId: validGuildId, moduleId: COURSES_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
  return botId;
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  const output: Record<string, unknown> = { ...input };
  for (const key of [
    "globalBannerUrl",
    "logChannelId",
    "scheduleLogChannelId",
    "proofLogChannelId",
    "resultChannelId",
    "evaluationChannelId",
    "adminLogChannelId",
    "tempProofCategoryId",
    "evaluatorMentionRoleId",
    "resultMentionRoleId",
    "publishChannelId",
    "reportChannelId",
    "reportImageUrl",
    "scheduleChannelId",
    "temporaryCategoryId"
  ] as const) {
    if (key in input) output[key] = input[key] || null;
  }

  if ("images" in input) {
    output.images = input.images?.map((image) => ({
      id: image.id ?? image._id ?? randomUUID(),
      botId: image.botId ?? null,
      guildId: image.guildId ?? "",
      name: image.name,
      type: image.type,
      url: image.url,
      createdAt: image.createdAt ?? new Date().toISOString(),
      createdBy: image.createdBy ?? null,
      active: image.active ?? true,
      default: image.default ?? false
    }));
  }

  return output;
}

function sanitizeCourse(input: Partial<z.infer<typeof courseSchema>>) {
  return {
    ...input,
    bannerUrl: input.bannerUrl || null,
    proofBannerUrl: input.proofBannerUrl || null,
    cancelledText: input.cancelledText || null,
    code: input.code || null,
    description: input.description || null,
    emoji: input.emoji || null,
    footerImageUrl: input.footerImageUrl || null,
    location: input.location || null,
    defaultSchedule: input.defaultSchedule || null,
    publishChannelId: input.publishChannelId || null,
    publishText: input.publishText || null,
    proofInstructionText: input.proofInstructionText || null,
    startedText: input.startedText || null,
    thumbnailUrl: input.thumbnailUrl || null
  };
}

function sanitizePublication(input: z.infer<typeof publicationSchema>) {
  return { ...input, notes: input.notes || null };
}

function sanitizeSchedule(input: z.infer<typeof scheduleSchema>) {
  return { ...input, channelId: input.channelId || null, notes: input.notes || null };
}

function routeParam(req: Request, name: string) {
  return z.string().min(1).parse(req.params[name]);
}
