import axios, { type AxiosInstance } from "axios";
import { env } from "../config/env";
import type { GuildSettings } from "../types";

export type CreateLogInput = {
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
};

export type LiveEventInput = {
  botId?: string | null;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
};

export type BotCommandAuthorization = {
  allowed: boolean;
  botId: string | null;
  checkedAt: string;
  commandName: string;
  guildId: string;
  moduleId: string | null;
  policy: "fail_closed";
  reason: string;
  reasonCode: string;
};

export type BotRuntimeModules = {
  active: boolean;
  botId: string;
  checkedAt: string;
  enabledModules: string[];
  status: "online" | "offline" | "invalid_token" | "error";
};

export type MaintenanceState = {
  active: boolean;
  activatedAt: string | null;
  affectedBots: number;
  deactivatedAt: string | null;
  updatedAt: string;
  updatedById: string | null;
  updatedByName: string | null;
};

export type SafeBotMessageState = {
  botId: string | null;
  guildId: string;
  channelId: string;
  messageId: string;
  updatedAt: string;
};

export type BotRuntimeModuleAuthorization = {
  allowed: boolean;
  botAuthorized: boolean;
  botId: string | null;
  botStatus: "online" | "offline" | "invalid_token" | "error" | null;
  checkedAt: string;
  guildAuthorized: boolean;
  guildId: string;
  licenseExpiresAt: string | null;
  licenseStatus: string | null;
  licenseValid: boolean;
  moduleEnabled: boolean;
  moduleId: string;
  moduleReleased: boolean;
  plan: string | null;
  policy: "fail_closed";
  reason: string;
  reasonCode: string;
  releaseModuleId: string | null;
};

export type ImageAntiSpamSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  immuneRoleIds: string[];
  ignoredChannelIds: string[];
  maxImages: number;
  windowSeconds: number;
  warningsEnabled: boolean;
  progressiveTimeoutEnabled: boolean;
  autoKickEnabled: boolean;
  maxWarnings: number;
  ignoreAdministrators: boolean;
  warningResetDays: number;
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamIncident = {
  id: string;
  botId: string;
  guildId: string;
  incidentKey: string;
  userId: string;
  username: string | null;
  channelId: string;
  channelIds: string[];
  mediaTypes: string[];
  messageIds: string[];
  removedImages: number;
  removedMessages: number;
  warningCount: number;
  timeoutMs: number;
  action: "none" | "warning" | "timeout" | "kick";
  actionSucceeded: boolean | null;
  actionError: string | null;
  reason: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamUser = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  warningCount: number;
  totalImagesRemoved: number;
  lastInfractionAt: string | null;
  lastPunishment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImageAntiSpamIncidentResult = {
  duplicate: boolean;
  incident: ImageAntiSpamIncident;
  settings: ImageAntiSpamSettings;
  user: ImageAntiSpamUser;
};

export type VoiceRecorderSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  allowedRoleIds: string[];
  maxDurationMinutes: number;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type VoiceRecordingStatus = "starting" | "recording" | "processing" | "completed" | "failed" | "deleted";

export type VoiceRecording = {
  id: string;
  botId: string;
  guildId: string;
  guildName: string | null;
  channelId: string;
  channelName: string | null;
  startedById: string;
  startedByTag: string | null;
  stoppedById: string | null;
  stoppedByTag: string | null;
  source: "discord" | "dashboard";
  participants: Array<{
    userId: string;
    username: string | null;
    joinedAt: string;
    leftAt: string | null;
    speakingMs: number;
  }>;
  events: Array<{
    type: string;
    userId: string | null;
    username: string | null;
    message: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  fileName: string | null;
  fileSize: number;
  fileUrl: string | null;
  downloadUrl: string | null;
  mimeType: string | null;
  status: VoiceRecordingStatus;
  error: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceRecordingStartResult = {
  recording: VoiceRecording;
  settings: VoiceRecorderSettings;
};

export type SelfBotProtectionModuleId =
  | "anti-spam"
  | "anti-flood"
  | "anti-imagens"
  | "anti-gif"
  | "anti-mencoes"
  | "anti-emojis"
  | "anti-convites"
  | "anti-links"
  | "anti-scam"
  | "anti-raid"
  | "anti-caps-lock"
  | "anti-texto-repetido"
  | "anti-copypasta"
  | "anti-flood-multi-canais"
  | "anti-anexos"
  | "anti-webhook"
  | "anti-bots"
  | "anti-contas-novas"
  | "anti-token-grabber"
  | "anti-phishing"
  | "anti-nitro-scam"
  | "anti-mass-ping"
  | "anti-divulgacao"
  | "anti-auto-spam"
  | "anti-comandos-em-massa";

export type SelfBotPunishmentAction =
  | "delete_message"
  | "warn"
  | "log"
  | "timeout"
  | "remove_role"
  | "add_role"
  | "kick"
  | "ban";

export type PunishmentDuration = {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
};

export type SelfBotPunishmentStep = {
  id: string;
  acao: SelfBotPunishmentAction;
  ativado: boolean;
  limite: number;
  proximaAcao: SelfBotPunishmentAction | null;
  apagarMensagem: boolean;
  enviarAviso: boolean;
  registrarLog: boolean;
  tempoTimeout: PunishmentDuration;
  cargoAdicionarId: string | null;
  cargoRemoverId: string | null;
  banApagarMensagensSegundos: number;
};

export type ResolvedSelfBotPunishment = {
  actionCount: number;
  step: SelfBotPunishmentStep;
  totalOccurrences: number;
};

export type SelfBotProtectionSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  moduleToggles: Record<SelfBotProtectionModuleId, boolean>;
  ignoredChannelIds: string[];
  protectedChannelIds: string[];
  mediaChannelIds: string[];
  linkChannelIds: string[];
  logChannelId: string | null;
  punishmentLogChannelId: string | null;
  logWebhookUrl: string | null;
  embedColor: string;
  punishmentSequence: SelfBotPunishmentAction[];
  punishmentSteps: SelfBotPunishmentStep[];
  addRoleId: string | null;
  removeRoleId: string | null;
  timeoutSeconds: number;
  floodLimit: number;
  floodWindowSeconds: number;
  imageLimit: number;
  imageWindowSeconds: number;
  mentionLimit: number;
  emojiLimit: number;
  capsMinLength: number;
  capsPercentage: number;
  repeatedTextLimit: number;
  repeatedTextWindowSeconds: number;
  multiChannelLimit: number;
  multiChannelWindowSeconds: number;
  raidJoinLimit: number;
  raidWindowSeconds: number;
  newAccountMaxAgeHours: number;
  suspiciousDomains: string[];
  blockedTerms: string[];
  createdAt: string;
  updatedAt: string;
};

export type SelfBotRoleAssignment = {
  botId: string;
  guildId: string;
  lastIncidentId: string;
  lastPunishedAt: string;
  roleId: string | null;
  userId: string;
  username: string | null;
};

export type SelfBotProtectionIncident = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  channelId: string | null;
  messageId: string | null;
  messageContent: string | null;
  moduleId: SelfBotProtectionModuleId;
  infractionType: string;
  punishmentActions: SelfBotPunishmentAction[];
  punishmentSucceeded: boolean;
  punishmentError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SocialNotification = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  platform: "twitch";
  twitchChannelName: string;
  twitchChannelUrl: string;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KickNotification = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  platform: "kick";
  kickChannelName: string;
  kickChannelUrl: string;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickBanner?: string | null;
  kickFollowers?: number | null;
  kickVerified?: boolean | null;
  kickCategory?: string | null;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: string | null;
  lastEndedAt?: string | null;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  peakViewers?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type KickStream = {
  id: string;
  broadcasterUserId: string;
  channelId: string | null;
  slug: string;
  displayName: string;
  categoryName: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string | null;
  startedAt: string;
  avatar: string | null;
  url: string;
};

export type ClipMentionType = "none" | "everyone" | "role";
export type ClipPlatform = "twitch" | "kick";

export type ClipRewardRole = {
  clipCount: number;
  label: string;
  roleId: string;
};

export type ClipRewardAssignment = ClipRewardRole & {
  userId: string;
};

export type ClipsConfig = {
  id: string;
  guildId: string;
  botId: string | null;
  platform: ClipPlatform;
  channelName: string;
  broadcasterId: string;
  displayName: string | null;
  avatar: string | null;
  channelUrl: string | null;
  captureAvailable: boolean;
  providerStatus: string;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName: string | null;
  twitchAvatar: string | null;
  kickChannelName: string | null;
  kickChannelUrl: string | null;
  kickChannelId: string | null;
  kickUserId: string | null;
  kickDisplayName: string | null;
  kickAvatar: string | null;
  kickFollowers: number | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  clipRewards: ClipRewardRole[];
  lastCheckAt: string | null;
  activeLiveSessionId: string | null;
  activeLiveStartedAt: string | null;
  activeLiveTitle: string | null;
  activeLiveThumbnail: string | null;
  totalSent: number;
  createdAt: string;
  updatedAt: string;
};

export type GiveawayParticipant = {
  id: string;
  accountId: string | null;
  platform: "twitch" | "kick";
  platformUserId: string;
  username: string;
  displayName: string;
  subscriber: boolean;
  follower: boolean;
  source: "twitch" | "kick";
  subTier: string | null;
  subTierLabel: string | null;
  subMonths: number | null;
  isPrime: boolean;
  isVip: boolean;
  isModerator: boolean;
  isEditor: boolean;
  tickets: number;
  eligible: boolean;
  invalidReason: string | null;
  validatedAt: string;
};

export type GiveawayWinner = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: string;
};

export type GiveawayStatus = "waiting" | "running" | "ended";

export type Giveaway = {
  id: string;
  botId: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch" | "kick" | "multi";
  twitchBroadcasterId: string;
  twitchChannelName: string | null;
  kickChannelName: string | null;
  kickUserId: string | null;
  kickChannelId: string | null;
  participantMode: "twitch_subs" | "twitch_followers" | "twitch_subs_followers" | "kick_subs" | "kick_followers" | "twitch_kick" | "all";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  prizeName: string;
  participants: GiveawayParticipant[];
  winners: GiveawayWinner[];
  status: GiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  customMessage: string | null;
  schedulerError: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
};

export type SocialPlatform =
  | "twitter"
  | "instagram"
  | "twitch"
  | "youtube"
  | "tiktok"
  | "kick"
  | "facebook"
  | "website";

export type SocialMember = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string | null;
  discordId: string | null;
  name: string;
  avatar: string | null;
  role: string | null;
  links: Record<SocialPlatform, string>;
  createdAt: string;
  updatedAt: string;
};

export type SocialPanel = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string | null;
  messageId: string | null;
  embedColor: string;
  published: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  lastPublishedAt: string | null;
};

export type SocialPanelPayload = {
  members: SocialMember[];
  panel: SocialPanel;
};

export type XApiStatus = "idle" | "ok" | "error";

export type XAccount = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId: string;
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  active: boolean;
  lastSyncAt: string | null;
  lastPostId: string | null;
  lastPostAt: string | null;
  lastApiStatus: XApiStatus;
  lastApiError: string | null;
  totalPostsSent: number;
  createdAt: string;
  updatedAt: string;
};

export type XPost = {
  id: string;
  text: string;
  createdAt: string;
  url: string;
  mediaUrls: string[];
};

export type XSyncResult = {
  account: XAccount;
  posts: XPost[];
};

export type FivemFacMessages = {
  panelTitle: string;
  panelDescription: string;
  requestCreated: string;
  approved: string;
  rejected: string;
  started: string;
  finished: string;
};

export type FivemFacPanelButton = {
  id: string;
  label: string;
  emoji: string | null;
  style: "primary" | "secondary" | "success" | "danger" | "link";
  type: "action" | "url";
  action: "request_absence" | "my_absences" | "url";
  url: string | null;
  order: number;
  enabled: boolean;
};

export type FivemFacPanelVisual = {
  panelColor: string;
  imageUrl: string | null;
  imagePosition: "right_small" | "top" | "bottom" | "none";
  buttonsPosition: "inside_panel" | "outside_panel" | "below" | "rows" | "none";
  buttons: FivemFacPanelButton[];
  componentsOrder: Array<"image" | "text" | "buttons">;
  enabledSections: {
    image: boolean;
    buttons: boolean;
    description: boolean;
  };
};

export type FivemFacSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  absenceRoleId: string | null;
  viewerRoleIds: string[];
  approverRoleIds: string[];
  memberRoleIds: string[];
  logChannelId: string | null;
  messages: FivemFacMessages;
  panelVisual: FivemFacPanelVisual;
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FivemFacAbsenceStatus = "pending" | "approved" | "active" | "rejected" | "finished" | "closed";

export type FivemFacAbsence = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  photoUrl: string | null;
  status: FivemFacAbsenceStatus;
  privateChannelId: string | null;
  requestMessageId: string | null;
  moderatorId: string | null;
  rejectionReason: string | null;
  roleAddedAt: string | null;
  roleRemovedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsFeatureId =
  | "mission"
  | "clear"
  | "voice"
  | "rich-presence"
  | "username-checker";

export type MissionToolsStatus =
  | "active"
  | "inactive"
  | "deactivated"
  | "waiting"
  | "running"
  | "completed"
  | "error";

export type MissionToolsClearMode = "bulk" | "userDm";
export type MissionToolsVoiceStatus = "connected" | "disconnected" | "reconnecting";
export type MissionToolsRichPresenceStatus = "active" | "inactive";
export type MissionToolsRichPresenceActivityType = 0 | 1 | 2 | 3 | 5;
export type MissionToolsTokenStatus = "connected" | "invalid" | "expired" | "disconnected";

export type MissionToolsRichPresenceConfig = {
  applicationId?: string;
  activityType?: MissionToolsRichPresenceActivityType;
  name?: string;
  description?: string;
  state?: string;
  details?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  startTimestamp?: string;
};

export type MissionToolsUsernameCheckerOptions = {
  usernameLength?: number;
  concurrency?: number;
  requestDelay?: number;
};

export type MissionToolsUsernameCheckerStats = {
  hits: number;
  taken: number;
  errors: number;
  activeProxies: number;
  deadProxies: number;
  bannedProxies: number;
  workersRunning: number;
};

export type MissionToolsSettings = {
  id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleIds: string[];
  allowedRoleIds: string[];
  enabledFeatures: MissionToolsFeatureId[];
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsUserPanel = {
  id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  dmChannelId: string | null;
  clearMessageId: string | null;
  missionMessageId: string | null;
  voiceMessageId: string | null;
  richPresenceMessageId: string | null;
  usernameCheckerMessageId: string | null;
  tokenConfigured: boolean;
  tokenStatus: MissionToolsTokenStatus;
  tokenLast4: string | null;
  tokenUpdatedAt: string | null;
  tokenLastValidatedAt: string | null;
  tokenInvalidReason: string | null;
  clearStatus: MissionToolsStatus;
  clearMode: MissionToolsClearMode;
  clearTargetUserId: string | null;
  missionStatus: MissionToolsStatus;
  voiceStatus: MissionToolsVoiceStatus;
  richPresenceStatus: MissionToolsRichPresenceStatus;
  usernameCheckerStatus: MissionToolsStatus;
  currentMission: string | null;
  missionDetail: string | null;
  voiceGuildId: string | null;
  voiceGuildName: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  voiceConnectedAt: string | null;
  richPresenceConfig: MissionToolsRichPresenceConfig;
  richPresenceUpdatedAt: string | null;
  usernameCheckerOptions: MissionToolsUsernameCheckerOptions;
  usernameCheckerStats: MissionToolsUsernameCheckerStats;
  usernameCheckerLastEvent: string | null;
  usernameCheckerUpdatedAt: string | null;
  completedCount: number;
  totalMissions: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolsUserPatch = Partial<Omit<
  MissionToolsUserPanel,
  "id" | "botId" | "guildId" | "userId" | "createdAt" | "updatedAt"
>>;

export type MissionToolsTokenResponse = {
  token: string;
  tokenConfigured: boolean;
  tokenLast4: string | null;
  tokenStatus: MissionToolsTokenStatus;
  invalidReason: string | null;
  lastValidatedAt: string | null;
  updatedAt: string;
};

export class ApiClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.BACKEND_API_URL,
      headers: {
        "x-bot-token": env.BOT_API_TOKEN,
        ...(env.DASHBOARD_BOT_ID ? { "x-dashboard-bot-id": env.DASHBOARD_BOT_ID } : {})
      },
      timeout: 8000
    });

    this.http.interceptors.request.use((config) => {
      if (!env.BACKEND_API_URL) {
        throw new Error("BACKEND_API_URL nao configurado.");
      }

      recordApiRequest(config.method, config.url);
      return config;
    });
  }

  setDiscordClientId(clientId: string) {
    this.http.defaults.headers.common["x-discord-bot-client-id"] = clientId;
  }

  async postLog(input: CreateLogInput) {
    const { data } = await this.http.post("/logs", input);
    return data;
  }

  async notifyLive(input: LiveEventInput) {
    const { data } = await this.http.post("/lives/events", input);
    return data;
  }

  async authorizeCommand(input: { channelId?: string | null; commandName: string; guildId: string; userId?: string | null }) {
    try {
      const { data } = await this.http.post<{ authorization: BotCommandAuthorization }>(
        `/bot/guilds/${input.guildId}/commands/${encodeURIComponent(input.commandName)}/authorize`,
        {
          channelId: input.channelId ?? null,
          userId: input.userId ?? null
        },
        {
          timeout: 10_000
        }
      );

      return data.authorization;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const authorization = readAuthorizationResponse(error.response?.data);

        if (authorization) {
          return authorization;
        }
      }

      throw error;
    }
  }

  async getRuntimeModules() {
    const { data } = await this.http.get<BotRuntimeModules>("/bot/runtime/modules");
    return data;
  }

  async getMaintenanceState() {
    const { data } = await this.http.get<{ maintenance: MaintenanceState }>("/bot/maintenance");
    return data.maintenance;
  }

  async authorizeRuntimeModule(guildId: string, moduleId: string) {
    const { data } = await this.http.get<{ authorization: BotRuntimeModuleAuthorization }>(
      `/bot/runtime/guilds/${guildId}/modules/${encodeURIComponent(moduleId)}/authorize`,
      {
        timeout: 8_000
      }
    );
    return data.authorization;
  }

  async createTicket(input: { guildId: string; channelId?: string | null; openerId: string; subject: string }) {
    const { data } = await this.http.post("/tickets", input);
    return data;
  }

  async getSettings(guildId: string, discordBotClientId?: string | null) {
    const { data } = await this.http.get<{ settings: GuildSettings }>(`/settings/${guildId}`, {
      headers: discordBotClientId
        ? {
            "x-discord-bot-client-id": discordBotClientId
          }
        : undefined
    });
    return data.settings;
  }

  async syncSelfBotRole(input: { guildId: string; roleId: string; roleName?: string | null }) {
    const { data } = await this.http.post<{ settings: GuildSettings }>(
      `/settings/bot/${input.guildId}/self-bot-role`,
      {
        roleId: input.roleId,
        roleName: input.roleName ?? undefined
      }
    );
    return data.settings;
  }

  async syncSafeBotSetup(input: {
    filterChannelId: string;
    filterChannelName?: string | null;
    guildId: string;
    logChannelId: string;
    logChannelName?: string | null;
    roleId: string;
    roleName?: string | null;
  }) {
    const { data } = await this.http.post<{ settings: GuildSettings }>(
      `/settings/bot/${input.guildId}/safe-bot-setup`,
      {
        filterChannelId: input.filterChannelId,
        filterChannelName: input.filterChannelName ?? undefined,
        logChannelId: input.logChannelId,
        logChannelName: input.logChannelName ?? undefined,
        roleId: input.roleId,
        roleName: input.roleName ?? undefined
      }
    );
    return data.settings;
  }

  async getSafeBotMessageState(guildId: string) {
    const { data } = await this.http.get<{ state: SafeBotMessageState | null }>(
      `/settings/bot/${guildId}/safe-bot-message`
    );
    return data.state;
  }

  async saveSafeBotMessageState(guildId: string, input: { channelId: string; messageId: string }) {
    const { data } = await this.http.put<{ state: SafeBotMessageState }>(
      `/settings/bot/${guildId}/safe-bot-message`,
      input
    );
    return data.state;
  }

  async clearSafeBotMessageState(guildId: string) {
    await this.http.delete<{ ok: boolean }>(`/settings/bot/${guildId}/safe-bot-message`);
  }

  async getImageAntiSpamSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: ImageAntiSpamSettings }>(
      `/image-anti-spam/bot/${guildId}`
    );
    return data.settings;
  }

  async recordImageAntiSpamIncident(input: {
    guildId: string;
    incidentKey: string;
    userId: string;
    username?: string | null;
    channelId: string;
    channelIds?: string[];
    mediaTypes?: string[];
    messageIds?: string[];
    removedImages: number;
    removedMessages?: number;
  }) {
    const { data } = await this.http.post<ImageAntiSpamIncidentResult>(
      "/image-anti-spam/bot/incidents",
      input
    );
    return data;
  }

  async completeImageAntiSpamIncident(
    incidentId: string,
    input: {
      actionSucceeded: boolean;
      actionError?: string | null;
    }
  ) {
    const { data } = await this.http.patch<{ incident: ImageAntiSpamIncident }>(
      `/image-anti-spam/bot/incidents/${incidentId}`,
      input
    );
    return data.incident;
  }

  async getVoiceRecorderSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: VoiceRecorderSettings }>(
      `/voice-recorder/bot/${guildId}/settings`
    );
    return data.settings;
  }

  async startVoiceRecording(input: {
    actorId: string;
    actorRoleIds: string[];
    actorTag?: string | null;
    channelId: string;
    channelName?: string | null;
    guildId: string;
    guildName?: string | null;
    source: "discord" | "dashboard";
  }) {
    const { data } = await this.http.post<VoiceRecordingStartResult>("/voice-recorder/bot/start", input, {
      timeout: 12_000
    });
    return data;
  }

  async reconcileVoiceRecordings() {
    const { data } = await this.http.post<{ recordings: VoiceRecording[] }>("/voice-recorder/bot/reconcile", {});
    return data.recordings;
  }

  async markVoiceRecordingStarted(recordingId: string, input: {
    channelName?: string | null;
    guildName?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/started`,
      input
    );
    return data.recording;
  }

  async stopVoiceRecording(input: {
    actorId: string;
    actorRoleIds: string[];
    actorTag?: string | null;
    guildId: string;
    recordingId?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>("/voice-recorder/bot/stop", input, {
      timeout: 12_000
    });
    return data.recording;
  }

  async markDashboardVoiceRecordingProcessing(recordingId: string, input: {
    actorId: string;
    actorTag?: string | null;
    guildId: string;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/processing`,
      input,
      {
        timeout: 12_000
      }
    );
    return data.recording;
  }

  async completeVoiceRecording(recordingId: string, input: {
    durationMs: number;
    endedAt?: string | null;
    filePath: string;
    fileSize: number;
    participants: Array<{
      userId: string;
      username?: string | null;
      joinedAt: string;
      leftAt?: string | null;
      speakingMs?: number;
    }>;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/complete`,
      input,
      {
        timeout: 20_000
      }
    );
    return data.recording;
  }

  async failVoiceRecording(recordingId: string, input: {
    error: string;
    guildId?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording | null }>(
      `/voice-recorder/bot/recordings/${recordingId}/fail`,
      input
    );
    return data.recording;
  }

  async recordVoiceRecordingEvent(recordingId: string, input: {
    guildId: string;
    message: string;
    metadata?: Record<string, unknown>;
    type: string;
    userId?: string | null;
    username?: string | null;
  }) {
    const { data } = await this.http.post<{ recording: VoiceRecording }>(
      `/voice-recorder/bot/recordings/${recordingId}/events`,
      input
    );
    return data.recording;
  }

  async getSelfBotProtectionSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: SelfBotProtectionSettings }>(
      `/self-bot-protection/bot/${guildId}`
    );
    return data.settings;
  }

  async getSelfBotRoleAssignments(guildId: string) {
    const { data } = await this.http.get<{ assignments: SelfBotRoleAssignment[] }>(
      `/self-bot-protection/bot/${guildId}/role-assignments`
    );
    return data.assignments;
  }

  async recordSelfBotProtectionIncident(input: {
    guildId: string;
    userId: string;
    username?: string | null;
    channelId?: string | null;
    messageId?: string | null;
    messageContent?: string | null;
    moduleId: SelfBotProtectionModuleId;
    infractionType: string;
    punishmentActions: SelfBotPunishmentAction[];
    punishmentSucceeded: boolean;
    punishmentError?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { data } = await this.http.post<{ incident: SelfBotProtectionIncident }>(
      "/self-bot-protection/bot/incidents",
      input
    );
    return data.incident;
  }

  async resolveSelfBotPunishment(input: {
    guildId: string;
    moduleId: SelfBotProtectionModuleId;
    userId: string;
  }) {
    const { data } = await this.http.post<{ punishment: ResolvedSelfBotPunishment }>(
      "/self-bot-protection/bot/punishments/next",
      input
    );
    return data.punishment;
  }

  async getActiveTwitchNotifications() {
    const { data } = await this.http.get<{ notifications: SocialNotification[] }>("/social-notifications/bot/twitch-active", {
      timeout: 30_000
    });
    return data.notifications;
  }

  async updateTwitchNotificationState(id: string, input: { isLive?: boolean; lastLiveAt?: string | null; lastStreamId?: string | null; lastMessageId?: string | null; twitchAvatar?: string | null }) {
    const { data } = await this.http.patch<{ notification: SocialNotification }>(`/social-notifications/bot/twitch/${id}/state`, input);
    return data.notification;
  }

  async getActiveKickNotifications() {
    const { data } = await this.http.get<{ notifications: KickNotification[] }>("/kick-integration/bot/active", {
      timeout: 30_000
    });
    return data.notifications;
  }

  async getActiveKickStreams() {
    const { data } = await this.http.get<{ streams: KickStream[] }>("/kick-integration/bot/streams", {
      timeout: 30_000
    });
    return new Map(data.streams.map((stream) => [stream.broadcasterUserId, stream]));
  }

  async updateKickNotificationState(id: string, input: {
    isLive?: boolean;
    kickAvatar?: string | null;
    kickCategory?: string | null;
    lastEndedAt?: string | null;
    lastLiveAt?: string | null;
    lastMessageId?: string | null;
    lastStreamId?: string | null;
    peakViewers?: number | null;
  }) {
    const { data } = await this.http.patch<{ notification: KickNotification }>(`/kick-integration/bot/${id}/state`, input);
    return data.notification;
  }

  async getActiveClipConfigs() {
    const { data } = await this.http.get<{ configs: ClipsConfig[] }>("/clips/bot/configs");
    return data.configs;
  }

  async isClipSent(configId: string, clipId: string) {
    const { data } = await this.http.get<{ sent: boolean }>(`/clips/bot/configs/${configId}/sent/${encodeURIComponent(clipId)}`);
    return data.sent;
  }

  async updateClipConfigCheck(configId: string, lastCheckAt = new Date().toISOString()) {
    await this.http.patch<{ ok: boolean }>(`/clips/bot/configs/${configId}/check`, {
      lastCheckAt
    });
  }

  async updateClipLiveSession(configId: string, input: {
    isLive: boolean;
    startedAt?: string | null;
    streamId?: string | null;
    thumbnailUrl?: string | null;
    title?: string | null;
  }) {
    await this.http.patch<{ ok: boolean }>(`/clips/bot/configs/${configId}/live-session`, input);
  }

  async recordClipSent(configId: string, input: {
    clipId: string;
    clipTitle: string;
    clipUrl: string;
    clipThumbnail?: string | null;
    clipCreatorName?: string | null;
    clipDuration?: number | null;
    createdAtTwitch: string;
    discordChannelId?: string | null;
    discordMessageId?: string | null;
  }) {
    const { data } = await this.http.post<{
      clip: unknown;
      rewards: ClipRewardAssignment[];
    }>(`/clips/bot/configs/${configId}/sent`, input);
    return data;
  }

  async getActiveGiveaways() {
    const { data } = await this.http.get<{ giveaways: Giveaway[] }>("/giveaways/bot/active");
    return data.giveaways;
  }

  async getGiveaway(giveawayId: string) {
    const { data } = await this.http.get<{ giveaway: Giveaway }>(`/giveaways/bot/${giveawayId}`);
    return data.giveaway;
  }

  async updateGiveawayPanelState(giveawayId: string, input: { panelMessageId?: string | null }) {
    const { data } = await this.http.patch<{ giveaway: Giveaway }>(`/giveaways/bot/${giveawayId}/panel-state`, input);
    return data.giveaway;
  }

  async getSocialPanels() {
    const { data } = await this.http.get<{ panels: SocialPanelPayload[] }>("/socials/bot/panels");
    return data.panels;
  }

  async getSocialPanel(panelId: string) {
    const { data } = await this.http.get<SocialPanelPayload>(`/socials/bot/panels/${panelId}`);
    return data;
  }

  async updateSocialPanelState(panelId: string, input: { messageId?: string | null; published?: boolean }) {
    const { data } = await this.http.patch<{ panel: SocialPanel }>(`/socials/bot/panels/${panelId}/state`, input);
    return data.panel;
  }

  async getActiveXAccounts() {
    const { data } = await this.http.get<{ accounts: XAccount[] }>("/x-monitor/bot/accounts");
    return data.accounts;
  }

  async syncXAccount(accountId: string) {
    const { data } = await this.http.post<XSyncResult>(`/x-monitor/bot/accounts/${accountId}/sync`, undefined, {
      timeout: 30_000
    });
    return data;
  }

  async recordXPostSent(accountId: string, input: {
    channelId: string;
    discordMessageId?: string | null;
    xPostCreatedAt?: string | null;
    xPostId: string;
    xPostUrl: string;
  }) {
    const { data } = await this.http.post(`/x-monitor/bot/accounts/${accountId}/sent`, input);
    return data;
  }

  async recordXDiscordFailure(accountId: string, message: string) {
    await this.http.post(`/x-monitor/bot/accounts/${accountId}/discord-error`, {
      message
    });
  }

  async getActiveFivemFacConfigs() {
    const { data } = await this.http.get<{ configs: FivemFacSettings[] }>("/fivem/bot/fac/configs");
    return data.configs;
  }

  async getFivemFacSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: FivemFacSettings }>(`/fivem/bot/fac/${guildId}`);
    return data.settings;
  }

  async updateFivemFacPanelState(input: { guildId: string; messageId?: string | null }) {
    const { data } = await this.http.post<{ settings: FivemFacSettings }>("/fivem/bot/fac/panel-state", input);
    return data.settings;
  }

  async createFivemFacAbsence(input: {
    guildId: string;
    userId: string;
    username?: string | null;
    reason: string;
    startDate: string;
    endDate: string;
    notes?: string | null;
  }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>("/fivem/bot/fac/absences", input);
    return data.absence;
  }

  async getFivemFacAbsence(absenceId: string) {
    const { data } = await this.http.get<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}`);
    return data.absence;
  }

  async getFivemFacUserAbsences(guildId: string, userId: string) {
    const { data } = await this.http.get<{ absences: FivemFacAbsence[] }>("/fivem/bot/fac/absences/user", {
      params: {
        guildId,
        userId
      }
    });
    return data.absences;
  }

  async getFivemFacDueAbsences(today?: string) {
    const { data } = await this.http.get<{ absences: FivemFacAbsence[] }>("/fivem/bot/fac/absences/due", {
      params: today ? { today } : undefined
    });
    return data.absences;
  }

  async updateFivemFacAbsenceChannel(absenceId: string, input: { privateChannelId?: string | null; requestMessageId?: string | null }) {
    const { data } = await this.http.patch<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/channel`, input);
    return data.absence;
  }

  async approveFivemFacAbsence(absenceId: string, input: { moderatorId: string; moderatorRoleIds: string[] }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/approve`, input);
    return data.absence;
  }

  async rejectFivemFacAbsence(absenceId: string, input: { moderatorId: string; moderatorRoleIds: string[]; reason: string }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/reject`, input);
    return data.absence;
  }

  async closeFivemFacAbsence(absenceId: string, input: { moderatorId: string; moderatorRoleIds: string[]; reason?: string | null; roleRemoved?: boolean }) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/close`, input);
    return data.absence;
  }

  async markFivemFacAbsenceStarted(absenceId: string, roleAdded = true) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/start`, {
      roleAdded
    });
    return data.absence;
  }

  async markFivemFacAbsenceFinished(absenceId: string, roleRemoved = true) {
    const { data } = await this.http.post<{ absence: FivemFacAbsence }>(`/fivem/bot/fac/absences/${absenceId}/finish`, {
      roleRemoved
    });
    return data.absence;
  }

  async getActiveMissionToolsConfigs() {
    const { data } = await this.http.get<{ configs: MissionToolsSettings[] }>("/mission-tools/bot/configs");
    return data.configs;
  }

  async getMissionToolsSettings(guildId: string) {
    const { data } = await this.http.get<{ settings: MissionToolsSettings }>(`/mission-tools/bot/${guildId}`);
    return data.settings;
  }

  async updateMissionToolsPanelState(input: { guildId: string; messageId?: string | null }) {
    const { data } = await this.http.post<{ settings: MissionToolsSettings }>("/mission-tools/bot/panel-state", input);
    return data.settings;
  }

  async getMissionToolsUser(guildId: string, userId: string) {
    const { data } = await this.http.get<{ user: MissionToolsUserPanel }>(
      `/mission-tools/bot/${guildId}/users/${userId}`
    );
    return data.user;
  }

  async updateMissionToolsUser(guildId: string, userId: string, input: MissionToolsUserPatch) {
    const { data } = await this.http.patch<{ user: MissionToolsUserPanel }>(
      `/mission-tools/bot/${guildId}/users/${userId}`,
      input
    );
    return data.user;
  }

  async saveMissionToolsToken(guildId: string, userId: string, token: string) {
    const { data } = await this.http.post<{
      tokenConfigured: boolean;
      tokenLast4: string | null;
      tokenStatus: MissionToolsTokenStatus;
      user: MissionToolsUserPanel;
    }>(
      `/mission-tools/bot/${guildId}/users/${userId}/token`,
      { token }
    );
    return data;
  }

  async deleteMissionToolsToken(guildId: string, userId: string) {
    const { data } = await this.http.delete<{ tokenConfigured: boolean }>(
      `/mission-tools/bot/${guildId}/users/${userId}/token`
    );
    return data;
  }

  async getMissionToolsToken(guildId: string, userId: string) {
    const { data } = await this.http.get<MissionToolsTokenResponse>(
      `/mission-tools/bot/${guildId}/users/${userId}/token`
    );
    return data;
  }

  async markMissionToolsTokenAuthFailure(guildId: string, userId: string, input: {
    reason?: string | null;
    source?: string | null;
    statusCode?: number | null;
  }) {
    const { data } = await this.http.post<{
      tokenStatus: MissionToolsTokenStatus;
      user: MissionToolsUserPanel;
    }>(
      `/mission-tools/bot/${guildId}/users/${userId}/token/auth-failure`,
      input
    );
    return data;
  }

  async recordEmojiCloneJob(input: {
    guildId: string;
    userId: string;
    sourceGuildId?: string | null;
    status: "pending" | "running" | "completed" | "cancelled";
    total: number;
    success: number;
    failed: number;
    prefix?: string | null;
    createdAt?: string | null;
    finishedAt?: string | null;
    items: Array<{
      originalEmojiId: string;
      originalName: string;
      originalUrl?: string | null;
      newEmojiId?: string | null;
      newName?: string | null;
      animated: boolean;
      status: "pending" | "success" | "failed";
      errorReason?: string | null;
    }>;
  }) {
    const { data } = await this.http.post("/emoji-cloner/bot/jobs", input, {
      timeout: 12_000
    });
    return data;
  }
}

const API_REQUEST_WINDOW_MS = 60_000;
const API_REQUEST_WARN_THRESHOLD = 40;
const apiRequestCounters = new Map<string, { count: number; resetAt: number; warnedAt: number }>();

function recordApiRequest(method = "GET", url = "") {
  const now = Date.now();
  const key = `${method.toUpperCase()} ${normalizeApiMetricUrl(url)}`;
  const current = apiRequestCounters.get(key);

  if (!current || current.resetAt <= now) {
    apiRequestCounters.set(key, {
      count: 1,
      resetAt: now + API_REQUEST_WINDOW_MS,
      warnedAt: 0
    });
    cleanupApiRequestCounters(now);
    return;
  }

  current.count += 1;

  if (current.count > API_REQUEST_WARN_THRESHOLD && now - current.warnedAt > API_REQUEST_WINDOW_MS) {
    current.warnedAt = now;
    console.warn(`[api-client] alto volume de requests: ${key} count=${current.count}/min`);
  }
}

function normalizeApiMetricUrl(url: string) {
  return url
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\b\d{15,22}\b/g, ":snowflake")
    .replace(/\/sent\/[^/?]+/g, "/sent/:id")
    .split("?")[0] || "/";
}

function cleanupApiRequestCounters(now: number) {
  if (apiRequestCounters.size < 500) {
    return;
  }

  for (const [key, value] of apiRequestCounters.entries()) {
    if (value.resetAt <= now) {
      apiRequestCounters.delete(key);
    }
  }
}

function readAuthorizationResponse(value: unknown): BotCommandAuthorization | null {
  if (!value || typeof value !== "object" || !("authorization" in value)) {
    return null;
  }

  const authorization = (value as { authorization?: unknown }).authorization;

  if (!authorization || typeof authorization !== "object" || !("allowed" in authorization)) {
    return null;
  }

  return authorization as BotCommandAuthorization;
}
