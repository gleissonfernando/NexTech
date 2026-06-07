import axios from "axios";
import { env } from "../config/env";
import { getDiscordAvatarUrl } from "./discordAssetService";
import type { DiscordGuild } from "./guildService";

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordUser = {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
  avatar: string | null;
  email?: string | null;
};

export type DiscordTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export type DiscordCurrentUserGuildMember = {
  roles?: string[];
};

function encodeOAuthParams(params: Record<string, string>) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function buildDiscordAuthUrl(state: string) {
  const params = encodeOAuthParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: env.DISCORD_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: env.DISCORD_SCOPES,
    state,
    prompt: "consent"
  });

  return `${DISCORD_API}/oauth2/authorize?${params}`;
}

export async function exchangeDiscordCode(code: string) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.DISCORD_OAUTH_REDIRECT_URI
  });

  const { data } = await axios.post<DiscordTokenResponse>(`${DISCORD_API}/oauth2/token`, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  return data;
}

export async function refreshDiscordTokens(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const { data } = await axios.post<DiscordTokenResponse>(`${DISCORD_API}/oauth2/token`, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  return data;
}

export async function fetchDiscordUser(accessToken: string) {
  const { data } = await axios.get<DiscordUser>(`${DISCORD_API}/users/@me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return data;
}

export async function fetchDiscordCurrentUserGuildMember(accessToken: string, guildId: string) {
  const { data } = await axios.get<DiscordCurrentUserGuildMember>(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    timeout: 5000
  });

  return data;
}

export async function fetchDiscordUserById(userId: string) {
  if (!env.DISCORD_BOT_TOKEN) {
    return null;
  }

  try {
    const { data } = await axios.get<DiscordUser>(`${DISCORD_API}/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
      }
    });

    return {
      ...data,
      email: data.email ?? null
    };
  } catch (error) {
    console.warn("[discord] nao foi possivel buscar usuario pelo bot:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function fetchDiscordGuilds(accessToken: string) {
  const { data } = await axios.get<DiscordGuild[]>(`${DISCORD_API}/users/@me/guilds`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return data;
}

export function discordAvatarUrl(user: Pick<DiscordUser, "id" | "avatar"> & Partial<Pick<DiscordUser, "discriminator">>) {
  return user.avatar ? getDiscordAvatarUrl(user.id, user.avatar) : discordDefaultAvatarUrl(user);
}

export function discordUserTag(user: Pick<DiscordUser, "username" | "discriminator" | "global_name">) {
  if (user.discriminator && user.discriminator !== "0") {
    return `${user.username}#${user.discriminator}`;
  }

  return user.global_name ?? user.username;
}

function discordDefaultAvatarUrl(user: Pick<DiscordUser, "id"> & Partial<Pick<DiscordUser, "discriminator">>) {
  if (user.discriminator && user.discriminator !== "0") {
    const discriminator = Number.parseInt(user.discriminator, 10);
    const index = Number.isFinite(discriminator) ? discriminator % 5 : 0;

    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }

  try {
    const index = Number((BigInt(user.id) >> 22n) % 6n);

    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  } catch {
    return "https://cdn.discordapp.com/embed/avatars/0.png";
  }
}
