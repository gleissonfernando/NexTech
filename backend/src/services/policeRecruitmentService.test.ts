import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAnswer,
  normalizeDateAnswer,
  normalizeTimeAnswer,
  normalizeQuestionType,
  POLICE_RECRUITMENT_DEFAULT_QUESTIONS,
  validatePoliceReportsConfiguration
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

test("validacao aponta exatamente o que falta para publicar o painel", () => {
  const questions = [{ enabled: true }];
  const completo = {
    enabled: true,
    temporaryCategoryId: "1",
    panelChannelId: "2",
    reportsForumChannelId: "3",
    logChannelId: "4",
    recruiterRoleIds: ["1348411317194850445"],
    supervisorRoleIds: ["1348411317194850446"]
  };

  assert.equal(validatePoliceReportsConfiguration(completo, questions).ready, true);

  const semForum = validatePoliceReportsConfiguration({ ...completo, reportsForumChannelId: null, forumChannelId: null }, questions);
  assert.equal(semForum.ready, false);
  assert.deepEqual(semForum.checks.filter((item) => !item.ok).map((item) => item.label), ["Fórum dos relatórios"]);

  // Sem nenhuma pergunta ativa o modulo tambem nao pode publicar.
  const semPerguntas = validatePoliceReportsConfiguration(completo, [{ enabled: false }]);
  assert.equal(semPerguntas.ready, false);
  assert.deepEqual(semPerguntas.checks.filter((item) => !item.ok).map((item) => item.label), ["Perguntas configuradas"]);

  // O forum legado (forumChannelId) continua valendo para servidores antigos.
  const forumLegado = validatePoliceReportsConfiguration({ ...completo, reportsForumChannelId: null, forumChannelId: "9" }, questions);
  assert.equal(forumLegado.ready, true);
});

test("tipos novos de pergunta sao preservados ao salvar", () => {
  for (const type of ["DATE", "TIME", "MULTI_SELECT", "SELECT", "BOOLEAN", "NUMBER", "LONG_TEXT", "USER_SELECT", "ROLE_SELECT", "TEXT"]) {
    assert.equal(normalizeQuestionType(type), type, type + ' nao deveria virar TEXT');
  }
  assert.equal(normalizeQuestionType("INEXISTENTE"), "TEXT");
  assert.equal(normalizeQuestionType(undefined), "TEXT");
});
