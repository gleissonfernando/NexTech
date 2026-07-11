import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, ".discloud-package");

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
cpSync(path.join(root, "backend/dist"), path.join(target, "backend/dist"), { recursive: true });
cpSync(path.join(root, "bot/dist"), path.join(target, "bot/dist"), { recursive: true });
cpSync(path.join(root, "frontend/dist"), path.join(target, "frontend/dist"), { recursive: true });

writeFileSync(path.join(target, "discloud.config"), [
  "NAME=NexTech",
  "TYPE=site",
  "ID=nextech",
  "MAIN=index.js",
  "RAM=1024",
  "VERSION=latest",
  "BUILD=npm install --omit=dev",
  "START=npm start",
  ""
].join("\n"));

writeFileSync(path.join(target, "package.json"), `${JSON.stringify({
  name: "nextech-discloud-runtime",
  version: "1.0.0",
  description: "Prebuilt NexTech runtime package for Discloud.",
  main: "index.js",
  scripts: {
    start: "node scripts/start-production.mjs",
    "start:discloud": "node scripts/start-production.mjs"
  },
  dependencies: {
    "@discordjs/voice": "^0.19.2",
    archiver: "^7.0.1",
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
    mongodb: "^6.12.0",
    morgan: "^1.10.0",
    multer: "^2.0.2",
    opusscript: "^0.0.8",
    "prism-media": "^1.3.5",
    shoukaku: "^4.3.0",
    "socket.io": "^4.8.1",
    "socket.io-client": "^4.8.1",
    ws: "^8.21.0",
    yauzl: "^3.2.0",
    zod: "^3.24.1"
  },
  engines: {
    node: ">=20"
  }
}, null, 2)}\n`);

console.log(`Pacote Discloud preparado em ${path.relative(root, target)}`);
