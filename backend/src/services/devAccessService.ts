import type { NextFunction, Request, Response } from "express";
import { isDashboardDevUserId } from "../config/devOwner";
import { requireAuth } from "../middleware/auth";
import type { AuthSessionUser } from "../types/session";
import type { DashboardAuth } from "./tokenService";

export function isDevUser(user: AuthSessionUser | null | undefined) {
  return isDashboardDevUserId(user?.discordId);
}

export async function canAccessDevPanel(user: AuthSessionUser | null | undefined) {
  return isDevUser(user);
}

export function requireDevAccess(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    const auth = res.locals.dashboardAuth as DashboardAuth | undefined;

    void (async () => {
      if (!(await canAccessDevPanel(auth?.user))) {
        return res.status(403).json({
          message: "Somente usuarios Dev podem cadastrar e gerenciar bots."
        });
      }

      return next();
    })().catch(next);
  });
}
