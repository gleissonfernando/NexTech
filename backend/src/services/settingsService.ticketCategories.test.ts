import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings, normalizeTicketPanelOptions } from "./settingsService";

describe("ticket category settings", () => {
  it("uses a single required support category as the empty fallback", () => {
    const options = normalizeTicketPanelOptions([]);

    assert.equal(options.length, 1);
    assert.equal(options[0]?.label, "Suporte");
    assert.equal(options[0]?.description, "Atendimento geral");
    assert.equal(options[0]?.enabled, true);
  });

  it("keeps dashboard configured categories as the source of truth", () => {
    const options = normalizeTicketPanelOptions([
      { enabled: true, label: "Parcerias", position: 2, value: "parcerias" },
      { enabled: true, label: "Denuncias", position: 1, value: "denuncias" }
    ]);

    assert.deepEqual(options.map((option) => option.value), ["denuncias", "parcerias"]);
  });

  it("guarantees at least one available category when all saved categories are disabled", () => {
    const options = normalizeTicketPanelOptions([
      { enabled: false, label: "Arquivada", position: 1, value: "arquivada" }
    ]);

    assert.ok(options.some((option) => option.enabled));
    assert.ok(options.some((option) => option.value === "suporte" && option.enabled));
  });

  it("default settings do not include legacy ticket categories", () => {
    const values = defaultSettings("guild", "bot").ticketPanelOptions.map((option) => option.value);

    assert.deepEqual(values, ["suporte"]);
  });
});
