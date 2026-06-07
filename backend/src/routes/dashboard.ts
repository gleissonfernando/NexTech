import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { fetchBotProfile } from "../services/botProfileService";
import { canAccessDevPanel } from "../services/devAccessService";
import { canManageDevBotGuild, getAccessibleDashboardBotBySlug, listAccessibleDashboardBots } from "../services/devBotService";
import { mergeAuthorizedBotGuilds } from "../services/statsService";
import { issueAuthCookies, type DashboardAuth } from "../services/tokenService";
import { saveSelectedGuild } from "../services/userService";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

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
      return res.status(404).json({
        message: "Dashboard do bot nao encontrada."
      });
    }

    return res.json({
      bot
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

    if (!canManageDashboardGuild(auth.user, input.selectedGuildId) && !(await canManageDevBotGuild(auth.user, botId, input.selectedGuildId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para configurar este servidor."
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
