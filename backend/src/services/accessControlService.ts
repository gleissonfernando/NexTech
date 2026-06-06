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

const ROLE_ACCESS_TIMEOUT_MS = 2500;

function getAuthorizedUserIds() {
  return new Set(
    env.DASHBOARD_AUTHORIZED_USER_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export async function evaluateDashboardAccess(user: AuthSessionUser): Promise<AccessValidationResult> {
  const baseChecks = user.guilds.map((guild) => ({
    guildId: guild.id,
    guildName: guild.name,
    administrator: guild.isAdmin,
    owner: guild.owner,
    administratorRole: false,
    configuredPanelRole: false
  }));
  const authorizedUser = getAuthorizedUserIds().has(user.discordId);
  const hasOAuthAdminAccess = baseChecks.some((check) => check.administrator || check.owner);

  if (env.DASHBOARD_VERIFICATION_MODE === "temporary" || authorizedUser || hasOAuthAdminAccess) {
    return createValidationResult(baseChecks, authorizedUser, env.DASHBOARD_VERIFICATION_MODE === "temporary");
  }

  const checks = await withTimeout(
    Promise.all(
      baseChecks.map(async (check) => {
        const roleAccess = await getDiscordRoleAccess(check.guildId, user.discordId);

        return {
          ...check,
          administrator: check.administrator || roleAccess.administratorRole,
          administratorRole: roleAccess.administratorRole,
          configuredPanelRole: roleAccess.configuredPanelRole
        };
      })
    ),
    baseChecks,
    ROLE_ACCESS_TIMEOUT_MS
  );

  return createValidationResult(checks, authorizedUser, false);
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), timeoutMs);

    void promise
      .then(resolve)
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timeout));
  });
}

function createValidationResult(checks: GuildAccessCheck[], authorizedUser: boolean, temporaryAccess: boolean): AccessValidationResult {
  const canManageDashboard = authorizedUser || checks.some((check) => check.administrator || check.owner || check.configuredPanelRole);

  return {
    allowed: true,
    mode: env.DASHBOARD_VERIFICATION_MODE,
    temporaryAccess,
    accessLevel: canManageDashboard ? "admin" : "viewer",
    authorizedUser,
    canManageDashboard,
    checks
  };
}
