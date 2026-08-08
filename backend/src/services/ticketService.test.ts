import assert from "node:assert/strict";
import test from "node:test";
import { ticketActiveKey, ticketRecoveryActiveKey } from "./ticketService";

test("chave de recuperação de ticket preserva o ticketId e não colide com ticket aberto da mesma categoria", () => {
  const base = ticketActiveKey("guild-1", "bot-1", "user-1", "suporte", "default");
  const recovered = ticketRecoveryActiveKey("guild-1", "bot-1", "user-1", "suporte", "720e77d7-eb06-4368-bff7-7aa421c72cd5", "default");

  assert.notEqual(recovered, base);
  assert.equal(recovered, `${base}:720e77d7-eb06-4368-bff7-7aa421c72cd5`);
});
