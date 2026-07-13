import { env } from "./env";

const DEFAULT_PUBLIC_URL = "https://nextech.discloud.app";

function normalizePublicBaseUrl(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\/+$/, "");
  return normalized || DEFAULT_PUBLIC_URL;
}

export const APP_BASE_URL = normalizePublicBaseUrl(
  env.APP_BASE_URL || env.TRANSCRIPT_BASE_URL || DEFAULT_PUBLIC_URL
);
export const TRANSCRIPT_BASE_URL = normalizePublicBaseUrl(
  env.TRANSCRIPT_BASE_URL || env.APP_BASE_URL || APP_BASE_URL
);

export function buildAppUrl(path: string) {
  const baseUrl = APP_BASE_URL;
  const normalizedPath = path.replace(/^\/+/, "");

  return `${baseUrl}/${normalizedPath}`;
}

export function buildTranscriptUrl(transcriptId: string) {
  const normalizedPath = `transcripts/${encodeURIComponent(transcriptId)}`;
  return `${TRANSCRIPT_BASE_URL}/${normalizedPath}`;
}
