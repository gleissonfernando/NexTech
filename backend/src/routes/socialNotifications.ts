import { Router } from "express";
import { z } from "zod";
import type { Request } from "express";
import { requireAuth, requireBot } from "../middleware/auth";
import {
  claimTwitchLiveStart,
  createServiceError,
  createTwitchNotification,
  deleteTwitchNotification,
  listActiveTwitchNotifications,
  listSocialNotifications,
  previewTwitchNotificationPanel,
  previewTwitchChannel,
  sendTwitchNotificationTest,
  updateTwitchNotification,
  updateTwitchNotificationState,
  TWITCH_NOTIFICATION_LIMIT
} from "../services/socialNotificationService";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { isGuildTextChannel } from "../services/discordOptionsService";
import { getBotGuildIds } from "../services/statsService";
import type { AuthSessionUser } from "../types/session";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { createLog } from "../services/logService";

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

const claimStartSchema = z.object({
  lastLiveAt: z.string().min(1),
  streamId: z.string().min(1)
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).optional().default("")
});

export const socialNotificationsRouter = Router();
export const botLivesRouter = Router();

botLivesRouter.get("/:botId/guilds/:guildId/lives", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanReadGuild(req, guildId, botId, "visualizou lives");

    const query = listQuerySchema.parse(req.query);
    const result = await listSocialNotifications(guildId, botId, query);
    await writeLiveAudit({
      action: "visualizou lives",
      botId,
      guildId,
      metadata: {
        total: result.total
      },
      userId: user.discordId
    });

    return res.json({
      ...result,
      limit: TWITCH_NOTIFICATION_LIMIT
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

botLivesRouter.post("/:botId/guilds/:guildId/lives/preview", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    await assertCanManageGuild(req, guildId, botId, "previsualizou live");

    const input = previewTwitchSchema.parse(req.body);
    const preview = await previewTwitchChannel(input.twitchChannelInput);

    return res.json({
      preview
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

botLivesRouter.post("/:botId/guilds/:guildId/lives", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "criou live");

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

botLivesRouter.patch("/:botId/guilds/:guildId/lives/:id", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "editou live");

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

botLivesRouter.post("/:botId/guilds/:guildId/lives/:id/test", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "testou live");

    await sendTwitchNotificationTest(guildId, id, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      ok: true
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

botLivesRouter.get("/:botId/guilds/:guildId/lives/:id/panel-preview", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    await assertCanManageGuild(req, guildId, botId, "visualizou previa da live");

    return res.json({
      preview: await previewTwitchNotificationPanel(guildId, id, botId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

botLivesRouter.delete("/:botId/guilds/:guildId/lives/:id", requireAuth, async (req, res, next) => {
  try {
    const botId = getRequiredParam(req.params.botId, "botId");
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "removeu live");

    const notification = await deleteTwitchNotification(guildId, id, user.discordId, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

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

socialNotificationsRouter.post("/bot/twitch/:id/claim-start", requireBot, async (req, res, next) => {
  try {
    const id = getRequiredParam(req.params.id, "id");
    const botId = await resolveRequestBotId(req);
    const input = claimStartSchema.parse(req.body);
    const result = await claimTwitchLiveStart(id, input, botId);

    return res.json(result);
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.post("/:guildId/twitch/preview", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    await assertCanManageGuild(req, guildId, botId, "previsualizou live");

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
    await assertCanReadGuild(req, guildId, botId, "visualizou lives");
    const query = listQuerySchema.parse(req.query);
    const result = await listSocialNotifications(guildId, botId, query);
    await writeLiveAudit({
      action: "visualizou lives",
      botId,
      guildId,
      metadata: {
        total: result.total
      },
      userId: user.discordId
    });

    return res.json({
      ...result,
      limit: TWITCH_NOTIFICATION_LIMIT
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
    await assertCanManageGuild(req, guildId, botId, "criou live");

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
    await assertCanManageGuild(req, guildId, botId, "editou live");

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
    await assertCanManageGuild(req, guildId, botId, "testou live");

    await sendTwitchNotificationTest(guildId, id, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      ok: true
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

socialNotificationsRouter.get("/:guildId/twitch/:id/panel-preview", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    await assertCanManageGuild(req, guildId, botId, "visualizou previa da live");

    return res.json({
      preview: await previewTwitchNotificationPanel(guildId, id, botId)
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
    await assertCanManageGuild(req, guildId, botId, "removeu live");

    const notification = await deleteTwitchNotification(guildId, id, user.discordId, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

async function assertCanManageGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canUseDevBotModule(user, botId, guildId, "live")) : !canManageDashboardGuild(user, guildId)) {
    await writeLiveAudit({
      action: `sem permissao tentou ${action}`,
      botId,
      guildId,
      userId: user.discordId
    });
    throw createServiceError("Você não tem permissão para configurar as notificações deste servidor.", 403);
  }
}

async function assertCanReadGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canReadDevBotModule(user, botId, guildId, "live")) : !canManageDashboardGuild(user, guildId)) {
    await writeLiveAudit({
      action: `sem permissao tentou ${action}`,
      botId,
      guildId,
      userId: user.discordId
    });
    throw createServiceError("Voce nao tem permissao para visualizar as notificacoes deste servidor.", 403);
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

async function writeLiveAudit(input: {
  action: string;
  botId: string | null;
  guildId: string;
  metadata?: Record<string, unknown>;
  userId: string;
}) {
  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    type: "audit.lives",
    message: `Usuario ${input.action}.`,
    metadata: {
      action: input.action,
      botId: input.botId,
      guildId: input.guildId,
      module: "lives",
      userId: input.userId,
      ...input.metadata
    }
  }).catch(() => undefined);
}
