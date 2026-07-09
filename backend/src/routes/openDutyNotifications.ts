import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import {
  getOpenDutyDashboard,
  getOpenDutySettings,
  OPEN_DUTY_MODULE_ID,
  recordOpenDutyDelivery,
  resetOpenDutyCounter,
  saveOpenDutySettings
} from "../services/openDutyNotificationService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const openDutyNotificationsRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const nullableSnowflake = snowflake.nullable().optional().or(z.literal(""));
const configSchema = z.object({
  alertChannelId: nullableSnowflake,
  alertMessage: z.string().max(1200).optional(),
  allowedRoleIds: z.array(snowflake).max(100).optional(),
  allowedUserIds: z.array(snowflake).max(100).optional(),
  buttonEmojis: z.object({
    cancel: z.string().max(20),
    config: z.string().max(20),
    edit: z.string().max(20),
    logs: z.string().max(20),
    reset: z.string().max(20),
    save: z.string().max(20),
    search: z.string().max(20),
    send: z.string().max(20)
  }).optional(),
  counterMode: z.enum(["accumulate", "reset_after_3", "cycles"]).optional(),
  defaultMessage: z.string().max(3000).optional(),
  dmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
  footerIconUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  footerImageUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  footerText: z.string().max(300).nullable().optional().or(z.literal("")),
  imagePosition: z.enum(["top", "middle", "bottom", "footer"]).optional(),
  logChannelId: nullableSnowflake,
  panelBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  panelColor: z.string().max(24).optional()
});
const deliverySchema = z.object({
  edited: z.boolean().default(false),
  errorReason: z.string().max(1000).nullable().optional(),
  executorId: snowflake,
  message: z.string().max(3000).default(""),
  status: z.enum(["sent", "failed", "cancelled", "denied"]),
  targetId: snowflake
});
const resetSchema = z.object({ userId: snowflake });

openDutyNotificationsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getOpenDutyDashboard(botId, guildId));
  } catch (error) { next(error); }
});

openDutyNotificationsRouter.patch("/:guildId/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ settings: await saveOpenDutySettings(botId, guildId, configSchema.parse(req.body), res.locals.dashboardAuth.user.discordId) });
  } catch (error) { next(error); }
});

openDutyNotificationsRouter.post("/:guildId/reset-counter", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({ counter: await resetOpenDutyCounter(botId, guildId, resetSchema.parse(req.body).userId) });
  } catch (error) { next(error); }
});

openDutyNotificationsRouter.get("/bot/:guildId/config", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getOpenDutySettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) { next(error); }
});

openDutyNotificationsRouter.post("/bot/:guildId/deliveries", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    const guildId = snowflake.parse(req.params.guildId);
    res.status(201).json(await recordOpenDutyDelivery(botId, guildId, deliverySchema.parse(req.body)));
  } catch (error) { next(error); }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(OPEN_DUTY_MODULE_ID)) throw routeError("Ponto Aberto não liberado.", 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, OPEN_DUTY_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, OPEN_DUTY_MODULE_ID);
  if (!allowed) throw routeError("Sem permissão para Ponto Aberto.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
