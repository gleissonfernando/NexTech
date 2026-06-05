import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

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

function envUrl(name: string, developmentDefault: string, productionDefault?: string) {
  return z.preprocess(
    (value) => cleanEnvValue(value) ?? (isProduction ? productionDefault ?? "" : developmentDefault),
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
    DISCORD_BOT_TOKEN: z.string().default(""),
    BACKEND_API_URL: envUrl(
      "BACKEND_API_URL",
      "http://localhost:4000/api",
      productionFrontendUrl ? `${productionFrontendUrl}/api` : undefined
    ),
    BACKEND_SOCKET_URL: envUrl("BACKEND_SOCKET_URL", "http://localhost:4000", productionFrontendUrl),
    BOT_API_TOKEN: z.string().default(""),
    TWITCH_CLIENT_ID: z.string().default(""),
    TWITCH_CLIENT_SECRET: z.string().default(""),
    TWITCH_MONITOR_INTERVAL_MS: z.coerce.number().default(300_000)
  })
  .superRefine((value, ctx) => {
    rejectLocalProductionUrl(ctx, "BACKEND_API_URL", value.BACKEND_API_URL);
    rejectLocalProductionUrl(ctx, "BACKEND_SOCKET_URL", value.BACKEND_SOCKET_URL);
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
