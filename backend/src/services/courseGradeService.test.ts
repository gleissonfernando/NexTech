import assert from "node:assert/strict";
import test from "node:test";
import { COURSE_PASSING_GRADE, evaluateCourseGrade, formatCourseGrade, normalizeCourseGrade } from "./courseGradeService";

test("aprova somente nota final maior ou igual a 6", () => {
  assert.equal(COURSE_PASSING_GRADE, 6);
  assert.equal(evaluateCourseGrade(5.99).result, "rejected");
  assert.equal(evaluateCourseGrade("5,99").resultado, "REPROVADO");
  assert.equal(evaluateCourseGrade(6).result, "approved");
  assert.equal(evaluateCourseGrade("6,00").resultado, "APROVADO");
  assert.equal(evaluateCourseGrade(6.01).result, "approved");
  assert.equal(evaluateCourseGrade(6.1).result, "approved");
  assert.equal(evaluateCourseGrade(6.5).result, "approved");
  assert.equal(evaluateCourseGrade(7.25).result, "approved");
  assert.equal(evaluateCourseGrade(10).result, "approved");
});

test("compreende todos os numeros inteiros de 0 a 10", () => {
  for (let grade = 0; grade <= 10; grade += 1) {
    assert.equal(evaluateCourseGrade(String(grade)).notaFinal, grade);
    assert.equal(evaluateCourseGrade(`${grade},0`).notaFinal, grade);
    assert.equal(evaluateCourseGrade(`${grade}.0`).notaFinal, grade);
  }
});

test("compreende todos os decimos com virgula e ponto entre 0 e 9", () => {
  for (let integer = 0; integer <= 9; integer += 1) {
    for (let decimal = 0; decimal <= 9; decimal += 1) {
      const expected = Number(`${integer}.${decimal}`);
      assert.equal(evaluateCourseGrade(`${integer},${decimal}`).notaFinal, expected);
      assert.equal(evaluateCourseGrade(`${integer}.${decimal}`).notaFinal, expected);
    }
  }
});

test("mantem a virgula como separador decimal sem transformar decimos em dezenas", () => {
  assert.equal(evaluateCourseGrade("1,1").notaFinal, 1.1);
  assert.equal(evaluateCourseGrade("5,9").notaFinal, 5.9);
  assert.equal(evaluateCourseGrade("6,1").notaFinal, 6.1);
  assert.equal(evaluateCourseGrade("7,5").notaFinal, 7.5);
  assert.equal(evaluateCourseGrade("9,9").notaFinal, 9.9);
});

test("reprova todos os decimos abaixo de 6 e aprova a partir de 6", () => {
  for (let decimal = 0; decimal <= 9; decimal += 1) {
    assert.equal(evaluateCourseGrade(`5,${decimal}`).aprovado, false);
    assert.equal(evaluateCourseGrade(`6,${decimal}`).aprovado, true);
  }
});

test("aceita dez inteiro e com zeros decimais, mas bloqueia acima de dez", () => {
  assert.equal(evaluateCourseGrade("10").notaFinal, 10);
  assert.equal(evaluateCourseGrade("10,0").notaFinal, 10);
  assert.equal(evaluateCourseGrade("10,00").notaFinal, 10);
  assert.equal(evaluateCourseGrade("10.0").notaFinal, 10);
  assert.equal(evaluateCourseGrade("10.00").notaFinal, 10);
  for (const value of ["10,1", "10.1", "10,5", "10.5", "10,9", "10.9", "11", "100"]) {
    assert.throws(() => normalizeCourseGrade(value), /nota|Formato/i);
  }
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
  for (const value of [-1, "-1", "-0,1", "6,,1", "6..1", "6,1,2", "6.1.2", "1,2,3", "abc", "seis", Number.NaN, "NaN", Infinity, "Infinity", ""]) {
    assert.throws(() => normalizeCourseGrade(value), /nota|Formato/i);
  }
  assert.throws(() => normalizeCourseGrade(null), /não foi informada/);
  assert.throws(() => normalizeCourseGrade(undefined), /não foi informada/);
});

test("formata nota para exibicao brasileira sem alterar valor real", () => {
  assert.equal(formatCourseGrade(5.9), "5,9");
  assert.equal(formatCourseGrade(6), "6,0");
  assert.equal(formatCourseGrade(6.5), "6,5");
  assert.equal(formatCourseGrade(10), "10,0");
});
