import assert from "node:assert/strict";
import test from "node:test";
import { createFarmRoomPanelPayload, createGoalRequestPanelPayload, renderApprovedSetChannelName } from "./fivemGoalService";

test("painel inicial da sala de farm usa somente o modelo de fechamento", () => {
  const payload = createFarmRoomPanelPayload(null, { managerRoleId: "123456789012345678" }, "987654321098765432");
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /SALA DE FARM/);
  assert.match(serialized, /Sala criada para organizar o registro do farm/);
  assert.match(serialized, /Fechar sala/);
  assert.match(serialized, /Fechar Canal/);
  assert.match(serialized, /fivem_goal:room:close:987654321098765432/);
  assert.match(serialized, /<@&123456789012345678>/);
  assert.doesNotMatch(serialized, /Adicionar Meta|Histórico|Ranking|Atualizar|Solicitar Revisao/);
});

test("canal de meta aprovado pelo set usa prefixo com nome e id in-game", () => {
  assert.equal(renderApprovedSetChannelName("Tairan cooper", "15774"), "📕┋tairan-cooper-|-15774");
});

test("painel de solicitar sala de meta usa custom ids com escopo do servidor e bot", () => {
  const payload = createGoalRequestPanelPayload("Sistema de Metas FiveM", "Solicite seu canal.", "1533162050417721486", "bot-dev-1");
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /fivem_goal:request_channel:1533162050417721486:bot-dev-1/);
  assert.match(serialized, /fivem_goal:help:1533162050417721486:bot-dev-1/);
});
