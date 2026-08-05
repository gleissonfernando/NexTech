import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  WEAPON_SALE_MODULE_ID,
  addWeaponSaleItems,
  cancelWeaponSaleSession,
  clearWeaponSaleItems,
  confirmWeaponSaleSession,
  createWeaponSaleSession,
  findWeaponSaleSessionByChannel,
  getWeaponSaleDashboard,
  getWeaponSaleRuntime,
  readyWeaponSaleSession,
  reopenWeaponSaleSession,
  requestWeaponSalePanelPublish,
  saveWeaponSaleConfig,
  updateWeaponSalePanelState,
  updateWeaponSaleSessionChannel
} from "../services/weaponSaleService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const configSchema = z.object({
  accentColor: z.string().max(20).nullable().optional(),
  buttonText: z.string().max(80).optional(),
  cancelDeleteDelaySeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  completedDeleteDelaySeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  description: z.string().max(1500).optional(),
  enabled: z.boolean().optional(),
  expirationMinutes: z.coerce.number().int().min(5).max(10_080).optional(),
  footerImageUrl: z.string().max(2048).nullable().optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
  logChannelId: optionalSnowflake,
  managerRoleIds: z.array(snowflake).max(100).optional(),
  managerUserIds: z.array(snowflake).max(100).optional(),
  orientationText: z.string().max(1500).optional(),
  panelChannelId: optionalSnowflake,
  panelMessageId: optionalSnowflake,
  temporaryCategoryId: optionalSnowflake,
  temporaryChannelText: z.string().max(1500).optional(),
  thumbnailUrl: z.string().max(2048).nullable().optional(),
  title: z.string().max(120).optional(),
  weapons: z.array(z.object({ active: z.boolean().optional(), id: z.string().uuid().optional(), name: z.string().min(1).max(80), unitPriceInCents: z.coerce.number().int().positive() })).max(500).optional()
});
const sessionSchema = z.object({ buyerFactionId: z.string().min(1).max(120), openedByUserId: snowflake, sellerName: z.string().max(120).nullable().optional() });
const actorSchema = z.object({ actorId: snowflake });
const addItemsSchema = z.object({
  actorId: snowflake,
  items: z.array(z.object({ quantity: z.coerce.number().int().positive().max(1_000_000), weaponId: z.string().uuid() })).min(1).max(50),
  messageContent: z.string().max(1000).nullable().optional(),
  messageId: optionalSnowflake
});

export const weaponSalesRouter = Router();
weaponSalesRouter.use(requireAuthOrBot);

weaponSalesRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) return res.status(403).json({ message: "Use as rotas runtime do bot." });
    if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sistema de Armas não liberado." });
    return res.json(await getWeaponSaleDashboard(guildId, botId));
  } catch (error) { return next(error); }
});

weaponSalesRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar." });
    return res.json({ config: await saveWeaponSaleConfig(guildId, botId, configSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

weaponSalesRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar." });
    return res.json({ config: await requestWeaponSalePanelPublish(guildId, botId) });
  } catch (error) { return next(error); }
});

weaponSalesRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try { return res.json(await getWeaponSaleRuntime(snowflake.parse(req.params.guildId), await resolveRequestBotId(req))); } catch (error) { return next(error); }
});
weaponSalesRouter.put("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await getWeaponSaleRuntime(guildId, botId);
    return res.json({ config: await saveWeaponSaleConfig(guildId, botId, configSchema.parse(req.body), req.headers["x-bot-id"]?.toString() ?? null) });
  } catch (error) { return next(error); }
});
weaponSalesRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try { return res.json({ config: await updateWeaponSalePanelState(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), optionalSnowflake.parse(req.body?.messageId) ?? null) }); } catch (error) { return next(error); }
});
weaponSalesRouter.post("/bot/:guildId/sessions", requireBot, async (req, res, next) => {
  try { return res.status(201).json({ session: await createWeaponSaleSession(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), sessionSchema.parse(req.body)) }); } catch (error) { return next(error); }
});
weaponSalesRouter.patch("/bot/:guildId/sessions/:sessionId/channel", requireBot, async (req, res, next) => {
  try { return res.json({ session: await updateWeaponSaleSessionChannel(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), z.object({ channelId: optionalSnowflake, panelMessageId: optionalSnowflake }).parse(req.body)) }); } catch (error) { return next(error); }
});
weaponSalesRouter.get("/bot/:guildId/sessions/by-channel/:channelId", requireBot, async (req, res, next) => {
  try { return res.json({ session: await findWeaponSaleSessionByChannel(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), snowflake.parse(req.params.channelId)) }); } catch (error) { return next(error); }
});
weaponSalesRouter.post("/bot/:guildId/sessions/:sessionId/items", requireBot, async (req, res, next) => {
  try { return res.json({ session: await addWeaponSaleItems(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), addItemsSchema.parse(req.body)) }); } catch (error) { return next(error); }
});
weaponSalesRouter.delete("/bot/:guildId/sessions/:sessionId/items", requireBot, async (req, res, next) => {
  try { return res.json({ session: await clearWeaponSaleItems(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), actorSchema.parse(req.body).actorId) }); } catch (error) { return next(error); }
});
weaponSalesRouter.post("/bot/:guildId/sessions/:sessionId/ready", requireBot, async (req, res, next) => {
  try { return res.json({ session: await readyWeaponSaleSession(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), actorSchema.parse(req.body).actorId) }); } catch (error) { return next(error); }
});
weaponSalesRouter.post("/bot/:guildId/sessions/:sessionId/reopen", requireBot, async (req, res, next) => {
  try { return res.json({ session: await reopenWeaponSaleSession(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), actorSchema.parse(req.body).actorId) }); } catch (error) { return next(error); }
});
weaponSalesRouter.post("/bot/:guildId/sessions/:sessionId/confirm", requireBot, async (req, res, next) => {
  try { return res.json({ session: await confirmWeaponSaleSession(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), actorSchema.parse(req.body).actorId) }); } catch (error) { return next(error); }
});
weaponSalesRouter.post("/bot/:guildId/sessions/:sessionId/cancel", requireBot, async (req, res, next) => {
  try { return res.json({ session: await cancelWeaponSaleSession(snowflake.parse(req.params.guildId), await resolveRequestBotId(req), z.string().uuid().parse(req.params.sessionId), actorSchema.parse(req.body).actorId) }); } catch (error) { return next(error); }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, WEAPON_SALE_MODULE_ID);
}
async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, WEAPON_SALE_MODULE_ID);
}
