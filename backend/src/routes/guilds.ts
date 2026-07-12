import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canAccessDevBotGuild, canManageDevBotGuild, getDevBotToken } from "../services/devBotService";
import { createLog } from "../services/logService";
import { deleteGuildStructure, getGuildLiveOptions, getGuildMemberOptions, getGuildRoleOptions } from "../services/discordOptionsService";
import { getBotStatus } from "../services/statsService";
import { removePanelImageSettings, savePanelImageUpload } from "../services/panelImageSettingsService";

export const guildsRouter = Router();
const imageUpload = raw({ limit: "10mb", type: ["image/gif", "image/jpeg", "image/png", "image/webp"] });

guildsRouter.use(requireAuth);

guildsRouter.get("/", (req, res) => {
  return res.json({
    guilds: req.session.user?.guilds ?? []
  });
});

guildsRouter.get("/:guildId", (req, res) => {
  const guild = req.session.user?.guilds.find((item) => item.id === req.params.guildId);

  if (!guild) {
    return res.status(404).json({
      message: "Servidor nao encontrado ou sem permissao administrativa."
    });
  }

  return res.json({
    guild
  });
});

guildsRouter.get("/:guildId/stats", (req, res) => {
  const guild = req.session.user?.guilds.find((item) => item.id === req.params.guildId);

  if (!guild) {
    return res.status(404).json({
      message: "Servidor nao encontrado ou sem permissao administrativa."
    });
  }

  return res.json({
    stats: {
      memberCount: guild.memberCount,
      channelCount: guild.channelCount,
      activeLives: 0,
      openTickets: 0,
      botStatus: getBotStatus(),
      updatedAt: new Date().toISOString()
    }
  });
});

guildsRouter.get("/:guildId/live-options", async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    const botId = typeof req.query.botId === "string" && req.query.botId.trim() ? req.query.botId.trim() : null;
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

    if (!guildId) {
      return res.status(400).json({
        message: "Servidor obrigatorio."
      });
    }

    if (
      !canReadDashboardGuild(res.locals.dashboardAuth.user, guildId) &&
      !(await canAccessDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))
    ) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar lives deste servidor."
      });
    }

    return res.json({
      options: await getGuildLiveOptions(guildId, await getDevBotToken(botId), forceRefresh)
    });
  } catch (error) {
    return next(error);
  }
});

guildsRouter.post("/:guildId/delete-channels", async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    const input = z.object({
      botId: z.string().trim().min(1),
      channelIds: z.array(z.string().regex(/^\d{16,22}$/)).max(500).default([]),
      roleIds: z.array(z.string().regex(/^\d{16,22}$/)).max(250).default([])
    }).refine((value) => value.channelIds.length + value.roleIds.length > 0, "Selecione ao menos um canal ou cargo.").parse(req.body);
    const botId = input.botId;

    if (
      !canReadDashboardGuild(res.locals.dashboardAuth.user, guildId) &&
      !(await canAccessDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))
    ) {
      return res.status(403).json({ message: "Voce nao tem permissao para apagar canais deste servidor." });
    }

    const result = await deleteGuildStructure(
      guildId,
      input.channelIds,
      input.roleIds,
      await getDevBotToken(botId)
    );

    await createLog({
      botId,
      guildId,
      userId: res.locals.dashboardAuth.user.discordId ?? res.locals.dashboardAuth.user.id,
      type: "dashboard.channels_deleted",
      message: `${result.deleted.length} canal(is) e/ou cargo(s) removido(s) pela dashboard.`,
      metadata: { deletedIds: result.deleted.map((channel) => channel.id), failedIds: result.failed.map((channel) => channel.id) }
    }).catch(() => null);

    return res.json({ result });
  } catch (error) {
    return next(error);
  }
});

guildsRouter.get("/:guildId/role-options", async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    const botId = typeof req.query.botId === "string" && req.query.botId.trim() ? req.query.botId.trim() : null;

    if (!guildId) {
      return res.status(400).json({
        message: "Servidor obrigatorio."
      });
    }

    if (
      !canManageDashboardGuild(res.locals.dashboardAuth.user, guildId) &&
      !(await canManageDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))
    ) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar cargos deste servidor."
      });
    }

    return res.json({
      roles: await getGuildRoleOptions(guildId, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

guildsRouter.get("/:guildId/member-options", async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    const botId = typeof req.query.botId === "string" && req.query.botId.trim() ? req.query.botId.trim() : null;
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";

    if (!guildId) {
      return res.status(400).json({
        message: "Servidor obrigatorio."
      });
    }

    if (
      !canManageDashboardGuild(res.locals.dashboardAuth.user, guildId) &&
      !(await canManageDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))
    ) {
      return res.status(403).json({
        message: "Voce nao tem permissao para selecionar usuarios deste servidor."
      });
    }

    return res.json({
      members: await getGuildMemberOptions(guildId, query, await getDevBotToken(botId))
    });
  } catch (error) {
    return next(error);
  }
});

guildsRouter.post("/:guildId/modules/:moduleId/images", imageUpload, async (req, res, next) => {
  try {
    const guildId = z.string().regex(/^\d{5,32}$/).parse(req.params.guildId);
    const moduleId = z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/i).parse(req.params.moduleId);
    const botId = typeof req.query.botId === "string" && req.query.botId.trim() ? req.query.botId.trim() : null;
    const mimeType = req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";

    if (!botId) return res.status(400).json({ message: "Escolha um bot cadastrado para configurar imagens." });
    if (!(await canManageDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para configurar imagens deste modulo." });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "Arquivo de imagem obrigatorio." });
    }

    return res.json({
      settings: await savePanelImageUpload({
        actorId: res.locals.dashboardAuth.user.discordId,
        botId,
        buffer: req.body,
        guildId,
        mimeType,
        panelId: moduleId
      })
    });
  } catch (error) {
    return next(error);
  }
});

guildsRouter.delete("/:guildId/modules/:moduleId/images/:imageType", async (req, res, next) => {
  try {
    const guildId = z.string().regex(/^\d{5,32}$/).parse(req.params.guildId);
    const moduleId = z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/i).parse(req.params.moduleId);
    z.enum(["panel", "banner", "thumbnail", "footer", "background", "logo"]).parse(req.params.imageType);
    const botId = typeof req.query.botId === "string" && req.query.botId.trim() ? req.query.botId.trim() : null;

    if (!botId) return res.status(400).json({ message: "Escolha um bot cadastrado para configurar imagens." });
    if (!(await canManageDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))) {
      return res.status(403).json({ message: "Voce nao tem permissao para remover imagens deste modulo." });
    }

    return res.json({
      settings: await removePanelImageSettings({
        actorId: res.locals.dashboardAuth.user.discordId,
        botId,
        guildId,
        panelId: moduleId
      })
    });
  } catch (error) {
    return next(error);
  }
});
