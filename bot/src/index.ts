import {
    Client,
    GatewayIntentBits,
    Options,
    Partials
} from "discord.js";
import { createCommandCollection } from "./commands";
import { env, isBotModuleEnabled } from "./config/env";
import { registerEvents, stopEventProcessing } from "./handlers/eventHandler";
import { ApiClient } from "./services/apiClient";
import { isLinkAntiSpamEnabled } from "./services/linkAntiSpamService";
import { registerMemoryPressureCleanup, startMemoryMonitor, stopMemoryMonitor } from "./services/memoryMonitor";
import { isSelfBotModuleEnabled } from "./services/safeBotService";
import type { BotContext } from "./types";
import { BotSocketClient } from "./websocket/socketClient";

const intents = [GatewayIntentBits.Guilds];
const managedRuntimeBot = Boolean(env.DASHBOARD_BOT_ID.trim());
const managedRuntimeDefaults = managedRuntimeBot && process.env.NEX_TECH_RUNTIME_ROLE !== "dev-bot-worker";
const needsVoiceRecorder = isBotModuleEnabled("voice-recorder");
const needsMusic = isBotModuleEnabled("music") || managedRuntimeDefaults;
const needsTagVerification = isBotModuleEnabled("tag-verification") || managedRuntimeDefaults;
const needsLivePresence = isBotModuleEnabled("live") || isBotModuleEnabled("auto-activity-clock") || managedRuntimeDefaults;
const needsVoiceEvents = managedRuntimeDefaults || isBotModuleEnabled("anti-abuse") || isBotModuleEnabled("anti-disconnect") || isBotModuleEnabled("temporary-voice") || isBotModuleEnabled("logs");
const needsAntiBan = isBotModuleEnabled("anti-ban") || managedRuntimeDefaults;
const needsMemberEvents = ["welcome", "leave", "roles", "logs", "fivem-absences", "fivem-hierarchy", "account-age-security", "anti-ban", "tag-verification"].some(isBotModuleEnabled)
  || isSelfBotModuleEnabled()
  || managedRuntimeDefaults;
const selfBotModuleEnabled = isSelfBotModuleEnabled();
const needsLegacyMessageModeration = !selfBotModuleEnabled && (isBotModuleEnabled("image-anti-spam") || isLinkAntiSpamEnabled());
const needsMessageLogs = managedRuntimeDefaults || isBotModuleEnabled("logs") || env.BOT_MESSAGE_LOGS_ENABLED;
const needsMessageEvents = needsLegacyMessageModeration
  || selfBotModuleEnabled
  || managedRuntimeDefaults
  || needsMusic
  || isBotModuleEnabled("manual-payments")
  || isBotModuleEnabled("fivem-ammunition")
  || isBotModuleEnabled("fivem-weapons")
  || isBotModuleEnabled("message-control")
  || isBotModuleEnabled("police-rank-up")
  || isBotModuleEnabled("visible-message")
  || isBotModuleEnabled("temporary-voice")
  || needsMessageLogs;

if (needsTagVerification || (env.BOT_MEMBER_EVENTS_ENABLED && needsMemberEvents) || managedRuntimeDefaults || isBotModuleEnabled("fivem-hierarchy")) {
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

if (needsLivePresence || needsTagVerification) {
  intents.push(GatewayIntentBits.GuildPresences);
}

if (needsVoiceRecorder || needsMusic || needsVoiceEvents) {
  intents.push(GatewayIntentBits.GuildVoiceStates);
}

const partials = [Partials.Channel, Partials.GuildMember, Partials.User];

if (needsMessageLogs || (!selfBotModuleEnabled && isBotModuleEnabled("image-anti-spam")) || managedRuntimeDefaults) {
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
    PresenceManager: needsTagVerification || needsLivePresence ? Math.max(env.BOT_CACHE_PRESENCES_MAX, env.BOT_CACHE_MEMBERS_MAX) : 0,
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
      console.warn("[music:lavalink] falha ao carregar módulo:", error instanceof Error ? error.message : error);
    });
}

if (!env.DISCORD_BOT_TOKEN) {
  console.error("[bot] DISCORD_BOT_TOKEN não configurado.");
  process.exit(1);
}

let loginStarted = false;
let shuttingDown = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

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
      stopMemoryMonitor();
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

function isIgnorableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message || "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code === "ECONNRESET"
    || /ECONNRESET/i.test(message)
    || /read ECONNRESET/i.test(message)
    || /socket hang up/i.test(message);
}

process.on("unhandledRejection", (reason) => {
  if (isIgnorableNetworkError(reason)) {
    console.warn(JSON.stringify({
      at: new Date().toISOString(),
      error: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
      level: "warning",
      service: "bot",
      type: "unhandledRejection",
      note: "ignored transient network error"
    }));
    return;
  }

  console.error(JSON.stringify({
    at: new Date().toISOString(),
    error: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
    level: "critical",
    note: "logged without shutdown to preserve bot availability",
    service: "bot",
    type: "unhandledRejection"
  }));
});

process.on("uncaughtException", (error) => {
  if (isIgnorableNetworkError(error)) {
    console.warn(JSON.stringify({
      at: new Date().toISOString(),
      error: error.stack ?? error.message,
      level: "warning",
      service: "bot",
      type: "uncaughtException",
      note: "ignored transient network error"
    }));
    return;
  }

  console.error(JSON.stringify({ at: new Date().toISOString(), error: error.stack ?? error.message, level: "critical", service: "bot", type: "uncaughtException" }));
  shutdown("uncaughtException", 1);
});

process.on("warning", (warning) => {
  console.warn(JSON.stringify({ at: new Date().toISOString(), error: warning.stack ?? warning.message, level: "warning", service: "bot", type: warning.name }));
});

registerMemoryPressureCleanup((sample) => {
  if (sample.status !== "critical" && sample.status !== "emergency") return;
  const before = context.liveCache.size;
  context.liveCache.clear();
  if (before > 0) {
    console.warn(JSON.stringify({ at: new Date().toISOString(), before, level: "warning", service: "bot", type: "memory_cleanup", target: "liveCache" }));
  }
});

startMemoryMonitor({
  criticalRssMb: env.BOT_MEMORY_RESTART_MB,
  onCritical: (sample) => {
    console.error(JSON.stringify({ at: sample.timestamp, level: "critical", rssMb: sample.rssMb, service: "bot", thresholdMb: env.BOT_MEMORY_RESTART_MB, type: "memory_limit" }));
    shutdown("memory limit", 1);
  }
});

startBot().catch((error) => {
  console.error("[bot] falha ao conectar:", error);
  if (isInvalidTokenError(error)) {
    console.error("[bot] token inválido; encerrando sem reconexao automática.");
    process.exit(0);
  }
  scheduleReconnect("falha inicial de login");
});

function isInvalidTokenError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";

  return /tokeninvalid|invalid token|token was provided/i.test(`${code} ${message}`);
}
