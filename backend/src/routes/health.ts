import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { getPaymentGatewayHealth } from "../config/payments";
import { getMongoDb } from "../database/mongo";
import { getRedisClient } from "../database/redis";
import { metricsSnapshot } from "../services/monitoringService";
import { getBotStatus } from "../services/statsService";
import { backgroundJobHealth } from "../services/backgroundJobService";
import { bootController } from "../services/bootController";
import { listDevBotSummaries, type DevBotDto } from "../services/devBotService";
import { memoryMonitorSnapshot } from "../services/memoryMonitor";
import { getTranscriptHealthStatus } from "../services/transcriptService";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  return res.json({
    status: "ok",
    service: "nextech-api",
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/ready", healthSnapshotHandler);
healthRouter.get("/", healthSnapshotHandler);

async function healthSnapshotHandler(_req: Request, res: Response) {
  const trace = _req.performanceTrace;
  const [database, redis, jobs, registeredBots] = await Promise.all([
    traceAsync(trace, "database:health", databaseHealth),
    traceAsync(trace, "redis:health", redisHealth),
    traceAsync(trace, "queue:background-jobs", () => backgroundJobHealth().catch((error) => ({ status: "error", lastError: error instanceof Error ? error.message : String(error) }))),
    traceAsync(trace, "database:list-dev-bots", () => listDevBotSummaries().catch(() => [] as DevBotDto[]))
  ]);
  const bot = getBotStatus();
  const boot = bootController.snapshot();
  const memory = memoryMonitorSnapshot();
  const mail = mailHealth();
  const payments = paymentsHealth();
  const healthy = database.ok && (!redis.configured || redis.ok) && boot.status !== "failed" && memory.pressure !== "emergency";
  const serverIssues = buildServerHealth(registeredBots, bot);

  return res.json({
    status: healthy ? (boot.status === "degraded" ? "degraded" : "ok") : "degraded",
    boot,
    memory,
    database,
    redis,
    jobs,
    mail,
    payments,
    bot: {
      ...bot,
      serverIssues: serverIssues.filter((server) => !server.ok)
    },
    timestamp: new Date().toISOString()
  });
}

async function traceAsync<T>(trace: Request["performanceTrace"] | undefined, name: string, fn: () => Promise<T>) {
  const startedAt = Date.now();

  try {
    const result = await fn();
    trace?.addStep(name, Date.now() - startedAt);
    return result;
  } catch (error) {
    trace?.addStep(name, Date.now() - startedAt, {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

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
    const bots = await listDevBotSummaries();
    const bot = bots.find((item) => item.id === req.params.botId || item.clientId === req.params.botId);

    if (!bot) {
      return res.status(404).json({
        status: "not_found",
        message: "Bot não encontrado.",
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
    const bots = await listDevBotSummaries();
    const servers = buildServerHealth(bots, getBotStatus());
    return res.json({ servers });
  } catch (error) {
    return next(error);
  }
});

healthRouter.get("/metrics", async (_req, res) => {
  return res.json({
    status: "ok",
    metrics: metricsSnapshot(),
    memory: memoryMonitorSnapshot(),
    jobs: await backgroundJobHealth().catch((error) => ({ status: "error", lastError: error instanceof Error ? error.message : String(error) })),
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/memory", (_req, res) => {
  const memory = memoryMonitorSnapshot();
  return res.status(memory.pressure === "emergency" ? 503 : 200).json({
    status: memory.pressure,
    memory,
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
      message: error instanceof Error ? error.message : "MongoDB indisponível"
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
      message: error instanceof Error ? error.message : "Redis indisponível"
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
  const gateway = getPaymentGatewayHealth();
  const provider = resolvePaymentHealthProvider();

  if (provider === "disabled") {
    return {
      enabled: false,
      ok: true,
      provider,
      status: "disabled",
      ...gateway
    };
  }

  const active = provider === "stripe"
    ? gateway.stripe
    : provider === "asaas"
      ? gateway.asaas
    : provider === "pagbank"
      ? gateway.pagBank
      : gateway.mercadoPago;

  return {
    enabled: active.enabled,
    ok: active.status === "operational",
    provider,
    status: active.status,
    ...gateway
  };
}

function resolvePaymentHealthProvider() {
  if (process.env.PAYMENTS_ENABLED?.trim().toLowerCase() === "false") {
    return "disabled";
  }

  if (env.PAYMENT_PROVIDER !== "disabled") {
    return env.PAYMENT_PROVIDER;
  }

  return env.MERCADOPAGO_ENABLED ? "mercadopago" : "disabled";
}

function buildServerHealth(bots: DevBotDto[], runtimeBot: ReturnType<typeof getBotStatus>) {
  const runtimeGuildIds = new Set(runtimeBot.botGuilds.map((guild) => guild.id));
  const runtimeGuildsById = new Map(runtimeBot.botGuilds.map((guild) => [guild.id, guild]));
  const runtimeAgeMs = Date.now() - new Date(runtimeBot.updatedAt).getTime();
  const runtimeStale = !Number.isFinite(runtimeAgeMs) || runtimeAgeMs > 120_000;
  const servers = new Map<string, ReturnType<typeof serverHealthRecord>>();

  for (const bot of bots) {
    const botGuildIds = [...new Set([bot.mainGuildId, ...bot.guildIds].filter(Boolean))];

    for (const guildId of botGuildIds) {
      const runtimeGuild = runtimeGuildsById.get(guildId);
      servers.set(`${bot.id}:${guildId}`, serverHealthRecord({
        bot,
        guildId,
        runtimeGuild,
        runtimeGuildIds,
        runtimeOnline: runtimeBot.online,
        runtimeStale
      }));
    }
  }

  return [...servers.values()].sort((left, right) => {
    if (left.ok !== right.ok) return left.ok ? 1 : -1;
    return left.name.localeCompare(right.name, "pt-BR");
  });
}

function serverHealthRecord(input: {
  bot: DevBotDto;
  guildId: string;
  runtimeGuild: ReturnType<typeof getBotStatus>["botGuilds"][number] | undefined;
  runtimeGuildIds: Set<string>;
  runtimeOnline: boolean;
  runtimeStale: boolean;
}) {
  const issues = serverHealthReasons(input);
  const isMainGuild = input.guildId === input.bot.mainGuildId;

  return {
    botId: input.bot.id,
    botName: input.bot.name,
    botStatus: input.bot.status,
    botStatusMessage: input.bot.statusMessage,
    desiredOnline: input.bot.desiredOnline,
    iconUrl: input.runtimeGuild?.iconUrl ?? (isMainGuild ? input.bot.mainGuildIconUrl : null),
    id: input.guildId,
    memberCount: input.runtimeGuild?.memberCount ?? (isMainGuild ? input.bot.mainGuildMemberCount : 0),
    name: input.runtimeGuild?.name ?? (isMainGuild ? input.bot.mainGuildName : `Servidor ${input.guildId}`),
    ok: issues.length === 0,
    reason: issues[0] ?? null,
    reasons: issues,
    runtimeOnline: input.runtimeOnline,
    runtimePresent: input.runtimeGuildIds.has(input.guildId),
    status: issues.length ? "problem" : "online",
    updatedAt: new Date().toISOString()
  };
}

function serverHealthReasons(input: {
  bot: DevBotDto;
  guildId: string;
  runtimeGuildIds: Set<string>;
  runtimeOnline: boolean;
  runtimeStale: boolean;
}) {
  const reasons: string[] = [];
  const botStatus = input.bot.status;

  if (!input.bot.desiredOnline) {
    reasons.push("Bot configurado para ficar desligado.");
  }

  if (botStatus === "invalid_token") {
    reasons.push(input.bot.statusMessage || "Token do bot inválido.");
  } else if (botStatus === "error") {
    reasons.push(input.bot.statusMessage || "Processo do bot está em erro.");
  } else if (botStatus === "degraded") {
    reasons.push(input.bot.statusMessage || "Bot está degradado.");
  } else if (botStatus === "offline" || botStatus === "stopping") {
    reasons.push(input.bot.statusMessage || "Bot está offline.");
  } else if (botStatus === "starting" || botStatus === "authenticating" || botStatus === "syncing_config") {
    reasons.push(input.bot.statusMessage || "Bot ainda está inicializando.");
  }

  if (!input.runtimeOnline) {
    reasons.push("Runtime principal do bot não está online.");
  }

  if (input.runtimeStale) {
    reasons.push("Status do bot está sem atualização recente.");
  }

  if (!input.runtimeGuildIds.has(input.guildId) && !isDevBotRuntimeHealthy(botStatus)) {
    reasons.push("Servidor não aparece no runtime do bot; o bot pode ter sido removido do servidor ou não conseguiu carregar a guild.");
  }

  return [...new Set(reasons)];
}

function isDevBotRuntimeHealthy(status: DevBotDto["status"]) {
  return status === "online" || status === "ready";
}
