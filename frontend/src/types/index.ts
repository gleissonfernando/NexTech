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
  shardIds?: number[];
  shardCount?: number;
  instanceId?: string;
  memory?: {
    heapUsedMb: number;
    rssMb: number;
  };
  botGuilds: Array<{
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount?: number;
    channelCount?: number;
    shardId?: number;
  }>;
  updatedAt: string;
};

export type GuildSettings = {
  botId: string | null;
  guildId: string;
  leavePanelImage: PanelImageSettings | null;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
  welcomePanelImage: PanelImageSettings | null;
  welcomeTitle: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle: string | null;
  welcomeRules: string | null;
  welcomeChannelLabel: string | null;
  welcomeFooterText: string | null;
  welcomeColor: string;
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
  leaveColor: string;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  ticketPanelImage: PanelImageSettings | null;
  ticketPanelTitle: string | null;
  ticketPanelDescription: string | null;
  ticketPanelInfoText: string | null;
  ticketPanelFooterText: string | null;
  ticketPanelColor: string;
  ticketPanelPlaceholder: string | null;
  ticketPanelOptions: TicketPanelOption[];
  reportSystem: ReportSystemSettings;
  logChannelId: string | null;
  discordLogsEnabled: boolean;
  siteLogsEnabled: boolean;
  discordLogCategories: LogCategory[];
  siteLogCategories: LogCategory[];
  globalLogConfig: GlobalLogConfig;
  moderationEnabled: boolean;
  accountAgeSecurityEnabled: boolean;
  accountAgeMinDays: number;
  accountAgeLogChannelId: string | null;
  accountAgeAllowedUserIds: string[];
  safeBotEnabled: boolean;
  safeBotChannelId: string | null;
  safeBotRoleId: string | null;
  safeBotLogChannelId: string | null;
  emojiCloneEnabled: boolean;
  emojiCloneAllowedRoleIds: string[];
  emojiCloneLogChannelId: string | null;
  emojiCloneDefaultPrefix: string | null;
  emojiCloneAllowAnimated: boolean;
  emojiCloneMaxPerRun: number;
  emojiCloneAllowedBotIds: string[];
  rulesEnabled: boolean;
  rulesChannelId: string | null;
  rulesRoleId: string | null;
  rulesTitle: string | null;
  rulesMessage: string | null;
  rulesButtonLabel: string | null;
  rulesColor: string;
  rulesPanelMessageId: string | null;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds: string[];
  dashboardRolePermissions: Record<string, DashboardAccessLevel>;
  dashboardUserPermissions: Record<string, DashboardAccessLevel>;
};

export type GlobalLogConfig = {
  transcriptChannelId: string | null;
  logViewRoleId: string | null;
  transcriptViewRoleId: string | null;
  transcriptRequired: boolean;
  transcriptWebsiteEnabled: boolean;
  transcriptTextEnabled: boolean;
  transcriptExpirationDays: number | null;
  panelBannerUrl: string | null;
  panelFooterText: string | null;
  panelColor: string;
  moduleEmoji: string | null;
  moduleName: string | null;
  showAnonymousAuthorToRoleIds: string[];
};

export type TicketPanelOption = {
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  label: string;
  value: string;
};

export type ReportSystemCategory = {
  channelOrCategoryId: string | null;
  color: string;
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
};

export type ReportSystemStatus = { color: string; id: string; name: string; order: number };
export type ReportSystemButtonKey = "claim" | "reply" | "status" | "requestEvidence" | "addMember" | "removeMember" | "transcript" | "close" | "reopen" | "delete";
export type ReportSystemLogKey = "opened" | "closed" | "replies" | "statusChanged" | "messagesDeleted" | "anonymous" | "admin";
export type ReportSystemSettings = {
  adminRoleIds: string[];
  allowAnonymousReports: boolean;
  allowAnonymousStaffReplies: boolean;
  anonymousAvatarUrl: string | null;
  anonymousEmbedColor: string;
  anonymousInvestigatorName: string;
  anonymousReporterName: string;
  auditChannelId: string | null;
  buttonText: string;
  buttons: Record<ReportSystemButtonKey, boolean>;
  categories: ReportSystemCategory[];
  categoryId: string | null;
  closeRoleIds: string[];
  comissarioCategoryId: string | null;
  comissarioLogChannelId: string | null;
  comissarioRoleIds: string[];
  competenceCommandRoleIds: string[];
  conselhoCategoryId: string | null;
  conselhoLogChannelId: string | null;
  conselhoRoleIds: string[];
  createRoleIds: string[];
  defaultDeadline: string;
  dmBannerUrl: string | null;
  enabled: boolean;
  footerText: string | null;
  finishedCategoryId: string | null;
  hcmdCategoryId: string | null;
  hcmdLogChannelId: string | null;
  hcmdRoleIds: string[];
  iabCategoryId: string | null;
  iabLogChannelId: string | null;
  iabRoleIds: string[];
  imageUrl: string | null;
  infoMessage: string;
  logChannelId: string | null;
  logs: Record<ReportSystemLogKey, boolean>;
  mentionRoleIds: string[];
  name: string;
  openMessage: string;
  panelChannelId: string | null;
  panelColor: string;
  panelDescription: string;
  panelEmoji: string | null;
  panelPlaceholder: string;
  panelTitle: string;
  subpoenaDmText: string;
  subpoenaPanelBannerUrl: string | null;
  permissionRoleIds: string[];
  reopenRoleIds: string[];
  replyRoleIds: string[];
  statusRoleIds: string[];
  statuses: ReportSystemStatus[];
  thumbnailUrl: string | null;
  transcriptChannelId: string | null;
  viewRoleIds: string[];
};

export type EmojiLibraryItem = {
  id: string;
  animated: boolean;
  botId: string;
  category: string;
  destinationGuildId: string;
  importedAt: string;
  lastUpdatedAt: string;
  name: string;
  originalEmojiId: string;
  sourceGuildId: string | null;
  targetEmojiId: string | null;
  targetEmojiName: string | null;
  url: string;
  userId: string;
};

export type EmojiCloneRemoteEmoji = {
  animated: boolean;
  id: string;
  name: string;
  selected: boolean;
  status: "ready" | "cloned" | "failed" | "ignored";
  url: string;
};

export type ServerBackupFrequency = "6h" | "12h" | "daily" | "weekly" | "monthly";
export type ServerBackupRestorePart = "roles" | "channels" | "permissions" | "emojis" | "stickers" | "settings" | "panels";
export type ServerBackupRestoreMode = "merge" | "missing" | "replace" | "clear";

export type ServerBackupSettings = {
  autoEnabled: boolean;
  authorizedRoleIds: string[];
  botId: string;
  frequency: ServerBackupFrequency;
  guildId: string;
  limit: number;
  logChannelId: string | null;
  updatedAt: string | null;
};

export type ServerBackupSnapshot = {
  botId: string;
  checksum?: string | null;
  counts: {
    categories: number;
    channels: number;
    emojis: number;
    roles: number;
    stickers: number;
  };
  createdAt: string;
  createdBy: string | null;
  guildId: string;
  guildName: string;
  id: string;
  kind: "manual" | "automatic";
  snapshotVersion?: number;
  status: "pending" | "completed" | "failed" | "partial";
  statusMessage: string | null;
  updatedAt: string;
};

export type ServerBackupRestorePreview = {
  backupId: string;
  canRestore: boolean;
  missingPermissions: string[];
  mode: ServerBackupRestoreMode;
  parts: ServerBackupRestorePart[];
  sourceGuildId: string;
  summary: {
    categories: number;
    channels: number;
    emojis: number;
    roles: number;
    settings: number;
    stickers: number;
  };
  targetGuildId: string;
  warnings: string[];
};

export type ServerBackupRestoreResult = {
  completedSteps: string[];
  errors: Array<{ message: string; step: string }>;
  idMap: {
    categories: Record<string, string>;
    channels: Record<string, string>;
    emojis: Record<string, string>;
    roles: Record<string, string>;
    stickers: Record<string, string>;
  };
  progress: Array<{
    at: string;
    message: string;
    status: "running" | "completed" | "warning" | "failed";
    step: string;
  }>;
  summary: {
    categories: number;
    channels: number;
    emojis: number;
    failed: number;
    permissions: number;
    reused: number;
    roles: number;
    settings: number;
    stickers: number;
  };
  progressPercent: number;
  durationMs: number;
};

export type ServerBackupRestoreJob = {
  id: string;
  backupId: string;
  botId: string;
  completedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  guildId: string;
  options: Array<ServerBackupRestorePart | ServerBackupRestoreMode>;
  progress?: number;
  preview: ServerBackupRestorePreview;
  result: ServerBackupRestoreResult | null;
  sourceGuildId?: string | null;
  status: "pending" | "running" | "completed" | "failed" | "partial";
  targetGuildId?: string | null;
  updatedAt: string;
};

export type ServerBackupDashboard = {
  backups: ServerBackupSnapshot[];
  restoreJobs: ServerBackupRestoreJob[];
  settings: ServerBackupSettings;
};

export type ApplicationEmojiItem = {
  animated: boolean;
  applicationEmojiId: string;
  applicationName: string;
  botId: string;
  hash: string | null;
  id: string;
  originalEmojiId: string;
  originalName: string;
  size: number;
  sourceGuildId: string | null;
  syncedAt: string;
  type: "Animado" | "Estatico";
  updatedAt: string;
  url: string;
};

export type ApplicationEmojiPage = {
  autoSyncGuildIds: string[];
  items: ApplicationEmojiItem[];
  limit: number;
  remaining: number;
  total: number;
};

export type ApplicationEmojiSettings = {
  autoSync: boolean;
  botId: string;
  guildId: string;
  updatedAt: string;
};

export type ApplicationEmojiSyncResult = ApplicationEmojiPage & {
  job?: {
    failed: number;
    id: string;
    removed: number;
    sent: number;
    skipped: number;
    status: "running" | "completed" | "failed";
    total: number;
    updated: number;
  };
};

export type LogCategory =
  | "members"
  | "messages"
  | "roles"
  | "moderation"
  | "dashboard"
  | "automation";

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

export type SafeBotWarningAction = "record_only" | "dm" | "channel_message" | "add_role" | "remove_role" | "timeout" | "kick" | "ban" | "notify_staff" | "open_ticket" | "block_channels" | "custom";
export type SafeBotWarningLevel = {
  id: string; number: number; name: string; description: string; defaultReason: string;
  action: SafeBotWarningAction | null; actions?: SafeBotWarningAction[]; durationSeconds: number | null; roleId: string | null;
  channelId: string | null; targetChannelIds: string[]; logChannelId: string | null;
  userMessage: string; staffMessage: string; customAction: string; enabled: boolean;
};
export type SafeBotWarningSettings = {
  id: string; botId: string; guildId: string; enabled: boolean; authorizedRoleIds: string[];
  defaultLogChannelId: string | null; overflowMode: "repeat_last" | "record_only" | "block" | "final_action";
  finalLevel: SafeBotWarningLevel | null; levels: SafeBotWarningLevel[]; createdAt: string; updatedAt: string;
};
export type SafeBotWarningUser = {
  id: string; botId: string; guildId: string; userId: string; username: string | null;
  totalWarnings: number; internalNote: string; createdAt: string; updatedAt: string;
};
export type SafeBotWarningRecord = {
  id: string; botId: string; guildId: string; userId: string; username: string | null;
  staffId: string; staffName: string | null; reason: string; warningNumber: number;
  level: SafeBotWarningLevel | null; configuredAction: SafeBotWarningAction | null;
  executedAction: string | null; status: "pending" | "recorded" | "success" | "failed" | "removed";
  error: string | null; removedBy: string | null; removedAt: string | null; createdAt: string; updatedAt: string;
};
export type SafeBotWarningDashboard = { settings: SafeBotWarningSettings; users: SafeBotWarningUser[]; warnings: SafeBotWarningRecord[] };
export type AutomatedLogSettings = { id: string; botId: string; guildId: string; enabled: boolean; categoryId: string | null; channels: { site: string | null; absence: string | null; messages: string | null; calls: string | null; verification: string | null; punishment: string | null }; enabledChannels: { site: boolean; absence: boolean; messages: boolean; calls: boolean; verification: boolean; punishment: boolean }; allowedRoleIds: string[]; lastError: string | null; lastSyncedAt: string | null; lastSyncRequestedAt: string | null; createdAt: string; updatedAt: string };

export type PanelImagePosition = "banner" | "thumbnail" | "top" | "below_title" | "middle" | "bottom" | "side" | "footer" | "before_buttons" | "below_text" | "above_buttons" | "none";
export type PanelImageSize = "small" | "medium" | "large" | "full_banner" | "custom";
export type PanelImageLayoutMode = "embed" | "components_v2";
export type PanelBlock =
  | { editable?: boolean; id: string; order: number; type: "text"; content: string }
  | { divider?: boolean; id: string; order: number; spacing?: "small" | "large" | number; type: "separator" }
  | { id: string; items: Array<{ description?: string | null; spoiler?: boolean; url: string }>; order: number; type: "media_gallery" }
  | { accessory?: { kind: "thumbnail"; description?: string | null; url: string } | { kind: "button"; customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string } | null; id: string; order: number; texts: string[]; type: "section" }
  | { buttons: Array<{ customId?: string; disabled?: boolean; label: string; style?: "primary" | "secondary" | "success" | "danger" | "link"; url?: string }>; id: string; order: number; type: "action_row" };

export type PanelImageSettings = {
  blocks: PanelBlock[];
  botId: string;
  customHeight: number | null;
  customWidth: number | null;
  guildId: string;
  imageEnabled: boolean;
  imageInvalidReason?: string | null;
  imagePosition: PanelImagePosition;
  imageSize: PanelImageSize;
  imageUrl: string;
  layoutMode: PanelImageLayoutMode;
  panelId: string;
  updatedAt: string | null;
  useGlobalDefault: boolean;
};

export type SavePanelImageSettingsPayload = Partial<Pick<
  PanelImageSettings,
  "blocks" | "customHeight" | "customWidth" | "imageEnabled" | "imagePosition" | "imageSize" | "imageUrl" | "layoutMode" | "useGlobalDefault"
>>;

export type SaveSelfBotProtectionSettingsPayload = Partial<Omit<
  SelfBotProtectionSettings,
  "id" | "botId" | "guildId" | "createdAt" | "updatedAt"
>>;

export type LogEntry = {
  id: string;
  botId: string | null;
  guildId: string;
  userId?: string | null;
  executorId?: string | null;
  channelId?: string | null;
  logChannelId?: string | null;
  module?: string | null;
  action?: string | null;
  caseId?: string | null;
  status?: string | null;
  transcriptId?: string | null;
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

export type CourseSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  publishChannelId: string | null;
  scheduleChannelId: string | null;
  scheduleLogChannelId: string | null;
  proofLogChannelId: string | null;
  resultChannelId: string | null;
  evaluationChannelId: string | null;
  reportChannelId: string | null;
  logChannelId: string | null;
  adminLogChannelId: string | null;
  temporaryCategoryId: string | null;
  tempProofCategoryId: string | null;
  evaluatorMentionRoleId: string | null;
  resultMentionRoleId: string | null;
  adminUserIds: string[];
  adminRoleIds: string[];
  managerUserIds: string[];
  managerRoleIds: string[];
  generalInstructorRoleIds: string[];
  globalInstructorUserIds: string[];
  globalInstructorRoleIds: string[];
  evaluatorUserIds: string[];
  evaluatorRoleIds: string[];
  configUserIds: string[];
  configRoleIds: string[];
  permissionMatrix: Record<string, { userIds: string[]; roleIds: string[] }>;
  images: CourseImage[];
  defaultExpirationHours: number | null;
  noPermissionMessage: string;
  cancelledMessage: string;
  startedMessage: string;
  globalBannerUrl: string | null;
  reportImageUrl: string | null;
  panelMessageId: string | null;
  lastPanelRequestedAt: string | null;
  buttonEmojis: { cancel: string; enter: string; leave: string; start: string } & Record<string, string | undefined>;
  updatedAt: string;
};

export type CourseImage = {
  id: string;
  botId: string | null;
  guildId: string;
  name: string;
  type: "main_banner" | "proof_banner" | "logs_banner" | "approved_result" | "rejected_result" | "module";
  url: string;
  createdAt: string;
  createdBy: string | null;
  active: boolean;
  default: boolean;
};

export type Course = {
  id: string;
  botId: string | null;
  guildId: string;
  name: string;
  code: string | null;
  description: string | null;
  emoji: string | null;
  color: string;
  bannerUrl: string | null;
  proofBannerUrl: string | null;
  footerImageUrl: string | null;
  thumbnailUrl: string | null;
  imagePosition: "top" | "bottom" | "side" | "footer";
  publishText: string | null;
  proofInstructionText: string | null;
  startedText: string | null;
  cancelledText: string | null;
  buttonLabels: { cancel: string; enter: string; leave: string; start: string };
  instructorUserIds: string[];
  instructorRoleIds: string[];
  allowGeneralInstructorRoles: boolean;
  publishChannelId: string | null;
  maxStudents: number;
  location: string | null;
  defaultSchedule: string | null;
  active: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoursePublication = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  channelId: string;
  messageId: string | null;
  instructorId: string;
  location: string;
  scheduledFor: string;
  capacity: number;
  students: string[];
  notes: string | null;
  status: "open" | "started" | "cancelled" | "closed" | "proof" | "finished";
  cancelledBy: string | null;
  cancelledAt: string | null;
  startedAt: string | null;
  proofStartedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseScheduleRequest = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  instructorId: string;
  requestedDate: string;
  requestedTime: string;
  location: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseReport = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  instructorId: string;
  reportDate: string;
  reportTime: string;
  students: Array<{ note: string; observation: string | null; userId: string }>;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
};

export type CourseExamSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  enabled: boolean;
  minScore: number;
  maxTimeMinutes: number | null;
  correctionChannelId: string | null;
  resultChannelId: string | null;
  temporaryCategoryId: string | null;
  logChannelId: string | null;
  deleteWrittenAnswers: boolean;
  allowCurrentQuestionReview: boolean;
  initialMessage: string;
  finalMessage: string;
  approvalMessage: string;
  rejectionMessage: string;
  manualQuestionMaxScore: number;
  manualApproval: boolean;
  automaticApproval: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

export type CourseExamQuestion = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  order: number;
  questionNumber: number;
  type: "selection" | "written";
  prompt: string;
  title: string;
  description: string | null;
  points: number;
  alternatives: Array<{ id: string; text: string; value?: string; score?: number; isCorrect?: boolean; order?: number }>;
  correctAlternativeId: string | null;
  placeholder: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type CourseExamAttempt = {
  id: string;
  botId: string | null;
  guildId: string;
  courseId: string;
  publicationId: string;
  channelId: string;
  studentId: string;
  instructorId: string;
  status: "in_progress" | "finished" | "approved" | "rejected" | "awaiting_review" | "manual_reviewed";
  startedAt: string;
  finishedAt: string | null;
  correctedAt: string | null;
  correctedBy: string | null;
  currentQuestionIndex: number;
  objectiveCorrect: number;
  objectiveWrong: number;
  writtenCount: number;
  score: number;
  automaticScore: number;
  manualScore: number | null;
  finalScore: number | null;
  manualObservation: string | null;
  result: "approved" | "rejected" | null;
  maxScore: number;
  percent: number;
  correctionMessageId: string | null;
  rejectionReason: string | null;
  updatedAt: string;
};

export type CourseExamDashboard = {
  attempts: CourseExamAttempt[];
  questions: CourseExamQuestion[];
  settings: CourseExamSettings;
};

export type CourseLog = {
  id: string;
  action: string;
  actorId: string | null;
  type: string;
  authorId: string | null;
  targetId: string | null;
  courseId: string | null;
  publicationId: string | null;
  sessionId: string | null;
  channelId: string | null;
  status: string | null;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CoursesDashboard = {
  courses: Course[];
  publications: CoursePublication[];
  reports: CourseReport[];
  scheduleRequests: CourseScheduleRequest[];
  settings: CourseSettings;
  logs: CourseLog[];
};

export type SaveCourseSettingsPayload = Partial<Omit<CourseSettings, "id" | "botId" | "guildId" | "updatedAt">>;
export type SaveCoursePayload = Partial<Omit<Course, "id" | "botId" | "guildId" | "createdAt" | "updatedAt">> & { name: string };
export type SaveCourseExamSettingsPayload = Partial<Omit<CourseExamSettings, "id" | "botId" | "guildId" | "courseId" | "updatedAt">>;
export type SaveCourseExamQuestionPayload = Partial<Omit<CourseExamQuestion, "id" | "botId" | "guildId" | "courseId" | "createdAt" | "updatedAt">> & { prompt: string; type: "selection" | "written" };

export type RhAdminSettings = {
  id: string;
  botId: string | null;
  guildId: string;
  enabled: boolean;
  systemName: string;
  color: string;
  panelChannelId: string | null;
  absencePanelChannelId: string | null;
  absenceReviewChannelId: string | null;
  absenceLogChannelId: string | null;
  adornmentPanelChannelId: string | null;
  adornmentReviewChannelId: string | null;
  adornmentLogChannelId: string | null;
  generalLogChannelId: string | null;
  absenceRoleId: string | null;
  configUserIds: string[];
  configRoleIds: string[];
  approverUserIds: string[];
  approverRoleIds: string[];
  viewerUserIds: string[];
  viewerRoleIds: string[];
  panelBannerUrl: string | null;
  dmBannerUrl: string | null;
  approvalDmBannerUrl: string | null;
  rejectionDmBannerUrl: string | null;
  finishedDmBannerUrl: string | null;
  adornmentBannerUrl: string | null;
  panelDescription: string;
  adornmentDescription: string;
  approvalDmText: string;
  rejectionDmText: string;
  finishedDmText: string;
  sendAbsenceDm: boolean;
  mentionAdornmentUser: boolean;
  allowNonDirectImageLinks: boolean;
  checkIntervalMinutes: number;
  buttonEmojis: { absence: string; adornment: string; approve: string; reject: string; back: string; save: string; publish: string; logs: string };
  mainPanelMessageId: string | null;
  mainPanelPublishedAt: string | null;
  lastPanelRequestedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type RhAdminAbsence = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  serverName: string;
  startDate: string;
  returnDate: string;
  startAt: string;
  returnAt: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "finished";
  absenceRoleId: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewChannelId: string | null;
  reviewMessageId: string | null;
  roleAddedAt: string | null;
  roleRemovedAt: string | null;
  autoRemoved: boolean;
  dmDelivered: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type RhAdminAdornment = {
  id: string;
  botId: string | null;
  guildId: string;
  userId: string;
  serverName: string;
  number: string;
  imageUrl: string;
  observation: string | null;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
};

export type RhAdminLog = {
  id: string;
  action: string;
  actorId: string | null;
  channelId: string | null;
  createdAt: string;
  description: string;
  guildId: string;
  metadata: Record<string, unknown>;
  status: "success" | "warning" | "error" | "denied" | "info";
  userId: string | null;
};

export type RhAdminDashboard = {
  absences: RhAdminAbsence[];
  adornments: RhAdminAdornment[];
  logs: RhAdminLog[];
  settings: RhAdminSettings;
  stats: { approvedAbsences: number; pendingAbsences: number; sentAdornments: number };
};

export type SaveRhAdminSettingsPayload = Partial<Omit<RhAdminSettings, "id" | "botId" | "guildId" | "updatedAt">>;

export type ManualRegistrationField = {
  enabled: boolean;
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  name: string;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type ManualRegistrationSetRole = {
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
  requestable: boolean;
  roleId: string;
};

export type ManualRegistrationSettings = {
  approvalChannelId: string | null;
  allowOnlyOneRequest: boolean;
  allowResubmit: boolean;
  approvalMessage: string;
  approverRoleIds: string[];
  automaticApproval: boolean;
  autoRoleIds: string[];
  bannerPosition: "top" | "bottom" | "none";
  botId: string | null;
  color: string;
  description: string | null;
  cooldownMinutes: number;
  dmNotifications: boolean;
  enabled: boolean;
  emoji: string | null;
  fields: ManualRegistrationField[];
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  name: string;
  panelCategoryId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelImage: PanelImageSettings | null;
  rejectionMessage: string;
  removeRoleIds: string[];
  setRoles: ManualRegistrationSetRole[];
  staffRoleIds: string[];
  successMessage: string;
  thumbnailUrl: string | null;
  title: string;
  updatedAt: string | null;
};

export type ManualRegistrationSubmission = {
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string | null;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  messageId: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  requestedRoleId: string | null;
  status: "pending" | "approved" | "rejected";
  updatedAt: string;
  userAvatar: string | null;
  userId: string;
  username: string;
};

export type ManualRegistrationLog = {
  action: string;
  botId: string | null;
  createdAt: string;
  data: Record<string, unknown>;
  executorId: string | null;
  guildId: string;
  id: string;
  submissionId: string | null;
  targetUserId: string | null;
};

export type ManualRegistrationDashboard = {
  logs: ManualRegistrationLog[];
  settings: ManualRegistrationSettings;
  submissions: ManualRegistrationSubmission[];
};

export type FivemGoalField = {
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type FivemGoalItem = {
  category: string | null;
  color: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
};

export type FivemGoalSettings = {
  autoCreateWithManualRegistration: boolean;
  botId: string | null;
  categoryId: string | null;
  channelNameTemplate: string;
  enabled: boolean;
  fields: FivemGoalField[];
  guildId: string;
  items: FivemGoalItem[];
  logChannelId: string | null;
  managerRoleId: string | null;
  requestPanelChannelId: string | null;
  requestPanelDescription: string;
  requestPanelEnabled: boolean;
  requestPanelMessageId: string | null;
  requestPanelTitle: string;
  requestRequiresApproval: boolean;
  updatedAt: string | null;
  viewRoleId: string | null;
};

export type FivemGoalEntry = {
  botId: string | null;
  channelId: string;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  imageUrl: string;
  itemId: string | null;
  quantity: number | null;
  updatedAt: string;
  userId: string;
};

export type FivemGoalConfig = {
  approverRoleIds: string[];
  botId: string | null;
  createdAt: string;
  createdBy: string | null;
  currentValue: number;
  deleteRoleIds: string[];
  description: string | null;
  editRoleIds: string[];
  fields: FivemGoalField[];
  guildId: string;
  id: string;
  logChannelId: string | null;
  managerRoleIds: string[];
  name: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  participantRoleIds: string[];
  period: "daily" | "weekly" | "monthly" | "custom";
  requiresApproval: boolean;
  requiresProof: boolean;
  resetConfig: {
    customDate: string | null;
    enabled: boolean;
    frequency: "none" | "daily" | "weekly" | "monthly" | "custom";
  };
  rules: string | null;
  status: "active" | "paused" | "finished";
  targetValue: number;
  totalParticipants: number;
  type: string;
  updatedAt: string;
  updatedBy?: string | null;
  viewerRoleIds: string[];
};

export type FivemGoalSubmission = {
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string | null;
  createdAt: string;
  description: string | null;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  metaId: string;
  proofUrl: string | null;
  refusedAt: string | null;
  refusedBy: string | null;
  refusalReason: string | null;
  roleIdsSnapshot: string[];
  status: "pending" | "approved" | "refused";
  updatedAt: string;
  userId: string;
  value: number;
};

export type FivemGoalLog = {
  action: string;
  botId: string | null;
  createdAt: string;
  details: Record<string, unknown>;
  guildId: string;
  id: string;
  metaId: string | null;
  userId: string | null;
};

export type FivemGoalReport = {
  approvedCount: number;
  members: Array<{
    approvedCount: number;
    pendingCount: number;
    refusedCount: number;
    totalApprovedValue: number;
    totalPendingValue: number;
    userId: string;
  }>;
  participantCount: number;
  pendingCount: number;
  periodEnd: string;
  periodStart: string;
  refusedCount: number;
  totalApprovedValue: number;
  totalPendingValue: number;
  totalRecords: number;
  types: Array<{
    approvedCount: number;
    metaId: string;
    name: string;
    totalApprovedValue: number;
    type: string;
  }>;
};

export type FivemOrderStatus = "open" | "pending_approval" | "approved" | "in_production" | "ready" | "delivered" | "cancelled" | "rejected";
export type FivemOrderSettings = {
  adminRoleIds: string[]; allowAnonymous: boolean; allowAttachments: boolean; allowCustomNotes: boolean; approvalChannelId: string | null; approvalRequired: boolean; approveRoleIds: string[];
  botId: string | null; cancelRoleIds: string[]; color: string; createRoleIds: string[]; deliveryChannelId: string | null; enabled: boolean; errorMessage: string;
  editValueRoleIds: string[]; enabledOrderModules: Array<"washing" | "ammo" | "drug" | "weapon" | "custom">; finishRoleIds: string[]; footerText: string | null; guildId: string; logChannelId: string | null; maxOpenHours: number; orderCancelledMessage: string;
  orderCreatedMessage: string; orderDeliveredMessage: string; panelChannelId: string | null; panelDescription: string; panelImage: PanelImageSettings | null;
  panelMessageId: string | null; panelTitle: string; updatedAt: string | null;
};
export type FivemOrderFamily = { active: boolean; botId: string | null; createdAt: string; guildId: string; id: string; logChannelId: string | null; name: string; notes: string | null; orderModules: Array<"washing" | "ammo" | "drug" | "weapon" | "custom">; responsibleId: string; roleId: string; type?: "pista" | "produto" | "sem_produto"; updatedAt: string };
export type FivemOrderProduct = {
  active: boolean; allowCustomQuantity: boolean; allowNotes: boolean; botId: string | null; category: string; cost: number; createdAt: string;
  config?: {
    adminRoleIds?: string[];
    allowAttachments?: boolean | null;
    allowCustomNotes?: boolean | null;
    approvalChannelId?: string | null;
    approvalRequired?: boolean | null;
    approveRoleIds?: string[];
    cancelRoleIds?: string[];
    color?: string | null;
    createRoleIds?: string[];
    deliveryChannelId?: string | null;
    finishRoleIds?: string[];
    footerText?: string | null;
    logChannelId?: string | null;
    orderCancelledMessage?: string | null;
    orderCreatedMessage?: string | null;
    orderDeliveredMessage?: string | null;
  };
  defaultQuantity: number; description: string | null; emoji: string | null; factionPercentage: number; washingPercentages?: number[]; featured: boolean; guildId: string; id: string; maximumQuantity: number; minimumQuantity: number;
  name: string; order: number; price: number; sellerPercentage: number; type: "standard" | "washing" | "ammo" | "drug" | "weapon" | "custom";
  updatedAt: string;
};

export type FivemFinanceSettings = {
  adminRoleIds: string[];
  allowBalanceQuery: boolean;
  allowNegativeBalance: boolean;
  autoCloseMinutes: number;
  bannerMode: "above" | "inside" | "below" | "none";
  botId: string | null;
  color: string;
  enabled: boolean;
  footerImageUrl: string | null;
  footerText: string | null;
  guildId: string;
  logChannelId: string | null;
  panelChannelId: string | null;
  panelDescription: string;
  panelImage: PanelImageSettings | null;
  panelMessageId: string | null;
  panelTitle: string;
  tempCategoryId: string | null;
  updatedAt: string | null;
  useRoleIds: string[];
};
export type FivemFinanceTransaction = {
  amount: number;
  botId: string | null;
  createdAt: string;
  guildId: string;
  id: string;
  logChannelId: string | null;
  logMessageId: string | null;
  newBalance: number;
  notes: string | null;
  oldBalance: number;
  proofImageUrl: string;
  proofMessageId: string | null;
  status: "completed" | "reviewed" | "cancelled" | "corrected";
  tempChannelId: string | null;
  transactionId: string;
  type: "add" | "remove";
  updatedAt: string;
  userAvatar: string | null;
  userId: string;
  username: string;
};
export type FivemFinanceDashboard = {
  report: {
    balance: number;
    lastUpdatedAt: string | null;
    topAdders: Array<{ amount: number; count: number; userId: string; username: string }>;
    topRemovers: Array<{ amount: number; count: number; userId: string; username: string }>;
    totalIn: number;
    totalOut: number;
    transactions: number;
  };
  settings: FivemFinanceSettings;
  transactions: FivemFinanceTransaction[];
};
export type FivemOrder = {
  botId: string | null; category: string; clientName: string; costTotal: number; createdAt: string; expectedDelivery: string | null; familyId: string; familyName: string; finalValue: number;
  grossValue: number; guildId: string; history: Array<{ actorId: string | null; at: string; from: FivemOrderStatus | null; note: string | null; to: FivemOrderStatus }>;
  id: string; notes: string | null; orderNumber: number; productId: string; productName: string; profit: number; proofUrl: string | null; quantity: number;
  responsibleId: string | null; sourceId: string | null; status: FivemOrderStatus; unitPrice: number; updatedAt: string; userId: string; washingPercentage?: number | null;
};
export type FivemOrderLog = { action: string; actorId: string | null; botId: string | null; createdAt: string; data: Record<string, unknown>; guildId: string; id: string; orderId: string | null; productId: string | null };
export type FivemOrderDashboard = {
  families: FivemOrderFamily[]; logs: FivemOrderLog[]; orders: FivemOrder[]; products: FivemOrderProduct[];
  report: { cancelled: number; delivered: number; familyTotals: Array<{ familyId: string; name: string; orders: number; total: number }>; open: number; productTotals: Array<{ name: string; productId: string; quantity: number; total: number }>; production: number; totalProfit: number; totalRevenue: number; typeTotals: Array<{ orders: number; total: number; type: string }> };
  settings: FivemOrderSettings;
};

export type FivemGoalDashboard = {
  configs: FivemGoalConfig[];
  entries: FivemGoalEntry[];
  logs: FivemGoalLog[];
  report: FivemGoalReport;
  settings: FivemGoalSettings;
  submissions: FivemGoalSubmission[];
};

export type FivemHierarchyEntry = {
  active: boolean;
  color: string | null;
  description: string | null;
  emoji: string | null;
  id: string;
  limit: number | null;
  name: string;
  order: number;
  roleId: string;
};

export type FivemHierarchyPanel = {
  allowedRoleIds: string[];
  botId: string | null;
  color: string;
  createdAt: string;
  description: string | null;
  enabled: boolean;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string | null;
  guildId: string;
  hierarchies: FivemHierarchyEntry[];
  id: string;
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  linkedToFivem: boolean;
  logChannelId: string | null;
  name: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  title: string;
  updatedAt: string;
  updatedBy?: string | null;
};

export type FivemHierarchyLog = {
  action: string;
  botId: string | null;
  createdAt: string;
  details: Record<string, unknown>;
  guildId: string;
  id: string;
  panelId: string | null;
  userId: string | null;
};

export type FivemHierarchyDashboard = {
  logs: FivemHierarchyLog[];
  panels: FivemHierarchyPanel[];
};

export type GlobalBlacklistSafeBotSettings = {
  autoBlacklistOnSafeBotBan: boolean;
  botId: string | null;
  directActions: string[];
  enabledSafeBotModules: string[];
  guildId: string;
  infractionLimit: number;
  kickMode: "history_only" | "alert" | "blacklist";
  logChannelId: string | null;
  requireApprovalAfterRemoval: boolean;
  updatedAt: string | null;
};

export type GlobalBlacklistEntry = {
  active: boolean;
  addedAt: string;
  addedBy: string | null;
  addedByType: "safebot" | "staff";
  botId: string | null;
  guildId: string;
  id: string;
  reason: string;
  safeBotModule: string | null;
  userId: string;
};

export type GlobalBlacklistHistory = {
  action: "infraction" | "blacklisted" | "removed" | "monitored" | "approval_required";
  createdAt: string;
  guildId: string;
  id: string;
  infractionType: string;
  reason: string;
  safeBotModule: string | null;
  userId: string;
};

export type GlobalBlacklistDashboard = {
  entries: GlobalBlacklistEntry[];
  history: GlobalBlacklistHistory[];
  settings: GlobalBlacklistSafeBotSettings;
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

export type GuildCategoryOption = {
  id: string;
  name: string;
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
  categories?: GuildCategoryOption[];
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
  autoApproveEnabled: boolean;
  autoApproveMaxDays: number | null;
  autoApproveRoleIds: string[];
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
  approvedBy: string | null;
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

export type FivemModuleDefinition = {
  builtIn: boolean;
  description: string;
  id: string;
  permissions: string;
  title: string;
};

export type SaveFivemModulePayload = {
  description: string;
  permissions: string;
  title: string;
};

export type SaveFivemFacSettingsPayload = Partial<Omit<FivemFacSettings, "id" | "botId" | "guildId" | "panelMessageId" | "lastPanelRequestedAt" | "createdAt" | "updatedAt">>;

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
export type MissionToolsTokenStatus = "connected" | "invalid" | "expired" | "disconnected" | "fake";

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

export type MissionToolsStats = {
  configuredUsers: number;
  usersWithToken: number;
  runningMissions: number;
  runningCleanups: number;
  activeVoiceSessions: number;
  activeRichPresence: number;
  usernameHits: number;
};

export type MissionToolsResponse = {
  settings: MissionToolsSettings;
  users: MissionToolsUserPanel[];
  stats: MissionToolsStats;
};

export type SaveMissionToolsSettingsPayload = Partial<Omit<
  MissionToolsSettings,
  "id" | "botId" | "guildId" | "panelMessageId" | "lastPanelRequestedAt" | "createdAt" | "updatedAt"
>>;

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

export type ClipsConfigPage = {
  configs: ClipsConfig[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

export type GiveawayPlatformDiagnostics = {
  channel: string | null;
  connected: boolean;
  lastError: string | null;
  lastEvent: string | null;
  lastMessage: string | null;
  tokenStatus: "invalid" | "missing" | "unknown" | "valid";
  usersReceived: number;
};

export type GiveawayDiagnosticLog = {
  at: string;
  level: "debug" | "error" | "info";
  message: string;
  platform: "system" | "twitch" | "kick";
  payload?: unknown;
};

export type GiveawayDiagnostics = {
  debug: boolean;
  kick: GiveawayPlatformDiagnostics;
  logs: GiveawayDiagnosticLog[];
  twitch: GiveawayPlatformDiagnostics;
};

export type SaveClipsConfigPayload = {
  configId?: string | null;
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

export type OrvitechPaymentProviderType = "manual" | "pix" | "mercadopago" | "stripe" | "paypal" | "custom";
export type OrvitechSaleStatus = "pending" | "paid" | "cancelled" | "refunded";

export type OrvitechSalesPaymentProvider = {
  id: string;
  gatewayId: string;
  ownerUserId: string;
  storeId: string;
  enabled: boolean;
  label: string;
  provider: OrvitechPaymentProviderType;
  publicKey: string | null;
  webhookUrl: string | null;
  instructions: string | null;
  secretConfigured: boolean;
  secretMasked: string | null;
  webhookSecretConfigured: boolean;
  updatedAt: string;
};

export type OrvitechSalesSettings = {
  id: string;
  botId: string;
  guildId: string;
  storeId: string;
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
  paymentProviders: OrvitechSalesPaymentProvider[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrvitechSalesPlan = {
  id: string;
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
  createdAt: string;
  updatedAt: string;
};

export type OrvitechProductFeatureKey =
  | "hosting"
  | "updates"
  | "support"
  | "automaticContract"
  | "automaticPix"
  | "releaseCode"
  | "coupons"
  | "automaticRenewal"
  | "passwordCreation"
  | "automaticLogin"
  | "activationKey";

export type OrvitechProductPlanConfig = {
  benefits: string[];
  buttonColor: string;
  buttonText: string;
  description: string;
  enabled: boolean;
  name: string;
  paymentProviderId: string | null;
  priceCents: number;
  priceText: string;
};

export type OrvitechProduct = {
  id: string;
  active: boolean;
  additionalInfo: string;
  bannerUrl: string | null;
  botId: string;
  category: string;
  createdAt: string;
  createdBy: string | null;
  fullDescription: string;
  guildId: string;
  howItWorks: string;
  layout: {
    accentColor: string;
    glassEffect: boolean;
    theme: "dark" | "purple";
  };
  name: string;
  observations: string;
  ownerUserId: string;
  plans: {
    lifetime: OrvitechProductPlanConfig;
    monthly: OrvitechProductPlanConfig;
  };
  publicUrl: string;
  seo: {
    description: string | null;
    title: string | null;
  };
  shortDescription: string;
  slug: string;
  storeId: string;
  toggles: Record<OrvitechProductFeatureKey, boolean>;
  updatedAt: string;
  updatedBy: string | null;
  warnings: string;
};

export type OrvitechSale = {
  id: string;
  botId: string;
  guildId: string;
  planId: string | null;
  planName: string;
  buyerId: string;
  buyerName: string | null;
  amountCents: number;
  currency: "BRL" | "USD" | "EUR";
  paymentGatewayId: string | null;
  paymentProviderId: string | null;
  paymentProviderLabel: string | null;
  productId?: string | null;
  productName?: string | null;
  productPlanType?: "monthly" | "lifetime" | "manual";
  productSlug?: string | null;
  externalReference: string | null;
  status: OrvitechSaleStatus;
  notes: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrvitechSalesDashboard = {
  plans: OrvitechSalesPlan[];
  products: OrvitechProduct[];
  sales: OrvitechSale[];
  settings: OrvitechSalesSettings;
  stats: {
    activePlans: number;
    customers: number;
    paidSales: number;
    pendingSales: number;
    revenueCents: number;
    subscriptions: number;
    salesThisMonth: number;
    totalSales: number;
  };
};

export type PublicOrvitechProduct = {
  paymentProviders: Array<Pick<OrvitechSalesPaymentProvider, "gatewayId" | "id" | "label" | "provider">>;
  product: OrvitechProduct;
  settings: Pick<OrvitechSalesSettings, "currency" | "enabled" | "panelColor" | "storeId" | "termsUrl">;
};

export type PriceTableItem = {
  active: boolean;
  billingText: string | null;
  billingType: "one_time" | "monthly" | "weekly" | "custom";
  description: string | null;
  highlight: boolean;
  id: string;
  name: string;
  order: number;
  price: number;
  priceText: string | null;
};

export type PriceTable = {
  id: string;
  botId: string;
  buttonText: { plans: string; quote: string; support: string };
  color: string;
  createdAt: string;
  createdBy: string | null;
  currency: "BRL" | "USD" | "EUR" | "CUSTOM";
  currencyFormat: string;
  description: string | null;
  discordChannelId: string | null;
  footerText: string | null;
  guildId: string;
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  isActive: boolean;
  items: PriceTableItem[];
  logChannelId: string | null;
  messageId: string | null;
  modalText: {
    contactLabel: string;
    contactPlaceholder: string;
    detailsLabel: string;
    detailsPlaceholder: string;
    productLabel: string;
    productPlaceholder: string;
    title: string;
    userNameLabel: string;
    userNamePlaceholder: string;
  };
  name: string;
  supportCategoryId: string | null;
  title: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type PriceTableRequest = {
  id: string;
  botId: string;
  contact: string;
  createdAt: string;
  details: string;
  guildId: string;
  itemId: string | null;
  itemName: string;
  tableId: string;
  ticketChannelId: string | null;
  userId: string;
  userName: string;
};

export type PriceTablesDashboard = {
  requests: PriceTableRequest[];
  tables: PriceTable[];
};

export type SavePriceTablePayload = Partial<Omit<
  PriceTable,
  "botId" | "createdAt" | "createdBy" | "guildId" | "id" | "messageId" | "updatedAt" | "updatedBy"
>>;

export type ManualPaymentService = {
  active: boolean;
  amount: number;
  bannerUrl: string | null;
  createServiceChannel: boolean;
  customText: string | null;
  description: string | null;
  id: string;
  manualApproval: boolean;
  name: string;
  order: number;
  serviceType: "product" | "service" | "subscription" | "custom";
};

export type ManualPaymentSettings = {
  id: string;
  approveRoleIds: string[];
  attendanceCategoryId: string | null;
  bannerUrl: string | null;
  botId: string;
  color: string;
  enabled: boolean;
  finalizeRoleIds: string[];
  guildId: string;
  logChannelId: string | null;
  logViewRoleIds: string[];
  maxPaymentMinutes: number;
  paymentCategoryId: string | null;
  paymentInstructions: string;
  pixKey: string | null;
  pixKeyType: "cpf" | "cnpj" | "phone" | "email" | "random";
  pixQrCodeUrl: string | null;
  receiverBank: string | null;
  receiverName: string | null;
  rejectRoleIds: string[];
  salePanelDescription: string;
  salePanelChannelId: string | null;
  salePanelMessageId: string | null;
  salePanelTitle: string;
  services: ManualPaymentService[];
  supportPanelChannelId: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type ManualPaymentOrderStatus =
  | "PENDING_PAYMENT"
  | "WAITING_STAFF_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "DELIVERED"
  | "FINISHED"
  | "CANCELLED_BY_CUSTOMER"
  | "CANCELLED_BY_STAFF";

export type ManualPaymentOrder = {
  id: string;
  amount: number;
  approvedAt: string | null;
  approvedBy: string | null;
  botId: string;
  createdAt: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  guildId: string;
  orderNumber: number;
  paidAt: string | null;
  paymentChannelId: string | null;
  paymentMessageId: string | null;
  paymentMethod: "PIX_KEY" | "PIX_QR_CODE" | null;
  proofMessageId: string | null;
  proofUrl: string | null;
  rejectionReason: string | null;
  serviceChannelId: string | null;
  serviceId: string;
  serviceName: string;
  rejectedBy: string | null;
  staffMessageId: string | null;
  status: ManualPaymentOrderStatus;
  updatedAt: string;
  userId: string;
  username: string | null;
};

export type ManualPaymentOrderLog = {
  id: string;
  action: string;
  actorId: string | null;
  botId: string;
  channelId: string | null;
  createdAt: string;
  guildId: string;
  message: string;
  metadata: Record<string, unknown> | null;
  newStatus: ManualPaymentOrderStatus;
  oldStatus: ManualPaymentOrderStatus | null;
  orderId: string;
};

export type ManualPaymentsDashboard = {
  logs: ManualPaymentOrderLog[];
  orders: ManualPaymentOrder[];
  settings: ManualPaymentSettings;
};

export type SaveManualPaymentSettingsPayload = Partial<Omit<
  ManualPaymentSettings,
  "botId" | "guildId" | "id" | "salePanelMessageId" | "updatedAt" | "updatedBy"
>>;

export type SaveOrvitechSalesSettingsPayload = Partial<Pick<
  OrvitechSalesSettings,
  | "currency"
  | "customerRoleId"
  | "enabled"
  | "logChannelId"
  | "panelColor"
  | "panelDescription"
  | "panelImageUrl"
  | "panelTitle"
  | "publicUrl"
  | "saleChannelId"
  | "supportRoleIds"
  | "termsUrl"
  | "thumbnailUrl"
>>;

export type SaveOrvitechPaymentProviderPayload = {
  enabled: boolean;
  id?: string | null;
  instructions?: string | null;
  label: string;
  provider: OrvitechPaymentProviderType;
  publicKey?: string | null;
  secret?: string | null;
  webhookSecret?: string | null;
  webhookUrl?: string | null;
};

export type SaveOrvitechSalesPlanPayload = {
  checkoutMessage?: string | null;
  description?: string | null;
  durationDays?: number | null;
  enabled: boolean;
  imageUrl?: string | null;
  moduleIds: string[];
  name: string;
  priceCents: number;
};

export type SaveOrvitechProductPayload = Omit<
  OrvitechProduct,
  "botId" | "createdAt" | "createdBy" | "guildId" | "id" | "ownerUserId" | "publicUrl" | "storeId" | "updatedAt" | "updatedBy"
>;

export type SaveOrvitechSalePayload = {
  amountCents?: number | null;
  buyerId: string;
  buyerName?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  paymentProviderId?: string | null;
  planId?: string | null;
  status: OrvitechSaleStatus;
};

export type BotGuildConfig = {
  id: string;
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export type DatabaseMaintenanceUser = {
  userId: string;
  username: string | null;
  sources: string[];
};

export type DatabaseMaintenanceLink = {
  channels: string[];
  collection: string;
  count: number;
  module: string;
  sample: Array<Record<string, unknown>>;
};

export type DatabaseMaintenanceLinksResult = {
  botId: string | null;
  guildId: string;
  links: DatabaseMaintenanceLink[];
  total: number;
  userId: string;
};

export type DatabaseMaintenanceActionResult = {
  deletedTotal: number;
  errors?: Array<{ collection: string; message: string; module: string }>;
  modules: Array<{ collection: string; deleted: number; module: string; reason?: string }>;
  channelIds?: string[];
};

export type DatabaseMaintenanceModuleOption = {
  id: string;
  label: string;
};

export type AdvancedModuleConfig = {
  botId: string;
  config: Record<string, unknown>;
  guildId: string;
  moduleId: string;
  updatedAt: string;
};

export type TagVerificationRunResult = {
  botId: string;
  guildId: string;
  checked: number;
  assigned: number;
  removed: number;
  ignored: number;
  unavailable: number;
  errors: number;
  lastCheckAt: string;
  nextCheckAt: string | null;
  lastError: string | null;
};

export type AntiBanAction = "log_only" | "remove_admin_roles" | "kick_executor" | "ban_executor" | "remove_dangerous_permissions" | "block_future_actions";
export type AntiBanRecovery = "alert_only" | "unban" | "restore_permissions";

export type AntiBanConfig = {
  id: string | null;
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
  actionOnTrigger: AntiBanAction;
  autoRecovery: AntiBanRecovery;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AntiBanReadiness = {
  botId: string;
  guildId: string;
  ready: boolean;
  missingPermissions: string[];
  error: string | null;
  checks: {
    administrator: boolean;
    banMembers: boolean;
    kickMembers: boolean;
    manageRoles: boolean;
    viewAuditLog: boolean;
  };
};

export type AntiBanLog = {
  id: string;
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
  createdAt: string;
};

export type DevBotStatus = "online" | "offline" | "invalid_token" | "error";

export type FivemActionArchitecture = "fac" | "police";
export type FivemActionSettings = { id: string; botId: string; guildId: string; architecture: FivemActionArchitecture; enabled: boolean; categoryId: string | null; panelChannelId: string | null; actionChannelId: string | null; reportChannelId: string | null; panelMessageId: string | null; panelTitle: string; panelDescription: string; color: string; imageUrl: string | null; imagePosition: "top" | "center" | "bottom" | "none"; lastPanelRequestedAt: string | null; createdAt: string; updatedAt: string };
export type FivemActionDefinition = { id: string; botId: string; guildId: string; architecture: FivemActionArchitecture; name: string; description: string; emoji: string | null; imageUrl: string | null; color: string; maxParticipants: number; enabled: boolean; order: number; createdAt: string; updatedAt: string };
export type FivemActionParticipant = { userId: string; username: string; roleIds: string[]; joinedAt: string; leftAt: string | null };
export type FivemActionSession = { id: string; architecture: FivemActionArchitecture; actionId: string; actionName: string; actionDescription: string; actionEmoji: string | null; actionImageUrl: string | null; actionColor: string; openerId: string; openerName: string; channelId: string | null; messageId: string | null; status: "active" | "victory" | "defeat"; maxParticipants: number; participants: FivemActionParticipant[]; startedAt: string; finishedAt: string | null; createdAt: string; updatedAt: string };
export type FivemActionDashboard = { settings: FivemActionSettings; actions: FivemActionDefinition[]; history: FivemActionSession[] };
export type PolicePatrolSettings = { id: string; botId: string; guildId: string; enabled: boolean; creatorRoleIds: string[]; viewerRoleIds: string[]; deleteRoleIds: string[]; supervisorRoleIds: string[]; logChannelId: string | null; temporaryCategoryId: string | null; deleteDelayMinutes: number; defaultExportFormat: "html" | "pdf" | "json"; createdAt: string; updatedAt: string };
export type PolicePatrolReport = { id: string; officerId: string; officerName: string; authorId: string; authorName: string; patrolType: string | null; initialNotes: string | null; patrolStart: string | null; patrolEnd: string | null; durationMinutes: number | null; channelId: string | null; messageCount: number; attachmentCount: number; status: "draft" | "active" | "finished" | "cancelled"; createdAt: string; finishedAt: string | null };
export type PolicePatrolDashboard = { settings: PolicePatrolSettings; reports: PolicePatrolReport[] };
export type PoliceHiddenChannelSettings = { id: string; botId: string; guildId: string; enabled: boolean; channelId: string | null; allowedRoleId: string | null; logChannelId: string | null; createdBy: string | null; createdAt: string; updatedBy: string | null; updatedAt: string };
export type PoliceHiddenChannelLog = { id: string; botId: string; guildId: string; channelId: string; logChannelId: string | null; originalMessageId: string; relayedMessageId: string | null; authorId: string; authorTag: string; content: string; attachmentUrls: string[]; stickerIds: string[]; embedCount: number; status: "relayed" | "failed"; errorMessage: string | null; createdAt: string };
export type PoliceHiddenChannelDashboard = { settings: PoliceHiddenChannelSettings; logs: PoliceHiddenChannelLog[] };
export type DmBarConfig = { id: string; botId: string; guildId: string; enabled: boolean; allowedRoleIds: string[]; allowedUserIds: string[]; allowAdmins: boolean; logChannelId: string | null; logsEnabled: boolean; titleTemplate: string; descriptionTemplate: string; footerText: string; mainImageUrl: string | null; footerIconUrl: string | null; imagePosition: "top" | "middle" | "bottom" | "gallery" | "thumbnail" | "none"; accentColor: string; emoji: string; cooldownSeconds: number; allowMentions: boolean; showSender: boolean; showDate: boolean; showServer: boolean; showTargetId: boolean; footerEnabled: boolean; signature: string; createdAt: string; updatedAt: string; updatedBy: string | null };
export type DmBarLog = { id: string; botId: string; guildId: string; senderId: string; targetId: string | null; title: string; message: string; status: "sent" | "failed" | "denied" | "cancelled" | "test"; errorReason: string | null; sentAt: string };
export type DmBarDashboard = { config: DmBarConfig; logs: DmBarLog[]; stats: { lastSenderId: string | null; lastSentAt: string | null; sentCount: number } };
export type OpenDutyCounterMode = "accumulate" | "reset_after_3" | "cycles";
export type OpenDutySettings = { id: string; botId: string | null; guildId: string; enabled: boolean; logChannelId: string | null; alertChannelId: string | null; mentionChannelId: string | null; allowedRoleIds: string[]; allowedUserIds: string[]; defaultMessage: string; alertMessage: string; dmBannerUrl: string | null; panelBannerUrl: string | null; footerImageUrl: string | null; footerText: string | null; footerIconUrl: string | null; imagePosition: "top" | "middle" | "bottom" | "footer" | "none"; panelColor: string; buttonEmojis: { cancel: string; config: string; edit: string; logs: string; reset: string; save: string; search: string; send: string }; counterMode: OpenDutyCounterMode; updatedAt: string; updatedBy: string | null };
export type OpenDutyNotification = { id: string; botId: string | null; guildId: string; executorId: string; targetId: string; message: string; edited: boolean; status: "sent" | "failed" | "cancelled" | "denied"; errorReason: string | null; counterTotal: number; alertTriggered: boolean; createdAt: string };
export type OpenDutyDashboard = { counters: Array<{ lastNotifiedAt: string | null; total: number; userId: string }>; history: OpenDutyNotification[]; settings: OpenDutySettings };
export type SaveOpenDutySettingsPayload = Partial<Omit<OpenDutySettings, "id" | "botId" | "guildId" | "updatedAt">>;

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

export type DiscloudBotStatus = "online" | "offline" | "restarting" | "deploy" | "suspended" | "maintenance" | "unknown";

export type DiscloudBotSnapshot = {
  botId: string;
  botName: string;
  botAvatarUrl: string | null;
  clientId: string;
  appId: string;
  appName: string;
  status: DiscloudBotStatus;
  region: string | null;
  plan: string | null;
  uptime: string | null;
  onlineSince: string | null;
  lastStartedAt: string | null;
  nodeVersion: string | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  memoryUsagePercent: number | null;
  cpuUsagePercent: number | null;
  diskUsedMb: number | null;
  diskTotalMb: number | null;
  diskUsagePercent: number | null;
  networkDown: string | null;
  networkUp: string | null;
  requestCount: number | null;
  apiPingMs: number | null;
  botPingMs: number | null;
  lastDeployAt: string | null;
  lastSyncAt: string;
  alerts: string[];
  rawStatus: string | null;
};

export type DiscloudHistoryEvent = {
  id: string;
  appId: string;
  botId: string | null;
  event: string;
  message: string;
  createdAt: string;
};

export type DiscloudMonitoringResponse = {
  configured: boolean;
  bots: DiscloudBotSnapshot[];
  history: DiscloudHistoryEvent[];
  updatedAt: string;
};

export type DiscloudLogsResponse = {
  full: string;
  small: string;
  updatedAt: string;
};

export type DiscloudConsoleResult = {
  online: boolean;
  stderr: string;
  stdout: string;
};

export type MaintenanceLog = {
  id: string;
  action: "enabled" | "disabled" | "manual_alert";
  active: boolean;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
  message: string;
};

export type MaintenanceState = {
  active: boolean;
  activatedAt: string | null;
  affectedBots: number;
  deactivatedAt: string | null;
  logs: MaintenanceLog[];
  updatedAt: string;
  updatedById: string | null;
  updatedByName: string | null;
};

export type DevAccessRole = "owner" | "admin" | "dev";

export type DevAccessEntry = {
  id: string;
  userId: string;
  role: DevAccessRole;
  canCreateBot: boolean;
  canEditBot: boolean;
  canDeleteBot: boolean;
  canManageModules: boolean;
  createdAt: string;
};

export type CreateDevBotPayload = {
  token: string;
  mainGuildId: string;
};
