import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type Message } from "discord.js";
import { detectMessageContents } from "./safeBotService";

function message(content: string, attachments: Array<{ contentType: string; name: string; url: string }> = [], stickers = 0) {
  return {
    attachments: new Collection(attachments.map((attachment, index) => [String(index), attachment])),
    content,
    stickers: new Collection(Array.from({ length: stickers }, (_, index) => [String(index), { id: String(index) }]))
  } as unknown as Message;
}

test("link e arquivo na mesma mensagem são avaliados por módulos independentes", () => {
  const detected = detectMessageContents(message("https://exemplo.com", [{
    contentType: "application/zip",
    name: "arquivo.zip",
    url: "https://cdn.discordapp.com/attachments/1/2/arquivo.zip"
  }]));
  assert.deepEqual(detected.map((item) => item.moduleId), ["anti-links", "anti-anexos"]);
});

test("link interno do Discord não vira link externo e sticker tem módulo próprio", () => {
  assert.deepEqual(detectMessageContents(message("https://discord.com/channels/1/2/3")).map((item) => item.moduleId), []);
  assert.deepEqual(detectMessageContents(message("", [], 1)).map((item) => item.moduleId), ["anti-stickers"]);
});
