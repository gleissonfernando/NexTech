import assert from "node:assert/strict";
import test from "node:test";
import { BootController } from "./bootController";

test("boot controller registra progresso e memoria sem manter filas ilimitadas", () => {
  const controller = new BootController();
  controller.setState("BOOTING");

  const snapshot = controller.snapshot();
  assert.equal(snapshot.status, "booting");
  assert.equal(snapshot.targetMs, 60_000);
  assert.equal(snapshot.timeoutMs, 120_000);
  assert.ok(snapshot.memory.rssMb > 0);
});
