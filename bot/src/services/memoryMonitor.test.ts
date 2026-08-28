import assert from "node:assert/strict";
import test from "node:test";
import { classifyMemoryPressure, possibleMemoryLeak } from "./memoryMonitor";

test("classifica faixas de pressao de memoria do bot", () => {
  assert.equal(classifyMemoryPressure(900), "healthy");
  assert.equal(classifyMemoryPressure(1_250), "monitor");
  assert.equal(classifyMemoryPressure(1_320), "pressure");
  assert.equal(classifyMemoryPressure(1_420), "critical");
  assert.equal(classifyMemoryPressure(1_520), "emergency");
});

test("detecta tendencia de vazamento por historico do bot", () => {
  assert.equal(possibleMemoryLeak([
    { rssMb: 700 },
    { rssMb: 730 },
    { rssMb: 760 },
    { rssMb: 800 },
    { rssMb: 830 },
    { rssMb: 845 }
  ]), true);

  assert.equal(possibleMemoryLeak([
    { rssMb: 820 },
    { rssMb: 860 },
    { rssMb: 835 },
    { rssMb: 840 },
    { rssMb: 830 },
    { rssMb: 825 }
  ]), false);
});
