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
  isClipSent,
  listActiveClipsConfigs,
  listClipsHistory,
  recordClipSent,
  saveClipsConfig,
  sendClipsTest,
  updateClipsConfigLastCheck,
  validateTwitchClipChannel
} from "../services/clipsService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const clipsConfigSchema = z.object({
  guildId: guildIdSchema,
  twitchChannelInput: z.string().min(1).max(256),
  discordChannelId: z.string().regex(/^\d{5,32}$/).nullable(),
  allowedRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).default([]),
  mentionType: z.enum(["none", "everyone", "role"]).default("none"),
  mentionRoleId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  embedColor: z.string().max(16).nullable().optional(),
  customMessage: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().optional()
});
const guildActionSchema = z.object({
  guildId: guildIdSchema
});
const botCheckSchema = z.object({
  lastCheckAt: z.string().datetime().optional()
});
const botSentSchema = z.object({
  clipId: z.string().min(1).max(128),
  clipTitle: z.string().min(1).max(300),
  clipUrl: z.string().url().max(2048),
  clipThumbnail: z.string().url().max(2048).nullable().optional(),
  clipCreatorName: z.string().max(100).nullable().optional(),
  createdAtTwitch: z.string().datetime(),
  discordChannelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  discordMessageId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});

export const clipsRouter = Router();

clipsRouter.get("/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = readGuildId(req.query.guildId);
    const botId = await resolveRequestBotId(req);

    await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId);

    return res.json({
      config: await getClipsConfig(guildId, botId)
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

    await assertCanManageClips(user, input.guildId, botId);

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

    await assertCanManageClips(user, input.guildId, botId);

    return res.json({
      config: await enableClipsConfig(input.guildId, user.discordId, botId)
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

    await assertCanManageClips(user, input.guildId, botId);

    return res.json({
      config: await disableClipsConfig(input.guildId, user.discordId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.get("/history", requireAuth, async (req, res, next) => {
  try {
    const guildId = readGuildId(req.query.guildId);
    const botId = await resolveRequestBotId(req);

    await assertCanReadClips(res.locals.dashboardAuth.user, guildId, botId);

    return res.json({
      clips: await listClipsHistory(guildId, botId)
    });
  } catch (error) {
    return next(error);
  }
});

clipsRouter.post("/test", requireAuth, async (req, res, next) => {
  try {
    const input = guildActionSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageClips(user, input.guildId, botId);

    return res.json({
      ok: true,
      ...(await sendClipsTest(input.guildId, user.discordId, botId, await getDevBotToken(botId)))
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

clipsRouter.post("/bot/configs/:configId/sent", requireBot, async (req, res, next) => {
  try {
    const input = botSentSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const configId = z.string().min(1).parse(req.params.configId);

    return res.status(201).json({
      clip: await recordClipSent(configId, input, botId)
    });
  } catch (error) {
    return next(error);
  }
});

function readGuildId(value: unknown) {
  return guildIdSchema.parse(typeof value === "string" ? value : "");
}

async function assertCanReadClips(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes("clips")) {
      throw createRouteError("O modulo de clips nao foi liberado para este bot.", 403);
    }

    if (await canReadDevBotModule(user, botId, guildId, "clips")) {
      return;
    }
  } else if (canReadDashboardGuild(user, guildId)) {
    return;
  }

  if (await hasClipsRoleAccess(user, guildId, botId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para acessar clips deste servidor.", 403);
}

async function assertCanManageClips(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (botId) {
    const permissions = await getBotApiPermissions(botId);

    if (!permissions?.enabledModules.includes("clips")) {
      throw createRouteError("O modulo de clips nao foi liberado para este bot.", 403);
    }

    if (await canUseDevBotModule(user, botId, guildId, "clips")) {
      return;
    }
  } else if (canManageDashboardGuild(user, guildId)) {
    return;
  }

  if (await hasClipsRoleAccess(user, guildId, botId)) {
    return;
  }

  throw createRouteError("Voce nao tem permissao para configurar clips deste servidor.", 403);
}

async function hasClipsRoleAccess(user: AuthSessionUser, guildId: string, botId: string | null) {
  if (!botId) {
    return false;
  }

  const config = await getClipsConfig(guildId, botId).catch(() => null);

  if (!config?.allowedRoleIds.length) {
    return false;
  }

  return userHasAnyGuildRole(guildId, user.discordId, config.allowedRoleIds, await getDevBotToken(botId));
}

function createRouteError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
