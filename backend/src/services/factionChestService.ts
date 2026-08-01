import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoFactionChestItem,
  type MongoFactionChestLog,
  type MongoFactionChestSettings
} from "../database/mongo";
import { dashboardLogRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const FACTION_CHEST_MODULE_ID = "faction-chest";

export type FactionChestSettingsInput = Partial<Pick<MongoFactionChestSettings,
  "enabled" | "categoryId" | "panelChannelId" | "logChannelId" | "auditChannelId" |
  "registerRoleIds" | "auditRoleIds" | "viewRoleIds" | "adminRoleIds" |
  "systemName" | "panelImageUrl" | "color" | "lastPanelRequestedAt"
>>;

export type FactionChestItemInput = Partial<Pick<MongoFactionChestItem,
  "name" | "quantity" | "category" | "description" | "imageUrl" | "aliases" | "active" | "minimumQuantity"
>>;

export type FactionChestMovementInput = {
  action: "add" | "remove";
  actorId: string;
  actorName: string;
  bauId?: string | null;
  channelId?: string | null;
  item: string;
  items?: string | null;
  messageId?: string | null;
  quantity?: number;
  reason?: string | null;
};

export async function getFactionChestDashboard(botId: string, guildId: string) {
  const { factionChestItems, factionChestLogs } = await getMongoCollections();
  const [settings, items, logs] = await Promise.all([
    getFactionChestSettings(botId, guildId),
    factionChestItems.find({ botId, guildId }).sort({ category: 1, name: 1 }).limit(1000).toArray(),
    factionChestLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);

  return {
    items: items.map(itemDto),
    logs: logs.map(logDto),
    settings: settingsDto(settings),
    summary: {
      itemCount: items.length,
      totalQuantity: items.reduce((total, item) => total + item.quantity, 0)
    }
  };
}

export async function getFactionChestSettings(botId: string, guildId: string) {
  const { factionChestSettings } = await getMongoCollections();
  const existing = await factionChestSettings.findOne({ botId, guildId });
  if (existing) return existing;

  const now = new Date();
  const settings: MongoFactionChestSettings = {
    _id: randomUUID(),
    adminRoleIds: [],
    auditChannelId: null,
    auditRoleIds: [],
    botId,
    categoryId: null,
    color: "#22c55e",
    createdAt: now,
    enabled: false,
    guildId,
    lastPanelRequestedAt: null,
    logChannelId: null,
    panelChannelId: null,
    panelImageUrl: null,
    panelMessageId: null,
    registerRoleIds: [],
    systemName: "VINHEDO",
    updatedAt: now,
    updatedBy: null,
    viewRoleIds: []
  };

  await factionChestSettings.updateOne({ botId, guildId }, { $setOnInsert: settings }, { upsert: true });
  return (await factionChestSettings.findOne({ botId, guildId })) ?? settings;
}

export async function saveFactionChestSettings(botId: string, guildId: string, input: FactionChestSettingsInput, actorId: string | null) {
  const current = await getFactionChestSettings(botId, guildId);
  const { factionChestSettings } = await getMongoCollections();
  const now = new Date();
  const patch = normalizeSettingsInput(input);
  const shouldRefreshPanel = current.enabled && Boolean(current.panelMessageId);

  await factionChestSettings.updateOne(
    { botId, guildId },
    {
      $set: {
        ...patch,
        ...(shouldRefreshPanel ? { lastPanelRequestedAt: now } : {}),
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  const saved = (await factionChestSettings.findOne({ botId, guildId }))!;
  emitFactionChestUpdated(botId, guildId, "settings");
  return settingsDto(saved);
}

export async function requestFactionChestPanel(botId: string, guildId: string, actorId: string) {
  return saveFactionChestSettings(botId, guildId, { enabled: true, lastPanelRequestedAt: new Date() }, actorId);
}

export async function updateFactionChestPanelState(botId: string, guildId: string, panelMessageId: string | null) {
  return saveFactionChestSettings(botId, guildId, { panelMessageId } as FactionChestSettingsInput, null);
}

export async function listActiveFactionChestSettings(botId: string) {
  const { factionChestSettings } = await getMongoCollections();
  return (await factionChestSettings.find({ botId, enabled: true }).toArray()).map(settingsDto);
}

export async function saveFactionChestItem(botId: string, guildId: string, itemId: string | null, input: FactionChestItemInput, actorId: string) {
  const { factionChestItems } = await getMongoCollections();
  const now = new Date();
  const id = itemId ?? randomUUID();
  const name = input.name?.trim();
  const normalizedName = name ? normalizeItemName(name) : undefined;
  const patch: Partial<MongoFactionChestItem> = { updatedAt: now, updatedBy: actorId };

  if (name) {
    const duplicate = await factionChestItems.findOne({ _id: { $ne: id }, botId, guildId, normalizedName });
    if (duplicate) throw serviceError("Já existe um item com esse nome neste baú.", 409);
    patch.name = name;
    patch.normalizedName = normalizedName!;
  }

  if (Array.isArray(input.aliases)) {
    const aliases = [...new Set(input.aliases.map((alias) => normalizeDisplayText(alias, 80)).filter(Boolean))].slice(0, 50);
    patch.aliases = aliases;
    patch.normalizedAliases = aliases.map(normalizeItemName);
  }
  if (typeof input.active === "boolean") patch.active = input.active;
  if (typeof input.minimumQuantity === "number") {
    if (!Number.isInteger(input.minimumQuantity) || input.minimumQuantity < 0) throw serviceError("Quantidade mínima inválida.", 400);
    patch.minimumQuantity = input.minimumQuantity;
  }
  if (typeof input.quantity === "number") {
    if (!Number.isInteger(input.quantity) || input.quantity < 0) throw serviceError("Quantidade inválida.", 400);
    patch.quantity = input.quantity;
  }
  if (typeof input.category === "string") patch.category = input.category.trim() || "Geral";
  if ("description" in input) patch.description = input.description?.trim() || null;
  if ("imageUrl" in input) patch.imageUrl = input.imageUrl?.trim() || null;

  const insertDefaults: Partial<MongoFactionChestItem> = {
    _id: id,
    botId,
    category: input.category?.trim() || "Geral",
    createdAt: now,
    createdBy: actorId,
    description: input.description?.trim() || null,
    guildId,
    imageUrl: input.imageUrl?.trim() || null,
    name: name || "Novo item",
    normalizedName: normalizedName ?? normalizeItemName("Novo item"),
    aliases: Array.isArray(input.aliases) ? [...new Set(input.aliases.map((alias) => normalizeDisplayText(alias, 80)).filter(Boolean))].slice(0, 50) : [],
    normalizedAliases: Array.isArray(input.aliases) ? [...new Set(input.aliases.map((alias) => normalizeDisplayText(alias, 80)).filter(Boolean))].slice(0, 50).map(normalizeItemName) : [],
    active: input.active ?? true,
    minimumQuantity: input.minimumQuantity ?? 0,
    quantity: input.quantity ?? 0
  };
  for (const key of Object.keys(patch) as Array<keyof MongoFactionChestItem>) {
    delete insertDefaults[key];
  }

  await factionChestItems.updateOne(
    { _id: id, botId, guildId },
    {
      $set: patch,
      $setOnInsert: insertDefaults
    },
    { upsert: true }
  );

  const saved = (await factionChestItems.findOne({ _id: id, botId, guildId }))!;
  emitFactionChestUpdated(botId, guildId, "item");
  return itemDto(saved);
}

export async function recordFactionChestMovement(botId: string, guildId: string, input: FactionChestMovementInput) {
  const { factionChestItems, factionChestLogs } = await getMongoCollections();
  const parsed = parseMovementItems(input.items ?? (input.quantity ? `${input.item} x${input.quantity}` : input.item));
  if (!parsed.length) throw serviceError("Informe os itens no formato Nome do item xQuantidade.", 400);

  const allItems = await factionChestItems.find({ botId, guildId }).toArray();
  const matched = parsed.map((entry) => {
    const normalized = normalizeItemName(entry.name);
    const item = allItems.find((candidate) => {
      if (candidate.active === false) return false;
      return candidate.normalizedName === normalized || (candidate.normalizedAliases ?? []).includes(normalized);
    });
    if (!item) throw serviceError(`Item não cadastrado. Chame a gerência para caso de dúvidas.\nItem: ${entry.name}`, 404);
    return { ...entry, item };
  });

  const now = new Date();
  const operationCode = await nextOperationCode(botId, guildId);
  const results: Array<{ item: MongoFactionChestItem; log: MongoFactionChestLog }> = [];

  for (const entry of matched) {
    const previousQuantity = entry.item.quantity;
    const nextQuantity = input.action === "add" ? previousQuantity + entry.quantity : previousQuantity - entry.quantity;
    if (nextQuantity < 0) {
      throw serviceError(`Estoque insuficiente para realizar esta retirada.\nItem: ${entry.item.name}\nDisponível: ${previousQuantity}\nSolicitado: ${entry.quantity}`, 409);
    }
    const updated = await factionChestItems.findOneAndUpdate(
      { _id: entry.item._id, botId, guildId, quantity: previousQuantity },
      { $set: { quantity: nextQuantity, updatedAt: now, updatedBy: input.actorId } },
      { returnDocument: "after" }
    );
    if (!updated) throw serviceError("O item foi alterado ao mesmo tempo. Tente novamente.", 409);

    const log: MongoFactionChestLog = {
      _id: randomUUID(),
      action: input.action,
      actorId: input.actorId,
      actorName: normalizeDisplayText(input.actorName, 100) || input.actorId,
      bauId: input.bauId ?? null,
      botId,
      channelId: input.channelId ?? null,
      createdAt: now,
      guildId,
      itemId: updated._id,
      itemName: updated.name,
      messageId: input.messageId ?? null,
      metadata: { totalItems: matched.length },
      nextQuantity,
      operationCode,
      previousQuantity,
      quantity: entry.quantity,
      reason: normalizeDisplayText(input.reason ?? "", 500) || null
    };
    await factionChestLogs.insertOne(log);
    results.push({ item: updated, log });
  }

  emitFactionChestUpdated(botId, guildId, "movement");
  return {
    item: results[0] ? itemDto(results[0].item) : null,
    items: results.map((result) => itemDto(result.item)),
    log: results[0] ? logDto(results[0].log) : null,
    logs: results.map((result) => logDto(result.log)),
    operationCode
  };
}

function normalizeSettingsInput(input: FactionChestSettingsInput): FactionChestSettingsInput {
  const patch = { ...input };
  if ("systemName" in patch) patch.systemName = normalizeDisplayText(patch.systemName ?? "", 80) || "VINHEDO";
  if ("panelImageUrl" in patch) patch.panelImageUrl = patch.panelImageUrl?.trim() || null;
  for (const key of ["registerRoleIds", "auditRoleIds", "viewRoleIds", "adminRoleIds"] as const) {
    if (Array.isArray(patch[key])) patch[key] = [...new Set(patch[key]!.filter(Boolean))].slice(0, 50);
  }
  return patch;
}

function settingsDto(value: MongoFactionChestSettings) {
  return {
    ...value,
    id: value._id,
    createdAt: value.createdAt.toISOString(),
    lastPanelRequestedAt: value.lastPanelRequestedAt?.toISOString() ?? null,
    updatedAt: value.updatedAt.toISOString()
  };
}

function itemDto(value: MongoFactionChestItem) {
  return { ...value, id: value._id, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
}

function logDto(value: MongoFactionChestLog) {
  return { ...value, id: value._id, createdAt: value.createdAt.toISOString() };
}

function normalizeItemName(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function normalizeDisplayText(value: string, maxLength: number) {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().slice(0, maxLength);
}

function emitFactionChestUpdated(botId: string, guildId: string, scope: "settings" | "item" | "movement") {
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "faction-chest:updated", { botId, guildId, scope });
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function parseMovementItems(value: string) {
  const normalized = normalizeDisplayText(value, 4000);
  const lines = normalized.includes("\n") ? normalized.split(/\r?\n/) : splitInlineItems(normalized);
  const merged = new Map<string, { name: string; quantity: number }>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(.+?)(?:\s*[xX]\s*|\s+)(\d+)$/);
    if (!match) throw serviceError(`Formato não reconhecido: ${line}`, 400);
    const name = normalizeDisplayText(match[1] ?? "", 80);
    const quantity = Number.parseInt(match[2] ?? "", 10);
    if (!name) throw serviceError("Item sem nome.", 400);
    if (!Number.isInteger(quantity) || quantity <= 0) throw serviceError(`Quantidade inválida para ${name}.`, 400);
    const key = normalizeItemName(name);
    const current = merged.get(key);
    merged.set(key, { name: current?.name ?? name, quantity: (current?.quantity ?? 0) + quantity });
  }
  return [...merged.values()];
}

function splitInlineItems(value: string) {
  const matches = [...value.matchAll(/(.+?)(?:\s*[xX]\s*|\s+)(\d+)(?=\s+\S.+?(?:\s*[xX]\s*|\s+)\d+|$)/g)];
  return matches.length ? matches.map((match) => `${match[1]?.trim()} x${match[2]}`) : [value];
}

async function nextOperationCode(botId: string, guildId: string) {
  const { factionChestLogs } = await getMongoCollections();
  const count = await factionChestLogs.countDocuments({ botId, guildId, operationCode: { $type: "string" } });
  return `#BAU-${String(count + 1).padStart(6, "0")}`;
}
