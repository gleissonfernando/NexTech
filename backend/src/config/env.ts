import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgresql://discord:discord@localhost:5432/discord_platform?schema=public"),
  REDIS_URL: z.string().optional().default(""),
  REDIS_SESSION_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  SESSION_SECRET: z.string().min(12).default("development-session-secret"),
  SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
  JWT_SECRET: z.string().min(12).default("development-jwt-secret"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(60 * 15),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
  BOT_API_TOKEN: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
  DISCORD_CALLBACK_URL: z.string().url().default("http://localhost:4000/api/auth/discord/callback"),
  DISCORD_SCOPES: z.string().default("identify email guilds"),
  TWITCH_CLIENT_ID: z.string().default(""),
  TWITCH_CLIENT_SECRET: z.string().default(""),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  DASHBOARD_AUTH_REQUIRED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  DASHBOARD_VERIFICATION_MODE: z.enum(["temporary", "roles"]).default("temporary"),
  DEV_AUTH_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);
