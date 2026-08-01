import assert from "node:assert/strict";
import test from "node:test";
import { createFinancePanelActionRow } from "./fivemFinanceService";

test("painel financeiro principal mostra somente entrada e saída", () => {
  const row = createFinancePanelActionRow().toJSON();
  const buttons = row.components.map((component) => {
    assert.ok("custom_id" in component);
    assert.ok("label" in component);
    return component;
  });
  const customIds = buttons.map((component) => component.custom_id);
  const labels = buttons.map((component) => component.label);

  assert.deepEqual(customIds, ["fivem_finance:add", "fivem_finance:remove"]);
  assert.deepEqual(labels, ["Adicionar dinheiro", "Remover dinheiro"]);
  assert.equal(customIds.includes("fivem_finance:withdraw"), false);
  assert.equal(customIds.includes("fivem_finance:history"), false);
  assert.equal(customIds.includes("fivem_finance:refresh"), false);
});
