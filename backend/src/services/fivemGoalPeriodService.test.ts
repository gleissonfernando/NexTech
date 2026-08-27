import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFivemGoalSettings,
  fivemGoalPeriodContains,
  nextFivemGoalPeriodWindow,
  openEndedFivemGoalPeriodPatch,
  resolveFivemGoalPeriodWindow
} from "./fivemGoalService";

const previousPeriod = {
  endAt: new Date("2026-08-02T18:00:00.000Z"),
  startAt: new Date("2026-07-26T18:00:00.000Z")
};
const nextPeriod = {
  endAt: new Date("2026-08-09T18:00:00.000Z"),
  startAt: new Date("2026-08-02T18:00:00.000Z")
};

test("periodo de meta usa intervalo fechado no inicio e aberto no fechamento", () => {
  assert.equal(fivemGoalPeriodContains(previousPeriod, new Date("2026-08-02T17:59:59.999Z")), true);
  assert.equal(fivemGoalPeriodContains(previousPeriod, new Date("2026-08-02T18:00:00.000Z")), false);
  assert.equal(fivemGoalPeriodContains(nextPeriod, new Date("2026-08-02T18:00:00.000Z")), true);
});

test("proximo periodo inicia exatamente no fechamento do periodo anterior", () => {
  const window = nextFivemGoalPeriodWindow(previousPeriod);

  assert.equal(window.startAt.toISOString(), previousPeriod.endAt.toISOString());
  assert.equal(window.endAt.toISOString(), nextPeriod.endAt.toISOString());
});

test("janela semanal configurada separa registros no horario exato do fechamento", () => {
  const settings = defaultFivemGoalSettings("guild", "bot");
  settings.cycle = { ...settings.cycle, endDay: 0, endTime: "15:00", frequency: "weekly" };

  const beforeCut = resolveFivemGoalPeriodWindow(settings, new Date("2026-08-02T17:59:59.999Z"));
  assert.equal(beforeCut.start.toISOString(), previousPeriod.startAt.toISOString());
  assert.equal(beforeCut.end.toISOString(), previousPeriod.endAt.toISOString());

  const atCut = resolveFivemGoalPeriodWindow(settings, new Date("2026-08-02T18:00:00.000Z"));
  assert.equal(atCut.start.toISOString(), nextPeriod.startAt.toISOString());
  assert.equal(atCut.end.toISOString(), nextPeriod.endAt.toISOString());
});

test("periodo aberto por metas ilimitadas zera os estados de fechamento", () => {
  const patch = openEndedFivemGoalPeriodPatch(new Date("2026-08-27T12:00:00.000Z"));

  assert.equal(patch.status, "ACTIVE");
  assert.equal(patch.closedAt, null);
  assert.equal(patch.closingStartedAt, null);
  assert.equal(patch.endAt.toISOString(), "9999-12-31T23:59:59.999Z");
  assert.equal(patch.cutAt.toISOString(), "9999-12-31T23:59:59.999Z");
});
