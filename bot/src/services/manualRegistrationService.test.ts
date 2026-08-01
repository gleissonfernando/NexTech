import assert from "node:assert/strict";
import test from "node:test";
import { createManualRegistrationDecisionLogPayload } from "./manualRegistrationService";
import type { ManualRegistrationSettings, ManualRegistrationSubmission } from "./apiClient";

const settings = {
  color: "#7c3aed",
  logMentionRoleId: "333333333333333333",
  panelImage: null,
  setRoles: []
} as unknown as ManualRegistrationSettings;

const submission = {
  createdAt: "2026-07-30T17:50:51.000Z",
  fields: [
    { id: "nome_personagem", label: "Nome do personagem", value: "Tairan cooper" },
    { id: "id_fivem", label: "ID in-game", value: "15774" },
    { id: "telefone", label: "Telefone in-game", value: "441247" },
    { id: "recrutador", label: "Recrutador", value: "melo gst" }
  ],
  id: "sub-1",
  requestedName: "Tairan cooper",
  requestedRoleId: "222222222222222222",
  status: "approved",
  userId: "111111111111111111",
  username: "ytairanw7"
} as ManualRegistrationSubmission;

test("log de aprovação do Pedido de Set usa o formato de Registro aprovado", () => {
  const payload = createManualRegistrationDecisionLogPayload(settings, submission, {
    actorId: "444444444444444444",
    actorLabel: "Arsenal | 10354 (arsenal7_)",
    decidedAt: new Date("2026-07-30T19:12:19.000Z"),
    status: "approved"
  });

  assert.equal(payload.content, "<@&333333333333333333>");
  assert.deepEqual(payload.allowedMentions.roles, ["333333333333333333"]);
  const container = payload.components[0] as { components: Array<{ content?: string; components?: Array<{ content?: string }> }> };
  const firstBlock = container.components[0];
  assert.ok(firstBlock);
  const content = firstBlock.content ?? firstBlock.components?.[0]?.content ?? "";
  assert.match(content, /Registro - Aprovado/);
  assert.match(content, /Usuario:\*\* <@111111111111111111> \| 15774 \(ytairanw7\)/);
  assert.match(content, /Personagem: Tairan cooper/);
  assert.match(content, /Recrutador: melo gst/);
  assert.doesNotMatch(content, /Log de Pedido de Set/);
});
