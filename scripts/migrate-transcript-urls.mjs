import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
applyPackedEnv();

const DEFAULT_BASE_URL = "https://nextech.discloud.app";
const mongoUri = process.env.MONGODB_URI?.trim() || process.env.MONGO_URI?.trim() || process.env.DATABASE_URL?.trim();
const appBaseUrl = normalizeBaseUrl(
  process.env.APP_BASE_URL?.trim()
  || process.env.TRANSCRIPT_BASE_URL?.trim()
  || process.env.SITE_ORIGIN?.trim()
  || DEFAULT_BASE_URL
);

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const client = new MongoClient(mongoUri);
const runId = `transcript-url-migration-${new Date().toISOString()}-${randomUUID()}`;

try {
  await client.connect();
  const db = client.db();
  const transcripts = db.collection("transcripts");
  const backups = db.collection("transcript_url_migration_backups");
  const query = {
    $or: [
      { websiteUrl: { $regex: /^https?:\/\//i } },
      { htmlPath: { $regex: /^https?:\/\//i } },
      { txtPath: { $regex: /^https?:\/\//i } },
      { pdfPath: { $regex: /^https?:\/\//i } }
    ]
  };
  const candidates = await transcripts.find(query, {
    projection: { _id: 1, websiteUrl: 1, htmlPath: 1, txtPath: 1, pdfPath: 1 }
  }).toArray();

  if (candidates.length) {
    await backups.insertOne({
      _id: runId,
      appBaseUrl,
      count: candidates.length,
      createdAt: new Date(),
      records: candidates
    });
  }

  let modified = 0;
  for (const item of candidates) {
    const transcriptId = String(item._id);
    const next = {
      htmlPath: `/transcripts/${encodeURIComponent(transcriptId)}`,
      txtPath: `/transcripts/${encodeURIComponent(transcriptId)}/export.txt`,
      websiteUrl: `${appBaseUrl}/transcripts/${encodeURIComponent(transcriptId)}`
    };
    const result = await transcripts.updateOne({ _id: item._id }, { $set: next });
    modified += result.modifiedCount;
  }

  console.log(JSON.stringify({
    ok: true,
    appBaseUrl,
    backupRunId: runId,
    matched: candidates.length,
    modified
  }, null, 2));
} finally {
  await client.close();
}

function normalizeBaseUrl(value) {
  return (value || DEFAULT_BASE_URL).replace(/\/+$/, "") || DEFAULT_BASE_URL;
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
