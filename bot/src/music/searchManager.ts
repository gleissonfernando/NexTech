import { randomUUID } from "node:crypto";
import { YouTube, type Video } from "youtube-sr";
import type { MusicConfig, MusicTrack } from "./types";

type Requester = { id: string; tag: string };
const SEARCH_TIMEOUT_MS = 15_000;

export async function resolveMusicQuery(query: string, requester: Requester, config: MusicConfig) {
  const value = query.trim();
  if (!value) throw new Error("Digite um link ou o nome de uma música.");
  if (value.length > 300) throw new Error("A busca deve ter no máximo 300 caracteres.");

  if (looksLikeUrl(value)) {
    if (!config.allowLinks) throw new Error("Links estão desativados neste servidor.");
    if (!isYouTubeUrl(value)) throw new Error("Link inválido ou não suportado. Use um link do YouTube.");

    if (YouTube.isPlaylist(value)) {
      if (!config.allowPlaylists) throw new Error("Playlists estão desativadas neste servidor.");
      const playlist = await YouTube.getPlaylist(value, {
        fetchAll: false,
        limit: config.playlistLimit,
        requestOptions: requestOptions()
      });
      return uniqueValidTracks(playlist.videos, requester, config, "playlist").slice(0, config.playlistLimit);
    }

    const video = await YouTube.getVideo(value, requestOptions());
    return [toTrack(video, requester, config, "link")];
  }

  const videos = await YouTube.search(value, {
    limit: 8,
    type: "video",
    safeSearch: true,
    requestOptions: requestOptions()
  });
  const tracks = uniqueValidTracks(videos, requester, config, "search");
  if (!tracks.length) throw new Error("Música não encontrada ou fora dos limites configurados.");
  return [tracks[0]!];
}

export async function resolveArtist(artist: string, requester: Requester, config: MusicConfig) {
  const value = artist.trim();
  if (!config.allowArtistSearch) throw new Error("Busca de artistas está desativada neste servidor.");
  if (value.length < 2 || value.length > 100) throw new Error("Digite um nome de artista válido.");

  const videos = await YouTube.search(`${value} músicas`, {
    limit: Math.min(50, Math.max(config.artistLimit * 2, config.artistLimit)),
    type: "video",
    safeSearch: true,
    requestOptions: requestOptions()
  });
  const tracks = uniqueValidTracks(videos, requester, config, "artist").slice(0, config.artistLimit);
  if (!tracks.length) throw new Error("Não encontrei músicas reproduzíveis desse artista.");
  return tracks;
}

function uniqueValidTracks(videos: Video[], requester: Requester, config: MusicConfig, source: MusicTrack["source"]) {
  const result: MusicTrack[] = [];
  const seen = new Set<string>();

  for (const video of videos) {
    try {
      const track = toTrack(video, requester, config, source);
      const key = `${track.title.toLowerCase()}|${track.author.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(track);
      }
    } catch {
      // Resultados ao vivo, privados, indisponíveis ou longos são ignorados.
    }
  }
  return result;
}

function toTrack(video: Video, requester: Requester, config: MusicConfig, source: MusicTrack["source"]): MusicTrack {
  if (!video.id || !video.title || video.private || video.live) throw new Error("Música indisponível ou transmissão ao vivo.");
  if (!video.duration || video.duration > config.maxTrackMinutes * 60_000) {
    throw new Error(`A música excede o limite de ${config.maxTrackMinutes} minutos.`);
  }

  return {
    id: randomUUID(),
    title: video.title,
    author: video.channel?.name ?? "Canal desconhecido",
    durationMs: video.duration,
    url: video.url,
    thumbnail: video.thumbnail?.url ?? null,
    requestedById: requester.id,
    requestedByTag: requester.tag,
    addedAt: new Date(),
    source
  };
}

function looksLikeUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function requestOptions(): RequestInit {
  return { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) };
}
