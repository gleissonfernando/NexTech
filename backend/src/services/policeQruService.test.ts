import assert from "node:assert/strict";
import test from "node:test";
import {
  endOfPoliceQruRankingCycle,
  parseEvidenceUrlList,
  policeQruRankingCutoff,
  POLICE_QRU_RANKING_CYCLE_DAYS,
  startOfPoliceQruRankingCycle
} from "./policeQruService";

test("ranking de QRU zera a cada 15 dias, sempre as 14:00 de Brasilia", () => {
  assert.equal(POLICE_QRU_RANKING_CYCLE_DAYS, 15);

  // Um segundo antes da virada ainda pertence ao ciclo anterior.
  assert.equal(
    startOfPoliceQruRankingCycle(new Date("2026-08-14T16:59:59.000Z")).toISOString(),
    "2026-07-30T17:00:00.000Z"
  );
  // No instante exato da virada, o ciclo novo comeca.
  assert.equal(
    startOfPoliceQruRankingCycle(new Date("2026-08-14T17:00:00.000Z")).toISOString(),
    "2026-08-14T17:00:00.000Z"
  );
  // No meio do ciclo, o corte continua sendo o inicio dele.
  assert.equal(
    startOfPoliceQruRankingCycle(new Date("2026-08-19T12:00:00.000Z")).toISOString(),
    "2026-08-14T17:00:00.000Z"
  );
});

test("ciclos consecutivos tem exatamente 15 dias", () => {
  const first = startOfPoliceQruRankingCycle(new Date("2026-08-19T12:00:00.000Z"));
  const next = startOfPoliceQruRankingCycle(new Date("2026-08-30T12:00:00.000Z"));

  assert.equal((next.getTime() - first.getTime()) / 86_400_000, 15);
  assert.equal(
    endOfPoliceQruRankingCycle(new Date("2026-08-19T12:00:00.000Z")).getTime() + 1,
    next.getTime()
  );
});

test("corte do ranking respeita reset manual apenas dentro do ciclo atual", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  assert.equal(
    policeQruRankingCutoff({ rankingResetAt: new Date("2026-08-18T12:00:00.000Z") }, now).toISOString(),
    "2026-08-18T12:00:00.000Z"
  );
  // Reset manual de um ciclo anterior nao vale mais: o corte volta a ser a virada.
  assert.equal(
    policeQruRankingCutoff({ rankingResetAt: new Date("2026-08-10T18:00:00.000Z") }, now).toISOString(),
    "2026-08-14T17:00:00.000Z"
  );
});

test("evidencias aceitam varias URLs e ignoram texto que nao e link", () => {
  assert.deepEqual(
    parseEvidenceUrlList("https://cdn.discordapp.com/a.png?ex=1&is=2\nhttp://site.com/img\nqualquer texto"),
    ["https://cdn.discordapp.com/a.png?ex=1&is=2", "http://site.com/img"]
  );
  assert.deepEqual(parseEvidenceUrlList(null), []);
  assert.deepEqual(parseEvidenceUrlList("ftp://site.com/a.png"), []);
});
