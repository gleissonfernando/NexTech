import assert from "node:assert/strict";
import test from "node:test";
import { defaultManualRegistrationSettings, isManualRegistrationRemovableStatus } from "./manualRegistrationService";

test("exclusão do Pedido de Set aceita cadastro pendente e aprovado", () => {
  assert.equal(isManualRegistrationRemovableStatus("pending"), true);
  assert.equal(isManualRegistrationRemovableStatus("approved"), true);
});

test("exclusão do Pedido de Set bloqueia cadastros já finalizados", () => {
  assert.equal(isManualRegistrationRemovableStatus("rejected"), false);
  assert.equal(isManualRegistrationRemovableStatus("removed"), false);
});

test("Pedido de Set padrao usa somente os tres campos configurados", () => {
  const settings = defaultManualRegistrationSettings("123456789012345678", "987654321098765432");

  assert.deepEqual(settings.fields.map((field) => field.id), ["nome_personagem", "id_fivem", "telefone"]);
  assert.equal(settings.fields.every((field) => field.enabled), true);
});
