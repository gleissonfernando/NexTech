import assert from "node:assert/strict";
import test from "node:test";
import type { MongoCourseExamQuestion } from "../database/mongo";
import { calculateMultipleChoiceScore, calculateSelectionScore, decideCourseExamResult } from "./courseExamService";

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
  assert.equal(score >= 6, true);
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

test("resultado da prova segue a nota minima configurada", () => {
  assert.equal(decideCourseExamResult(5.99, { minScore: 6 }, 10), "rejected");
  assert.equal(decideCourseExamResult(6, { minScore: 6 }, 10), "approved");
  assert.equal(decideCourseExamResult(9.8, { minScore: 6 }, 10), "approved");
  assert.equal(decideCourseExamResult(9.8, { minScore: 98 }, 10), "approved");
});
