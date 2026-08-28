import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { memoryMonitorSnapshot } from "./memoryMonitor";

type RouteMetric = {
  durationsMs: number[];
  errors: number;
  maxDurationMs: number;
  minDurationMs: number;
  requests: number;
  totalDurationMs: number;
};

export type OperationMetricInput = {
  botId?: string | null;
  durationMs: number;
  metadata?: Record<string, unknown>;
  module?: string | null;
  operation: string;
  requestId?: string;
  status?: "ok" | "error";
  type: "cache" | "database" | "externalApi" | "processing" | "queue" | "redis";
};

type OperationMetric = {
  durationsMs: number[];
  errors: number;
  maxDurationMs: number;
  minDurationMs: number;
  requests: number;
  totalDurationMs: number;
};

const startedAt = new Date();
const routeMetrics = new Map<string, RouteMetric>();
const operationMetrics = new Map<string, OperationMetric>();
const MAX_ROUTE_METRICS = 500;
const MAX_OPERATION_METRICS = 500;
const MAX_SAMPLES_PER_METRIC = 200;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });

eventLoopDelay.enable();

export function recordHttpRequest(input: {
  durationMs: number;
  method: string;
  path: string;
  statusCode: number;
}) {
  const key = `${input.method.toUpperCase()} ${normalizePath(input.path)}`;
  const metric = routeMetrics.get(key) ?? {
    durationsMs: [],
    errors: 0,
    maxDurationMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    requests: 0,
    totalDurationMs: 0
  };
  const durationMs = Math.max(0, Math.round(input.durationMs));

  metric.requests += 1;
  metric.totalDurationMs += durationMs;
  metric.minDurationMs = Math.min(metric.minDurationMs, durationMs);
  metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
  pushSample(metric.durationsMs, durationMs);

  if (input.statusCode >= 500) {
    metric.errors += 1;
  }

  routeMetrics.set(key, metric);

  if (routeMetrics.size > MAX_ROUTE_METRICS) {
    pruneRouteMetrics();
  }
}

export function recordOperationMetric(input: OperationMetricInput) {
  const key = [
    input.type,
    input.module?.trim() || "unknown",
    input.operation.trim() || "unknown"
  ].join(" ");
  const metric = operationMetrics.get(key) ?? {
    durationsMs: [],
    errors: 0,
    maxDurationMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    requests: 0,
    totalDurationMs: 0
  };
  const durationMs = Math.max(0, Math.round(input.durationMs));

  metric.requests += 1;
  metric.totalDurationMs += durationMs;
  metric.minDurationMs = Math.min(metric.minDurationMs, durationMs);
  metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
  pushSample(metric.durationsMs, durationMs);

  if (input.status === "error") {
    metric.errors += 1;
  }

  operationMetrics.set(key, metric);

  if (operationMetrics.size > MAX_OPERATION_METRICS) {
    pruneOperationMetrics();
  }
}

export function metricsSnapshot() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const memoryMonitor = memoryMonitorSnapshot();
  const routes = [...routeMetrics.entries()]
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, 50)
    .map(([route, metric]) => ({
      route,
      requests: metric.requests,
      errors: metric.errors,
      avgDurationMs: average(metric),
      maxDurationMs: metric.maxDurationMs,
      minDurationMs: Number.isFinite(metric.minDurationMs) ? metric.minDurationMs : 0,
      p50Ms: percentile(metric.durationsMs, 50),
      p95Ms: percentile(metric.durationsMs, 95),
      p99Ms: percentile(metric.durationsMs, 99)
    }));
  const operations = [...operationMetrics.entries()]
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, 50)
    .map(([operation, metric]) => ({
      operation,
      requests: metric.requests,
      errors: metric.errors,
      avgDurationMs: average(metric),
      maxDurationMs: metric.maxDurationMs,
      minDurationMs: Number.isFinite(metric.minDurationMs) ? metric.minDurationMs : 0,
      p50Ms: percentile(metric.durationsMs, 50),
      p95Ms: percentile(metric.durationsMs, 95),
      p99Ms: percentile(metric.durationsMs, 99)
    }));

  return {
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      status: memoryMonitor.pressure,
      possibleLeak: memoryMonitor.possibleLeak,
      targetMb: memoryMonitor.targetMb,
      limitMb: memoryMonitor.limitMb,
      averageRssMb: memoryMonitor.averageRssMb,
      history: memoryMonitor.history
    },
    cpu: {
      loadAverage: os.loadavg(),
      systemMilliseconds: Math.round(cpu.system / 1_000),
      userMilliseconds: Math.round(cpu.user / 1_000)
    },
    eventLoop: {
      maxMs: nsToMs(eventLoopDelay.max),
      meanMs: nsToMs(eventLoopDelay.mean),
      minMs: nsToMs(eventLoopDelay.min),
      p50Ms: nsToMs(eventLoopDelay.percentile(50)),
      p95Ms: nsToMs(eventLoopDelay.percentile(95)),
      p99Ms: nsToMs(eventLoopDelay.percentile(99)),
      stddevMs: nsToMs(eventLoopDelay.stddev)
    },
    routes,
    operations,
    latency: {
      backendProcessing: routes.length ? {
        averageMs: Math.round(routes.reduce((total, route) => total + route.avgDurationMs, 0) / routes.length),
        p50Ms: percentile(routes.map((route) => route.p50Ms), 50),
        p95Ms: percentile(routes.map((route) => route.p95Ms), 95),
        p99Ms: percentile(routes.map((route) => route.p99Ms), 99)
      } : null,
      eventLoop: {
        maxMs: nsToMs(eventLoopDelay.max),
        meanMs: nsToMs(eventLoopDelay.mean),
        p50Ms: nsToMs(eventLoopDelay.percentile(50)),
        p95Ms: nsToMs(eventLoopDelay.percentile(95)),
        p99Ms: nsToMs(eventLoopDelay.percentile(99))
      }
    }
  };
}

export function trimMonitoringSamples(maxSamples = 50) {
  for (const metric of routeMetrics.values()) {
    trimArray(metric.durationsMs, maxSamples);
  }

  for (const metric of operationMetrics.values()) {
    trimArray(metric.durationsMs, maxSamples);
  }
}

function pruneRouteMetrics() {
  const retained = [...routeMetrics.entries()]
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, MAX_ROUTE_METRICS);

  routeMetrics.clear();

  for (const [route, metric] of retained) {
    routeMetrics.set(route, metric);
  }
}

function pruneOperationMetrics() {
  const retained = [...operationMetrics.entries()]
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, MAX_OPERATION_METRICS);

  operationMetrics.clear();

  for (const [route, metric] of retained) {
    operationMetrics.set(route, metric);
  }
}

function pushSample(samples: number[], value: number) {
  samples.push(value);
  if (samples.length > MAX_SAMPLES_PER_METRIC) {
    samples.splice(0, samples.length - MAX_SAMPLES_PER_METRIC);
  }
}

function trimArray<T>(items: T[], maxItems: number) {
  if (items.length > maxItems) {
    items.splice(0, items.length - maxItems);
  }
}

function average(metric: Pick<RouteMetric, "requests" | "totalDurationMs">) {
  return metric.requests ? Math.round(metric.totalDurationMs / metric.requests) : 0;
}

function percentile(values: number[], percentileRank: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileRank / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function normalizePath(path: string) {
  return path
    .replace(/\?.*$/, "")
    .replace(/\/\d{5,32}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, "/:uuid");
}

function nsToMs(value: number) {
  return Number((value / 1_000_000).toFixed(3));
}
