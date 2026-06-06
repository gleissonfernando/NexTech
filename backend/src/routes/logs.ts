import { Router } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
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
  const logs = await listLogs(guildId);

  if (isBotRequest(req)) {
    return res.json({
      logs
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
    logs: guildId ? logs : logs.filter((log) => allowedGuildIds.has(log.guildId))
  });
});

logsRouter.post("/", async (req, res, next) => {
  try {
    const input = logSchema.parse(req.body);

    if (!isBotRequest(req) && !canReadDashboardGuild(res.locals.dashboardAuth.user, input.guildId)) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const log = await createLog(input);

    emitRealtime("logs:new", log);

    return res.status(201).json({
      log
    });
  } catch (error) {
    return next(error);
  }
});
