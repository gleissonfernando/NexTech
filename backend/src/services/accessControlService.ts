import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";
import { getDiscordRoleAccess } from "./discordRoleAccessService";

export type GuildAccessCheck = {
  guildId: string;
  guildName: string;
  administrator: boolean;
  owner: boolean;
  administratorRole: boolean;
  configuredPanelRole: boolean;
};

export type AccessValidationResult = {
  allowed: boolean;
  mode: "temporary" | "roles";
  temporaryAccess: boolean;
  accessLevel: "admin" | "viewer";
  authorizedUser: boolean;
  canManageDashboard: boolean;
  checks: GuildAccessCheck[];
};

function getAuthorizedUserIds() {
  return new Set(
    env.DASHBOARD_AUTHORIZED_USER_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export async function evaluateDashboardAccess(user: AuthSessionUser): Promise<AccessValidationResult> {
  const checks = await Promise.all(
    user.guilds.map(async (guild) => {
      const roleAccess =
        guild.owner || guild.isAdmin
          ? {
              administratorRole: false,
              configuredPanelRole: false
            }
          : await getDiscordRoleAccess(guild.id, user.discordId);

      return {
        guildId: guild.id,
        guildName: guild.name,
        administrator: guild.isAdmin || roleAccess.administratorRole,
        owner: guild.owner,
        administratorRole: roleAccess.administratorRole,
        configuredPanelRole: roleAccess.configuredPanelRole
      };
    })
  );
  const authorizedUser = getAuthorizedUserIds().has(user.discordId);
  const canManageDashboard = authorizedUser || checks.some((check) => check.administrator || check.owner || check.configuredPanelRole);

  if (env.DASHBOARD_VERIFICATION_MODE === "temporary") {
    return {
      allowed: true,
      mode: "temporary",
      temporaryAccess: true,
      accessLevel: canManageDashboard ? "admin" : "viewer",
      authorizedUser,
      canManageDashboard,
      checks
    };
  }

  return {
    allowed: true,
    mode: "roles",
    temporaryAccess: false,
    accessLevel: canManageDashboard ? "admin" : "viewer",
    authorizedUser,
    canManageDashboard,
    checks
  };
}
