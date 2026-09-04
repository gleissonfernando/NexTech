import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAnswer,
  normalizeDateAnswer,
  normalizeTimeAnswer,
  POLICE_RECRUITMENT_DEFAULT_QUESTIONS
} from "./policeRecruitmentService";

test("data aceita os formatos que o recrutador digita e guarda em dd/mm/aaaa", () => {
  assert.equal(normalizeDateAnswer("04/09/2026"), "04/09/2026");
  assert.equal(normalizeDateAnswer("4/9/2026"), "04/09/2026");
  assert.equal(normalizeDateAnswer("04-09-2026"), "04/09/2026");
  assert.equal(normalizeDateAnswer("2026-09-04"), "04/09/2026");
  assert.equal(normalizeDateAnswer("04/09/26"), "04/09/2026");
  assert.equal(normalizeDateAnswer(""), null);
});

test("data invalida e recusada com mensagem util", () => {
  assert.throws(() => normalizeDateAnswer("31/02/2026"), /Data inexistente/);
  assert.throws(() => normalizeDateAnswer("32/01/2026"), /Data inexistente/);
  assert.throws(() => normalizeDateAnswer("13/13/2026"), /Data inexistente/);
  assert.throws(() => normalizeDateAnswer("ontem"), /dd\/mm\/aaaa/);
});

test("29 de fevereiro so passa em ano bissexto", () => {
  assert.equal(normalizeDateAnswer("29/02/2028"), "29/02/2028");
  assert.throws(() => normalizeDateAnswer("29/02/2026"), /Data inexistente/);
});

test("horario aceita HH:MM, HHhMM e com segundos", () => {
  assert.equal(normalizeTimeAnswer("14:29"), "14:29");
  assert.equal(normalizeTimeAnswer("9:05"), "09:05");
  assert.equal(normalizeTimeAnswer("14h30"), "14:30");
  assert.equal(normalizeTimeAnswer("23:59:59"), "23:59");
  assert.equal(normalizeTimeAnswer(""), null);
});

test("horario invalido e recusado", () => {
  assert.throws(() => normalizeTimeAnswer("24:00"), /00:00 até 23:59/);
  assert.throws(() => normalizeTimeAnswer("10:70"), /00:00 até 23:59/);
  assert.throws(() => normalizeTimeAnswer("meio-dia"), /HH:MM/);
});

test("multipla selecao guarda a lista de etapas marcadas", () => {
  assert.deepEqual(
    normalizeAnswer("MULTI_SELECT", ["Formação", "Juramento"]),
    ["Formação", "Juramento"]
  );
  assert.deepEqual(normalizeAnswer("MULTI_SELECT", []), []);
});

test("tipos antigos continuam com o mesmo comportamento", () => {
  assert.equal(normalizeAnswer("NUMBER", "7,5"), 7.5);
  assert.equal(normalizeAnswer("BOOLEAN", "Sim"), true);
  assert.equal(normalizeAnswer("BOOLEAN", "Não"), false);
  assert.equal(normalizeAnswer("TEXT", "  resposta  "), "resposta");
  assert.equal(normalizeAnswer("TEXT", null), null);
  assert.throws(() => normalizeAnswer("NUMBER", "abc"), /número válido/);
});

test("formulario padrao reproduz o relatorio F.T.O.", () => {
  const questions = POLICE_RECRUITMENT_DEFAULT_QUESTIONS;
  assert.equal(questions.length, 11);

  assert.equal(questions[0]?.title, "Data do recrutamento");
  assert.equal(questions[0]?.type, "DATE");
  assert.equal(questions[1]?.type, "TIME");
  assert.equal(questions[2]?.type, "TIME");

  const etapas = questions.find((question) => question.type === "MULTI_SELECT");
  assert.ok(etapas, "a pergunta de etapas precisa ser de selecao multipla");
  assert.equal(etapas?.options.length, 12);
  assert.ok(etapas?.options.includes("Juramento"));

  const padrao = questions.find((question) => question.title.startsWith("O recrutamento seguiu"));
  assert.deepEqual(padrao?.options, ["Sim", "Parcialmente", "Não"]);

  // "Houve problemas" e o unico campo opcional do formulario.
  const opcionais = questions.filter((question) => !question.required).map((question) => question.title);
  assert.deepEqual(opcionais, ["Houve problemas durante o recrutamento?"]);

  // Nenhuma pergunta pode passar do limite de opcoes de um select do Discord.
  for (const question of questions) {
    assert.ok(question.options.length <= 25, `${question.title} excede 25 opcoes`);
  }
});
