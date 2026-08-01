import assert from "node:assert/strict";
import test from "node:test";
import { createFarmRoomPanelPayload } from "./fivemGoalService";

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
