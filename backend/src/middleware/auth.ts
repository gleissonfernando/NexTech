import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { createPublicDashboardUser } from "../services/publicAuthService";

export function isBotRequest(req: Request) {
  const token = req.header("x-bot-token");
  return Boolean(env.BOT_API_TOKEN && token && token === env.BOT_API_TOKEN);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    req.session.user ??= createPublicDashboardUser();
    return next();
  }

  if (req.session.user) {
    return next();
  }

  return res.status(401).json({ message: "Sessao nao autenticada." });
}

export function requireBot(req: Request, res: Response, next: NextFunction) {
  if (isBotRequest(req)) {
    return next();
  }

  return res.status(401).json({ message: "Token do bot invalido." });
}

export function requireAuthOrBot(req: Request, res: Response, next: NextFunction) {
  if (!env.DASHBOARD_AUTH_REQUIRED) {
    req.session.user ??= createPublicDashboardUser();
    return next();
  }

  if (req.session.user || isBotRequest(req)) {
    return next();
  }

  return res.status(401).json({ message: "Autenticacao obrigatoria." });
}
