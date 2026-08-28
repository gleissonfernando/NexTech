import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTaskQueue } from "./boundedTaskQueue";

test("fila executa tarefas de alta prioridade antes das demais", async () => {
  const executed: string[] = [];
  const queue = new BoundedTaskQueue(1, 10, () => undefined);

  queue.enqueue("low", async () => {
    executed.push("low");
  }, "low");

  queue.enqueue("normal", async () => {
    executed.push("normal");
  }, "normal");

  queue.enqueue("high", async () => {
    executed.push("high");
  }, "high");

  await queue.stopAndDrain(100);

  assert.deepEqual(executed, ["low", "high", "normal"]);
});

test("fila descarta tarefas de baixa prioridade quando a fila enche e uma tarefa alta chega", async () => {
  const executed: string[] = [];
  const queue = new BoundedTaskQueue(0, 2, () => undefined);

  assert.equal(queue.enqueue("low-1", async () => {
    executed.push("low-1");
  }, "low"), true);

  assert.equal(queue.enqueue("normal-1", async () => {
    executed.push("normal-1");
  }, "normal"), true);

  assert.equal(queue.enqueue("high-1", async () => {
    executed.push("high-1");
  }, "high"), true);

  const snapshot = queue.snapshot();
  assert.equal(snapshot.pending, 2);
  assert.deepEqual(snapshot.pendingByPriority, {
    high: 1,
    normal: 1,
    low: 0
  });

  await queue.stopAndDrain(100);
  assert.deepEqual(executed, []);
});
