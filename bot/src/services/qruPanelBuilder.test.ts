import assert from "node:assert/strict";
import test from "node:test";
import type { PoliceQruRecord } from "./apiClient";
import {
  buildQruPanelSections,
  buildQruRegistrationPanel,
  discordRelativeTimestamp,
  escapeQruText,
  extractOfficerBadge,
  formatOfficerLine,
  formatQruDateTime,
  parseAccentColor,
  resolveQruGalleryItems
} from "./qruPanelBuilder";

function record(input: Partial<PoliceQruRecord> = {}): PoliceQruRecord {
  return {
    approvalChannelId: null,
    approvalMessageId: null,
    approvedAt: "2026-08-27T23:14:00.000Z",
    approvedById: "222",
    approvedByName: "Ofc. Aiden Kryrazev | 2354",
    authorId: "111",
    authorName: "SO.Bento Borsoli | 1409",
    boNumber: "BO-1234",
    botId: "bot-1",
    createdAt: "2026-08-27T23:14:00.000Z",
    evidenceUrl: "",
    guildId: "guild-1",
    id: "qru-1",
    notes: null,
    occurrenceDate: "27/08/2026",
    officers: [{ id: "333", mention: "<@333>", name: "SO. Deckard S'Mall | 5293" }],
    qruType: "QRU convencional",
    recordChannelId: null,
    recordMessageId: null,
    rejectionCount: 0,
    rejections: [],
    seizures: null,
    status: "approved",
    temporaryChannelId: null,
    updatedAt: "2026-08-27T23:14:00.000Z",
    vehicle: null,
    ...input
  } as PoliceQruRecord;
}

test("cabecalho traz o tipo da QRU", () => {
  const panel = buildQruRegistrationPanel({ record: record(), settings: { color: "#22c55e" } }) as any;
  const container = panel.components[0];
  assert.equal(container.components[0].content, "# 🚓 APREENSÃO • QRU convencional");
  assert.equal(container.accent_color, parseAccentColor("#22c55e"));
});

test("data do registro e dinamica e por extenso", () => {
  const formatted = formatQruDateTime("2026-08-27T23:14:00.000Z");
  assert.match(formatted ?? "", /27 de agosto de 2026/);
  assert.match(formatted ?? "", /20:14/);
  assert.equal(formatQruDateTime("data-invalida"), null);
});

test("rodape usa timestamp relativo do Discord, nunca data fixa", () => {
  const panel = buildQruRegistrationPanel({
    footerLabel: "FAST - North Police Department",
    record: record(),
    settings: { color: "#22c55e" }
  }) as any;
  const footer = panel.components[0].components.at(-1).content as string;

  assert.match(footer, /^-# /);
  assert.match(footer, /FAST/);
  assert.match(footer, /<t:\d+:R>/);
});

test("ID do personagem sai do nome e vira sufixo da mencao", () => {
  assert.equal(extractOfficerBadge("SO.Bento Borsoli | 1409"), "1409");
  assert.equal(extractOfficerBadge("Sem identificacao"), null);
  assert.equal(formatOfficerLine({ id: "111", name: "SO.Bento Borsoli | 1409" }), "<@111> | 1409");
  assert.equal(formatOfficerLine({ id: "111", name: null }), "<@111>");
});

test("participantes aparecem um por linha e sem repetir o autor", () => {
  const sections = buildQruPanelSections({
    record: record({
      officers: [
        { id: "111", mention: "<@111>", name: "SO.Bento Borsoli | 1409" },
        { id: "333", mention: "<@333>", name: "Usuario1 | 5293" },
        { id: "444", mention: "<@444>", name: "Usuario2 | 1534" }
      ]
    }),
    settings: { color: "#22c55e" }
  });
  const participants = sections.find((section) => section.startsWith("### Participantes"));

  assert.equal(participants, "### Participantes\n<@333> | 5293\n<@444> | 1534");
});

test("campos ausentes somem em vez de virar undefined ou separador vazio", () => {
  const panel = buildQruRegistrationPanel({
    record: record({ approvedById: null, approvedByName: null, notes: null, officers: [], seizures: "nenhuma", status: "pending", vehicle: null }),
    settings: { color: "#22c55e" }
  }) as any;
  const rendered = JSON.stringify(panel);

  assert.doesNotMatch(rendered, /undefined|null,"content"|NaN|Invalid Date/);
  assert.doesNotMatch(rendered, /Aprovado por/);
  assert.doesNotMatch(rendered, /Participantes/);
  assert.doesNotMatch(rendered, /Apreensões/);
  assert.match(rendered, /aguardando aprovação/);

  // Nenhum separador pode ficar sobrando no fim do painel.
  const last = panel.components[0].components.at(-1);
  assert.notEqual(last.type, 14);
});

test("galeria prefere a copia permanente e so cai na URL original sem ela", () => {
  const stored = resolveQruGalleryItems(
    record({
      media: [{ fileName: "evidencia.png", originalUrl: "https://cdn.discordapp.com/a.png?ex=1", status: "ready", storedUrl: "https://nextech.app/api/persistent-images/abc" }]
    }),
    ["https://cdn.discordapp.com/a.png?ex=1"]
  );
  assert.deepEqual(stored, [{ media: { url: "https://nextech.app/api/persistent-images/abc" }, description: "evidencia.png" }]);

  const fallback = resolveQruGalleryItems(
    record({ media: [{ originalUrl: "https://cdn.discordapp.com/a.png?ex=1", status: "failed" }] }),
    ["https://cdn.discordapp.com/a.png?ex=1"]
  );
  assert.deepEqual(fallback, [{ media: { url: "https://cdn.discordapp.com/a.png?ex=1" }, description: "Evidência da ocorrência" }]);

  assert.deepEqual(resolveQruGalleryItems(record({ media: [] }), []), []);
});

test("registro antigo sem media continua renderizando", () => {
  const panel = buildQruRegistrationPanel({
    fallbackImageUrls: ["https://cdn.discordapp.com/antigo.png"],
    record: record({ media: undefined }),
    settings: { color: "#22c55e" }
  }) as any;
  const gallery = panel.components[0].components.find((component: any) => component.type === 12);

  assert.equal(gallery.items[0].media.url, "https://cdn.discordapp.com/antigo.png");
});

test("texto do usuario nao quebra o layout", () => {
  const escaped = escapeQruText("**quebra** _tudo_ `code` <@everyone>");
  assert.doesNotMatch(escaped, /(?<!\\)\*/);
  assert.doesNotMatch(escaped, /(?<!\\)@/);

  const panel = buildQruRegistrationPanel({
    record: record({ qruType: "# Falso @everyone **titulo**" }),
    settings: { color: "#22c55e" }
  }) as any;
  assert.doesNotMatch(panel.components[0].components[0].content.slice(2), /(?<!\\)@everyone/);
});

test("timestamp relativo invalido nao aparece no painel", () => {
  assert.equal(discordRelativeTimestamp("nao-e-data"), null);
});
