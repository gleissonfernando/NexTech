import assert from "node:assert/strict";
import test from "node:test";
import { createDecisionDmPayload, createManualRegistrationCreatedLogPayload, createManualRegistrationDecisionLogPayload, createPanelPayload } from "./manualRegistrationService";
import type { ManualRegistrationSettings, ManualRegistrationSubmission } from "./apiClient";

const settings = {
  color: "#7c3aed",
  logMentionRoleId: "333333333333333333",
  panelImage: null,
  setRoles: []
} as unknown as ManualRegistrationSettings;

const submission = {
  createdAt: "2026-07-30T17:50:51.000Z",
  fields: [
    { id: "nome_personagem", label: "Nome do personagem", value: "Tairan cooper" },
    { id: "id_fivem", label: "ID in-game", value: "15774" },
    { id: "telefone", label: "Telefone in-game", value: "441247" },
    { id: "recrutador", label: "Recrutador", value: "melo gst" }
  ],
  id: "sub-1",
  requestedName: "Tairan cooper",
  requestedRoleId: "222222222222222222",
  status: "approved",
  userId: "111111111111111111",
  username: "ytairanw7"
} as ManualRegistrationSubmission;

test("log de aprovação do Pedido de Set usa o formato de Registro aprovado", () => {
  const payload = createManualRegistrationDecisionLogPayload(settings, submission, {
    actorId: "444444444444444444",
    actorLabel: "Arsenal | 10354 (arsenal7_)",
    decidedAt: new Date("2026-07-30T19:12:19.000Z"),
    status: "approved"
  });

  assert.equal(payload.content, "<@&333333333333333333>");
  assert.deepEqual(payload.allowedMentions.roles, ["333333333333333333"]);
  const container = payload.components[0] as { components: Array<{ content?: string; components?: Array<{ content?: string }> }> };
  const firstBlock = container.components[0];
  assert.ok(firstBlock);
  const content = firstBlock.content ?? firstBlock.components?.[0]?.content ?? "";
  assert.match(content, /Registro - Aprovado/);
  assert.match(content, /Usuario:\*\* <@111111111111111111> \| 15774 \(ytairanw7\)/);
  assert.match(content, /Personagem: Tairan cooper/);
  assert.match(content, /Recrutador: melo gst/);
  assert.doesNotMatch(content, /Log de Pedido de Set/);
});

test("log inicial do Pedido de Set contém canal criado e dados do formulário", () => {
  const payload = createManualRegistrationCreatedLogPayload(settings, { ...submission, channelId: "555555555555555555", status: "pending" }, {
    channelId: "555555555555555555",
    guildId: "999999999999999999",
    guildName: "Vortex",
    memberDisplayName: "Tairan Cooper"
  });
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /Novo registro realizado/);
  assert.match(serialized, /<@111111111111111111>/);
  assert.match(serialized, /Nome no servidor: Tairan Cooper/);
  assert.match(serialized, /Servidor:\*\* Vortex/);
  assert.match(serialized, /Canal criado: <#555555555555555555>/);
  assert.match(serialized, /https:\/\/discord\.com\/channels\/999999999999999999\/555555555555555555/);
  assert.match(serialized, /Registro:\*\* sub-1/);
  assert.match(serialized, /Nome do personagem: Tairan cooper/);
  assert.match(serialized, /Recrutador: melo gst/);
});

test("painel do Pedido de Set usa modelo compacto de registro", () => {
  const payload = createPanelPayload({
    ...settings,
    bannerPosition: "top",
    description: "Preencha seu cadastro para liberar o acesso.",
    emoji: "📝",
    fields: [
      { enabled: true, id: "nome_personagem", label: "Nome do personagem", maxLength: 80, minLength: 2, name: "nome_personagem", placeholder: null, required: true, style: "short" },
      { enabled: true, id: "id_fivem", label: "ID", maxLength: 32, minLength: 1, name: "id_fivem", placeholder: null, required: true, style: "short" },
      { enabled: true, id: "telefone", label: "Telefone", maxLength: 32, minLength: 1, name: "telefone", placeholder: null, required: false, style: "short" },
      { enabled: true, id: "recrutador", label: "Recrutador", maxLength: 80, minLength: 1, name: "recrutador", placeholder: null, required: false, style: "short" }
    ],
    footerText: "NexTech - Todos os direitos reservados",
    name: "Pedido de Set",
    thumbnailUrl: null,
    title: "Pedido de Set"
  } as unknown as ManualRegistrationSettings);
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /Antes de começar/);
  assert.match(serialized, /Em caso de divergência/);
  assert.match(serialized, /Solicitar Set/);
  assert.match(serialized, /Clique no botão ao lado para abrir sua solicitação/);
  assert.doesNotMatch(serialized, /Escolha um dos/);
  assert.doesNotMatch(serialized, /Confirme o set disponível/);
  const container = payload.components[0] as { components: Array<{ accessory?: { custom_id?: string; label?: string; type?: number }; components?: unknown[]; type?: number }> };
  const startSection = container.components.find((component) => component.type === 9 && component.accessory?.custom_id === "manual_registration:start");
  assert.equal(startSection?.accessory?.type, 2);
  assert.equal(startSection?.accessory?.label, "Solicitar Set");
});

test("DM de aprovação mostra link direto do canal de meta sem menção desconhecida", () => {
  const guild = {
    channels: {
      cache: new Map([["555555555555555555", { name: "farm-tairan-15774" }]])
    },
    client: {
      application: { emojis: { cache: { get: () => null, find: () => null } } },
      emojis: { cache: { get: () => null, find: () => null } },
      guilds: { cache: { get: () => null } }
    },
    emojis: { cache: { get: () => null, find: () => null } },
    id: "999999999999999999"
  };
  const payload = createDecisionDmPayload(settings, submission, {
    goalChannelId: "555555555555555555",
    guild: guild as never,
    status: "approved"
  });
  const serialized = JSON.stringify(payload);

  assert.match(serialized, /#farm-tairan-15774/);
  assert.match(serialized, /https:\/\/discord\.com\/channels\/999999999999999999\/555555555555555555/);
  assert.doesNotMatch(serialized, /<#555555555555555555>/);
});
