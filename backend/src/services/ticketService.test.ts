import assert from "node:assert/strict";
import test from "node:test";
import { isActiveTicketStatus, ticketActiveKey } from "./ticketService";

test("chave ativa separa bot, servidor, usuário e modalidade sem converter snowflakes", () => {
  assert.equal(
    ticketActiveKey("123456789012345678", "987654321098765432", "456789012345678901", "suporte"),
    "987654321098765432:123456789012345678:default:456789012345678901:suporte"
  );
  assert.notEqual(ticketActiveKey("1", "2", "3", "a"), ticketActiveKey("1", "2", "3", "b"));
  assert.notEqual(ticketActiveKey("1", "2", "3", "a", "default"), ticketActiveKey("1", "2", "3", "a", "police"));
});

test("somente estados realmente ativos mantêm a reserva distribuída", () => {
  for (const status of ["OPEN", "PENDING", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER"] as const) assert.equal(isActiveTicketStatus(status), true);
  for (const status of ["CLOSED", "RESOLVED", "DENIED", "ARCHIVED", "INCOMPLETE"] as const) assert.equal(isActiveTicketStatus(status), false);
});
