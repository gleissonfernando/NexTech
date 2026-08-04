import assert from "node:assert/strict";
import test from "node:test";
import { COURSE_PASSING_GRADE, evaluateCourseGrade, normalizeCourseGrade } from "./courseGradeService";

test("aprova somente nota final maior ou igual a 6", () => {
  assert.equal(COURSE_PASSING_GRADE, 6);
  assert.equal(evaluateCourseGrade(5.99).result, "rejected");
  assert.equal(evaluateCourseGrade(6).result, "approved");
  assert.equal(evaluateCourseGrade(6.01).result, "approved");
  assert.equal(evaluateCourseGrade(6.1).result, "approved");
  assert.equal(evaluateCourseGrade(6.5).result, "approved");
  assert.equal(evaluateCourseGrade(7.25).result, "approved");
  assert.equal(evaluateCourseGrade(10).result, "approved");
});

test("normaliza decimal com virgula e ponto antes de avaliar", () => {
  assert.equal(normalizeCourseGrade("6,00"), 6);
  assert.equal(normalizeCourseGrade("6.50"), 6.5);
  assert.equal(evaluateCourseGrade("5,99").result, "rejected");
  assert.equal(evaluateCourseGrade("6,00").result, "approved");
});

test("arredonda nota final para duas casas antes da comparacao", () => {
  assert.equal(normalizeCourseGrade(5.994), 5.99);
  assert.equal(evaluateCourseGrade(5.994).result, "rejected");
  assert.equal(normalizeCourseGrade(5.995), 6);
  assert.equal(evaluateCourseGrade(5.995).result, "approved");
});

test("bloqueia notas invalidas sem converter para zero", () => {
  assert.throws(() => normalizeCourseGrade("abc"), /Nota inválida/);
  assert.throws(() => normalizeCourseGrade(Number.NaN), /Nota inválida/);
  assert.throws(() => normalizeCourseGrade(-0.01), /Nota inválida/);
  assert.throws(() => normalizeCourseGrade(10.01), /Nota inválida/);
  assert.throws(() => normalizeCourseGrade("6,0,0"), /Nota inválida/);
});
