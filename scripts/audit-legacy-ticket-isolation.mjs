import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || process.env.MONGO_DATABASE || "nextech";

if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db(dbName);
  const tickets = db.collection("Ticket");
  const query = {
    $or: [
      { botId: { $exists: false } },
      { botId: null },
      { moduleType: { $exists: false } },
      { ticketType: { $exists: false } },
      { migrationStatus: { $exists: false } }
    ]
  };

  const legacy = await tickets.find(query).limit(10000).toArray();
  const summary = {
    apply,
    checkedAt: new Date().toISOString(),
    dbName,
    legacyCount: legacy.length,
    pendingReview: legacy.filter((ticket) => !ticket.botId).length,
    safeDefaultCandidates: legacy.filter((ticket) => ticket.botId && !ticket.moduleType).length
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!apply || legacy.length === 0) {
    process.exit(0);
  }

  const backupDir = resolve(process.cwd(), ".migration-backups");
  await mkdir(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `legacy-tickets-${Date.now()}.json`);
  await writeFile(backupPath, JSON.stringify(legacy, null, 2), "utf8");

  const missingBotResult = await tickets.updateMany(
    {
      _id: { $in: legacy.filter((ticket) => !ticket.botId).map((ticket) => ticket._id) }
    },
    {
      $set: {
        migrationStatus: "pending_review",
        moduleType: "default",
        ticketType: "support"
      }
    }
  );

  const scopedDefaultResult = await tickets.updateMany(
    {
      _id: { $in: legacy.filter((ticket) => ticket.botId).map((ticket) => ticket._id) }
    },
    {
      $set: {
        migrationStatus: "ok",
        moduleType: "default",
        ticketType: "support"
      }
    }
  );

  console.log(JSON.stringify({
    backupPath,
    markedPendingReview: missingBotResult.modifiedCount,
    markedDefaultWithBotScope: scopedDefaultResult.modifiedCount
  }, null, 2));
} finally {
  await client.close();
}
