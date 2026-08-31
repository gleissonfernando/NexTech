import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
applyPackedEnv();

const mongoUri = process.env.MONGODB_URI?.trim();
const apply = process.argv.includes("--apply");
const botFilter = readArg("--bot");
const guildFilter = readArg("--guild");
const selectedCollections = new Set((readArg("--collections") || "").split(",").map((item) => item.trim()).filter(Boolean));

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const CONFIG_COLLECTIONS = [
  "GuildSettings",
  "BotGuildConfig",
  "safe_bot_message_states",
  "course_settings",
  "course_exam_settings",
  "course_instructor_settings",
  "course_history_settings",
  "open_duty_settings",
  "rh_admin_settings",
  "manual_registration_settings",
  "fivem_goal_settings",
  "fivem_goal_configs",
  "fivem_order_settings",
  "fivem_finance_settings",
  "ammunition_configs",
  "weapon_sale_configs",
  "fivem_expense_configs",
  "washing_settings",
  "global_blacklist_settings",
  "server_backup_settings",
  "live_detection_settings",
  "police_time_clock_settings",
  "auto_activity_clock_settings",
  "clips_config",
  "kick_api_configs",
  "fivem_action_settings",
  "faction_chest_settings",
  "daf_scale_settings",
  "police_patrol_settings",
  "vehicle_abandonment_settings",
  "police_qru_settings",
  "police_promotion_settings",
  "police_rank_up_settings",
  "police_hidden_channel_settings",
  "message_control_settings",
  "dm_bar_configs",
  "fivem_fac_settings",
  "image_anti_spam_settings",
  "voice_recorder_settings",
  "media_settings",
  "application_emoji_settings",
  "nexTech_sales_settings",
  "subscription_presence_settings",
  "booster_config",
  "salesTicketSettings",
  "manual_payment_settings",
  "custom_bot_order_settings",
  "self_bot_protection_settings",
  "safe_bot_warning_settings",
  "automated_log_settings",
  "security_feature_access",
  "payment_settings",
  "monthly_billing_settings",
  "panel_image_settings"
];

const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const db = client.db(databaseNameFromUri(mongoUri));
  const collections = selectedCollections.size
    ? CONFIG_COLLECTIONS.filter((name) => selectedCollections.has(name))
    : CONFIG_COLLECTIONS;

  const bots = await db.collection("Bot").find(
    botFilter ? { _id: botFilter } : {},
    {
      projection: {
        _id: 1,
        clientId: 1,
        databaseName: 1,
        guildIds: 1,
        mainGuildId: 1,
        name: 1,
        status: 1
      }
    }
  ).sort({ name: 1 }).toArray();

  const reports = [];
  let copiedDocuments = 0;

  for (const bot of bots) {
    const botId = String(bot._id);
    const guildIds = await listBotGuildIds(db, bot);
    const guildReports = [];

    for (const guildId of guildIds) {
      if (guildFilter && guildId !== guildFilter) continue;

      const collectionReports = [];

      for (const name of collections) {
        const collection = db.collection(name);
        const specificFilter = { botId, guildId };
        const legacyFilter = legacyScopeQuery(guildId);
        const [specificCount, legacyDocs] = await Promise.all([
          collection.countDocuments(specificFilter).catch(() => 0),
          name === "BotGuildConfig"
            ? Promise.resolve([])
            : collection.find(legacyFilter).limit(1000).toArray().catch(() => [])
        ]);

        let copied = 0;
        if (apply && specificCount === 0 && legacyDocs.length) {
          const docs = legacyDocs.map((doc) => cloneLegacyDoc(doc, botId, guildId, name));
          if (docs.length) {
            const result = await collection.insertMany(docs, { ordered: false }).catch((error) => {
              if (error?.result?.result?.nInserted) return { insertedCount: error.result.result.nInserted };
              throw error;
            });
            copied = result.insertedCount ?? 0;
            copiedDocuments += copied;
          }
        }

        if (specificCount || legacyDocs.length || copied) {
          collectionReports.push({
            collection: name,
            copied,
            hasSpecific: specificCount > 0,
            legacyAvailable: legacyDocs.length,
            specificCount
          });
        }
      }

      guildReports.push({
        guildId,
        collections: collectionReports,
        missingButRecoverable: collectionReports
          .filter((item) => !item.hasSpecific && item.legacyAvailable > 0)
          .map((item) => item.collection)
      });
    }

    reports.push({
      botId,
      clientId: bot.clientId ?? null,
      databaseName: bot.databaseName ?? null,
      guilds: guildReports,
      name: bot.name ?? null,
      status: bot.status ?? null
    });
  }

  console.log(JSON.stringify({
    ok: true,
    database: db.databaseName,
    mode: apply ? "apply" : "dry-run",
    checkedBots: reports.length,
    copiedDocuments,
    collections,
    reports
  }, null, 2));

  if (!apply) {
    console.log("Dry-run concluido. Para copiar configs legadas faltantes: npm run db:audit-bot-configs -- --apply");
  }
} finally {
  await client.close();
}

async function listBotGuildIds(db, bot) {
  const configured = await db.collection("BotGuildConfig").find(
    { botId: String(bot._id) },
    { projection: { guildId: 1 } }
  ).toArray();

  return [
    bot.mainGuildId,
    ...(Array.isArray(bot.guildIds) ? bot.guildIds : []),
    ...configured.map((item) => item.guildId)
  ]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .sort();
}

function legacyScopeQuery(guildId) {
  return {
    guildId,
    $or: [
      { botId: null },
      { botId: { $exists: false } }
    ]
  };
}

function cloneLegacyDoc(doc, botId, guildId, collection) {
  const now = new Date();
  const cloned = {
    ...doc,
    _id: randomUUID(),
    botId,
    guildId,
    migratedFrom: {
      collection,
      legacyId: String(doc._id),
      sourceBotId: doc.botId ?? null
    },
    migratedFromLegacyAt: now,
    updatedAt: now
  };

  if (!cloned.createdAt) cloned.createdAt = now;
  return cloned;
}

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : "";
}

function databaseNameFromUri(uri) {
  const configuredName = process.env.MONGODB_DATABASE_NAME || process.env.MONGODB_DB_NAME;
  const defaultName = "NexTech";
  const rawName = configuredName || uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i)?.[1] || "";
  const dbName = decodeURIComponent(rawName.replace(/^\/+/, "").split("/")[0] ?? "");

  return dbName || defaultName;
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
