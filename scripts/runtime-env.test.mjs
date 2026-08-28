import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvIfConfigured, packedConfigValueFromEnv } from "./runtime-env.mjs";

test("packed config reads json values from env", () => {
  const value = packedConfigValueFromEnv({ APP_CONFIG_JSON: JSON.stringify({ START_REGISTERED_DEV_BOTS: "true" }) }, "START_REGISTERED_DEV_BOTS");
  assert.equal(value, "true");
});

test("applyEnvIfConfigured keeps existing values and ignores blanks", () => {
  const env = { START_REGISTERED_DEV_BOTS: "" };

  assert.equal(applyEnvIfConfigured(env, "START_REGISTERED_DEV_BOTS", ""), "");
  assert.equal(env.START_REGISTERED_DEV_BOTS, "");

  assert.equal(applyEnvIfConfigured(env, "START_REGISTERED_DEV_BOTS", "true"), "true");
  assert.equal(env.START_REGISTERED_DEV_BOTS, "true");

  assert.equal(applyEnvIfConfigured(env, "START_REGISTERED_DEV_BOTS", "false"), "true");
  assert.equal(env.START_REGISTERED_DEV_BOTS, "true");
});
