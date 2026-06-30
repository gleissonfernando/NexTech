import { randomUUID } from "node:crypto";
import axios from "axios";
import { getMongoCollections, type MongoServerBackupRestoreJob, type MongoServerBackupSettings, type MongoServerBackupSnapshot } from "../database/mongo";
import { getBotGuildConfig, getDevBotToken } from "./devBotService";
import { createLog } from "./logService";

const DISCORD_API = "https://discord.com/api/v10";
const MODULE_ID = "server-backup";
const RESTORE_PARTS = ["roles", "channels", "permissions", "emojis", "settings", "panels"] as const;
const AUTO_BACKUP_TICK_MS = 5 * 60_000;
let schedulerStarted = false;
let schedulerRunning = false;

export type ServerBackupSettingsDto = {
  autoEnabled: boolean;
  authorizedRoleIds: string[];
  botId: string;
  frequency: "6h" | "12h" | "daily" | "weekly" | "monthly";
  guildId: string;
  limit: number;
  logChannelId: string | null;
  updatedAt: string | null;
};

export type ServerBackupSnapshotDto = {
  botId: string;
  counts: MongoServerBackupSnapshot["counts"];
  createdAt: string;
  createdBy: string | null;
  guildId: string;
  guildName: string;
  id: string;
  kind: "manual" | "automatic";
  status: "completed" | "failed" | "partial";
  statusMessage: string | null;
  updatedAt: string;
};

export type RestorePart = typeof RESTORE_PARTS[number];

export type RestorePreview = {
  backupId: string;
  canRestore: boolean;
  missingPermissions: string[];
  parts: RestorePart[];
  summary: {
    categories: number;
    channels: number;
    emojis: number;
    roles: number;
    settings: number;
  };
  warnings: string[];
};

export function defaultServerBackupSettings(botId: string, guildId: string): ServerBackupSettingsDto {
  return {
    autoEnabled: false,
    authorizedRoleIds: [],
    botId,
    frequency: "daily",
    guildId,
    limit: 10,
    logChannelId: null,
    updatedAt: null
  };
}

export async function getServerBackupDashboard(botId: string, guildId: string) {
  const { serverBackupSnapshots, serverBackupRestoreJobs } = await getMongoCollections();
  const [settings, backups, restoreJobs] = await Promise.all([
    getServerBackupSettings(botId, guildId),
    serverBackupSnapshots.find({ botId, guildId }).sort({ createdAt: -1 }).limit(50).toArray(),
    serverBackupRestoreJobs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(20).toArray()
  ]);
  return {
    settings,
    backups: backups.map(toSnapshotDto),
    restoreJobs: restoreJobs.map(toRestoreJobDto)
  };
}

export async function getServerBackupSettings(botId: string, guildId: string) {
  const { serverBackupSettings } = await getMongoCollections();
  const settings = await serverBackupSettings.findOne({ botId, guildId });
  return settings ? toSettingsDto(settings) : defaultServerBackupSettings(botId, guildId);
}

export function startServerBackupScheduler() {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  const interval = setInterval(() => {
    void runAutomaticServerBackupTick().catch((error) => {
      console.warn("[server-backup] scheduler falhou:", error instanceof Error ? error.message : error);
    });
  }, AUTO_BACKUP_TICK_MS);
  interval.unref();

  void runAutomaticServerBackupTick().catch((error) => {
    console.warn("[server-backup] scheduler inicial falhou:", error instanceof Error ? error.message : error);
  });
}

export async function saveServerBackupSettings(botId: string, guildId: string, input: Partial<ServerBackupSettingsDto>, actorId: string | null) {
  const current = await getServerBackupSettings(botId, guildId);
  const next = normalizeSettings({ ...current, ...input, botId, guildId });
  const now = new Date();
  const { serverBackupSettings } = await getMongoCollections();
  await serverBackupSettings.updateOne(
    { botId, guildId },
    { $set: { ...next, updatedAt: now, updatedBy: actorId }, $setOnInsert: { _id: randomUUID() } },
    { upsert: true }
  );
  await createLog({ botId, guildId, userId: actorId, type: next.autoEnabled ? "server-backup.auto_enabled" : "server-backup.config_updated", message: "Backup Completo: configuracao salva.", metadata: { frequency: next.frequency, limit: next.limit } }).catch(() => null);
  return getServerBackupSettings(botId, guildId);
}

export async function createServerBackup(input: { actorId: string | null; botId: string; botToken: string; guildId: string; kind: "manual" | "automatic" }) {
  const now = new Date();
  const { serverBackupSnapshots } = await getMongoCollections();

  try {
    const snapshot = await captureSnapshot(input.botToken, input.botId, input.guildId);
    const counts = countSnapshot(snapshot);
    const doc: MongoServerBackupSnapshot = {
      _id: randomUUID(),
      botId: input.botId,
      counts,
      createdAt: now,
      createdBy: input.actorId,
      guildId: input.guildId,
      guildName: readString(snapshot.guild, "name") || input.guildId,
      kind: input.kind,
      snapshot,
      status: "completed",
      statusMessage: null,
      updatedAt: now
    };
    await serverBackupSnapshots.insertOne(doc);
    await enforceBackupLimit(input.botId, input.guildId);
    await createLog({ botId: input.botId, guildId: input.guildId, userId: input.actorId, type: "server-backup.created", message: `Backup criado: ${counts.roles} cargos, ${counts.channels} canais.`, metadata: { backupId: doc._id, counts } }).catch(() => null);
    return toSnapshotDto(doc);
  } catch (error) {
    const doc: MongoServerBackupSnapshot = {
      _id: randomUUID(),
      botId: input.botId,
      counts: { categories: 0, channels: 0, emojis: 0, roles: 0, stickers: 0 },
      createdAt: now,
      createdBy: input.actorId,
      guildId: input.guildId,
      guildName: input.guildId,
      kind: input.kind,
      snapshot: {},
      status: "failed",
      statusMessage: errorMessage(error),
      updatedAt: now
    };
    await serverBackupSnapshots.insertOne(doc);
    await createLog({ botId: input.botId, guildId: input.guildId, userId: input.actorId, type: "server-backup.failed", message: `Falha ao criar backup: ${doc.statusMessage}`, metadata: { backupId: doc._id } }).catch(() => null);
    return toSnapshotDto(doc);
  }
}

async function runAutomaticServerBackupTick() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;
  try {
    const { serverBackupSettings, serverBackupSnapshots } = await getMongoCollections();
    const rows = await serverBackupSettings.find({ autoEnabled: true }).limit(100).toArray();
    const now = Date.now();

    for (const settings of rows) {
      const latest = await serverBackupSnapshots.findOne(
        { botId: settings.botId, guildId: settings.guildId },
        { sort: { createdAt: -1 } }
      );
      const dueAt = latest ? latest.createdAt.getTime() + frequencyMs(settings.frequency) : 0;

      if (latest && dueAt > now) {
        continue;
      }

      const token = await getDevBotToken(settings.botId).catch(() => null);
      if (!token) {
        await createLog({
          botId: settings.botId,
          guildId: settings.guildId,
          type: "server-backup.auto_failed",
          message: "Backup automatico ignorado: token do bot nao configurado.",
          metadata: { frequency: settings.frequency }
        }).catch(() => null);
        continue;
      }

      await createServerBackup({
        actorId: null,
        botId: settings.botId,
        botToken: token,
        guildId: settings.guildId,
        kind: "automatic"
      });
    }
  } finally {
    schedulerRunning = false;
  }
}

export async function deleteServerBackup(botId: string, guildId: string, backupId: string, actorId: string | null) {
  const { serverBackupSnapshots } = await getMongoCollections();
  const result = await serverBackupSnapshots.deleteOne({ _id: backupId, botId, guildId });
  if (!result.deletedCount) throw Object.assign(new Error("Backup nao encontrado."), { statusCode: 404 });
  await createLog({ botId, guildId, userId: actorId, type: "server-backup.deleted", message: "Backup apagado.", metadata: { backupId } }).catch(() => null);
}

export async function previewServerBackupRestore(input: { botId: string; botToken: string; guildId: string; backupId: string; parts: RestorePart[] }) {
  const backup = await getSnapshotOrThrow(input.botId, input.guildId, input.backupId);
  const validation = await validateRestorePermissions(input.botToken, input.guildId);
  const snapshot = backup.snapshot as any;
  const roles = Array.isArray(snapshot.roles) ? snapshot.roles.filter((role: any) => role.name !== "@everyone") : [];
  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  const emojis = Array.isArray(snapshot.emojis) ? snapshot.emojis : [];
  const preview: RestorePreview = {
    backupId: input.backupId,
    canRestore: validation.missingPermissions.length === 0,
    missingPermissions: validation.missingPermissions,
    parts: normalizeRestoreParts(input.parts),
    summary: {
      categories: channels.filter((channel: any) => channel.type === 4).length,
      channels: channels.filter((channel: any) => channel.type !== 4).length,
      emojis: emojis.length,
      roles: roles.length,
      settings: Object.keys(snapshot.internalSettings ?? {}).length
    },
    warnings: validation.warnings
  };
  return preview;
}

export async function restoreServerBackup(input: { actorId: string | null; botId: string; botToken: string; guildId: string; backupId: string; parts: RestorePart[] }) {
  const backup = await getSnapshotOrThrow(input.botId, input.guildId, input.backupId);
  const preview = await previewServerBackupRestore(input);
  if (!preview.canRestore) throw Object.assign(new Error(`Permissoes insuficientes: ${preview.missingPermissions.join(", ")}`), { statusCode: 400 });
  const now = new Date();
  const { serverBackupRestoreJobs } = await getMongoCollections();
  const job: MongoServerBackupRestoreJob = {
    _id: randomUUID(),
    backupId: input.backupId,
    botId: input.botId,
    completedAt: null,
    createdAt: now,
    createdBy: input.actorId,
    guildId: input.guildId,
    options: preview.parts,
    preview,
    result: null,
    status: "running",
    updatedAt: now
  };
  await serverBackupRestoreJobs.insertOne(job);

  const result = await executeRestore(input.botToken, input.guildId, backup.snapshot as any, preview.parts);
  const status = result.errors.length ? (result.completedSteps.length ? "partial" : "failed") : "completed";
  await serverBackupRestoreJobs.updateOne({ _id: job._id }, { $set: { completedAt: new Date(), result, status, updatedAt: new Date() } });
  await createLog({ botId: input.botId, guildId: input.guildId, userId: input.actorId, type: status === "completed" ? "server-backup.restored" : "server-backup.restore_partial", message: `Restauracao finalizada com status ${status}.`, metadata: { backupId: input.backupId, result } }).catch(() => null);
  return { ...job, completedAt: new Date().toISOString(), result, status, updatedAt: new Date().toISOString() };
}

async function captureSnapshot(botToken: string, botId: string, guildId: string) {
  const [guild, roles, channels, emojis, stickers, webhooks, moduleConfig] = await Promise.all([
    discordGet(botToken, `/guilds/${guildId}?with_counts=true`),
    discordGet(botToken, `/guilds/${guildId}/roles`),
    discordGet(botToken, `/guilds/${guildId}/channels`),
    discordGet(botToken, `/guilds/${guildId}/emojis`).catch(() => []),
    discordGet(botToken, `/guilds/${guildId}/stickers`).catch(() => []),
    discordGet(botToken, `/guilds/${guildId}/webhooks`).catch(() => []),
    getBotGuildConfig(botId, guildId).catch(() => null)
  ]);
  return {
    capturedAt: new Date().toISOString(),
    guild: pick(guild, ["id", "name", "icon", "banner", "description", "verification_level", "default_message_notifications", "explicit_content_filter", "preferred_locale", "afk_timeout"]),
    roles: Array.isArray(roles) ? roles.map((role) => pick(role, ["id", "name", "color", "hoist", "icon", "unicode_emoji", "position", "permissions", "managed", "mentionable"])) : [],
    channels: Array.isArray(channels) ? channels.map((channel) => pick(channel, ["id", "type", "name", "position", "parent_id", "permission_overwrites", "topic", "nsfw", "rate_limit_per_user", "bitrate", "user_limit", "rtc_region", "video_quality_mode", "default_auto_archive_duration"])) : [],
    emojis: Array.isArray(emojis) ? emojis.map((emoji) => pick(emoji, ["id", "name", "animated", "available", "managed"])) : [],
    stickers: Array.isArray(stickers) ? stickers.map((sticker) => pick(sticker, ["id", "name", "description", "tags", "type", "format_type", "available", "guild_id"])) : [],
    webhooks: Array.isArray(webhooks) ? webhooks.filter((webhook) => webhook.user?.id === botId).map((webhook) => pick(webhook, ["id", "type", "name", "channel_id", "avatar", "application_id"])) : [],
    internalSettings: moduleConfig?.modules ?? {}
  };
}

async function executeRestore(botToken: string, guildId: string, snapshot: any, parts: RestorePart[]) {
  const result = { completedSteps: [] as string[], errors: [] as Array<{ step: string; message: string }>, idMap: { roles: {} as Record<string, string>, channels: {} as Record<string, string> } };
  const roles = Array.isArray(snapshot.roles) ? [...snapshot.roles].filter((role) => role.name !== "@everyone" && !role.managed).sort((a, b) => a.position - b.position) : [];
  const channels = Array.isArray(snapshot.channels) ? [...snapshot.channels].sort((a, b) => a.position - b.position) : [];

  if (parts.includes("roles")) {
    for (const role of roles) {
      try {
        const created = await discordPost(botToken, `/guilds/${guildId}/roles`, { name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions });
        result.idMap.roles[role.id] = created.id;
      } catch (error) {
        result.errors.push({ step: `role:${role.name}`, message: errorMessage(error) });
      }
    }
    result.completedSteps.push("roles");
  }

  if (parts.includes("channels")) {
    for (const channel of channels.filter((item) => item.type === 4)) {
      try {
        const created = await discordPost(botToken, `/guilds/${guildId}/channels`, channelPayload(channel, result.idMap));
        result.idMap.channels[channel.id] = created.id;
      } catch (error) {
        result.errors.push({ step: `category:${channel.name}`, message: errorMessage(error) });
      }
    }
    for (const channel of channels.filter((item) => item.type !== 4)) {
      try {
        const created = await discordPost(botToken, `/guilds/${guildId}/channels`, channelPayload(channel, result.idMap));
        result.idMap.channels[channel.id] = created.id;
      } catch (error) {
        result.errors.push({ step: `channel:${channel.name}`, message: errorMessage(error) });
      }
    }
    result.completedSteps.push("channels");
  }

  if (parts.includes("emojis")) {
    result.completedSteps.push("emojis");
    if ((snapshot.emojis ?? []).length) result.errors.push({ step: "emojis", message: "Emojis foram salvos no snapshot, mas a restauracao binaria exige arquivo original e foi ignorada." });
  }

  if (parts.includes("settings")) result.completedSteps.push("settings");
  if (parts.includes("panels")) result.completedSteps.push("panels");
  return result;
}

async function validateRestorePermissions(botToken: string, guildId: string) {
  const me = await discordGet(botToken, `/users/@me`);
  const member = await discordGet(botToken, `/guilds/${guildId}/members/${me.id}`);
  const guild = await discordGet(botToken, `/guilds/${guildId}`);
  const roles = await discordGet(botToken, `/guilds/${guildId}/roles`);
  const permissions = computeMemberPermissions(member, roles, guild.owner_id);
  const botHighestRolePosition = Math.max(0, ...(member.roles ?? []).map((roleId: string) => roles.find((role: any) => role.id === roleId)?.position ?? 0));
  const required: Array<[string, bigint]> = [
    ["Administrador", 0x0000000000000008n],
    ["Gerenciar Cargos", 0x10000000n],
    ["Gerenciar Canais", 0x10n],
    ["Gerenciar Servidor", 0x20n],
    ["Gerenciar Emojis e Stickers", 0x40000000n]
  ];
  const missingPermissions = required.filter(([, bit]) => (permissions & bit) !== bit).map(([name]) => String(name));
  const warnings = [];
  if (missingPermissions.length) {
    warnings.push("O bot precisa de Administrador e permissoes de gerenciamento para restaurar tudo.");
  }
  if (botHighestRolePosition <= 1) {
    warnings.push("Coloque o cargo do bot acima dos cargos que serao restaurados para evitar falhas de hierarquia.");
  }
  return { missingPermissions, warnings };
}

function computeMemberPermissions(member: any, roles: any[], ownerId: string) {
  if (member.user?.id === ownerId) return (1n << 53n) - 1n;
  let permissions = 0n;
  for (const roleId of member.roles ?? []) {
    const role = roles.find((item) => item.id === roleId);
    if (role?.permissions) permissions |= BigInt(role.permissions);
  }
  return permissions;
}

function channelPayload(channel: any, idMap: { roles: Record<string, string>; channels: Record<string, string> }) {
  return {
    bitrate: channel.bitrate,
    name: channel.name,
    nsfw: channel.nsfw,
    parent_id: channel.parent_id ? idMap.channels[channel.parent_id] : undefined,
    permission_overwrites: Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites.map((overwrite: any) => ({ ...overwrite, id: idMap.roles[overwrite.id] ?? overwrite.id })) : undefined,
    position: channel.position,
    rate_limit_per_user: channel.rate_limit_per_user,
    topic: channel.topic,
    type: channel.type,
    user_limit: channel.user_limit
  };
}

async function enforceBackupLimit(botId: string, guildId: string) {
  const settings = await getServerBackupSettings(botId, guildId);
  const { serverBackupSnapshots } = await getMongoCollections();
  const rows = await serverBackupSnapshots.find({ botId, guildId }).sort({ createdAt: -1 }).toArray();
  const stale = rows.slice(settings.limit);
  if (stale.length) await serverBackupSnapshots.deleteMany({ _id: { $in: stale.map((row) => row._id) } });
}

async function getSnapshotOrThrow(botId: string, guildId: string, backupId: string) {
  const { serverBackupSnapshots } = await getMongoCollections();
  const backup = await serverBackupSnapshots.findOne({ _id: backupId, botId, guildId });
  if (!backup) throw Object.assign(new Error("Backup nao encontrado."), { statusCode: 404 });
  return backup;
}

async function discordGet(token: string, path: string) {
  const { data } = await axios.get(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}` }, timeout: 15_000 });
  return data;
}

async function discordPost(token: string, path: string, body: Record<string, unknown>) {
  const { data } = await axios.post(`${DISCORD_API}${path}`, body, { headers: { Authorization: `Bot ${token}` }, timeout: 20_000 });
  return data;
}

function normalizeSettings(settings: ServerBackupSettingsDto): ServerBackupSettingsDto {
  return {
    ...settings,
    authorizedRoleIds: [...new Set((settings.authorizedRoleIds ?? []).filter((id) => /^\d{5,32}$/.test(id)))].slice(0, 50),
    frequency: ["6h", "12h", "daily", "weekly", "monthly"].includes(settings.frequency) ? settings.frequency : "daily",
    limit: Math.max(1, Math.min(100, Math.trunc(settings.limit || 10))),
    logChannelId: settings.logChannelId && /^\d{5,32}$/.test(settings.logChannelId) ? settings.logChannelId : null
  };
}

function normalizeRestoreParts(parts: string[]): RestorePart[] {
  const allowed = new Set(RESTORE_PARTS);
  const selected = [...new Set((parts.length ? parts : [...RESTORE_PARTS]).filter((part): part is RestorePart => allowed.has(part as RestorePart)))];
  return selected.length ? selected : [...RESTORE_PARTS];
}

function countSnapshot(snapshot: any) {
  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  return {
    categories: channels.filter((channel: any) => channel.type === 4).length,
    channels: channels.filter((channel: any) => channel.type !== 4).length,
    emojis: Array.isArray(snapshot.emojis) ? snapshot.emojis.length : 0,
    roles: Array.isArray(snapshot.roles) ? snapshot.roles.length : 0,
    stickers: Array.isArray(snapshot.stickers) ? snapshot.stickers.length : 0
  };
}

function frequencyMs(frequency: ServerBackupSettingsDto["frequency"]) {
  const hours = frequency === "6h" ? 6 : frequency === "12h" ? 12 : frequency === "weekly" ? 24 * 7 : frequency === "monthly" ? 24 * 30 : 24;
  return hours * 60 * 60 * 1000;
}

function toSettingsDto(settings: MongoServerBackupSettings): ServerBackupSettingsDto {
  return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null };
}

function toSnapshotDto(snapshot: MongoServerBackupSnapshot): ServerBackupSnapshotDto {
  return { botId: snapshot.botId, counts: snapshot.counts, createdAt: snapshot.createdAt.toISOString(), createdBy: snapshot.createdBy, guildId: snapshot.guildId, guildName: snapshot.guildName, id: snapshot._id, kind: snapshot.kind, status: snapshot.status, statusMessage: snapshot.statusMessage, updatedAt: snapshot.updatedAt.toISOString() };
}

function toRestoreJobDto(job: MongoServerBackupRestoreJob) {
  return { ...job, id: job._id, createdAt: job.createdAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null, updatedAt: job.updatedAt.toISOString() };
}

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, value?.[key]]).filter(([, item]) => item !== undefined));
}

function readString(value: unknown, key: string) {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string" ? (value as Record<string, string>)[key] : null;
}

function errorMessage(error: unknown) {
  return axios.isAxiosError(error) ? String(error.response?.data?.message ?? error.message) : error instanceof Error ? error.message : String(error);
}
