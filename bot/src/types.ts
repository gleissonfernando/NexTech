import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import type { ApiClient } from "./services/apiClient";
import type { BotSocketClient } from "./websocket/socketClient";

export type BotContext = {
  api: ApiClient;
  client: Client;
  commands: Collection<string, BotCommand>;
  liveCache: Set<string>;
  socket: BotSocketClient;
};

export type BotCommand = {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, context: BotContext) => Promise<void>;
  moduleId?: string;
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
  ticketPanelChannelId: string | null;
  ticketPanelMessageId: string | null;
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
  globalLogConfig: {
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
  dashboardRolePermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
  dashboardUserPermissions?: Record<string, "admin" | "moderator" | "premium" | "basic">;
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
  escalateToCategoryId: string | null;
  id: string;
  judgeLabel: string | null;
  logChannelId: string | null;
  name: string;
  order: number;
  responsibleRoleIds: string[];
};

export type ReportSystemStatus = {
  color: string;
  id: string;
  name: string;
  order: number;
};

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

export type LogCategory =
  | "members"
  | "messages"
  | "roles"
  | "moderation"
  | "dashboard"
  | "automation";

export type PanelImageSettings = {
  blocks?: import("./services/panelVisualRenderer").PanelBlock[];
  botId: string;
  customHeight: number | null;
  customWidth: number | null;
  guildId: string;
  imageEnabled: boolean;
  imagePosition: import("./services/panelVisualRenderer").PanelVisualPosition;
  useGlobalDefault?: boolean;
  imageSize: "small" | "medium" | "large" | "full_banner" | "custom";
  imageUrl: string;
  layoutMode: "embed" | "components_v2";
  panelId: string;
  updatedAt: string | null;
};
