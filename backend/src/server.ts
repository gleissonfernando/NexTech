import { createServer } from "node:http";
import { env } from "./config/env";
import { bootController } from "./services/bootController";
import { registerMemoryPressureCleanup, startMemoryMonitor, stopMemoryMonitor } from "./services/memoryMonitor";
import { trimMonitoringSamples } from "./services/monitoringService";

let httpServer: ReturnType<typeof createServer> | null = null;
let shuttingDown = false;
const DEV_BOT_START_RETRY_DELAYS_MS = [15_000, 45_000, 120_000, 300_000];

void main().catch((error) => {
  console.error("[BOOT] backend startup failed:", error instanceof Error ? error.stack ?? error.message : error);
  bootController.finish();
  shutdown("boot failure", 1);
});

async function main() {
  startMemoryMonitor();
  registerMemoryPressureCleanup(() => {
    trimMonitoringSamples();
  });
  bootController.setState("BOOTING");
  await bootController.startDatabase();
  await bootController.startRedis();

  const [
    { app },
    { createSocketServer },
    { runAccessControlStartupAudit },
    { seedDefaultPanelEmojisForAllBots },
    { markDevBotsOfflineAfterBackendRestart },
    devBotRuntime,
    giveaway,
    serverBackup,
    voiceRecorder,
    backgroundJobs,
    { startDiscloudAutoRecoveryService },
    transcripts,
    transcriptMigration,
    botBilling
  ] = await Promise.all([
    import("./app.js"),
    import("./realtime/socket.js"),
    import("./services/accessStartupAuditService.js"),
    import("./services/defaultPanelEmojiService.js"),
    import("./services/devBotService.js"),
    import("./services/devBotRuntimeService.js"),
    import("./services/giveawayService.js"),
    import("./services/serverBackupService.js"),
    import("./services/voiceRecorderService.js"),
    import("./services/backgroundJobService.js"),
    import("./services/discloudMonitoringService.js"),
    import("./services/transcriptService.js"),
    import("./services/transcriptUrlMigrationService.js"),
    import("./services/botBillingService.js")
  ]);

  await bootController.startCore(async () => {
    httpServer = createServer(app);
    httpServer.keepAliveTimeout = 65_000;
    httpServer.headersTimeout = 70_000;
    httpServer.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 0);
    httpServer.maxHeadersCount = 100;

    createSocketServer(httpServer);
    backgroundJobs.registerBackgroundJobHandler("server-backup.restore", serverBackup.processQueuedServerBackupRestore);
    backgroundJobs.registerBackgroundJobHandler("server-backup.capture", serverBackup.processQueuedServerBackupCapture);
    backgroundJobs.registerBackgroundJobHandler("giveaway.start", giveaway.processQueuedGiveawayStart);
    backgroundJobs.registerBackgroundJobHandler("giveaway.end", giveaway.processQueuedGiveawayEnd);

    await new Promise<void>((resolve) => {
      httpServer!.listen(env.PORT, env.HOST, () => {
        console.log(`[api] rodando em ${env.FRONTEND_URL} (${env.HOST}:${env.PORT})`);
        resolve();
      });
    });
  });

  await bootController.startCriticalModules([
    {
      name: "Transcripts",
      criticality: "critical",
      dependencies: ["MongoDB", "Core"],
      run: async () => {
        const transcriptStatus = transcripts.getTranscriptStartupStatus();
        if (!transcriptStatus.ok) {
          throw new Error(transcriptStatus.error);
        }
        console.log(`[transcripts] rota publica pronta em ${transcriptStatus.route} (porta ${transcriptStatus.port})`);
      }
    },
    {
      name: "BackgroundJobs",
      criticality: "important",
      dependencies: ["MongoDB", "Core"],
      run: () => {
        if (env.BACKGROUND_WORKER_ENABLED) backgroundJobs.startBackgroundJobWorker();
      }
    }
  ]);

  await bootController.healthCheck(async () => {
    const response = await fetch(`http://127.0.0.1:${env.PORT}/health/live`);
    if (response.status >= 500) {
      throw new Error(`health live HTTP ${response.status}`);
    }
  });

  const shouldRunDevBotRuntime = env.START_REGISTERED_DEV_BOTS || env.DEV_BOT_RUNTIME_RECONCILE_ENABLED;
  bootController.startBackgroundModules([
    {
      name: "TranscriptMigration",
      criticality: "optional",
      dependencies: ["MongoDB", "Core"],
      run: () => transcriptMigration.runTranscriptUrlStartupMigration()
    },
    {
      name: "Schedulers",
      criticality: "important",
      dependencies: ["MongoDB", "Core"],
      run: () => {
        if (!env.SCHEDULER_ENABLED) return;
        giveaway.startGiveawayScheduler();
        serverBackup.startServerBackupScheduler();
        voiceRecorder.startVoiceRecorderRetentionScheduler();
        startDiscloudAutoRecoveryService();
        botBilling.startBotBillingScheduler();
      }
    },
    {
      name: "BotBillingStartup",
      criticality: "important",
      dependencies: ["MongoDB", "Core"],
      run: async () => {
        const result = await botBilling.processBotBillingCycle("startup");
        console.log(`[bot-billing] rotina inicial concluída: geradas=${result.generated.created} vencidas=${result.overdue.updated} migradas=${result.migration.lifetime + result.migration.monthly}.`);
      }
    },
    {
      name: "DevBotRestartRecovery",
      criticality: "important",
      dependencies: ["MongoDB", "Core"],
      run: async () => {
        if (!shouldRunDevBotRuntime) {
          console.log("[dev-bot] runtime de processos DEV desativado neste app.");
          return;
        }

        const restartRecovery = await markDevBotsOfflineAfterBackendRestart();
        if (restartRecovery.count > 0) {
          console.log(`[dev-bot] ${restartRecovery.count} bot(s) marcado(s) como offline após restart do runtime de bots.`);
        }

        if (env.START_REGISTERED_DEV_BOTS) {
          scheduleRegisteredDevBotStartup(0, devBotRuntime.startRegisteredDevBots);
        }

        if (env.DEV_BOT_RUNTIME_RECONCILE_ENABLED) {
          devBotRuntime.startDevBotRuntimeReconciler();
        }
      }
    },
    {
      name: "AccessStartupAudit",
      criticality: "optional",
      dependencies: ["MongoDB", "Core"],
      run: runAccessControlStartupAudit
    },
    {
      name: "DefaultPanelEmojis",
      criticality: "optional",
      dependencies: ["MongoDB", "Core"],
      run: async () => {
        const results = await seedDefaultPanelEmojisForAllBots();
        const ok = results.filter((result) => result.ok).length;
        if (ok > 0) console.log(`[default-panel-emojis] pacote padrão processado para ${ok} bot(s).`);
      }
    },
    {
      name: "DevBotCommandCleanup",
      criticality: "optional",
      dependencies: ["MongoDB", "Core"],
      run: () => {
        if (!env.DEV_BOT_PROCESS_RUNNER_ENABLED) {
          console.log("[dev-bot] limpeza de comandos ignorada neste app; runtime de processos DEV desativado.");
          return;
        }
        setTimeout(() => {
          void devBotRuntime.cleanupObsoleteDevBotCommands()
            .catch((error: unknown) => {
              console.warn("[dev-bot] limpeza tardia de comandos obsoletos falhou:", error instanceof Error ? error.message : error);
            });
        }, env.DEV_BOT_COMMAND_CLEANUP_DELAY_MS ?? (shouldRunDevBotRuntime ? 15 * 60_000 : 60_000)).unref();
      }
    }
  ]);
}

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] encerrando por ${signal}`);
  const forceExit = setTimeout(() => process.exit(exitCode || 1), 25_000);
  forceExit.unref();
  const closeHttp = httpServer
    ? new Promise<void>((resolve) => httpServer!.close(() => resolve()))
    : Promise.resolve();
  void Promise.allSettled([
    closeHttp,
    Promise.resolve().then(() => stopMemoryMonitor()),
    import("./services/backgroundJobService.js").then(({ stopBackgroundJobWorker }) => stopBackgroundJobWorker()),
    import("./services/devBotRuntimeService.js").then(({ stopDevBotRuntimeReconciler }) => stopDevBotRuntimeReconciler()),
    import("./services/devBotRuntimeService.js").then(({ stopAllDevBotProcesses }) => stopAllDevBotProcesses())
  ]).finally(() => process.exit(exitCode));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  if (isTransientMongoError(reason)) {
    console.warn(JSON.stringify({ level: "warning", service: "backend", type: "mongoTransientRejection", error: readProcessError(reason), at: new Date().toISOString() }));
    return;
  }
  console.error(JSON.stringify({ level: "critical", service: "backend", type: "unhandledRejection", error: readProcessError(reason), at: new Date().toISOString() }));
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ level: "critical", service: "backend", type: "uncaughtException", error: readProcessError(error), at: new Date().toISOString() }));
  shutdown("uncaughtException", 1);
});
process.on("warning", (warning) => {
  console.warn(JSON.stringify({ level: "warning", service: "backend", type: warning.name, error: warning.stack ?? warning.message, at: new Date().toISOString() }));
});

function scheduleRegisteredDevBotStartup(attempt: number, startRegisteredDevBots: () => Promise<number>) {
  void startRegisteredDevBots()
    .then((count) => {
      console.log(`[dev-bot] start automático concluído para ${count} bot(s) cadastrado(s).`);
    })
    .catch((error) => {
      scheduleDevBotStartupRetry({
        attempt,
        label: "start automático",
        retry: () => scheduleRegisteredDevBotStartup(attempt + 1, startRegisteredDevBots),
        error
      });
    });
}


function scheduleDevBotStartupRetry(input: {
  attempt: number;
  error: unknown;
  label: string;
  retry: () => void;
}) {
  const delayMs = DEV_BOT_START_RETRY_DELAYS_MS[input.attempt];

  if (!delayMs || shuttingDown) {
    console.warn(`[dev-bot] ${input.label} falhou definitivamente:`, input.error instanceof Error ? input.error.message : input.error);
    return;
  }

  console.warn(
    `[dev-bot] ${input.label} falhou; nova tentativa em ${Math.round(delayMs / 1000)}s (${input.attempt + 1}/${DEV_BOT_START_RETRY_DELAYS_MS.length}):`,
    input.error instanceof Error ? input.error.message : input.error
  );
  setTimeout(() => {
    if (!shuttingDown) input.retry();
  }, delayMs).unref();
}

function readProcessError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function isTransientMongoError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /Mongo(ServerSelection|Network|NetworkTimeout|PoolCleared)Error/.test(error.name)
    || /Server selection timed out|connection \d+ to .* timed out|Connection pool .* was cleared/i.test(error.message);
}
