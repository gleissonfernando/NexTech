import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const mode = process.argv[2] ?? "full";
const root = process.cwd();
const require = createRequire(import.meta.url);
const requiredDiscloud = {
  NAME: "OrviteK",
  TYPE: "bot",
  MAIN: "index.js",
  RAM: "1024",
  VERSION: "latest",
  BUILD: "npm install && npm run build",
  START: "npm start"
};

const checks = [];

function check(name, run) {
  checks.push({ name, run });
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const cwd = options.cwd ?? root;
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    shell: false,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} falhou com codigo ${result.status ?? 1}.`);
  }
}

function parseKeyValueFile(file) {
  const parsed = new Map();
  const content = readFileSync(path.join(root, file), "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");

    if (index <= 0) {
      fail(`${file} contem linha invalida: ${line}`);
    }

    parsed.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }

  return parsed;
}

function listFiles(targetPath, predicate) {
  if (!existsSync(targetPath)) {
    return [];
  }

  const stats = statSync(targetPath);

  if (!stats.isDirectory()) {
    return predicate(targetPath) ? [targetPath] : [];
  }

  return readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = path.join(targetPath, entry.name);
    return entry.isDirectory() ? listFiles(childPath, predicate) : (predicate(childPath) ? [childPath] : []);
  });
}

function readProjectFile(file) {
  return readFileSync(path.join(root, file), "utf8");
}

check("configuracao discloud.config", () => {
  if (!existsSync(path.join(root, "discloud.config"))) {
    fail("discloud.config nao encontrado na raiz.");
  }

  const config = parseKeyValueFile("discloud.config");

  for (const [key, expected] of Object.entries(requiredDiscloud)) {
    const actual = config.get(key);

    if (actual !== expected) {
      fail(`discloud.config ${key} esperado "${expected}", recebido "${actual ?? "<ausente>"}".`);
    }
  }
});

check("contrato de token interno do bot", () => {
  const backendAuth = readProjectFile("backend/src/middleware/auth.ts");
  const botApiClient = readProjectFile("bot/src/services/apiClient.ts");
  const botSocketClient = readProjectFile("bot/src/websocket/socketClient.ts");

  if (!backendAuth.includes('req.header("x-bot-token")')) {
    fail("backend precisa aceitar o header x-bot-token enviado pelo bot.");
  }

  if (!backendAuth.includes('req.header("bot-token")')) {
    fail("backend precisa manter compatibilidade com o header bot-token.");
  }

  if (!botApiClient.includes('"x-bot-token": env.BOT_API_TOKEN')) {
    fail("bot API client precisa enviar x-bot-token com BOT_API_TOKEN.");
  }

  if (!botSocketClient.includes("auth:") || !botSocketClient.includes("token: env.BOT_API_TOKEN")) {
    fail("bot socket client precisa autenticar com BOT_API_TOKEN.");
  }
});

check("arquivos dist", () => {
  const requiredFiles = [
    "backend/dist/server.js",
    "bot/dist/index.js",
    "frontend/dist/index.html",
    "frontend/dist/health"
  ];

  for (const file of requiredFiles) {
    if (!existsSync(path.join(root, file))) {
      fail(`${file} nao encontrado. Rode npm run build.`);
    }
  }
});

check("sintaxe JS de producao", () => {
  const files = [
    "index.js",
    "scripts/start-production.mjs",
    ...listFiles(path.join(root, "backend/dist"), (file) => file.endsWith(".js")),
    ...listFiles(path.join(root, "bot/dist"), (file) => file.endsWith(".js"))
  ];

  for (const file of files) {
    run(process.execPath, ["--check", path.relative(root, file)]);
  }
});

check("comandos Discord", () => {
  const { createCommandCollection } = require("../bot/dist/commands");
  const commands = createCommandCollection();

  if (!commands.size) {
    fail("nenhum comando Discord registrado.");
  }

  for (const command of commands.values()) {
    const json = command.data.toJSON();

    if (!json.name || !/^[\w-]{1,32}$/.test(json.name)) {
      fail(`comando Discord com nome invalido: ${json.name ?? "<sem nome>"}.`);
    }

    if (!json.description && json.type === undefined) {
      fail(`comando /${json.name} sem descricao.`);
    }
  }
});

if (mode === "env") {
  check(".env local", () => {
    if (!existsSync(path.join(root, ".env"))) {
      fail(".env nao encontrado.");
    }

    const env = parseKeyValueFile(".env");
    const requiredEnv = [
      "MONGODB_URI",
      "DISCORD_BOT_TOKEN",
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "SITE_ORIGIN",
      "FRONTEND_URL",
      "BOT_API_TOKEN"
    ];

    for (const key of requiredEnv) {
      if (!env.get(key)?.trim()) {
        fail(`.env sem valor para ${key}.`);
      }
    }
  });
}

for (const item of checks) {
  process.stdout.write(`[deploy-check] ${item.name}... `);
  item.run();
  process.stdout.write("ok\n");
}

console.log(`[deploy-check] ${mode} aprovado.`);
