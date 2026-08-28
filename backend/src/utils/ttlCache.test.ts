import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCache } from "./ttlCache";

test("ttl cache retorna valor antes da expiracao", () => {
  const cache = createTtlCache<string>(1_000);
  cache.set("bot:1", "ready", 100);

  assert.equal(cache.getValue("bot:1", 500), "ready");
  assert.equal(cache.getEntry("bot:1", 500)?.value, "ready");
});

test("ttl cache remove valor expirado ao consultar", () => {
  const cache = createTtlCache<string>(1_000);
  cache.set("bot:1", "ready", 100);

  assert.equal(cache.getValue("bot:1", 1_200), undefined);
  assert.equal(cache.getEntry("bot:1", 1_200), null);
});
