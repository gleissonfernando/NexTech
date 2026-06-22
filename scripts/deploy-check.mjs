import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const mode = process.argv[2] ?? "full";
const root = process.cwd();
const require = createRequire(import.meta.url);
const appId = "3748bc53-e5aa-4619-827e-1323e3abb267";
const requiredShardcloud = {
  APPID: appId,
  LANGUAGE: "node",
  MEMORY: "512",
  MAIN: "index.js",
  CUSTOM_COMMAND: "npm start"
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

check("configuracao .shardcloud", () => {
  if (!existsSync(path.join(root, ".shardcloud"))) {
    return;
  }

  const config = parseKeyValueFile(".shardcloud");

  for (const [key, expected] of Object.entries(requiredShardcloud)) {
    const actual = config.get(key);

    if (actual !== expected) {
      fail(`.shardcloud ${key} esperado "${expected}", recebido "${actual ?? "<ausente>"}".`);
    }
  }
});

check("arquivos dist", () => {
  const requiredFiles = [
    "backend/dist/server.js",
    "bot/dist/index.js",
    "frontend/dist/index.html",
    "frontend/dist/health",
    "frontend/dist/_shardcloud/health"
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
