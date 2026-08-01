import assert from "node:assert/strict";
import test from "node:test";
import { isManualRegistrationRemovableStatus } from "./manualRegistrationService";

test("exclusão do Pedido de Set aceita cadastro pendente e aprovado", () => {
  assert.equal(isManualRegistrationRemovableStatus("pending"), true);
  assert.equal(isManualRegistrationRemovableStatus("approved"), true);
});

test("exclusão do Pedido de Set bloqueia cadastros já finalizados", () => {
  assert.equal(isManualRegistrationRemovableStatus("rejected"), false);
  assert.equal(isManualRegistrationRemovableStatus("removed"), false);
});
