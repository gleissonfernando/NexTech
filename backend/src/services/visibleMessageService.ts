import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoVisibleMessageUser } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const VISIBLE_MESSAGE_MODULE_ID = "visible-message";

export type VisibleMessageUserDto = {
  avatarUrl: string | null;
  botId: string;
  createdAt: string;
  createdBy: string | null;
  enabled: boolean;
  guildId: string;
  id: string;
  updatedAt: string;
  updatedBy: string | null;
  userId: string;
  username: string | null;
};

export type VisibleMessageDashboardDto = {
  users: VisibleMessageUserDto[];
};

export type SaveVisibleMessageUserInput = {
  avatarUrl?: string | null;
  userId: string;
  username?: string | null;
};

export async function getVisibleMessageDashboard(botId: string, guildId: string): Promise<VisibleMessageDashboardDto> {
  return { users: await listVisibleMessageUsers(botId, guildId) };
}

export async function listVisibleMessageUsers(botId: string, guildId: string) {
  const { visibleMessageUsers } = await getMongoCollections();
  const rows = await visibleMessageUsers
    .find({ botId, guildId, enabled: true })
    .sort({ updatedAt: -1 })
    .limit(5000)
    .toArray();
  return rows.map(toDto);
}

export async function isVisibleMessageUserEnabled(botId: string, guildId: string, userId: string) {
  const { visibleMessageUsers } = await getMongoCollections();
  const row = await visibleMessageUsers.findOne({ botId, guildId, userId, enabled: true }, { projection: { _id: 1 } });
  return Boolean(row);
}

export async function addVisibleMessageUser(
  botId: string,
  guildId: string,
  input: SaveVisibleMessageUserInput,
  actorId: string | null
) {
  const { visibleMessageUsers } = await getMongoCollections();
  const now = new Date();
  const current = await visibleMessageUsers.findOne({ botId, guildId, userId: input.userId });
  const row: MongoVisibleMessageUser = {
    _id: current?._id ?? randomUUID(),
    avatarUrl: normalizeNullable(input.avatarUrl ?? current?.avatarUrl ?? null, 500),
    botId,
    createdAt: current?.createdAt ?? now,
    createdBy: current?.createdBy ?? actorId,
    enabled: true,
    guildId,
    updatedAt: now,
    updatedBy: actorId,
    userId: input.userId,
    username: normalizeNullable(input.username ?? current?.username ?? null, 120)
  };

  await ensureGuild(guildId);
  await visibleMessageUsers.updateOne({ botId, guildId, userId: input.userId }, { $set: row }, { upsert: true });
  emitVisibleMessageUsersUpdated(botId, guildId);
  return toDto(row);
}

export async function removeVisibleMessageUser(botId: string, guildId: string, userId: string, actorId: string | null) {
  const { visibleMessageUsers } = await getMongoCollections();
  const now = new Date();
  const row = await visibleMessageUsers.findOneAndUpdate(
    { botId, guildId, userId },
    { $set: { enabled: false, updatedAt: now, updatedBy: actorId } },
    { returnDocument: "after" }
  );

  emitVisibleMessageUsersUpdated(botId, guildId);
  return row ? toDto(row) : null;
}

export async function clearVisibleMessageUsers(botId: string, guildId: string, actorId: string | null) {
  const { visibleMessageUsers } = await getMongoCollections();
  await visibleMessageUsers.updateMany(
    { botId, guildId, enabled: true },
    { $set: { enabled: false, updatedAt: new Date(), updatedBy: actorId } }
  );
  emitVisibleMessageUsersUpdated(botId, guildId);
  return listVisibleMessageUsers(botId, guildId);
}

function toDto(row: MongoVisibleMessageUser): VisibleMessageUserDto {
  return {
    avatarUrl: row.avatarUrl,
    botId: row.botId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    enabled: row.enabled,
    guildId: row.guildId,
    id: row._id,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    userId: row.userId,
    username: row.username
  };
}

function normalizeNullable(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function emitVisibleMessageUsersUpdated(botId: string, guildId: string) {
  const payload = { botId, guildId };
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "visible-message:users_updated", payload);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "visible-message:users_updated", payload);
}
