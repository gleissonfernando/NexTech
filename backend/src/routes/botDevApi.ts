import { Router } from "express";
import { z } from "zod";
import { requireBot } from "../middleware/auth";
import { authorizeBotCommand } from "../services/botCommandAuthorizationService";
import {
  authorizeBotRuntimeModule,
  getBotGuildConfig,
  getBotApiPermissions,
  syncDevBotGuilds,
  syncDevBotProfile,
  updateBotGuildModuleRuntimeStatus,
  updateDevBotRuntimeStatus
} from "../services/devBotService";
import { getMaintenanceState } from "../services/maintenanceService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const botDevApiRouter = Router();
const commandAuthorizationSchema = z.object({
  channelId: z.string().nullable().optional(),
  userId: z.string().nullable().optional()
});
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const runtimeStatusSchema = z.object({
  botGuilds: z.array(z.object({
    id: z.string().regex(/^\d{5,32}$/),
    name: z.string().min(1).max(100)
  })).max(250).optional(),
  botProfile: z.object({
    avatarUrl: z.string().url().nullable().optional(),
    id: z.string().regex(/^\d{5,32}$/),
    username: z.string().min(1).max(100)
  }).optional(),
  online: z.boolean()
});
const tagVerificationStatusSchema = z.object({
  lastCheckAt: z.string().datetime(),
  nextCheckAt: z.string().datetime().nullable(),
  totalChecked: z.number().int().min(0),
  totalAssigned: z.number().int().min(0),
  totalRemoved: z.number().int().min(0),
  totalIgnored: z.number().int().min(0),
  totalUnavailable: z.number().int().min(0),
  totalErrors: z.number().int().min(0),
  lastError: z.string().max(500).nullable()
});

botDevApiRouter.use(requireBot);

botDevApiRouter.get("/maintenance", async (_req, res, next) => {
  try {
    return res.json({
      maintenance: await getMaintenanceState()
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/runtime/modules", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const permissions = botId ? await getBotApiPermissions(botId) : null;

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    return res.json({
      active: permissions.desiredOnline && permissions.status !== "error" && permissions.status !== "invalid_token",
      botId,
      checkedAt: new Date().toISOString(),
      enabledModules: permissions.enabledModules,
      status: permissions.status
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/runtime/status", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);

    if (!botId) {
      return res.status(400).json({
        message: "Bot nao identificado na requisicao runtime."
      });
    }

    const input = runtimeStatusSchema.parse(req.body ?? {});

    if (input.botProfile) {
      await syncDevBotProfile(botId, input.botProfile);
    }

    if (input.botGuilds) {
      await syncDevBotGuilds(botId, input.botGuilds);
    }

    const bot = await updateDevBotRuntimeStatus(
      botId,
      input.online ? "online" : "offline",
      input.online ? "Bot conectado ao Discord." : "Bot offline."
    );

    return res.json({
      botId,
      status: bot?.status ?? (input.online ? "online" : "offline")
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/runtime/guilds/:guildId/modules/:moduleId/authorize", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const authorization = await authorizeBotRuntimeModule({
      botId,
      guildId: req.params.guildId,
      moduleId: req.params.moduleId
    });

    return res.json({
      authorization
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/runtime/guilds/:guildId/tag-verification/status", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const status = tagVerificationStatusSchema.parse(req.body ?? {});
    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "tag-verification" });

    if (!authorization.allowed || !botId) {
      return res.status(403).json({ message: authorization.reason });
    }

    await updateBotGuildModuleRuntimeStatus({ botId, guildId, moduleId: "tag-verification", status });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/commands/:commandName/authorize", async (req, res, next) => {
  try {
    const { commandName, guildId } = req.params;
    const input = commandAuthorizationSchema.parse(req.body ?? {});

    if (!commandName || !guildId) {
      return res.status(400).json({
        message: "guildId e commandName sao obrigatorios."
      });
    }

    const authorization = await authorizeBotCommand({
      botId: await resolveRequestBotId(req),
      channelId: input.channelId,
      commandName,
      guildId,
      userId: input.userId
    });

    return res.json({
      authorization
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/permissions", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    return res.json(permissions);
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/guild/:guildId/modules", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    return res.json({
      botId: req.params.botId,
      guildId: req.params.guildId,
      modules: permissions.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/guild/:guildId/config", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot nao encontrado."
      });
    }

    const config = await getBotGuildConfig(req.params.botId, req.params.guildId);

    return res.json({
      ...config,
      enabledModules: permissions.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});
