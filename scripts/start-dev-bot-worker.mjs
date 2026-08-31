import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

enforceSecureTls();
loadRuntimeConfigFile();
process.env.NODE_ENV = "production";

const backendUrl = normalizeUrl(
  process.env.DEV_BOT_WORKER_BACKEND_URL
  || process.env.NEX_TECH_WORKER_BACKEND_URL
  || process.env.APP_BASE_URL
  || "https://nextech.discloud.app"
);
const botApiToken = process.env.BOT_API_TOKEN || packedConfigValue("BOT_API_TOKEN") || "";
const concurrency = numberEnv("DEV_BOT_START_CONCURRENCY", 1, 1, 64);
const staggerMs = numberEnv("DEV_BOT_START_STAGGER_MS", 45_000, 1_000, 600_000);
const reconcileMs = numberEnv("DEV_BOT_RUNTIME_RECONCILE_INTERVAL_MS", 120_000, 15_000, 900_000);
const childHeapMb = numberEnv("DEV_BOT_NODE_MAX_OLD_SPACE_MB", 96, 64, 512);
const runningBots = new Map();
const restartTimers = new Map();
let reconcileRunning = false;
let shuttingDown = false;

function enforceSecureTls() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") {
    return;
  }

  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  console.warn("[dev-bot-worker] NODE_TLS_REJECT_UNAUTHORIZED=0 ignorado para manter TLS seguro.");
}

if (!botApiToken) {
  console.error("[dev-bot-worker] BOT_API_TOKEN ausente.");
  process.exit(1);
}

console.log(`[dev-bot-worker] iniciado; backend=${backendUrl} concurrency=${concurrency} stagger=${staggerMs}ms.`);
void reconcile("startup");
const interval = setInterval(() => void reconcile("interval"), reconcileMs);
interval.unref();

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function reconcile(reason) {
  if (reconcileRunning || shuttingDown) return;
  reconcileRunning = true;

  try {
    const bots = await fetchRuntimeConfigs();
    const desiredIds = new Set(bots.filter((bot) => bot.desiredOnline).map((bot) => bot.id));

    for (const botId of [...runningBots.keys()]) {
      if (!desiredIds.has(botId)) {
        stopBot(botId, "estado desejado desligado");
      }
    }

    const pending = bots.filter((bot) => bot.desiredOnline && !runningBots.has(bot.id));
    if (pending.length > 0) {
      console.log(`[dev-bot-worker] reconciliacao ${reason}: iniciando ${pending.length} bot(s).`);
      await startBatch(pending);
    }
  } catch (error) {
    console.warn("[dev-bot-worker] reconciliacao falhou:", readError(error));
  } finally {
    reconcileRunning = false;
  }
}

async function fetchRuntimeConfigs() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(`${backendUrl}/api/bot/worker/runtime-configs`, {
    headers: { "x-bot-token": botApiToken },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`GET /api/bot/worker/runtime-configs falhou com HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.bots) ? payload.bots : [];
}

async function startBatch(bots) {
  for (let index = 0; index < bots.length; index += concurrency) {
    const batch = bots.slice(index, index + concurrency);
    await Promise.allSettled(batch.map((bot) => startBot(bot)));
    if (index + concurrency < bots.length && staggerMs > 0) {
      await delay(staggerMs);
    }
  }
}

async function startBot(bot) {
  if (runningBots.has(bot.id) || shuttingDown) return;

  const entry = path.resolve("bot/dist/index.js");
  if (!existsSync(entry)) {
    throw new Error("Build do bot não encontrado no worker.");
  }

  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      DISCORD_BOT_TOKEN: bot.token,
      DASHBOARD_BOT_ID: bot.id,
      BOT_DATABASE_NAME: bot.databaseName || "",
      BOT_MAIN_GUILD_ID: bot.mainGuildId,
      BOT_COMMAND_GUILD_IDS: Array.isArray(bot.guildIds) ? bot.guildIds.join(",") : "",
      BOT_ENABLED_MODULES: Array.isArray(bot.enabledModules) ? bot.enabledModules.join(",") : "",
      BOT_MEMBER_EVENTS_ENABLED: "true",
      NODE_OPTIONS: nodeOptionsWithMaxOldSpace(process.env.NODE_OPTIONS, childHeapMb),
      BACKEND_API_URL: `${backendUrl}/api`,
      BACKEND_SOCKET_URL: backendUrl,
      BOT_API_TOKEN: botApiToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  runningBots.set(bot.id, { child, bot });
  child.stdout.on("data", (chunk) => writeBotLog(bot.id, chunk));
  child.stderr.on("data", (chunk) => writeBotLog(bot.id, chunk, true));
  child.on("error", (error) => console.error(`[dev-bot-worker:${bot.id}] falha no processo:`, error.message));
  child.on("exit", (code, signal) => {
    const current = runningBots.get(bot.id);
    if (current?.child === child) runningBots.delete(bot.id);
    if (shuttingDown) return;

    const detail = signal ? `sinal ${signal}` : `codigo ${code ?? 0}`;
    console.warn(`[dev-bot-worker:${bot.id}] saiu com ${detail}; reagendando restart.`);
    const delayMs = restartDelayMs(bot.id);
    const timer = setTimeout(() => {
      restartTimers.delete(bot.id);
      void reconcile("restart");
    }, delayMs);
    timer.unref();
    restartTimers.set(bot.id, timer);
  });
}

function stopBot(botId, reason) {
  const timer = restartTimers.get(botId);
  if (timer) clearTimeout(timer);
  restartTimers.delete(botId);

  const runtime = runningBots.get(botId);
  if (!runtime) return;
  console.log(`[dev-bot-worker:${botId}] encerrando: ${reason}.`);
  runningBots.delete(botId);
  runtime.child.kill("SIGTERM");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shutdown(code) {
  shuttingDown = true;
  clearInterval(interval);
  for (const botId of [...runningBots.keys()]) {
    stopBot(botId, "worker encerrando");
  }
  setTimeout(() => process.exit(code), 10_000).unref();
}

function loadRuntimeConfigFile() {
  const runtimePath = [".nex-tech-runtime-env.json", ".NexTech-runtime-env.json", ".orvitek-runtime-env.json"].find((candidate) => existsSync(candidate));
  if (!runtimePath) return;

  try {
    const parsed = JSON.parse(readFileSync(runtimePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (/^[A-Z0-9_]+$/.test(key) && value !== null && value !== undefined) {
        process.env[key] = typeof value === "string" ? value : String(value);
      }
    }
  } catch (error) {
    console.warn("[dev-bot-worker] runtime env invalido:", readError(error));
  }
}

function packedConfigValue(key) {
  const rawConfig = process.env.APP_CONFIG_JSON?.trim()
    || (process.env.APP_CONFIG_B64?.trim() ? Buffer.from(process.env.APP_CONFIG_B64, "base64").toString("utf8") : "");
  if (!rawConfig) return "";
  try {
    const value = JSON.parse(rawConfig)?.[key];
    return value === null || value === undefined ? "" : String(value).trim();
  } catch {
    return "";
  }
}

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}

function numberEnv(key, fallback, min, max) {
  const value = Number.parseInt(process.env[key] || "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function nodeOptionsWithMaxOldSpace(current, maxOldSpaceMb) {
  const options = (current ?? "")
    .split(/\s+/)
    .map((option) => option.trim())
    .filter(Boolean)
    .filter((option) => !option.startsWith("--max-old-space-size"));
  options.push(`--max-old-space-size=${maxOldSpaceMb}`);
  return options.join(" ");
}

function restartDelayMs(botId) {
  const jitter = Number.parseInt(String(botId).replace(/\D/g, "").slice(-4), 10);
  return 30_000 + (Number.isFinite(jitter) ? jitter % 15_000 : randomBytes(1)[0] * 50);
}

function writeBotLog(botId, chunk, isError = false) {
  const message = chunk.toString("utf8").trim();
  if (!message) return;
  const writer = isError ? console.error : console.log;
  writer(`[dev-bot:${botId}] ${message}`);
}

function readError(error) {
  return error instanceof Error ? error.message : String(error);
}
