import type { DashboardGuild } from "../services/guildService";
import type { SessionAccessLevel } from "../services/dashboardPermissionService";

export type AuthSessionUser = {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  discriminator: string | null;
  tag: string;
  avatar: string | null;
  avatarUrl: string | null;
  email: string | null;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  dashboardBotId?: string | null;
  dashboardBotSlug?: string | null;
  accessLevel: SessionAccessLevel;
  authorized: boolean;
  lastLoginAt: string;
  sessionId?: string | null;
  sessionVersion?: number;
  sessionScope?: "dashboard" | "customer";
  sessionBotId?: string | null;
  sessionCreatedAt?: string | null;
  sessionLastAccessAt?: string | null;
  sessionExpiresAt?: string | null;
  sessionIp?: string | null;
  sessionUserAgent?: string | null;
};

declare module "express-session" {
  interface SessionData {
    user?: AuthSessionUser;
    verified?: boolean;
    oauth2VerifiedAt?: string;
    accessValidatedAt?: number;
    oauthState?: {
      botId?: string;
      botSlug?: string;
      expiresAt: number;
      returnTo: string;
      state: string;
      type: "dev" | "bot" | "dashboard" | "customer";
      ua?: string;
    };
    discordAccessToken?: string;
    discordRefreshToken?: string;
    dashboardSessionTouchedAt?: number;
    giveawayOAuth?: {
      codeVerifier?: string;
      platform: "twitch" | "kick";
      redirectPath: string;
      state: string;
      token: string;
    };
    giveawayPlatformAccounts?: {
      kick?: string;
      twitch?: string;
    };
  }
}
