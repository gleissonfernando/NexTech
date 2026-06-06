import { Router } from "express";
import { requireAdminAccess, requireAuth } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { getGuildLiveOptions } from "../services/discordOptionsService";
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

guildsRouter.get("/:guildId/live-options", requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = req.params.guildId;

    if (!guildId) {
      return res.status(400).json({
        message: "Servidor obrigatorio."
      });
    }

    if (!canManageDashboardGuild(res.locals.dashboardAuth.user, guildId)) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar lives deste servidor."
      });
    }

    return res.json({
      options: await getGuildLiveOptions(guildId)
    });
  } catch (error) {
    return next(error);
  }
});
