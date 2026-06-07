import { createServer } from "node:http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./realtime/socket";
import { runAccessControlStartupAudit } from "./services/accessStartupAuditService";
import { startRegisteredDevBots, stopAllDevBotProcesses } from "./services/devBotRuntimeService";

const httpServer = createServer(app);

createSocketServer(httpServer);

httpServer.listen(env.PORT, env.HOST, () => {
  console.log(`[api] rodando em ${env.FRONTEND_URL} (${env.HOST}:${env.PORT})`);
  void runAccessControlStartupAudit()
    .catch((error) => {
      console.warn("[access-audit] varredura inicial falhou:", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      void startRegisteredDevBots();
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
