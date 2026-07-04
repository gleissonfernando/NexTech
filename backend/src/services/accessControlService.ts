import { env } from "../config/env";
import type { AuthSessionUser } from "../types/session";
import {
  canManageDashboardAccessLevel,
  dashboardPermissionsForLevel,
  highestDashboardAccessLevel,
  type DashboardAccessLevel,
  type SessionAccessLevel
} from "./dashboardPermissionService";
import { scanAccessibleDevBots } from "./devBotService";
import { canAccessDevDashboard } from "./devPermissionService";
import { saveDiscordAccessSnapshot } from "./userService";

export type GuildAccessCheck = {
  guildId: string;
  guildName: string;
  administrator: boolean;
  owner: boolean;
  administratorRole: boolean;
  configuredPanelRole: boolean;
  accessLevel: DashboardAccessLevel | null;
  matchedRoleIds: string[];
  matchedUserIds: string[];
  requiredRoleIds: string[];
  requiredUserIds: string[];
};

export type AccessValidationResult = {
  allowed: boolean;
  mode: "temporary" | "roles";
  temporaryAccess: boolean;
  accessLevel: SessionAccessLevel;
  authorizedUser: boolean;
  canManageDashboard: boolean;
  checks: GuildAccessCheck[];
  rejectionReasons: string[];
};

export type DashboardAccessOptions = {
  botSlug?: string | null;
  discordAccessToken?: string | null;
  discordRefreshToken?: string | null;
  onDiscordTokensRefreshed?: (tokens: { accessToken: string; refreshToken: string | null }) => Promise<void> | void;
};

const BOT_ACCESS_TIMEOUT_MS = 12_000;

export async function evaluateDashboardAccess(
  user: AuthSessionUser,
  options: DashboardAccessOptions = {}
): Promise<AccessValidationResult> {
  const baseChecks: GuildAccessCheck[] = user.guilds.map((guild) => ({
    guildId: guild.id,
    guildName: guild.name,
    administrator: guild.isAdmin,
    owner: guild.owner,
    administratorRole: false,
    configuredPanelRole: false,
    accessLevel: null,
    matchedRoleIds: [],
    matchedUserIds: [],
    requiredRoleIds: [],
    requiredUserIds: []
  }));
  const authorizedUser = await canAccessDevDashboard(user.discordId);

  if (authorizedUser) {
    const validation = createValidationResult(baseChecks, true, [], "admin");
    await persistAccessSnapshot(user.discordId, validation, accessScanRoleSnapshot([]));
    return validation;
  }

  const accessScan = await withTimeout(
    scanAccessibleDevBots(user, {
      botSlug: options.botSlug,
      discordAccessToken: options.discordAccessToken,
      discordRefreshToken: options.discordRefreshToken,
      onDiscordTokensRefreshed: options.onDiscordTokensRefreshed
    }),
    {
      accessibleBots: [],
      diagnostics: [{
        allowed: false,
        accessLevel: null,
        botId: "",
        botName: "Painel",
        configuredRoleCount: 0,
        configuredUserCount: 0,
        guildId: "",
        guildName: "Servidor",
        matchedRoleIds: [],
        matchedUserIds: [],
        matchedRoleCount: 0,
        memberRoleIds: [],
        reason: "A validacao de usuarios liberados demorou demais para responder. Tente novamente em alguns segundos.",
        requiredRoleIds: [],
        requiredUserIds: []
      }]
    },
    BOT_ACCESS_TIMEOUT_MS
  );
  const accessibleBots = accessScan.accessibleBots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    slug: bot.slug,
    dashboardUrl: bot.dashboardUrl,
    clientId: bot.clientId,
    avatarUrl: bot.avatarUrl,
    mainGuildId: bot.mainGuildId,
    mainGuildName: bot.mainGuildName,
    mainGuildIconUrl: bot.mainGuildIconUrl,
    mainGuildMemberCount: bot.mainGuildMemberCount,
    mainGuildChannelCount: bot.mainGuildChannelCount,
    botCreatedAt: bot.botCreatedAt,
    guildIds: bot.guildIds,
    status: bot.status,
    statusMessage: bot.statusMessage,
    enabledModules: bot.enabledModules,
    accessLevel: bot.accessLevel,
    permissions: bot.permissions
  }));
  const checksByGuildId = new Map(baseChecks.map((check) => [check.guildId, check]));
  const roleSnapshot = accessScanRoleSnapshot(accessScan.diagnostics);

  for (const bot of accessibleBots) {
    for (const guildId of bot.guildIds) {
      const current = checksByGuildId.get(guildId);
      const diagnostic = accessScan.diagnostics.find((item) => item.allowed && item.botId === bot.id && item.guildId === guildId);

      checksByGuildId.set(guildId, {
        guildId,
        guildName: current?.guildName ?? (guildId === bot.mainGuildId ? bot.mainGuildName : `Servidor ${guildId}`),
        administrator: current?.administrator ?? false,
        owner: current?.owner ?? false,
        administratorRole: false,
        configuredPanelRole: true,
        accessLevel: diagnostic?.accessLevel ?? bot.accessLevel,
        matchedRoleIds: diagnostic?.matchedRoleIds ?? [],
        matchedUserIds: diagnostic?.matchedUserIds ?? [],
        requiredRoleIds: diagnostic?.requiredRoleIds ?? [],
        requiredUserIds: diagnostic?.requiredUserIds ?? []
      });
    }
  }

  const rejectionReasons = uniqueReasons(accessScan.diagnostics.filter((item) => !item.allowed).map((item) => item.reason));
  const highestAccessLevel = highestDashboardAccessLevel(accessibleBots.map((bot) => bot.accessLevel));

  const validation = createValidationResult(
    [...checksByGuildId.values()],
    authorizedUser,
    rejectionReasons.length ? rejectionReasons : ["Nenhuma dashboard com usuario liberado foi encontrada para esta conta Discord."],
    highestAccessLevel
  );
  await persistAccessSnapshot(user.discordId, validation, roleSnapshot);
  return validation;
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[access] validacao de usuarios liberados excedeu ${timeoutMs}ms.`);
      resolve(fallback);
    }, timeoutMs);

    void promise
      .then(resolve)
      .catch((error) => {
        console.warn("[access] nao foi possivel validar usuarios liberados do painel:", error instanceof Error ? error.message : error);
        resolve(fallback);
      })
      .finally(() => clearTimeout(timeout));
  });
}

function createValidationResult(
  checks: GuildAccessCheck[],
  authorizedUser: boolean,
  rejectionReasons: string[] = [],
  accessLevel: DashboardAccessLevel | null = null
): AccessValidationResult {
  const resolvedAccessLevel: SessionAccessLevel = authorizedUser ? "admin" : accessLevel ?? "viewer";
  const permissions = dashboardPermissionsForLevel(resolvedAccessLevel);
  const canManageDashboard = authorizedUser || checks.some(guildCheckGrantsDashboardAccess);

  return {
    allowed: canManageDashboard,
    mode: env.DASHBOARD_VERIFICATION_MODE,
    temporaryAccess: false,
    accessLevel: canManageDashboard ? resolvedAccessLevel : "viewer",
    authorizedUser,
    canManageDashboard: canManageDashboard && (permissions.canManageDashboard || permissions.canManageOwnServices),
    checks,
    rejectionReasons: canManageDashboard ? [] : rejectionReasons
  };
}

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))].slice(0, 4);
}

export function guildCheckGrantsDashboardAccess(check: GuildAccessCheck) {
  return check.configuredPanelRole && Boolean(check.accessLevel);
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
        isAdmin: validation.authorizedUser || canManageDashboardAccessLevel(
          validation.checks.find((check) => check.guildId === guild.id)?.accessLevel ?? "viewer"
        )
      }))
  };
}

export function createDeniedAccessUser(user: AuthSessionUser): AuthSessionUser {
  const selectedGuildId = user.selectedGuildId && user.guilds.some((guild) => guild.id === user.selectedGuildId)
    ? user.selectedGuildId
    : user.guilds[0]?.id ?? null;

  return {
    ...user,
    accessLevel: "viewer",
    authorized: false,
    selectedGuildId
  };
}

function accessScanRoleSnapshot(diagnostics: Array<{
  guildId: string;
  memberRoleIds?: string[];
}>) {
  const roleIdsByGuild: Record<string, string[]> = {};

  for (const diagnostic of diagnostics) {
    if (diagnostic.guildId && diagnostic.memberRoleIds?.length) {
      roleIdsByGuild[diagnostic.guildId] = diagnostic.memberRoleIds;
    }
  }

  return roleIdsByGuild;
}

async function persistAccessSnapshot(
  discordId: string,
  validation: AccessValidationResult,
  roleIdsByGuild: Record<string, string[]>
) {
  await saveDiscordAccessSnapshot(discordId, {
    accessStatus: validation.allowed ? "allowed" : "denied",
    permissionLevel: validation.accessLevel,
    roleIdsByGuild
  });
}
