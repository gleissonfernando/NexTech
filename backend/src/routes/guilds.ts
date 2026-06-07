import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild, getDevBotToken } from "../services/devBotService";
import { getGuildLiveOptions, getGuildRoleOptions } from "../services/discordOptionsService";
import { getBotStatus } from "../services/statsService";

export const guildsRouter = Router();

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
        message: "Voce nao tem permissao para configurar lives deste servidor."
      });
    }

    return res.json({
      options: await getGuildLiveOptions(guildId, await getDevBotToken(botId))
    });
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
