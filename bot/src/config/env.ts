import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const isProduction = process.env.NODE_ENV === "production";
const productionPublicUrl = "https://ricardinho98.shardweb.app";

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

function isLocalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return /(?:\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(value);
  }
}

const configuredFrontendUrl = cleanEnvValue(process.env.FRONTEND_URL);
const productionFrontendUrl =
  configuredFrontendUrl && !isLocalUrl(configuredFrontendUrl) ? normalizeUrl(configuredFrontendUrl) : productionPublicUrl;

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DISCORD_BOT_TOKEN: z.string().default(""),
    BACKEND_API_URL: envUrl(
      "BACKEND_API_URL",
      `${productionFrontendUrl}/api`,
      productionFrontendUrl ? `${productionFrontendUrl}/api` : undefined
    ),
    BACKEND_SOCKET_URL: envUrl("BACKEND_SOCKET_URL", productionFrontendUrl, productionFrontendUrl),
    BOT_API_TOKEN: z.string().default(""),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    TWITCH_MONITOR_INTERVAL_MS: z.coerce.number().default(300_000)
  });

export const env = envSchema.parse(process.env);

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
