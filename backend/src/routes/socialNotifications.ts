import { Router } from "express";
import { z } from "zod";
import { requireAdminAccess, requireAuth, requireBot } from "../middleware/auth";
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
import { getBotGuildIds } from "../services/statsService";
import type { AuthSessionUser } from "../types/session";

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

socialNotificationsRouter.get("/bot/twitch-active", requireBot, async (_req, res, next) => {
  try {
    const botGuildIds = getBotGuildIds();
    const notifications = await listActiveTwitchNotifications();

    return res.json({
      notifications: botGuildIds.size > 0 ? notifications.filter((notification) => botGuildIds.has(notification.guildId)) : []
    });
  } catch (error) {
    return next(error);
  }
});

socialNotificationsRouter.patch("/bot/twitch/:id/state", requireBot, async (req, res, next) => {
  try {
    const id = getRequiredParam(req.params.id, "id");
    const input = stateSchema.parse(req.body);
    const notification = await updateTwitchNotificationState(id, input);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch/preview", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    assertCanManageGuild(res.locals.dashboardAuth.user, guildId);

    const input = previewTwitchSchema.parse(req.body);
    const preview = await previewTwitchChannel(input.twitchChannelInput);

    return res.json({
      preview
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.get("/:guildId", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    assertCanManageGuild(res.locals.dashboardAuth.user, guildId);

    return res.json({
      notifications: await listSocialNotifications(guildId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    assertCanManageGuild(user, guildId);

    const input = createTwitchSchema.parse(req.body);
    const notification = await createTwitchNotification(guildId, {
      ...input,
      userId: user.discordId
    });

    return res.status(201).json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.put("/:guildId/twitch/:id", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    assertCanManageGuild(res.locals.dashboardAuth.user, guildId);

    const input = updateTwitchSchema.parse(req.body);
    const notification = await updateTwitchNotification(guildId, id, input);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch/:id/test", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    assertCanManageGuild(user, guildId);

    await sendTwitchNotificationTest(guildId, id, user.discordId);

    return res.json({
      ok: true
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.delete("/:guildId/twitch/:id", requireAuth, requireAdminAccess, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    assertCanManageGuild(user, guildId);

    const notification = await deleteTwitchNotification(guildId, id, user.discordId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

function assertCanManageGuild(user: AuthSessionUser, guildId: string) {
  if (!canManageDashboardGuild(user, guildId)) {
    throw createServiceError("Você não tem permissão para configurar as notificações deste servidor.", 403);
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
