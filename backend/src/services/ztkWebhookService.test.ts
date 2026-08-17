import assert from "node:assert/strict";
import test from "node:test";
import { ztkDominationGangRankingPipelineForTest, ztkDominationStatTargetsForTest } from "./ztkWebhookService";

test("ranking de gangs ZTK usa somente dominações do período semanal ativo", () => {
  const weekStart = new Date("2026-08-10T23:00:00.000Z");
  const [matchStage] = ztkDominationGangRankingPipelineForTest({
    _id: "clan-1",
    botId: "bot-1",
    guildId: "guild-1"
  }, weekStart);

  assert.deepEqual(matchStage, {
    $match: {
      botId: "bot-1",
      clanId: "clan-1",
      eventTimestamp: { $gte: weekStart },
      eventType: "domination",
      guildId: "guild-1"
    }
  });
});

test("dominação ZTK gera um alvo de incremento por jogador sem duplicar no mesmo evento", () => {
  const targets = ztkDominationStatTargetsForTest({
    participants: [
      { id: "101", name: "Ana Silva", normalizedName: "ana silva" },
      { id: "101", name: "Ana Silva", normalizedName: "ana silva" },
      { id: null, name: "Bruno Costa", normalizedName: "bruno costa" },
      { id: null, name: "Bruno Costa", normalizedName: "bruno costa" }
    ],
    playerId: null,
    playerName: null,
    recruiterName: null
  });

  assert.deepEqual(targets, [
    { key: "id:101", playerId: "101", playerName: "Ana Silva" },
    { key: "name:bruno costa", playerId: null, playerName: "Bruno Costa" }
  ]);
});

test("dominação ZTK sem lista de participantes incrementa o jogador principal uma vez", () => {
  const targets = ztkDominationStatTargetsForTest({
    participants: [],
    playerId: "202",
    playerName: "Carla Souza",
    recruiterName: null
  });

  assert.deepEqual(targets, [
    { key: "id:202", playerId: "202", playerName: "Carla Souza" }
  ]);
});
