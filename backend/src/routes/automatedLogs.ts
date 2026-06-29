import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { areGuildRoles } from "../services/discordOptionsService";
import {
  authorizeBotRuntimeModule,
  canReadDevBotModule,
  canUseDevBotModule,
  getBotApiPermissions,
  getDevBotToken
} from "../services/devBotService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  getAutomatedLogSettings,
  saveAutomatedLogSettings,
  updateAutomatedLogRuntime
} from "../services/automatedLogService";
import type { AuthSessionUser } from "../types/session";

const guild = z.string().regex(/^\d{5,32}$/);
const id = guild;
const channels = z.object({
  absence: id.nullable(),
  calls: id.nullable(),
  messages: id.nullable(),
  punishment: id.nullable(),
  site: id.nullable(),
  verification: id.nullable()
});
const enabledChannels = z.object({
  absence: z.boolean().optional(),
  calls: z.boolean().optional(),
  messages: z.boolean().optional(),
  punishment: z.boolean().optional(),
  site: z.boolean().optional(),
  verification: z.boolean().optional()
});

export const automatedLogsRouter = Router();

automatedLogsRouter.get("/bot/:guildId", requireBot, async (req, res, next) => {
  try {
    const scope = await botScope(req, req.params.guildId);
    return res.json({ settings: await getAutomatedLogSettings(scope.botId, scope.guildId) });
  } catch (error) {
    return next(error);
  }
});

automatedLogsRouter.patch("/bot/:guildId/runtime", requireBot, async (req, res, next) => {
  try {
    const scope = await botScope(req, req.params.guildId);
    const input = z.object({
      categoryId: id.nullable().optional(),
      channels: channels.optional(),
      lastError: z.string().max(1000).nullable().optional(),
      synced: z.boolean().optional()
    }).parse(req.body);
    return res.json({ settings: await updateAutomatedLogRuntime(scope.botId, scope.guildId, input) });
  } catch (error) {
    return next(error);
  }
});

automatedLogsRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const scope = await userScope(req, res.locals.dashboardAuth.user, req.params.guildId, false);
    return res.json({ settings: await getAutomatedLogSettings(scope.botId, scope.guildId) });
  } catch (error) {
    return next(error);
  }
});

automatedLogsRouter.patch("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const scope = await userScope(req, user, req.params.guildId, true);
    const input = z.object({
      allowedRoleIds: z.array(id).max(100).optional(),
      enabled: z.boolean().optional(),
      enabledChannels: enabledChannels.optional()
    }).parse(req.body);

    if (input.allowedRoleIds?.length && !(await areGuildRoles(scope.guildId, input.allowedRoleIds, await getDevBotToken(scope.botId)))) {
      throw err("Um dos cargos autorizados a ver logs não pertence a este servidor.", 400);
    }

    return res.json({ settings: await saveAutomatedLogSettings(scope.botId, scope.guildId, input) });
  } catch (error) {
    return next(error);
  }
});

automatedLogsRouter.post("/:guildId/sync", requireAuth, async (req, res, next) => {
  try {
    const scope = await userScope(req, res.locals.dashboardAuth.user, req.params.guildId, true);
    return res.json({ settings: await saveAutomatedLogSettings(scope.botId, scope.guildId, {}, true) });
  } catch (error) {
    return next(error);
  }
});

async function botScope(req: Parameters<typeof resolveRequestBotId>[0], raw: unknown) {
  const guildId = guild.parse(raw);
  const botId = await resolveRequestBotId(req);

  if (!botId) throw err("Escopo do bot é obrigatório.", 400);

  const permissions = await getBotApiPermissions(botId);
  if (!permissions?.enabledModules.includes("logs")) throw err("Logs não estão ativados para este bot.", 403);

  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "logs" });
  if (!authorization.allowed) throw err(authorization.reason, 403);

  return { botId, guildId };
}

async function userScope(req: Parameters<typeof resolveRequestBotId>[0], user: AuthSessionUser, raw: unknown, manage: boolean) {
  const guildId = guild.parse(raw);
  const botId = await resolveRequestBotId(req);

  if (!botId) throw err("Selecione um bot cadastrado.", 400);

  const allowed = manage
    ? await canUseDevBotModule(user, botId, guildId, "logs")
    : await canReadDevBotModule(user, botId, guildId, "logs");

  if (!allowed) throw err("Você não tem permissão para configurar este sistema de logs.", 403);

  return { botId, guildId };
}

function err(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
