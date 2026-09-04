import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { getRedisClient } from "../database/redis";

type RateLimitPolicy = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type MemoryBucket = {
  count: number;
  resetAt: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();

const publicPolicy: RateLimitPolicy = {
  keyPrefix: "public",
  limit: env.RATE_LIMIT_PUBLIC_PER_MINUTE,
  windowMs: 60_000
};

const authPolicy: RateLimitPolicy = {
  keyPrefix: "auth",
  limit: env.RATE_LIMIT_AUTH_PER_MINUTE,
  windowMs: 60_000
};

const mutationPolicy: RateLimitPolicy = {
  keyPrefix: "mutation",
  limit: env.RATE_LIMIT_MUTATION_PER_MINUTE,
  windowMs: 60_000
};

const botRuntimePolicy: RateLimitPolicy = {
  keyPrefix: "bot-runtime",
  limit: env.RATE_LIMIT_BOT_RUNTIME_PER_MINUTE,
  windowMs: 60_000
};

const botMutationPolicy: RateLimitPolicy = {
  keyPrefix: "bot-mutation",
  limit: env.RATE_LIMIT_BOT_MUTATION_PER_MINUTE,
  windowMs: 60_000
};

const logPolicy: RateLimitPolicy = {
  keyPrefix: "logs",
  limit: env.RATE_LIMIT_LOGS_PER_MINUTE,
  windowMs: 60_000
};

const devPolicy: RateLimitPolicy = {
  keyPrefix: "dev",
  limit: env.RATE_LIMIT_DEV_PER_MINUTE,
  windowMs: 60_000
};

/**
 * Teto do balde âncora (user/IP) em relação ao limite da política.
 *
 * A identidade do rate limit inclui `botId`/slug, que vêm de query string e
 * headers — valores que o cliente controla. Sem um teto ancorado apenas em
 * usuário/IP, bastaria variar `?botId=<aleatório>` a cada requisição para criar
 * um balde novo toda vez e nunca atingir o limite. O multiplicador mantém o
 * escopo por bot (quem opera vários bots continua com folga) e ao mesmo tempo
 * impede amplificação ilimitada.
 */
const IDENTITY_ANCHOR_MULTIPLIER = 3;

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (shouldSkipRateLimit(req)) {
    return next();
  }

  const policy = policyForRequest(req);
  const identity = rateLimitIdentity(req);
  const anchor = rateLimitAnchorIdentity(req);
  const anchorPolicy: RateLimitPolicy = {
    keyPrefix: policy.keyPrefix,
    limit: policy.limit * IDENTITY_ANCHOR_MULTIPLIER,
    windowMs: policy.windowMs
  };
  // Quando a identidade já é só o âncora, não há segundo balde a consumir.
  const anchorKey = identity === anchor ? null : `${policy.keyPrefix}:${anchor}`;
  const [result, anchorResult] = await consumeRateLimits(
    { key: `${policy.keyPrefix}:${identity}`, policy },
    anchorKey ? { key: anchorKey, policy: anchorPolicy } : null
  );

  res.setHeader("X-RateLimit-Limit", String(policy.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.limit - result.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

  const overScoped = result.count > policy.limit;
  const overAnchor = Boolean(anchorResult && anchorResult.count > anchorPolicy.limit);

  if (overScoped || overAnchor) {
    const blocked = overScoped ? policy : anchorPolicy;
    const blockedCount = overScoped ? result.count : anchorResult!.count;
    console.warn(
      `[rate-limit] bloqueado policy=${policy.keyPrefix}${overScoped ? "" : ":anchor"} method=${req.method} path=${req.path} identity=${overScoped ? identity : anchor} count=${blockedCount}/${blocked.limit}`
    );

    return res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Muitas requisicoes em pouco tempo. Aguarde alguns segundos e tente novamente."
      }
    });
  }

  return next();
}

// Só os endpoints de liveness/readiness (sondados com frequência por infra como
// Discloud/orquestradores) ficam de fora do rate limit. O restante de /health —
// em especial /servers e /bots/:botId, que enumeram bots e guilds de todos os
// tenants — precisa do limite padrão como qualquer outra rota pública.
const UNLIMITED_HEALTH_PATHS = new Set([
  "/health",
  "/health/",
  "/health/live",
  "/health/ready",
  "/api/health",
  "/api/health/",
  "/api/health/live",
  "/api/health/ready"
]);

function shouldSkipRateLimit(req: Request) {
  return UNLIMITED_HEALTH_PATHS.has(req.path);
}

export function policyForRequest(req: Request): RateLimitPolicy {
  const path = req.path;

  if (path.startsWith("/auth") || path.startsWith("/api/auth")) {
    return authPolicy;
  }

  if (path.startsWith("/api/dev")) {
    return devPolicy;
  }

  if (path.startsWith("/api/logs") || path.startsWith("/logs")) {
    return logPolicy;
  }

  if (isBotRuntimePath(path)) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
      return botMutationPolicy;
    }

    return botRuntimePolicy;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
    return mutationPolicy;
  }

  return publicPolicy;
}

function isBotRuntimePath(path: string) {
  return path.startsWith("/api/bot/")
    || path.startsWith("/bot/")
    || isModuleBotRuntimePath(path)
    || path.startsWith("/api/settings/bot/")
    || path.startsWith("/settings/bot/")
    || path.startsWith("/api/self-bot-protection/bot/")
    || path.startsWith("/self-bot-protection/bot/")
    || path.startsWith("/api/image-anti-spam/bot/")
    || path.startsWith("/image-anti-spam/bot/")
    || path.startsWith("/api/social-notifications/bot/")
    || path.startsWith("/social-notifications/bot/")
    || path.startsWith("/api/kick-integration/bot/")
    || path.startsWith("/kick-integration/bot/")
    || path.startsWith("/api/clips/bot/")
    || path.startsWith("/clips/bot/")
    || path.startsWith("/api/giveaways/bot/")
    || path.startsWith("/giveaways/bot/")
    || path.startsWith("/api/socials/bot/")
    || path.startsWith("/socials/bot/")
    || path.startsWith("/api/panels/bot/")
    || path.startsWith("/panels/bot/")
    || path.startsWith("/api/x-monitor/bot/")
    || path.startsWith("/x-monitor/bot/")
    || path.startsWith("/api/fivem/bot/")
    || path.startsWith("/fivem/bot/")
    || path.startsWith("/api/voice-recorder/bot/")
    || path.startsWith("/voice-recorder/bot/");
}

function isModuleBotRuntimePath(path: string) {
  return /^\/api\/[a-z0-9-]+\/bot(?:\/|$)/i.test(path)
    || /^\/[a-z0-9-]+\/bot(?:\/|$)/i.test(path);
}

function rateLimitIdentity(req: Request) {
  const queryBotId = typeof req.query.botId === "string" ? req.query.botId.trim() : "";
  const headerBotId = req.header("x-dashboard-bot-id")?.trim() ?? req.header("x-discord-bot-client-id")?.trim() ?? "";
  const botId = queryBotId || headerBotId;
  const dashboardSlug = dashboardSlugFromPath(req.path);

  return [rateLimitAnchorIdentity(req), botId ? `bot:${botId}` : "", dashboardSlug ? `dash:${dashboardSlug}` : ""]
    .filter(Boolean)
    .join(":");
}

/**
 * Parte da identidade que o cliente NÃO consegue trocar à vontade.
 * É o que impede que variar `botId` gere baldes infinitos.
 */
function rateLimitAnchorIdentity(req: Request) {
  const user = req.session?.user?.discordId;

  if (user) {
    return `user:${user}`;
  }

  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function dashboardSlugFromPath(path: string) {
  const match = path.match(/^\/api\/dashboard\/([a-z0-9]+(?:-[a-z0-9]+)*)/i)
    ?? path.match(/^\/dashboard\/([a-z0-9]+(?:-[a-z0-9]+)*)/i);

  return match?.[1] ?? "";
}

type RateLimitTarget = { key: string; policy: RateLimitPolicy };
type RateLimitOutcome = { count: number; resetAt: number };

/**
 * Consome um ou dois baldes numa única ida ao Redis.
 *
 * A versão anterior fazia `incr`, `pexpire` e `pttl` em chamadas separadas — até
 * 3 round-trips por requisição. Com pipeline, o caso normal é 1 round-trip mesmo
 * consumindo os dois baldes (escopo + âncora).
 */
async function consumeRateLimits(
  scoped: RateLimitTarget,
  anchor: RateLimitTarget | null
): Promise<[RateLimitOutcome, RateLimitOutcome | null]> {
  const targets = anchor ? [scoped, anchor] : [scoped];
  const redis = getRedisClient();
  const now = Date.now();

  if (redis?.status === "ready") {
    try {
      const pipeline = redis.pipeline();
      for (const target of targets) {
        pipeline.incr(`rate:${target.key}`);
        pipeline.pttl(`rate:${target.key}`);
      }

      const replies = await pipeline.exec();
      if (!replies) throw new Error("pipeline sem resposta");

      const outcomes: RateLimitOutcome[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        const countReply = replies[index * 2];
        const ttlReply = replies[index * 2 + 1];
        if (countReply?.[0] || ttlReply?.[0]) throw countReply?.[0] ?? ttlReply?.[0];

        const count = Number(countReply?.[1] ?? 0);
        let ttl = Number(ttlReply?.[1] ?? -1);

        // ttl < 0 significa chave sem expiração (primeira requisição da janela,
        // ou um pexpire que falhou antes). Sem este reparo a chave nunca expira
        // e a identidade fica bloqueada para sempre.
        if (count === 1 || ttl < 0) {
          await redis.pexpire(`rate:${target.key}`, target.policy.windowMs);
          ttl = target.policy.windowMs;
        }

        outcomes.push({ count, resetAt: now + Math.max(ttl, 0) });
      }

      return [outcomes[0]!, outcomes[1] ?? null];
    } catch (error) {
      console.warn("[rate-limit] Redis indisponível, usando memória:", error instanceof Error ? error.message : error);
    }
  }

  return [
    consumeMemoryRateLimit(scoped.key, scoped.policy, now),
    anchor ? consumeMemoryRateLimit(anchor.key, anchor.policy, now) : null
  ];
}

function consumeMemoryRateLimit(key: string, policy: RateLimitPolicy, now: number) {
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + policy.windowMs
    };
    memoryBuckets.set(key, next);
    cleanupMemoryBuckets(now);
    return next;
  }

  bucket.count += 1;
  return bucket;
}

function cleanupMemoryBuckets(now: number) {
  if (memoryBuckets.size < 10_000) {
    return;
  }

  for (const [key, bucket] of memoryBuckets.entries()) {
    if (bucket.resetAt <= now) {
      memoryBuckets.delete(key);
    }
  }
}
