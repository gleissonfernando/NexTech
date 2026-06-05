import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import type {
  AuthResponse,
  CreateTwitchNotificationPayload,
  GuildLiveOptions,
  GuildSettings,
  LiveEvent,
  LogEntry,
  SocialNotification,
  Ticket,
  UpdateTwitchNotificationPayload
} from "../types";

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

function resolveDevelopmentApiUrl() {
  const configuredApiUrl = normalizeUrl(import.meta.env.VITE_API_URL);

  if (configuredApiUrl && !isLocalHttpUrl(configuredApiUrl)) {
    return configuredApiUrl;
  }

  return isLocalBrowserOrigin() ? "http://localhost:4000/api" : "/api";
}

function resolveAuthUrl(apiUrl: string) {
  if (apiUrl === "/api") {
    return "/auth";
  }

  try {
    const authUrl = new URL(apiUrl, window.location.origin);
    const normalizedPath = authUrl.pathname.replace(/\/+$/, "");

    if (normalizedPath.endsWith("/api")) {
      authUrl.pathname = `${normalizedPath.slice(0, -"/api".length)}/auth`;
      authUrl.search = "";
      authUrl.hash = "";

      return normalizeUrl(authUrl.toString()) ?? "/auth";
    }
  } catch {
    // Keep the simple fallback below for relative or unusual API URLs.
  }

  return `${apiUrl.replace(/\/+$/, "")}/auth`;
}

export const API_URL = import.meta.env.PROD ? "/api" : resolveDevelopmentApiUrl();
export const AUTH_URL = import.meta.env.PROD ? "/auth" : resolveAuthUrl(API_URL);

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

let refreshPromise: Promise<AuthResponse> | null = null;

type RetryRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetryRequestConfig | undefined;

    if (!originalRequest || error.response?.status !== 401 || originalRequest._retry || originalRequest.url?.includes("/auth/refresh")) {
      throw error;
    }

    originalRequest._retry = true;
    refreshPromise ??= refreshSession().finally(() => {
      refreshPromise = null;
    });

    await refreshPromise;
    return api(originalRequest);
  }
);

export async function getSession() {
  const { data } = await api.get<AuthResponse>("/auth/me");
  return data;
}

export async function refreshSession() {
  const { data } = await api.post<AuthResponse>("/auth/refresh");
  return data;
}

export async function verifyAccess() {
  const { data } = await api.post<AuthResponse>("/auth/verify");
  return data;
}

export async function loginDev() {
  const { data } = await api.post<AuthResponse>("/auth/dev");
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function getGuildSettings(guildId: string) {
  const { data } = await api.get<{ settings: GuildSettings }>(`/settings/${guildId}`);
  return data.settings;
}

export async function getGuildLiveOptions(guildId: string) {
  const { data } = await api.get<{ options: GuildLiveOptions }>(`/guilds/${guildId}/live-options`);
  return data.options;
}

export async function patchGuildSettings(guildId: string, payload: Partial<GuildSettings>) {
  const { data } = await api.patch<{ settings: GuildSettings }>(`/settings/${guildId}`, payload);
  return data.settings;
}

export async function getLogs(guildId?: string) {
  const { data } = await api.get<{ logs: LogEntry[] }>("/logs", {
    params: {
      guildId
    }
  });
  return data.logs;
}

export async function getLives(guildId?: string) {
  const { data } = await api.get<{ lives: LiveEvent[] }>("/lives", {
    params: {
      guildId
    }
  });
  return data.lives;
}

export async function getTickets(guildId?: string) {
  const { data } = await api.get<{ tickets: Ticket[] }>("/tickets", {
    params: {
      guildId
    }
  });
  return data.tickets;
}

export async function getSocialNotifications(guildId: string) {
  const { data } = await api.get<{ notifications: SocialNotification[] }>(`/social-notifications/${guildId}`);
  return data.notifications;
}

export async function createTwitchNotification(guildId: string, payload: CreateTwitchNotificationPayload) {
  const { data } = await api.post<{ notification: SocialNotification }>(`/social-notifications/${guildId}/twitch`, payload);
  return data.notification;
}

export async function updateTwitchNotification(guildId: string, id: string, payload: UpdateTwitchNotificationPayload) {
  const { data } = await api.put<{ notification: SocialNotification }>(`/social-notifications/${guildId}/twitch/${id}`, payload);
  return data.notification;
}

export async function deleteTwitchNotification(guildId: string, id: string) {
  const { data } = await api.delete<{ notification: SocialNotification }>(`/social-notifications/${guildId}/twitch/${id}`);
  return data.notification;
}
