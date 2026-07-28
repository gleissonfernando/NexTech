import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, authorizeBotRuntimeModule } from "../services/devBotService";
import {
  addCustomBotOrderNote,
  createCustomBotOrder,
  CUSTOM_BOT_ORDERS_MODULE_ID,
  ensureCustomBotOrderSettings,
  getCustomBotOrderRuntime,
  getCustomBotOrdersDashboard,
  listCustomBotOrderNotes,
  requestCustomBotOrderPanelDelete,
  requestCustomBotOrderPanelPublish,
  saveCustomBotOrderSettings,
  updateCustomBotOrder,
  updateCustomBotOrderPanelState
} from "../services/customBotOrderService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const customBotOrdersRouter = Router();
customBotOrdersRouter.use(requireAuthOrBot);

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const statusSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  dmEnabled: z.boolean().default(false),
  emoji: z.string().max(80).default("🔹"),
  id: z.string().min(1).max(80),
  locked: z.boolean().optional(),
  name: z.string().min(1).max(80),
  order: z.coerce.number().int().min(1).max(1000)
});
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).max(100).optional(),
  allowMultipleActiveOrders: z.boolean().optional(),
  assignRoleIds: z.array(snowflake).max(100).optional(),
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  buttonEmoji: z.string().max(80).optional(),
  buttonLabel: z.string().max(80).optional(),
  categoryId: optionalSnowflake,
  closeRoleIds: z.array(snowflake).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  description: z.string().max(1800).optional(),
  enabled: z.boolean().optional(),
  footerImageUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  footerText: z.string().max(180).optional(),
  introText: z.string().max(1000).optional(),
  logChannelId: optionalSnowflake,
  maxActiveOrdersPerUser: z.coerce.number().int().min(1).max(10).optional(),
  mentionRoleId: optionalSnowflake,
  noticeCooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  panelChannelId: optionalSnowflake,
  panelEmoji: z.string().max(80).optional(),
  responsibleRoleIds: z.array(snowflake).max(100).optional(),
  reviewChannelId: optionalSnowflake,
  staffRoleIds: z.array(snowflake).max(100).optional(),
  statusDefinitions: z.array(statusSchema).max(25).optional(),
  subtitle: z.string().max(160).optional(),
  thumbnailUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  title: z.string().max(120).optional(),
  transcriptChannelId: optionalSnowflake
});
const createOrderSchema = z.object({
  budget: z.string().max(180).nullable().optional(),
  customerId: snowflake,
  customerName: z.string().max(100).nullable().optional(),
  deadline: z.string().max(180).nullable().optional(),
  description: z.string().min(1).max(1800),
  features: z.string().min(1).max(1500),
  notes: z.string().max(800).nullable().optional(),
  projectName: z.string().min(1).max(120),
  references: z.string().max(800).nullable().optional(),
  type: z.string().min(1).max(120)
});
const updateOrderSchema = z.object({
  action: z.string().max(80).optional(),
  actorId: snowflake.nullable().optional(),
  actorName: z.string().max(100).nullable().optional(),
  assignedStaffId: snowflake.nullable().optional(),
  channelId: optionalSnowflake,
  closeReason: z.string().max(800).nullable().optional(),
  closedById: snowflake.nullable().optional(),
  notice: z.boolean().optional(),
  panelMessageId: optionalSnowflake,
  result: z.string().max(800).nullable().optional(),
  status: z.string().max(80).optional(),
  transcriptAdminText: z.string().max(250000).nullable().optional(),
  transcriptChannelMessageId: optionalSnowflake,
  transcriptCustomerText: z.string().max(200000).nullable().optional()
});
const noteSchema = z.object({
  authorId: snowflake,
  authorName: z.string().max(100).nullable().optional(),
  content: z.string().min(1).max(1500)
});

customBotOrdersRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Módulo de pedidos de bots personalizados não liberado." });
    return res.json(await getCustomBotOrdersDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar pedidos de bots personalizados." });
    return res.json({ settings: await saveCustomBotOrderSettings(guildId, botId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar painel." });
    return res.json({ settings: await requestCustomBotOrderPanelPublish(guildId, botId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.delete("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para excluir painel." });
    return res.json({ settings: await requestCustomBotOrderPanelDelete(guildId, botId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.json(await getCustomBotOrderRuntime(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.json({ settings: await updateCustomBotOrderPanelState(guildId, botId, optionalSnowflake.parse(req.body?.messageId) || null) });
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.post("/bot/:guildId/orders", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const order = await createCustomBotOrder(guildId, botId, createOrderSchema.parse(req.body ?? {}));
    return res.status(201).json({ order });
  } catch (error) {
    const activeOrder = (error as { activeOrder?: unknown })?.activeOrder;
    if (activeOrder) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 409;
      return res.status(statusCode).json({ activeOrder, message: error instanceof Error ? error.message : "Você já possui um pedido em andamento." });
    }
    return next(error);
  }
});

customBotOrdersRouter.patch("/bot/:guildId/orders/:orderId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const orderId = z.string().min(1).max(120).parse(req.params.orderId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const order = await updateCustomBotOrder(guildId, botId, orderId, sanitizeOrderPatch(updateOrderSchema.parse(req.body ?? {})));
    if (!order) return res.status(404).json({ message: "Pedido não encontrado." });
    return res.json({ order });
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.post("/bot/:guildId/orders/:orderId/notes", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const orderId = z.string().min(1).max(120).parse(req.params.orderId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const note = await addCustomBotOrderNote(guildId, botId, orderId, noteSchema.parse(req.body ?? {}));
    if (!note) return res.status(404).json({ message: "Pedido não encontrado." });
    return res.status(201).json({ note });
  } catch (error) {
    return next(error);
  }
});

customBotOrdersRouter.get("/bot/:guildId/orders/:orderId/notes", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const orderId = z.string().min(1).max(120).parse(req.params.orderId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.json({ notes: await listCustomBotOrderNotes(guildId, botId, orderId) });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return false;
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, CUSTOM_BOT_ORDERS_MODULE_ID);
}

async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return false;
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, CUSTOM_BOT_ORDERS_MODULE_ID);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: CUSTOM_BOT_ORDERS_MODULE_ID });
  if (authorization.allowed) return;
  throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    bannerUrl: input.bannerUrl || null,
    categoryId: input.categoryId || null,
    footerImageUrl: input.footerImageUrl || null,
    logChannelId: input.logChannelId || null,
    mentionRoleId: input.mentionRoleId || null,
    panelChannelId: input.panelChannelId || null,
    reviewChannelId: input.reviewChannelId || null,
    thumbnailUrl: input.thumbnailUrl || null,
    transcriptChannelId: input.transcriptChannelId || null
  };
}

function sanitizeOrderPatch(input: z.infer<typeof updateOrderSchema>) {
  const output: Record<string, unknown> = { ...input };
  for (const key of ["channelId", "panelMessageId", "transcriptChannelMessageId"] as const) {
    if (key in input) output[key] = input[key] || null;
  }
  return output as z.infer<typeof updateOrderSchema>;
}
