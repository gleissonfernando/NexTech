import { getMongoCollections, type MongoSystemEmoji } from "../database/mongo";
import {
  FIXED_SYSTEM_EMOJI_BY_KEY,
  isSystemEmojiKey,
  SYSTEM_EMOJI_BY_KEY,
  SYSTEM_EMOJIS,
  type SystemEmojiKey
} from "../config/systemEmojis";

export type SystemEmojiDto = {
  key: SystemEmojiKey;
  name: string;
  emojiId: string | null;
  animated: boolean;
  sourceGuildId: string | null;
  enabled: boolean;
  fallback: string;
  scope: "global" | "bot" | "guild" | "default";
  botId: string | null;
  guildId: string | null;
  preview: string;
  found: boolean;
  missing: boolean;
  updatedAt: string | null;
  lastFoundAt: string | null;
  lastMissingAt: string | null;
  lastValidatedAt: string | null;
  label: string;
  description: string;
  extraEmojiNames: string[];
};

export type SystemEmojiDashboard = {
  botId: string | null;
  guildId: string | null;
  definitions: typeof SYSTEM_EMOJIS;
  emojis: SystemEmojiDto[];
  summary: {
    total: number;
    configured: number;
    found: number;
    missing: number;
    disabled: number;
    extras: number;
    fallbacks: number;
    lastSyncAt: string | null;
  };
};

type UpdateSystemEmojiInput = {
  animated?: boolean;
  emojiId?: string | null;
  enabled?: boolean;
  fallback?: string | null;
  name?: string | null;
  sourceGuildId?: string | null;
};

type ValidationInput = {
  botId: string | null;
  guildId?: string | null;
  extraEmojiNames?: string[];
  emojis: Array<{
    key: string;
    name?: string | null;
    emojiId?: string | null;
    animated?: boolean;
    found: boolean;
    sourceGuildId?: string | null;
  }>;
};

export async function getSystemEmojiDashboard(botId?: string | null, guildId?: string | null): Promise<SystemEmojiDashboard> {
  const normalizedBotId = normalizeBotId(botId);
  const normalizedGuildId = normalizeGuildId(guildId);
  const emojis = await listSystemEmojis(normalizedBotId, normalizedGuildId);
  const extraEmojiNames = [...new Set(emojis.flatMap((item) => item.extraEmojiNames))].sort();
  const timestamps = emojis
    .map((item) => item.lastValidatedAt)
    .filter((item): item is string => Boolean(item))
    .sort();
  const summary = {
    total: emojis.length,
    configured: emojis.filter((item) => Boolean(item.emojiId)).length,
    found: emojis.filter((item) => item.found).length,
    missing: emojis.filter((item) => item.missing).length,
    disabled: emojis.filter((item) => !item.enabled).length,
    extras: extraEmojiNames.length,
    fallbacks: emojis.filter((item) => !item.emojiId || item.missing || !item.enabled).length,
    lastSyncAt: timestamps.at(-1) ?? null
  };

  return {
    botId: normalizedBotId,
    guildId: normalizedGuildId,
    definitions: SYSTEM_EMOJIS,
    emojis,
    summary
  };
}

export async function getSystemEmojiRuntimeConfig(botId?: string | null, guildId?: string | null) {
  const dashboard = await getSystemEmojiDashboard(botId ?? null, guildId ?? null);
  const applicationEmojis = await getApplicationEmojiRuntimeMap(dashboard.botId);

  return {
    botId: dashboard.botId,
    guildId: dashboard.guildId,
    definitions: dashboard.definitions,
    emojis: dashboard.emojis.map((item) => {
      const applicationEmoji = applicationEmojis.get(item.key);
      const emojiId = applicationEmoji?.emojiId ?? (item.missing ? null : item.emojiId);
      return {
        key: item.key,
        name: applicationEmoji?.name ?? item.name,
        emojiId,
        animated: applicationEmoji?.animated ?? item.animated,
        sourceGuildId: applicationEmoji ? null : item.sourceGuildId,
        enabled: item.enabled,
        fallback: item.fallback,
        guildId: item.guildId,
        scope: item.scope
      };
    })
  };
}

export async function updateSystemEmojiConfig(key: string, input: UpdateSystemEmojiInput, actorId: string | null, botId?: string | null, guildId?: string | null) {
  if (!isSystemEmojiKey(key)) {
    throw new Error("Emoji do sistema inválido.");
  }

  const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
  const fixed = FIXED_SYSTEM_EMOJI_BY_KEY[key];
  const now = new Date();
  const normalizedBotId = normalizeBotId(botId);
  const normalizedGuildId = normalizeGuildId(guildId);
  const name = fixed ? fixed.name : normalizeEmojiName(input.name ?? definition.name);
  const emojiId = fixed ? fixed.emojiId : normalizeSnowflake(input.emojiId ?? null);
  const animated = fixed ? fixed.animated : Boolean(input.animated);
  const sourceGuildId = fixed ? null : normalizeSnowflake(input.sourceGuildId ?? null);
  const enabled = fixed ? true : (input.enabled ?? true);
  const fallback = fixed ? definition.fallback : normalizeFallback(input.fallback ?? definition.fallback, definition.fallback);
  const { systemEmojis } = await getMongoCollections();

  await systemEmojis.updateOne(
    { botId: normalizedBotId, guildId: normalizedGuildId, key },
    {
      $set: {
        animated,
        botId: normalizedBotId,
        emojiId,
        enabled,
        fallback,
        guildId: normalizedGuildId,
        key,
        name,
        sourceGuildId,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: {
        _id: documentId(normalizedBotId, normalizedGuildId, key),
        createdAt: now
      }
    },
    { upsert: true }
  );

  return getSystemEmojiDashboard(normalizedBotId, normalizedGuildId);
}

export async function resetSystemEmojiConfig(key: string, botId?: string | null, guildId?: string | null) {
  if (!isSystemEmojiKey(key)) {
    throw new Error("Emoji do sistema inválido.");
  }

  const normalizedBotId = normalizeBotId(botId);
  const normalizedGuildId = normalizeGuildId(guildId);
  const { systemEmojis } = await getMongoCollections();
  await systemEmojis.deleteOne({ botId: normalizedBotId, guildId: normalizedGuildId, key });
  return getSystemEmojiDashboard(normalizedBotId, normalizedGuildId);
}

export async function ensureSystemEmojiDefaults(botId?: string | null, guildId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const normalizedGuildId = normalizeGuildId(guildId);
  return getSystemEmojiDashboard(normalizedBotId, normalizedGuildId);
}

export async function recordSystemEmojiValidation(input: ValidationInput) {
  const normalizedBotId = normalizeBotId(input.botId);
  const normalizedGuildId = normalizeGuildId(input.guildId);
  const extraEmojiNames = [...new Set((input.extraEmojiNames ?? []).map((item) => normalizeExtraEmojiName(item)).filter(Boolean))].sort();
  const now = new Date();
  const { systemEmojis } = await getMongoCollections();
  const operations = input.emojis
    .filter((item) => isSystemEmojiKey(item.key))
    .map((item) => {
      const key = item.key as SystemEmojiKey;
      const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
      const foundEmojiId = item.found ? normalizeSnowflake(item.emojiId ?? null) : null;
      const foundUpdate = item.found ? { lastFoundAt: now, lastMissingAt: null } : { lastMissingAt: now };

      return systemEmojis.updateOne(
        { botId: normalizedBotId, guildId: normalizedGuildId, key },
        {
          $set: {
            animated: foundEmojiId ? Boolean(item.animated) : false,
            botId: normalizedBotId,
            emojiId: foundEmojiId,
            enabled: true,
            extraEmojiNames,
            fallback: definition.fallback,
            guildId: normalizedGuildId,
            key,
            lastValidatedAt: now,
            lastValidationBotId: normalizedBotId,
            name: foundEmojiId ? normalizeEmojiName(item.name || definition.name) : definition.name,
            sourceGuildId: foundEmojiId ? normalizedGuildId : null,
            updatedAt: now,
            updatedBy: "bot-runtime",
            ...foundUpdate
          },
          $setOnInsert: {
            _id: documentId(normalizedBotId, normalizedGuildId, key),
            createdAt: now
          }
        },
        { upsert: true }
      );
    });

  await Promise.all(operations);
  return getSystemEmojiDashboard(normalizedBotId, normalizedGuildId);
}

async function listSystemEmojis(botId: string | null, guildId: string | null) {
  const { systemEmojis } = await getMongoCollections();
  const docs = await systemEmojis.find({
    $or: [
      { botId: null, guildId: null },
      ...(botId ? [{ botId, guildId: null }] : []),
      ...(botId && guildId ? [{ botId, guildId }] : []),
      ...(!botId && guildId ? [{ botId: null, guildId }] : [])
    ]
  }).toArray();
  const globalDocs = new Map(docs.filter((item) => item.botId === null && (item.guildId ?? null) === null).map((item) => [item.key, item]));
  const botDocs = new Map(docs.filter((item) => item.botId === botId && botId !== null && (item.guildId ?? null) === null).map((item) => [item.key, item]));
  const guildDocs = new Map(docs.filter((item) => (item.guildId ?? null) === guildId && guildId !== null).map((item) => [item.key, item]));

  return SYSTEM_EMOJIS.map((definition) => {
    const doc = (guildDocs.get(definition.key) ?? botDocs.get(definition.key) ?? globalDocs.get(definition.key) ?? null) as MongoSystemEmoji | null;
    return toDto(definition.key, doc, botId, guildId);
  });
}

async function getApplicationEmojiRuntimeMap(botId: string | null) {
  const byKey = new Map<SystemEmojiKey, { animated: boolean; emojiId: string; name: string }>();
  if (!botId) return byKey;

  const { applicationEmojiItems } = await getMongoCollections();
  const items = await applicationEmojiItems.find({ botId }).sort({ syncedAt: -1 }).limit(2000).toArray();
  const byName = new Map(items.map((item) => [item.applicationName.toLowerCase(), item]));

  for (const definition of SYSTEM_EMOJIS) {
    const names = [definition.key, definition.name, ...(definition.aliases ?? [])].map((name) => name.toLowerCase());
    const item = names.map((name) => byName.get(name)).find(Boolean);
    if (!item) continue;

    byKey.set(definition.key, {
      animated: Boolean(item.animated),
      emojiId: item.applicationEmojiId,
      name: item.applicationName
    });
  }

  return byKey;
}

function toDto(key: SystemEmojiKey, doc: MongoSystemEmoji | null, requestedBotId: string | null, requestedGuildId: string | null): SystemEmojiDto {
  const definition = SYSTEM_EMOJI_BY_KEY.get(key)!;
  const fixed = FIXED_SYSTEM_EMOJI_BY_KEY[key];
  const name = doc?.name || fixed?.name || definition.name;
  const emojiId = doc?.emojiId || null;
  const animated = doc?.animated ?? fixed?.animated ?? false;
  const enabled = doc?.enabled ?? true;
  const lastMissingAt = doc?.lastMissingAt ?? null;
  const lastFoundAt = doc?.lastFoundAt ?? null;
  const missing = enabled && Boolean(emojiId) && lastMissingAt !== null && (!lastFoundAt || lastMissingAt > lastFoundAt);

  return {
    key,
    name,
    emojiId,
    animated,
    sourceGuildId: doc?.sourceGuildId ?? null,
    enabled,
    fallback: doc?.fallback || definition.fallback,
    scope: doc ? ((doc.guildId ?? null) ? "guild" : doc.botId ? "bot" : "global") : "default",
    botId: doc?.botId ?? requestedBotId,
    guildId: doc?.guildId ?? requestedGuildId,
    preview: emojiId && enabled ? `<${animated ? "a" : ""}:${name}:${emojiId}>` : (doc?.fallback || definition.fallback),
    found: Boolean(enabled && emojiId && lastFoundAt && !missing),
    missing,
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
    lastFoundAt: lastFoundAt ? lastFoundAt.toISOString() : null,
    lastMissingAt: lastMissingAt ? lastMissingAt.toISOString() : null,
    lastValidatedAt: doc?.lastValidatedAt ? doc.lastValidatedAt.toISOString() : null,
    label: definition.label,
    description: definition.description,
    extraEmojiNames: doc?.extraEmojiNames ?? []
  };
}

function normalizeBotId(botId?: string | null) {
  const value = (botId ?? "").trim();
  return value || null;
}

function normalizeGuildId(guildId?: string | null) {
  return normalizeSnowflake(guildId ?? null);
}

function normalizeEmojiName(value: string) {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(normalized)) {
    throw new Error("Nome de emoji inválido.");
  }
  return normalized;
}

function normalizeSnowflake(value?: string | null) {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  if (!/^\d{5,32}$/.test(normalized)) {
    throw new Error("ID de emoji/servidor inválido.");
  }
  return normalized;
}

function normalizeFallback(value: string | null, defaultValue: string) {
  const normalized = (value ?? "").trim();
  return normalized.slice(0, 16) || defaultValue;
}

function normalizeExtraEmojiName(value: string) {
  const normalized = value.trim();
  return /^[a-zA-Z0-9_]{2,32}$/.test(normalized) ? normalized : "";
}

function documentId(botId: string | null, guildId: string | null, key: string) {
  return `${botId ?? "global"}:${guildId ?? "global"}:${key}`;
}
