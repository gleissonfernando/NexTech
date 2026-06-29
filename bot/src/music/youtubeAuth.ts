import ytdl from "@distube/ytdl-core";
import { env } from "../config/env";

type YouTubeCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
  hostOnly?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: string;
};

let cachedAgent: ReturnType<typeof ytdl.createAgent> | undefined;
let cookiesLoaded = false;
let cachedCookieHeader: string | null = null;

export function getYouTubeAgent() {
  loadCookies();
  return cachedAgent;
}

export function getYouTubeCookieHeader() {
  loadCookies();
  return cachedCookieHeader;
}

export function hasYouTubeCookies() {
  loadCookies();
  return Boolean(cachedAgent);
}

function loadCookies() {
  if (cookiesLoaded) return;
  cookiesLoaded = true;

  const raw = env.YOUTUBE_COOKIES_JSON.trim()
    || decodeBase64(env.YOUTUBE_COOKIES_B64.trim());
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("o valor precisa ser um array JSON");

    const cookies = parsed.filter(isYouTubeCookie).slice(0, 300);
    if (!cookies.length) throw new Error("nenhum cookie valido foi encontrado");

    cachedAgent = ytdl.createAgent(cookies);
    cachedCookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    console.log(`[music] sessao do YouTube carregada com ${cookies.length} cookie(s).`);
  } catch (error) {
    console.warn("[music] YOUTUBE_COOKIES_JSON/YOUTUBE_COOKIES_B64 invalido:", error instanceof Error ? error.message : error);
  }
}

function isYouTubeCookie(value: unknown): value is YouTubeCookie {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cookie = value as Record<string, unknown>;
  return typeof cookie.name === "string"
    && cookie.name.length > 0
    && typeof cookie.value === "string";
}

function decodeBase64(value: string) {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}
