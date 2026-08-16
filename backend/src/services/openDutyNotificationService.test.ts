import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenDutyMessageText } from "./openDutyNotificationService";

test("normaliza erros ortograficos persistidos na mensagem de ponto aberto", () => {
  assert.equal(
    normalizeOpenDutyMessageText("Prezada(o) {usuário},\n\nSe você esqueceu o ponto aberto, por favor, justifique justiqu"),
    "Prezado(a) {usuário},\n\nSe você esqueceu o ponto aberto, por favor, justifique"
  );
});
