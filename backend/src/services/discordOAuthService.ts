import axios from "axios";
import { env } from "../config/env";
import { getDiscordAvatarUrl } from "./discordAssetService";
import type { DiscordGuild } from "./guildService";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

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

type DiscordOAuthErrorPayload = {
  error?: string;
  error_description?: string;
  message?: string;
};

export class DiscordOAuthError extends Error {
  statusCode: number;
  discordError?: string;
  discordDescription?: string;

  constructor(message: string, input: { statusCode: number; discordError?: string; discordDescription?: string }) {
    super(message);
    this.name = "DiscordOAuthError";
    this.statusCode = input.statusCode;
    this.discordError = input.discordError;
    this.discordDescription = input.discordDescription;
  }
}

function safeClientSecretFingerprint() {
  const secret = env.DISCORD_CLIENT_SECRET.trim();
  return secret ? `${secret.slice(0, 4)}...${secret.slice(-4)} len=${secret.length}` : "empty";
}

export function getDiscordOAuthDiagnostics() {
  return {
    clientId: env.DISCORD_CLIENT_ID || "empty",
    clientSecret: safeClientSecretFingerprint(),
    redirectUri: env.DISCORD_OAUTH_REDIRECT_URI || "empty",
    scopes: env.DISCORD_SCOPES || "empty"
  };
}

export function buildDiscordAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: env.DISCORD_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: env.DISCORD_SCOPES,
    state
  });

  return `${DISCORD_OAUTH_AUTHORIZE_URL}?${params}`;
}

export async function exchangeDiscordCode(code: string) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.DISCORD_OAUTH_REDIRECT_URI
  });

  try {
    const { data } = await axios.post<DiscordTokenResponse>(`${DISCORD_API}/oauth2/token`, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    return data;
  } catch (error) {
    throw normalizeDiscordOAuthError(error, "trocar code por token");
  }
}

export async function refreshDiscordTokens(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  try {
    const { data } = await axios.post<DiscordTokenResponse>(`${DISCORD_API}/oauth2/token`, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    return data;
  } catch (error) {
    throw normalizeDiscordOAuthError(error, "renovar token");
  }
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
    console.warn("[discord] não foi possível buscar usuário pelo bot:", error instanceof Error ? error.message : error);
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

function normalizeDiscordOAuthError(error: unknown, action: string) {
  if (!axios.isAxiosError<DiscordOAuthErrorPayload>(error)) {
    return error;
  }

  const payload = error.response?.data;
  const status = error.response?.status ?? 502;
  const discordError = payload?.error ?? payload?.message;
  const discordDescription = payload?.error_description;
  const hint = oauthErrorHint(discordError, discordDescription);
  const diagnostics = getDiscordOAuthDiagnostics();

  console.warn(
    `[auth] discord oauth falhou ao ${action}: status=${status} error=${discordError ?? "unknown"} description=${discordDescription ?? "none"} hint=${hint} client_id=${diagnostics.clientId} redirect_uri=${diagnostics.redirectUri} client_secret=${diagnostics.clientSecret}.`
  );

  return new DiscordOAuthError(`Discord OAuth falhou ao ${action}: ${hint}`, {
    statusCode: status,
    discordError,
    discordDescription
  });
}

function oauthErrorHint(error?: string, description?: string) {
  const text = `${error ?? ""} ${description ?? ""}`.toLowerCase();

  if (text.includes("redirect_uri")) {
    return "redirect_uri inválido ou diferente do cadastrado no Developer Portal";
  }

  if (text.includes("client_secret")) {
    return "client_secret inválido para o client_id configurado";
  }

  if (text.includes("unknown") || text.includes("invalid_client") || text.includes("client_id")) {
    return "client_id inválido ou aplicativo Discord incorreto";
  }

  return "resposta OAuth recusada pelo Discord";
}
