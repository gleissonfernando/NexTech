import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  canReadDevBotModule,
  canUseDevBotModule,
  getBotGuildModuleConfig,
  updateBotGuildModuleConfig
} from "../services/devBotService";
import { createLog } from "../services/logService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const botIdSchema = z.string().min(1).max(120);
const moduleIdSchema = z.enum([
  "anti-ban",
  "suspicious-servers",
  "global-blacklist",
  "advanced-permissions",
  "invite-cleanup",
  "server-backup",
  "vanity-url-protection",
  "hide-empty-voice",
  "auto-unmute",
  "temporary-voice",
  "tag-verification",
  "bio-url-verification",
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
        message: "Este modulo nao foi liberado para este bot ou voce nao tem permissao para visualiza-lo."
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
        message: "Este modulo nao foi liberado para este bot ou voce nao tem permissao para configura-lo."
      });
    }

    const previous = await getBotGuildModuleConfig(botId, guildId, moduleId);
    const normalizedConfig = normalizeModuleConfig(moduleId, input.config);
    const savedModule = await updateBotGuildModuleConfig({
      botId,
      guildId,
      guildName: input.guildName ?? `Servidor ${guildId}`,
      moduleId,
      config: {
        ...normalizedConfig,
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

    return res.json({
      module: savedModule
    });
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

  if (moduleId === "music") {
    return musicConfigSchema.parse(config);
  }

  return config;
}

async function writeModuleConfigLogs(input: {
  botId: string;
  config: Record<string, unknown>;
  guildId: string;
  moduleId: string;
  previousConfig: Record<string, unknown>;
  user: AuthSessionUser;
}) {
  const label = input.moduleId === "auto-unmute" ? "Auto Desmutar" : input.moduleId;
  const enabled = input.config.enabled === true;
  const wasEnabled = input.previousConfig.enabled === true;

  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.user.discordId ?? input.user.id,
    type: `${input.moduleId}.config_updated`,
    message: `${label}: configuracao salva para este bot e servidor.`,
    metadata: {
      botId: input.botId,
      guildId: input.guildId,
      moduleId: input.moduleId
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
