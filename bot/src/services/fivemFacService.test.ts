import assert from "node:assert/strict";
import test from "node:test";
import { applyDashboardPanelVisual, buildPanelPayload } from "./fivemFacService";
import type { FivemFacSettings } from "./apiClient";

test("painel de ausencias usa endpoint de midia com extensao para banner persistente", () => {
  const settings = facSettings({
    imageExtension: "png",
    imageMimeType: "image/png",
    imageUrl: "https://example.com/api/persistent-images/123e4567-e89b-12d3-a456-426614174000"
  });

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

test("painel de ausencias usa banner configurado no painel geral do dashboard", () => {
  const settings = facSettings({ imageUrl: null, imageExtension: null, imageMimeType: null });
  const effective = applyDashboardPanelVisual(settings, {
    imageEnabled: true,
    imageExtension: "webp",
    imageMimeType: "image/webp",
    imagePosition: "banner",
    imageUrl: "https://example.com/api/persistent-images/123e4567-e89b-12d3-a456-426614174111",
    useGlobalDefault: false
  });

  const serialized = JSON.stringify(buildPanelPayload(effective));

  assert.match(
    serialized,
    /https:\/\/example\.com\/api\/persistent-images\/123e4567-e89b-12d3-a456-426614174111\/media\.webp/
  );
});

function facSettings(panelVisual: Partial<FivemFacSettings["panelVisual"]>) {
  return {
    messages: {
      panelTitle: "Sistema de Ausencias",
      panelDescription: "Informe nome RP, data de inicio, data de retorno e motivo da sua ausencia."
    },
    panelVisual: {
      panelColor: "#2b2d31",
      imageUrl: null,
      imageExtension: null,
      imageMimeType: null,
      imagePosition: "top",
      buttonsPosition: "outside_panel",
      buttons: [],
      componentsOrder: ["image", "text", "buttons"],
      enabledSections: {
        image: true,
        buttons: false,
        description: true
      },
      ...panelVisual
    }
  } as unknown as FivemFacSettings;
}
