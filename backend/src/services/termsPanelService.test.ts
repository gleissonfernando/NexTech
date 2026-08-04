import assert from "node:assert/strict";
import test from "node:test";
import { buildTermsPanelPayload } from "./termsPanelService";

test("painel de termos usa texto estruturado e banner solto no final", () => {
  const payload = buildTermsPanelPayload({
    botId: "bot-1",
    guildId: "guild-1",
    termsPanelButtonLabel: "Ler termos",
    termsPanelButtonUrl: null,
    termsPanelChannelId: "12345",
    termsPanelColor: "#FFD500",
    termsPanelDescription: null,
    termsPanelEnabled: true,
    termsPanelFooterText: null,
    termsPanelImageFormat: "horizontal",
    termsPanelImageUrl: null,
    termsPanelMessageId: null,
    termsPanelSubtitle: null,
    termsPanelTitle: "Termos de Serviço da NexTech"
  } as any);

  const container = (payload.components as any[])[0];
  const components = container.components as any[];
  const textComponents = components.filter((component) => component.type === 10);
  const text = textComponents.map((component) => component.content).join("\n");

  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0xffd500);
  assert.equal(components.some((component) => component.type === 1), false);
  assert.equal(textComponents.length >= 4, true);
  assert.equal(components.at(-1).type, 12);
  assert.match(components.at(-1).items[0].media.url, /\/terms-banner\.png\?v=20260804-terms-panel$/);
  assert.match(text, /# Termos & Serviço/);
  assert.match(text, /Contratação, pagamento e reembolso/);
  assert.match(text, /Aceitação dos Termos & Serviço/);
  assert.match(text, /Pagamento e Orçamento/);
  assert.match(text, /Política de Reembolso/);
  assert.match(text, /revenda a terceiros não é permitida/);
});
