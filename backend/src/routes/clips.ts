import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild, canReadDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getBotApiPermissions, getDevBotToken } from "../services/devBotService";
import { userHasAnyGuildRole } from "../services/discordOptionsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { getBotGuildIds } from "../services/statsService";
import {
  disableClipsConfig,
  enableClipsConfig,
  getClipsConfig,
  getClipsStats,
  getPublicKickClips,
  isClipSent,
  listActiveClipsConfigs,
  listClipsHistory,
  listClipsRanking,
  recordClipSent,
  saveClipsConfig,
  sendClipsTest,
  updateClipLiveSession,
  updateClipsConfigLastCheck,
  validateKickClipChannel,
  validateTwitchClipChannel
} from "../services/clipsService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const clipPlatformSchema = z.enum(["twitch", "kick"]).default("twitch");
const clipDateFilterSchema = z.enum(["today", "yesterday", "7d", "30d", "all"]).default("all");
const clipRewardSchema = z.object({
  clipCount: z.number().int().min(1).max(100000),
  label: z.string().min(1).max(60),
  roleId: z.string().regex(/^\d{5,32}$/)
});
const clipsConfigSchema = z.object({
  guildId: guildIdSchema,
  platform: clipPlatformSchema.optional(),
  twitchChannelInput: z.string().max(256).nullable().optional(),
  kickChannelInput: z.string().max(256).nullable().optional(),
  kickChannelUrl: z.string().max(2048).nullable().optional(),
  kickChannelId: z.string().max(64).nullable().optional(),
  kickApiToken: z.string().max(512).nullable().optional(),
  discordChannelId: z.string().regex(/^\d{5,32}$/).nullable(),
  allowedRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).default([]),
  mentionType: z.enum(["none", "everyone", "role"]).default("none"),
  mentionRoleId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  embedColor: z.string().max(16).nullable().optional(),
  customMessage: z.string().max(1000).nullable().optional(),
  clipRewards: z.array(clipRewardSchema).default([]),
  enabled: z.boolean().optional()
});
const guildActionSchema = z.object({
  guildId: guildIdSchema,
  platform: clipPlatformSchema.optional()
});
const botCheckSchema = z.object({
  lastCheckAt: z.string().datetime().optional()
});
const botLiveSessionSchema = z.object({
  isLive: z.boolean(),
  streamId: z.string().max(256).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  thumbnailUrl: z.string().url().max(2048).nullable().optional()
});
const botSentSchema = z.object({
  clipId: z.string().min(1).max(128),
  clipTitle: z.string().min(1).max(300),
  clipUrl: z.string().url().max(2048),
  clipThumbnail: z.string().url().max(2048).nullable().optional(),
  clipCreatorName: z.string().max(100).nullable().optional(),
  clipDuration: z.number().min(0).max(86400).nullable().optional(),
  createdAtTwitch: z.string().datetime(),
  discordChannelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  discordMessageId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});

export const clipsRouter = Router();

clipsRouter.get("/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = readGuildId(req.query.guildId);
    const botId = await resolveRequestBotId(req);
    const platform = readPlatform(req.query.platform);

    await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId, platform);

    return res.json({
      config: await getClipsConfig(guildId, botId, platform)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.post("/config", requireAuth, async (req, res, next) => {
  try {
    const input = clipsConfigSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const platform = input.platform ?? "twitch";

    await assertCanManageClips(user, input.guildId, botId, platform);

    const config = await saveClipsConfig(input.guildId, input, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      config
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.post("/enable", requireAuth, async (req, res, next) => {
  try {
    const input = guildActionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const platform = input.platform ?? "twitch";

    await assertCanManageClips(user, input.guildId, botId, platform);

    return res.json({
      config: await enableClipsConfig(input.guildId, user.discordId, botId, platform)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.post("/disable", requireAuth, async (req, res, next) => {
  try {
    const input = guildActionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const platform = input.platform ?? "twitch";

    await assertCanManageClips(user, input.guildId, botId, platform);

    return res.json({
      config: await disableClipsConfig(input.guildId, user.discordId, botId, platform)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/history", requireAuth, async (req, res, next) => {
  try {
    const guildId = readGuildId(req.query.guildId);
    const botId = await resolveRequestBotId(req);
    const platform = readPlatform(req.query.platform);
    const filter = readDateFilter(req.query.filter);

    await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId, platform);

    return res.json({
      clips: await listClipsHistory(guildId, botId, { filter, platform })
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/ranking", requireAuth, async (req, res, next) => {
  try {
    const guildId = readGuildId(req.query.guildId);
    const botId = await resolveRequestBotId(req);
    const platform = readPlatform(req.query.platform);
    const filter = readDateFilter(req.query.filter);

    await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId, platform);

    return res.json({
      ranking: await listClipsRanking(guildId, botId, { filter, platform })
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/stats", requireAuth, async (req, res, next) => {
  try {
    const guildId = readGuildId(req.query.guildId);
    const botId = await resolveRequestBotId(req);
    const platform = readPlatform(req.query.platform);

    await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId, platform);

    return res.json({
      stats: await getClipsStats(guildId, botId, platform)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/public/kick/:channel", async (req, res, next) => {
  try {
    const channel = z.string().min(1).max(256).parse(req.params.channel);

    return res.json(await getPublicKickClips(channel));
  } catch (error) {
    return next(error);
  }
});

clipsRouter.post("/test", requireAuth, async (req, res, next) => {
  try {
    const input = guildActionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const platform = input.platform ?? "twitch";

    await assertCanManageClips(user, input.guildId, botId, platform);

    return res.json({
      ok: true,
      ...(await sendClipsTest(input.guildId, user.discordId, botId, await getDevBotToken(botId), platform))
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/validate-twitch", requireAuth, async (req, res, next) => {
  try {
    const channel = typeof req.query.channel === "string" ? req.query.channel : "";

    return res.json({
      channel: await validateTwitchClipChannel(channel)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/validate-kick", requireAuth, async (req, res, next) => {
  try {
    const channel = typeof req.query.channel === "string" ? req.query.channel : "";
    const guildId = typeof req.query.guildId === "string" ? guildIdSchema.parse(req.query.guildId) : null;
    const botId = await resolveRequestBotId(req);

    if (guildId) {
      await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId, "kick");
    }

    return res.json({
      channel: await validateKickClipChannel(channel, guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/bot/configs", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const configs = await listActiveClipsConfigs(botId);
    const botGuildIds = getBotGuildIds();

    return res.json({
      configs: botId ? configs : configs.filter((config) => botGuildIds.has(config.guildId))
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/bot/configs/:configId/sent/:clipId", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const configId = z.string().min(1).parse(req.params.configId);
    const clipId = z.string().min(1).parse(req.params.clipId);

    return res.json({
      sent: await isClipSent(configId, clipId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.patch("/bot/configs/:configId/check", requireBot, async (req, res, next) => {
  try {
    const input = botCheckSchema.parse(req.body ?? {});
    const botId = await resolveRequestBotId(req);
    const configId = z.string().min(1).parse(req.params.configId);

    await updateClipsConfigLastCheck(configId, botId, input.lastCheckAt ? new Date(input.lastCheckAt) : new Date());

    return res.json({
      ok: true
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.patch("/bot/configs/:configId/live-session", requireBot, async (req, res, next) => {
  try {
    const input = botLiveSessionSchema.parse(req.body ?? {});
    const botId = await resolveRequestBotId(req);
    const configId = z.string().min(1).parse(req.params.configId);

    await updateClipLiveSession(configId, input, botId);

    return res.json({
      ok: true
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.post("/bot/configs/:configId/sent", requireBot, async (req, res, next) => {
  try {
    const input = botSentSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const configId = z.string().min(1).parse(req.params.configId);
    const result = await recordClipSent(configId, input, botId);

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

function readGuildId(value: unknown) {
  return guildIdSchema.parse(typeof value === "string" ? value : "");
}

function readPlatform(value: unknown) {
  return clipPlatformSchema.parse(typeof value === "string" ? value : "twitch");
}

function readDateFilter(value: unknown) {
  return clipDateFilterSchema.parse(typeof value === "string" ? value : "all");
}

async function assertCanReadClips(user: AuthSessionUser, guildId: string, botId: string | null, platform: "twitch" | "kick") {
  const moduleId = moduleIdForPlatform(platform);

  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes(moduleId)) {
      throw createRouteError(`O modulo de clipes ${platform === "kick" ? "Kick" : "Twitch"} nao foi liberado para este bot.`, 403);
    }

    if (await canReadDevBotModule(user, botId, guildId, moduleId)) {
      return;
    }
  } else if (canReadDashboardGuild(user, guildId)) {
    return;
  }

  if (await hasClipsRoleAccess(user, guildId, botId, platform)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar clipes deste servidor.", 403);
}

async function assertCanManageClips(user: AuthSessionUser, guildId: string, botId: string | null, platform: "twitch" | "kick") {
  const moduleId = moduleIdForPlatform(platform);

  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes(moduleId)) {
      throw createRouteError(`O modulo de clipes ${platform === "kick" ? "Kick" : "Twitch"} nao foi liberado para este bot.`, 403);
    }

    if (await canUseDevBotModule(user, botId, guildId, moduleId)) {
      return;
    }
  } else if (canManageDashboardGuild(user, guildId)) {
    return;
  }

  if (await hasClipsRoleAccess(user, guildId, botId, platform)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar clipes deste servidor.", 403);
}

async function hasClipsRoleAccess(user: AuthSessionUser, guildId: string, botId: string | null, platform: "twitch" | "kick") {
  if (!botId) {
    return false;
  }

  const config = await getClipsConfig(guildId, botId, platform).catch(() => null);

  if (!config?.allowedRoleIds.length) {
    return false;
  }

  return userHasAnyGuildRole(guildId, user.discordId, config.allowedRoleIds, await getDevBotToken(botId));
}

function moduleIdForPlatform(platform: "twitch" | "kick") {
  return platform === "kick" ? "kick-clips" : "clips";
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
