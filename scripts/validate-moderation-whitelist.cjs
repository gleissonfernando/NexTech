const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const policy = require(path.join(root, "bot/dist/services/moderationChannelPolicy.js"));
const allowed = ["links", "images", "attachments", "videos", "gifs"];

for (const channelId of allowed) {
  assert.equal(policy.isChannelIdWhitelisted(channelId, null, allowed), true, `${channelId} deveria estar liberado`);
}
assert.equal(policy.isChannelIdWhitelisted("thread", "images", allowed), true, "thread deve herdar whitelist do canal pai");
assert.equal(policy.isChannelIdWhitelisted("blocked", null, allowed), false, "canal fora da whitelist deve ser moderável");

for (const file of [
  "bot/src/services/safeBotService.ts",
  "bot/src/services/selfBotProtectionService.ts",
  "bot/src/services/imageAntiSpamService.ts",
  "bot/src/services/linkAntiSpamService.ts"
]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.match(source, /canModerateMessage\(message, context,/, `${file} não usa a política central`);
}

console.log("[ok] whitelist global: links, imagens, anexos, vídeos, GIFs, combinações e threads");
