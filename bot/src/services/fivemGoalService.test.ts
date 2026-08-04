import assert from "node:assert/strict";
import test from "node:test";
import { createFarmRegisteredPayload, createFarmRoomPanelPayload, createGoalRegistrationModal, createGoalRequestPanelPayload, createImageReviewPayload, ensureFivemGoalChannelForApprovedSet, isReusableFarmRoomChannel, renderApprovedSetChannelName } from "./fivemGoalService";

test("painel inicial da sala de farm usa somente o modelo de fechamento", () => {
  const payload = createFarmRoomPanelPayload(null, { managerRoleId: "123456789012345678" }, "987654321098765432");
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /SALA DE FARM/);
  assert.match(serialized, /Sala criada para organizar o registro do farm/);
  assert.match(serialized, /Fechar sala/);
  assert.match(serialized, /Fechar Canal/);
  assert.match(serialized, /fivem_goal:room:close:987654321098765432/);
  assert.match(serialized, /<@&123456789012345678>/);
  assert.doesNotMatch(serialized, /Adicionar Meta|Histórico|Ranking|Atualizar|Solicitar Revisao/);
});

test("canal de meta aprovado pelo set usa prefixo com nome e id in-game", () => {
  assert.equal(renderApprovedSetChannelName("Tairan cooper", "15774"), "📕┋tairan-cooper-|-15774");
});

test("painel de solicitar sala de meta usa custom ids com escopo do servidor e bot", () => {
  const payload = createGoalRequestPanelPayload("Sistema de Metas FiveM", "Solicite seu canal.", "1533162050417721486", "bot-dev-1");
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /CRIAR SALA DE FARM/);
  assert.match(serialized, /Solicitar Sala de Farm/);
  assert.match(serialized, /fivem_goal:request_channel:1533162050417721486:bot-dev-1/);
  assert.doesNotMatch(serialized, /fivem_goal:help:1533162050417721486:bot-dev-1/);
});

test("painel de registro de farm preserva a mensagem original no custom id", () => {
  const payload = createImageReviewPayload(
    "111111111111111111",
    "222222222222222222",
    "333333333333333333",
    "attachment-1",
    "https://cdn.discordapp.com/image.png",
    { items: [] } as any
  );
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /Registro de Farm/);
  assert.match(serialized, /Registrar Farm/);
  assert.match(serialized, /fivem_goal:register:333333333333333333/);
  assert.doesNotMatch(serialized, /https:\/\/cdn\.discordapp\.com\/image\.png/);
  assert.doesNotMatch(serialized, /meta image/);
  assert.doesNotMatch(serialized, /fivem_goal:confirm:/);
});

test("painel de farm registrado usa icone do servidor no lugar da foto enviada", () => {
  const guild = {
    client: {
      emojis: { cache: { find: () => null, get: () => null } },
      guilds: { cache: { get: () => null } },
      user: {
        displayAvatarURL: () => "https://cdn.discordapp.com/bot-avatar.png"
      }
    },
    emojis: { cache: { find: () => null, get: () => null } },
    iconURL: () => "https://cdn.discordapp.com/server-icon.png"
  } as any;

  const payload = createFarmRegisteredPayload(
    "111111111111111111",
    [{ id: "item", label: "Item", value: "Dinheiro sujo" }],
    19999,
    guild,
    null
  );
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /Farm registrado/);
  assert.match(serialized, /https:\/\/cdn\.discordapp\.com\/server-icon\.png/);
  assert.doesNotMatch(serialized, /https:\/\/cdn\.discordapp\.com\/image\.png/);
});

test("modal de registro de farm inclui select de item e campo de quantidade", () => {
  const modal = createGoalRegistrationModal("fivem_goal:modal:source:select:user:none", [
    { enabled: true, id: "dirty-money", name: "Dinheiro Sujo", emoji: null, category: "Registrar dinheiro" },
    { enabled: true, id: "ammo", name: "Munição", emoji: null, category: null }
  ]);
  const serialized = JSON.stringify(modal.toJSON());

  assert.match(serialized, /meta_item_select/);
  assert.match(serialized, /Selecione o item que deseja registrar/);
  assert.match(serialized, /dirty-money/);
  assert.match(serialized, /ammo/);
  assert.match(serialized, /meta_quantidade/);
  assert.doesNotMatch(serialized, /fivem_goal:item:/);
});

test("sala de farm salva só é reutilizada quando o canal ainda existe e é texto", () => {
  assert.equal(isReusableFarmRoomChannel(null), false);
  assert.equal(isReusableFarmRoomChannel({ isDMBased: () => false, isTextBased: () => false, messages: {} }), false);
  assert.equal(isReusableFarmRoomChannel({ isDMBased: () => true, isTextBased: () => true, messages: {} }), false);
  assert.equal(isReusableFarmRoomChannel({ isDMBased: () => false, isTextBased: () => true, messages: { fetch: async () => null } }), true);
});

test("aprovação remove vínculo antigo quando canal de farm salvo foi apagado", async () => {
  const calls = { deleted: [] as string[], saved: [] as string[] };
  const createdChannel = {
    delete: async () => undefined,
    id: "333333333333333333",
    send: async () => ({ id: "444444444444444444" })
  };
  const guild = {
    channels: {
      cache: new Map(),
      create: async () => createdChannel,
      fetch: async (id: string) => id === "222222222222222222"
        ? { id, permissionsFor: () => ({ has: () => true }), type: 4 }
        : null
    },
    client: { user: { id: "999999999999999999" } },
    emojis: { cache: new Map() },
    id: "111111111111111111",
    iconURL: () => null,
    members: {
      me: { id: "999999999999999999", permissions: { has: () => true } },
      fetch: async () => ({ displayName: "User", roles: { cache: new Map() } })
    },
    roles: { cache: new Map(), everyone: { id: "000000000000000000" } }
  } as any;
  const context = {
    api: {
      deleteFivemGoalChannelByChannel: async (channelId: string) => { calls.deleted.push(channelId); return null; },
      getFivemGoalChannelByUser: async () => ({ channelId: "555555555555555555" }),
      getFivemGoalSettings: async () => ({
        botId: "bot",
        categoryId: "222222222222222222",
        channelNameTemplate: "meta-{username}",
        enabled: true,
        items: [],
        managerRoleId: null,
        managerRoleIds: [],
        viewRoleId: null,
        viewerRoleIds: []
      }),
      postLog: async () => null,
      saveFivemGoalChannel: async (input: { channelId: string }) => { calls.saved.push(input.channelId); return input; }
    }
  } as any;

  const result = await ensureFivemGoalChannelForApprovedSet(context, guild, "666666666666666666", "VILAO", "222222222222222222", true, "111111");

  assert.equal(result.error, null);
  assert.equal(result.channelId, createdChannel.id);
  assert.deepEqual(calls.deleted, ["555555555555555555"]);
  assert.deepEqual(calls.saved, [createdChannel.id]);
});
