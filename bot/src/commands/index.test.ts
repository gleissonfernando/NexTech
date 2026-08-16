import assert from "node:assert/strict";
import test from "node:test";
import { createCommandCollection } from ".";

test("registra comandos da Mensagem Visivel", () => {
  const commands = createCommandCollection();
  const activate = commands.get("mensagem-ativar");
  const deactivate = commands.get("mensagem-desativar");

  assert.ok(activate);
  assert.ok(deactivate);
  assert.equal(activate.data.toJSON().default_member_permissions, undefined);
  assert.equal(deactivate.data.toJSON().default_member_permissions, undefined);
});
