import assert from "node:assert/strict";
import test from "node:test";
import { resolveVisibleMessageContent } from "./visibleMessageService";

test("Mensagem Visivel ativa processa texto normal do usuario", () => {
  assert.equal(resolveVisibleMessageContent("mensagem normal", true), "mensagem normal");
});

test("Mensagem Visivel preserva prefixos legados", () => {
  assert.equal(resolveVisibleMessageContent(".mv mensagem normal", true), "mensagem normal");
  assert.equal(resolveVisibleMessageContent("visível: mensagem normal", true), "mensagem normal");
});

test("Mensagem Visivel inativa ignora conversa normal", () => {
  assert.equal(resolveVisibleMessageContent("mensagem normal", false), null);
});
