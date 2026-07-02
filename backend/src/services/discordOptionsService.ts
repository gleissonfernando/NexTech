import { createHash } from "node:crypto";
import { env } from "../config/env";
import { getDiscordAvatarUrl } from "./discordAssetService";

type DiscordChannel = {
  id: string;
  guild_id?: string;
  name: string;
  permission_overwrites?: DiscordPermissionOverwrite[];
  type: number;
  parent_id?: string | null;
  position?: number;
};

type DiscordPermissionOverwrite = {
  allow: string;
  deny: string;
  id: string;
  type: number;
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

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string | null;
  avatar?: string | null;
  bot?: boolean;
};

type DiscordGuildMember = {
  avatar?: string | null;
  nick?: string | null;
  roles: string[];
  user?: DiscordUser;
};

export type GuildChannelOptionDto = {
  id: string;
  name: string;
  parentId: string | null;
  type: "text" | "announcement";
};

export type GuildVoiceChannelOptionDto = {
  id: string;
  name: string;
  parentId: string | null;
  type: "voice" | "stage";
};

export type GuildCategoryOptionDto = {
  id: string;
  name: string;
};

export type GuildRoleOptionDto = {
  assignable: boolean;
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildLiveOptionsDto = {
  categories: GuildCategoryOptionDto[];
  channels: GuildChannelOptionDto[];
  roles: GuildRoleOptionDto[];
  voiceChannels: GuildVoiceChannelOptionDto[];
};

export type DeleteGuildChannelsResultDto = {
  deleted: Array<{ id: string; name: string; type: "category" | "voice" | "stage" }>;
  failed: Array<{ id: string; name: string; reason: string; type: "category" | "voice" | "stage" }>;
};

export type GuildMemberOptionDto = {
  avatarUrl: string | null;
  bot: boolean;
  displayName: string;
  globalName: string | null;
  id: string;
  tag: string;
  username: string;
};

export type GuildPanelChannelValidationDto = {
  missingPermissions: string[];
  ok: boolean;
  reason: string | null;
};

export type GuildAssignableRoleValidationDto = {
  ok: boolean;
  reason: "bot_missing_manage_roles" | "role_above_bot" | "role_managed" | "role_not_found" | null;
  roleName: string | null;
};

const DISCORD_API_URL = "https://discord.com/api/v10";
const LIVE_OPTIONS_CACHE_TTL_MS = 60_000;
const LIVE_OPTIONS_STALE_TTL_MS = 15 * 60_000;
const MAX_DISCORD_RATE_LIMIT_RETRIES = 1;
const MAX_DISCORD_RETRY_DELAY_MS = 5_000;
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const VOICE_CHANNEL_TYPES = new Set([2, 13]);
const ADMINISTRATOR = 0x8n;
const MANAGE_ROLES = 0x10000000n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const USE_EXTERNAL_EMOJIS = 1n << 18n;
const PIN_MESSAGES = 1n << 51n;
const PANEL_CHANNEL_PERMISSIONS = [
  { bit: VIEW_CHANNEL, label: "View Channel" },
  { bit: SEND_MESSAGES, label: "Send Messages" },
  { bit: EMBED_LINKS, label: "Embed Links" },
  { bit: USE_EXTERNAL_EMOJIS, label: "Use External Emojis" },
  { bit: PIN_MESSAGES, label: "Pin Messages" }
] as const;

type GuildLiveOptionsCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  value: GuildLiveOptionsDto;
};

class DiscordApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "DiscordApiRequestError";
  }
}

const guildLiveOptionsCache = new Map<string, GuildLiveOptionsCacheEntry>();
const guildLiveOptionsRequests = new Map<string, Promise<GuildLiveOptionsDto>>();

export async function getGuildLiveOptions(
  guildId: string,
  botToken?: string | null,
  forceRefresh = false
): Promise<GuildLiveOptionsDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return {
      categories: [],
      channels: [],
      roles: [createEveryoneRole(guildId)],
      voiceChannels: []
    };
  }

  const cacheKey = createLiveOptionsCacheKey(guildId, token);
  const now = Date.now();
  const cached = guildLiveOptionsCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const activeRequest = guildLiveOptionsRequests.get(cacheKey);

  if (activeRequest) {
    return activeRequest;
  }

  const request = fetchGuildLiveOptions(guildId, token)
    .then((value) => {
      const cachedAt = Date.now();

      guildLiveOptionsCache.set(cacheKey, {
        expiresAt: cachedAt + LIVE_OPTIONS_CACHE_TTL_MS,
        staleUntil: cachedAt + LIVE_OPTIONS_STALE_TTL_MS,
        value
      });

      return value;
    })
    .catch((error) => {
      if (cached && cached.staleUntil > Date.now() && isTransientDiscordError(error)) {
        console.warn(`[discord:options] usando cache temporario para o servidor ${guildId}.`);
        return cached.value;
      }

      throw error;
    })
    .finally(() => {
      guildLiveOptionsRequests.delete(cacheKey);
    });

  guildLiveOptionsRequests.set(cacheKey, request);
  return request;
}

export async function deleteGuildVoiceChannelsAndCategories(
  guildId: string,
  channelIds: string[],
  botToken?: string | null
): Promise<DeleteGuildChannelsResultDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw new Error("Token do bot nao configurado.");
  }

  const requestedIds = [...new Set(channelIds)];
  const guildChannels = await discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`, token);
  const allowedChannels = new Map(
    guildChannels
      .filter((channel) => channel.type === 2 || channel.type === 4 || channel.type === 13)
      .map((channel) => [channel.id, channel] as const)
  );

  const invalidIds = requestedIds.filter((channelId) => !allowedChannels.has(channelId));
  if (invalidIds.length) {
    throw Object.assign(new Error("A selecao contem canais invalidos ou que nao pertencem a este servidor."), { statusCode: 400 });
  }

  const orderedChannels = requestedIds
    .map((channelId) => allowedChannels.get(channelId)!)
    .sort((left, right) => Number(left.type === 4) - Number(right.type === 4));
  const result: DeleteGuildChannelsResultDto = { deleted: [], failed: [] };

  for (const channel of orderedChannels) {
    const type = channel.type === 4 ? "category" : channel.type === 13 ? "stage" : "voice";
    try {
      await discordDelete(`/channels/${channel.id}`, token, "Removido pela dashboard");
      result.deleted.push({ id: channel.id, name: channel.name, type });
    } catch (error) {
      result.failed.push({
        id: channel.id,
        name: channel.name,
        reason: error instanceof Error ? error.message : "Falha desconhecida.",
        type
      });
    }
  }

  guildLiveOptionsCache.delete(createLiveOptionsCacheKey(guildId, token));
  return result;
}

async function fetchGuildLiveOptions(guildId: string, token: string): Promise<GuildLiveOptionsDto> {
  const [channels, roles] = await Promise.all([
    discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`, token),
    getGuildRoleOptions(guildId, token)
  ]);

  return {
    categories: channels
      .filter((channel) => channel.type === 4)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name
      })),
    channels: channels
      .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentId: channel.parent_id ?? null,
        type: channel.type === 5 ? "announcement" : "text"
      })),
    voiceChannels: channels
      .filter((channel) => VOICE_CHANNEL_TYPES.has(channel.type))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentId: channel.parent_id ?? null,
        type: channel.type === 13 ? "stage" : "voice"
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

export async function getGuildMemberOptions(
  guildId: string,
  query: string,
  botToken?: string | null
): Promise<GuildMemberOptionDto[]> {
  const token = botToken || env.DISCORD_BOT_TOKEN;
  const normalizedQuery = query.trim();

  if (!token || normalizedQuery.length < 2) {
    return [];
  }

  const membersById = new Map<string, GuildMemberOptionDto>();

  if (/^\d{5,32}$/.test(normalizedQuery)) {
    try {
      const member = await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${normalizedQuery}`, token);
      const option = toGuildMemberOption(member, guildId);

      if (option) {
        membersById.set(option.id, option);
      }
    } catch {
      // The search below may still find a member by username.
    }
  }

  try {
    const searchParams = new URLSearchParams({
      limit: "12",
      query: normalizedQuery
    });
    const members = await discordFetch<DiscordGuildMember[]>(
      `/guilds/${guildId}/members/search?${searchParams.toString()}`,
      token
    );

    for (const member of members) {
      const option = toGuildMemberOption(member, guildId);

      if (option) {
        membersById.set(option.id, option);
      }
    }
  } catch (error) {
    if (!membersById.size) {
      throw Object.assign(new Error("Nao foi possivel buscar membros neste servidor pelo Discord."), {
        cause: error,
        statusCode: 502
      });
    }
  }

  return [...membersById.values()]
    .filter((member) => !member.bot)
    .slice(0, 12);
}

export async function isGuildTextChannel(guildId: string, channelId: string, botToken?: string | null) {
  return isGuildChannelType(guildId, channelId, TEXT_CHANNEL_TYPES, botToken);
}

export async function isGuildVoiceChannel(guildId: string, channelId: string, botToken?: string | null) {
  return isGuildChannelType(guildId, channelId, VOICE_CHANNEL_TYPES, botToken);
}

export async function validateGuildPanelChannel(
  guildId: string,
  channelId: string,
  botToken?: string | null
): Promise<GuildPanelChannelValidationDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return {
      missingPermissions: [],
      ok: false,
      reason: "Token do bot nao configurado para validar o canal do painel."
    };
  }

  try {
    const [channel, bot, roles] = await Promise.all([
      discordFetch<DiscordChannel>(`/channels/${channelId}`, token),
      discordFetch<DiscordBotUser>("/users/@me", token),
      discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token)
    ]);

    if (channel.guild_id !== guildId || !TEXT_CHANNEL_TYPES.has(channel.type)) {
      return {
        missingPermissions: [],
        ok: false,
        reason: "O canal configurado nao existe neste servidor ou nao e um canal de texto."
      };
    }

    const botMember = await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${bot.id}`, token);
    const permissions = resolveChannelPermissions(guildId, bot.id, botMember.roles, roles, channel.permission_overwrites ?? []);

    if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
      return {
        missingPermissions: [],
        ok: true,
        reason: null
      };
    }

    const missingPermissions = PANEL_CHANNEL_PERMISSIONS
      .filter((permission) => (permissions & permission.bit) !== permission.bit)
      .map((permission) => permission.label);

    return {
      missingPermissions,
      ok: missingPermissions.length === 0,
      reason: missingPermissions.length
        ? `Bot sem permissao no canal do painel: ${missingPermissions.join(", ")}.`
        : null
    };
  } catch {
    return {
      missingPermissions: [],
      ok: false,
      reason: "Nao foi possivel validar o canal configurado no Discord."
    };
  }
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

export async function validateGuildAssignableRole(
  guildId: string,
  roleId: string,
  botToken?: string | null
): Promise<GuildAssignableRoleValidationDto> {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    return { ok: false, reason: "bot_missing_manage_roles", roleName: null };
  }

  const bot = await discordFetch<DiscordBotUser>("/users/@me", token);
  const [roles, botMember] = await Promise.all([
    discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`, token),
    discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${bot.id}`, token)
  ]);
  const role = roles.find((item) => item.id === roleId);

  if (!role || role.id === guildId) {
    return { ok: false, reason: "role_not_found", roleName: null };
  }

  if (role.managed) {
    return { ok: false, reason: "role_managed", roleName: role.name };
  }

  const botRoleIds = new Set([guildId, ...botMember.roles]);
  const botRoles = roles.filter((item) => botRoleIds.has(item.id));
  const highestBotRolePosition = Math.max(0, ...botRoles.map((item) => item.position));
  const botPermissions = botRoles.reduce((permissions, item) => permissions | parsePermissions(item.permissions), 0n);
  const canManageRoles = (botPermissions & ADMINISTRATOR) === ADMINISTRATOR
    || (botPermissions & MANAGE_ROLES) === MANAGE_ROLES;

  if (!canManageRoles) {
    return { ok: false, reason: "bot_missing_manage_roles", roleName: role.name };
  }

  if (role.position >= highestBotRolePosition) {
    return { ok: false, reason: "role_above_bot", roleName: role.name };
  }

  return { ok: true, reason: null, roleName: role.name };
}

export async function areGuildMembers(guildId: string, userIds: string[], botToken?: string | null) {
  const normalizedUserIds = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];

  if (!normalizedUserIds.length) {
    return true;
  }

  const checks = await Promise.all(
    normalizedUserIds.map((userId) => isGuildMember(guildId, userId, botToken))
  );

  return checks.every(Boolean);
}

export async function isGuildMember(guildId: string, userId: string, botToken?: string | null) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token || !/^\d{5,32}$/.test(userId.trim())) {
    return false;
  }

  try {
    await discordFetch<DiscordGuildMember>(`/guilds/${guildId}/members/${userId.trim()}`, token);
    return true;
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

function resolveChannelPermissions(
  guildId: string,
  botId: string,
  botRoleIds: string[],
  roles: DiscordRole[],
  overwrites: DiscordPermissionOverwrite[]
) {
  const roleIds = new Set([guildId, ...botRoleIds]);
  let permissions = roles
    .filter((role) => roleIds.has(role.id))
    .reduce((total, role) => total | parsePermissions(role.permissions), 0n);

  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
    return permissions;
  }

  permissions = applyPermissionOverwrite(
    permissions,
    overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0)
  );

  let roleAllow = 0n;
  let roleDeny = 0n;

  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !roleIds.has(overwrite.id) || overwrite.id === guildId) {
      continue;
    }

    roleAllow |= parsePermissions(overwrite.allow);
    roleDeny |= parsePermissions(overwrite.deny);
  }

  permissions = (permissions & ~roleDeny) | roleAllow;
  permissions = applyPermissionOverwrite(
    permissions,
    overwrites.find((overwrite) => overwrite.id === botId && overwrite.type === 1)
  );

  return permissions;
}

function applyPermissionOverwrite(permissions: bigint, overwrite?: DiscordPermissionOverwrite) {
  if (!overwrite) {
    return permissions;
  }

  return (permissions & ~parsePermissions(overwrite.deny)) | parsePermissions(overwrite.allow);
}

function toGuildMemberOption(member: DiscordGuildMember, guildId: string): GuildMemberOptionDto | null {
  const user = member.user;

  if (!user) {
    return null;
  }

  const displayName = member.nick?.trim() || user.global_name?.trim() || user.username;
  const tag = user.discriminator && user.discriminator !== "0"
    ? `${user.username}#${user.discriminator}`
    : `@${user.username}`;

  return {
    avatarUrl: getMemberAvatarUrl(guildId, user.id, member.avatar) ?? getDiscordAvatarUrl(user.id, user.avatar),
    bot: user.bot === true,
    displayName,
    globalName: user.global_name ?? null,
    id: user.id,
    tag,
    username: user.username
  };
}

function getMemberAvatarUrl(guildId: string, userId: string, avatar: string | null | undefined) {
  if (!avatar) {
    return null;
  }

  const extension = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatar}.${extension}?size=128`;
}

function createLiveOptionsCacheKey(guildId: string, token: string) {
  const tokenHash = createHash("sha256").update(token).digest("base64url").slice(0, 16);
  return `${guildId}:${tokenHash}`;
}

function isTransientDiscordError(error: unknown) {
  return error instanceof DiscordApiRequestError
    ? error.status === 429 || error.status >= 500
    : error instanceof TypeError;
}

async function discordFetch<TResponse>(path: string, token: string, attempt = 0): Promise<TResponse> {
  const response = await fetch(`${DISCORD_API_URL}${path}`, {
    headers: {
      Authorization: `Bot ${token}`
    }
  });

  if (response.status === 429) {
    const retryAfterMs = await readDiscordRetryAfterMs(response);

    if (attempt < MAX_DISCORD_RATE_LIMIT_RETRIES) {
      await wait(Math.min(retryAfterMs, MAX_DISCORD_RETRY_DELAY_MS));
      return discordFetch<TResponse>(path, token, attempt + 1);
    }

    throw new DiscordApiRequestError(
      "O Discord limitou temporariamente a consulta ao servidor. Aguarde alguns segundos e tente novamente.",
      response.status
    );
  }

  if (!response.ok) {
    throw new DiscordApiRequestError(`Discord API respondeu ${response.status} em ${path}.`, response.status);
  }

  return (await response.json()) as TResponse;
}

async function discordDelete(path: string, token: string, reason: string, attempt = 0): Promise<void> {
  const response = await fetch(`${DISCORD_API_URL}${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${token}`,
      "X-Audit-Log-Reason": encodeURIComponent(reason)
    }
  });

  if (response.status === 429 && attempt < MAX_DISCORD_RATE_LIMIT_RETRIES) {
    await wait(Math.min(await readDiscordRetryAfterMs(response), MAX_DISCORD_RETRY_DELAY_MS));
    return discordDelete(path, token, reason, attempt + 1);
  }

  if (!response.ok) {
    throw new DiscordApiRequestError(
      response.status === 403
        ? "O bot nao tem permissao para apagar este canal."
        : `Discord API respondeu ${response.status}.`,
      response.status
    );
  }
}

async function readDiscordRetryAfterMs(response: Response) {
  const headerValue = response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-after");
  const headerSeconds = headerValue ? Number(headerValue) : Number.NaN;

  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
    return Math.max(250, Math.ceil(headerSeconds * 1000));
  }

  try {
    const payload = await response.clone().json() as { retry_after?: unknown };
    const bodySeconds = Number(payload.retry_after);

    if (Number.isFinite(bodySeconds) && bodySeconds >= 0) {
      return Math.max(250, Math.ceil(bodySeconds * 1000));
    }
  } catch {
    // Discord may omit a JSON body on some gateway or proxy rate limits.
  }

  return 1_000;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
