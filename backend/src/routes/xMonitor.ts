import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth, requireBot } from "../middleware/auth";
import { canManageDashboardGuild } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule, getDevBotToken } from "../services/devBotService";
import { isGuildTextChannel } from "../services/discordOptionsService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { getBotGuildIds } from "../services/statsService";
import type { AuthSessionUser } from "../types/session";
import {
  createServiceError,
  createXAccount,
  deleteXAccount,
  getXMonitorDashboard,
  listActiveXAccounts,
  markXAccountDiscordFailure,
  recordXPostSent,
  syncXAccount,
  updateXAccount,
  verifyXAccount
} from "../services/xMonitorService";

const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const accountInputSchema = z.object({
  active: z.boolean().default(true),
  channelId: z.string().regex(/^\d{5,32}$/),
  username: z.string().min(1).max(2048)
});
const accountUpdateSchema = z.object({
  active: z.boolean().optional(),
  channelId: z.string().regex(/^\d{5,32}$/).optional(),
  username: z.string().min(1).max(2048).optional()
});
const verifySchema = z.object({
  username: z.string().min(1).max(2048)
});
const sentSchema = z.object({
  channelId: z.string().regex(/^\d{5,32}$/),
  discordMessageId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  xPostCreatedAt: z.string().datetime().nullable().optional(),
  xPostId: z.string().min(1).max(64),
  xPostUrl: z.string().url().max(2048)
});
const discordFailureSchema = z.object({
  message: z.string().min(1).max(500)
});

export const xMonitorRouter = Router();

xMonitorRouter.get("/bot/accounts", requireBot, async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const accounts = await listActiveXAccounts(botId);
    const botGuildIds = getBotGuildIds();

    return res.json({
      accounts: botId ? accounts : accounts.filter((account) => botGuildIds.has(account.guildId))
    });
  } catch (error) {
    return next(error);
  }
});

xMonitorRouter.post("/bot/accounts/:accountId/sync", requireBot, async (req, res, next) => {
  try {
    const accountId = getRequiredParam(req.params.accountId, "accountId");
    const botId = await resolveRequestBotId(req);

    return res.json(await syncXAccount(accountId, botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.post("/bot/accounts/:accountId/sent", requireBot, async (req, res, next) => {
  try {
    const accountId = getRequiredParam(req.params.accountId, "accountId");
    const botId = await resolveRequestBotId(req);
    const input = sentSchema.parse(req.body);

    return res.status(201).json(await recordXPostSent(accountId, input, botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.post("/bot/accounts/:accountId/discord-error", requireBot, async (req, res, next) => {
  try {
    const accountId = getRequiredParam(req.params.accountId, "accountId");
    const botId = await resolveRequestBotId(req);
    const input = discordFailureSchema.parse(req.body);
    const account = await markXAccountDiscordFailure(accountId, input.message, botId);

    return res.json({
      account
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.get("/:guildId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);

    await assertCanReadXMonitor(req, guildId, botId, "acessar o X Monitor");

    return res.json(await getXMonitorDashboard(guildId, botId));
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.post("/:guildId/verify", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const input = verifySchema.parse(req.body);

    await assertCanManageXMonitor(req, guildId, botId, "verificar contas do X");

    return res.json({
      profile: await verifyXAccount(input.username)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.post("/:guildId/accounts", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = accountInputSchema.parse(req.body);

    await assertCanManageXMonitor(req, guildId, botId, "cadastrar contas do X");
    await assertChannelBelongsToGuild(guildId, input.channelId, botId);

    return res.status(201).json({
      account: await createXAccount(guildId, {
        ...input,
        botId,
        userId: user.discordId
      })
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.patch("/:guildId/accounts/:accountId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const accountId = getRequiredParam(req.params.accountId, "accountId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;
    const input = accountUpdateSchema.parse(req.body);

    await assertCanManageXMonitor(req, guildId, botId, "editar contas do X");

    if (input.channelId) {
      await assertChannelBelongsToGuild(guildId, input.channelId, botId);
    }

    return res.json({
      account: await updateXAccount(guildId, accountId, input, user.discordId, botId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

xMonitorRouter.delete("/:guildId/accounts/:accountId", requireAuth, async (req, res, next) => {
  try {
    const guildId = guildIdSchema.parse(req.params.guildId);
    const accountId = getRequiredParam(req.params.accountId, "accountId");
    const botId = await resolveRequestBotId(req);
    const user = res.locals.dashboardAuth.user as AuthSessionUser;

    await assertCanManageXMonitor(req, guildId, botId, "remover contas do X");

    return res.json({
      account: await deleteXAccount(guildId, accountId, user.discordId, botId)
    });
  } catch (error) {
    return handleRouteError(error, res, next);
  }
});

async function assertCanManageXMonitor(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canUseDevBotModule(user, botId, guildId, "x-monitor")) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError(`Voce nao tem permissao para ${action} neste servidor.`, 403);
  }
}

async function assertCanReadXMonitor(req: Request, guildId: string, botId: string | null, action: string) {
  const user = req.res?.locals.dashboardAuth.user as AuthSessionUser;

  if (botId ? !(await canReadDevBotModule(user, botId, guildId, "x-monitor")) : !canManageDashboardGuild(user, guildId)) {
    throw createServiceError(`Voce nao tem permissao para ${action} neste servidor.`, 403);
  }
}

async function assertChannelBelongsToGuild(guildId: string, channelId: string, botId: string | null) {
  const validChannel = await isGuildTextChannel(guildId, channelId, await getDevBotToken(botId));

  if (!validChannel) {
    throw createServiceError("Selecione um canal de texto que pertence ao servidor configurado.", 400);
  }
}

function getRequiredParam(value: string | undefined, name: string) {
  if (!value) {
    throw createServiceError(`${name} obrigatorio.`, 400);
  }

  return value;
}

function handleRouteError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => unknown } }, next: (error: unknown) => unknown) {
  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : null;

  if (statusCode) {
    return res.status(statusCode).json({
      message: error instanceof Error ? error.message : "Erro inesperado."
    });
  }

  return next(error);
}
