import assert from "node:assert/strict";
import test from "node:test";
import { isReportSystemTicket, isUsableReportSystemTicket } from "./reportSystemService";

test("recuperação do report system não aceita ticket normal", () => {
  assert.equal(isReportSystemTicket({
    subject: "ABA DE FARM",
    ticketType: "aba-de-farm"
  }), false);
});

test("recuperação do report system aceita tickets marcados pelo módulo", () => {
  assert.equal(isReportSystemTicket({
    subject: "Atendimento interno",
    ticketType: "report-system"
  }), true);
});

test("recuperação do report system preserva denúncias legadas", () => {
  assert.equal(isReportSystemTicket({
    subject: "Denúncia identificada - Corregedoria",
    ticketType: "corregedoria"
  }), true);
  assert.equal(isReportSystemTicket({
    subject: "Denúncia anônima - IAB",
    ticketType: null
  }), true);
});

test("tópico contaminado de corregedoria não ativa sistema oculto em ticket normal", () => {
  assert.equal(isUsableReportSystemTicket({
    status: "OPEN",
    subject: "ABA DE FARM",
    ticketType: "aba-de-farm"
  }), false);
});

test("tópico de corregedoria só é usado em ticket aberto do report system", () => {
  assert.equal(isUsableReportSystemTicket({
    status: "OPEN",
    subject: "Atendimento interno",
    ticketType: "report-system"
  }), true);

  assert.equal(isUsableReportSystemTicket({
    status: "CLOSED",
    subject: "Denúncia identificada - IAB",
    ticketType: "report-system"
  }), false);
});
