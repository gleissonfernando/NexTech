import { randomBytes } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const productionPublicUrl = "";
const defaultDashboardGuildIds = "";
const defaultDashboardDevUserIds = "";
const requiredDiscordScopes = "identify connections guilds guilds.join";
const isProduction = process.env.NODE_ENV === "production";

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
    ?? cleanEnvValue(process.env.ORVITEK_CONFIG_B64);
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
    console.warn("[env] APP_CONFIG_JSON/APP_CONFIG_B64 invalido:", error instanceof Error ? error.message : error);
  }
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function discordRedirectUriFor(origin: string) {
  return `${normalizeUrl(origin)}/auth/discord/callback`;
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function envSecret() {
  const fallback = randomBytes(32).toString("hex");

  return z.preprocess(
    (value) => cleanEnvValue(value) ?? fallback,
    z.string().min(12)
  );
}

function internalBotToken() {
  const fallback = randomBytes(32).toString("hex");

  return z.preprocess(
    (value) => cleanEnvValue(value) ?? fallback,
    z.string()
  );
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
  return z
    .string()
    .optional()
    .default(String(defaultValue))
    .transform((value) => ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));
}

function mergeCsvValues(value: string, fallback: string) {
  return [...new Set(`${value},${fallback}`.split(",").map((item) => item.trim()).filter(Boolean))].join(",");
}

function mergeSpaceValues(value: string, fallback: string) {
  return [...new Set(`${value} ${fallback}`.split(/\s+/).map((item) => item.trim()).filter(Boolean))].join(" ");
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

const configuredSiteOrigin =
  cleanEnvValue(process.env.SITE_ORIGIN)
  ?? cleanEnvValue(process.env.FRONTEND_URL)
  ?? cleanEnvValue(process.env.BACKEND_URL);
const productionSiteOrigin = configuredSiteOrigin && !isLocalUrl(configuredSiteOrigin)
  ? normalizeUrl(configuredSiteOrigin)
  : productionPublicUrl;
const defaultSiteOrigin = productionSiteOrigin;
const canonicalDiscordRedirectUri = defaultSiteOrigin ? discordRedirectUriFor(defaultSiteOrigin) : "";
const canonicalTwitchRedirectUri = defaultSiteOrigin ? `${defaultSiteOrigin}/api/giveaways/oauth/twitch/callback` : "";
const canonicalKickRedirectUri = defaultSiteOrigin ? `${defaultSiteOrigin}/api/giveaways/oauth/kick/callback` : "";

function productionSafeUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  if (isLocalUrl(value)) {
    return undefined;
  }

  return value;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().default(80),
    MONGODB_URI: z.string().optional().default(""),
    REDIS_URL: z.string().optional().default(""),
    REDIS_SESSION_ENABLED: envBoolean(false),
    BACKGROUND_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
    BACKGROUND_WORKER_ENABLED: envBoolean(true),
    SCHEDULER_ENABLED: envBoolean(true),
    SESSION_SECRET: envSecret(),
    SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    JWT_SECRET: envSecret(),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(60 * 15),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    BOT_API_TOKEN: internalBotToken(),
    DISCORD_BOT_TOKEN: z.string().default(""),
    DISCORD_CLIENT_ID: z.string().default(""),
    DISCORD_CLIENT_SECRET: z.string().default(""),
    DISCLOUD_TOKEN: z.string().optional().default(""),
    DISCLOUD_APP_IDS: z.string().optional().default(""),
    DISCLOUD_APP_ID_BY_BOT: z.string().optional().default(""),
    SITE_ORIGIN: envUrl("SITE_ORIGIN", defaultSiteOrigin),
    BACKEND_URL: envUrl("BACKEND_URL", defaultSiteOrigin),
    DISCORD_REDIRECT_URI: envUrl("DISCORD_REDIRECT_URI", canonicalDiscordRedirectUri),
    DISCORD_OAUTH_REDIRECT_URI: envUrl("DISCORD_OAUTH_REDIRECT_URI", canonicalDiscordRedirectUri),
    DISCORD_CALLBACK_URL: envUrl("DISCORD_CALLBACK_URL", canonicalDiscordRedirectUri),
    DISCORD_SCOPES: z.string().default(requiredDiscordScopes),
    X_CONSUMER_KEY: z.string().default(""),
    X_CONSUMER_SECRET: z.string().default(""),
    X_BEARER_TOKEN: z.string().default(""),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    TWITCH_BROADCASTER_ACCESS_TOKEN: z.string().default(""),
    TWITCH_OAUTH_REDIRECT_URI: envUrl("TWITCH_OAUTH_REDIRECT_URI", canonicalTwitchRedirectUri),
    KICK_API_KEY: z.string().default(""),
    KICK_CLIENT_ID: z.string().default(""),
    KICK_CLIENT_SECRET: z.string().default(""),
    KICK_OAUTH_REDIRECT_URI: envUrl("KICK_OAUTH_REDIRECT_URI", canonicalKickRedirectUri),
    KICK_WEBHOOK_PUBLIC_KEY: z.string().default(""),
    FRONTEND_URL: envUrl("FRONTEND_URL", defaultSiteOrigin),
    STORAGE_PROVIDER: z.enum(["mongodb", "cloudinary", "firebase", "s3", "r2", "supabase"]).default("mongodb"),
    CLOUDINARY_CLOUD_NAME: z.string().optional().default(""),
    CLOUDINARY_API_KEY: z.string().optional().default(""),
    CLOUDINARY_API_SECRET: z.string().optional().default(""),
    R2_ENDPOINT: z.string().optional().default(""),
    R2_ACCESS_KEY_ID: z.string().optional().default(""),
    R2_SECRET_ACCESS_KEY: z.string().optional().default(""),
    R2_BUCKET: z.string().optional().default(""),
    R2_PUBLIC_URL: z.string().optional().default(""),
    DASHBOARD_DEV_USER_IDS: z.string().optional().default(""),
    DEV_DISCORD_IDS: z.string().optional().default(""),
    DASHBOARD_GUILD_IDS: z.string().optional().default(defaultDashboardGuildIds),
    DASHBOARD_VERIFICATION_MODE: z.enum(["temporary", "roles"]).default("roles"),
    START_REGISTERED_DEV_BOTS: envBoolean(!isProduction)
  })
  .transform((value) => {
    const mongoUrl = productionSafeUrl(cleanEnvValue(value.MONGODB_URI)) ?? "";
    const configuredOrigin = cleanEnvValue(value.SITE_ORIGIN) ?? cleanEnvValue(value.FRONTEND_URL) ?? cleanEnvValue(value.BACKEND_URL);
    const oauthFrontendUrl = configuredOrigin && !isLocalUrl(configuredOrigin)
      ? normalizeUrl(configuredOrigin)
      : productionSiteOrigin;
    const oauthCallbackUrl = oauthFrontendUrl ? discordRedirectUriFor(oauthFrontendUrl) : "";
    const configuredDiscordRedirect =
      cleanEnvValue(value.DISCORD_REDIRECT_URI)
      ?? cleanEnvValue(value.DISCORD_OAUTH_REDIRECT_URI)
      ?? cleanEnvValue(value.DISCORD_CALLBACK_URL);
    const normalizedDiscordRedirect = configuredDiscordRedirect && !isLocalUrl(configuredDiscordRedirect)
      ? normalizeUrl(configuredDiscordRedirect)
      : "";
    const effectiveDiscordRedirect = oauthCallbackUrl || normalizedDiscordRedirect;

    if (normalizedDiscordRedirect && oauthCallbackUrl && normalizedDiscordRedirect !== oauthCallbackUrl) {
      console.warn(`[env] Discord redirect configurado (${normalizedDiscordRedirect}) difere do dominio canonico (${oauthCallbackUrl}); usando o canonico.`);
    }

    return {
      ...value,
      MONGODB_URI: mongoUrl,
      SITE_ORIGIN: oauthFrontendUrl,
      FRONTEND_URL: oauthFrontendUrl,
      BACKEND_URL: oauthFrontendUrl,
      DISCORD_REDIRECT_URI: effectiveDiscordRedirect,
      DISCORD_OAUTH_REDIRECT_URI: effectiveDiscordRedirect,
      DISCORD_CALLBACK_URL: effectiveDiscordRedirect,
      TWITCH_OAUTH_REDIRECT_URI: value.TWITCH_OAUTH_REDIRECT_URI || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/giveaways/oauth/twitch/callback` : ""),
      KICK_OAUTH_REDIRECT_URI: value.KICK_OAUTH_REDIRECT_URI || (oauthFrontendUrl ? `${oauthFrontendUrl}/api/giveaways/oauth/kick/callback` : ""),
      DISCORD_SCOPES: mergeSpaceValues(value.DISCORD_SCOPES, requiredDiscordScopes),
      REDIS_URL: productionSafeUrl(cleanEnvValue(value.REDIS_URL)) ?? "",
      DASHBOARD_DEV_USER_IDS: mergeCsvValues(
        mergeCsvValues(value.DASHBOARD_DEV_USER_IDS, value.DEV_DISCORD_IDS),
        defaultDashboardDevUserIds
      ),
      DEV_DISCORD_IDS: value.DEV_DISCORD_IDS,
      DASHBOARD_GUILD_IDS: mergeCsvValues(value.DASHBOARD_GUILD_IDS, defaultDashboardGuildIds)
    };
  });

export const env = envSchema.parse(process.env);

process.env.MONGODB_URI = env.MONGODB_URI;
process.env.SITE_ORIGIN = env.SITE_ORIGIN;
process.env.FRONTEND_URL = env.FRONTEND_URL;
process.env.BACKEND_URL = env.BACKEND_URL;
process.env.DISCORD_REDIRECT_URI = env.DISCORD_REDIRECT_URI;
process.env.DISCORD_OAUTH_REDIRECT_URI = env.DISCORD_OAUTH_REDIRECT_URI;
process.env.DISCORD_CALLBACK_URL = env.DISCORD_CALLBACK_URL;
process.env.BOT_API_TOKEN = env.BOT_API_TOKEN;

if (env.NODE_ENV === "production") {
  const missing = [
    ["SITE_ORIGIN", env.SITE_ORIGIN],
    ["FRONTEND_URL", env.FRONTEND_URL],
    ["MONGODB_URI", env.MONGODB_URI],
    ["BOT_API_TOKEN", cleanEnvValue(env.BOT_API_TOKEN)],
    ["DISCORD_BOT_TOKEN", cleanEnvValue(env.DISCORD_BOT_TOKEN)],
    ["DISCORD_CLIENT_ID", cleanEnvValue(env.DISCORD_CLIENT_ID)],
    ["DISCORD_CLIENT_SECRET", cleanEnvValue(env.DISCORD_CLIENT_SECRET)],
    ["DISCORD_OAUTH_REDIRECT_URI", env.DISCORD_OAUTH_REDIRECT_URI]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.warn(`[env] variaveis pendentes na hospedagem: ${missing.join(", ")}.`);
  }

  if (!cleanEnvValue(process.env.SESSION_SECRET) || !cleanEnvValue(process.env.JWT_SECRET)) {
    console.warn("[env] SESSION_SECRET/JWT_SECRET ausentes; usando segredos temporarios ate configurar na hospedagem.");
  }
}
