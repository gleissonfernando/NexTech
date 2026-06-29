import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoAutomatedLogSettings } from "../database/mongo";

type AutomatedLogChannels = { site: string | null; absence: string | null; messages: string | null; calls: string | null; verification: string | null; punishment: string | null };
const emptyChannels = (): AutomatedLogChannels => ({ site: null, absence: null, messages: null, calls: null, verification: null, punishment: null });
export async function getAutomatedLogSettings(botId: string, guildId: string) {
  const { automatedLogSettings } = await getMongoCollections(); const settings = await automatedLogSettings.findOne({ botId, guildId });
  if (!settings) return { id: "", botId, guildId, enabled: false, categoryId: null, channels: emptyChannels(), allowedRoleIds: [], lastError: null, lastSyncedAt: null, lastSyncRequestedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return dto(settings);
}
export async function saveAutomatedLogSettings(botId: string, guildId: string, input: { enabled?: boolean; allowedRoleIds?: string[] }, requestSync = true) {
  const { automatedLogSettings } = await getMongoCollections(); const current = await getAutomatedLogSettings(botId, guildId); const now = new Date();
  await automatedLogSettings.updateOne({ botId, guildId }, { $set: { botId, guildId, enabled: input.enabled ?? current.enabled, allowedRoleIds: ids(input.allowedRoleIds ?? current.allowedRoleIds), ...(requestSync ? { lastSyncRequestedAt: now } : {}), lastError: null, updatedAt: now }, $setOnInsert: { _id: randomUUID(), categoryId: null, channels: emptyChannels(), lastSyncedAt: null, createdAt: now } }, { upsert: true });
  return getAutomatedLogSettings(botId, guildId);
}
export async function updateAutomatedLogRuntime(botId: string, guildId: string, input: { categoryId?: string | null; channels?: AutomatedLogChannels; lastError?: string | null; synced?: boolean }) {
  const { automatedLogSettings } = await getMongoCollections(); const now = new Date();
  await automatedLogSettings.updateOne({ botId, guildId }, { $set: { ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.channels ? { channels: input.channels } : {}), ...(input.lastError !== undefined ? { lastError: input.lastError } : {}), ...(input.synced ? { lastSyncedAt: now } : {}), updatedAt: now } });
  return getAutomatedLogSettings(botId, guildId);
}
function dto(settings: MongoAutomatedLogSettings) { return { ...settings, id: settings._id, lastSyncedAt: settings.lastSyncedAt?.toISOString() ?? null, lastSyncRequestedAt: settings.lastSyncRequestedAt?.toISOString() ?? null, createdAt: settings.createdAt.toISOString(), updatedAt: settings.updatedAt.toISOString() }; }
function ids(values: string[]) { return [...new Set(values.filter((id) => /^\d{5,32}$/.test(id)))]; }
