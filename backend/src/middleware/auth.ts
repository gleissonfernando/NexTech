import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { isDashboardDevUserId } from "../config/devOwner";
import { recordAccessAttempt } from "../services/accessAuditService";
import { applyDashboardAccessValidation, createDeniedAccessUser, evaluateDashboardAccess } from "../services/accessControlService";
import { dashboardPermissionsForLevel } from "../services/dashboardPermissionService";
import { getBotStatus, refreshBotGuildsFromDiscord } from "../services/statsService";
import { clearAuthCookies, issueAuthCookies, resolveAuthFromRequest, type DashboardAuth } from "../services/tokenService";

const VERIFIED_ACCESS_RECHECK_MS = 3 * 1000;
export const ACCESS_DENIED_MESSAGE = "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte.";
export const SUPPORT_DISCORD_URL = "https://discord.gg/KAGgfuTcDS";
const AUTH_MIDDLEWARE_TIMEOUT_MS = 12_000;

export function isBotRequest(req: Request) {
  const token = req.header("bot-token") ?? req.header("x-bot-token");
  return Boolean(env.BOT_API_TOKEN && token && token === env.BOT_API_TOKEN);
}

export async function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  try {
    await withAuthMiddlewareTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    const auth = resolveAuthFromRequest(req, res);

    if (!auth) {
      return res.status(401).json({ message: "Sessão não autenticada." });
    }

    req.session.user = auth.user;
    if (auth.verified) {
      req.session.verified = true;
    }
    res.locals.dashboardAuth = auth;
    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    await withAuthMiddlewareTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    const auth = resolveAuthFromRequest(req, res);

    if (!auth) {
      await recordAccessAttempt(req, {
        result: "denied",
        reason: "Sessão não autenticada."
      });
      return res.status(401).json({ message: "Sessão não autenticada." });
    }

    const freshAuth = await ensureVerifiedRoleAccess(req, res, auth);

    if (!freshAuth) {
      await recordAccessAttempt(req, {
        userId: auth.user.discordId,
        username: auth.user.username,
        result: "denied",
        reason: ACCESS_DENIED_MESSAGE
      });
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE, supportUrl: SUPPORT_DISCORD_URL });
    }

    if (!freshAuth.verified) {
      await recordAccessAttempt(req, {
        userId: auth.user.discordId,
        username: auth.user.username,
        result: "denied",
        reason: "Verificação obrigatória para acessar o painel."
      });
      return res.status(403).json({ message: "Verificação obrigatória para acessar o painel." });
    }

    req.session.user = freshAuth.user;
    req.session.verified = freshAuth.verified;
    res.locals.dashboardAuth = freshAuth;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireBot(req: Request, res: Response, next: NextFunction) {
  if (isBotRequest(req)) {
    return next();
  }

  return res.status(401).json({ message: "Token do bot inválido." });
}

export function requireAdminAccess(_req: Request, res: Response, next: NextFunction) {
  const accessLevel = res.locals.dashboardAuth?.user?.accessLevel ?? "viewer";

  if (dashboardPermissionsForLevel(accessLevel).canManageGlobalSettings) {
    return next();
  }

  return res.status(403).json({ message: "Acesso administrativo necessário para esta ação." });
}

export function requireAuthOrBot(req: Request, res: Response, next: NextFunction) {
  if (isBotRequest(req)) {
    return next();
  }

  return requireAuth(req, res, next);
}

async function ensureBotGuildsLoaded() {
  if (getBotStatus().botGuilds.length === 0) {
    await refreshBotGuildsFromDiscord();
  }
}

async function ensureVerifiedRoleAccess(req: Request, res: Response, auth: DashboardAuth) {
  const lastValidation = typeof req.session.accessValidatedAt === "number" ? req.session.accessValidatedAt : 0;

  if (isDashboardDevUserId(auth.user.discordId)) {
    const freshAuth = auth.verified && auth.user.authorized === true && auth.user.accessLevel === "admin"
      ? auth
      : issueAuthCookies(res, {
          ...auth.user,
          accessLevel: "admin",
          authorized: true
        }, true);
    req.session.user = freshAuth.user;
    req.session.verified = true;
    req.session.accessValidatedAt = Date.now();
    return freshAuth;
  }

  if (auth.verified && Date.now() - lastValidation < VERIFIED_ACCESS_RECHECK_MS) {
    return auth;
  }

  const validation = await withAuthMiddlewareTimeout("dashboard_access_recheck", evaluateDashboardAccess(auth.user, {
    botSlug: auth.user.dashboardBotSlug ?? null,
    discordAccessToken: req.session.discordAccessToken ?? null,
    discordRefreshToken: null,
    onDiscordTokensRefreshed: (tokens) => {
      req.session.discordAccessToken = tokens.accessToken;
      req.session.discordRefreshToken = undefined;
    }
  }));

  if (!validation.allowed) {
    const deniedUser = createDeniedAccessUser(auth.user);
    clearAuthCookies(res);
    req.session.user = deniedUser;
    req.session.verified = false;
    req.session.accessValidatedAt = Date.now();
    return null;
  }

  const validatedUser = applyDashboardAccessValidation(auth.user, validation);
  const freshAuth = issueAuthCookies(res, validatedUser, true);
  req.session.user = freshAuth.user;
  req.session.verified = freshAuth.verified;
  req.session.accessValidatedAt = Date.now();

  return freshAuth;
}

function withAuthMiddlewareTimeout<T>(stage: string, promise: Promise<T>, timeoutMs = AUTH_MIDDLEWARE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn(`[auth] middleware excedeu timeout na etapa ${stage}.`);
      reject(Object.assign(new Error(`Timeout na autenticacao: ${stage}.`), { statusCode: 504 }));
    }, timeoutMs);

    void promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}
