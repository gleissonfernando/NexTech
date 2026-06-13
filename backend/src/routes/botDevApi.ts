import { Router } from "express";
import { z } from "zod";
import { requireBot } from "../middleware/auth";
import { authorizeBotCommand } from "../services/botCommandAuthorizationService";
import { getBotGuildConfig, getBotApiPermissions } from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

export const botDevApiRouter = Router();
const commandAuthorizationSchema = z.object({
  channelId: z.string().nullable().optional(),
  userId: z.string().nullable().optional()
});

botDevApiRouter.use(requireBot);

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
      botId,
      enabledModules: permissions.enabledModules
    });
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
