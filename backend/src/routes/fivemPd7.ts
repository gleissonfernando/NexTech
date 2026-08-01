import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  createPd7Request,
  getPd7Dashboard,
  getPd7Request,
  listActivePd7Settings,
  listPd7Settings,
  requestPd7Publish,
  savePd7Settings,
  updatePd7PanelState,
  updatePd7Request
} from "../services/fivemPd7Service";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = z.union([snowflake, z.literal(""), z.null()]).transform((value) => value || null);
const id = z.string().min(1).max(80);
const field = z.object({
  id: id.regex(/^[a-z0-9_-]+$/i),
  label: z.string().min(1).max(45),
  order: z.number().int().min(0).max(4),
  placeholder: z.string().max(100).nullable(),
  required: z.boolean(),
  style: z.enum(["short", "paragraph"])
});
const settingsSchema = z.object({
  allowedRolesPD7: z.array(snowflake).max(100).optional(),
  approvedRolePD7: optionalSnowflake.optional(),
  autoDeleteMinutes: z.number().int().min(0).max(43200).nullable().optional(),
  categoryPD7: optionalSnowflake.optional(),
  enabled: z.boolean().optional(),
  factionName: z.string().min(1).max(80).optional(),
  fields: z.array(field).min(1).max(5).optional(),
  logChannelPD7: optionalSnowflake.optional(),
  panelChannelPD7: optionalSnowflake.optional(),
  rejectedRolePD7: optionalSnowflake.optional(),
  responsibleUsersPD7: z.array(snowflake).max(100).optional()
});

export const fivemPd7Router = Router();

async function scope(req: any, res: any, manage: boolean) {
  const botId = await resolveRequestBotId(req);
  if (!botId) throw Object.assign(new Error("Selecione um bot DEV."), { statusCode: 400 });
  const guildId = snowflake.parse(req.params.guildId);
  const ok = manage
    ? await canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, "fivem-factions")
    : await canReadDevBotModule(res.locals.dashboardAuth.user, botId, guildId, "fivem-factions");
  if (!ok) throw Object.assign(new Error("Sem permissão para o sistema de Facções."), { statusCode: 403 });
  return { botId, guildId };
}

fivemPd7Router.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const scoped = await scope(req, res, false);
    return res.json({ factions: await listPd7Settings(scoped.guildId, scoped.botId) });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.get("/:guildId/factions/:factionId", requireAuth, async (req, res, next) => {
  try {
    const scoped = await scope(req, res, false);
    return res.json(await getPd7Dashboard(scoped.guildId, scoped.botId, id.parse(req.params.factionId)));
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.patch("/:guildId/factions/:factionId", requireAuth, async (req, res, next) => {
  try {
    const scoped = await scope(req, res, true);
    return res.json({ settings: await savePd7Settings(scoped.guildId, scoped.botId, id.parse(req.params.factionId), settingsSchema.parse(req.body)) });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.post("/:guildId/factions/:factionId/publish", requireAuth, async (req, res, next) => {
  try {
    const scoped = await scope(req, res, true);
    return res.json({ settings: await requestPd7Publish(scoped.guildId, scoped.botId, id.parse(req.params.factionId)) });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.get("/bot/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    if (!botId) throw new Error("Bot inválido");
    return res.json({ configs: await listActivePd7Settings(botId) });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.post("/bot/requests", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    if (!botId) throw new Error("Bot inválido");
    const input = z.object({
      factionId: id,
      fields: z.array(z.object({ id, label: z.string().max(45), value: z.string().max(4000) })).max(5),
      guildId: snowflake,
      userId: snowflake,
      username: z.string().max(100)
    }).parse(req.body);
    return res.status(201).json({ request: await createPd7Request({ ...input, botId }) });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.get("/bot/requests/:requestId", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const request = botId && await getPd7Request(id.parse(req.params.requestId), botId);
    return request ? res.json({ request }) : res.status(404).json({ message: "Solicitação de Set não encontrada." });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.patch("/bot/requests/:requestId", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    if (!botId) throw new Error("Bot inválido");
    const patch = z.object({
      approvedAt: z.coerce.date().nullable().optional(),
      approvedBy: optionalSnowflake.optional(),
      channelId: optionalSnowflake.optional(),
      goalCategoryId: optionalSnowflake.optional(),
      goalChannelId: optionalSnowflake.optional(),
      handledBy: optionalSnowflake.optional(),
      panelMessageId: optionalSnowflake.optional(),
      pd7RegistrationId: z.string().max(120).nullable().optional(),
      pd7TemporaryChannelId: optionalSnowflake.optional(),
      rejectionReason: z.string().max(1000).nullable().optional(),
      resolvedAt: z.coerce.date().nullable().optional(),
      source: z.string().max(40).nullable().optional(),
      status: z.enum(["pending", "approved", "rejected", "closed"]).optional()
    }).parse(req.body);
    return res.json({ request: await updatePd7Request(id.parse(req.params.requestId), botId, patch) });
  } catch (error) {
    return next(error);
  }
});

fivemPd7Router.post("/bot/panel-state", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    if (!botId) throw new Error("Bot inválido");
    const input = z.object({ factionId: id, guildId: snowflake, panelMessageId: optionalSnowflake }).parse(req.body);
    return res.json({ settings: await updatePd7PanelState(input.guildId, botId, input.factionId, input.panelMessageId) });
  } catch (error) {
    return next(error);
  }
});
