import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

const options = parseArgs(process.argv.slice(2));
const target = new URL(options.url);
const transport = target.protocol === "https:" ? https : http;
const agent = new transport.Agent({
  keepAlive: true,
  maxFreeSockets: Math.min(options.concurrency, 2_000),
  maxSockets: options.concurrency,
  timeout: options.timeoutMs
});

const labels = [
  { label: "users", total: options.users },
  { label: "bots", total: options.bots }
].filter((item) => item.total > 0);
const total = labels.reduce((sum, item) => sum + item.total, 0);
const latencies = [];
const byLabel = Object.fromEntries(labels.map((item) => [item.label, { ok: 0, fail: 0 }]));
let cursor = 0;
let inFlight = 0;
let completed = 0;
let ok = 0;
let fail = 0;
let nextLabelIndex = 0;

if (!total) {
  throw new Error("Configure --users, --bots ou ambos com valor maior que zero.");
}

const startedAt = Date.now();
const progressTimer = setInterval(() => {
  const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1_000);
  console.log(JSON.stringify({
    event: "progress",
    completed,
    inFlight,
    ok,
    fail,
    rps: Math.round(completed / elapsedSeconds)
  }));
}, options.progressMs);
progressTimer.unref();

await new Promise((resolve) => {
  function pump() {
    while (inFlight < options.concurrency && cursor < total) {
      const label = nextLabel();
      cursor += 1;
      inFlight += 1;
      void requestOnce(label).finally(() => {
        inFlight -= 1;
        completed += 1;
        if (completed >= total) {
          resolve();
          return;
        }
        pump();
      });
    }
  }

  pump();
});

clearInterval(progressTimer);
agent.destroy();

latencies.sort((left, right) => left - right);
const elapsedMs = Date.now() - startedAt;
const result = {
  url: options.url,
  users: options.users,
  bots: options.bots,
  total,
  concurrency: options.concurrency,
  ok,
  fail,
  durationMs: elapsedMs,
  rps: Math.round(total / Math.max(1, elapsedMs / 1_000)),
  p50: percentile(0.50),
  p95: percentile(0.95),
  p99: percentile(0.99),
  max: Math.round(latencies.at(-1) ?? 0),
  byLabel
};

console.log(JSON.stringify({ event: "result", ...result }, null, 2));

if (fail > 0) {
  process.exitCode = 1;
}

function nextLabel() {
  for (let attempts = 0; attempts < labels.length; attempts += 1) {
    const index = nextLabelIndex % labels.length;
    nextLabelIndex += 1;
    const entry = labels[index];
    if (entry.total > 0) {
      entry.total -= 1;
      return entry.label;
    }
  }

  return labels[0].label;
}

function requestOnce(label) {
  const started = performance.now();

  return new Promise((resolve) => {
    const req = transport.request({
      agent,
      headers: {
        "accept": "application/json",
        "connection": "keep-alive",
        "user-agent": label === "bots" ? "nex-tech-load-bot/1.0" : "nex-tech-load-user/1.0",
        ...(label === "bots" ? { "x-load-bot": "true" } : {})
      },
      hostname: target.hostname,
      method: "GET",
      path: `${target.pathname}${target.search}`,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      protocol: target.protocol,
      timeout: options.timeoutMs
    }, (res) => {
      res.resume();
      res.on("end", () => {
        const success = res.statusCode >= 200 && res.statusCode < 400;
        record(label, success, performance.now() - started);
        resolve();
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", () => {
      record(label, false, performance.now() - started);
      resolve();
    });
    req.end();
  });
}

function record(label, success, latencyMs) {
  latencies.push(latencyMs);
  if (success) {
    ok += 1;
    byLabel[label].ok += 1;
  } else {
    fail += 1;
    byLabel[label].fail += 1;
  }
}

function percentile(value) {
  return Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * value))] ?? 0);
}

function parseArgs(args) {
  const parsed = {
    bots: 0,
    concurrency: 500,
    progressMs: 5_000,
    timeoutMs: 10_000,
    url: "http://127.0.0.1:3010/health",
    users: 10_000
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [key, inlineValue] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : ["", ""];
    if (!key) continue;
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;

    if (key === "url") parsed.url = String(value);
    else if (key === "users") parsed.users = readPositiveInteger(value, key);
    else if (key === "bots") parsed.bots = readPositiveInteger(value, key);
    else if (key === "concurrency") parsed.concurrency = readPositiveInteger(value, key);
    else if (key === "timeout-ms") parsed.timeoutMs = readPositiveInteger(value, key);
    else if (key === "progress-ms") parsed.progressMs = readPositiveInteger(value, key);
  }

  parsed.concurrency = Math.min(parsed.concurrency, Math.max(1, parsed.users + parsed.bots));
  return parsed;
}

function readPositiveInteger(value, key) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`--${key} precisa ser um inteiro positivo.`);
  }
  return number;
}
