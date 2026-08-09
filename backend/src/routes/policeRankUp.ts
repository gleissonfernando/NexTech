import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  createPoliceRankUpLog,
  createPoliceRankUpRequest,
  decidePoliceRankUpRequest,
  findPoliceRankUpRequestByChannel,
  getPoliceRankUpDashboard,
  getPoliceRankUpRequest,
  getPoliceRankUpSettings,
  POLICE_RANK_UP_MODULE_ID,
  requestPoliceRankUpPanelPublish,
  savePoliceRankUpSettings,
  updatePoliceRankUpRequestChannel
} from "../services/policeRankUpService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const nullableSnowflake = snowflake.nullable();
const id = z.string().uuid();
const permission = z.enum(["view", "approve", "reject", "cancel", "manage_ranks", "manage_channels", "publish_panel", "view_logs", "manage_responsibles"]);
const rankSchema = z.object({
  allowSkip: z.boolean(),
  allowedPreviousRanks: z.array(z.string().min(1).max(80)).max(100),
  createdAt: z.preprocess((value) => typeof value === "string" ? new Date(value) : value, z.date()),
  description: z.string().max(100).nullable(),
  emoji: z.string().max(80).nullable(),
  enabled: z.boolean(),
  hierarchyPosition: z.coerce.number().int().min(1).max(1000),
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  roleId: z.string().max(32),
  updatedAt: z.preprocess((value) => typeof value === "string" ? new Date(value) : value, z.date())
});
const settingsSchema = z.object({
  adminChannelId: nullableSnowflake.optional(),
  adminRoleIds: z.array(snowflake).max(100).optional(),
  adminUserIds: z.array(snowflake).max(100).optional(),
  allowRequesterCancel: z.boolean().optional(),
  approvedDeleteSeconds: z.coerce.number().int().min(0).max(3600).optional(),
  autoDeleteChannels: z.boolean().optional(),
  blockDemotions: z.boolean().optional(),
  blockMultipleRanks: z.boolean().optional(),
  enabled: z.boolean().optional(),
  logChannelId: nullableSnowflake.optional(),
  mentionResponsibles: z.boolean().optional(),
  minRequestIntervalHours: z.coerce.number().int().min(0).max(8760).optional(),
  notifyByDm: z.boolean().optional(),
  onlyNextRank: z.boolean().optional(),
  panelChannelId: nullableSnowflake.optional(),
  panelMessage: z.string().max(1500).optional(),
  panelMessageId: nullableSnowflake.optional(),
  permissions: z.object({
    roles: z.record(z.array(permission).max(20)),
    users: z.record(z.array(permission).max(20))
  }).optional(),
  ranks: z.array(rankSchema).max(100).optional(),
  rejectedDeleteSeconds: z.coerce.number().int().min(0).max(3600).optional(),
  requireApprovalForInitialRank: z.boolean().optional(),
  responsibleRoleIds: z.array(snowflake).max(100).optional(),
  responsibleUserIds: z.array(snowflake).max(100).optional(),
  temporaryCategoryId: nullableSnowflake.optional(),
  temporaryChannelName: z.string().min(1).max(80).optional()
});
const createRequestSchema = z.object({
  currentRankId: z.string().max(80).nullable().optional(),
  currentRoleId: nullableSnowflake.optional(),
  guildId: snowflake,
  requestedRankId: z.string().min(1).max(80),
  temporaryChannelId: nullableSnowflake.optional(),
  userDisplayName: z.string().min(1).max(120),
  userId: snowflake,
  username: z.string().min(1).max(120)
});

export const policeRankUpRouter = Router();

policeRankUpRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getPoliceRankUpDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await savePoliceRankUpSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.post("/:guildId/publish", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await requestPoliceRankUpPanelPublish(botId, guildId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ settings: await getPoliceRankUpSettings(botId, guildId) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ settings: await savePoliceRankUpSettings(botId, guildId, settingsSchema.parse(req.body), req.header("x-actor-id") ?? null) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.post("/bot/requests", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const input = createRequestSchema.parse(req.body);
    await licensed(botId, input.guildId);
    res.status(201).json({ request: await createPoliceRankUpRequest(botId, input) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.get("/bot/requests/:requestId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    res.json({ request: await getPoliceRankUpRequest(botId, id.parse(req.params.requestId)) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.get("/bot/channels/:channelId/request", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    res.json({ request: await findPoliceRankUpRequestByChannel(botId, snowflake.parse(req.params.channelId)) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.patch("/bot/requests/:requestId/channel", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const input = z.object({ messageId: nullableSnowflake.optional(), temporaryChannelId: nullableSnowflake.optional() }).parse(req.body);
    res.json({ request: await updatePoliceRankUpRequestChannel(botId, id.parse(req.params.requestId), input) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.post("/bot/requests/:requestId/decision", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const input = z.object({
      actorId: snowflake,
      actorName: z.string().max(120).nullable().optional(),
      errorReason: z.string().max(1200).nullable().optional(),
      reason: z.string().max(1200).nullable().optional(),
      result: z.enum(["approved", "rejected", "cancelled", "error"])
    }).parse(req.body);
    res.json({ request: await decidePoliceRankUpRequest(botId, id.parse(req.params.requestId), input) });
  } catch (error) {
    next(error);
  }
});

policeRankUpRouter.post("/bot/logs", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const input = z.object({
      action: z.string().min(1).max(120),
      actorId: snowflake.nullable().optional(),
      actorName: z.string().max(120).nullable().optional(),
      guildId: snowflake,
      metadata: z.record(z.unknown()).optional(),
      requestId: id.nullable().optional()
    }).parse(req.body);
    await licensed(botId, input.guildId);
    await createPoliceRankUpLog(botId, input.guildId, input);
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

async function licensed(botId: string, guildId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(POLICE_RANK_UP_MODULE_ID)) throw routeError("Sistema de UP não liberado.", 403);
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: POLICE_RANK_UP_MODULE_ID });
  if (!authorization.allowed) throw routeError(authorization.reason, 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId, guildId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, POLICE_RANK_UP_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, POLICE_RANK_UP_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para Sistema de UP.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
