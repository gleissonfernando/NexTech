import axios from "axios";
import { env } from "../config/env";

type TwitchToken = {
  accessToken: string;
  expiresAt: number;
};

export type TwitchUserDto = {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
};

export type TwitchStreamDto = {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameName: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string;
  startedAt: string;
};

let tokenCache: TwitchToken | null = null;

export function normalizeTwitchChannel(input: string): string {
  let value = input.trim();

  value = value.replace("https://www.twitch.tv/", "");
  value = value.replace("https://twitch.tv/", "");
  value = value.replace("http://www.twitch.tv/", "");
  value = value.replace("http://twitch.tv/", "");
  value = value.replace("www.twitch.tv/", "");
  value = value.replace("twitch.tv/", "");

  value = value.split("?")[0] ?? value;
  value = value.split("/")[0] ?? value;

  return value.toLowerCase();
}

type TwitchUserResponse = {
  data: Array<{
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
  }>;
};

export async function getTwitchUser(channelName: string) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<TwitchUserResponse>("https://api.twitch.tv/helix/users", {
    headers: twitchHeaders(token),
    params: {
      login: channelName
    },
    timeout: 10_000
  });

  const user = data.data[0];

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url || null
  } satisfies TwitchUserDto;
}

export async function getTwitchStream(channelName: string) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<{ data: Array<Record<string, string | number>> }>("https://api.twitch.tv/helix/streams", {
    headers: twitchHeaders(token),
    params: {
      user_login: channelName
    },
    timeout: 10_000
  });

  const stream = data.data[0];

  if (!stream) {
    return null;
  }

  return {
    id: String(stream.id),
    userId: String(stream.user_id),
    userLogin: String(stream.user_login),
    userName: String(stream.user_name),
    gameName: String(stream.game_name || ""),
    title: String(stream.title || ""),
    viewerCount: Number(stream.viewer_count || 0),
    thumbnailUrl: String(stream.thumbnail_url || ""),
    startedAt: String(stream.started_at || new Date().toISOString())
  } satisfies TwitchStreamDto;
}

async function getAppAccessToken() {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error("Credenciais da Twitch API nao configuradas.");
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    "https://id.twitch.tv/oauth2/token",
    new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials"
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 10_000
    }
  );

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };

  return tokenCache.accessToken;
}

function twitchHeaders(accessToken: string) {
  return {
    "Client-ID": env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${accessToken}`
  };
}
