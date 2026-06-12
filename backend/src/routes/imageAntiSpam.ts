import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import {
  areGuildRoles,
  isGuildTextChannel
} from "../services/discordOptionsService";
import {
  canReadDevBotModule,
  canUseDevBotModule,
  getBotApiPermissions,
  getDevBotToken
} from "../services/devBotService";
import {
  completeImageAntiSpamIncident,
  getImageAntiSpamDashboard,
  getImageAntiSpamSettings,
  recordImageAntiSpamIncident,
  saveImageAntiSpamSettings
} from "../services/imageAntiSpamService";
import { createLog } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "image-anti-spam";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  logChannelId: optionalSnowflakeSchema,
  immuneRoleIds: z.array(snowflakeSchema).max(100).optional(),
  ignoredChannelIds: z.array(snowflakeSchema).max(100).optional(),
  maxImages: z.coerce.number().int().min(1).max(20).optional(),
  windowSeconds: z.coerce.number().int().min(1).max(3_600).optional(),
  warningsEnabled: z.boolean().optional(),
  progressiveTimeoutEnabled: z.boolean().optional(),
  autoKickEnabled: z.boolean().optional(),
  maxWarnings: z.coerce.number().int().min(1).max(20).optional(),
  ignoreAdministrators: z.boolean().optional(),
  warningResetDays: z.coerce.number().int().min(1).max(3_650).optional()
});
const incidentSchema = z.object({
  guildId: guildIdSchema,
  incidentKey: z.string().min(1).max(200),
  userId: snowflakeSchema,
  username: z.string().max(100).nullable().optional(),
  channelId: snowflakeSchema,
  removedImages: z.number().int().min(0).max(100)
});
const completionSchema = z.object({
  actionSucceeded: z.boolean(),
  actionError: z.string().max(500).nullable().optional()
});

export const imageAntiSpamRouter = Router();

imageAntiSpamRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId);

    return res.json({
      settings: await getImageAntiSpamSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.post("/bot/incidents", requireBot, async (req, res, next) => {
  try {
    const input = incidentSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId);

    return res.status(201).json(await recordImageAntiSpamIncident({
      ...input,
      botId
    }));
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.patch("/bot/incidents/:incidentId", requireBot, async (req, res, next) => {
  try {
    const incidentId = z.string().min(1).parse(req.params.incidentId);
    const input = completionSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId);
    const incident = await completeImageAntiSpamIncident(incidentId, botId, input);
    const log = await createLog({
      botId,
      guildId: incident.guildId,
      userId: incident.userId,
      type: incident.action === "kick"
        ? "image_anti_spam.member_kicked"
        : "image_anti_spam.incident",
      message: incident.action === "kick"
        ? `Usuario ${incident.username ?? incident.userId} expulso por spam recorrente de imagens.`
        : `${incident.removedImages} imagem(ns) removida(s) de ${incident.username ?? incident.userId}.`,
      metadata: {
        action: incident.action,
        actionError: incident.actionError,
        actionSucceeded: incident.actionSucceeded,
        channelId: incident.channelId,
        reason: incident.reason,
        removedImages: incident.removedImages,
        timeoutMs: incident.timeoutMs,
        warningCount: incident.warningCount
      }
    });

    emitRealtime("logs:new", log);

    return res.json({
      incident
    });
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanRead(user, guildId, botId);

    return res.json(await getImageAntiSpamDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

imageAntiSpamRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = settingsSchema.parse(req.body);

    await assertCanManage(user, guildId, botId);
    await validateResources(guildId, botId, input);

    const settings = await saveImageAntiSpamSettings(
      guildId,
      botId,
      {
        ...input,
        logChannelId: input.logChannelId || null
      },
      user.discordId
    );
    const log = await createLog({
      botId,
      guildId,
      userId: user.discordId,
      type: "image_anti_spam.settings_updated",
      message: settings.enabled
        ? "Anti-Spam de Imagens atualizado e ativado."
        : "Anti-Spam de Imagens atualizado e desativado.",
      metadata: {
        changedKeys: Object.keys(input)
      }
    });

    emitRealtime("image-anti-spam:settings_updated", settings);
    emitRealtime("logs:new", log);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

async function readRequiredBotId(req: Parameters<typeof resolveRequestBotId>[0]) {
  const botId = await resolveRequestBotId(req);

  if (!botId) {
    throw createRouteError("Escolha um bot cadastrado para usar o Anti-Spam de Imagens.", 400);
  }

  return botId;
}

async function assertCanRead(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotModuleLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar o Anti-Spam de Imagens deste bot.", 403);
}

async function assertCanManage(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotModuleLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar o Anti-Spam de Imagens deste bot.", 403);
}

async function assertBotModuleLicense(botId: string) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(MODULE_ID)) {
    throw createRouteError("O Anti-Spam de Imagens nao foi liberado para este bot.", 403);
  }
}

async function validateResources(
  guildId: string,
  botId: string,
  input: z.infer<typeof settingsSchema>
) {
  const botToken = await getDevBotToken(botId);
  const channelIds = [
    input.logChannelId,
    ...(input.ignoredChannelIds ?? [])
  ].filter((channelId): channelId is string => Boolean(channelId));
  const channelChecks = await Promise.all(
    [...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados nao pertence a este servidor.", 400);
  }

  const roleIds = [...new Set(input.immuneRoleIds ?? [])];

  if (roleIds.length && !(await areGuildRoles(guildId, roleIds, botToken))) {
    throw createRouteError("Um dos cargos imunes nao pertence a este servidor.", 400);
  }
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
