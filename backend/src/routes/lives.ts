import { Router } from "express";
import { z } from "zod";
import { requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
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

  return res.json({
    lives: listLiveEvents(guildId)
  });
});

livesRouter.post("/events", async (req, res, next) => {
  try {
    const input = liveEventSchema.parse(req.body);
    const event = createLiveEvent(input);
    const realtimeEvent = input.type === "started" ? "live:started" : "live:ended";

    await createLog({
      guildId: input.guildId,
      type: realtimeEvent,
      message: `${input.streamer} ${input.type === "started" ? "iniciou" : "encerrou"} uma live.`,
      metadata: input
    });

    emitRealtime(realtimeEvent, event);

    return res.status(201).json({
      live: event
    });
  } catch (error) {
    return next(error);
  }
});
