import { Router } from "express";
import { env } from "../config/env";
import { getMercadoPagoHealth } from "../config/payments";
import { getMongoDb } from "../database/mongo";
import { getRedisClient } from "../database/redis";
import { metricsSnapshot } from "../services/monitoringService";
import { getBotStatus } from "../services/statsService";
import { backgroundJobHealth } from "../services/backgroundJobService";
import { listDevBots } from "../services/devBotService";
import { getTranscriptHealthStatus } from "../services/transcriptService";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const [database, redis, jobs] = await Promise.all([
    databaseHealth(),
    redisHealth(),
    backgroundJobHealth().catch((error) => ({ status: "error", lastError: error instanceof Error ? error.message : String(error) }))
  ]);
  const bot = getBotStatus();
  const mail = mailHealth();
  const payments = paymentsHealth();
  const healthy = database.ok && (!redis.configured || redis.ok);

  return res.json({
    status: healthy ? "ok" : "degraded",
    database,
    redis,
    jobs,
    mail,
    payments,
    bot,
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/transcripts", async (_req, res) => {
  const health = await getTranscriptHealthStatus();
  return res.status(health.ok ? 200 : 503).json({
    status: health.ok ? "online" : "degraded",
    service: health.service,
    baseUrl: health.baseUrl,
    database: health.database,
    storage: health.storage,
    route: health.route,
    timestamp: health.timestamp
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

healthRouter.get("/bots/:botId", async (req, res, next) => {
  try {
    const bots = await listDevBots();
    const bot = bots.find((item) => item.id === req.params.botId || item.clientId === req.params.botId);

    if (!bot) {
      return res.status(404).json({
        status: "not_found",
        message: "Bot nao encontrado.",
        timestamp: new Date().toISOString()
      });
    }

    return res.json({
      status: bot.status === "error" || bot.status === "invalid_token" ? "degraded" : "ok",
      bot: {
        id: bot.id,
        clientId: bot.clientId,
        name: bot.name,
        status: bot.status,
        statusMessage: bot.statusMessage,
        desiredOnline: bot.desiredOnline,
        updatedAt: bot.updatedAt
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

healthRouter.get("/mail", (_req, res) => {
  const mail = mailHealth();
  return res.status(mail.ok || !mail.configured ? 200 : 503).json(mail);
});

healthRouter.get("/payments", (_req, res) => {
  const payments = paymentsHealth();
  return res.status(payments.ok || !payments.enabled ? 200 : 503).json(payments);
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

function mailHealth() {
  const configured = Boolean(process.env.SMTP_HOST || process.env.MAIL_HOST || process.env.RESEND_API_KEY);

  return {
    configured,
    ok: configured,
    status: configured ? "configured" : "not_configured",
    provider: process.env.RESEND_API_KEY ? "resend" : process.env.SMTP_HOST || process.env.MAIL_HOST ? "smtp" : null
  };
}

function paymentsHealth() {
  const provider = resolvePaymentHealthProvider();
  const supported = provider === "disabled" || provider === "mercadopago";

  if (provider === "mercadopago") {
    const mercadoPago = getMercadoPagoHealth();
    return {
      enabled: mercadoPago.enabled,
      ok: mercadoPago.status === "operational",
      provider,
      status: mercadoPago.status,
      mercadoPago
    };
  }

  return {
    enabled: false,
    ok: supported,
    provider,
    status: supported ? "disabled" : "unsupported_provider"
  };
}

function resolvePaymentHealthProvider() {
  if (process.env.PAYMENTS_ENABLED?.trim().toLowerCase() === "false") {
    return "disabled";
  }

  if (env.PAYMENT_PROVIDER === "mercadopago" || env.MERCADOPAGO_ENABLED) {
    return "mercadopago";
  }

  return env.PAYMENT_PROVIDER;
}
