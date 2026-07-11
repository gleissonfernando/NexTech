import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
applyPackedEnv();

const mongoUri = process.env.MONGODB_URI?.trim();
const confirmed = process.argv.includes("--confirm");

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const client = new MongoClient(mongoUri);

try {
  await client.connect();

  const mainDb = client.db(databaseNameFromUri(mongoUri));
  const bots = await mainDb.collection("Bot").find({}, {
    projection: {
      _id: 1,
      clientId: 1,
      databaseName: 1,
      name: 1
    }
  }).toArray();

  const results = [];

  for (const bot of bots) {
    const databaseName = cleanString(bot.databaseName) || botDatabaseName(cleanString(bot.clientId) || String(bot._id));
    const needsBotUpdate = bot.databaseName !== databaseName;

    if (confirmed && needsBotUpdate) {
      await mainDb.collection("Bot").updateOne(
        { _id: bot._id },
        {
          $set: {
            databaseName,
            updatedAt: new Date()
          }
        }
      );
    }

    if (confirmed) {
      await client.db(databaseName).collection("bot_metadata").updateOne(
        { _id: "database" },
        {
          $set: {
            botId: bot._id,
            botClientId: bot.clientId ?? null,
            botName: bot.name ?? null,
            databaseName,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
    }

    results.push({
      botId: bot._id,
      clientId: bot.clientId ?? null,
      name: bot.name ?? null,
      databaseName,
      wouldUpdateBot: needsBotUpdate
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: confirmed ? "write" : "dry-run",
    bots: results.length,
    results
  }, null, 2));
} finally {
  await client.close();
}

function botDatabaseName(botId) {
  const prefix = (process.env.BOT_DATABASE_PREFIX || "orvitek_bot").trim() || "orvitek_bot";
  const normalizedBotId = botId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");

  if (!normalizedBotId) {
    throw new Error("botId invalido para banco de dados do bot.");
  }

  return `${prefix}_${normalizedBotId}`.slice(0, 63);
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

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
