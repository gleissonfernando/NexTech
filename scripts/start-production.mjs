import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const children = new Set();
loadRuntimeConfigFile();
process.env.NODE_ENV = "production";
process.env.HOST ||= "0.0.0.0";
process.env.PORT ||= process.env.TRANSCRIPT_PORT || "8080";
process.env.TRANSCRIPT_PORT ||= process.env.PORT;
process.env.TRANSCRIPT_BASE_URL ||= process.env.SITE_ORIGIN || process.env.FRONTEND_URL || process.env.BACKEND_URL || "";
process.env.BOT_API_TOKEN ||= packedConfigValue("BOT_API_TOKEN") || randomBytes(32).toString("hex");
process.env.START_REGISTERED_DEV_BOTS ||= packedConfigValue("START_REGISTERED_DEV_BOTS") || (discloudStartEnablesDevBots() ? "true" : "");
process.env.BACKEND_API_URL = `http://127.0.0.1:${process.env.PORT}/api`;
process.env.BACKEND_SOCKET_URL = `http://127.0.0.1:${process.env.PORT}`;

function loadRuntimeConfigFile() {
  const path = ".nex-tech-runtime-env.json";
  if (!existsSync(path)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("arquivo precisa conter um objeto JSON.");
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[A-Z0-9_]+$/.test(key) || value === null || value === undefined) {
        continue;
      }

      if (!process.env[key]?.trim()) {
        process.env[key] = typeof value === "string" ? value : String(value);
      }
    }
  } catch (error) {
    console.warn("[start] .nex-tech-runtime-env.json invalido:", error instanceof Error ? error.message : error);
  }
}

function packedConfigValue(key) {
  const jsonConfig = process.env.APP_CONFIG_JSON?.trim();
  const base64Config =
    process.env.APP_CONFIG_B64?.trim()
    || process.env.APP_CONFIG_BASE64?.trim()
    || process.env.NEX_TECH_CONFIG_B64?.trim();
  const rawConfig = jsonConfig || (base64Config ? Buffer.from(base64Config, "base64").toString("utf8") : "");

  if (!rawConfig) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawConfig);
    const value = parsed?.[key];
    return value === null || value === undefined ? "" : String(value).trim();
  } catch {
    return "";
  }
}

function discloudStartEnablesDevBots() {
  try {
    const config = readFileSync("discloud.config", "utf8");
    const start = config
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("START="))
      ?.split("=")
      .slice(1)
      .join("=")
      .trim();

    return start === "npm run start:discloud" || /\bSTART_REGISTERED_DEV_BOTS=true\b/.test(start ?? "");
  } catch {
    return false;
  }
}

function ensureBuild() {
  const requiredBuildFiles = [
    "backend/dist/server.js",
    "bot/dist/index.js",
    "frontend/dist/index.html",
    "frontend/dist/health"
  ];
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
    "frontend/public",
    "frontend/scripts",
    "frontend/src",
    "frontend/vite.config.mjs"
  ];

  const buildFilesExist = requiredBuildFiles.every((file) => existsSync(file));

  if (buildFilesExist && (process.env.NODE_ENV === "production" || !isBuildStale(requiredBuildFiles, sourcePaths))) {
    return;
  }

  if (process.env.NODE_ENV === "production" && process.env.NEX_TECH_RUNTIME_BUILD !== "true") {
    const missing = requiredBuildFiles.filter((file) => !existsSync(file));
    const detail = missing.length > 0 ? `Arquivos ausentes: ${missing.join(", ")}.` : "Arquivos de build existem, mas parecem desatualizados.";
    console.error(`[start] build de producao nao encontrado. ${detail} Rode o BUILD da hospedagem antes do START.`);
    process.exit(1);
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
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || `--max-old-space-size=${Math.max(256, Number(process.env.NEX_TECH_NODE_MAX_OLD_SPACE_MB) || 512)}`
    },
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
      if (!signal && code === 0 && once) {
        return;
      }

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

  setTimeout(() => process.exit(code), 25_000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

ensureBuild();
startProcess("backend", "node", ["backend/dist/server.js"], { restartDelayMs: 5_000 });
startProcess("bot", "node", [process.env.BOT_SHARDING_ENABLED === "true" ? "bot/dist/shard.js" : "bot/dist/index.js"]);
