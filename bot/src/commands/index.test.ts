import assert from "node:assert/strict";
import test from "node:test";
import { createCommandCollection } from ".";

test("registra comandos da Mensagem Visivel", () => {
  const commands = createCommandCollection();
  const activate = commands.get("mensagem-ativar");
  const deactivate = commands.get("mensagem-desativar");
  const message = commands.get("mensagem");

  assert.ok(activate);
  assert.ok(deactivate);
  assert.ok(message);
  assert.equal(activate.data.toJSON().default_member_permissions, undefined);
  assert.equal(deactivate.data.toJSON().default_member_permissions, undefined);
  assert.equal(message.moduleId, undefined);
});

test("registra comandos de QRU na coleção local", () => {
  const commands = createCommandCollection();

  assert.ok(commands.get("qru"));
  assert.ok(commands.get("rank"));
  assert.ok(commands.get("ranking"));
});
