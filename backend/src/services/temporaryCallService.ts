import { randomUUID } from "node:crypto";
import { getMongoCollections, type MongoTemporaryCall } from "../database/mongo";
import { getBotGuildModuleConfig, updateBotGuildModuleConfig } from "./devBotService";

export type TemporaryVoiceSettings = {
  botId: string; guildId: string; enabled: boolean; panelChannelId: string | null; panelMessageId: string | null;
  categoryId: string | null; defaultUserLimit: number; emptyDeleteMinutes: number; logChannelId: string | null;
};

export async function getTemporaryVoiceSettings(botId: string, guildId: string): Promise<TemporaryVoiceSettings> {
  const module = await getBotGuildModuleConfig(botId, guildId, "temporary-voice");
  const config = module.config ?? {};
  return {
    botId, guildId, enabled: config.enabled === true,
    panelChannelId: id(config.panelChannelId), panelMessageId: id(config.panelMessageId), categoryId: id(config.categoryId),
    defaultUserLimit: integer(config.defaultUserLimit, 1, 99, 10),
    emptyDeleteMinutes: integer(config.emptyDeleteMinutes, 1, 1440, 1),
    logChannelId: id(config.logChannelId)
  };
}

export async function updateTemporaryVoicePanelState(botId: string, guildId: string, panelMessageId: string | null) {
  const current = await getBotGuildModuleConfig(botId, guildId, "temporary-voice");
  await updateBotGuildModuleConfig({ botId, guildId, guildName: `Servidor ${guildId}`, moduleId: "temporary-voice", config: { ...current.config, panelMessageId } });
  return getTemporaryVoiceSettings(botId, guildId);
}

export async function listTemporaryCalls(botId: string, guildId?: string) {
  const { temporaryCalls } = await getMongoCollections();
  return (await temporaryCalls.find({ botId, ...(guildId ? { guildId } : {}) }).toArray()).map(dto);
}

export async function getTemporaryCallByOwner(botId: string, guildId: string, ownerId: string) {
  const { temporaryCalls } = await getMongoCollections();
  const call = await temporaryCalls.findOne({ botId, guildId, ownerId });
  return call ? dto(call) : null;
}

export async function getTemporaryCallByChannel(botId: string, guildId: string, channelId: string) {
  const { temporaryCalls } = await getMongoCollections();
  const call = await temporaryCalls.findOne({ botId, guildId, channelId });
  return call ? dto(call) : null;
}

export async function createTemporaryCall(input: Omit<MongoTemporaryCall, "_id" | "createdAt" | "updatedAt" | "emptySince">) {
  const { temporaryCalls } = await getMongoCollections();
  const now = new Date();
  const call: MongoTemporaryCall = { ...input, _id: randomUUID(), allowedUsers: ids(input.allowedUsers), bannedUsers: ids(input.bannedUsers), userLimit: integer(input.userLimit, 1, 99, 10), isPrivate: input.isPrivate === true, createdAt: now, updatedAt: now, emptySince: null };
  try { await temporaryCalls.insertOne(call); }
  catch (error) { if (String(error).includes("E11000")) throw statusError("Você já possui uma call temporária ativa neste servidor.", 409); throw error; }
  return dto(call);
}

export async function updateTemporaryCall(botId: string, guildId: string, callId: string, patch: Partial<Pick<MongoTemporaryCall, "channelName" | "userLimit" | "isPrivate" | "allowedUsers" | "bannedUsers">> & { emptySince?: string | Date | null }) {
  const { temporaryCalls } = await getMongoCollections();
  const $set: Partial<MongoTemporaryCall> = { updatedAt: new Date() };
  if (patch.channelName !== undefined) $set.channelName = String(patch.channelName).trim().slice(0, 100);
  if (patch.userLimit !== undefined) $set.userLimit = integer(patch.userLimit, 1, 99, 10);
  if (patch.isPrivate !== undefined) $set.isPrivate = patch.isPrivate === true;
  if (patch.allowedUsers !== undefined) $set.allowedUsers = ids(patch.allowedUsers);
  if (patch.bannedUsers !== undefined) $set.bannedUsers = ids(patch.bannedUsers);
  if (patch.emptySince !== undefined) $set.emptySince = patch.emptySince ? new Date(patch.emptySince) : null;
  const call = await temporaryCalls.findOneAndUpdate({ _id: callId, botId, guildId }, { $set }, { returnDocument: "after" });
  if (!call) throw statusError("Call temporária não encontrada.", 404);
  return dto(call);
}

export async function deleteTemporaryCall(botId: string, guildId: string, callId: string) {
  const { temporaryCalls } = await getMongoCollections();
  const call = await temporaryCalls.findOneAndDelete({ _id: callId, botId, guildId });
  if (!call) throw statusError("Call temporária não encontrada.", 404);
  return dto(call);
}

function dto(call: MongoTemporaryCall) { return { ...call, id: call._id, createdAt: call.createdAt.toISOString(), updatedAt: call.updatedAt.toISOString(), emptySince: call.emptySince?.toISOString() ?? null }; }
function id(value: unknown) { return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null; }
function ids(values: unknown) { return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === "string" && /^\d{5,32}$/.test(value)))] : []; }
function integer(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function statusError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }
