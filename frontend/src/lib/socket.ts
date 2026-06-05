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

const configuredSocketUrl = normalizeUrl(import.meta.env.VITE_SOCKET_URL);

if (import.meta.env.PROD && isLocalHttpUrl(configuredSocketUrl)) {
  throw new Error("VITE_SOCKET_URL nao pode apontar para localhost em producao.");
}

export const SOCKET_URL = configuredSocketUrl ?? (import.meta.env.PROD ? window.location.origin : "http://localhost:4000");

export function createDashboardSocket() {
  return io(SOCKET_URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
  });
}
