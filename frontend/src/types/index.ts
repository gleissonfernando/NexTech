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
  tag: string;
  avatar: string | null;
  email: string | null;
  guilds: DashboardGuild[];
};

export type AuthResponse = {
  user: AuthUser;
  guilds: DashboardGuild[];
  permissions: {
    canManageGuilds: boolean;
  };
  access: {
    authenticated: boolean;
    verified: boolean;
    verificationMode: "temporary" | "roles";
    tokenExpiresAt: string;
  };
  validation?: {
    allowed: boolean;
    mode: "temporary" | "roles";
    temporaryAccess: boolean;
  };
};

export type BotStatus = {
  online: boolean;
  latency: number;
  guilds: number;
  users: number;
  updatedAt: string;
};

export type GuildSettings = {
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
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
  guildId: string;
  userId?: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: string;
};

export type LiveEvent = {
  id: string;
  guildId: string;
  type: "started" | "ended";
  streamer: string;
  title?: string;
  url?: string;
  createdAt: string;
};

export type Ticket = {
  id: string;
  guildId: string;
  channelId?: string | null;
  openerId: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: string;
  closedAt?: string | null;
};

export type SocialNotification = {
  id: string;
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
  enabled: boolean;
  isLive: boolean;
  lastStreamId?: string | null;
  lastMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTwitchNotificationPayload = {
  twitchChannelInput: string;
  discordChannelId: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  enabled: boolean;
};

export type UpdateTwitchNotificationPayload = {
  discordChannelId?: string;
  mentionRoleId?: string | null;
  customMessage?: string | null;
  enabled?: boolean;
};
