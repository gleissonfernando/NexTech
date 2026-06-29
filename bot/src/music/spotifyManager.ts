import { env } from "../config/env";

export type SpotifyMetadataTrack = {
  name: string;
  artists: string[];
  durationMs: number | null;
  url: string;
  thumbnail: string | null;
};

type SpotifyApiTrack = {
  name?: unknown;
  artists?: Array<{ name?: unknown }>;
  duration_ms?: unknown;
  external_urls?: { spotify?: unknown };
  album?: { images?: Array<{ url?: unknown }> };
};

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getSpotifyMetadata(url: string, limit: number) {
  const normalizedUrl = await resolveSpotifyUrl(url);
  const parsed = parseSpotifyUrl(normalizedUrl);
  if (!parsed) throw new Error("Link do Spotify inválido.");

  if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) {
    try {
      return await getViaWebApi(parsed.type, parsed.id, Math.max(1, Math.min(50, limit)));
    } catch (error) {
      console.warn("[music] Spotify Web API falhou; usando oEmbed:", error instanceof Error ? error.message : error);
    }
  }

  const response = await fetchWithTimeout(`https://open.spotify.com/oembed?url=${encodeURIComponent(normalizedUrl)}`);
  if (!response.ok) throw new Error(`O Spotify não retornou os metadados (HTTP ${response.status}).`);
  const data = await response.json() as { title?: unknown; thumbnail_url?: unknown };
  if (typeof data.title !== "string" || !data.title.trim()) throw new Error("O Spotify não retornou um título válido.");
  return [{
    name: data.title.trim(),
    artists: [],
    durationMs: null,
    url: normalizedUrl,
    thumbnail: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null
  }] satisfies SpotifyMetadataTrack[];
}

async function resolveSpotifyUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.hostname.toLowerCase() !== "spotify.link") return parsed.href;
  const response = await fetchWithTimeout(parsed, { method: "HEAD", redirect: "follow" }, 10_000);
  const resolved = new URL(response.url);
  if (resolved.hostname.toLowerCase() !== "open.spotify.com") throw new Error("O link curto do Spotify redirecionou para um destino inválido.");
  return resolved.href;
}

async function getViaWebApi(type: "track" | "playlist" | "album", id: string, limit: number) {
  const token = await getAccessToken();
  const endpoint = type === "track"
    ? `https://api.spotify.com/v1/tracks/${id}`
    : type === "album"
      ? `https://api.spotify.com/v1/albums/${id}/tracks?limit=${limit}`
      : `https://api.spotify.com/v1/playlists/${id}/items?limit=${limit}&additional_types=track`;
  const response = await fetchWithTimeout(endpoint, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Spotify Web API respondeu HTTP ${response.status}.`);
  const data = await response.json() as Record<string, unknown>;
  const rawTracks = type === "track"
    ? [data]
    : Array.isArray(data.items)
      ? data.items.map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as { item?: unknown; track?: unknown };
          return item.item ?? item.track ?? entry;
        })
      : [];
  const tracks = rawTracks.map(toMetadataTrack).filter((track): track is SpotifyMetadataTrack => Boolean(track)).slice(0, limit);
  if (!tracks.length) throw new Error("Nenhuma faixa utilizável foi retornada pelo Spotify.");
  return tracks;
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const credentials = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const response = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`Não foi possível autenticar no Spotify (HTTP ${response.status}).`);
  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string") throw new Error("O Spotify não retornou um token válido.");
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000
  };
  return tokenCache.token;
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, milliseconds = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  let rejection: NodeJS.Timeout | null = null;
  timer.unref();
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        rejection = setTimeout(() => reject(new Error("O Spotify não respondeu a tempo.")), milliseconds);
        rejection.unref();
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (rejection) clearTimeout(rejection);
  }
}

function toMetadataTrack(value: unknown): SpotifyMetadataTrack | null {
  if (!value || typeof value !== "object") return null;
  const track = value as SpotifyApiTrack;
  if (typeof track.name !== "string" || !track.name.trim()) return null;
  return {
    name: track.name.trim(),
    artists: Array.isArray(track.artists)
      ? track.artists.map((artist) => artist.name).filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
      : [],
    durationMs: Number.isFinite(Number(track.duration_ms)) ? Number(track.duration_ms) : null,
    url: typeof track.external_urls?.spotify === "string" ? track.external_urls.spotify : "https://open.spotify.com/",
    thumbnail: track.album?.images?.find((image) => typeof image.url === "string")?.url as string | undefined ?? null
  };
}

function parseSpotifyUrl(value: string) {
  try {
    const url = new URL(value);
    const match = /^\/(track|playlist|album)\/([A-Za-z0-9]+)(?:\/|$)/.exec(url.pathname);
    if (!match?.[1] || !match[2]) return null;
    return { type: match[1] as "track" | "playlist" | "album", id: match[2] };
  } catch {
    return null;
  }
}
