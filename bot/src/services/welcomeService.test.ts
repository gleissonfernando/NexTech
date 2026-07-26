import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type Guild } from "discord.js";
import { resolveMemberPanelEmoji } from "./welcomeService";

function guildWithApplicationEmoji(emojiId?: string, name?: string) {
  const applicationEmojiCache = new Collection<string, { animated: boolean; id: string; name: string }>();
  if (emojiId && name) {
    applicationEmojiCache.set(emojiId, { animated: false, id: emojiId, name });
  }

  const client = {
    application: {
      emojis: {
        cache: applicationEmojiCache
      }
    },
    emojis: {
      cache: new Collection()
    },
    guilds: {
      cache: new Collection()
    }
  };

  return {
    client,
    emojis: {
      cache: new Collection()
    },
    id: "guild"
  } as unknown as Guild;
}

test("painel de entrada e saida usa fallback quando emoji fixo nao esta acessivel", () => {
  const guild = guildWithApplicationEmoji();

  assert.equal(resolveMemberPanelEmoji(guild, ":trofeu_alt:"), "🏅");
  assert.equal(resolveMemberPanelEmoji(guild, "porta"), "🚪");
  assert.equal(resolveMemberPanelEmoji(guild, "<:visto:1525682264300716082>"), "✅");
});

test("painel de entrada e saida usa emoji da aplicacao quando disponivel", () => {
  const guild = guildWithApplicationEmoji("1525682260525711431", "trofeu_alt");

  assert.equal(resolveMemberPanelEmoji(guild, ":trofeu_alt:"), "<:trofeu_alt:1525682260525711431>");
});
