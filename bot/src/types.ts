import type {
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder
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
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, context: BotContext) => Promise<void>;
};

export type GuildSettings = {
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
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
