import { Router } from "express";
import { z } from "zod";
import type { Request } from "express";
import { requireAuth, requireBot } from "../middleware/auth";
import {
  createServiceError,
  createTwitchNotification,
  deleteTwitchNotification,
  listActiveTwitchNotifications,
  listSocialNotifications,
  previewTwitchChannel,
  sendTwitchNotificationTest,
  updateTwitchNotification,
  updateTwitchNotificationState
} from "../services/socialNotificationService";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { isGuildTextChannel } from "../services/discordOptionsService";
import { getBotGuildIds } from "../services/statsService";
import type { AuthSessionUser } from "../types/session";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const createTwitchSchema = z.object({
  twitchChannelInput: z.string(),
  discordChannelId: z.string().min(1),
  mentionRoleId: z.string().optional().nullable(),
  customMessage: z.string().optional().nullable(),
  embedColor: z.string().optional().nullable(),
  enabled: z.boolean().default(true)
});

const previewTwitchSchema = z.object({
  twitchChannelInput: z.string()
});

const updateTwitchSchema = z.object({
  discordChannelId: z.string().min(1).optional(),
  mentionRoleId: z.string().optional().nullable(),
  customMessage: z.string().optional().nullable(),
  embedColor: z.string().optional().nullable(),
  enabled: z.boolean().optional()
});

const stateSchema = z.object({
  isLive: z.boolean().optional(),
  lastLiveAt: z.string().optional().nullable(),
  lastStreamId: z.string().optional().nullable(),
  lastMessageId: z.string().optional().nullable(),
  twitchAvatar: z.string().optional().nullable()
});

export const socialNotificationsRouter = Router();

socialNotificationsRouter.get("/bot/twitch-active", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const botGuildIds = getBotGuildIds();
    const notifications = await listActiveTwitchNotifications(botId);

    return res.json({
      notifications: botId ? notifications : botGuildIds.size > 0 ? notifications.filter((notification) => botGuildIds.has(notification.guildId)) : []
    });
  } catch (error) {
    return next(error);
  }
});

socialNotificationsRouter.patch("/bot/twitch/:id/state", requireBot, async (req, res, next) => {
  try {
    const id = getRequiredParam(req.params.id, "id");
    const botId = await resolveRequestBotId(req);
    const input = stateSchema.parse(req.body);
    const notification = await updateTwitchNotificationState(id, input, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch/preview", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    await assertCanManageGuild(req, guildId, botId);

    const input = previewTwitchSchema.parse(req.body);
    const preview = await previewTwitchChannel(input.twitchChannelInput);

    return res.json({
      preview
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId);

    return res.json({
      notifications: await listSocialNotifications(guildId, botId, user.discordId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId);

    const input = createTwitchSchema.parse(req.body);
    await assertChannelBelongsToGuild(guildId, input.discordChannelId, botId);
    const notification = await createTwitchNotification(guildId, {
      ...input,
      botId,
      userId: user.discordId
    });

    return res.status(201).json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.put("/:guildId/twitch/:id", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId);

    const input = updateTwitchSchema.parse(req.body);

    if (input.discordChannelId) {
      await assertChannelBelongsToGuild(guildId, input.discordChannelId, botId);
    }

    const notification = await updateTwitchNotification(guildId, id, input, user.discordId, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch/:id/test", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId);

    await sendTwitchNotificationTest(guildId, id, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      ok: true
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.delete("/:guildId/twitch/:id", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId);

    const notification = await deleteTwitchNotification(guildId, id, user.discordId, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

async function assertCanManageGuild(req: Request, guildId: string, botId: string | null) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canUseDevBotModule(user, botId, guildId, "live")) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError("Você não tem permissão para configurar as notificações deste servidor.", 403);
  }
}

async function assertChannelBelongsToGuild(guildId: string, channelId: string, botId: string | null) {
  const validChannel = await isGuildTextChannel(guildId, channelId, await getDevBotToken(botId));

  if (!validChannel) {
    throw createServiceError("Selecione um canal de texto que pertence ao servidor configurado.", 400);
  }
}

function getRequiredParam(value: string | undefined, name: string) {
  if (!value) {
    throw createServiceError(`${name} obrigatório.`, 400);
  }

  return value;
}

function handleRouteError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => unknown } }, next: (error: unknown) => unknown) {
  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : null;

  if (statusCode) {
    return res.status(statusCode).json({
      message: error instanceof Error ? error.message : "Erro inesperado."
    });
  }

  return next(error);
}
