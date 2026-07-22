import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runAutoUpdateLogger } from "./auto-update-logger.mjs";

const root = process.cwd();
const commitMessage = process.argv.slice(2).join(" ").trim() || `Manual Discloud release ${new Date().toISOString()}`;
const appId = readDiscloudAppId();

function run(command, args, options = {}) {
  const useShell = process.platform === "win32";
  const cwd = options.cwd ?? root;
  const result = useShell
    ? spawnSync([command, ...args.map(quoteShellArg)].join(" "), {
      cwd,
      env: process.env,
      shell: true,
      stdio: options.capture ? "pipe" : "inherit",
      encoding: "utf8"
    })
    : spawnSync(command, args, {
    cwd,
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
  if (!existsSync(configPath)) return "nextech";
  const idLine = readFileSync(configPath, "utf8").split(/\r?\n/).find((line) => line.trim().startsWith("ID="));
  return idLine?.split("=").slice(1).join("=").trim() || "nextech";
}

function currentBranch() {
  return run("git", ["branch", "--show-current"], { capture: true }).trim() || "main";
}

function hasChanges() {
  return run("git", ["status", "--porcelain"], { capture: true }).trim().length > 0;
}

console.log("[release] Validando build e deploy-check...");
run("npm", ["run", "deploy:check"]);
console.log("[release] Preparando pacote runtime para Discloud...");
run("node", ["scripts/prepare-discloud-package.mjs"]);

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
run("discloud", ["app", "commit", appId], { cwd: path.join(root, ".discloud-package") });

console.log("[release] Status Discloud...");
run("discloud", ["app", "status", appId]);

console.log("[release] Health check...");
const healthUrl = `https://${appId}.discloud.app/health`;
await waitForHealthyApp(healthUrl);

console.log("[release] Auto Update Logger...");
await runAutoUpdateLogger().catch((error) => {
  console.warn(`[release] Auto Update Logger ignorado: ${error instanceof Error ? error.message : String(error)}`);
});

console.log("[release] Concluido.");

async function waitForHealthyApp(url) {
  let lastBody = "";
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url);
      lastBody = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${lastBody}`);
      const payload = JSON.parse(lastBody);
      if (payload?.status === "ok" && payload?.database?.ok && payload?.bot?.online) {
        console.log(lastBody);
        return;
      }
      console.log(`[release] Aguardando bot online (${attempt}/12)...`);
    } catch (error) {
      console.log(`[release] Health ainda indisponivel (${attempt}/12): ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Health check falhou em ${url}: ${lastBody || "sem resposta com bot online"}`);
}
