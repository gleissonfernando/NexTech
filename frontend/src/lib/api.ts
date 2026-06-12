import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import type {
  AccessValidationResult,
  AuthResponse,
  ClipPlatform,
  ClipRankingEntry,
  ClipSent,
  ClipStats,
  ClipsConfig,
  CreateTwitchNotificationPayload,
  CreateKickNotificationPayload,
  CreateDevBotPayload,
  DashboardBot,
  DashboardMeResponse,
  DevBot,
  DevModuleDefinition,
  FivemFacAbsence,
  FivemFacResponse,
  FivemFacSettings,
  Giveaway,
  GiveawayEntryResult,
  GiveawayIdentity,
  GiveawaySpinResult,
  GuildLiveOptions,
  KickChannelPreview,
  KickIntegrationStatus,
  KickNotification,
  KickNotificationsPage,
  LivePanelPreview,
  GuildMemberOption,
  GuildRoleOption,
  GuildSettings,
  ImageAntiSpamResponse,
  ImageAntiSpamSettings,
  LiveEvent,
  LogEntry,
  PublicKickClips,
  SaveClipsConfigPayload,
  SaveFivemFacSettingsPayload,
  SaveGiveawayPayload,
  SaveImageAntiSpamSettingsPayload,
  SaveSocialPanelPayload,
  SocialMember,
  SocialMemberPayload,
  SocialNetworkResponse,
  SocialNotification,
  SocialNotificationsPage,
  SocialPanel,
  Ticket,
  KickClipChannelPreview,
  TwitchClipChannelPreview,
  TwitchChannelPreview,
  UpdateSocialMemberPayload,
  UpdateTwitchNotificationPayload,
  UpdateKickNotificationPayload,
  SaveXAccountPayload,
  UpdateXAccountPayload,
  XAccount,
  XAccountPreview,
  XMonitorResponse
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

export async function verifyAccess(botSlug?: string | null) {
  const { data } = await api.post<AuthResponse & { verificationToken: string }>(
    "/auth/verify",
    botSlug ? { botSlug } : undefined
  );
  storeTabVerification(data.verificationToken);
  return data;
}

export async function checkSiteAccess(botSlug?: string | null) {
  const { data } = await api.get<{ validation: AccessValidationResult }>("/auth/access-check", {
    params: botSlug ? { botSlug } : undefined
  });
  return data.validation;
}

export async function getDashboardMe() {
  const { data } = await api.get<DashboardMeResponse>("/dashboard/me");
  return data;
}

export async function getDashboardBySlug(slug: string) {
  const { data } = await api.get<DashboardMeResponse & { selectedBot: DashboardBot }>(`/dashboard/${encodeURIComponent(slug)}`);
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

export async function getGuildRoleOptions(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ roles: GuildRoleOption[] }>(`/guilds/${guildId}/role-options`, {
    params: botParams(botId)
  });
  return data.roles;
}

export async function getGuildMemberOptions(guildId: string, query: string, botId?: string | null) {
  const { data } = await api.get<{ members: GuildMemberOption[] }>(`/guilds/${guildId}/member-options`, {
    params: {
      query,
      ...botParams(botId)
    }
  });
  return data.members;
}

export async function patchGuildSettings(guildId: string, payload: Partial<GuildSettings>, botId?: string | null) {
  const { data } = await api.patch<{ settings: GuildSettings }>(`/settings/${guildId}`, payload, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function getImageAntiSpam(guildId: string, botId: string) {
  const { data } = await api.get<ImageAntiSpamResponse>(
    `/image-anti-spam/${guildId}`,
    {
      params: botParams(botId)
    }
  );
  return data;
}

export async function saveImageAntiSpamSettings(
  guildId: string,
  botId: string,
  payload: SaveImageAntiSpamSettingsPayload
) {
  const { data } = await api.patch<{ settings: ImageAntiSpamSettings }>(
    `/image-anti-spam/${guildId}`,
    payload,
    {
      params: botParams(botId)
    }
  );
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

export async function getSocialNotifications(
  guildId: string,
  botId?: string | null,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}
) {
  const { data } = await api.get<SocialNotificationsPage>(
    botId ? scopedBotGuildPath(botId, guildId, "/lives") : `/social-notifications/${guildId}`,
    {
      params: {
        ...botParams(botId),
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 25,
        search: options.search || undefined
      }
    }
  );
  return data;
}

export async function getClipsConfig(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.get<{ config: ClipsConfig | null }>("/clips/config", {
    params: {
      guildId,
      platform,
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

export async function enableClips(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/enable", { guildId, platform }, {
    params: botParams(botId)
  });
  return data.config;
}

export async function disableClips(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/disable", { guildId, platform }, {
    params: botParams(botId)
  });
  return data.config;
}

export async function getClipsHistory(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch", filter = "all") {
  const { data } = await api.get<{ clips: ClipSent[] }>("/clips/history", {
    params: {
      guildId,
      filter,
      platform,
      ...botParams(botId)
    }
  });
  return data.clips;
}

export async function getClipsRanking(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch", filter = "all") {
  const { data } = await api.get<{ ranking: ClipRankingEntry[] }>("/clips/ranking", {
    params: {
      guildId,
      filter,
      platform,
      ...botParams(botId)
    }
  });
  return data.ranking;
}

export async function getClipsStats(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.get<{ stats: ClipStats }>("/clips/stats", {
    params: {
      guildId,
      platform,
      ...botParams(botId)
    }
  });
  return data.stats;
}

export async function getPublicKickClips(channel: string) {
  const { data } = await api.get<PublicKickClips>(`/clips/public/kick/${encodeURIComponent(channel)}`, {
    timeout: 15000
  });
  return data;
}

export async function testClips(guildId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  await api.post<{ ok: boolean }>("/clips/test", { guildId, platform }, {
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

export async function validateClipKickChannel(guildId: string, channel: string, botId?: string | null) {
  const { data } = await api.get<{ channel: KickClipChannelPreview }>("/clips/validate-kick", {
    params: {
      channel,
      guildId,
      ...botParams(botId)
    },
    timeout: 15000
  });
  return data.channel;
}

export async function getGiveaways(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ giveaways: Giveaway[] }>(`/giveaways/${guildId}`, {
    params: botParams(botId)
  });
  return data.giveaways;
}

export function giveawayConnectUrl(token: string, platform: "twitch" | "kick") {
  return `${API_URL}/giveaways/roulette/${encodeURIComponent(token)}/connect/${platform}`;
}

export async function getGiveawayIdentity(token: string) {
  const { data } = await api.get<{ identity: GiveawayIdentity }>(`/giveaways/roulette/${encodeURIComponent(token)}/identity`, {
    timeout: 15000
  });
  return data.identity;
}

export async function enterRouletteGiveaway(token: string) {
  const { data } = await api.post<GiveawayEntryResult>(`/giveaways/roulette/${encodeURIComponent(token)}/entry`, undefined, {
    timeout: 30000
  });
  return data;
}

export async function createGiveaway(guildId: string, payload: SaveGiveawayPayload, botId?: string | null) {
  const { data } = await api.post<{ giveaway: Giveaway }>(`/giveaways/${guildId}`, payload, {
    params: botParams(botId),
    timeout: 20000
  });
  return data.giveaway;
}

export async function updateGiveaway(guildId: string, giveawayId: string, payload: SaveGiveawayPayload, botId?: string | null) {
  const { data } = await api.patch<{ giveaway: Giveaway }>(`/giveaways/${guildId}/${giveawayId}`, payload, {
    params: botParams(botId),
    timeout: 20000
  });
  return data.giveaway;
}

export async function publishGiveawayPanel(guildId: string, giveawayId: string, botId?: string | null) {
  const { data } = await api.post<{ giveaway: Giveaway }>(`/giveaways/${guildId}/${giveawayId}/panel`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.giveaway;
}

export async function startGiveaway(guildId: string, giveawayId: string, botId?: string | null) {
  const { data } = await api.post<{ giveaway: Giveaway }>(`/giveaways/${guildId}/${giveawayId}/start`, undefined, {
    params: botParams(botId),
    timeout: 30000
  });
  return data.giveaway;
}

export async function endGiveaway(guildId: string, giveawayId: string, botId?: string | null) {
  const { data } = await api.post<{ giveaway: Giveaway }>(`/giveaways/${guildId}/${giveawayId}/end`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.giveaway;
}

export async function syncGiveawayParticipants(guildId: string, giveawayId: string, botId?: string | null) {
  const { data } = await api.post<{ giveaway: Giveaway }>(`/giveaways/${guildId}/${giveawayId}/sync`, undefined, {
    params: botParams(botId),
    timeout: 45000
  });
  return data.giveaway;
}

export async function getRouletteGiveaway(token: string) {
  const { data } = await api.get<{ giveaway: Giveaway }>(`/giveaways/roulette/${encodeURIComponent(token)}`, {
    timeout: 15000
  });
  return data.giveaway;
}

export async function spinRoulette(token: string) {
  const { data } = await api.post<GiveawaySpinResult>(`/giveaways/roulette/${encodeURIComponent(token)}/spin`, undefined, {
    timeout: 30000
  });
  return data;
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

export async function previewTwitchNotificationPanel(guildId: string, id: string, botId?: string | null) {
  const { data } = await api.get<{ preview: LivePanelPreview }>(
    botId
      ? scopedBotGuildPath(botId, guildId, `/lives/${id}/panel-preview`)
      : `/social-notifications/${guildId}/twitch/${id}/panel-preview`,
    {
      params: botParams(botId),
      timeout: 15000
    }
  );
  return data.preview;
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

export async function getKickIntegrationStatus(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ status: KickIntegrationStatus }>(`/kick-integration/${guildId}/status`, {
    params: botParams(botId)
  });
  return data.status;
}

export async function validateKickApi(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ message: string }>(`/kick-integration/${guildId}/api/validate`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.message;
}

export async function saveKickApiConfig(
  guildId: string,
  payload: {
    clientId: string;
    clientSecret?: string | null;
    redirectUri?: string | null;
  },
  botId?: string | null
) {
  const { data } = await api.put<{ message: string }>(`/kick-integration/${guildId}/api/config`, payload, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.message;
}

export async function getKickNotifications(
  guildId: string,
  botId?: string | null,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}
) {
  const { data } = await api.get<KickNotificationsPage>(`/kick-integration/${guildId}`, {
    params: {
      ...botParams(botId),
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 25,
      search: options.search || undefined
    }
  });
  return data;
}

export async function createKickNotification(guildId: string, payload: CreateKickNotificationPayload, botId?: string | null) {
  const { data } = await api.post<{ notification: KickNotification }>(`/kick-integration/${guildId}/channels`, payload, {
    params: botParams(botId)
  });
  return data.notification;
}

export async function previewKickChannel(guildId: string, kickChannelInput: string, botId?: string | null) {
  const { data } = await api.post<{ preview: KickChannelPreview }>(
    `/kick-integration/${guildId}/preview`,
    {
      kickChannelInput
    },
    {
      params: botParams(botId)
    }
  );
  return data.preview;
}

export async function updateKickNotification(guildId: string, id: string, payload: UpdateKickNotificationPayload, botId?: string | null) {
  const { data } = await api.patch<{ notification: KickNotification }>(`/kick-integration/${guildId}/channels/${id}`, payload, {
    params: botParams(botId)
  });
  return data.notification;
}

export async function testKickNotification(guildId: string, id: string, botId?: string | null) {
  await api.post<{ ok: boolean }>(`/kick-integration/${guildId}/channels/${id}/test`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
}

export async function previewKickNotificationPanel(guildId: string, id: string, botId?: string | null) {
  const { data } = await api.get<{ preview: LivePanelPreview }>(
    `/kick-integration/${guildId}/channels/${id}/panel-preview`,
    {
      params: botParams(botId),
      timeout: 15000
    }
  );
  return data.preview;
}

export async function deleteKickNotification(guildId: string, id: string, botId?: string | null) {
  const { data } = await api.delete<{ notification: KickNotification }>(`/kick-integration/${guildId}/channels/${id}`, {
    params: botParams(botId)
  });
  return data.notification;
}

export async function getMemberSocialNetwork(guildId: string, botId?: string | null) {
  const { data } = await api.get<SocialNetworkResponse>(`/socials/${guildId}`, {
    params: botParams(botId)
  });
  return data;
}

export async function createSocialMember(guildId: string, payload: SocialMemberPayload, botId?: string | null) {
  const { data } = await api.post<{ member: SocialMember }>(`/socials/${guildId}/members`, payload, {
    params: botParams(botId)
  });
  return data.member;
}

export async function updateSocialMember(guildId: string, memberId: string, payload: UpdateSocialMemberPayload, botId?: string | null) {
  const { data } = await api.patch<{ member: SocialMember }>(`/socials/${guildId}/members/${memberId}`, payload, {
    params: botParams(botId)
  });
  return data.member;
}

export async function deleteSocialMember(guildId: string, memberId: string, botId?: string | null) {
  const { data } = await api.delete<{ member: SocialMember }>(`/socials/${guildId}/members/${memberId}`, {
    params: botParams(botId)
  });
  return data.member;
}

export async function saveSocialPanel(guildId: string, payload: SaveSocialPanelPayload, botId?: string | null) {
  const { data } = await api.put<{ panel: SocialPanel }>(`/socials/${guildId}/panel`, payload, {
    params: botParams(botId)
  });
  return data.panel;
}

export async function publishSocialPanel(guildId: string, payload: Partial<SaveSocialPanelPayload>, botId?: string | null) {
  const { data } = await api.post<SocialNetworkResponse>("/socials/update", {
    guildId,
    ...payload
  }, {
    params: botParams(botId),
    timeout: 15000
  });
  return data;
}

export async function testSocialPanel(guildId: string, payload: SaveSocialPanelPayload, botId?: string | null) {
  await api.post<{ ok: boolean; messageId?: string | null }>(`/socials/${guildId}/panel/test`, payload, {
    params: botParams(botId),
    timeout: 15000
  });
}

export async function removeSocialPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ panel: SocialPanel | null }>(`/socials/${guildId}/panel/remove`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.panel;
}

export async function getXMonitor(guildId: string, botId?: string | null) {
  const { data } = await api.get<XMonitorResponse>(`/x-monitor/${guildId}`, {
    params: botParams(botId)
  });
  return data;
}

export async function verifyXAccount(guildId: string, username: string, botId?: string | null) {
  const { data } = await api.post<{ profile: XAccountPreview }>(`/x-monitor/${guildId}/verify`, {
    username
  }, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.profile;
}

export async function createXAccount(guildId: string, payload: SaveXAccountPayload, botId?: string | null) {
  const { data } = await api.post<{ account: XAccount }>(`/x-monitor/${guildId}/accounts`, payload, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.account;
}

export async function updateXAccount(guildId: string, accountId: string, payload: UpdateXAccountPayload, botId?: string | null) {
  const { data } = await api.patch<{ account: XAccount }>(`/x-monitor/${guildId}/accounts/${accountId}`, payload, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.account;
}

export async function deleteXAccount(guildId: string, accountId: string, botId?: string | null) {
  const { data } = await api.delete<{ account: XAccount }>(`/x-monitor/${guildId}/accounts/${accountId}`, {
    params: botParams(botId)
  });
  return data.account;
}

export async function getFivemFac(guildId: string, botId: string) {
  const { data } = await api.get<FivemFacResponse>(`/fivem/${guildId}/fac`, {
    params: botParams(botId)
  });
  return data;
}

export async function getFivemFacOptions(guildId: string, botId: string) {
  const { data } = await api.get<{ options: GuildLiveOptions }>(`/fivem/${guildId}/fac/options`, {
    params: botParams(botId)
  });
  return data.options;
}

export async function saveFivemFacSettings(guildId: string, botId: string, payload: SaveFivemFacSettingsPayload) {
  const { data } = await api.patch<{ settings: FivemFacSettings }>(`/fivem/${guildId}/fac`, payload, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function publishFivemFacPanel(guildId: string, botId: string) {
  const { data } = await api.post<{ settings: FivemFacSettings }>(`/fivem/${guildId}/fac/panel`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.settings;
}

export async function uploadFivemFacAbsencePhoto(guildId: string, botId: string, absenceId: string, file: File) {
  const { data } = await api.put<{ absence: FivemFacAbsence }>(
    `/fivem/${guildId}/fac/absences/${absenceId}/photo`,
    file,
    {
      headers: {
        "Content-Type": file.type || "application/octet-stream"
      },
      params: botParams(botId),
      timeout: 30000
    }
  );
  return data.absence;
}

export async function removeFivemFacAbsencePhoto(guildId: string, botId: string, absenceId: string) {
  const { data } = await api.delete<{ absence: FivemFacAbsence }>(
    `/fivem/${guildId}/fac/absences/${absenceId}/photo`,
    {
      params: botParams(botId)
    }
  );
  return data.absence;
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

export async function stopDevBot(botId: string) {
  const { data } = await api.post<{ bot: DevBot }>(`/dev/bots/${botId}/stop`, undefined, {
    timeout: 16000
  });
  return data.bot;
}

export async function deleteDevBot(botId: string) {
  const { data } = await api.delete<{ bot: DevBot }>(`/dev/bots/${botId}`);
  return data.bot;
}
