import { Readable } from "node:stream";
import ytdl from "@distube/ytdl-core";
import play from "play-dl";
import prism from "prism-media";
import { StreamType } from "@discordjs/voice";
import type { MusicTrack } from "./types";
import { getYouTubeAgent } from "./youtubeAuth";
import { assertPublicHttpUrl } from "./searchManager";

const CONNECT_TIMEOUT_MS = 20_000;
let ffmpegValidated = false;

export async function createTrackStream(track: MusicTrack) {
  if (track.provider === "youtube") {
    return {
      stream: ytdl(track.url, {
        agent: getYouTubeAgent(),
        filter: (format) => format.hasAudio && !format.hasVideo && format.container === "webm",
        highWaterMark: 1 << 25,
        quality: "highestaudio"
      }),
      inputType: StreamType.WebmOpus
    };
  }

  if (track.provider === "soundcloud") {
    const result = await withTimeout(play.stream(track.url), CONNECT_TIMEOUT_MS, "O stream do SoundCloud não respondeu a tempo.");
    const inputType = discordStreamType(result.type);
    if (inputType === StreamType.Arbitrary) ensureFfmpeg();
    return {
      stream: result.stream,
      inputType
    };
  }

  ensureFfmpeg();
  return {
    stream: await openDirectStream(track.url),
    inputType: StreamType.Arbitrary
  };
}

function ensureFfmpeg() {
  if (ffmpegValidated) return;
  const info = prism.FFmpeg.getInfo();
  ffmpegValidated = true;
  console.log(`[music] FFmpeg pronto: ${info.version ?? "versão detectada"}.`);
}

async function openDirectStream(initialUrl: string) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const url = await assertPublicHttpUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    timer.unref();
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("O servidor de áudio retornou um redirecionamento inválido.");
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Não foi possível abrir o áudio direto (HTTP ${response.status}).`);
    return Readable.fromWeb(response.body as never);
  }
  throw new Error("O link de áudio possui redirecionamentos demais.");
}

function discordStreamType(type: string) {
  if (type === "webm/opus") return StreamType.WebmOpus;
  if (type === "ogg/opus") return StreamType.OggOpus;
  if (type === "raw") return StreamType.Raw;
  return StreamType.Arbitrary;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
  try { return await Promise.race([promise, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
