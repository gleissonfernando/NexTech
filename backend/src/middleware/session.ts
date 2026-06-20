import session from "express-session";
import { env } from "../config/env";
import { getRedisClient } from "../database/redis";
import { RedisSessionStore } from "../database/redisSessionStore";

const redis = env.REDIS_SESSION_ENABLED ? getRedisClient() : null;

export const sessionMiddleware = session({
  name: "discord_dashboard.sid",
  secret: env.SESSION_SECRET,
  proxy: env.NODE_ENV === "production",
  resave: false,
  saveUninitialized: false,
  store: redis ? new RedisSessionStore(redis) : undefined,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production"
  }
});
