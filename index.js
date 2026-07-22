const { spawn } = require("node:child_process");

const child = spawn(process.execPath, ["scripts/start-production.mjs"], {
  env: process.env,
  stdio: "inherit"
});
let shuttingDown = false;

child.on("exit", (code, signal) => {
  if (shuttingDown) {
    process.exit(0);
    return;
  }

  if (signal) {
    console.error(`[start] processo de produção encerrado por ${signal}.`);
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[start] falha ao iniciar aplicacao:", error);
  process.exit(1);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!child.killed) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(0), 25_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
