import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { applyDashboardAccessValidation, evaluateDashboardAccess } from "../services/accessControlService";
import { getBotStatus, refreshBotGuildsFromDiscord } from "../services/statsService";
import { clearAuthCookies, issueAuthCookies, resolveAuthFromRequest, type DashboardAuth } from "../services/tokenService";

const VERIFIED_ACCESS_RECHECK_MS = 30 * 1000;

export function isBotRequest(req: Request) {
  const token = req.header("x-bot-token");
  return Boolean(env.BOT_API_TOKEN && token && token === env.BOT_API_TOKEN);
}

export async function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  await ensureBotGuildsLoaded();
  const auth = resolveAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({ message: "Sessao nao autenticada." });
  }

  req.session.user = auth.user;
  if (auth.verified) {
    req.session.verified = true;
  }
  res.locals.dashboardAuth = auth;
  return next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  await ensureBotGuildsLoaded();
  const auth = resolveAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({ message: "Sessao nao autenticada." });
  }

  if (!auth.verified) {
    return res.status(403).json({ message: "Verificacao obrigatoria para acessar o painel." });
  }

  const freshAuth = await ensureVerifiedRoleAccess(req, res, auth);

  if (!freshAuth) {
    return res.status(403).json({ message: "Nenhum bot cadastrado liberou o cargo deste usuario para acessar o painel." });
  }

  if (freshAuth.user.accessLevel !== "admin") {
    return res.status(403).json({ message: "A verificacao de acesso deste usuario expirou. Verifique o cargo novamente." });
  }

  req.session.user = freshAuth.user;
  req.session.verified = freshAuth.verified;
  res.locals.dashboardAuth = freshAuth;
  return next();
}

export function requireBot(req: Request, res: Response, next: NextFunction) {
  if (isBotRequest(req)) {
    return next();
  }

  return res.status(401).json({ message: "Token do bot invalido." });
}

export function requireAdminAccess(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.dashboardAuth?.user?.accessLevel === "admin") {
    return next();
  }

  return res.status(403).json({ message: "Acesso administrativo necessario para esta acao." });
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

  if (Date.now() - lastValidation < VERIFIED_ACCESS_RECHECK_MS) {
    return auth;
  }

  const validation = await evaluateDashboardAccess(auth.user);
  const validatedUser = applyDashboardAccessValidation(auth.user, validation);

  if (!validation.allowed) {
    clearAuthCookies(res);
    req.session.user = validatedUser;
    req.session.verified = false;
    req.session.accessValidatedAt = Date.now();
    return null;
  }

  const freshAuth = issueAuthCookies(res, validatedUser, true);
  req.session.user = freshAuth.user;
  req.session.verified = freshAuth.verified;
  req.session.accessValidatedAt = Date.now();

  return freshAuth;
}
