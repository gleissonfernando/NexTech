import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot, requireBot } from "../middleware/auth";
import { canReadDashboardGuild, canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createManualRegistrationSubmission,
  createManualRegistrationDashboardSubmission,
  deleteManualRegistrationSubmission,
  getLatestManualRegistrationSubmission,
  getManualRegistrationSettings,
  listManualRegistrationLogs,
  listManualRegistrationSubmissions,
  requestManualRegistrationPanelPublish,
  saveManualRegistrationSettings,
  updateManualRegistrationSubmissionMessage,
  updateManualRegistrationSubmissionChannel,
  updateManualRegistrationSubmissionRole,
  updateManualRegistrationSubmissionStatus
} from "../services/manualRegistrationService";

const MODULE_ID = "manual-registration";
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();

const fieldSchema = z.object({
  enabled: z.boolean().optional(),
  id: z.string().max(80),
  label: z.string().min(1).max(80),
  maxLength: z.coerce.number().int().min(1).max(1500).nullable().optional().default(null),
  minLength: z.coerce.number().int().min(0).max(1500).nullable().optional().default(null),
  name: z.string().max(80),
  placeholder: z.string().max(100).nullable().optional().default(null),
  required: z.boolean(),
  style: z.enum(["short", "paragraph"])
});

const settingsSchema = z.object({
  approvalChannelId: optionalSnowflakeSchema,
  allowOnlyOneRequest: z.boolean().optional(),
  allowResubmit: z.boolean().optional(),
  approvalMessage: z.string().max(500).optional(),
  approverRoleIds: z.array(snowflakeSchema).max(20).optional(),
  approvedRoleId: optionalSnowflakeSchema,
  manualRegistrationRoleIds: z.array(snowflakeSchema).max(20).optional(),
  requestCategoryId: optionalSnowflakeSchema,
  automaticApproval: z.boolean().optional(),
  autoRoleIds: z.array(snowflakeSchema).max(20).optional(),
  bannerPosition: z.enum(["top", "bottom", "none"]).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  description: z.string().max(1200).nullable().optional(),
  cooldownMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  dmNotifications: z.boolean().optional(),
  enabled: z.boolean().optional(),
  emoji: z.string().max(80).nullable().optional(),
  fields: z.array(fieldSchema).max(100).optional(),
  footerText: z.string().max(180).nullable().optional(),
  logChannelId: optionalSnowflakeSchema,
  name: z.string().max(80).optional(),
  panelCategoryId: optionalSnowflakeSchema,
  panelChannelId: optionalSnowflakeSchema,
  panelMessageId: optionalSnowflakeSchema,
  rejectionMessage: z.string().max(500).optional(),
  removeRoleIds: z.array(snowflakeSchema).max(20).optional(),
  setRoles: z.array(z.object({
    description: z.string().max(200).nullable().optional(),
    emoji: z.string().max(80).nullable().optional(),
    enabled: z.boolean(),
    id: z.string().max(80),
    name: z.string().min(1).max(80),
    order: z.coerce.number().int().min(0).max(1000),
    requestable: z.boolean(),
    roleId: z.union([snowflakeSchema, z.literal("")])
  })).max(25).optional(),
  staffRoleIds: z.array(snowflakeSchema).max(20).optional(),
  successMessage: z.string().max(500).optional(),
  thumbnailUrl: z.string().max(2048).nullable().optional(),
  title: z.string().max(120).optional(),
  tutorial: z.string().max(1500).optional()
});

const submissionSchema = z.object({
  fields: z.array(z.object({
    id: z.string().max(80),
    label: z.string().max(100),
    value: z.string().max(1500)
  })).max(100),
  guildId: snowflakeSchema,
  messageId: optionalSnowflakeSchema,
  requestedRoleId: optionalSnowflakeSchema,
  userAvatar: z.string().max(2048).nullable().optional(),
  userId: snowflakeSchema,
  username: z.string().max(120)
  ,registrationType: z.enum(["request", "manual"]).optional()
});

const messageSchema = z.object({
  messageId: optionalSnowflakeSchema,
  channelId: optionalSnowflakeSchema
});

const statusSchema = z.object({
  actorId: snowflakeSchema,
  actorRoleIds: z.array(snowflakeSchema).max(100).default([]),
  actorIsAdministrator: z.boolean().default(false),
  guildId: snowflakeSchema,
  rejectionReason: z.string().max(800).nullable().optional(),
  status: z.enum(["approved", "rejected"])
});
const roleUpdateSchema = z.object({ actorId: snowflakeSchema, guildId: snowflakeSchema, requestedRoleId: snowflakeSchema });
const dashboardRegistrationSchema = z.object({
  characterName: z.string().trim().min(2).max(80),
  gameId: z.string().trim().min(1).max(32),
  goalCategoryId: snowflakeSchema,
  requestedRoleId: snowflakeSchema,
  userAvatar: z.string().max(2048).nullable().optional(),
  userId: snowflakeSchema,
  username: z.string().trim().min(1).max(120)
});

export const manualRegistrationRouter = Router();

manualRegistrationRouter.use(requireAuthOrBot);

manualRegistrationRouter.get("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    if (isBotRequest(req)) await assertRuntimeModule(botId, guildId);

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, guildId, botId))) {
      return res.status(403).json({ message: "Servidor nao encontrado ou modulo nao liberado." });
    }

    return res.json({
      settings: await getManualRegistrationSettings(guildId, botId),
      logs: isBotRequest(req) ? [] : await listManualRegistrationLogs(guildId, botId),
      submissions: isBotRequest(req) ? [] : await listManualRegistrationSubmissions(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.put("/:guildId/settings", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = settingsSchema.parse(req.body);

    if (isBotRequest(req) || !(await canManageScopedGuild(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissao para alterar cadastro manual." });
    }

    return res.json({
      settings: await saveManualRegistrationSettings(guildId, botId, normalizeSettingsInput(input), res.locals.dashboardAuth.user.discordId)
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.post("/:guildId/panel", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManageScopedGuild(req, guildId, botId))) return res.status(403).json({ message: "Sem permissao para publicar o Pedido de Set." });
    return res.json({ settings: await requestManualRegistrationPanelPublish(guildId, botId, res.locals.dashboardAuth.user.discordId) });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.delete("/:guildId/submissions/:id", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const id = z.string().min(1).parse(req.params.id);
    const botId = await resolveRequestBotId(req);
    if (isBotRequest(req) || !(await canManageScopedGuild(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissao para excluir este cadastro." });
    }
    const reason = z.string().trim().min(3).max(800).parse(req.body?.reason); await deleteManualRegistrationSubmission(guildId, botId, id, res.locals.dashboardAuth.user.discordId, reason);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.post("/:guildId/submissions/manual", async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const input = dashboardRegistrationSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    if (!botId || isBotRequest(req) || !(await canManageScopedGuild(req, guildId, botId))) {
      return res.status(403).json({ message: "Sem permissao para cadastrar este membro." });
    }
    return res.status(201).json({
      submission: await createManualRegistrationDashboardSubmission({ ...input, actorId: res.locals.dashboardAuth.user.discordId, botId, guildId })
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.post("/bot/submissions", requireBot, async (req, res, next) => {
  try {
    const input = submissionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    await assertRuntimeModule(botId, input.guildId);
    const settings = await getManualRegistrationSettings(input.guildId, botId);

    if (!settings.enabled) {
      return res.status(403).json({ message: "Cadastro manual desativado." });
    }

    return res.status(201).json({
      submission: await createManualRegistrationSubmission({ ...input, botId })
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.get("/bot/:guildId/users/:userId/submission", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const userId = snowflakeSchema.parse(req.params.userId);
    const botId = await resolveRequestBotId(req);
    await assertRuntimeModule(botId, guildId);
    return res.json({ submission: await getLatestManualRegistrationSubmission(guildId, userId, botId) });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.patch("/bot/submissions/:id/message", requireBot, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const input = messageSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    if (input.channelId !== undefined) return res.json({ submission: await updateManualRegistrationSubmissionChannel(id, botId, input.channelId ?? null, input.messageId ?? null) });
    await updateManualRegistrationSubmissionMessage(id, botId, input.messageId ?? null); return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.patch("/bot/submissions/:id/status", requireBot, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const input = statusSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    await assertRuntimeModule(botId, input.guildId);
    return res.json({
      submission: await updateManualRegistrationSubmissionStatus({ ...input, id, botId })
    });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.patch("/bot/submissions/:id/role", requireBot, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const input = roleUpdateSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    await assertRuntimeModule(botId, input.guildId);
    return res.json({ submission: await updateManualRegistrationSubmissionRole({ ...input, botId, id }) });
  } catch (error) {
    return next(error);
  }
});

manualRegistrationRouter.put("/bot/:guildId/settings", requireBot, async (req, res, next) => {
  try {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const input = settingsSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    await assertRuntimeModule(botId, guildId);
    return res.json({ settings: await saveManualRegistrationSettings(guildId, botId, normalizeSettingsInput(input), null) });
  } catch (error) {
    return next(error);
  }
});

async function canReadScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, MODULE_ID);
  }

  return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManageScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, MODULE_ID);
  }

  return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function assertRuntimeModule(botId: string | null, guildId: string) {
  const access = await authorizeBotRuntimeModule({ botId, guildId, moduleId: MODULE_ID });
  if (!access.allowed) throw Object.assign(new Error(access.reason), { statusCode: 403 });
}

function normalizeSettingsInput(input: z.infer<typeof settingsSchema>) {
  return {
    ...input,
    fields: input.fields?.map((field) => ({ ...field, enabled: field.enabled !== false })),
    setRoles: input.setRoles?.map((item) => ({ ...item, description: item.description ?? null, emoji: item.emoji ?? null }))
  };
}
