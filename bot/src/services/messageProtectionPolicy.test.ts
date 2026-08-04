import assert from "node:assert/strict";
import test from "node:test";
import { Collection, PermissionFlagsBits, PermissionsBitField, type Message } from "discord.js";
import type { SelfBotProtectionSettings } from "./apiClient";
import { extractMessageDomains, isChannelIgnoredOrAllowed, isDomainAllowed } from "./messageProtectionPolicy";

function settings(patch: Partial<SelfBotProtectionSettings> = {}) {
  return {
    enabled: true,
    moduleToggles: { "anti-flood": true, "anti-links": true },
    ignoredChannelIds: [], ignoredCategoryIds: [], ignoredUserIds: [], ignoredRoleIds: [],
    linkChannelIds: [], mediaChannelIds: [], protectedChannelIds: [], allowedDomains: [], allowSubdomains: true,
    ...patch
  } as unknown as SelfBotProtectionSettings;
}

function message(options: { categoryId?: string | null; channelId?: string; parentId?: string | null; roleIds?: string[]; userId?: string; administrator?: boolean } = {}) {
  const channelId = options.channelId ?? "100000000000000001";
  const parentId = options.parentId ?? null;
  const categoryId = options.categoryId ?? null;
  const roles = new Collection((options.roleIds ?? []).map((id) => [id, { id }]));
  const member = {
    id: options.userId ?? "200000000000000001",
    permissions: new PermissionsBitField(options.administrator ? PermissionFlagsBits.Administrator : 0n),
    roles: { cache: roles }
  };
  return {
    author: { id: member.id },
    channelId,
    guild: { ownerId: "999999999999999999" },
    member,
    channel: parentId ? { isThread: () => true, parentId, parent: { parentId: categoryId } } : { isThread: () => false, parentId: categoryId }
  } as unknown as Message;
}

test("canal, canal pai e categoria liberam somente o módulo correspondente", () => {
  const direct = message({ channelId: "100000000000000001" });
  assert.equal(isChannelIgnoredOrAllowed(direct, settings({ linkChannelIds: [direct.channelId] }), "anti-links").reason, "channel_allowed");
  assert.equal(isChannelIgnoredOrAllowed(direct, settings({ linkChannelIds: [direct.channelId] }), "anti-flood").allowed, false);

  const thread = message({ parentId: "100000000000000002", categoryId: "100000000000000003" });
  assert.equal(isChannelIgnoredOrAllowed(thread, settings({ linkChannelIds: ["100000000000000002"] }), "anti-links").reason, "channel_allowed");
  assert.equal(isChannelIgnoredOrAllowed(thread, settings({ ignoredCategoryIds: ["100000000000000003"] }), "anti-links").reason, "category_allowed");
});

test("usuário, cargo e administrador respeitam a prioridade de exceções", () => {
  assert.equal(isChannelIgnoredOrAllowed(message(), settings({ ignoredUserIds: ["200000000000000001"] }), "anti-links").reason, "user_ignored");
  assert.equal(isChannelIgnoredOrAllowed(message({ roleIds: ["300000000000000001"] }), settings({ ignoredRoleIds: ["300000000000000001"] }), "anti-links").reason, "role_ignored");
  assert.equal(isChannelIgnoredOrAllowed(message({ administrator: true }), settings(), "anti-links").reason, "administrator");
});

test("domínios normalizam caixa, protocolo e subdomínio sem aceitar domínio semelhante", () => {
  assert.equal(isDomainAllowed("HTTPS://WWW.Exemplo.com/path", ["exemplo.com"], true), true);
  assert.equal(isDomainAllowed("sub.exemplo.com", ["exemplo.com"], true), true);
  assert.equal(isDomainAllowed("sub.exemplo.com", ["exemplo.com"], false), false);
  assert.equal(isDomainAllowed("exemplo.com.evil.test", ["exemplo.com"], true), false);
});

test("URLs internas e anexos do Discord não são tratados como domínios externos", () => {
  assert.deepEqual(extractMessageDomains("https://discord.com/channels/1/2/3 https://cdn.discordapp.com/attachments/1/2/a.png"), []);
  assert.deepEqual(extractMessageDomains("EXEMPLO.COM/path?x=1"), ["exemplo.com"]);
});

test("sistema e módulo desativados interrompem apenas a proteção aplicável", () => {
  assert.equal(isChannelIgnoredOrAllowed(message(), settings({ enabled: false }), "anti-links").reason, "system_disabled");
  assert.equal(isChannelIgnoredOrAllowed(message(), settings({ moduleToggles: { "anti-links": false } as SelfBotProtectionSettings["moduleToggles"] }), "anti-links").reason, "module_disabled");
  assert.equal(isChannelIgnoredOrAllowed(message(), settings({ moduleToggles: {} as SelfBotProtectionSettings["moduleToggles"] }), "anti-links").reason, "module_disabled");
});
