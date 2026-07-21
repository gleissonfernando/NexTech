import { Router, raw, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuth, requireAuthOrBot } from "../middleware/auth";
import { canReadDashboardGuild, canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createZtkClan,
  createZtkReward,
  getZtkWebhookDashboard,
  ingestZtkWebhookEvent,
  updateZtkClan,
  updateZtkWebhookState,
  ZTK_WEBHOOK_MODULE_ID
} from "../services/ztkWebhookService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const id = z.string().min(1).max(120);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).optional();
const clanSchema = z.object({
  active: z.boolean().optional(),
  clanName: z.string().min(1).max(80).optional(),
  dominationChannelId: optionalSnowflake,
  rankingChannelId: optionalSnowflake,
  recruitmentChannelId: optionalSnowflake,
  rewardChannelId: optionalSnowflake,
  settingsChannelId: optionalSnowflake
});
const createClanSchema = z.object({
  clanName: z.string().min(1).max(80),
  ownerUserId: snowflake.optional()
});
const rewardSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
  rankingType: z.enum(["domination", "recruitment", "online"]).optional(),
  rewardDate: z.string().max(40).nullable().optional(),
  winners: z.array(z.object({
    place: z.coerce.number().int().min(1).max(50),
    value: z.string().min(1).max(40)
  })).max(10).optional()
});

export const ztkWebhookRouter = Router();

ztkWebhookRouter.post("/ingest/:clanId/:token", raw({ limit: "2mb", type: () => true }), async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : ((req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {}));
    const payload = parseIncomingPayload(req.body, rawBody);
    const result = await ingestZtkWebhookEvent(id.parse(req.params.clanId), z.string().min(16).max(200).parse(req.params.token), payload, rawBody);
    return res.status(result.duplicate ? 202 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

ztkWebhookRouter.use(requireAuthOrBot);

ztkWebhookRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req)) await assertRuntime(botId, guildId);
    else if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "ZTK Webhook não liberado." });
    const userId = res.locals.dashboardAuth?.user?.discordId ?? null;
    const canManage = isBotRequest(req) || await canManageZtk(req, guildId, botId);
    const selectedClanId = typeof req.query.clanId === "string" && req.query.clanId.trim() ? id.parse(req.query.clanId) : null;
    return res.json(await getZtkWebhookDashboard(guildId, botId, userId, canManage, selectedClanId));
  } catch (error) {
    return next(error);
  }
});

ztkWebhookRouter.post("/:guildId/clans", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!(await canRead(req, guildId, botId))) return res.status(403).json({ message: "ZTK Webhook não liberado." });
    const input = createClanSchema.parse(req.body);
    const ownerUserId = input.ownerUserId && await canManageZtk(req, guildId, botId)
      ? input.ownerUserId
      : res.locals.dashboardAuth.user.discordId;
    return res.status(201).json({ clan: await createZtkClan(guildId, botId, { clanName: input.clanName, ownerUserId }) });
  } catch (error) {
    return next(error);
  }
});

ztkWebhookRouter.patch("/:guildId/clans/:clanId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!(await canManageClan(req, guildId, botId, req.params.clanId ?? ""))) return res.status(403).json({ message: "Sem permissão para configurar este clã." });
    const clan = await updateZtkClan(guildId, botId, id.parse(req.params.clanId), clanSchema.parse(req.body), res.locals.dashboardAuth.user.discordId);
    if (!clan) return res.status(404).json({ message: "Clã ZTK não encontrado." });
    return res.json({ clan });
  } catch (error) {
    return next(error);
  }
});

ztkWebhookRouter.post("/:guildId/clans/:clanId/webhook/:action", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const action = z.enum(["create", "regenerate", "disable", "delete"]).parse(req.params.action);
    if (!(await canManageClan(req, guildId, botId, req.params.clanId ?? ""))) return res.status(403).json({ message: "Sem permissão para gerenciar esta webhook." });
    const clan = await updateZtkWebhookState(guildId, botId, id.parse(req.params.clanId), action, res.locals.dashboardAuth.user.discordId);
    if (!clan) return res.status(404).json({ message: "Clã ZTK não encontrado." });
    return res.json({ clan });
  } catch (error) {
    return next(error);
  }
});

ztkWebhookRouter.post("/:guildId/clans/:clanId/rewards", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!(await canManageZtk(req, guildId, botId))) return res.status(403).json({ message: "Sem permissão para criar premiações." });
    const reward = await createZtkReward(guildId, botId, id.parse(req.params.clanId), rewardSchema.parse(req.body), res.locals.dashboardAuth.user.discordId);
    if (!reward) return res.status(404).json({ message: "Clã ZTK não encontrado." });
    return res.status(201).json({ reward });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, ZTK_WEBHOOK_MODULE_ID);
}

async function canManageZtk(req: Request, guildId: string, botId: string | null) {
  if (!botId) return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
  return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, ZTK_WEBHOOK_MODULE_ID);
}

async function canManageClan(req: Request, guildId: string, botId: string | null, clanId: string) {
  if (await canManageZtk(req, guildId, botId)) return true;
  const dashboard = await getZtkWebhookDashboard(guildId, botId, req.res?.locals.dashboardAuth.user.discordId ?? null, false);
  return dashboard.clans.some((clan) => clan.id === clanId);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const access = await authorizeBotRuntimeModule({ botId, guildId, moduleId: ZTK_WEBHOOK_MODULE_ID });
  if (access.allowed) return;
  throw Object.assign(new Error(access.reason), { statusCode: 403 });
}

function parseIncomingPayload(body: unknown, rawBody: string) {
  if (body && !Buffer.isBuffer(body)) return body;
  try {
    return JSON.parse(rawBody);
  } catch {
    return { content: rawBody };
  }
}
