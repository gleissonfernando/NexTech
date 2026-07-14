import { Router, type Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createRhAbsence,
  createRhAdornment,
  decideRhAbsence,
  finishRhAbsence,
  getRhAbsence,
  getRhAdminDashboard,
  getRhAdminSettings,
  isRhApprover,
  listDueRhAbsences,
  logRhAdminAction,
  markRhAbsenceRoleAdded,
  requestRhAdminPanelPublish,
  RH_ADMIN_MODULE_ID,
  saveRhAdminSettings,
  updateRhAbsenceMessage,
  updateRhAdornmentMessage
} from "../services/rhAdminService";

export const rhAdminRouter = Router();

const snowflake = z.string().regex(/^\d{5,32}$/);
const optionalSnowflake = snowflake.nullable().optional().or(z.literal(""));
const settingsSchema = z.object({
  absenceLogChannelId: optionalSnowflake,
  absencePanelChannelId: optionalSnowflake,
  absenceReviewChannelId: optionalSnowflake,
  absenceRoleId: optionalSnowflake,
  adornmentBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  adornmentDescription: z.string().max(1200).optional(),
  adornmentLogChannelId: optionalSnowflake,
  adornmentPanelChannelId: optionalSnowflake,
  adornmentReviewChannelId: optionalSnowflake,
  allowNonDirectImageLinks: z.boolean().optional(),
  approvalDmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  approvalDmText: z.string().max(1200).optional(),
  approverRoleIds: z.array(snowflake).optional(),
  approverUserIds: z.array(snowflake).optional(),
  buttonEmojis: z.object({
    absence: z.string().max(32),
    adornment: z.string().max(32),
    approve: z.string().max(32),
    back: z.string().max(32),
    logs: z.string().max(32),
    publish: z.string().max(32),
    reject: z.string().max(32),
    save: z.string().max(32)
  }).optional(),
  checkIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  color: z.string().max(24).optional(),
  configRoleIds: z.array(snowflake).optional(),
  configUserIds: z.array(snowflake).optional(),
  dmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
  finishedDmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  finishedDmText: z.string().max(1200).optional(),
  generalLogChannelId: optionalSnowflake,
  mainPanelMessageId: optionalSnowflake,
  mentionAdornmentUser: z.boolean().optional(),
  panelBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  panelChannelId: optionalSnowflake,
  panelDescription: z.string().max(1800).optional(),
  rejectionDmBannerUrl: z.string().max(2048).nullable().optional().or(z.literal("")),
  rejectionDmText: z.string().max(1200).optional(),
  sendAbsenceDm: z.boolean().optional(),
  systemName: z.string().min(1).max(160).optional(),
  viewerRoleIds: z.array(snowflake).optional(),
  viewerUserIds: z.array(snowflake).optional()
});
const absenceSchema = z.object({
  reason: z.string().min(1).max(900),
  returnAt: z.coerce.date(),
  returnDate: z.string().min(1).max(20),
  serverName: z.string().min(1).max(120),
  startAt: z.coerce.date(),
  startDate: z.string().min(1).max(20),
  userId: snowflake
});
const adornmentSchema = z.object({
  imageUrl: z.string().url().max(2048),
  number: z.string().min(1).max(80),
  observation: z.string().max(900).nullable().optional().or(z.literal("")),
  serverName: z.string().min(1).max(120),
  userId: snowflake
});
const messageSchema = z.object({ channelId: optionalSnowflake, messageId: optionalSnowflake, reviewChannelId: optionalSnowflake, reviewMessageId: optionalSnowflake });
const decisionSchema = z.object({ actorId: snowflake, isAdministrator: z.boolean().optional(), rejectionReason: z.string().max(900).nullable().optional(), roleIds: z.array(snowflake).default([]), status: z.enum(["approved", "rejected"]) });
const roleStateSchema = z.object({ dmDelivered: z.boolean().nullable().optional(), roleAdded: z.boolean().optional(), roleRemoved: z.boolean().optional() });
const permissionSchema = z.object({ isAdministrator: z.boolean().optional(), roleIds: z.array(snowflake).default([]), userId: snowflake });
const logSchema = z.object({
  action: z.string().min(1).max(100),
  actorId: snowflake.nullable().optional(),
  channelId: optionalSnowflake,
  description: z.string().min(1).max(900),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(["success", "warning", "error", "denied", "info"]).default("info"),
  userId: snowflake.nullable().optional()
});

rhAdminRouter.use(requireAuthOrBot);

rhAdminRouter.get("/:guildId", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canRead(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para ver o RH Administrativo." });
    return res.json(await getRhAdminDashboard(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.patch("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para configurar o RH Administrativo." });
    const settings = await saveRhAdminSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManage(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para publicar painel RH." });
    const settings = await requestRhAdminPanelPublish(botId, guildId, res.locals.dashboardAuth.user.discordId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.get("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.json({ settings: await getRhAdminSettings(botId, guildId) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const settings = await saveRhAdminSettings(botId, guildId, sanitizeSettings(settingsSchema.parse(req.body ?? {})), req.get("x-actor-id") ?? null);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/permissions/approver", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = permissionSchema.parse(req.body ?? {});
    const settings = await getRhAdminSettings(botId, guildId);
    return res.json({ allowed: isRhApprover(settings, input.userId, input.roleIds, input.isAdministrator) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    return res.status(201).json({ absence: await createRhAbsence(botId, guildId, absenceSchema.parse(req.body ?? {})) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.get("/bot/:guildId/absences/:absenceId", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const absence = await getRhAbsence(botId, guildId, routeParam(req, "absenceId"));
    if (!absence) return res.status(404).json({ message: "Solicitação de ausência não encontrada." });
    return res.json({ absence });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.patch("/bot/:guildId/absences/:absenceId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = messageSchema.parse(req.body ?? {});
    return res.json({ absence: await updateRhAbsenceMessage(botId, guildId, routeParam(req, "absenceId"), { reviewChannelId: input.reviewChannelId || input.channelId || null, reviewMessageId: input.reviewMessageId || input.messageId || null }) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences/:absenceId/decision", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = decisionSchema.parse(req.body ?? {});
    const settings = await getRhAdminSettings(botId, guildId);
    if (!isRhApprover(settings, input.actorId, input.roleIds, input.isAdministrator)) return res.status(403).json({ message: "Você não tem permissão para analisar solicitações de ausência." });
    const result = await decideRhAbsence(botId, guildId, routeParam(req, "absenceId"), input);
    if (!result) return res.status(404).json({ message: "Solicitação de ausência não encontrada." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences/:absenceId/role-added", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = roleStateSchema.parse(req.body ?? {});
    return res.json({ absence: await markRhAbsenceRoleAdded(botId, guildId, routeParam(req, "absenceId"), input.roleAdded ?? true) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/absences/:absenceId/finish", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = roleStateSchema.parse(req.body ?? {});
    const result = await finishRhAbsence(botId, guildId, routeParam(req, "absenceId"), input.roleRemoved ?? true, input.dmDelivered ?? null);
    if (!result) return res.status(404).json({ message: "Solicitação de ausência não encontrada." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.get("/bot/absences/due", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    if (!botId) return res.status(403).json({ message: "Bot nao identificado." });
    return res.json({ absences: await listDueRhAbsences(botId) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/adornments", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = adornmentSchema.parse(req.body ?? {});
    return res.status(201).json({ adornment: await createRhAdornment(botId, guildId, { ...input, observation: input.observation || null }) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.patch("/bot/:guildId/adornments/:adornmentId/message", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = messageSchema.parse(req.body ?? {});
    return res.json({ adornment: await updateRhAdornmentMessage(botId, guildId, routeParam(req, "adornmentId"), { channelId: input.channelId || null, messageId: input.messageId || null }) });
  } catch (error) {
    return next(error);
  }
});

rhAdminRouter.post("/bot/:guildId/logs", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflake.parse(req.params.guildId);
    const botId = await assertRuntime(await resolveRequestBotId(req), guildId);
    const input = logSchema.parse(req.body ?? {});
    return res.status(201).json({ log: await logRhAdminAction(botId, guildId, input.action, input.userId ?? null, input.actorId ?? null, input.description, input.status, input.metadata ?? {}, input.channelId || null) });
  } catch (error) {
    return next(error);
  }
});

async function canRead(req: Request, guildId: string, botId: string) {
  return (await canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, RH_ADMIN_MODULE_ID))
    || canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManage(req: Request, guildId: string, botId: string) {
  return (await canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, RH_ADMIN_MODULE_ID))
    || canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function assertRuntime(botId: string | null, guildId: string) {
  const validGuildId = snowflake.parse(guildId);
  if (!botId) throw Object.assign(new Error("Bot nao identificado."), { statusCode: 403 });
  const authorization = await authorizeBotRuntimeModule({ botId, guildId: validGuildId, moduleId: RH_ADMIN_MODULE_ID });
  if (!authorization.allowed) throw Object.assign(new Error("O módulo RH Administrativo não está liberado para este servidor. Entre em contato com a administração do bot."), { statusCode: 403 });
  return botId;
}

function sanitizeSettings(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    adornmentBannerUrl: normalizeOptionalUrl(input.adornmentBannerUrl),
    approvalDmBannerUrl: normalizeOptionalUrl(input.approvalDmBannerUrl),
    dmBannerUrl: normalizeOptionalUrl(input.dmBannerUrl),
    finishedDmBannerUrl: normalizeOptionalUrl(input.finishedDmBannerUrl),
    panelBannerUrl: normalizeOptionalUrl(input.panelBannerUrl),
    rejectionDmBannerUrl: normalizeOptionalUrl(input.rejectionDmBannerUrl)
  };
}

function routeParam(req: Request, name: string) {
  return z.string().min(1).parse(req.params[name]);
}

function normalizeOptionalUrl(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : value;
  return normalized || null;
}
