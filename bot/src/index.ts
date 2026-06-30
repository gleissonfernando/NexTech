import {
  Client,
  GatewayIntentBits,
  Options,
  Partials
} from "discord.js";
import { env, isBotModuleEnabled } from "./config/env";
import { createCommandCollection } from "./commands";
import { registerEvents, stopEventProcessing } from "./handlers/eventHandler";
import { ApiClient } from "./services/apiClient";
import { isLinkAntiSpamEnabled } from "./services/linkAntiSpamService";
import { isSelfBotModuleEnabled } from "./services/safeBotService";
import type { BotContext } from "./types";
import { BotSocketClient } from "./websocket/socketClient";

const intents = [GatewayIntentBits.Guilds];
const managedRuntimeBot = Boolean(env.DASHBOARD_BOT_ID.trim());
const needsVoiceRecorder = isBotModuleEnabled("voice-recorder");
const needsMusic = isBotModuleEnabled("music") || managedRuntimeBot;
const needsTagVerification = isBotModuleEnabled("tag-verification") || managedRuntimeBot;
const needsVoiceEvents = managedRuntimeBot || isBotModuleEnabled("anti-abuse") || isBotModuleEnabled("anti-disconnect") || isBotModuleEnabled("temporary-voice") || isBotModuleEnabled("logs");
const needsAntiBan = isBotModuleEnabled("anti-ban") || managedRuntimeBot;
const needsMemberEvents = ["welcome", "leave", "roles", "logs", "fivem-fac", "account-age-security", "anti-ban", "tag-verification"].some(isBotModuleEnabled)
  || isSelfBotModuleEnabled()
  || managedRuntimeBot;
const selfBotModuleEnabled = isSelfBotModuleEnabled();
const needsLegacyMessageModeration = !selfBotModuleEnabled && (isBotModuleEnabled("image-anti-spam") || isLinkAntiSpamEnabled());
const needsMessageLogs = managedRuntimeBot || isBotModuleEnabled("logs") || env.BOT_MESSAGE_LOGS_ENABLED;
const needsMessageEvents = needsLegacyMessageModeration
  || selfBotModuleEnabled
  || managedRuntimeBot
  || needsMusic
  || isBotModuleEnabled("temporary-voice")
  || needsMessageLogs;

if (needsTagVerification || (env.BOT_MEMBER_EVENTS_ENABLED && needsMemberEvents)) {
  intents.push(GatewayIntentBits.GuildMembers);
}

if (needsAntiBan) {
  intents.push(GatewayIntentBits.GuildModeration);
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

if ((env.BOT_PRESENCE_MONITOR_ENABLED && isBotModuleEnabled("live")) || needsTagVerification) {
  intents.push(GatewayIntentBits.GuildPresences);
}

if (needsVoiceRecorder || needsMusic || needsVoiceEvents) {
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
    PresenceManager: needsTagVerification ? Math.max(env.BOT_CACHE_PRESENCES_MAX, env.BOT_CACHE_MEMBERS_MAX) : env.BOT_PRESENCE_MONITOR_ENABLED ? env.BOT_CACHE_PRESENCES_MAX : 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
    UserManager: env.BOT_CACHE_USERS_MAX,
    VoiceStateManager: needsVoiceRecorder || needsMusic || needsVoiceEvents ? 500 : 0
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

let destroyLavalinkIfLoaded: (() => void) | null = null;

if (needsMusic) {
  void import("./music/lavalinkManager.js")
    .then(({ destroyLavalink, initializeLavalink }) => {
      destroyLavalinkIfLoaded = destroyLavalink;
      initializeLavalink(client);
    })
    .catch((error) => {
      console.warn("[music:lavalink] falha ao carregar modulo:", error instanceof Error ? error.message : error);
    });
}

if (!env.DISCORD_BOT_TOKEN) {
  console.error("[bot] DISCORD_BOT_TOKEN nao configurado.");
  process.exit(1);
}

let loginStarted = false;
let shuttingDown = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let highMemorySamples = 0;

function scheduleReconnect(reason: string) {
  if (shuttingDown || reconnectTimer) {
    return;
  }

  loginStarted = false;
  const delay = Math.min(60_000, 2_000 * 2 ** Math.min(reconnectAttempts, 5));
  reconnectAttempts += 1;
  console.warn(`[bot] reconexao agendada em ${delay}ms: ${reason}`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startBot().catch((error) => {
      console.error("[bot] reconexao falhou:", error instanceof Error ? error.stack ?? error.message : error);
      scheduleReconnect("falha ao reconectar");
    });
  }, delay);
  reconnectTimer.unref();
}

async function startBot() {
  if (loginStarted) {
    console.warn("[bot] login ignorado: tentativa duplicada de inicializacao.");
    return;
  }

  loginStarted = true;
  await client.login(env.DISCORD_BOT_TOKEN);
  reconnectAttempts = 0;
}

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[bot] encerrando por ${signal}.`);
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const forceExit = setTimeout(() => process.exit(exitCode || 1), 15_000);
  forceExit.unref();
  void stopEventProcessing().finally(() => {
    try {
      context.socket.disconnect(client);
      destroyLavalinkIfLoaded?.();
      client.destroy();
    } catch (error) {
      console.error("[bot] falha durante encerramento:", error);
    }
    process.exit(exitCode);
  });
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({
    at: new Date().toISOString(),
    error: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
    level: "critical",
    service: "bot",
    type: "unhandledRejection"
  }));
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: error.stack ?? error.message, level: "critical", service: "bot", type: "uncaughtException" }));
  shutdown("uncaughtException", 1);
});

process.on("warning", (warning) => {
  console.warn(JSON.stringify({ at: new Date().toISOString(), error: warning.stack ?? warning.message, level: "warning", service: "bot", type: warning.name }));
});

const memoryMonitor = setInterval(() => {
  const memory = process.memoryUsage();
  const rssMb = memory.rss / 1024 / 1024;
  highMemorySamples = rssMb >= env.BOT_MEMORY_RESTART_MB ? highMemorySamples + 1 : 0;
  if (highMemorySamples >= 3) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "critical", rssMb: Math.round(rssMb), service: "bot", thresholdMb: env.BOT_MEMORY_RESTART_MB, type: "memory_limit" }));
    shutdown("memory limit", 1);
  }
}, 30_000);
memoryMonitor.unref();

startBot().catch((error) => {
  console.error("[bot] falha ao conectar:", error);
  scheduleReconnect("falha inicial de login");
});
