import { randomBytes } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const localMongoUrl = "mongodb://localhost:27017/ricardinho98";
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
    (value) => cleanEnvValue(value) ?? (isProduction ? productionDefault ?? "" : developmentDefault),
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

function rejectLocalProductionUrl(ctx: z.RefinementCtx, name: string, value?: string) {
  if (!isProduction || !value || !isLocalUrl(value)) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [name],
    message: `${name} nao pode apontar para localhost em producao.`
  });
}

const configuredFrontendUrl = cleanEnvValue(process.env.FRONTEND_URL);
const productionFrontendUrl = configuredFrontendUrl ? normalizeUrl(configuredFrontendUrl) : undefined;

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default(isProduction ? "0.0.0.0" : "localhost"),
    PORT: z.coerce.number().default(isProduction ? 80 : 4000),
    DATABASE_URL: z.string().optional().default(""),
    MONGO_URI: z.string().optional().default(""),
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
    DISCORD_CALLBACK_URL: envUrl(
      "DISCORD_CALLBACK_URL",
      "http://localhost:4000/auth/discord/callback",
      productionFrontendUrl ? `${productionFrontendUrl}/auth/discord/callback` : undefined
    ),
    DISCORD_SCOPES: z.string().default("identify email guilds"),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    FRONTEND_URL: envUrl("FRONTEND_URL", "http://localhost:5173"),
    DASHBOARD_AUTH_REQUIRED: envBoolean(isProduction),
    DASHBOARD_AUTHORIZED_USER_IDS: z.string().optional().default(""),
    DASHBOARD_VERIFICATION_MODE: z.enum(["temporary", "roles"]).default("temporary"),
    DEV_AUTH_ENABLED: envBoolean(false)
  })
  .superRefine((value, ctx) => {
    const mongoUrl = cleanEnvValue(value.MONGODB_URI) ?? cleanEnvValue(value.MONGO_URI) ?? cleanEnvValue(value.DATABASE_URL);

    rejectLocalProductionUrl(ctx, "MONGODB_URI", mongoUrl);
    if (value.REDIS_SESSION_ENABLED) {
      rejectLocalProductionUrl(ctx, "REDIS_URL", cleanEnvValue(value.REDIS_URL));
    }
    rejectLocalProductionUrl(ctx, "DISCORD_CALLBACK_URL", value.DISCORD_CALLBACK_URL);
    rejectLocalProductionUrl(ctx, "FRONTEND_URL", value.FRONTEND_URL);
  })
  .transform((value) => {
    const mongoUrl = cleanEnvValue(value.MONGODB_URI) ?? cleanEnvValue(value.MONGO_URI) ?? cleanEnvValue(value.DATABASE_URL) ?? (isProduction ? "" : localMongoUrl);

    return {
      ...value,
      DATABASE_URL: cleanEnvValue(value.DATABASE_URL) ?? mongoUrl,
      MONGO_URI: cleanEnvValue(value.MONGO_URI) ?? mongoUrl,
      MONGODB_URI: mongoUrl,
      DASHBOARD_AUTH_REQUIRED: isProduction ? true : value.DASHBOARD_AUTH_REQUIRED,
      DEV_AUTH_ENABLED: isProduction ? false : value.DEV_AUTH_ENABLED
    };
  });

export const env = envSchema.parse(process.env);

process.env.DATABASE_URL = env.DATABASE_URL;
process.env.MONGO_URI = env.MONGO_URI;
process.env.MONGODB_URI = env.MONGODB_URI;

if (env.NODE_ENV === "production") {
  const missing = [
    ["FRONTEND_URL", env.FRONTEND_URL],
    ["MONGODB_URI", env.MONGODB_URI],
    ["BOT_API_TOKEN", cleanEnvValue(env.BOT_API_TOKEN)],
    ["DISCORD_BOT_TOKEN", cleanEnvValue(env.DISCORD_BOT_TOKEN)],
    ["DISCORD_CLIENT_ID", cleanEnvValue(env.DISCORD_CLIENT_ID)],
    ["DISCORD_CLIENT_SECRET", cleanEnvValue(env.DISCORD_CLIENT_SECRET)],
    ["DISCORD_CALLBACK_URL", env.DISCORD_CALLBACK_URL]
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
