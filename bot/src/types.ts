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
  ticketPanelImage: PanelImageSettings | null;
  ticketPanelTitle: string | null;
  ticketPanelDescription: string | null;
  ticketPanelInfoText: string | null;
  ticketPanelFooterText: string | null;
  ticketPanelColor: string;
  ticketPanelPlaceholder: string | null;
  ticketPanelOptions: TicketPanelOption[];
  logChannelId: string | null;
  discordLogsEnabled: boolean;
  siteLogsEnabled: boolean;
  discordLogCategories: LogCategory[];
  siteLogCategories: LogCategory[];
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
};

export type TicketPanelOption = {
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  label: string;
  value: string;
};

export type LogCategory =
  | "members"
  | "messages"
  | "roles"
  | "moderation"
  | "dashboard"
  | "automation";

export type PanelImageSettings = {
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
