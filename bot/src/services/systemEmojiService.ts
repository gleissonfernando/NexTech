import { type Client, type Guild, type GuildEmoji } from "discord.js";
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
const fixedSystemEmojiKeyById = new Map<string, SystemEmojiKey>();
const systemEmojiKeyByName = new Map<string, SystemEmojiKey>();

for (const [key, item] of Object.entries(FIXED_SYSTEM_EMOJI_BY_KEY) as Array<[SystemEmojiKey, (typeof FIXED_SYSTEM_EMOJI_BY_KEY)[SystemEmojiKey]]>) {
  if (!fixedSystemEmojiKeyById.has(item.emojiId)) {
    fixedSystemEmojiKeyById.set(item.emojiId, key);
  }
}

for (const definition of SYSTEM_EMOJIS) {
  systemEmojiKeyByName.set(definition.key.toLowerCase(), definition.key);
  systemEmojiKeyByName.set(definition.name.toLowerCase(), definition.key);
  for (const alias of definition.aliases ?? []) {
    systemEmojiKeyByName.set(alias.toLowerCase(), definition.key);
  }
}

const unicodeReplacementPairs: Array<[RegExp, SystemEmojiKey]> = [
  [/✅|✔️|✔/g, "visto"],
  [/⚠️|⚠|🚫/g, "perigo"],
  [/❓/g, "interrogacao"],
  [/❗|❕|🔴|❌/g, "exclamacao"],
  [/📅/g, "calendario"],
  [/📍|🗺️|🗺/g, "mapa"],
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
    await fetchApplicationEmojis(client);
  } catch (error) {
    console.warn("[system-emojis] não foi possível carregar configuração; usando fallbacks:", error instanceof Error ? error.message : error);
  }

  const cacheResults = await Promise.allSettled([...client.guilds.cache.values()].map((guild) => cacheGuildSystemEmojis(guild, context)));
  const caches = cacheResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  for (const result of cacheResults) {
    if (result.status === "rejected") {
      console.warn("[system-emojis] não foi possível validar emojis de um servidor:", result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }

  await refreshSystemEmojis(context).catch((error) => {
    console.warn("[system-emojis] não foi possível atualizar configuração após validação; mantendo fallbacks/cache local:", error instanceof Error ? error.message : error);
  });
  const found = caches.reduce((total, cache) => total + [...cache.emojis.values()].filter((item) => item.found).length, 0);
  const total = caches.length * SYSTEM_EMOJIS.length;
  console.log(`[system-emojis] cache por servidor concluído: ${found}/${total} encontrado(s) em ${caches.length} servidor(es).`);
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
    const extraEmojiNames = [...new Set(cache.extras.map(validationEmojiName).filter((item): item is string => Boolean(item)))].slice(0, 250);
    await context.api.reportSystemEmojiValidation({
      extraEmojiNames,
      guildId: guild.id,
      emojis: [...entries.values()].map((item) => ({
        animated: item.animated,
        emojiId: item.emojiId,
        found: item.found,
        key: item.key,
        name: validationEmojiName(item.name) ?? item.key,
        sourceGuildId: item.found ? guild.id : null
      }))
    }).catch((error) => {
      console.warn(`[system-emojis] não foi possível registrar validação do servidor ${guild.id}:`, error instanceof Error ? error.message : error);
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
  const cached = guild ? guildEmojiCaches.get(guild.id)?.emojis.get(key) : null;
  const fixed = FIXED_SYSTEM_EMOJI_BY_KEY[key];

  if (!fixed && cached?.found) {
    return cached.markdown;
  }

  const resolved = client ? findEmoji(client, guild ?? null, emoji) : findGuildEmoji(guild ?? null, emoji);

  if (emoji.enabled && resolved) {
    return customEmojiMarkdown(resolved);
  }

  if (emoji.enabled && emoji.emojiId && client) {
    const fromClient = client.emojis.cache.get(emoji.emojiId);
    if (fromClient && isGuildEmojiUsable(fromClient)) return customEmojiMarkdown(fromClient);
    const fromApplication = findApplicationEmoji(client, emoji.emojiId);
    if (fromApplication) return customEmojiMarkdown(fromApplication);
  }

  if (cached?.found) {
    return cached.markdown;
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
  const withNamedTokens = replaceNamedSystemEmojiTokens(input, guild, client);
  return unicodeReplacementPairs.reduce((text, [pattern, key]) => text.replace(pattern, systemEmojiText(key, guild, client)), replaceFixedSystemEmojiMarkdown(withNamedTokens, guild, client));
}

function replaceFixedSystemEmojiMarkdown(input: string, guild?: Guild | null, client?: Client | null) {
  return normalizeFixedSystemEmojiText(input).replace(/<a?:([a-zA-Z0-9_]{2,32}):(\d{5,32})>/g, (match, _name: string, emojiId: string) => {
    const key = fixedSystemEmojiKeyById.get(emojiId);
    return key ? systemEmojiText(key, guild, client) : match;
  });
}

function replaceNamedSystemEmojiTokens(input: string, guild?: Guild | null, client?: Client | null) {
  const emojiTokens: string[] = [];
  const protectedInput = input.replace(/<a?:[a-zA-Z0-9_]{2,32}:\d{5,32}>/g, (match) => {
    const token = `\u0000CUSTOM_EMOJI_${emojiTokens.length}\u0000`;
    emojiTokens.push(match);
    return token;
  });
  const replaced = protectedInput.replace(/:([a-zA-Z0-9_]{2,32}):/g, (match, name: string) => {
    const key = systemEmojiKeyByName.get(name.toLowerCase());
    return key ? systemEmojiText(key, guild, client) : match;
  });
  return emojiTokens.reduce((text, emoji, index) => text.split(`\u0000CUSTOM_EMOJI_${index}\u0000`).join(emoji), replaced);
}

function cachedEmoji(key: SystemEmojiKey, name: string, fallback: string, emoji: GuildEmoji | null): CachedGuildEmoji {
  if (!emoji || !isGuildEmojiUsable(emoji)) {
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
    markdown: customEmojiMarkdown(emoji),
    name: emoji.name ?? name
  };
}

function systemEmojiNames(definition: SystemEmojiDefinition) {
  return [definition.name, ...(definition.aliases ?? [])];
}

function validationEmojiName(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
  return normalized.length >= 2 ? normalized : null;
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
    if (fromClient && isGuildEmojiUsable(fromClient)) return fromClient;
    const fromApplication = findApplicationEmoji(client, item.emojiId);
    if (fromApplication) return fromApplication;
    const fromGuild = guild?.emojis.cache.get(item.emojiId);
    if (fromGuild && isGuildEmojiUsable(fromGuild)) return fromGuild;
  }

  const sourceGuild = item.sourceGuildId ? client.guilds.cache.get(item.sourceGuildId) : null;
  return (
    findApplicationEmojiByName(client, item.name) ??
    sourceGuild?.emojis.cache.find((emoji) => emoji.name === item.name && isGuildEmojiUsable(emoji)) ??
    guild?.emojis.cache.find((emoji) => emoji.name === item.name && isGuildEmojiUsable(emoji)) ??
    client.emojis.cache.find((emoji) => emoji.name === item.name && isGuildEmojiUsable(emoji)) ??
    null
  );
}

function findGuildEmoji(guild: Guild | null, item: RuntimeEmoji) {
  if (!item.enabled || !guild) return null;
  if (item.emojiId) {
    const emoji = guild.emojis.cache.get(item.emojiId);
    return emoji && isGuildEmojiUsable(emoji) ? emoji : null;
  }
  return guild.emojis.cache.find((emoji) => emoji.name === item.name && isGuildEmojiUsable(emoji)) ?? null;
}

export async function fetchApplicationEmojis(client: Client) {
  const emojis = (client.application as any)?.emojis;
  if (!emojis?.fetch) return;
  await emojis.fetch().catch(() => undefined);
}

function findApplicationEmoji(client: Client, emojiId: string) {
  return ((client.application as any)?.emojis?.cache?.get(emojiId) ?? null) as { animated?: boolean; id: string; name: string } | null;
}

function findApplicationEmojiByName(client: Client, name: string) {
  return (((client.application as any)?.emojis?.cache?.find((emoji: { name?: string | null }) => emoji.name === name)) ?? null) as { animated?: boolean; id: string; name: string } | null;
}

function isGuildEmojiUsable(emoji: GuildEmoji) {
  if (emoji.available === false) return false;
  if (!emoji.roles.cache.size) return true;
  const botMember = emoji.guild.members.me;
  return Boolean(botMember && emoji.roles.cache.some((role) => botMember.roles.cache.has(role.id)));
}

function customEmojiMarkdown(emoji: { animated?: boolean | null; id: string; name?: string | null }) {
  const name = (emoji.name ?? "emoji").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32) || "emoji";
  return `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`;
}
