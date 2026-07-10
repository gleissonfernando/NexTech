import { getMongoDb } from "../backend/dist/database/mongo.js";

const db = await getMongoDb();
const botCollection = db.collection("Bot");
const bots = await botCollection.find({}, {
  projection: { _id: 1, clientId: 1, mainGuildId: 1, ownerId: 1, status: 1 }
}).toArray();
const botIds = new Set(bots.map((bot) => String(bot._id)));
const collectionNames = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name);
const legacyNames = ["Bots", "DevBot", "DevBots", "devBots", "dev_bots"].filter((name) => collectionNames.includes(name));
const duplicateClientIds = duplicateValues(bots, "clientId");
const configs = [];
let orphanConfigurations = 0;

for (const name of collectionNames) {
  const collection = db.collection(name);
  const withBotId = await collection.countDocuments({ botId: { $exists: true, $nin: [null, ""] } }).catch(() => 0);
  if (!withBotId) continue;
  const referencedIds = await collection.distinct("botId", { botId: { $exists: true, $nin: [null, ""] } }).catch(() => []);
  const orphanIds = referencedIds.map(String).filter((id) => !botIds.has(id));
  const orphanCount = orphanIds.length
    ? await collection.countDocuments({ botId: { $in: orphanIds } }).catch(() => 0)
    : 0;
  configs.push({ collection: name, records: withBotId, orphanRecords: orphanCount });
  orphanConfigurations += orphanCount;
}

const report = {
  mode: "dry-run/read-only",
  database: db.databaseName,
  botCollection: "Bot",
  botsFound: bots.length,
  botsOnline: bots.filter((bot) => bot.status === "online").length,
  botsOffline: bots.filter((bot) => bot.status === "offline").length,
  botsWithError: bots.filter((bot) => bot.status === "error" || bot.status === "invalid_token").length,
  botsWithoutOwnerId: bots.filter((bot) => !bot.ownerId).length,
  botsWithoutGuildId: bots.filter((bot) => !bot.mainGuildId).length,
  duplicateClientIds,
  legacyCollections: await Promise.all(legacyNames.map(async (name) => ({
    collection: name,
    records: await db.collection(name).countDocuments({})
  }))),
  configurationCollections: configs,
  configurationsFound: configs.reduce((total, item) => total + item.records, 0),
  orphanConfigurations,
  recordsMigrated: 0,
  recordsModified: 0
};

console.log(JSON.stringify(report, null, 2));
await db.client.close();

function duplicateValues(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] ? String(item[key]) : null;
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}
