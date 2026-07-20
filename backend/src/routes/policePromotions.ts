import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  addPolicePromotionHistory,
  assignPolicePromotionEvaluator,
  clonePolicePromotionRequest,
  closePolicePromotionRequest,
  createPolicePromotionLog,
  createPolicePromotionRequest,
  decidePolicePromotionRequest,
  findPolicePromotionRequestByChannel,
  finishPolicePromotionEvaluation,
  getPolicePromotionDashboard,
  getPolicePromotionRequest,
  getPolicePromotionSettings,
  POLICE_PROMOTIONS_MODULE_ID,
  savePolicePromotionSettings,
  updatePolicePromotionApprovalMessage,
  updatePolicePromotionTicketState
} from "../services/policePromotionService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const id = z.string().uuid();
const nullableSnowflake = snowflake.nullable();
const questionType = z.enum(["short", "paragraph", "number", "date", "time", "select", "checkbox", "radio"]);
const answerSchema = z.object({
  questionId: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  type: questionType,
  value: z.union([z.string().max(1000), z.array(z.string().max(200)).max(25)])
});
const questionSchema = z.object({
  active: z.boolean(),
  defaultValue: z.string().max(500).nullable(),
  description: z.string().max(300).nullable(),
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  maxLength: z.coerce.number().int().min(1).max(1000).nullable(),
  options: z.array(z.string().min(1).max(80)).max(25),
  order: z.coerce.number().int(),
  placeholder: z.string().max(120).nullable(),
  required: z.boolean(),
  type: questionType
});
const promotionSchema = z.object({
  active: z.boolean(),
  approvalRoleIds: z.array(snowflake).max(100),
  categoryId: nullableSnowflake,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  description: z.string().max(1200),
  emoji: z.string().max(80).nullable(),
  evaluatorRoleIds: z.array(snowflake).max(100),
  grantedRoleId: nullableSnowflake,
  historyChannelId: nullableSnowflake,
  id: z.string().min(1).max(120),
  logChannelId: nullableSnowflake,
  name: z.string().min(1).max(120),
  panelChannelId: nullableSnowflake,
  panelDescription: z.string().max(1200),
  panelMessageId: nullableSnowflake,
  panelTitle: z.string().max(200),
  receivedRankName: z.string().min(1).max(100),
  rejectedRoleIds: z.array(snowflake).max(100),
  removedRoleId: nullableSnowflake,
  requestNewEvaluationEnabled: z.boolean(),
  questions: z.array(questionSchema).max(100)
});
const settingsSchema = z.object({
  defaultApprovalChannelId: nullableSnowflake.optional(),
  defaultCategoryId: nullableSnowflake.optional(),
  defaultHistoryChannelId: nullableSnowflake.optional(),
  defaultLogChannelId: nullableSnowflake.optional(),
  defaultPanelChannelId: nullableSnowflake.optional(),
  enabled: z.boolean().optional(),
  promotions: z.array(promotionSchema).max(50).optional()
});
const createRequestSchema = z.object({
  answers: z.array(answerSchema).max(100),
  guildId: snowflake,
  previousRequestId: id.nullable().optional(),
  promotionId: z.string().min(1).max(120),
  requesterId: snowflake,
  requesterName: z.string().min(1).max(100)
});
const ticketStateSchema = z.object({
  channelId: snowflake.nullable().optional(),
  channelMessageId: snowflake.nullable().optional(),
  logChannelId: snowflake.nullable().optional()
});
const actorSchema = z.object({
  actorId: snowflake.nullable().optional(),
  actorName: z.string().max(100).nullable().optional()
});

export const policePromotionsRouter = Router();

policePromotionsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getPolicePromotionDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await savePolicePromotionSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getPolicePromotionSettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ request: await createPolicePromotionRequest(botId, createRequestSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.get("/bot/requests/:requestId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ request: await getPolicePromotionRequest(botId, id.parse(req.params.requestId)) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.get("/bot/channels/:channelId/request", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ request: await findPolicePromotionRequestByChannel(botId, snowflake.parse(req.params.channelId)) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests/:requestId/new-evaluation", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ request: await clonePolicePromotionRequest(botId, id.parse(req.params.requestId), actorSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.patch("/bot/requests/:requestId/ticket", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ request: await updatePolicePromotionTicketState(botId, id.parse(req.params.requestId), ticketStateSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests/:requestId/assign", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = z.object({ evaluatorId: snowflake, evaluatorName: z.string().min(1).max(100) }).parse(req.body);
    res.json({ request: await assignPolicePromotionEvaluator(botId, id.parse(req.params.requestId), input) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests/:requestId/evaluation", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = z.object({
      evaluationNotes: z.string().min(1).max(2000),
      evaluationResult: z.enum(["approved", "rejected"]),
      evaluatorId: snowflake
    }).parse(req.body);
    res.json({ request: await finishPolicePromotionEvaluation(botId, id.parse(req.params.requestId), input) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.patch("/bot/requests/:requestId/approval-message", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = z.object({ approvalChannelId: snowflake.nullable().optional(), approvalMessageId: snowflake.nullable().optional() }).parse(req.body);
    res.json({ request: await updatePolicePromotionApprovalMessage(botId, id.parse(req.params.requestId), input) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests/:requestId/decision", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = z.object({
      actorId: snowflake,
      actorName: z.string().min(1).max(100),
      approvalReason: z.string().max(1000).nullable().optional(),
      result: z.enum(["approved", "rejected"])
    }).parse(req.body);
    res.json({ request: await decidePolicePromotionRequest(botId, id.parse(req.params.requestId), input) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests/:requestId/close", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = actorSchema.extend({ status: z.enum(["cancelled", "closed"]).optional() }).parse(req.body);
    res.json({ request: await closePolicePromotionRequest(botId, id.parse(req.params.requestId), input, input.status ?? "closed") });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/requests/:requestId/history", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const input = actorSchema.extend({ action: z.string().min(1).max(120), metadata: z.record(z.unknown()).optional() }).parse(req.body);
    res.json({ request: await addPolicePromotionHistory(botId, id.parse(req.params.requestId), input.action, input, input.metadata ?? {}) });
  } catch (error) {
    next(error);
  }
});

policePromotionsRouter.post("/bot/logs", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const body = z.object({
      action: z.string().min(1).max(120),
      actorId: snowflake.nullable().optional(),
      actorName: z.string().max(100).nullable().optional(),
      guildId: snowflake,
      metadata: z.record(z.unknown()).optional(),
      requestId: id.nullable().optional()
    }).parse(req.body);
    await createPolicePromotionLog(botId, body.guildId, body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(POLICE_PROMOTIONS_MODULE_ID)) throw routeError("Sistema de Promoções não liberado.", 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, POLICE_PROMOTIONS_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, POLICE_PROMOTIONS_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para Sistema de Promoções.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
