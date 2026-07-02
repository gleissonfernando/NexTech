import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  createFivemOrder,
  createFivemOrderFamily,
  createFivemOrderProduct,
  deleteFivemOrderProduct,
  deleteFivemOrderFamily,
  FIVEM_ORDERS_MODULE_ID,
  getFivemOrderByNumber,
  getFivemOrderDashboard,
  getFivemOrderSettings,
  listFivemOrderProducts,
  listFivemOrderFamilies,
  listFivemOrders,
  requestFivemOrderPanelPublish,
  saveFivemOrderSettings,
  updateFivemOrderProduct,
  updateFivemOrderFamily,
  updateFivemOrderStatus
} from "../services/fivemOrderService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const statusSchema = z.enum(["open", "pending_approval", "approved", "in_production", "ready", "delivered", "cancelled", "rejected"]);
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).max(100).optional(), allowAnonymous: z.boolean().optional(), allowAttachments: z.boolean().optional(), allowCustomNotes: z.boolean().optional(),
  approvalChannelId: optionalSnowflake, approvalRequired: z.boolean().optional(), approveRoleIds: z.array(snowflake).max(100).optional(), cancelRoleIds: z.array(snowflake).max(100).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  createRoleIds: z.array(snowflake).max(100).optional(), deliveryChannelId: optionalSnowflake, enabled: z.boolean().optional(), errorMessage: z.string().max(500).optional(),
  editValueRoleIds: z.array(snowflake).max(100).optional(), enabledOrderModules: z.array(z.enum(["washing", "ammo", "drug", "weapon", "custom"])).max(5).optional(), finishRoleIds: z.array(snowflake).max(100).optional(), footerText: z.string().max(200).nullable().optional(), logChannelId: optionalSnowflake, maxOpenHours: z.coerce.number().min(1).max(8760).optional(),
  orderCancelledMessage: z.string().max(500).optional(), orderCreatedMessage: z.string().max(500).optional(), orderDeliveredMessage: z.string().max(500).optional(),
  panelChannelId: optionalSnowflake, panelDescription: z.string().max(1500).optional(), panelMessageId: optionalSnowflake, panelTitle: z.string().max(120).optional()
});
const productSchema = z.object({
  active: z.boolean().optional(), allowCustomQuantity: z.boolean().optional(), allowNotes: z.boolean().optional(), category: z.string().max(80).optional(),
  cost: z.coerce.number().min(0).max(1_000_000_000_000).optional(), description: z.string().max(500).nullable().optional(), emoji: z.string().max(80).nullable().optional(),
  defaultQuantity: z.coerce.number().int().min(1).max(1_000_000).optional(), factionPercentage: z.coerce.number().min(0).max(100).optional(), featured: z.boolean().optional(), maximumQuantity: z.coerce.number().int().min(1).max(1_000_000).optional(), minimumQuantity: z.coerce.number().int().min(1).max(1_000_000).optional(), minimumStock: z.coerce.number().min(0).max(1_000_000_000).optional(),
  washingPercentages: z.array(z.coerce.number().min(0).max(100)).max(25).optional(),
  name: z.string().min(1).max(100).optional(), order: z.coerce.number().int().min(0).max(10000).optional(), price: z.coerce.number().min(0).max(1_000_000_000_000).optional(),
  sellerPercentage: z.coerce.number().min(0).max(100).optional(), stock: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(), type: z.enum(["standard", "washing", "ammo", "drug", "weapon", "custom"]).optional(), useStock: z.boolean().optional()
});
const familySchema = z.object({
  active: z.boolean().optional(),
  logChannelId: optionalSnowflake,
  name: z.string().min(1).max(100),
  notes: z.string().max(1000).nullable().optional(),
  orderModules: z.array(z.enum(["washing", "ammo", "drug", "weapon", "custom"])).max(5).optional(),
  responsibleId: snowflake,
  roleId: snowflake
});
const createOrderSchema = z.object({
  clientName: z.string().min(1).max(120), expectedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), grossValue: z.coerce.number().min(0).max(1_000_000_000_000).nullable().optional(),
  familyId: z.string().min(1).max(80), guildId: snowflake, notes: z.string().max(1000).nullable().optional(), productId: z.string().min(1).max(80), proofUrl: z.string().max(2048).nullable().optional(),
  quantity: z.coerce.number().min(1).max(1_000_000), sourceId: z.string().max(120).nullable().optional(), userId: snowflake,
  washingPercentage: z.coerce.number().min(0).max(100).nullable().optional()
});
const updateStatusSchema = z.object({ actorId: snowflake, guildId: snowflake, note: z.string().max(500).nullable().optional(), status: statusSchema });

export const fivemOrdersRouter = Router();
fivemOrdersRouter.use(requireAuthOrBot);

fivemOrdersRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId); else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Modulo de encomendas nao liberado." });
    return res.json(await getFivemOrderDashboard(guildId, botId));
  } catch (error) { return next(error); }
});

fivemOrdersRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); const input = settingsSchema.parse(req.body);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para configurar encomendas." });
    return res.json({ settings: await saveFivemOrderSettings(guildId, botId, input, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

fivemOrdersRouter.post("/:guildId/products", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); const input = productSchema.parse(req.body);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para criar produtos." });
    return res.status(201).json({ product: await createFivemOrderProduct(guildId, botId, input, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

fivemOrdersRouter.post("/:guildId/families", async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); const input = familySchema.parse(req.body); if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para criar familias." }); return res.status(201).json({ family: await createFivemOrderFamily(guildId, botId, input, res.locals.dashboardAuth.user.discordId) }); } catch (error) { return next(error); }
});
fivemOrdersRouter.patch("/:guildId/families/:familyId", async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const familyId = z.string().min(1).max(80).parse(req.params.familyId); const botId = await resolveRequestBotId(req); const input = familySchema.partial().parse(req.body); if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para editar familias." }); const family = await updateFivemOrderFamily(guildId, botId, familyId, input, res.locals.dashboardAuth.user.discordId); if (!family) return res.status(404).json({ message: "Familia nao encontrada." }); return res.json({ family }); } catch (error) { return next(error); }
});
fivemOrdersRouter.delete("/:guildId/families/:familyId", async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const familyId = z.string().min(1).max(80).parse(req.params.familyId); const botId = await resolveRequestBotId(req); if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para excluir familias." }); const family = await deleteFivemOrderFamily(guildId, botId, familyId, res.locals.dashboardAuth.user.discordId); if (!family) return res.status(404).json({ message: "Familia nao encontrada." }); return res.json({ family }); } catch (error) { return next(error); }
});

fivemOrdersRouter.patch("/:guildId/products/:productId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const productId = z.string().min(1).max(80).parse(req.params.productId); const botId = await resolveRequestBotId(req); const input = productSchema.partial().parse(req.body);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para editar produtos." });
    const product = await updateFivemOrderProduct(guildId, botId, productId, input, res.locals.dashboardAuth.user.discordId); if (!product) return res.status(404).json({ message: "Produto nao encontrado." });
    return res.json({ product });
  } catch (error) { return next(error); }
});

fivemOrdersRouter.delete("/:guildId/products/:productId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const productId = z.string().min(1).max(80).parse(req.params.productId); const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para excluir produtos." });
    const product = await deleteFivemOrderProduct(guildId, botId, productId, res.locals.dashboardAuth.user.discordId); if (!product) return res.status(404).json({ message: "Produto nao encontrado." });
    return res.json({ product });
  } catch (error) { return next(error); }
});

fivemOrdersRouter.patch("/:guildId/orders/:orderId/status", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const orderId = z.string().min(1).max(80).parse(req.params.orderId); const botId = await resolveRequestBotId(req); const input = z.object({ note: z.string().max(500).nullable().optional(), status: statusSchema }).parse(req.body);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para atualizar encomendas." });
    const order = await updateFivemOrderStatus(guildId, botId, orderId, input.status, res.locals.dashboardAuth.user.discordId, input.note); if (!order) return res.status(404).json({ message: "Encomenda nao encontrada." });
    return res.json({ order });
  } catch (error) { return next(error); }
});

fivemOrdersRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para publicar o painel." });
    return res.json({ settings: await requestFivemOrderPanelPublish(guildId, botId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

fivemOrdersRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); return res.json({ families: await listFivemOrderFamilies(guildId, botId, true), products: await listFivemOrderProducts(guildId, botId, true), settings: await getFivemOrderSettings(guildId, botId) }); } catch (error) { return next(error); }
});
fivemOrdersRouter.get("/bot/:guildId/orders/:orderNumber", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const orderNumber = z.coerce.number().int().min(1).parse(req.params.orderNumber); const userId = req.query.userId ? snowflake.parse(req.query.userId) : null; const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); return res.json({ order: await getFivemOrderByNumber(guildId, botId, orderNumber, userId) }); } catch (error) { return next(error); }
});
fivemOrdersRouter.post("/bot/orders", requireBot, async (req, res, next) => {
  try { const input = createOrderSchema.parse(req.body); const botId = await resolveRequestBotId(req); await assertRuntime(botId, input.guildId); return res.status(201).json({ order: await createFivemOrder({ ...input, botId }) }); } catch (error) { return next(error); }
});
fivemOrdersRouter.post("/bot/:guildId/products", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const input = productSchema.parse(req.body); const actorId = snowflake.parse(req.body.actorId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); return res.status(201).json({ product: await createFivemOrderProduct(guildId, botId, input, actorId) }); } catch (error) { return next(error); }
});
fivemOrdersRouter.patch("/bot/:guildId/products/:productId", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const productId = z.string().min(1).max(80).parse(req.params.productId); const input = productSchema.partial().parse(req.body); const actorId = snowflake.parse(req.body.actorId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); const product = await updateFivemOrderProduct(guildId, botId, productId, input, actorId); if (!product) return res.status(404).json({ message: "Produto nao encontrado." }); return res.json({ product }); } catch (error) { return next(error); }
});
fivemOrdersRouter.delete("/bot/:guildId/products/:productId", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const productId = z.string().min(1).max(80).parse(req.params.productId); const actorId = snowflake.parse(req.query.actorId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); const product = await deleteFivemOrderProduct(guildId, botId, productId, actorId); if (!product) return res.status(404).json({ message: "Produto nao encontrado." }); return res.json({ product }); } catch (error) { return next(error); }
});
fivemOrdersRouter.patch("/bot/orders/:orderId/status", requireBot, async (req, res, next) => {
  try { const orderId = z.string().min(1).max(80).parse(req.params.orderId); const input = updateStatusSchema.parse(req.body); const botId = await resolveRequestBotId(req); await assertRuntime(botId, input.guildId); const order = await updateFivemOrderStatus(input.guildId, botId, orderId, input.status, input.actorId, input.note); if (!order) return res.status(404).json({ message: "Encomenda nao encontrada." }); return res.json({ order }); } catch (error) { return next(error); }
});
fivemOrdersRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const input = z.object({ messageId: optionalSnowflake }).parse(req.body); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); return res.json({ settings: await saveFivemOrderSettings(guildId, botId, { panelMessageId: input.messageId || null }, null) }); } catch (error) { return next(error); }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, FIVEM_ORDERS_MODULE_ID))
    || (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "fivem-washing"))
    || (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "fivem-drugs"));
}
async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, FIVEM_ORDERS_MODULE_ID))
    || (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "fivem-washing"))
    || (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "fivem-drugs"));
}
async function assertRuntime(botId: string | null, guildId: string) {
  const ordersAccess = await authorizeBotRuntimeModule({ botId, guildId, moduleId: FIVEM_ORDERS_MODULE_ID });
  if (ordersAccess.allowed) return;
  const washingAccess = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "fivem-washing" });
  if (washingAccess.allowed) return;
  const drugsAccess = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "fivem-drugs" });
  if (drugsAccess.allowed) return;
  throw Object.assign(new Error(ordersAccess.reason), { statusCode: 403 });
}
