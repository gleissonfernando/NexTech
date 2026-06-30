import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";
import { runAccessControlStartupAudit } from "./services/accessStartupAuditService";
import { markDevBotsOfflineAfterBackendRestart } from "./services/devBotService";
import { startRegisteredDevBots, stopAllDevBotProcesses } from "./services/devBotRuntimeService";
import { processQueuedGiveawayEnd, processQueuedGiveawayStart, startGiveawayScheduler } from "./services/giveawayService";
import { processQueuedServerBackupCapture, processQueuedServerBackupRestore, startServerBackupScheduler } from "./services/serverBackupService";
import { startVoiceRecorderRetentionScheduler } from "./services/voiceRecorderService";
import { registerBackgroundJobHandler, startBackgroundJobWorker, stopBackgroundJobWorker } from "./services/backgroundJobService";

const httpServer = createServer(app);
let shuttingDown = false;

httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 70_000;
httpServer.requestTimeout = 30_000;
httpServer.maxHeadersCount = 100;

createSocketServer(httpServer);
registerBackgroundJobHandler("server-backup.restore", processQueuedServerBackupRestore);
registerBackgroundJobHandler("server-backup.capture", processQueuedServerBackupCapture);
registerBackgroundJobHandler("giveaway.start", processQueuedGiveawayStart);
registerBackgroundJobHandler("giveaway.end", processQueuedGiveawayEnd);

httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`[api] rodando em ${env.FRONTEND_URL} (${env.HOST}:${env.PORT})`);
  if (env.BACKGROUND_WORKER_ENABLED) startBackgroundJobWorker();
  if (env.SCHEDULER_ENABLED) {
    startGiveawayScheduler();
    startServerBackupScheduler();
    startVoiceRecorderRetentionScheduler();
  }
  void markDevBotsOfflineAfterBackendRestart()
    .then((count) => {
      if (count > 0) {
        console.log(`[dev-bot] ${count} bot(s) marcado(s) como offline apos restart do backend.`);
      }
    })
    .catch((error) => {
      console.warn("[dev-bot] nao foi possivel reconciliar status no boot:", error instanceof Error ? error.message : error);
    })
    .then(() => runAccessControlStartupAudit())
    .catch((error) => {
      console.warn("[access-audit] varredura inicial falhou:", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      if (env.START_REGISTERED_DEV_BOTS) {
        void startRegisteredDevBots();
      } else {
        console.log("[dev-bot] start automatico desativado. Use START_REGISTERED_DEV_BOTS=true para habilitar.");
      }
    });
});

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] encerrando por ${signal}`);
  const forceExit = setTimeout(() => process.exit(exitCode || 1), 25_000);
  forceExit.unref();
  const closeHttp = new Promise<void>((resolve) => httpServer.close(() => resolve()));
  void Promise.allSettled([closeHttp, stopBackgroundJobWorker(), stopAllDevBotProcesses()]).finally(() => process.exit(exitCode));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
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

function readProcessError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
