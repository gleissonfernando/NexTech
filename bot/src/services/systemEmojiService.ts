import type { Client, Guild, GuildEmoji } from "discord.js";
import {
  FIXED_SYSTEM_EMOJI_BY_KEY,
  normalizeFixedSystemEmojiText,
  SYSTEM_EMOJI_BY_KEY,
  SYSTEM_EMOJIS,
  type SystemEmojiDefinition,
  type SystemEmojiKey
} from "../config/systemEmojis";
import type { BotContext } from "../types";
import { ensureGuildEmojiCache } from "../utils/componentEmoji";

type RuntimeEmoji = {
  key: string;
  name: string;
  emojiId: string | null;
  animated: boolean;
  sourceGuildId: string | null;
  enabled: boolean;
  fallback: string;
};

type CachedGuildEmoji = {
  key: SystemEmojiKey;
  name: string;
  emojiId: string | null;
  animated: boolean;
  fallback: string;
  found: boolean;
  markdown: string;
};

type GuildSystemEmojiCache = {
  guildId: string;
  emojis: Map<SystemEmojiKey, CachedGuildEmoji>;
  extras: string[];
  lastSyncedAt: number;
};

const runtimeEmojis = new Map<string, RuntimeEmoji>();
const guildEmojiCaches = new Map<string, GuildSystemEmojiCache>();

const unicodeReplacementPairs: Array<[RegExp, SystemEmojiKey]> = [
  [/✅|✔️|✔/g, "visto"],
  [/⚠️|⚠|🚫/g, "perigo"],
  [/❓/g, "interrogacao"],
  [/❗|❕|🔴|❌/g, "exclamacao"],
  [/📅/g, "calendario"],
  [/🏆|⭐|📚|🎓/g, "trofeu"],
  [/🏅|🎖️|🎖/g, "trofeu_alt"],
  [/💰|💵|💸/g, "dinheiro"],
  [/📄|🧾|⚖️|⚖/g, "folha"],
  [/📋|🏷️|🏷|📁|🎫/g, "prancheta"],
  [/📝|✏️|✏/g, "prancheta_caneta"],
  [/👤|👥|👮/g, "homem"],
  [/🔗|📨|📩/g, "link"],
  [/📦|📭|💎/g, "caixa"],
  [/🕒|⏰|⏳|🔄/g, "relogio"],
  [/⚙️|⚙|🔧|🏛️|🏛/g, "engrenagem"],
  [/🚪|↩️|↩/g, "porta"],
  [/🤖/g, "robo"],
  [/📈|📊/g, "prancheta_acertos"],
  [/📣|🛡️|🛡/g, "alerta"],
  [/▶️|▶/g, "liga"],
  [/🚀|➡️|➡/g, "acessar"],
  [/☁️|☁/g, "nuvem"],
  [/🔫/g, "arma"],
  [/🔍|🎧/g, "interrogacao"]
];

export async function refreshSystemEmojis(context: BotContext) {
  const config = await context.api.getSystemEmojis();
  runtimeEmojis.clear();

  for (const item of config.emojis) {
    runtimeEmojis.set(item.key, item);
  }

  return config;
}

export async function validateSystemEmojisOnStartup(client: Client<true>, context: BotContext) {
  try {
    await refreshSystemEmojis(context);
  } catch (error) {
    console.warn("[system-emojis] nao foi possivel carregar configuracao; usando fallbacks:", error instanceof Error ? error.message : error);
  }

  const caches = await Promise.all([...client.guilds.cache.values()].map((guild) => cacheGuildSystemEmojis(guild, context)));
  const found = caches.reduce((total, cache) => total + [...cache.emojis.values()].filter((item) => item.found).length, 0);
  const total = caches.length * SYSTEM_EMOJIS.length;
  console.log(`[system-emojis] cache por servidor concluido: ${found}/${total} encontrado(s) em ${caches.length} servidor(es).`);
}

export async function cacheGuildSystemEmojis(guild: Guild, context?: BotContext | null) {
  await ensureGuildEmojiCache(guild);

  const requiredNames = new Set(SYSTEM_EMOJIS.flatMap(systemEmojiNames));
  const entries = new Map<SystemEmojiKey, CachedGuildEmoji>();

  for (const definition of SYSTEM_EMOJIS) {
    const names = systemEmojiNames(definition);
    const resolved = guild.emojis.cache.find((emoji) => Boolean(emoji.name && names.includes(emoji.name))) ?? null;
    entries.set(definition.key, cachedEmoji(definition.key, definition.name, definition.fallback, resolved));
  }

  const cache: GuildSystemEmojiCache = {
    guildId: guild.id,
    emojis: entries,
    extras: guild.emojis.cache.filter((emoji) => Boolean(emoji.name && !requiredNames.has(emoji.name as SystemEmojiKey))).map((emoji) => emoji.name ?? emoji.id),
    lastSyncedAt: Date.now()
  };

  guildEmojiCaches.set(guild.id, cache);

  if (context) {
    await context.api.reportSystemEmojiValidation({
      extraEmojiNames: cache.extras,
      guildId: guild.id,
      emojis: [...entries.values()].map((item) => ({
        animated: item.animated,
        emojiId: item.emojiId,
        found: item.found,
        key: item.key,
        name: item.name,
        sourceGuildId: item.found ? guild.id : null
      }))
    }).catch((error) => {
      console.warn(`[system-emojis] nao foi possivel registrar validacao do servidor ${guild.id}:`, error instanceof Error ? error.message : error);
    });
  }

  return cache;
}

export function handleSystemEmojiGuildMutation(emoji: GuildEmoji, context: BotContext) {
  return cacheGuildSystemEmojis(emoji.guild, context);
}

export function getGuildSystemEmojiCache(guildId: string) {
  return guildEmojiCaches.get(guildId) ?? null;
}

export function systemEmojiText(key: SystemEmojiKey, guild?: Guild | null, client?: Client | null) {
  const emoji = runtimeEmoji(key);
  if (emoji.enabled && emoji.emojiId) {
    return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.emojiId}>`;
  }

  const cached = guild ? guildEmojiCaches.get(guild.id)?.emojis.get(key) : null;
  if (cached?.found) {
    return cached.markdown;
  }

  const resolved = client ? findEmoji(client, guild ?? null, emoji) : findGuildEmoji(guild ?? null, emoji);

  if (emoji.enabled && resolved) {
    return `<${resolved.animated ? "a" : ""}:${resolved.name}:${resolved.id}>`;
  }

  return emoji.fallback;
}

export function systemComponentEmoji(key: SystemEmojiKey, guild?: Guild | null, client?: Client | null) {
  return systemEmojiText(key, guild, client);
}

export function systemActionEmoji(action: "open" | "close" | "save" | "edit" | "approve" | "reject" | "pay" | "settings" | "link" | "help", guild?: Guild | null, client?: Client | null) {
  const keyByAction: Record<typeof action, SystemEmojiKey> = {
    approve: "visto",
    close: "porta",
    edit: "prancheta_caneta",
    help: "interrogacao",
    link: "link",
    open: "acessar",
    pay: "dinheiro",
    reject: "exclamacao",
    save: "prancheta_acertos",
    settings: "engrenagem"
  };

  return systemComponentEmoji(keyByAction[action], guild, client);
}

export function systemStatusEmoji(status: "success" | "warning" | "danger" | "active" | "pending" | "offline", guild?: Guild | null, client?: Client | null) {
  const keyByStatus: Record<typeof status, SystemEmojiKey> = {
    active: "liga",
    danger: "perigo",
    offline: "porta",
    pending: "relogio",
    success: "visto",
    warning: "exclamacao"
  };

  return systemEmojiText(keyByStatus[status], guild, client);
}

export function replaceSystemEmojis(input: string, guild?: Guild | null, client?: Client | null) {
  return unicodeReplacementPairs.reduce((text, [pattern, key]) => text.replace(pattern, systemEmojiText(key, guild, client)), normalizeFixedSystemEmojiText(input));
}

function cachedEmoji(key: SystemEmojiKey, name: string, fallback: string, emoji: GuildEmoji | null): CachedGuildEmoji {
  if (!emoji) {
    return {
      animated: false,
      emojiId: null,
      fallback,
      found: false,
      key,
      markdown: fallback,
      name
    };
  }

  return {
    animated: emoji.animated ?? false,
    emojiId: emoji.id,
    fallback,
    found: true,
    key,
    markdown: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`,
    name: emoji.name ?? name
  };
}

function systemEmojiNames(definition: SystemEmojiDefinition) {
  return [definition.name, ...(definition.aliases ?? [])];
}

function runtimeEmoji(key: SystemEmojiKey): RuntimeEmoji {
  const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
  const fixed = FIXED_SYSTEM_EMOJI_BY_KEY[key];
  if (fixed) {
    return {
      key,
      name: fixed.name,
      emojiId: fixed.emojiId,
      animated: fixed.animated,
      sourceGuildId: null,
      enabled: true,
      fallback: definition.fallback
    };
  }

  const configured = runtimeEmojis.get(key);
  if (configured) return configured;

  return {
    key,
    name: definition.name,
    emojiId: null,
    animated: false,
    sourceGuildId: null,
    enabled: true,
    fallback: definition.fallback
  };
}

function findEmoji(client: Client, guild: Guild | null, item: RuntimeEmoji) {
  if (!item.enabled) return null;

  if (item.emojiId) {
    const fromClient = client.emojis.cache.get(item.emojiId);
    if (fromClient) return fromClient;
    const fromGuild = guild?.emojis.cache.get(item.emojiId);
    if (fromGuild) return fromGuild;
  }

  const sourceGuild = item.sourceGuildId ? client.guilds.cache.get(item.sourceGuildId) : null;
  return (
    sourceGuild?.emojis.cache.find((emoji) => emoji.name === item.name) ??
    guild?.emojis.cache.find((emoji) => emoji.name === item.name) ??
    client.emojis.cache.find((emoji) => emoji.name === item.name) ??
    null
  );
}

function findGuildEmoji(guild: Guild | null, item: RuntimeEmoji) {
  if (!item.enabled || !guild) return null;
  if (item.emojiId) return guild.emojis.cache.get(item.emojiId) ?? null;
  return guild.emojis.cache.find((emoji) => emoji.name === item.name) ?? null;
}
