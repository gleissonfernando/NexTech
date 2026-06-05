import { env } from "../config/env";
import { getGuildSettings } from "./settingsService";

type DiscordGuildMember = {
  roles: string[];
};

type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
};

export type DiscordRoleAccess = {
  administratorRole: boolean;
  configuredPanelRole: boolean;
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const ADMINISTRATOR = 0x8n;

const noRoleAccess: DiscordRoleAccess = {
  administratorRole: false,
  configuredPanelRole: false
};

export async function getDiscordRoleAccess(guildId: string, userId: string): Promise<DiscordRoleAccess> {
  if (!env.DISCORD_BOT_TOKEN) {
    return noRoleAccess;
  }

  try {
    const [member, roles, settings] = await Promise.all([
      discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`),
      discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`),
      getGuildSettings(guildId)
    ]);
    const memberRoleIds = new Set(member.roles);
    const configuredPanelRole = Boolean(
      settings.verificationEnabled &&
        settings.verificationRoleId &&
        memberRoleIds.has(settings.verificationRoleId)
    );
    const administratorRole = roles.some((role) => memberRoleIds.has(role.id) && hasAdministratorPermission(role.permissions));

    return {
      administratorRole,
      configuredPanelRole
    };
  } catch (error) {
    if (error instanceof Error && /Discord API respondeu (403|404)/.test(error.message)) {
      return noRoleAccess;
    }

    console.warn(`[discord] nao foi possivel validar cargos em ${guildId}:`, error instanceof Error ? error.message : error);
    return noRoleAccess;
  }
}

function hasAdministratorPermission(permissionsValue: string) {
  try {
    const permissions = BigInt(permissionsValue || "0");
    return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

async function discordFetch<TResponse>(path: string) {
  const response = await fetch(`${DISCORD_API_URL}${path}`, {
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord API respondeu ${response.status} em ${path}.`);
  }

  return (await response.json()) as TResponse;
}
