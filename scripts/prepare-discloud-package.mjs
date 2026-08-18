import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCurrentReleaseMetadata } from "./auto-update-logger.mjs";

const root = process.cwd();
const target = path.join(root, process.env.DISCLOUD_PACKAGE_DIR?.trim() || ".discloud-package");
const packageName = process.env.DISCLOUD_PACKAGE_NAME?.trim() || "NexTech";
const packageType = process.env.DISCLOUD_PACKAGE_TYPE?.trim() || "site";
const packageId = process.env.DISCLOUD_PACKAGE_ID?.trim() || "nextech";
const packageRam = process.env.DISCLOUD_PACKAGE_RAM?.trim() || "1024";

const required = [
  "index.js",
  "scripts/start-production.mjs",
  "backend/dist/server.js",
  "bot/dist/index.js",
  "frontend/dist/index.html",
  "frontend/dist/health"
];

for (const file of required) {
  if (!existsSync(path.join(root, file))) {
    throw new Error(`${file} nao encontrado. Rode npm run build antes de preparar o pacote.`);
  }
}

if (!target.startsWith(root + path.sep)) {
  throw new Error("Diretorio de pacote fora do workspace.");
}

rmSync(target, { recursive: true, force: true });
mkdirSync(path.join(target, "scripts"), { recursive: true });
mkdirSync(path.join(target, "backend"), { recursive: true });
mkdirSync(path.join(target, "bot"), { recursive: true });
mkdirSync(path.join(target, "frontend"), { recursive: true });

cpSync(path.join(root, "index.js"), path.join(target, "index.js"));
cpSync(path.join(root, "scripts/start-production.mjs"), path.join(target, "scripts/start-production.mjs"));
cpSync(path.join(root, "scripts/start-dev-bot-worker.mjs"), path.join(target, "scripts/start-dev-bot-worker.mjs"));
cpSync(path.join(root, "scripts/auto-update-logger.mjs"), path.join(target, "scripts/auto-update-logger.mjs"));
cpSync(path.join(root, "backend/dist"), path.join(target, "backend/dist"), { recursive: true });
if (existsSync(path.join(root, "backend/assets"))) {
  cpSync(path.join(root, "backend/assets"), path.join(target, "backend/assets"), { recursive: true });
}
if (existsSync(path.join(root, "emojis-paineis.zip"))) {
  mkdirSync(path.join(target, "backend/assets"), { recursive: true });
  cpSync(path.join(root, "emojis-paineis.zip"), path.join(target, "backend/assets/default-panel-emojis.zip"));
}
cpSync(path.join(root, "bot/dist"), path.join(target, "bot/dist"), { recursive: true });
cpSync(path.join(root, "frontend/dist"), path.join(target, "frontend/dist"), { recursive: true });

writeFileSync(path.join(target, "discloud.config"), [
  `NAME=${packageName}`,
  `TYPE=${packageType}`,
  `ID=${packageId}`,
  "MAIN=index.js",
  `RAM=${packageRam}`,
  "VERSION=latest",
  "BUILD=npm install --omit=dev",
  "START=npm start",
  ""
].join("\n"));

const runtimeEnv = {};
for (const key of [
  "APP_CONFIG_JSON",
  "APP_CONFIG_B64",
  "APP_CONFIG_BASE64",
  "NEX_TECH_CONFIG_B64",
  "MONGODB_URI",
  "MONGO_URI",
  "DATABASE_URL",
  "MONGODB_ALLOW_SINGLE_LABEL_HOST",
  "BOT_API_TOKEN",
  "DISCORD_BOT_TOKEN",
  "UPDATE_CHANNEL_ID",
  "AUTO_UPDATE_CHANNEL_ID",
  "UPDATE_PANEL_MODE",
  "UPDATE_PANEL_FOOTER_TEXT",
  "UPDATE_PANEL_FOOTER_ICON_URL",
  "PAYMENTS_ENABLED",
  "PAYMENT_PROVIDER",
  "PAYMENTS_ALLOW_LIVE_CHARGES",
  "PIX_EXPIRATION_MINUTES",
  "ASAAS_API_URL",
  "ASAAS_BASE_URL",
  "ASAAS_API_KEY",
  "ASAAS_WEBHOOK_TOKEN",
  "ASAAS_WEBHOOK_URL",
  "ASAAS_TIMEOUT",
  "ASAAS_CHECKOUT_EXPIRATION_MINUTES",
  "STRIPE_RESTRICTED_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SUCCESS_URL",
  "STRIPE_CANCEL_URL",
  "STRIPE_WEBHOOK_URL",
  "STRIPE_CURRENCY",
  "STRIPE_CHECKOUT_EXPIRATION_MINUTES",
  "STRIPE_STATEMENT_DESCRIPTOR",
  "STRIPE_INTEGRATION_IDENTIFIER",
  "STRIPE_INVOICE_CREATION_ENABLED",
  "STRIPE_TAX_ENABLED",
  "STRIPE_TAX_REGISTRATION_ACTIVE",
  "STRIPE_TAX_ID_COLLECTION_ENABLED"
]) {
  const value = process.env[key]?.trim() || explicitRuntimeConfigValue(key);
  if (value) {
    runtimeEnv[key] = value;
  }
}
for (const key of [
  "NEX_TECH_RUNTIME_ROLE",
  "START_REGISTERED_DEV_BOTS",
  "DEV_BOT_PROCESS_RUNNER_ENABLED",
  "DEV_BOT_RUNTIME_RECONCILE_ENABLED",
  "DEV_BOT_RUNTIME_RECONCILE_INTERVAL_MS",
  "DEV_BOT_START_CONCURRENCY",
  "DEV_BOT_NODE_MAX_OLD_SPACE_MB",
  "DEV_BOT_START_STAGGER_MS",
  "DEV_BOT_COMMAND_CLEANUP_DELAY_MS"
]) {
  const value = process.env[key]?.trim() || explicitRuntimeConfigValue(key);
  if (value) {
    runtimeEnv[key] = value;
  }
}

writeFileSync(path.join(target, ".nex-tech-runtime-env.json"), `${JSON.stringify(runtimeEnv, null, 2)}\n`);
writeFileSync(path.join(target, ".nex-tech-release.json"), `${JSON.stringify(buildCurrentReleaseMetadata(), null, 2)}\n`);

function explicitRuntimeConfigValue(key) {
  const runtimeConfigFile = [".nex-tech-runtime-env.json", ".NexTech-runtime-env.json", ".orvitek-runtime-env.json"]
    .find((candidate) => existsSync(path.join(root, candidate)));

  if (!runtimeConfigFile) {
    return "";
  }

  try {
    const parsed = JSON.parse(readFileSync(path.join(root, runtimeConfigFile), "utf8"));
    const value = parsed?.[key];
    return value === null || value === undefined ? "" : String(value).trim();
  } catch {
    return "";
  }
}

writeFileSync(path.join(target, "package.json"), `${JSON.stringify({
  name: "nextech-discloud-runtime",
  version: "1.0.0",
  main: "index.js",
  scripts: {
    start: "node index.js",
    "start:discloud": "node index.js"
  },
  dependencies: {
    "@discordjs/voice": "^0.19.2",
    archiver: "^8.0.0",
    axios: "^1.7.9",
    "cookie-parser": "^1.4.7",
    cors: "^2.8.5",
    "discloud.app": "^2.0.4",
    "discord.js": "^14.16.3",
    dotenv: "^16.4.7",
    express: "^4.21.2",
    "express-session": "^1.18.1",
    "ffmpeg-static": "^5.3.0",
    helmet: "^7.2.0",
    ioredis: "^5.4.2",
    jsonwebtoken: "^9.0.3",
    "libsodium-wrappers": "^0.8.4",
    mercadopago: "^3.2.0",
    mongodb: "^6.12.0",
    morgan: "^1.10.0",
    multer: "^2.0.2",
    opusscript: "^0.0.8",
    "prism-media": "^1.3.5",
    shoukaku: "^4.3.0",
    "socket.io": "^4.8.1",
    "socket.io-client": "^4.8.1",
    stripe: "^22.3.2",
    ws: "^8.21.0",
    yauzl: "^3.2.0",
    zod: "^3.24.1"
  }
}, null, 2)}\n`);

console.log(`Pacote Discloud preparado em ${path.relative(root, target)}`);
