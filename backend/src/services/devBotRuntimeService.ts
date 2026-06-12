import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import axios from "axios";
import { env } from "../config/env";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import {
  getDevBotRuntimeConfig,
  listDevBotRuntimeConfigs,
  updateDevBotRuntimeStatus,
  type DevBotRuntimeConfig
} from "./devBotService";

type RunningBot = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  lastError: string | null;
  stopping: boolean;
};

type DiscordApplication = {
  flags?: number;
};

type StopDevBotOptions = {
  message?: string;
  notifyBot?: boolean;
};

const DISCORD_API = "https://discord.com/api/v10";
const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;
const GATEWAY_MESSAGE_CONTENT = 1 << 18;
const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;
const runningBots = new Map<string, RunningBot>();
const restartTimers = new Map<string, NodeJS.Timeout>();

export async function startRegisteredDevBots() {
  const bots = await listDevBotRuntimeConfigs().catch((error) => {
    console.warn("[dev-bot] nao foi possivel carregar bots cadastrados:", error instanceof Error ? error.message : error);
    return [];
  });

  await Promise.allSettled(bots.map((bot) => startRuntime(bot)));
}

export async function startDevBotProcess(botId: string) {
  const bot = await getDevBotRuntimeConfig(botId);

  if (!bot) {
    return null;
  }

  await stopDevBotProcess(botId, {
    message: "Reiniciando processo do bot.",
    notifyBot: false
  });
  await startRuntime(bot);
  return bot;
}

export async function restartDevBotProcess(botId: string) {
  return startDevBotProcess(botId);
}

export async function stopDevBotProcess(botId: string, options: StopDevBotOptions = {}) {
  const timer = restartTimers.get(botId);
  const statusMessage = options.message ?? "Bot desligado pelo painel DEV.";
  const notifyBot = options.notifyBot === true;

  if (timer) {
    clearTimeout(timer);
    restartTimers.delete(botId);
  }

  const runtime = runningBots.get(botId);
  const status = await updateDevBotRuntimeStatus(botId, "offline", statusMessage);

  if (notifyBot) {
    emitRealtimeToRoom(devBotRealtimeRoom(botId), "bot:shutdown", {
      botId
    });
  }

  if (!runtime) {
    return status;
  }

  runtime.stopping = true;
  runningBots.delete(botId);

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };

    runtime.child.once("exit", finish);

    if (!runtime.child.kill("SIGTERM")) {
      finish();
    }
  });

  return status;
}

export async function stopAllDevBotProcesses() {
  await Promise.all([...runningBots.keys()].map((botId) => stopDevBotProcess(botId, {
    message: "Backend encerrando processo do bot.",
    notifyBot: false
  })));
}

async function startRuntime(bot: DevBotRuntimeConfig) {
  if (bot.token === env.DISCORD_BOT_TOKEN) {
    await updateDevBotRuntimeStatus(bot.id, "online", "Executado pelo processo principal.");
    return;
  }

  const entry = path.resolve(__dirname, "../../../bot/dist/index.js");

  if (!existsSync(entry)) {
    await updateDevBotRuntimeStatus(bot.id, "error", "Build do bot nao encontrado. Execute o build da aplicacao.");
    return;
  }

  await updateDevBotRuntimeStatus(bot.id, "offline", "Iniciando processo do bot.");
  const messageContentEnabled = await canUseMessageContentIntent(bot);

  if (!messageContentEnabled) {
    await updateDevBotRuntimeStatus(
      bot.id,
      "error",
      "Ative o Message Content Intent no Discord Developer Portal para usar o Anti-Spam de Imagens."
    );
    return;
  }

  const memberEventsEnabled = await canUseGuildMemberIntent(bot);

  const child = spawn(process.execPath, [entry], {
    cwd: path.resolve(__dirname, "../../.."),
    env: {
      ...process.env,
      NODE_ENV: env.NODE_ENV,
      DISCORD_BOT_TOKEN: bot.token,
      DASHBOARD_BOT_ID: bot.id,
      BOT_MAIN_GUILD_ID: bot.mainGuildId,
      BOT_COMMAND_GUILD_IDS: bot.guildIds.join(","),
      BOT_ENABLED_MODULES: bot.enabledModules.join(","),
      BOT_MEMBER_EVENTS_ENABLED: String(memberEventsEnabled),
      BACKEND_API_URL: process.env.BACKEND_API_URL || `${env.FRONTEND_URL}/api`,
      BACKEND_SOCKET_URL: process.env.BACKEND_SOCKET_URL || env.FRONTEND_URL,
      BOT_API_TOKEN: env.BOT_API_TOKEN
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const runtime: RunningBot = {
    child,
    lastError: null,
    stopping: false
  };

  runningBots.set(bot.id, runtime);
  child.stdout.on("data", (chunk) => {
    const message = writeBotLog(bot.id, chunk);

    if (message.includes("[bot] conectado como")) {
      void updateDevBotRuntimeStatus(bot.id, "online", "Bot conectado ao Discord.");
    }
  });
  child.stderr.on("data", (chunk) => {
    const message = writeBotLog(bot.id, chunk, true);
    const runtimeError = botRuntimeError(message);

    if (runtimeError) {
      runtime.lastError = runtimeError.message;
      void updateDevBotRuntimeStatus(bot.id, runtimeError.status, runtimeError.message);
    }
  });
  child.on("error", (error) => {
    runtime.lastError = `Falha ao iniciar processo: ${error.message}`;
    void updateDevBotRuntimeStatus(bot.id, "error", `Falha ao iniciar processo: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    const current = runningBots.get(bot.id);

    if (current?.child === child) {
      runningBots.delete(bot.id);
    }

    if (runtime.stopping) {
      return;
    }

    const detail = signal ? `sinal ${signal}` : `codigo ${code ?? 0}`;
    const exitMessage = runtime.lastError ?? `Processo encerrado com ${detail}.`;
    void updateDevBotRuntimeStatus(bot.id, code === 0 ? "offline" : "error", exitMessage);

    const timer = setTimeout(() => {
      restartTimers.delete(bot.id);
      void startDevBotProcess(bot.id);
    }, 10_000);

    timer.unref();
    restartTimers.set(bot.id, timer);
  });
}

async function canUseGuildMemberIntent(bot: DevBotRuntimeConfig) {
  const needsMemberEvents = ["welcome", "leave", "roles", "logs", "fivem-fac"].some((moduleId) => bot.enabledModules.includes(moduleId));

  if (!needsMemberEvents) {
    return false;
  }

  try {
    const { data } = await axios.get<DiscordApplication>(`${DISCORD_API}/oauth2/applications/@me`, {
      headers: {
        Authorization: `Bot ${bot.token}`
      },
      timeout: 5_000
    });
    const flags = data.flags ?? 0;
    const enabled = Boolean(flags & (GATEWAY_GUILD_MEMBERS | GATEWAY_GUILD_MEMBERS_LIMITED));

    if (!enabled) {
      console.warn(
        `[dev-bot:${bot.id}] Server Members Intent nao esta ativo no Discord; eventos de membros serao ignorados.`
      );
    }

    return enabled;
  } catch (error) {
    console.warn(
      `[dev-bot:${bot.id}] nao foi possivel consultar intents do Discord; iniciando sem eventos de membros:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

async function canUseMessageContentIntent(bot: DevBotRuntimeConfig) {
  if (!bot.enabledModules.includes("image-anti-spam")) {
    return true;
  }

  try {
    const { data } = await axios.get<DiscordApplication>(`${DISCORD_API}/oauth2/applications/@me`, {
      headers: {
        Authorization: `Bot ${bot.token}`
      },
      timeout: 5_000
    });
    const flags = data.flags ?? 0;
    return Boolean(flags & (GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED));
  } catch (error) {
    console.warn(
      `[dev-bot:${bot.id}] nao foi possivel consultar o Message Content Intent:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

function botRuntimeError(message: string) {
  if (/invalid token|tokeninvalid|token was provided/i.test(message)) {
    return {
      status: "invalid_token" as const,
      message: "O Discord recusou o token durante a inicializacao."
    };
  }

  if (/disallowed intents/i.test(message)) {
    return {
      status: "error" as const,
      message: "O bot tentou usar intents nao ativadas no Discord Developer Portal."
    };
  }

  return null;
}

function writeBotLog(botId: string, chunk: Buffer, isError = false) {
  const message = chunk.toString("utf8").trim();

  if (!message) {
    return "";
  }

  const writer = isError ? console.error : console.log;
  writer(`[dev-bot:${botId}] ${message}`);
  return message;
}
