import type { NextFunction, Request, Response } from "express";
import { evaluateDashboardAccess } from "../services/accessControlService";
import type { DashboardAuth } from "../services/tokenService";

const ACCESS_DENIED_MESSAGE = "Sem acesso ao painel. Se seu cargo foi liberado agora, saia e entre novamente pelo Discord.";

export async function requireDashboardAccessValidation(req: Request, res: Response, next: NextFunction) {
  const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

  if (!auth) {
    return res.status(401).json({
      message: "Sessao nao autenticada."
    });
  }

  const validation = await evaluateDashboardAccess(auth.user, {
    discordAccessToken: req.session.discordAccessToken ?? null,
    discordRefreshToken: req.session.discordRefreshToken ?? null,
    onDiscordTokensRefreshed: (tokens) => {
      req.session.discordAccessToken = tokens.accessToken;
      req.session.discordRefreshToken = tokens.refreshToken ?? req.session.discordRefreshToken;
    }
  });

  if (!validation.allowed) {
    return res.status(403).json({
      message: ACCESS_DENIED_MESSAGE,
      validation
    });
  }

  res.locals.accessValidation = validation;
  return next();
}
