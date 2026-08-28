import assert from "node:assert/strict";
import { test } from "node:test";
import { policyForRequest } from "./rateLimit";

test("rate limit policy classifies health as public but skipped upstream", () => {
  const policy = policyForRequest({
    method: "GET",
    path: "/health"
  } as never);

  assert.equal(policy.keyPrefix, "public");
});

test("rate limit policy classifies auth requests separately", () => {
  const policy = policyForRequest({
    method: "POST",
    path: "/api/auth/login"
  } as never);

  assert.equal(policy.keyPrefix, "auth");
});

test("rate limit policy classifies bot runtime reads separately", () => {
  const policy = policyForRequest({
    method: "GET",
    path: "/api/bot/runtime/modules"
  } as never);

  assert.equal(policy.keyPrefix, "bot-runtime");
});

test("rate limit policy classifies module bot runtime reads separately", () => {
  const policy = policyForRequest({
    method: "GET",
    path: "/api/courses/bot/123/settings"
  } as never);

  assert.equal(policy.keyPrefix, "bot-runtime");
});

test("rate limit policy classifies bot runtime mutations separately", () => {
  const policy = policyForRequest({
    method: "POST",
    path: "/api/bot/runtime/status"
  } as never);

  assert.equal(policy.keyPrefix, "bot-mutation");
});

test("rate limit policy classifies module bot runtime mutations separately", () => {
  const policy = policyForRequest({
    method: "POST",
    path: "/api/police-qru/bot/logs"
  } as never);

  assert.equal(policy.keyPrefix, "bot-mutation");
});
