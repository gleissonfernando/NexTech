import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  canReadDevBotModule,
  canUseDevBotModule,
  getBotGuildModuleConfig,
  updateBotGuildModuleConfig
} from "../services/devBotService";
import type { AuthSessionUser } from "../types/session";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const botIdSchema = z.string().min(1).max(120);
const moduleIdSchema = z.enum([
  "anti-ban",
  "suspicious-servers",
  "global-blacklist",
  "advanced-permissions",
  "invite-cleanup",
  "server-backup",
  "vanity-url-protection",
  "hide-empty-voice",
  "auto-unmute",
  "temporary-voice",
  "tag-verification",
  "bio-url-verification",
  "first-lady"
]);
const primitiveConfigValue = z.union([
  z.boolean(),
  z.string().max(500),
  z.number().finite().min(0).max(1_000_000),
  z.null()
]);
const configSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  z.union([
    primitiveConfigValue,
    z.array(primitiveConfigValue).max(250)
  ])
).default({});
const saveSchema = z.object({
  config: configSchema,
  guildName: z.string().min(1).max(100).optional()
});

export const advancedModulesRouter = Router();

advancedModulesRouter.use(requireAuth);

advancedModulesRouter.get("/:botId/:guildId/:moduleId", async (req, res, next) => {
  try {
    const botId = botIdSchema.parse(req.params.botId);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const moduleId = moduleIdSchema.parse(req.params.moduleId);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    if (!(await canReadDevBotModule(user, botId, guildId, moduleId))) {
      return res.status(403).json({
        message: "Este modulo nao foi liberado para este bot ou voce nao tem permissao para visualiza-lo."
      });
    }

    return res.json({
      module: await getBotGuildModuleConfig(botId, guildId, moduleId)
    });
  } catch (error) {
    return next(error);
  }
});

advancedModulesRouter.patch("/:botId/:guildId/:moduleId", async (req, res, next) => {
  try {
    const botId = botIdSchema.parse(req.params.botId);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const moduleId = moduleIdSchema.parse(req.params.moduleId);
    const input = saveSchema.parse(req.body ?? {});
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    if (!(await canUseDevBotModule(user, botId, guildId, moduleId))) {
      return res.status(403).json({
        message: "Este modulo nao foi liberado para este bot ou voce nao tem permissao para configura-lo."
      });
    }

    return res.json({
      module: await updateBotGuildModuleConfig({
        botId,
        guildId,
        guildName: input.guildName ?? `Servidor ${guildId}`,
        moduleId,
        config: input.config
      })
    });
  } catch (error) {
    return next(error);
  }
});
