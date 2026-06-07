import { env } from "../config/env";
import { isDashboardDevUserId } from "../config/devOwner";
import type { AuthSessionUser } from "../types/session";
import { listAccessibleDashboardBots } from "./devBotService";

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

const BOT_ACCESS_TIMEOUT_MS = 6000;

export async function evaluateDashboardAccess(user: AuthSessionUser): Promise<AccessValidationResult> {
  const baseChecks = user.guilds.map((guild) => ({
    guildId: guild.id,
    guildName: guild.name,
    administrator: guild.isAdmin,
    owner: guild.owner,
    administratorRole: false,
    configuredPanelRole: false
  }));
  const authorizedUser = isDashboardDevUserId(user.discordId);

  if (authorizedUser) {
    return createValidationResult(baseChecks, true);
  }

  const accessibleBots = await withTimeout(
    listAccessibleDashboardBots(user),
    [],
    BOT_ACCESS_TIMEOUT_MS
  );
  const accessibleGuildIds = new Set(accessibleBots.flatMap((bot) => bot.guildIds));
  const checks = baseChecks.map((check) => ({
    ...check,
    configuredPanelRole: accessibleGuildIds.has(check.guildId)
  }));

  return createValidationResult(checks, authorizedUser);
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

function createValidationResult(checks: GuildAccessCheck[], authorizedUser: boolean): AccessValidationResult {
  const canManageDashboard = authorizedUser || checks.some(guildCheckGrantsDashboardAccess);

  return {
    allowed: canManageDashboard,
    mode: env.DASHBOARD_VERIFICATION_MODE,
    temporaryAccess: false,
    accessLevel: canManageDashboard ? "admin" : "viewer",
    authorizedUser,
    canManageDashboard,
    checks
  };
}

export function guildCheckGrantsDashboardAccess(check: GuildAccessCheck) {
  return check.configuredPanelRole;
}

export function applyDashboardAccessValidation(user: AuthSessionUser, validation: AccessValidationResult): AuthSessionUser {
  const manageableGuildIds = new Set(
    validation.checks
      .filter((check) => validation.authorizedUser || guildCheckGrantsDashboardAccess(check))
      .map((check) => check.guildId)
  );
  const selectedGuildId = user.selectedGuildId && manageableGuildIds.has(user.selectedGuildId)
    ? user.selectedGuildId
    : manageableGuildIds.values().next().value ?? null;

  return {
    ...user,
    accessLevel: validation.accessLevel,
    authorized: validation.authorizedUser,
    selectedGuildId,
    guilds: user.guilds
      .filter((guild) => manageableGuildIds.has(guild.id))
      .map((guild) => ({
        ...guild,
        isAdmin: validation.authorizedUser || manageableGuildIds.has(guild.id)
      }))
  };
}
