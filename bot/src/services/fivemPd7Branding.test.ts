import assert from "node:assert/strict";
import test from "node:test";
import { createPedirSetChannelName, PEDIR_SET_NAME, PEDIR_SET_REQUEST_LABEL } from "./fivemPd7Branding";

test("usa a identidade Pedir Set na interface", () => {
  assert.equal(PEDIR_SET_NAME, "Pedir Set");
  assert.equal(PEDIR_SET_REQUEST_LABEL, "Solicitar Set");
  assert.doesNotMatch(`${PEDIR_SET_NAME} ${PEDIR_SET_REQUEST_LABEL}`, /peedir set/i);
});

test("cria canais temporários com o prefixo set", () => {
  assert.equal(createPedirSetChannelName("João Silva"), "set-jo-o-silva");
  assert.equal(createPedirSetChannelName("USUARIO_123"), "set-usuario-123");
});
