import { strict as assert } from "node:assert";
import { test } from "node:test";
import { coursePublicationCalendarDayKey, isCoursePublicationStartAllowedForDate } from "./courseService";

test("normaliza a data agendada do curso em chave diaria por Sao Paulo", () => {
  assert.equal(
    coursePublicationCalendarDayKey(new Date("2026-07-31T13:00:00.000Z"), "31/07 10:00"),
    "2026-07-31"
  );
});

test("usa scheduledFor legado quando scheduledStartAt nao existe", () => {
  assert.equal(coursePublicationCalendarDayKey(null, "31/07 10:00"), `${new Date().getFullYear()}-07-31`);
});

test("bloqueia inicio de curso agendado para dia futuro", () => {
  assert.equal(
    isCoursePublicationStartAllowedForDate(
      { scheduledFor: "31/07 10:00", scheduledStartAt: new Date("2026-07-31T13:00:00.000Z") },
      new Date("2026-07-30T15:00:00.000Z")
    ),
    false
  );
});

test("permite inicio quando chega o dia agendado", () => {
  assert.equal(
    isCoursePublicationStartAllowedForDate(
      { scheduledFor: "31/07 10:00", scheduledStartAt: new Date("2026-07-31T13:00:00.000Z") },
      new Date("2026-07-31T03:00:00.000Z")
    ),
    true
  );
});
