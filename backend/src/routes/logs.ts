import { Router } from "express";
import { z } from "zod";
import { requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { createLog, listLogs } from "../services/logService";

const logSchema = z.object({
  guildId: z.string().min(1),
  userId: z.string().optional().nullable(),
  type: z.string().min(1),
  message: z.string().min(1),
  metadata: z.unknown().optional()
});

export const logsRouter = Router();

logsRouter.use(requireAuthOrBot);

logsRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;

  return res.json({
    logs: await listLogs(guildId)
  });
});

logsRouter.post("/", async (req, res, next) => {
  try {
    const input = logSchema.parse(req.body);
    const log = await createLog(input);

    emitRealtime("logs:new", log);

    return res.status(201).json({
      log
    });
  } catch (error) {
    return next(error);
  }
});
