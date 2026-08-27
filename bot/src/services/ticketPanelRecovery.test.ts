import assert from "node:assert/strict";
import test from "node:test";
import { createTicketChannelTopic, isPendingTicketLeaseActive, parseScopedComponentId, parseTicketChannelTopic, parseTicketPanelText, scopedComponentId } from "./ticketPanelService";

test("tópico legado do canal mantém metadados suficientes para reconstrução padrão", () => {
  assert.deepEqual(
    parseTicketChannelTopic("SafeBot ticket=123e4567-e89b-12d3-a456-426614174000 opener=123456789012345678 category=suporte"),
    {
      botId: null,
      categoryId: "suporte",
      guildId: null,
      moduleType: "default",
      openerId: "123456789012345678",
      panelId: "suporte",
      ticketId: "123e4567-e89b-12d3-a456-426614174000",
      ticketType: "suporte"
    }
  );
  assert.equal(parseTicketChannelTopic("canal comum"), null);
});

test("tópico novo isola guild, bot, painel, módulo e tipo", () => {
  const topic = createTicketChannelTopic({
    botId: "222222222222222222",
    categoryId: "suporte",
    guildId: "111111111111111111",
    moduleType: "police",
    openerId: "333333333333333333",
    panelId: "painel-policial",
    ticketId: "123e4567-e89b-12d3-a456-426614174000",
    ticketType: "police"
  });

  assert.deepEqual(parseTicketChannelTopic(topic), {
    botId: "222222222222222222",
    categoryId: "suporte",
    guildId: "111111111111111111",
    moduleType: "police",
    openerId: "333333333333333333",
    panelId: "painel-policial",
    ticketId: "123e4567-e89b-12d3-a456-426614174000",
    ticketType: "police"
  });
});

test("customId escopado preserva bot e guild, mas parser ainda aceita legado", () => {
  const scoped = scopedComponentId("ticket_action:", "claim", "111111111111111111", "222222222222222222", "123e4567-e89b-12d3-a456-426614174000");
  assert.deepEqual(parseScopedComponentId(scoped, "ticket_action:"), {
    action: "claim",
    botId: "222222222222222222",
    guildId: "111111111111111111",
    legacy: false,
    targetId: "123e4567-e89b-12d3-a456-426614174000"
  });
  assert.deepEqual(parseScopedComponentId("ticket_action:claim:123e4567-e89b-12d3-a456-426614174000", "ticket_action:"), {
    action: "claim",
    botId: null,
    guildId: null,
    legacy: true,
    targetId: "123e4567-e89b-12d3-a456-426614174000"
  });
});

test("recupera metadados de ticket antigo pelo texto do painel", () => {
  assert.deepEqual(
    parseTicketPanelText(
      [
        "<@&123456789012345678>",
        "## Ticket Aberto",
        "Categoria: Atendimento 1",
        "Assunto: aaaaaaaaaa",
        "Cliente: Não",
        "Autor: <@142687249020158018>",
        "ID do usuário: 142687249020158018",
        "ID do Ticket: #f2180fe3-84a0-4e18-a81a-9ff827ba1777"
      ].join("\n"),
      { guildId: "1505184193766752386", name: "ticket-aaaa-8018", parentId: "222222222222222222" },
      "f2180fe3-84a0-4e18-a81a-9ff827ba1777",
      "1492325134550302952"
    ),
    {
      botId: "1492325134550302952",
      categoryId: "222222222222222222",
      guildId: "1505184193766752386",
      moduleType: "default",
      openerId: "142687249020158018",
      panelId: "222222222222222222",
      responsibleRoleId: "123456789012345678",
      subject: "aaaaaaaaaa",
      ticketId: "f2180fe3-84a0-4e18-a81a-9ff827ba1777",
      ticketType: "atendimento-1"
    }
  );
});

test("recupera metadados de ticket pelo novo layout visual", () => {
  assert.deepEqual(
    parseTicketPanelText(
      [
        "## 🎧 Atendimento Core Network",
        "Olá <@142687249020158018>, seja bem-vindo ao seu ticket.",
        "",
        "**📁 Categoria do atendimento**",
        "```",
        "Compras",
        "```",
        "**📄 Assunto do ticket**",
        "```",
        "queria fazer um orçamento",
        "```",
        "**ID do Ticket:** #f2180fe3-84a0-4e18-a81a-9ff827ba1777"
      ].join("\n"),
      { guildId: "1505184193766752386", name: "compras-vilaofps7", parentId: "222222222222222222" },
      "f2180fe3-84a0-4e18-a81a-9ff827ba1777",
      "1492325134550302952"
    ),
    {
      botId: "1492325134550302952",
      categoryId: "222222222222222222",
      guildId: "1505184193766752386",
      moduleType: "default",
      openerId: "142687249020158018",
      panelId: "222222222222222222",
      responsibleRoleId: null,
      subject: "queria fazer um orçamento",
      ticketId: "f2180fe3-84a0-4e18-a81a-9ff827ba1777",
      ticketType: "compras"
    }
  );
});

test("reserva pendente recente bloqueia concorrência e expira para reconciliação", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  assert.equal(isPendingTicketLeaseActive("2026-08-01T11:59:30.000Z", now), true);
  assert.equal(isPendingTicketLeaseActive("2026-08-01T11:57:00.000Z", now), false);
  assert.equal(isPendingTicketLeaseActive("invalid", now), false);
});
