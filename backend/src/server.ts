import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";
import { runAccessControlStartupAudit } from "./services/accessStartupAuditService";
import { markDevBotsOfflineAfterBackendRestart } from "./services/devBotService";
import { startRegisteredDevBots, stopAllDevBotProcesses } from "./services/devBotRuntimeService";
import { startGiveawayScheduler } from "./services/giveawayService";
import { startServerBackupScheduler } from "./services/serverBackupService";
import { startVoiceRecorderRetentionScheduler } from "./services/voiceRecorderService";

const httpServer = createServer(app);

createSocketServer(httpServer);

httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`[api] rodando em ${env.FRONTEND_URL} (${env.HOST}:${env.PORT})`);
  startGiveawayScheduler();
  startServerBackupScheduler();
  startVoiceRecorderRetentionScheduler();
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

function shutdown(signal: string) {
  console.log(`[api] encerrando por ${signal}`);
  void stopAllDevBotProcesses().finally(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
