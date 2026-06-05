import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().default(""),
  BACKEND_API_URL: z.string().url().default("http://localhost:4000/api"),
  BACKEND_SOCKET_URL: z.string().url().default("http://localhost:4000"),
  BOT_API_TOKEN: z.string().default(""),
  TWITCH_CLIENT_ID: z.string().default(""),
  TWITCH_CLIENT_SECRET: z.string().default(""),
  TWITCH_MONITOR_INTERVAL_MS: z.coerce.number().default(300_000)
});

export const env = envSchema.parse(process.env);
