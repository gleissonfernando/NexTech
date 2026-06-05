import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const children = new Set();
process.env.NODE_ENV = "production";
process.env.HOST = "0.0.0.0";
process.env.PORT = "80";

function ensureBuild() {
  const requiredBuildFiles = ["backend/dist/server.js", "bot/dist/index.js", "frontend/dist/index.html"];

  if (requiredBuildFiles.every((file) => existsSync(file))) {
    return;
  }

  console.log("[start] build nao encontrado; gerando arquivos de producao...");
  const result = spawnSync("npm", ["run", "build"], {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startProcess(name, command, args, options = {}) {
  const { critical = false, once = false, restartDelayMs = 10_000 } = options;
  const child = spawn(command, args, {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] saiu com ${detail}.`);

    if (critical || once) {
      shutdown(code && code > 0 ? code : 1);
      return;
    }

    console.error(`[${name}] reiniciando em ${Math.round(restartDelayMs / 1000)}s.`);
    setTimeout(() => {
      if (!shuttingDown) {
        startProcess(name, command, args, options);
      }
    }, restartDelayMs).unref();
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;

  for (const child of children) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

ensureBuild();
startProcess("backend", "node", ["backend/dist/server.js"], { critical: true });
startProcess("bot", "node", ["bot/dist/index.js"]);
