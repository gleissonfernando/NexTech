import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import type {
  AccessValidationResult,
  AdvancedModuleConfig,
  AutoActivityClockCity,
  AutoActivityClockDashboard,
  AutoActivityClockSettings,
  ApplicationEmojiPage,
  ApplicationEmojiSettings,
  ApplicationEmojiSyncResult,
  AuthResponse,
  ClipPlatform,
  ClipsConfigPage,
  ClipRankingEntry,
  ClipSent,
  ClipStats,
  ClipsConfig,
  CreateTwitchNotificationPayload,
  CreateKickNotificationPayload,
  BotGuildConfig,
  CreateDevBotPayload,
  Course,
  CourseExamDashboard,
  CourseExamQuestion,
  CourseHistorySettings,
  CourseInstructorTrackingSettings,
  CoursesDashboard,
  DashboardBot,
  DashboardMeResponse,
  DevAccessEntry,
  DevAccessRole,
  DevBot,
  DiscloudLogsResponse,
  DiscloudMonitoringResponse,
  DevModuleDefinition,
  FivemFacAbsence,
  FivemFacResponse,
  FivemFacSettings,
  FivemGoalConfig,
  FivemGoalDashboard,
  FivemGoalSettings,
  FivemGoalSubmission,
  FivemHierarchyDashboard,
  FivemHierarchyPanel,
  FivemModuleDefinition,
  FivemOrderDashboard,
  FivemOrderProduct,
  FivemOrderSettings,
  FivemOrderStatus,
  Giveaway,
  GiveawayDiagnostics,
  GiveawayEntryResult,
  GiveawayIdentity,
  GiveawayLivePreview,
  GiveawaySpinResult,
  GlobalBlacklistDashboard,
  GlobalBlacklistSafeBotSettings,
  GuildLiveOptions,
  HierarchyForwardingRule,
  KickChannelPreview,
  KickIntegrationStatus,
  KickNotification,
  KickNotificationsPage,
  LivePanelPreview,
  GuildMemberOption,
  GuildRoleOption,
  GuildSettings,
  EmojiLibraryItem,
  EmojiCloneRemoteEmoji,
  ImageAntiSpamResponse,
  ImageAntiSpamSettings,
  LiveDetectionSettings,
  LiveEvent,
  LogEntry,
  SystemHealthResponse,
  SystemMetricsResponse,
  ManualPaymentsDashboard,
  ManualRegistrationDashboard,
  ManualRegistrationSettings,
  ManualRegistrationSubmission,
  MessageControlDashboard,
  MessageControlSettings,
  MessageControlStatus,
  MessageControlUser,
  MercadoPagoConnectionTest,
  MissionToolsResponse,
  MissionToolsSettings,
  MissionToolsUserPanel,
  MaintenanceState,
  BotCredential,
  CustomerPlansDashboard,
  DevPlansDashboard,
  NexTechSale,
  NexTechSaleStatus,
  NexTechProduct,
  NexTechInviteDashboard,
  NexTechInvite,
  NexTechSalesDashboard,
  NexTechSalesPlan,
  NexTechSalesSettings,
  SalesTicketDashboard,
  SalesTicketSettings,
  SalesTicketType,
  OpenDutyDashboard,
  PanelImageSettings,
  Pd7Dashboard,
  Pd7Settings,
  PoliceTimeClockDashboard,
  PoliceTimeClockSettings,
  PriceTable,
  PriceTablesDashboard,
  PublicNexTechProduct,
  PublicKickClips,
  RhAdminDashboard,
  SaveClipsConfigPayload,
  SaveCoursePayload,
  SaveCourseExamQuestionPayload,
  SaveCourseExamSettingsPayload,
  SaveCourseSettingsPayload,
  SaveFivemFacSettingsPayload,
  SaveManualPaymentSettingsPayload,
  SavePaymentSettingsPayload,
  SavePlanFeaturePayload,
  SavePlanPayload,
  SaveZtkRewardPayload,
  SaveZtkWebhookClanPayload,
  SaveFivemModulePayload,
  SaveGiveawayPayload,
  SaveImageAntiSpamSettingsPayload,
  SaveMissionToolsSettingsPayload,
  SaveNexTechPaymentProviderPayload,
  SaveNexTechProductPayload,
  SaveNexTechInvitePayload,
  SaveNexTechSalePayload,
  SaveNexTechSalesPlanPayload,
  SaveNexTechSalesSettingsPayload,
  SaveSalesTicketSettingsPayload,
  SaveSalesTicketTypePayload,
  SaveOpenDutySettingsPayload,
  SavePanelImageSettingsPayload,
  SavePriceTablePayload,
  SaveRhAdminSettingsPayload,
  SaveSelfBotProtectionSettingsPayload,
  SaveSocialPanelPayload,
  SaveSystemEmojiPayload,
  SaveVoiceRecorderSettingsPayload,
  ServerBackupDashboard,
  ServerBackupRestorePart,
  ServerBackupRestorePreview,
  ServerBackupSettings,
  ServerBackupSnapshot,
  Plan,
  PlanFeature,
  PlanSubscription,
  WorkspacePlanDashboard,
  SelfBotProtectionResponse,
  SelfBotProtectionSettings,
  SocialMember,
  SocialMemberPayload,
  SocialNetworkResponse,
  SocialNotification,
  SocialNotificationsPage,
  SocialPanel,
  SystemEmojiDashboard,
  Ticket,
  KickClipChannelPreview,
  TwitchClipChannelPreview,
  TwitchChannelPreview,
  UpdateSocialMemberPayload,
  UpdateTwitchNotificationPayload,
  UpdateKickNotificationPayload,
  SaveXAccountPayload,
  UpdateXAccountPayload,
  VoiceRecorderResponse,
  VoiceRecording,
  XAccount,
  XAccountPreview,
  XMonitorResponse,
  ZtkReward,
  ZtkWebhookClan,
  ZtkWebhookDashboard
} from "../types";
import { buildEditableFivemHierarchyPanelPayload, hierarchyPanelClientRequestId } from "./fivemHierarchy";
import { publicOrigin } from "./urls";

export const API_URL = (
  import.meta.env.VITE_API_URL
  || `${publicOrigin()}/api`
  || "https://nextech.discloud.app/api"
).replace(/\/+$/, "");

export const api = axios.create({
  baseURL: API_URL,
  timeout: 12000,
  withCredentials: true
});

let tabVerificationToken: string | null = null;

clearLegacyTabVerificationStorage();

api.interceptors.request.use((config) => {
  const token = readTabVerification();

  if (token) {
    config.headers.set("x-dashboard-verification", token);
  }

  if (window.location.pathname === "/dev" || window.location.pathname.startsWith("/dev/")) {
    config.headers.set("x-dev-dashboard", "true");
  }

  return config;
});

function botParams(botId?: string | null) {
  return botId ? { botId } : undefined;
}

function scopedBotGuildPath(botId: string, guildId: string, suffix: string) {
  return `/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}${suffix}`;
}

type RetryRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetryRequestConfig | undefined;
    const responseStatus = error.response?.status;
    const responseData = error.response?.data as { message?: unknown; supportUrl?: unknown } | undefined;
    const responseMessage = typeof responseData?.message === "string" ? responseData.message : "";

    if (
      responseStatus === 403
      && typeof window !== "undefined"
      && (typeof responseData?.supportUrl === "string" || responseMessage.includes("Você não possui acesso a esta dashboard"))
    ) {
      window.dispatchEvent(new CustomEvent("dashboard:access-denied", {
        detail: {
          message: responseMessage || "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte."
        }
      }));
    }

    if (!originalRequest || responseStatus !== 401 || originalRequest._retry) {
      throw error;
    }

    originalRequest._retry = true;
    clearTabVerification();
    throw error;
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

export async function getDashboardMaintenanceState() {
  const { data } = await api.get<{ maintenance: MaintenanceState }>("/dashboard/maintenance");
  return data.maintenance;
}

export async function updateSelectedDashboardGuild(selectedGuildId: string, botId?: string | null) {
  const { data } = await api.patch<{ selectedGuildId: string }>("/dashboard/selected-guild", {
    selectedGuildId,
    botId
  });
  return data.selectedGuildId;
}

export async function getPublicPlans() {
  const { data } = await api.get<{ plans: Plan[] }>("/plans");
  return data.plans;
}

export async function getPublicPlan(slug: string) {
  const { data } = await api.get<{ plan: Plan }>(`/plans/${encodeURIComponent(slug)}`);
  return data.plan;
}

export async function getCustomerPlansDashboard() {
  const { data } = await api.get<CustomerPlansDashboard>("/customer/plans-dashboard");
  return data;
}

export async function getCustomerPaymentOrder(orderId: string) {
  const { data } = await api.get<{
    order: import("../types").PaymentOrder;
    plan: Plan | null;
    subscription: import("../types").PlanSubscription | null;
  }>(`/customer/payment-orders/${encodeURIComponent(orderId)}`);
  return data;
}

export async function createPlanCheckoutInterest(planId: string, paymentMethod: "checkout" | "pix" = "checkout") {
  const { data } = await api.post<{
    success?: boolean;
    orderId?: string;
    environment?: "test" | "production" | null;
    order: import("../types").PaymentOrder;
    payment: { enabled: boolean; message: string | null; provider: import("../types").PaymentProvider };
    plan: Plan;
  }>("/payments/mercadopago/checkout", {
    paymentMethod,
    planId
  });
  return data;
}

export async function getPaymentOrderStatus(orderId: string) {
  const { data } = await api.get<{
    order: import("../types").PaymentOrder;
    plan: Plan | null;
    subscription: import("../types").PlanSubscription | null;
  }>(`/payments/orders/${encodeURIComponent(orderId)}/status`);
  return data;
}

export async function retryPaymentOrder(orderId: string) {
  const { data } = await api.post<{ order: import("../types").PaymentOrder }>(
    `/payments/orders/${encodeURIComponent(orderId)}/retry`
  );
  return data.order;
}

export async function getBotRegistrationStatus(orderId?: string | null) {
  const { data } = await api.get<{
    activeSubscription: import("../types").PlanSubscription | null;
    canRegister: boolean;
    dashboardBaseUrl: string;
    message: string | null;
    workspace: import("../types").PlanWorkspace | null;
  }>("/bot-registration/status", {
    params: orderId ? { orderId } : undefined
  });
  return data;
}

export async function verifyAndRegisterBot(payload: { guildId: string; slug?: string | null; token: string }) {
  const { data } = await api.post<{
    bot: BotCredential;
    dashboardUrl: string;
    server: { iconUrl: string | null; id: string; name: string };
  }>("/bot-registration/verify", payload, {
    timeout: 30000
  });
  return data;
}

export async function getWorkspacePlanDashboard(workspaceId: string) {
  const { data } = await api.get<WorkspacePlanDashboard>(`/workspaces/${encodeURIComponent(workspaceId)}`);
  return data;
}

export async function createWorkspaceBot(workspaceId: string, payload: { botClientId: string; botName: string; token: string }) {
  const { data } = await api.post<{ bot: BotCredential }>(`/workspaces/${encodeURIComponent(workspaceId)}/bots`, payload);
  return data.bot;
}

export async function updateWorkspaceBotToken(workspaceId: string, credentialId: string, token: string) {
  const { data } = await api.put<{ bot: BotCredential }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/bots/${encodeURIComponent(credentialId)}/token`,
    { token }
  );
  return data.bot;
}

export async function validateWorkspaceBot(workspaceId: string, credentialId: string) {
  const { data } = await api.post<{ bot: BotCredential }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/bots/${encodeURIComponent(credentialId)}/validate`
  );
  return data.bot;
}

export async function deleteWorkspaceBot(workspaceId: string, credentialId: string) {
  const { data } = await api.delete<{ bot: BotCredential }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/bots/${encodeURIComponent(credentialId)}`
  );
  return data.bot;
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    clearTabVerification();
  }
}

export function readTabVerification() {
  return tabVerificationToken;
}

function storeTabVerification(token: string) {
  tabVerificationToken = token;
}

export function clearTabVerification() {
  tabVerificationToken = null;
}

function synchronizeTabVerification(auth: AuthResponse) {
  if (auth.access.verified && typeof auth.verificationToken === "string" && auth.verificationToken.trim()) {
    storeTabVerification(auth.verificationToken);
    return;
  }

  if (!auth.access.verified) {
    clearTabVerification();
  }
}

function clearLegacyTabVerificationStorage() {
  try {
    window.sessionStorage.removeItem("dashboard.tab_verification");
  } catch {
    // Legacy cleanup only; auth state is kept in memory.
  }
}

export async function getGuildSettings(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ settings: GuildSettings }>(`/settings/${guildId}`, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function getGuildLiveOptions(guildId: string, botId?: string | null, refresh = false) {
  const { data } = await api.get<{ options: GuildLiveOptions }>(`/guilds/${guildId}/live-options`, {
    params: {
      ...botParams(botId),
      refresh: refresh ? "1" : undefined
    }
  });
  return data.options;
}

export async function deleteGuildChannels(guildId: string, channelIds: string[], roleIds: string[], botId?: string | null) {
  const { data } = await api.post<{
    result: {
      deleted: Array<{ id: string; name: string; type: "announcement" | "category" | "role" | "stage" | "text" | "voice" }>;
      failed: Array<{ id: string; name: string; reason: string; type: "announcement" | "category" | "role" | "stage" | "text" | "voice" }>;
    };
  }>(`/guilds/${guildId}/delete-channels`, { botId: botId ?? null, channelIds, roleIds });
  return data.result;
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

export async function listPanelImageSettings(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ settings: PanelImageSettings[] }>(`/panel-images/${guildId}`, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function getPanelImageSettings(guildId: string, panelId: string, botId?: string | null) {
  const { data } = await api.get<{ settings: PanelImageSettings }>(
    `/panel-images/${guildId}/${encodeURIComponent(panelId)}`,
    {
      params: botParams(botId)
    }
  );
  return data.settings;
}

export async function savePanelImageSettings(
  guildId: string,
  panelId: string,
  payload: SavePanelImageSettingsPayload,
  botId?: string | null
) {
  const { data } = await api.put<{ settings: PanelImageSettings }>(
    `/panel-images/${guildId}/${encodeURIComponent(panelId)}`,
    payload,
    {
      params: botParams(botId)
    }
  );
  return data.settings;
}

export async function uploadPanelImage(guildId: string, panelId: string, file: File, botId?: string | null, onProgress?: (percent: number) => void) {
  const { data } = await api.put<{ settings: PanelImageSettings }>(
    `/panel-images/${guildId}/${encodeURIComponent(panelId)}/upload`,
    file,
    {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name)
      },
      onUploadProgress: (event) => {
        if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
      },
      params: botParams(botId),
      timeout: 120000
    }
  );
  return data.settings;
}

export async function removePanelImage(guildId: string, panelId: string, botId?: string | null) {
  const { data } = await api.delete<{ settings: PanelImageSettings }>(
    `/panel-images/${guildId}/${encodeURIComponent(panelId)}/images/panel`,
    {
      params: botParams(botId)
    }
  );
  return data.settings;
}

export async function cloneEmojiToGuild(
  guildId: string,
  payload: { image: string; name: string; sourceLabel?: string | null },
  botId?: string | null
) {
  const { data } = await api.post<{ duplicate?: boolean; emoji: { id: string; name: string; animated?: boolean } }>(
    `/emoji-cloner/${guildId}/clone`,
    payload,
    {
      params: botParams(botId)
    }
  );
  return { ...data.emoji, duplicate: data.duplicate === true };
}

export async function getEmojiLibrary(botId: string, filters: { animated?: "all" | "true" | "false"; q?: string } = {}) {
  const { data } = await api.get<{ items: EmojiLibraryItem[] }>("/emoji-cloner/library", {
    params: {
      ...botParams(botId),
      animated: filters.animated ?? "all",
      q: filters.q || undefined
    }
  });
  return data.items;
}

export async function getApplicationEmojis(botId: string, filters: { animated?: "all" | "true" | "false"; q?: string; sort?: "date" | "name" | "size" } = {}) {
  const { data } = await api.get<ApplicationEmojiPage>("/emoji-cloner/application", {
    params: {
      ...botParams(botId),
      animated: filters.animated ?? "all",
      q: filters.q || undefined,
      sort: filters.sort ?? "date"
    }
  });
  return data;
}

export async function syncApplicationEmojis(botId: string, guildId: string) {
  const { data } = await api.post<ApplicationEmojiSyncResult>("/emoji-cloner/application/sync", { guildId }, {
    params: botParams(botId)
  });
  return data;
}

export async function refreshApplicationEmojis(botId: string) {
  const { data } = await api.post<ApplicationEmojiPage>("/emoji-cloner/application/refresh", undefined, {
    params: botParams(botId)
  });
  return data;
}

export async function removeAllApplicationEmojis(botId: string) {
  const { data } = await api.delete<ApplicationEmojiPage & { removed: number }>("/emoji-cloner/application", {
    params: botParams(botId)
  });
  return data;
}

export async function getApplicationEmojiSettings(botId: string, guildId: string) {
  const { data } = await api.get<{ settings: ApplicationEmojiSettings }>(`/emoji-cloner/application/settings/${guildId}`, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function updateApplicationEmojiSettings(botId: string, guildId: string, payload: { autoSync: boolean }) {
  const { data } = await api.patch<{ settings: ApplicationEmojiSettings }>(`/emoji-cloner/application/settings/${guildId}`, payload, {
    params: botParams(botId)
  });
  return data.settings;
}

export function applicationEmojiDownloadUrl(botId: string, guildId?: string | null) {
  const params = new URLSearchParams({
    botId
  });

  if (guildId) {
    params.set("guildId", guildId);
  }

  return `${API_URL}/emoji-cloner/application/download?${params.toString()}`;
}

export function emojiLibraryDownloadUrl(botId: string, guildId?: string | null) {
  const params = new URLSearchParams({
    botId
  });

  if (guildId) {
    params.set("guildId", guildId);
  }

  return `${API_URL}/emoji-cloner/library/download?${params.toString()}`;
}

export async function downloadEmojiZip(
  source: "application" | "library",
  botId: string,
  guildId: string | null | undefined,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {}
) {
  const response = await api.get<Blob>(`/emoji-cloner/${source}/download`, {
    params: { ...botParams(botId), ...(guildId ? { guildId } : {}) },
    onDownloadProgress: (event) => {
      const percent = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
      options.onProgress?.(percent);
    },
    responseType: "blob",
    signal: options.signal,
    timeout: 120_000
  });

  return {
    blob: response.data,
    count: Number(response.headers["x-emoji-count"] ?? 0),
    failed: Number(response.headers["x-emoji-failed"] ?? 0),
    total: Number(response.headers["x-emoji-total"] ?? 0)
  };
}

export async function resendEmojiFromLibrary(botId: string, emojiId: string, payload: { guildId: string; name?: string }) {
  const { data } = await api.post<{ duplicate?: boolean; emoji: { id: string; name: string; animated?: boolean } }>(
    `/emoji-cloner/library/${encodeURIComponent(emojiId)}/resend`,
    payload,
    {
      params: botParams(botId)
    }
  );
  return { ...data.emoji, duplicate: data.duplicate === true };
}

export async function validateFakeEmojiCloneToken(payload: {
  botId: string;
  sourceGuildId: string;
  targetGuildId: string;
  token: string;
}) {
  const { data } = await api.post<{
    accepted: boolean;
    message: string;
  }>("/emoji-cloner/fake-token/validate", payload);
  return data;
}

export async function validateEmojiCloneBotToken(payload: {
  sourceGuildId: string;
  targetGuildId: string;
  token: string;
}) {
  const { data } = await api.post<{
    accepted: boolean;
    bot: { id: string; username: string };
    message: string;
    sourceGuild: { id: string; name?: string };
    targetGuild: { id: string; name?: string };
  }>("/emoji-cloner/bot-token/validate", payload);
  return data;
}

export async function fetchEmojiCloneBotTokenEmojis(payload: {
  sourceGuildId: string;
  targetGuildId: string;
  token: string;
}) {
  const { data } = await api.post<{ emojis: EmojiCloneRemoteEmoji[] }>("/emoji-cloner/bot-token/emojis", payload);
  return data.emojis;
}

export async function cloneSelectedEmojiCloneBotToken(
  botId: string | null | undefined,
  payload: {
    emojis: EmojiCloneRemoteEmoji[];
    prefix?: string | null;
    sourceGuildId: string;
    targetGuildId: string;
    token: string;
  }
) {
  const { data } = await api.post<{
    failed: number;
    items: Array<{ errorReason?: string | null; newEmojiId?: string | null; newName?: string | null; originalEmojiId: string; status: "success" | "failed" }>;
    success: number;
    total: number;
  }>("/emoji-cloner/bot-token/clone-selected", payload, {
    params: botParams(botId)
  });
  return data;
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

export async function getVoiceRecorder(
  guildId: string,
  botId: string,
  filters: {
    channelId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    maxDurationSeconds?: number | null;
    minDurationSeconds?: number | null;
    search?: string | null;
    userId?: string | null;
  } = {}
) {
  const { data } = await api.get<VoiceRecorderResponse>(
    `/voice-recorder/${guildId}`,
    {
      params: {
        ...botParams(botId),
        channelId: filters.channelId || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        maxDurationSeconds: filters.maxDurationSeconds ?? undefined,
        minDurationSeconds: filters.minDurationSeconds ?? undefined,
        search: filters.search || undefined,
        userId: filters.userId || undefined
      }
    }
  );
  return data;
}

export async function saveVoiceRecorderSettings(
  guildId: string,
  botId: string,
  payload: SaveVoiceRecorderSettingsPayload
) {
  const { data } = await api.patch<{ settings: VoiceRecorderResponse["settings"] }>(
    `/voice-recorder/${guildId}`,
    payload,
    {
      params: botParams(botId)
    }
  );
  return data.settings;
}

export async function startVoiceRecorder(guildId: string, botId: string, channelId: string) {
  const { data } = await api.post<{ recording: VoiceRecording }>(
    `/voice-recorder/${guildId}/start`,
    { channelId },
    {
      params: botParams(botId),
      timeout: 15000
    }
  );
  return data.recording;
}

export async function stopVoiceRecorder(guildId: string, botId: string, recordingId?: string | null) {
  const { data } = await api.post<{ recording: VoiceRecording }>(
    `/voice-recorder/${guildId}/stop`,
    { recordingId: recordingId ?? null },
    {
      params: botParams(botId),
      timeout: 15000
    }
  );
  return data.recording;
}

export async function deleteVoiceRecording(guildId: string, botId: string, recordingId: string) {
  const { data } = await api.delete<{ recording: VoiceRecording }>(
    `/voice-recorder/${guildId}/recordings/${recordingId}`,
    {
      params: botParams(botId)
    }
  );
  return data.recording;
}

export function voiceRecordingAudioUrl(guildId: string, botId: string, recordingId: string) {
  const params = new URLSearchParams(botParams(botId));
  return `${API_URL}/voice-recorder/${encodeURIComponent(guildId)}/recordings/${encodeURIComponent(recordingId)}/audio?${params.toString()}`;
}

export function voiceRecordingDownloadUrl(guildId: string, botId: string, recordingId: string) {
  const params = new URLSearchParams(botParams(botId));
  return `${API_URL}/voice-recorder/${encodeURIComponent(guildId)}/recordings/${encodeURIComponent(recordingId)}/download?${params.toString()}`;
}

export async function getSelfBotProtection(guildId: string, botId: string) {
  const { data } = await api.get<SelfBotProtectionResponse>(
    `/self-bot-protection/${guildId}`,
    {
      params: botParams(botId)
    }
  );
  return data;
}

export async function saveSelfBotProtectionSettings(
  guildId: string,
  botId: string,
  payload: SaveSelfBotProtectionSettingsPayload
) {
  const { data } = await api.patch<{
    settings: SelfBotProtectionSettings;
    setup: { error?: string; ok: boolean };
  }>(
    `/self-bot-protection/${guildId}`,
    payload,
    {
      params: botParams(botId)
    }
  );
  return data;
}

export async function getSafeBotWarnings(guildId: string, botId: string) {
  const { data } = await api.get<import("../types").SafeBotWarningDashboard>(`/self-bot-protection/${guildId}/warnings`, { params: botParams(botId) });
  return data;
}

export async function saveSafeBotWarningSettings(guildId: string, botId: string, payload: Partial<import("../types").SafeBotWarningSettings>) {
  const { id: _id, botId: _botId, guildId: _guildId, createdAt: _createdAt, updatedAt: _updatedAt, ...settings } = payload;
  const { data } = await api.patch<{ settings: import("../types").SafeBotWarningSettings }>(`/self-bot-protection/${guildId}/warnings/settings`, settings, { params: botParams(botId) });
  return data.settings;
}

export async function removeSafeBotWarning(guildId: string, botId: string, warningId: string) {
  await api.delete(`/self-bot-protection/${guildId}/warnings/${warningId}`, { params: botParams(botId) });
}

export async function resetSafeBotWarnings(guildId: string, botId: string, userId: string) {
  await api.delete(`/self-bot-protection/${guildId}/warnings/users/${userId}`, { params: botParams(botId) });
}

export async function saveSafeBotWarningNote(guildId: string, botId: string, userId: string, note: string) {
  await api.patch(`/self-bot-protection/${guildId}/warnings/users/${userId}/note`, { note }, { params: botParams(botId) });
}

export async function getAutomatedLogSettings(guildId: string, botId: string) { const { data } = await api.get<{ settings: import("../types").AutomatedLogSettings }>(`/automated-logs/${guildId}`, { params: botParams(botId) }); return data.settings; }
export async function saveAutomatedLogSettings(guildId: string, botId: string, payload: { enabled?: boolean; allowedRoleIds?: string[]; enabledChannels?: Partial<import("../types").AutomatedLogSettings["enabledChannels"]> }) { const { data } = await api.patch<{ settings: import("../types").AutomatedLogSettings }>(`/automated-logs/${guildId}`, payload, { params: botParams(botId) }); return data.settings; }
export async function syncAutomatedLogStructure(guildId: string, botId: string) { const { data } = await api.post<{ settings: import("../types").AutomatedLogSettings }>(`/automated-logs/${guildId}/sync`, undefined, { params: botParams(botId) }); return data.settings; }

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

export async function publishRulesPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ messageId: string; settings: GuildSettings }>(`/settings/${guildId}/rules-panel`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.settings;
}

export async function publishReportSystemPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ messageId: string; settings: GuildSettings }>(`/settings/${guildId}/report-system-panel`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.settings;
}

export async function listHierarchyForwardingRules(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ rules: HierarchyForwardingRule[] }>(`/report-forwarding/${guildId}`, {
    params: botParams(botId)
  });
  return data.rules;
}

export async function createHierarchyForwardingRule(guildId: string, input: Pick<HierarchyForwardingRule, "denouncedRoleId" | "destinationCategoryId" | "enabled">, botId?: string | null) {
  const { data } = await api.post<{ rule: HierarchyForwardingRule }>(`/report-forwarding/${guildId}`, input, {
    params: botParams(botId)
  });
  return data.rule;
}

export async function updateHierarchyForwardingRule(guildId: string, ruleId: string, input: Partial<Pick<HierarchyForwardingRule, "denouncedRoleId" | "destinationCategoryId" | "enabled">>, botId?: string | null) {
  const { data } = await api.patch<{ rule: HierarchyForwardingRule }>(`/report-forwarding/${guildId}/${ruleId}`, input, {
    params: botParams(botId)
  });
  return data.rule;
}

export async function duplicateHierarchyForwardingRule(guildId: string, ruleId: string, botId?: string | null) {
  const { data } = await api.post<{ rule: HierarchyForwardingRule }>(`/report-forwarding/${guildId}/${ruleId}/duplicate`, undefined, {
    params: botParams(botId)
  });
  return data.rule;
}

export async function deleteHierarchyForwardingRule(guildId: string, ruleId: string, botId?: string | null) {
  await api.delete(`/report-forwarding/${guildId}/${ruleId}`, {
    params: botParams(botId)
  });
}

export async function publishTicketPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ settings: GuildSettings }>(`/settings/${guildId}/ticket-panel`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.settings;
}

export async function getLogs(guildId: string, botId: string) {
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

export async function getLiveDetectionSettings(guildId: string, botId?: string | null) {
  const { data } = await api.get<{ settings: LiveDetectionSettings }>("/lives/settings", {
    params: {
      guildId,
      ...botParams(botId)
    }
  });
  return data.settings;
}

export async function saveLiveDetectionSettings(
  guildId: string,
  payload: Pick<LiveDetectionSettings, "enabled" | "liveRoleId" | "logChannelId">,
  botId?: string | null
) {
  const { data } = await api.put<{ settings: LiveDetectionSettings }>("/lives/settings", {
    guildId,
    enabled: payload.enabled,
    liveRoleId: payload.liveRoleId,
    logChannelId: payload.logChannelId
  }, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function deleteLiveDetectionSettings(guildId: string, botId?: string | null) {
  const { data } = await api.delete<{ settings: LiveDetectionSettings }>(`/lives/settings/${guildId}`, {
    params: botParams(botId)
  });
  return data.settings;
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

export async function getManualRegistrationDashboard(guildId: string, botId?: string | null) {
  const { data } = await api.get<ManualRegistrationDashboard>(`/manual-registration/${guildId}/settings`, {
    params: botId ? { botId } : undefined
  });
  return data;
}

export async function saveManualRegistrationSettings(guildId: string, payload: Partial<ManualRegistrationSettings>, botId?: string | null) {
  const { data } = await api.put<{ settings: ManualRegistrationSettings }>(`/manual-registration/${guildId}/settings`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.settings;
}

export async function publishManualRegistrationPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ settings: ManualRegistrationSettings }>(`/manual-registration/${guildId}/panel`, undefined, { params: botId ? { botId } : undefined });
  return data.settings;
}

export async function deleteManualRegistrationSubmission(guildId: string, submissionId: string, reason: string, botId?: string | null) {
  await api.delete(`/manual-registration/${guildId}/submissions/${submissionId}`, {
    data: { reason },
    params: botId ? { botId } : undefined
  });
}

export async function createManualRegistrationSubmission(guildId: string, payload: { characterName: string; gameId: string; goalCategoryId: string; requestedRoleId: string; userAvatar?: string | null; userId: string; username: string }, botId?: string | null) {
  const { data } = await api.post<{ submission: ManualRegistrationSubmission }>(`/manual-registration/${guildId}/submissions/manual`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.submission;
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

export async function getClipsConfigs(
  guildId: string,
  botId?: string | null,
  platform: ClipPlatform = "twitch",
  options: { page?: number; pageSize?: number; q?: string } = {}
) {
  const { data } = await api.get<ClipsConfigPage>("/clips/configs", {
    params: {
      guildId,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 25,
      platform,
      q: options.q || undefined,
      ...botParams(botId)
    }
  });
  return data;
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

export async function enableClipsConfigById(guildId: string, configId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/enable", { configId, guildId, platform }, {
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

export async function disableClipsConfigById(guildId: string, configId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.post<{ config: ClipsConfig }>("/clips/disable", { configId, guildId, platform }, {
    params: botParams(botId)
  });
  return data.config;
}

export async function deleteClipsConfigById(guildId: string, configId: string, botId?: string | null, platform: ClipPlatform = "twitch") {
  const { data } = await api.delete<{ config: ClipsConfig }>("/clips/config", {
    data: { configId, guildId, platform },
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

export async function previewGiveawayLive(guildId: string, liveUrl: string, botId?: string | null) {
  const { data } = await api.post<{ preview: GiveawayLivePreview }>(`/giveaways/${guildId}/live-preview`, {
    liveUrl
  }, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.preview;
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

export async function getRouletteDiagnostics(token: string) {
  const { data } = await api.get<{ diagnostics: GiveawayDiagnostics }>(`/giveaways/roulette/${encodeURIComponent(token)}/diagnostics`, {
    timeout: 15000
  });
  return data.diagnostics;
}

export async function setRouletteDebug(token: string, debug: boolean) {
  const { data } = await api.post<{ diagnostics: GiveawayDiagnostics }>(`/giveaways/roulette/${encodeURIComponent(token)}/debug`, {
    debug
  }, {
    timeout: 15000
  });
  return data.diagnostics;
}

export async function testRouletteIntegration(token: string) {
  const { data } = await api.post<{ diagnostics: GiveawayDiagnostics; report: string[] }>(`/giveaways/roulette/${encodeURIComponent(token)}/test-integration`, undefined, {
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

export async function getFivemModules() {
  const { data } = await api.get<{ modules: FivemModuleDefinition[] }>("/fivem/modules");
  return data.modules;
}
export async function listPd7Factions(guildId:string,botId:string){const{data}=await api.get<{factions:Pd7Settings[]}>(`/fivem-pd7/${guildId}`,{params:botParams(botId)});return data.factions;}
export async function getPd7Dashboard(guildId:string,factionId:string,botId:string){const{data}=await api.get<Pd7Dashboard>(`/fivem-pd7/${guildId}/factions/${encodeURIComponent(factionId)}`,{params:botParams(botId)});return data;}
export async function savePd7Settings(guildId:string,factionId:string,botId:string,payload:Partial<Pd7Settings>){const{data}=await api.patch<{settings:Pd7Settings}>(`/fivem-pd7/${guildId}/factions/${encodeURIComponent(factionId)}`,payload,{params:botParams(botId)});return data.settings;}
export async function publishPd7Panel(guildId:string,factionId:string,botId:string){const{data}=await api.post<{settings:Pd7Settings}>(`/fivem-pd7/${guildId}/factions/${encodeURIComponent(factionId)}/publish`,undefined,{params:botParams(botId)});return data.settings;}

export async function getFivemActions(guildId: string, architecture: import("../types").FivemActionArchitecture, botId: string) {
  const { data } = await api.get<import("../types").FivemActionDashboard>(`/fivem-actions/${guildId}/${architecture}`, { params: botParams(botId) }); return data;
}
export async function saveFivemActionSettings(guildId: string, architecture: import("../types").FivemActionArchitecture, botId: string, payload: Partial<import("../types").FivemActionSettings>) {
  const { data } = await api.patch<{ settings: import("../types").FivemActionSettings }>(`/fivem-actions/${guildId}/${architecture}/settings`, payload, { params: botParams(botId) }); return data.settings;
}
export async function createFivemAction(guildId: string, architecture: import("../types").FivemActionArchitecture, botId: string, payload: Partial<import("../types").FivemActionDefinition>) {
  const { data } = await api.post<{ action: import("../types").FivemActionDefinition }>(`/fivem-actions/${guildId}/${architecture}/actions`, payload, { params: botParams(botId) }); return data.action;
}
export async function updateFivemAction(guildId: string, architecture: import("../types").FivemActionArchitecture, botId: string, actionId: string, payload: Partial<import("../types").FivemActionDefinition>) {
  const { data } = await api.patch<{ action: import("../types").FivemActionDefinition }>(`/fivem-actions/${guildId}/${architecture}/actions/${actionId}`, payload, { params: botParams(botId) }); return data.action;
}
export async function deleteFivemAction(guildId: string, architecture: import("../types").FivemActionArchitecture, botId: string, actionId: string) {
  await api.delete(`/fivem-actions/${guildId}/${architecture}/actions/${actionId}`, { params: botParams(botId) });
}
export async function publishFivemActionsPanel(guildId: string, architecture: import("../types").FivemActionArchitecture, botId: string) {
  const { data } = await api.post<{ settings: import("../types").FivemActionSettings }>(`/fivem-actions/${guildId}/${architecture}/publish`, undefined, { params: botParams(botId) }); return data.settings;
}
export async function getPolicePatrolDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").PolicePatrolDashboard>(`/police-patrol-reports/${guildId}`, { params: botParams(botId) }); return data; }
export async function savePolicePatrolSettings(guildId: string, botId: string, payload: Partial<import("../types").PolicePatrolSettings>) { const { data } = await api.patch<{ settings: import("../types").PolicePatrolSettings }>(`/police-patrol-reports/${guildId}/settings`, payload, { params: botParams(botId) }); return data.settings; }
export async function deletePolicePatrolReport(guildId: string, botId: string, reportId: string) { await api.delete(`/police-patrol-reports/${guildId}/reports/${reportId}`, { params: botParams(botId) }); }
export async function getVehicleAbandonmentDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").VehicleAbandonmentDashboard>(`/vehicle-abandonment/${guildId}`, { params: botParams(botId) }); return data; }
export async function saveVehicleAbandonmentSettings(guildId: string, botId: string, payload: Partial<import("../types").VehicleAbandonmentSettings>) { const { data } = await api.patch<{ settings: import("../types").VehicleAbandonmentSettings }>(`/vehicle-abandonment/${guildId}/settings`, payload, { params: botParams(botId) }); return data.settings; }
export async function getPoliceQruDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").PoliceQruDashboard>(`/police-qru/${guildId}`, { params: botParams(botId) }); return data; }
export async function savePoliceQruSettings(guildId: string, botId: string, payload: Partial<import("../types").PoliceQruSettings>) { const { data } = await api.patch<{ settings: import("../types").PoliceQruSettings }>(`/police-qru/${guildId}/settings`, payload, { params: botParams(botId) }); return data.settings; }
export async function getPolicePromotionDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").PolicePromotionDashboard>(`/police-promotions/${guildId}`, { params: botParams(botId) }); return data; }
export async function savePolicePromotionSettings(guildId: string, botId: string, payload: Partial<import("../types").PolicePromotionSettings>) { const { data } = await api.patch<{ settings: import("../types").PolicePromotionSettings }>(`/police-promotions/${guildId}/settings`, payload, { params: botParams(botId) }); return data.settings; }
export async function publishPolicePromotionPanel(guildId: string, botId: string) { const { data } = await api.post<{ settings: import("../types").PolicePromotionSettings }>(`/police-promotions/${guildId}/publish`, undefined, { params: botParams(botId) }); return data.settings; }
export async function getPoliceHiddenChannelDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").PoliceHiddenChannelDashboard>(`/police-hidden-channel/${guildId}`, { params: botParams(botId) }); return data; }
export async function savePoliceHiddenChannelSettings(guildId: string, botId: string, payload: Partial<import("../types").PoliceHiddenChannelSettings>) { const { data } = await api.patch<{ settings: import("../types").PoliceHiddenChannelSettings }>(`/police-hidden-channel/${guildId}/settings`, payload, { params: botParams(botId) }); return data.settings; }
export async function removePoliceHiddenChannelSettings(guildId: string, botId: string) { const { data } = await api.delete<{ settings: import("../types").PoliceHiddenChannelSettings }>(`/police-hidden-channel/${guildId}/settings`, { params: botParams(botId) }); return data.settings; }
export async function getVisibleMessageDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").VisibleMessageDashboard>(`/visible-message/${guildId}`, { params: botParams(botId) }); return data; }
export async function addVisibleMessageUser(guildId: string, botId: string, payload: { avatarUrl?: string | null; userId: string; username?: string | null }) { const { data } = await api.post<{ user: import("../types").VisibleMessageUser }>(`/visible-message/${guildId}/users`, payload, { params: botParams(botId) }); return data.user; }
export async function removeVisibleMessageUser(guildId: string, botId: string, userId: string) { const { data } = await api.delete<{ user: import("../types").VisibleMessageUser | null }>(`/visible-message/${guildId}/users/${userId}`, { params: botParams(botId) }); return data.user; }
export async function clearVisibleMessageUsers(guildId: string, botId: string) { const { data } = await api.delete<{ users: import("../types").VisibleMessageUser[] }>(`/visible-message/${guildId}/users`, { params: botParams(botId) }); return data.users; }
export async function getMessageControlDashboard(guildId: string, botId: string) { const { data } = await api.get<MessageControlDashboard>(`/message-control/${guildId}`, { params: botParams(botId) }); return data; }
export async function addMessageControlUser(guildId: string, botId: string, payload: { avatarUrl?: string | null; discordId: string; username?: string | null }) { const { data } = await api.post<{ user: MessageControlUser }>(`/message-control/${guildId}/users`, payload, { params: botParams(botId) }); return data.user; }
export async function removeMessageControlUser(guildId: string, botId: string, discordId: string) { const { data } = await api.delete<{ user: MessageControlUser | null }>(`/message-control/${guildId}/users/${discordId}`, { params: botParams(botId) }); return data.user; }
export async function clearMessageControlUsers(guildId: string, botId: string) { const { data } = await api.delete<{ users: MessageControlUser[] }>(`/message-control/${guildId}/users`, { params: botParams(botId) }); return data.users; }
export async function saveMessageControlSettings(guildId: string, botId: string, payload: Partial<Pick<MessageControlSettings, "managerRoleIds" | "managerUserIds">>) { const { data } = await api.patch<{ settings: MessageControlSettings }>(`/message-control/${guildId}/settings`, payload, { params: botParams(botId) }); return data.settings; }
export async function setMessageControlUserStatus(guildId: string, botId: string, discordId: string, status: MessageControlStatus) { const { data } = await api.patch<{ user: MessageControlUser }>(`/message-control/${guildId}/users/${discordId}/status`, { status }, { params: botParams(botId) }); return data.user; }
export async function getDmBarDashboard(guildId: string, botId: string) { const { data } = await api.get<import("../types").DmBarDashboard>(`/dm-bar/${guildId}`, { params: botParams(botId) }); return data; }
export async function saveDmBarConfig(guildId: string, botId: string, payload: Partial<import("../types").DmBarConfig>) { const { data } = await api.patch<{ config: import("../types").DmBarConfig }>(`/dm-bar/${guildId}/config`, payload, { params: botParams(botId) }); return data.config; }
export async function resetDmBarConfig(guildId: string, botId: string) { const { data } = await api.post<{ config: import("../types").DmBarConfig }>(`/dm-bar/${guildId}/reset`, undefined, { params: botParams(botId) }); return data.config; }
export async function uploadDmBarImage(guildId: string, botId: string, imageType: "main" | "footer", file: File) { const form = new FormData(); form.append("file", file); const { data } = await api.post<{ config: import("../types").DmBarConfig; image: unknown }>(`/dm-bar/${guildId}/images/${imageType}`, form, { params: botParams(botId), timeout: 60000 }); return data.config; }
export async function removeDmBarImage(guildId: string, botId: string, imageType: "main" | "footer") { const { data } = await api.delete<{ config: import("../types").DmBarConfig }>(`/dm-bar/${guildId}/images/${imageType}`, { params: botParams(botId) }); return data.config; }
export async function getOpenDutyDashboard(guildId: string, botId: string) { const { data } = await api.get<OpenDutyDashboard>(`/open-duty-notifications/${guildId}`, { params: botParams(botId) }); return data; }
export async function saveOpenDutySettings(guildId: string, botId: string, payload: SaveOpenDutySettingsPayload) { const { data } = await api.patch<{ settings: import("../types").OpenDutySettings }>(`/open-duty-notifications/${guildId}/config`, payload, { params: botParams(botId) }); return data.settings; }
export async function resetOpenDutyCounter(guildId: string, botId: string, userId: string) { const { data } = await api.post<{ counter: { total: number; userId: string } }>(`/open-duty-notifications/${guildId}/reset-counter`, { userId }, { params: botParams(botId) }); return data.counter; }
export async function getPoliceTimeClockDashboard(guildId: string, botId: string) { const { data } = await api.get<PoliceTimeClockDashboard>(`/police-time-clock/${guildId}`, { params: botParams(botId) }); return data; }
export async function savePoliceTimeClockSettings(guildId: string, botId: string, payload: Partial<PoliceTimeClockSettings>) { const { data } = await api.patch<{ settings: PoliceTimeClockSettings }>(`/police-time-clock/${guildId}/config`, payload, { params: botParams(botId) }); return data.settings; }
export async function getAutoActivityClockDashboard(guildId: string, botId: string) { const { data } = await api.get<AutoActivityClockDashboard>(`/auto-activity-clock/${guildId}`, { params: botParams(botId) }); return data; }
export async function saveAutoActivityClockSettings(guildId: string, botId: string, payload: Partial<AutoActivityClockSettings>) { const { data } = await api.patch<{ settings: AutoActivityClockSettings }>(`/auto-activity-clock/${guildId}/config`, payload, { params: botParams(botId) }); return data.settings; }
export async function saveAutoActivityClockCity(guildId: string, botId: string, payload: { aliases?: string[]; cityId?: string | null; enabled?: boolean; name: string }) { const { data } = await api.post<{ city: AutoActivityClockCity }>(`/auto-activity-clock/${guildId}/cities`, payload, { params: botParams(botId) }); return data.city; }
export async function deleteAutoActivityClockCity(guildId: string, botId: string, cityId: string) { await api.delete(`/auto-activity-clock/${guildId}/cities/${cityId}`, { params: botParams(botId) }); }

export async function getGlobalBlacklistDashboard(guildId: string, botId?: string | null) {
  const { data } = await api.get<GlobalBlacklistDashboard>(`/global-blacklist/${guildId}`, {
    params: botId ? { botId } : undefined
  });
  return data;
}

export async function saveGlobalBlacklistSettings(guildId: string, payload: Partial<GlobalBlacklistSafeBotSettings>, botId?: string | null) {
  const { data } = await api.patch<{ settings: GlobalBlacklistSafeBotSettings }>(`/global-blacklist/${guildId}/settings`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.settings;
}

export async function getFivemGoals(guildId: string, botId?: string | null) {
  const { data } = await api.get<FivemGoalDashboard>(`/fivem/${guildId}/goals`, {
    params: botId ? { botId } : undefined
  });
  return data;
}

export async function getFivemOrders(guildId: string, botId?: string | null) {
  const { data } = await api.get<FivemOrderDashboard>(`/fivem-orders/${guildId}`, { params: botId ? { botId } : undefined });
  return data;
}
export async function saveFivemOrderSettings(guildId: string, payload: Partial<FivemOrderSettings>, botId?: string | null) {
  const { data } = await api.put<{ settings: FivemOrderSettings }>(`/fivem-orders/${guildId}/settings`, payload, { params: botId ? { botId } : undefined }); return data.settings;
}
export async function publishFivemOrderPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ settings: FivemOrderSettings }>(`/fivem-orders/${guildId}/panel`, undefined, { params: botId ? { botId } : undefined }); return data.settings;
}
export async function createFivemOrderProduct(guildId: string, payload: Partial<FivemOrderProduct>, botId?: string | null) {
  const { data } = await api.post<{ product: FivemOrderProduct }>(`/fivem-orders/${guildId}/products`, payload, { params: botId ? { botId } : undefined }); return data.product;
}
export async function createFivemOrderFamily(guildId: string, payload: Omit<import("../types").FivemOrderFamily, "botId" | "createdAt" | "guildId" | "id" | "updatedAt">, botId?: string | null) {
  const { data } = await api.post<{ family: import("../types").FivemOrderFamily }>(`/fivem-orders/${guildId}/families`, payload, { params: botId ? { botId } : undefined }); return data.family;
}
export async function updateFivemOrderFamily(guildId: string, familyId: string, payload: Partial<import("../types").FivemOrderFamily>, botId?: string | null) {
  const { data } = await api.patch<{ family: import("../types").FivemOrderFamily }>(`/fivem-orders/${guildId}/families/${encodeURIComponent(familyId)}`, payload, { params: botId ? { botId } : undefined }); return data.family;
}
export async function deleteFivemOrderFamily(guildId: string, familyId: string, botId?: string | null) {
  await api.delete(`/fivem-orders/${guildId}/families/${encodeURIComponent(familyId)}`, { params: botId ? { botId } : undefined });
}
export async function updateFivemOrderProduct(guildId: string, productId: string, payload: Partial<FivemOrderProduct>, botId?: string | null) {
  const { data } = await api.patch<{ product: FivemOrderProduct }>(`/fivem-orders/${guildId}/products/${encodeURIComponent(productId)}`, payload, { params: botId ? { botId } : undefined }); return data.product;
}
export async function deleteFivemOrderProduct(guildId: string, productId: string, botId?: string | null) {
  await api.delete(`/fivem-orders/${guildId}/products/${encodeURIComponent(productId)}`, { params: botId ? { botId } : undefined });
}
export async function updateFivemOrderStatus(guildId: string, orderId: string, status: FivemOrderStatus, botId?: string | null) {
  const { data } = await api.patch<{ order: import("../types").FivemOrder }>(`/fivem-orders/${guildId}/orders/${encodeURIComponent(orderId)}/status`, { status }, { params: botId ? { botId } : undefined }); return data.order;
}

export async function getFivemFinance(guildId: string, botId?: string | null) {
  const { data } = await api.get<import("../types").FivemFinanceDashboard>(`/fivem-finance/${guildId}`, { params: botId ? { botId } : undefined });
  return data;
}
export async function saveFivemFinanceSettings(guildId: string, payload: Partial<import("../types").FivemFinanceSettings>, botId?: string | null) {
  const { data } = await api.put<{ settings: import("../types").FivemFinanceSettings }>(`/fivem-finance/${guildId}/settings`, payload, { params: botId ? { botId } : undefined });
  return data.settings;
}
export async function publishFivemFinancePanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ settings: import("../types").FivemFinanceSettings }>(`/fivem-finance/${guildId}/panel`, undefined, { params: botId ? { botId } : undefined });
  return data.settings;
}
export async function updateFivemFinanceTransaction(guildId: string, transactionId: string, payload: Partial<import("../types").FivemFinanceTransaction>, botId?: string | null) {
  const { data } = await api.patch<{ transaction: import("../types").FivemFinanceTransaction }>(`/fivem-finance/${guildId}/transactions/${encodeURIComponent(transactionId)}`, payload, { params: botId ? { botId } : undefined });
  return data.transaction;
}

export async function saveFivemGoalSettings(guildId: string, payload: Partial<FivemGoalSettings>, botId?: string | null) {
  const { data } = await api.patch<{ settings: FivemGoalSettings }>(`/fivem/${guildId}/goals`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.settings;
}

export async function publishFivemGoalPanel(guildId: string, botId?: string | null) {
  const { data } = await api.post<{ settings: FivemGoalSettings }>(`/fivem/${guildId}/goals/panel`, undefined, {
    params: botId ? { botId } : undefined,
    timeout: 15000
  });
  return data.settings;
}

export async function createFivemGoalConfig(guildId: string, payload: Partial<FivemGoalConfig>, botId?: string | null) {
  const { data } = await api.post<{ config: FivemGoalConfig }>(`/fivem/${guildId}/goals/configs`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.config;
}

export async function updateFivemGoalConfig(guildId: string, metaId: string, payload: Partial<FivemGoalConfig>, botId?: string | null) {
  const { data } = await api.patch<{ config: FivemGoalConfig }>(`/fivem/${guildId}/goals/configs/${encodeURIComponent(metaId)}`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.config;
}

export async function deleteFivemGoalConfig(guildId: string, metaId: string, deleteHistory: boolean, botId?: string | null) {
  const { data } = await api.delete<{ config: FivemGoalConfig }>(`/fivem/${guildId}/goals/configs/${encodeURIComponent(metaId)}`, {
    params: {
      ...(botId ? { botId } : {}),
      history: deleteHistory ? "1" : undefined
    }
  });
  return data.config;
}

export async function moderateFivemGoalSubmission(guildId: string, submissionId: string, payload: { refusalReason?: string | null; status: "approved" | "refused" }, botId?: string | null) {
  const { data } = await api.patch<{ submission: FivemGoalSubmission }>(`/fivem/${guildId}/goals/submissions/${encodeURIComponent(submissionId)}`, payload, {
    params: botId ? { botId } : undefined
  });
  return data.submission;
}

export async function getFivemHierarchy(guildId: string, botId?: string | null) {
  const { data } = await api.get<FivemHierarchyDashboard>(`/fivem/${guildId}/hierarchy`, {
    params: botId ? { botId } : undefined
  });
  return data;
}

export async function saveFivemHierarchyPanel(guildId: string, panel: FivemHierarchyPanel, botId?: string | null) {
  const payload = buildEditableFivemHierarchyPanelPayload(panel);
  const clientRequestId = hierarchyPanelClientRequestId(panel.id);
  const request = clientRequestId
    ? api.post<{ panel: FivemHierarchyPanel }>(`/fivem/${guildId}/hierarchy/panels`, { ...payload, clientRequestId }, {
        params: botId ? { botId } : undefined,
        timeout: 30000
      })
    : api.patch<{ panel: FivemHierarchyPanel }>(`/fivem/${guildId}/hierarchy/panels/${encodeURIComponent(panel.id)}`, payload, {
        params: botId ? { botId } : undefined,
        timeout: 30000
      });
  const { data } = await request;
  return data.panel;
}

export async function deleteFivemHierarchyPanel(guildId: string, panelId: string, botId?: string | null) {
  const { data } = await api.delete<{ panel: FivemHierarchyPanel }>(`/fivem/${guildId}/hierarchy/panels/${encodeURIComponent(panelId)}`, {
    params: botId ? { botId } : undefined
  });
  return data.panel;
}

export async function refreshFivemHierarchyOfficialMessage(guildId: string, panelId: string, botId?: string | null) {
  const { data } = await api.post<{ panel: FivemHierarchyPanel }>(
    `/fivem/${guildId}/hierarchy/panels/${encodeURIComponent(panelId)}/publish`,
    undefined,
    {
      params: botId ? { botId } : undefined,
      timeout: 30000
    }
  );
  return data.panel;
}

export async function getDevFivemModules() {
  const { data } = await api.get<{ modules: FivemModuleDefinition[] }>("/dev/fivem/modules");
  return data.modules;
}

export async function createDevFivemModule(payload: SaveFivemModulePayload) {
  const { data } = await api.post<{ module: FivemModuleDefinition }>("/dev/fivem/modules", payload);
  return data.module;
}

export async function updateDevFivemModule(moduleId: string, payload: Partial<SaveFivemModulePayload>) {
  const { data } = await api.patch<{ module: FivemModuleDefinition }>(`/dev/fivem/modules/${encodeURIComponent(moduleId)}`, payload);
  return data.module;
}

export async function deleteDevFivemModule(moduleId: string) {
  await api.delete(`/dev/fivem/modules/${encodeURIComponent(moduleId)}`);
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

export async function getMissionTools(guildId: string, botId: string) {
  const { data } = await api.get<MissionToolsResponse>(`/mission-tools/${guildId}`, {
    params: botParams(botId)
  });
  return data;
}

export async function getMissionToolsOptions(guildId: string, botId: string) {
  const { data } = await api.get<{ options: GuildLiveOptions }>(`/mission-tools/${guildId}/options`, {
    params: botParams(botId)
  });
  return data.options;
}

export async function saveMissionToolsSettings(guildId: string, botId: string, payload: SaveMissionToolsSettingsPayload) {
  const { data } = await api.patch<{ settings: MissionToolsSettings }>(`/mission-tools/${guildId}/settings`, payload, {
    params: botParams(botId)
  });
  return data.settings;
}

export async function publishMissionToolsPanel(guildId: string, botId: string) {
  const { data } = await api.post<{ settings: MissionToolsSettings }>(`/mission-tools/${guildId}/panel`, undefined, {
    params: botParams(botId),
    timeout: 15000
  });
  return data.settings;
}

export async function saveMissionToolsUserToken(
  guildId: string,
  botId: string,
  userId: string,
  payload: {
    token: string;
    username?: string | null;
  }
) {
  const { data } = await api.post<{
    accepted: false;
    fake: true;
    tokenConfigured: boolean;
    tokenLast4: string | null;
    tokenStatus: MissionToolsUserPanel["tokenStatus"];
    user: MissionToolsUserPanel;
  }>(`/mission-tools/${guildId}/users/${encodeURIComponent(userId)}/token`, payload, {
    params: botParams(botId),
    timeout: 15000
  });
  return data;
}

export async function saveMissionToolsMyToken(
  guildId: string,
  botId: string,
  payload: {
    token: string;
  }
) {
  const { data } = await api.post<{
    accepted: false;
    fake: true;
    tokenConfigured: boolean;
    tokenLast4: string | null;
    tokenStatus: MissionToolsUserPanel["tokenStatus"];
    user: MissionToolsUserPanel;
  }>(`/mission-tools/${guildId}/me/token`, payload, {
    params: botParams(botId),
    timeout: 15000
  });
  return data;
}

export async function deleteMissionToolsMyToken(guildId: string, botId: string) {
  const { data } = await api.delete<{
    tokenConfigured: boolean;
    tokenLast4: string | null;
    tokenStatus: MissionToolsUserPanel["tokenStatus"];
    user: MissionToolsUserPanel;
  }>(`/mission-tools/${guildId}/me/token`, {
    params: botParams(botId),
    timeout: 15000
  });
  return data;
}

export async function getDevModules() {
  const { data } = await api.get<{ modules: DevModuleDefinition[] }>("/dev/modules");
  return data.modules;
}

export async function getDevBots() {
  const { data } = await api.get<{ bots: DevBot[] }>("/dev/bots");
  return data.bots;
}

export async function getSystemHealth() {
  const { data } = await api.get<SystemHealthResponse>("/health", {
    timeout: 5000
  });
  return data;
}

export async function getSystemMetrics() {
  const { data } = await api.get<SystemMetricsResponse>("/health/metrics", {
    timeout: 5000
  });
  return data;
}

export async function getDiscloudMonitoring(refresh = false) {
  const { data } = await api.get<DiscloudMonitoringResponse>("/dev/discloud/monitoring", {
    params: refresh ? { refresh: "1" } : undefined,
    timeout: 20000
  });
  return data;
}

export async function getDiscloudBotLogs(botId: string) {
  const { data } = await api.get<{ logs: DiscloudLogsResponse }>(`/dev/discloud/bots/${encodeURIComponent(botId)}/logs`, {
    timeout: 20000
  });
  return data.logs;
}

export async function runDiscloudBotAction(botId: string, action: "start" | "stop" | "restart" | "redeploy") {
  const { data } = await api.post<DiscloudMonitoringResponse>(`/dev/discloud/bots/${encodeURIComponent(botId)}/actions`, {
    action
  }, {
    timeout: 30000
  });
  return data;
}

export async function getDevPlansDashboard() {
  const { data } = await api.get<DevPlansDashboard>("/dev/plans-dashboard");
  return data;
}

export async function createDevPlan(payload: SavePlanPayload) {
  const { data } = await api.post<{ plan: Plan }>("/dev/plans", payload);
  return data.plan;
}

export async function updateDevPlan(planId: string, payload: SavePlanPayload) {
  const { data } = await api.put<{ plan: Plan }>(`/dev/plans/${encodeURIComponent(planId)}`, payload);
  return data.plan;
}

export async function duplicateDevPlan(planId: string) {
  const { data } = await api.post<{ plan: Plan }>(`/dev/plans/${encodeURIComponent(planId)}/duplicate`);
  return data.plan;
}

export async function setDevPlanActive(planId: string, active: boolean) {
  const { data } = await api.post<{ plan: Plan }>(
    `/dev/plans/${encodeURIComponent(planId)}/${active ? "activate" : "deactivate"}`
  );
  return data.plan;
}

export async function createDevPlanFeature(payload: SavePlanFeaturePayload) {
  const { data } = await api.post<{ feature: PlanFeature }>("/dev/plan-features", payload);
  return data.feature;
}

export async function updateDevPlanFeature(featureId: string, payload: SavePlanFeaturePayload) {
  const { data } = await api.put<{ feature: PlanFeature }>(`/dev/plan-features/${encodeURIComponent(featureId)}`, payload);
  return data.feature;
}

export async function manuallyActivatePlanSubscription(payload: { planId: string; userId: string; workspaceName?: string | null }) {
  const { data } = await api.post<{ subscription: PlanSubscription }>("/dev/subscriptions/manual-activate", payload);
  return data.subscription;
}

export async function setPlanSubscriptionStatus(subscriptionId: string, action: "suspend" | "reactivate" | "cancel") {
  const { data } = await api.post<{ subscription: PlanSubscription }>(
    `/dev/subscriptions/${encodeURIComponent(subscriptionId)}/${action}`
  );
  return data.subscription;
}

export async function extendPlanSubscription(subscriptionId: string, days: number) {
  const { data } = await api.post<{ subscription: PlanSubscription }>(
    `/dev/subscriptions/${encodeURIComponent(subscriptionId)}/extend`,
    { days }
  );
  return data.subscription;
}

export async function updatePlanPaymentSettings(payload: SavePaymentSettingsPayload) {
  const { data } = await api.put<{ settings: import("../types").PaymentSettings }>("/dev/payment-settings", payload);
  return data.settings;
}

export async function markPlanPaymentOrderPaidForTest(orderId: string) {
  const { data } = await api.post<{
    order: import("../types").PaymentOrder;
    subscription: import("../types").PlanSubscription | null;
  }>(`/dev/payment-orders/${encodeURIComponent(orderId)}/test-paid`);
  return data;
}

export async function getDatabaseMaintenanceModules() {
  const { data } = await api.get<{ modules: import("../types").DatabaseMaintenanceModuleOption[] }>("/database-maintenance/modules");
  return data.modules;
}

export async function getSystemEmojiDashboard(botId?: string | null, guildId?: string | null) {
  const { data } = await api.get<SystemEmojiDashboard>("/dev/system-emojis", {
    params: { ...(botId ? { botId } : {}), ...(guildId ? { guildId } : {}) }
  });
  return data;
}

export async function saveSystemEmoji(key: string, payload: SaveSystemEmojiPayload) {
  const { data } = await api.patch<SystemEmojiDashboard>(`/dev/system-emojis/${encodeURIComponent(key)}`, payload, {
    params: { ...(payload.botId ? { botId: payload.botId } : {}), ...(payload.guildId ? { guildId: payload.guildId } : {}) }
  });
  return data;
}

export async function resetSystemEmoji(key: string, botId?: string | null, guildId?: string | null) {
  const { data } = await api.post<SystemEmojiDashboard>(`/dev/system-emojis/${encodeURIComponent(key)}/reset`, {
    botId: botId ?? null,
    guildId: guildId ?? null
  });
  return data;
}

export async function syncSystemEmojis(botId?: string | null, guildId?: string | null) {
  const { data } = await api.post<SystemEmojiDashboard>("/dev/system-emojis/sync", {
    botId: botId ?? null,
    guildId: guildId ?? null
  });
  return data;
}

export async function searchDatabaseMaintenanceUsers(botId: string, guildId: string, query: string) {
  const { data } = await api.get<{ users: import("../types").DatabaseMaintenanceUser[] }>(
    `/database-maintenance/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/search`,
    { params: { q: query } }
  );
  return data.users;
}

export async function getDatabaseMaintenanceUserLinks(botId: string, guildId: string, userId: string) {
  const { data } = await api.get<import("../types").DatabaseMaintenanceLinksResult>(
    `/database-maintenance/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}/links`
  );
  return data;
}

export async function deleteDatabaseMaintenanceUserLinks(botId: string, guildId: string, userId: string, confirmation: string) {
  const { data } = await api.post<{ result: import("../types").DatabaseMaintenanceActionResult }>(
    `/database-maintenance/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/users/delete`,
    { confirmation, userId },
    { timeout: 60000 }
  );
  return data.result;
}

export async function cleanupLegacyDatabaseMaintenance(botId: string, guildId: string) {
  const { data } = await api.post<{ result: import("../types").DatabaseMaintenanceActionResult }>(
    `/database-maintenance/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/cleanup-legacy`,
    undefined,
    { timeout: 60000 }
  );
  return data.result;
}

export async function resetDatabaseMaintenanceModule(botId: string, guildId: string, module: string, confirmation: string) {
  const { data } = await api.post<{ result: import("../types").DatabaseMaintenanceActionResult }>(
    `/database-maintenance/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/reset-module`,
    { confirmation, module },
    { timeout: 60000 }
  );
  return data.result;
}

export async function resetDatabaseMaintenanceServer(botId: string, guildId: string, confirmation: string) {
  const { data } = await api.post<{ result: import("../types").DatabaseMaintenanceActionResult }>(
    `/database-maintenance/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/reset-server`,
    { confirmation },
    { timeout: 120000 }
  );
  return data.result;
}

export async function listBotGuildConfigs(botId: string) {
  const { data } = await api.get<{ configs: BotGuildConfig[] }>(`/dev/bots/${botId}/guilds`);
  return data.configs;
}

export async function getBotGuildConfig(botId: string, guildId: string) {
  const { data } = await api.get<{ config: BotGuildConfig }>(`/dev/bots/${botId}/guilds/${guildId}/config`);
  return data.config;
}

export async function getDashboardBotGuildConfig(botId: string, guildId: string) {
  const { data } = await api.get<{ config: BotGuildConfig }>(`/dashboard/bots/${botId}/guilds/${guildId}/config`);
  return data.config;
}

export async function releaseDashboardBotGuildModule(botId: string, guildId: string, moduleId: string, guildName?: string | null) {
  const { data } = await api.post<{ config: BotGuildConfig }>(
    `/dashboard/bots/${botId}/guilds/${guildId}/modules/${moduleId}/release`,
    { guildName }
  );
  return data.config;
}

export async function updateBotGuildConfig(botId: string, guildId: string, payload: Pick<BotGuildConfig, "guildName" | "modules">) {
  const { data } = await api.patch<{ config: BotGuildConfig }>(`/dev/bots/${botId}/guilds/${guildId}/config`, payload);
  return data.config;
}

export async function getNexTechInviteDashboard(botId?: string | null, guildId?: string | null) {
  const path = botId && guildId
    ? `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nextech-invites`
    : "/dev/nextech/invites";
  const { data } = await api.get<NexTechInviteDashboard>(path, {
    params: botId && guildId ? undefined : { botId: botId || undefined, guildId: guildId || undefined }
  });
  return data;
}

export async function generateNexTechInviteCode() {
  const { data } = await api.post<{ code: string }>("/dev/nextech/invites/generate-code");
  return data.code;
}

export async function createNexTechInvite(payload: SaveNexTechInvitePayload, botId?: string | null, guildId?: string | null) {
  const path = botId && guildId
    ? `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nextech-invites`
    : "/dev/nextech/invites";
  const { data } = await api.post<{ invite: NexTechInvite }>(path, payload);
  return data.invite;
}

export async function updateNexTechInvite(inviteId: string, payload: Partial<SaveNexTechInvitePayload>, botId?: string | null, guildId?: string | null) {
  const path = botId && guildId
    ? `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nextech-invites/${encodeURIComponent(inviteId)}`
    : `/dev/nextech/invites/${encodeURIComponent(inviteId)}`;
  const { data } = await api.patch<{ invite: NexTechInvite }>(path, payload);
  return data.invite;
}

export async function deleteNexTechInvite(inviteId: string) {
  const { data } = await api.delete<{ invite: NexTechInvite }>(`/dev/nextech/invites/${encodeURIComponent(inviteId)}`);
  return data.invite;
}

export async function getNexTechSalesDashboard(botId: string, guildId: string) {
  const { data } = await api.get<NexTechSalesDashboard>(`/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales`);
  return data;
}

export async function saveNexTechSalesSettings(botId: string, guildId: string, payload: SaveNexTechSalesSettingsPayload) {
  const { data } = await api.patch<{ settings: NexTechSalesSettings }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/settings`,
    payload
  );
  return data.settings;
}

export async function getSalesTicketDashboard(botId: string, guildId: string) {
  const { data } = await api.get<SalesTicketDashboard>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets`
  );
  return data;
}

export async function saveSalesTicketSettings(botId: string, guildId: string, payload: SaveSalesTicketSettingsPayload) {
  const { data } = await api.patch<{ settings: SalesTicketSettings }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets/settings`,
    payload
  );
  return data.settings;
}

export async function publishSalesTicketPanel(botId: string, guildId: string) {
  const { data } = await api.post<{ settings: SalesTicketSettings }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets/panel`
  );
  return data.settings;
}

export async function createSalesTicketType(botId: string, guildId: string, payload: SaveSalesTicketTypePayload) {
  const { data } = await api.post<{ type: SalesTicketType }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets/types`,
    payload
  );
  return data.type;
}

export async function updateSalesTicketType(botId: string, guildId: string, typeId: string, payload: SaveSalesTicketTypePayload) {
  const { data } = await api.patch<{ type: SalesTicketType }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets/types/${encodeURIComponent(typeId)}`,
    payload
  );
  return data.type;
}

export async function duplicateSalesTicketType(botId: string, guildId: string, typeId: string) {
  const { data } = await api.post<{ type: SalesTicketType }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets/types/${encodeURIComponent(typeId)}/duplicate`
  );
  return data.type;
}

export async function deleteSalesTicketType(botId: string, guildId: string, typeId: string) {
  const { data } = await api.delete<{ type: SalesTicketType }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/tickets/types/${encodeURIComponent(typeId)}`
  );
  return data.type;
}

export async function saveNexTechPaymentProvider(botId: string, guildId: string, payload: SaveNexTechPaymentProviderPayload) {
  const { data } = await api.post<{ settings: NexTechSalesSettings }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/providers`,
    payload
  );
  return data.settings;
}

export async function testNexTechPaymentProvider(botId: string, guildId: string, payload: SaveNexTechPaymentProviderPayload) {
  const { data } = await api.post<{ result: MercadoPagoConnectionTest }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/providers/test`,
    payload
  );
  return data.result;
}

export async function deleteNexTechPaymentProvider(botId: string, guildId: string, providerId: string) {
  const { data } = await api.delete<{ settings: NexTechSalesSettings }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/providers/${encodeURIComponent(providerId)}`
  );
  return data.settings;
}

export async function getPaymentGatewayDashboard(guildId: string, botId: string) {
  const { data } = await api.get<NexTechSalesDashboard>(`/payment-gateway/${encodeURIComponent(guildId)}`, {
    params: botParams(botId)
  });
  return data;
}

export async function savePaymentGatewayProvider(guildId: string, botId: string, payload: SaveNexTechPaymentProviderPayload) {
  const { data } = await api.post<{ settings: NexTechSalesSettings }>(
    `/payment-gateway/${encodeURIComponent(guildId)}/providers`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function testPaymentGatewayProvider(guildId: string, botId: string, payload: SaveNexTechPaymentProviderPayload) {
  const { data } = await api.post<{ result: MercadoPagoConnectionTest }>(
    `/payment-gateway/${encodeURIComponent(guildId)}/providers/test`,
    payload,
    { params: botParams(botId) }
  );
  return data.result;
}

export async function deletePaymentGatewayProvider(guildId: string, botId: string, providerId: string) {
  const { data } = await api.delete<{ settings: NexTechSalesSettings }>(
    `/payment-gateway/${encodeURIComponent(guildId)}/providers/${encodeURIComponent(providerId)}`,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function createNexTechProduct(botId: string, guildId: string, payload: SaveNexTechProductPayload) {
  const { data } = await api.post<{ product: NexTechProduct }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/products`,
    payload
  );
  return data.product;
}

export async function updateNexTechProduct(botId: string, guildId: string, productId: string, payload: SaveNexTechProductPayload) {
  const { data } = await api.patch<{ product: NexTechProduct }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/products/${encodeURIComponent(productId)}`,
    payload
  );
  return data.product;
}

export async function duplicateNexTechProduct(botId: string, guildId: string, productId: string) {
  const { data } = await api.post<{ product: NexTechProduct }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/products/${encodeURIComponent(productId)}/duplicate`
  );
  return data.product;
}

export async function deleteNexTechProduct(botId: string, guildId: string, productId: string) {
  const { data } = await api.delete<{ product: NexTechProduct }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/products/${encodeURIComponent(productId)}`
  );
  return data.product;
}

export async function uploadNexTechProductBanner(botId: string, guildId: string, productId: string, file: File) {
  const { data } = await api.put<{ product: NexTechProduct }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/products/${encodeURIComponent(productId)}/banner`,
    file,
    {
      headers: {
        "Content-Type": file.type || "application/octet-stream"
      },
      timeout: 30000
    }
  );
  return data.product;
}

export async function createNexTechSalesPlan(botId: string, guildId: string, payload: SaveNexTechSalesPlanPayload) {
  const { data } = await api.post<{ plan: NexTechSalesPlan }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/plans`,
    payload
  );
  return data.plan;
}

export async function updateNexTechSalesPlan(botId: string, guildId: string, planId: string, payload: SaveNexTechSalesPlanPayload) {
  const { data } = await api.patch<{ plan: NexTechSalesPlan }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/plans/${encodeURIComponent(planId)}`,
    payload
  );
  return data.plan;
}

export async function deleteNexTechSalesPlan(botId: string, guildId: string, planId: string) {
  const { data } = await api.delete<{ plan: NexTechSalesPlan }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/plans/${encodeURIComponent(planId)}`
  );
  return data.plan;
}

export async function createNexTechSale(botId: string, guildId: string, payload: SaveNexTechSalePayload) {
  const { data } = await api.post<{ sale: NexTechSale }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/sales`,
    payload
  );
  return data.sale;
}

export async function updateNexTechSaleStatus(botId: string, guildId: string, saleId: string, status: NexTechSaleStatus) {
  const { data } = await api.patch<{ sale: NexTechSale }>(
    `/dev/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/nex-tech-sales/sales/${encodeURIComponent(saleId)}/status`,
    { status }
  );
  return data.sale;
}

export async function getPublicNexTechProduct(storeId: string, slug: string) {
  const { data } = await api.get<PublicNexTechProduct>(
    `/nex-tech-sales/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(slug)}`
  );
  return data;
}

export async function checkoutNexTechProduct(
  storeId: string,
  slug: string,
  payload: {
    buyerEmail?: string | null;
    buyerId?: string | null;
    buyerName?: string | null;
    paymentProviderId?: string | null;
    planType: "monthly" | "lifetime";
  }
) {
  const { data } = await api.post<{
    checkoutUrl: string | null;
    gatewayId: string;
    instructions: string | null;
    provider: string;
    publicKey: string | null;
    sale: NexTechSale;
    successUrl: string;
  }>(
    `/nex-tech-sales/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(slug)}/checkout`,
    payload
  );
  return data;
}

export async function getPriceTablesDashboard(botId: string, guildId: string) {
  const { data } = await api.get<PriceTablesDashboard>(`/price-tables/${encodeURIComponent(guildId)}`, {
    params: botParams(botId)
  });
  return data;
}

export async function getCoursesDashboard(botId: string, guildId: string) {
  const { data } = await api.get<CoursesDashboard>(`/courses/${encodeURIComponent(guildId)}`, {
    params: botParams(botId)
  });
  return data;
}

export async function saveCourseSettings(botId: string, guildId: string, payload: SaveCourseSettingsPayload) {
  const { data } = await api.patch<{ settings: CoursesDashboard["settings"] }>(
    `/courses/${encodeURIComponent(guildId)}/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function saveCourseInstructorTrackingSettings(botId: string, guildId: string, payload: Partial<CourseInstructorTrackingSettings>) {
  const { data } = await api.patch<{ settings: CourseInstructorTrackingSettings }>(
    `/courses/${encodeURIComponent(guildId)}/instructors/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function saveCourseHistorySettings(botId: string, guildId: string, payload: Partial<CourseHistorySettings>) {
  const { data } = await api.patch<{ settings: CourseHistorySettings }>(
    `/courses/${encodeURIComponent(guildId)}/history/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function publishCoursePanel(botId: string, guildId: string) {
  const { data } = await api.post<{ settings: CoursesDashboard["settings"] }>(
    `/courses/${encodeURIComponent(guildId)}/panel`,
    undefined,
    { params: botParams(botId), timeout: 15000 }
  );
  return data.settings;
}

export async function createCourseApi(botId: string, guildId: string, payload: SaveCoursePayload) {
  const { data } = await api.post<{ course: Course }>(
    `/courses/${encodeURIComponent(guildId)}/courses`,
    payload,
    { params: botParams(botId) }
  );
  return data.course;
}

export async function updateCourseApi(botId: string, guildId: string, courseId: string, payload: Partial<SaveCoursePayload>) {
  const { data } = await api.patch<{ course: Course }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}`,
    payload,
    { params: botParams(botId) }
  );
  return data.course;
}

export async function deleteCourseApi(botId: string, guildId: string, courseId: string) {
  const { data } = await api.delete<{ course: Course }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}`,
    { params: botParams(botId) }
  );
  return data.course;
}

export async function getCourseExamDashboard(botId: string, guildId: string, courseId: string) {
  const { data } = await api.get<CourseExamDashboard>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam`,
    { params: botParams(botId) }
  );
  return data;
}

export async function saveCourseExamSettings(botId: string, guildId: string, courseId: string, payload: SaveCourseExamSettingsPayload) {
  const { data } = await api.patch<{ settings: CourseExamDashboard["settings"] }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function createCourseExamQuestionApi(botId: string, guildId: string, courseId: string, payload: SaveCourseExamQuestionPayload) {
  const { data } = await api.post<{ question: CourseExamQuestion }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam/questions`,
    payload,
    { params: botParams(botId) }
  );
  return data.question;
}

export async function updateCourseExamQuestionApi(botId: string, guildId: string, courseId: string, questionId: string, payload: Partial<SaveCourseExamQuestionPayload>) {
  const { data } = await api.patch<{ question: CourseExamQuestion }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam/questions/${encodeURIComponent(questionId)}`,
    payload,
    { params: botParams(botId) }
  );
  return data.question;
}

export async function deleteCourseExamQuestionApi(botId: string, guildId: string, courseId: string, questionId: string) {
  const { data } = await api.delete<{ question: CourseExamQuestion }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam/questions/${encodeURIComponent(questionId)}`,
    { params: botParams(botId) }
  );
  return data.question;
}

export async function reviewCourseExamAttemptApi(botId: string, guildId: string, courseId: string, attemptId: string, payload: { manualScore?: number | null; rejectionReason?: string | null; status: "approved" | "rejected" }) {
  const { data } = await api.post<{ attempt: CourseExamDashboard["attempts"][number] }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam/attempts/${encodeURIComponent(attemptId)}/review`,
    payload,
    { params: botParams(botId) }
  );
  return data.attempt;
}

export async function duplicateCourseExamQuestionApi(botId: string, guildId: string, courseId: string, questionId: string) {
  const { data } = await api.post<{ question: CourseExamQuestion }>(
    `/courses/${encodeURIComponent(guildId)}/courses/${encodeURIComponent(courseId)}/exam/questions/${encodeURIComponent(questionId)}/duplicate`,
    undefined,
    { params: botParams(botId) }
  );
  return data.question;
}

export async function getRhAdminDashboard(botId: string, guildId: string) {
  const { data } = await api.get<RhAdminDashboard>(`/rh-admin/${encodeURIComponent(guildId)}`, {
    params: botParams(botId)
  });
  return data;
}

export async function saveRhAdminSettings(botId: string, guildId: string, payload: SaveRhAdminSettingsPayload) {
  const { data } = await api.patch<{ settings: RhAdminDashboard["settings"] }>(
    `/rh-admin/${encodeURIComponent(guildId)}/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function publishRhAdminPanel(botId: string, guildId: string) {
  const { data } = await api.post<{ settings: RhAdminDashboard["settings"] }>(
    `/rh-admin/${encodeURIComponent(guildId)}/panel`,
    undefined,
    { params: botParams(botId), timeout: 15000 }
  );
  return data.settings;
}

export async function createPriceTable(botId: string, guildId: string, payload: SavePriceTablePayload) {
  const { data } = await api.post<{ table: PriceTable }>(`/price-tables/${encodeURIComponent(guildId)}`, payload, {
    params: botParams(botId)
  });
  return data.table;
}

export async function updatePriceTable(botId: string, guildId: string, tableId: string, payload: SavePriceTablePayload) {
  const { data } = await api.patch<{ table: PriceTable }>(
    `/price-tables/${encodeURIComponent(guildId)}/${encodeURIComponent(tableId)}`,
    payload,
    { params: botParams(botId) }
  );
  return data.table;
}

export async function deletePriceTableApi(botId: string, guildId: string, tableId: string) {
  const { data } = await api.delete<{ table: PriceTable }>(
    `/price-tables/${encodeURIComponent(guildId)}/${encodeURIComponent(tableId)}`,
    { params: botParams(botId) }
  );
  return data.table;
}

export async function publishPriceTable(botId: string, guildId: string, tableId: string) {
  const { data } = await api.post<{ table: PriceTable }>(
    `/price-tables/${encodeURIComponent(guildId)}/${encodeURIComponent(tableId)}/publish`,
    undefined,
    { params: botParams(botId), timeout: 15000 }
  );
  return data.table;
}

export async function getManualPaymentsDashboard(botId: string, guildId: string) {
  const { data } = await api.get<ManualPaymentsDashboard>(`/manual-payments/${encodeURIComponent(guildId)}`, {
    params: botParams(botId)
  });
  return data;
}

export async function saveManualPaymentSettings(botId: string, guildId: string, payload: SaveManualPaymentSettingsPayload) {
  const { data } = await api.put<{ settings: ManualPaymentsDashboard["settings"] }>(
    `/manual-payments/${encodeURIComponent(guildId)}/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function uploadManualPaymentQrCode(botId: string, guildId: string, file: File) {
  const { data } = await api.put<{ settings: ManualPaymentsDashboard["settings"] }>(
    `/manual-payments/${encodeURIComponent(guildId)}/qr-code`,
    file,
    {
      headers: {
        "Content-Type": file.type || "application/octet-stream"
      },
      params: botParams(botId),
      timeout: 30000
    }
  );
  return data.settings;
}

export async function publishManualPaymentPanel(botId: string, guildId: string) {
  const { data } = await api.post<{ settings: ManualPaymentsDashboard["settings"] }>(
    `/manual-payments/${encodeURIComponent(guildId)}/panel`,
    undefined,
    { params: botParams(botId), timeout: 15000 }
  );
  return data.settings;
}

export async function getZtkWebhookDashboard(botId: string, guildId: string, clanId?: string | null) {
  const { data } = await api.get<ZtkWebhookDashboard>(`/ztk-webhook/${encodeURIComponent(guildId)}`, {
    params: { ...botParams(botId), ...(clanId ? { clanId } : {}) }
  });
  return data;
}

export async function createZtkWebhookClan(botId: string, guildId: string, payload: { clanName: string; ownerUserId?: string }) {
  const { data } = await api.post<{ clan: ZtkWebhookClan }>(
    `/ztk-webhook/${encodeURIComponent(guildId)}/clans`,
    payload,
    { params: botParams(botId) }
  );
  return data.clan;
}

export async function saveZtkWebhookClan(botId: string, guildId: string, clanId: string, payload: SaveZtkWebhookClanPayload) {
  const { data } = await api.patch<{ clan: ZtkWebhookClan }>(
    `/ztk-webhook/${encodeURIComponent(guildId)}/clans/${encodeURIComponent(clanId)}`,
    payload,
    { params: botParams(botId) }
  );
  return data.clan;
}

export async function updateZtkWebhookState(botId: string, guildId: string, clanId: string, action: "create" | "delete" | "disable" | "regenerate") {
  const { data } = await api.post<{ clan: ZtkWebhookClan }>(
    `/ztk-webhook/${encodeURIComponent(guildId)}/clans/${encodeURIComponent(clanId)}/webhook/${action}`,
    undefined,
    { params: botParams(botId), timeout: 40000 }
  );
  return data.clan;
}

export async function createZtkReward(botId: string, guildId: string, clanId: string, payload: SaveZtkRewardPayload) {
  const { data } = await api.post<{ reward: ZtkReward }>(
    `/ztk-webhook/${encodeURIComponent(guildId)}/clans/${encodeURIComponent(clanId)}/rewards`,
    payload,
    { params: botParams(botId) }
  );
  return data.reward;
}

export async function getAdvancedModuleConfig(botId: string, guildId: string, moduleId: string) {
  const { data } = await api.get<{ module: AdvancedModuleConfig }>(
    `/advanced-modules/${encodeURIComponent(botId)}/${encodeURIComponent(guildId)}/${encodeURIComponent(moduleId)}`
  );
  return data.module;
}

export async function saveAdvancedModuleConfig(
  botId: string,
  guildId: string,
  moduleId: string,
  payload: { config: Record<string, unknown>; guildName?: string }
) {
  const { data } = await api.patch<{ module: AdvancedModuleConfig }>(
    `/advanced-modules/${encodeURIComponent(botId)}/${encodeURIComponent(guildId)}/${encodeURIComponent(moduleId)}`,
    payload
  );
  return data.module;
}

export async function runTagVerificationNow(botId: string, guildId: string) {
  const { data } = await api.post<{ result: import("../types").TagVerificationRunResult }>(
    `/advanced-modules/${encodeURIComponent(botId)}/${encodeURIComponent(guildId)}/tag-verification/run`,
    undefined,
    { timeout: 120_000 }
  );
  return data.result;
}

export async function getServerBackupDashboard(botId: string, guildId: string) {
  const { data } = await api.get<ServerBackupDashboard>(`/server-backups/${encodeURIComponent(guildId)}`, {
    params: botParams(botId)
  });
  return data;
}

export async function saveServerBackupSettings(botId: string, guildId: string, payload: Partial<ServerBackupSettings>) {
  const { data } = await api.patch<{ settings: ServerBackupSettings }>(
    `/server-backups/${encodeURIComponent(guildId)}/settings`,
    payload,
    { params: botParams(botId) }
  );
  return data.settings;
}

export async function createServerBackup(botId: string, guildId: string) {
  const { data } = await api.post<{ backup: ServerBackupSnapshot }>(
    `/server-backups/${encodeURIComponent(guildId)}/backups`,
    undefined,
    { params: botParams(botId), timeout: 180000 }
  );
  return data.backup;
}

export async function deleteServerBackup(botId: string, guildId: string, backupId: string) {
  await api.delete(`/server-backups/${encodeURIComponent(guildId)}/backups/${encodeURIComponent(backupId)}`, {
    params: botParams(botId)
  });
}

export async function previewServerBackupRestore(botId: string, guildId: string, backupId: string, parts: ServerBackupRestorePart[], targetGuildId?: string | null, mode: import("../types").ServerBackupRestoreMode = "merge") {
  const { data } = await api.post<{ preview: ServerBackupRestorePreview }>(
    `/server-backups/${encodeURIComponent(guildId)}/backups/${encodeURIComponent(backupId)}/preview`,
    { mode, parts, targetGuildId },
    { params: botParams(botId), timeout: 30000 }
  );
  return data.preview;
}

export async function restoreServerBackup(botId: string, guildId: string, backupId: string, parts: ServerBackupRestorePart[], confirmation: string, targetGuildId?: string | null, mode: import("../types").ServerBackupRestoreMode = "merge") {
  const { data } = await api.post(
    `/server-backups/${encodeURIComponent(guildId)}/backups/${encodeURIComponent(backupId)}/restore`,
    { confirmation, mode, parts, targetGuildId },
    { params: botParams(botId), timeout: 600000 }
  );
  return data.job;
}

export async function getAntiBanConfig(botId: string, guildId: string) {
  const { data } = await api.get<{ config: import("../types").AntiBanConfig; readiness: import("../types").AntiBanReadiness }>(
    `/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/anti-ban`
  );
  return data;
}

export async function saveAntiBanConfig(botId: string, guildId: string, config: import("../types").AntiBanConfig) {
  const { id: _id, botId: _botId, guildId: _guildId, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = config;
  const { data } = await api.post<{ config: import("../types").AntiBanConfig; readiness: import("../types").AntiBanReadiness }>(
    `/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/anti-ban`,
    payload
  );
  return data;
}

export async function getAntiBanLogs(botId: string, guildId: string) {
  const { data } = await api.get<{ logs: import("../types").AntiBanLog[] }>(
    `/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/anti-ban/logs`
  );
  return data.logs;
}

export async function testAntiBanProtection(botId: string, guildId: string) {
  const { data } = await api.post<{ delivered: boolean; readiness: import("../types").AntiBanReadiness }>(
    `/bots/${encodeURIComponent(botId)}/guilds/${encodeURIComponent(guildId)}/anti-ban/test`
  );
  return data;
}

export async function startAllDevBots() {
  const { data } = await api.post<{ affected: number; bots: DevBot[] }>("/dev/bots/start-all", undefined, {
    timeout: 45000
  });
  return data;
}

export async function stopAllDevBots() {
  const { data } = await api.post<{ affected: number; bots: DevBot[] }>("/dev/bots/stop-all", undefined, {
    timeout: 45000
  });
  return data;
}

export async function getMaintenanceState() {
  const { data } = await api.get<{ maintenance: MaintenanceState }>("/dev/maintenance");
  return data.maintenance;
}

export async function setMaintenanceMode(active: boolean) {
  const { data } = await api.patch<{ maintenance: MaintenanceState }>("/dev/maintenance", {
    active
  });
  return data.maintenance;
}

export async function sendMaintenanceAlert() {
  const { data } = await api.post<{ maintenance: MaintenanceState }>("/dev/maintenance/alert");
  return data.maintenance;
}

export async function getDevAccessEntries() {
  const { data } = await api.get<{ entries: DevAccessEntry[] }>("/dev/access");
  return data.entries;
}

export async function saveDevAccessEntry(payload: { role: DevAccessRole; userId: string }) {
  const { data } = await api.post<{ entry: DevAccessEntry }>("/dev/access", payload);
  return data.entry;
}

export async function deleteDevAccessEntry(userId: string) {
  const { data } = await api.delete<{ entry: DevAccessEntry }>(`/dev/access/${encodeURIComponent(userId)}`);
  return data.entry;
}

export async function createDevBot(payload: CreateDevBotPayload) {
  const { data } = await api.post<{ bot: DevBot }>("/dev/bots/create", payload, {
    timeout: 16000
  });
  return data.bot;
}

export async function updateDevBotToken(botId: string, token: string) {
  const { data } = await api.patch<{ bot: DevBot }>(`/dev/bots/${encodeURIComponent(botId)}`, {
    token
  }, {
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
