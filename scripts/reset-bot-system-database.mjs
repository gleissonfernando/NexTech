import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
applyPackedEnv();

const mongoUri = process.env.MONGODB_URI?.trim();
const confirmArgIndex = process.argv.indexOf("--confirm");
const confirmed = confirmArgIndex >= 0 && process.argv[confirmArgIndex + 1] === "RESET_BOT_SYSTEM";

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const fixedPreservedCollections = new Set([
  "User",
  "Guild",
  "GuildSettings",
  "Bot",
  "BotGuildConfig",
  "DevPermission",
  "MaintenanceState",
  "bot_credentials",
  "security_feature_access",
  "safe_bot_message_states",
  "panel_image_settings",
  "persistent_images",
  "application_emojis",
  "media_library",
  "plans",
  "plan_features",
  "payment_settings",
  "price_tables",
  "social_notifications"
]);

const client = new MongoClient(mongoUri);

try {
  await client.connect();

  const db = client.db(databaseNameFromUri(mongoUri));
  const collectionInfos = await db.listCollections({}, { nameOnly: true }).toArray();
  const collections = collectionInfos.map((collection) => collection.name).sort((a, b) => a.localeCompare(b));
  const toPreserve = collections.filter(shouldPreserveCollection);
  const toDrop = collections.filter((name) => !shouldPreserveCollection(name));
  const counts = {};

  for (const name of collections) {
    counts[name] = await db.collection(name).estimatedDocumentCount().catch(() => null);
  }

  if (confirmed) {
    for (const name of toDrop) {
      await db.collection(name).drop();
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: confirmed ? "write" : "dry-run",
    database: db.databaseName,
    preservedCollections: toPreserve,
    droppedCollections: confirmed ? toDrop : [],
    wouldDropCollections: confirmed ? [] : toDrop,
    counts
  }, null, 2));

  if (!confirmed) {
    console.log("Para executar de verdade: npm run db:reset-bot-system -- --confirm RESET_BOT_SYSTEM");
  }
} finally {
  await client.close();
}

function databaseNameFromUri(uri) {
  const configuredName = process.env.MONGODB_DATABASE_NAME || process.env.MONGODB_DB_NAME;
  const defaultName = "orvitek";
  const legacyNames = {
    ricardinho98: defaultName
  };
  const rawName = configuredName || uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i)?.[1] || "";
  const dbName = decodeURIComponent(rawName.replace(/^\/+/, "").split("/")[0] ?? "");

  return legacyNames[dbName] || dbName || defaultName;
}

function shouldPreserveCollection(name) {
  if (fixedPreservedCollections.has(name)) {
    return true;
  }

  return /(?:settings|configs?|config)$/i.test(name);
}

function applyPackedEnv() {
  const rawConfig = process.env.APP_CONFIG_JSON?.trim()
    || decodeBase64Config(process.env.APP_CONFIG_B64)
    || decodeBase64Config(process.env.APP_CONFIG_BASE64)
    || decodeBase64Config(process.env.NEX_TECH_CONFIG_B64);

  if (!rawConfig) {
    return;
  }

  const parsed = JSON.parse(rawConfig);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("APP_CONFIG_JSON/APP_CONFIG_B64 precisa conter um objeto JSON.");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[A-Z0-9_]+$/.test(key) || value === null || value === undefined) {
      continue;
    }

    process.env[key] ||= typeof value === "string" ? value : String(value);
  }
}

function decodeBase64Config(value) {
  const trimmed = value?.trim();
  return trimmed ? Buffer.from(trimmed, "base64").toString("utf8") : "";
}
