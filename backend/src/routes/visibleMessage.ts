import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  addVisibleMessageUser,
  clearVisibleMessageUsers,
  getVisibleMessageDashboard,
  getVisibleMessageUser,
  isVisibleMessageUserEnabled,
  listVisibleMessageUsers,
  removeVisibleMessageUser,
  setVisibleMessageUserEnabled,
  VISIBLE_MESSAGE_MODULE_ID
} from "../services/visibleMessageService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const userSchema = z.object({
  avatarUrl: z.string().url().max(500).nullable().optional(),
  userId: snowflake,
  username: z.string().max(120).nullable().optional()
});
const statusSchema = z.object({ enabled: z.boolean() });

export const visibleMessageRouter = Router();

visibleMessageRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getVisibleMessageDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.post("/:guildId/users", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.status(201).json({
      user: await addVisibleMessageUser(botId, guildId, userSchema.parse(req.body), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.delete("/:guildId/users/:userId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const userId = snowflake.parse(req.params.userId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ user: await removeVisibleMessageUser(botId, guildId, userId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.delete("/:guildId/users", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ users: await clearVisibleMessageUsers(botId, guildId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.get("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ users: await listVisibleMessageUsers(botId, guildId) });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.get("/bot/:guildId/users/:userId/enabled", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      enabled: await isVisibleMessageUserEnabled(botId, guildId, snowflake.parse(req.params.userId))
    });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.get("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      user: await getVisibleMessageUser(botId, guildId, snowflake.parse(req.params.userId))
    });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.patch("/bot/:guildId/users/:userId/status", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      user: await setVisibleMessageUserEnabled(
        botId,
        guildId,
        snowflake.parse(req.params.userId),
        statusSchema.parse(req.body).enabled,
        req.header("x-actor-id") ?? null
      )
    });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.post("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.status(201).json({
      user: await addVisibleMessageUser(botId, guildId, userSchema.parse(req.body), req.header("x-actor-id") ?? null)
    });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.delete("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      user: await removeVisibleMessageUser(botId, guildId, snowflake.parse(req.params.userId), req.header("x-actor-id") ?? null)
    });
  } catch (error) {
    next(error);
  }
});

visibleMessageRouter.delete("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ users: await clearVisibleMessageUsers(botId, guildId, req.header("x-actor-id") ?? null) });
  } catch (error) {
    next(error);
  }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string, guildId?: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(VISIBLE_MESSAGE_MODULE_ID)) throw routeError("Mensagem Visível não liberada.", 403);

  if (guildId) {
    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: VISIBLE_MESSAGE_MODULE_ID });
    if (!authorization.allowed) throw routeError(authorization.reason, 403);
  }
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, VISIBLE_MESSAGE_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, VISIBLE_MESSAGE_MODULE_ID);

  if (!allowed) throw routeError("Sem permissão para Mensagem Visível.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
