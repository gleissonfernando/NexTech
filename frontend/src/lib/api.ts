import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import type {
  AccessValidationResult,
  AuthResponse,
  BotConnectionTest,
  ClipSent,
  ClipsConfig,
  CreateTwitchNotificationPayload,
  CreateDevBotPayload,
  DashboardMeResponse,
  DetectedDiscordGuild,
  DevBot,
  DevModuleDefinition,
  GuildLiveOptions,
  GuildSettings,
  LiveEvent,
  LogEntry,
  RegisterPrimaryDevBotPayload,
  SaveClipsConfigPayload,
  SocialNotification,
  Ticket,
  TwitchClipChannelPreview,
  TwitchChannelPreview,
  UpdateTwitchNotificationPayload
} from "../types";
import { publicOrigin } from "./urls";

export const API_URL = `${publicOrigin()}/api`;

export const api = axios.create({
  baseURL: API_URL,
  timeout: 12000,
  withCredentials: true
});

const VERIFICATION_STORAGE_KEY = "dashboard.tab_verification";

api.interceptors.request.use((config) => {
  const token = readTabVerification();

  if (token) {
    config.headers.set("x-dashboard-verification", token);
  }

  return config;
});

function botParams(botId?: string | null) {
  return botId ? { botId } : undefined;
}

function scopedBotGuildPath(botId: string, guildId: string, suffix: string) {
  return `/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}${suffix}`;
}

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
  synchronizeTabVerification(data);
  return data;
}

export async function refreshSession() {
  const { data } = await api.post<AuthResponse>("/auth/refresh");
  synchronizeTabVerification(data);
  return data;
}

export async function verifyAccess() {
  const { data } = await api.post<AuthResponse & { verificationToken: string }>("/auth/verify");
  storeTabVerification(data.verificationToken);
  return data;
}

export async function checkSiteAccess() {
  const { data } = await api.get<{ validation: AccessValidationResult }>("/auth/access-check");
  return data.validation;
}

export async function getDashboardMe() {
  const { data } = await api.get<DashboardMeResponse>("/dashboard/me");
  return data;
}

export async function updateSelectedDashboardGuild(selectedGuildId: string, botId?: string | null) {
  const { data } = await api.patch<{ selectedGuildId: string }>("/dashboard/selected-guild", {
    selectedGuildId,
    botId
  });
  return data.selectedGuildId;
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    clearTabVerification();
  }
}

function readTabVerification() {
  try {
    return window.sessionStorage.getItem(VERIFICATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeTabVerification(token: string) {
  try {
    window.sessionStorage.setItem(VERIFICATION_STORAGE_KEY, token);
  } catch {
    // Browsers with storage disabled will require verification again.
  }
}

function clearTabVerification() {
  try {
    window.sessionStorage.removeItem(VERIFICATION_STORAGE_KEY);
  } catch {
    // Nothing else is needed when storage is unavailable.
  }
}

function synchronizeTabVerification(auth: AuthResponse) {
  if (!auth.access.verified) {
    clearTabVerification();
  }
}

export async function getGuildSettings(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ settings: GuildSettings }>(`/settings/${guildId}`, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function getGuildLiveOptions(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ options: GuildLiveOptions }>(`/guilds/${guildId}/live-options`, {
    params: botParams(botId)
  });
  return data.options;
}

export async function patchGuildSettings(guildId: string, payload: Partial<GuildSettings>, botId?: string | null) {
  const { data } = await api.patch<{ settings: GuildSettings }>(`/settings/${guildId}`, payload, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function uploadWelcomeImage(guildId: string, file: File, botId?: string | null) {
  const { data } = await api.put<{ settings: GuildSettings }>(`/settings/${guildId}/welcome-image`, file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    params: botParams(botId),
    timeout: 30000
  });
  return data.settings;
}

export async function uploadLeaveImage(guildId: string, file: File, botId?: string | null) {
  const { data } = await api.put<{ settings: GuildSettings }>(`/settings/${guildId}/leave-image`, file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    params: botParams(botId),
    timeout: 30000
  });
  return data.settings;
}

export async function testWelcomePanel(guildId: string, botId?: string | null) {
  await api.post<{ ok: boolean }>(`/settings/${guildId}/welcome-test`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
}

export async function testLeavePanel(guildId: string, botId?: string | null) {
  await api.post<{ ok: boolean }>(`/settings/${guildId}/leave-test`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
}

export async function getLogs(guildId?: string, botId?: string | null) {
  const { data } = await api.get<{ logs: LogEntry[] }>("/logs", {
    params: {
      guildId,
      ...botParams(botId)
    }
  });
  return data.logs;
}

export async function getLives(guildId?: string, botId?: string | null) {
  const { data } = await api.get<{ lives: LiveEvent[] }>("/lives", {
    params: {
      guildId,
      ...botParams(botId)
    }
  });
  return data.lives;
}

export async function getTickets(guildId?: string, botId?: string | null) {
  const { data } = await api.get<{ tickets: Ticket[] }>("/tickets", {
    params: {
      guildId,
      ...botParams(botId)
    }
  });
  return data.tickets;
}

export async function getSocialNotifications(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ notifications: SocialNotification[] }>(
    botId ? scopedBotGuildPath(botId, guildId, "/lives") : `/social-notifications/${guildId}`,
    {
      params: botParams(botId)
    }
  );
  return data.notifications;
}

export async function getClipsConfig(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ config: ClipsConfig | null }>("/clips/config", {
    params: {
      guildId,
      ...botParams(botId)
    }
  });
  return data.config;
}

export async function saveClipsConfig(payload: SaveClipsConfigPayload, botId?: string | null) {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/config", payload, {
    params: botParams(botId)
  });
  return data.config;
}

export async function enableClips(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/enable", { guildId }, {
    params: botParams(botId)
  });
  return data.config;
}

export async function disableClips(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/disable", { guildId }, {
    params: botParams(botId)
  });
  return data.config;
}

export async function getClipsHistory(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ clips: ClipSent[] }>("/clips/history", {
    params: {
      guildId,
      ...botParams(botId)
    }
  });
  return data.clips;
}

export async function testClips(guildId: string, botId?: string | null) {
  await api.post<{ ok: boolean }>("/clips/test", { guildId }, {
    params: botParams(botId),
    timeout: 15000
  });
}

export async function validateClipTwitchChannel(channel: string) {
  const { data } = await api.get<{ channel: TwitchClipChannelPreview }>("/clips/validate-twitch", {
    params: {
      channel
    },
    timeout: 15000
  });
  return data.channel;
}

export async function createTwitchNotification(guildId: string, payload: CreateTwitchNotificationPayload, botId?: string | null) {
  const { data } = await api.post<{ notification: SocialNotification }>(
    botId ? scopedBotGuildPath(botId, guildId, "/lives") : `/social-notifications/${guildId}/twitch`,
    payload,
    {
      params: botParams(botId)
    }
  );
  return data.notification;
}

export async function previewTwitchChannel(guildId: string, twitchChannelInput: string, botId?: string | null) {
  const { data } = await api.post<{ preview: TwitchChannelPreview }>(
    botId ? scopedBotGuildPath(botId, guildId, "/lives/preview") : `/social-notifications/${guildId}/twitch/preview`,
    {
      twitchChannelInput
    },
    {
      params: botParams(botId)
    }
  );
  return data.preview;
}

export async function updateTwitchNotification(guildId: string, id: string, payload: UpdateTwitchNotificationPayload, botId?: string | null) {
  const { data } = botId
    ? await api.patch<{ notification: SocialNotification }>(scopedBotGuildPath(botId, guildId, `/lives/${id}`), payload)
    : await api.put<{ notification: SocialNotification }>(`/social-notifications/${guildId}/twitch/${id}`, payload, {
        params: botParams(botId)
      });
  return data.notification;
}

export async function testTwitchNotification(guildId: string, id: string, botId?: string | null) {
  await api.post<{ ok: boolean }>(
    botId ? scopedBotGuildPath(botId, guildId, `/lives/${id}/test`) : `/social-notifications/${guildId}/twitch/${id}/test`,
    undefined,
    {
      params: botParams(botId),
      timeout: 15000
    }
  );
}

export async function deleteTwitchNotification(guildId: string, id: string, botId?: string | null) {
  const { data } = await api.delete<{ notification: SocialNotification }>(
    botId ? scopedBotGuildPath(botId, guildId, `/lives/${id}`) : `/social-notifications/${guildId}/twitch/${id}`,
    {
      params: botParams(botId)
    }
  );
  return data.notification;
}

export async function getDevModules() {
  const { data } = await api.get<{ modules: DevModuleDefinition[] }>("/dev/modules");
  return data.modules;
}

export async function getDevBots() {
  const { data } = await api.get<{ bots: DevBot[] }>("/dev/bots");
  return data.bots;
}

export async function createDevBot(payload: CreateDevBotPayload) {
  const { data } = await api.post<{ bot: DevBot }>("/dev/bots/create", payload, {
    timeout: 16000
  });
  return data.bot;
}

export async function registerPrimaryDevBot(payload: RegisterPrimaryDevBotPayload) {
  const { data } = await api.post<{ bot: DevBot; created: boolean }>("/dev/bots/register-primary", payload, {
    timeout: 16000
  });
  return data;
}

export async function updateDevBotAccess(botId: string, payload: { ownerName?: string; ownerId?: string }) {
  const { data } = await api.patch<{ bot: DevBot }>(`/dev/bots/${botId}`, payload, {
    timeout: 16000
  });
  return data.bot;
}

export async function testDevBotConnection(token: string, clientId?: string) {
  const { data } = await api.post<BotConnectionTest>("/dev/bots/test-connection", { token, clientId: clientId || undefined }, {
    timeout: 16000
  });
  return data;
}

export async function detectDevBotGuild(token: string, guildId: string) {
  const { data } = await api.post<{ guild: DetectedDiscordGuild }>("/dev/bots/detect-guild", {
    token,
    guildId
  }, {
    timeout: 16000
  });
  return data.guild;
}

export async function updateDevBotModules(botId: string, enabledModules: string[]) {
  const { data } = await api.patch<{ bot: DevBot }>(`/dev/bots/${botId}/modules`, {
    enabledModules
  });
  return data.bot;
}

export async function restartDevBot(botId: string) {
  const { data } = await api.post<{ bot: DevBot }>(`/dev/bots/${botId}/restart`, undefined, {
    timeout: 16000
  });
  return data.bot;
}

export async function deleteDevBot(botId: string) {
  const { data } = await api.delete<{ bot: DevBot }>(`/dev/bots/${botId}`);
  return data.bot;
}
