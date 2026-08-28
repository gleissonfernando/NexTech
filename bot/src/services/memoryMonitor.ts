import v8 from "node:v8";

export type MemoryPressureStatus = "healthy" | "monitor" | "pressure" | "critical" | "emergency";

export type MemorySample = {
  arrayBuffersMb: number;
  externalMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  resource: {
    fsRead: number;
    fsWrite: number;
    involuntaryContextSwitches: number;
    maxRssMb: number;
    systemCpuMs: number;
    userCpuMs: number;
    voluntaryContextSwitches: number;
  };
  rssMb: number;
  status: MemoryPressureStatus;
  timestamp: string;
  v8: {
    heapSizeLimitMb: number;
    mallocedMemoryMb: number;
    totalAvailableSizeMb: number;
    usedHeapSizeMb: number;
  };
};

export type MemoryMonitorSnapshot = {
  averageRssMb: number;
  checkpoints: MemorySample[];
  history: MemorySample[];
  latest: MemorySample;
  limitMb: number;
  possibleLeak: boolean;
  pressure: MemoryPressureStatus;
  sampleCount: number;
  targetMb: number;
};

type CleanupHandler = (sample: MemorySample) => void | Promise<void>;
type CriticalHandler = (sample: MemorySample, highSamples: number) => void;

const TARGET_MB = 1_300;
const LIMIT_MB = 1_500;
const SAMPLE_INTERVAL_MS = 30_000;
const MAX_HISTORY = 720;
const PRESSURE_CLEANUP_COOLDOWN_MS = 60_000;
const CHECKPOINTS_MS = [0, 5, 15, 30, 60, 180, 360].map((minutes) => minutes * 60_000);

const history: MemorySample[] = [];
const cleanupHandlers = new Set<CleanupHandler>();
const startedAt = Date.now();
let timer: NodeJS.Timeout | null = null;
let highSamples = 0;
let lastCleanupAt = 0;

export function startMemoryMonitor(options: {
  criticalRssMb: number;
  onCritical: CriticalHandler;
}) {
  if (timer) return;
  recordMemorySample("startup", options);
  timer = setInterval(() => {
    recordMemorySample("interval", options);
  }, SAMPLE_INTERVAL_MS);
  timer.unref();
}

export function stopMemoryMonitor() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function registerMemoryPressureCleanup(handler: CleanupHandler) {
  cleanupHandlers.add(handler);
  return () => cleanupHandlers.delete(handler);
}

export function memoryMonitorSnapshot(): MemoryMonitorSnapshot {
  const latest = history.at(-1) ?? recordMemorySample("snapshot");
  const averageRssMb = history.length
    ? Math.round(history.reduce((total, sample) => total + sample.rssMb, 0) / history.length)
    : latest.rssMb;

  return {
    averageRssMb,
    checkpoints: checkpointSamples(history, startedAt),
    history: history.slice(-24),
    latest,
    limitMb: LIMIT_MB,
    possibleLeak: possibleMemoryLeak(history),
    pressure: latest.status,
    sampleCount: history.length,
    targetMb: TARGET_MB
  };
}

export function recordMemorySample(reason = "manual", options?: {
  criticalRssMb: number;
  onCritical: CriticalHandler;
}) {
  const sample = takeMemorySample();
  history.push(sample);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  if (sample.status !== "healthy" && sample.status !== "monitor") {
    console.warn(JSON.stringify({
      at: sample.timestamp,
      level: sample.status === "emergency" ? "critical" : "warning",
      reason,
      rssMb: sample.rssMb,
      service: "bot",
      status: sample.status,
      type: "memory_pressure"
    }));
    void runPressureCleanup(sample);
  }

  if (options) {
    highSamples = sample.rssMb >= options.criticalRssMb ? highSamples + 1 : 0;
    if (highSamples >= 3) {
      options.onCritical(sample, highSamples);
    }
  }

  return sample;
}

export function classifyMemoryPressure(rssMb: number): MemoryPressureStatus {
  if (rssMb > LIMIT_MB) return "emergency";
  if (rssMb >= 1_400) return "critical";
  if (rssMb >= TARGET_MB) return "pressure";
  if (rssMb >= 1_200) return "monitor";
  return "healthy";
}

export function possibleMemoryLeak(samples: Pick<MemorySample, "rssMb">[]) {
  if (samples.length < 6) return false;
  const recent = samples.slice(-6);
  const growth = recent[recent.length - 1]!.rssMb - recent[0]!.rssMb;
  const upwardSteps = recent.slice(1).filter((sample, index) => sample.rssMb >= recent[index]!.rssMb).length;
  return growth >= 100 && upwardSteps >= 4;
}

async function runPressureCleanup(sample: MemorySample) {
  if (Date.now() - lastCleanupAt < PRESSURE_CLEANUP_COOLDOWN_MS) return;
  lastCleanupAt = Date.now();

  for (const handler of cleanupHandlers) {
    try {
      await handler(sample);
    } catch (error) {
      console.warn("[memory] cleanup handler falhou:", error instanceof Error ? error.message : error);
    }
  }
}

function takeMemorySample(): MemorySample {
  const memory = process.memoryUsage();
  const resource = process.resourceUsage();
  const heap = v8.getHeapStatistics();
  const rssMb = mb(memory.rss);

  return {
    arrayBuffersMb: mb(memory.arrayBuffers),
    externalMb: mb(memory.external),
    heapTotalMb: mb(memory.heapTotal),
    heapUsedMb: mb(memory.heapUsed),
    resource: {
      fsRead: resource.fsRead,
      fsWrite: resource.fsWrite,
      involuntaryContextSwitches: resource.involuntaryContextSwitches,
      maxRssMb: mb(resource.maxRSS * 1024),
      systemCpuMs: Math.round(resource.systemCPUTime / 1_000),
      userCpuMs: Math.round(resource.userCPUTime / 1_000),
      voluntaryContextSwitches: resource.voluntaryContextSwitches
    },
    rssMb,
    status: classifyMemoryPressure(rssMb),
    timestamp: new Date().toISOString(),
    v8: {
      heapSizeLimitMb: mb(heap.heap_size_limit),
      mallocedMemoryMb: mb(heap.malloced_memory),
      totalAvailableSizeMb: mb(heap.total_available_size),
      usedHeapSizeMb: mb(heap.used_heap_size)
    }
  };
}

function checkpointSamples(samples: MemorySample[], baseTime: number) {
  return CHECKPOINTS_MS
    .map((checkpoint) => {
      const target = baseTime + checkpoint;
      return samples.find((sample) => Date.parse(sample.timestamp) >= target) ?? null;
    })
    .filter((sample): sample is MemorySample => Boolean(sample));
}

function mb(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}
