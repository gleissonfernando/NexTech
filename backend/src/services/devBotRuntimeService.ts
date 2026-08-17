import axios from "axios";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { env } from "../config/env";
import type { MongoDevBotStatus } from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { resolveDevBotUnexpectedExitLog, sendDevBotUnexpectedExitLog } from "./devBotDiscordLogService";
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

type DiscordApplicationCommand = {
  id: string;
  name: string;
};

type StopDevBotOptions = {
  finalStatus?: MongoDevBotStatus;
  message?: string;
  notifyBot?: boolean;
};

const DISCORD_API = "https://discord.com/api/v10";
const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;
const GATEWAY_MESSAGE_CONTENT = 1 << 18;
const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;
const MODULES_REQUIRING_MEMBER_EVENTS = ["welcome", "leave", "roles", "logs", "fivem-absences", "account-age-security", "safe-bot", "moderation"];
const MODULES_REQUIRING_MESSAGE_CONTENT = ["moderation", "safe-bot", "link-anti-spam", "image-anti-spam", "temporary-voice"];
const OBSOLETE_DEV_BOT_COMMAND_NAMES = new Set(["encomendas"]);
const DEV_BOT_START_CONCURRENCY = env.DEV_BOT_START_CONCURRENCY ?? (env.NODE_ENV === "production" ? 1 : 3);
const DEV_BOT_NODE_MAX_OLD_SPACE_MB = env.DEV_BOT_NODE_MAX_OLD_SPACE_MB ?? 128;
const DEV_BOT_START_STAGGER_MS = env.DEV_BOT_START_STAGGER_MS ?? (env.NODE_ENV === "production" ? 10_000 : 2_000);
const DEV_BOT_RESTART_DELAY_MS = 30_000;
const DEV_BOT_SUPERVISOR_LEASE_ID = "dev-bot-runtime-supervisor";
const DEV_BOT_SUPERVISOR_LEASE_MS = 60_000;
const DEV_BOT_SUPERVISOR_START_RETRY_MS = 3_000;
const DEV_BOT_SUPERVISOR_START_ATTEMPTS = Math.ceil(DEV_BOT_SUPERVISOR_LEASE_MS / DEV_BOT_SUPERVISOR_START_RETRY_MS) + 5;
const DEV_BOT_SUPERVISOR_INSTANCE_ID = `dev-bot-supervisor:${process.pid}:${randomUUID()}`;
const runningBots = new Map<string, RunningBot>();
const restartTimers = new Map<string, NodeJS.Timeout>();
const restartAttempts = new Map<string, { attempts: number; firstFailureAt: number }>();
const moduleRestartTimers = new Map<string, NodeJS.Timeout>();
let supervisorLeaseTimer: NodeJS.Timeout | null = null;
let supervisorLeaseHeld = false;
let supervisorLeaseLocalOnly = false;
let supervisorLeaseErrors = 0;

export async function startRegisteredDevBots() {
  if (!(await waitForDevBotSupervisorLease())) {
    console.warn("[dev-bot] outro supervisor manteve a trava distribuida; bots cadastrados não serão iniciados nesta instância.");
    return 0;
  }

  const bots = await listDevBotRuntimeConfigs().catch((error) => {
    console.warn("[dev-bot] não foi possível carregar bots cadastrados:", error instanceof Error ? error.message : error);
    return [];
  });

  console.log(`[dev-bot] iniciando ${bots.length} bot(s) cadastrado(s) automaticamente.`);
  const enabledBots = bots.filter((bot) => bot.desiredOnline);
  console.log(`[dev-bot] ${bots.length - enabledBots.length} bot(s) permanecerao desligados por bloqueio persistente.`);
  await startDevBotRuntimeBatch(enabledBots);
  return enabledBots.length;
}

export async function cleanupObsoleteDevBotCommands() {
  const bots = await listDevBotRuntimeConfigsWithRetry();
  let checkedScopes = 0;
  let removedCommands = 0;

  for (const bot of bots) {
    const guildIds = [...new Set([bot.mainGuildId, ...bot.guildIds].filter(Boolean))];
    const scopes = [
      { guildId: null, label: "global" },
      ...guildIds.map((guildId) => ({ guildId, label: `guild:${guildId}` }))
    ];

    for (const scope of scopes) {
      try {
        const commands = await listDiscordApplicationCommands(bot, scope.guildId);
        checkedScopes += 1;
        const obsoleteCommands = commands.filter((command) => OBSOLETE_DEV_BOT_COMMAND_NAMES.has(command.name));

        for (const command of obsoleteCommands) {
          await deleteDiscordApplicationCommand(bot, command.id, scope.guildId);
          removedCommands += 1;
          console.log(`[dev-bot] comando obsoleto /${command.name} removido de ${bot.id} (${scope.label}).`);
        }
      } catch (error) {
        console.warn(`[dev-bot] falha ao limpar comandos obsoletos de ${bot.id} (${scope.label}):`, readRuntimeError(error));
      }
    }
  }

  console.log(`[dev-bot] limpeza de comandos obsoletos concluída: scopes=${checkedScopes}, removidos=${removedCommands}.`);
  return { checkedScopes, removedCommands };
}

async function listDevBotRuntimeConfigsWithRetry() {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await listDevBotRuntimeConfigs();
    } catch (error) {
      lastError = error;
      console.warn(
        `[dev-bot] não foi possível carregar bots para limpar comandos obsoletos (${attempt}/8):`,
        readRuntimeError(error)
      );
      await delay(10_000);
    }
  }

  console.warn("[dev-bot] limpeza de comandos obsoletos ignorada:", readRuntimeError(lastError));
  return [];
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
  if (!(await waitForDevBotSupervisorLease())) {
    throw new Error("Outra instancia e responsável por executar os bots cadastrados.");
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

export function scheduleDevBotModuleRestart(botId: string, delayMs = 2_000) {
  const pending = moduleRestartTimers.get(botId);
  if (pending) clearTimeout(pending);

  const timer = setTimeout(() => {
    moduleRestartTimers.delete(botId);
    void restartDevBotProcess(botId).catch((error) => {
      console.warn(`[dev-bot:${botId}] falha ao aplicar modulos após debounce:`, error instanceof Error ? error.message : error);
    });
  }, delayMs);

  timer.unref();
  moduleRestartTimers.set(botId, timer);
}

export async function stopDevBotProcess(botId: string, options: StopDevBotOptions = {}) {
  const timer = restartTimers.get(botId);
  const moduleTimer = moduleRestartTimers.get(botId);
  const statusMessage = options.message ?? "Bot desligado pelo painel DEV.";
  const notifyBot = options.notifyBot === true;

  if (timer) {
    clearTimeout(timer);
    restartTimers.delete(botId);
  }
  if (moduleTimer) {
    clearTimeout(moduleTimer);
    moduleRestartTimers.delete(botId);
  }

  const runtime = runningBots.get(botId);
  const finalStatus = options.finalStatus ?? "offline";
  const status = await updateDevBotRuntimeStatus(botId, runtime ? "stopping" : finalStatus, statusMessage);

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

  return await updateDevBotRuntimeStatus(botId, finalStatus, statusMessage);
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
  if (!supervisorLeaseLocalOnly) {
    startDevBotSupervisorLeaseRenewal();
    console.info(`[dev-bot] trava distribuida de supervisor adquirida por ${DEV_BOT_SUPERVISOR_INSTANCE_ID}.`);
  } else {
    console.warn("[dev-bot] MongoDB bloqueou escritas; usando supervisor local para iniciar bots cadastrados nesta instância.");
  }
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
    if (isMongoWriteBlockedError(error)) {
      supervisorLeaseLocalOnly = true;
      return true;
    }
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
  if (supervisorLeaseLocalOnly) return;
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

    if (result.matchedCount === 0) {
      if (await reacquireDevBotSupervisorLease("a renovacao nao encontrou a trava atual")) {
        return;
      }

      await handleLostDevBotSupervisorLease("a posse da trava foi transferida para outra instancia");
      return;
    }

    supervisorLeaseErrors = 0;
  } catch (error) {
    supervisorLeaseErrors += 1;
    console.warn("[dev-bot] falha ao renovar trava distribuida de supervisor; mantendo bots ativos enquanto a posse não for perdida:", readRuntimeError(error));

    if (isMongoWriteBlockedError(error)) {
      supervisorLeaseLocalOnly = true;
      supervisorLeaseErrors = 0;
      console.warn("[dev-bot] MongoDB bloqueou escritas durante renovacao; supervisor local manterá os bots ativos nesta instância.");
      return;
    }
  }
}

async function reacquireDevBotSupervisorLease(reason: string) {
  supervisorLeaseHeld = false;
  supervisorLeaseErrors = 0;
  const acquired = await acquireDevBotSupervisorLease();

  if (!acquired) {
    return false;
  }

  supervisorLeaseHeld = true;
  console.warn(`[dev-bot] trava distribuida de supervisor recuperada após ${reason}.`);
  return true;
}

async function handleLostDevBotSupervisorLease(reason: string) {
  if (!supervisorLeaseHeld) return;
  supervisorLeaseHeld = false;
  if (supervisorLeaseTimer) clearInterval(supervisorLeaseTimer);
  supervisorLeaseTimer = null;
  console.error(`[dev-bot] supervisor desativado: ${reason}. Encerrando bots filhos para impedir processos duplicados.`);
  await Promise.all([...runningBots.keys()].map((botId) => stopDevBotProcess(botId, {
    message: "Processo encerrado porque esta instância perdeu a trava de supervisor.",
    notifyBot: false
  })));
}

async function releaseDevBotSupervisorLease() {
  if (supervisorLeaseTimer) clearInterval(supervisorLeaseTimer);
  supervisorLeaseTimer = null;
  const held = supervisorLeaseHeld;
  supervisorLeaseHeld = false;
  const localOnly = supervisorLeaseLocalOnly;
  supervisorLeaseLocalOnly = false;
  if (!held) return;
  if (localOnly) return;

  const { serviceHeartbeats } = await getMongoCollections();
  await serviceHeartbeats.deleteOne({
    _id: DEV_BOT_SUPERVISOR_LEASE_ID,
    instanceId: DEV_BOT_SUPERVISOR_INSTANCE_ID
  }).catch((error) => {
    console.warn("[dev-bot] não foi possível liberar trava de supervisor:", readRuntimeError(error));
  });
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

function isMongoWriteBlockedError(error: unknown) {
  const message = readRuntimeError(error).toLowerCase();
  return message.includes("over your space quota") || message.includes("writes are blocked");
}

function readRuntimeError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return discordRuntimeRequestError(error);
  }

  return error instanceof Error ? error.message : String(error);
}

async function startRuntime(bot: DevBotRuntimeConfig) {
  if (!bot.desiredOnline) {
    await updateDevBotRuntimeStatus(bot.id, "offline", "Bot mantido desligado pelo controle persistente DEV.");
    return;
  }
  if (bot.token === env.DISCORD_BOT_TOKEN) {
    await updateDevBotRuntimeStatus(bot.id, "ready", "Executado pelo processo principal.");
    return;
  }

  const entry = path.resolve(__dirname, "../../../bot/dist/index.js");

  if (!existsSync(entry)) {
    await updateDevBotRuntimeStatus(bot.id, "error", "Build do bot não encontrado. Execute o build da aplicacao.");
    return;
  }

  await updateDevBotRuntimeStatus(bot.id, "starting", "Iniciando processo do bot.");
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

  await updateDevBotRuntimeStatus(bot.id, "authenticating", "Processo iniciado; autenticando no Discord.");
  const child = spawn(process.execPath, [entry], {
    cwd: path.resolve(__dirname, "../../.."),
    env: {
      ...process.env,
      NODE_ENV: env.NODE_ENV,
      DISCORD_BOT_TOKEN: bot.token,
      DASHBOARD_BOT_ID: bot.id,
      ...(bot.databaseName ? { BOT_DATABASE_NAME: bot.databaseName } : {}),
      BOT_MAIN_GUILD_ID: bot.mainGuildId,
      BOT_COMMAND_GUILD_IDS: bot.guildIds.join(","),
      BOT_ENABLED_MODULES: bot.enabledModules.join(","),
      BOT_MEMBER_EVENTS_ENABLED: String(memberEventsEnabled),
      NODE_OPTIONS: nodeOptionsWithMaxOldSpace(process.env.NODE_OPTIONS, DEV_BOT_NODE_MAX_OLD_SPACE_MB),
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
  child.stdout.on("data", (chunk: Buffer) => {
    const message = writeBotLog(bot.id, chunk);

    if (message.includes("[bot] conectado como")) {
      void updateDevBotRuntimeStatus(bot.id, "syncing_config", "Bot conectado ao Discord; sincronizando comandos e configurações.");
    } else if (/comandos sincronizados/i.test(message)) {
      restartAttempts.delete(bot.id);
      void updateDevBotRuntimeStatus(bot.id, "ready", "Bot pronto; comandos sincronizados no Discord.");
      void resolveDevBotUnexpectedExitLog({
        botId: bot.id,
        botName: bot.name,
        clientId: bot.clientId,
        message: "O bot voltou a ficar pronto; comandos sincronizados no Discord. Este canal temporario sera removido automaticamente."
      });
    } else if (/MongoDB bloqueou|over your space quota|writes are blocked/i.test(message)) {
      void updateDevBotRuntimeStatus(bot.id, "degraded", "Bot online, mas o banco está bloqueando escritas por limite de armazenamento.");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const message = writeBotLog(bot.id, chunk, true);
    const runtimeError = botRuntimeError(message);

    if (runtimeError) {
      runtime.lastError = runtimeError.message;
      void updateDevBotRuntimeStatus(bot.id, runtimeError.status, runtimeError.message);
    }
  });
  child.on("error", (error: Error) => {
    runtime.lastError = `Falha ao iniciar processo: ${error.message}`;
    void updateDevBotRuntimeStatus(bot.id, "error", `Falha ao iniciar processo: ${error.message}`);
  });
  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    const current = runningBots.get(bot.id);

    if (current?.child === child) {
      runningBots.delete(bot.id);
    }

    if (runtime.stopping) {
      return;
    }

    const detail = signal ? `sinal ${signal}` : `codigo ${code ?? 0}`;
    const exitMessage = runtime.lastError ?? `Processo encerrado com ${detail}.`;
    const invalidToken = /token inv.lido|discord recusou o token/i.test(exitMessage);
    const status: MongoDevBotStatus = invalidToken ? "invalid_token" : code === 0 ? "offline" : "crashed";
    void updateDevBotRuntimeStatus(bot.id, status, exitMessage);
    void sendDevBotUnexpectedExitLog({
      botId: bot.id,
      botName: bot.name,
      clientId: bot.clientId,
      detail,
      message: exitMessage,
      status: status === "crashed" ? "error" : status
    });

    if (invalidToken) {
      return;
    }

    const delayMs = restartDelayMs(bot.id);
    void updateDevBotRuntimeStatus(
      bot.id,
      "waiting_retry",
      `Processo caiu com ${detail}; nova tentativa automática em ${Math.round(delayMs / 1000)}s.`
    );

    const timer = setTimeout(() => {
      restartTimers.delete(bot.id);
      void startDevBotProcess(bot.id);
    }, delayMs);

    timer.unref();
    restartTimers.set(bot.id, timer);
  });
}

function restartDelayMs(botId: string) {
  const now = Date.now();
  const current = restartAttempts.get(botId);
  const windowMs = 30 * 60_000;
  const next = current && now - current.firstFailureAt <= windowMs
    ? { attempts: current.attempts + 1, firstFailureAt: current.firstFailureAt }
    : { attempts: 1, firstFailureAt: now };
  restartAttempts.set(botId, next);
  const jitter = Number.parseInt(botId.replace(/\D/g, "").slice(-4), 10);
  const backoff = Math.min(10 * 60_000, DEV_BOT_RESTART_DELAY_MS * 2 ** Math.max(0, next.attempts - 1));
  return backoff + (Number.isFinite(jitter) ? jitter % 15_000 : 0);
}

function nodeOptionsWithMaxOldSpace(current: string | undefined, maxOldSpaceMb: number) {
  const options = (current ?? "")
    .split(/\s+/)
    .map((option) => option.trim())
    .filter(Boolean)
    .filter((option) => !option.startsWith("--max-old-space-size"));

  options.push(`--max-old-space-size=${maxOldSpaceMb}`);
  return options.join(" ");
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

async function listDiscordApplicationCommands(bot: DevBotRuntimeConfig, guildId: string | null) {
  const endpoint = guildId
    ? `${DISCORD_API}/applications/${bot.clientId}/guilds/${guildId}/commands`
    : `${DISCORD_API}/applications/${bot.clientId}/commands`;
  const { data } = await axios.get<DiscordApplicationCommand[]>(endpoint, {
    headers: {
      Authorization: `Bot ${bot.token}`
    },
    timeout: 10_000
  });
  return data;
}

async function deleteDiscordApplicationCommand(bot: DevBotRuntimeConfig, commandId: string, guildId: string | null) {
  const endpoint = guildId
    ? `${DISCORD_API}/applications/${bot.clientId}/guilds/${guildId}/commands/${commandId}`
    : `${DISCORD_API}/applications/${bot.clientId}/commands/${commandId}`;
  await axios.delete(endpoint, {
    headers: {
      Authorization: `Bot ${bot.token}`
    },
    timeout: 10_000
  });
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
        `[dev-bot:${bot.id}] Server Members Intent não esta ativo no Discord; eventos de membros serão ignorados.`
      );
    }

    return enabled;
  } catch (error) {
    console.warn(
      `[dev-bot:${bot.id}] não foi possível consultar intents do Discord; iniciando sem eventos de membros:`,
      readRuntimeError(error)
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
      `[dev-bot:${bot.id}] não foi possível consultar o Message Content Intent:`,
      readRuntimeError(error)
    );
    return false;
  }
}

function hasEnabledModule(bot: DevBotRuntimeConfig, moduleIds: string[]) {
  return moduleIds.some((moduleId) => bot.enabledModules.includes(moduleId));
}

function discordRuntimeRequestError(error: import("axios").AxiosError) {
  const status = error.response?.status;
  const method = error.config?.method?.toUpperCase() ?? "HTTP";
  const url = sanitizeDiscordRuntimeUrl(error.config?.url);
  const message = readDiscordRuntimeErrorMessage(error.response?.data) ?? error.message;
  return `Discord ${method} ${url} falhou${status ? ` com ${status}` : ""}: ${message}`;
}

function sanitizeDiscordRuntimeUrl(url: string | undefined) {
  if (!url) {
    return "request";
  }

  return url.replace(DISCORD_API, "");
}

function readDiscordRuntimeErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
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
      message: "O bot tentou usar intents não ativadas no Discord Developer Portal."
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
