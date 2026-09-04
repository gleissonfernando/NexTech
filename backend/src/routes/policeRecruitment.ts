import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  createPoliceRecruitmentQuestion,
  cancelPoliceRecruitmentSession,
  createPoliceRecruitmentSession,
  deletePoliceRecruitmentQuestion,
  ensurePoliceRecruitmentForum,
  finishPoliceRecruitmentSession,
  getPoliceRecruitmentRecruiter,
  getPoliceRecruitmentReport,
  getPoliceReportsDashboard,
  getPoliceRecruitmentSession,
  getPoliceRecruitmentSessionByChannel,
  getPoliceRecruitmentSettings,
  listPoliceRecruitmentExpiredSessions,
  listPoliceRecruitmentQuestions,
  listPoliceRecruitmentReports,
  movePoliceRecruitmentQuestion,
  POLICE_RECRUITMENT_MODULE_ID,
  requestPoliceRecruitmentPanelPublish,
  reorderPoliceRecruitmentQuestion,
  savePoliceRecruitmentAnswer,
  savePoliceRecruitmentSettings,
  selectPoliceRecruitmentUser,
  setPoliceRecruitmentSessionChannel,
  updatePoliceRecruitmentQuestion,
  updatePoliceRecruitmentReportPublication
} from "../services/policeRecruitmentService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const id = z.string().uuid();
const roleIds = z.array(snowflake).max(100);
const settingsSchema = z.object({
  adminRoleIds: roleIds.optional(),
  authorizedRoleIds: roleIds.optional(),
  corporationName: z.string().trim().min(1).max(100).optional(),
  deleteDelaySeconds: z.coerce.number().int().min(0).max(600).optional(),
  deleteRoleIds: roleIds.optional(),
  editorRoleIds: roleIds.optional(),
  enabled: z.boolean().optional(),
  forumChannelId: snowflake.nullable().optional(),
  logChannelId: snowflake.nullable().optional(),
  panelChannelId: snowflake.nullable().optional(),
  panelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  panelMessageId: snowflake.nullable().optional(),
  configured: z.boolean().optional(),
  createReportRoleIds: roleIds.optional(),
  deleteReportRoleIds: roleIds.optional(),
  editReportRoleIds: roleIds.optional(),
  manageConfigurationRoleIds: roleIds.optional(),
  manageQuestionsRoleIds: roleIds.optional(),
  recruiterRoleIds: roleIds.optional(),
  reportsForumChannelId: snowflake.nullable().optional(),
  sessionExpirationHours: z.coerce.number().min(1).max(168).optional(),
  sessionExpirationMinutes: z.coerce.number().min(1).max(10080).optional(),
  supervisorRoleIds: roleIds.optional(),
  temporaryCategoryId: snowflake.nullable().optional(),
  viewerRoleIds: roleIds.optional(),
  viewAllReportsRoleIds: roleIds.optional()
});
const questionSchema = z.object({
  description: z.string().trim().max(600).nullable().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(25).optional(),
  required: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["TEXT", "LONG_TEXT", "NUMBER", "DATE", "TIME", "USER_SELECT", "ROLE_SELECT", "SELECT", "MULTI_SELECT", "BOOLEAN"]).optional()
});
const actorSchema = z.object({ actorId: snowflake });
const userSnapshotSchema = z.object({ avatar: z.string().max(2048).nullable(), discordId: snowflake, displayName: z.string().max(100), username: z.string().max(100) });

export const policeRecruitmentRouter = Router();

policeRecruitmentRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getPoliceReportsDashboard(botId, guildId));
  } catch (error) { next(error); }
});

policeRecruitmentRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await savePoliceRecruitmentSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/:guildId/reports/:reportId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json({ report: await getPoliceRecruitmentReport(botId, id.parse(req.params.reportId)) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/:guildId/panel", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json(await requestPoliceRecruitmentPanelPublish(botId, guildId, res.locals.dashboardAuth.user.discordId));
  } catch (error) { next(error); }
});

// Refazer a criação do fórum quando a ativação aconteceu com o bot offline.
policeRecruitmentRouter.post("/:guildId/forum", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json(await ensurePoliceRecruitmentForum(botId, guildId, res.locals.dashboardAuth.user.discordId));
  } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/:guildId/questions", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    const input = questionSchema.parse(req.body ?? {});
    res.status(201).json({ question: await createPoliceRecruitmentQuestion(botId, guildId, sanitizeQuestionInput(input), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.patch("/:guildId/questions/:questionId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    const input = questionSchema.parse(req.body ?? {});
    res.json({ question: await updatePoliceRecruitmentQuestion(botId, guildId, id.parse(req.params.questionId), sanitizeQuestionInput(input), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.delete("/:guildId/questions/:questionId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ question: await deletePoliceRecruitmentQuestion(botId, guildId, id.parse(req.params.questionId), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/:guildId/questions/:questionId/move", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    const direction = z.object({ direction: z.enum(["up", "down"]) }).parse(req.body ?? {});
    res.json({ questions: await reorderPoliceRecruitmentQuestion(botId, guildId, id.parse(req.params.questionId), direction.direction, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ settings: await getPoliceRecruitmentSettings(botId, snowflake.parse(req.params.guildId)) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const actorId = typeof req.header("x-actor-id") === "string" ? req.header("x-actor-id")! : null; res.json({ settings: await savePoliceRecruitmentSettings(botId, snowflake.parse(req.params.guildId), settingsSchema.parse(req.body), actorId) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/:guildId/questions", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ questions: await listPoliceRecruitmentQuestions(botId, snowflake.parse(req.params.guildId)) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/:guildId/questions", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const guildId = snowflake.parse(req.params.guildId); const input = questionSchema.parse(req.body ?? {}); res.status(201).json({ question: await createPoliceRecruitmentQuestion(botId, guildId, sanitizeQuestionInput(input), req.header("x-actor-id") ?? null) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/:guildId/panel", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const guildId = snowflake.parse(req.params.guildId); res.json(await requestPoliceRecruitmentPanelPublish(botId, guildId, req.header("x-actor-id") ?? null)); } catch (error) { next(error); }
});

policeRecruitmentRouter.patch("/bot/:guildId/questions/:questionId", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const guildId = snowflake.parse(req.params.guildId); const input = questionSchema.parse(req.body ?? {}); res.json({ question: await updatePoliceRecruitmentQuestion(botId, guildId, id.parse(req.params.questionId), sanitizeQuestionInput(input), req.header("x-actor-id") ?? null) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/:guildId/questions/:questionId/move", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const guildId = snowflake.parse(req.params.guildId); const direction = z.object({ direction: z.enum(["up", "down"]) }).parse(req.body ?? {}); res.json({ questions: await reorderPoliceRecruitmentQuestion(botId, guildId, id.parse(req.params.questionId), direction.direction, req.header("x-actor-id") ?? null) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.delete("/bot/:guildId/questions/:questionId", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const guildId = snowflake.parse(req.params.guildId); res.json({ question: await deletePoliceRecruitmentQuestion(botId, guildId, id.parse(req.params.questionId), req.header("x-actor-id") ?? null) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/sessions", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = z.object({ guildId: snowflake, recruiter: userSnapshotSchema.extend({ policeId: z.string().max(40).nullable().optional() }) }).parse(req.body);
    res.status(201).json({ session: await createPoliceRecruitmentSession({ botId, ...input }) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.patch("/bot/sessions/:sessionId/channel", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const input = z.object({ channelId: snowflake, panelMessageId: snowflake }).parse(req.body); res.json({ session: await setPoliceRecruitmentSessionChannel(botId, id.parse(req.params.sessionId), input.channelId, input.panelMessageId) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/sessions/:sessionId/recruited", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const input = userSnapshotSchema.extend({ actorId: snowflake }).parse(req.body); res.json({ session: await selectPoliceRecruitmentUser(botId, id.parse(req.params.sessionId), input.actorId, input) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/sessions/:sessionId/answers", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = z.object({ actorId: snowflake, move: z.enum(["stay", "next", "previous"]).optional(), questionId: id, value: z.union([z.string().max(1800), z.array(z.string().max(200)).max(25), z.boolean(), z.number(), z.null()]) }).parse(req.body);
    res.json({ session: await savePoliceRecruitmentAnswer(botId, id.parse(req.params.sessionId), input.actorId, input.questionId, input.value, input.move) });
  } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/sessions/:sessionId/move", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const input = actorSchema.extend({ direction: z.enum(["next", "previous"]) }).parse(req.body); res.json({ session: await movePoliceRecruitmentQuestion(botId, id.parse(req.params.sessionId), input.actorId, input.direction) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/sessions/:sessionId/finish", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const input = actorSchema.parse(req.body); res.json({ report: await finishPoliceRecruitmentSession(botId, id.parse(req.params.sessionId), input.actorId) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.post("/bot/sessions/:sessionId/cancel", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const input = actorSchema.extend({ status: z.enum(["CANCELLED", "EXPIRED"]).optional() }).parse(req.body); res.json({ session: await cancelPoliceRecruitmentSession(botId, id.parse(req.params.sessionId), input.actorId, input.status) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/sessions/channel/:channelId", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ session: await getPoliceRecruitmentSessionByChannel(botId, snowflake.parse(req.params.channelId)) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/sessions/:sessionId", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ session: await getPoliceRecruitmentSession(botId, id.parse(req.params.sessionId)) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/sessions/expired/list", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ sessions: await listPoliceRecruitmentExpiredSessions(botId) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/:guildId/recruiters/:discordId", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ recruiter: await getPoliceRecruitmentRecruiter(botId, snowflake.parse(req.params.guildId), snowflake.parse(req.params.discordId)) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/:guildId/reports", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ reports: await listPoliceRecruitmentReports(botId, snowflake.parse(req.params.guildId), { query: typeof req.query.q === "string" ? req.query.q : null, recruitedDiscordId: typeof req.query.recruitedDiscordId === "string" ? snowflake.parse(req.query.recruitedDiscordId) : null, recruiterDiscordId: typeof req.query.recruiterDiscordId === "string" ? snowflake.parse(req.query.recruiterDiscordId) : null }) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.get("/bot/reports/:reportId", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); res.json({ report: await getPoliceRecruitmentReport(botId, id.parse(req.params.reportId)) }); } catch (error) { next(error); }
});

policeRecruitmentRouter.patch("/bot/reports/:reportId/publication", requireBot, async (req, res, next) => {
  try { const botId = await botIdFor(req); await licensed(botId); const input = z.object({ forumMessageId: snowflake.nullable(), forumThreadId: snowflake }).parse(req.body); res.json({ report: await updatePoliceRecruitmentReportPublication(botId, id.parse(req.params.reportId), input.forumThreadId, input.forumMessageId) }); } catch (error) { next(error); }
});

async function botIdFor(req: any) { const value = await resolveRequestBotId(req); if (!value) throw routeError("Bot não identificado.", 400); return value; }
async function licensed(botId: string) { const permissions = await getBotApiPermissions(botId); if (!permissions) throw routeError("Bot não encontrado.", 404); if (!permissions.enabledModules.includes(POLICE_RECRUITMENT_MODULE_ID)) throw routeError("Recrutamento policial não liberado.", 403); }
async function authorize(user: any, botId: string, guildId: string, manage: boolean) { await licensed(botId); const allowed = manage ? await canUseDevBotModule(user, botId, guildId, POLICE_RECRUITMENT_MODULE_ID) : await canReadDevBotModule(user, botId, guildId, POLICE_RECRUITMENT_MODULE_ID); if (!allowed) throw routeError("Sem permissão para recrutamento policial.", 403); }
function sanitizeQuestionInput(input: z.infer<typeof questionSchema>) {
  return {
    ...input,
    description: input.description === "" ? null : input.description,
    options: input.options ?? []
  };
}
function routeError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
