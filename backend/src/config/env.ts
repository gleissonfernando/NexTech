import { randomBytes } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const localMongoUrl = "mongodb://localhost:27017/ricardinho98";
const productionPublicUrl = "https://ricardinho98.shardweb.app";
const isProduction = process.env.NODE_ENV === "production";

function cleanEnvValue(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function envSecret(developmentDefault: string) {
  const productionDefault = randomBytes(32).toString("hex");

  return z.preprocess(
    (value) => cleanEnvValue(value) ?? (isProduction ? productionDefault : developmentDefault),
    z.string().min(12)
  );
}

function envUrl(name: string, developmentDefault: string, productionDefault?: string) {
  return z.preprocess(
    (value) => {
      const cleaned = cleanEnvValue(value);
      const fallback = isProduction ? productionDefault ?? "" : developmentDefault;

      if (isProduction && cleaned && isLocalUrl(cleaned)) {
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
    .transform((value) => value === "true");
}

function isLocalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return /(?:\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(value);
  }
}

const configuredSiteOrigin = cleanEnvValue(process.env.SITE_ORIGIN) ?? cleanEnvValue(process.env.FRONTEND_URL);
const productionSiteOrigin =
  configuredSiteOrigin && !isLocalUrl(configuredSiteOrigin) ? normalizeUrl(configuredSiteOrigin) : productionPublicUrl;
const canonicalDiscordRedirectUri = discordRedirectUriFor(productionSiteOrigin);

function productionSafeUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  if (isProduction && isLocalUrl(value)) {
    return undefined;
  }

  return value;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.preprocess((value) => (isProduction ? "0.0.0.0" : cleanEnvValue(value) ?? "localhost"), z.string()),
    PORT: z.preprocess((value) => (isProduction ? 80 : cleanEnvValue(value) ?? 4000), z.coerce.number()),
    MONGODB_URI: z.string().optional().default(""),
    REDIS_URL: z.string().optional().default(""),
    REDIS_SESSION_ENABLED: envBoolean(false),
    SESSION_SECRET: envSecret("development-session-secret"),
    SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    JWT_SECRET: envSecret("development-jwt-secret"),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(60 * 15),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    BOT_API_TOKEN: z.string().default(""),
    DISCORD_BOT_TOKEN: z.string().default(""),
    DISCORD_CLIENT_ID: z.string().default(""),
    DISCORD_CLIENT_SECRET: z.string().default(""),
    SITE_ORIGIN: envUrl("SITE_ORIGIN", productionSiteOrigin, productionSiteOrigin),
    DISCORD_OAUTH_REDIRECT_URI: envUrl(
      "DISCORD_OAUTH_REDIRECT_URI",
      canonicalDiscordRedirectUri,
      canonicalDiscordRedirectUri
    ),
    DISCORD_CALLBACK_URL: envUrl(
      "DISCORD_CALLBACK_URL",
      canonicalDiscordRedirectUri,
      canonicalDiscordRedirectUri
    ),
    DISCORD_SCOPES: z.string().default("identify email guilds"),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    FRONTEND_URL: envUrl("FRONTEND_URL", productionSiteOrigin, productionSiteOrigin),
    DASHBOARD_AUTH_REQUIRED: envBoolean(isProduction),
    DASHBOARD_AUTHORIZED_USER_IDS: z.string().optional().default(""),
    DASHBOARD_VERIFICATION_MODE: z.enum(["temporary", "roles"]).default("temporary"),
    DEV_AUTH_ENABLED: envBoolean(false)
  })
  .transform((value) => {
    const mongoUrl = productionSafeUrl(cleanEnvValue(value.MONGODB_URI)) ?? (isProduction ? "" : localMongoUrl);
    const configuredOrigin = cleanEnvValue(value.SITE_ORIGIN) ?? cleanEnvValue(value.FRONTEND_URL);
    const oauthFrontendUrl =
      configuredOrigin && !(value.DASHBOARD_AUTH_REQUIRED && isLocalUrl(configuredOrigin))
        ? normalizeUrl(configuredOrigin)
        : productionSiteOrigin;
    const oauthCallbackUrl = discordRedirectUriFor(oauthFrontendUrl);

    return {
      ...value,
      MONGODB_URI: mongoUrl,
      SITE_ORIGIN: oauthFrontendUrl,
      FRONTEND_URL: oauthFrontendUrl,
      DISCORD_OAUTH_REDIRECT_URI: oauthCallbackUrl,
      DISCORD_CALLBACK_URL: oauthCallbackUrl,
      REDIS_URL: value.REDIS_SESSION_ENABLED ? productionSafeUrl(cleanEnvValue(value.REDIS_URL)) ?? "" : "",
      DASHBOARD_AUTH_REQUIRED: isProduction ? true : value.DASHBOARD_AUTH_REQUIRED,
      DEV_AUTH_ENABLED: isProduction ? false : value.DEV_AUTH_ENABLED
    };
  });

export const env = envSchema.parse(process.env);

process.env.MONGODB_URI = env.MONGODB_URI;
process.env.SITE_ORIGIN = env.SITE_ORIGIN;
process.env.FRONTEND_URL = env.FRONTEND_URL;
process.env.DISCORD_OAUTH_REDIRECT_URI = env.DISCORD_OAUTH_REDIRECT_URI;
process.env.DISCORD_CALLBACK_URL = env.DISCORD_CALLBACK_URL;

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
