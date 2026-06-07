import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { createLog, listLogs } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

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
  const botId = await resolveRequestBotId(req);
  const logs = await listLogs(guildId, botId);

  if (isBotRequest(req)) {
    return res.json({
      logs
    });
  }

  const user = res.locals.dashboardAuth.user;

  if (guildId && !(await canReadScopedGuild(req, guildId, botId))) {
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
    const botId = await resolveRequestBotId(req);

    if (!isBotRequest(req) && !(await canManageScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const log = await createLog({
      ...input,
      botId
    });

    emitRealtime("logs:new", log);

    return res.status(201).json({
      log
    });
  } catch (error) {
    return next(error);
  }
});

async function canReadScopedGuild(req: Request, guildId: string, botId: string | null) {
  const user = req.res?.locals.dashboardAuth.user;

  if (!user) {
    return false;
  }

  if (botId) {
    return canReadDevBotModule(user, botId, guildId, "logs");
  }

  return canReadDashboardGuild(user, guildId);
}

async function canManageScopedGuild(req: Request, guildId: string, botId: string | null) {
  const user = req.res?.locals.dashboardAuth.user;

  if (!user) {
    return false;
  }

  if (botId) {
    return canUseDevBotModule(user, botId, guildId, "logs");
  }

  return canManageDashboardGuild(user, guildId);
}
