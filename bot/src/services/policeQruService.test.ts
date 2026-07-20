import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvidenceUrls, policeQruEvidenceFiles } from "./policeQruService";

test("comprovantes de QRU aceitam links de imagem, PDF e outros arquivos", () => {
  const value = [
    "https://cdn.discordapp.com/attachments/1/2/image.png",
    "https://example.com/BO-14587.pdf",
    "https://example.com/evidencia"
  ].join("\n");

  assert.deepEqual(policeQruEvidenceFiles(value), [
    { kind: "image", name: "image.png", url: "https://cdn.discordapp.com/attachments/1/2/image.png" },
    { kind: "pdf", name: "BO-14587.pdf", url: "https://example.com/BO-14587.pdf" },
    { kind: "file", name: "evidencia", url: "https://example.com/evidencia" }
  ]);
});

test("normalizacao de comprovantes remove duplicados e limita a dez links", () => {
  const links = Array.from({ length: 12 }, (_, index) => `https://example.com/${index}.png`);
  const normalized = normalizeEvidenceUrls([
    links[0]!,
    `${links[0]!}.`,
    ...links
  ]);

  assert.equal(normalized.length, 10);
  assert.equal(normalized[0], links[0]);
  assert.equal(new Set(normalized).size, normalized.length);
});
