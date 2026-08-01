import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  FACTION_CHEST_MODULE_ID,
  getFactionChestDashboard,
  listActiveFactionChestSettings,
  recordFactionChestMovement,
  requestFactionChestPanel,
  saveFactionChestItem,
  saveFactionChestSettings,
  updateFactionChestPanelState
} from "../services/factionChestService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).max(50).optional(),
  auditChannelId: snowflake.nullable().optional(),
  auditRoleIds: z.array(snowflake).max(50).optional(),
  categoryId: snowflake.nullable().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  enabled: z.boolean().optional(),
  logChannelId: snowflake.nullable().optional(),
  panelChannelId: snowflake.nullable().optional(),
  panelImageUrl: z.string().trim().max(2048).nullable().optional(),
  registerRoleIds: z.array(snowflake).max(50).optional(),
  systemName: z.string().trim().min(1).max(80).optional(),
  viewRoleIds: z.array(snowflake).max(50).optional()
});
const itemSchema = z.object({
  active: z.boolean().optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  category: z.string().trim().min(1).max(80).default("Geral"),
  description: z.string().trim().max(500).nullable().default(null),
  imageUrl: z.string().trim().max(2048).nullable().default(null),
  minimumQuantity: z.coerce.number().int().min(0).max(999999).optional(),
  name: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().int().min(0).max(999999)
});
const movementSchema = z.object({
  action: z.enum(["add", "remove"]),
  actorId: snowflake,
  actorName: z.string().trim().min(1).max(100),
  bauId: z.string().trim().max(100).nullable().optional(),
  channelId: snowflake.nullable().optional(),
  item: z.string().trim().max(80).default(""),
  items: z.string().trim().max(4000).nullable().optional(),
  messageId: snowflake.nullable().optional(),
  quantity: z.coerce.number().int().min(1).max(999999).optional(),
  reason: z.string().trim().max(500).nullable().optional()
}).refine((value) => Boolean(value.items?.trim()) || (Boolean(value.item.trim()) && typeof value.quantity === "number"), {
  message: "Informe itens ou item e quantidade."
});

export const factionChestRouter = Router();

factionChestRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await dashboardBotId(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getFactionChestDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

factionChestRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await dashboardBotId(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await saveFactionChestSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.post("/:guildId/items", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await dashboardBotId(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.status(201).json({ item: await saveFactionChestItem(botId, guildId, null, itemSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.patch("/:guildId/items/:itemId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await dashboardBotId(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ item: await saveFactionChestItem(botId, guildId, req.params.itemId!, itemSchema.partial().parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.post("/:guildId/publish", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await dashboardBotId(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await requestFactionChestPanel(botId, guildId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.get("/bot/configs/active", requireBot, async (req, res, next) => {
  try {
    const botId = await botRuntimeId(req);
    await licensed(botId);
    res.json({ configs: await listActiveFactionChestSettings(botId) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const botId = await botRuntimeId(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId);
    res.json(await getFactionChestDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

factionChestRouter.patch("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botRuntimeId(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId);
    res.json({ settings: await saveFactionChestSettings(botId, guildId, settingsSchema.parse(req.body), req.get("x-actor-id") ?? null) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.post("/bot/:guildId/publish", requireBot, async (req, res, next) => {
  try {
    const botId = await botRuntimeId(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId);
    res.json({ settings: await requestFactionChestPanel(botId, guildId, req.get("x-actor-id") ?? "bot-runtime") });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.post("/bot/panel-state", requireBot, async (req, res, next) => {
  try {
    const botId = await botRuntimeId(req);
    await licensed(botId);
    const input = z.object({ guildId: snowflake, panelMessageId: snowflake.nullable() }).parse(req.body);
    res.json({ settings: await updateFactionChestPanelState(botId, input.guildId, input.panelMessageId) });
  } catch (error) {
    next(error);
  }
});

factionChestRouter.post("/bot/:guildId/movements", requireBot, async (req, res, next) => {
  try {
    const botId = await botRuntimeId(req);
    const guildId = snowflake.parse(req.params.guildId);
    await licensed(botId);
    res.status(201).json(await recordFactionChestMovement(botId, guildId, movementSchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

async function dashboardBotId(req: any) {
  const id = await resolveRequestBotId(req);
  if (!id) throw routeError("Selecione um bot DEV.", 400);
  return id;
}

async function botRuntimeId(req: any) {
  const id = await resolveRequestBotId(req);
  if (!id) throw routeError("Bot não identificado.", 400);
  return id;
}

async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(FACTION_CHEST_MODULE_ID)) {
    throw routeError("Este módulo não está liberado para este bot.", 403);
  }
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, FACTION_CHEST_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, FACTION_CHEST_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para o Sistema de Baú.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
