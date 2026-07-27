import assert from "node:assert/strict";
import test from "node:test";
import { approvalPayload, approvalPayloads, displayableComponentTextSize, evaluationDraftFromRequest, isEvaluationStepButtonDisabled } from "./policePromotionService";

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

test("rascunho de avaliacao restaura resposta pendente persistida", () => {
  const request = {
    history: [
      {
        action: "request.evaluation_step_saved",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T09:56:00.000Z",
        metadata: {
          answer: "Data: 27/07/2026\nInicio: 10:00\nFim: 11:00",
          step: "patrol"
        }
      },
      {
        action: "request.evaluation_step_saved",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T09:57:00.000Z",
        metadata: {
          answer: "Decisões: Bom\nAbordagens: Bom\nAcompanhamentos: Bom",
          step: "operational"
        }
      },
      {
        action: "request.evaluation_step_saved",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T09:58:00.000Z",
        metadata: {
          answer: "Comportamento: Bom\nComunicação: Bom\nAdaptação: Bom",
          step: "conduct"
        }
      },
      {
        action: "request.evaluation_step_saved",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T09:59:00.000Z",
        metadata: {
          answer: "Pontos fortes: Boa postura\nMelhorias: Continuar evoluindo\nIntervenção: Não",
          step: "notes"
        }
      },
      {
        action: "request.evaluation_step_started",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T10:00:00.000Z",
        metadata: { step: "final" }
      },
      {
        action: "request.evaluation_step_pending",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T10:01:00.000Z",
        metadata: {
          answer: "Apto: Sim\nJustificativa: Demonstrou desempenho suficiente para seguir.",
          step: "final"
        }
      }
    ],
    id: "request"
  };

  const draft = evaluationDraftFromRequest(request as any, "evaluator", "guild");

  assert.equal(draft.pending?.step, "final");
  assert.equal(draft.pending?.answer, "Apto: Sim\nJustificativa: Demonstrou desempenho suficiente para seguir.");
});

test("rascunho de avaliacao restaura etapa salva e libera proxima", () => {
  const request = {
    history: [
      {
        action: "request.evaluation_step_saved",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T10:00:00.000Z",
        metadata: {
          answer: "Data: 27/07/2026\nInicio: 10:00\nFim: 11:00",
          step: "patrol"
        }
      },
      {
        action: "request.evaluation_step_pending",
        actorId: "evaluator",
        actorName: "Instrutor",
        at: "2026-07-27T10:01:00.000Z",
        metadata: {
          answer: "Decisões: Bom\nAbordagens: Bom\nAcompanhamentos: Bom",
          step: "operational"
        }
      }
    ],
    id: "request"
  };

  const draft = evaluationDraftFromRequest(request as any, "evaluator", "guild");

  assert.equal(draft.patrol, "Data: 27/07/2026\nInicio: 10:00\nFim: 11:00");
  assert.equal(draft.pending?.step, "operational");
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

test("relatorio de aprovacao nao envia painel de historico completo", () => {
  const request = {
    answers: [{ label: "Conduta", value: "Resposta completa" }],
    approvalMessageId: null,
    approvalReason: null,
    approvalResult: null,
    approvedAt: null,
    approvedById: null,
    channelId: "channel",
    currentRank: "Soldado",
    evaluationEndedAt: "2026-07-26T15:00:00.000Z",
    evaluationNotes: "Observacao completa",
    evaluationResult: "approved",
    evaluatorId: "222222222222222222",
    history: [{
      action: "request.evaluation_report_sent",
      actorId: "222222222222222222",
      actorName: "Instrutor",
      at: "2026-07-26T15:00:00.000Z",
      metadata: {}
    }],
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

  const payloads = approvalPayloads(request as any, promotion as any, null as any);
  const serialized = JSON.stringify(payloads.map((payload) => payload.components));

  assert.equal(serialized.includes("Histórico completo"), false);
  assert.equal(serialized.includes("Historico completo"), false);
});

test("relatorio de aprovacao curto fica em um painel com botoes fora do container", () => {
  const request = {
    answers: [
      { label: "Identificação da Patrulha", value: "Patrulha realizada com presença completa." },
      { label: "Avaliação Operacional", value: "Atuação consistente e comunicação clara." }
    ],
    approvalMessageId: null,
    approvalReason: null,
    approvalResult: null,
    approvedAt: null,
    approvedById: null,
    channelId: "channel",
    currentRank: "Soldado",
    evaluationEndedAt: "2026-07-26T15:00:00.000Z",
    evaluationNotes: "Sem observações adicionais.",
    evaluationResult: "approved",
    evaluatorId: "222222222222222222",
    history: [],
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

  const payloads = approvalPayloads(request as any, promotion as any, null as any);
  const components = payloads[0]!.components as any[];
  const container = components[0] as any;
  const containerText = JSON.stringify(container);
  const buttonRowText = JSON.stringify(components[1]);

  assert.equal(payloads.length, 1);
  assert.equal(components.length, 2);
  assert.equal(container.type, 17);
  assert.equal(containerText.includes("Respostas completas"), true);
  assert.equal(containerText.includes("Observações completas"), true);
  assert.equal(containerText.includes("Aprovar Promoção"), false);
  assert.equal(buttonRowText.includes("Aprovar Promoção"), true);
});

test("relatorio de aprovacao decidido nao mantem botoes desativados", () => {
  const request = {
    answers: [{ label: "Conduta", value: "Resposta completa" }],
    approvalMessageId: null,
    approvalReason: "Aprovado pela coordenação.",
    approvalResult: "approved",
    approvedAt: "2026-07-26T16:00:00.000Z",
    approvedById: "333333333333333333",
    channelId: "channel",
    currentRank: "Soldado",
    evaluationEndedAt: "2026-07-26T15:00:00.000Z",
    evaluationNotes: "Observacao completa",
    evaluationResult: "approved",
    evaluatorId: "222222222222222222",
    history: [],
    id: "request-id",
    requesterId: "111111111111111111",
    requesterName: "Usuario Avaliado",
    status: "approved",
    targetRank: "Officer",
    updatedAt: "2026-07-26T16:00:00.000Z"
  };
  const promotion = {
    color: "#facc15",
    requestNewEvaluationEnabled: true
  };

  const payload = approvalPayload(request as any, promotion as any, null as any, true);
  const serialized = JSON.stringify(payload.components);

  assert.equal(serialized.includes("Aprovar Promoção"), false);
  assert.equal(serialized.includes("Reprovar Promoção"), false);
});
