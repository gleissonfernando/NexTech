import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import {
  areGuildAssignableRoles,
  isGuildTextChannel
} from "../services/discordOptionsService";
import {
  authorizeBotRuntimeModule,
  canReadDevBotModule,
  canUseDevBotModule,
  getBotApiPermissions,
  getDevBotToken
} from "../services/devBotService";
import { createLog } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  SELF_BOT_PROTECTION_MODULES,
  SELF_BOT_PUNISHMENT_ACTIONS,
  getSelfBotRoleAssignments,
  getSelfBotProtectionDashboard,
  getSelfBotProtectionSettings,
  recordSelfBotProtectionIncident,
  resolveSelfBotPunishment,
  saveSelfBotProtectionSettings
} from "../services/selfBotProtectionService";
import type {
  SelfBotProtectionModuleId,
  SelfBotPunishmentAction
} from "../services/selfBotProtectionService";
import { updateGuildSettings } from "../services/settingsService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "safe-bot";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const moduleIdSchema = z.enum(SELF_BOT_PROTECTION_MODULES.map((module) => module.id) as [SelfBotProtectionModuleId, ...SelfBotProtectionModuleId[]]);
const punishmentActionSchema = z.enum(SELF_BOT_PUNISHMENT_ACTIONS as [SelfBotPunishmentAction, ...SelfBotPunishmentAction[]]);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const punishmentDurationSchema = z.object({
  dias: z.coerce.number().int().min(0).max(28).optional(),
  horas: z.coerce.number().int().min(0).max(23).optional(),
  minutos: z.coerce.number().int().min(0).max(59).optional(),
  segundos: z.coerce.number().int().min(0).max(59).optional()
});
const punishmentStepSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  acao: punishmentActionSchema,
  ativado: z.boolean().optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  proximaAcao: punishmentActionSchema.nullable().optional(),
  apagarMensagem: z.boolean().optional(),
  enviarAviso: z.boolean().optional(),
  registrarLog: z.boolean().optional(),
  tempoTimeout: punishmentDurationSchema.optional(),
  cargoAdicionarId: optionalSnowflakeSchema,
  cargoRemoverId: optionalSnowflakeSchema,
  banApagarMensagensSegundos: z.coerce.number().int().min(0).max(604_800).optional()
});
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  moduleToggles: z.record(moduleIdSchema, z.boolean()).optional(),
  ignoredChannelIds: z.array(snowflakeSchema).max(250).optional(),
  protectedChannelIds: z.array(snowflakeSchema).max(250).optional(),
  mediaChannelIds: z.array(snowflakeSchema).max(250).optional(),
  linkChannelIds: z.array(snowflakeSchema).max(250).optional(),
  logChannelId: optionalSnowflakeSchema,
  punishmentLogChannelId: optionalSnowflakeSchema,
  logWebhookUrl: z.string().max(500).nullable().optional(),
  embedColor: hexColorSchema.optional(),
  punishmentSequence: z.array(punishmentActionSchema).max(8).optional(),
  punishmentSteps: z.array(punishmentStepSchema).max(12).optional(),
  addRoleId: optionalSnowflakeSchema,
  removeRoleId: optionalSnowflakeSchema,
  timeoutSeconds: z.coerce.number().int().min(5).max(2_419_200).optional(),
  floodLimit: z.coerce.number().int().min(2).max(50).optional(),
  floodWindowSeconds: z.coerce.number().int().min(1).max(3_600).optional(),
  imageLimit: z.coerce.number().int().min(1).max(50).optional(),
  imageWindowSeconds: z.coerce.number().int().min(1).max(3_600).optional(),
  mentionLimit: z.coerce.number().int().min(1).max(100).optional(),
  emojiLimit: z.coerce.number().int().min(1).max(200).optional(),
  capsMinLength: z.coerce.number().int().min(4).max(500).optional(),
  capsPercentage: z.coerce.number().int().min(40).max(100).optional(),
  repeatedTextLimit: z.coerce.number().int().min(2).max(25).optional(),
  repeatedTextWindowSeconds: z.coerce.number().int().min(1).max(3_600).optional(),
  multiChannelLimit: z.coerce.number().int().min(2).max(100).optional(),
  multiChannelWindowSeconds: z.coerce.number().int().min(1).max(3_600).optional(),
  raidJoinLimit: z.coerce.number().int().min(2).max(500).optional(),
  raidWindowSeconds: z.coerce.number().int().min(5).max(3_600).optional(),
  newAccountMaxAgeHours: z.coerce.number().int().min(1).max(87_600).optional(),
  suspiciousDomains: z.array(z.string().min(1).max(120)).max(250).optional(),
  blockedTerms: z.array(z.string().min(1).max(120)).max(250).optional()
});
const punishmentResolveSchema = z.object({
  guildId: guildIdSchema,
  moduleId: moduleIdSchema,
  userId: snowflakeSchema
});
const incidentSchema = z.object({
  guildId: guildIdSchema,
  userId: snowflakeSchema,
  username: z.string().max(120).nullable().optional(),
  channelId: optionalSnowflakeSchema,
  messageId: optionalSnowflakeSchema,
  messageContent: z.string().max(1900).nullable().optional(),
  moduleId: moduleIdSchema,
  infractionType: z.string().min(1).max(120),
  punishmentActions: z.array(punishmentActionSchema).max(8),
  punishmentSucceeded: z.boolean(),
  punishmentError: z.string().max(500).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const selfBotProtectionRouter = Router();

selfBotProtectionRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId, guildId);

    return res.json({
      settings: await getSelfBotProtectionSettings(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

selfBotProtectionRouter.get("/bot/:guildId/role-assignments", requireBot, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId, guildId);

    return res.json({
      assignments: await getSelfBotRoleAssignments(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

selfBotProtectionRouter.post("/bot/incidents", requireBot, async (req, res, next) => {
  try {
    const input = incidentSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId, input.guildId, input.moduleId);
    const incident = await recordSelfBotProtectionIncident({
      ...input,
      botId,
      channelId: input.channelId || null,
      messageId: input.messageId || null
    });
    const log = await createLog({
      botId,
      guildId: input.guildId,
      userId: input.userId,
      type: `self_bot_protection.${input.moduleId}`,
      message: `${input.infractionType} bloqueado para ${input.username ?? input.userId}.`,
      metadata: {
        channelId: input.channelId || null,
        incidentId: incident.id,
        moduleId: input.moduleId,
        punishmentActions: input.punishmentActions,
        punishmentError: input.punishmentError ?? null,
        punishmentSucceeded: input.punishmentSucceeded
      }
    }).catch(() => null);

    emitRealtime("self-bot-protection:incident", incident);
    if (log) {
      emitRealtime("logs:new", log);
    }

    return res.status(201).json({
      incident
    });
  } catch (error) {
    return next(error);
  }
});

selfBotProtectionRouter.post("/bot/punishments/next", requireBot, async (req, res, next) => {
  try {
    const input = punishmentResolveSchema.parse(req.body);
    const botId = await readRequiredBotId(req);

    await assertBotModuleLicense(botId, input.guildId, input.moduleId);

    return res.status(201).json({
      punishment: await resolveSelfBotPunishment({
        ...input,
        botId
      })
    });
  } catch (error) {
    return next(error);
  }
});

selfBotProtectionRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanRead(user, guildId, botId);

    return res.json(await getSelfBotProtectionDashboard(guildId, botId));
  } catch (error) {
    return next(error);
  }
});

selfBotProtectionRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await readRequiredBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = settingsSchema.parse(req.body);

    await assertCanManage(user, guildId, botId);
    await validateActivation(guildId, botId, input);
    await validateResources(guildId, botId, input);

    const settings = await saveSelfBotProtectionSettings(
      guildId,
      botId,
      {
        ...input,
        addRoleId: input.addRoleId || null,
        logChannelId: input.logChannelId || null,
        punishmentLogChannelId: input.punishmentLogChannelId || null,
        removeRoleId: input.removeRoleId || null
      },
      user.discordId
    );
    const guildSettingsPatch: Parameters<typeof updateGuildSettings>[1] = {
      safeBotEnabled: settings.enabled,
      safeBotLogChannelId: settings.logChannelId
    };

    if (settings.addRoleId) {
      guildSettingsPatch.safeBotRoleId = settings.addRoleId;
    }

    const guildSettings = await updateGuildSettings(guildId, guildSettingsPatch, botId);
    const log = await createLog({
      botId,
      guildId,
      userId: user.discordId,
      type: "self_bot_protection.settings_updated",
      message: settings.enabled
        ? "SelfBot Protection atualizado e ativado."
        : "SelfBot Protection atualizado e desativado.",
      metadata: {
        changedKeys: Object.keys(input),
        enabledModules: Object.entries(settings.moduleToggles)
          .filter(([, enabled]) => enabled)
          .map(([moduleId]) => moduleId)
      }
    });

    emitRealtime("self-bot-protection:settings_updated", settings);
    emitRealtime("settings:updated", guildSettings);
    emitRealtime("logs:new", log);
    emitRealtimeToRoom(devBotRealtimeRoom(botId), "self-bot:ensure_setup", {
      botId,
      guildId
    });

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
    throw createRouteError("Escolha um bot cadastrado para usar o SelfBot Protection.", 400);
  }

  return botId;
}

async function assertCanRead(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotModuleLicense(botId);

  if (await canReadDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar o SelfBot Protection deste bot.", 403);
}

async function assertCanManage(user: AuthSessionUser, guildId: string, botId: string) {
  await assertBotModuleLicense(botId);

  if (await canUseDevBotModule(user, botId, guildId, MODULE_ID)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar o SelfBot Protection deste bot.", 403);
}

async function assertBotModuleLicense(botId: string, guildId?: string, moduleId = MODULE_ID) {
  const permissions = await getBotApiPermissions(botId);

  if (!permissions) {
    throw createRouteError("Bot nao encontrado.", 404);
  }

  if (!permissions.enabledModules.includes(MODULE_ID)) {
    throw createRouteError("O SelfBot Protection nao foi liberado para este bot.", 403);
  }

  if (guildId) {
    const authorization = await authorizeBotRuntimeModule({
      botId,
      guildId,
      moduleId
    });

    if (!authorization.allowed) {
      throw createRouteError(authorization.reason, 403);
    }
  }
}

async function validateActivation(
  guildId: string,
  botId: string,
  input: z.infer<typeof settingsSchema>
) {
  const current = await getSelfBotProtectionSettings(guildId, botId);
  const enabled = "enabled" in input ? input.enabled : current.enabled;

  if (!enabled) {
    return;
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
    input.punishmentLogChannelId,
    ...(input.ignoredChannelIds ?? []),
    ...(input.protectedChannelIds ?? []),
    ...(input.mediaChannelIds ?? []),
    ...(input.linkChannelIds ?? [])
  ].filter((channelId): channelId is string => Boolean(channelId));
  const channelChecks = await Promise.all(
    [...new Set(channelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!channelChecks.every(Boolean)) {
    throw createRouteError("Um dos canais selecionados nao pertence a este servidor.", 400);
  }

  const roleIds = [input.addRoleId, input.removeRoleId].filter((roleId): roleId is string => Boolean(roleId));
  for (const step of input.punishmentSteps ?? []) {
    if (step.cargoAdicionarId) {
      roleIds.push(step.cargoAdicionarId);
    }
    if (step.cargoRemoverId) {
      roleIds.push(step.cargoRemoverId);
    }
  }

  if (roleIds.length && !(await areGuildAssignableRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createRouteError("Um dos cargos de punicao precisa ficar abaixo do cargo do bot.", 400);
  }
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
