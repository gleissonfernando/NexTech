import { Router } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { createLiveEvent, listLiveEvents } from "../services/liveService";
import { createLog } from "../services/logService";

const liveEventSchema = z.object({
  guildId: z.string().min(1),
  type: z.enum(["started", "ended"]),
  streamer: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url().optional()
});

export const livesRouter = Router();

livesRouter.use(requireAuthOrBot);

livesRouter.get("/", (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const lives = listLiveEvents(guildId);

  if (isBotRequest(req)) {
    return res.json({
      lives
    });
  }

  const user = res.locals.dashboardAuth.user;

  if (guildId && !canReadDashboardGuild(user, guildId)) {
    return res.status(403).json({
      message: "Servidor nao encontrado ou sem o bot."
    });
  }

  const allowedGuildIds = getAccessibleGuildIds(user);

  return res.json({
    lives: guildId ? lives : lives.filter((event) => allowedGuildIds.has(event.guildId))
  });
});

livesRouter.post("/events", async (req, res, next) => {
  try {
    const input = liveEventSchema.parse(req.body);

    if (!isBotRequest(req) && !canReadDashboardGuild(res.locals.dashboardAuth.user, input.guildId)) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const event = createLiveEvent(input);
    const realtimeEvent = input.type === "started" ? "live:started" : "live:ended";

    const log = await createLog({
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
