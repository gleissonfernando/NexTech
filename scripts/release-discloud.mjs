import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const commitMessage = process.argv.slice(2).join(" ").trim() || `Manual Discloud release ${new Date().toISOString()}`;
const appId = readDiscloudAppId();

function run(command, args, options = {}) {
  const useShell = process.platform === "win32";
  const result = useShell
    ? spawnSync([command, ...args.map(quoteShellArg)].join(" "), {
      cwd: root,
      env: process.env,
      shell: true,
      stdio: options.capture ? "pipe" : "inherit",
      encoding: "utf8"
    })
    : spawnSync(command, args, {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} falhou com codigo ${result.status ?? 1}.`);
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function quoteShellArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function readDiscloudAppId() {
  const configPath = path.join(root, "discloud.config");
  if (!existsSync(configPath)) return "orvitek-bots";
  const idLine = readFileSync(configPath, "utf8").split(/\r?\n/).find((line) => line.trim().startsWith("ID="));
  return idLine?.split("=").slice(1).join("=").trim() || "orvitek-bots";
}

function currentBranch() {
  return run("git", ["branch", "--show-current"], { capture: true }).trim() || "main";
}

function hasChanges() {
  return run("git", ["status", "--porcelain"], { capture: true }).trim().length > 0;
}

console.log("[release] Validando build e deploy-check...");
run("npm", ["run", "deploy:check"]);

if (hasChanges()) {
  console.log("[release] Criando commit...");
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", commitMessage]);
} else {
  console.log("[release] Nenhuma alteracao local para commitar.");
}

const branch = currentBranch();
console.log(`[release] Enviando para origin/${branch}...`);
run("git", ["push", "origin", branch]);

console.log(`[release] Atualizando Discloud app ${appId}...`);
run("discloud", ["app", "commit", appId]);

console.log("[release] Status Discloud...");
run("discloud", ["app", "status", appId]);

console.log("[release] Health check...");
const healthUrl = "https://orvitek-bots.discloud.app/health";
try {
  const response = await fetch(healthUrl);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${body}`);
  }
  console.log(body);
} catch (error) {
  throw new Error(`Health check falhou em ${healthUrl}: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("[release] Concluido.");
