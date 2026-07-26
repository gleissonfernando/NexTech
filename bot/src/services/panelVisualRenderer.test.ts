import assert from "node:assert/strict";
import test from "node:test";
import { createV2Footer } from "./panelVisualRenderer";

test("footer v2 com imagem mantem imagem no mesmo componente de rodape", () => {
  const footer = createV2Footer({
    image: "https://example.com/footer.png",
    text: "NexTech"
  });

  assert.deepEqual(footer, {
    type: 9,
    components: [{ type: 10, content: "-# NexTech" }],
    accessory: {
      type: 11,
      media: { url: "https://example.com/footer.png" },
      description: "Imagem de rodapé"
    }
  });
});
