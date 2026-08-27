import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyUpdateContent, type UpdateCategory, type UpdateRule } from "./updateSystemService";

const categories: Array<Pick<UpdateCategory, "id" | "name" | "keywords" | "priority" | "enabled" | "autoClassificationEnabled">> = [
  { id: "novidades", name: "Novidades", keywords: ["novo", "adicionado", "criado", "implementado"], priority: 100, enabled: true, autoClassificationEnabled: true },
  { id: "correcoes", name: "Correções", keywords: ["corrigido", "bug", "erro", "problema"], priority: 90, enabled: true, autoClassificationEnabled: true },
  { id: "melhorias", name: "Melhorias", keywords: ["melhorado", "otimizado", "refatorado"], priority: 80, enabled: true, autoClassificationEnabled: true }
];

describe("classifyUpdateContent", () => {
  it("classifica novidades por palavras-chave do título e descrição", () => {
    const result = classifyUpdateContent({
      title: "Novo sistema de inventário",
      description: "Adicionado suporte a peso e novos slots.",
      changes: []
    }, categories);

    assert.equal(result[0]?.categoryId, "novidades");
    assert.ok((result[0]?.confidence ?? 0) >= 90);
  });

  it("classifica correções por mudanças corrigidas", () => {
    const result = classifyUpdateContent({
      title: "Patch de estabilidade",
      description: "",
      changes: [{ id: "1", text: "Corrigido erro que fazia jogadores perderem itens." }]
    }, categories);

    assert.equal(result[0]?.categoryId, "correcoes");
  });

  it("permite múltiplas categorias quando o conteúdo mistura contexto", () => {
    const result = classifyUpdateContent({
      title: "Atualização geral",
      description: "",
      changes: [
        { id: "1", text: "Adicionado novo painel administrativo." },
        { id: "2", text: "Corrigido bug de sincronização." },
        { id: "3", text: "Otimizado carregamento do painel." }
      ]
    }, categories);

    assert.deepEqual(new Set(result.map((item) => item.categoryId)), new Set(["novidades", "correcoes", "melhorias"]));
  });

  it("prioriza regras personalizadas sobre palavras genéricas", () => {
    const rules: Array<Pick<UpdateRule, "categoryId" | "terms" | "priority" | "enabled">> = [
      { categoryId: "novidades", terms: ["novo inventário"], priority: 200, enabled: true }
    ];
    const result = classifyUpdateContent({
      title: "Novo inventário",
      description: "Melhorado fluxo do inventário.",
      changes: []
    }, categories, rules);

    assert.equal(result[0]?.categoryId, "novidades");
  });
});
