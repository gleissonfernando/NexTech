import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";
import { runAccessControlStartupAudit } from "./services/accessStartupAuditService";
import { seedDefaultPanelEmojisForAllBots } from "./services/defaultPanelEmojiService";
import { markDevBotsOfflineAfterBackendRestart } from "./services/devBotService";
import { cleanupObsoleteDevBotCommands, startAllDevBotProcesses, startRegisteredDevBots, stopAllDevBotProcesses } from "./services/devBotRuntimeService";
import { processQueuedGiveawayEnd, processQueuedGiveawayStart, startGiveawayScheduler } from "./services/giveawayService";
import { processQueuedServerBackupCapture, processQueuedServerBackupRestore, startServerBackupScheduler } from "./services/serverBackupService";
import { startVoiceRecorderRetentionScheduler } from "./services/voiceRecorderService";
import { registerBackgroundJobHandler, startBackgroundJobWorker, stopBackgroundJobWorker } from "./services/backgroundJobService";
import { startDiscloudAutoRecoveryService } from "./services/discloudMonitoringService";
import { getTranscriptStartupStatus } from "./services/transcriptService";
import { runTranscriptUrlStartupMigration } from "./services/transcriptUrlMigrationService";
import { processBotBillingCycle, startBotBillingScheduler } from "./services/botBillingService";

const httpServer = createServer(app);
let shuttingDown = false;

httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 70_000;
httpServer.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 0);
httpServer.maxHeadersCount = 100;

createSocketServer(httpServer);
registerBackgroundJobHandler("server-backup.restore", processQueuedServerBackupRestore);
registerBackgroundJobHandler("server-backup.capture", processQueuedServerBackupCapture);
registerBackgroundJobHandler("giveaway.start", processQueuedGiveawayStart);
registerBackgroundJobHandler("giveaway.end", processQueuedGiveawayEnd);

httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`[api] rodando em ${env.FRONTEND_URL} (${env.HOST}:${env.PORT})`);
  const transcriptStatus = getTranscriptStartupStatus();
  if (transcriptStatus.ok) {
    console.log(`[transcripts] rota publica pronta em ${transcriptStatus.route} (porta ${transcriptStatus.port})`);
    void runTranscriptUrlStartupMigration();
  } else {
    console.error(`[transcripts] configuração inválida: ${transcriptStatus.error}`);
  }
  if (env.BACKGROUND_WORKER_ENABLED) startBackgroundJobWorker();
  if (env.SCHEDULER_ENABLED) {
    startGiveawayScheduler();
    startServerBackupScheduler();
    startVoiceRecorderRetentionScheduler();
    startDiscloudAutoRecoveryService();
    startBotBillingScheduler();
  }
  void processBotBillingCycle("startup")
    .then((result) => {
      console.log(`[bot-billing] rotina inicial concluída: geradas=${result.generated.created} vencidas=${result.overdue.updated} migradas=${result.migration.lifetime + result.migration.monthly}.`);
    })
    .catch((error) => {
      console.warn("[bot-billing] rotina inicial falhou:", error instanceof Error ? error.message : error);
    });
  const devBotRestartRecovery = markDevBotsOfflineAfterBackendRestart()
    .then((restartRecovery) => {
      if (restartRecovery.count > 0) {
        console.log(`[dev-bot] ${restartRecovery.count} bot(s) marcado(s) como offline após restart do backend.`);
      }
      return restartRecovery;
    })
    .catch((error) => {
      console.warn("[dev-bot] não foi possível reconciliar status no boot:", error instanceof Error ? error.message : error);
      return { count: 0, botIds: [] };
    });

  void devBotRestartRecovery
    .then(async (restartRecovery) => {
      await runAccessControlStartupAudit();
      await cleanupObsoleteDevBotCommands();
      return restartRecovery;
    })
    .catch((error) => {
      console.warn("[startup] varredura/limpeza inicial falhou:", error instanceof Error ? error.message : error);
      return { count: 0, botIds: [] };
    })
    .then((restartRecovery) => {
      if (env.START_REGISTERED_DEV_BOTS) {
        void startRegisteredDevBots()
          .then((count) => {
            console.log(`[dev-bot] start automático concluído para ${count} bot(s) cadastrado(s).`);
          })
          .catch((error) => {
            console.warn("[dev-bot] start automático falhou:", error instanceof Error ? error.message : error);
          });
        return;
      }

      if (restartRecovery.botIds.length > 0) {
        void startAllDevBotProcesses(restartRecovery.botIds)
          .then(() => {
            console.log(`[dev-bot] retomada pós-restart solicitada para ${restartRecovery.botIds.length} bot(s) que estavam online.`);
          })
          .catch((error) => {
            console.warn("[dev-bot] retomada pós-restart falhou:", error instanceof Error ? error.message : error);
          });
        return;
      }

      console.log("[dev-bot] start automático desativado. Use START_REGISTERED_DEV_BOTS=true para habilitar.");
    });
  setTimeout(() => {
    void seedDefaultPanelEmojisForAllBots()
      .then((results) => {
        const ok = results.filter((result) => result.ok).length;
        if (ok > 0) console.log(`[default-panel-emojis] pacote padrão processado para ${ok} bot(s).`);
      })
      .catch((error) => {
        console.warn("[default-panel-emojis] falha ao processar pacote padrão:", error instanceof Error ? error.message : error);
      });
  }, 20_000).unref();
  setTimeout(() => {
    void cleanupObsoleteDevBotCommands()
      .catch((error) => {
        console.warn("[dev-bot] limpeza tardia de comandos obsoletos falhou:", error instanceof Error ? error.message : error);
      });
  }, 60_000).unref();
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

function readProcessError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function isTransientMongoError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /Mongo(ServerSelection|Network|NetworkTimeout|PoolCleared)Error/.test(error.name)
    || /Server selection timed out|connection \d+ to .* timed out|Connection pool .* was cleared/i.test(error.message);
}
