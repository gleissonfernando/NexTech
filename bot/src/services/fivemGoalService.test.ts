import assert from "node:assert/strict";
import test from "node:test";
import { createFarmRoomPanelPayload, createGoalRegistrationModal, createGoalRequestPanelPayload, createImageReviewPayload, renderApprovedSetChannelName } from "./fivemGoalService";

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

  assert.match(serialized, /CRIAR SALA DE FARM/);
  assert.match(serialized, /Solicitar Sala de Farm/);
  assert.match(serialized, /fivem_goal:request_channel:1533162050417721486:bot-dev-1/);
  assert.doesNotMatch(serialized, /fivem_goal:help:1533162050417721486:bot-dev-1/);
});

test("painel de registro de farm preserva a mensagem original no custom id", () => {
  const payload = createImageReviewPayload(
    "111111111111111111",
    "222222222222222222",
    "333333333333333333",
    "attachment-1",
    "https://cdn.discordapp.com/image.png",
    { items: [] } as any
  );
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /Registro de Farm/);
  assert.match(serialized, /Registrar Farm/);
  assert.match(serialized, /fivem_goal:register:333333333333333333/);
  assert.doesNotMatch(serialized, /fivem_goal:confirm:/);
});

test("modal de registro de farm inclui select de item e campo de quantidade", () => {
  const modal = createGoalRegistrationModal("fivem_goal:modal:source:select:user:none", [
    { enabled: true, id: "dirty-money", name: "Dinheiro Sujo", emoji: null, category: "Registrar dinheiro" },
    { enabled: true, id: "ammo", name: "Munição", emoji: null, category: null }
  ]);
  const serialized = JSON.stringify(modal.toJSON());

  assert.match(serialized, /meta_item_select/);
  assert.match(serialized, /Selecione o item que deseja registrar/);
  assert.match(serialized, /dirty-money/);
  assert.match(serialized, /ammo/);
  assert.match(serialized, /meta_quantidade/);
  assert.doesNotMatch(serialized, /fivem_goal:item:/);
});
