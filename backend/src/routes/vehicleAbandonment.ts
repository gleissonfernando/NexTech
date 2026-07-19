import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createVehicleAbandonmentRecord,
  getVehicleAbandonmentDashboard,
  getVehicleAbandonmentRecord,
  getVehicleAbandonmentSettings,
  saveVehicleAbandonmentSettings,
  updateVehicleAbandonmentRecord,
  VEHICLE_ABANDONMENT_MODULE_ID
} from "../services/vehicleAbandonmentService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const id = z.string().uuid();
const nullableSnowflake = snowflake.nullable();
const httpUrl = z.string().url().max(2048).nullable();
const settingsSchema = z.object({
  allowMultipleAttachments: z.boolean().optional(),
  allowRecordEditing: z.boolean().optional(),
  allowedRoleIds: z.array(snowflake).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  confirmationBeforeSend: z.boolean().optional(),
  defaultImageUrl: httpUrl.optional(),
  deleteOriginalMessage: z.boolean().optional(),
  embedTitle: z.string().max(200).optional(),
  emoji: z.string().max(80).optional(),
  enabled: z.boolean().optional(),
  errorMessage: z.string().max(500).optional(),
  explanatoryPanelAllowedRoleIds: z.array(snowflake).max(100).optional(),
  explanatoryPanelButtonEnabled: z.boolean().optional(),
  explanatoryPanelChannelId: nullableSnowflake.optional(),
  explanatoryPanelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  explanatoryPanelCommandEnabled: z.boolean().optional(),
  explanatoryPanelCommonErrorsText: z.string().max(1600).optional(),
  explanatoryPanelDescription: z.string().max(1200).optional(),
  explanatoryPanelEmoji: z.string().max(80).optional(),
  explanatoryPanelExampleText: z.string().max(1800).optional(),
  explanatoryPanelFinalText: z.string().max(1000).optional(),
  explanatoryPanelHowItWorksText: z.string().max(1800).optional(),
  explanatoryPanelImageUrl: httpUrl.optional(),
  explanatoryPanelModalContent: z.string().max(3800).optional(),
  explanatoryPanelModalTitle: z.string().max(45).optional(),
  explanatoryPanelNotesText: z.string().max(1800).optional(),
  explanatoryPanelRequiredFieldsText: z.string().max(1000).optional(),
  explanatoryPanelThumbnailUrl: httpUrl.optional(),
  explanatoryPanelTitle: z.string().max(200).optional(),
  footerText: z.string().max(200).optional(),
  logChannelId: nullableSnowflake.optional(),
  logsEnabled: z.boolean().optional(),
  maxImages: z.coerce.number().int().min(1).max(10).optional(),
  mentionRoleId: nullableSnowflake.optional(),
  recordChannelId: nullableSnowflake.optional(),
  successMessage: z.string().max(500).optional(),
  systemChannelId: nullableSnowflake.optional(),
  systemName: z.string().max(120).optional(),
  thumbnailUrl: httpUrl.optional()
});
const recordSchema = z.object({
  authorId: snowflake,
  authorName: z.string().max(100),
  guildId: snowflake,
  imageUrls: z.array(z.string().url().max(2048)).min(1).max(10),
  model: z.string().min(1).max(300),
  plate: z.string().min(1).max(80),
  recordChannelId: snowflake,
  recordMessageId: snowflake.nullable().optional(),
  report: z.string().min(1).max(2000),
  sourceMessageId: snowflake,
  systemChannelId: snowflake
});
const recordPatchSchema = z.object({
  model: z.string().min(1).max(300).optional(),
  plate: z.string().min(1).max(80).optional(),
  recordMessageId: snowflake.nullable().optional(),
  report: z.string().min(1).max(2000).optional()
});

export const vehicleAbandonmentRouter = Router();

vehicleAbandonmentRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, false);
    res.json(await getVehicleAbandonmentDashboard(botId, guildId));
  } catch (error) {
    next(error);
  }
});

vehicleAbandonmentRouter.patch("/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await botIdFor(req);
    await authorize(res.locals.dashboardAuth.user, botId, guildId, true);
    res.json({
      settings: await saveVehicleAbandonmentSettings(botId, guildId, settingsSchema.parse(req.body), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    next(error);
  }
});

vehicleAbandonmentRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ settings: await getVehicleAbandonmentSettings(botId, snowflake.parse(req.params.guildId)) });
  } catch (error) {
    next(error);
  }
});

vehicleAbandonmentRouter.post("/bot/records", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.status(201).json({ record: await createVehicleAbandonmentRecord(botId, recordSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

vehicleAbandonmentRouter.get("/bot/records/:recordId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ record: await getVehicleAbandonmentRecord(botId, id.parse(req.params.recordId)) });
  } catch (error) {
    next(error);
  }
});

vehicleAbandonmentRouter.patch("/bot/records/:recordId", requireBot, async (req, res, next) => {
  try {
    const botId = await botIdFor(req);
    await licensed(botId);
    res.json({ record: await updateVehicleAbandonmentRecord(botId, id.parse(req.params.recordId), recordPatchSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

async function botIdFor(req: any) {
  const value = await resolveRequestBotId(req);
  if (!value) throw routeError("Bot não identificado.", 400);
  return value;
}

async function licensed(botId: string) {
  const permissions = await getBotApiPermissions(botId);
  if (!permissions) throw routeError("Bot não encontrado.", 404);
  if (!permissions.enabledModules.includes(VEHICLE_ABANDONMENT_MODULE_ID)) throw routeError("Abandono de Veículo não liberado.", 403);
}

async function authorize(user: any, botId: string, guildId: string, manage: boolean) {
  await licensed(botId);
  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, VEHICLE_ABANDONMENT_MODULE_ID)
    : await canReadDevBotModule(user, botId, guildId, VEHICLE_ABANDONMENT_MODULE_ID);

  if (!allowed) throw routeError("Sem permissão para Abandono de Veículo.", 403);
}

function routeError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
