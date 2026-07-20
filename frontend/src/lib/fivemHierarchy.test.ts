import assert from "node:assert/strict";
import test from "node:test";
import type { FivemHierarchyPanel } from "../types";
import {
  buildEditableFivemHierarchyPanelPayload,
  hierarchyPanelClientRequestId,
  hierarchyPanelDraftId,
  isLocalHierarchyPanelId
} from "./fivemHierarchy";

const clientRequestId = "9e77d2be-6200-4f69-8a55-a9204dcfb682";

function examplePanel(): FivemHierarchyPanel {
  return {
    allowedRoleIds: ["12345"],
    botId: "bot-id",
    color: "#22c55e",
    configRevision: 1,
    contentHash: "a".repeat(64),
    createdAt: "2026-07-10T00:00:00.000Z",
    createdBy: "22222",
    description: "Painel oficial",
    enabled: true,
    footerEnabled: true,
    footerIconUrl: null,
    footerText: "NexTech",
    guildId: "67890",
    hierarchies: [{
      active: true,
      color: null,
      description: null,
      emoji: "👤",
      id: "chief",
      limit: null,
      name: "Chief",
      order: 1,
      roleId: "54321"
    }],
    id: hierarchyPanelDraftId(clientRequestId),
    imagePosition: "none",
    imageUrl: null,
    linkedToFivem: true,
    logChannelId: null,
    managerUserIds: [],
    managerRoleIds: [],
    commandUserIds: [],
    commandRoleIds: [],
    name: "Comando",
    panelChannelId: "98765",
    panelMessageId: "11111",
    panelVersion: 2,
    publishedAt: "2026-07-10T00:00:00.000Z",
    status: "published",
    title: "Hierarquia",
    updatedAt: "2026-07-10T00:00:00.000Z",
    updatedBy: "22222"
  };
}

test("novo painel preserva uma chave idempotente entre tentativas", () => {
  const draftId = hierarchyPanelDraftId(clientRequestId);
  assert.equal(isLocalHierarchyPanelId(draftId), true);
  assert.equal(hierarchyPanelClientRequestId(draftId), clientRequestId);
  assert.equal(isLocalHierarchyPanelId("panel-persisted"), false);
});

test("payload editavel nunca envia estado oficial controlado pelo bot", () => {
  const payload = buildEditableFivemHierarchyPanelPayload(examplePanel());
  const keys = Object.keys(payload);

  for (const forbidden of [
    "botId",
    "contentHash",
    "createdAt",
    "guildId",
    "id",
    "panelMessageId",
    "panelVersion",
    "updatedAt",
    "updatedBy"
  ]) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} não deve ser enviado pela dashboard`);
  }

  assert.equal(payload.panelChannelId, "98765");
  assert.equal(payload.hierarchies[0]?.roleId, "54321");
});

test("chave de criacao inválida e rejeitada", () => {
  assert.throws(() => hierarchyPanelDraftId("new"), /inv[aá]lido/i);
});
