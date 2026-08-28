type QueuedTask = {
  enqueuedAt: number;
  name: string;
  priority: TaskPriority;
  run: () => Promise<unknown>;
};

export type TaskPriority = "high" | "normal" | "low";

type PriorityBuckets = {
  high: QueuedTask[];
  low: QueuedTask[];
  normal: QueuedTask[];
};

type TaskPriorityInput = boolean | TaskPriority;

type QueueSnapshot = {
  active: number;
  concurrency: number;
  maxPending: number;
  oldestPendingMs: number;
  pending: number;
  pendingByPriority: Record<TaskPriority, number>;
};

function normalizePriority(priority: TaskPriorityInput | undefined): TaskPriority {
  if (priority === "high" || priority === "normal" || priority === "low") {
    return priority;
  }

  return priority ? "high" : "normal";
}

function createBuckets(): PriorityBuckets {
  return {
    high: [],
    low: [],
    normal: []
  };
}

function pendingCount(buckets: PriorityBuckets) {
  return buckets.high.length + buckets.normal.length + buckets.low.length;
}

function oldestPendingAt(buckets: PriorityBuckets) {
  const candidates = [buckets.high[0], buckets.normal[0], buckets.low[0]].filter(Boolean) as QueuedTask[];
  return candidates.reduce((oldest, task) => Math.min(oldest, task.enqueuedAt), Number.POSITIVE_INFINITY);
}

function snapshotBuckets(buckets: PriorityBuckets) {
  return {
    high: buckets.high.length,
    low: buckets.low.length,
    normal: buckets.normal.length
  };
}

function pushTask(buckets: PriorityBuckets, task: QueuedTask) {
  buckets[task.priority].push(task);
}

function shiftTask(buckets: PriorityBuckets) {
  return buckets.high.shift() ?? buckets.normal.shift() ?? buckets.low.shift() ?? null;
}

export class BoundedTaskQueue {
  private active = 0;
  private accepting = true;
  private readonly idleWaiters = new Set<() => void>();
  private readonly pending = createBuckets();
  private lastOverloadLogAt = 0;

  constructor(
    private readonly concurrency: number,
    private readonly maxPending: number,
    private readonly onError: (name: string, error: unknown) => void
  ) {}

  enqueue(name: string, run: () => Promise<unknown>, priority: TaskPriorityInput = false) {
    if (!this.accepting) {
      return false;
    }

    const taskPriority = normalizePriority(priority);
    const nextTask: QueuedTask = {
      enqueuedAt: Date.now(),
      name,
      priority: taskPriority,
      run
    };

    const currentPending = pendingCount(this.pending);

    if (currentPending >= this.maxPending) {
      if (!this.makeRoomFor(taskPriority)) {
        this.logOverload();
        return false;
      }
    }

    pushTask(this.pending, nextTask);
    this.drain();
    return true;
  }

  snapshot(): QueueSnapshot {
    const totalPending = pendingCount(this.pending);
    const oldestAt = oldestPendingAt(this.pending);
    return {
      active: this.active,
      concurrency: this.concurrency,
      maxPending: this.maxPending,
      oldestPendingMs: Number.isFinite(oldestAt) ? Math.max(0, Date.now() - oldestAt) : 0,
      pending: totalPending,
      pendingByPriority: snapshotBuckets(this.pending)
    };
  }

  async stopAndDrain(timeoutMs: number) {
    this.accepting = false;
    if (this.active === 0 && pendingCount(this.pending) === 0) return;

    await Promise.race([
      new Promise<void>((resolve) => this.idleWaiters.add(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }

  private drain() {
    while (this.active < this.concurrency && pendingCount(this.pending)) {
      const task = shiftTask(this.pending);
      if (!task) return;
      this.active += 1;
      void task.run()
        .catch((error) => this.onError(task.name, error))
        .finally(() => {
          this.active -= 1;
          this.drain();
          if (this.active === 0 && pendingCount(this.pending) === 0) {
            for (const resolve of this.idleWaiters) resolve();
            this.idleWaiters.clear();
          }
        });
    }
  }

  private makeRoomFor(priority: TaskPriority) {
    if (priority === "high") {
      if (this.pending.low.shift()) return true;
      if (this.pending.normal.shift()) return true;
      return false;
    }

    if (priority === "normal") {
      if (this.pending.low.shift()) return true;
      return false;
    }

    return false;
  }

  private logOverload() {
    if (Date.now() - this.lastOverloadLogAt <= 10_000) {
      return;
    }

    this.lastOverloadLogAt = Date.now();
    console.error(JSON.stringify({
      active: this.active,
      at: new Date().toISOString(),
      level: "critical",
      maxPending: this.maxPending,
      module: "gateway-events",
      pending: pendingCount(this.pending),
      pendingByPriority: snapshotBuckets(this.pending),
      type: "queue_overload"
    }));
  }
}
