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
  accessLevel: "admin" | "viewer";
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
};

export type AccessValidationResult = {
  allowed: boolean;
  mode: "temporary" | "roles";
  temporaryAccess: boolean;
  accessLevel: "admin" | "viewer";
  authorizedUser: boolean;
  canManageDashboard: boolean;
  checks: GuildAccessCheck[];
};

export type AuthResponse = {
  user: AuthUser;
  guilds: DashboardGuild[];
  permissions: {
    canManageGuilds: boolean;
    canManageDashboard: boolean;
    canConfigureGuilds: boolean;
  };
  access: {
    authenticated: boolean;
    verified: boolean;
    level: "admin" | "viewer";
    verificationMode: "temporary" | "roles";
    tokenExpiresAt: string;
  };
  validation?: AccessValidationResult;
};

export type BotStatus = {
  botId?: string | null;
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
  welcomeMessage: string | null;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveDisplayChannelId: string | null;
  leaveImageUrl: string | null;
  leaveMessage: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  logChannelId: string | null;
  moderationEnabled: boolean;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
};

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

export type GuildRoleOption = {
  assignable: boolean;
  id: string;
  name: string;
  color: number;
  managed: boolean;
};

export type GuildLiveOptions = {
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
};

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

export type ClipMentionType = "none" | "everyone" | "role";

export type ClipsConfig = {
  id: string;
  guildId: string;
  botId: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  twitchDisplayName: string | null;
  twitchAvatar: string | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId: string | null;
  embedColor: string;
  customMessage: string | null;
  checkInterval: number;
  lastCheckAt: string | null;
  totalSent: number;
  createdAt: string;
  updatedAt: string;
};

export type ClipSent = {
  id: string;
  guildId: string;
  botId: string | null;
  twitchChannelName: string;
  twitchBroadcasterId: string;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  createdAtTwitch: string;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: string;
};

export type SaveClipsConfigPayload = {
  guildId: string;
  twitchChannelInput: string;
  discordChannelId: string | null;
  allowedRoleIds: string[];
  mentionType: ClipMentionType;
  mentionRoleId?: string | null;
  embedColor?: string | null;
  customMessage?: string | null;
  checkInterval?: number;
  enabled?: boolean;
};

export type TwitchClipChannelPreview = {
  twitchId: string;
  twitchUsername: string;
  twitchDisplayName: string;
  twitchAvatar: string | null;
  twitchUrl: string;
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

export type DashboardViewMode = "developer" | "user";

export type DevModuleDefinition = {
  id: string;
  label: string;
};

export type DevBotStatus = "online" | "offline" | "invalid_token" | "error";

export type DashboardBot = {
  id: string;
  name: string;
  clientId: string;
  avatarUrl: string | null;
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
};

export type DevBot = {
  id: string;
  name: string;
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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDevBotPayload = {
  name?: string | null;
  clientId: string;
  token: string;
  avatarUrl?: string | null;
  secret?: string | null;
  ownerName?: string;
  ownerId?: string;
  mainGuildId: string;
  enabledModules: string[];
};

export type RegisterPrimaryDevBotPayload = {
  name?: string | null;
  ownerName?: string;
  ownerId?: string;
  mainGuildId: string;
  enabledModules: string[];
};

export type BotConnectionTest = {
  status: DevBotStatus;
  message: string;
  avatarUrl: string | null;
  clientId: string | null;
  botId: string | null;
  username: string | null;
  createdAt: string | null;
};

export type DetectedDiscordGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
  onlineCount: number;
  channelCount: number;
  botId: string;
  botName: string;
  botAvatarUrl: string | null;
  botCreatedAt: string | null;
  hasAdministrator: boolean;
};
