import { Router } from "express";
import { getMongoDb } from "../database/mongo";
import { getRedisClient } from "../database/redis";
import { metricsSnapshot } from "../services/monitoringService";
import { getBotStatus } from "../services/statsService";
import { backgroundJobHealth } from "../services/backgroundJobService";
import { listDevBots } from "../services/devBotService";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const [database, redis, jobs] = await Promise.all([
    databaseHealth(),
    redisHealth(),
    backgroundJobHealth().catch((error) => ({ status: "error", lastError: error instanceof Error ? error.message : String(error) }))
  ]);
  const bot = getBotStatus();
  const healthy = database.ok && (!redis.configured || redis.ok);

  return res.json({
    status: healthy ? "ok" : "degraded",
    database,
    redis,
    jobs,
    bot,
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/database", async (_req, res) => {
  const database = await databaseHealth();
  return res.status(database.ok ? 200 : 503).json(database);
});

healthRouter.get("/redis", async (_req, res) => {
  const redis = await redisHealth();
  return res.status(redis.ok || !redis.configured ? 200 : 503).json(redis);
});

healthRouter.get("/bots", (_req, res) => {
  return res.json({
    status: "ok",
    bot: getBotStatus(),
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/servers", async (_req, res, next) => {
  try {
    const bots = await listDevBots();
    const servers = [...new Map(bots.map((bot) => [bot.id, {
      botId: bot.id,
      botName: bot.name,
      iconUrl: bot.mainGuildIconUrl,
      id: bot.mainGuildId,
      memberCount: bot.mainGuildMemberCount,
      name: bot.mainGuildName,
      status: bot.status
    }])).values()];
    return res.json({ servers });
  } catch (error) {
    return next(error);
  }
});

healthRouter.get("/metrics", async (_req, res) => {
  return res.json({
    status: "ok",
    metrics: metricsSnapshot(),
    jobs: await backgroundJobHealth().catch((error) => ({ status: "error", lastError: error instanceof Error ? error.message : String(error) })),
    timestamp: new Date().toISOString()
  });
});

async function databaseHealth() {
  const startedAt = Date.now();

  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });

    return {
      ok: true,
      status: "ok",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "MongoDB indisponivel"
    };
  }
}

async function redisHealth() {
  const startedAt = Date.now();
  const redis = getRedisClient();

  if (!redis) {
    return {
      configured: false,
      ok: true,
      status: "not_configured",
      latencyMs: 0
    };
  }

  try {
    await redis.ping();

    return {
      configured: true,
      ok: true,
      status: "ok",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      status: "error",
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Redis indisponivel"
    };
  }
}
