import type { Request, Response } from "express";
import { env } from "../config/env";
import { demoGuilds } from "./guildService";
import { createAuthResponse, issueAuthCookies, type DashboardAuth } from "./tokenService";
import type { AuthSessionUser } from "../types/session";
import { discordAvatarUrl, discordUserTag, fetchDiscordUserById } from "./discordOAuthService";

export async function createLocalDashboardUser(): Promise<AuthSessionUser> {
  const configuredDiscordId = getPrimaryAuthorizedDiscordId();
  const discordUser = configuredDiscordId ? await fetchDiscordUserById(configuredDiscordId) : null;

  return {
    id: discordUser?.id ?? "local-admin",
    discordId: configuredDiscordId ?? "000000000000000000",
    username: discordUser ? discordUser.global_name ?? discordUser.username : "Admin Local",
    tag: discordUser ? discordUserTag(discordUser) : "local-admin",
    avatar: discordUser ? discordAvatarUrl(discordUser) : null,
    email: null,
    guilds: demoGuilds,
    accessLevel: "admin",
    authorized: true,
    lastLoginAt: new Date().toISOString()
  };
}

export async function issueLocalAccess(req: Request, res: Response): Promise<DashboardAuth> {
  const user = await createLocalDashboardUser();
  const auth = issueAuthCookies(res, user, true);

  req.session.user = user;
  req.session.verified = true;
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

function getPrimaryAuthorizedDiscordId() {
  return (
    env.DASHBOARD_AUTHORIZED_USER_IDS.split(",")
      .map((id) => id.trim())
      .find(Boolean) ?? null
  );
}
