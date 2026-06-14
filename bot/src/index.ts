import {
  Client,
  GatewayIntentBits,
  Options,
  Partials
} from "discord.js";
import { env, isBotModuleEnabled } from "./config/env";
import { createCommandCollection } from "./commands";
import { registerEvents } from "./handlers/eventHandler";
import { ApiClient } from "./services/apiClient";
import { isLinkAntiSpamEnabled } from "./services/linkAntiSpamService";
import { isSelfBotModuleEnabled } from "./services/safeBotService";
import type { BotContext } from "./types";
import { BotSocketClient } from "./websocket/socketClient";

const intents = [GatewayIntentBits.Guilds];
const managedRuntimeBot = Boolean(env.DASHBOARD_BOT_ID.trim());
const needsVoiceRecorder = isBotModuleEnabled("voice-recorder");
const needsMemberEvents = ["welcome", "leave", "roles", "logs", "fivem-fac", "account-age-security"].some(isBotModuleEnabled)
  || isSelfBotModuleEnabled()
  || managedRuntimeBot;
const selfBotModuleEnabled = isSelfBotModuleEnabled();
const needsLegacyMessageModeration = !selfBotModuleEnabled && (isBotModuleEnabled("image-anti-spam") || isLinkAntiSpamEnabled());
const needsMessageLogs = managedRuntimeBot || isBotModuleEnabled("logs") || env.BOT_MESSAGE_LOGS_ENABLED;
const needsMessageEvents = needsLegacyMessageModeration
  || selfBotModuleEnabled
  || managedRuntimeBot
  || needsMessageLogs;

if (env.BOT_MEMBER_EVENTS_ENABLED && needsMemberEvents) {
  intents.push(GatewayIntentBits.GuildMembers);
}

if (needsMessageLogs) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

if (needsMessageEvents) {
  if (!intents.includes(GatewayIntentBits.GuildMessages)) {
    intents.push(GatewayIntentBits.GuildMessages);
  }
  if (!intents.includes(GatewayIntentBits.MessageContent)) {
    intents.push(GatewayIntentBits.MessageContent);
  }
}

if (env.BOT_PRESENCE_MONITOR_ENABLED && isBotModuleEnabled("live")) {
  intents.push(GatewayIntentBits.GuildPresences);
}

if (needsVoiceRecorder) {
  intents.push(GatewayIntentBits.GuildVoiceStates);
}

const partials = [Partials.Channel, Partials.User];

if (needsMessageLogs || (!selfBotModuleEnabled && isBotModuleEnabled("image-anti-spam")) || managedRuntimeBot) {
  partials.push(Partials.Message);
}

const client = new Client({
  intents,
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    GuildInviteManager: 0,
    GuildMemberManager: {
      maxSize: env.BOT_CACHE_MEMBERS_MAX,
      keepOverLimit: (member) => Boolean(member.client.user && member.id === member.client.user.id)
    },
    DMMessageManager: 0,
    GuildForumThreadManager: 0,
    GuildMessageManager: needsMessageLogs ? env.BOT_CACHE_MESSAGES_PER_CHANNEL : 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    GuildTextThreadManager: 0,
    MessageManager: needsMessageLogs ? env.BOT_CACHE_MESSAGES_PER_CHANNEL : 0,
    PresenceManager: env.BOT_PRESENCE_MONITOR_ENABLED ? env.BOT_CACHE_PRESENCES_MAX : 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
    UserManager: env.BOT_CACHE_USERS_MAX,
    VoiceStateManager: needsVoiceRecorder ? 500 : 0
  }),
  partials,
  sweepers: {
    guildMembers: {
      interval: 3_600,
      filter: () => (member) => Boolean(member.client.user && member.id !== member.client.user.id)
    },
    messages: {
      interval: 300,
      lifetime: 300
    },
    presences: {
      interval: 300,
      filter: () => () => true
    },
    users: {
      interval: 3_600,
      filter: () => (user) => user.bot
    }
  }
});

const commands = createCommandCollection();
const context: BotContext = {
  api: new ApiClient(),
  client,
  commands,
  liveCache: new Set<string>(),
  socket: new BotSocketClient()
};

registerEvents(client, context);

if (!env.DISCORD_BOT_TOKEN) {
  console.error("[bot] DISCORD_BOT_TOKEN nao configurado.");
  process.exit(1);
}

process.on("SIGINT", () => {
  context.socket.disconnect(client);
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  context.socket.disconnect(client);
  client.destroy();
  process.exit(0);
});

void client.login(env.DISCORD_BOT_TOKEN);
