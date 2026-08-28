import assert from "node:assert/strict";
import test from "node:test";
import { classifyMemoryPressure, possibleMemoryLeak } from "./memoryMonitor";

test("classifica faixas de pressao de memoria do backend", () => {
  assert.equal(classifyMemoryPressure(900), "healthy");
  assert.equal(classifyMemoryPressure(1_250), "monitor");
  assert.equal(classifyMemoryPressure(1_320), "pressure");
  assert.equal(classifyMemoryPressure(1_420), "critical");
  assert.equal(classifyMemoryPressure(1_520), "emergency");
});

test("detecta crescimento continuo de RSS sem depender de snapshot unico", () => {
  assert.equal(possibleMemoryLeak([
    { rssMb: 800 },
    { rssMb: 830 },
    { rssMb: 860 },
    { rssMb: 900 },
    { rssMb: 930 },
    { rssMb: 950 }
  ]), true);

  assert.equal(possibleMemoryLeak([
    { rssMb: 900 },
    { rssMb: 940 },
    { rssMb: 910 },
    { rssMb: 930 },
    { rssMb: 920 },
    { rssMb: 925 }
  ]), false);
});
