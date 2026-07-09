import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoFivemHierarchyEntry, type MongoFivemHierarchyLog, type MongoFivemHierarchyPanel } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const FIVEM_HIERARCHY_MODULE_ID = "fivem-hierarchy";

export type FivemHierarchyEntryDto = {
  active: boolean;
  color: string | null;
  description: string | null;
  emoji: string | null;
  id: string;
  limit: number | null;
  name: string;
  order: number;
  roleId: string;
};

export type FivemHierarchyPanelDto = {
  allowedRoleIds: string[];
  botId: string | null;
  color: string;
  createdAt: string;
  description: string | null;
  enabled: boolean;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string | null;
  guildId: string;
  hierarchies: FivemHierarchyEntryDto[];
  id: string;
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  linkedToFivem: boolean;
  logChannelId: string | null;
  name: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  title: string;
  updatedAt: string;
  updatedBy?: string | null;
};

export type FivemHierarchyLogDto = {
  action: string;
  botId: string | null;
  createdAt: string;
  details: Record<string, unknown>;
  guildId: string;
  id: string;
  panelId: string | null;
  userId: string | null;
};

export async function getFivemHierarchyDashboard(guildId: string, botId?: string | null) {
  return {
    logs: await listFivemHierarchyLogs(guildId, botId),
    panels: await listFivemHierarchyPanels(guildId, botId)
  };
}

export async function listFivemHierarchyPanels(guildId: string, botId?: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const rows = await fivemHierarchyPanels.find(scopeQuery(guildId, normalizeBotId(botId))).sort({ createdAt: -1 }).limit(50).toArray();
  return rows.map(toPanelDto);
}

export async function listActiveFivemHierarchyPanels(botId: string) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const rows = await fivemHierarchyPanels.find({ botId, enabled: true }).sort({ updatedAt: -1 }).toArray();
  return rows.map(toPanelDto);
}

export async function getFivemHierarchyPanel(guildId: string, panelId: string, botId?: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const row = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizeBotId(botId)) });
  return row ? toPanelDto(row) : null;
}

export async function saveFivemHierarchyPanel(guildId: string, botId: string | null, input: Partial<FivemHierarchyPanelDto>, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();
  const current = input.id ? await getRawPanel(guildId, input.id, normalizedBotId) : null;
  const panelId = current?._id ?? randomUUID();
  const mergedInput = current ? { ...toPanelDto(current), ...input } : input;
  const next: MongoFivemHierarchyPanel = {
    ...normalizePanelInput(mergedInput, guildId, normalizedBotId),
    _id: panelId,
    botId: normalizedBotId,
    createdAt: current?.createdAt ?? now,
    guildId,
    panelMessageId: normalizeSnowflake(input.panelMessageId ?? current?.panelMessageId),
    updatedAt: now,
    updatedBy: actorId
  };
  const { fivemHierarchyPanels } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemHierarchyPanels.updateOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) }, { $set: next }, { upsert: true });
  await writeFivemHierarchyLog({ action: current ? "panel.updated" : "panel.created", botId: normalizedBotId, details: { title: next.title }, guildId, panelId, userId: actorId });
  emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId ?? ""), "fivem:hierarchy:panel_update", { action: "update", botId: normalizedBotId, guildId, panelId });
  return toPanelDto(next);
}

export async function deleteFivemHierarchyPanel(guildId: string, botId: string | null, panelId: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  await fivemHierarchyPanels.deleteOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) });
  await writeFivemHierarchyLog({ action: "panel.deleted", botId: normalizedBotId, details: { title: current.title }, guildId, panelId, userId: actorId });
  return toPanelDto(current);
}

export async function requestFivemHierarchyPanelPublish(guildId: string, botId: string, panelId: string, actorId: string | null) {
  const panel = await getFivemHierarchyPanel(guildId, panelId, botId);
  if (!panel) throw createPublishError("Painel de hierarquia nao encontrado.", 404);
  if (!panel.enabled) throw createPublishError("Ative o painel de hierarquia antes de publicar.", 400);
  if (!panel.panelChannelId) throw createPublishError("Configure o canal do painel de hierarquia.", 400);
  await writeFivemHierarchyLog({ action: "panel.publish_requested", botId, details: { channelId: panel.panelChannelId }, guildId, panelId, userId: actorId });
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "fivem:hierarchy:panel_update", { action: "publish", botId, guildId, panelId });
  return panel;
}

export async function updateFivemHierarchyPanelState(guildId: string, botId: string | null, panelId: string, messageId: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const row = await fivemHierarchyPanels.findOneAndUpdate(
    { _id: panelId, ...scopeQuery(guildId, normalizeBotId(botId)) },
    { $set: { panelMessageId: normalizeSnowflake(messageId), updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  return row ? toPanelDto(row) : null;
}

export async function listFivemHierarchyLogs(guildId: string, botId?: string | null, panelId?: string | null) {
  const { fivemHierarchyLogs } = await getMongoCollections();
  const rows = await fivemHierarchyLogs.find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(panelId ? { panelId } : {}) }).sort({ createdAt: -1 }).limit(200).toArray();
  return rows.map(toLogDto);
}

async function getRawPanel(guildId: string, panelId: string, botId: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  return fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, botId) });
}

function normalizePanelInput(input: Partial<FivemHierarchyPanelDto>, guildId: string, botId: string | null): Omit<MongoFivemHierarchyPanel, "_id" | "createdAt" | "guildId" | "panelMessageId" | "updatedAt" | "updatedBy"> {
  return {
    allowedRoleIds: normalizeRoleIds(input.allowedRoleIds ?? []),
    botId,
    color: /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color ?? "#22c55e" : "#22c55e",
    description: normalizeText(input.description, 1200) ?? "Hierarquia atualizada automaticamente pelos cargos do servidor.",
    enabled: input.enabled === true,
    footerEnabled: input.footerEnabled !== false,
    footerIconUrl: normalizeText(input.footerIconUrl, 2048),
    footerText: normalizeText(input.footerText, 200),
    hierarchies: normalizeHierarchies(input.hierarchies ?? []),
    imagePosition: input.imagePosition === "top" || input.imagePosition === "bottom" || input.imagePosition === "thumbnail" ? input.imagePosition : "none",
    imageUrl: normalizeText(input.imageUrl, 2048),
    linkedToFivem: input.linkedToFivem !== false,
    logChannelId: normalizeSnowflake(input.logChannelId),
    name: normalizeText(input.name, 100) ?? "Hierarquia FAQ",
    panelChannelId: normalizeSnowflake(input.panelChannelId),
    title: normalizeText(input.title, 120) ?? "Hierarquia Policial"
  };
}

function normalizeHierarchies(values: Array<Partial<FivemHierarchyEntryDto> | MongoFivemHierarchyEntry>) {
  return (Array.isArray(values) ? values : [])
    .map((item, index) => ({
      active: item.active !== false,
      color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color ?? null : null,
      description: normalizeText(item.description, 300),
      emoji: normalizeText(item.emoji, 40),
      id: normalizeText(item.id, 80) ?? randomUUID(),
      limit: typeof item.limit === "number" && Number.isFinite(item.limit) ? Math.max(1, Math.min(100, Math.trunc(item.limit))) : null,
      name: normalizeText(item.name, 80) ?? `Hierarquia ${index + 1}`,
      order: typeof item.order === "number" && Number.isFinite(item.order) ? Math.trunc(item.order) : index + 1,
      roleId: normalizeSnowflake(item.roleId) ?? ""
    }))
    .filter((item) => item.roleId)
    .sort((a, b) => a.order - b.order)
    .slice(0, 50);
}

async function writeFivemHierarchyLog(input: Omit<MongoFivemHierarchyLog, "_id" | "createdAt">) {
  const { fivemHierarchyLogs } = await getMongoCollections();
  await fivemHierarchyLogs.insertOne({ _id: randomUUID(), createdAt: new Date(), ...input });
}

function toPanelDto(row: MongoFivemHierarchyPanel): FivemHierarchyPanelDto {
  return {
    allowedRoleIds: row.allowedRoleIds ?? [],
    botId: normalizeBotId(row.botId),
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    description: row.description ?? null,
    enabled: row.enabled === true,
    footerEnabled: row.footerEnabled !== false,
    footerIconUrl: row.footerIconUrl ?? null,
    footerText: row.footerText ?? null,
    guildId: row.guildId,
    hierarchies: (row.hierarchies ?? []).map((item) => ({ ...item })),
    id: row._id,
    imagePosition: row.imagePosition ?? "none",
    imageUrl: row.imageUrl ?? null,
    linkedToFivem: row.linkedToFivem !== false,
    logChannelId: row.logChannelId ?? null,
    name: row.name,
    panelChannelId: row.panelChannelId ?? null,
    panelMessageId: row.panelMessageId ?? null,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? null
  };
}

function toLogDto(row: MongoFivemHierarchyLog): FivemHierarchyLogDto {
  return { action: row.action, botId: normalizeBotId(row.botId), createdAt: row.createdAt.toISOString(), details: row.details ?? {}, guildId: row.guildId, id: row._id, panelId: row.panelId ?? null, userId: row.userId ?? null };
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

function normalizeRoleIds(values: string[]) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))].slice(0, 100);
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}

function createPublishError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}
