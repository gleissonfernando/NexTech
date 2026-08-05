import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  AMMUNITION_MODULE_ID,
  applyAmmunitionOrderItems,
  cancelAmmunitionOrder,
  clearAmmunitionOrderItems,
  completeAmmunitionOrder,
  createAmmunitionOrder,
  findPendingAmmunitionOrderByChannel,
  getAmmunitionDashboard,
  getAmmunitionRuntime,
  getAmmunitionWeeklySummary,
  removeAmmunitionOrderItem,
  recordAmmunitionOrderMessage,
  requestAmmunitionPanelPublish,
  saveAmmunitionConfig,
  setAmmunitionOrderItemLock,
  updateAmmunitionOrderChannel,
  updateAmmunitionPanelState
} from "../services/ammunitionService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const rolesSchema = z.object({
  CANCEL_ORDER: z.array(snowflake).max(100).optional(),
  COMPLETE_ORDER: z.array(snowflake).max(100).optional(),
  CREATE_ORDER: z.array(snowflake).max(100).optional(),
  MANAGE_CONFIG: z.array(snowflake).max(100).optional(),
  VIEW_CHANNEL: z.array(snowflake).max(100).optional(),
  VIEW_REPORT: z.array(snowflake).max(100).optional()
});
const settingsSchema = z.object({
  ammunitionTypes: z.array(z.object({
    active: z.boolean().optional(),
    aliases: z.array(z.string().min(1).max(80)).max(20).optional(),
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(80),
    unitPriceInCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional()
  })).max(100).optional(),
  cancelledChannelDeleteDelaySeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  completedChannelDeleteDelaySeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  enabled: z.boolean().optional(),
  logChannelId: optionalSnowflake,
  panelChannelId: optionalSnowflake,
  panelMessageId: optionalSnowflake,
  roles: rolesSchema.optional(),
  sellerFactionId: z.string().min(1).max(120).nullable().optional(),
  temporaryCategoryId: optionalSnowflake,
  timezone: z.string().min(1).max(80).nullable().optional(),
  unitPriceInCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional()
});
const orderSchema = z.object({
  buyerFactionId: z.string().min(1).max(120),
  openedByUserId: snowflake,
  quantity: z.coerce.number().int().positive().max(1_000_000).optional(),
  sellerUserId: snowflake
});
const orderItemsSchema = z.object({
  actorId: snowflake,
  items: z.array(z.object({ ammunitionTypeId: z.string().uuid(), quantity: z.coerce.number().int().positive().max(1_000_000) })).min(1).max(50),
  messageContent: z.string().max(1000).nullable().optional(),
  messageId: optionalSnowflake
});
const orderMessageLogSchema = z.object({
  action: z.enum(["LIST_ITEMS", "REJECTED"]),
  actorId: snowflake,
  messageContent: z.string().max(1000).nullable().optional(),
  messageId: optionalSnowflake,
  metadata: z.record(z.unknown()).optional()
});
const actorSchema = z.object({
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  id: snowflake,
  name: z.string().min(1).max(120)
});

export const ammunitionRouter = Router();
ammunitionRouter.use(requireAuthOrBot);

ammunitionRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) return res.status(403).json({ message: "Use a rota runtime do bot." });
    if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sistema de Munição não liberado." });
    return res.json(await getAmmunitionDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar o Sistema de Munição." });
    return res.json({ config: await saveAmmunitionConfig(guildId, botId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId, "DASHBOARD") });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar painel." });
    return res.json({ config: await requestAmmunitionPanelPublish(guildId, botId) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    return res.json(await getAmmunitionRuntime(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.put("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    return res.json({ config: await saveAmmunitionConfig(guildId, botId, settingsSchema.parse(req.body), req.headers["x-bot-id"]?.toString() ?? null, "DISCORD") });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const messageId = optionalSnowflake.parse(req.body?.messageId) ?? null;
    return res.json({ config: await updateAmmunitionPanelState(guildId, botId, messageId) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/bot/:guildId/orders", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    return res.status(201).json({ order: await createAmmunitionOrder(guildId, botId, orderSchema.parse(req.body)) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.patch("/bot/:guildId/orders/:orderId/channel", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const input = z.object({ panelMessageId: optionalSnowflake, temporaryChannelId: optionalSnowflake }).parse(req.body);
    return res.json({ order: await updateAmmunitionOrderChannel(guildId, botId, z.string().uuid().parse(req.params.orderId), input) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.get("/bot/:guildId/orders/by-channel/:channelId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const channelId = snowflake.parse(req.params.channelId);
    return res.json({ order: await findPendingAmmunitionOrderByChannel(guildId, botId, channelId) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/bot/:guildId/orders/:orderId/items", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    return res.json({ order: await applyAmmunitionOrderItems(guildId, botId, z.string().uuid().parse(req.params.orderId), orderItemsSchema.parse(req.body)) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.delete("/bot/:guildId/orders/:orderId/items/:ammunitionTypeId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const input = z.object({ actorId: snowflake, messageContent: z.string().max(1000).nullable().optional(), messageId: optionalSnowflake }).parse(req.body ?? {});
    return res.json({ order: await removeAmmunitionOrderItem(guildId, botId, z.string().uuid().parse(req.params.orderId), input.actorId, z.string().uuid().parse(req.params.ammunitionTypeId), input.messageId, input.messageContent) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.delete("/bot/:guildId/orders/:orderId/items", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const input = z.object({ actorId: snowflake, messageContent: z.string().max(1000).nullable().optional(), messageId: optionalSnowflake }).parse(req.body ?? {});
    return res.json({ order: await clearAmmunitionOrderItems(guildId, botId, z.string().uuid().parse(req.params.orderId), input.actorId, input.messageId, input.messageContent) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/bot/:guildId/orders/:orderId/item-lock", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const input = z.object({ actorId: snowflake, locked: z.boolean(), messageContent: z.string().max(1000).nullable().optional(), messageId: optionalSnowflake }).parse(req.body);
    return res.json({ order: await setAmmunitionOrderItemLock(guildId, botId, z.string().uuid().parse(req.params.orderId), input.actorId, input.locked, input.messageId, input.messageContent) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/bot/:guildId/orders/:orderId/message-log", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    return res.json({ order: await recordAmmunitionOrderMessage(guildId, botId, z.string().uuid().parse(req.params.orderId), orderMessageLogSchema.parse(req.body)) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/bot/:guildId/orders/:orderId/complete", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    return res.json({ order: await completeAmmunitionOrder(guildId, botId, z.string().uuid().parse(req.params.orderId), actorSchema.parse(req.body)) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.post("/bot/:guildId/orders/:orderId/cancel", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    const input = z.object({ actorId: snowflake, reason: z.string().max(500).nullable().optional() }).parse(req.body);
    return res.json({ order: await cancelAmmunitionOrder(guildId, botId, z.string().uuid().parse(req.params.orderId), input.actorId, input.reason ?? null) });
  } catch (error) {
    return next(error);
  }
});

ammunitionRouter.get("/bot/:guildId/summary", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getAmmunitionRuntime(guildId, botId);
    return res.json({ summary: await getAmmunitionWeeklySummary(guildId, botId) });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, AMMUNITION_MODULE_ID);
}

async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, AMMUNITION_MODULE_ID);
}
