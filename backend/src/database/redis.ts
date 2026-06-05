import Redis from "ioredis";
import { env } from "../config/env";

let redis: Redis | null = null;

export function getRedisClient() {
  if (!env.REDIS_URL) {
    return null;
  }

  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2
    });

    redis.on("connect", () => {
      console.log("[redis] conectado");
    });

    redis.on("error", (error) => {
      console.warn("[redis] conexao indisponivel:", error.message);
    });

    redis.connect().catch((error) => {
      console.warn("[redis] nao foi possivel conectar:", error.message);
    });
  }

  return redis;
}
