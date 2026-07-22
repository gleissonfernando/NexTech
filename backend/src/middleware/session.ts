import session from "express-session";
import { env } from "../config/env";
import { MongoSessionStore } from "../database/mongoSessionStore";
import { getRedisClient } from "../database/redis";
import { RedisSessionStore } from "../database/redisSessionStore";

const redis = env.REDIS_SESSION_ENABLED ? getRedisClient() : null;
const persistentStore = redis
  ? new RedisSessionStore(redis)
  : env.MONGODB_URI
    ? new MongoSessionStore()
    : undefined;

if (persistentStore) {
  console.log(`[session] usando ${redis ? "Redis" : "MongoDB"} como store de sessão.`);
} else if (env.NODE_ENV === "production") {
  throw new Error("Store persistente de sessão não configurado. Configure MONGODB_URI ou REDIS_URL.");
} else {
  console.warn("[session] usando store temporário em memória. Configure MONGODB_URI ou REDIS_URL para persistir sessões.");
}

export const sessionMiddleware = session({
  name: "discord_dashboard.sid",
  secret: env.SESSION_SECRET,
  proxy: env.NODE_ENV === "production",
  resave: false,
  saveUninitialized: false,
  store: persistentStore,
  cookie: {
    httpOnly: true,
    maxAge: env.SESSION_TTL_SECONDS * 1000,
    sameSite: "lax",
    secure: env.NODE_ENV === "production"
  }
});
