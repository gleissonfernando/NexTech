import assert from "node:assert/strict";
import test from "node:test";
import { approvalPayload, displayableComponentTextSize, isEvaluationStepButtonDisabled } from "./policePromotionService";

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

test("relatorio de aprovacao respeita limite de texto dos componentes do Discord", () => {
  const longText = "Texto longo da avaliacao com detalhes operacionais. ".repeat(180);
  const request = {
    answers: Array.from({ length: 8 }, (_, index) => ({
      label: `Pergunta ${index + 1}`,
      value: longText
    })),
    approvalMessageId: null,
    approvalReason: `${longText}${longText}`,
    approvalResult: null,
    approvedAt: null,
    approvedById: null,
    channelId: "channel",
    currentRank: "Soldado",
    evaluationEndedAt: "2026-07-26T15:00:00.000Z",
    evaluationNotes: `${longText}${longText}${longText}`,
    evaluationResult: "approved",
    evaluatorId: "222222222222222222",
    history: Array.from({ length: 80 }, (_, index) => ({
      action: "request.evaluation_step_saved",
      actorId: index % 2 ? "222222222222222222" : null,
      actorName: "Instrutor",
      at: "2026-07-26T15:00:00.000Z",
      metadata: {}
    })),
    id: "request-id",
    requesterId: "111111111111111111",
    requesterName: "Usuario Avaliado",
    status: "pending_approval",
    targetRank: "Officer",
    updatedAt: "2026-07-26T15:00:00.000Z"
  };
  const promotion = {
    color: "#facc15",
    requestNewEvaluationEnabled: true
  };
  const payload = approvalPayload(request as any, promotion as any, null as any);

  assert.ok(displayableComponentTextSize(payload.components) <= 4000);
});
