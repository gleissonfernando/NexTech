import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getBotStatus } from "../services/statsService";

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
