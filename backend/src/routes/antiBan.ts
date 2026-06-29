import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import {
  canReadDevBotModule,
  canUseDevBotModule,
  authorizeBotRuntimeModule,
  getDevBotToken
} from "../services/devBotService";
import {
  createAntiBanLog,
  getAntiBanConfig,
  getAntiBanReadiness,
  listAntiBanLogs,
  saveAntiBanConfig,
  sendAntiBanTest
} from "../services/antiBanService";
import { getGuildLiveOptions } from "../services/discordOptionsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const snowflake = z.string().regex(/^\d{5,32}$/);
const paramsSchema = z.object({ botId: z.string().min(1).max(120), guildId: snowflake });
const configSchema = z.object({
  enabled: z.boolean(),
  banLimit: z.coerce.number().int().min(1).max(50),
  kickLimit: z.coerce.number().int().min(1).max(50),
  timeWindow: z.coerce.number().int().min(10).max(3600),
  logChannelId: snowflake.nullable(),
  whitelistUsers: z.array(snowflake).max(250),
  whitelistRoles: z.array(snowflake).max(100),
  whitelistRoleMode: z.enum(["ignore", "log_only"]),
  protectedRoles: z.array(snowflake).max(100),
  actionOnTrigger: z.enum(["log_only", "remove_admin_roles", "kick_executor", "ban_executor", "remove_dangerous_permissions", "block_future_actions"]),
  autoRecovery: z.enum(["alert_only", "unban", "restore_permissions"])
}).strict();
const logSchema = z.object({
  executorId: snowflake.nullable(),
  targetId: snowflake.nullable(),
  actionType: z.string().min(1).max(80),
  amount: z.number().int().min(0).max(10_000),
  limit: z.number().int().min(0).max(10_000),
  punishment: z.string().min(1).max(120),
  success: z.boolean(),
  errorMessage: z.string().max(2000).nullable(),
  metadata: z.unknown().optional()
}).strict();

export const antiBanDashboardRouter = Router();
export const antiBanBotRouter = Router();

antiBanDashboardRouter.use(requireAuth);

antiBanDashboardRouter.get("/:botId/guilds/:guildId/anti-ban", async (req, res, next) => {
  try {
    const { botId, guildId } = paramsSchema.parse(req.params);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    if (!(await canReadDevBotModule(user, botId, guildId, "anti-ban"))) {
      return res.status(403).json({ message: "Módulo Anti Ban não liberado para este bot." });
    }
    const [config, readiness] = await Promise.all([getAntiBanConfig(botId, guildId), getAntiBanReadiness(botId, guildId)]);
    return res.json({ config, readiness });
  } catch (error) { return next(error); }
});

antiBanDashboardRouter.post("/:botId/guilds/:guildId/anti-ban", async (req, res, next) => {
  try {
    const { botId, guildId } = paramsSchema.parse(req.params);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    if (!(await canUseDevBotModule(user, botId, guildId, "anti-ban"))) {
      return res.status(403).json({ message: "Módulo Anti Ban não liberado para este bot." });
    }
    const input = configSchema.parse(req.body ?? {});
    if (input.enabled && !input.logChannelId) {
      return res.status(400).json({ message: "Selecione um canal de logs antes de ativar o Anti Ban." });
    }
    const [readiness, token] = await Promise.all([getAntiBanReadiness(botId, guildId), getDevBotToken(botId)]);
    if (input.enabled && !readiness.ready) {
      return res.status(409).json({ message: `O bot não possui permissões suficientes: ${readiness.missingPermissions.join(", ")}.`, readiness });
    }
    if (!token) return res.status(409).json({ message: "Token oficial do bot não está disponível." });
    const options = await getGuildLiveOptions(guildId, token, true);
    const channelIds = new Set(options.channels.map((channel) => channel.id));
    const roleIds = new Set(options.roles.map((role) => role.id));
    if (input.logChannelId && !channelIds.has(input.logChannelId)) return res.status(400).json({ message: "O canal de logs não pertence a este servidor." });
    if ([...input.whitelistRoles, ...input.protectedRoles].some((roleId) => !roleIds.has(roleId))) {
      return res.status(400).json({ message: "Um ou mais cargos selecionados não pertencem a este servidor." });
    }
    const config = await saveAntiBanConfig(botId, guildId, input);
    return res.json({ config, readiness });
  } catch (error) { return next(error); }
});

antiBanDashboardRouter.get("/:botId/guilds/:guildId/anti-ban/logs", async (req, res, next) => {
  try {
    const { botId, guildId } = paramsSchema.parse(req.params);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    if (!(await canReadDevBotModule(user, botId, guildId, "anti-ban"))) return res.status(403).json({ message: "Módulo Anti Ban não liberado para este bot." });
    return res.json({ logs: await listAntiBanLogs(botId, guildId, Number(req.query.limit) || 50) });
  } catch (error) { return next(error); }
});

antiBanDashboardRouter.post("/:botId/guilds/:guildId/anti-ban/test", async (req, res, next) => {
  try {
    const { botId, guildId } = paramsSchema.parse(req.params);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    if (!(await canUseDevBotModule(user, botId, guildId, "anti-ban"))) return res.status(403).json({ message: "Módulo Anti Ban não liberado para este bot." });
    return res.json(await sendAntiBanTest(botId, guildId));
  } catch (error) { return next(error); }
});

antiBanBotRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "anti-ban" });
    if (!botId || !authorization.allowed) return res.status(403).json({ message: authorization.reason, authorization });
    return res.json({ config: await getAntiBanConfig(botId, guildId), authorization });
  } catch (error) { return next(error); }
});

antiBanBotRouter.post("/bot/:guildId/logs", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "anti-ban" });
    if (!botId || !authorization.allowed) return res.status(403).json({ message: authorization.reason });
    const input = logSchema.parse(req.body ?? {});
    return res.status(201).json({ log: await createAntiBanLog({ botId, guildId, ...input }) });
  } catch (error) { return next(error); }
});
