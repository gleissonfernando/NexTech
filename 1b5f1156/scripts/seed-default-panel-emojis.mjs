import "dotenv/config";

const { seedDefaultPanelEmojisForAllBots } = await import("../backend/dist/services/defaultPanelEmojiService.js");

const results = await seedDefaultPanelEmojisForAllBots();
const ok = results.filter((result) => result.ok).length;
const failed = results.length - ok;

console.log(JSON.stringify({ failed, ok, total: results.length }, null, 2));
