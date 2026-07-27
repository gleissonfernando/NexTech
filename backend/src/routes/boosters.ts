import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import {
  BOOSTER_MODULE_ID,
  claimBoosterEvent,
  completeBoosterHistory,
  getBoosterDashboard,
  getBoosterRuntime,
  saveBoosterSettings
} from "../services/boosterService";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const boostersRouter = Router();
boostersRouter.use(requireAuthOrBot);

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();

const settingsSchema = z.object({
  announcementChannelId: optionalSnowflake,
  bannerEnabled: z.boolean().optional(),
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  benefitsMessage: z.string().max(1800).optional(),
  boosterRoleId: optionalSnowflake,
  embedColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  enabled: z.boolean().optional(),
  logChannelId: optionalSnowflake,
  message: z.string().max(1800).optional(),
  messageEnabled: z.boolean().optional(),
  showAvatar: z.boolean().optional(),
  showTimestamp: z.boolean().optional()
});

const claimSchema = z.object({
  avatarUrl: z.string().max(2048).nullable().optional(),
  boostCount: z.coerce.number().int().min(0).max(1000000),
  boostLevel: z.coerce.number().int().min(0).max(3),
  dedupeKey: z.string().max(180).nullable().optional(),
  userId: snowflake,
  username: z.string().min(1).max(100)
});

const completeSchema = z.object({
  announcementChannelId: optionalSnowflake,
  bannerSent: z.boolean().optional(),
  error: z.string().max(1000).nullable().optional(),
  logChannelId: optionalSnowflake,
  messageId: optionalSnowflake,
  messageSent: z.boolean().optional(),
  roleGiven: z.boolean().optional(),
  roleId: optionalSnowflake,
  status: z.enum(["processed", "failed", "skipped"])
});

boostersRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sistema Booster não liberado." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json(await getBoosterDashboard(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

boostersRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar Sistema Booster." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json({
      settings: await saveBoosterSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

boostersRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json(await getBoosterRuntime(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

boostersRouter.post("/bot/:guildId/events/claim", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.status(201).json(await claimBoosterEvent(botId, guildId, claimSchema.parse(req.body ?? {})));
  } catch (error) {
    return next(error);
  }
});

boostersRouter.patch("/bot/:guildId/history/:historyId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const historyId = z.string().min(1).max(160).parse(req.params.historyId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json({ history: await completeBoosterHistory(botId, guildId, historyId, sanitizeComplete(completeSchema.parse(req.body ?? {}))) });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, BOOSTER_MODULE_ID);
}

async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, BOOSTER_MODULE_ID);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: BOOSTER_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    announcementChannelId: input.announcementChannelId || null,
    bannerUrl: input.bannerUrl || null,
    boosterRoleId: input.boosterRoleId || null,
    logChannelId: input.logChannelId || null
  };
}

function sanitizeComplete(input: z.infer<typeof completeSchema>) {
  return {
    ...input,
    announcementChannelId: input.announcementChannelId || null,
    error: input.error || null,
    logChannelId: input.logChannelId || null,
    messageId: input.messageId || null,
    roleId: input.roleId || null
  };
}
