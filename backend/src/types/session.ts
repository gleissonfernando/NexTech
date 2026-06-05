import type { DashboardGuild } from "../services/guildService";

export type AuthSessionUser = {
  id: string;
  discordId: string;
  username: string;
  tag: string;
  avatar: string | null;
  email: string | null;
  guilds: DashboardGuild[];
  accessLevel: "admin" | "viewer";
  authorized: boolean;
  lastLoginAt: string;
};

declare module "express-session" {
  interface SessionData {
    user?: AuthSessionUser;
    oauthState?: string;
  }
}
