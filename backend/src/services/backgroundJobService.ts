import { createHash, randomUUID } from "node:crypto";
import type { MongoBackgroundJob } from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { env } from "../config/env";

export type BackgroundJobContext = {
  attempt: number;
  jobId: string;
  maxAttempts: number;
};

export type BackgroundJobHandler = (payload: Record<string, unknown>, context: BackgroundJobContext) => Promise<void>;

const INSTANCE_ID = `${process.pid}:${randomUUID()}`;
const POLL_INTERVAL_MS = 1_000;
const LEASE_MS = 10 * 60_000;
const DEFAULT_CONCURRENCY = env.BACKGROUND_JOB_CONCURRENCY;
const handlers = new Map<string, BackgroundJobHandler>();
const activeJobs = new Set<Promise<void>>();
let pollTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let polling = false;
let stopping = false;
let lastClaimAt: string | null = null;
let lastPollAt: string | null = null;
let lastError: string | null = null;
let completedSinceStart = 0;
let failedSinceStart = 0;
let writeBlockedWarningEmitted = false;

export function registerBackgroundJobHandler(type: string, handler: BackgroundJobHandler) {
  handlers.set(type, handler);
}

export async function enqueueBackgroundJob(input: {
  idempotencyKey: string;
  maxAttempts?: number;
  payload: Record<string, unknown>;
  priority?: number;
  reviveTerminal?: boolean;
  type: string;
}) {
  const { backgroundJobs } = await getMongoCollections();
  const now = new Date();
  const id = createJobId(input.type, input.idempotencyKey);
  await backgroundJobs.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        _id: id,
        attempts: 0,
        availableAt: now,
        completedAt: null,
        createdAt: now,
        idempotencyKey: input.idempotencyKey,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        lockedUntil: null,
        logs: [{ at: now, message: "Job enfileirado.", status: "pending" }],
        maxAttempts: Math.max(1, Math.min(10, input.maxAttempts ?? 3)),
        payload: input.payload,
        priority: Math.max(-100, Math.min(100, input.priority ?? 0)),
        status: "pending",
        type: input.type,
        updatedAt: now
      }
    },
    { upsert: true }
  );
  if (input.reviveTerminal) {
    await backgroundJobs.updateOne(
      { _id: id, status: { $in: ["completed", "failed"] } },
      { $set: { attempts: 0, availableAt: now, completedAt: null, lastError: null, status: "pending", updatedAt: now } }
    );
  }
  return backgroundJobs.findOne({ _id: id });
}

export function startBackgroundJobWorker() {
  if (pollTimer) return;
  stopping = false;
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  heartbeatTimer = setInterval(() => void writeWorkerHeartbeat(), 10_000);
  void writeWorkerHeartbeat();
  void poll();
}

export async function stopBackgroundJobWorker(timeoutMs = 15_000) {
  const wasRunning = Boolean(pollTimer || heartbeatTimer);
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  pollTimer = null;
  heartbeatTimer = null;
  await Promise.race([
    Promise.allSettled([...activeJobs]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
  if (wasRunning) {
    await getMongoCollections()
      .then(({ serviceHeartbeats }) => serviceHeartbeats.deleteOne({ _id: INSTANCE_ID }))
      .catch(() => undefined);
  }
}

export async function backgroundJobHealth() {
  const { backgroundJobs, serviceHeartbeats } = await getMongoCollections();
  const now = new Date();
  const [pending, running, failed, oldestPending, activeWorkers] = await Promise.all([
    backgroundJobs.countDocuments({ status: "pending" }, { limit: 10_000 }),
    backgroundJobs.countDocuments({ status: "running" }, { limit: 10_000 }),
    backgroundJobs.countDocuments({ status: "failed", updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60_000) } }, { limit: 10_000 }),
    backgroundJobs.findOne({ status: "pending" }, { sort: { createdAt: 1 }, projection: { createdAt: 1, availableAt: 1 } }),
    serviceHeartbeats.countDocuments({ service: "background-worker", expiresAt: { $gt: now } })
  ]);
  return {
    activeLocal: activeJobs.size,
    activeWorkers,
    completedSinceStart,
    concurrency: DEFAULT_CONCURRENCY,
    failedLast24Hours: failed,
    failedSinceStart,
    instanceId: INSTANCE_ID,
    lastClaimAt,
    lastError,
    lastPollAt,
    oldestPendingAgeMs: oldestPending ? Math.max(0, now.getTime() - oldestPending.createdAt.getTime()) : 0,
    pending,
    running,
    status: stopping ? "stopping" : pollTimer ? "running" : activeWorkers > 0 ? "remote" : "disabled"
  };
}

async function poll() {
  if (polling || stopping || activeJobs.size >= DEFAULT_CONCURRENCY) return;
  polling = true;
  lastPollAt = new Date().toISOString();
  try {
    const capacity = DEFAULT_CONCURRENCY - activeJobs.size;
    for (let index = 0; index < capacity; index += 1) {
      const job = await claimNextJob().catch((error) => {
        lastError = readError(error);
        if (isMongoWriteBlockedError(error)) {
          pauseWorkerForWriteBlock(lastError);
          return null;
        }
        console.error("[background-jobs] falha ao buscar job:", lastError);
        return null;
      });
      if (!job) break;
      const task = processClaimedJob(job).finally(() => activeJobs.delete(task));
      activeJobs.add(task);
    }
  } finally {
    polling = false;
  }
}

async function writeWorkerHeartbeat() {
  const { serviceHeartbeats } = await getMongoCollections();
  const now = new Date();
  await serviceHeartbeats.updateOne(
    { _id: INSTANCE_ID },
    {
      $set: {
        expiresAt: new Date(now.getTime() + 30_000),
        instanceId: INSTANCE_ID,
        metadata: { activeJobs: activeJobs.size, concurrency: DEFAULT_CONCURRENCY },
        service: "background-worker",
        updatedAt: now
      },
      $setOnInsert: { startedAt: now }
    },
    { upsert: true }
  ).catch((error) => {
    lastError = readError(error);
  });
}

async function claimNextJob() {
  const { backgroundJobs } = await getMongoCollections();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LEASE_MS);
  const job = await backgroundJobs.findOneAndUpdate(
    {
      $or: [
        { status: "pending", availableAt: { $lte: now } },
        { status: "running", lockedUntil: { $lte: now } }
      ],
      type: { $in: [...handlers.keys()] }
    },
    {
      $inc: { attempts: 1 },
      $push: { logs: { $each: [{ at: now, message: `Job assumido por ${INSTANCE_ID}.`, status: "running" }], $slice: -50 } },
      $set: { lastError: null, lockedAt: now, lockedBy: INSTANCE_ID, lockedUntil, status: "running", updatedAt: now }
    },
    { returnDocument: "after", sort: { priority: -1, createdAt: 1 } }
  );
  if (job) lastClaimAt = now.toISOString();
  return job;
}

async function processClaimedJob(job: MongoBackgroundJob) {
  const handler = handlers.get(job.type);
  if (!handler) return;
  const heartbeat = setInterval(() => void renewLease(job._id), Math.floor(LEASE_MS / 3));
  heartbeat.unref();

  try {
    await handler(job.payload, { attempt: job.attempts, jobId: job._id, maxAttempts: job.maxAttempts });
    await completeJob(job._id);
    completedSinceStart += 1;
  } catch (error) {
    lastError = readError(error);
    const terminal = job.attempts >= job.maxAttempts;
    await failOrRetryJob(job._id, job.attempts, terminal, lastError);
    if (terminal) failedSinceStart += 1;
  } finally {
    clearInterval(heartbeat);
  }
}

async function renewLease(jobId: string) {
  const { backgroundJobs } = await getMongoCollections();
  await backgroundJobs.updateOne(
    { _id: jobId, lockedBy: INSTANCE_ID, status: "running" },
    { $set: { lockedUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() } }
  ).catch(() => undefined);
}

async function completeJob(jobId: string) {
  const { backgroundJobs } = await getMongoCollections();
  const now = new Date();
  await backgroundJobs.updateOne(
    { _id: jobId, lockedBy: INSTANCE_ID, status: "running" },
    {
      $push: { logs: { $each: [{ at: now, message: "Job concluido.", status: "completed" }], $slice: -50 } },
      $set: { completedAt: now, lockedBy: null, lockedUntil: null, status: "completed", updatedAt: now }
    }
  );
}

async function failOrRetryJob(jobId: string, attempt: number, terminal: boolean, message: string) {
  const { backgroundJobs } = await getMongoCollections();
  const now = new Date();
  const delayMs = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
  await backgroundJobs.updateOne(
    { _id: jobId, lockedBy: INSTANCE_ID, status: "running" },
    {
      $push: { logs: { $each: [{ at: now, message, status: terminal ? "failed" : "retry" }], $slice: -50 } },
      $set: {
        availableAt: terminal ? now : new Date(now.getTime() + delayMs),
        completedAt: terminal ? now : null,
        lastError: message.slice(0, 2_000),
        lockedBy: null,
        lockedUntil: null,
        status: terminal ? "failed" : "pending",
        updatedAt: now
      }
    }
  );
}

function createJobId(type: string, idempotencyKey: string) {
  return createHash("sha256").update(`${type}:${idempotencyKey}`).digest("hex");
}

function readError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function isMongoWriteBlockedError(error: unknown) {
  const message = readError(error).toLowerCase();
  return message.includes("over your space quota") || message.includes("writes are blocked");
}

function pauseWorkerForWriteBlock(message: string) {
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  pollTimer = null;
  heartbeatTimer = null;
  stopping = true;

  if (!writeBlockedWarningEmitted) {
    writeBlockedWarningEmitted = true;
    console.warn("[background-jobs] MongoDB bloqueou escritas por quota; worker pausado ate liberar espaco no Atlas.");
    console.warn(`[background-jobs] ultimo erro: ${message.split("\n")[0] ?? message}`);
  }
}
