import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canReadDevBotModule, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { areGuildRoles, userHasAnyGuildRole } from "../services/discordOptionsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  createServerBackup,
  deleteServerBackup,
  getServerBackupDashboard,
  getServerBackupSettings,
  previewServerBackupRestore,
  restoreServerBackup,
  saveServerBackupSettings
} from "../services/serverBackupService";
import type { AuthSessionUser } from "../types/session";

const MODULE_ID = "server-backup";
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const backupIdSchema = z.string().min(8).max(120);
const snowflakeSchema = z.string().regex(/^\d{5,32}$/);
const optionalSnowflakeSchema = z.union([snowflakeSchema, z.literal(""), z.null()]).optional();
const restorePartSchema = z.enum(["roles", "channels", "permissions", "emojis", "settings", "panels"]);

const settingsSchema = z.object({
  autoEnabled: z.boolean().optional(),
  authorizedRoleIds: z.array(snowflakeSchema).max(50).optional(),
  frequency: z.enum(["6h", "12h", "daily", "weekly", "monthly"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  logChannelId: optionalSnowflakeSchema
});

const restoreSchema = z.object({
  confirmation: z.string().optional(),
  parts: z.array(restorePartSchema).max(6).default(["roles", "channels", "permissions", "emojis", "settings", "panels"])
});

export const serverBackupsRouter = Router();

serverBackupsRouter.use(requireAuth);

serverBackupsRouter.get("/:guildId", async (req, res, next) => {
  try {
    const scope = await readScope(req, res);
    if (!scope || !(await canReadDevBotModule(scope.user, scope.botId, scope.guildId, MODULE_ID))) {
      return res.status(403).json({ message: "Sem acesso ao Backup Completo deste bot/servidor." });
    }

    return res.json(await getServerBackupDashboard(scope.botId, scope.guildId));
  } catch (error) {
    return next(error);
  }
});

serverBackupsRouter.patch("/:guildId/settings", async (req, res, next) => {
  try {
    const scope = await readScope(req, res);
    const input = settingsSchema.parse(req.body ?? {});
    if (!scope || !(await canManageServerBackup(scope))) {
      return res.status(403).json({ message: "Sem permissao para configurar Backup Completo." });
    }

    const token = await readBotToken(scope.botId);
    if (input.authorizedRoleIds?.length && !(await areGuildRoles(scope.guildId, input.authorizedRoleIds, token))) {
      return res.status(400).json({ message: "Um ou mais cargos autorizados nao existem neste servidor." });
    }

    return res.json({
      settings: await saveServerBackupSettings(scope.botId, scope.guildId, input, scope.user.discordId ?? scope.user.id)
    });
  } catch (error) {
    return next(error);
  }
});

serverBackupsRouter.post("/:guildId/backups", async (req, res, next) => {
  try {
    const scope = await readScope(req, res);
    if (!scope || !(await canManageServerBackup(scope))) {
      return res.status(403).json({ message: "Sem permissao para criar backup." });
    }

    const botToken = await readBotToken(scope.botId);
    const backup = await createServerBackup({
      actorId: scope.user.discordId ?? scope.user.id,
      botId: scope.botId,
      botToken,
      guildId: scope.guildId,
      kind: "manual"
    });

    return res.status(201).json({ backup });
  } catch (error) {
    return next(error);
  }
});

serverBackupsRouter.delete("/:guildId/backups/:backupId", async (req, res, next) => {
  try {
    const scope = await readScope(req, res);
    const backupId = backupIdSchema.parse(req.params.backupId);
    if (!scope || !(await canManageServerBackup(scope))) {
      return res.status(403).json({ message: "Sem permissao para apagar backup." });
    }

    await deleteServerBackup(scope.botId, scope.guildId, backupId, scope.user.discordId ?? scope.user.id);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

serverBackupsRouter.post("/:guildId/backups/:backupId/preview", async (req, res, next) => {
  try {
    const scope = await readScope(req, res);
    const backupId = backupIdSchema.parse(req.params.backupId);
    const input = restoreSchema.parse(req.body ?? {});
    if (!scope || !(await canReadDevBotModule(scope.user, scope.botId, scope.guildId, MODULE_ID))) {
      return res.status(403).json({ message: "Sem permissao para visualizar restauracao." });
    }

    return res.json({
      preview: await previewServerBackupRestore({
        backupId,
        botId: scope.botId,
        botToken: await readBotToken(scope.botId),
        guildId: scope.guildId,
        parts: input.parts
      })
    });
  } catch (error) {
    return next(error);
  }
});

serverBackupsRouter.post("/:guildId/backups/:backupId/restore", async (req, res, next) => {
  try {
    const scope = await readScope(req, res);
    const backupId = backupIdSchema.parse(req.params.backupId);
    const input = restoreSchema.parse(req.body ?? {});
    if (input.confirmation !== "CONFIRMAR") {
      return res.status(400).json({ message: "Digite CONFIRMAR para iniciar a restauracao." });
    }
    if (!scope || !(await canManageServerBackup(scope))) {
      return res.status(403).json({ message: "Sem permissao para restaurar backup." });
    }

    return res.json({
      job: await restoreServerBackup({
        actorId: scope.user.discordId ?? scope.user.id,
        backupId,
        botId: scope.botId,
        botToken: await readBotToken(scope.botId),
        guildId: scope.guildId,
        parts: input.parts
      })
    });
  } catch (error) {
    return next(error);
  }
});

async function readScope(req: Request, res: Response) {
  const guildId = guildIdSchema.parse(req.params.guildId);
  const botId = await resolveRequestBotId(req);
  const user = res.locals.dashboardAuth.user as AuthSessionUser;
  return botId ? { botId, guildId, user } : null;
}

async function readBotToken(botId: string) {
  const token = await getDevBotToken(botId);
  if (!token) throw Object.assign(new Error("Token do bot nao configurado."), { statusCode: 400 });
  return token;
}

async function canManageServerBackup(scope: { botId: string; guildId: string; user: AuthSessionUser }) {
  if (await canUseDevBotModule(scope.user, scope.botId, scope.guildId, MODULE_ID)) {
    return true;
  }

  const settings = await getServerBackupSettings(scope.botId, scope.guildId);
  if (!scope.user.discordId || !settings.authorizedRoleIds.length) {
    return false;
  }

  return userHasAnyGuildRole(scope.guildId, scope.user.discordId, settings.authorizedRoleIds, await readBotToken(scope.botId));
}
