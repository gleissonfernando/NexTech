import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  addMessageControlUser,
  clearMessageControlUsers,
  getMessageControlDashboard,
  getMessageControlSettings,
  getMessageControlUser,
  listMessageControlUsers,
  MESSAGE_CONTROL_MODULE_ID,
  removeMessageControlUser,
  saveMessageControlSettings,
  setMessageControlUserStatus
} from "../services/messageControlService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const userSchema = z.object({
  avatarUrl: z.string().url().max(500).nullable().optional(),
  discordId: snowflake,
  username: z.string().max(120).nullable().optional()
});
const legacyUserSchema = z.object({
  avatarUrl: z.string().url().max(500).nullable().optional(),
  userId: snowflake,
  username: z.string().max(120).nullable().optional()
});
const statusSchema = z.object({ status: z.enum(["equipe", "pessoal"]) });
const settingsSchema = z.object({
  managerRoleIds: z.array(snowflake).max(100).optional(),
  managerUserIds: z.array(snowflake).max(100).optional()
});

export const messageControlRouter = Router();

messageControlRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getMessageControlDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

messageControlRouter.post("/:guildId/users", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.status(201).json({
      user: await addMessageControlUser(botId, guildId, parseUser(req.body), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.delete("/:guildId/users/:discordId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const discordId = snowflake.parse(req.params.discordId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ user: await removeMessageControlUser(botId, guildId, discordId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.delete("/:guildId/users", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ users: await clearMessageControlUsers(botId, guildId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({
      settings: await saveMessageControlSettings(
        botId,
        guildId,
        settingsSchema.parse(req.body),
        res.locals.dashboardAuth.user.discordId
      )
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.patch("/:guildId/users/:discordId/status", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const discordId = snowflake.parse(req.params.discordId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({
      user: await setMessageControlUserStatus(
        botId,
        guildId,
        discordId,
        statusSchema.parse(req.body).status,
        res.locals.dashboardAuth.user.discordId
      )
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.get("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ users: await listMessageControlUsers(botId, guildId) });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ settings: await getMessageControlSettings(botId, guildId) });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      settings: await saveMessageControlSettings(
        botId,
        guildId,
        settingsSchema.parse(req.body),
        req.header("x-actor-id") ?? null
      )
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.get("/bot/:guildId/users/:discordId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      user: await getMessageControlUser(botId, guildId, snowflake.parse(req.params.discordId))
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.patch("/bot/:guildId/users/:discordId/status", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      user: await setMessageControlUserStatus(
        botId,
        guildId,
        snowflake.parse(req.params.discordId),
        statusSchema.parse(req.body).status,
        req.header("x-actor-id") ?? null
      )
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.post("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.status(201).json({
      user: await addMessageControlUser(botId, guildId, parseUser(req.body), req.header("x-actor-id") ?? null)
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.delete("/bot/:guildId/users/:discordId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({
      user: await removeMessageControlUser(botId, guildId, snowflake.parse(req.params.discordId), req.header("x-actor-id") ?? null)
    });
  } catch (error) {
    next(error);
  }
});

messageControlRouter.delete("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId, guildId);
    res.json({ users: await clearMessageControlUsers(botId, guildId, req.header("x-actor-id") ?? null) });
  } catch (error) {
    next(error);
  }
});

function parseUser(body: unknown) {
  const result = userSchema.safeParse(body);
  if (result.success) return result.data;
  const legacy = legacyUserSchema.parse(body);
  return {
    avatarUrl: legacy.avatarUrl,
    discordId: legacy.userId,
    username: legacy.username
  };
}

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string, guildId?: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);

  if (guildId) {
    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: MESSAGE_CONTROL_MODULE_ID });
    if (!authorization.allowed) throw routeError(authorization.reason, 403);
  }
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, MESSAGE_CONTROL_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, MESSAGE_CONTROL_MODULE_ID);

  if (!allowed) throw routeError("Sem permissão para Sistema de Controle de Mensagem Individual.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
