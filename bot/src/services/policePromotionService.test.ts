import assert from "node:assert/strict";
import test from "node:test";
import { isEvaluationStepButtonDisabled } from "./policePromotionService";

function completeDraft(overrides: Record<string, unknown> = {}) {
  return {
    conduct: "Comportamento: Bom\nComunicação: Bom\nAdaptação: Bom",
    final: "Apto: Sim\nJustificativa: Demonstrou desempenho suficiente para seguir para a próxima patente.",
    guildId: "guild",
    notes: "Pontos fortes: Boa postura\nMelhorias: Continuar evoluindo\nIntervenção: Não",
    operational: "Decisões: Bom\nAbordagens: Bom\nAcompanhamentos: Bom",
    patrol: "Data: 26/07/2026\nInicio: 10:00\nFim: 11:00",
    requestId: "request",
    updatedAt: Date.now(),
    userId: "evaluator",
    ...overrides
  } as any;
}

test("etapa final invalida continua reabrivel para correcao", () => {
  const draft = completeDraft({
    final: "Apto: Sim\nJustificativa: ok"
  });

  assert.equal(isEvaluationStepButtonDisabled(draft, "final"), false);
});

test("etapa final valida fica bloqueada como concluida", () => {
  assert.equal(isEvaluationStepButtonDisabled(completeDraft(), "final"), true);
});
