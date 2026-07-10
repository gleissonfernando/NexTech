import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoFivemHierarchyEntry, type MongoFivemHierarchyLog, type MongoFivemHierarchyPanel } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom, emitRealtimeToRoomWithAck } from "../realtime/events";

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
  contentHash: string | null;
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
  panelVersion: number;
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

type FivemHierarchyPublishAck = {
  error?: string;
  messageId?: string | null;
  ok: boolean;
  panelId?: string;
};

export async function getFivemHierarchyDashboard(guildId: string, botId?: string | null) {
  return {
    logs: await listFivemHierarchyLogs(guildId, botId),
    panels: await listFivemHierarchyPanels(guildId, botId)
  };
}

export async function listFivemHierarchyPanels(guildId: string, botId?: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  await migrateFivemHierarchyPanelState(guildId, normalizeBotId(botId));
  const rows = await fivemHierarchyPanels.find(scopeQuery(guildId, normalizeBotId(botId))).sort({ createdAt: -1 }).limit(50).toArray();
  return rows.map(toPanelDto);
}

export async function listActiveFivemHierarchyPanels(botId: string) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  await migrateFivemHierarchyPanelState(null, botId);
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
  const nextPanelChannelId = normalizeSnowflake(input.panelChannelId ?? current?.panelChannelId);
  const channelChanged = Boolean(current && input.panelChannelId !== undefined && (current.panelChannelId ?? null) !== nextPanelChannelId);
  const next: MongoFivemHierarchyPanel = {
    ...normalizePanelInput(mergedInput, guildId, normalizedBotId),
    _id: panelId,
    botId: normalizedBotId,
    contentHash: channelChanged ? null : current?.contentHash ?? null,
    createdAt: current?.createdAt ?? now,
    guildId,
    panelMessageId: channelChanged ? null : normalizeSnowflake(input.panelMessageId ?? current?.panelMessageId),
    panelVersion: 2,
    updateLock: null,
    updatedAt: now,
    updatedBy: actorId
  };
  const { fivemHierarchyPanels } = await getMongoCollections();
  await ensureGuild(guildId);
  await fivemHierarchyPanels.updateOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) }, { $set: next }, { upsert: true });
  await writeFivemHierarchyLog({ action: current ? "panel.updated" : "panel.created", botId: normalizedBotId, details: { title: next.title }, guildId, panelId, userId: actorId });
  const dto = toPanelDto(next);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, current ? "panel.updated" : "panel.created", dto);
  if (normalizedBotId) {
    emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:hierarchy:panel_update", {
      action: "update",
      botId: normalizedBotId,
      guildId,
      oldPanelChannelId: channelChanged ? current?.panelChannelId ?? null : null,
      oldPanelMessageId: channelChanged ? current?.panelMessageId ?? null : null,
      panelId
    });
  }
  return dto;
}

export async function deleteFivemHierarchyPanel(guildId: string, botId: string | null, panelId: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  await fivemHierarchyPanels.deleteOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) });
  await writeFivemHierarchyLog({ action: "panel.deleted", botId: normalizedBotId, details: { title: current.title }, guildId, panelId, userId: actorId });
  const dto = toPanelDto(current);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, "panel.deleted", dto);
  if (normalizedBotId) {
    emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:hierarchy:panel_update", {
      action: "delete",
      botId: normalizedBotId,
      guildId,
      oldPanelChannelId: current.panelChannelId ?? null,
      oldPanelMessageId: current.panelMessageId ?? null,
      panelId
    });
  }
  return dto;
}

export async function requestFivemHierarchyPanelPublish(guildId: string, botId: string, panelId: string, actorId: string | null) {
  const panel = await getFivemHierarchyPanel(guildId, panelId, botId);
  if (!panel) throw createPublishError("Painel de hierarquia nao encontrado.", 404);
  if (!panel.enabled) throw createPublishError("Ative o painel de hierarquia antes de publicar.", 400);
  if (!panel.panelChannelId) throw createPublishError("Configure o canal do painel de hierarquia.", 400);
  await writeFivemHierarchyLog({ action: "panel.publish_requested", botId, details: { channelId: panel.panelChannelId }, guildId, panelId, userId: actorId });
  const responses = await emitRealtimeToRoomWithAck<
    { action: "publish"; botId: string; guildId: string; panelId: string },
    FivemHierarchyPublishAck
  >(devBotRealtimeRoom(botId), "fivem:hierarchy:panel_update", { action: "publish", botId, guildId, panelId }, 20_000);
  const success = responses.find((response) => response?.ok);
  if (success) {
    await writeFivemHierarchyLog({ action: "panel.published", botId, details: { channelId: panel.panelChannelId, messageId: success.messageId ?? null }, guildId, panelId, userId: actorId });
    return await getFivemHierarchyPanel(guildId, panelId, botId) ?? panel;
  }

  const error = responses.find((response) => response?.error)?.error;
  throw createPublishError(error ?? "O bot nao respondeu a solicitacao de publicacao. Confira se o bot DEV esta online e conectado ao backend.", 409);
}

export async function updateFivemHierarchyPanelState(guildId: string, botId: string | null, panelId: string, input: { contentHash?: string | null; messageId?: string | null; panelVersion?: number }) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const normalizedBotId = normalizeBotId(botId);
  const normalizedMessageId = normalizeSnowflake(input.messageId);
  const normalizedHash = normalizeContentHash(input.contentHash);
  const panelVersion = input.panelVersion === 2 ? 2 : 2;
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) });
  if (!current) return null;
  if ((current.panelMessageId ?? null) === normalizedMessageId
    && (current.contentHash ?? null) === normalizedHash
    && (current.panelVersion ?? 1) === panelVersion) {
    return toPanelDto(current);
  }
  const row = await fivemHierarchyPanels.findOneAndUpdate(
    { _id: panelId, ...scopeQuery(guildId, normalizedBotId) },
    { $set: { contentHash: normalizedHash, panelMessageId: normalizedMessageId, panelVersion, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!row) return null;
  const dto = toPanelDto(row);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, "panel.state_updated", dto);
  return dto;
}

export async function acquireFivemHierarchyPanelLock(guildId: string, botId: string | null, panelId: string, instanceId: string, ttlMs: number) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(5_000, Math.min(ttlMs, 120_000)));
  const row = await fivemHierarchyPanels.findOneAndUpdate(
    {
      _id: panelId,
      ...scopeQuery(guildId, normalizeBotId(botId)),
      $or: [
        { updateLock: null },
        { updateLock: { $exists: false } },
        { "updateLock.expiresAt": { $lte: now } },
        { "updateLock.instanceId": instanceId }
      ]
    },
    { $set: { updateLock: { expiresAt, instanceId } } },
    { returnDocument: "after" }
  );
  return Boolean(row);
}

export async function releaseFivemHierarchyPanelLock(guildId: string, botId: string | null, panelId: string, instanceId: string) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  await fivemHierarchyPanels.updateOne(
    { _id: panelId, ...scopeQuery(guildId, normalizeBotId(botId)), "updateLock.instanceId": instanceId },
    { $set: { updateLock: null } }
  );
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

function normalizePanelInput(input: Partial<FivemHierarchyPanelDto>, guildId: string, botId: string | null): Omit<MongoFivemHierarchyPanel, "_id" | "contentHash" | "createdAt" | "guildId" | "panelMessageId" | "panelVersion" | "updateLock" | "updatedAt" | "updatedBy"> {
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
    .filter((item, _index, items) => items.findIndex((candidate) => candidate.roleId === item.roleId) === _index)
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
    contentHash: row.contentHash ?? null,
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
    panelVersion: row.panelVersion === 2 ? 2 : 1,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? null
  };
}

function toLogDto(row: MongoFivemHierarchyLog): FivemHierarchyLogDto {
  return { action: row.action, botId: normalizeBotId(row.botId), createdAt: row.createdAt.toISOString(), details: row.details ?? {}, guildId: row.guildId, id: row._id, panelId: row.panelId ?? null, userId: row.userId ?? null };
}

function emitFivemHierarchyPanelUpdated(guildId: string, botId: string | null, action: string, panel: FivemHierarchyPanelDto) {
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:hierarchy:updated", {
    action,
    botId,
    guildId,
    panel,
    panelId: panel.id
  });
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

function normalizeContentHash(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeRoleIds(values: string[]) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeSnowflake).filter((value): value is string => Boolean(value)))].slice(0, 100);
}

async function migrateFivemHierarchyPanelState(guildId: string | null, botId: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  await fivemHierarchyPanels.updateMany(
    {
      ...(guildId ? { guildId } : {}),
      ...(botId ? { botId } : {}),
      $or: [
        { panelVersion: { $ne: 2 } },
        { contentHash: { $exists: false } },
        { updateLock: { $exists: false } }
      ]
    },
    {
      $set: { contentHash: null, panelVersion: 2, updateLock: null }
    }
  );
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
