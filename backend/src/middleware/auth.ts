import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { isDashboardDevUserId } from "../config/devOwner";
import { recordAccessAttempt } from "../services/accessAuditService";
import { applyDashboardAccessValidation, createDeniedAccessUser, evaluateDashboardAccess } from "../services/accessControlService";
import { dashboardPermissionsForLevel } from "../services/dashboardPermissionService";
import { getBotStatus, refreshBotGuildsFromDiscord } from "../services/statsService";
import { clearAuthCookies, issueAuthCookies, resolveAuthFromRequest, type DashboardAuth } from "../services/tokenService";
import { getUserDashboardSessionState, touchDashboardSession } from "../services/userService";

const VERIFIED_ACCESS_RECHECK_MS = 3 * 1000;
export const ACCESS_DENIED_MESSAGE = [
  "Não foi encontrada nenhuma permissão para esta Dashboard.",
  "",
  "Verificações realizadas:",
  "✔ Cadastro",
  "✔ Servidor",
  "✔ Bot",
  "✔ Permissões",
  "✔ Lista de acesso",
  "",
  "Caso acredite que isso seja um erro, entre em contato com o proprietário da Dashboard."
].join("\n");
export const NO_BOT_ACCESS_MESSAGE = "Você não possui nenhum bot cadastrado na plataforma. Cadastre um bot para utilizar o Dashboard.";
export const SUPPORT_DISCORD_URL = "https://discord.gg/7WYzSwVBPm";
const AUTH_MIDDLEWARE_TIMEOUT_MS = 12_000;
const SESSION_TOUCH_INTERVAL_MS = 15_000;
const AUTH_SESSION_EXPIRED_MESSAGE = "Sessão expirada. Faça login novamente pelo Discord.";

type AuthFailureCode =
  | "BOT_TOKEN_INVALID"
  | "DASHBOARD_ACCESS_DENIED"
  | "INSUFFICIENT_PERMISSION"
  | "SESSION_EXPIRED"
  | "SESSION_MISSING"
  | "VERIFICATION_REQUIRED";

export function isBotRequest(req: Request) {
  const token = req.header("bot-token") ?? req.header("x-bot-token");
  return Boolean(env.BOT_API_TOKEN && token && token === env.BOT_API_TOKEN);
}

export async function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  try {
    await withAuthMiddlewareTimeout("bot_guilds_refresh", ensureBotGuildsLoaded());
    const auth = resolveAuthFromRequest(req, res);

    if (!auth) {
      logAuthFailure(req, 401, "SESSION_MISSING");
      return sendAuthFailure(res, 401, "SESSION_MISSING", "Sessão não autenticada.");
    }

    const activeAuth = await validateResolvedDashboardAuth(req, res, auth);

    if (!activeAuth) {
      logAuthFailure(req, 401, "SESSION_EXPIRED", auth.user.discordId);
      return sendAuthFailure(res, 401, "SESSION_EXPIRED", AUTH_SESSION_EXPIRED_MESSAGE);
    }

    req.session.user = activeAuth.user;
    req.session.oauth2VerifiedAt ??= new Date().toISOString();
    if (activeAuth.verified) {
      req.session.verified = true;
    }
    res.locals.dashboardAuth = activeAuth;
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
      logAuthFailure(req, 401, "SESSION_MISSING");
      return sendAuthFailure(res, 401, "SESSION_MISSING", "Sessão não autenticada.");
    }

    const activeAuth = await validateResolvedDashboardAuth(req, res, auth, { requireDashboardScope: true });

    if (!activeAuth) {
      await recordAccessAttempt(req, {
        userId: auth.user.discordId,
        username: auth.user.username,
        result: "denied",
        reason: "Sessão expirada ou invalidada."
      });
      logAuthFailure(req, 401, "SESSION_EXPIRED", auth.user.discordId);
      return sendAuthFailure(res, 401, "SESSION_EXPIRED", AUTH_SESSION_EXPIRED_MESSAGE);
    }

    const freshAuth = await ensureVerifiedRoleAccess(req, res, activeAuth);

    if (!freshAuth) {
      await recordAccessAttempt(req, {
        userId: activeAuth.user.discordId,
        username: activeAuth.user.username,
        result: "denied",
        reason: NO_BOT_ACCESS_MESSAGE
      });
      logAuthFailure(req, 403, "DASHBOARD_ACCESS_DENIED", activeAuth.user.discordId);
      return sendAuthFailure(res, 403, "DASHBOARD_ACCESS_DENIED", NO_BOT_ACCESS_MESSAGE, {
        supportUrl: SUPPORT_DISCORD_URL
      });
    }

    if (!freshAuth.verified) {
      await recordAccessAttempt(req, {
        userId: activeAuth.user.discordId,
        username: activeAuth.user.username,
        result: "denied",
        reason: "Verificação obrigatória para acessar o painel."
      });
      logAuthFailure(req, 403, "VERIFICATION_REQUIRED", activeAuth.user.discordId);
      return sendAuthFailure(res, 403, "VERIFICATION_REQUIRED", "Verificação obrigatória para acessar o painel.");
    }

    req.session.user = freshAuth.user;
    req.session.verified = freshAuth.verified;
    req.session.oauth2VerifiedAt ??= new Date().toISOString();
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

  return sendAuthFailure(res, 401, "BOT_TOKEN_INVALID", "Token do bot inválido.");
}

export function requireAdminAccess(_req: Request, res: Response, next: NextFunction) {
  const accessLevel = res.locals.dashboardAuth?.user?.accessLevel ?? "viewer";

  if (dashboardPermissionsForLevel(accessLevel).canManageGlobalSettings) {
    return next();
  }

  return sendAuthFailure(res, 403, "INSUFFICIENT_PERMISSION", "Acesso administrativo necessário para esta ação.");
}

export function requireAuthOrBot(req: Request, res: Response, next: NextFunction) {
  if (isBotRequest(req)) {
    return next();
  }

  return requireAuth(req, res, next);
}

function sendAuthFailure(res: Response, status: number, code: AuthFailureCode, message: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...extra
  });
}

function logAuthFailure(req: Request, status: number, code: AuthFailureCode, discordId?: string | null) {
  const sessionId = req.sessionID ? maskIdentifier(req.sessionID) : null;
  console.warn("[AUTH DEBUG]", {
    code,
    discordId: discordId ? maskIdentifier(discordId) : null,
    hasCookie: Boolean(req.headers.cookie),
    hasDiscordAccessToken: Boolean(req.session.discordAccessToken),
    hasDiscordRefreshToken: Boolean(req.session.discordRefreshToken),
    method: req.method,
    path: req.originalUrl || req.url,
    sessionId,
    status
  });
}

function maskIdentifier(value: string) {
  if (value.length <= 8) {
    return "***";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function ensureBotGuildsLoaded() {
  if (getBotStatus().botGuilds.length === 0) {
    await refreshBotGuildsFromDiscord();
  }
}

export async function validateResolvedDashboardAuth(
  req: Request,
  res: Response,
  auth: DashboardAuth,
  options: { requireDashboardScope?: boolean } = {}
) {
  const sessionId = auth.user.sessionId;
  const sessionVersion = auth.user.sessionVersion;

  if (!sessionId || typeof sessionVersion !== "number") {
    logAuthFailure(req, 401, "SESSION_EXPIRED", auth.user.discordId);
    clearDashboardSession(req, res);
    return null;
  }

  const state = await withAuthMiddlewareTimeout("dashboard_session_state", getUserDashboardSessionState(auth.user.discordId));

  if (
    !state ||
    state.activeSessionStatus !== "active" ||
    state.activeSessionId !== sessionId ||
    (state.activeSessionExpiresAt instanceof Date && state.activeSessionExpiresAt.getTime() <= Date.now()) ||
    state.authSessionVersion !== sessionVersion ||
    (options.requireDashboardScope && state.activeSessionScope !== "dashboard")
  ) {
    logAuthFailure(req, 401, "SESSION_EXPIRED", auth.user.discordId);
    clearDashboardSession(req, res);
    return null;
  }

  const now = Date.now();
  if (now - (req.session.dashboardSessionTouchedAt ?? 0) > SESSION_TOUCH_INTERVAL_MS) {
    req.session.dashboardSessionTouchedAt = now;
    void touchDashboardSession(auth.user.discordId, sessionId).catch((error) => {
      console.warn("[auth] não foi possível atualizar lastAccess da sessão:", error instanceof Error ? error.message : error);
    });
  }

  const nextUser = {
    ...auth.user,
    sessionLastAccessAt: new Date(now).toISOString()
  };
  const freshAuth = issueAuthCookies(res, nextUser, auth.verified);
  req.session.user = freshAuth.user;
  req.session.verified = freshAuth.verified;

  return freshAuth;
}

function clearDashboardSession(req: Request, res: Response) {
  clearAuthCookies(res);
  req.session.user = undefined;
  req.session.verified = false;
  req.session.oauth2VerifiedAt = undefined;
  req.session.discordAccessToken = undefined;
  req.session.discordRefreshToken = undefined;
  req.session.accessValidatedAt = undefined;
  req.session.dashboardSessionTouchedAt = undefined;
}

async function ensureVerifiedRoleAccess(req: Request, res: Response, auth: DashboardAuth) {
  const lastValidation = typeof req.session.accessValidatedAt === "number" ? req.session.accessValidatedAt : 0;

  if (isDashboardDevUserId(auth.user.discordId)) {
    const freshAuth = auth.user.authorized === true && auth.user.accessLevel === "admin"
      ? auth
      : issueAuthCookies(res, {
          ...auth.user,
          accessLevel: "admin",
          authorized: true
        }, auth.verified);
    req.session.user = freshAuth.user;
    req.session.verified = freshAuth.verified;
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
  const freshAuth = issueAuthCookies(res, validatedUser, auth.verified);
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
