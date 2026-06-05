import axios from "axios";
import { env } from "../config/env";
import type { DiscordGuild } from "./guildService";

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordUser = {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
  avatar: string | null;
  email: string | null;
};

export type DiscordTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
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

export async function fetchDiscordUser(accessToken: string) {
  const { data } = await axios.get<DiscordUser>(`${DISCORD_API}/users/@me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return data;
}

export async function fetchDiscordGuilds(accessToken: string) {
  const { data } = await axios.get<DiscordGuild[]>(`${DISCORD_API}/users/@me/guilds`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return data;
}

export function discordAvatarUrl(user: Pick<DiscordUser, "id" | "avatar">) {
  if (!user.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

export function discordUserTag(user: Pick<DiscordUser, "username" | "discriminator" | "global_name">) {
  if (user.discriminator && user.discriminator !== "0") {
    return `${user.username}#${user.discriminator}`;
  }

  return user.global_name ?? user.username;
}
