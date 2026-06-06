import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { issueLocalAccess } from "../services/localAccessService";
import { getBotStatus, refreshBotGuildsFromDiscord } from "../services/statsService";
import { resolveAuthFromRequest } from "../services/tokenService";

export function isBotRequest(req: Request) {
  const token = req.header("x-bot-token");
  return Boolean(env.BOT_API_TOKEN && token && token === env.BOT_API_TOKEN);
}

export async function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    const auth = await issueLocalAccess(req, res);
    res.locals.dashboardAuth = auth;
    return next();
  }

  await ensureBotGuildsLoaded();
  const auth = resolveAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({ message: "Sessao nao autenticada." });
  }

  req.session.user = auth.user;
  req.session.verified = auth.verified;
  res.locals.dashboardAuth = auth;
  return next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    const auth = await issueLocalAccess(req, res);
    res.locals.dashboardAuth = auth;
    return next();
  }

  await ensureBotGuildsLoaded();
  const auth = resolveAuthFromRequest(req, res);

  if (!auth) {
    return res.status(401).json({ message: "Sessao nao autenticada." });
  }

  if (!auth.verified) {
    return res.status(403).json({ message: "Verificacao obrigatoria para acessar o painel." });
  }

  req.session.user = auth.user;
  req.session.verified = auth.verified;
  res.locals.dashboardAuth = auth;
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
