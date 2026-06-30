import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoFivemGoalEntry, type MongoFivemGoalSettings, type MongoFivemGoalUserChannel } from "../database/mongo";

export const FIVEM_GOALS_MODULE_ID = "fivem-goals";

export type FivemGoalFieldDto = {
  id: string;
  label: string;
  maxLength: number | null;
  minLength: number | null;
  placeholder: string | null;
  required: boolean;
  style: "short" | "paragraph";
};

export type FivemGoalItemDto = {
  category: string | null;
  color: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
};

export type FivemGoalSettingsDto = {
  botId: string | null;
  categoryId: string | null;
  channelNameTemplate: string;
  enabled: boolean;
  fields: FivemGoalFieldDto[];
  guildId: string;
  items: FivemGoalItemDto[];
  logChannelId: string | null;
  managerRoleId: string | null;
  updatedAt: string | null;
  viewRoleId: string | null;
};

export type FivemGoalEntryDto = {
  botId: string | null;
  channelId: string;
  createdAt: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  id: string;
  imageUrl: string;
  itemId: string | null;
  quantity: number | null;
  updatedAt: string;
  userId: string;
};

export type FivemGoalUserChannelDto = {
  botId: string | null;
  channelId: string;
  createdAt: string;
  guildId: string;
  updatedAt: string;
  userId: string;
};

const DEFAULT_FIELDS: FivemGoalFieldDto[] = [
  { id: "euro_sujo", label: "Euro Sujo", maxLength: 80, minLength: 1, placeholder: "Ex: 100000", required: true, style: "short" },
  { id: "itens", label: "Itens", maxLength: 300, minLength: 1, placeholder: "Ex: 5 Diamantes", required: true, style: "short" },
  { id: "quantidade", label: "Quantidade", maxLength: 80, minLength: 1, placeholder: "Ex: 5", required: true, style: "short" },
  { id: "observacao", label: "Observacao", maxLength: 1000, minLength: null, placeholder: "Detalhes extras", required: false, style: "paragraph" }
];

const DEFAULT_ITEMS: FivemGoalItemDto[] = [
  { category: "Dinheiro", color: "#22c55e", emoji: "💰", enabled: true, id: "euro-sujo", name: "Euro Sujo", order: 1 },
  { category: "Itens", color: "#38bdf8", emoji: "💎", enabled: true, id: "diamante", name: "Diamante", order: 2 },
  { category: "Armas", color: "#f97316", emoji: "🔫", enabled: true, id: "armas", name: "Armas", order: 3 },
  { category: "Itens", color: "#a855f7", emoji: "📦", enabled: true, id: "contrabando", name: "Contrabando", order: 4 }
];

export function defaultFivemGoalSettings(guildId: string, botId: string | null = null): FivemGoalSettingsDto {
  return {
    botId,
    categoryId: null,
    channelNameTemplate: "📈・{username}",
    enabled: false,
    fields: DEFAULT_FIELDS.map((field) => ({ ...field })),
    guildId,
    items: DEFAULT_ITEMS.map((item) => ({ ...item })),
    logChannelId: null,
    managerRoleId: null,
    updatedAt: null,
    viewRoleId: null
  };
}

export async function getFivemGoalSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemGoalSettings } = await getMongoCollections();
  const settings = await fivemGoalSettings.findOne(scopeQuery(guildId, normalizedBotId));
  return settings ? toSettingsDto(settings) : defaultFivemGoalSettings(guildId, normalizedBotId);
}

export async function saveFivemGoalSettings(guildId: string, botId: string | null, input: Partial<FivemGoalSettingsDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getFivemGoalSettings(guildId, normalizedBotId);
  const next = normalizeSettings({ ...current, ...input, botId: normalizedBotId, guildId });
  const now = new Date();
  const { fivemGoalSettings } = await getMongoCollections();

  await ensureGuild(guildId);
  await fivemGoalSettings.updateOne(
    scopeQuery(guildId, normalizedBotId),
    {
      $set: {
        ...next,
        updatedAt: now,
        updatedBy: actorId
      },
      $setOnInsert: { _id: randomUUID() }
    },
    { upsert: true }
  );

  return getFivemGoalSettings(guildId, normalizedBotId);
}

export async function upsertFivemGoalUserChannel(input: { botId?: string | null; channelId: string; guildId: string; userId: string }) {
  const now = new Date();
  const botId = normalizeBotId(input.botId);
  const { fivemGoalUserChannels } = await getMongoCollections();
  await fivemGoalUserChannels.updateOne(
    { botId, guildId: input.guildId, userId: input.userId },
    {
      $set: { botId, channelId: input.channelId, guildId: input.guildId, updatedAt: now, userId: input.userId },
      $setOnInsert: { _id: randomUUID(), createdAt: now }
    },
    { upsert: true }
  );
  return getFivemGoalUserChannelByUser(input.guildId, input.userId, botId);
}

export async function getFivemGoalUserChannelByUser(guildId: string, userId: string, botId?: string | null) {
  const { fivemGoalUserChannels } = await getMongoCollections();
  const row = await fivemGoalUserChannels.findOne({ botId: normalizeBotId(botId), guildId, userId });
  return row ? toUserChannelDto(row) : null;
}

export async function getFivemGoalUserChannelByChannel(channelId: string, botId?: string | null) {
  const { fivemGoalUserChannels } = await getMongoCollections();
  const row = await fivemGoalUserChannels.findOne({ botId: normalizeBotId(botId), channelId });
  return row ? toUserChannelDto(row) : null;
}

export async function createFivemGoalEntry(input: {
  botId?: string | null;
  channelId: string;
  fields: Array<{ id: string; label: string; value: string }>;
  guildId: string;
  imageUrl: string;
  itemId?: string | null;
  quantity?: number | null;
  userId: string;
}) {
  const now = new Date();
  const doc: MongoFivemGoalEntry = {
    _id: randomUUID(),
    botId: normalizeBotId(input.botId),
    channelId: input.channelId,
    createdAt: now,
    fields: input.fields.map((field) => ({ id: field.id, label: field.label.slice(0, 100), value: field.value.slice(0, 1500) })),
    guildId: input.guildId,
    imageUrl: input.imageUrl.slice(0, 2048),
    itemId: input.itemId ?? null,
    quantity: typeof input.quantity === "number" && Number.isFinite(input.quantity) ? input.quantity : null,
    updatedAt: now,
    userId: input.userId
  };
  const { fivemGoalEntries } = await getMongoCollections();
  await fivemGoalEntries.insertOne(doc);
  return toEntryDto(doc);
}

export async function listFivemGoalEntries(guildId: string, botId?: string | null, userId?: string | null) {
  const { fivemGoalEntries } = await getMongoCollections();
  const rows = await fivemGoalEntries
    .find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(userId ? { userId } : {}) })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return rows.map(toEntryDto);
}

function normalizeSettings(settings: FivemGoalSettingsDto): FivemGoalSettingsDto {
  return {
    ...settings,
    categoryId: normalizeSnowflake(settings.categoryId),
    channelNameTemplate: normalizeText(settings.channelNameTemplate, 80) || "📈・{username}",
    fields: normalizeFields(settings.fields),
    items: normalizeItems(settings.items),
    logChannelId: normalizeSnowflake(settings.logChannelId),
    managerRoleId: normalizeSnowflake(settings.managerRoleId),
    viewRoleId: normalizeSnowflake(settings.viewRoleId)
  };
}

function normalizeFields(fields: FivemGoalFieldDto[]) {
  const normalized = (Array.isArray(fields) ? fields : []).map((field, index) => {
    const label = normalizeText(field.label, 80) || `Campo ${index + 1}`;
    return {
      id: normalizeText(field.id, 80) || slug(label) || `campo-${index + 1}`,
      label,
      maxLength: clamp(field.maxLength, 1, 1500),
      minLength: clamp(field.minLength, 0, 1500),
      placeholder: normalizeText(field.placeholder, 100),
      required: field.required !== false,
      style: field.style === "paragraph" ? "paragraph" as const : "short" as const
    };
  }).slice(0, 5);
  return normalized.length ? normalized : DEFAULT_FIELDS.map((field) => ({ ...field }));
}

function normalizeItems(items: FivemGoalItemDto[]) {
  const normalized = (Array.isArray(items) ? items : []).map((item, index) => {
    const name = normalizeText(item.name, 80) || `Item ${index + 1}`;
    return {
      category: normalizeText(item.category, 80),
      color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color : null,
      emoji: normalizeText(item.emoji, 80),
      enabled: item.enabled !== false,
      id: normalizeText(item.id, 80) || slug(name) || `item-${index + 1}`,
      name,
      order: Number.isFinite(item.order) ? Math.trunc(item.order) : index + 1
    };
  }).slice(0, 100);
  return normalized.length ? normalized : DEFAULT_ITEMS.map((item) => ({ ...item }));
}

function toSettingsDto(settings: MongoFivemGoalSettings): FivemGoalSettingsDto {
  return normalizeSettings({
    botId: normalizeBotId(settings.botId),
    categoryId: settings.categoryId,
    channelNameTemplate: settings.channelNameTemplate,
    enabled: settings.enabled === true,
    fields: settings.fields as FivemGoalFieldDto[],
    guildId: settings.guildId,
    items: settings.items as FivemGoalItemDto[],
    logChannelId: settings.logChannelId,
    managerRoleId: settings.managerRoleId,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    viewRoleId: settings.viewRoleId
  });
}

function toUserChannelDto(row: MongoFivemGoalUserChannel): FivemGoalUserChannelDto {
  return { botId: normalizeBotId(row.botId), channelId: row.channelId, createdAt: row.createdAt.toISOString(), guildId: row.guildId, updatedAt: row.updatedAt.toISOString(), userId: row.userId };
}

function toEntryDto(row: MongoFivemGoalEntry): FivemGoalEntryDto {
  return { botId: normalizeBotId(row.botId), channelId: row.channelId, createdAt: row.createdAt.toISOString(), fields: row.fields, guildId: row.guildId, id: row._id, imageUrl: row.imageUrl, itemId: row.itemId, quantity: row.quantity, updatedAt: row.updatedAt.toISOString(), userId: row.userId };
}

function scopeQuery(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}

function clamp(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
