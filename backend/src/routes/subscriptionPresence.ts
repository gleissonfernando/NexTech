import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  completeSubscriptionPresencePublication,
  createSubscriptionPresencePublication,
  deleteSubscriptionPresenceProduct,
  getSubscriptionPresenceDashboard,
  saveSubscriptionPresenceProduct,
  saveSubscriptionPresenceSettings,
  SUBSCRIPTION_PRESENCE_MODULE_ID
} from "../services/subscriptionPresenceService";

export const subscriptionPresenceRouter = Router();
subscriptionPresenceRouter.use(requireAuthOrBot);

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const buttonSchema = z.object({
  enabled: z.boolean().default(true),
  emoji: z.string().max(80).nullable().optional(),
  label: z.string().min(1).max(80),
  order: z.coerce.number().int().min(1).max(1000).default(1),
  style: z.enum(["primary", "secondary", "success", "danger", "link"]).default("link"),
  type: z.enum(["store", "docs", "support", "website", "custom"]).default("custom"),
  url: z.string().url().max(2048).nullable().optional().or(z.literal(""))
});
const settingsSchema = z.object({
  buttons: z.array(buttonSchema).max(4).optional(),
  channelId: optionalSnowflake,
  companyAvatarUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  companyDocsUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  companyName: z.string().min(1).max(100).optional(),
  companySupportUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  companyWebsiteUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
  footerText: z.string().max(180).nullable().optional().or(z.literal("")),
  messageEnabled: z.boolean().optional(),
  messageTemplate: z.string().max(1200).optional(),
  panelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  photoMode: z.enum(["avatar", "company", "product"]).optional(),
  pingBuyer: z.boolean().optional(),
  pingRoles: z.boolean().optional(),
  showAvatar: z.boolean().optional(),
  showTimestamp: z.boolean().optional(),
  storeUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  title: z.string().min(1).max(120).optional()
});
const planSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  emoji: z.string().max(80).nullable().optional(),
  enabled: z.boolean().default(true),
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  order: z.coerce.number().int().min(1).max(1000).default(1),
  roleId: optionalSnowflake
});
const productSchema = z.object({
  active: z.boolean().default(true),
  category: z.string().min(1).max(80).default("Produto digital"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#FFD500"),
  emoji: z.string().max(80).nullable().optional(),
  iconUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  matchNames: z.array(z.string().min(1).max(100)).max(20).optional(),
  name: z.string().min(1).max(100),
  order: z.coerce.number().int().min(0).max(1000).default(0),
  plans: z.array(planSchema).max(20).default([])
});
const publicationSchema = z.object({
  amountCents: z.coerce.number().int().min(0).max(1000000000),
  buyerId: snowflake,
  buyerName: z.string().max(100).nullable().optional(),
  currency: z.enum(["BRL", "USD", "EUR"]),
  gateway: z.string().max(120).nullable().optional(),
  moduleId: z.string().max(120).nullable().optional(),
  paymentMethod: z.string().max(120).nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),
  planName: z.string().min(1).max(120),
  productId: z.string().max(160).nullable().optional(),
  productName: z.string().max(120).nullable().optional(),
  productPlanType: z.string().max(80).nullable().optional(),
  saleId: z.string().min(1).max(160)
});
const completeSchema = z.object({
  channelId: optionalSnowflake,
  error: z.string().max(1000).nullable().optional(),
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  saleId: z.string().min(1).max(160),
  status: z.enum(["sent", "failed", "skipped"])
});

subscriptionPresenceRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Módulo Pagamento de Presença não liberado." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json(await getSubscriptionPresenceDashboard(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

subscriptionPresenceRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar Pagamento de Presença." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json({ settings: await saveSubscriptionPresenceSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

subscriptionPresenceRouter.post("/:guildId/products", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar produtos." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.status(201).json({ product: await saveSubscriptionPresenceProduct(botId, guildId, null, sanitizeProduct(productSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

subscriptionPresenceRouter.patch("/:guildId/products/:productId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const productId = z.string().min(1).max(160).parse(req.params.productId);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar produtos." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.json({ product: await saveSubscriptionPresenceProduct(botId, guildId, productId, sanitizeProduct(productSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

subscriptionPresenceRouter.delete("/:guildId/products/:productId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const productId = z.string().min(1).max(160).parse(req.params.productId);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar produtos." });
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    await deleteSubscriptionPresenceProduct(botId, guildId, productId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

subscriptionPresenceRouter.post("/bot/:guildId/publications", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    return res.status(201).json(await createSubscriptionPresencePublication(botId, guildId, publicationSchema.parse(req.body ?? {})));
  } catch (error) {
    return next(error);
  }
});

subscriptionPresenceRouter.patch("/bot/:guildId/publications/:logId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const logId = z.string().min(1).max(160).parse(req.params.logId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    if (!botId) return res.status(400).json({ message: "botId obrigatório." });
    await completeSubscriptionPresencePublication(botId, guildId, logId, sanitizeComplete(completeSchema.parse(req.body ?? {})));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, SUBSCRIPTION_PRESENCE_MODULE_ID);
}

async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, SUBSCRIPTION_PRESENCE_MODULE_ID);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: SUBSCRIPTION_PRESENCE_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    buttons: input.buttons?.map((button) => ({ ...button, emoji: button.emoji || null, url: button.url || null })),
    channelId: input.channelId || null,
    companyAvatarUrl: input.companyAvatarUrl || null,
    companyDocsUrl: input.companyDocsUrl || null,
    companySupportUrl: input.companySupportUrl || null,
    companyWebsiteUrl: input.companyWebsiteUrl || null,
    footerText: input.footerText || null,
    storeUrl: input.storeUrl || null
  };
}

function sanitizeProduct(input: z.infer<typeof productSchema>) {
  return {
    ...input,
    emoji: input.emoji || null,
    iconUrl: input.iconUrl || null,
    plans: input.plans.map((plan) => ({ ...plan, color: plan.color || null, emoji: plan.emoji || null, roleId: plan.roleId || null }))
  };
}

function sanitizeComplete(input: z.infer<typeof completeSchema>) {
  return {
    ...input,
    channelId: input.channelId || null,
    error: input.error || null,
    messageId: input.messageId || null
  };
}
