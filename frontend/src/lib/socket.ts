import { io } from "socket.io-client";

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

function resolveDevelopmentSocketUrl() {
  const configuredSocketUrl = normalizeUrl(import.meta.env.VITE_SOCKET_URL);

  if (configuredSocketUrl && !isLocalHttpUrl(configuredSocketUrl)) {
    return configuredSocketUrl;
  }

  return isLocalBrowserOrigin() ? "http://localhost:4000" : window.location.origin;
}

export const SOCKET_URL = import.meta.env.PROD ? window.location.origin : resolveDevelopmentSocketUrl();

export function createDashboardSocket() {
  return io(SOCKET_URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
}
