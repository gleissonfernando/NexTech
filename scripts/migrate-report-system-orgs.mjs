import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
applyPackedEnv();

const mongoUri = process.env.MONGODB_URI?.trim() || process.env.MONGO_URI?.trim() || process.env.DATABASE_URL?.trim();
const confirmed = process.argv.includes("--confirm");

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const client = new MongoClient(mongoUri);
const runId = `report-system-orgs-${new Date().toISOString()}-${randomUUID()}`;

try {
  await client.connect();
  const db = client.db();
  const guildSettings = db.collection("GuildSettings");
  const backups = db.collection("report_system_org_migration_backups");
  const settings = await guildSettings.find({ reportSystem: { $exists: true } }).toArray();
  const results = [];

  for (const item of settings) {
    const report = item.reportSystem && typeof item.reportSystem === "object" ? item.reportSystem : {};
    const currentCategories = Array.isArray(report.categories) ? report.categories : [];
    const categories = migrateCategories(currentCategories, report);
    const changed = JSON.stringify(currentCategories) !== JSON.stringify(categories);

    if (confirmed && changed) {
      await backups.insertOne({
        _id: `${runId}:${String(item._id)}`,
        botId: item.botId ?? null,
        createdAt: new Date(),
        guildId: item.guildId ?? item._id,
        previousReportSystem: report,
        runId
      });
      await guildSettings.updateOne(
        { _id: item._id },
        {
          $set: {
            "reportSystem.categories": categories,
            updatedAt: new Date()
          }
        }
      );
    }

    results.push({
      botId: item.botId ?? null,
      changed,
      guildId: item.guildId ?? item._id,
      migratedCategories: categories.length
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: confirmed ? "write" : "dry-run",
    matched: settings.length,
    changed: results.filter((item) => item.changed).length,
    runId,
    results
  }, null, 2));
} finally {
  await client.close();
}

function migrateCategories(source, report) {
  const categories = source.map((item, index) => normalizeCategory(item, index));
  const iabId = ensureOrg(categories, ["iab", "denuncias-iab"], "iab", "I.A.B.", report.iabCategoryId, report.iabLogChannelId, report.iabRoleIds, "Denuncias contra oficiais");
  const conselhoId = ensureOrg(categories, ["conselho", "council"], "conselho", "Conselho", report.conselhoCategoryId, report.conselhoLogChannelId, report.conselhoRoleIds, "Denuncias contra membros da I.A.B.");
  const hcmdId = ensureOrg(categories, ["alto-comando", "high-command", "hcmd"], "alto-comando", "Alto Comando", report.hcmdCategoryId, report.hcmdLogChannelId, report.hcmdRoleIds, "Denuncias contra membros do Conselho");
  const comissarioId = ensureOrg(categories, ["comissario", "commissioner"], "comissario", "Comissario", report.comissarioCategoryId, report.comissarioLogChannelId, report.comissarioRoleIds, "Denuncias contra membros do Alto Comando");

  setEscalation(categories, iabId, conselhoId);
  setEscalation(categories, conselhoId, hcmdId);
  setEscalation(categories, hcmdId, comissarioId);
  setEscalation(categories, comissarioId, null);

  return categories.map((category, index) => ({ ...category, order: index + 1 }));
}

function ensureOrg(categories, keys, fallbackId, name, channelOrCategoryId, logChannelId, responsibleRoleIds, judgeLabel) {
  const category = categories.find((item) => keys.some((key) => item.id === key || normalized(item.name).includes(key)));
  if (category) {
    category.channelOrCategoryId ||= cleanSnowflake(channelOrCategoryId);
    category.logChannelId ||= cleanSnowflake(logChannelId);
    category.judgeLabel ||= judgeLabel;
    category.responsibleRoleIds = category.responsibleRoleIds.length ? category.responsibleRoleIds : cleanSnowflakes(responsibleRoleIds);
    return category.id;
  }
  const id = uniqueId(categories, fallbackId);
  categories.push({
    channelOrCategoryId: cleanSnowflake(channelOrCategoryId),
    color: "#dc2626",
    description: judgeLabel,
    emoji: null,
    enabled: true,
    escalateToCategoryId: null,
    id,
    judgeLabel,
    logChannelId: cleanSnowflake(logChannelId),
    name,
    order: categories.length + 1,
    responsibleRoleIds: cleanSnowflakes(responsibleRoleIds)
  });
  return id;
}

function normalizeCategory(item, index) {
  const record = item && typeof item === "object" ? item : {};
  const name = cleanString(record.name) || `Orgao ${index + 1}`;
  return {
    channelOrCategoryId: cleanSnowflake(record.channelOrCategoryId),
    color: cleanString(record.color) || "#dc2626",
    description: cleanString(record.description) || null,
    emoji: cleanString(record.emoji) || null,
    enabled: record.enabled !== false,
    escalateToCategoryId: cleanString(record.escalateToCategoryId) || null,
    id: cleanString(record.id) || slug(name) || `orgao-${index + 1}`,
    judgeLabel: cleanString(record.judgeLabel) || null,
    logChannelId: cleanSnowflake(record.logChannelId),
    name,
    order: Number(record.order) || index + 1,
    responsibleRoleIds: cleanSnowflakes(record.responsibleRoleIds)
  };
}

function setEscalation(categories, fromId, toId) {
  const category = categories.find((item) => item.id === fromId);
  if (category) category.escalateToCategoryId = toId;
}

function uniqueId(categories, preferred) {
  const used = new Set(categories.map((item) => item.id));
  if (!used.has(preferred)) return preferred;
  for (let index = 2; index < 100; index += 1) {
    const id = `${preferred}-${index}`;
    if (!used.has(id)) return id;
  }
  return `${preferred}-${Date.now()}`;
}

function cleanSnowflakes(value) {
  return Array.isArray(value) ? [...new Set(value.map(cleanString).filter((item) => /^\d{5,32}$/.test(item)))] : [];
}

function cleanSnowflake(value) {
  const text = cleanString(value);
  return /^\d{5,32}$/.test(text) ? text : null;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slug(value) {
  return normalized(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function normalized(value) {
  return cleanString(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function applyPackedEnv() {
  const rawConfig = process.env.APP_CONFIG_JSON?.trim()
    || decodeBase64Config(process.env.APP_CONFIG_B64)
    || decodeBase64Config(process.env.APP_CONFIG_BASE64)
    || decodeBase64Config(process.env.NEX_TECH_CONFIG_B64);
  if (!rawConfig) return;
  const parsed = JSON.parse(rawConfig);
  for (const [key, value] of Object.entries(parsed)) {
    if (/^[A-Z0-9_]+$/.test(key) && value !== null && value !== undefined) {
      process.env[key] ||= typeof value === "string" ? value : String(value);
    }
  }
}

function decodeBase64Config(value) {
  const trimmed = value?.trim();
  return trimmed ? Buffer.from(trimmed, "base64").toString("utf8") : "";
}
