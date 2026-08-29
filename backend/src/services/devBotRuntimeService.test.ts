import assert from "node:assert/strict";
import test from "node:test";
import { resolveDevBotStartBatchPlan, resolveDevBotStartRetryDelayMs, shouldEmitDevBotShutdownSignal } from "./devBotRuntimeService";

test("startup batch plan preserva limites configurados para evitar burst no Discord", () => {
  const plan = resolveDevBotStartBatchPlan(12, 1, 45_000, true);

  assert.equal(plan.concurrency, 1);
  assert.equal(plan.staggerMs, 45_000);
});

test("batch plan normal preserva os valores configurados", () => {
  const plan = resolveDevBotStartBatchPlan(12, 8, 1_000, false);

  assert.equal(plan.concurrency, 8);
  assert.equal(plan.staggerMs, 1_000);
});

test("retry de start usa backoff deterministico por bot", () => {
  const first = resolveDevBotStartRetryDelayMs("bot-1234");
  const second = resolveDevBotStartRetryDelayMs("bot-1234");

  assert.ok(second > first);
  assert.equal(first % 1_000, 234);
});

test("shutdown por socket só é emitido quando existe runtime filho", () => {
  assert.equal(shouldEmitDevBotShutdownSignal(false, true), false);
  assert.equal(shouldEmitDevBotShutdownSignal(true, false), false);
  assert.equal(shouldEmitDevBotShutdownSignal(true, true), true);
});
