import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import {
  authorizeBotRuntimeModule,
  canReadDevBotModule,
  canUseDevBotModule,
  runtimeModuleIdForLogType
} from "../services/devBotService";
import { createLog, listLogs } from "../services/logService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const logSchema = z.object({
  guildId: z.string().min(1),
  userId: z.string().optional().nullable(),
  executorId: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  logChannelId: z.string().optional().nullable(),
  module: z.string().max(100).optional().nullable(),
  action: z.string().max(140).optional().nullable(),
  caseId: z.string().max(120).optional().nullable(),
  status: z.string().max(60).optional().nullable(),
  transcriptId: z.string().max(120).optional().nullable(),
  type: z.string().min(1),
  message: z.string().min(1),
  metadata: z.unknown().optional()
});

export const logsRouter = Router();

logsRouter.use(requireAuthOrBot);

logsRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const botId = await resolveRequestBotId(req);

  if (isBotRequest(req)) {
    const logs = filterLogs(await listLogs(guildId, botId), req.query);
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

  const logs = filterLogs(await listLogs(guildId, botId), req.query);
  const allowedGuildIds = getAccessibleGuildIds(user);

  return res.json({
    logs: guildId ? logs : logs.filter((log) => allowedGuildIds.has(log.guildId))
  });
});

function filterLogs(logs: Awaited<ReturnType<typeof listLogs>>, query: Request["query"]) {
  const moduleFilter = textQuery(query.module);
  const userFilter = textQuery(query.userId);
  const actionFilter = textQuery(query.action);
  const statusFilter = textQuery(query.status);
  const caseFilter = textQuery(query.caseId);
  const from = dateQuery(query.dateFrom);
  const to = dateQuery(query.dateTo);

  return logs.filter((log) => {
    const createdAt = new Date(log.createdAt).getTime();
    if (moduleFilter && log.module !== moduleFilter && !log.type.startsWith(`${moduleFilter}.`)) return false;
    if (userFilter && log.userId !== userFilter && log.executorId !== userFilter) return false;
    if (actionFilter && log.action !== actionFilter && !log.type.includes(actionFilter)) return false;
    if (statusFilter && log.status !== statusFilter) return false;
    if (caseFilter && log.caseId !== caseFilter && !String(log.metadata ?? "").includes(caseFilter)) return false;
    if (from && createdAt < from.getTime()) return false;
    if (to && createdAt > to.getTime()) return false;
    return true;
  });
}

function textQuery(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateQuery(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

logsRouter.post("/", async (req, res, next) => {
  try {
    const input = logSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);

    if (isBotRequest(req)) {
      const moduleId = runtimeModuleIdForLogType(input.type);

      if (moduleId) {
        const authorization = await authorizeBotRuntimeModule({
          botId,
          guildId: input.guildId,
          moduleId
        });

        if (!authorization.allowed) {
          return res.status(204).send();
        }
      }
    }

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
