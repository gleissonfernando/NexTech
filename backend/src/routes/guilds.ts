import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canManageDevBotGuild, getDevBotToken } from "../services/devBotService";
import { createLog } from "../services/logService";
import { deleteGuildVoiceChannelsAndCategories, getGuildLiveOptions, getGuildMemberOptions, getGuildRoleOptions } from "../services/discordOptionsService";
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
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

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
      botId: z.string().trim().min(1).nullable().optional(),
      channelIds: z.array(z.string().regex(/^\d{16,22}$/)).min(1).max(500)
    }).parse(req.body);
    const botId = input.botId ?? null;

    if (
      !canManageDashboardGuild(res.locals.dashboardAuth.user, guildId) &&
      !(await canManageDevBotGuild(res.locals.dashboardAuth.user, botId, guildId))
    ) {
      return res.status(403).json({ message: "Voce nao tem permissao para apagar canais deste servidor." });
    }

    const result = await deleteGuildVoiceChannelsAndCategories(
      guildId,
      input.channelIds,
      await getDevBotToken(botId)
    );

    await createLog({
      botId,
      guildId,
      userId: res.locals.dashboardAuth.user.discordId ?? res.locals.dashboardAuth.user.id,
      type: "dashboard.channels_deleted",
      message: `${result.deleted.length} canal(is) removido(s) pela dashboard.`,
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

    if (query.length < 2) {
      return res.json({
        members: []
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
