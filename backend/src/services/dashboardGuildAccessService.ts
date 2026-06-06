import type { AuthSessionUser } from "../types/session";

export function getAccessibleGuildIds(user: AuthSessionUser) {
  return new Set(user.guilds.filter((guild) => guild.botEnabled).map((guild) => guild.id));
}

export function canReadDashboardGuild(user: AuthSessionUser, guildId: string) {
  return getAccessibleGuildIds(user).has(guildId);
}

export function canManageDashboardGuild(user: AuthSessionUser, guildId: string) {
  const guild = user.guilds.find((item) => item.id === guildId);

  if (!guild?.botEnabled) {
    return false;
  }

  return user.authorized || guild.owner || guild.isAdmin;
}
