import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const isProduction = process.env.NODE_ENV === "production";
const productionPublicUrl = "";

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
    ?? cleanEnvValue(process.env.RICARDINHO_CONFIG_B64);
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

      if (cleaned && isLocalUrl(cleaned)) {
        return fallback;
      }

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
  configuredFrontendUrl && !isLocalUrl(configuredFrontendUrl) ? normalizeUrl(configuredFrontendUrl) : productionPublicUrl;
const defaultBackendUrl = productionFrontendUrl;
const defaultBackendApiUrl = defaultBackendUrl ? `${defaultBackendUrl}/api` : "";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    DISCORD_BOT_TOKEN: z.string().default(""),
    DASHBOARD_BOT_ID: z.string().optional().default(""),
    BOT_MAIN_GUILD_ID: z.string().optional().default(""),
    BACKEND_API_URL: envUrl("BACKEND_API_URL", defaultBackendApiUrl),
    BACKEND_SOCKET_URL: envUrl("BACKEND_SOCKET_URL", defaultBackendUrl),
    BOT_API_TOKEN: z.string().default(""),
    BOT_ENABLED_MODULES: z.string().optional().default(""),
    BOT_MEMBER_EVENTS_ENABLED: envBoolean(true),
    BOT_MESSAGE_LOGS_ENABLED: envBoolean(false),
    BOT_PRESENCE_MONITOR_ENABLED: envBoolean(false),
    BOT_CACHE_MEMBERS_MAX: envNumber(200),
    BOT_CACHE_MESSAGES_PER_CHANNEL: envNumber(10),
    BOT_CACHE_PRESENCES_MAX: envNumber(0),
    BOT_CACHE_USERS_MAX: envNumber(200),
    CLIPS_MAX_PER_CHECK: envNumber(3),
    CLIPS_LOOKBACK_MS: envNumber(15 * 60_000),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    TWITCH_MONITOR_INTERVAL_MS: z.coerce.number().default(20_000),
    X_MONITOR_INTERVAL_MS: z.coerce.number().default(60_000)
  });

export const env = envSchema.parse(process.env);
const enabledModules = new Set(
  env.BOT_ENABLED_MODULES.split(",")
    .map((moduleId) => moduleId.trim())
    .filter(Boolean)
);

export function isBotModuleEnabled(moduleId: string) {
  return enabledModules.size === 0 || enabledModules.has(moduleId);
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
