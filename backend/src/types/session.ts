import type { DashboardGuild } from "../services/guildService";

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
  accessLevel: "admin" | "viewer";
  authorized: boolean;
  lastLoginAt: string;
};

declare module "express-session" {
  interface SessionData {
    user?: AuthSessionUser;
    verified?: boolean;
    accessValidatedAt?: number;
    oauthState?: string;
    discordAccessToken?: string;
    discordRefreshToken?: string;
  }
}
