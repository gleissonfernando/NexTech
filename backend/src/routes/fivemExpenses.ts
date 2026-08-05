import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  FIVEM_EXPENSE_MODULE_ID,
  getFivemExpenseDashboard,
  getFivemExpenseRuntime,
  registerFivemExpense,
  requestFivemExpensePanelPublish,
  resetFivemExpenses,
  saveFivemExpenseConfig,
  saveFivemExpenseItem,
  updateFivemExpensePanelState
} from "../services/fivemExpenseService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const organizationId = z.string().min(1).max(120).optional();

const configSchema = z.object({
  adminRoleIds: z.array(snowflake).max(100).optional(),
  allowAdministrators: z.boolean().optional(),
  allowNegativeBalance: z.boolean().optional(),
  authorizedRoleIds: z.array(snowflake).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  enabled: z.boolean().optional(),
  footerText: z.string().max(200).nullable().optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
  logsChannelId: optionalSnowflake,
  organizationId,
  organizationName: z.string().min(1).max(120).optional(),
  panelChannelId: optionalSnowflake,
  panelDescription: z.string().max(1500).optional(),
  panelName: z.string().max(120).optional(),
  panelTitle: z.string().max(120).optional(),
  summaryChannelId: optionalSnowflake,
  thumbnailUrl: z.string().max(2048).nullable().optional()
});

const itemSchema = z.object({
  amountMode: z.enum(["TOTAL", "UNIT_PRICE", "BOTH"]).optional(),
  deductFromCash: z.boolean().optional(),
  defaultUnitAmountCents: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().max(200).nullable().optional(),
  emoji: z.string().max(32).nullable().optional(),
  enabled: z.boolean().optional(),
  id: z.string().min(1).max(120).optional(),
  maxQuantity: z.coerce.number().int().positive().nullable().optional(),
  minQuantity: z.coerce.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(80),
  organizationId,
  position: z.coerce.number().int().min(1).max(1000).optional(),
  requiresAmount: z.boolean().optional(),
  requiresDescription: z.boolean().optional(),
  requiresQuantity: z.boolean().optional()
});

const registerSchema = z.object({
  channelId: snowflake,
  description: z.string().max(1000).nullable().optional(),
  interactionId: z.string().min(1).max(120),
  itemId: z.string().min(1).max(120),
  organizationId,
  quantity: z.coerce.number().int().positive().nullable().optional(),
  totalAmountCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unitAmountCents: z.coerce.number().int().positive().nullable().optional(),
  userAvatar: z.string().max(2048).nullable().optional(),
  userDisplayName: z.string().min(1).max(120),
  userId: snowflake
});

export const fivemExpensesRouter = Router();
fivemExpensesRouter.use(requireAuthOrBot);

fivemExpensesRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const org = organizationId.parse(req.query.organizationId);
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sistema de Gastos não liberado." });
    return res.json(await getFivemExpenseDashboard(guildId, botId, org));
  } catch (error) { return next(error); }
});

fivemExpensesRouter.put("/:guildId/config", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para configurar gastos." });
    const input = configSchema.parse(req.body);
    return res.json({ config: await saveFivemExpenseConfig(guildId, botId, input, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

fivemExpensesRouter.post("/:guildId/items", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para gerenciar itens." });
    return res.status(201).json({ item: await saveFivemExpenseItem(guildId, botId, itemSchema.parse(req.body)) });
  } catch (error) { return next(error); }
});

fivemExpensesRouter.patch("/:guildId/items/:itemId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para gerenciar itens." });
    return res.json({ item: await saveFivemExpenseItem(guildId, botId, itemSchema.parse({ ...req.body, id: req.params.itemId })) });
  } catch (error) { return next(error); }
});

fivemExpensesRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para publicar painel." });
    const org = organizationId.parse(req.body?.organizationId ?? req.query.organizationId);
    return res.json({ config: await requestFivemExpensePanelPublish(guildId, botId, org) });
  } catch (error) { return next(error); }
});

fivemExpensesRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.json(await getFivemExpenseRuntime(guildId, botId, organizationId.parse(req.query.organizationId)));
  } catch (error) { return next(error); }
});

fivemExpensesRouter.post("/bot/:guildId/register", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    return res.status(201).json({ record: await registerFivemExpense({ ...registerSchema.parse(req.body), guildId }, botId) });
  } catch (error) { return next(error); }
});

fivemExpensesRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const messageId = optionalSnowflake.parse(req.body?.messageId) ?? null;
    const org = organizationId.parse(req.body?.organizationId);
    return res.json({ config: await updateFivemExpensePanelState(guildId, botId, messageId, org) });
  } catch (error) { return next(error); }
});

fivemExpensesRouter.post("/bot/:guildId/reset", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    await assertRuntime(botId, guildId);
    const input = z.object({ actorId: snowflake, organizationId, reason: z.string().max(500).optional() }).parse(req.body);
    return res.json(await resetFivemExpenses(guildId, botId, input));
  } catch (error) { return next(error); }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, FIVEM_EXPENSE_MODULE_ID);
}
async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, FIVEM_EXPENSE_MODULE_ID);
}
async function assertRuntime(botId: string | null, guildId: string) {
  await authorizeBotRuntimeModule({ botId, guildId, moduleId: FIVEM_EXPENSE_MODULE_ID });
}
