import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildRulesPanelPayload, RULES_ACCEPT_BUTTON_ID } from "./rulesPanelService";
import { defaultSettings } from "./settingsService";

test("monta painel de regras em Components V2 com categorias e botão", () => {
  const settings = {
    ...defaultSettings("123", "456"),
    rulesButtons: [
      {
        action: "accept" as const,
        command: null,
        emoji: "📖",
        enabled: true,
        id: "read-rules",
        label: "Ler Regras",
        message: null,
        order: 1,
        style: "primary" as const,
        url: null
      }
    ],
    rulesCategories: [
      {
        description: "Trate todos com respeito.",
        emoji: "💜",
        enabled: true,
        id: "convivencia",
        name: "Convivência",
        order: 1,
        rules: ["Seja respeitoso.", "Não pratique discurso de ódio."]
      }
    ],
    rulesColor: "#9333ea",
    rulesFooterText: "NexTech © Todos os direitos reservados",
    rulesImageFormat: "none" as const,
    rulesSubtitle: "Regras Oficiais do Servidor",
    rulesTitle: "Regras e Diretrizes da Loja"
  };

  const payload = buildRulesPanelPayload(settings);
  const container = payload.components[0] as { accent_color: number; components: Array<{ components?: Array<{ custom_id?: string }>; content?: string; type: number }>; type: number };
  const text = container.components.find((component) => component.type === 10)?.content ?? "";
  const row = container.components.find((component) => component.type === 1);

  assert.equal(payload.flags, 32768);
  assert.deepEqual(payload.embeds, []);
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0x9333ea);
  assert.match(text, /Regras e Diretrizes da Loja/);
  assert.match(text, /1\. Convivência/);
  assert.match(text, /Seja respeitoso/);
  assert.equal(row?.components?.[0]?.custom_id, RULES_ACCEPT_BUTTON_ID);
});
