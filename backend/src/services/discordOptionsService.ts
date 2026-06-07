import { env } from "../config/env";

type DiscordChannel = {
  id: string;
  guild_id?: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position?: number;
};

type DiscordRole = {
  id: string;
  name: string;
  color: number;
  managed: boolean;
  permissions: string;
  position: number;
};

type DiscordBotUser = {
  id: string;
};

type DiscordGuildMember = {
  roles: string[];
};

export type GuildChannelOptionDto = {
  id: string;
  name: string;
  parentId: string | null;
  type: "text" | "announcement";
};

export type GuildRoleOptionDto = {
  assignable: boolean;
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildLiveOptionsDto = {
  channels: GuildChannelOptionDto[];
  roles: GuildRoleOptionDto[];
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const ADMINISTRATOR = 0x8n;
const MANAGE_ROLES = 0x10000000n;

export async function getGuildLiveOptions(guildId: string, botToken?: string | null): Promise<GuildLiveOptionsDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return {
      channels: [],
      roles: [createEveryoneRole(guildId)]
    };
  }

  const [channels, roles] = await Promise.all([
    discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`, token),
    getGuildRoleOptions(guildId, token)
  ]);

  return {
    channels: channels
      .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentId: channel.parent_id ?? null,
        type: channel.type === 5 ? "announcement" : "text"
      })),
    roles
  };
}

export async function getGuildRoleOptions(guildId: string, botToken?: string | null): Promise<GuildRoleOptionDto[]> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return [createEveryoneRole(guildId)];
  }

  const bot = await discordFetch<DiscordBotUser>("/users/@me", token);
  const [roles, botMember] = await Promise.all([
    discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token),
    discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${bot.id}`, token)
  ]);
  const botRoleIds = new Set([guildId, ...botMember.roles]);
  const botRoles = roles.filter((role) => botRoleIds.has(role.id));
  const highestBotRolePosition = Math.max(0, ...botRoles.map((role) => role.position));
  const botPermissions = botRoles.reduce((permissions, role) => permissions | parsePermissions(role.permissions), 0n);
  const canManageRoles =
    (botPermissions & ADMINISTRATOR) === ADMINISTRATOR
    || (botPermissions & MANAGE_ROLES) === MANAGE_ROLES;

  return [
    createEveryoneRole(guildId),
    ...roles
      .filter((role) => role.id !== guildId && !role.managed)
      .sort((left, right) => right.position - left.position)
      .map((role) => ({
        assignable: canManageRoles && role.position < highestBotRolePosition,
        id: role.id,
        name: role.name,
        color: role.color,
        managed: role.managed
      }))
  ];
}

export async function isGuildTextChannel(guildId: string, channelId: string, botToken?: string | null) {
  return isGuildChannelType(guildId, channelId, TEXT_CHANNEL_TYPES, botToken);
}

export async function isGuildCategoryChannel(guildId: string, channelId: string, botToken?: string | null) {
  return isGuildChannelType(guildId, channelId, new Set([4]), botToken);
}

export async function areGuildRoles(guildId: string, roleIds: string[], botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return false;
  }

  try {
    const roles = await discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token);
    const availableRoleIds = new Set(roles.map((role) => role.id));
    availableRoleIds.add(guildId);
    return roleIds.every((roleId) => availableRoleIds.has(roleId));
  } catch {
    return false;
  }
}

export async function areGuildAssignableRoles(guildId: string, roleIds: string[], botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token || !roleIds.length) {
    return false;
  }

  try {
    const roles = await getGuildRoleOptions(guildId, token);
    const assignableRoleIds = new Set(
      roles
        .filter((role) => role.assignable)
        .map((role) => role.id)
    );

    return roleIds.every((roleId) => assignableRoleIds.has(roleId));
  } catch {
    return false;
  }
}

export async function userHasAnyGuildRole(guildId: string, userId: string, roleIds: string[], botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;
  const normalizedRoleIds = roleIds.map((roleId) => roleId.trim()).filter(Boolean);

  if (!token || !normalizedRoleIds.length) {
    return false;
  }

  try {
    const member = await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`, token);
    const memberRoleIds = new Set([guildId, ...member.roles]);
    return normalizedRoleIds.some((roleId) => memberRoleIds.has(roleId));
  } catch {
    return false;
  }
}

async function isGuildChannelType(
  guildId: string,
  channelId: string,
  allowedTypes: Set<number>,
  botToken?: string | null
) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return false;
  }

  try {
    const channel = await discordFetch<DiscordChannel>(`/channels/${channelId}`, token);
    return channel.guild_id === guildId && allowedTypes.has(channel.type);
  } catch {
    return false;
  }
}

function createEveryoneRole(guildId: string): GuildRoleOptionDto {
  return {
    assignable: false,
    id: guildId,
    name: "@everyone",
    color: 0,
    managed: false
  };
}

function parsePermissions(value: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

async function discordFetch<TResponse>(path: string, token: string) {
  const response = await fetch(`${DISCORD_API_URL}${path}`, {
    headers: {
      Authorization: `Bot ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord API respondeu ${response.status} em ${path}.`);
  }

  return (await response.json()) as TResponse;
}
