import assert from "node:assert/strict";
import test from "node:test";
import { ticketActiveKey, ticketChannelLookupQueries, ticketIdLookupQueries, ticketRecoveryActiveKey } from "./ticketService";

test("chave de recuperação de ticket preserva o ticketId e não colide com ticket aberto da mesma categoria", () => {
  const base = ticketActiveKey("guild-1", "bot-1", "user-1", "suporte", "default");
  const recovered = ticketRecoveryActiveKey("guild-1", "bot-1", "user-1", "suporte", "720e77d7-eb06-4368-bff7-7aa421c72cd5", "default");

  assert.notEqual(recovered, base);
  assert.equal(recovered, `${base}:720e77d7-eb06-4368-bff7-7aa421c72cd5`);
});

test("busca de ticket por id tenta o escopo do bot e depois o legado sem botId", () => {
  assert.deepEqual(ticketIdLookupQueries("ticket-1", "bot-1"), [
    { _id: "ticket-1", botId: "bot-1" },
    { _id: "ticket-1" }
  ]);
  assert.deepEqual(ticketIdLookupQueries("ticket-1", null), [
    {
      _id: "ticket-1",
      $or: [
        { botId: null },
        { botId: { $exists: false } }
      ]
    },
    { _id: "ticket-1" }
  ]);
});

test("busca de ticket por canal tenta o escopo do bot e depois o legado", () => {
  assert.deepEqual(ticketChannelLookupQueries("channel-1", "guild-1", "bot-1"), [
    { channelId: "channel-1", guildId: "guild-1", botId: "bot-1" },
    { channelId: "channel-1", guildId: "guild-1" }
  ]);
  assert.deepEqual(ticketChannelLookupQueries("channel-1", "guild-1", null), [
    {
      channelId: "channel-1",
      guildId: "guild-1",
      $or: [
        { botId: null },
        { botId: { $exists: false } }
      ]
    },
    { channelId: "channel-1", guildId: "guild-1" }
  ]);
});
