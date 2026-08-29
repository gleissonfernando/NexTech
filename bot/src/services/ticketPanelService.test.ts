import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import {
  createTicketClaimedPayload,
  isTicketScopeCompatible,
  normalizeTicketDescription,
  normalizeTicketSubject,
  resolveTicketCategoryId,
  shouldDeleteSupportTicketChannelAfterClose,
  buildTranscriptDmPayload
} from "./ticketPanelService";

test("ticket aceita texto curto e rejeita vazio", () => {
  assert.equal(normalizeTicketDescription("Ajuda"), "Ajuda");
  assert.equal(normalizeTicketDescription("Pagamento atrasado"), "Pagamento atrasado");
  assert.equal(normalizeTicketDescription("   "), null);
});

test("renomeação também aceita assunto curto e rejeita vazio", () => {
  assert.equal(normalizeTicketSubject("Ajuda"), "Ajuda");
  assert.equal(normalizeTicketSubject("Suporte técnico"), "Suporte técnico");
  assert.equal(normalizeTicketSubject("\n\t "), null);
});

test("ticket aceita botId diferente quando a interação vem do mesmo canal", () => {
  assert.equal(
    isTicketScopeCompatible(
      { botId: "222222222222222222", channelId: "333333333333333333", guildId: "111111111111111111" },
      "111111111111111111",
      "444444444444444444",
      "333333333333333333"
    ),
    true
  );
  assert.equal(
    isTicketScopeCompatible(
      { botId: "222222222222222222", channelId: "333333333333333333", guildId: "111111111111111111" },
      "111111111111111111",
      "444444444444444444",
      "555555555555555555"
    ),
    false
  );
});

test("ticket de suporte apaga o canal ao encerrar", () => {
  assert.equal(shouldDeleteSupportTicketChannelAfterClose(), true);
});

test("payload de ticket assumido aponta para o canal correto", () => {
  const payload = createTicketClaimedPayload({
    channelId: "987654321098765432",
    guild: { id: "123456789012345678", name: "NexTech" } as never,
    openerId: "111111111111111111",
    staffId: "222222222222222222"
  });

  const serialized = JSON.stringify(payload);
  assert.ok(serialized.includes("discord.com/channels/123456789012345678/987654321098765432"));
  assert.ok(serialized.includes("Seu ticket foi assumido"));
});

test("categoria de ticket usa fallback quando a principal não existe", async () => {
  const guild = {
    id: "123456789012345678",
    channels: {
      fetch: async (channelId: string) => (channelId === "fallback-category"
        ? { type: 4 }
        : null)
    }
  } as never;

  await assert.doesNotReject(async () => {
    const resolved = await resolveTicketCategoryId(guild, "missing-category", "fallback-category");
    assert.equal(resolved, "fallback-category");
  });
});

test("buildTranscriptDmPayload gera painel Components V2 com transcript e senha", () => {
  const payload = buildTranscriptDmPayload({
    expiresLine: "29/08/2026",
    guildName: "Core Network LTDA",
    password: "abc123",
    transcriptUrl: "https://example.com/transcript",
    username: "vilafps7"
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.ok(Array.isArray(payload.components));
  const text = collectText(payload).join("\n");
  assert.match(text, /## Ticket finalizado/);
  assert.match(text, /Olá vilafps7, seu ticket foi finalizado no servidor Core Network LTDA\./);
  assert.match(text, /\*\*Considerações finais:\*\*/);
  assert.match(text, /Atendimento concluído!/);
  assert.match(text, /\*\*Histórico da conversa:\*\*/);
  assert.match(text, /\*\*Transcript:\*\* https:\/\/example\.com\/transcript/);
  assert.match(text, /\*\*Senha:\*\* \|\|abc123\|\|/);
  assert.match(text, /\*\*Validade:\*\* 29\/08\/2026/);
  assert.match(text, /Acessar transcript/);
});

function collectText(value: unknown): string[] {
  const collected: string[] = [];

  visit(value);

  return collected;

  function visit(current: unknown) {
    if (typeof current === "string") {
      collected.push(current);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") {
      return;
    }

    for (const next of Object.values(current as Record<string, unknown>)) {
      visit(next);
    }
  }
}
