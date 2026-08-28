import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const appId = process.env.DISCLOUD_BOTS_APP_ID?.trim() || "1787018855642";
const packageDir = ".discloud-bots-package";

console.log(`[release:bots] app separada NexTech Bots (${appId}) desativada. Use a app principal NexTech.`);
process.exit(0);

function run(command, args, options = {}) {
  const useShell = process.platform === "win32";
  const env = sanitizedEnvironment(options.env);
  const cwd = options.cwd ?? root;
  const result = useShell
    ? spawnSync([command, ...args.map(quoteShellArg)].join(" "), {
      cwd,
      env,
      shell: true,
      stdio: options.capture ? "pipe" : "inherit",
      encoding: "utf8"
    })
    : spawnSync(command, args, {
      cwd,
      env,
      shell: false,
      stdio: options.capture ? "pipe" : "inherit",
      encoding: "utf8"
    });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} falhou com codigo ${result.status ?? 1}.`);
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function commandAvailable(command) {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { cwd: root, shell: false, stdio: "ignore" })
    : spawnSync("sh", ["-c", `command -v ${quoteShellArg(command)}`], { cwd: root, shell: false, stdio: "ignore" });

  return result.status === 0;
}

function runDiscloud(args, options = {}) {
  if (commandAvailable("discloud")) {
    return run("discloud", args, options);
  }

  console.log("[release:bots] CLI global da Discloud não encontrado; usando npx discloud-cli.");
  return run("npx", ["--yes", "discloud-cli", ...args], options);
}

function runDiscloudWithRetry(args, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return runDiscloud(args, options);
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      console.warn(`[release:bots] Discloud falhou na tentativa ${attempt}/3: ${error instanceof Error ? error.message : String(error)}`);
      sleep(15_000);
    }
  }
  throw lastError;
}

function quoteShellArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sanitizedEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
  return env;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function appExists() {
  try {
    runDiscloud(["app", "status", appId], { capture: true });
    return true;
  } catch {
    return false;
  }
}

if (process.env.SKIP_DEPLOY_CHECK !== "true") {
  console.log("[release:bots] Validando build e deploy-check...");
  run("npm", ["run", "deploy:check"]);
} else {
  console.log("[release:bots] deploy-check ignorado; usando build ja validado pelo release principal.");
}

console.log(`[release:bots] Preparando pacote ${appId}...`);
run("node", ["scripts/prepare-discloud-package.mjs"], {
  env: {
    DISCLOUD_PACKAGE_DIR: packageDir,
    DISCLOUD_PACKAGE_NAME: "NexTech Bots",
    DISCLOUD_PACKAGE_ID: appId,
    DISCLOUD_PACKAGE_TYPE: "bot",
    DISCLOUD_PACKAGE_RAM: process.env.DISCLOUD_BOTS_RAM?.trim() || "1024",
    NEX_TECH_RUNTIME_ROLE: "dev-bot-worker",
    START_REGISTERED_DEV_BOTS: "false",
    DEV_BOT_PROCESS_RUNNER_ENABLED: "true",
    DEV_BOT_RUNTIME_RECONCILE_ENABLED: "true",
    DEV_BOT_RUNTIME_RECONCILE_INTERVAL_MS: process.env.DEV_BOT_RUNTIME_RECONCILE_INTERVAL_MS?.trim() || "120000",
    DEV_BOT_START_CONCURRENCY: process.env.DEV_BOT_START_CONCURRENCY?.trim() || "8",
    DEV_BOT_START_STAGGER_MS: process.env.DEV_BOT_START_STAGGER_MS?.trim() || "1000",
    DEV_BOT_MAX_RUNNING_PROCESSES: process.env.DEV_BOT_MAX_RUNNING_PROCESSES?.trim() || "64",
    DEV_BOT_NODE_MAX_OLD_SPACE_MB: process.env.DEV_BOT_NODE_MAX_OLD_SPACE_MB?.trim() || "96",
    BOT_EVENT_CONCURRENCY: process.env.BOT_EVENT_CONCURRENCY?.trim() || "12",
    BOT_EVENT_QUEUE_MAX: process.env.BOT_EVENT_QUEUE_MAX?.trim() || "300",
    BOT_CACHE_MEMBERS_MAX: process.env.BOT_CACHE_MEMBERS_MAX?.trim() || "25",
    BOT_CACHE_USERS_MAX: process.env.BOT_CACHE_USERS_MAX?.trim() || "25",
    BOT_CACHE_MESSAGES_PER_CHANNEL: process.env.BOT_CACHE_MESSAGES_PER_CHANNEL?.trim() || "2",
    BOT_MEMORY_RESTART_MB: process.env.BOT_MEMORY_RESTART_MB?.trim() || "320"
  }
});

if (!existsSync(path.join(root, packageDir, "discloud.config"))) {
  throw new Error("Pacote do worker não foi gerado corretamente.");
}

verifyPackageParity();

if (appExists()) {
  console.log(`[release:bots] Atualizando Discloud app ${appId}...`);
  runDiscloudWithRetry(["app", "commit", appId], { cwd: path.join(root, packageDir) });
} else {
  console.log(`[release:bots] Criando Discloud app ${appId}...`);
  runDiscloudWithRetry(["app", "upload"], { cwd: path.join(root, packageDir) });
}

console.log("[release:bots] Status Discloud...");
runDiscloud(["app", "status", appId]);
console.log("[release:bots] Concluido.");

function verifyPackageParity() {
  const mainPackageDir = path.join(root, ".discloud-package");
  const botsPackageDir = path.join(root, packageDir);
  if (!existsSync(mainPackageDir)) {
    console.log("[release:bots] Pacote principal ausente; paridade de pacote ignorada.");
    return;
  }

  for (const relativePath of [
    "index.js",
    "package.json",
    "scripts/start-production.mjs",
    "scripts/start-dev-bot-worker.mjs",
    "backend/dist",
    "bot/dist",
    "frontend/dist"
  ]) {
    const mainHash = hashPath(path.join(mainPackageDir, relativePath));
    const botsHash = hashPath(path.join(botsPackageDir, relativePath));
    if (mainHash !== botsHash) {
      throw new Error(`Pacote dos bots fora de sincronia com o principal em ${relativePath}.`);
    }
  }

  console.log("[release:bots] Paridade com pacote principal... ok");
}

function hashPath(targetPath) {
  if (!existsSync(targetPath)) {
    return "<missing>";
  }

  const stats = statSync(targetPath);
  if (stats.isFile()) {
    return createHash("sha256").update(readFileSync(targetPath)).digest("hex");
  }

  const hash = createHash("sha256");
  for (const entry of listFiles(targetPath)) {
    hash.update(path.relative(targetPath, entry).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(readFileSync(entry));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
