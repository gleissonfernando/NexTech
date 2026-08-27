import assert from "node:assert/strict";
import test from "node:test";
import { isTicketScopeCompatible, normalizeTicketDescription, normalizeTicketSubject } from "./ticketPanelService";

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
