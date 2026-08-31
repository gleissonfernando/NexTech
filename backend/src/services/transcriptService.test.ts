import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MongoTranscript } from "../database/mongo";
import { generateTemporaryPassword, renderTranscriptHtml } from "./transcriptService";

describe("renderTranscriptHtml", () => {
  it("renderiza transcript personalizável com busca, filtros, participantes e conteúdo escapado", () => {
    const transcript = sampleTranscript();
    const html = renderTranscriptHtml(transcript, "Temporária", "2026-08-30T12:00:00.000Z", {
      logoUrl: "https://cdn.discordapp.com/icons/logo.png",
      brandName: "Cliente Teste",
      primaryColor: "#ff0055",
      secondaryColor: "#38bdf8",
      accentColor: "#f43f5e",
      backgroundColor: "#07080d",
      secondaryBackgroundColor: "#10131d",
      cardColor: "#151925",
      messageColor: "#111522",
      borderColor: "#2b3143",
      textColor: "#f8fafc",
      mutedTextColor: "#a1a8b8",
      buttonColor: "#ff0055",
      linkColor: "#7dd3fc",
      titleColor: "#ffffff",
      iconColor: "#ff0055",
      statusColor: "#22c55e",
      hoverColor: "#232a3c",
      searchColor: "#0d111c",
      mode: "dark",
      density: "normal",
      cardRadius: "rounded",
      style: "tech",
      showNevsecBranding: true,
      labels: {
        pageTitle: "Transcrição de atendimento",
        summaryTitle: "Resumo da transcrição",
        contactTitle: "Detalhes do contato",
        conversationTitle: "Conversa",
        searchPlaceholder: "Buscar na conversa",
        openedAt: "Aberto em",
        closedAt: "Fechado em",
        duration: "Duração",
        messages: "Mensagens",
        openedBy: "Aberto por",
        assumedBy: "Assumido por",
        category: "Categoria",
        subject: "Assunto",
        status: "Status",
        ticketId: "ID do ticket",
        transcriptId: "ID do transcript",
        endOfConversation: "Fim da conversa",
        footerText: "Registro preservado."
      }
    });

    assert.match(html, /Cliente Teste/);
    assert.match(html, /Transcrição de atendimento/);
    assert.match(html, /Resumo da transcrição/);
    assert.match(html, /data-search/);
    assert.match(html, /data-filter="media"/);
    assert.match(html, /data-filter="links"/);
    assert.match(html, /Vilão 1/);
    assert.match(html, /Dms\. 1/);
    assert.match(html, /Hoje|27\/08\/2026|27\/08\/26/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /anexo\.png/);
    assert.match(html, /Embed seguro/);
    assert.match(html, /Tecnologia NexTech/);
  });
});

describe("generateTemporaryPassword", () => {
  it("gera uma senha numérica de 4 dígitos", () => {
    assert.match(generateTemporaryPassword(), /^\d{4}$/);
  });
});

function sampleTranscript(): MongoTranscript {
  const createdAt = new Date("2026-08-27T21:00:00.000Z");
  const closedAt = new Date("2026-08-27T21:35:00.000Z");
  return {
    _id: "TR-TESTE01",
    ticketId: "TICKET-1",
    guildId: "12345",
    botId: "67890",
    ownerId: "11111",
    channelId: "22222",
    channelName: "🛒・vilao",
    guildName: "Core Network LTDA",
    type: "Ticket",
    categoryName: "Compras",
    htmlPath: "/transcripts/TR-TESTE01",
    pdfPath: null,
    txtPath: "/transcripts/TR-TESTE01/export.txt",
    htmlContent: "",
    textContent: "",
    websiteUrl: null,
    status: "Finalizado",
    createdAt,
    closedAt,
    expiresAt: new Date("2027-08-27T21:00:00.000Z"),
    isPartial: false,
    partialReason: null,
    accessCount: 0,
    openedById: "11111",
    responsibleUserId: "33333",
    closedById: "33333",
    closeReason: "Atendimento concluído.",
    openReason: "queria fazer um orçamento",
    finalResult: "Atendimento concluído.",
    internalNotes: null,
    rolesInvolved: [],
    metadata: {},
    participants: [
      { id: "11111", name: "Vilão", role: "Cliente" },
      { id: "33333", name: "Dms.", role: "Staff" }
    ],
    messages: [
      {
        id: "m1",
        authorAvatarUrl: null,
        authorId: "11111",
        authorName: "Vilão",
        authorRoleIds: [],
        content: "<script>alert(1)</script>",
        attachments: [{ contentType: "image/png", id: "a1", name: "anexo.png", size: 1200, url: "https://cdn.discordapp.com/attachments/a/anexo.png" }],
        embeds: [],
        createdAt,
        editedAt: null
      },
      {
        id: "m2",
        authorAvatarUrl: null,
        authorId: "33333",
        authorName: "Dms.",
        authorRoleIds: [],
        content: "Veja https://example.com",
        attachments: [],
        embeds: [{ title: "Embed seguro", description: "Conteúdo preservado" }],
        createdAt: new Date("2026-08-27T21:05:00.000Z"),
        editedAt: null
      }
    ],
    attachments: [{ contentType: "image/png", id: "a1", name: "anexo.png", size: 1200, url: "https://cdn.discordapp.com/attachments/a/anexo.png" }],
    events: [],
    deletedAt: null
  };
}
