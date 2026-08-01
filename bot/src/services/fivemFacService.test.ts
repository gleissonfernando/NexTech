import assert from "node:assert/strict";
import test from "node:test";
import { buildPanelPayload } from "./fivemFacService";
import type { FivemFacSettings } from "./apiClient";

test("painel de ausencias usa endpoint de midia com extensao para banner persistente", () => {
  const settings = {
    messages: {
      panelTitle: "Sistema de Ausencias",
      panelDescription: "Informe nome RP, data de inicio, data de retorno e motivo da sua ausencia."
    },
    panelVisual: {
      panelColor: "#2b2d31",
      imageUrl: "https://example.com/api/persistent-images/123e4567-e89b-12d3-a456-426614174000",
      imageExtension: "png",
      imageMimeType: "image/png",
      imagePosition: "top",
      buttonsPosition: "outside_panel",
      buttons: [],
      componentsOrder: ["image", "text", "buttons"],
      enabledSections: {
        image: true,
        buttons: false,
        description: true
      }
    }
  } as unknown as FivemFacSettings;

  const serialized = JSON.stringify(buildPanelPayload(settings));

  assert.match(
    serialized,
    /https:\/\/example\.com\/api\/persistent-images\/123e4567-e89b-12d3-a456-426614174000\/media\.png/
  );
  assert.doesNotMatch(
    serialized,
    /"url":"https:\/\/example\.com\/api\/persistent-images\/123e4567-e89b-12d3-a456-426614174000"/
  );
});
