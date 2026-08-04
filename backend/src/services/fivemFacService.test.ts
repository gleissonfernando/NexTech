import assert from "node:assert/strict";
import test from "node:test";
import {
  fivemFacAbsenceDurationMsForTest,
  isFivemFacAbsenceShorterThan24Hours,
  shouldAutoApproveFivemFacAbsence
} from "./fivemFacService";

const autoApproveSettings = {
  autoApproveEnabled: true,
  autoApproveMaxDays: 2,
  autoApproveRoleIds: ["role-auto"]
};

test("ausencia de 1 minuto exige aprovacao manual", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04T10:00:00.000Z", "2026-08-04T10:01:00.000Z"), true);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04T10:00:00.000Z", "2026-08-04T10:01:00.000Z", ["role-auto"]), false);
});

test("ausencia no mesmo dia enviada pela interface fica pendente", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04", "2026-08-04"), true);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04", "2026-08-04", ["role-auto"]), false);
});

test("ausencia de 1 hora exige aprovacao manual", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04T10:00:00.000Z", "2026-08-04T11:00:00.000Z"), true);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04T10:00:00.000Z", "2026-08-04T11:00:00.000Z", ["role-auto"]), false);
});

test("ausencia de 12 horas exige aprovacao manual", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04T10:00:00.000Z", "2026-08-04T22:00:00.000Z"), true);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04T10:00:00.000Z", "2026-08-04T22:00:00.000Z", ["role-auto"]), false);
});

test("ausencia de 23 horas e 59 minutos exige aprovacao manual", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04T10:00:00.000Z", "2026-08-05T09:59:00.000Z"), true);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04T10:00:00.000Z", "2026-08-05T09:59:00.000Z", ["role-auto"]), false);
});

test("ausencia de exatamente 24 horas segue a regra existente de autoaprovacao", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04T10:00:00.000Z", "2026-08-05T10:00:00.000Z"), false);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04T10:00:00.000Z", "2026-08-05T10:00:00.000Z", ["role-auto"]), true);
});

test("ausencia de 24 horas e 1 minuto segue o fluxo normal existente", () => {
  assert.equal(isFivemFacAbsenceShorterThan24Hours("2026-08-04T10:00:00.000Z", "2026-08-05T10:01:00.000Z"), false);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "2026-08-04T10:00:00.000Z", "2026-08-05T10:01:00.000Z", ["role-auto"]), true);
});

test("ausencia com data ou horario invalido nao autoaprova", () => {
  assert.equal(fivemFacAbsenceDurationMsForTest("data-invalida", "2026-08-05T10:01:00.000Z"), null);
  assert.equal(fivemFacAbsenceDurationMsForTest("2026-08-05T10:01:00.000Z", "data-invalida"), null);
  assert.equal(fivemFacAbsenceDurationMsForTest("2026-02-31", "2026-03-01"), null);
  assert.equal(shouldAutoApproveFivemFacAbsence(autoApproveSettings, "data-invalida", "2026-08-05T10:01:00.000Z", ["role-auto"]), false);
});
