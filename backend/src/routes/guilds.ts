import { Router } from "express";
import { requireAdminAccess, requireAuth } from "../middleware/auth";
import { getGuildLiveOptions } from "../services/discordOptionsService";
import { getBotStatus } from "../services/statsService";
import type { AuthSessionUser } from "../types/session";

export const guildsRouter = Router();

guildsRouter.use(requireAuth);

guildsRouter.get("/", (req, res) => {
  const botStatus = getBotStatus();
  const guilds = req.session.user?.guilds.map((guild) => ({
    ...guild,
    botEnabled: guild.botEnabled || botStatus.online
  }));

  return res.json({
    guilds
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

    if (!canManageGuild(res.locals.dashboardAuth.user, guildId)) {
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

function canManageGuild(user: AuthSessionUser, guildId: string) {
  if (user.authorized) {
    return true;
  }

  const guild = user.guilds.find((item) => item.id === guildId);
  return Boolean(guild && (guild.owner || guild.isAdmin));
}
