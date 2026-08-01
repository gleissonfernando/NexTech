import assert from "node:assert/strict";
import test from "node:test";
import { isReportSystemTicket } from "./reportSystemService";

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
