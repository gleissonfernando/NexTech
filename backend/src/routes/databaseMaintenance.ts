import { Router } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDevBot } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { DashboardAuth } from "../services/tokenService";
import {
  cleanupLegacyMaintenance,
  deleteUserLinks,
  listMaintenanceModules,
  listUserLinks,
  resetMaintenanceModule,
  resetMaintenanceServer,
  searchMaintenanceUsers,
  type DatabaseMaintenanceModule
} from "../services/databaseMaintenanceService";

const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const moduleSchema = z.enum([
  "manual-registration",
  "fivem-goals",
  "fivem-orders",
  "fivem-finance",
  "fivem-absences",
  "fivem-hierarchy",
  "tickets",
  "temporary-voice",
  "socials",
  "security",
  "logs"
]);

const searchSchema = z.object({
  guildId: snowflakeSchema,
  query: z.string().max(120).default("")
});

const deleteSchema = z.object({
  confirmation: z.string().max(80).optional(),
  userId: snowflakeSchema
});

const cleanupSchema = z.object({
  existingChannelIds: z.array(snowflakeSchema).max(10000).optional()
});

const resetModuleSchema = z.object({
  confirmation: z.string().max(80),
  module: moduleSchema
});

const resetServerSchema = z.object({
  confirmation: z.string().max(80)
});

export const databaseMaintenanceRouter = Router();

databaseMaintenanceRouter.use(requireAuthOrBot);

databaseMaintenanceRouter.get("/modules", (_req, res) => {
  return res.json({ modules: listMaintenanceModules() });
});

databaseMaintenanceRouter.get("/dev/bots/:botId/guilds/:guildId/search", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const botId = z.string().min(1).parse(req.params.botId);
    const input = searchSchema.parse({ guildId, query: req.query.q ?? "" });
    await assertCanManageBot(auth, botId);
    return res.json({ users: await searchMaintenanceUsers({ botId, guildId: input.guildId, query: input.query }) });
  } catch (error) {
    return next(error);
  }
});

databaseMaintenanceRouter.get("/dev/bots/:botId/guilds/:guildId/users/:userId/links", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const botId = z.string().min(1).parse(req.params.botId);
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    await assertCanManageBot(auth, botId);
    return res.json(await listUserLinks({ botId, guildId, userId }));
  } catch (error) {
    return next(error);
  }
});

databaseMaintenanceRouter.post("/dev/bots/:botId/guilds/:guildId/users/delete", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const botId = z.string().min(1).parse(req.params.botId);
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const input = deleteSchema.parse(req.body ?? {});
    await assertCanManageBot(auth, botId);
    if (input.confirmation !== input.userId) {
      return res.status(400).json({ message: "Confirme digitando o ID do usuário." });
    }
    return res.json({
      result: await deleteUserLinks({
        actorId: auth.user.discordId,
        actorName: auth.user.globalName || auth.user.username,
        botId,
        guildId,
        reason: "dashboard_manual",
        userId: input.userId
      })
    });
  } catch (error) {
    return next(error);
  }
});

databaseMaintenanceRouter.post("/dev/bots/:botId/guilds/:guildId/cleanup-legacy", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const botId = z.string().min(1).parse(req.params.botId);
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const input = cleanupSchema.parse(req.body ?? {});
    await assertCanManageBot(auth, botId);
    return res.json({
      result: await cleanupLegacyMaintenance({
        actorId: auth.user.discordId,
        actorName: auth.user.globalName || auth.user.username,
        botId,
        existingChannelIds: input.existingChannelIds,
        guildId
      })
    });
  } catch (error) {
    return next(error);
  }
});

databaseMaintenanceRouter.post("/dev/bots/:botId/guilds/:guildId/reset-module", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const botId = z.string().min(1).parse(req.params.botId);
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const input = resetModuleSchema.parse(req.body ?? {});
    await assertCanManageBot(auth, botId);
    return res.json({
      result: await resetMaintenanceModule({
        actorId: auth.user.discordId,
        actorName: auth.user.globalName || auth.user.username,
        botId,
        confirmation: input.confirmation,
        guildId,
        module: input.module as DatabaseMaintenanceModule
      })
    });
  } catch (error) {
    return next(error);
  }
});

databaseMaintenanceRouter.post("/dev/bots/:botId/guilds/:guildId/reset-server", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const botId = z.string().min(1).parse(req.params.botId);
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const input = resetServerSchema.parse(req.body ?? {});
    await assertCanManageBot(auth, botId);
    return res.json({
      result: await resetMaintenanceServer({
        actorId: auth.user.discordId,
        actorName: auth.user.globalName || auth.user.username,
        botId,
        confirmation: input.confirmation,
        guildId
      })
    });
  } catch (error) {
    return next(error);
  }
});

databaseMaintenanceRouter.post("/bot/guilds/:guildId/member-left/:userId", requireBot, async (req, res, next) => {
  try {
    if (!isBotRequest(req)) return res.status(403).json({ message: "Rota exclusiva do bot." });
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await resolveRequestBotId(req);
    return res.json({
      result: await deleteUserLinks({
        actorId: null,
        actorName: "guildMemberRemove",
        botId,
        guildId,
        reason: "guild_member_remove",
        userId
      })
    });
  } catch (error) {
    return next(error);
  }
});

async function assertCanManageBot(auth: DashboardAuth, botId: string) {
  if (!(await canManageDevBot(auth.user, botId))) {
    throw Object.assign(new Error("Você não tem acesso administrativo a este bot."), { statusCode: 403 });
  }
}
