import { demoGuilds } from "./guildService";
import type { AuthSessionUser } from "../types/session";

export function createPublicDashboardUser(): AuthSessionUser {
  return {
    id: "public-admin",
    discordId: "000000000000000000",
    username: "Admin Local",
    avatar: null,
    email: null,
    guilds: demoGuilds
  };
}

export function createAuthResponse(user: AuthSessionUser) {
  return {
    user,
    guilds: user.guilds,
    permissions: {
      canManageGuilds: user.guilds.some((guild) => guild.isAdmin)
    }
  };
}
