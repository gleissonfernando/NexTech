import type { DashboardGuild } from "../services/guildService";

export type AuthSessionUser = {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  email: string | null;
  guilds: DashboardGuild[];
};

declare module "express-session" {
  interface SessionData {
    user?: AuthSessionUser;
    oauthState?: string;
  }
}
