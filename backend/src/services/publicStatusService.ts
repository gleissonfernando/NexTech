import { getMercadoPagoHealth } from "../config/payments";
import { getMongoDb } from "../database/mongo";
import { getRedisClient } from "../database/redis";
import { backgroundJobHealth } from "./backgroundJobService";
import { metricsSnapshot } from "./monitoringService";
import { getBotStatus } from "./statsService";

export type PublicServiceState =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

export type PublicHistoryState = "operational" | "degraded" | "down" | "maintenance" | "no_data";

export type PublicStatusService = {
  critical: boolean;
  currentStatus: PublicServiceState;
  description: string | null;
  history: Array<{
    averageResponseTimeMs: number | null;
    startedAt: string;
    status: PublicHistoryState;
  }>;
  id: string;
  lastCheckedAt: string | null;
  name: string;
  responseTimeMs: number | null;
  uptimePercentage: number;
};

export type PublicStatusCategory = {
  id: string;
  name: string;
  services: PublicStatusService[];
};

export type PublicStatusSnapshot = {
  categories: PublicStatusCategory[];
  generatedAt: string;
  globalMessage: string;
  globalStatus: "operational" | "degraded" | "major_outage";
  historyWindow: {
    bars: number;
    intervalSeconds: number;
    label: string;
  };
  incidents: Array<{
    affectedServiceIds: string[];
    id: string;
    severity: "minor" | "major" | "critical";
    startedAt: string;
    status: "investigating" | "identified" | "monitoring" | "resolved";
    title: string;
  }>;
  maintenances: Array<{
    id: string;
    scheduledFor: string;
    status: "scheduled" | "in_progress" | "completed";
    title: string;
  }>;
  servicesTotal: number;
};

const HISTORY_BARS = 60;
const HISTORY_INTERVAL_SECONDS = 60;

export async function getPublicStatusSnapshot(): Promise<PublicStatusSnapshot> {
  const generatedAt = new Date();
  const [database, redis, jobs] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    backgroundJobHealth().catch(() => ({ status: "error" as const }))
  ]);
  const bot = getBotStatus();
  const payments = getPaymentStatus();
  const metrics = metricsSnapshot();
  const apiLatency = latestApiLatency(metrics.routes);

  const categories: PublicStatusCategory[] = [
    {
      id: "web",
      name: "Web",
      services: [
        buildService({
          critical: true,
          description: "Dashboard pública, autenticação e rotas principais.",
          id: "nextech-dashboard",
          latencyMs: apiLatency,
          name: "Dashboard NextTech",
          status: "operational",
          timestamp: generatedAt
        }),
        buildService({
          critical: true,
          description: "API pública sanitizada da plataforma.",
          id: "public-api",
          latencyMs: apiLatency,
          name: "API Pública",
          status: apiLatency !== null && apiLatency > 1500 ? "degraded" : "operational",
          timestamp: generatedAt
        })
      ]
    },
    {
      id: "services",
      name: "Serviços",
      services: [
        buildService({
          critical: true,
          description: "Conexão do bot principal e eventos do Discord.",
          id: "discord-bot",
          history: bot.responseTime.history.length ? bot.responseTime.history.map((point) => ({
            averageResponseTimeMs: point.latencyMs,
            startedAt: point.at,
            status: publicHistoryStatusFromResponseTime(point.status)
          })) : undefined,
          latencyMs: bot.responseTime.currentMs ?? (bot.online ? bot.latency : null),
          name: "Bot Discord",
          status: bot.online ? publicServiceStatusFromResponseTime(bot.responseTime.status) : "partial_outage",
          timestamp: generatedAt
        }),
        buildService({
          critical: false,
          description: "Execução de filas, rotinas e tarefas assíncronas.",
          id: "background-jobs",
          latencyMs: null,
          name: "Jobs Assíncronos",
          status: jobs.status === "ok" || jobs.status === "running" ? "operational" : "degraded",
          timestamp: generatedAt
        }),
        buildService({
          critical: false,
          description: "Checkout, PIX e confirmação de pedidos.",
          id: "payments",
          latencyMs: null,
          name: "Pagamentos",
          status: payments,
          timestamp: generatedAt
        })
      ]
    },
    {
      id: "infrastructure",
      name: "Infraestrutura",
      services: [
        buildService({
          critical: true,
          description: "Persistência de dados da plataforma.",
          id: "data-storage",
          latencyMs: database.latencyMs,
          name: "Armazenamento de Dados",
          status: database.ok ? (database.latencyMs > 1000 ? "degraded" : "operational") : "major_outage",
          timestamp: generatedAt
        }),
        ...(redis.configured ? [
          buildService({
            critical: false,
            description: "Cache e operações de apoio em tempo real.",
            id: "cache",
            latencyMs: redis.latencyMs,
            name: "Cache",
            status: redis.ok ? (redis.latencyMs > 500 ? "degraded" : "operational") : "degraded",
            timestamp: generatedAt
          })
        ] : [])
      ]
    }
  ];

  const services = categories.flatMap((category) => category.services);
  const globalStatus = calculateGlobalStatus(services);

  return {
    categories,
    generatedAt: generatedAt.toISOString(),
    globalMessage: globalMessage(globalStatus),
    globalStatus,
    historyWindow: {
      bars: HISTORY_BARS,
      intervalSeconds: HISTORY_INTERVAL_SECONDS,
      label: "Últimos 60 minutos"
    },
    incidents: services
      .filter((service) => service.currentStatus === "major_outage" || service.currentStatus === "partial_outage")
      .map((service) => ({
        affectedServiceIds: [service.id],
        id: `incident-${service.id}`,
        severity: service.critical ? "critical" as const : "major" as const,
        startedAt: generatedAt.toISOString(),
        status: "investigating" as const,
        title: `${service.name} apresenta indisponibilidade`
      })),
    maintenances: [],
    servicesTotal: services.length
  };
}

async function checkDatabase() {
  const startedAt = Date.now();
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}

async function checkRedis() {
  const startedAt = Date.now();
  const redis = getRedisClient();
  if (!redis) return { configured: false, ok: true, latencyMs: 0 };

  try {
    await redis.ping();
    return { configured: true, ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { configured: true, ok: false, latencyMs: Date.now() - startedAt };
  }
}

function getPaymentStatus(): PublicServiceState {
  const payments = getMercadoPagoHealth();
  if (!payments.enabled) return "unknown";
  if (payments.status === "operational") return "operational";
  return "partial_outage";
}

function latestApiLatency(routes: Array<{ avgDurationMs: number; route: string }>) {
  const publicRoutes = routes.filter((route) => route.route.includes("/api/") || route.route.includes("/health"));
  const durations = publicRoutes.map((route) => route.avgDurationMs).filter((duration) => Number.isFinite(duration) && duration > 0);
  if (!durations.length) return null;
  return Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length);
}

function buildService(input: {
  critical: boolean;
  description: string;
  history?: PublicStatusService["history"];
  id: string;
  latencyMs: number | null;
  name: string;
  status: PublicServiceState;
  timestamp: Date;
}): PublicStatusService {
  return {
    critical: input.critical,
    currentStatus: input.status,
    description: input.description,
    history: input.history?.length ? input.history.slice(-HISTORY_BARS) : buildHistory(input.status, input.latencyMs, input.timestamp),
    id: input.id,
    lastCheckedAt: input.timestamp.toISOString(),
    name: input.name,
    responseTimeMs: input.latencyMs,
    uptimePercentage: uptimeForStatus(input.status)
  };
}

function publicServiceStatusFromResponseTime(status: "good" | "warn" | "critical" | "offline"): PublicServiceState {
  if (status === "good") return "operational";
  if (status === "offline") return "partial_outage";
  return "degraded";
}

function publicHistoryStatusFromResponseTime(status: "good" | "warn" | "critical" | "offline"): PublicHistoryState {
  if (status === "good") return "operational";
  if (status === "offline") return "down";
  return "degraded";
}

function buildHistory(status: PublicServiceState, latencyMs: number | null, now: Date) {
  const historyStatus = historyStatusForService(status);
  return Array.from({ length: HISTORY_BARS }, (_, index) => {
    const startedAt = new Date(now.getTime() - (HISTORY_BARS - index - 1) * HISTORY_INTERVAL_SECONDS * 1000);
    return {
      averageResponseTimeMs: historyStatus === "no_data" ? null : latencyMs,
      startedAt: startedAt.toISOString(),
      status: historyStatus
    };
  });
}

function historyStatusForService(status: PublicServiceState): PublicHistoryState {
  if (status === "operational") return "operational";
  if (status === "degraded") return "degraded";
  if (status === "maintenance") return "maintenance";
  if (status === "unknown") return "no_data";
  return "down";
}

function uptimeForStatus(status: PublicServiceState) {
  if (status === "operational") return 100;
  if (status === "degraded") return 99.5;
  if (status === "maintenance") return 100;
  if (status === "unknown") return 0;
  return 0;
}

function calculateGlobalStatus(services: PublicStatusService[]): PublicStatusSnapshot["globalStatus"] {
  if (services.some((service) => service.critical && service.currentStatus === "major_outage")) {
    return "major_outage";
  }

  if (services.some((service) => service.currentStatus !== "operational" && service.currentStatus !== "unknown")) {
    return "degraded";
  }

  return "operational";
}

function globalMessage(status: PublicStatusSnapshot["globalStatus"]) {
  if (status === "major_outage") return "Interrupção grave nos serviços";
  if (status === "degraded") return "Serviços parcialmente degradados";
  return "Todos os serviços estão operacionais";
}
