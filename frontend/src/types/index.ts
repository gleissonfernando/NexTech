export type DashboardGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  isAdmin: boolean;
  botEnabled: boolean;
  memberCount: number;
  channelCount: number;
};

export type DashboardAccessLevel = "admin" | "moderator" | "premium" | "basic";
export type SessionAccessLevel = DashboardAccessLevel | "viewer";

export type DashboardPermissionFlags = {
  canAccessDashboard: boolean;
  canConfigureGuilds: boolean;
  canManageAccess: boolean;
  canManageBots: boolean;
  canManageDashboard: boolean;
  canManageGlobalSettings: boolean;
  canManageGuilds: boolean;
  canManageModules: boolean;
  canManageOwnServices: boolean;
  canManageUsers: boolean;
  canUsePremium: boolean;
  canViewUsers: boolean;
};

export type AuthUser = {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  discriminator: string | null;
  tag: string;
  avatar: string | null;
  avatarUrl: string | null;
  email: string | null;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  accessLevel: SessionAccessLevel;
  authorized: boolean;
  lastLoginAt: string;
};

export type GuildAccessCheck = {
  guildId: string;
  guildName: string;
  administrator: boolean;
  owner: boolean;
  administratorRole: boolean;
  configuredPanelRole: boolean;
  accessLevel: DashboardAccessLevel | null;
  matchedRoleIds: string[];
  matchedUserIds: string[];
  requiredRoleIds: string[];
  requiredUserIds: string[];
};

export type AccessValidationResult = {
  allowed: boolean;
  mode: "temporary" | "roles";
  temporaryAccess: boolean;
  accessLevel: SessionAccessLevel;
  authorizedUser: boolean;
  canManageDashboard: boolean;
  checks: GuildAccessCheck[];
  rejectionReasons: string[];
};

export type AuthResponse = {
  user: AuthUser;
  guilds: DashboardGuild[];
  permissions: {
    canManageGuilds: boolean;
    canManageDashboard: boolean;
    canConfigureGuilds: boolean;
  } & DashboardPermissionFlags;
  access: {
    authenticated: boolean;
    verified: boolean;
    level: SessionAccessLevel;
    verificationMode: "temporary" | "roles";
    tokenExpiresAt: string;
  };
  validation?: AccessValidationResult;
};

export type BotStatus = {
  botId?: string | null;
  botProfile?: {
    avatarUrl: string | null;
    id: string;
    username: string;
  } | null;
  online: boolean;
  latency: number;
  guilds: number;
  users: number;
  botGuilds: Array<{
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount?: number;
    channelCount?: number;
  }>;
  updatedAt: string;
};

export type GuildSettings = {
  botId: string | null;
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
  welcomeTitle: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle: string | null;
  welcomeRules: string | null;
  welcomeChannelLabel: string | null;
  welcomeFooterText: string | null;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveDisplayChannelId: string | null;
  leaveImageUrl: string | null;
  leaveTitle: string | null;
  leaveMessage: string | null;
  leaveRulesTitle: string | null;
  leaveRules: string | null;
  leaveChannelLabel: string | null;
  leaveFooterText: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  logChannelId: string | null;
  moderationEnabled: boolean;
  accountAgeSecurityEnabled: boolean;
  accountAgeMinDays: number;
  accountAgeLogChannelId: string | null;
  accountAgeAllowedUserIds: string[];
  safeBotEnabled: boolean;
  safeBotChannelId: string | null;
  safeBotRoleId: string | null;
  safeBotLogChannelId: string | null;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds: string[];
  dashboardRolePermissions: Record<string, DashboardAccessLevel>;
  dashboardUserPermissions: Record<string, DashboardAccessLevel>;
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

export type ImageAntiSpamResponse = {
  settings: ImageAntiSpamSettings;
  users: ImageAntiSpamUser[];
  incidents: ImageAntiSpamIncident[];
};

export type SaveImageAntiSpamSettingsPayload = Partial<Pick<
  ImageAntiSpamSettings,
  | "enabled"
  | "logChannelId"
  | "immuneRoleIds"
  | "ignoredChannelIds"
  | "maxImages"
  | "windowSeconds"
  | "warningsEnabled"
  | "progressiveTimeoutEnabled"
  | "autoKickEnabled"
  | "maxWarnings"
  | "ignoreAdministrators"
  | "warningResetDays"
>>;

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
  logWebhookUrl: string | null;
  embedColor: string;
  punishmentSequence: SelfBotPunishmentAction[];
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

export type SelfBotProtectionStats = {
  blockedSpam: number;
  removedImages: number;
  blockedLinks: number;
  punishedUsers: number;
  infractionsToday: number;
  infractionsWeek: number;
  infractionsMonth: number;
  byModule: Array<{
    moduleId: SelfBotProtectionModuleId;
    total: number;
  }>;
  daily: Array<{
    label: string;
    value: number;
  }>;
};

export type SelfBotProtectionResponse = {
  incidents: SelfBotProtectionIncident[];
  settings: SelfBotProtectionSettings;
  stats: SelfBotProtectionStats;
};

export type SaveSelfBotProtectionSettingsPayload = Partial<Omit<
  SelfBotProtectionSettings,
  "id" | "botId" | "guildId" | "createdAt" | "updatedAt"
>>;

export type LogEntry = {
  id: string;
  botId: string | null;
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type LiveEvent = {
  id: string;
  botId: string | null;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
  createdAt: string;
};

export type Ticket = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId?: string | null;
  openerId: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: string;
  closedAt?: string | null;
};

export type GuildChannelOption = {
  id: string;
  name: string;
  parentId: string | null;
  type: "text" | "announcement";
};

export type GuildVoiceChannelOption = {
  id: string;
  name: string;
  parentId: string | null;
  type: "voice" | "stage";
};

export type GuildRoleOption = {
  assignable: boolean;
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildMemberOption = {
  avatarUrl: string | null;
  bot: boolean;
  displayName: string;
  globalName: string | null;
  id: string;
  tag: string;
  username: string;
};

export type GuildLiveOptions = {
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  voiceChannels?: GuildVoiceChannelOption[];
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

export type VoiceRecorderStats = {
  totalRecordings: number;
  totalDurationMs: number;
  totalStorageBytes: number;
  recordingsThisMonth: number;
  recordingsToday: number;
  activeRecording: boolean;
};

export type VoiceRecorderResponse = {
  activeRecording: VoiceRecording | null;
  recordings: VoiceRecording[];
  settings: VoiceRecorderSettings;
  stats: VoiceRecorderStats;
};

export type SaveVoiceRecorderSettingsPayload = Partial<Pick<
  VoiceRecorderSettings,
  "enabled" | "logChannelId" | "allowedRoleIds" | "maxDurationMinutes" | "retentionDays"
>>;

export type SocialNotification = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  createdBy: string;
  updatedBy: string | null;
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
  createdBy: string;
  updatedBy: string | null;
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

export type SocialNotificationsPage = {
  notifications: SocialNotification[];
  page: number;
  pageSize: number;
  total: number;
  filteredTotal: number;
  totalPages: number;
  limit: number;
};

export type KickNotificationsPage = {
  notifications: KickNotification[];
  page: number;
  pageSize: number;
  total: number;
  filteredTotal: number;
  totalPages: number;
  limit: number;
};

export type LivePanelPreview = {
  platform: "twitch" | "kick";
  dataSource: "live" | "simulated";
  mention: string | null;
  color: string;
  authorName: string;
  authorIconUrl: string | null;
  title: string;
  url: string;
  description: string;
  fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }>;
  imageUrl: string | null;
  footer: string;
  buttonLabel: string;
};

export type KickIntegrationStatus = {
  apiConfigured: boolean;
  apiStatus: "not_configured" | "ok" | "error";
  apiMessage: string;
  apiConfig: KickApiConfig | null;
  connectedAccount: KickNotification | null;
  totalChannels: number;
  activeChannels: number;
  totalLivesMonitored: number;
  lastLiveAt: string | null;
  webhook: {
    activeGiveaways: number;
    kickFollowers: number;
    kickParticipants: number;
    kickSubscribers: number;
    lastEventAt: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    recordedEvents: number;
    status: "active" | "inactive";
    totalParticipants: number;
    url: string | null;
  };
};

export type KickApiConfig = {
  id: string;
  botId: string | null;
  guildId: string;
  clientId: string;
  redirectUri: string | null;
  secretConfigured: boolean;
  createdAt: string;
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

export type SocialLinks = Record<SocialPlatform, string>;

export type SocialMember = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string | null;
  discordId: string | null;
  name: string;
  avatar: string | null;
  role: string | null;
  links: SocialLinks;
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

export type SocialNetworkResponse = {
  members: SocialMember[];
  panel: SocialPanel | null;
};

export type SocialMemberPayload = {
  avatar?: string | null;
  discordId?: string | null;
  links: Partial<Record<SocialPlatform, string | null>>;
  name: string;
  role?: string | null;
};

export type UpdateSocialMemberPayload = Partial<SocialMemberPayload>;

export type SaveSocialPanelPayload = {
  channelId: string;
  embedColor?: string | null;
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

export type XAccountPreview = {
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  mostRecentPostId: string | null;
};

export type XMonitorResponse = {
  accounts: XAccount[];
  logs: LogEntry[];
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

export type FivemFacResponse = {
  absences: FivemFacAbsence[];
  settings: FivemFacSettings;
};

export type SaveFivemFacSettingsPayload = Partial<Omit<FivemFacSettings, "id" | "botId" | "guildId" | "panelMessageId" | "lastPanelRequestedAt" | "createdAt" | "updatedAt">>;

export type MissionToolStatus = "open" | "running" | "completed" | "cancelled";

export type MissionToolsMessages = {
  panelTitle: string;
  panelDescription: string;
  joinSuccess: string;
  leaveSuccess: string;
  missionStarted: string;
  missionCompleted: string;
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
  participantRoleIds: string[];
  completionRoleId: string | null;
  messages: MissionToolsMessages;
  lastPanelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionToolParticipant = {
  userId: string;
  username: string | null;
  joinedAt: string;
  leftAt: string | null;
};

export type MissionToolMission = {
  id: string;
  botId: string;
  guildId: string;
  title: string;
  description: string | null;
  status: MissionToolStatus;
  participantLimit: number;
  participants: MissionToolParticipant[];
  activeParticipantCount: number;
  createdBy: string | null;
  startedBy: string | null;
  completedBy: string | null;
  cancelledBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
};

export type MissionToolsStats = {
  activeParticipants: number;
  completedMissions: number;
  openMissions: number;
  totalMissions: number;
};

export type MissionToolsResponse = {
  activeMission: MissionToolMission | null;
  missions: MissionToolMission[];
  settings: MissionToolsSettings;
  stats: MissionToolsStats;
};

export type SaveMissionToolsSettingsPayload = Partial<Omit<
  MissionToolsSettings,
  "id" | "botId" | "guildId" | "panelMessageId" | "lastPanelRequestedAt" | "createdAt" | "updatedAt"
>>;

export type CreateMissionToolMissionPayload = {
  description?: string | null;
  participantLimit?: number | null;
  title: string;
};

export type SaveXAccountPayload = {
  active: boolean;
  channelId: string;
  username: string;
};

export type UpdateXAccountPayload = Partial<SaveXAccountPayload>;

export type ClipMentionType = "none" | "everyone" | "role";
export type ClipPlatform = "twitch" | "kick";

export type ClipRewardRole = {
  clipCount: number;
  label: string;
  roleId: string;
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
  followers: number | null;
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
  kickApiTokenConfigured: boolean;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  clipRewards: ClipRewardRole[];
  checkInterval: number;
  lastCheckAt: string | null;
  activeLiveSessionId: string | null;
  activeLiveStartedAt: string | null;
  activeLiveTitle: string | null;
  activeLiveThumbnail: string | null;
  totalSent: number;
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClipSent = {
  id: string;
  guildId: string;
  botId: string | null;
  configId: string | null;
  platform: ClipPlatform;
  channelName: string;
  broadcasterId: string;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  kickChannelName: string | null;
  kickUserId: string | null;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  clipDuration: number | null;
  createdAtTwitch: string;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: string;
};

export type ClipRankingEntry = {
  username: string;
  count: number;
};

export type ClipStats = {
  total: number;
  today: number;
  week: number;
  month: number;
  topCreator: ClipRankingEntry | null;
  dailyAverage: number;
  clipsByDay: Array<{ label: string; value: number }>;
  clipsByWeek: Array<{ label: string; value: number }>;
  clipsByMonth: Array<{ label: string; value: number }>;
};

export type PublicKickClips = {
  channel: ClipsConfig;
  clips: ClipSent[];
  ranking: ClipRankingEntry[];
  stats: ClipStats;
};

export type GiveawayStatus = "waiting" | "running" | "ended";
export type GiveawayParticipantMode =
  | "twitch_subs"
  | "twitch_followers"
  | "twitch_subs_followers"
  | "kick_subs"
  | "kick_followers"
  | "twitch_kick"
  | "all";

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
  participantMode: GiveawayParticipantMode;
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

export type GiveawayLivePreview = {
  avatar: string | null;
  category: string | null;
  channelId: string | null;
  channelName: string;
  displayName: string;
  followers: number | null;
  isLive: boolean;
  platform: "twitch" | "kick";
  platformUserId: string;
  startedAt: string | null;
  status: "online" | "offline";
  thumbnailUrl: string | null;
  title: string | null;
  url: string;
  verified: boolean | null;
  viewerCount: number | null;
  warning: string | null;
};

export type SaveGiveawayPayload = {
  allowRepeatWinners: boolean;
  customMessage?: string | null;
  discordChannelId: string | null;
  endDelayMinutes: number;
  kickChannelInput?: string | null;
  liveUrl: string;
  participantMode: GiveawayParticipantMode;
  prizeName: string;
  startDelayMinutes: number;
  title: string;
  winnerCount: number;
};

export type GiveawaySpinResult = {
  giveaway: Giveaway;
  winner: GiveawayWinner;
};

export type GiveawayConnectedAccount = {
  id: string;
  platform: "twitch" | "kick";
  platformUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  scopes: string[];
  lastVerifiedAt: string | null;
};

export type GiveawayIdentity = {
  accounts: GiveawayConnectedAccount[];
  entries: GiveawayParticipant[];
};

export type GiveawayEntryResult = {
  giveaway: Giveaway;
  identity: GiveawayIdentity;
  verifications: Array<{
    account: GiveawayConnectedAccount;
    eligible: boolean;
    participant: GiveawayParticipant;
    reason: string | null;
  }>;
};

export type SaveClipsConfigPayload = {
  guildId: string;
  platform?: ClipPlatform;
  twitchChannelInput?: string | null;
  kickChannelInput?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickApiToken?: string | null;
  discordChannelId: string | null;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId?: string | null;
  embedColor?: string | null;
  customMessage?: string | null;
  clipRewards?: ClipRewardRole[];
  enabled?: boolean;
};

export type TwitchClipChannelPreview = {
  twitchId: string;
  twitchUsername: string;
  twitchDisplayName: string;
  twitchAvatar: string | null;
  twitchUrl: string;
};

export type KickClipChannelPreview = {
  kickChannelId: string | null;
  kickUserId: string;
  kickUsername: string;
  kickDisplayName: string;
  kickAvatar: string | null;
  kickBanner: string | null;
  kickFollowers: number;
  kickVerified: boolean;
  kickUrl: string;
  isLive: boolean;
  streamTitle: string | null;
  thumbnailUrl: string | null;
};

export type CreateTwitchNotificationPayload = {
  twitchChannelInput: string;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
};

export type UpdateTwitchNotificationPayload = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled?: boolean;
};

export type TwitchChannelPreview = {
  twitchId: string;
  twitchUsername: string;
  twitchDisplayName: string;
  twitchAvatar: string | null;
  twitchUrl: string;
};

export type CreateKickNotificationPayload = {
  kickChannelInput: string;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled: boolean;
};

export type UpdateKickNotificationPayload = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  embedColor?: string | null;
  enabled?: boolean;
};

export type KickChannelPreview = {
  kickChannelId: string | null;
  kickUserId: string;
  kickUsername: string;
  kickDisplayName: string;
  kickAvatar: string | null;
  kickBanner: string | null;
  kickFollowers: number;
  kickVerified: boolean;
  kickUrl: string;
};

export type DashboardMeUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
};

export type DashboardMeBot = {
  id: string | null;
  username: string;
  avatarUrl: string | null;
  connected: boolean;
};

export type DashboardMeGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
  botInGuild: boolean;
};

export type DashboardMeResponse = {
  user: DashboardMeUser;
  bot: DashboardMeBot;
  bots: DashboardBot[];
  canViewDev: boolean;
  selectedGuildId: string | null;
  guilds: DashboardMeGuild[];
};

export type DevModuleDefinition = {
  id: string;
  label: string;
};

export type DevBotStatus = "online" | "offline" | "invalid_token" | "error";

export type DashboardBot = {
  id: string;
  name: string;
  slug: string;
  dashboardUrl: string;
  clientId: string;
  avatarUrl: string | null;
  ownerId: string;
  mainGuildId: string;
  mainGuildName: string;
  mainGuildIconUrl: string | null;
  mainGuildMemberCount: number;
  mainGuildChannelCount: number;
  botCreatedAt: string | null;
  guildIds: string[];
  status: DevBotStatus;
  statusMessage: string | null;
  enabledModules: string[];
  accessLevel: DashboardAccessLevel;
  permissions: DashboardPermissionFlags;
  createdBy: string;
};

export type DevBot = {
  id: string;
  name: string;
  slug: string;
  dashboardUrl: string;
  clientId: string;
  tokenMasked: string;
  secretConfigured: boolean;
  avatarUrl: string | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  mainGuildName: string;
  mainGuildIconUrl: string | null;
  mainGuildMemberCount: number;
  mainGuildChannelCount: number;
  botCreatedAt: string | null;
  guildIds: string[];
  status: DevBotStatus;
  statusMessage: string | null;
  enabledModules: string[];
  accessLevel: DashboardAccessLevel;
  permissions: DashboardPermissionFlags;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDevBotPayload = {
  token: string;
  mainGuildId: string;
};
