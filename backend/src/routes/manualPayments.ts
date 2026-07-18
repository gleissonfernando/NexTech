import { Router, raw, type Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MongoManualPaymentService } from "../database/mongo";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  createManualPaymentOrder,
  getManualPaymentOrder,
  getManualPaymentRuntime,
  getManualPaymentsDashboard,
  MANUAL_PAYMENTS_MODULE_ID,
  requestManualPaymentPanelPublish,
  saveManualPaymentSettings,
  updateManualPaymentOrder,
  updateManualPaymentPanelState,
  uploadManualPaymentQrCode
} from "../services/manualPaymentService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const manualPaymentsRouter = Router();
manualPaymentsRouter.use(requireAuthOrBot);

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const serviceSchema = z.object({
  active: z.boolean().default(true),
  amount: z.coerce.number().min(0).max(100000000),
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  createServiceChannel: z.boolean().default(true),
  customText: z.string().max(1200).nullable().optional().or(z.literal("")),
  description: z.string().max(600).nullable().optional().or(z.literal("")),
  id: z.string().max(120).optional().or(z.literal("")),
  manualApproval: z.boolean().default(true),
  name: z.string().min(1).max(100),
  order: z.number().int().min(0).max(500).default(0),
  serviceType: z.string().min(1).max(80).default("serviço")
});
const settingsSchema = z.object({
  approveRoleIds: z.array(snowflake).max(100).optional(),
  attendanceCategoryId: optionalSnowflake,
  bannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  enabled: z.boolean().optional(),
  finalizeRoleIds: z.array(snowflake).max(100).optional(),
  logChannelId: optionalSnowflake,
  logViewRoleIds: z.array(snowflake).max(100).optional(),
  maxPaymentMinutes: z.coerce.number().int().min(5).max(10080).optional(),
  paymentCategoryId: optionalSnowflake,
  paymentInstructions: z.string().max(1500).optional(),
  pixCopyPasteCode: z.string().max(1200).nullable().optional().or(z.literal("")),
  pixKey: z.string().max(180).nullable().optional().or(z.literal("")),
  pixKeyType: z.enum(["cpf", "cnpj", "phone", "email", "random"]).optional(),
  pixQrCodeUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  receiverBank: z.string().max(100).nullable().optional().or(z.literal("")),
  receiverName: z.string().max(100).nullable().optional().or(z.literal("")),
  rejectRoleIds: z.array(snowflake).max(100).optional(),
  salePanelChannelId: optionalSnowflake,
  salePanelDescription: z.string().max(1500).optional(),
  salePanelMessageId: optionalSnowflake,
  salePanelTitle: z.string().max(120).optional(),
  services: z.array(serviceSchema).max(50).optional(),
  supportPanelChannelId: optionalSnowflake
});
const qrCodeUpload = raw({
  limit: "10mb",
  type: () => true
});
const orderCreateSchema = z.object({
  serviceId: z.string().min(1).max(120),
  userId: snowflake,
  username: z.string().max(100).nullable().optional()
});
const orderPatchSchema = z.object({
  action: z.string().max(80).optional(),
  channelId: optionalSnowflake,
  paymentChannelId: optionalSnowflake,
  paymentMessageId: optionalSnowflake,
  paymentMethod: z.enum(["PIX_KEY", "PIX_QR_CODE"]).nullable().optional(),
  proofMessageId: optionalSnowflake,
  proofUrl: z.string().url().max(2048).nullable().optional(),
  reason: z.string().max(1000).nullable().optional(),
  serviceChannelId: optionalSnowflake,
  staffId: snowflake.nullable().optional(),
  staffMessageId: optionalSnowflake,
  status: z.enum(["PENDING_PAYMENT", "WAITING_STAFF_APPROVAL", "APPROVED", "REJECTED", "IN_PROGRESS", "WAITING_CUSTOMER", "DELIVERED", "FINISHED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_STAFF"]).optional()
});

manualPaymentsRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Módulo de pagamentos não liberado." });
    return res.json(await getManualPaymentsDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar pagamentos." });
    return res.json({ settings: await saveManualPaymentSettings(guildId, botId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar painel de vendas." });
    return res.json({ settings: await requestManualPaymentPanelPublish(guildId, botId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.put("/:guildId/qr-code", qrCodeUpload, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar pagamentos." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Envie a imagem do QR Code." });
    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    return res.json({
      settings: await uploadManualPaymentQrCode({
        actorId: res.locals.dashboardAuth.user.discordId,
        botId,
        buffer: req.body,
        guildId,
        mimeType
      })
    });
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.json(await getManualPaymentRuntime(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const messageId = optionalSnowflake.parse(req.body?.messageId) ?? null;
    return res.json({ settings: await updateManualPaymentPanelState(guildId, botId, messageId || null) });
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.post("/bot/:guildId/orders", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const order = await createManualPaymentOrder(guildId, botId, orderCreateSchema.parse(req.body ?? {}));
    if (!order) return res.status(404).json({ message: "Servico indisponível." });
    return res.status(201).json({ order });
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.get("/bot/:guildId/orders/:orderId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const orderId = z.string().min(1).max(120).parse(req.params.orderId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.json({ order: await getManualPaymentOrder(guildId, botId, orderId) });
  } catch (error) {
    return next(error);
  }
});

manualPaymentsRouter.patch("/bot/:guildId/orders/:orderId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const orderId = z.string().min(1).max(120).parse(req.params.orderId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const order = await updateManualPaymentOrder(guildId, botId, orderId, sanitizePatch(orderPatchSchema.parse(req.body ?? {})));
    if (!order) return res.status(404).json({ message: "Pedido não encontrado." });
    return res.json({ order });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, MANUAL_PAYMENTS_MODULE_ID);
}

async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, MANUAL_PAYMENTS_MODULE_ID);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: MANUAL_PAYMENTS_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error(authorization.reason), { statusCode: 403 });
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    attendanceCategoryId: input.attendanceCategoryId || null,
    bannerUrl: input.bannerUrl || null,
    logChannelId: input.logChannelId || null,
    paymentCategoryId: input.paymentCategoryId || null,
    pixCopyPasteCode: input.pixCopyPasteCode || null,
    pixKey: input.pixKey || null,
    pixQrCodeUrl: input.pixQrCodeUrl || null,
    receiverBank: input.receiverBank || null,
    receiverName: input.receiverName || null,
    salePanelChannelId: input.salePanelChannelId || null,
    salePanelMessageId: input.salePanelMessageId || null,
    services: input.services?.map((service, index): MongoManualPaymentService => ({
      active: service.active,
      amount: service.amount,
      bannerUrl: service.bannerUrl || null,
      createServiceChannel: service.createServiceChannel,
      customText: service.customText || null,
      description: service.description || null,
      id: service.id || randomUUID(),
      manualApproval: service.manualApproval,
      name: service.name,
      order: service.order ?? index,
      serviceType: service.serviceType
    })),
    supportPanelChannelId: input.supportPanelChannelId || null
  };
}

function sanitizePatch(input: z.infer<typeof orderPatchSchema>) {
  return {
    ...input,
    channelId: input.channelId || null,
    paymentChannelId: input.paymentChannelId || null,
    paymentMessageId: input.paymentMessageId || null,
    proofMessageId: input.proofMessageId || null,
    proofUrl: input.proofUrl || null,
    reason: input.reason || null,
    serviceChannelId: input.serviceChannelId || null,
    staffMessageId: input.staffMessageId || null
  };
}
