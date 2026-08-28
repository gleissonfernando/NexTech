import assert from "node:assert/strict";
import test from "node:test";
import { createTicketClaimedPayload, isTicketScopeCompatible, normalizeTicketDescription, normalizeTicketSubject, resolveTicketCategoryId, shouldDeleteSupportTicketChannelAfterClose } from "./ticketPanelService";

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
