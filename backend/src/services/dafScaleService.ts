import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoDafScaleEntry,
  type MongoDafScaleRole,
  type MongoDafScaleSettings
} from "../database/mongo";

export type DafScaleSettingsPatch = Partial<Pick<MongoDafScaleSettings,
  "configRoleId" | "enabled" | "logChannelId" | "maxPilots" | "maxShooters" |
  "panelChannelId" | "panelMessageId" | "participantRoleId" | "pilotRoleId" | "shooterRoleId"
>>;

export type DafScaleMemberInput = {
  actorId?: string | null;
  actorName?: string | null;
  roleIds: string[];
  userId: string;
  username: string;
};

export type DafScaleActionResult = {
  action: "join" | "leave" | "switch" | "none";
  entry: ReturnType<typeof entryDto> | null;
  previousRole: MongoDafScaleRole | null;
  settings: ReturnType<typeof settingsDto>;
  state: Awaited<ReturnType<typeof getDafScaleState>>;
};

export async function getDafScaleState(botId: string, guildId: string) {
  const settings = await getDafScaleSettings(botId, guildId);
  const { dafScaleEntries } = await getMongoCollections();
  const entries = await dafScaleEntries.find({ botId, guildId }).sort({ role: 1, joinedAt: 1 }).toArray();
  return {
    entries: entries.map(entryDto),
    pilots: entries.filter((entry) => entry.role === "pilot").map(entryDto),
    settings: settingsDto(settings),
    shooters: entries.filter((entry) => entry.role === "shooter").map(entryDto)
  };
}

export async function getDafScaleSettings(botId: string, guildId: string) {
  const { dafScaleSettings } = await getMongoCollections();
  const existing = await dafScaleSettings.findOne({ botId, guildId });
  if (existing) return existing;
  const now = new Date();
  const settings: MongoDafScaleSettings = {
    _id: randomUUID(),
    botId,
    configRoleId: null,
    createdAt: now,
    enabled: false,
    guildId,
    logChannelId: null,
    maxPilots: 4,
    maxShooters: 6,
    panelChannelId: null,
    panelMessageId: null,
    participantRoleId: null,
    pilotRoleId: null,
    shooterRoleId: null,
    updatedAt: now,
    updatedBy: null
  };
  await dafScaleSettings.insertOne(settings);
  return settings;
}

export async function saveDafScaleSettings(botId: string, guildId: string, patch: DafScaleSettingsPatch, actorId: string | null) {
  const { dafScaleSettings } = await getMongoCollections();
  await getDafScaleSettings(botId, guildId);
  const now = new Date();
  const normalized = normalizeSettingsPatch(patch);
  await dafScaleSettings.updateOne(
    { botId, guildId },
    { $set: { ...normalized, updatedAt: now, updatedBy: actorId } }
  );
  await recordDafScaleAudit(botId, guildId, {
    action: "config",
    metadata: { patch: Object.keys(normalized) },
    previousRole: null,
    role: null,
    userId: actorId ?? "system",
    username: actorId ?? "system"
  });
  return settingsDto((await dafScaleSettings.findOne({ botId, guildId }))!);
}

export async function setDafScalePanelMessage(botId: string, guildId: string, messageId: string | null, actorId: string | null) {
  return saveDafScaleSettings(botId, guildId, { panelMessageId: messageId }, actorId);
}

export async function joinDafScale(botId: string, guildId: string, role: MongoDafScaleRole, member: DafScaleMemberInput) {
  const settings = await getDafScaleSettings(botId, guildId);
  assertEnabled(settings);
  assertMemberAllowed(settings, role, member.roleIds);
  const { dafScaleEntries } = await getMongoCollections();
  const existing = await dafScaleEntries.findOne({ botId, guildId, userId: member.userId });
  if (existing?.role === role) {
    return buildResult(botId, guildId, "none", existing, existing.role);
  }
  const count = await dafScaleEntries.countDocuments({ botId, guildId, role });
  const limit = role === "pilot" ? settings.maxPilots : settings.maxShooters;
  if (!existing && count >= limit) {
    throw serviceError(`A escala de ${roleLabelPlural(role).toLowerCase()} já atingiu o limite de ${limit}.`, 409);
  }
  const now = new Date();
  const entry: MongoDafScaleEntry = {
    _id: existing?._id ?? randomUUID(),
    botId,
    guildId,
    joinedAt: existing?.joinedAt ?? now,
    role,
    updatedAt: now,
    userId: member.userId,
    username: member.username
  };
  await dafScaleEntries.updateOne(
    { botId, guildId, userId: member.userId },
    { $set: entry },
    { upsert: true }
  );
  const action = existing ? "switch" : "join";
  await recordDafScaleAudit(botId, guildId, {
    action,
    metadata: member.actorId ? { actorId: member.actorId, actorName: member.actorName ?? null } : null,
    previousRole: existing?.role ?? null,
    role,
    userId: member.userId,
    username: member.username
  });
  return buildResult(botId, guildId, action, entry, existing?.role ?? null);
}

export async function leaveDafScale(botId: string, guildId: string, member: Pick<DafScaleMemberInput, "userId" | "username">) {
  const { dafScaleEntries } = await getMongoCollections();
  const existing = await dafScaleEntries.findOne({ botId, guildId, userId: member.userId });
  if (!existing) {
    return buildResult(botId, guildId, "none", null, null);
  }
  await dafScaleEntries.deleteOne({ botId, guildId, userId: member.userId });
  await recordDafScaleAudit(botId, guildId, {
    action: "leave",
    previousRole: existing.role,
    role: existing.role,
    userId: member.userId,
    username: member.username
  });
  return buildResult(botId, guildId, "leave", null, existing.role);
}

export async function recordDafScaleAudit(botId: string, guildId: string, input: {
  action: "join" | "leave" | "switch" | "refresh" | "publish" | "config";
  metadata?: Record<string, unknown> | null;
  previousRole: MongoDafScaleRole | null;
  role: MongoDafScaleRole | null;
  userId: string;
  username: string;
}) {
  const { dafScaleAudits } = await getMongoCollections();
  await dafScaleAudits.insertOne({
    _id: randomUUID(),
    botId,
    createdAt: new Date(),
    guildId,
    metadata: input.metadata ?? null,
    ...input
  });
}

async function buildResult(botId: string, guildId: string, action: DafScaleActionResult["action"], entry: MongoDafScaleEntry | null, previousRole: MongoDafScaleRole | null) {
  const state = await getDafScaleState(botId, guildId);
  return {
    action,
    entry: entry ? entryDto(entry) : null,
    previousRole,
    settings: state.settings,
    state
  };
}

function normalizeSettingsPatch(patch: DafScaleSettingsPatch) {
  const normalized = { ...patch };
  if (typeof normalized.maxPilots === "number") normalized.maxPilots = clampLimit(normalized.maxPilots);
  if (typeof normalized.maxShooters === "number") normalized.maxShooters = clampLimit(normalized.maxShooters);
  return normalized;
}

function clampLimit(value: number) {
  return Math.max(1, Math.min(50, Math.trunc(value)));
}

function assertEnabled(settings: MongoDafScaleSettings) {
  if (!settings.enabled) throw serviceError("O sistema de Escala DAF está desativado.", 403);
}

function assertMemberAllowed(settings: MongoDafScaleSettings, role: MongoDafScaleRole, roleIds: string[]) {
  if (settings.participantRoleId && !roleIds.includes(settings.participantRoleId)) {
    throw serviceError("Você não tem o cargo necessário para participar da Escala DAF.", 403);
  }
  if (role === "pilot" && settings.pilotRoleId && !roleIds.includes(settings.pilotRoleId)) {
    throw serviceError("Você não tem o cargo de Piloto para entrar nessa função.", 403);
  }
  if (role === "shooter" && settings.shooterRoleId && !roleIds.includes(settings.shooterRoleId)) {
    throw serviceError("Você não tem o cargo de Atirador para entrar nessa função.", 403);
  }
}

function settingsDto(settings: MongoDafScaleSettings) {
  return {
    id: settings._id,
    botId: settings.botId,
    configRoleId: settings.configRoleId ?? null,
    createdAt: settings.createdAt.toISOString(),
    enabled: settings.enabled,
    guildId: settings.guildId,
    logChannelId: settings.logChannelId ?? null,
    maxPilots: settings.maxPilots,
    maxShooters: settings.maxShooters,
    panelChannelId: settings.panelChannelId ?? null,
    panelMessageId: settings.panelMessageId ?? null,
    participantRoleId: settings.participantRoleId ?? null,
    pilotRoleId: settings.pilotRoleId ?? null,
    shooterRoleId: settings.shooterRoleId ?? null,
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedBy ?? null
  };
}

function entryDto(entry: MongoDafScaleEntry) {
  return {
    id: entry._id,
    botId: entry.botId,
    guildId: entry.guildId,
    joinedAt: entry.joinedAt.toISOString(),
    role: entry.role,
    updatedAt: entry.updatedAt.toISOString(),
    userId: entry.userId,
    username: entry.username
  };
}

function roleLabelPlural(role: MongoDafScaleRole) {
  return role === "pilot" ? "Pilotos" : "Atiradores";
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
