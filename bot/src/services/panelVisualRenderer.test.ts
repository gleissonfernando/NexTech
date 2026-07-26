import assert from "node:assert/strict";
import test from "node:test";
import { createV2Footer } from "./panelVisualRenderer";

test("footer v2 com imagem nao cria thumbnail separada", () => {
  const footer = createV2Footer({
    image: "https://example.com/footer.png",
    text: "NexTech"
  });

  assert.deepEqual(footer, { type: 10, content: "-# NexTech" });
});
