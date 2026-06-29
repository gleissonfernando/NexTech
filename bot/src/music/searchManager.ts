import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { LoadType, type LavalinkResponse, type Track } from "shoukaku";
import type { MusicConfig, MusicTrack } from "./types";
import { getLavalinkNode } from "./lavalinkManager";
import { getSpotifyMetadata } from "./spotifyManager";

type Requester = { id: string; tag: string };

export async function resolveMusicQuery(query: string, requester: Requester, config: MusicConfig) {
  const value = query.trim();
  if (!value) throw new Error("Digite um link ou o nome de uma música.");
  if (value.length > 500) throw new Error("A busca deve ter no máximo 500 caracteres.");
  console.log(`[music:resolve] URL/busca recebida: ${value}`);

  if (!looksLikeUrl(value)) return [await searchTrack(value, requester, config, "search")];
  if (!config.allowLinks) throw new Error("Links estão desativados neste servidor.");

  const kind = detectUrlKind(value);
  if (kind === "spotify") return resolveSpotify(value, requester, config);
  if (kind === "direct") await assertPublicHttpUrl(value);
  return resolveLavalinkIdentifier(value, requester, config, kind === "soundcloud" ? "soundcloud" : kind === "youtube" ? "link" : "direct");
}

export async function resolveArtist(artist: string, requester: Requester, config: MusicConfig) {
  const value = artist.trim();
  if (!config.allowArtistSearch) throw new Error("Busca de artistas está desativada neste servidor.");
  if (value.length < 2 || value.length > 100) throw new Error("Digite um nome de artista válido.");
  const response = await load(`ytmsearch:${value} músicas`);
  const tracks = responseTracks(response)
    .map((track) => toMusicTrack(track, requester, "artist", config))
    .filter(notNull)
    .slice(0, config.artistLimit);
  if (!tracks.length) throw loadError(response, "Não encontrei músicas reproduzíveis desse artista.");
  return tracks;
}

export async function resolvePlaybackFallback(track: MusicTrack, config: MusicConfig) {
  const requester = { id: track.requestedById, tag: track.requestedByTag };
  const query = `${track.title} ${track.author}`.trim();
  for (const identifier of [`ytmsearch:${query}`, `scsearch:${query}`]) {
    try {
      const response = await load(identifier);
      const replacement = responseTracks(response)
        .map((item) => toMusicTrack(item, requester, track.source, config))
        .find((item) => item && item.encoded !== track.encoded);
      if (replacement) {
        console.log(`[music:fallback] ${track.url} -> ${replacement.provider} (${identifier.split(":", 1)[0]}).`);
        return replacement;
      }
      if (response?.loadType === LoadType.ERROR) logLavalinkError(identifier, response);
    } catch (error) {
      console.warn(`[music:fallback] ${identifier} falhou:`, errorDetails(error));
    }
  }
  throw new Error("Nenhuma fonte alternativa compatível foi encontrada.");
}

async function resolveSpotify(url: string, requester: Requester, config: MusicConfig) {
  const collection = /^https:\/\/open\.spotify\.com\/(playlist|album)\//i.test(url);
  if (collection && !config.allowPlaylists) throw new Error("Playlists e álbuns estão desativados neste servidor.");
  const metadata = await getSpotifyMetadata(url, collection ? config.playlistLimit : 1);
  const result: MusicTrack[] = [];
  for (const item of metadata) {
    try {
      result.push(await searchTrack(`${item.name} ${item.artists.join(" ")}`, requester, config, "spotify"));
    } catch (error) {
      console.warn(`[music:spotify] não foi possível resolver ${item.name}:`, errorDetails(error));
    }
  }
  if (!result.length) throw new Error("Não encontrei uma fonte reproduzível equivalente para esse link do Spotify.");
  return result;
}

async function searchTrack(query: string, requester: Requester, config: MusicConfig, source: MusicTrack["source"]) {
  let lastError: unknown;
  for (const identifier of [`ytmsearch:${query}`, `ytsearch:${query}`, `scsearch:${query}`]) {
    try {
      const response = await load(identifier);
      const found = responseTracks(response).map((track) => toMusicTrack(track, requester, source, config)).find(notNull);
      if (found) return found;
      if (response?.loadType === LoadType.ERROR) {
        logLavalinkError(identifier, response);
        lastError = response.data;
      }
    } catch (error) {
      lastError = error;
      console.warn(`[music:search] ${identifier} falhou:`, errorDetails(error));
    }
  }
  throw new Error(lastError ? `Nenhuma fonte conseguiu carregar a música: ${errorDetails(lastError)}` : "Música não encontrada ou fora dos limites configurados.");
}

async function resolveLavalinkIdentifier(identifier: string, requester: Requester, config: MusicConfig, source: MusicTrack["source"]) {
  const response = await load(identifier);
  if (!response) throw new Error("O Lavalink não retornou uma resposta para esse link.");
  if (response.loadType === LoadType.ERROR) {
    logLavalinkError(identifier, response);
    throw new Error(`O Lavalink recusou a faixa: ${response.data.message || response.data.cause}`);
  }
  const isPlaylist = response.loadType === LoadType.PLAYLIST;
  if (isPlaylist && !config.allowPlaylists) throw new Error("Playlists estão desativadas neste servidor.");
  const limit = isPlaylist ? config.playlistLimit : 1;
  const tracks = responseTracks(response).map((track) => toMusicTrack(track, requester, isPlaylist ? "playlist" : source, config)).filter(notNull).slice(0, limit);
  if (!tracks.length) throw new Error(isPlaylist ? "A playlist não possui músicas reproduzíveis." : "A música está indisponível, é uma live ou excede o limite configurado.");
  return tracks;
}

async function load(identifier: string) {
  const node = getLavalinkNode();
  try {
    return await node.rest.resolve(identifier);
  } catch (error) {
    console.error(`[music:lavalink] falha REST ao carregar ${identifier}:`, errorDetails(error));
    throw error;
  }
}

function responseTracks(response: LavalinkResponse | undefined): Track[] {
  if (!response) return [];
  if (response.loadType === LoadType.TRACK) return [response.data];
  if (response.loadType === LoadType.PLAYLIST) return response.data.tracks;
  if (response.loadType === LoadType.SEARCH) return response.data;
  return [];
}

function toMusicTrack(track: Track, requester: Requester, source: MusicTrack["source"], config: MusicConfig): MusicTrack | null {
  const durationMs = Number(track.info.length);
  if (!track.encoded || !track.info.title || track.info.isStream || !validDuration(durationMs, config)) return null;
  const provider = providerFromSource(track.info.sourceName);
  const url = track.info.uri || (provider === "youtube" ? `https://www.youtube.com/watch?v=${track.info.identifier}` : track.info.identifier);
  console.log(`[music:resolve] fonte=${provider} sourceName=${track.info.sourceName} url=${url}`);
  return {
    id: randomUUID(),
    title: track.info.title,
    author: track.info.author || "Artista desconhecido",
    durationMs,
    url,
    thumbnail: track.info.artworkUrl ?? null,
    requestedById: requester.id,
    requestedByTag: requester.tag,
    addedAt: new Date(),
    source,
    provider,
    encoded: track.encoded
  };
}

function providerFromSource(sourceName: string): MusicTrack["provider"] {
  const value = sourceName.toLowerCase();
  if (value.includes("youtube")) return "youtube";
  if (value.includes("soundcloud")) return "soundcloud";
  return "direct";
}

function loadError(response: LavalinkResponse | undefined, fallback: string) {
  return response?.loadType === LoadType.ERROR ? new Error(`${fallback} Lavalink: ${response.data.message || response.data.cause}`) : new Error(fallback);
}

function logLavalinkError(identifier: string, response: Extract<LavalinkResponse, { loadType: LoadType.ERROR }>) {
  console.error(`[music:lavalink] loadType=error identifier=${identifier} severity=${response.data.severity} message=${response.data.message} cause=${response.data.cause}`);
}

export async function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("URL inválida ou insegura.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("Endereço privado não é permitido.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Endereço privado não é permitido.");
  return url;
}

function detectUrlKind(value: string): "youtube" | "soundcloud" | "spotify" | "direct" {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) return "soundcloud";
  if (host === "spotify.com" || host.endsWith(".spotify.com") || host === "spotify.link") return "spotify";
  return "direct";
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

function errorDetails(error: unknown) {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error && typeof error === "object") {
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

function notNull<T>(value: T | null): value is T { return value !== null; }
