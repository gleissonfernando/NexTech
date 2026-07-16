import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoVisibleUser } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { createLog } from "./logService";

export const VISIBLE_MODE_MODULE_ID = "visible-mode";

export type VisibleUserDto = {
  addedBy: string | null;
  botId: string;
  createdAt: string;
  guildId: string;
  id: string;
  updatedAt: string;
  userId: string;
};

export async function listVisibleUsers(botId: string, guildId: string) {
  const { visibleUsers } = await getMongoCollections();
  const rows = await visibleUsers.find({ botId, guildId }).sort({ updatedAt: -1 }).toArray();
  return rows.map(toDto);
}

export async function searchVisibleUsers(botId: string, guildId: string, query: string) {
  const normalized = query.trim();
  const { visibleUsers } = await getMongoCollections();
  const filter = normalized
    ? { botId, guildId, userId: { $regex: escapeRegex(normalized), $options: "i" } }
    : { botId, guildId };
  const rows = await visibleUsers.find(filter).sort({ updatedAt: -1 }).limit(50).toArray();
  return rows.map(toDto);
}

export async function countVisibleUsers(botId: string, guildId: string) {
  const { visibleUsers } = await getMongoCollections();
  return visibleUsers.countDocuments({ botId, guildId });
}

export async function getVisibleUser(botId: string, guildId: string, userId: string) {
  const { visibleUsers } = await getMongoCollections();
  const row = await visibleUsers.findOne({ botId, guildId, userId });
  return row ? toDto(row) : null;
}

export async function isVisibleUser(botId: string, guildId: string, userId: string) {
  const { visibleUsers } = await getMongoCollections();
  const row = await visibleUsers.findOne({ botId, guildId, userId }, { projection: { _id: 1 } });
  return Boolean(row);
}

export async function upsertVisibleUser(botId: string, guildId: string, userId: string, actorId: string | null) {
  const { visibleUsers } = await getMongoCollections();
  const now = new Date();
  const current = await visibleUsers.findOne({ botId, guildId, userId });
  const row: MongoVisibleUser = {
    _id: current?._id ?? randomUUID(),
    addedBy: current?.addedBy ?? actorId,
    botId,
    createdAt: current?.createdAt ?? now,
    guildId,
    updatedAt: now,
    userId
  };

  await ensureGuild(guildId);
  await visibleUsers.updateOne({ botId, guildId, userId }, { $set: row }, { upsert: true });
  await audit(botId, guildId, actorId, current ? "visible_mode.user_updated" : "visible_mode.user_added", `Usuário ${userId} liberado no Modo Visível.`, { userId });
  emitVisibleModeUpdated(botId, guildId, userId);
  return toDto(row);
}

export async function removeVisibleUser(botId: string, guildId: string, userId: string, actorId: string | null) {
  const { visibleUsers } = await getMongoCollections();
  const result = await visibleUsers.deleteOne({ botId, guildId, userId });
  if (result.deletedCount > 0) {
    await audit(botId, guildId, actorId, "visible_mode.user_removed", `Usuário ${userId} removido do Modo Visível.`, { userId });
    emitVisibleModeUpdated(botId, guildId, userId);
  }
  return { removed: result.deletedCount > 0 };
}

export async function clearVisibleUsers(botId: string, guildId: string, actorId: string | null) {
  const { visibleUsers } = await getMongoCollections();
  const result = await visibleUsers.deleteMany({ botId, guildId });
  await audit(botId, guildId, actorId, "visible_mode.users_cleared", `${result.deletedCount} usuário(s) removido(s) do Modo Visível.`, { removed: result.deletedCount });
  emitVisibleModeUpdated(botId, guildId, null);
  return { removed: result.deletedCount };
}

async function audit(botId: string, guildId: string, actorId: string | null, type: string, message: string, metadata: Record<string, unknown>) {
  await createLog({
    action: type,
    botId,
    guildId,
    message,
    metadata,
    module: VISIBLE_MODE_MODULE_ID,
    type,
    userId: actorId
  }).catch((error) => {
    console.warn("[visible-mode] falha ao registrar log:", error instanceof Error ? error.message : error);
  });
}

function emitVisibleModeUpdated(botId: string, guildId: string, userId: string | null) {
  const payload = { botId, guildId, userId };
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "visible-mode:users_updated", payload);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "visible-mode:users_updated", payload);
}

function toDto(row: MongoVisibleUser): VisibleUserDto {
  return {
    addedBy: row.addedBy,
    botId: row.botId,
    createdAt: row.createdAt.toISOString(),
    guildId: row.guildId,
    id: row._id,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
