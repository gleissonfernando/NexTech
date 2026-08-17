import assert from "node:assert/strict";
import test from "node:test";
import { createFarmRegisteredPayload, createFarmRoomPanelPayload, createFinalUserGoalReportContent, createGoalChannelRequestModal, createGoalRegistrationModal, createGoalRequestPanelPayload, createImageReviewPayload, ensureFivemGoalChannelForApprovedSet, ensureFivemGoalChannelForUser, handleFivemGoalMessage, isAllowedGoalImage, isReusableFarmRoomChannel, renderApprovedSetChannelName } from "./fivemGoalService";

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

test("relatório final agrupa registros por item configurado", () => {
  const guild = createGoalReportGuildMock();
  const content = createFinalUserGoalReportContent(guild, {
    approvedCount: 0,
    channelId: "222222222222222222",
    groupedItems: [
      {
        configured: true,
        emoji: "💸",
        entries: [
          { entryId: "entry-1", quantity: 29108, registeredAt: "2026-08-01T10:00:00.000Z", status: "confirmed" },
          { entryId: "entry-2", quantity: 37743, registeredAt: "2026-08-02T10:00:00.000Z", status: "confirmed" }
        ],
        itemId: "dinheiro-sujo",
        name: "Dinheiro Sujo",
        total: 66851
      },
      {
        configured: true,
        emoji: "🔋",
        entries: [{ entryId: "entry-3", quantity: 150, registeredAt: "2026-08-03T10:00:00.000Z", status: "confirmed" }],
        itemId: "pilha",
        name: "Pilha",
        total: 150
      }
    ],
    items: [],
    pendingCount: 0,
    periodEnd: "2026-08-08T12:00:00.000Z",
    periodId: "period-1",
    periodStart: "2026-08-01T12:00:00.000Z",
    refusedCount: 0,
    registeredName: "VILÃO",
    result: "completed",
    totalApprovedValue: 0,
    totalPendingValue: 0,
    totalRecords: 3,
    userId: "111111111111111111"
  } as any, "<@999999999999999999>", "<@111111111111111111>", "Manual");

  assert.match(content, /Relatório final \(Admin\)/);
  assert.match(content, /Dinheiro Sujo/);
  assert.match(content, /Dinheiro Sujo:\*\* 29\.108/);
  assert.match(content, /Dinheiro Sujo:\*\* 37\.743/);
  assert.match(content, /Pilha/);
  assert.match(content, /Pilha:\*\* 150/);
  assert.match(content, /Tipo: Manual/);
});

test("relatório final informa usuário sem registros sem criar valores zero", () => {
  const guild = createGoalReportGuildMock();
  const content = createFinalUserGoalReportContent(guild, {
    approvedCount: 0,
    channelId: "222222222222222222",
    groupedItems: [],
    items: [],
    pendingCount: 0,
    periodEnd: "2026-08-08T12:00:00.000Z",
    periodId: "period-1",
    periodStart: "2026-08-01T12:00:00.000Z",
    refusedCount: 0,
    registeredName: "Sem cadastro no Set",
    result: "no_records",
    totalApprovedValue: 0,
    totalPendingValue: 0,
    totalRecords: 0,
    userId: "111111111111111111"
  } as any, "Sistema", "<@111111111111111111>", "Automático");

  assert.match(content, /Sem registros/);
  assert.match(content, /não possui registros de farm no momento\./);
  assert.doesNotMatch(content, /Total: 0/);
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

test("modal de solicitar sala de farm pede nome in game e id de usuario", () => {
  const modal = createGoalChannelRequestModal("fivem_goal:request_channel_modal:1533162050417721486:bot-dev-1");
  const serialized = JSON.stringify(modal.toJSON());

  assert.match(serialized, /Solicitar Sala de Farm/);
  assert.match(serialized, /farm_room_game_name/);
  assert.match(serialized, /Nome in game/);
  assert.match(serialized, /farm_room_user_id/);
  assert.match(serialized, /ID de usuario/);
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

test("painel de farm registrado nao exibe token literal de emoji configurado indisponivel", () => {
  const guild = {
    client: {
      emojis: { cache: { find: () => null, get: () => null } },
      guilds: { cache: { get: () => null } },
      user: {
        displayAvatarURL: () => "https://cdn.discordapp.com/bot-avatar.png"
      }
    },
    emojis: { cache: { find: () => null, get: () => null } },
    iconURL: () => null
  } as any;

  const payload = createFarmRegisteredPayload(
    "111111111111111111",
    [{ id: "item", label: "Item", value: "Diamante" }],
    112212,
    guild,
    ":caixa:"
  );
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /Farm registrado/);
  assert.doesNotMatch(serialized, /:caixa:/);
  assert.match(serialized, /📦 Diamante: 112\.212/);
});

test("gatilho de meta ignora texto no canal de farm sem responder ou logar", async () => {
  const calls = { logs: 0, replies: 0, settings: 0 };
  const message = createGoalMessageMock({ attachments: [], authorId: "111111111111111111", ownerId: "111111111111111111", reply: async () => { calls.replies++; } });
  const context = createGoalContextMock({
    getFivemGoalSettings: async () => { calls.settings++; return { enabled: true }; },
    postLog: async () => { calls.logs++; }
  });

  const handled = await handleFivemGoalMessage(message as any, context as any);

  assert.equal(handled, true);
  assert.equal(calls.replies, 0);
  assert.equal(calls.logs, 0);
  assert.equal(calls.settings, 0);
});

test("gatilho de meta ignora anexos que nao sao imagem valida em silencio", async () => {
  const calls = { logs: 0, replies: 0 };
  const message = createGoalMessageMock({
    attachments: [{ contentType: "application/pdf", id: "att-pdf", url: "https://cdn.discordapp.com/prova.pdf" }],
    authorId: "111111111111111111",
    ownerId: "111111111111111111",
    reply: async () => { calls.replies++; }
  });
  const context = createGoalContextMock({ postLog: async () => { calls.logs++; } });

  const handled = await handleFivemGoalMessage(message as any, context as any);

  assert.equal(handled, true);
  assert.equal(calls.replies, 0);
  assert.equal(calls.logs, 0);
});

test("gatilho de meta ignora imagem enviada por usuario nao autorizado", async () => {
  const calls = { logs: 0, replies: 0 };
  const message = createGoalMessageMock({
    attachments: [{ contentType: "image/png", id: "att-img", url: "https://cdn.discordapp.com/prova.png" }],
    authorId: "222222222222222222",
    ownerId: "111111111111111111",
    reply: async () => { calls.replies++; }
  });
  const context = createGoalContextMock({
    getFivemGoalSettings: async () => ({ correctionManagement: { allowAdministrators: false }, enabled: true, managerRoleIds: [] }),
    postLog: async () => { calls.logs++; }
  });

  const handled = await handleFivemGoalMessage(message as any, context as any);

  assert.equal(handled, true);
  assert.equal(calls.replies, 0);
  assert.equal(calls.logs, 0);
});

test("gatilho de meta publica painel quando dono envia imagem valida", async () => {
  const calls = { logs: [] as any[], replies: [] as any[] };
  const message = createGoalMessageMock({
    attachments: [{ contentType: "image/gif", id: "att-gif", url: "https://cdn.discordapp.com/prova.gif" }],
    authorId: "111111111111111111",
    id: "333333333333333333",
    ownerId: "111111111111111111",
    reply: async (payload: any) => { calls.replies.push(payload); }
  });
  const context = createGoalContextMock({
    getFivemGoalSettings: async () => ({ enabled: true, items: [], setRequestEnabled: false }),
    getPendingFivemGoalCorrections: async () => [],
    postLog: async (payload: any) => { calls.logs.push(payload); }
  });

  const handled = await handleFivemGoalMessage(message as any, context as any);

  assert.equal(handled, true);
  assert.equal(calls.replies.length, 1);
  assert.match(JSON.stringify(calls.replies[0]), /Registrar Farm/);
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0].type, "fivem.goals.photo_received");
  assert.equal(calls.logs[0].userId, "111111111111111111");
});

test("validacao de imagem aceita MIME e extensoes permitidas", () => {
  assert.equal(isAllowedGoalImage({ contentType: "image/png; charset=binary", url: "https://cdn.discordapp.com/file.bin" } as any), true);
  assert.equal(isAllowedGoalImage({ contentType: null, url: "https://cdn.discordapp.com/file.jpeg?token=1" } as any), true);
  assert.equal(isAllowedGoalImage({ contentType: "image/gif", url: "https://cdn.discordapp.com/file.dat" } as any), true);
  assert.equal(isAllowedGoalImage({ contentType: "application/zip", url: "https://cdn.discordapp.com/file.zip" } as any), false);
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

test("sala de farm reutilizada atualiza nome com dados do modal", async () => {
  const calls = { names: [] as string[] };
  const existingChannel = {
    id: "222222222222222222",
    isDMBased: () => false,
    isTextBased: () => true,
    messages: {
      fetch: async () => ({
        find: () => undefined,
        some: () => true
      })
    },
    name: "meta-antiga",
    parentId: null,
    setName: async (name: string) => { calls.names.push(name); }
  };
  const guild = {
    channels: {
      cache: new Map(),
      fetch: async (id: string) => id === existingChannel.id ? existingChannel : null
    },
    client: { user: { id: "999999999999999999" } },
    emojis: { cache: new Map() },
    id: "111111111111111111",
    iconURL: () => null,
    members: { me: { id: "999999999999999999", permissions: { has: () => true } } },
    roles: { cache: new Map(), everyone: { id: "000000000000000000" } }
  } as any;
  const context = {
    api: {
      getFivemGoalChannelByUser: async () => ({ channelId: existingChannel.id }),
      getFivemGoalSettings: async () => ({
        botId: "bot",
        categoryId: null,
        channelNameTemplate: "meta-{username}",
        enabled: true,
        items: [],
        managerRoleId: null,
        managerRoleIds: [],
        viewRoleId: null,
        viewerRoleIds: []
      }),
      postLog: async () => null
    }
  } as any;

  const channelId = await ensureFivemGoalChannelForUser(context, guild, "666666666666666666", "Tairan Cooper", null, "15774");

  assert.equal(channelId, existingChannel.id);
  assert.deepEqual(calls.names, ["📕┋tairan-cooper-|-15774"]);
});

function createGoalContextMock(overrides: Record<string, any> = {}) {
  return {
    api: {
      deleteFivemGoalChannelByChannel: async () => null,
      getFivemGoalChannelByChannel: async () => ({ userId: "111111111111111111" }),
      getFivemGoalSettings: async () => ({ enabled: true, items: [], setRequestEnabled: false }),
      getLatestManualRegistrationSubmission: async () => ({ status: "approved" }),
      getPendingFivemGoalCorrections: async () => [],
      postLog: async () => null,
      ...overrides
    }
  };
}

function createGoalMessageMock(input: {
  attachments: Array<{ contentType: string | null; id: string; url: string }>;
  authorId: string;
  id?: string;
  ownerId: string;
  reply?: (payload: any) => Promise<void>;
}) {
  const attachmentList = input.attachments.map((attachment) => ({ ...attachment }));
  return {
    attachments: {
      find: (predicate: (attachment: any) => boolean) => attachmentList.find(predicate),
      size: attachmentList.length
    },
    author: { bot: false, id: input.authorId },
    channel: {
      id: "222222222222222222",
      isDMBased: () => false,
      isSendable: () => true,
      send: async () => null
    },
    delete: async () => null,
    guild: {
      client: {
        emojis: { cache: { find: () => null, get: () => null } },
        guilds: { cache: { get: () => null } },
        user: { displayAvatarURL: () => null }
      },
      emojis: { cache: { find: () => null, get: () => null } },
      id: "999999999999999999",
      iconURL: () => null,
      members: {
        fetch: async () => ({ permissions: { has: () => false }, roles: { cache: { some: () => false } } })
      }
    },
    id: input.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    reply: input.reply ?? (async () => undefined)
  };
}

function createGoalReportGuildMock() {
  return {
    client: {
      emojis: { cache: { find: () => null, get: () => null } },
      guilds: { cache: { get: () => null } },
      user: { displayAvatarURL: () => null }
    },
    emojis: { cache: { find: () => null, get: () => null } }
  } as any;
}

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
