import {
  Client,
  GatewayIntentBits,
  Options,
  Partials
} from "discord.js";
import { env } from "./config/env";
import { createCommandCollection } from "./commands";
import { registerEvents } from "./handlers/eventHandler";
import { ApiClient } from "./services/apiClient";
import type { BotContext } from "./types";
import { BotSocketClient } from "./websocket/socketClient";

const intents = [GatewayIntentBits.Guilds];

if (env.BOT_MEMBER_EVENTS_ENABLED) {
  intents.push(GatewayIntentBits.GuildMembers);
}

if (env.BOT_MESSAGE_LOGS_ENABLED) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

if (env.BOT_PRESENCE_MONITOR_ENABLED) {
  intents.push(GatewayIntentBits.GuildPresences);
}

const partials = [Partials.Channel, Partials.User];

if (env.BOT_MESSAGE_LOGS_ENABLED) {
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
    GuildMessageManager: env.BOT_MESSAGE_LOGS_ENABLED ? env.BOT_CACHE_MESSAGES_PER_CHANNEL : 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    GuildTextThreadManager: 0,
    MessageManager: env.BOT_MESSAGE_LOGS_ENABLED ? env.BOT_CACHE_MESSAGES_PER_CHANNEL : 0,
    PresenceManager: env.BOT_PRESENCE_MONITOR_ENABLED ? env.BOT_CACHE_PRESENCES_MAX : 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
    UserManager: env.BOT_CACHE_USERS_MAX,
    VoiceStateManager: 0
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
