import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTicketDescription, normalizeTicketSubject } from "./ticketPanelService";

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
