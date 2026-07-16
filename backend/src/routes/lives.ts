import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import {
  createLiveEvent,
  getLiveDetectionSettings,
  listLiveEvents,
  removeLiveDetectionSettings,
  saveLiveDetectionSettings
} from "../services/liveService";
import { createLog } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const liveEventSchema = z.object({
  guildId: z.string().min(1),
  type: z.enum(["started", "ended"]),
  streamer: z.string().min(1),
  userId: z.string().min(1).nullable().optional(),
  title: z.string().optional(),
  url: z.string().url().optional(),
  roleId: z.string().min(1).nullable().optional(),
  roleApplied: z.boolean().optional(),
  roleRemoved: z.boolean().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  error: z.string().nullable().optional()
});

const liveSettingsSchema = z.object({
  guildId: z.string().min(1),
  enabled: z.boolean().optional(),
  liveRoleId: z.string().min(1).nullable().optional(),
  logChannelId: z.string().min(1).nullable().optional(),
  actorId: z.string().min(1).nullable().optional()
});

export const livesRouter = Router();

livesRouter.use(requireAuthOrBot);

livesRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const botId = await resolveRequestBotId(req);
  const lives = listLiveEvents(guildId, botId);

  if (isBotRequest(req)) {
    return res.json({
      lives
    });
  }

  const user = res.locals.dashboardAuth.user;

  if (guildId && !(await canReadScopedGuild(req, guildId, botId))) {
    return res.status(403).json({
      message: "Servidor não encontrado ou sem o bot."
    });
  }

  const allowedGuildIds = getAccessibleGuildIds(user);

  return res.json({
    lives: guildId ? lives : lives.filter((event) => allowedGuildIds.has(event.guildId))
  });
});

livesRouter.get("/settings", async (req, res, next) => {
  try {
    const guildId = z.string().min(1).parse(req.query.guildId);
    const botId = await resolveRequestBotId(req);

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, guildId, botId))) {
      return res.status(403).json({
        message: "Servidor não encontrado ou sem o bot."
      });
    }

    const settings = await getLiveDetectionSettings(botId, guildId);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

livesRouter.put("/settings", async (req, res, next) => {
  try {
    const input = liveSettingsSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);

    if (!isBotRequest(req) && !(await canManageScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor não encontrado ou sem o bot."
      });
    }

    const actorId = isBotRequest(req) ? input.actorId ?? null : res.locals.dashboardAuth.user.discordId;
    const settings = await saveLiveDetectionSettings(botId, input.guildId, input, actorId);

    if (botId) {
      const log = await createLog({
        botId,
        guildId: input.guildId,
        type: "audit.lives",
        userId: actorId,
        module: "lives",
        action: "live_detection_settings_updated",
        message: "Configuração do Sistema Detecta Lives atualizada.",
        metadata: settings
      });

      emitRealtime("logs:new", log);
    }

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

livesRouter.delete("/settings/:guildId", async (req, res, next) => {
  try {
    const guildId = z.string().min(1).parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    if (!isBotRequest(req) && !(await canManageScopedGuild(req, guildId, botId))) {
      return res.status(403).json({
        message: "Servidor não encontrado ou sem o bot."
      });
    }

    const actorId = isBotRequest(req) ? null : res.locals.dashboardAuth.user.discordId;
    const settings = await removeLiveDetectionSettings(botId, guildId, actorId);
    if (botId) {
      const log = await createLog({
        botId,
        guildId,
        type: "audit.lives",
        userId: actorId,
        module: "lives",
        action: "live_detection_settings_removed",
        message: "Configuração do Sistema Detecta Lives removida.",
        metadata: settings
      });

      emitRealtime("logs:new", log);
    }

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

livesRouter.post("/events", async (req, res, next) => {
  try {
    const input = liveEventSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);

    if (!botId) {
      return res.status(400).json({
        message: "botId obrigatório para registrar evento de live."
      });
    }

    if (!isBotRequest(req) && !(await canManageScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor não encontrado ou sem o bot."
      });
    }

    const event = createLiveEvent({
      ...input,
      botId
    });
    const realtimeEvent = input.type === "started" ? "live:started" : "live:ended";

    const log = await createLog({
      botId,
      guildId: input.guildId,
      type: realtimeEvent,
      message: `${input.streamer} ${input.type === "started" ? "iniciou" : "encerrou"} uma live.`,
      metadata: input
    });

    emitRealtime("logs:new", log);
    emitRealtime(realtimeEvent, event);

    return res.status(201).json({
      live: event
    });
  } catch (error) {
    return next(error);
  }
});

async function canReadScopedGuild(req: Request, guildId: string | undefined, botId: string | null) {
  if (!guildId) {
    return true;
  }

  if (botId) {
    return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "live");
  }

  return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManageScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "live");
  }

  return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}
