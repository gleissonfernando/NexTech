import type { Request, Response } from "express";
import { demoGuilds } from "./guildService";
import { createAuthResponse, issueAuthCookies, type DashboardAuth } from "./tokenService";
import type { AuthSessionUser } from "../types/session";

export function createLocalDashboardUser(): AuthSessionUser {
  return {
    id: "local-admin",
    discordId: "000000000000000000",
    username: "Admin Local",
    tag: "local-admin",
    avatar: null,
    email: null,
    guilds: demoGuilds,
    accessLevel: "admin",
    authorized: true,
    lastLoginAt: new Date().toISOString()
  };
}

export async function issueLocalAccess(req: Request, res: Response): Promise<DashboardAuth> {
  const user = createLocalDashboardUser();
  const auth = issueAuthCookies(res, user, true);

  req.session.user = user;
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return auth;
}

export function createLocalAccessResponse(auth: DashboardAuth) {
  return createAuthResponse(auth);
}
