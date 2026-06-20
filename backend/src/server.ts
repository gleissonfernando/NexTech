import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";
import { runAccessControlStartupAudit } from "./services/accessStartupAuditService";
import { startRegisteredDevBots, stopAllDevBotProcesses } from "./services/devBotRuntimeService";
import { startGiveawayScheduler } from "./services/giveawayService";
import { startVoiceRecorderRetentionScheduler } from "./services/voiceRecorderService";

const httpServer = createServer(app);

createSocketServer(httpServer);

httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`[api] rodando em ${env.FRONTEND_URL} (${env.HOST}:${env.PORT})`);
  startGiveawayScheduler();
  startVoiceRecorderRetentionScheduler();
  void runAccessControlStartupAudit()
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
