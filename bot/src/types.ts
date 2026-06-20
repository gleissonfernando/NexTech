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
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds: string[];
};

export type LogCategory =
  | "members"
  | "messages"
  | "roles"
  | "moderation"
  | "dashboard"
  | "automation";
