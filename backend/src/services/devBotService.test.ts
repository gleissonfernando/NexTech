import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDiscordBotToken } from "./devBotService";

test("normalizeDiscordBotToken remove prefixo Bot e aspas sem alterar token valido", () => {
  assert.equal(normalizeDiscordBotToken('  "Bot abc.def.ghi"  '), "abc.def.ghi");
  assert.equal(normalizeDiscordBotToken("abc.def.ghi"), "abc.def.ghi");
});
