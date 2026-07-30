import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isRegisteredBotIdentityMatch } from "./requestBotScopeService";

test("aceita requisicao de bot sem clientId para compatibilidade legada", () => {
  assert.equal(isRegisteredBotIdentityMatch("1492325134550302952", null), true);
  assert.equal(isRegisteredBotIdentityMatch("1492325134550302952", ""), true);
});

test("aceita requisicao quando bot cadastrado e clientId do token batem", () => {
  assert.equal(isRegisteredBotIdentityMatch("1492325134550302952", "1492325134550302952"), true);
});

test("bloqueia requisicao quando botId cadastrado aponta para outro clientId", () => {
  assert.equal(isRegisteredBotIdentityMatch("1492325134550302952", "1505924330490695800"), false);
});
