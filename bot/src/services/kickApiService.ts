import axios from "axios";
import { env } from "../config/env";

const KICK_API_URL = "https://api.kick.com/public/v1";
const KICK_OAUTH_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_BATCH_SIZE = 50;

type KickToken = {
  accessToken: string;
  expiresAt: number;
};

export type KickStream = {
  id: string;
  broadcasterUserId: string;
  channelId: string | null;
  slug: string;
  displayName: string;
  categoryName: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string | null;
  startedAt: string;
  avatar: string | null;
  url: string;
};

type KickLivestreamsResponse = {
  data?: Array<{
    broadcaster_user_id?: number | string | null;
    category?: {
      id?: number | string | null;
      name?: string | null;
      thumbnail?: string | null;
    } | null;
    channel_id?: number | string | null;
    profile_picture?: string | null;
    slug?: string | null;
    started_at?: string | null;
    stream_title?: string | null;
    thumbnail?: string | null;
    viewer_count?: number | null;
  }>;
};

type KickTokenResponse = {
  access_token: string;
  expires_in: number;
};

let tokenCache: KickToken | null = null;

export async function getKickLivestreamsByUserIds(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
  const streams = new Map<string, KickStream>();

  if (!uniqueUserIds.length) {
    return streams;
  }

  const token = await getAppAccessToken();

  for (let index = 0; index < uniqueUserIds.length; index += KICK_BATCH_SIZE) {
    const params = new URLSearchParams();
    params.set("limit", String(KICK_BATCH_SIZE));

    for (const userId of uniqueUserIds.slice(index, index + KICK_BATCH_SIZE)) {
      params.append("broadcaster_user_id", userId);
    }

    const { data } = await axios.get<KickLivestreamsResponse>(`${KICK_API_URL}/livestreams`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      params,
      timeout: 10_000
    });

    for (const stream of data.data ?? []) {
      const parsed = normalizeKickStream(stream);

      if (parsed) {
        streams.set(parsed.broadcasterUserId, parsed);
      }
    }
  }

  return streams;
}

async function getAppAccessToken() {
  if (!env.KICK_CLIENT_ID || !(env.KICK_CLIENT_SECRET || env.KICK_API_KEY)) {
    throw new Error("Credenciais da Kick API nao configuradas no bot.");
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const { data } = await axios.post<KickTokenResponse>(
    KICK_OAUTH_TOKEN_URL,
    new URLSearchParams({
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET || env.KICK_API_KEY,
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
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };

  return tokenCache.accessToken;
}

function normalizeKickStream(stream: NonNullable<KickLivestreamsResponse["data"]>[number]) {
  if (!stream.broadcaster_user_id || !stream.slug) {
    return null;
  }

  const broadcasterUserId = String(stream.broadcaster_user_id);
  const slug = String(stream.slug).toLowerCase();
  const startedAt = stream.started_at?.trim() || new Date().toISOString();

  return {
    id: `${broadcasterUserId}:${startedAt}`,
    broadcasterUserId,
    channelId: stream.channel_id === undefined || stream.channel_id === null ? null : String(stream.channel_id),
    slug,
    displayName: displayNameFromSlug(slug),
    categoryName: stream.category?.name?.trim() || "Sem categoria",
    title: stream.stream_title?.trim() || "Live ao vivo",
    viewerCount: Number(stream.viewer_count ?? 0),
    thumbnailUrl: stream.thumbnail?.trim() || null,
    startedAt,
    avatar: stream.profile_picture?.trim() || null,
    url: `https://kick.com/${slug}`
  } satisfies KickStream;
}

function displayNameFromSlug(slug: string) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || slug;
}
