import axios from "axios";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { env } from "../config/env";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { sendDevBotUnexpectedExitLog } from "./devBotDiscordLogService";
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
const MODULES_REQUIRING_MEMBER_EVENTS = ["welcome", "leave", "roles", "logs", "fivem-absences", "fivem-fac", "account-age-security", "safe-bot", "moderation"];
const MODULES_REQUIRING_MESSAGE_CONTENT = ["moderation", "safe-bot", "link-anti-spam", "image-anti-spam", "temporary-voice"];
const DEV_BOT_START_CONCURRENCY = 2;
const DEV_BOT_START_STAGGER_MS = 3_000;
const DEV_BOT_RESTART_DELAY_MS = 30_000;
const DEV_BOT_SUPERVISOR_LEASE_ID = "dev-bot-runtime-supervisor";
const DEV_BOT_SUPERVISOR_LEASE_MS = 30_000;
const DEV_BOT_SUPERVISOR_START_RETRY_MS = 6_000;
const DEV_BOT_SUPERVISOR_START_ATTEMPTS = 7;
const DEV_BOT_SUPERVISOR_INSTANCE_ID = `dev-bot-supervisor:${process.pid}:${randomUUID()}`;
const runningBots = new Map<string, RunningBot>();
const restartTimers = new Map<string, NodeJS.Timeout>();
let supervisorLeaseTimer: NodeJS.Timeout | null = null;
let supervisorLeaseHeld = false;
let supervisorLeaseErrors = 0;

export async function startRegisteredDevBots() {
  if (!(await waitForDevBotSupervisorLease())) {
    console.warn("[dev-bot] outro supervisor manteve a trava distribuida; bots cadastrados nao serao iniciados nesta instancia.");
    return 0;
  }

  const bots = await listDevBotRuntimeConfigs().catch((error) => {
    console.warn("[dev-bot] nao foi possivel carregar bots cadastrados:", error instanceof Error ? error.message : error);
    return [];
  });

  console.log(`[dev-bot] iniciando ${bots.length} bot(s) cadastrado(s) automaticamente.`);
  const enabledBots = bots.filter((bot) => bot.desiredOnline);
  console.log(`[dev-bot] ${bots.length - enabledBots.length} bot(s) permanecerao desligados por bloqueio persistente.`);
  await startDevBotRuntimeBatch(enabledBots);
  return enabledBots.length;
}

async function waitForDevBotSupervisorLease() {
  for (let attempt = 1; attempt <= DEV_BOT_SUPERVISOR_START_ATTEMPTS; attempt += 1) {
    if (await ensureDevBotSupervisorLease()) return true;
    if (attempt === DEV_BOT_SUPERVISOR_START_ATTEMPTS) break;

    console.warn(`[dev-bot] trava de supervisor ainda pertence a instancia anterior; nova tentativa em ${DEV_BOT_SUPERVISOR_START_RETRY_MS / 1_000}s (${attempt}/${DEV_BOT_SUPERVISOR_START_ATTEMPTS}).`);
    await delay(DEV_BOT_SUPERVISOR_START_RETRY_MS);
  }

  return false;
}

export async function startAllDevBotProcesses(botIds: string[]) {
  if (!(await ensureDevBotSupervisorLease())) {
    throw new Error("Outra instancia e responsavel por executar os bots cadastrados.");
  }

  const bots = (await Promise.all(botIds.map((botId) => getDevBotRuntimeConfig(botId))))
    .filter((bot): bot is DevBotRuntimeConfig => Boolean(bot?.desiredOnline));

  await startDevBotRuntimeBatch(bots);
}

export async function stopSelectedDevBotProcesses(botIds: string[], options: StopDevBotOptions = {}) {
  await Promise.allSettled(botIds.map((botId) => stopDevBotProcess(botId, {
    message: options.message ?? "Bot desligado pelo controle geral DEV.",
    notifyBot: options.notifyBot ?? true
  })));
}

export async function startDevBotProcess(botId: string) {
  if (!(await ensureDevBotSupervisorLease())) {
    console.warn(`[dev-bot:${botId}] inicio ignorado porque outra instancia possui a trava de supervisor.`);
    return null;
  }

  const bot = await getDevBotRuntimeConfig(botId);

  if (!bot) {
    return null;
  }

  if (!bot.desiredOnline) {
    await updateDevBotRuntimeStatus(botId, "offline", "Bot mantido desligado pelo controle persistente DEV.");
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
  await releaseDevBotSupervisorLease();
}

async function ensureDevBotSupervisorLease() {
  if (supervisorLeaseHeld) return true;

  const acquired = await acquireDevBotSupervisorLease();
  if (!acquired) return false;

  supervisorLeaseHeld = true;
  supervisorLeaseErrors = 0;
  startDevBotSupervisorLeaseRenewal();
  console.info(`[dev-bot] trava distribuida de supervisor adquirida por ${DEV_BOT_SUPERVISOR_INSTANCE_ID}.`);
  return true;
}

async function acquireDevBotSupervisorLease() {
  const { serviceHeartbeats } = await getMongoCollections();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEV_BOT_SUPERVISOR_LEASE_MS);

  try {
    const lease = await serviceHeartbeats.findOneAndUpdate(
      {
        _id: DEV_BOT_SUPERVISOR_LEASE_ID,
        $or: [
          { expiresAt: { $lte: now } },
          { instanceId: DEV_BOT_SUPERVISOR_INSTANCE_ID }
        ]
      },
      {
        $set: {
          expiresAt,
          instanceId: DEV_BOT_SUPERVISOR_INSTANCE_ID,
          metadata: { pid: process.pid },
          service: "dev-bot-supervisor",
          updatedAt: now
        },
        $setOnInsert: { startedAt: now }
      },
      { returnDocument: "after", upsert: true }
    );
    return lease?.instanceId === DEV_BOT_SUPERVISOR_INSTANCE_ID;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    console.error("[dev-bot] falha ao adquirir trava distribuida de supervisor:", readRuntimeError(error));
    return false;
  }
}

function startDevBotSupervisorLeaseRenewal() {
  if (supervisorLeaseTimer) clearInterval(supervisorLeaseTimer);
  supervisorLeaseTimer = setInterval(() => void renewDevBotSupervisorLease(), Math.floor(DEV_BOT_SUPERVISOR_LEASE_MS / 3));
  supervisorLeaseTimer.unref();
}

async function renewDevBotSupervisorLease() {
  if (!supervisorLeaseHeld) return;
  const now = new Date();

  try {
    const { serviceHeartbeats } = await getMongoCollections();
    const result = await serviceHeartbeats.updateOne(
      { _id: DEV_BOT_SUPERVISOR_LEASE_ID, instanceId: DEV_BOT_SUPERVISOR_INSTANCE_ID },
      {
        $set: {
          expiresAt: new Date(now.getTime() + DEV_BOT_SUPERVISOR_LEASE_MS),
          metadata: { pid: process.pid, runningBots: runningBots.size },
          updatedAt: now
        }
      }
    );

    supervisorLeaseErrors = 0;
    if (result.matchedCount === 0) {
      await handleLostDevBotSupervisorLease("a posse da trava foi transferida para outra instancia");
    }
  } catch (error) {
    supervisorLeaseErrors += 1;
    console.error("[dev-bot] falha ao renovar trava distribuida de supervisor:", readRuntimeError(error));
    if (supervisorLeaseErrors >= 2) {
      await handleLostDevBotSupervisorLease("a trava nao pode ser renovada antes da expiracao");
    }
  }
}

async function handleLostDevBotSupervisorLease(reason: string) {
  if (!supervisorLeaseHeld) return;
  supervisorLeaseHeld = false;
  if (supervisorLeaseTimer) clearInterval(supervisorLeaseTimer);
  supervisorLeaseTimer = null;
  console.error(`[dev-bot] supervisor desativado: ${reason}. Encerrando bots filhos para impedir processos duplicados.`);
  await Promise.all([...runningBots.keys()].map((botId) => stopDevBotProcess(botId, {
    message: "Processo encerrado porque esta instancia perdeu a trava de supervisor.",
    notifyBot: false
  })));
}

async function releaseDevBotSupervisorLease() {
  if (supervisorLeaseTimer) clearInterval(supervisorLeaseTimer);
  supervisorLeaseTimer = null;
  const held = supervisorLeaseHeld;
  supervisorLeaseHeld = false;
  if (!held) return;

  const { serviceHeartbeats } = await getMongoCollections();
  await serviceHeartbeats.deleteOne({
    _id: DEV_BOT_SUPERVISOR_LEASE_ID,
    instanceId: DEV_BOT_SUPERVISOR_INSTANCE_ID
  }).catch((error) => {
    console.warn("[dev-bot] nao foi possivel liberar trava de supervisor:", readRuntimeError(error));
  });
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

function readRuntimeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function startRuntime(bot: DevBotRuntimeConfig) {
  if (!bot.desiredOnline) {
    await updateDevBotRuntimeStatus(bot.id, "offline", "Bot mantido desligado pelo controle persistente DEV.");
    return;
  }
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
      "Ative o Message Content Intent no Discord Developer Portal para usar os modulos que leem mensagens."
    );
    return;
  }

  const memberEventsEnabled = await canUseGuildMemberIntent(bot);
  const backendRuntimeUrl = `http://127.0.0.1:${env.PORT}`;

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
      BACKEND_API_URL: `${backendRuntimeUrl}/api`,
      BACKEND_SOCKET_URL: backendRuntimeUrl,
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
    const status = code === 0 ? "offline" : "error";
    void updateDevBotRuntimeStatus(bot.id, status, exitMessage);
    void sendDevBotUnexpectedExitLog({
      botId: bot.id,
      botName: bot.name,
      clientId: bot.clientId,
      detail,
      message: exitMessage,
      status
    });

    const timer = setTimeout(() => {
      restartTimers.delete(bot.id);
      void startDevBotProcess(bot.id);
    }, restartDelayMs(bot.id));

    timer.unref();
    restartTimers.set(bot.id, timer);
  });
}

function restartDelayMs(botId: string) {
  const jitter = Number.parseInt(botId.replace(/\D/g, "").slice(-4), 10);
  return DEV_BOT_RESTART_DELAY_MS + (Number.isFinite(jitter) ? jitter % 15_000 : 0);
}

async function startDevBotRuntimeBatch(bots: DevBotRuntimeConfig[]) {
  for (let index = 0; index < bots.length; index += DEV_BOT_START_CONCURRENCY) {
    const batch = bots.slice(index, index + DEV_BOT_START_CONCURRENCY);
    await Promise.allSettled(batch.map((bot) => startRuntime(bot)));

    if (index + DEV_BOT_START_CONCURRENCY < bots.length) {
      await delay(DEV_BOT_START_STAGGER_MS);
    }
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function canUseGuildMemberIntent(bot: DevBotRuntimeConfig) {
  const needsMemberEvents = hasEnabledModule(bot, MODULES_REQUIRING_MEMBER_EVENTS);

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
  if (!hasEnabledModule(bot, MODULES_REQUIRING_MESSAGE_CONTENT)) {
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

function hasEnabledModule(bot: DevBotRuntimeConfig, moduleIds: string[]) {
  return moduleIds.some((moduleId) => bot.enabledModules.includes(moduleId));
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
