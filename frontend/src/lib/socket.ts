import { io } from "socket.io-client";

const PUBLIC_FRONTEND_URL = "https://ricardinho98.shardweb.app";

function normalizeUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") || "/" : undefined;
}

function isLocalHttpUrl(value?: string) {
  if (!value || !/^https?:\/\//i.test(value)) {
    return false;
  }

  const url = new URL(value);
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
}

function isLocalBrowserOrigin() {
  return isLocalHttpUrl(window.location.origin);
}

function publicOrigin() {
  const configuredPublicUrl = normalizeUrl(import.meta.env.VITE_FRONTEND_URL);

  if (configuredPublicUrl && !isLocalHttpUrl(configuredPublicUrl)) {
    return configuredPublicUrl;
  }

  return PUBLIC_FRONTEND_URL;
}

function resolveDevelopmentSocketUrl() {
  const configuredSocketUrl = normalizeUrl(import.meta.env.VITE_SOCKET_URL);

  if (configuredSocketUrl && !isLocalHttpUrl(configuredSocketUrl)) {
    return configuredSocketUrl;
  }

  return isLocalBrowserOrigin() ? publicOrigin() : window.location.origin;
}

export const SOCKET_URL = import.meta.env.PROD ? window.location.origin : resolveDevelopmentSocketUrl();

export function createDashboardSocket() {
  return io(SOCKET_URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
}
