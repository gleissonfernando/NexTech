import { startGiveawayScheduler } from "./services/giveawayService";
import { startServerBackupScheduler } from "./services/serverBackupService";
import { processDueSystemUpdates } from "./services/updateSystemService";

startGiveawayScheduler();
startServerBackupScheduler();
const updatesScheduler = setInterval(() => {
  void processDueSystemUpdates().catch((error) => {
    console.error("[scheduler] falha ao processar atualizações agendadas:", error instanceof Error ? error.message : error);
  });
}, 60_000);
updatesScheduler.unref();
console.log(`[scheduler] iniciado pid=${process.pid}`);

const keepAlive = setInterval(() => undefined, 60 * 60_000);
let shuttingDown = false;

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[scheduler] encerrando por ${signal}`);
  clearInterval(keepAlive);
  clearInterval(updatesScheduler);
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: readError(reason), level: "critical", service: "scheduler", type: "unhandledRejection" }));
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: readError(error), level: "critical", service: "scheduler", type: "uncaughtException" }));
  shutdown("uncaughtException", 1);
});

function readError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
