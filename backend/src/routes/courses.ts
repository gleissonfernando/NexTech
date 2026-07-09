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
  getCourse,
  getCoursePublication,
  getCoursesDashboard,
  getCourseSettings,
  getManageableCourses,
  getScheduleRequest,
  joinCoursePublication,
  leaveCoursePublication,
  requestCoursePanelPublish,
  saveCourseSettings,
  setCoursePublicationStatus,
  updateCourse,
  updateCoursePanelMessage,
  updateCoursePublicationMessage,
  updateScheduleRequest
} from "../services/courseService";

export const coursesRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = snowflake.nullable().optional().or(z.literal(""));
const courseSchema = z.object({
  active: z.boolean().optional(),
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  buttonLabels: z.object({
    cancel: z.string().min(1).max(40),
    enter: z.string().min(1).max(40),
    leave: z.string().min(1).max(40),
    start: z.string().min(1).max(40)
  }).optional(),
  cancelledText: z.string().max(900).nullable().optional().or(z.literal("")),
  color: z.string().max(24).optional(),
  description: z.string().max(1200).nullable().optional().or(z.literal("")),
  emoji: z.string().max(80).nullable().optional().or(z.literal("")),
  footerImageUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  imagePosition: z.enum(["top", "bottom", "side", "footer"]).optional(),
  instructorRoleIds: z.array(snowflake).optional(),
  instructorUserIds: z.array(snowflake).optional(),
  name: z.string().min(1).max(120),
  publishText: z.string().max(1200).nullable().optional().or(z.literal("")),
  startedText: z.string().max(900).nullable().optional().or(z.literal("")),
  thumbnailUrl: z.string().max(2048).nullable().optional().or(z.literal(""))
});
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).optional(),
  adminUserIds: z.array(snowflake).optional(),
  buttonEmojis: z.object({
    cancel: z.string().max(20),
    enter: z.string().max(20),
    leave: z.string().max(20),
    start: z.string().max(20)
  }).optional(),
  cancelledMessage: z.string().max(900).optional(),
  defaultExpirationHours: z.number().int().min(1).max(720).nullable().optional(),
  globalBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
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
const joinSchema = z.object({ userId: snowflake });
const statusSchema = z.object({ actorId: snowflake, status: z.enum(["started", "cancelled", "closed"]) });
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

coursesRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json({ settings: await getCourseSettings(botId, guildId) });
  } catch (error) {
    return next(error);
  }
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
    const result = await joinCoursePublication(botId, guildId, routeParam(req, "publicationId"), joinSchema.parse(req.body ?? {}).userId);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

coursesRouter.post("/bot/:guildId/publications/:publicationId/leave", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const publication = await leaveCoursePublication(botId, guildId, routeParam(req, "publicationId"), joinSchema.parse(req.body ?? {}).userId);
    if (!publication) return res.status(404).json({ message: "Publicacao nao encontrada." });
    return res.json({ publication });
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
  return {
    ...input,
    globalBannerUrl: input.globalBannerUrl || null,
    logChannelId: input.logChannelId || null,
    publishChannelId: input.publishChannelId || null,
    reportChannelId: input.reportChannelId || null,
    reportImageUrl: input.reportImageUrl || null,
    scheduleChannelId: input.scheduleChannelId || null,
    temporaryCategoryId: input.temporaryCategoryId || null
  };
}

function sanitizeCourse(input: Partial<z.infer<typeof courseSchema>>) {
  return {
    ...input,
    bannerUrl: input.bannerUrl || null,
    cancelledText: input.cancelledText || null,
    description: input.description || null,
    emoji: input.emoji || null,
    footerImageUrl: input.footerImageUrl || null,
    publishText: input.publishText || null,
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
