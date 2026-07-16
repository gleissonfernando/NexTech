import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  clearVisibleUsers,
  countVisibleUsers,
  getVisibleUser,
  isVisibleUser,
  listVisibleUsers,
  removeVisibleUser,
  searchVisibleUsers,
  upsertVisibleUser,
  VISIBLE_MODE_MODULE_ID
} from "../services/visibleModeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const querySchema = z.object({ q: z.string().trim().max(64).optional() });

export const visibleModeRouter = Router();

visibleModeRouter.get("/:guildId/users", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    const { q } = querySchema.parse(req.query);
    res.json({ users: q ? await searchVisibleUsers(botId, guildId, q) : await listVisibleUsers(botId, guildId) });
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.get("/:guildId/count", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json({ count: await countVisibleUsers(botId, guildId) });
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.put("/:guildId/users/:userId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const userId = snowflake.parse(req.params.userId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ user: await upsertVisibleUser(botId, guildId, userId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.delete("/:guildId/users/:userId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const userId = snowflake.parse(req.params.userId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json(await removeVisibleUser(botId, guildId, userId, res.locals.dashboardAuth.user.discordId));
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.delete("/:guildId/users", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json(await clearVisibleUsers(botId, guildId, res.locals.dashboardAuth.user.discordId));
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.get("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ users: await listVisibleUsers(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.get("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const guildId = snowflake.parse(req.params.guildId);
    const userId = snowflake.parse(req.params.userId);
    res.json({ enabled: await isVisibleUser(botId, guildId, userId), user: await getVisibleUser(botId, guildId, userId) });
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.put("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({
      user: await upsertVisibleUser(botId, snowflake.parse(req.params.guildId), snowflake.parse(req.params.userId), req.header("x-actor-id") ?? null)
    });
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.delete("/bot/:guildId/users/:userId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json(await removeVisibleUser(botId, snowflake.parse(req.params.guildId), snowflake.parse(req.params.userId), req.header("x-actor-id") ?? null));
  } catch (error) {
    next(error);
  }
});

visibleModeRouter.delete("/bot/:guildId/users", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json(await clearVisibleUsers(botId, snowflake.parse(req.params.guildId), req.header("x-actor-id") ?? null));
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
  if (!permissions.enabledModules.includes(VISIBLE_MODE_MODULE_ID)) throw routeError("Modo Visível não liberado.", 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, VISIBLE_MODE_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, VISIBLE_MODE_MODULE_ID);

  if (!allowed) throw routeError("Sem permissão para Modo Visível.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
