import { env } from "../config/env";
import { listGuildBotRuntimeConfigs } from "./devBotService";
import { getGuildSettings } from "./settingsService";

type DiscordGuildMember = {
  roles: string[];
};

export type DiscordRoleAccess = {
  administratorRole: boolean;
  configuredPanelRole: boolean;
};

type RoleScope = {
  botId: string | null;
  token: string;
};

type ConfiguredRoleScope = RoleScope & {
  verificationRoleId: string;
};

type MemberRoleCacheEntry = {
  expiresAt: number;
  roleIds: string[];
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const DISCORD_MEMBER_TIMEOUT_MS = 2500;
const MEMBER_ROLE_CACHE_TTL_MS = 10 * 1000;

const noRoleAccess: DiscordRoleAccess = {
  administratorRole: false,
  configuredPanelRole: false
};
const memberRoleCache = new Map<string, MemberRoleCacheEntry>();

export async function getDiscordRoleAccess(guildId: string, userId: string): Promise<DiscordRoleAccess> {
  const configuredScopes = await listConfiguredRoleScopes(guildId);

  if (!configuredScopes.length) {
    return noRoleAccess;
  }

  const memberRoleIds = await getCachedMemberRoleIds(guildId, userId, configuredScopes);

  if (!memberRoleIds) {
    return noRoleAccess;
  }

  return {
    administratorRole: false,
    configuredPanelRole: configuredScopes.some((scope) => memberRoleIds.has(scope.verificationRoleId))
  };
}

async function listConfiguredRoleScopes(guildId: string) {
  const scopes = await listRoleScopes(guildId);

  if (!scopes.length) {
    return [];
  }

  const configuredScopes = await Promise.all(
    scopes.map(async (scope): Promise<ConfiguredRoleScope | null> => {
      try {
        const settings = await getGuildSettings(guildId, scope.botId);

        if (!settings.verificationEnabled || !settings.verificationRoleId) {
          return null;
        }

        return {
          ...scope,
          verificationRoleId: settings.verificationRoleId
        };
      } catch (error) {
        console.warn(
          `[discord] nao foi possivel carregar configuracao de acesso em ${guildId}:`,
          error instanceof Error ? error.message : error
        );

        return null;
      }
    })
  );

  return configuredScopes.filter((scope): scope is ConfiguredRoleScope => Boolean(scope));
}

async function listRoleScopes(guildId: string): Promise<RoleScope[]> {
  const customBots = await listGuildBotRuntimeConfigs(guildId).catch(() => []);
  const scopes: RoleScope[] = [];
  const legacyToken = env.DISCORD_BOT_TOKEN.trim();

  if (legacyToken) {
    scopes.push({
      botId: null,
      token: legacyToken
    });
  }

  for (const bot of customBots) {
    const token = bot.token.trim();

    if (token) {
      scopes.push({
        botId: bot.id,
        token
      });
    }
  }

  return scopes;
}

async function getCachedMemberRoleIds(guildId: string, userId: string, scopes: ConfiguredRoleScope[]) {
  const cacheKey = `${guildId}:${userId}`;
  const cached = memberRoleCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return new Set(cached.roleIds);
  }

  if (cached) {
    memberRoleCache.delete(cacheKey);
  }

  const roleIds = await fetchMemberRoleIdsFromAnyToken(guildId, userId, scopes);

  if (!roleIds) {
    return null;
  }

  memberRoleCache.set(cacheKey, {
    expiresAt: Date.now() + MEMBER_ROLE_CACHE_TTL_MS,
    roleIds: [...roleIds]
  });

  return roleIds;
}

async function fetchMemberRoleIdsFromAnyToken(guildId: string, userId: string, scopes: ConfiguredRoleScope[]) {
  const tokens = [...new Set(scopes.map((scope) => scope.token).filter(Boolean))];

  if (!tokens.length) {
    return null;
  }

  try {
    return await Promise.any(tokens.map((token) => fetchMemberRoleIds(guildId, userId, token)));
  } catch (error) {
    if (shouldLogDiscordRoleError(error)) {
      console.warn(
        `[discord] nao foi possivel validar cargo do painel em ${guildId}:`,
        formatDiscordRoleError(error)
      );
    }

    return null;
  }
}

async function fetchMemberRoleIds(guildId: string, userId: string, token: string) {
  const member = await discordFetch<DiscordGuildMember>(
    `/guilds/${guildId}/members/${userId}`,
    token,
    DISCORD_MEMBER_TIMEOUT_MS
  );
  const memberRoleIds = new Set(member.roles);
  memberRoleIds.add(guildId);

  return memberRoleIds;
}

function shouldLogDiscordRoleError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some(shouldLogDiscordRoleError);
  }

  if (error instanceof Error && /Discord API respondeu (403|404)/.test(error.message)) {
    return false;
  }

  return true;
}

function formatDiscordRoleError(error: unknown) {
  if (error instanceof AggregateError) {
    const firstError = error.errors.find((entry) => entry instanceof Error) as Error | undefined;
    return firstError?.message ?? "todas as tentativas falharam.";
  }

  return error instanceof Error ? error.message : error;
}

async function discordFetch<TResponse>(path: string, token: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${DISCORD_API_URL}${path}`, {
      headers: {
        Authorization: `Bot ${token}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Discord API respondeu ${response.status} em ${path}.`);
    }

    return (await response.json()) as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}
