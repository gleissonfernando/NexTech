import { Router, raw } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { isBotRequest, requireAuth, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canAccessDevBotGuild, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { createLog } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { getGuildSettings, MAX_AUTOMATIC_ROLES, updateGuildSettings } from "../services/settingsService";
import { saveLeaveImage, saveWelcomeImage, sendLeavePanelToDiscord, sendWelcomePanelToDiscord } from "../services/welcomePanelService";
import {
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
  autoRoleEnabled: z.boolean().optional(),
  autoRoleIds: z.array(z.string()).max(MAX_AUTOMATIC_ROLES, "Selecione no maximo 2 cargos automaticos.").optional(),
  twitchRoleId: z.string().nullable().optional(),
  boosterRoleId: z.string().nullable().optional(),
  ticketEnabled: z.boolean().optional(),
  ticketCategoryId: z.string().nullable().optional(),
  logChannelId: z.string().nullable().optional(),
  moderationEnabled: z.boolean().optional(),
  verificationEnabled: z.boolean().optional(),
  verificationRoleId: z.string().nullable().optional(),
  verificationRoleIds: z.array(z.string()).optional(),
  dashboardRolePermissions: z.record(z.enum(["admin", "moderator", "premium", "basic"])).optional(),
  dashboardUserPermissions: z.record(z.enum(["admin", "moderator", "premium", "basic"])).optional()
});

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

    if (!(await canPatchSettings(req, res, guildId, botId, input))) {
      return res.status(403).json({
        message: "Uma ou mais funcoes nao foram liberadas para este bot."
      });
    }

    await validateGuildResources(guildId, botId, input);

    const settings = await updateGuildSettings(guildId, input, botId);
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
  input: z.infer<typeof settingsSchema>
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
    autoRoleEnabled: ["welcome", "roles"],
    autoRoleIds: ["welcome", "roles"],
    twitchRoleId: ["roles"],
    boosterRoleId: ["roles"],
    ticketEnabled: ["tickets"],
    ticketCategoryId: ["tickets"],
    logChannelId: ["logs"],
    moderationEnabled: ["moderation"],
    verificationEnabled: ["verification"],
    verificationRoleId: ["verification"],
    verificationRoleIds: ["verification"],
    dashboardRolePermissions: ["verification"],
    dashboardUserPermissions: ["verification"]
  };
  const access = await Promise.all(
    (Object.keys(input) as Array<keyof typeof input>).map(async (key) => {
      const moduleIds = moduleBySetting[key] ?? [];
      const moduleAccess = await Promise.all(
        moduleIds.map((moduleId) => canManageModule(req, res, guildId, botId, moduleId))
      );

      return moduleAccess.some(Boolean);
    })
  );

  return access.every(Boolean);
}

async function validateGuildResources(
  guildId: string,
  botId: string | null,
  input: z.infer<typeof settingsSchema>
) {
  const botToken = await getDevBotToken(botId);
  const textChannelIds = [
    input.welcomeChannelId,
    input.welcomeDisplayChannelId,
    input.leaveChannelId,
    input.leaveDisplayChannelId,
    input.logChannelId
  ].filter((channelId): channelId is string => Boolean(channelId));

  const textChannelChecks = await Promise.all(
    [...new Set(textChannelIds)].map((channelId) => isGuildTextChannel(guildId, channelId, botToken))
  );

  if (!textChannelChecks.every(Boolean)) {
    throw createSettingsError("Um dos canais selecionados nao pertence a este servidor.");
  }

  if (
    input.ticketCategoryId
    && !(await isGuildCategoryChannel(guildId, input.ticketCategoryId, botToken))
  ) {
    throw createSettingsError("A categoria de tickets nao pertence a este servidor.");
  }

  const roleIds = [
    ...(input.autoRoleIds ?? []),
    ...(input.verificationRoleIds ?? []),
    ...Object.keys(input.dashboardRolePermissions ?? {}),
    input.twitchRoleId,
    input.boosterRoleId,
    input.verificationRoleId
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
}

function createSettingsError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 400
  });
}

function inferSettingsModuleName(input: z.infer<typeof settingsSchema>) {
  const keys = new Set(Object.keys(input));

  if ([...keys].some((key) => key.startsWith("verification") || key === "dashboardRolePermissions" || key === "dashboardUserPermissions")) return "permissions";
  if ([...keys].some((key) => key.startsWith("welcome") || key.startsWith("autoRole"))) return "welcome";
  if ([...keys].some((key) => key.startsWith("leave"))) return "leave";
  if ([...keys].some((key) => key.startsWith("ticket"))) return "tickets";
  if ([...keys].some((key) => key.startsWith("log"))) return "logs";
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

  if (input.logChannelId !== undefined) {
    return "Canal de logs atualizado.";
  }

  if (input.moderationEnabled !== undefined) {
    return input.moderationEnabled ? "Sistema de moderacao ativado." : "Sistema de moderacao desativado.";
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
