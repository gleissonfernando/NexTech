import { env } from "../config/env";
import { isDashboardDevUserId } from "../config/devOwner";
import type { AuthSessionUser } from "../types/session";
import { scanAccessibleDevBots } from "./devBotService";

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
        botId: "",
        botName: "Painel",
        configuredRoleCount: 0,
        guildId: "",
        guildName: "Servidor",
        matchedRoleCount: 0,
        reason: "A validacao de cargos demorou demais para responder. Tente novamente em alguns segundos."
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
    enabledModules: bot.enabledModules
  }));
  const checksByGuildId = new Map(baseChecks.map((check) => [check.guildId, check]));

  for (const bot of accessibleBots) {
    for (const guildId of bot.guildIds) {
      const current = checksByGuildId.get(guildId);

      checksByGuildId.set(guildId, {
        guildId,
        guildName: current?.guildName ?? (guildId === bot.mainGuildId ? bot.mainGuildName : `Servidor ${guildId}`),
        administrator: current?.administrator ?? false,
        owner: current?.owner ?? false,
        administratorRole: false,
        configuredPanelRole: true
      });
    }
  }

  const rejectionReasons = uniqueReasons(accessScan.diagnostics.filter((item) => !item.allowed).map((item) => item.reason));

  return createValidationResult(
    [...checksByGuildId.values()],
    authorizedUser,
    rejectionReasons.length ? rejectionReasons : ["Nenhuma dashboard com acesso por cargo foi encontrada para esta conta Discord."]
  );
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[access] validacao de cargos excedeu ${timeoutMs}ms.`);
      resolve(fallback);
    }, timeoutMs);

    void promise
      .then(resolve)
      .catch((error) => {
        console.warn("[access] nao foi possivel validar cargos do painel:", error instanceof Error ? error.message : error);
        resolve(fallback);
      })
      .finally(() => clearTimeout(timeout));
  });
}

function createValidationResult(
  checks: GuildAccessCheck[],
  authorizedUser: boolean,
  rejectionReasons: string[] = []
): AccessValidationResult {
  const canManageDashboard = authorizedUser || checks.some(guildCheckGrantsDashboardAccess);

  return {
    allowed: canManageDashboard,
    mode: env.DASHBOARD_VERIFICATION_MODE,
    temporaryAccess: false,
    accessLevel: canManageDashboard ? "admin" : "viewer",
    authorizedUser,
    canManageDashboard,
    checks,
    rejectionReasons: canManageDashboard ? [] : rejectionReasons
  };
}

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))].slice(0, 4);
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
