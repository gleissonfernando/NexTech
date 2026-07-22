import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { devBotRealtimeRoom, emitRealtimeToRoom, emitRealtimeToRoomWithAck } from "../realtime/events";
import {
  canReadDevBotModule,
  canUseDevBotModule,
  getDevBotToken,
  getBotGuildModuleConfig,
  updateBotGuildModuleConfig
} from "../services/devBotService";
import { validateGuildAssignableRole } from "../services/discordOptionsService";
import { createLog } from "../services/logService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const botIdSchema = z.string().min(1).max(120);
const moduleIdSchema = z.enum([
  "anti-abuse",
  "anti-ban",
  "suspicious-servers",
  "global-blacklist",
  "advanced-permissions",
  "invite-cleanup",
  "server-backup",
  "vanity-url-protection",
  "hide-empty-voice",
  "anti-disconnect",
  "auto-unmute",
  "temporary-voice",
  "tag-verification",
  "bio-url-verification",
  "fivem-captcha",
  "first-lady",
  "music"
]);
const primitiveConfigValue = z.union([
  z.boolean(),
  z.string().max(500),
  z.number().finite().min(0).max(1_000_000),
  z.null()
]);
const configSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  z.union([
    primitiveConfigValue,
    z.array(primitiveConfigValue).max(250)
  ])
).default({});
const saveSchema = z.object({
  config: configSchema,
  guildName: z.string().min(1).max(100).optional()
});
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const autoUnmuteConfigSchema = z.object({
  enabled: z.boolean().default(false),
  voiceChannelId: snowflakeSchema.nullable().default(null),
  requiredRoleId: snowflakeSchema.nullable().default(null),
  delaySeconds: z.coerce.number().int().min(0).max(60).default(0),
  antiSpamSeconds: z.coerce.number().int().min(1).max(300).default(10)
});
const antiDisconnectConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedRoleIds: z.array(snowflakeSchema).max(100).default([]),
  protectedRoleIds: z.array(snowflakeSchema).max(100).default([]),
  logChannelId: snowflakeSchema.nullable().default(null),
  reconnectDelayMs: z.coerce.number().int().min(250).max(5000).default(800),
  cooldownSeconds: z.coerce.number().int().min(1).max(60).default(5)
});
const antiAbuseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  masterEnabled: z.boolean().default(true),
  antiDisconnectEnabled: z.boolean().default(true),
  antiMuteAbuseEnabled: z.boolean().default(true),
  antiDeafenAbuseEnabled: z.boolean().default(true),
  antiMoveAbuseEnabled: z.boolean().default(true),
  antiKickVoiceEnabled: z.boolean().default(true),
  autoReconnectEnabled: z.boolean().default(true),
  autoUnmuteEnabled: z.boolean().default(true),
  allowedRoleIds: z.array(snowflakeSchema).max(100).default([]),
  immuneRoleIds: z.array(snowflakeSchema).max(100).default([]),
  protectedRoleIds: z.array(snowflakeSchema).max(100).default([]),
  logChannelId: snowflakeSchema.nullable().default(null),
  revertDelayMs: z.coerce.number().int().min(100).max(5000).default(600),
  cooldownSeconds: z.coerce.number().int().min(1).max(60).default(5),
  strictDevOverride: z.boolean().default(true),
  punishAbuser: z.boolean().default(false)
});
const musicConfigSchema = z.object({
  enabled: z.boolean().default(false),
  commandChannelId: snowflakeSchema.nullable().default(null),
  allowedChannelIds: z.array(snowflakeSchema).max(100).default([]),
  blockedChannelIds: z.array(snowflakeSchema).max(100).default([]),
  djRoleId: snowflakeSchema.nullable().default(null),
  permissionMode: z.enum(["everyone", "roles", "administrators"]).default("everyone"),
  allowedRoleIds: z.array(snowflakeSchema).max(100).default([]),
  blockedUserIds: z.array(snowflakeSchema).max(250).default([]),
  defaultVolume: z.coerce.number().int().min(10).max(100).default(50),
  queueLimit: z.coerce.number().int().min(1).max(500).default(100),
  playlistLimit: z.coerce.number().int().min(1).max(100).default(50),
  artistLimit: z.coerce.number().int().min(1).max(50).default(25),
  cooldownSeconds: z.coerce.number().int().min(0).max(60).default(5),
  maxTrackMinutes: z.coerce.number().int().min(1).max(180).default(15),
  idleDisconnectSeconds: z.coerce.number().int().min(5).max(600).default(30),
  allowPlaylists: z.boolean().default(true),
  allowLinks: z.boolean().default(true),
  allowArtistSearch: z.boolean().default(true),
  logChannelId: snowflakeSchema.nullable().default(null)
});
const temporaryVoiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  panelChannelId: snowflakeSchema.nullable().default(null),
  panelMessageId: snowflakeSchema.nullable().default(null),
  categoryId: snowflakeSchema.nullable().default(null),
  defaultUserLimit: z.coerce.number().int().min(1).max(99).default(10),
  emptyDeleteMinutes: z.coerce.number().int().min(1).max(1440).default(1),
  logChannelId: snowflakeSchema.nullable().default(null),
  autoDeleteChannelIds: z.array(snowflakeSchema).max(100).default([])
});
const fivemCaptchaConfigSchema = z.object({
  enabled: z.boolean().default(false),
  panelChannelId: snowflakeSchema.nullable().default(null),
  panelMessageId: snowflakeSchema.nullable().default(null),
  roleId: snowflakeSchema.nullable().default(null),
  bypassRoleIds: z.array(snowflakeSchema).max(100).default([]),
  logChannelId: snowflakeSchema.nullable().default(null),
  challengeMode: z.enum(["button", "code", "math"]).default("math"),
  captchaLength: z.coerce.number().int().min(4).max(8).default(6),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
  expiresMinutes: z.coerce.number().int().min(1).max(60).default(5),
  cooldownSeconds: z.coerce.number().int().min(0).max(300).default(10),
  failureAction: z.enum(["log_only", "kick", "ban"]).default("log_only"),
  requireNickname: z.boolean().default(true),
  deletePromptAfterVerify: z.boolean().default(true)
});
const tagVerificationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  requiredTag: z.string().trim().max(100).default(""),
  roleId: snowflakeSchema.nullable().default(null),
  updateIntervalMinutes: z.coerce.number().int().min(1).max(1440).default(10),
  autoRemove: z.boolean().default(true),
  updatedAt: z.string().datetime()
}).superRefine((config, context) => {
  if (!config.enabled) return;

  if (!config.requiredTag) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Informe a tag exigida.", path: ["requiredTag"] });
  }

  if (!config.roleId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Selecione o cargo que será entregue.", path: ["roleId"] });
  }
});

type TagVerificationRunResult = {
  botId: string;
  guildId: string;
  checked: number;
  assigned: number;
  removed: number;
  ignored: number;
  unavailable: number;
  errors: number;
  lastCheckAt: string;
  nextCheckAt: string | null;
  lastError: string | null;
};

export const advancedModulesRouter = Router();

advancedModulesRouter.use(requireAuth);

advancedModulesRouter.get("/:botId/:guildId/:moduleId", async (req, res, next) => {
  try {
    const botId = botIdSchema.parse(req.params.botId);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const moduleId = moduleIdSchema.parse(req.params.moduleId);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    if (!(await canReadDevBotModule(user, botId, guildId, moduleId))) {
      return res.status(403).json({
        message: "Este módulo não foi liberado para este bot ou você não tem permissão para visualiza-lo."
      });
    }

    return res.json({
      module: await getBotGuildModuleConfig(botId, guildId, moduleId)
    });
  } catch (error) {
    return next(error);
  }
});

advancedModulesRouter.patch("/:botId/:guildId/:moduleId", async (req, res, next) => {
  try {
    const botId = botIdSchema.parse(req.params.botId);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const moduleId = moduleIdSchema.parse(req.params.moduleId);
    const input = saveSchema.parse(req.body ?? {});
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    if (!(await canUseDevBotModule(user, botId, guildId, moduleId))) {
      return res.status(403).json({
        message: "Este módulo não foi liberado para este bot ou você não tem permissão para configura-lo."
      });
    }

    if (moduleId === "anti-ban") {
      return res.status(409).json({
        message: "Use a configuração dedicada do Anti Ban para validar permissões, limites e canal de logs."
      });
    }

    const previous = await getBotGuildModuleConfig(botId, guildId, moduleId);
    const normalizedConfig = normalizeModuleConfig(moduleId, input.config);
    if (
      (moduleId === "temporary-voice" || moduleId === "fivem-captcha")
      && !Object.prototype.hasOwnProperty.call(input.config, "panelMessageId")
      && previous.config.panelMessageId
    ) {
      (normalizedConfig as Record<string, unknown>).panelMessageId = previous.config.panelMessageId;
    }

    if (moduleId === "tag-verification" && normalizedConfig.enabled === true) {
      await validateTagVerificationRole(botId, guildId, String((normalizedConfig as Record<string, unknown>).roleId));
    }

    const normalizedRecord = normalizedConfig as Record<string, unknown>;
    if (moduleId === "fivem-captcha" && typeof normalizedRecord.roleId === "string") {
      await validateTagVerificationRole(botId, guildId, normalizedRecord.roleId);
    }

    const savedModule = await updateBotGuildModuleConfig({
      botId,
      guildId,
      guildName: input.guildName ?? `Servidor ${guildId}`,
      moduleId,
      config: {
        ...normalizedConfig,
        ...(moduleId === "tag-verification" ? { botId, guildId } : {}),
        updatedBy: user.id
      }
    });

    await writeModuleConfigLogs({
      botId,
      config: savedModule.config,
      guildId,
      moduleId,
      previousConfig: previous.config,
      user
    });

    if (moduleId === "tag-verification") {
      emitRealtimeToRoom(devBotRealtimeRoom(botId), "tag-verification:config_updated", {
        botId,
        guildId
      });
    }

    return res.json({
      module: savedModule
    });
  } catch (error) {
    return next(error);
  }
});

advancedModulesRouter.post("/:botId/:guildId/tag-verification/run", async (req, res, next) => {
  try {
    const botId = botIdSchema.parse(req.params.botId);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    if (!(await canUseDevBotModule(user, botId, guildId, "tag-verification"))) {
      return res.status(403).json({ message: "Este módulo não foi liberado para este bot ou servidor." });
    }

    const module = await getBotGuildModuleConfig(botId, guildId, "tag-verification");

    if (module.config.enabled !== true) {
      return res.status(409).json({ message: "Ative e salve a Verificação de Tag antes de executar." });
    }

    const responses = await emitRealtimeToRoomWithAck<
      { botId: string; guildId: string },
      TagVerificationRunResult | { error: string }
    >(devBotRealtimeRoom(botId), "tag-verification:run", { botId, guildId }, 120_000);
    const result = responses.find((item): item is TagVerificationRunResult => "checked" in item);

    if (!result) {
      const error = responses.find((item): item is { error: string } => "error" in item)?.error;
      return res.status(503).json({ message: error || "O bot não respondeu a verificação manual." });
    }

    return res.json({ result });
  } catch (error) {
    return next(error);
  }
});

function normalizeModuleConfig(moduleId: z.infer<typeof moduleIdSchema>, config: Record<string, unknown>) {
  if (moduleId === "auto-unmute") {
    return autoUnmuteConfigSchema.parse({
      antiSpamSeconds: config.antiSpamSeconds,
      delaySeconds: config.delaySeconds,
      enabled: config.enabled,
      requiredRoleId: config.requiredRoleId || null,
      voiceChannelId: config.voiceChannelId || null
    });
  }

  if (moduleId === "anti-disconnect") {
    return antiDisconnectConfigSchema.parse({
      allowedRoleIds: Array.isArray(config.allowedRoleIds) ? config.allowedRoleIds : [],
      cooldownSeconds: config.cooldownSeconds,
      enabled: config.enabled,
      logChannelId: config.logChannelId || null,
      protectedRoleIds: Array.isArray(config.protectedRoleIds) ? config.protectedRoleIds : [],
      reconnectDelayMs: config.reconnectDelayMs
    });
  }

  if (moduleId === "anti-abuse") {
    return antiAbuseConfigSchema.parse({
      allowedRoleIds: Array.isArray(config.allowedRoleIds) ? config.allowedRoleIds : [],
      antiDeafenAbuseEnabled: config.antiDeafenAbuseEnabled,
      antiDisconnectEnabled: config.antiDisconnectEnabled,
      antiKickVoiceEnabled: config.antiKickVoiceEnabled,
      antiMoveAbuseEnabled: config.antiMoveAbuseEnabled,
      antiMuteAbuseEnabled: config.antiMuteAbuseEnabled,
      autoReconnectEnabled: config.autoReconnectEnabled,
      autoUnmuteEnabled: config.autoUnmuteEnabled,
      cooldownSeconds: config.cooldownSeconds,
      enabled: config.enabled,
      immuneRoleIds: Array.isArray(config.immuneRoleIds) ? config.immuneRoleIds : [],
      logChannelId: config.logChannelId || null,
      masterEnabled: config.masterEnabled,
      protectedRoleIds: Array.isArray(config.protectedRoleIds) ? config.protectedRoleIds : [],
      punishAbuser: config.punishAbuser,
      revertDelayMs: config.revertDelayMs,
      strictDevOverride: config.strictDevOverride
    });
  }

  if (moduleId === "music") {
    return musicConfigSchema.parse(config);
  }

  if (moduleId === "temporary-voice") {
    return temporaryVoiceConfigSchema.parse(config);
  }

  if (moduleId === "fivem-captcha") {
    return fivemCaptchaConfigSchema.parse({
      bypassRoleIds: Array.isArray(config.bypassRoleIds) ? config.bypassRoleIds : [],
      captchaLength: config.captchaLength,
      challengeMode: config.challengeMode,
      cooldownSeconds: config.cooldownSeconds,
      deletePromptAfterVerify: config.deletePromptAfterVerify,
      enabled: config.enabled,
      expiresMinutes: config.expiresMinutes,
      failureAction: config.failureAction,
      logChannelId: config.logChannelId || null,
      maxAttempts: config.maxAttempts,
      panelChannelId: config.panelChannelId || null,
      panelMessageId: config.panelMessageId || null,
      requireNickname: config.requireNickname,
      roleId: config.roleId || null
    });
  }

  if (moduleId === "tag-verification") {
    const result = tagVerificationConfigSchema.safeParse({
      autoRemove: config.autoRemove ?? config.removeOnMismatch,
      enabled: config.enabled,
      requiredTag: config.requiredTag,
      roleId: config.roleId,
      updateIntervalMinutes: config.updateIntervalMinutes ?? config.intervalMinutes,
      updatedAt: new Date().toISOString()
    });

    if (!result.success) {
      const error = new Error(result.error.issues[0]?.message ?? "Configuração de Verificação de Tag inválida.");
      Object.assign(error, { statusCode: 400 });
      throw error;
    }

    return result.data;
  }

  return config;
}

async function validateTagVerificationRole(botId: string, guildId: string, roleId: string) {
  const token = await getDevBotToken(botId);
  if (!token) {
    const error = new Error("O token deste bot não está disponível para validar o cargo.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  const validation = await validateGuildAssignableRole(guildId, roleId, token);

  if (validation.ok) {
    return;
  }

  const messages = {
    bot_missing_manage_roles: "Bot sem permissão para gerenciar cargos.",
    role_above_bot: "Cargo selecionado está acima do cargo do bot.",
    role_managed: "Cargo selecionado e gerenciado por uma integração.",
    role_not_found: "Cargo não encontrado."
  } as const;

  const error = new Error(validation.reason ? messages[validation.reason] : "Não foi possível validar o cargo selecionado.");
  Object.assign(error, { statusCode: 400 });
  throw error;
}

async function writeModuleConfigLogs(input: {
  botId: string;
  config: Record<string, unknown>;
  guildId: string;
  moduleId: string;
  previousConfig: Record<string, unknown>;
  user: AuthSessionUser;
}) {
  const label = input.moduleId === "auto-unmute" ? "Auto Desmutar" : input.moduleId === "anti-disconnect" ? "Anti Disconnect" : input.moduleId === "anti-abuse" ? "Anti Abuse" : input.moduleId === "tag-verification" ? "Verificação de Tag" : input.moduleId === "fivem-captcha" ? "CAPTCHA FiveM" : input.moduleId;
  const enabled = input.config.enabled === true;
  const wasEnabled = input.previousConfig.enabled === true;

  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.user.discordId ?? input.user.id,
    type: `${input.moduleId}.config_updated`,
    message: `${label}: configuração salva para este bot e servidor.`,
    metadata: {
      botId: input.botId,
      guildId: input.guildId,
      moduleId: input.moduleId,
      ...(input.moduleId === "tag-verification" ? {
        autoRemove: input.config.autoRemove,
        requiredTag: input.config.requiredTag,
        roleId: input.config.roleId,
        updateIntervalMinutes: input.config.updateIntervalMinutes
      } : {}),
      ...(input.moduleId === "fivem-captcha" ? {
        challengeMode: input.config.challengeMode,
        failureAction: input.config.failureAction,
        maxAttempts: input.config.maxAttempts,
        panelChannelId: input.config.panelChannelId,
        roleId: input.config.roleId
      } : {})
    }
  }).catch(() => undefined);

  if (enabled === wasEnabled) {
    return;
  }

  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.user.discordId ?? input.user.id,
    type: enabled ? `${input.moduleId}.enabled` : `${input.moduleId}.disabled`,
    message: `${label}: sistema ${enabled ? "ativado" : "pausado"} neste bot e servidor.`,
    metadata: {
      botId: input.botId,
      guildId: input.guildId,
      moduleId: input.moduleId
    }
  }).catch(() => undefined);
}
