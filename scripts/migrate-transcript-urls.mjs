import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
applyPackedEnv();

const mongoUri = process.env.MONGODB_URI?.trim();

if (!mongoUri) {
  throw new Error("MONGODB_URI nao configurado.");
}

const client = new MongoClient(mongoUri);

try {
  await client.connect();
  const db = client.db();
  const transcripts = db.collection("transcripts");
  const absoluteUrlCount = await transcripts.countDocuments({
    websiteUrl: { $regex: /^https?:\/\//i }
  });

  const result = await transcripts.updateMany(
    {},
    [
      {
        $set: {
          htmlPath: { $concat: ["/transcripts/", "$_id"] },
          txtPath: { $concat: ["/transcripts/", "$_id", "/export.txt"] },
          websiteUrl: null
        }
      }
    ]
  );

  console.log(JSON.stringify({
    ok: true,
    absoluteUrlRecordsFound: absoluteUrlCount,
    matched: result.matchedCount,
    modified: result.modifiedCount
  }, null, 2));
} finally {
  await client.close();
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
