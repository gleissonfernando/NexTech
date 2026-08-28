import assert from "node:assert/strict";
import test from "node:test";
import { BotBootController, type BotBootTask } from "./bootController";

test("boot do bot isola falha de modulo normal como degraded sem crash", async () => {
  const controller = new BotBootController();
  const tasks: BotBootTask[] = [
    {
      enabled: true,
      name: "module:normal-failing",
      run: async () => {
        throw new Error("falha simulada");
      },
      tier: "normal"
    }
  ];

  await controller.runTier("STARTING_NORMAL_MODULES", tasks, 1);
  controller.finish();

  const snapshot = controller.snapshot();
  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.components[0]?.status, "FAILED");
});

test("background apos online nao recoloca o bot em estado de startup", async () => {
  const controller = new BotBootController();
  controller.markReady("Discord Gateway", "critical");
  controller.finish();

  controller.startBackground([
    {
      enabled: true,
      name: "module:background",
      run: async () => undefined,
      tier: "background"
    }
  ], 1);

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(controller.snapshot().status, "online");
});
