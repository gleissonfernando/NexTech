import { Router, raw } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { isBotRequest, requireAuth, requireAuthOrBot, requireBot } from "../middleware/auth";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { isDashboardDevUserId } from "../config/devOwner";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { authorizeBotRuntimeModule, canAccessDevBotGuild, canManageDevBot, canUseDevBotModule, getDevBot, getDevBotToken } from "../services/devBotService";
import { createLog } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  clearSafeBotMessageState,
  getGuildSettings,
  getSafeBotMessageState,
  LOG_CATEGORIES,
  MAX_AUTOMATIC_ROLES,
  saveSafeBotMessageState,
  updateGuildSettings
} from "../services/settingsService";
import { publishRulesPanelToDiscord } from "../services/rulesPanelService";
import { publishReportSystemPanelToDiscord } from "../services/reportSystemPanelService";
import { getSelfBotProtectionSettings, saveSelfBotProtectionSettings } from "../services/selfBotProtectionService";
import { saveLeaveImage, saveWelcomeImage, sendLeavePanelToDiscord, sendWelcomePanelToDiscord } from "../services/welcomePanelService";
import {
  areGuildMembers,
  areGuildAssignableRoles,
  areGuildRoles,
  isGuildCategoryChannel,
  isGuildTextChannel
} from "../services/discordOptionsService";

const settingsSchema = z.object({
  welcomeEnabled: z.boolean().optional(),
  welcomeChannelId: z.string().nullable().optional(),
  welcomeDisplayChannelId: z.string().nullable().optional(),
  welcomeImageUrl: z.string().max(2048).nullable().optional(),
  welcomeTitle: z.string().max(120).nullable().optional(),
  welcomeMessage: z.string().max(1000).nullable().optional(),
  welcomeRulesTitle: z.string().max(120).nullable().optional(),
  welcomeRules: z.string().max(1500).nullable().optional(),
  welcomeChannelLabel: z.string().max(120).nullable().optional(),
  welcomeFooterText: z.string().max(180).nullable().optional(),
  welcomeColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  leaveEnabled: z.boolean().optional(),
  leaveChannelId: z.string().nullable().optional(),
  leaveDisplayChannelId: z.string().nullable().optional(),
  leaveImageUrl: z.string().max(2048).nullable().optional(),
  leaveTitle: z.string().max(120).nullable().optional(),
  leaveMessage: z.string().max(1000).nullable().optional(),
  leaveRulesTitle: z.string().max(120).nullable().optional(),
  leaveRules: z.string().max(1500).nullable().optional(),
  leaveChannelLabel: z.string().max(120).nullable().optional(),
  leaveFooterText: z.string().max(180).nullable().optional(),
  leaveColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  autoRoleEnabled: z.boolean().optional(),
  autoRoleIds: z.array(z.string()).max(MAX_AUTOMATIC_ROLES, "Selecione no maximo 2 cargos automaticos.").optional(),
  twitchRoleId: z.string().nullable().optional(),
  boosterRoleId: z.string().nullable().optional(),
  ticketEnabled: z.boolean().optional(),
  ticketCategoryId: z.string().nullable().optional(),
  ticketPanelTitle: z.string().max(120).nullable().optional(),
  ticketPanelDescription: z.string().max(1000).nullable().optional(),
  ticketPanelInfoText: z.string().max(1200).nullable().optional(),
  ticketPanelFooterText: z.string().max(180).nullable().optional(),
  ticketPanelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  ticketPanelPlaceholder: z.string().max(120).nullable().optional(),
  ticketPanelOptions: z.array(z.object({
    description: z.string().max(100).nullable().optional().default(null),
    emoji: z.string().max(80).nullable().optional().default(null),
    enabled: z.boolean().optional().default(true),
    label: z.string().min(1).max(80),
    value: z.string().min(1).max(80)
  })).max(25).optional(),
  reportSystem: z.object({
    adminRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    allowAnonymousReports: z.boolean().optional(),
    allowAnonymousStaffReplies: z.boolean().optional(),
    anonymousAvatarUrl: z.string().url().max(2048).nullable().optional(),
    anonymousEmbedColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    anonymousInvestigatorName: z.string().max(80).optional(),
    anonymousReporterName: z.string().max(80).optional(),
    auditChannelId: z.string().nullable().optional(),
    buttonText: z.string().max(80).optional(),
    buttons: z.record(z.boolean()).optional(),
    categories: z.array(z.object({
      channelOrCategoryId: z.string().nullable().optional(),
      color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      description: z.string().max(100).nullable().optional(),
      emoji: z.string().max(80).nullable().optional(),
      enabled: z.boolean().optional(),
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(80),
      order: z.coerce.number().int().min(1).max(1000).optional()
    })).max(25).optional(),
    categoryId: z.string().nullable().optional(),
    closeRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    comissarioCategoryId: z.string().nullable().optional(),
    comissarioLogChannelId: z.string().nullable().optional(),
    comissarioRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    competenceCommandRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    conselhoCategoryId: z.string().nullable().optional(),
    conselhoLogChannelId: z.string().nullable().optional(),
    conselhoRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    createRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    defaultDeadline: z.string().max(120).optional(),
    dmBannerUrl: z.string().url().max(2048).nullable().optional(),
    enabled: z.boolean().optional(),
    footerText: z.string().max(180).nullable().optional(),
    hcmdCategoryId: z.string().nullable().optional(),
    hcmdLogChannelId: z.string().nullable().optional(),
    hcmdRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    iabCategoryId: z.string().nullable().optional(),
    iabLogChannelId: z.string().nullable().optional(),
    iabRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    imageUrl: z.string().url().max(2048).nullable().optional(),
    infoMessage: z.string().max(1800).optional(),
    logChannelId: z.string().nullable().optional(),
    logs: z.record(z.boolean()).optional(),
    mentionRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    name: z.string().max(80).optional(),
    openMessage: z.string().max(1000).optional(),
    panelChannelId: z.string().nullable().optional(),
    panelColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    panelDescription: z.string().max(1000).optional(),
    panelEmoji: z.string().max(80).nullable().optional(),
    panelPlaceholder: z.string().max(120).optional(),
    panelTitle: z.string().max(120).optional(),
    subpoenaDmText: z.string().max(1000).optional(),
    subpoenaPanelBannerUrl: z.string().url().max(2048).nullable().optional(),
    permissionRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    reopenRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    replyRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    statusRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional(),
    statuses: z.array(z.object({
      color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(80),
      order: z.coerce.number().int().min(1).max(1000).optional()
    })).max(25).optional(),
    thumbnailUrl: z.string().url().max(2048).nullable().optional(),
    transcriptChannelId: z.string().nullable().optional(),
    viewRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(100).optional()
  }).optional(),
  logChannelId: z.string().nullable().optional(),
  discordLogsEnabled: z.boolean().optional(),
  siteLogsEnabled: z.boolean().optional(),
  discordLogCategories: z.array(z.enum(LOG_CATEGORIES)).optional(),
  siteLogCategories: z.array(z.enum(LOG_CATEGORIES)).optional(),
  moderationEnabled: z.boolean().optional(),
  accountAgeSecurityEnabled: z.boolean().optional(),
  accountAgeMinDays: z.coerce.number().int().min(0).max(3650).optional(),
  accountAgeLogChannelId: z.string().nullable().optional(),
  accountAgeAllowedUserIds: z.array(z.string().regex(/^\d{5,32}$/)).max(200).optional(),
  safeBotEnabled: z.boolean().optional(),
  safeBotChannelId: z.string().nullable().optional(),
  safeBotRoleId: z.string().nullable().optional(),
  safeBotLogChannelId: z.string().nullable().optional(),
  emojiCloneEnabled: z.boolean().optional(),
  emojiCloneAllowedRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(50).optional(),
  emojiCloneLogChannelId: z.string().nullable().optional(),
  emojiCloneDefaultPrefix: z.string().max(24).nullable().optional(),
  emojiCloneAllowAnimated: z.boolean().optional(),
  emojiCloneMaxPerRun: z.coerce.number().int().min(1).max(100).optional(),
  emojiCloneAllowedBotIds: z.array(z.string().regex(/^\d{5,32}$/)).max(25).optional(),
  rulesEnabled: z.boolean().optional(),
  rulesChannelId: z.string().nullable().optional(),
  rulesRoleId: z.string().nullable().optional(),
  rulesTitle: z.string().max(120).nullable().optional(),
  rulesMessage: z.string().max(1800).nullable().optional(),
  rulesButtonLabel: z.string().max(80).nullable().optional(),
  rulesColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  rulesPanelMessageId: z.string().nullable().optional(),
  verificationEnabled: z.boolean().optional(),
  verificationRoleId: z.string().nullable().optional(),
  verificationRoleIds: z.array(z.string()).optional(),
  dashboardRolePermissions: z.record(z.enum(["admin", "moderator", "premium", "basic"])).optional(),
  dashboardUserPermissions: z.record(z.enum(["admin", "moderator", "premium", "basic"])).optional()
});
const botSelfBotRoleSchema = z.object({
  roleId: z.string().regex(/^\d{5,32}$/),
  roleName: z.string().max(100).optional()
});
const botSafeBotSetupSchema = z.object({
  filterChannelId: z.string().regex(/^\d{5,32}$/),
  filterChannelName: z.string().max(100).optional(),
  logChannelId: z.string().regex(/^\d{5,32}$/),
  logChannelName: z.string().max(100).optional(),
  roleId: z.string().regex(/^\d{5,32}$/),
  roleName: z.string().max(100).optional()
});
const botSafeBotMessageStateSchema = z.object({
  channelId: z.string().regex(/^\d{5,32}$/),
  messageId: z.string().regex(/^\d{5,32}$/)
});

type SettingsInput = z.infer<typeof settingsSchema>;

const ownerDevOnlySettingKeys = new Set<keyof SettingsInput>([
  "autoRoleEnabled",
  "autoRoleIds",
  "twitchRoleId",
  "boosterRoleId",
  "safeBotEnabled",
  "safeBotChannelId",
  "safeBotRoleId",
  "safeBotLogChannelId",
  "emojiCloneAllowedBotIds",
  "verificationEnabled",
  "verificationRoleId",
  "verificationRoleIds",
  "dashboardRolePermissions",
  "dashboardUserPermissions"
]);

export const settingsRouter = Router();
const welcomeImageUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});

settingsRouter.get("/:guildId", requireAuthOrBot, async (req, res) => {
  const { guildId } = req.params;
  const botId = await resolveRequestBotId(req);

  if (!guildId) {
    return res.status(400).json({
      message: "guildId obrigatorio."
    });
  }

  if (!(await canReadSettings(req, res, guildId, botId))) {
    return res.status(403).json({
      message: "Servidor nao encontrado ou sem o bot."
    });
  }

  return res.json({
    settings: await getGuildSettings(guildId, botId)
  });
});

settingsRouter.patch("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const input = settingsSchema.parse(req.body);

    if (!guildId) {
      return res.status(400).json({ message: "guildId obrigatorio." });
    }

    await validateGuildResources(guildId, botId, input);
    const settings = await updateGuildSettings(guildId, input, botId);
    emitRealtime("settings:updated", settings);

    const settingsLog = await createLog({
      botId,
      guildId,
      userId: null,
      type: "discord.settings.updated",
      message: friendlySettingsMessage(input),
      metadata: { botId, guildId, changedKeys: Object.keys(input), moduleName: inferSettingsModuleName(input) }
    }).catch(() => null);

    if (settingsLog) {
      emitRealtime("logs:new", settingsLog);
    }

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.post("/bot/:guildId/self-bot-role", requireBot, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const input = botSelfBotRoleSchema.parse(req.body);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    const authorization = await authorizeBotRuntimeModule({
      botId,
      guildId,
      moduleId: "safe-bot"
    });

    if (!authorization.allowed) {
      return res.status(403).json({
        message: authorization.reason
      });
    }

    const botToken = await getDevBotToken(botId);

    if (!(await areGuildAssignableRoles(guildId, [input.roleId], botToken))) {
      return res.status(400).json({
        message: "O cargo Self Bot precisa ficar abaixo do cargo do bot e o bot precisa da permissao Gerenciar Cargos."
      });
    }

    const settings = await updateGuildSettings(guildId, {
      safeBotRoleId: input.roleId
    }, botId);
    const settingsLog = await createLog({
      botId,
      guildId,
      userId: null,
      type: "security.self_bot.role_synced",
      message: `Cargo Self Bot sincronizado${input.roleName ? `: ${input.roleName}` : "."}`,
      metadata: {
        botId,
        guildId,
        roleId: input.roleId,
        roleName: input.roleName ?? null
      }
    }).catch(() => null);

    emitRealtime("settings:updated", settings);
    if (settingsLog) {
      emitRealtime("logs:new", settingsLog);
    }

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.post("/bot/:guildId/safe-bot-setup", requireBot, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const input = botSafeBotSetupSchema.parse(req.body);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    const authorization = await authorizeBotRuntimeModule({
      botId,
      guildId,
      moduleId: "safe-bot"
    });

    if (!authorization.allowed) {
      return res.status(403).json({
        message: authorization.reason
      });
    }

    const botToken = await getDevBotToken(botId);
    const [roleOk, filterOk, logOk] = await Promise.all([
      areGuildAssignableRoles(guildId, [input.roleId], botToken),
      isGuildTextChannel(guildId, input.filterChannelId, botToken),
      isGuildTextChannel(guildId, input.logChannelId, botToken)
    ]);

    if (!roleOk) {
      return res.status(400).json({
        message: "O cargo Self Bot precisa ficar abaixo do cargo do bot e o bot precisa da permissao Gerenciar Cargos."
      });
    }

    if (!filterOk || !logOk) {
      return res.status(400).json({
        message: "Os canais do SafeBot precisam pertencer a este servidor."
      });
    }

    const currentSettings = await getGuildSettings(guildId, botId);
    const needsSettingsUpdate = currentSettings.safeBotEnabled !== true
      || currentSettings.safeBotChannelId !== input.filterChannelId
      || currentSettings.safeBotLogChannelId !== input.logChannelId
      || currentSettings.safeBotRoleId !== input.roleId;

    const settings = needsSettingsUpdate
      ? await updateGuildSettings(guildId, {
        safeBotEnabled: true,
        safeBotChannelId: input.filterChannelId,
        safeBotLogChannelId: input.logChannelId,
        safeBotRoleId: input.roleId
      }, botId)
      : currentSettings;

    const protectionSettings = botId ? await getSelfBotProtectionSettings(guildId, botId) : null;
    const needsProtectionUpdate = Boolean(
      botId
      && protectionSettings
      && (!protectionSettings.addRoleId || !protectionSettings.logChannelId)
    );
    const syncedProtectionSettings = needsProtectionUpdate && botId && protectionSettings
      ? await saveSelfBotProtectionSettings(
        guildId,
        botId,
        {
          addRoleId: protectionSettings.addRoleId ?? input.roleId,
          logChannelId: protectionSettings.logChannelId ?? input.logChannelId
        },
        null
      )
      : null;

    if (needsSettingsUpdate) {
      emitRealtime("settings:updated", settings);
    }
    if (syncedProtectionSettings) {
      emitRealtime("self-bot-protection:settings_updated", syncedProtectionSettings);
    }

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.get("/bot/:guildId/safe-bot-message", requireBot, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({ message: "guildId obrigatorio." });
    }

    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "safe-bot" });

    if (!authorization.allowed) {
      return res.status(403).json({ message: authorization.reason });
    }

    return res.json({
      state: await getSafeBotMessageState(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.put("/bot/:guildId/safe-bot-message", requireBot, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const input = botSafeBotMessageStateSchema.parse(req.body);

    if (!guildId) {
      return res.status(400).json({ message: "guildId obrigatorio." });
    }

    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "safe-bot" });

    if (!authorization.allowed) {
      return res.status(403).json({ message: authorization.reason });
    }

    return res.json({
      state: await saveSafeBotMessageState(guildId, input, botId)
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.delete("/bot/:guildId/safe-bot-message", requireBot, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({ message: "guildId obrigatorio." });
    }

    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "safe-bot" });

    if (!authorization.allowed) {
      return res.status(403).json({ message: authorization.reason });
    }

    await clearSafeBotMessageState(guildId, botId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.put("/:guildId/welcome-image", requireAuth, welcomeImageUpload, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!(await canManageModule(req, res, guildId, botId, "welcome"))) {
      return res.status(403).json({
        message: "O modulo de entrada nao foi liberado para este bot."
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        message: "Arquivo de imagem obrigatorio."
      });
    }

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const welcomeImageUrl = await saveWelcomeImage(guildId, req.body, mimeType);
    const settings = await updateGuildSettings(guildId, {
      welcomeImageUrl
    }, botId);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.put("/:guildId/leave-image", requireAuth, welcomeImageUpload, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!(await canManageModule(req, res, guildId, botId, "leave"))) {
      return res.status(403).json({
        message: "O modulo de saida nao foi liberado para este bot."
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        message: "Arquivo de imagem obrigatorio."
      });
    }

    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const leaveImageUrl = await saveLeaveImage(guildId, req.body, mimeType);
    const settings = await updateGuildSettings(guildId, {
      leaveImageUrl
    }, botId);

    emitRealtime("settings:updated", settings);

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

settingsRouter.post("/:guildId/welcome-test", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!(await canManageModule(req, res, guildId, botId, "welcome"))) {
      return res.status(403).json({
        message: "O modulo de entrada nao foi liberado para este bot."
      });
    }

    const settings = await getGuildSettings(guildId, botId);

    await sendWelcomePanelToDiscord(settings, `<@${user.discordId}>`, await getDevBotToken(botId));

    return res.json({
      ok: true
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.post("/:guildId/leave-test", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user;

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!(await canManageModule(req, res, guildId, botId, "leave"))) {
      return res.status(403).json({
        message: "O modulo de saida nao foi liberado para este bot."
      });
    }

    const settings = await getGuildSettings(guildId, botId);

    await sendLeavePanelToDiscord(settings, `<@${user.discordId}>`, await getDevBotToken(botId));

    return res.json({
      ok: true
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.post("/:guildId/rules-panel", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    if (!(await canManageModule(req, res, guildId, botId, "rules"))) {
      return res.status(403).json({
        message: "O modulo de regras nao foi liberado para este bot."
      });
    }

    const settings = await getGuildSettings(guildId, botId);
    const messageId = await publishRulesPanelToDiscord(settings, await getDevBotToken(botId));
    const updatedSettings = await getGuildSettings(guildId, botId);

    emitRealtime("settings:updated", updatedSettings);

    return res.json({
      messageId,
      settings: updatedSettings
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.post("/:guildId/report-system-panel", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const canManageReportSystem =
      await canManageModule(req, res, guildId, botId, "police-iab")
      || await canManageModule(req, res, guildId, botId, "tickets");

    if (!canManageReportSystem) {
      return res.status(403).json({
        message: "O modulo Denuncias Corregedoria nao foi liberado para este bot."
      });
    }

    const settings = await getGuildSettings(guildId, botId);
    const messageId = await publishReportSystemPanelToDiscord(settings, await getDevBotToken(botId));
    const updatedSettings = await getGuildSettings(guildId, botId);

    emitRealtime("settings:updated", updatedSettings);

    return res.json({
      messageId,
      settings: updatedSettings
    });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(400).json({
        message: error.message
      });
    }

    return next(error);
  }
});

settingsRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const { guildId } = req.params;
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatorio."
      });
    }

    if (!(await canManageSettings(req, res, guildId, botId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
      });
    }

    const input = settingsSchema.parse(req.body);

    const ownerDevOnlyPatch = touchesOwnerDevOnlySettings(input);
    const canManageOwnerDevPatch = ownerDevOnlyPatch
      ? await canManageOwnerDevOnlySettings(req, res, guildId, botId)
      : false;

    if (ownerDevOnlyPatch && !canManageOwnerDevPatch) {
      return res.status(403).json({
        message: "Apenas o dono do bot ou um DEV pode alterar cargos e permissoes administrativas."
      });
    }

    if (!(await canPatchSettings(req, res, guildId, botId, input, canManageOwnerDevPatch))) {
      return res.status(403).json({
        message: "Uma ou mais funcoes nao foram liberadas para este bot."
      });
    }

    await validateSafeBotActivation(guildId, botId, input);
    await validateGuildResources(guildId, botId, input);

    const settings = await updateGuildSettings(guildId, input, botId);
    emitRealtime("settings:updated", settings);
    if (botId && touchesSafeBotSettings(input)) {
      emitRealtimeToRoom(devBotRealtimeRoom(botId), "self-bot:ensure_setup", {
        botId,
        guildId
      });
    }

    const settingsLog = await createLog({
      botId,
      guildId,
      userId: res.locals.dashboardAuth.user.discordId,
      type: "dashboard.settings.updated",
      message: friendlySettingsMessage(input),
      metadata: {
        moduleName: inferSettingsModuleName(input),
        changedKeys: Object.keys(input),
        botId,
        guildId,
        userId: res.locals.dashboardAuth.user.discordId
      }
    }).catch(() => null);

    if (settingsLog) {
      emitRealtime("logs:new", settingsLog);
    }

    return res.json({
      settings
    });
  } catch (error) {
    return next(error);
  }
});

async function canReadSettings(req: Request, res: Response, guildId: string, botId: string | null) {
  if (isBotRequest(req)) {
    return true;
  }

  const user = res.locals.dashboardAuth.user;

  if (botId) {
    return canAccessDevBotGuild(user, botId, guildId);
  }

  return canReadDashboardGuild(user, guildId);
}

async function canManageSettings(req: Request, res: Response, guildId: string, botId: string | null) {
  if (isBotRequest(req)) {
    return true;
  }

  const user = res.locals.dashboardAuth.user;

  if (botId) {
    return canAccessDevBotGuild(user, botId, guildId);
  }

  return canManageDashboardGuild(user, guildId);
}

async function canManageOwnerDevOnlySettings(
  req: Request,
  res: Response,
  guildId: string,
  botId: string | null
) {
  if (isBotRequest(req)) {
    return true;
  }

  const user = res.locals.dashboardAuth.user;

  if (botId) {
    return canManageDevBot(user, botId);
  }

  return isDashboardDevUserId(user.discordId) || user.guilds.some((guild: { id: string; owner?: boolean }) => guild.id === guildId && guild.owner);
}

async function canManageModule(
  req: Request,
  res: Response,
  guildId: string,
  botId: string | null,
  moduleId: string
) {
  if (!botId) {
    return canManageSettings(req, res, guildId, botId);
  }

  return canUseDevBotModule(res.locals.dashboardAuth.user, botId, guildId, moduleId);
}

async function canPatchSettings(
  req: Request,
  res: Response,
  guildId: string,
  botId: string | null,
  input: SettingsInput,
  ownerDevOverride = false
) {
  if (!botId) {
    return true;
  }

  const moduleBySetting: Partial<Record<keyof z.infer<typeof settingsSchema>, string[]>> = {
    welcomeEnabled: ["welcome"],
    welcomeChannelId: ["welcome"],
    welcomeDisplayChannelId: ["welcome"],
    welcomeImageUrl: ["welcome"],
    welcomeTitle: ["welcome"],
    welcomeMessage: ["welcome"],
    welcomeRulesTitle: ["welcome"],
    welcomeRules: ["welcome"],
    welcomeChannelLabel: ["welcome"],
    welcomeFooterText: ["welcome"],
    welcomeColor: ["welcome"],
    leaveEnabled: ["leave"],
    leaveChannelId: ["leave"],
    leaveDisplayChannelId: ["leave"],
    leaveImageUrl: ["leave"],
    leaveTitle: ["leave"],
    leaveMessage: ["leave"],
    leaveRulesTitle: ["leave"],
    leaveRules: ["leave"],
    leaveChannelLabel: ["leave"],
    leaveFooterText: ["leave"],
    leaveColor: ["leave"],
    autoRoleEnabled: ["welcome", "roles"],
    autoRoleIds: ["welcome", "roles"],
    twitchRoleId: ["roles"],
    boosterRoleId: ["roles"],
    ticketEnabled: ["tickets"],
    ticketCategoryId: ["tickets"],
    ticketPanelTitle: ["tickets"],
    ticketPanelDescription: ["tickets"],
    ticketPanelInfoText: ["tickets"],
    ticketPanelFooterText: ["tickets"],
    ticketPanelColor: ["tickets"],
    ticketPanelPlaceholder: ["tickets"],
    ticketPanelOptions: ["tickets"],
    reportSystem: ["police-iab", "tickets"],
    logChannelId: ["logs"],
    discordLogsEnabled: ["logs"],
    siteLogsEnabled: ["logs"],
    discordLogCategories: ["logs"],
    siteLogCategories: ["logs"],
    moderationEnabled: ["moderation"],
    accountAgeSecurityEnabled: ["account-age-security"],
    accountAgeMinDays: ["account-age-security"],
    accountAgeLogChannelId: ["account-age-security"],
    accountAgeAllowedUserIds: ["account-age-security"],
    safeBotEnabled: ["safe-bot"],
    safeBotChannelId: ["safe-bot"],
    safeBotRoleId: ["safe-bot"],
    safeBotLogChannelId: ["safe-bot"],
    emojiCloneEnabled: ["emoji-cloner"],
    emojiCloneAllowedRoleIds: ["emoji-cloner"],
    emojiCloneLogChannelId: ["emoji-cloner"],
    emojiCloneDefaultPrefix: ["emoji-cloner"],
    emojiCloneAllowAnimated: ["emoji-cloner"],
    emojiCloneMaxPerRun: ["emoji-cloner"],
    emojiCloneAllowedBotIds: ["emoji-cloner"],
    rulesEnabled: ["rules"],
    rulesChannelId: ["rules"],
    rulesRoleId: ["rules"],
    rulesTitle: ["rules"],
    rulesMessage: ["rules"],
    rulesButtonLabel: ["rules"],
    rulesColor: ["rules"],
    rulesPanelMessageId: ["rules"],
    verificationEnabled: ["verification"],
    verificationRoleId: ["verification"],
    verificationRoleIds: ["verification"],
    dashboardRolePermissions: ["verification"],
    dashboardUserPermissions: ["verification"]
  };
  const ownerDevEnabledModules = ownerDevOverride
    ? new Set((await getDevBot(botId))?.enabledModules ?? [])
    : null;
  const access = await Promise.all(
    (Object.keys(input) as Array<keyof typeof input>).map(async (key) => {
      const moduleIds = moduleBySetting[key] ?? [];

      if (ownerDevOverride && ownerDevOnlySettingKeys.has(key)) {
        return moduleIds.some((moduleId) => ownerDevEnabledModules?.has(moduleId));
      }

      const moduleAccess = await Promise.all(
        moduleIds.map((moduleId) => canManageModule(req, res, guildId, botId, moduleId))
      );

      return moduleAccess.some(Boolean);
    })
  );

  return access.every(Boolean);
}

function touchesOwnerDevOnlySettings(input: SettingsInput) {
  return (Object.keys(input) as Array<keyof SettingsInput>).some((key) => ownerDevOnlySettingKeys.has(key));
}

function touchesSafeBotSettings(input: SettingsInput) {
  return Object.keys(input).some((key) => key.startsWith("safeBot"));
}

async function validateSafeBotActivation(guildId: string, botId: string | null, input: SettingsInput) {
  if (input.safeBotEnabled !== true) {
    return;
  }

  const current = await getGuildSettings(guildId, botId);
  const safeBotLogChannelId = "safeBotLogChannelId" in input
    ? input.safeBotLogChannelId
    : current.safeBotLogChannelId;

  if ("safeBotLogChannelId" in input && input.safeBotLogChannelId === "" && !safeBotLogChannelId) {
    throw createSettingsError("Selecione um canal de logs valido para o SafeBot ou deixe o bot criar o padrao automaticamente.");
  }
}

async function validateGuildResources(
  guildId: string,
  botId: string | null,
  input: SettingsInput
) {
  const botToken = await getDevBotToken(botId);
  const textChannelIds = [
    input.welcomeChannelId,
    input.welcomeDisplayChannelId,
    input.leaveChannelId,
    input.leaveDisplayChannelId,
    input.logChannelId,
    input.accountAgeLogChannelId,
    input.safeBotChannelId,
    input.safeBotLogChannelId,
    input.emojiCloneLogChannelId,
    input.rulesChannelId,
    input.reportSystem?.panelChannelId,
    input.reportSystem?.logChannelId,
    input.reportSystem?.transcriptChannelId,
    input.reportSystem?.auditChannelId,
    input.reportSystem?.iabLogChannelId,
    input.reportSystem?.conselhoLogChannelId,
    input.reportSystem?.hcmdLogChannelId,
    input.reportSystem?.comissarioLogChannelId
  ].filter((channelId): channelId is string => Boolean(channelId));

  const textChannelChecks = await Promise.all(
    [...new Set(textChannelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!textChannelChecks.every(Boolean)) {
    throw createSettingsError("Um dos canais selecionados nao pertence a este servidor.");
  }

  if (
    input.discordLogsEnabled !== undefined
    || input.siteLogsEnabled !== undefined
    || input.logChannelId !== undefined
    || input.discordLogCategories !== undefined
    || input.siteLogCategories !== undefined
  ) {
    const current = await getGuildSettings(guildId, botId);
    const logChannelId = "logChannelId" in input ? input.logChannelId : current.logChannelId;
    const discordLogsEnabled = input.discordLogsEnabled ?? current.discordLogsEnabled;
    const siteLogsEnabled = input.siteLogsEnabled ?? current.siteLogsEnabled;
    const discordLogCategories = input.discordLogCategories ?? current.discordLogCategories;
    const siteLogCategories = input.siteLogCategories ?? current.siteLogCategories;

    if (discordLogsEnabled && !logChannelId) {
      throw createSettingsError("Selecione o canal que recebera os logs do Discord.");
    }

    if (discordLogsEnabled && !discordLogCategories.length) {
      throw createSettingsError("Selecione pelo menos uma categoria para os logs do Discord.");
    }

    if (siteLogsEnabled && !siteLogCategories.length) {
      throw createSettingsError("Selecione pelo menos uma categoria para os logs do site.");
    }
  }

  if (
    input.ticketCategoryId
    && !(await isGuildCategoryChannel(guildId, input.ticketCategoryId, botToken))
  ) {
    throw createSettingsError("A categoria de tickets nao pertence a este servidor.");
  }

  if (
    input.reportSystem?.categoryId
    && !(await isGuildCategoryChannel(guildId, input.reportSystem.categoryId, botToken))
  ) {
    throw createSettingsError("A categoria de denuncias nao pertence a este servidor.");
  }

  const reportCategoryIds = [
    input.reportSystem?.iabCategoryId,
    input.reportSystem?.conselhoCategoryId,
    input.reportSystem?.hcmdCategoryId,
    input.reportSystem?.comissarioCategoryId
  ].filter((categoryId): categoryId is string => Boolean(categoryId));

  if (reportCategoryIds.length) {
    const categoryChecks = await Promise.all([...new Set(reportCategoryIds)].map((categoryId) => isGuildCategoryChannel(guildId, categoryId, botToken)));
    if (!categoryChecks.every(Boolean)) {
      throw createSettingsError("Uma das categorias de competencia nao pertence a este servidor.");
    }
  }

  const roleIds = [
    ...(input.autoRoleIds ?? []),
    ...(input.verificationRoleIds ?? []),
    ...Object.keys(input.dashboardRolePermissions ?? {}),
    input.twitchRoleId,
    input.boosterRoleId,
    input.safeBotRoleId,
    input.verificationRoleId,
    ...(input.emojiCloneAllowedRoleIds ?? []),
    input.rulesRoleId,
    ...(input.reportSystem?.viewRoleIds ?? []),
    ...(input.reportSystem?.replyRoleIds ?? []),
    ...(input.reportSystem?.closeRoleIds ?? []),
    ...(input.reportSystem?.reopenRoleIds ?? []),
    ...(input.reportSystem?.adminRoleIds ?? []),
    ...(input.reportSystem?.createRoleIds ?? []),
    ...(input.reportSystem?.permissionRoleIds ?? []),
    ...(input.reportSystem?.mentionRoleIds ?? []),
    ...(input.reportSystem?.statusRoleIds ?? []),
    ...(input.reportSystem?.iabRoleIds ?? []),
    ...(input.reportSystem?.conselhoRoleIds ?? []),
    ...(input.reportSystem?.hcmdRoleIds ?? []),
    ...(input.reportSystem?.comissarioRoleIds ?? []),
    ...(input.reportSystem?.competenceCommandRoleIds ?? [])
  ].filter((roleId): roleId is string => Boolean(roleId));

  if (roleIds.length && !(await areGuildRoles(guildId, [...new Set(roleIds)], botToken))) {
    throw createSettingsError("Um dos cargos selecionados nao pertence a este servidor.");
  }

  if (
    input.autoRoleIds?.length
    && !(await areGuildAssignableRoles(guildId, [...new Set(input.autoRoleIds)], botToken))
  ) {
    throw createSettingsError("O cargo automatico precisa ficar abaixo do cargo do bot e o bot precisa da permissao Gerenciar Cargos.");
  }

  if (
    input.safeBotRoleId
    && !(await areGuildAssignableRoles(guildId, [input.safeBotRoleId], botToken))
  ) {
    throw createSettingsError("O cargo Self Bot precisa ficar abaixo do cargo do bot e o bot precisa da permissao Gerenciar Cargos.");
  }

  const dashboardUserIds = Object.keys(input.dashboardUserPermissions ?? {});

  if (
    dashboardUserIds.length
    && !(await areGuildMembers(guildId, dashboardUserIds, botToken))
  ) {
    throw createSettingsError("Uma das pessoas selecionadas nao esta mais neste servidor Discord.");
  }
}

function createSettingsError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 400
  });
}

function inferSettingsModuleName(input: z.infer<typeof settingsSchema>) {
  const keys = new Set(Object.keys(input));

  if ([...keys].some((key) => key.startsWith("verification") || key === "dashboardRolePermissions" || key === "dashboardUserPermissions")) return "permissions";
  if ([...keys].some((key) => key.startsWith("accountAge"))) return "account_age_security";
  if ([...keys].some((key) => key.startsWith("safeBot"))) return "self_bot";
  if ([...keys].some((key) => key.startsWith("emojiClone"))) return "emoji_cloner";
  if ([...keys].some((key) => key.startsWith("rules"))) return "rules";
  if (keys.has("reportSystem")) return "reports";
  if ([...keys].some((key) => key.startsWith("welcome") || key.startsWith("autoRole"))) return "welcome";
  if ([...keys].some((key) => key.startsWith("leave"))) return "leave";
  if ([...keys].some((key) => key.startsWith("ticket"))) return "tickets";
  if ([...keys].some((key) => key.startsWith("log") || key.startsWith("discordLog") || key.startsWith("siteLog"))) return "logs";
  if ([...keys].some((key) => key.startsWith("moderation"))) return "moderation";
  if ([...keys].some((key) => key.startsWith("twitch") || key.startsWith("booster"))) return "roles";

  return "settings";
}

function friendlySettingsMessage(input: z.infer<typeof settingsSchema>) {
  if (input.verificationRoleIds || input.verificationRoleId !== undefined || input.dashboardRolePermissions || input.dashboardUserPermissions) {
    return "Permissao de acesso ao painel atualizada.";
  }

  if (input.verificationEnabled !== undefined) {
    return input.verificationEnabled ? "Sistema de permissoes ativado." : "Sistema de permissoes desativado.";
  }

  if (
    input.logChannelId !== undefined
    || input.discordLogsEnabled !== undefined
    || input.siteLogsEnabled !== undefined
    || input.discordLogCategories !== undefined
    || input.siteLogCategories !== undefined
  ) {
    return "Sistema de logs atualizado.";
  }

  if (input.moderationEnabled !== undefined) {
    return input.moderationEnabled ? "Sistema de moderacao ativado." : "Sistema de moderacao desativado.";
  }

  if (Object.keys(input).some((key) => key.startsWith("accountAge"))) {
    return "Seguranca de idade da conta atualizada.";
  }

  if (Object.keys(input).some((key) => key.startsWith("safeBot"))) {
    return "Self Bot atualizado.";
  }

  if (Object.keys(input).some((key) => key.startsWith("emojiClone"))) {
    return "Clonagem de emojis atualizada.";
  }

  if (Object.keys(input).some((key) => key.startsWith("rules"))) {
    return "Sistema de regras atualizado.";
  }

  if (input.reportSystem !== undefined) {
    return "Sistema de denuncias atualizado.";
  }

  if (input.ticketEnabled !== undefined) {
    return input.ticketEnabled ? "Sistema de tickets ativado." : "Sistema de tickets desativado.";
  }

  if (input.welcomeEnabled !== undefined) {
    return input.welcomeEnabled ? "Boas-vindas ativadas." : "Boas-vindas desativadas.";
  }

  if (Object.keys(input).some((key) => key.startsWith("welcome"))) {
    return "Boas-vindas atualizadas.";
  }

  if (input.leaveEnabled !== undefined) {
    return input.leaveEnabled ? "Mensagem de saida ativada." : "Mensagem de saida desativada.";
  }

  if (Object.keys(input).some((key) => key.startsWith("leave"))) {
    return "Mensagem de saida atualizada.";
  }

  if (input.autoRoleIds !== undefined) {
    return "Cargos automaticos atualizados.";
  }

  if (input.autoRoleEnabled !== undefined) {
    return input.autoRoleEnabled ? "Sistema de cargos automaticos ativado." : "Sistema de cargos automaticos desativado.";
  }

  return "Configuracao do servidor atualizada.";
}
