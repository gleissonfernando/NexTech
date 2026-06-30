import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  addGlobalBlacklistEntry,
  getGlobalBlacklistDashboard,
  recordSafeBotInfraction,
  removeGlobalBlacklistEntry,
  saveGlobalBlacklistSettings
} from "../services/globalBlacklistService";

const MODULE_ID = "global-blacklist";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();

const settingsSchema = z.object({
  autoBlacklistOnSafeBotBan: z.boolean().optional(),
  directActions: z.array(z.string().max(80)).max(100).optional(),
  enabledSafeBotModules: z.array(z.string().max(80)).max(100).optional(),
  infractionLimit: z.coerce.number().int().min(1).max(100).optional(),
  kickMode: z.enum(["history_only", "alert", "blacklist"]).optional(),
  logChannelId: optionalSnowflakeSchema,
  requireApprovalAfterRemoval: z.boolean().optional()
});

const manualEntrySchema = z.object({
  reason: z.string().min(1).max(1000),
  userId: snowflakeSchema
});

const removeSchema = z.object({
  reason: z.string().max(1000).optional().default("Removido manualmente")
});

const safeBotInfractionSchema = z.object({
  actionTaken: z.string().max(80).nullable().optional(),
  actorId: snowflakeSchema.nullable().optional(),
  evidence: z.record(z.unknown()).optional(),
  guildId: guildIdSchema,
  infractionType: z.string().max(120),
  reason: z.string().max(1000),
  safeBotModule: z.string().max(80).nullable().optional(),
  userId: snowflakeSchema
});

export const globalBlacklistRouter = Router();

globalBlacklistRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || !(await canReadDevBotModule(res.locals.dashboardAuth.user, botId, guildId, MODULE_ID))) {
      return res.status(403).json({ message: "Sem acesso a Blacklist Global." });
    }
    return res.json(await getGlobalBlacklistDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

globalBlacklistRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = settingsSchema.parse(req.body);
    if (!botId || !(await canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, MODULE_ID))) {
      return res.status(403).json({ message: "Sem permissao para configurar Blacklist Global." });
    }
    return res.json({ settings: await saveGlobalBlacklistSettings(guildId, botId, input, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

globalBlacklistRouter.post("/:guildId/entries", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = manualEntrySchema.parse(req.body);
    if (!botId || !(await canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, MODULE_ID))) {
      return res.status(403).json({ message: "Sem permissao para adicionar blacklist." });
    }
    return res.status(201).json({ entry: await addGlobalBlacklistEntry({ ...input, addedBy: res.locals.dashboardAuth.user.discordId, addedByType: "staff", botId, evidence: { manual: true }, guildId, safeBotModule: null }) });
  } catch (error) {
    return next(error);
  }
});

globalBlacklistRouter.delete("/:guildId/entries/:userId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await resolveRequestBotId(req);
    const input = removeSchema.parse(req.body ?? {});
    if (!botId || !(await canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, MODULE_ID))) {
      return res.status(403).json({ message: "Sem permissao para remover blacklist." });
    }
    return res.json({ entry: await removeGlobalBlacklistEntry(guildId, botId, userId, res.locals.dashboardAuth.user.discordId, input.reason) });
  } catch (error) {
    return next(error);
  }
});

globalBlacklistRouter.post("/bot/safebot/infractions", requireBot, async (req, res, next) => {
  try {
    const input = safeBotInfractionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    return res.status(201).json(await recordSafeBotInfraction({ ...input, botId }));
  } catch (error) {
    return next(error);
  }
});
