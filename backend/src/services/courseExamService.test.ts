import assert from "node:assert/strict";
import test from "node:test";
import type { MongoCourseExamQuestion } from "../database/mongo";
import { calculateMultipleChoiceScore, calculateSelectionScore, decideCourseExamResult, isObjectiveAnswerFullyScored, perfectAnswerScore } from "./courseExamService";

function objectiveQuestion(overrides: Partial<MongoCourseExamQuestion> = {}): MongoCourseExamQuestion {
  const now = new Date("2026-07-19T00:00:00.000Z");
  return {
    _id: "question-1",
    botId: "bot-1",
    guildId: "guild-1",
    courseId: "course-1",
    order: 1,
    questionNumber: 1,
    type: "selection",
    prompt: "Pergunta",
    title: "Pergunta",
    description: null,
    points: 1,
    alternatives: [
      { id: "correct", text: "Correta", isCorrect: true, score: 0 },
      { id: "wrong", text: "Errada", isCorrect: false, score: 0 }
    ],
    correctAlternativeId: "correct",
    correctAlternativeIds: [],
    correctText: null,
    placeholder: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    ...overrides
  };
}

test("resposta correta objetiva sem score positivo usa os pontos da pergunta", () => {
  const questions = Array.from({ length: 10 }, (_, index) => objectiveQuestion({ _id: `question-${index + 1}`, order: index + 1, questionNumber: index + 1 }));
  const score = questions.slice(0, 7).reduce((total, question) => total + calculateSelectionScore(question, question.alternatives[0]), 0);

  assert.equal(score, 7);
  assert.equal(decideCourseExamResult(score), "approved");
});

test("multipla escolha divide os pontos restantes entre corretas sem score", () => {
  const question = objectiveQuestion({
    type: "multiple",
    points: 1,
    alternatives: [
      { id: "a", text: "A", isCorrect: true, score: 0.25 },
      { id: "b", text: "B", isCorrect: true, score: 0 },
      { id: "c", text: "C", isCorrect: true },
      { id: "d", text: "D", isCorrect: false, score: 0 }
    ],
    correctAlternativeId: null,
    correctAlternativeIds: ["a", "b", "c"]
  });

  assert.equal(calculateMultipleChoiceScore(question, ["a", "b", "c"]), 1);
  assert.equal(calculateMultipleChoiceScore(question, ["b"]), 0.375);
});

test("resultado da prova segue nota minima fixa 6.0", () => {
  assert.equal(decideCourseExamResult(5.99), "rejected");
  assert.equal(decideCourseExamResult(6.00), "approved");
  assert.equal(decideCourseExamResult(6.01), "approved");
  assert.equal(decideCourseExamResult(6.10), "approved");
  assert.equal(decideCourseExamResult(6.50), "approved");
  assert.equal(decideCourseExamResult(7.25), "approved");
  assert.equal(decideCourseExamResult(10.00), "approved");
});

test("marcar todas as alternativas nao entrega mais a nota cheia", () => {
  const question = objectiveQuestion({
    type: "multiple",
    points: 1,
    alternatives: [
      { id: "a", text: "A", isCorrect: true, score: 0 },
      { id: "b", text: "B", isCorrect: true, score: 0 },
      { id: "c", text: "C", isCorrect: false, score: 0 },
      { id: "d", text: "D", isCorrect: false, score: 0 }
    ],
    correctAlternativeId: null,
    correctAlternativeIds: ["a", "b"]
  });

  // Duas corretas valem 0.5 cada; cada errada desconta 0.5.
  assert.equal(calculateMultipleChoiceScore(question, ["a", "b"]), 1);
  assert.equal(calculateMultipleChoiceScore(question, ["a", "b", "c", "d"]), 0);
  assert.equal(calculateMultipleChoiceScore(question, ["a", "b", "c"]), 0.5);
  assert.equal(calculateMultipleChoiceScore(question, ["a"]), 0.5);
  // Marcar so as erradas nunca gera nota negativa.
  assert.equal(calculateMultipleChoiceScore(question, ["c", "d"]), 0);
});

test("nota parcial continua valendo pontos, mas nao conta como acerto", () => {
  const question = objectiveQuestion({
    type: "multiple",
    points: 1,
    alternatives: [
      { id: "a", text: "A", isCorrect: true, score: 0 },
      { id: "b", text: "B", isCorrect: true, score: 0 },
      { id: "c", text: "C", isCorrect: true, score: 0 },
      { id: "d", text: "D", isCorrect: false, score: 0 }
    ],
    correctAlternativeId: null,
    correctAlternativeIds: ["a", "b", "c"]
  });

  const partial = calculateMultipleChoiceScore(question, ["a"]);
  const full = calculateMultipleChoiceScore(question, ["a", "b", "c"]);

  assert.ok(partial > 0, "resposta parcial deve continuar somando pontos");
  // Tres corretas de 1/3 nao fecham exatamente 1 em ponto flutuante; por isso a
  // comparacao de acerto usa tolerancia em vez de igualdade.
  assert.ok(Math.abs(perfectAnswerScore(question) - 1) < 1e-9);
  assert.equal(isObjectiveAnswerFullyScored(question, partial), false);
  assert.equal(isObjectiveAnswerFullyScored(question, full), true);
  // Acertar todas mas marcar uma errada tambem nao e acerto.
  assert.equal(isObjectiveAnswerFullyScored(question, calculateMultipleChoiceScore(question, ["a", "b", "c", "d"])), false);
});

test("questao de selecao unica: acerto so na alternativa correta", () => {
  const question = objectiveQuestion();
  const right = calculateSelectionScore(question, question.alternatives[0]);
  const wrong = calculateSelectionScore(question, question.alternatives[1]);

  assert.equal(right, 1);
  assert.equal(wrong, 0);
  assert.equal(isObjectiveAnswerFullyScored(question, right), true);
  assert.equal(isObjectiveAnswerFullyScored(question, wrong), false);
});

test("acerto respeita score explicito menor que os pontos da questao", () => {
  const question = objectiveQuestion({
    points: 2,
    alternatives: [
      { id: "correct", text: "Correta", isCorrect: true, score: 0.5 },
      { id: "wrong", text: "Errada", isCorrect: false, score: 0 }
    ]
  });
  const earned = calculateSelectionScore(question, question.alternatives[0]);

  // A melhor resposta possivel vale 0.5, entao 0.5 e acerto mesmo com points = 2.
  assert.equal(earned, 0.5);
  assert.equal(perfectAnswerScore(question), 0.5);
  assert.equal(isObjectiveAnswerFullyScored(question, earned), true);
});
