import { getMongoCollections, getMongoDb } from "../database/mongo";
import { getRedisClient } from "../database/redis";

export type BootState =
  | "BOOTING"
  | "STARTING_DATABASE"
  | "STARTING_REDIS"
  | "STARTING_CORE"
  | "STARTING_DISCORD"
  | "STARTING_CRITICAL_MODULES"
  | "STARTING_NORMAL_MODULES"
  | "STARTING_BACKGROUND"
  | "HEALTH_CHECK"
  | "ONLINE"
  | "DEGRADED"
  | "FAILED";

export type BootComponentStatus = "PENDING" | "CONNECTING" | "READY" | "FAILED" | "RECOVERING" | "SKIPPED";
export type BootComponentCriticality = "critical" | "important" | "optional";

export type BootComponentSnapshot = {
  attempts: number;
  criticality: BootComponentCriticality;
  dependencies: string[];
  durationMs: number | null;
  error: string | null;
  name: string;
  startedAt: string | null;
  status: BootComponentStatus;
  updatedAt: string;
};

export type BootSnapshot = {
  components: BootComponentSnapshot[];
  elapsedMs: number;
  memory: {
    arrayBuffersMb: number;
    externalMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
    rssMb: number;
  };
  progress: number;
  state: BootState;
  status: "booting" | "online" | "degraded" | "failed";
  targetMs: number;
  timeoutMs: number;
  updatedAt: string;
};

type BootTask = {
  criticality: BootComponentCriticality;
  dependencies?: string[];
  name: string;
  run: () => Promise<void> | void;
};

type RetryOptions = {
  baseDelayMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
};

const BOOT_TARGET_MS = 60_000;
const BOOT_HEALTHY_MS = 90_000;
const BOOT_TIMEOUT_MS = 120_000;
const MAX_EVENTS = 200;

export class BootController {
  private readonly components = new Map<string, BootComponentSnapshot>();
  private readonly events: string[] = [];
  private readonly startedAt = Date.now();
  private completedAt: number | null = null;
  private state: BootState = "BOOTING";
  private updatedAt = new Date().toISOString();

  setState(state: BootState) {
    this.state = state;
    this.touch();
    this.log(`State ${state}`);
  }

  async startDatabase() {
    this.setState("STARTING_DATABASE");
    await this.runTask({
      name: "MongoDB",
      criticality: "critical",
      run: async () => {
        const db = await getMongoDb();
        await db.command({ ping: 1 });
      }
    }, { maxAttempts: 4, timeoutMs: 20_000, baseDelayMs: 750 });

    // A criação de índices só acontece dentro de getMongoCollections(), que o
    // ping acima não chama — então a PRIMEIRA requisição pagava por centenas de
    // createIndex e pelas migrações de coleção, e todas as requisições
    // concorrentes ficavam bloqueadas nela. Aquecer aqui, sem bloquear o boot:
    // a promise é memoizada, então quem chegar antes do fim apenas a aguarda.
    void getMongoCollections().catch((error) => {
      console.warn("[mongo] aquecimento de indices falhou; será refeito sob demanda:", error instanceof Error ? error.message : error);
    });
  }

  async startRedis() {
    this.setState("STARTING_REDIS");
    const redis = getRedisClient();

    if (!redis) {
      this.skip("Redis", "important", "REDIS_URL nao configurado");
      return;
    }

    await this.runTask({
      name: "Redis",
      criticality: "important",
      dependencies: ["MongoDB"],
      run: async () => {
        await redis.ping();
      }
    }, { maxAttempts: 3, timeoutMs: 5_000, baseDelayMs: 500 });
  }

  async startCore(run: () => Promise<void> | void) {
    this.setState("STARTING_CORE");
    await this.runTask({
      name: "Core",
      criticality: "critical",
      dependencies: ["MongoDB"],
      run
    }, { maxAttempts: 2, timeoutMs: 20_000, baseDelayMs: 500 });
  }

  async startCriticalModules(tasks: BootTask[]) {
    this.setState("STARTING_CRITICAL_MODULES");
    await this.runTasks(tasks);
  }

  startBackgroundModules(tasks: BootTask[]) {
    if (this.state !== "ONLINE" && this.state !== "DEGRADED") {
      this.setState("STARTING_BACKGROUND");
    }
    void this.runTasks(tasks).then(() => {
      if (this.state !== "FAILED") {
        this.finish();
      }
    }).catch((error) => {
      this.log(`Background startup failed: ${readError(error)}`);
      this.finish();
    });
  }

  async healthCheck(run: () => Promise<void> | void) {
    this.setState("HEALTH_CHECK");
    await this.runTask({
      name: "Health",
      criticality: "critical",
      dependencies: ["MongoDB", "Core"],
      run
    }, { maxAttempts: 2, timeoutMs: 10_000, baseDelayMs: 500 });
    this.finish();
  }

  finish() {
    const hasCriticalFailure = [...this.components.values()].some((component) => (
      component.criticality === "critical" && component.status === "FAILED"
    ));
    const hasFailure = [...this.components.values()].some((component) => component.status === "FAILED");
    const wasCompleted = this.completedAt !== null;
    const now = Date.now();

    if (!this.completedAt) this.completedAt = now;
    const elapsed = this.completedAt - this.startedAt;
    this.setState(hasCriticalFailure ? "FAILED" : hasFailure || (!wasCompleted && elapsed > BOOT_HEALTHY_MS) ? "DEGRADED" : "ONLINE");
    this.log(`Completed in ${elapsed}ms with ${this.state}`);
  }

  snapshot(): BootSnapshot {
    const components = [...this.components.values()];
    const complete = components.filter((component) => (
      component.status === "READY" || component.status === "SKIPPED" || component.status === "FAILED"
    )).length;
    const progress = components.length ? Math.round((complete / components.length) * 100) : 0;
    const memory = process.memoryUsage();
    const status = this.state === "ONLINE"
      ? "online"
      : this.state === "DEGRADED"
        ? "degraded"
        : this.state === "FAILED"
          ? "failed"
          : "booting";

    return {
      components,
      elapsedMs: (this.completedAt ?? Date.now()) - this.startedAt,
      memory: {
        arrayBuffersMb: mb(memory.arrayBuffers),
        externalMb: mb(memory.external),
        heapTotalMb: mb(memory.heapTotal),
        heapUsedMb: mb(memory.heapUsed),
        rssMb: mb(memory.rss)
      },
      progress,
      state: this.state,
      status,
      targetMs: BOOT_TARGET_MS,
      timeoutMs: BOOT_TIMEOUT_MS,
      updatedAt: this.updatedAt
    };
  }

  private async runTasks(tasks: BootTask[]) {
    for (const task of tasks) {
      const blocked = (task.dependencies ?? []).find((dependency) => {
        const state = this.components.get(dependency);
        return state?.criticality === "critical" && state.status === "FAILED";
      });

      if (blocked) {
        this.skip(task.name, task.criticality, `dependencia falhou: ${blocked}`, task.dependencies);
        continue;
      }

      await this.runTask(task);
    }
  }

  private async runTask(task: BootTask, options: RetryOptions = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 750;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.mark(task, attempt, attempt === 1 ? "CONNECTING" : "RECOVERING");
      const startedAt = Date.now();

      try {
        await withTimeout(Promise.resolve(task.run()), options.timeoutMs ?? 15_000);
        this.complete(task.name, Date.now() - startedAt);
        return;
      } catch (error) {
        lastError = error;
        this.fail(task, attempt, Date.now() - startedAt, error);

        if (attempt < maxAttempts) {
          const delayMs = retryDelay(baseDelayMs, attempt);
          this.log(`${task.name} retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms`);
          await delay(delayMs);
        }
      }
    }

    if (task.criticality === "critical") {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  }

  private mark(task: BootTask, attempts: number, status: BootComponentStatus) {
    const now = new Date().toISOString();
    const current = this.components.get(task.name);
    this.components.set(task.name, {
      attempts,
      criticality: task.criticality,
      dependencies: task.dependencies ?? current?.dependencies ?? [],
      durationMs: current?.durationMs ?? null,
      error: null,
      name: task.name,
      startedAt: current?.startedAt ?? now,
      status,
      updatedAt: now
    });
    this.touch(now);
    this.log(`${task.name}: ${status}`);
  }

  private complete(name: string, durationMs: number) {
    const current = this.components.get(name);
    if (!current) return;
    const now = new Date().toISOString();
    this.components.set(name, {
      ...current,
      durationMs,
      error: null,
      status: "READY",
      updatedAt: now
    });
    this.touch(now);
    this.log(`${name}: READY ${durationMs}ms`);
  }

  private fail(task: BootTask, attempts: number, durationMs: number, error: unknown) {
    const current = this.components.get(task.name);
    const now = new Date().toISOString();
    this.components.set(task.name, {
      attempts,
      criticality: task.criticality,
      dependencies: task.dependencies ?? current?.dependencies ?? [],
      durationMs,
      error: readError(error),
      name: task.name,
      startedAt: current?.startedAt ?? now,
      status: "FAILED",
      updatedAt: now
    });
    this.touch(now);
    this.log(`${task.name}: FAILED attempt=${attempts} error=${readError(error)}`);
  }

  private skip(name: string, criticality: BootComponentCriticality, reason: string, dependencies: string[] = []) {
    const now = new Date().toISOString();
    this.components.set(name, {
      attempts: 0,
      criticality,
      dependencies,
      durationMs: 0,
      error: reason,
      name,
      startedAt: now,
      status: "SKIPPED",
      updatedAt: now
    });
    this.touch(now);
    this.log(`${name}: SKIPPED ${reason}`);
  }

  private log(message: string) {
    const line = `[BOOT] ${message}`;
    this.events.push(line);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    console.log(line);
  }

  private touch(now = new Date().toISOString()) {
    this.updatedAt = now;
  }
}

export const bootController = new BootController();

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(baseDelayMs: number, attempt: number) {
  const jitter = Math.floor(Math.random() * Math.max(100, baseDelayMs));
  return Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1) + jitter);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`timeout após ${timeoutMs}ms`)), timeoutMs);
        timeout.unref();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function mb(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}
