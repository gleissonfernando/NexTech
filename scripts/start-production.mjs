import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";

const children = new Set();
process.env.NODE_ENV = "production";
process.env.HOST = "0.0.0.0";
process.env.PORT = "80";

function ensureBuild() {
  const requiredBuildFiles = ["backend/dist/server.js", "bot/dist/index.js", "frontend/dist/index.html"];
  const sourcePaths = [
    ".env",
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    "backend/package.json",
    "backend/src",
    "bot/package.json",
    "bot/src",
    "frontend/index.html",
    "frontend/package.json",
    "frontend/src",
    "frontend/vite.config.ts"
  ];

  if (requiredBuildFiles.every((file) => existsSync(file)) && !isBuildStale(requiredBuildFiles, sourcePaths)) {
    return;
  }

  console.log("[start] build ausente ou desatualizado; gerando arquivos de producao...");
  const result = spawnSync("npm", ["run", "build"], {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fileMtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function newestMtimeMs(targetPath) {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  return readdirSync(targetPath, { withFileTypes: true }).reduce((newest, entry) => {
    const childPath = `${targetPath}/${entry.name}`;
    return Math.max(newest, entry.isDirectory() ? newestMtimeMs(childPath) : fileMtimeMs(childPath));
  }, stats.mtimeMs);
}

function isBuildStale(buildFiles, sourcePaths) {
  const oldestBuild = Math.min(...buildFiles.map(fileMtimeMs));
  const newestSource = Math.max(...sourcePaths.map(newestMtimeMs));

  return newestSource > oldestBuild;
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

    if (!signal && code === 0) {
      return;
    }

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
