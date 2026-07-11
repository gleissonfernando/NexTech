import { env } from "../config/env";
import type { BotContext } from "../types";

type TranscriptCreateResult = Awaited<ReturnType<BotContext["api"]["createTranscript"]>>;

export function buildAppUrl(path: string) {
  const baseUrl = (env.TRANSCRIPT_BASE_URL || env.APP_BASE_URL || env.FRONTEND_URL || "https://nextech.discloud.app").replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return `${baseUrl}/${normalizedPath}`;
}

export function buildTranscriptUrl(transcriptId: string) {
  return buildAppUrl(`/transcripts/${encodeURIComponent(transcriptId)}`);
}

export function resolveTranscriptUrl(transcript: TranscriptCreateResult) {
  return transcript.publicUrl
    || transcript.transcript.publicUrl
    || buildTranscriptUrl(transcript.transcript.id);
}
