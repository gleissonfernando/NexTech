import { Router } from "express";
import { z } from "zod";
import type { Request } from "express";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { isGuildTextChannel } from "../services/discordOptionsService";
import {
  createKickNotification,
  createServiceError,
  deleteKickNotification,
  getKickIntegrationStatus,
  KICK_MODULE_ID,
  KICK_NOTIFICATION_LIMIT,
  getKickStreamsForBot,
  listActiveKickNotifications,
  listKickNotifications,
  previewKickNotificationPanel,
  previewKickChannel,
  processKickWebhookStatus,
  saveKickApiConfig,
  sendDiscordKickLiveEnd,
  sendDiscordKickLiveStart,
  sendKickNotificationTest,
  updateKickNotification,
  updateKickNotificationState,
  verifyKickWebhookSignature
} from "../services/kickNotificationService";
import { createLog } from "../services/logService";
import { createLiveEvent } from "../services/liveService";
import { emitRealtime } from "../realtime/events";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { recordKickGiveawayWebhookEvent } from "../services/giveawayIdentityService";
import type { AuthSessionUser } from "../types/session";
import { validateKickApiCredentials } from "../services/kickService";

const KICK_LICENSE_MODULE_IDS = ["live", KICK_MODULE_ID];

const createKickSchema = z.object({
  kickChannelInput: z.string(),
  discordChannelId: z.string().min(1),
  mentionRoleId: z.string().optional().nullable(),
  customMessage: z.string().optional().nullable(),
  embedColor: z.string().optional().nullable(),
  enabled: z.boolean().default(true)
});

const previewKickSchema = z.object({
  kickChannelInput: z.string()
});

const updateKickSchema = z.object({
  discordChannelId: z.string().min(1).optional(),
  mentionRoleId: z.string().optional().nullable(),
  customMessage: z.string().optional().nullable(),
  embedColor: z.string().optional().nullable(),
  enabled: z.boolean().optional()
});

const stateSchema = z.object({
  isLive: z.boolean().optional(),
  kickAvatar: z.string().optional().nullable(),
  kickCategory: z.string().optional().nullable(),
  lastEndedAt: z.string().optional().nullable(),
  lastLiveAt: z.string().optional().nullable(),
  lastMessageId: z.string().optional().nullable(),
  lastStreamId: z.string().optional().nullable(),
  peakViewers: z.number().optional().nullable()
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(100).optional().default("")
});

const validateApiSchema = z.object({
  clientId: z.string().optional().nullable(),
  clientSecret: z.string().optional().nullable(),
  redirectUri: z.string().url().optional().nullable()
}).optional();

export const kickNotificationsRouter = Router();
export const kickWebhookRouter = Router();

kickNotificationsRouter.get("/bot/active", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const notifications = await listActiveKickNotifications(botId);

    return res.json({
      notifications
    });
  } catch (error) {
    return next(error);
  }
});

kickNotificationsRouter.get("/bot/streams", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const streams = await getKickStreamsForBot(botId);

    return res.json({
      streams
    });
  } catch (error) {
    return next(error);
  }
});

kickNotificationsRouter.patch("/bot/:id/state", requireBot, async (req, res, next) => {
  try {
    const id = getRequiredParam(req.params.id, "id");
    const botId = await resolveRequestBotId(req);
    const input = stateSchema.parse(req.body);
    const notification = await updateKickNotificationState(id, input, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.get("/:guildId/status", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    await assertCanReadGuild(req, guildId, botId, "visualizou Kick Integration");

    return res.json({
      status: await getKickIntegrationStatus(guildId, botId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.post("/:guildId/api/validate", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    await assertCanManageGuild(req, guildId, botId, "validou API Kick");

    const input = validateApiSchema.parse(req.body);
    if (!input?.clientId && !input?.clientSecret) {
      const status = await getKickIntegrationStatus(guildId, botId);

      if (status.apiStatus !== "ok") {
        throw createServiceError(status.apiMessage, 400);
      }
    } else {
      await validateKickApiCredentials({
        clientId: input?.clientId ?? undefined,
        clientSecret: input?.clientSecret ?? undefined
      });
    }
    await writeKickAudit({
      action: "validou API Kick",
      botId,
      guildId,
      userId: (req.res?.locals.dashboardAuth.user as AuthSessionUser).discordId
    });

    return res.json({
      message: "API conectada com sucesso."
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.put("/:guildId/api/config", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "salvou API Kick");

    const input = validateApiSchema.parse(req.body);

    if (!input) {
      throw createServiceError("Credenciais da Kick API obrigatorias.", 400);
    }

    const config = await saveKickApiConfig(guildId, {
      clientId: input.clientId ?? "",
      clientSecret: input.clientSecret ?? "",
      redirectUri: input.redirectUri ?? null
    }, user.discordId, botId);

    return res.json({
      config,
      message: "API conectada com sucesso."
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanReadGuild(req, guildId, botId, "visualizou Kick Integration");

    const query = listQuerySchema.parse(req.query);
    const result = await listKickNotifications(guildId, botId, query);
    await writeKickAudit({
      action: "visualizou Kick Integration",
      botId,
      guildId,
      metadata: {
        total: result.total
      },
      userId: user.discordId
    });

    return res.json({
      ...result,
      limit: KICK_NOTIFICATION_LIMIT
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.post("/:guildId/preview", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    await assertCanManageGuild(req, guildId, botId, "previsualizou Kick");

    const input = previewKickSchema.parse(req.body);
    const preview = await previewKickChannel(input.kickChannelInput, guildId, botId);

    return res.json({
      preview
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.post("/:guildId/channels", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "criou canal Kick");

    const input = createKickSchema.parse(req.body);
    await assertChannelBelongsToGuild(guildId, input.discordChannelId, botId);
    const notification = await createKickNotification(guildId, {
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

kickNotificationsRouter.patch("/:guildId/channels/:id", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "editou canal Kick");

    const input = updateKickSchema.parse(req.body);

    if (input.discordChannelId) {
      await assertChannelBelongsToGuild(guildId, input.discordChannelId, botId);
    }

    const notification = await updateKickNotification(guildId, id, input, user.discordId, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.post("/:guildId/channels/:id/test", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "testou Kick");

    await sendKickNotificationTest(guildId, id, user.discordId, botId, await getDevBotToken(botId));

    return res.json({
      ok: true
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.get("/:guildId/channels/:id/panel-preview", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    await assertCanManageGuild(req, guildId, botId, "visualizou previa Kick");

    return res.json({
      preview: await previewKickNotificationPanel(guildId, id, botId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickNotificationsRouter.delete("/:guildId/channels/:id", requireAuth, async (req, res, next) => {
  try {
    const guildId = getRequiredParam(req.params.guildId, "guildId");
    const botId = await resolveRequestBotId(req);
    const id = getRequiredParam(req.params.id, "id");
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    await assertCanManageGuild(req, guildId, botId, "removeu canal Kick");

    const notification = await deleteKickNotification(guildId, id, user.discordId, botId);

    return res.json({
      notification
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

kickWebhookRouter.post("/webhook", async (req, res, next) => {
  try {
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const valid = verifyKickWebhookSignature({
      messageId: req.header("Kick-Event-Message-Id"),
      rawBody,
      signature: req.header("Kick-Event-Signature"),
      timestamp: req.header("Kick-Event-Message-Timestamp")
    });

    if (!valid) {
      return res.status(401).json({
        message: "Assinatura Kick invalida."
      });
    }

    const eventType = req.header("Kick-Event-Type") ?? "";

    const giveawayEvents = await recordKickGiveawayWebhookEvent(eventType, req.body).catch(() => ({
      recorded: 0
    }));

    if (eventType !== "livestream.status.updated") {
      return res.json({
        giveawayEvents,
        ok: true,
        ignored: giveawayEvents.recorded === 0
      });
    }

    const result = await processKickWebhookStatus(req.body, async (notification, stream) => {
      const botToken = await getDevBotToken(notification.botId);

      if (stream) {
        const messageId = await sendDiscordKickLiveStart({
          botToken,
          notification,
          stream
        });
        await recordLiveEvent(notification.guildId, notification.botId, "started", stream.displayName, stream.title, stream.url);
        return messageId;
      }

      await sendDiscordKickLiveEnd({
        botToken,
        notification,
        endedAt: req.body?.ended_at ?? null
      });
      await recordLiveEvent(notification.guildId, notification.botId, "ended", notification.kickDisplayName ?? notification.kickChannelName, undefined, notification.kickChannelUrl);
      return null;
    });

    return res.json({
      ok: true,
      result
    });
  } catch (error) {
    return next(error);
  }
});

async function assertCanManageGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canUseAnyKickModule(user, botId, guildId)) : !canManageDashboardGuild(user, guildId)) {
    await writeKickAudit({
      action: `sem permissao tentou ${action}`,
      botId,
      guildId,
      userId: user.discordId
    });
    throw createServiceError("Voc\u00ea n\u00e3o possui acesso ao m\u00f3dulo Kick Integration.", 403);
  }
}

async function assertCanReadGuild(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canReadAnyKickModule(user, botId, guildId)) : !canManageDashboardGuild(user, guildId)) {
    await writeKickAudit({
      action: `sem permissao tentou ${action}`,
      botId,
      guildId,
      userId: user.discordId
    });
    throw createServiceError("Voc\u00ea n\u00e3o possui acesso ao m\u00f3dulo Kick Integration.", 403);
  }
}

async function canUseAnyKickModule(user: AuthSessionUser, botId: string, guildId: string) {
  for (const moduleId of KICK_LICENSE_MODULE_IDS) {
    if (await canUseDevBotModule(user, botId, guildId, moduleId)) {
      return true;
    }
  }

  return false;
}

async function canReadAnyKickModule(user: AuthSessionUser, botId: string, guildId: string) {
  for (const moduleId of KICK_LICENSE_MODULE_IDS) {
    if (await canReadDevBotModule(user, botId, guildId, moduleId)) {
      return true;
    }
  }

  return false;
}

async function assertChannelBelongsToGuild(guildId: string, channelId: string, botId: string | null) {
  const validChannel = await isGuildTextChannel(guildId, channelId, await getDevBotToken(botId));

  if (!validChannel) {
    throw createServiceError("Selecione um canal de texto que pertence ao servidor configurado.", 400);
  }
}

function getRequiredParam(value: string | undefined, name: string) {
  if (!value) {
    throw createServiceError(`${name} obrigatorio.`, 400);
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

async function writeKickAudit(input: {
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
    type: "audit.kick",
    message: `Usuario ${input.action}.`,
    metadata: {
      action: input.action,
      botId: input.botId,
      guildId: input.guildId,
      module: KICK_MODULE_ID,
      userId: input.userId,
      ...input.metadata
    }
  }).catch(() => undefined);
}

async function recordLiveEvent(
  guildId: string,
  botId: string | null,
  type: "started" | "ended",
  streamer: string,
  title?: string,
  url?: string
) {
  const event = createLiveEvent({
    botId,
    guildId,
    type,
    streamer,
    title,
    url
  });
  const realtimeEvent = type === "started" ? "live:started" : "live:ended";
  const log = await createLog({
    botId,
    guildId,
    type: realtimeEvent,
    message: `${streamer} ${type === "started" ? "iniciou" : "encerrou"} uma live na Kick.`,
    metadata: {
      platform: "kick",
      streamer,
      title,
      type,
      url
    }
  });

  emitRealtime("logs:new", log);
  emitRealtime(realtimeEvent, event);
}
