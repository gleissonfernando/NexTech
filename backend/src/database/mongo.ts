import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "../config/env";

export type MongoUser = {
  _id: string;
  discordId: string;
  username: string;
  globalName?: string | null;
  discriminator?: string | null;
  avatar: string | null;
  avatarUrl?: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  discordRoleIdsByGuild?: Record<string, string[]>;
  accessStatus?: "allowed" | "denied" | "pending";
  permissionLevel?: "admin" | "moderator" | "premium" | "basic" | "viewer";
  lastAccessSyncAt?: Date | null;
  selectedGuildId?: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGuild = {
  _id: string;
  name: string;
  icon: string | null;
  ownerId: string | null;
  botEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGuildSettings = {
  _id: string;
  botId?: string | null;
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId?: string | null;
  welcomeImageUrl?: string | null;
  welcomeTitle?: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle?: string | null;
  welcomeRules?: string | null;
  welcomeChannelLabel?: string | null;
  welcomeFooterText?: string | null;
  welcomeColor?: string | null;
  leaveEnabled?: boolean;
  leaveChannelId?: string | null;
  leaveDisplayChannelId?: string | null;
  leaveImageUrl?: string | null;
  leaveTitle?: string | null;
  leaveMessage?: string | null;
  leaveRulesTitle?: string | null;
  leaveRules?: string | null;
  leaveChannelLabel?: string | null;
  leaveFooterText?: string | null;
  leaveColor?: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  logChannelId: string | null;
  discordLogsEnabled?: boolean;
  siteLogsEnabled?: boolean;
  discordLogCategories?: Array<"members" | "messages" | "roles" | "moderation" | "dashboard" | "automation">;
  siteLogCategories?: Array<"members" | "messages" | "roles" | "moderation" | "dashboard" | "automation">;
  moderationEnabled: boolean;
  accountAgeSecurityEnabled?: boolean;
  accountAgeMinDays?: number;
  accountAgeLogChannelId?: string | null;
  accountAgeAllowedUserIds?: string[];
  safeBotEnabled?: boolean;
  safeBotChannelId?: string | null;
  safeBotRoleId?: string | null;
  safeBotLogChannelId?: string | null;
  emojiCloneEnabled?: boolean;
  emojiCloneAllowedRoleIds?: string[];
  emojiCloneLogChannelId?: string | null;
  emojiCloneDefaultPrefix?: string | null;
  emojiCloneAllowAnimated?: boolean;
  emojiCloneMaxPerRun?: number;
  emojiCloneAllowedBotIds?: string[];
  rulesEnabled?: boolean;
  rulesChannelId?: string | null;
  rulesRoleId?: string | null;
  rulesTitle?: string | null;
  rulesMessage?: string | null;
  rulesButtonLabel?: string | null;
  rulesColor?: string | null;
  rulesPanelMessageId?: string | null;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds?: string[];
  dashboardRolePermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  dashboardUserPermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  updatedAt: Date;
};

export type MongoSafeBotMessageState = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  messageId: string;
  updatedAt: Date;
};

export type MongoTicket = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string | null;
  openerId: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: Date;
  closedAt: Date | null;
};

export type MongoLogEntry = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId: string | null;
  type: string;
  message: string;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoSocialNotification = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId: string;
  createdBy?: string;
  updatedBy?: string | null;
  platform: "twitch" | "kick";
  twitchChannelName?: string | null;
  twitchChannelUrl?: string | null;
  twitchUserId?: string | null;
  twitchAvatar?: string | null;
  kickChannelName?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickBanner?: string | null;
  kickFollowers?: number | null;
  kickVerified?: boolean | null;
  kickCategory?: string | null;
  discordChannelId: string;
  mentionRoleId: string | null;
  customMessage: string | null;
  embedColor?: string | null;
  enabled: boolean;
  isLive: boolean;
  lastLiveAt?: Date | null;
  lastEndedAt?: Date | null;
  lastStreamId: string | null;
  lastMessageId: string | null;
  peakViewers?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoKickApiConfig = {
  _id: string;
  botId?: string | null;
  guildId: string;
  clientId: string;
  clientSecretEncrypted: string;
  redirectUri: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSocialMember = {
  _id: string;
  botId?: string | null;
  guildId: string;
  userId?: string | null;
  discordId?: string | null;
  name: string;
  avatar: string | null;
  role?: string | null;
  twitter: string | null;
  instagram: string | null;
  twitch: string | null;
  youtube: string | null;
  tiktok: string | null;
  kick: string | null;
  facebook: string | null;
  website: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSocialPanel = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string | null;
  messageId: string | null;
  embedColor: string | null;
  published: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastPublishedAt?: Date | null;
};

export type MongoXAccount = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  xUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  lastPostId: string | null;
  lastPostAt: Date | null;
  lastApiStatus: "idle" | "ok" | "error";
  lastApiError: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoXPostSent = {
  _id: string;
  botId?: string | null;
  guildId: string;
  channelId: string;
  accountId: string;
  xPostId: string;
  xPostUrl: string;
  discordMessageId: string | null;
  sentAt: Date;
};

export type MongoClipMentionType = "none" | "everyone" | "role";
export type MongoClipPlatform = "twitch" | "kick";

export type MongoClipRewardRole = {
  clipCount: number;
  label: string;
  roleId: string;
};

export type MongoClipsConfig = {
  _id: string;
  guildId: string;
  botId?: string | null;
  platform?: MongoClipPlatform;
  twitchChannelName?: string | null;
  twitchBroadcasterId?: string | null;
  twitchDisplayName?: string | null;
  twitchAvatar?: string | null;
  kickChannelName?: string | null;
  kickChannelUrl?: string | null;
  kickChannelId?: string | null;
  kickUserId?: string | null;
  kickDisplayName?: string | null;
  kickAvatar?: string | null;
  kickFollowers?: number | null;
  kickApiTokenEncrypted?: string | null;
  discordChannelId: string | null;
  enabled: boolean;
  allowedRoleIds: string[];
  mentionType: MongoClipMentionType;
  mentionRoleId: string | null;
  embedColor: string | null;
  customMessage: string | null;
  clipRewards?: MongoClipRewardRole[];
  checkInterval: number;
  lastCheckAt: Date | null;
  activeLiveSessionId?: string | null;
  activeLiveStartedAt?: Date | null;
  activeLiveTitle?: string | null;
  activeLiveThumbnail?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoClipSent = {
  _id: string;
  guildId: string;
  botId?: string | null;
  configId?: string | null;
  platform?: MongoClipPlatform;
  twitchChannelName?: string | null;
  twitchBroadcasterId?: string | null;
  kickChannelName?: string | null;
  kickUserId?: string | null;
  clipId: string;
  clipTitle: string;
  clipUrl: string;
  clipThumbnail: string | null;
  clipCreatorName: string | null;
  clipDuration?: number | null;
  createdAtTwitch: Date;
  discordChannelId: string | null;
  discordMessageId: string | null;
  sentAt: Date;
};

export type MongoClipLog = {
  _id: string;
  guildId: string;
  botId?: string | null;
  platform?: MongoClipPlatform;
  action: string;
  userId: string | null;
  message: string;
  createdAt: Date;
};

export type MongoClipLiveSession = {
  _id: string;
  guildId: string;
  botId?: string | null;
  configId: string;
  platform: MongoClipPlatform;
  streamId: string;
  channelName: string;
  title: string | null;
  thumbnailUrl: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: "active" | "ended";
  createdAt: Date;
  updatedAt: Date;
};

export type MongoGiveawayStatus = "waiting" | "running" | "ended";
export type MongoGiveawayParticipantSource = "twitch" | "kick";
export type MongoGiveawayParticipantMode =
  | "twitch_subs"
  | "twitch_followers"
  | "twitch_subs_followers"
  | "kick_subs"
  | "kick_followers"
  | "twitch_kick"
  | "all";

export type MongoGiveawayParticipant = {
  id: string;
  accountId?: string | null;
  platform?: MongoGiveawayParticipantSource;
  platformUserId?: string;
  username: string;
  displayName: string;
  subscriber?: boolean;
  follower?: boolean;
  source: MongoGiveawayParticipantSource;
  subTier?: "prime" | "1000" | "2000" | "3000" | string | null;
  subTierLabel?: string | null;
  subMonths?: number | null;
  isPrime?: boolean;
  isVip?: boolean;
  isModerator?: boolean;
  isEditor?: boolean;
  tickets?: number;
  eligible?: boolean;
  invalidReason?: string | null;
  validatedAt: Date;
};

export type MongoGiveawayWinner = {
  participantId: string;
  username: string;
  displayName: string;
  wonAt: Date;
};

export type MongoGiveaway = {
  _id: string;
  botId?: string | null;
  guildId: string;
  ownerId: string;
  discordChannelId: string | null;
  title: string;
  liveName: string;
  liveUrl: string;
  livePlatform: "twitch" | "kick" | "multi";
  twitchBroadcasterId: string;
  twitchChannelName?: string | null;
  kickChannelName?: string | null;
  kickUserId?: string | null;
  kickChannelId?: string | null;
  participantMode?: MongoGiveawayParticipantMode;
  lastSyncedAt?: Date | null;
  lastSyncError?: string | null;
  prizeName: string;
  participants: MongoGiveawayParticipant[];
  winners: MongoGiveawayWinner[];
  status: MongoGiveawayStatus;
  rouletteToken: string;
  rouletteUrl: string;
  panelMessageId: string | null;
  winnerCount: number;
  allowRepeatWinners: boolean;
  startDelayMinutes: number;
  endDelayMinutes: number;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  customMessage: string | null;
  schedulerError?: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
};

export type MongoGiveawayPlatformAccount = {
  _id: string;
  platform: MongoGiveawayParticipantSource;
  platformUserId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastVerifiedAt: Date | null;
};

export type MongoGiveawayKickEvent = {
  _id: string;
  broadcasterUserId: string | null;
  channelSlug: string | null;
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isFollower: boolean;
  isSubscriber: boolean;
  lastChatAt: Date | null;
  lastFollowedAt: Date | null;
  lastSubscribedAt: Date | null;
  subExpiresAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

export type MongoFivemFacMessages = {
  panelTitle: string;
  panelDescription: string;
  requestCreated: string;
  approved: string;
  rejected: string;
  started: string;
  finished: string;
};

export type MongoPanelImagePosition = "right_small" | "top" | "bottom" | "none";
export type MongoPanelButtonsPosition = "inside_panel" | "outside_panel" | "below" | "rows" | "none";
export type MongoPanelButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";
export type MongoPanelButtonAction = "request_absence" | "my_absences" | "url";

export type MongoPanelButtonConfig = {
  id: string;
  label: string;
  emoji: string | null;
  style: MongoPanelButtonStyle;
  type: "action" | "url";
  action: MongoPanelButtonAction;
  url: string | null;
  order: number;
  enabled: boolean;
};

export type MongoPanelVisualConfig = {
  panelColor: string;
  imageUrl: string | null;
  imagePosition: MongoPanelImagePosition;
  buttonsPosition: MongoPanelButtonsPosition;
  buttons: MongoPanelButtonConfig[];
  componentsOrder: Array<"image" | "text" | "buttons">;
  enabledSections: {
    image: boolean;
    buttons: boolean;
    description: boolean;
  };
};

export type MongoFivemFacSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  absenceRoleId: string | null;
  viewerRoleIds: string[];
  approverRoleIds: string[];
  memberRoleIds?: string[];
  logChannelId: string | null;
  messages: MongoFivemFacMessages;
  panelVisual?: MongoPanelVisualConfig | null;
  lastPanelRequestedAt?: Date | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFivemFacAbsenceStatus = "pending" | "approved" | "active" | "rejected" | "finished" | "closed";

export type MongoFivemFacAuditEntry = {
  action: string;
  actorId: string | null;
  reason: string | null;
  status: MongoFivemFacAbsenceStatus;
  createdAt: Date;
};

export type MongoFivemFacAbsence = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  reason: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  photoUrl?: string | null;
  status: MongoFivemFacAbsenceStatus;
  privateChannelId: string | null;
  requestMessageId: string | null;
  moderatorId: string | null;
  rejectionReason: string | null;
  roleAddedAt: Date | null;
  roleRemovedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  closedAt: Date | null;
  audit: MongoFivemFacAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
};

export type MongoFivemModule = {
  _id: string;
  title: string;
  description: string;
  permissions: string;
  builtIn: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoImageAntiSpamSettings = {
  _id: string;
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
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoImageAntiSpamUser = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  warningCount: number;
  totalImagesRemoved: number;
  lastInfractionAt: Date | null;
  lastPunishment: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoImageAntiSpamIncident = {
  _id: string;
  botId: string;
  guildId: string;
  incidentKey: string;
  userId: string;
  username: string | null;
  channelId: string;
  channelIds?: string[];
  mediaTypes?: string[];
  messageIds?: string[];
  removedImages: number;
  removedMessages?: number;
  warningCount: number;
  timeoutMs: number;
  action: "none" | "warning" | "timeout" | "kick";
  actionSucceeded: boolean | null;
  actionError: string | null;
  reason: string;
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
};

export type MongoVoiceRecorderStatus = "starting" | "recording" | "processing" | "completed" | "failed" | "deleted";

export type MongoVoiceRecorderSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  allowedRoleIds: string[];
  maxDurationMinutes: number;
  retentionDays: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoVoiceRecordingParticipant = {
  userId: string;
  username: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  speakingMs: number;
};

export type MongoVoiceRecordingEvent = {
  type: string;
  userId: string | null;
  username: string | null;
  message: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
};

export type MongoVoiceRecording = {
  _id: string;
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
  participants: MongoVoiceRecordingParticipant[];
  events: MongoVoiceRecordingEvent[];
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number;
  filePath: string | null;
  fileName: string | null;
  fileSize: number;
  mimeType: string | null;
  accessToken: string | null;
  status: MongoVoiceRecorderStatus;
  error: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoEmojiCloneJob = {
  _id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  sourceGuildId: string | null;
  status: "pending" | "running" | "completed" | "cancelled";
  total: number;
  success: number;
  failed: number;
  prefix: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export type MongoEmojiCloneItem = {
  _id: string;
  jobId: string;
  originalEmojiId: string;
  originalName: string;
  newEmojiId: string | null;
  newName: string | null;
  animated: boolean;
  status: "pending" | "success" | "failed";
  errorReason: string | null;
};

export type MongoEmojiLibraryItem = {
  _id: string;
  animated: boolean;
  botId: string;
  category?: string | null;
  destinationGuildId: string;
  importedAt: Date;
  lastUpdatedAt: Date;
  localFilePath?: string | null;
  name: string;
  originalEmojiId: string;
  sourceGuildId: string | null;
  targetEmojiId: string | null;
  targetEmojiName: string | null;
  url: string;
  userId: string;
};

export type MongoMediaLibraryItem = {
  _id: string;
  botId: string;
  guildId: string;
  type: "emoji" | "sound";
  name: string;
  originalName: string;
  fileUrl: string;
  localPath: string;
  discordEmojiId: string | null;
  animated: boolean | null;
  category: string | null;
  format: string;
  mimeType: string;
  size: number;
  source: "clone" | "zip_import" | "manual_upload";
  status: "active" | "error" | "deleted";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMediaImportJob = {
  _id: string;
  botId: string;
  guildId: string;
  uploadedBy: string;
  zipFileName: string;
  tempDirectory: string;
  status: "pending" | "extracting" | "waiting_confirmation" | "importing" | "completed" | "failed" | "cancelled";
  duplicateMode: "ignore" | "rename" | "replace";
  totalFiles: number;
  totalEmojis: number;
  totalSounds: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  logs: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type MongoMediaImportJobItem = {
  _id: string;
  jobId: string;
  type: "emoji" | "sound";
  name: string;
  originalName: string;
  filePath: string;
  format: string;
  mimeType: string;
  size: number;
  animated: boolean | null;
  status: "pending" | "success" | "error" | "duplicate" | "ignored";
  errorMessage: string | null;
  discordEmojiId: string | null;
};

export type MongoMediaSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  allowAuthorizedUsers: boolean;
  devOnly: boolean;
  duplicateMode: "ignore" | "rename" | "replace";
  soundsLocalOnly: boolean;
  maxZipSizeMb: number;
  maxFilesPerZip: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type MongoApplicationEmojiItem = {
  _id: string;
  animated: boolean;
  applicationEmojiId: string;
  applicationId: string;
  applicationName: string;
  botId: string;
  hash: string | null;
  originalEmojiId: string;
  originalName: string;
  size: number;
  sourceGuildId: string | null;
  syncedAt: Date;
  updatedAt: Date;
  url: string;
  userId: string | null;
};

export type MongoApplicationEmojiJob = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  status: "running" | "completed" | "failed";
  total: number;
  sent: number;
  skipped: number;
  updated: number;
  removed: number;
  failed: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type MongoApplicationEmojiSettings = {
  _id: string;
  autoSync: boolean;
  botId: string;
  guildId: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoOrvitechSalesPaymentProvider = {
  id: string;
  enabled: boolean;
  label: string;
  provider: "manual" | "pix" | "mercadopago" | "stripe" | "paypal" | "custom";
  publicKey: string | null;
  secretEncrypted: string | null;
  webhookUrl: string | null;
  instructions: string | null;
  updatedAt: Date;
};

export type MongoOrvitechSalesSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  ownerUserId: string;
  publicUrl: string;
  currency: "BRL" | "USD" | "EUR";
  saleChannelId: string | null;
  logChannelId: string | null;
  supportRoleIds: string[];
  customerRoleId: string | null;
  panelTitle: string;
  panelDescription: string;
  panelColor: string;
  panelImageUrl: string | null;
  thumbnailUrl: string | null;
  termsUrl: string | null;
  paymentProviders: MongoOrvitechSalesPaymentProvider[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoOrvitechSalesPlan = {
  _id: string;
  botId: string;
  guildId: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationDays: number | null;
  enabled: boolean;
  moduleIds: string[];
  imageUrl: string | null;
  checkoutMessage: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoOrvitechSaleStatus = "pending" | "paid" | "cancelled" | "refunded";

export type MongoOrvitechSale = {
  _id: string;
  botId: string;
  guildId: string;
  planId: string | null;
  planName: string;
  buyerId: string;
  buyerName: string | null;
  amountCents: number;
  currency: "BRL" | "USD" | "EUR";
  paymentProviderId: string | null;
  paymentProviderLabel: string | null;
  externalReference: string | null;
  status: MongoOrvitechSaleStatus;
  notes: string | null;
  paidAt: Date | null;
  expiresAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMissionToolsFeatureId =
  | "mission"
  | "clear"
  | "voice"
  | "rich-presence"
  | "username-checker";

export type MongoMissionToolsStatus =
  | "active"
  | "inactive"
  | "deactivated"
  | "waiting"
  | "running"
  | "completed"
  | "error";

export type MongoMissionToolsVoiceStatus =
  | "connected"
  | "disconnected"
  | "reconnecting";

export type MongoMissionToolsClearMode = "bulk" | "userDm";

export type MongoMissionToolsRichPresenceStatus = "active" | "inactive";

export type MongoMissionToolsRichPresenceActivityType = 0 | 1 | 2 | 3 | 5;
export type MongoMissionToolsTokenStatus = "connected" | "invalid" | "expired" | "disconnected" | "fake";

export type MongoMissionToolsRichPresenceConfig = {
  applicationId?: string;
  activityType?: MongoMissionToolsRichPresenceActivityType;
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

export type MongoMissionToolsUsernameCheckerStats = {
  hits: number;
  taken: number;
  errors: number;
  activeProxies: number;
  deadProxies: number;
  bannedProxies: number;
  workersRunning: number;
};

export type MongoMissionToolsUsernameCheckerOptions = {
  usernameLength?: number;
  concurrency?: number;
  requestDelay?: number;
};

export type MongoMissionToolsSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  panelChannelId: string | null;
  panelMessageId: string | null;
  logChannelId: string | null;
  managerRoleIds: string[];
  allowedRoleIds: string[];
  enabledFeatures: MongoMissionToolsFeatureId[];
  lastPanelRequestedAt?: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMissionToolsUserPanel = {
  _id: string;
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
  clearStatus: MongoMissionToolsStatus;
  clearMode: MongoMissionToolsClearMode;
  clearTargetUserId: string | null;
  missionStatus: MongoMissionToolsStatus;
  voiceStatus: MongoMissionToolsVoiceStatus;
  richPresenceStatus: MongoMissionToolsRichPresenceStatus;
  usernameCheckerStatus: MongoMissionToolsStatus;
  currentMission: string | null;
  missionDetail: string | null;
  voiceGuildId: string | null;
  voiceGuildName: string | null;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  voiceConnectedAt: string | null;
  richPresenceConfig: MongoMissionToolsRichPresenceConfig;
  richPresenceUpdatedAt: string | null;
  usernameCheckerOptions: MongoMissionToolsUsernameCheckerOptions;
  usernameCheckerStats: MongoMissionToolsUsernameCheckerStats;
  usernameCheckerLastEvent: string | null;
  usernameCheckerUpdatedAt: string | null;
  completedCount: number;
  totalMissions: number;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoMissionToolsToken = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  tokenEncrypted: string;
  tokenHash?: string | null;
  tokenLast4: string | null;
  tokenStatus?: MongoMissionToolsTokenStatus;
  tokenUserId?: string | null;
  tokenUsername?: string | null;
  invalidReason?: string | null;
  lastValidatedAt?: Date | null;
  lastAuthFailureAt?: Date | null;
  authFailureCount?: number;
  statusUpdatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSelfBotProtectionModuleId =
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

export type MongoSelfBotPunishmentAction =
  | "delete_message"
  | "warn"
  | "log"
  | "timeout"
  | "remove_role"
  | "add_role"
  | "kick"
  | "ban";

export type MongoPunishmentDuration = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export type MongoSelfBotPunishmentStep = {
  id: string;
  action: MongoSelfBotPunishmentAction;
  enabled: boolean;
  limit: number;
  nextAction: MongoSelfBotPunishmentAction | null;
  deleteMessage?: boolean;
  sendWarning?: boolean;
  registerLog?: boolean;
  timeoutDuration?: MongoPunishmentDuration;
  addRoleId?: string | null;
  removeRoleId?: string | null;
  banDeleteMessageSeconds?: number;
};

export type MongoSelfBotProtectionSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  moduleToggles: Partial<Record<MongoSelfBotProtectionModuleId, boolean>>;
  ignoredChannelIds: string[];
  protectedChannelIds: string[];
  mediaChannelIds: string[];
  linkChannelIds: string[];
  logChannelId: string | null;
  punishmentLogChannelId?: string | null;
  logWebhookUrl: string | null;
  embedColor: string;
  punishmentSequence: MongoSelfBotPunishmentAction[];
  punishmentSteps?: MongoSelfBotPunishmentStep[];
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
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSelfBotPunishmentState = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  moduleId: MongoSelfBotProtectionModuleId;
  currentAction: MongoSelfBotPunishmentAction;
  actionCount: number;
  totalOccurrences: number;
  lastPunishmentActions: MongoSelfBotPunishmentAction[];
  lastInfractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSelfBotProtectionIncident = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  channelId: string | null;
  messageId: string | null;
  messageContent: string | null;
  moduleId: MongoSelfBotProtectionModuleId;
  infractionType: string;
  punishmentActions: MongoSelfBotPunishmentAction[];
  punishmentSucceeded: boolean;
  punishmentError: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type MongoSelfBotRoleAssignment = {
  _id: string;
  active: boolean;
  botId: string;
  guildId: string;
  lastIncidentId: string;
  lastPunishedAt: Date;
  roleId: string | null;
  userId: string;
  username: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSafeBotWarningAction =
  | "record_only"
  | "dm"
  | "channel_message"
  | "add_role"
  | "remove_role"
  | "timeout"
  | "kick"
  | "ban"
  | "notify_staff"
  | "open_ticket"
  | "block_channels"
  | "custom";

export type MongoSafeBotWarningLevel = {
  id: string;
  number: number;
  name: string;
  description: string;
  defaultReason: string;
  action: MongoSafeBotWarningAction | null;
  durationSeconds: number | null;
  roleId: string | null;
  channelId: string | null;
  targetChannelIds: string[];
  logChannelId: string | null;
  userMessage: string;
  staffMessage: string;
  customAction: string;
  enabled: boolean;
};

export type MongoSafeBotWarningSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  authorizedRoleIds: string[];
  defaultLogChannelId: string | null;
  overflowMode: "repeat_last" | "record_only" | "block" | "final_action";
  finalLevel: MongoSafeBotWarningLevel | null;
  levels: MongoSafeBotWarningLevel[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSafeBotWarningUser = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  totalWarnings: number;
  internalNote: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSafeBotWarningRecord = {
  _id: string;
  botId: string;
  guildId: string;
  userId: string;
  username: string | null;
  staffId: string;
  staffName: string | null;
  reason: string;
  warningNumber: number;
  level: MongoSafeBotWarningLevel | null;
  configuredAction: MongoSafeBotWarningAction | null;
  executedAction: string | null;
  status: "pending" | "recorded" | "success" | "failed" | "removed";
  error: string | null;
  removedBy: string | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoTemporaryCall = {
  _id: string;
  botId: string;
  guildId: string;
  ownerId: string;
  channelId: string;
  channelName: string;
  userLimit: number;
  isPrivate: boolean;
  allowedUsers: string[];
  bannedUsers: string[];
  createdAt: Date;
  updatedAt: Date;
  emptySince: Date | null;
};

export type MongoAutomatedLogSettings = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  categoryId: string | null;
  channels: {
    site: string | null;
    absence: string | null;
    messages: string | null;
    calls: string | null;
    verification: string | null;
    punishment: string | null;
  };
  enabledChannels?: {
    site: boolean;
    absence: boolean;
    messages: boolean;
    calls: boolean;
    verification: boolean;
    punishment: boolean;
  };
  allowedRoleIds: string[];
  lastError: string | null;
  lastSyncedAt: Date | null;
  lastSyncRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoSecurityFeatureAccess = {
  _id: string;
  botId: string;
  featureKey: "security_protection";
  enabledByDev: boolean;
  enabledBy: string | null;
  enabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoDevBotStatus = "online" | "offline" | "invalid_token" | "error";

export type MongoDevBot = {
  _id: string;
  name: string;
  slug?: string | null;
  clientId: string;
  tokenEncrypted: string;
  tokenPrefix?: string | null;
  tokenLast4?: string | null;
  secretEncrypted: string | null;
  avatarUrl: string | null;
  botCreatedAt?: Date | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  mainGuildName?: string;
  mainGuildIconUrl?: string | null;
  mainGuildMemberCount?: number;
  mainGuildChannelCount?: number;
  status: MongoDevBotStatus;
  statusMessage?: string | null;
  enabledModules: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoBotGuildModuleConfig = {
  enabled?: boolean;
  channelId?: string | null;
  message?: string | null;
  interval?: number | null;
  roleId?: string | null;
  [key: string]: unknown;
};

export type MongoBotGuildConfig = {
  _id: string;
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, MongoBotGuildModuleConfig>;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoAntiBanAction = "log_only" | "remove_admin_roles" | "kick_executor" | "ban_executor" | "remove_dangerous_permissions" | "block_future_actions";
export type MongoAntiBanRecovery = "alert_only" | "unban" | "restore_permissions";

export type MongoAntiBanConfig = {
  _id: string;
  botId: string;
  guildId: string;
  enabled: boolean;
  banLimit: number;
  kickLimit: number;
  timeWindow: number;
  logChannelId: string | null;
  whitelistUsers: string[];
  whitelistRoles: string[];
  whitelistRoleMode: "ignore" | "log_only";
  protectedRoles: string[];
  actionOnTrigger: MongoAntiBanAction;
  autoRecovery: MongoAntiBanRecovery;
  createdAt: Date;
  updatedAt: Date;
};

export type MongoAntiBanLog = {
  _id: string;
  botId: string;
  guildId: string;
  executorId: string | null;
  targetId: string | null;
  actionType: string;
  amount: number;
  limit: number;
  punishment: string;
  success: boolean;
  errorMessage: string | null;
  metadata?: unknown;
  createdAt: Date;
};

export type MongoDevPermission = {
  _id: string;
  userId: string;
  role: "owner" | "dev" | "admin";
  canCreateBot: boolean;
  canEditBot: boolean;
  canDeleteBot: boolean;
  canManageModules: boolean;
  createdAt: Date;
};

export type MongoMaintenanceState = {
  _id: "global";
  active: boolean;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
};

export type MongoMaintenanceLog = {
  _id: string;
  action: "enabled" | "disabled" | "manual_alert";
  active: boolean;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
  message: string;
};

export type MongoDashboardAuditLog = {
  _id: string;
  action: string;
  userId: string | null;
  botId?: string | null;
  guildId?: string | null;
  dashboardSlug?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type MongoGlobalPanelImagePosition = "banner" | "thumbnail" | "top" | "below_text" | "above_buttons" | "footer" | "none";
export type MongoGlobalPanelImageSize = "small" | "medium" | "large" | "full_banner" | "custom";
export type MongoGlobalPanelImageLayoutMode = "embed" | "components_v2";

export type MongoPanelImageSettings = {
  _id: string;
  botId: string;
  guildId: string;
  panelId: string;
  imageEnabled: boolean;
  imageUrl: string;
  imagePosition: MongoGlobalPanelImagePosition;
  imageSize: MongoGlobalPanelImageSize;
  customWidth: number | null;
  customHeight: number | null;
  layoutMode: MongoGlobalPanelImageLayoutMode;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const globalForMongo = globalThis as unknown as {
  mongoClient?: MongoClient;
  mongoIndexes?: Promise<void>;
};

function databaseNameFromUri(uri: string) {
  try {
    const url = new URL(uri);
    const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
    return dbName || "orvitek";
  } catch {
    return "orvitek";
  }
}

function getMongoClient() {
  if (!env.MONGODB_URI) {
    throw new Error("MONGODB_URI nao configurada.");
  }

  if (!globalForMongo.mongoClient) {
    globalForMongo.mongoClient = new MongoClient(env.MONGODB_URI);
  }

  return globalForMongo.mongoClient;
}

export async function getMongoDb() {
  const client = getMongoClient();
  await client.connect();
  return client.db(databaseNameFromUri(env.MONGODB_URI));
}

export async function getMongoCollections() {
  const db = await getMongoDb();
  await ensureMongoIndexes(db);

  return {
    users: db.collection<MongoUser>("User"),
    guilds: db.collection<MongoGuild>("Guild"),
    guildSettings: db.collection<MongoGuildSettings>("GuildSettings"),
    safeBotMessageStates: db.collection<MongoSafeBotMessageState>("safe_bot_message_states"),
    tickets: db.collection<MongoTicket>("Ticket"),
    logEntries: db.collection<MongoLogEntry>("LogEntry"),
    socialNotifications: db.collection<MongoSocialNotification>("social_notifications"),
    kickApiConfigs: db.collection<MongoKickApiConfig>("kick_api_configs"),
    socialMembers: db.collection<MongoSocialMember>("social_members"),
    socialPanels: db.collection<MongoSocialPanel>("social_panels"),
    xAccounts: db.collection<MongoXAccount>("x_accounts"),
    xPostsSent: db.collection<MongoXPostSent>("x_posts_sent"),
    clipsConfig: db.collection<MongoClipsConfig>("clips_config"),
    clipsSent: db.collection<MongoClipSent>("clips_sent"),
    clipsLogs: db.collection<MongoClipLog>("clips_logs"),
    clipLiveSessions: db.collection<MongoClipLiveSession>("clip_live_sessions"),
    giveaways: db.collection<MongoGiveaway>("giveaways"),
    giveawayPlatformAccounts: db.collection<MongoGiveawayPlatformAccount>("giveaway_platform_accounts"),
    giveawayKickEvents: db.collection<MongoGiveawayKickEvent>("giveaway_kick_events"),
    fivemModules: db.collection<MongoFivemModule>("fivem_modules"),
    fivemFacSettings: db.collection<MongoFivemFacSettings>("fivem_fac_settings"),
    fivemFacAbsences: db.collection<MongoFivemFacAbsence>("fivem_fac_absences"),
    imageAntiSpamSettings: db.collection<MongoImageAntiSpamSettings>("image_anti_spam_settings"),
    imageAntiSpamUsers: db.collection<MongoImageAntiSpamUser>("image_anti_spam_users"),
    imageAntiSpamIncidents: db.collection<MongoImageAntiSpamIncident>("image_anti_spam_incidents"),
    voiceRecorderSettings: db.collection<MongoVoiceRecorderSettings>("voice_recorder_settings"),
    voiceRecordings: db.collection<MongoVoiceRecording>("voice_recordings"),
    emojiCloneJobs: db.collection<MongoEmojiCloneJob>("emoji_clone_jobs"),
    emojiCloneItems: db.collection<MongoEmojiCloneItem>("emoji_clone_items"),
    emojiLibrary: db.collection<MongoEmojiLibraryItem>("emoji_library"),
    mediaLibrary: db.collection<MongoMediaLibraryItem>("media_library"),
    mediaImportJobs: db.collection<MongoMediaImportJob>("media_import_jobs"),
    mediaImportJobItems: db.collection<MongoMediaImportJobItem>("media_import_job_items"),
    mediaSettings: db.collection<MongoMediaSettings>("media_settings"),
    applicationEmojiItems: db.collection<MongoApplicationEmojiItem>("application_emojis"),
    applicationEmojiJobs: db.collection<MongoApplicationEmojiJob>("application_emoji_jobs"),
    applicationEmojiSettings: db.collection<MongoApplicationEmojiSettings>("application_emoji_settings"),
    orvitechSalesSettings: db.collection<MongoOrvitechSalesSettings>("orvitech_sales_settings"),
    orvitechSalesPlans: db.collection<MongoOrvitechSalesPlan>("orvitech_sales_plans"),
    orvitechSales: db.collection<MongoOrvitechSale>("orvitech_sales"),
    missionToolsSettings: db.collection<MongoMissionToolsSettings>("mission_tools_settings"),
    missionToolsUsers: db.collection<MongoMissionToolsUserPanel>("mission_tools_users"),
    missionToolsTokens: db.collection<MongoMissionToolsToken>("mission_tools_tokens"),
    selfBotProtectionSettings: db.collection<MongoSelfBotProtectionSettings>("self_bot_protection_settings"),
    selfBotPunishmentStates: db.collection<MongoSelfBotPunishmentState>("self_bot_punishment_states"),
    selfBotProtectionIncidents: db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents"),
    selfBotRoleAssignments: db.collection<MongoSelfBotRoleAssignment>("self_bot_role_assignments"),
    safeBotWarningSettings: db.collection<MongoSafeBotWarningSettings>("safe_bot_warning_settings"),
    safeBotWarningUsers: db.collection<MongoSafeBotWarningUser>("safe_bot_warning_users"),
    safeBotWarningRecords: db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records"),
    temporaryCalls: db.collection<MongoTemporaryCall>("temporary_calls"),
    automatedLogSettings: db.collection<MongoAutomatedLogSettings>("automated_log_settings"),
    securityFeatureAccess: db.collection<MongoSecurityFeatureAccess>("security_feature_access"),
    devBots: db.collection<MongoDevBot>("Bot"),
    botGuildConfigs: db.collection<MongoBotGuildConfig>("BotGuildConfig"),
    antiBanConfigs: db.collection<MongoAntiBanConfig>("anti_ban_configs"),
    antiBanLogs: db.collection<MongoAntiBanLog>("anti_ban_logs"),
    devPermissions: db.collection<MongoDevPermission>("DevPermission"),
    maintenanceState: db.collection<MongoMaintenanceState>("MaintenanceState"),
    maintenanceLogs: db.collection<MongoMaintenanceLog>("MaintenanceLog"),
    dashboardAuditLogs: db.collection<MongoDashboardAuditLog>("DashboardAuditLog"),
    panelImageSettings: db.collection<MongoPanelImageSettings>("panel_image_settings")
  };
}

export async function ensureGuild(guildId: string) {
  const { guilds } = await getMongoCollections();
  const now = new Date();

  await guilds.updateOne(
    {
      _id: guildId
    },
    {
      $set: {
        updatedAt: now
      },
      $setOnInsert: {
        _id: guildId,
        name: `Guild ${guildId}`,
        icon: null,
        ownerId: null,
        botEnabled: false,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );
}

async function ensureMongoIndexes(db: Db) {
  if (!globalForMongo.mongoIndexes) {
    globalForMongo.mongoIndexes = createMongoIndexes(db).catch((error) => {
      console.warn("[mongo] nao foi possivel criar indices:", error instanceof Error ? error.message : error);
    });
  }

  await globalForMongo.mongoIndexes;
}

async function createMongoIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoUser>("User").createIndex(
      { discordId: 1 },
      {
        name: "User_discordId_key",
        unique: true
      }
    ),
    ensureGuildSettingsIndexes(db),
    db.collection<MongoTicket>("Ticket").createIndex({ guildId: 1, createdAt: -1 }),
    db.collection<MongoLogEntry>("LogEntry").createIndex({ guildId: 1, createdAt: -1 }),
    db.collection<MongoPanelImageSettings>("panel_image_settings").createIndex(
      { botId: 1, guildId: 1, panelId: 1 },
      { unique: true }
    ),
    ensureSocialNotificationIndexes(db),
    ensureKickApiIndexes(db),
    ensureSocialNetworkIndexes(db),
    ensureXMonitorIndexes(db),
    ensureClipsIndexes(db),
    ensureGiveawayIndexes(db),
    ensureFivemModuleIndexes(db),
    ensureFivemFacIndexes(db),
    ensureImageAntiSpamIndexes(db),
    ensureVoiceRecorderIndexes(db),
    ensureEmojiCloneIndexes(db),
    ensureOrvitechSalesIndexes(db),
    ensureMissionToolsIndexes(db),
    ensureSelfBotProtectionIndexes(db),
    ensureSafeBotWarningIndexes(db),
    ensureTemporaryCallIndexes(db),
    ensureAutomatedLogIndexes(db),
    ensureSecurityFeatureAccessIndexes(db),
    ensureAntiBanIndexes(db),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        guildId: 1,
        platform: 1
      },
      {
        name: "social_notifications_guildId_platform_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        platform: 1,
        enabled: 1
      },
      {
        name: "social_notifications_platform_enabled_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        botId: 1,
        platform: 1,
        enabled: 1,
        updatedAt: 1
      },
      {
        name: "social_notifications_bot_platform_enabled_updated_idx"
      }
    ),
    db.collection<MongoSocialNotification>("social_notifications").createIndex(
      {
        botId: 1,
        guildId: 1,
        platform: 1,
        createdAt: -1
      },
      {
        name: "social_notifications_bot_guild_platform_created_idx"
      }
    ),
    ensureDevBotIndexes(db),
    db.collection<MongoBotGuildConfig>("BotGuildConfig").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoDevPermission>("DevPermission").createIndex({ userId: 1 }, { unique: true }),
    ensureDashboardAuditLogIndexes(db)
  ]);
}

async function ensureAntiBanIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoAntiBanConfig>("anti_ban_configs").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoAntiBanLog>("anti_ban_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoAntiBanLog>("anti_ban_logs").createIndex({ botId: 1, guildId: 1, executorId: 1, createdAt: -1 })
  ]);
}

async function ensureDevBotIndexes(db: Db) {
  const collection = db.collection<MongoDevBot>("Bot");

  await ensureDevBotSlugs(collection);
  await collection.createIndex({ clientId: 1 }, { unique: true });
  await collection.createIndex({ slug: 1 }, { unique: true });
  await collection.createIndex({ ownerId: 1, createdAt: -1 });
  await collection.createIndex({ _id: 1, slug: 1 }, { name: "Bot_botId_dashboardSlug_idx" });
  await collection.createIndex({ mainGuildId: 1, updatedAt: -1 });
}

async function ensureDashboardAuditLogIndexes(db: Db) {
  const collection = db.collection<MongoDashboardAuditLog>("DashboardAuditLog");

  await Promise.all([
    collection.createIndex({ createdAt: -1 }),
    collection.createIndex({ userId: 1, createdAt: -1 }),
    collection.createIndex({ botId: 1, createdAt: -1 }),
    collection.createIndex({ guildId: 1, createdAt: -1 }),
    collection.createIndex({ dashboardSlug: 1, createdAt: -1 }),
    collection.createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    collection.createIndex({ botId: 1, dashboardSlug: 1, createdAt: -1 })
  ]);
}

async function ensureDevBotSlugs(collection: Collection<MongoDevBot>) {
  const bots = await collection
    .find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          slug: 1,
          createdAt: 1
        }
      }
    )
    .sort({ createdAt: 1 })
    .toArray();
  const reservedSlugs = new Set<string>();

  for (const bot of bots) {
    const currentSlug = bot.slug ? slugifyBotName(bot.slug) : "";
    const baseSlug = currentSlug || slugifyBotName(bot.name);
    const nextSlug = uniqueSlugFromReserved(baseSlug, reservedSlugs);

    reservedSlugs.add(nextSlug);

    if (bot.slug !== nextSlug) {
      await collection.updateOne(
        {
          _id: bot._id
        },
        {
          $set: {
            slug: nextSlug,
            updatedAt: new Date()
          }
        }
      );
    }
  }
}

function uniqueSlugFromReserved(baseSlug: string, reservedSlugs: Set<string>) {
  const base = baseSlug || "bot";
  let slug = base;
  let suffix = 2;

  while (reservedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function slugifyBotName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "bot";
}

async function ensureGuildSettingsIndexes(db: Db) {
  const collection = db.collection<MongoGuildSettings>("GuildSettings");

  await Promise.all([
    collection.dropIndex("guildId_1").catch(() => undefined),
    collection.dropIndex("GuildSettings_guildId_key").catch(() => undefined)
  ]);
  await collection.createIndex({ botId: 1, guildId: 1 }, { unique: true });
  await db.collection<MongoSafeBotMessageState>("safe_bot_message_states").createIndex(
    { botId: 1, guildId: 1 },
    { unique: true }
  );
}

async function ensureKickApiIndexes(db: Db) {
  await db.collection<MongoKickApiConfig>("kick_api_configs").createIndex(
    {
      botId: 1,
      guildId: 1
    },
    {
      unique: true
    }
  );
}

async function ensureSocialNotificationIndexes(db: Db) {
  const collection = db.collection<MongoSocialNotification>("social_notifications");

  await collection.dropIndex("guildId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_userId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_platform_1_twitchChannelName_1").catch(() => undefined);
  await collection.dropIndex("botId_1_guildId_1_platform_1_kickChannelName_1").catch(() => undefined);
  await collection.createIndex({
    botId: 1,
    guildId: 1
  });
  await collection.createIndex(
    {
      botId: 1,
      guildId: 1,
      platform: 1,
      twitchChannelName: 1
    },
    {
      name: "social_notifications_twitch_channel_unique",
      partialFilterExpression: {
        platform: "twitch",
        twitchChannelName: {
          $type: "string"
        }
      },
      unique: true
    }
  );
  await collection.createIndex(
    {
      botId: 1,
      guildId: 1,
      platform: 1,
      kickChannelName: 1
    },
    {
      name: "social_notifications_kick_channel_unique",
      partialFilterExpression: {
        platform: "kick",
        kickChannelName: {
          $type: "string"
        }
      },
      unique: true
    }
  );
}

async function ensureSocialNetworkIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSocialMember>("social_members").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoSocialMember>("social_members").createIndex({
      botId: 1,
      guildId: 1,
      name: 1
    }),
    db.collection<MongoSocialPanel>("social_panels").createIndex(
      {
        botId: 1,
        guildId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoSocialPanel>("social_panels").createIndex({
      botId: 1,
      published: 1,
      updatedAt: 1
    })
  ]);
}

async function ensureXMonitorIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoXAccount>("x_accounts").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoXAccount>("x_accounts").createIndex(
      {
        botId: 1,
        guildId: 1,
        username: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoXAccount>("x_accounts").createIndex({
      botId: 1,
      active: 1,
      lastSyncAt: 1
    }),
    db.collection<MongoXPostSent>("x_posts_sent").createIndex(
      {
        botId: 1,
        accountId: 1,
        xPostId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoXPostSent>("x_posts_sent").createIndex({
      botId: 1,
      guildId: 1,
      sentAt: -1
    })
  ]);
}

async function ensureClipsIndexes(db: Db) {
  const clipsConfig = db.collection<MongoClipsConfig>("clips_config");
  const clipsSent = db.collection<MongoClipSent>("clips_sent");
  const clipLiveSessions = db.collection<MongoClipLiveSession>("clip_live_sessions");

  await Promise.all([
    clipsConfig.dropIndex("botId_1_guildId_1").catch(() => undefined),
    clipsConfig.dropIndex("clips_config_scope_platform_unique").catch(() => undefined),
    clipsSent.dropIndex("botId_1_guildId_1_clipId_1").catch(() => undefined),
    clipsSent.dropIndex("clips_sent_scope_platform_clip_unique").catch(() => undefined)
  ]);

  await Promise.all([
    clipsConfig.createIndex({ botId: 1, guildId: 1, platform: 1, updatedAt: -1 }, { name: "clips_config_scope_platform_idx" }),
    clipsConfig.createIndex(
      { botId: 1, guildId: 1, platform: 1, twitchBroadcasterId: 1 },
      {
        name: "clips_config_twitch_channel_unique",
        partialFilterExpression: { platform: "twitch", twitchBroadcasterId: { $type: "string" }, deletedAt: null },
        unique: true
      }
    ),
    clipsConfig.createIndex(
      { botId: 1, guildId: 1, platform: 1, kickUserId: 1 },
      {
        name: "clips_config_kick_channel_unique",
        partialFilterExpression: { platform: "kick", kickUserId: { $type: "string" }, deletedAt: null },
        unique: true
      }
    ),
    clipsConfig.createIndex({ enabled: 1, botId: 1, platform: 1, deletedAt: 1, lastCheckAt: 1 }),
    clipsSent.createIndex({ botId: 1, configId: 1, clipId: 1 }, { name: "clips_sent_config_clip_unique", unique: true }),
    clipsSent.createIndex({ botId: 1, guildId: 1, platform: 1, sentAt: -1 }),
    clipsSent.createIndex({ botId: 1, guildId: 1, platform: 1, clipCreatorName: 1, sentAt: -1 }),
    clipLiveSessions.createIndex({ botId: 1, configId: 1, streamId: 1 }, { unique: true }),
    clipLiveSessions.createIndex({ botId: 1, guildId: 1, platform: 1, startedAt: -1 }),
    db.collection<MongoClipLog>("clips_logs").createIndex({ botId: 1, guildId: 1, createdAt: -1 })
  ]);
}

async function ensureGiveawayIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, status: 1, scheduledStartAt: 1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ botId: 1, status: 1, scheduledEndAt: 1 }),
    db.collection<MongoGiveaway>("giveaways").createIndex({ rouletteToken: 1 }, { unique: true }),
    db.collection<MongoGiveawayPlatformAccount>("giveaway_platform_accounts").createIndex(
      {
        platform: 1,
        platformUserId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoGiveawayKickEvent>("giveaway_kick_events").createIndex(
      {
        broadcasterUserId: 1,
        channelSlug: 1,
        userId: 1
      },
      {
        unique: true
      }
    ),
    db.collection<MongoGiveawayKickEvent>("giveaway_kick_events").createIndex({
      broadcasterUserId: 1,
      isFollower: 1,
      isSubscriber: 1,
      updatedAt: -1
    })
  ]);
}

async function ensureFivemModuleIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoFivemModule>("fivem_modules").createIndex({ builtIn: 1, createdAt: -1 }),
    db.collection<MongoFivemModule>("fivem_modules").createIndex({ title: 1 })
  ]);
}

async function ensureFivemFacIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoFivemFacSettings>("fivem_fac_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoFivemFacSettings>("fivem_fac_settings").createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, guildId: 1, userId: 1, status: 1 }),
    db.collection<MongoFivemFacAbsence>("fivem_fac_absences").createIndex({ botId: 1, status: 1, startDate: 1, endDate: 1 })
  ]);
}

async function ensureImageAntiSpamIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoImageAntiSpamSettings>("image_anti_spam_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoImageAntiSpamSettings>("image_anti_spam_settings").createIndex({
      botId: 1,
      enabled: 1,
      updatedAt: -1
    }),
    db.collection<MongoImageAntiSpamUser>("image_anti_spam_users").createIndex(
      { botId: 1, guildId: 1, userId: 1 },
      { unique: true }
    ),
    db.collection<MongoImageAntiSpamUser>("image_anti_spam_users").createIndex({
      botId: 1,
      guildId: 1,
      warningCount: -1,
      lastInfractionAt: -1
    }),
    db.collection<MongoImageAntiSpamIncident>("image_anti_spam_incidents").createIndex(
      { botId: 1, guildId: 1, incidentKey: 1 },
      { unique: true }
    ),
    db.collection<MongoImageAntiSpamIncident>("image_anti_spam_incidents").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    })
  ]);
}

async function ensureVoiceRecorderIndexes(db: Db) {
  const settings = db.collection<MongoVoiceRecorderSettings>("voice_recorder_settings");
  const recordings = db.collection<MongoVoiceRecording>("voice_recordings");

  await Promise.all([
    settings.createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    recordings.createIndex({ botId: 1, guildId: 1, startedAt: -1 }),
    recordings.createIndex({ botId: 1, guildId: 1, status: 1, startedAt: -1 }),
    recordings.createIndex({ botId: 1, guildId: 1, channelId: 1, startedAt: -1 }),
    recordings.createIndex({ botId: 1, guildId: 1, startedById: 1, startedAt: -1 }),
    recordings.createIndex(
      { botId: 1, guildId: 1, status: 1 },
      {
        name: "voice_recordings_active_unique",
        partialFilterExpression: {
          status: {
            $in: ["starting", "recording", "processing"]
          }
        },
        unique: true
      }
    )
  ]);
}

async function ensureEmojiCloneIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoEmojiCloneJob>("emoji_clone_jobs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoEmojiCloneJob>("emoji_clone_jobs").createIndex({ botId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoEmojiCloneItem>("emoji_clone_items").createIndex({ jobId: 1 }),
    db.collection<MongoEmojiCloneItem>("emoji_clone_items").createIndex({ jobId: 1, status: 1 }),
    db.collection<MongoEmojiLibraryItem>("emoji_library").createIndex({ botId: 1, userId: 1, importedAt: -1 }),
    db.collection<MongoEmojiLibraryItem>("emoji_library").createIndex({ botId: 1, userId: 1, name: 1 }),
    db.collection<MongoEmojiLibraryItem>("emoji_library").createIndex(
      { botId: 1, userId: 1, originalEmojiId: 1 },
      { unique: true }
    ),
    db.collection<MongoMediaLibraryItem>("media_library").createIndex({ botId: 1, guildId: 1, type: 1, createdAt: -1 }),
    db.collection<MongoMediaLibraryItem>("media_library").createIndex({ botId: 1, guildId: 1, name: 1 }),
    db.collection<MongoMediaImportJob>("media_import_jobs").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoMediaImportJobItem>("media_import_job_items").createIndex({ jobId: 1, status: 1 }),
    db.collection<MongoMediaSettings>("media_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex({ botId: 1, syncedAt: -1 }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex({ botId: 1, sourceGuildId: 1, syncedAt: -1 }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex({ botId: 1, applicationName: 1 }),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex(
      { botId: 1, applicationEmojiId: 1 },
      { unique: true }
    ),
    db.collection<MongoApplicationEmojiItem>("application_emojis").createIndex(
      { botId: 1, sourceGuildId: 1, originalEmojiId: 1 },
      { unique: true }
    ),
    db.collection<MongoApplicationEmojiJob>("application_emoji_jobs").createIndex({ botId: 1, guildId: 1, startedAt: -1 }),
    db.collection<MongoApplicationEmojiSettings>("application_emoji_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    )
  ]);
}

async function ensureMissionToolsIndexes(db: Db) {
  const settings = db.collection<MongoMissionToolsSettings>("mission_tools_settings");
  const users = db.collection<MongoMissionToolsUserPanel>("mission_tools_users");
  const tokens = db.collection<MongoMissionToolsToken>("mission_tools_tokens");

  await Promise.all([
    settings.createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    settings.createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    users.createIndex({ botId: 1, guildId: 1, updatedAt: -1 }),
    users.createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    tokens.createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    tokens.createIndex({ botId: 1, guildId: 1, tokenHash: 1 })
  ]);
}

async function ensureOrvitechSalesIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoOrvitechSalesSettings>("orvitech_sales_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoOrvitechSalesSettings>("orvitech_sales_settings").createIndex({ botId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoOrvitechSalesPlan>("orvitech_sales_plans").createIndex({ botId: 1, guildId: 1, enabled: 1, updatedAt: -1 }),
    db.collection<MongoOrvitechSale>("orvitech_sales").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoOrvitechSale>("orvitech_sales").createIndex({ botId: 1, status: 1, createdAt: -1 }),
    db.collection<MongoOrvitechSale>("orvitech_sales").createIndex({ botId: 1, buyerId: 1, createdAt: -1 })
  ]);
}

async function ensureSecurityFeatureAccessIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSecurityFeatureAccess>("security_feature_access").createIndex(
      { botId: 1, featureKey: 1 },
      { unique: true }
    ),
    db.collection<MongoSecurityFeatureAccess>("security_feature_access").createIndex({
      featureKey: 1,
      enabledByDev: 1,
      updatedAt: -1
    })
  ]);
}

async function ensureSelfBotProtectionIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSelfBotProtectionSettings>("self_bot_protection_settings").createIndex(
      { botId: 1, guildId: 1 },
      { unique: true }
    ),
    db.collection<MongoSelfBotProtectionSettings>("self_bot_protection_settings").createIndex({
      botId: 1,
      enabled: 1,
      updatedAt: -1
    }),
    db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents").createIndex({
      botId: 1,
      guildId: 1,
      createdAt: -1
    }),
    db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents").createIndex({
      botId: 1,
      guildId: 1,
      moduleId: 1,
      createdAt: -1
    }),
    db.collection<MongoSelfBotProtectionIncident>("self_bot_protection_incidents").createIndex({
      botId: 1,
      guildId: 1,
      userId: 1,
      createdAt: -1
    }),
    db.collection<MongoSelfBotPunishmentState>("self_bot_punishment_states").createIndex(
      {
        botId: 1,
        guildId: 1,
        userId: 1,
        moduleId: 1
      },
      { unique: true }
    ),
    db.collection<MongoSelfBotPunishmentState>("self_bot_punishment_states").createIndex({
      botId: 1,
      guildId: 1,
      updatedAt: -1
    }),
    db.collection<MongoSelfBotRoleAssignment>("self_bot_role_assignments").createIndex(
      {
        botId: 1,
        guildId: 1,
        userId: 1
      },
      { unique: true }
    ),
    db.collection<MongoSelfBotRoleAssignment>("self_bot_role_assignments").createIndex({
      active: 1,
      botId: 1,
      guildId: 1,
      updatedAt: -1
    })
  ]);
}

async function ensureSafeBotWarningIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoSafeBotWarningSettings>("safe_bot_warning_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true }),
    db.collection<MongoSafeBotWarningUser>("safe_bot_warning_users").createIndex({ botId: 1, guildId: 1, userId: 1 }, { unique: true }),
    db.collection<MongoSafeBotWarningUser>("safe_bot_warning_users").createIndex({ botId: 1, guildId: 1, totalWarnings: -1 }),
    db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records").createIndex({ botId: 1, guildId: 1, createdAt: -1 }),
    db.collection<MongoSafeBotWarningRecord>("safe_bot_warning_records").createIndex({ botId: 1, guildId: 1, userId: 1, createdAt: -1 })
  ]);
}

async function ensureTemporaryCallIndexes(db: Db) {
  await Promise.all([
    db.collection<MongoTemporaryCall>("temporary_calls").createIndex({ botId: 1, guildId: 1, ownerId: 1 }, { unique: true }),
    db.collection<MongoTemporaryCall>("temporary_calls").createIndex({ botId: 1, guildId: 1, channelId: 1 }, { unique: true }),
    db.collection<MongoTemporaryCall>("temporary_calls").createIndex({ botId: 1, emptySince: 1 })
  ]);
}

async function ensureAutomatedLogIndexes(db: Db) {
  await db.collection<MongoAutomatedLogSettings>("automated_log_settings").createIndex({ botId: 1, guildId: 1 }, { unique: true });
}
