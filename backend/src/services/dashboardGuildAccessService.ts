import type { AuthSessionUser } from "../types/session";
import { canManageDashboardAccessLevel, dashboardPermissionsForLevel } from "./dashboardPermissionService";

export function getAccessibleGuildIds(user: AuthSessionUser) {
  if (!dashboardPermissionsForLevel(user.accessLevel).canAccessDashboard) {
    return new Set<string>();
  }

  return new Set(user.guilds.filter((guild) => guild.botEnabled).map((guild) => guild.id));
}

export function canReadDashboardGuild(user: AuthSessionUser, guildId: string) {
  return getAccessibleGuildIds(user).has(guildId);
}

export function canManageDashboardGuild(user: AuthSessionUser, guildId: string) {
  if (!canManageDashboardAccessLevel(user.accessLevel)) {
    return false;
  }

  const guild = user.guilds.find((item) => item.id === guildId);

  if (!guild?.botEnabled) {
    return false;
  }

  return guild.owner || guild.isAdmin;
}
