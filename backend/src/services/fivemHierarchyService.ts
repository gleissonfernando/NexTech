import { createHash, randomUUID } from "node:crypto";
import {
  ensureGuild,
  getMongoCollections,
  type MongoFivemHierarchyEntry,
  type MongoFivemHierarchyLog,
  type MongoFivemHierarchyPanel,
  type MongoFivemHierarchyPendingCleanup
} from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom, emitRealtimeToRoomWithAck } from "../realtime/events";
import { hierarchyDedupeFingerprint, sameHierarchyConfig } from "./fivemHierarchyState";

export const FIVEM_HIERARCHY_MODULE_ID = "fivem-hierarchy";
export const FIVEM_HIERARCHY_PROTOCOL = "hierarchy-v2";

const FIVEM_HIERARCHY_PANEL_VERSION = 2;
const FIVEM_HIERARCHY_MIGRATION_VERSION = 1;
const hierarchyMigrationRuns = new Map<string, Promise<void>>();

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
  roleName?: string | null;
};

export type FivemHierarchyPanelConfigInput = {
  allowedRoleIds?: string[];
  color?: string;
  configRevision?: number;
  description?: string | null;
  enabled?: boolean;
  footerEnabled?: boolean;
  footerIconUrl?: string | null;
  footerText?: string | null;
  hierarchies?: Array<Partial<FivemHierarchyEntryDto>>;
  imagePosition?: "top" | "bottom" | "thumbnail" | "none";
  imageUrl?: string | null;
  linkedToFivem?: boolean;
  logChannelId?: string | null;
  managerUserIds?: string[];
  managerRoleIds?: string[];
  commandUserIds?: string[];
  commandRoleIds?: string[];
  name?: string;
  panelChannelId?: string | null;
  title?: string;
  status?: "draft" | "completed" | "published" | "disabled";
};

export type FivemHierarchyPanelDto = {
  allowedRoleIds: string[];
  botId: string | null;
  color: string;
  configRevision: number;
  contentHash: string | null;
  createdAt: string;
  createdBy: string | null;
  deletedAt: string | null;
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
  managerUserIds: string[];
  managerRoleIds: string[];
  commandUserIds: string[];
  commandRoleIds: string[];
  name: string;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelVersion: number;
  publishedAt: string | null;
  status: "draft" | "completed" | "published" | "disabled";
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

export type FivemHierarchyCleanupTaskDto = {
  botId: string | null;
  deletedAt: string | null;
  description: string | null;
  guildId: string;
  legacyCleanupPending: boolean;
  officialChannelId: string | null;
  officialMessageId: string | null;
  panelId: string;
  pendingCleanup: Array<{
    channelId: string;
    cleanupId: string;
    createdAt: string;
    messageId: string;
    reason: MongoFivemHierarchyPendingCleanup["reason"];
  }>;
  title: string;
};

type NormalizedPanelConfig = {
  allowedRoleIds: string[];
  color: string;
  description: string | null;
  enabled: boolean;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string | null;
  hierarchies: MongoFivemHierarchyEntry[];
  imagePosition: "top" | "bottom" | "thumbnail" | "none";
  imageUrl: string | null;
  linkedToFivem: boolean;
  logChannelId: string | null;
  managerUserIds: string[];
  managerRoleIds: string[];
  commandUserIds: string[];
  commandRoleIds: string[];
  name: string;
  panelChannelId: string | null;
  title: string;
  status: "draft" | "completed" | "published" | "disabled";
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
  const normalizedBotId = normalizeBotId(botId);
  await ensureFivemHierarchyMigration(guildId, normalizedBotId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const rows = await fivemHierarchyPanels
    .find({ ...scopeQuery(guildId, normalizedBotId), deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return rows.map(toPanelDto);
}

export async function listActiveFivemHierarchyPanels(botId: string) {
  await ensureFivemHierarchyMigration(null, botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const rows = await fivemHierarchyPanels.find({ botId, deletedAt: null, enabled: true }).sort({ updatedAt: -1 }).toArray();
  return rows.map(toPanelDto);
}

export async function listManageableFivemHierarchyPanels(guildId: string, botId: string, actorId: string, actorRoleIds: string[], isGuildManager = false) {
  const panels = await listFivemHierarchyPanels(guildId, botId);
  return panels.filter((panel) => canManageFivemHierarchyPanel(panel, actorId, actorRoleIds, isGuildManager));
}

export function canManageFivemHierarchyPanel(panel: FivemHierarchyPanelDto, actorId: string, actorRoleIds: string[], isGuildManager = false) {
  if (isGuildManager) return true;
  if (panel.createdBy === actorId || panel.managerUserIds.includes(actorId) || panel.commandUserIds.includes(actorId)) return true;
  const roles = new Set(actorRoleIds);
  return [...panel.managerRoleIds, ...panel.commandRoleIds, ...panel.allowedRoleIds].some((roleId) => roles.has(roleId));
}

export async function assertCanManageFivemHierarchyPanel(guildId: string, botId: string, panelId: string, actorId: string, actorRoleIds: string[], isGuildManager = false) {
  const panel = await getFivemHierarchyPanel(guildId, panelId, botId);
  if (!panel) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
  if (!canManageFivemHierarchyPanel(panel, actorId, actorRoleIds, isGuildManager)) {
    await writeFivemHierarchyLogBestEffort({ action: "access.denied", botId, details: { origin: "Discord" }, guildId, panelId, userId: actorId });
    throw createHierarchyError("Você não possui autorização para gerenciar esta hierarquia.", 403);
  }
  return panel;
}

export async function getFivemHierarchyPanel(guildId: string, panelId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  await ensureFivemHierarchyMigration(guildId, normalizedBotId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const row = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId), deletedAt: null });
  return row ? toPanelDto(row) : null;
}

export async function createFivemHierarchyPanel(
  guildId: string,
  botId: string,
  input: FivemHierarchyPanelConfigInput & { clientRequestId: string },
  actorId: string | null,
  origin: "Dashboard" | "Discord" = "Dashboard"
) {
  const normalizedBotId = normalizeBotId(botId);
  if (!normalizedBotId) throw createHierarchyError("Bot vinculado obrigatorio para criar a hierarquia.", 400);
  await ensureFivemHierarchyMigration(guildId, normalizedBotId);
  const { clientRequestId, ...panelInput } = input;
  const creationKey = createHierarchyCreationKey(guildId, normalizedBotId, clientRequestId);
  const normalizedConfig = normalizePanelInput(panelInput);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const existing = await fivemHierarchyPanels.findOne({ creationKey });

  if (existing) {
    return resolveIdempotentCreate(existing, normalizedConfig);
  }
  const duplicateName = (await fivemHierarchyPanels.find({ ...scopeQuery(guildId, normalizedBotId), deletedAt: null }).toArray())
    .some((panel) => normalizeHierarchyName(panel.name) === normalizeHierarchyName(normalizedConfig.name));
  if (duplicateName) throw createHierarchyError("Ja existe uma hierarquia com este nome no servidor.", 409);

  const now = new Date();
  const panelId = randomUUID();
  const next: MongoFivemHierarchyPanel = {
    ...normalizedConfig,
    _id: panelId,
    botId: normalizedBotId,
    configRevision: 1,
    contentHash: null,
    creationKey,
    createdAt: now,
    createdBy: actorId,
    deletedAt: null,
    guildId,
    legacyCleanupPending: false,
    managerUserIds: actorId && !normalizedConfig.managerUserIds.length ? [actorId] : normalizedConfig.managerUserIds,
    migrationVersion: FIVEM_HIERARCHY_MIGRATION_VERSION,
    panelMessageId: null,
    panelVersion: FIVEM_HIERARCHY_PANEL_VERSION,
    pendingCleanup: [],
    publishedAt: null,
    stateUpdatedAt: null,
    updateLock: null,
    updatedAt: now,
    updatedBy: actorId
  };

  await ensureGuild(guildId);
  try {
    await fivemHierarchyPanels.insertOne(next);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await fivemHierarchyPanels.findOne({ creationKey });
    if (!raced) throw error;
    return resolveIdempotentCreate(raced, normalizedConfig);
  }

  await writeFivemHierarchyLogBestEffort({
    action: "panel.created",
    botId: normalizedBotId,
    details: { clientRequestId, origin, title: next.title },
    guildId,
    panelId,
    userId: actorId
  });
  const dto = toPanelDto(next);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, "panel.created", dto);
  emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:hierarchy:panel_update", {
    action: "update",
    botId: normalizedBotId,
    configRevision: dto.configRevision,
    guildId,
    panelId,
    protocol: FIVEM_HIERARCHY_PROTOCOL
  });
  return dto;
}

export async function updateFivemHierarchyPanel(
  guildId: string,
  botId: string,
  panelId: string,
  input: FivemHierarchyPanelConfigInput,
  actorId: string | null,
  origin: "Dashboard" | "Discord" = "Dashboard"
) {
  const normalizedBotId = normalizeBotId(botId);
  if (!normalizedBotId) throw createHierarchyError("Bot vinculado obrigatorio para editar a hierarquia.", 400);
  await ensureFivemHierarchyMigration(guildId, normalizedBotId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId), deletedAt: null });
  if (!current) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
  const currentRevision = configRevisionOf(current);
  if (input.configRevision !== undefined && input.configRevision !== currentRevision) {
    throw createHierarchyError("Esta hierarquia foi atualizada por outro usuário. Recarregue as informações antes de continuar.", 409);
  }

  const mergedInput = mergeDefinedPanelInput(panelConfigSnapshot(current), input);
  const nextConfig = normalizePanelInput(mergedInput);
  const duplicateName = (await fivemHierarchyPanels.find({ ...scopeQuery(guildId, normalizedBotId), _id: { $ne: panelId }, deletedAt: null }).toArray())
    .some((panel) => normalizeHierarchyName(panel.name) === normalizeHierarchyName(nextConfig.name));
  if (duplicateName) throw createHierarchyError("Ja existe outra hierarquia com este nome no servidor.", 409);
  if (sameHierarchyConfig(panelConfigSnapshot(current), nextConfig)) {
    return toPanelDto(current);
  }

  const now = new Date();
  const nextRevision = currentRevision + 1;
  const channelChanged = (current.panelChannelId ?? null) !== nextConfig.panelChannelId;
  const pendingCleanup = channelChanged
    ? addPendingCleanup(current.pendingCleanup, current.panelChannelId, current.panelMessageId, "channel_changed", now)
    : normalizePendingCleanup(current.pendingCleanup);
  const result = await fivemHierarchyPanels.updateOne(
    {
      _id: panelId,
      ...scopeQuery(guildId, normalizedBotId),
      configRevision: currentRevision,
      deletedAt: null
    },
    {
      $set: {
        ...nextConfig,
        configRevision: nextRevision,
        contentHash: null,
        panelMessageId: channelChanged ? null : current.panelMessageId ?? null,
        panelVersion: FIVEM_HIERARCHY_PANEL_VERSION,
        pendingCleanup,
        updatedAt: now,
        updatedBy: actorId
      }
    }
  );

  if (!result.modifiedCount) {
    const latest = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId) });
    if (!latest || latest.deletedAt) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
    throw createHierarchyError("A hierarquia foi alterada por outra solicitacao. Recarregue os dados e tente novamente.", 409);
  }

  const row = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId), deletedAt: null });
  if (!row) throw createHierarchyError("Painel de hierarquia nao encontrado apos a atualizacao.", 409);
  await writeFivemHierarchyLogBestEffort({
    action: "panel.updated",
    botId: normalizedBotId,
    details: { channelChanged, configRevision: nextRevision, title: row.title },
    guildId,
    panelId,
    userId: actorId
  });
  for (const change of hierarchyAuditChanges(current, row)) {
    await writeFivemHierarchyLogBestEffort({
      action: change.action,
      botId: normalizedBotId,
      details: { ...change.details, origin, revisionBefore: currentRevision, revisionAfter: nextRevision },
      guildId,
      panelId,
      userId: actorId
    });
  }
  const dto = toPanelDto(row);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, "panel.updated", dto);
  emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:hierarchy:panel_update", {
    action: "update",
    botId: normalizedBotId,
    configRevision: nextRevision,
    guildId,
    oldPanelChannelId: channelChanged ? current.panelChannelId ?? null : null,
    oldPanelMessageId: channelChanged ? current.panelMessageId ?? null : null,
    panelId,
    protocol: FIVEM_HIERARCHY_PROTOCOL
  });
  return dto;
}

export async function deleteFivemHierarchyPanel(guildId: string, botId: string, panelId: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  if (!normalizedBotId) throw createHierarchyError("Bot vinculado obrigatorio para excluir a hierarquia.", 400);
  await ensureFivemHierarchyMigration(guildId, normalizedBotId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId), deletedAt: null });
  if (!current) return null;

  const now = new Date();
  const currentRevision = configRevisionOf(current);
  const nextRevision = currentRevision + 1;
  const pendingCleanup = addPendingCleanup(current.pendingCleanup, current.panelChannelId, current.panelMessageId, "panel_deleted", now);
  const row = await fivemHierarchyPanels.findOneAndUpdate(
    {
      _id: panelId,
      ...scopeQuery(guildId, normalizedBotId),
      configRevision: currentRevision,
      deletedAt: null
    },
    {
      $set: {
        configRevision: nextRevision,
        contentHash: null,
        deletedAt: now,
        enabled: false,
        panelMessageId: null,
        pendingCleanup,
        updatedAt: now,
        updatedBy: actorId
      }
    },
    { returnDocument: "after" }
  );
  if (!row) throw createHierarchyError("A hierarquia foi alterada por outra solicitacao. Recarregue os dados e tente novamente.", 409);

  await writeFivemHierarchyLogBestEffort({
    action: "panel.deleted",
    botId: normalizedBotId,
    details: { configRevision: nextRevision, pendingCleanupCount: pendingCleanup.length, title: row.title },
    guildId,
    panelId,
    userId: actorId
  });
  const dto = toPanelDto(row);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, "panel.deleted", dto);
  emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:hierarchy:panel_update", {
    action: "delete",
    botId: normalizedBotId,
    configRevision: nextRevision,
    guildId,
    oldPanelChannelId: current.panelChannelId ?? null,
    oldPanelMessageId: current.panelMessageId ?? null,
    panelId,
    protocol: FIVEM_HIERARCHY_PROTOCOL
  });
  await finalizeCleanHierarchyTombstone(row);
  return dto;
}

export async function requestFivemHierarchyPanelPublish(guildId: string, botId: string, panelId: string, actorId: string | null) {
  const panel = await getFivemHierarchyPanel(guildId, panelId, botId);
  if (!panel) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
  if (!panel.enabled) throw createHierarchyError("Ative o painel de hierarquia antes de publicar.", 400);
  if (!panel.panelChannelId) throw createHierarchyError("Configure o canal do painel de hierarquia.", 400);
  await writeFivemHierarchyLogBestEffort({
    action: "panel.publish_requested",
    botId,
    details: { channelId: panel.panelChannelId, configRevision: panel.configRevision },
    guildId,
    panelId,
    userId: actorId
  });
  const responses = await emitRealtimeToRoomWithAck<
    { action: "publish"; botId: string; configRevision: number; guildId: string; panelId: string; protocol: string },
    FivemHierarchyPublishAck
  >(devBotRealtimeRoom(botId), "fivem:hierarchy:panel_update", {
    action: "publish",
    botId,
    configRevision: panel.configRevision,
    guildId,
    panelId,
    protocol: FIVEM_HIERARCHY_PROTOCOL
  }, 20_000);
  const success = responses.find((response) => response?.ok);
  if (success) {
    await writeFivemHierarchyLogBestEffort({
      action: "panel.published",
      botId,
      details: { channelId: panel.panelChannelId, messageId: success.messageId ?? null },
      guildId,
      panelId,
      userId: actorId
    });
    return await getFivemHierarchyPanel(guildId, panelId, botId) ?? panel;
  }

  const error = responses.find((response) => response?.error)?.error;
  throw createHierarchyError(error ?? "O bot V2 nao respondeu a solicitacao de publicacao.", 409);
}

export async function removeFivemHierarchyPanelPublication(guildId: string, botId: string, panelId: string, actorId: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  if (!normalizedBotId) throw createHierarchyError("Bot vinculado obrigatorio para remover a publicacao.", 400);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, normalizedBotId), deletedAt: null });
  if (!current) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
  const revision = configRevisionOf(current);
  const now = new Date();
  const pendingCleanup = addPendingCleanup(current.pendingCleanup, current.panelChannelId, current.panelMessageId, "channel_changed", now);
  const row = await fivemHierarchyPanels.findOneAndUpdate(
    { _id: panelId, ...scopeQuery(guildId, normalizedBotId), configRevision: revision, deletedAt: null },
    { $set: { configRevision: revision + 1, contentHash: null, enabled: false, panelMessageId: null, pendingCleanup, status: "completed", updatedAt: now, updatedBy: actorId } },
    { returnDocument: "after" }
  );
  if (!row) throw createHierarchyError("Esta hierarquia foi atualizada por outro usuário. Recarregue as informações antes de continuar.", 409);
  await writeFivemHierarchyLogBestEffort({ action: "panel.unpublished", botId: normalizedBotId, details: { channelId: current.panelChannelId, messageId: current.panelMessageId, origin: "Discord" }, guildId, panelId, userId: actorId });
  const dto = toPanelDto(row);
  emitFivemHierarchyPanelUpdated(guildId, normalizedBotId, "panel.unpublished", dto);
  emitRealtimeToRoom(devBotRealtimeRoom(normalizedBotId), "fivem:hierarchy:panel_update", { action: "unpublish", botId: normalizedBotId, configRevision: revision + 1, guildId, oldPanelChannelId: current.panelChannelId ?? null, oldPanelMessageId: current.panelMessageId ?? null, panelId, protocol: FIVEM_HIERARCHY_PROTOCOL });
  return dto;
}

export async function updateFivemHierarchyPanelState(
  guildId: string,
  botId: string,
  panelId: string,
  input: {
    configRevision: number;
    contentHash: string;
    instanceId: string;
    lockToken: string;
    messageId: string;
    panelVersion: 2;
  }
) {
  await ensureFivemHierarchyMigration(guildId, botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const now = new Date();
  const normalizedMessageId = normalizeSnowflake(input.messageId);
  const normalizedHash = normalizeContentHash(input.contentHash);
  if (!normalizedMessageId || !normalizedHash) throw createHierarchyError("Estado V2 do painel invalido.", 400);
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, botId) });
  assertWritablePanelState(current, input, now);

  if ((current.panelMessageId ?? null) === normalizedMessageId
    && (current.contentHash ?? null) === normalizedHash
    && current.panelVersion === FIVEM_HIERARCHY_PANEL_VERSION) {
    return toPanelDto(current);
  }

  const row = await fivemHierarchyPanels.findOneAndUpdate(
    {
      _id: panelId,
      ...scopeQuery(guildId, botId),
      configRevision: input.configRevision,
      deletedAt: null,
      enabled: true,
      "updateLock.expiresAt": { $gt: now },
      "updateLock.instanceId": input.instanceId,
      "updateLock.lockToken": input.lockToken,
      "updateLock.revision": input.configRevision
    },
    {
      $set: {
        contentHash: normalizedHash,
        panelMessageId: normalizedMessageId,
        panelVersion: FIVEM_HIERARCHY_PANEL_VERSION,
        publishedAt: current.publishedAt ?? now,
        status: "published",
        stateUpdatedAt: now
      }
    },
    { returnDocument: "after" }
  );
  if (!row) throw createHierarchyError("Lock ou revisao da hierarquia expirou durante a gravacao do estado.", 409);
  const dto = toPanelDto(row);
  emitFivemHierarchyPanelUpdated(guildId, botId, "panel.state_updated", dto);
  return dto;
}

export async function acquireFivemHierarchyPanelLock(guildId: string, botId: string, panelId: string, instanceId: string, ttlMs: number) {
  await ensureFivemHierarchyMigration(guildId, botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, botId) });
  if (!current || current.deletedAt) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
  if (!current.enabled) throw createHierarchyError("Painel de hierarquia desativado.", 409);
  const revision = configRevisionOf(current);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(5_000, Math.min(ttlMs, 120_000)));
  const lockToken = randomUUID();
  const row = await fivemHierarchyPanels.findOneAndUpdate(
    {
      _id: panelId,
      ...scopeQuery(guildId, botId),
      configRevision: revision,
      deletedAt: null,
      enabled: true,
      $or: [
        { updateLock: null },
        { updateLock: { $exists: false } },
        { "updateLock.expiresAt": { $lte: now } },
        { "updateLock.revision": { $ne: revision } }
      ]
    },
    { $set: { updateLock: { expiresAt, instanceId, lockToken, revision } } },
    { returnDocument: "after" }
  );
  if (!row) {
    return { acquired: false, configRevision: revision, expiresAt: null, lockToken: null };
  }
  return { acquired: true, configRevision: revision, expiresAt: expiresAt.toISOString(), lockToken };
}

export async function releaseFivemHierarchyPanelLock(guildId: string, botId: string, panelId: string, instanceId: string, lockToken: string) {
  await ensureFivemHierarchyMigration(guildId, botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const result = await fivemHierarchyPanels.updateOne(
    {
      _id: panelId,
      ...scopeQuery(guildId, botId),
      "updateLock.instanceId": instanceId,
      "updateLock.lockToken": lockToken
    },
    { $set: { updateLock: null } }
  );
  return result.modifiedCount > 0;
}

export async function listFivemHierarchyCleanupTasks(botId: string) {
  await ensureFivemHierarchyMigration(null, botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const rows = await fivemHierarchyPanels.find({
    botId,
    $or: [
      { legacyCleanupPending: true },
      { "pendingCleanup.0": { $exists: true } }
    ]
  }).sort({ updatedAt: 1 }).toArray();
  return rows.map(toCleanupTaskDto);
}

export async function completeFivemHierarchyCleanup(
  guildId: string,
  botId: string,
  panelId: string,
  input: { cleanupIds: string[]; instanceId: string; legacyCleanupCompleted: boolean }
) {
  await ensureFivemHierarchyMigration(guildId, botId);
  const { fivemHierarchyPanels } = await getMongoCollections();
  const current = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, botId) });
  if (!current) {
    return {
      acknowledgedCleanupIds: [...new Set(input.cleanupIds)],
      legacyCleanupPending: false,
      panelRemoved: true,
      pendingCleanupCount: 0
    };
  }

  const cleanupIds = [...new Set(input.cleanupIds)];
  const update: Record<string, unknown> = {};
  if (cleanupIds.length) {
    update.$pull = { pendingCleanup: { id: { $in: cleanupIds } } };
  }
  if (input.legacyCleanupCompleted) {
    update.$set = { legacyCleanupPending: false };
  }
  if (Object.keys(update).length) {
    await fivemHierarchyPanels.updateOne({ _id: panelId, ...scopeQuery(guildId, botId) }, update);
  }

  const row = await fivemHierarchyPanels.findOne({ _id: panelId, ...scopeQuery(guildId, botId) });
  if (!row) {
    return { acknowledgedCleanupIds: cleanupIds, legacyCleanupPending: false, panelRemoved: true, pendingCleanupCount: 0 };
  }
  const panelRemoved = await finalizeCleanHierarchyTombstone(row);
  await writeFivemHierarchyLogBestEffort({
    action: "panel.cleanup_completed",
    botId,
    details: {
      cleanupIds,
      instanceId: input.instanceId,
      legacyCleanupCompleted: input.legacyCleanupCompleted,
      panelRemoved
    },
    guildId,
    panelId,
    userId: null
  });
  return {
    acknowledgedCleanupIds: cleanupIds,
    legacyCleanupPending: panelRemoved ? false : row.legacyCleanupPending === true && !input.legacyCleanupCompleted,
    panelRemoved,
    pendingCleanupCount: panelRemoved ? 0 : normalizePendingCleanup(row.pendingCleanup).filter((item) => !cleanupIds.includes(item.id)).length
  };
}

export async function listFivemHierarchyLogs(guildId: string, botId?: string | null, panelId?: string | null) {
  const { fivemHierarchyLogs } = await getMongoCollections();
  const rows = await fivemHierarchyLogs.find({ ...scopeQuery(guildId, normalizeBotId(botId)), ...(panelId ? { panelId } : {}) }).sort({ createdAt: -1 }).limit(200).toArray();
  return rows.map(toLogDto);
}

export async function recordFivemHierarchyAudit(input: { action: string; botId: string; details: Record<string, unknown>; guildId: string; panelId: string | null; userId: string | null }) {
  const fingerprint = typeof input.details.fingerprint === "string" ? input.details.fingerprint : null;
  if (fingerprint) {
    const { fivemHierarchyLogs } = await getMongoCollections();
    const duplicate = await fivemHierarchyLogs.findOne({ action: input.action, botId: input.botId, guildId: input.guildId, panelId: input.panelId, "details.fingerprint": fingerprint });
    if (duplicate) return;
  }
  await writeFivemHierarchyLogBestEffort(input);
}

function resolveIdempotentCreate(existing: MongoFivemHierarchyPanel, normalizedConfig: NormalizedPanelConfig) {
  if (existing.deletedAt) {
    throw createHierarchyError("clientRequestId ja foi utilizado por uma hierarquia excluida.", 409);
  }
  if (!sameHierarchyConfig(panelConfigSnapshot(existing), normalizedConfig)) {
    throw createHierarchyError("clientRequestId ja foi utilizado com outro conteudo.", 409);
  }
  return toPanelDto(existing);
}

function normalizePanelInput(input: FivemHierarchyPanelConfigInput): NormalizedPanelConfig {
  return {
    allowedRoleIds: normalizeRoleIds(input.allowedRoleIds ?? []),
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
    managerUserIds: normalizeRoleIds(input.managerUserIds ?? []),
    managerRoleIds: normalizeRoleIds(input.managerRoleIds ?? []),
    commandUserIds: normalizeRoleIds(input.commandUserIds ?? []),
    commandRoleIds: normalizeRoleIds(input.commandRoleIds ?? []),
    name: normalizeText(input.name, 100) ?? "Hierarquia FAQ",
    panelChannelId: normalizeSnowflake(input.panelChannelId),
    title: normalizeText(input.title, 120) ?? "Hierarquia Policial",
    status: input.status === "completed" || input.status === "published" || input.status === "disabled" ? input.status : "draft"
  };
}

function panelConfigSnapshot(row: MongoFivemHierarchyPanel): NormalizedPanelConfig {
  return normalizePanelInput({
    allowedRoleIds: row.allowedRoleIds,
    color: row.color,
    description: row.description,
    enabled: row.enabled,
    footerEnabled: row.footerEnabled,
    footerIconUrl: row.footerIconUrl,
    footerText: row.footerText,
    hierarchies: row.hierarchies,
    imagePosition: row.imagePosition,
    imageUrl: row.imageUrl,
    linkedToFivem: row.linkedToFivem,
    logChannelId: row.logChannelId,
    managerUserIds: row.managerUserIds ?? [],
    managerRoleIds: row.managerRoleIds ?? [],
    commandUserIds: row.commandUserIds ?? [],
    commandRoleIds: row.commandRoleIds ?? [],
    name: row.name,
    panelChannelId: row.panelChannelId,
    title: row.title,
    status: row.status ?? (row.enabled && row.panelMessageId ? "published" : "draft")
  });
}

function mergeDefinedPanelInput(current: NormalizedPanelConfig, input: FivemHierarchyPanelConfigInput) {
  const merged: FivemHierarchyPanelConfigInput = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
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
      roleId: normalizeSnowflake(item.roleId) ?? "",
      roleName: normalizeText(item.roleName, 100)
    }))
    .filter((item) => item.roleId)
    .sort((a, b) => a.order - b.order)
    .filter((item, _index, items) => items.findIndex((candidate) => candidate.roleId === item.roleId) === _index)
    .slice(0, 50);
}

function toPanelDto(row: MongoFivemHierarchyPanel): FivemHierarchyPanelDto {
  return {
    allowedRoleIds: row.allowedRoleIds ?? [],
    botId: normalizeBotId(row.botId),
    color: row.color,
    configRevision: configRevisionOf(row),
    contentHash: normalizeContentHash(row.contentHash),
    createdAt: normalizeDate(row.createdAt)?.toISOString() ?? new Date(0).toISOString(),
    createdBy: row.createdBy ?? null,
    deletedAt: normalizeDate(row.deletedAt)?.toISOString() ?? null,
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
    managerUserIds: row.managerUserIds ?? [],
    managerRoleIds: row.managerRoleIds ?? [],
    commandUserIds: row.commandUserIds ?? [],
    commandRoleIds: row.commandRoleIds ?? [],
    name: row.name,
    panelChannelId: row.panelChannelId ?? null,
    panelMessageId: row.panelMessageId ?? null,
    panelVersion: row.panelVersion === FIVEM_HIERARCHY_PANEL_VERSION ? FIVEM_HIERARCHY_PANEL_VERSION : 1,
    publishedAt: normalizeDate(row.publishedAt)?.toISOString() ?? null,
    status: row.status ?? (row.enabled && row.panelMessageId ? "published" : "draft"),
    title: row.title,
    updatedAt: normalizeDate(row.updatedAt)?.toISOString() ?? new Date(0).toISOString(),
    updatedBy: row.updatedBy ?? null
  };
}

function toCleanupTaskDto(row: MongoFivemHierarchyPanel): FivemHierarchyCleanupTaskDto {
  return {
    botId: normalizeBotId(row.botId),
    deletedAt: normalizeDate(row.deletedAt)?.toISOString() ?? null,
    description: row.description ?? null,
    guildId: row.guildId,
    legacyCleanupPending: row.legacyCleanupPending === true,
    officialChannelId: row.panelChannelId ?? null,
    officialMessageId: row.panelMessageId ?? null,
    panelId: row._id,
    pendingCleanup: normalizePendingCleanup(row.pendingCleanup).map((item) => ({
      channelId: item.channelId,
      cleanupId: item.id,
      createdAt: item.createdAt.toISOString(),
      messageId: item.messageId,
      reason: item.reason
    })),
    title: row.title
  };
}

function toLogDto(row: MongoFivemHierarchyLog): FivemHierarchyLogDto {
  return {
    action: row.action,
    botId: normalizeBotId(row.botId),
    createdAt: row.createdAt.toISOString(),
    details: row.details ?? {},
    guildId: row.guildId,
    id: row._id,
    panelId: row.panelId ?? null,
    userId: row.userId ?? null
  };
}

function emitFivemHierarchyPanelUpdated(guildId: string, botId: string | null, action: string, panel: FivemHierarchyPanelDto) {
  if (!botId) return;
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "fivem:hierarchy:updated", {
    action,
    botId,
    guildId,
    panel,
    panelId: panel.id
  });
}

function assertWritablePanelState(
  current: MongoFivemHierarchyPanel | null,
  input: { configRevision: number; instanceId: string; lockToken: string },
  now: Date
): asserts current is MongoFivemHierarchyPanel {
  if (!current || current.deletedAt) throw createHierarchyError("Painel de hierarquia nao encontrado.", 404);
  if (!current.enabled) throw createHierarchyError("Painel de hierarquia desativado.", 409);
  if (configRevisionOf(current) !== input.configRevision) throw createHierarchyError("Revisao da hierarquia desatualizada.", 409);
  const lock = current.updateLock;
  if (!lock
    || lock.instanceId !== input.instanceId
    || lock.lockToken !== input.lockToken
    || lock.revision !== input.configRevision
    || !(lock.expiresAt instanceof Date)
    || lock.expiresAt.getTime() <= now.getTime()) {
    throw createHierarchyError("Lock V2 ausente, expirado ou pertencente a outra instancia.", 409);
  }
}

function addPendingCleanup(
  values: MongoFivemHierarchyPendingCleanup[] | undefined,
  channelId: string | null | undefined,
  messageId: string | null | undefined,
  reason: MongoFivemHierarchyPendingCleanup["reason"],
  createdAt: Date,
  cleanupId: string = randomUUID()
) {
  const normalized = normalizePendingCleanup(values);
  const normalizedChannelId = normalizeSnowflake(channelId);
  const normalizedMessageId = normalizeSnowflake(messageId);
  if (!normalizedChannelId || !normalizedMessageId) return normalized;
  if (normalized.some((item) => item.channelId === normalizedChannelId && item.messageId === normalizedMessageId)) return normalized;
  return [...normalized, { channelId: normalizedChannelId, createdAt, id: cleanupId, messageId: normalizedMessageId, reason }];
}

function normalizePendingCleanup(values: MongoFivemHierarchyPendingCleanup[] | undefined) {
  const result: MongoFivemHierarchyPendingCleanup[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    const channelId = normalizeSnowflake(item?.channelId);
    const messageId = normalizeSnowflake(item?.messageId);
    if (!channelId || !messageId) continue;
    if (result.some((candidate) => candidate.channelId === channelId && candidate.messageId === messageId)) continue;
    const reason = item.reason === "channel_changed" || item.reason === "panel_deleted" || item.reason === "migration_duplicate"
      ? item.reason
      : "migration_duplicate";
    result.push({
      channelId,
      createdAt: normalizeDate(item.createdAt) ?? new Date(),
      id: normalizeText(item.id, 80) ?? cleanupFingerprint(channelId, messageId),
      messageId,
      reason
    });
  }
  return result;
}

async function finalizeCleanHierarchyTombstone(row: MongoFivemHierarchyPanel) {
  if (!row.deletedAt || row.legacyCleanupPending === true || normalizePendingCleanup(row.pendingCleanup).length) return false;
  const { fivemHierarchyPanels } = await getMongoCollections();
  const result = await fivemHierarchyPanels.deleteOne({
    _id: row._id,
    deletedAt: { $ne: null },
    legacyCleanupPending: { $ne: true },
    "pendingCleanup.0": { $exists: false }
  });
  return result.deletedCount > 0;
}

async function writeFivemHierarchyLogBestEffort(input: Omit<MongoFivemHierarchyLog, "_id" | "createdAt">) {
  try {
    const { fivemHierarchyLogs } = await getMongoCollections();
    await fivemHierarchyLogs.insertOne({ _id: randomUUID(), createdAt: new Date(), ...input });
  } catch (error) {
    console.warn(`[fivem-hierarchy] falha ao persistir log ${input.action}:`, error instanceof Error ? error.message : String(error));
  }
}

async function ensureFivemHierarchyMigration(guildId: string | null, botId: string | null) {
  const key = `${botId ?? "default"}:${guildId ?? "all"}:${FIVEM_HIERARCHY_MIGRATION_VERSION}`;
  const existing = hierarchyMigrationRuns.get(key);
  if (existing) return existing;
  const migration = migrateFivemHierarchyPanelState(guildId, botId).catch((error) => {
    hierarchyMigrationRuns.delete(key);
    throw error;
  });
  hierarchyMigrationRuns.set(key, migration);
  return migration;
}

async function migrateFivemHierarchyPanelState(guildId: string | null, botId: string | null) {
  const { fivemHierarchyPanels } = await getMongoCollections();
  const migrationScope = migrationScopeQuery(guildId, botId);
  const candidates = await fivemHierarchyPanels.find({
    ...migrationScope,
    migrationVersion: { $ne: FIVEM_HIERARCHY_MIGRATION_VERSION }
  }).toArray();
  if (!candidates.length) return;

  const now = new Date();
  for (const row of candidates) {
    const normalizedConfig = panelConfigSnapshot(row);
    await fivemHierarchyPanels.updateOne(
      { _id: row._id, migrationVersion: { $ne: FIVEM_HIERARCHY_MIGRATION_VERSION } },
      {
        $set: {
          ...normalizedConfig,
          botId: normalizeBotId(row.botId),
          configRevision: configRevisionOf(row),
          contentHash: row.panelVersion === FIVEM_HIERARCHY_PANEL_VERSION ? normalizeContentHash(row.contentHash) : null,
          creationKey: normalizeCreationKey(row.creationKey),
          createdAt: normalizeDate(row.createdAt) ?? now,
          deletedAt: normalizeDate(row.deletedAt),
          guildId: row.guildId?.trim(),
          legacyCleanupPending: true,
          panelMessageId: normalizeSnowflake(row.panelMessageId),
          panelVersion: FIVEM_HIERARCHY_PANEL_VERSION,
          pendingCleanup: normalizePendingCleanup(row.pendingCleanup),
          stateUpdatedAt: normalizeDate(row.stateUpdatedAt),
          updateLock: null,
          updatedAt: normalizeDate(row.updatedAt) ?? normalizeDate(row.createdAt) ?? now
        }
      }
    );
  }

  const candidateIds = new Set(candidates.map((row) => row._id));
  const activeRows = await fivemHierarchyPanels.find({ ...migrationScope, deletedAt: null }).toArray();
  const groups = new Map<string, MongoFivemHierarchyPanel[]>();
  for (const row of activeRows) {
    const fingerprint = hierarchyDedupeFingerprint({
      botId: normalizeBotId(row.botId),
      guildId: row.guildId,
      panelChannelId: normalizeSnowflake(row.panelChannelId),
      roleIds: (row.hierarchies ?? []).map((item) => item.roleId)
    });
    if (!fingerprint) continue;
    const values = groups.get(fingerprint) ?? [];
    values.push(row);
    groups.set(fingerprint, values);
  }

  for (const rows of groups.values()) {
    if (rows.length < 2 || !rows.some((row) => candidateIds.has(row._id))) continue;
    rows.sort(compareNewestHierarchyPanel);
    const [winner, ...losers] = rows;
    if (!winner) continue;
    let pendingCleanup = normalizePendingCleanup(winner.pendingCleanup);
    let legacyCleanupPending = winner.legacyCleanupPending === true;
    for (const loser of losers) {
      for (const task of normalizePendingCleanup(loser.pendingCleanup)) {
        pendingCleanup = addPendingCleanup(pendingCleanup, task.channelId, task.messageId, task.reason, task.createdAt, task.id);
      }
      if (loser.panelMessageId !== winner.panelMessageId) {
        pendingCleanup = addPendingCleanup(
          pendingCleanup,
          loser.panelChannelId,
          loser.panelMessageId,
          "migration_duplicate",
          normalizeDate(loser.updatedAt) ?? now,
          cleanupFingerprint(loser.panelChannelId ?? "", loser.panelMessageId ?? "")
        );
      }
      legacyCleanupPending = legacyCleanupPending || loser.legacyCleanupPending === true;
    }
    await fivemHierarchyPanels.updateOne(
      { _id: winner._id },
      { $set: { legacyCleanupPending, pendingCleanup } }
    );
    await fivemHierarchyPanels.deleteMany({ _id: { $in: losers.map((row) => row._id) } });
    console.info(`[HIERARCHY] Migracao preservou ${winner._id} e removeu ${losers.length} registro(s) logicamente duplicado(s).`);
  }

  await fivemHierarchyPanels.updateMany(
    { _id: { $in: [...candidateIds] } },
    { $set: { migrationVersion: FIVEM_HIERARCHY_MIGRATION_VERSION } }
  );
}

function compareNewestHierarchyPanel(left: MongoFivemHierarchyPanel, right: MongoFivemHierarchyPanel) {
  const updatedDifference = (normalizeDate(right.updatedAt)?.getTime() ?? 0) - (normalizeDate(left.updatedAt)?.getTime() ?? 0);
  if (updatedDifference) return updatedDifference;
  const createdDifference = (normalizeDate(right.createdAt)?.getTime() ?? 0) - (normalizeDate(left.createdAt)?.getTime() ?? 0);
  if (createdDifference) return createdDifference;
  return right._id.localeCompare(left._id);
}

function migrationScopeQuery(guildId: string | null, botId: string | null) {
  return {
    ...(guildId ? { guildId } : {}),
    ...(botId ? { botId } : {})
  };
}

function scopeQuery(guildId: string, botId: string | null) {
  return botId ? { botId, guildId } : { guildId, $or: [{ botId: null }, { botId: { $exists: false } }] };
}

function createHierarchyCreationKey(guildId: string, botId: string, clientRequestId: string) {
  return `${botId}:${guildId}:${clientRequestId.trim().toLowerCase()}`;
}

function normalizeCreationKey(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function configRevisionOf(row: MongoFivemHierarchyPanel) {
  return typeof row.configRevision === "number" && Number.isSafeInteger(row.configRevision) && row.configRevision > 0
    ? row.configRevision
    : 1;
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

function normalizeDate(value: unknown) {
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) ?? "";
  return normalized || null;
}

function normalizeHierarchyName(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hierarchyAuditChanges(before: MongoFivemHierarchyPanel, after: MongoFivemHierarchyPanel) {
  const changes: Array<{ action: string; details: Record<string, unknown> }> = [];
  if (before.name !== after.name) changes.push({ action: "hierarchy.renamed", details: { before: before.name, after: after.name } });
  if ((before.panelChannelId ?? null) !== (after.panelChannelId ?? null)) changes.push({ action: "hierarchy.channel_changed", details: { before: before.panelChannelId ?? null, after: after.panelChannelId ?? null } });
  if ((before.status ?? "draft") !== (after.status ?? "draft")) changes.push({ action: "hierarchy.status_changed", details: { before: before.status ?? "draft", after: after.status ?? "draft" } });
  const oldPositions = new Map((before.hierarchies ?? []).map((item) => [item.id, item]));
  const newPositions = new Map((after.hierarchies ?? []).map((item) => [item.id, item]));
  for (const [id, item] of newPositions) {
    const previous = oldPositions.get(id);
    if (!previous) changes.push({ action: "hierarchy.position_added", details: { position: item } });
    else if (sameHierarchyConfig(previous, item) === false) changes.push({ action: previous.order !== item.order && previous.name === item.name && previous.roleId === item.roleId ? "hierarchy.order_changed" : "hierarchy.position_updated", details: { before: previous, after: item } });
  }
  for (const [id, item] of oldPositions) if (!newPositions.has(id)) changes.push({ action: "hierarchy.position_removed", details: { position: item } });
  return changes;
}

function cleanupFingerprint(channelId: string, messageId: string) {
  return createHash("sha256").update(`${channelId}:${messageId}`).digest("hex");
}

function isDuplicateKeyError(error: unknown) {
  return (error as { code?: unknown })?.code === 11000;
}

function createHierarchyError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
