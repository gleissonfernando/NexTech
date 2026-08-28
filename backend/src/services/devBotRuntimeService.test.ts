import assert from "node:assert/strict";
import test from "node:test";
import { resolveDevBotStartBatchPlan } from "./devBotRuntimeService";

test("startup batch plan ignora stagger e usa a maior concorrencia necessaria", () => {
  const plan = resolveDevBotStartBatchPlan(12, 1, 45_000, true);

  assert.equal(plan.concurrency, 12);
  assert.equal(plan.staggerMs, 0);
});

test("batch plan normal preserva os valores configurados", () => {
  const plan = resolveDevBotStartBatchPlan(12, 8, 1_000, false);

  assert.equal(plan.concurrency, 8);
  assert.equal(plan.staggerMs, 1_000);
});
