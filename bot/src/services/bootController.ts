export type BotBootState =
  | "BOOTING"
  | "STARTING_CORE"
  | "STARTING_DISCORD"
  | "STARTING_CRITICAL_MODULES"
  | "STARTING_NORMAL_MODULES"
  | "STARTING_BACKGROUND"
  | "HEALTH_CHECK"
  | "ONLINE"
  | "DEGRADED"
  | "FAILED";

export type BotBootTier = "critical" | "normal" | "background";
export type BotBootComponentStatus = "PENDING" | "CONNECTING" | "READY" | "FAILED" | "RECOVERING" | "SKIPPED";

export type BotBootTask = {
  dependencies?: string[];
  enabled: boolean;
  name: string;
  run: () => Promise<void> | void;
  tier: BotBootTier;
};

export type BotBootSnapshot = {
  components: Array<{
    attempts: number;
    dependencies: string[];
    durationMs: number | null;
    error: string | null;
    name: string;
    status: BotBootComponentStatus;
    tier: BotBootTier;
    updatedAt: string;
  }>;
  elapsedMs: number;
  memory: {
    arrayBuffersMb: number;
    externalMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
    rssMb: number;
  };
  progress: number;
  state: BotBootState;
  status: "booting" | "online" | "degraded" | "failed";
  targetMs: number;
  timeoutMs: number;
  updatedAt: string;
};

const TARGET_MS = 60_000;
const HEALTHY_MS = 90_000;
const TIMEOUT_MS = 120_000;

export class BotBootController {
  private readonly components = new Map<string, BotBootSnapshot["components"][number]>();
  private readonly startedAt = Date.now();
  private state: BotBootState = "BOOTING";
  private updatedAt = new Date().toISOString();

  setState(state: BotBootState) {
    this.state = state;
    this.updatedAt = new Date().toISOString();
    console.log(`[BOOT] ${state}`);
  }

  markReady(name: string, tier: BotBootTier = "critical") {
    const now = new Date().toISOString();
    this.components.set(name, {
      attempts: 1,
      dependencies: [],
      durationMs: 0,
      error: null,
      name,
      status: "READY",
      tier,
      updatedAt: now
    });
    this.updatedAt = now;
    console.log(`[BOOT] ${name}: READY`);
  }

  async runTier(state: BotBootState, tasks: BotBootTask[], concurrency: number) {
    if (this.state !== "ONLINE" && this.state !== "DEGRADED") {
      this.setState(state);
    }
    const enabled = tasks.filter((task) => task.enabled);
    await runLimited(enabled, Math.max(1, concurrency), (task) => this.runTask(task));
  }

  startBackground(tasks: BotBootTask[], concurrency: number) {
    if (this.state !== "ONLINE" && this.state !== "DEGRADED") {
      this.setState("STARTING_BACKGROUND");
    }

    const enabled = tasks.filter((task) => task.enabled);
    void runLimited(enabled, Math.max(1, concurrency), (task) => this.runTask(task)).then(() => this.finish());
  }

  finish() {
    const hasCriticalFailure = [...this.components.values()].some((component) => component.tier === "critical" && component.status === "FAILED");
    const hasFailure = [...this.components.values()].some((component) => component.status === "FAILED");
    const elapsed = Date.now() - this.startedAt;
    this.setState(hasCriticalFailure ? "FAILED" : hasFailure || elapsed > HEALTHY_MS ? "DEGRADED" : "ONLINE");
    console.log(`[BOOT] Startup completed in ${elapsed}ms status=${this.state}`);
  }

  snapshot(): BotBootSnapshot {
    const components = [...this.components.values()];
    const complete = components.filter((component) => (
      component.status === "READY" || component.status === "FAILED" || component.status === "SKIPPED"
    )).length;
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
      elapsedMs: Date.now() - this.startedAt,
      memory: {
        arrayBuffersMb: mb(memory.arrayBuffers),
        externalMb: mb(memory.external),
        heapTotalMb: mb(memory.heapTotal),
        heapUsedMb: mb(memory.heapUsed),
        rssMb: mb(memory.rss)
      },
      progress: components.length ? Math.round((complete / components.length) * 100) : 0,
      state: this.state,
      status,
      targetMs: TARGET_MS,
      timeoutMs: TIMEOUT_MS,
      updatedAt: this.updatedAt
    };
  }

  private async runTask(task: BotBootTask) {
    const blocked = (task.dependencies ?? []).find((dependency) => this.components.get(dependency)?.status === "FAILED");
    if (blocked) {
      this.write(task, "SKIPPED", 0, `dependencia falhou: ${blocked}`);
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      this.write(task, attempt === 1 ? "CONNECTING" : "RECOVERING", null, null, attempt);
      const startedAt = Date.now();
      try {
        await withTimeout(Promise.resolve(task.run()), 15_000);
        this.write(task, "READY", Date.now() - startedAt, null, attempt);
        return;
      } catch (error) {
        lastError = error;
        this.write(task, "FAILED", Date.now() - startedAt, readError(error), attempt);
        if (attempt < 3) await delay(retryDelay(500, attempt));
      }
    }

    if (task.tier === "critical") {
      console.warn(`[BOOT] critical module ${task.name} failed: ${readError(lastError)}`);
    }
  }

  private write(task: BotBootTask, status: BotBootComponentStatus, durationMs: number | null, error: string | null, attempts = 0) {
    const now = new Date().toISOString();
    this.components.set(task.name, {
      attempts,
      dependencies: task.dependencies ?? [],
      durationMs,
      error,
      name: task.name,
      status,
      tier: task.tier,
      updatedAt: now
    });
    this.updatedAt = now;
    console.log(`[BOOT] ${task.name}: ${status}${durationMs !== null ? ` ${durationMs}ms` : ""}${error ? ` error=${error}` : ""}`);
  }
}

export const botBootController = new BotBootController();

async function runLimited<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item) await run(item);
    }
  });
  await Promise.all(workers);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(baseDelayMs: number, attempt: number) {
  return Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1) + Math.floor(Math.random() * baseDelayMs));
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
