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

export type TwitchClipDto = {
  id: string;
  url: string;
  broadcasterId: string;
  broadcasterName: string;
  creatorName: string;
  title: string;
  thumbnailUrl: string | null;
  viewCount: number;
  createdAt: string;
};

export type TwitchSubscriberDto = {
  id: string;
  login: string;
  displayName: string;
  isGift: boolean;
  isPrime: boolean;
  subTier: string | null;
  subTierLabel: string | null;
};

export type TwitchOAuthToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
};

export type TwitchConnectedUser = TwitchUserDto & {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

export type TwitchUserVerification = {
  twitchId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isFollower: boolean;
  followedAt: string | null;
  isSubscriber: boolean;
  subTier: string | null;
  subTierLabel: string | null;
  subMonths: number | null;
  isPrime: boolean;
  isVip: boolean;
  isModerator: boolean;
  isEditor: boolean;
  checkedAt: string;
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

type TwitchClipsResponse = {
  data: Array<{
    id: string;
    url: string;
    broadcaster_id: string;
    broadcaster_name: string;
    creator_name: string;
    title: string;
    thumbnail_url: string;
    view_count: number;
    created_at: string;
  }>;
};

type TwitchSubscriptionsResponse = {
  data: Array<{
    broadcaster_id?: string;
    broadcaster_login?: string;
    broadcaster_name?: string;
    gifter_id?: string;
    gifter_login?: string;
    gifter_name?: string;
    is_gift?: boolean;
    plan_name?: string;
    tier?: string;
    user_id: string;
    user_login: string;
    user_name: string;
  }>;
  pagination?: {
    cursor?: string;
  };
};

type TwitchOAuthTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string[];
  token_type?: string;
};

type TwitchFollowedResponse = {
  data: Array<{
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    followed_at: string;
  }>;
};

type TwitchFollowersResponse = {
  data: Array<{
    followed_at: string;
    user_id: string;
    user_login: string;
    user_name: string;
  }>;
  pagination?: {
    cursor?: string;
  };
};

type TwitchRoleResponse = {
  data: Array<{
    user_id?: string;
    user_login?: string;
    user_name?: string;
  }>;
  pagination?: {
    cursor?: string;
  };
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

export async function getTwitchClips(input: {
  broadcasterId: string;
  endedAt?: string;
  first?: number;
  startedAt?: string;
}) {
  const token = await getAppAccessToken();
  const { data } = await axios.get<TwitchClipsResponse>("https://api.twitch.tv/helix/clips", {
    headers: twitchHeaders(token),
    params: {
      broadcaster_id: input.broadcasterId,
      first: Math.max(1, Math.min(input.first ?? 20, 100)),
      ...(input.startedAt ? { started_at: input.startedAt } : {}),
      ...(input.endedAt ? { ended_at: input.endedAt } : {})
    },
    timeout: 10_000
  });

  return data.data.map((clip) => ({
    id: clip.id,
    url: clip.url,
    broadcasterId: clip.broadcaster_id,
    broadcasterName: clip.broadcaster_name,
    creatorName: clip.creator_name,
    title: clip.title,
    thumbnailUrl: clip.thumbnail_url || null,
    viewCount: Number(clip.view_count || 0),
    createdAt: clip.created_at
  } satisfies TwitchClipDto));
}

export async function getTwitchSubscribers(input: {
  accessToken?: string | null;
  broadcasterId: string;
  max?: number;
}) {
  const token = input.accessToken?.trim() || env.TWITCH_BROADCASTER_ACCESS_TOKEN.trim();

  if (!env.TWITCH_CLIENT_ID) {
    throw new Error("TWITCH_CLIENT_ID nao configurado.");
  }

  if (!token) {
    throw new Error("TWITCH_BROADCASTER_ACCESS_TOKEN nao configurado para validar subs da live.");
  }

  const max = Math.max(1, Math.min(input.max ?? 1000, 5000));
  const subscribers = new Map<string, TwitchSubscriberDto>();
  let after: string | undefined;

  do {
    const { data } = await axios.get<TwitchSubscriptionsResponse>("https://api.twitch.tv/helix/subscriptions", {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      },
      params: {
        broadcaster_id: input.broadcasterId,
        first: Math.min(100, max - subscribers.size),
        ...(after ? { after } : {})
      },
      timeout: 10_000
    });

    for (const subscriber of data.data) {
      subscribers.set(subscriber.user_id, {
        id: subscriber.user_id,
        login: subscriber.user_login,
        displayName: subscriber.user_name || subscriber.user_login,
        isGift: subscriber.is_gift === true,
        isPrime: isPrimeSubscription(subscriber),
        subTier: subscriber.tier ?? null,
        subTierLabel: twitchTierLabel(subscriber.tier, subscriber)
      });

      if (subscribers.size >= max) {
        break;
      }
    }

    after = data.pagination?.cursor;
  } while (after && subscribers.size < max);

  return [...subscribers.values()];
}

export async function getTwitchFollowers(input: {
  accessToken?: string | null;
  broadcasterId: string;
  max?: number;
}) {
  const token = input.accessToken?.trim() || env.TWITCH_BROADCASTER_ACCESS_TOKEN.trim();

  if (!env.TWITCH_CLIENT_ID) {
    throw new Error("TWITCH_CLIENT_ID nao configurado.");
  }

  if (!token) {
    throw new Error("TWITCH_BROADCASTER_ACCESS_TOKEN nao configurado para validar followers da live.");
  }

  const max = Math.max(1, Math.min(input.max ?? 1000, 5000));
  const followers = new Map<string, TwitchUserVerification>();
  let after: string | undefined;

  do {
    const { data } = await axios.get<TwitchFollowersResponse>("https://api.twitch.tv/helix/channels/followers", {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      },
      params: {
        broadcaster_id: input.broadcasterId,
        first: Math.min(100, max - followers.size),
        ...(after ? { after } : {})
      },
      timeout: 10_000
    });

    for (const follower of data.data) {
      followers.set(follower.user_id, {
        twitchId: follower.user_id,
        username: follower.user_login,
        displayName: follower.user_name || follower.user_login,
        avatar: null,
        isFollower: true,
        followedAt: follower.followed_at,
        isSubscriber: false,
        subTier: null,
        subTierLabel: null,
        subMonths: null,
        isPrime: false,
        isVip: false,
        isModerator: false,
        isEditor: false,
        checkedAt: new Date().toISOString()
      });

      if (followers.size >= max) {
        break;
      }
    }

    after = data.pagination?.cursor;
  } while (after && followers.size < max);

  return [...followers.values()];
}

export function buildTwitchOAuthUrl(input: {
  redirectUri: string;
  scopes?: string[];
  state: string;
}) {
  if (!env.TWITCH_CLIENT_ID) {
    throw new Error("TWITCH_CLIENT_ID nao configurado.");
  }

  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", (input.scopes ?? twitchGiveawayScopes()).join(" "));

  return url.toString();
}

export function twitchGiveawayScopes() {
  return ["user:read:follows", "user:read:subscriptions"];
}

export async function exchangeTwitchOAuthCode(code: string, redirectUri: string): Promise<TwitchOAuthToken> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error("Credenciais OAuth da Twitch nao configuradas.");
  }

  const { data } = await axios.post<TwitchOAuthTokenResponse>(
    "https://id.twitch.tv/oauth2/token",
    new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 10_000
    }
  );

  return normalizeTwitchOAuthToken(data);
}

export async function refreshTwitchOAuthToken(refreshToken: string): Promise<TwitchOAuthToken> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error("Credenciais OAuth da Twitch nao configuradas.");
  }

  const { data } = await axios.post<TwitchOAuthTokenResponse>(
    "https://id.twitch.tv/oauth2/token",
    new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 10_000
    }
  );

  return normalizeTwitchOAuthToken(data);
}

export async function getTwitchAuthenticatedUser(token: TwitchOAuthToken): Promise<TwitchConnectedUser> {
  const { data } = await axios.get<TwitchUserResponse>("https://api.twitch.tv/helix/users", {
    headers: twitchHeaders(token.accessToken),
    timeout: 10_000
  });
  const user = data.data[0];

  if (!user) {
    throw new Error("Usuario Twitch nao encontrado.");
  }

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url || null,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresIn > 0 ? new Date(Date.now() + token.expiresIn * 1000) : null,
    scopes: token.scopes
  };
}

export async function verifyTwitchGiveawayUser(input: {
  broadcasterAccessToken?: string | null;
  broadcasterId: string;
  userAccessToken: string;
  userId: string;
}) {
  const [user, follow, subscription, moderator, vip, editor] = await Promise.all([
    getTwitchUserById(input.userId, input.userAccessToken),
    checkTwitchFollow(input.userAccessToken, input.userId, input.broadcasterId),
    checkTwitchSubscription(input.userAccessToken, input.userId, input.broadcasterId),
    checkTwitchRole("moderator", input.broadcasterAccessToken ?? env.TWITCH_BROADCASTER_ACCESS_TOKEN, input.broadcasterId, input.userId),
    checkTwitchRole("vip", input.broadcasterAccessToken ?? env.TWITCH_BROADCASTER_ACCESS_TOKEN, input.broadcasterId, input.userId),
    checkTwitchEditor(input.broadcasterAccessToken ?? env.TWITCH_BROADCASTER_ACCESS_TOKEN, input.broadcasterId, input.userId)
  ]);

  return {
    twitchId: user?.id ?? input.userId,
    username: user?.login ?? input.userId,
    displayName: user?.displayName ?? user?.login ?? input.userId,
    avatar: user?.profileImageUrl ?? null,
    isFollower: Boolean(follow),
    followedAt: follow?.followed_at ?? null,
    isSubscriber: Boolean(subscription),
    subTier: subscription?.tier ?? null,
    subTierLabel: twitchTierLabel(subscription?.tier, subscription ?? undefined),
    subMonths: null,
    isPrime: subscription ? isPrimeSubscription(subscription) : false,
    isVip: vip,
    isModerator: moderator,
    isEditor: editor,
    checkedAt: new Date().toISOString()
  } satisfies TwitchUserVerification;
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

function normalizeTwitchOAuthToken(data: TwitchOAuthTokenResponse): TwitchOAuthToken {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: Number(data.expires_in || 0),
    scopes: Array.isArray(data.scope) ? data.scope : []
  };
}

async function getTwitchUserById(userId: string, accessToken: string) {
  const { data } = await axios.get<TwitchUserResponse>("https://api.twitch.tv/helix/users", {
    headers: twitchHeaders(accessToken),
    params: {
      id: userId
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

async function checkTwitchFollow(accessToken: string, userId: string, broadcasterId: string) {
  const { data } = await axios.get<TwitchFollowedResponse>("https://api.twitch.tv/helix/channels/followed", {
    headers: twitchHeaders(accessToken),
    params: {
      broadcaster_id: broadcasterId,
      user_id: userId
    },
    timeout: 10_000
  });

  return data.data[0] ?? null;
}

async function checkTwitchSubscription(accessToken: string, userId: string, broadcasterId: string) {
  try {
    const { data } = await axios.get<TwitchSubscriptionsResponse>("https://api.twitch.tv/helix/subscriptions/user", {
      headers: twitchHeaders(accessToken),
      params: {
        broadcaster_id: broadcasterId,
        user_id: userId
      },
      timeout: 10_000
    });

    return data.data[0] ?? null;
  } catch (error) {
    if (axios.isAxiosError(error) && [400, 404].includes(error.response?.status ?? 0)) {
      return null;
    }

    throw error;
  }
}

async function checkTwitchRole(
  role: "moderator" | "vip",
  accessToken: string | null | undefined,
  broadcasterId: string,
  userId: string
) {
  const token = accessToken?.trim();

  if (!token) {
    return false;
  }

  const url = role === "moderator"
    ? "https://api.twitch.tv/helix/moderation/moderators"
    : "https://api.twitch.tv/helix/channels/vips";

  try {
    const { data } = await axios.get<TwitchRoleResponse>(url, {
      headers: twitchHeaders(token),
      params: {
        broadcaster_id: broadcasterId,
        user_id: userId
      },
      timeout: 10_000
    });

    return data.data.some((item) => item.user_id === userId);
  } catch {
    return false;
  }
}

async function checkTwitchEditor(accessToken: string | null | undefined, broadcasterId: string, userId: string) {
  const token = accessToken?.trim();

  if (!token) {
    return false;
  }

  try {
    const { data } = await axios.get<TwitchRoleResponse>("https://api.twitch.tv/helix/channels/editors", {
      headers: twitchHeaders(token),
      params: {
        broadcaster_id: broadcasterId
      },
      timeout: 10_000
    });

    return data.data.some((item) => item.user_id === userId);
  } catch {
    return false;
  }
}

function twitchTierLabel(tier?: string | null, subscriber?: { plan_name?: string; tier?: string } | null) {
  const planName = subscriber?.plan_name?.trim();

  if (planName && /prime/i.test(planName)) {
    return "Prime Gaming";
  }

  if (tier === "3000") {
    return "Tier 3";
  }

  if (tier === "2000") {
    return "Tier 2";
  }

  if (tier === "1000") {
    return "Tier 1";
  }

  return tier ?? null;
}

function isPrimeSubscription(subscriber: { plan_name?: string; tier?: string }) {
  return /prime/i.test(subscriber.plan_name ?? "");
}
