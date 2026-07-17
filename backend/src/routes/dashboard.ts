import { Router } from "express";
import { z } from "zod";
import { ACCESS_DENIED_MESSAGE, SUPPORT_DISCORD_URL, requireAuth } from "../middleware/auth";
import { recordAccessAttempt } from "../services/accessAuditService";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { fetchBotProfile } from "../services/botProfileService";
import { canAccessDevPanel } from "../services/devAccessService";
import { canAccessDevBotGuild, canManageDevBotGuild, getAccessibleDashboardBotBySlug, getBotGuildConfig, getDevBot, listAccessibleDashboardBots, updateBotGuildConfig } from "../services/devBotService";
import { getMaintenanceState } from "../services/maintenanceService";
import { mergeAuthorizedBotGuilds } from "../services/statsService";
import { issueAuthCookies, type DashboardAuth } from "../services/tokenService";
import { saveSelectedGuild } from "../services/userService";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/maintenance", async (_req, res, next) => {
  try {
    return res.json({
      maintenance: await getMaintenanceState()
    });
  } catch (error) {
    return next(error);
  }
});

dashboardRouter.get("/me", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const user = auth.user;
    const panelBots = await listAccessibleDashboardBots(user).catch(() => []);
    const canViewDev = await canAccessDevPanel(user);
    const accessibleGuilds = user.authorized ? mergeAuthorizedBotGuilds(user.guilds) : user.guilds;
    const guildsById = new Map(
      accessibleGuilds
      .filter((guild) => guild.botEnabled && (user.authorized || guild.owner || guild.isAdmin))
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
        owner: guild.owner,
        permissions: guild.isAdmin ? "ADMINISTRATOR" : "0",
        botInGuild: guild.botEnabled
      }))
      .map((guild) => [guild.id, guild])
    );

    for (const bot of panelBots) {
      for (const guildId of bot.guildIds) {
        if (guildsById.has(guildId)) {
          continue;
        }

        const userGuild = user.guilds.find((guild) => guild.id === guildId);
        guildsById.set(guildId, {
          id: guildId,
          name: userGuild?.name ?? (guildId === bot.mainGuildId ? bot.mainGuildName : `Servidor ${guildId}`),
          iconUrl: userGuild?.iconUrl ?? (guildId === bot.mainGuildId ? bot.mainGuildIconUrl : null),
          owner: userGuild?.owner ?? false,
          permissions: userGuild?.isAdmin || userGuild?.owner
            ? "ADMINISTRATOR"
            : "BOT_ADMIN",
          botInGuild: true
        });
      }
    }

    const guilds = [...guildsById.values()];

    const selectedGuildId = user.selectedGuildId && guilds.some((guild) => guild.id === user.selectedGuildId)
      ? user.selectedGuildId
      : guilds[0]?.id ?? null;

    return res.json({
      user: {
        id: user.discordId,
        username: user.username,
        globalName: user.globalName,
        avatarUrl: user.avatarUrl ?? user.avatar
      },
      bot: await fetchBotProfile(),
      bots: panelBots,
      canViewDev,
      selectedGuildId,
      guilds
    });
  } catch (error) {
    return next(error);
  }
});

dashboardRouter.get("/bots/:botId/guilds/:guildId/config", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = z.object({
      botId: z.string().min(1),
      guildId: z.string().regex(/^\d{5,32}$/)
    }).parse(req.params);
    const canViewDev = await canAccessDevPanel(auth.user);

    if (!canViewDev && !(await canAccessDevBotGuild(auth.user, input.botId, input.guildId))) {
      return res.status(403).json({
        message: ACCESS_DENIED_MESSAGE,
        supportUrl: SUPPORT_DISCORD_URL
      });
    }

    return res.json({
      config: await getBotGuildConfig(input.botId, input.guildId)
    });
  } catch (error) {
    return next(error);
  }
});

const dashboardServerReleaseModules = new Set(["police-daf-roster", "visible-message", "message-control"]);

dashboardRouter.post("/bots/:botId/guilds/:guildId/modules/:moduleId/release", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = z.object({
      botId: z.string().min(1),
      guildId: z.string().regex(/^\d{5,32}$/),
      moduleId: z.string().min(1)
    }).parse(req.params);
    const body = z.object({
      guildName: z.string().min(1).max(120).optional()
    }).parse(req.body ?? {});

    if (!dashboardServerReleaseModules.has(input.moduleId)) {
      return res.status(400).json({
        message: "Este módulo não aceita liberação pela dashboard do servidor."
      });
    }

    if (!(await canManageDevBotGuild(auth.user, input.botId, input.guildId))) {
      return res.status(403).json({
        message: ACCESS_DENIED_MESSAGE,
        supportUrl: SUPPORT_DISCORD_URL
      });
    }

    const bot = await getDevBot(input.botId);
    if (!bot) {
      return res.status(404).json({
        message: "Bot não encontrado."
      });
    }

    if (!bot.enabledModules.includes(input.moduleId)) {
      return res.status(403).json({
        message: "Módulo não foi liberado para este bot."
      });
    }

    const current = await getBotGuildConfig(input.botId, input.guildId);
    const modules = current.modules as Record<string, Record<string, unknown>>;
    const config = await updateBotGuildConfig({
      botId: input.botId,
      guildId: input.guildId,
      guildName: body.guildName ?? current.guildName,
      modules: {
        ...modules,
        [input.moduleId]: {
          ...(modules[input.moduleId] ?? {}),
          enabled: true
        }
      }
    });

    return res.json({ config });
  } catch (error) {
    return next(error);
  }
});

dashboardRouter.get("/:slug", async (req, res, next) => {
  try {
    const input = z
      .object({
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      })
      .parse(req.params);
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const bot = await getAccessibleDashboardBotBySlug(auth.user, input.slug);

    if (!bot) {
      await recordAccessAttempt(req, {
        userId: auth.user.discordId,
        username: auth.user.username,
        dashboardSlug: input.slug,
        result: "denied",
        reason: "Dashboard não pertence ao usuário autenticado."
      });
      return res.status(403).json({
        message: ACCESS_DENIED_MESSAGE,
        supportUrl: SUPPORT_DISCORD_URL
      });
    }

    await recordAccessAttempt(req, {
      userId: auth.user.discordId,
      username: auth.user.username,
      dashboardSlug: input.slug,
      botId: bot.id,
      result: "allowed",
      reason: "Dashboard liberada para o usuário autenticado."
    });

    const scopedGuilds = scopedBotDashboardGuilds(auth.user, bot);
    const selectedGuildId = auth.user.selectedGuildId && scopedGuilds.some((guild) => guild.id === auth.user.selectedGuildId)
      ? auth.user.selectedGuildId
      : scopedGuilds[0]?.id ?? null;

    return res.json({
      user: {
        id: auth.user.discordId,
        username: auth.user.username,
        globalName: auth.user.globalName,
        avatarUrl: auth.user.avatarUrl ?? auth.user.avatar
      },
      bot: await fetchBotProfile(),
      bots: [bot],
      selectedBot: bot,
      canViewDev: await canAccessDevPanel(auth.user),
      selectedGuildId,
      guilds: scopedGuilds
    });
  } catch (error) {
    return next(error);
  }
});

dashboardRouter.patch("/selected-guild", async (req, res, next) => {
  try {
    const input = z
      .object({
        selectedGuildId: z.string().regex(/^\d{5,32}$/)
      })
      .parse(req.body);
    const auth = res.locals.dashboardAuth as DashboardAuth;

    const botId = typeof req.body?.botId === "string" && req.body.botId.trim() ? req.body.botId.trim() : null;

    if (!canManageDashboardGuild(auth.user, input.selectedGuildId) && !(await canAccessDevBotGuild(auth.user, botId, input.selectedGuildId))) {
      await recordAccessAttempt(req, {
        userId: auth.user.discordId,
        username: auth.user.username,
        botId,
        guildId: input.selectedGuildId,
        result: "denied",
        reason: "Servidor não pertence ao escopo autorizado do usuário."
      });
      return res.status(403).json({
        message: ACCESS_DENIED_MESSAGE,
        supportUrl: SUPPORT_DISCORD_URL
      });
    }

    auth.user.selectedGuildId = input.selectedGuildId;
    req.session.user = auth.user;
    await saveSelectedGuild(auth.user.discordId, input.selectedGuildId);
    issueAuthCookies(res, auth.user, auth.verified);

    return res.json({
      selectedGuildId: input.selectedGuildId
    });
  } catch (error) {
    return next(error);
  }
});

function scopedBotDashboardGuilds(user: DashboardAuth["user"], bot: Awaited<ReturnType<typeof getAccessibleDashboardBotBySlug>>) {
  if (!bot) {
    return [];
  }

  return bot.guildIds.map((guildId) => {
    const userGuild = user.guilds.find((guild) => guild.id === guildId);
    const isMainGuild = guildId === bot.mainGuildId;

    return {
      id: guildId,
      name: userGuild?.name ?? (isMainGuild ? bot.mainGuildName : `Servidor ${guildId}`),
      iconUrl: userGuild?.iconUrl ?? (isMainGuild ? bot.mainGuildIconUrl : null),
      owner: userGuild?.owner ?? false,
      permissions: userGuild?.isAdmin || userGuild?.owner ? "ADMINISTRATOR" : "BOT_ADMIN",
      botInGuild: true
    };
  });
}
