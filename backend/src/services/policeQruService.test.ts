import assert from "node:assert/strict";
import test from "node:test";
import { policeQruRankingCutoff, startOfPoliceQruWeek } from "./policeQruService";

test("semana do ranking de QRU vira segunda-feira as 14:00 em Brasilia", () => {
  assert.equal(
    startOfPoliceQruWeek(new Date("2026-08-17T16:59:59.000Z")).toISOString(),
    "2026-08-10T17:00:00.000Z"
  );
  assert.equal(
    startOfPoliceQruWeek(new Date("2026-08-17T17:00:00.000Z")).toISOString(),
    "2026-08-17T17:00:00.000Z"
  );
});

test("corte do ranking respeita reset manual apenas dentro da semana atual", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  assert.equal(
    policeQruRankingCutoff({ rankingResetAt: new Date("2026-08-18T12:00:00.000Z") }, now).toISOString(),
    "2026-08-18T12:00:00.000Z"
  );
  assert.equal(
    policeQruRankingCutoff({ rankingResetAt: new Date("2026-08-10T18:00:00.000Z") }, now).toISOString(),
    "2026-08-17T17:00:00.000Z"
  );
});
