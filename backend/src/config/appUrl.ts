import { env } from "./env";

export const APP_BASE_URL = env.TRANSCRIPT_BASE_URL || env.APP_BASE_URL || "https://nextech.discloud.app";

export function buildAppUrl(path: string) {
  const baseUrl = APP_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return `${baseUrl}/${normalizedPath}`;
}

export function buildTranscriptUrl(transcriptId: string) {
  return buildAppUrl(`/transcripts/${encodeURIComponent(transcriptId)}`);
}
