import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenDutyMessageText } from "./notificar";

test("normaliza erros ortograficos da mensagem de ponto aberto", () => {
  assert.equal(
    normalizeOpenDutyMessageText("Prezada(o) <@123>,\n\nSe você esqueceu o ponto aberto, por favor, justifique justiqu"),
    "Prezado(a) <@123>,\n\nSe você esqueceu o ponto aberto, por favor, justifique"
  );
});

test("mantem canal de justificativa separado por pontuacao", () => {
  assert.equal(
    normalizeOpenDutyMessageText("Se você esqueceu o ponto aberto, por favor, justifique\n\nCanal de justificativa: <#456>"),
    "Se você esqueceu o ponto aberto, por favor, justifique.\n\nCanal de justificativa: <#456>"
  );
});
