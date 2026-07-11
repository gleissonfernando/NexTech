import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const isProduction = process.env.NODE_ENV === "production";
const productionPublicUrl = "https://nextech.discloud.app";
const defaultCacheSize = isProduction ? 50 : 200;
const defaultMessageCacheSize = isProduction ? 5 : 10;

function cleanEnvValue(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function applyPackedEnv() {
  const jsonConfig = cleanEnvValue(process.env.APP_CONFIG_JSON);
  const base64Config =
    cleanEnvValue(process.env.APP_CONFIG_B64)
    ?? cleanEnvValue(process.env.APP_CONFIG_BASE64)
    ?? cleanEnvValue(process.env.NEX_TECH_CONFIG_B64);
  const rawConfig = jsonConfig ?? (base64Config ? Buffer.from(base64Config, "base64").toString("utf8") : undefined);

  if (!rawConfig) {
    return;
  }

  try {
    const parsed = JSON.parse(rawConfig) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config precisa ser um objeto JSON.");
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[A-Z0-9_]+$/.test(key) || value === null || value === undefined) {
        continue;
      }

      if (!cleanEnvValue(process.env[key])) {
        process.env[key] = typeof value === "string" ? value : String(value);
      }
    }
  } catch (error) {
    console.warn("[bot env] APP_CONFIG_JSON/APP_CONFIG_B64 invalido:", error instanceof Error ? error.message : error);
  }
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function envUrl(name: string, fallback: string) {
  return z.preprocess(
    (value) => {
      const cleaned = cleanEnvValue(value);
      return cleaned ?? fallback;
    },
    z
      .string()
      .refine((value) => value === "" || isValidUrl(value), `${name} precisa ser uma URL valida.`)
      .transform((value) => (value ? normalizeUrl(value) : ""))
  );
}

function envBoolean(defaultValue: boolean) {
  return z.preprocess(
    (value) => cleanEnvValue(value) ?? String(defaultValue),
    z.string().transform((value) => value === "true")
  );
}

function envNumber(defaultValue: number) {
  return z.preprocess(
    (value) => cleanEnvValue(value) ?? defaultValue,
    z.coerce.number().int().nonnegative()
  );
}

function isLocalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return /(?:\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(value);
  }
}

applyPackedEnv();

const configuredFrontendUrl = cleanEnvValue(process.env.FRONTEND_URL);
const productionFrontendUrl =
  configuredFrontendUrl && !isLocalUrl(configuredFrontendUrl)
    ? normalizeUrl(configuredFrontendUrl)
    : productionPublicUrl;
const defaultBackendUrl = productionFrontendUrl;
const defaultBackendApiUrl = defaultBackendUrl ? `${defaultBackendUrl}/api` : "";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    DISCORD_BOT_TOKEN: z.string().default(""),
    DISCORD_CLIENT_ID: z.string().default(""),
    DASHBOARD_BOT_ID: z.string().optional().default(""),
    DASHBOARD_GUILD_IDS: z.string().optional().default(""),
    BOT_MAIN_GUILD_ID: z.string().optional().default(""),
    BOT_COMMAND_GUILD_IDS: z.string().optional().default(""),
    FRONTEND_URL: envUrl("FRONTEND_URL", productionFrontendUrl),
    BACKEND_API_URL: envUrl("BACKEND_API_URL", defaultBackendApiUrl),
    BACKEND_SOCKET_URL: envUrl("BACKEND_SOCKET_URL", defaultBackendUrl),
    BOT_API_TOKEN: z.string().default(""),
    BOT_ENABLED_MODULES: z.string().optional().default(""),
    BOT_DEFAULT_ALL_MODULES: envBoolean(!isProduction),
    BOT_MEMBER_EVENTS_ENABLED: envBoolean(true),
    BOT_MESSAGE_LOGS_ENABLED: envBoolean(false),
    BOT_PRESENCE_MONITOR_ENABLED: envBoolean(false),
    BOT_CACHE_MEMBERS_MAX: envNumber(defaultCacheSize),
    BOT_CACHE_MESSAGES_PER_CHANNEL: envNumber(defaultMessageCacheSize),
    BOT_CACHE_PRESENCES_MAX: envNumber(0),
    BOT_CACHE_USERS_MAX: envNumber(defaultCacheSize),
    BOT_EVENT_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(50),
    BOT_EVENT_QUEUE_MAX: z.coerce.number().int().min(10).max(10_000).default(1_000),
    BOT_MEMORY_RESTART_MB: z.coerce.number().int().min(128).max(8_192).default(450),
    LAVALINK_URL: envUrl("LAVALINK_URL", ""),
    LAVALINK_PASSWORD: z.string().default(""),
    SPOTIFY_CLIENT_ID: z.string().default(""),
    SPOTIFY_CLIENT_SECRET: z.string().default(""),
    CLIPS_MAX_PER_CHECK: envNumber(3),
    CLIPS_LOOKBACK_MS: envNumber(15 * 60_000),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    TWITCH_MONITOR_INTERVAL_MS: z.coerce.number().default(20_000),
    KICK_CLIENT_ID: z.string().default(""),
    KICK_API_KEY: z.string().default(""),
    KICK_CLIENT_SECRET: z.string().default(""),
    KICK_MONITOR_INTERVAL_MS: z.coerce.number().default(30_000),
    X_MONITOR_INTERVAL_MS: z.coerce.number().default(60_000),
    SECURITY_MAX_ACTIONS_PER_MINUTE: envNumber(40),
    SECURITY_MAX_DELETES_PER_MINUTE: envNumber(20),
    SECURITY_MAX_KICKS_PER_MINUTE: envNumber(4),
    SECURITY_MAX_BANS_PER_MINUTE: envNumber(2),
    SECURITY_MAX_ROLE_UPDATES_PER_MINUTE: envNumber(10),
    SECURITY_BACKUP_COOLDOWN_MINUTES: envNumber(60),
    SECURITY_CLEANUP_BATCH_SIZE: envNumber(10),
    SECURITY_SAFE_MODE_ERROR_LIMIT: envNumber(8),
    SECURITY_SAFE_MODE_TIME_MINUTES: envNumber(10)
  });

export const env = envSchema.parse(process.env);
const ALWAYS_ENABLED_MODULE_IDS = ["mission-tools"] as const;
const enabledModules = new Set(
  env.BOT_ENABLED_MODULES.split(",")
    .map((moduleId) => moduleId.trim())
    .filter(Boolean)
);
const MODULE_ALIASES: Record<string, string[]> = {
  courses: ["courses", "police-courses"],
  "police-courses": ["police-courses", "courses"],
  "fivem-absences": ["fivem-absences", "fivem-fac", "police-absences"],
  "fivem-fac": ["fivem-fac", "fivem-absences", "police-absences"],
  "police-absences": ["police-absences", "fivem-absences", "fivem-fac"],
  "fivem-orders": ["fivem-orders", "fivem-drugs", "fivem-washing"],
  "fivem-drugs": ["fivem-drugs", "fivem-orders"],
  "fivem-washing": ["fivem-washing", "fivem-orders"]
};
let runtimeEnabledModules: Set<string> | null = null;
let runtimeBotId = env.DASHBOARD_BOT_ID.trim() || null;

export function isBotModuleEnabled(moduleId: string) {
  const modules = runtimeEnabledModules ?? enabledModules;
  const candidateModuleIds = MODULE_ALIASES[moduleId] ?? [moduleId];

  if (candidateModuleIds.some((candidateModuleId) => ALWAYS_ENABLED_MODULE_IDS.includes(candidateModuleId as (typeof ALWAYS_ENABLED_MODULE_IDS)[number]))) {
    return true;
  }

  if (modules.size > 0) {
    return candidateModuleIds.some((candidateModuleId) => modules.has(candidateModuleId));
  }

  return runtimeEnabledModules === null && !env.DASHBOARD_BOT_ID && env.BOT_DEFAULT_ALL_MODULES;
}

export function configuredBotModules() {
  return [...new Set([...enabledModules, ...ALWAYS_ENABLED_MODULE_IDS])];
}

export function currentRuntimeBotId() {
  return runtimeBotId;
}

export function setRuntimeEnabledModules(moduleIds: string[], botId?: string | null) {
  runtimeEnabledModules = new Set([
    ...moduleIds.map((moduleId) => moduleId.trim()).filter(Boolean),
    ...ALWAYS_ENABLED_MODULE_IDS
  ]);

  if (botId?.trim()) {
    runtimeBotId = botId.trim();
  }
}

if (env.NODE_ENV === "production") {
  const missing = [
    ["DISCORD_BOT_TOKEN", cleanEnvValue(env.DISCORD_BOT_TOKEN)],
    ["BOT_API_TOKEN", cleanEnvValue(env.BOT_API_TOKEN)],
    ["BACKEND_API_URL", env.BACKEND_API_URL],
    ["BACKEND_SOCKET_URL", env.BACKEND_SOCKET_URL]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.warn(`[bot env] variaveis pendentes na hospedagem: ${missing.join(", ")}.`);
  }
}
