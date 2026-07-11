import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  createFivemFinanceTransaction,
  FIVEM_FINANCE_MODULE_ID,
  getFivemFinanceDashboard,
  getFivemFinanceSettings,
  listFivemFinanceTransactions,
  requestFivemFinancePanelPublish,
  saveFivemFinanceSettings,
  updateFivemFinancePanelState,
  updateFivemFinanceTransactionLog,
  updateFivemFinanceTransaction
} from "../services/fivemFinanceService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const settingsSchema = z.object({
  adminRoleIds: z.array(snowflake).max(100).optional(),
  allowBalanceQuery: z.boolean().optional(),
  allowNegativeBalance: z.boolean().optional(),
  confirmAdd: z.boolean().optional(),
  confirmRemove: z.boolean().optional(),
  historyEnabled: z.boolean().optional(),
  historyPageSize: z.coerce.number().int().min(5).max(25).optional(),
  maxTransactionAmount: z.coerce.number().positive().max(1_000_000_000_000).optional(),
  requireReason: z.boolean().optional(),
  autoCloseMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  bannerMode: z.enum(["above", "inside", "below", "none"]).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  enabled: z.boolean().optional(),
  footerImageUrl: z.string().max(2048).nullable().optional(),
  footerText: z.string().max(200).nullable().optional(),
  logChannelId: optionalSnowflake,
  panelChannelId: optionalSnowflake,
  panelDescription: z.string().max(1500).optional(),
  panelMessageId: optionalSnowflake,
  panelTitle: z.string().max(120).optional(),
  tempCategoryId: optionalSnowflake,
  useRoleIds: z.array(snowflake).max(100).optional()
});
const transactionSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000_000),
  logChannelId: optionalSnowflake,
  logMessageId: optionalSnowflake,
  proofImageUrl: z.union([z.string().url().max(2048), z.literal("")]).default(""),
  proofMessageId: optionalSnowflake,
  tempChannelId: optionalSnowflake,
  type: z.enum(["add", "remove"]),
  userAvatar: z.string().url().max(2048).nullable().optional(),
  userId: snowflake,
  username: z.string().min(1).max(120)
  ,managerId: snowflake.optional(), managerName: z.string().min(1).max(120).optional(), personName: z.string().min(1).max(120).optional(), reason: z.string().max(1000).optional(), targetUserId: snowflake.optional()
});
const correctionSchema = z.object({ amount: z.coerce.number().positive().max(1_000_000_000_000).optional(), notes: z.string().max(1000).nullable().optional(), status: z.enum(["completed", "reviewed", "cancelled", "corrected"]).optional() });

export const fivemFinanceRouter = Router();
fivemFinanceRouter.use(requireAuthOrBot);

fivemFinanceRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId); else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Modulo financeiro nao liberado." });
    return res.json(await getFivemFinanceDashboard(guildId, botId));
  } catch (error) { return next(error); }
});

fivemFinanceRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); const input = settingsSchema.parse(req.body);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para configurar financeiro." });
    return res.json({ settings: await saveFivemFinanceSettings(guildId, botId, input, res.locals.dashboardAuth.user.discordId) });
  } catch (error) { return next(error); }
});

fivemFinanceRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para publicar painel." });
    return res.json({ settings: await requestFivemFinancePanelPublish(guildId, botId) });
  } catch (error) { return next(error); }
});

fivemFinanceRouter.patch("/:guildId/transactions/:id", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); const input = correctionSchema.parse(req.body);
    if (isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para corrigir movimentacoes." });
    const transaction = await updateFivemFinanceTransaction(guildId, botId, req.params.id, input, res.locals.dashboardAuth.user.discordId);
    if (!transaction) return res.status(404).json({ message: "Movimentacao nao encontrada." });
    return res.json({ transaction });
  } catch (error) { return next(error); }
});

fivemFinanceRouter.get("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); return res.json({ settings: await getFivemFinanceSettings(guildId, botId), transactions: await listFivemFinanceTransactions(guildId, botId, 1000) }); } catch (error) { return next(error); }
});

fivemFinanceRouter.post("/bot/:guildId/transactions", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); const input = transactionSchema.parse(req.body); return res.status(201).json({ transaction: await createFivemFinanceTransaction({ ...input, guildId }, botId) }); } catch (error) { return next(error); }
});

fivemFinanceRouter.put("/bot/:guildId/panel-state", requireBot, async (req, res, next) => {
  try { const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId); const messageId = optionalSnowflake.parse(req.body?.messageId) ?? null; return res.json({ settings: await updateFivemFinancePanelState(guildId, botId, messageId) }); } catch (error) { return next(error); }
});

fivemFinanceRouter.patch("/bot/:guildId/transactions/:id/log", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId); const botId = await resolveRequestBotId(req); await assertRuntime(botId, guildId);
    const id = z.string().min(1).max(120).parse(req.params.id);
    const input = z.object({ logChannelId: optionalSnowflake, logMessageId: optionalSnowflake }).parse(req.body);
    const transaction = await updateFivemFinanceTransactionLog(guildId, botId, id, input);
    if (!transaction) return res.status(404).json({ message: "Movimentacao nao encontrada." });
    return res.json({ transaction });
  } catch (error) { return next(error); }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, FIVEM_FINANCE_MODULE_ID);
}
async function canManage(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, FIVEM_FINANCE_MODULE_ID);
}
async function assertRuntime(botId: string | null, guildId: string) { await authorizeBotRuntimeModule({ botId, guildId, moduleId: FIVEM_FINANCE_MODULE_ID }); }
