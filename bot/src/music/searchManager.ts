import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import ytdl from "@distube/ytdl-core";
import play, {
  type SoundCloudPlaylist,
  type SoundCloudTrack
} from "play-dl";
import { YouTube, type Video } from "youtube-sr";
import type { MusicConfig, MusicTrack } from "./types";
import { getYouTubeAgent, getYouTubeCookieHeader } from "./youtubeAuth";
import { getSpotifyMetadata } from "./spotifyManager";

type Requester = { id: string; tag: string };
const SEARCH_TIMEOUT_MS = 15_000;
let soundCloudSetup: Promise<void> | null = null;

export async function resolveMusicQuery(query: string, requester: Requester, config: MusicConfig) {
  const value = query.trim();
  if (!value) throw new Error("Digite um link ou o nome de uma música.");
  if (value.length > 500) throw new Error("A busca deve ter no máximo 500 caracteres.");

  if (!looksLikeUrl(value)) return [await searchPlayableTrack(value, requester, config, "search")];
  if (!config.allowLinks) throw new Error("Links estão desativados neste servidor.");

  const kind = detectUrlKind(value);
  if (kind === "youtube") return resolveYouTubeUrl(value, requester, config);
  if (kind === "soundcloud") return resolveSoundCloudUrl(value, requester, config);
  if (kind === "spotify") return resolveSpotifyUrl(value, requester, config);
  if (kind === "direct") return [await resolveDirectAudio(value, requester, config)];
  throw new Error("Link inválido ou fonte não suportada. Use YouTube, SoundCloud, Spotify ou áudio direto HTTPS.");
}

export async function resolveArtist(artist: string, requester: Requester, config: MusicConfig) {
  const value = artist.trim();
  if (!config.allowArtistSearch) throw new Error("Busca de artistas está desativada neste servidor.");
  if (value.length < 2 || value.length > 100) throw new Error("Digite um nome de artista válido.");

  try {
    const videos = await YouTube.search(`${value} músicas`, {
      limit: Math.min(50, Math.max(config.artistLimit * 2, config.artistLimit)),
      type: "video",
      safeSearch: true,
      requestOptions: youtubeRequestOptions()
    });
    const tracks = uniqueValidYouTubeTracks(videos, requester, config, "artist").slice(0, config.artistLimit);
    if (tracks.length) return tracks;
  } catch (error) {
    console.warn("[music] busca de artista no YouTube falhou; tentando SoundCloud:", plainError(error));
  }

  await ensureSoundCloud();
  const results = await withTimeout(
    play.search(value, { limit: config.artistLimit, source: { soundcloud: "tracks" } }),
    SEARCH_TIMEOUT_MS,
    "A busca no SoundCloud não respondeu a tempo."
  );
  const tracks = results.map((track) => soundCloudTrack(track, requester, config, "artist")).filter(notNull);
  if (!tracks.length) throw new Error("Não encontrei músicas reproduzíveis desse artista.");
  return tracks;
}

export async function resolveSoundCloudFallback(track: MusicTrack, config: MusicConfig) {
  await ensureSoundCloud();
  const query = `${track.title} ${track.author}`.trim();
  const results = await withTimeout(
    play.search(query, { limit: 5, source: { soundcloud: "tracks" } }),
    SEARCH_TIMEOUT_MS,
    "A fonte alternativa não respondeu a tempo."
  );
  const requester = { id: track.requestedById, tag: track.requestedByTag };
  const replacement = results.map((item) => soundCloudTrack(item, requester, config, track.source)).find(notNull);
  if (!replacement) throw new Error("Nenhuma fonte alternativa compatível foi encontrada.");
  return replacement;
}

async function resolveYouTubeUrl(url: string, requester: Requester, config: MusicConfig) {
  if (YouTube.isPlaylist(url)) {
    if (!config.allowPlaylists) throw new Error("Playlists estão desativadas neste servidor.");
    const playlist = await YouTube.getPlaylist(url, {
      fetchAll: false,
      limit: config.playlistLimit,
      requestOptions: youtubeRequestOptions()
    });
    const tracks = uniqueValidYouTubeTracks(playlist.videos, requester, config, "playlist").slice(0, config.playlistLimit);
    if (!tracks.length) throw new Error("A playlist não possui músicas reproduzíveis.");
    return tracks;
  }
  return [await directYouTubeTrack(url, requester, config, "link")];
}

async function resolveSoundCloudUrl(url: string, requester: Requester, config: MusicConfig) {
  await ensureSoundCloud();
  const result = await withTimeout(play.soundcloud(url), SEARCH_TIMEOUT_MS, "O SoundCloud não respondeu a tempo.");
  if (result.type === "track") {
    const track = soundCloudTrack(result as SoundCloudTrack, requester, config, "soundcloud");
    if (!track) throw new Error("Essa música do SoundCloud é longa demais ou está indisponível.");
    return [track];
  }
  if (!config.allowPlaylists) throw new Error("Playlists estão desativadas neste servidor.");
  const all = await withTimeout(
    (result as SoundCloudPlaylist).all_tracks(),
    SEARCH_TIMEOUT_MS,
    "A playlist do SoundCloud não respondeu a tempo."
  );
  const tracks = all.slice(0, config.playlistLimit).map((item) => soundCloudTrack(item, requester, config, "playlist")).filter(notNull);
  if (!tracks.length) throw new Error("A playlist do SoundCloud não possui músicas reproduzíveis.");
  return tracks;
}

async function resolveSpotifyUrl(url: string, requester: Requester, config: MusicConfig) {
  const kind = /^https:\/\/open\.spotify\.com\/(playlist|album)\//i.test(url) ? "collection" : "track";
  if (kind === "collection" && !config.allowPlaylists) throw new Error("Playlists e álbuns estão desativados neste servidor.");
  const limited = await getSpotifyMetadata(url, kind === "track" ? 1 : config.playlistLimit);
  const resolved: MusicTrack[] = [];
  for (const item of limited) {
    const text = `${item.name} ${item.artists.join(" ")}`.trim();
    try {
      resolved.push(await searchPlayableTrack(text, requester, config, "spotify"));
    } catch (error) {
      console.warn(`[music] fallback do Spotify falhou para ${item.name}:`, plainError(error));
    }
  }
  if (!resolved.length) throw new Error("Não encontrei uma fonte reproduzível equivalente para esse link do Spotify.");
  return resolved;
}

async function searchPlayableTrack(query: string, requester: Requester, config: MusicConfig, source: MusicTrack["source"]) {
  try {
    const videos = await YouTube.search(query, {
      limit: 8,
      type: "video",
      safeSearch: true,
      requestOptions: youtubeRequestOptions()
    });
    const found = uniqueValidYouTubeTracks(videos, requester, config, source)[0];
    if (found) return found;
  } catch (error) {
    console.warn("[music] pesquisa no YouTube falhou; tentando SoundCloud:", plainError(error));
  }

  await ensureSoundCloud();
  const results = await withTimeout(
    play.search(query, { limit: 5, source: { soundcloud: "tracks" } }),
    SEARCH_TIMEOUT_MS,
    "A busca alternativa não respondeu a tempo."
  );
  const found = results.map((track) => soundCloudTrack(track, requester, config, source)).find(notNull);
  if (!found) throw new Error("Música não encontrada ou fora dos limites configurados.");
  return found;
}

function uniqueValidYouTubeTracks(videos: Video[], requester: Requester, config: MusicConfig, source: MusicTrack["source"]) {
  const result: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const video of videos) {
    const track = youtubeSearchTrack(video, requester, config, source);
    if (!track) continue;
    const key = `${track.title.toLowerCase()}|${track.author.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(track);
    }
  }
  return result;
}

function youtubeSearchTrack(video: Video, requester: Requester, config: MusicConfig, source: MusicTrack["source"]): MusicTrack | null {
  if (!video.id || !video.title || video.private || video.live || !validDuration(video.duration, config)) return null;
  return baseTrack({
    title: video.title,
    author: video.channel?.name ?? "Canal desconhecido",
    durationMs: video.duration,
    url: video.url,
    thumbnail: video.thumbnail?.url ?? null,
    requester,
    source,
    provider: "youtube"
  });
}

async function directYouTubeTrack(url: string, requester: Requester, config: MusicConfig, source: MusicTrack["source"]) {
  try {
    const info = await withTimeout(
      ytdl.getBasicInfo(url, { agent: getYouTubeAgent() }),
      SEARCH_TIMEOUT_MS,
      "A fonte de música não respondeu a tempo."
    );
    const details = info.videoDetails;
    const durationMs = Number(details.lengthSeconds) * 1000;
    if (!details.videoId || !details.title || details.isPrivate || details.isLive || details.isLiveContent) {
      throw new Error("Música privada, removida, ao vivo ou indisponível.");
    }
    if (!validDuration(durationMs, config)) throw new Error(`A música excede o limite de ${config.maxTrackMinutes} minutos.`);
    return baseTrack({
      title: details.title,
      author: details.author?.name ?? "Canal desconhecido",
      durationMs,
      url: details.video_url || `https://www.youtube.com/watch?v=${details.videoId}`,
      thumbnail: details.thumbnails.at(-1)?.url ?? null,
      requester,
      source,
      provider: "youtube"
    });
  } catch (error) {
    console.warn("[music] metadados ytdl indisponíveis; tentando oEmbed:", plainError(error));
    const cookie = getYouTubeCookieHeader();
    const response = await withTimeout(
      fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
        headers: cookie ? { cookie } : undefined,
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      }),
      SEARCH_TIMEOUT_MS,
      "O YouTube não respondeu a tempo."
    );
    if (!response.ok) throw new Error("O vídeo é privado, removido, restrito ou está indisponível.");
    const data = await response.json() as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
    if (typeof data.title !== "string" || !data.title.trim()) throw new Error("O YouTube não retornou metadados válidos.");
    return baseTrack({
      title: data.title.trim(),
      author: typeof data.author_name === "string" ? data.author_name : "YouTube",
      durationMs: 0,
      url,
      thumbnail: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
      requester,
      source,
      provider: "youtube"
    });
  }
}

function soundCloudTrack(track: SoundCloudTrack, requester: Requester, config: MusicConfig, source: MusicTrack["source"]): MusicTrack | null {
  if (!track.fetched || !validDuration(track.durationInMs, config)) return null;
  return baseTrack({
    title: track.name,
    author: track.publisher?.artist || track.user?.name || "SoundCloud",
    durationMs: track.durationInMs,
    url: track.permalink || track.url,
    thumbnail: track.thumbnail || null,
    requester,
    source,
    provider: "soundcloud"
  });
}

async function resolveDirectAudio(url: string, requester: Requester, config: MusicConfig) {
  const { url: parsed, contentType } = await probeDirectAudioUrl(url);
  if (parsed.protocol !== "https:") throw new Error("Links diretos de áudio precisam usar HTTPS.");
  const extensionLooksAudio = /\.(mp3|wav|ogg|opus|m4a|aac|flac)(?:$|[?#])/i.test(parsed.href);
  if (!extensionLooksAudio && !contentType.startsWith("audio/")) {
    throw new Error("A URL não aponta para um arquivo de áudio reconhecido.");
  }
  const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "Áudio direto");
  return baseTrack({
    title: fileName.replace(/\.(mp3|wav|ogg|opus|m4a|aac|flac)$/i, "") || "Áudio direto",
    author: parsed.hostname,
    durationMs: 0,
    url: parsed.href,
    thumbnail: null,
    requester,
    source: "direct",
    provider: "direct"
  });
}

async function probeDirectAudioUrl(initialUrl: string) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const url = await assertPublicHttpUrl(current);
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        headers: { range: "bytes=0-0" },
        redirect: "manual",
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      });
      await response.body?.cancel().catch(() => undefined);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("O servidor retornou um redirecionamento inválido.");
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error(`O servidor do áudio respondeu HTTP ${response.status}.`);
    return { url, contentType: response.headers.get("content-type")?.toLowerCase() ?? "" };
  }
  throw new Error("O link de áudio possui redirecionamentos demais.");
}

function baseTrack(input: Omit<MusicTrack, "id" | "requestedById" | "requestedByTag" | "addedAt"> & { requester: Requester }): MusicTrack {
  const { requester, ...track } = input;
  return {
    ...track,
    id: randomUUID(),
    requestedById: requester.id,
    requestedByTag: requester.tag,
    addedAt: new Date()
  };
}

export async function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("URL inválida ou insegura.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("Endereço privado não é permitido.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Endereço privado não é permitido.");
  return url;
}

async function ensureSoundCloud() {
  if (!soundCloudSetup) {
    soundCloudSetup = withTimeout(play.getFreeClientID(), SEARCH_TIMEOUT_MS, "Não foi possível iniciar o SoundCloud.")
      .then((clientId) => play.setToken({ soundcloud: { client_id: clientId } }));
  }
  return soundCloudSetup;
}

function detectUrlKind(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) return "soundcloud";
  if (host === "spotify.com" || host.endsWith(".spotify.com") || host === "spotify.link") return "spotify";
  return "direct";
}

function youtubeRequestOptions(): RequestInit {
  const cookie = getYouTubeCookieHeader();
  return { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS), headers: cookie ? { cookie } : undefined };
}

function looksLikeUrl(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function validDuration(durationMs: number, config: MusicConfig) {
  return Number.isFinite(durationMs) && durationMs > 0 && durationMs <= config.maxTrackMinutes * 60_000;
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127);
}

function notNull<T>(value: T | null): value is T { return value !== null; }
function plainError(error: unknown) { return error instanceof Error ? error.message : String(error); }

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
  try { return await Promise.race([promise, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
