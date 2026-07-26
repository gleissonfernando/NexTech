import { createHash, randomUUID } from "node:crypto";
import axios from "axios";
import { getMongoCollections, type MongoServerBackupRestoreJob, type MongoServerBackupSettings, type MongoServerBackupSnapshot } from "../database/mongo";
import { dashboardLogRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { getBotGuildConfig, getDevBotToken, updateBotGuildConfig } from "./devBotService";
import { createLog } from "./logService";
import { enqueueBackgroundJob, type BackgroundJobContext } from "./backgroundJobService";

const DISCORD_API = "https://discord.com/api/v10";
const MODULE_ID = "server-backup";
const RESTORE_PARTS = ["roles", "channels", "permissions", "messages", "emojis", "stickers", "settings", "panels"] as const;
const RESTORE_MODES = ["merge", "missing", "replace", "clear"] as const;
const SNAPSHOT_VERSION = 2;
const MAX_EMBEDDED_ASSET_BYTES = 7 * 1024 * 1024;
const MAX_SINGLE_ASSET_BYTES = 1024 * 1024;
const MESSAGE_CLONE_LIMIT_PER_CHANNEL = Math.max(1, Math.min(100, Number(process.env.SERVER_BACKUP_MESSAGE_LIMIT_PER_CHANNEL ?? 50)));
const MESSAGE_REPLAY_DELAY_MS = 1250;
const SERVICE_STARTED_AT = new Date();
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
  checksum: string | null;
  counts: MongoServerBackupSnapshot["counts"];
  createdAt: string;
  createdBy: string | null;
  guildId: string;
  guildName: string;
  id: string;
  kind: "manual" | "automatic";
  snapshotVersion: number;
  status: "pending" | "completed" | "failed" | "partial";
  statusMessage: string | null;
  updatedAt: string;
};

export type RestorePart = typeof RESTORE_PARTS[number];
export type RestoreMode = typeof RESTORE_MODES[number];

type RestoreResult = {
  completedSteps: string[];
  durationMs: number;
  errors: Array<{ step: string; message: string }>;
  idMap: {
    categories: Record<string, string>;
    channels: Record<string, string>;
    emojis: Record<string, string>;
    roles: Record<string, string>;
    stickers: Record<string, string>;
  };
  progressPercent: number;
  progress: Array<{ at: string; message: string; status: "running" | "completed" | "warning" | "failed"; step: string }>;
  summary: { roles: number; categories: number; channels: number; permissions: number; messages: number; emojis: number; stickers: number; settings: number; reused: number; failed: number };
};

export type RestorePreview = {
  backupId: string;
  canRestore: boolean;
  missingPermissions: string[];
  mode: RestoreMode;
  parts: RestorePart[];
  sourceGuildId: string;
  summary: {
    categories: number;
    channels: number;
    messages: number;
    emojis: number;
    roles: number;
    settings: number;
    stickers: number;
  };
  targetGuildId: string;
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
    serverBackupRestoreJobs.find({ botId, $or: [{ guildId }, { sourceGuildId: guildId }, { targetGuildId: guildId }] }).sort({ createdAt: -1 }).limit(20).toArray()
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
  void backfillServerBackupRestoreJobs().catch((error) => {
    console.warn("[server-backup] falha ao recuperar restauracoes interrompidas:", errorMessage(error));
  });
  const interval = setInterval(() => {
    void Promise.all([runAutomaticServerBackupTick(), backfillServerBackupRestoreJobs()]).catch((error) => {
      console.warn("[server-backup] scheduler falhou:", error instanceof Error ? error.message : error);
    });
  }, AUTO_BACKUP_TICK_MS);
  interval.unref();

  void runAutomaticServerBackupTick().catch((error) => {
    console.warn("[server-backup] scheduler inicial falhou:", error instanceof Error ? error.message : error);
  });
}

export async function backfillServerBackupRestoreJobs() {
  const { serverBackupRestoreJobs, serverBackupSnapshots } = await getMongoCollections();
  const staleBefore = new Date(Math.min(SERVICE_STARTED_AT.getTime(), Date.now() - 10 * 60_000));
  const jobs = await serverBackupRestoreJobs.find({
    $or: [
      { status: "pending" },
      { status: "running", updatedAt: { $lt: staleBefore } }
    ]
  }).limit(100).toArray();
  for (const job of jobs) {
    if (job.status === "running") {
      await serverBackupRestoreJobs.updateOne(
        { _id: job._id, status: "running", updatedAt: job.updatedAt },
        { $set: { status: "pending", updatedAt: new Date() } }
      );
    }
    await enqueueBackgroundJob({
      idempotencyKey: job._id,
      maxAttempts: 3,
      payload: { restoreJobId: job._id },
      priority: 20,
      reviveTerminal: true,
      type: "server-backup.restore"
    });
  }
  const pendingSnapshots = await serverBackupSnapshots.find({ status: "pending" }).limit(100).toArray();
  for (const snapshot of pendingSnapshots) {
    await enqueueBackgroundJob({
      idempotencyKey: snapshot._id,
      maxAttempts: 3,
      payload: { snapshotId: snapshot._id },
      priority: snapshot.kind === "manual" ? 10 : 0,
      reviveTerminal: true,
      type: "server-backup.capture"
    });
  }
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
  await createLog({ botId, guildId, userId: actorId, type: next.autoEnabled ? "server-backup.auto_enabled" : "server-backup.config_updated", message: "Backup Completo: configuração salva.", metadata: { frequency: next.frequency, limit: next.limit } }).catch(() => null);
  return getServerBackupSettings(botId, guildId);
}

export async function createServerBackup(input: { actorId: string | null; botId: string; botToken: string; guildId: string; kind: "manual" | "automatic" }) {
  const now = new Date();
  const { serverBackupSnapshots } = await getMongoCollections();
  const interval = input.kind === "automatic" ? frequencyMs((await getServerBackupSettings(input.botId, input.guildId)).frequency) : 0;
  const bucket = interval ? Math.floor(now.getTime() / interval) : null;
  const snapshotId = bucket === null
    ? randomUUID()
    : createHash("sha256").update(`auto:${input.botId}:${input.guildId}:${bucket}`).digest("hex");
  const pending: MongoServerBackupSnapshot = {
    _id: snapshotId,
    botId: input.botId,
    checksum: null,
    counts: { categories: 0, channels: 0, emojis: 0, roles: 0, stickers: 0 },
    createdAt: now,
    createdBy: input.actorId,
    guildId: input.guildId,
    guildName: input.guildId,
    kind: input.kind,
    snapshotVersion: SNAPSHOT_VERSION,
    snapshot: {},
    status: "pending",
    statusMessage: "Backup aguardando processamento.",
    updatedAt: now
  };
  await serverBackupSnapshots.updateOne({ _id: snapshotId }, { $setOnInsert: pending }, { upsert: true });
  await enqueueBackgroundJob({
    idempotencyKey: snapshotId,
    maxAttempts: 3,
    payload: { snapshotId },
    priority: input.kind === "manual" ? 10 : 0,
    type: "server-backup.capture"
  });
  return toSnapshotDto(await serverBackupSnapshots.findOne({ _id: snapshotId }) ?? pending);
}

export async function processQueuedServerBackupCapture(payload: Record<string, unknown>, context: BackgroundJobContext) {
  const snapshotId = typeof payload.snapshotId === "string" ? payload.snapshotId : null;
  if (!snapshotId) throw new Error("Job de backup sem snapshotId.");
  const { serverBackupSnapshots } = await getMongoCollections();
  const pending = await serverBackupSnapshots.findOne({ _id: snapshotId });
  if (!pending) throw new Error(`Snapshot ${snapshotId} não encontrado.`);
  if (pending.status === "completed" || pending.status === "partial") return;
  const botToken = await getDevBotToken(pending.botId);
  if (!botToken) throw new Error("Token do bot não configurado para criar backup.");

  try {
    const snapshot = await captureSnapshot(botToken, pending.botId, pending.guildId);
    const counts = countSnapshot(snapshot);
    const assetWarnings = Array.isArray(snapshot.assetWarnings) ? snapshot.assetWarnings : [];
    const checksum = snapshotChecksum(snapshot);
    const updatedAt = new Date();
    const status = assetWarnings.length ? "partial" as const : "completed" as const;
    await serverBackupSnapshots.updateOne(
      { _id: snapshotId },
      { $set: { checksum, counts, guildName: readString(snapshot.guild, "name") || pending.guildId, snapshot, snapshotVersion: SNAPSHOT_VERSION, status, statusMessage: assetWarnings.length ? `${assetWarnings.length} mídia(s) não puderam ser incorporadas ao snapshot.` : null, updatedAt } }
    );
    const updatedSnapshot = await serverBackupSnapshots.findOne({ _id: snapshotId });
    if (updatedSnapshot) {
      emitRealtimeToRoom(dashboardLogRealtimeRoom(pending.guildId, pending.botId), "server-backup:snapshot_updated", toSnapshotDto(updatedSnapshot));
    }
    await enforceBackupLimit(pending.botId, pending.guildId);
    await createLog({
      botId: pending.botId,
      guildId: pending.guildId,
      userId: pending.createdBy,
      type: status === "completed" ? "server-backup.created" : "server-backup.created_partial",
      message: `Backup ${status === "completed" ? "criado" : "criado com avisos"}: ${counts.roles} cargos, ${counts.channels} canais, ${counts.messages} mensagens, ${counts.emojis} emojis e ${counts.stickers} stickers.`,
      metadata: { attempt: context.attempt, backupId: snapshotId, checksum, counts, snapshotVersion: SNAPSHOT_VERSION, warnings: assetWarnings }
    }).catch(() => null);
  } catch (error) {
    const terminal = context.attempt >= context.maxAttempts;
    await serverBackupSnapshots.updateOne(
      { _id: snapshotId },
      { $set: { status: terminal ? "failed" : "pending", statusMessage: errorMessage(error), updatedAt: new Date() } }
    );
    const failedSnapshot = await serverBackupSnapshots.findOne({ _id: snapshotId });
    if (failedSnapshot) {
      emitRealtimeToRoom(dashboardLogRealtimeRoom(pending.guildId, pending.botId), "server-backup:snapshot_updated", toSnapshotDto(failedSnapshot));
    }
    if (terminal) {
      await createLog({ botId: pending.botId, guildId: pending.guildId, userId: pending.createdBy, type: "server-backup.failed", message: `Falha ao criar backup: ${errorMessage(error)}`, metadata: { attempt: context.attempt, backupId: snapshotId } }).catch(() => null);
    }
    throw error;
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
          message: "Backup automático ignorado: token do bot não configurado.",
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
  if (!result.deletedCount) throw Object.assign(new Error("Backup não encontrado."), { statusCode: 404 });
  await createLog({ botId, guildId, userId: actorId, type: "server-backup.deleted", message: "Backup apagado.", metadata: { backupId } }).catch(() => null);
}

export async function isStoredServerBackupOwner(botId: string, guildId: string, backupId: string, userIds: string[]) {
  const { serverBackupSnapshots } = await getMongoCollections();
  const normalizedUserIds = [...new Set(userIds.map((item) => item.trim()).filter(Boolean))];
  if (!normalizedUserIds.length) return false;
  return Boolean(await serverBackupSnapshots.findOne(
    { _id: backupId, botId, guildId, createdBy: { $in: normalizedUserIds } },
    { projection: { _id: 1 } }
  ));
}

export async function previewServerBackupRestore(input: { botId: string; botToken: string; guildId: string; backupId: string; parts: RestorePart[]; targetGuildId?: string | null; mode?: RestoreMode | null }) {
  const backup = await getSnapshotOrThrow(input.botId, input.guildId, input.backupId);
  const targetGuildId = input.targetGuildId || input.guildId;
  const parts = normalizeRestoreParts(input.parts);
  const mode = normalizeRestoreMode(input.mode);
  const validation = await validateRestorePermissions(input.botToken, targetGuildId, parts, mode);
  const snapshot = backup.snapshot as any;
  const roles = Array.isArray(snapshot.roles) ? snapshot.roles.filter((role: any) => role.name !== "@everyone") : [];
  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  const emojis = Array.isArray(snapshot.emojis) ? snapshot.emojis : [];
  const messages = countSnapshotMessages(snapshot.messages);
  const preview: RestorePreview = {
    backupId: input.backupId,
    canRestore: validation.missingPermissions.length === 0,
    missingPermissions: validation.missingPermissions,
    mode,
    parts,
    sourceGuildId: backup.guildId,
    summary: {
      categories: channels.filter((channel: any) => channel.type === 4).length,
      channels: channels.filter((channel: any) => channel.type !== 4).length,
      emojis: emojis.length,
      messages,
      roles: roles.length,
      settings: Object.keys(snapshot.internalSettings ?? {}).length,
      stickers: Array.isArray(snapshot.stickers) ? snapshot.stickers.length : 0
    },
    targetGuildId,
    warnings: validation.warnings
  };
  const assetWarnings = Array.isArray(snapshot.assetWarnings) ? snapshot.assetWarnings.filter((item: unknown): item is string => typeof item === "string") : [];
  preview.warnings.push(...assetWarnings.slice(0, 10));
  return preview;
}

export async function restoreServerBackup(input: { actorId: string | null; botId: string; botToken: string; guildId: string; backupId: string; parts: RestorePart[]; targetGuildId?: string | null; mode?: RestoreMode | null }) {
  const preview = await previewServerBackupRestore(input);
  const targetGuildId = preview.targetGuildId;
  if (!preview.canRestore) {
    throw Object.assign(new Error(`Não foi possível iniciar a restauração porque o bot não possui permissoes suficientes no servidor de destino. Conceda: ${preview.missingPermissions.join(", ")}.`), { statusCode: 400 });
  }
  const now = new Date();
  const { serverBackupRestoreJobs } = await getMongoCollections();
  const job: MongoServerBackupRestoreJob = {
    _id: randomUUID(),
    backupId: input.backupId,
    botId: input.botId,
    completedAt: null,
    createdAt: now,
    createdBy: input.actorId,
    guildId: targetGuildId,
    options: [preview.mode, ...preview.parts],
    progress: 0,
    preview,
    result: null,
    sourceGuildId: input.guildId,
    status: "pending",
    targetGuildId,
    updatedAt: now
  };
  await serverBackupRestoreJobs.insertOne(job);
  emitRestoreProgress(job, input.guildId, targetGuildId);
  await enqueueBackgroundJob({
    idempotencyKey: job._id,
    maxAttempts: 3,
    payload: { restoreJobId: job._id },
    priority: 20,
    type: "server-backup.restore"
  });

  return toRestoreJobDto(job);
}

export async function processQueuedServerBackupRestore(payload: Record<string, unknown>, context: BackgroundJobContext) {
  const restoreJobId = typeof payload.restoreJobId === "string" ? payload.restoreJobId : null;
  if (!restoreJobId) throw new Error("Job de restauração sem restoreJobId.");

  const { serverBackupRestoreJobs } = await getMongoCollections();
  const job = await serverBackupRestoreJobs.findOne({ _id: restoreJobId });
  if (!job) throw new Error(`Restauração ${restoreJobId} não encontrada.`);
  if (job.status === "completed" || job.status === "partial") return;

  const sourceGuildId = job.sourceGuildId ?? job.guildId;
  const targetGuildId = job.targetGuildId ?? job.guildId;
  const backup = await getSnapshotOrThrow(job.botId, sourceGuildId, job.backupId);
  const botToken = await getDevBotToken(job.botId);
  if (!botToken) throw new Error("Token do bot não configurado para processar a restauração.");
  const preview = job.preview as unknown as RestorePreview;
  const startedAt = new Date();
  await serverBackupRestoreJobs.updateOne(
    { _id: job._id },
    { $set: { completedAt: null, progress: job.progress ?? 0, status: "running", updatedAt: startedAt } }
  );
  const runningJob = { ...job, completedAt: null, status: "running" as const, updatedAt: startedAt };
  emitRestoreProgress(runningJob, sourceGuildId, targetGuildId);

  const persistProgress = async (result: RestoreResult) => {
    const updatedAt = new Date();
    await serverBackupRestoreJobs.updateOne(
      { _id: job._id },
      { $set: { progress: result.progressPercent, result, status: "running", updatedAt } }
    );
    emitRestoreProgress({ ...runningJob, progress: result.progressPercent, result, updatedAt }, sourceGuildId, targetGuildId);
    const latest = result.progress[result.progress.length - 1];
    await createLog({
      botId: job.botId,
      guildId: targetGuildId,
      userId: job.createdBy,
      type: "server-backup.restore_progress",
      message: latest?.message ?? `Restauração em ${result.progressPercent}%.`,
      metadata: { attempt: context.attempt, backupId: job.backupId, jobId: job._id, progress: result.progressPercent, sourceGuildId, summary: result.summary, targetGuildId }
    }).catch(() => null);
  };

  let result: RestoreResult;
  try {
    result = await executeRestore(botToken, job.botId, targetGuildId, backup.snapshot as any, normalizeRestoreParts(preview.parts), normalizeRestoreMode(preview.mode), persistProgress);
  } catch (error) {
    result = failedRestoreResult(error);
    const terminal = context.attempt >= context.maxAttempts;
    const updatedAt = new Date();
    await serverBackupRestoreJobs.updateOne(
      { _id: job._id },
      { $set: { completedAt: terminal ? updatedAt : null, progress: terminal ? 100 : result.progressPercent, result, status: terminal ? "failed" : "pending", updatedAt } }
    );
    emitRestoreProgress({ ...runningJob, completedAt: terminal ? updatedAt : null, progress: terminal ? 100 : result.progressPercent, result, status: terminal ? "failed" : "pending", updatedAt }, sourceGuildId, targetGuildId);
    throw error;
  }

  const status = result.errors.length ? (result.completedSteps.length ? "partial" : "failed") : "completed";
  const completedAt = new Date();
  await serverBackupRestoreJobs.updateOne({ _id: job._id }, { $set: { completedAt, progress: 100, result, status, updatedAt: completedAt } });
  emitRestoreProgress({ ...runningJob, completedAt, progress: 100, result, status, updatedAt: completedAt }, sourceGuildId, targetGuildId);
  const metadata = { attempt: context.attempt, backupId: job.backupId, result, sourceGuildId, targetGuildId };
  await createLog({ botId: job.botId, guildId: targetGuildId, userId: job.createdBy, type: status === "completed" ? "server-backup.restored" : "server-backup.restore_partial", message: `Restauração finalizada com status ${status}. Origem ${sourceGuildId}, destino ${targetGuildId}.`, metadata }).catch(() => null);
  if (targetGuildId !== sourceGuildId) {
    await createLog({ botId: job.botId, guildId: sourceGuildId, userId: job.createdBy, type: "server-backup.sent_to_guild", message: `Backup enviado para restauração no servidor ${targetGuildId} com status ${status}.`, metadata }).catch(() => null);
  }
}

function failedRestoreResult(error: unknown): RestoreResult {
  const message = errorMessage(error);
  return {
    completedSteps: [],
    durationMs: 0,
    errors: [{ step: "fatal", message }],
    idMap: { categories: {}, channels: {}, emojis: {}, roles: {}, stickers: {} },
    progress: [{ at: new Date().toISOString(), message, status: "failed", step: "fatal" }],
    progressPercent: 100,
    summary: { roles: 0, categories: 0, channels: 0, permissions: 0, messages: 0, emojis: 0, stickers: 0, settings: 0, reused: 0, failed: 1 }
  };
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
  const assetBudget = { remaining: MAX_EMBEDDED_ASSET_BYTES, warnings: [] as string[] };
  const guildData = pick(guild, ["id", "name", "icon", "banner", "description", "verification_level", "default_message_notifications", "explicit_content_filter", "preferred_locale", "afk_timeout", "afk_channel_id", "system_channel_id", "rules_channel_id", "public_updates_channel_id"]);
  const capturedEmojis = await mapInBatches(Array.isArray(emojis) ? emojis : [], 5, async (emoji) => {
    const metadata = pick(emoji, ["id", "name", "animated", "available", "managed", "roles"]);
    return attachAssetData(metadata, emojiAssetUrl(emoji), assetBudget, `emoji:${emoji.name ?? emoji.id}`);
  });
  const capturedStickers = await mapInBatches(Array.isArray(stickers) ? stickers : [], 5, async (sticker) => {
    const metadata = pick(sticker, ["id", "name", "description", "tags", "type", "format_type", "available", "guild_id"]);
    return attachAssetData(metadata, stickerAssetUrl(sticker), assetBudget, `sticker:${sticker.name ?? sticker.id}`);
  });
  const capturedMessages = await captureSnapshotMessages(botToken, Array.isArray(channels) ? channels : []);
  if (typeof guild.icon === "string" && guild.icon) {
    Object.assign(guildData, await captureNamedAsset(guildIconUrl(guildId, guild.icon), assetBudget, "icone do servidor", "iconData"));
  }
  if (typeof guild.banner === "string" && guild.banner) {
    Object.assign(guildData, await captureNamedAsset(guildBannerUrl(guildId, guild.banner), assetBudget, "banner do servidor", "bannerData"));
  }

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    source: { botId, guildId },
    guild: guildData,
    roles: Array.isArray(roles) ? roles.map((role) => pick(role, ["id", "name", "color", "colors", "hoist", "icon", "unicode_emoji", "position", "permissions", "managed", "mentionable", "tags"])) : [],
    channels: Array.isArray(channels) ? channels.map((channel) => pick(channel, ["id", "type", "name", "position", "parent_id", "permission_overwrites", "topic", "nsfw", "rate_limit_per_user", "bitrate", "user_limit", "rtc_region", "video_quality_mode", "default_auto_archive_duration", "available_tags", "default_reaction_emoji", "default_thread_rate_limit_per_user", "default_sort_order", "default_forum_layout", "flags"])) : [],
    messages: capturedMessages,
    emojis: capturedEmojis,
    stickers: capturedStickers,
    webhooks: Array.isArray(webhooks) ? webhooks.map((webhook) => pick(webhook, ["id", "type", "name", "channel_id", "avatar", "application_id"])) : [],
    internalSettings: moduleConfig?.modules ?? {},
    assetWarnings: assetBudget.warnings
  };
}

async function captureSnapshotMessages(botToken: string, channels: any[]) {
  const textChannels = channels.filter((channel) => isMessageCloneableChannel(channel));
  return mapInBatches(textChannels, 2, async (channel) => {
    try {
      const messages = await discordGet(botToken, `/channels/${channel.id}/messages?limit=${MESSAGE_CLONE_LIMIT_PER_CHANNEL}`).catch(() => []);
      return {
        channelId: channel.id,
        channelName: channel.name,
        messages: Array.isArray(messages)
          ? messages
            .filter((message) => isReplayableMessage(message))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .map(snapshotMessage)
          : [],
        status: "completed"
      };
    } catch (error) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        error: errorMessage(error),
        messages: [],
        status: "failed"
      };
    }
  });
}

function isMessageCloneableChannel(channel: any) {
  return [0, 5].includes(Number(channel?.type)) && typeof channel?.id === "string";
}

function isReplayableMessage(message: any) {
  if (!message || typeof message !== "object") return false;
  if (![0, 19].includes(Number(message.type ?? 0))) return false;
  return Boolean(readString(message, "content") || (Array.isArray(message.embeds) && message.embeds.length) || (Array.isArray(message.attachments) && message.attachments.length));
}

function snapshotMessage(message: any) {
  return {
    id: readString(message, "id"),
    author: {
      avatar: message.author?.avatar ?? null,
      avatarUrl: message.author?.id && message.author?.avatar ? `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.${String(message.author.avatar).startsWith("a_") ? "gif" : "png"}?size=128` : null,
      discriminator: message.author?.discriminator ?? null,
      id: message.author?.id ?? null,
      username: String(message.author?.global_name || message.author?.username || "Usuário").slice(0, 80)
    },
    attachments: Array.isArray(message.attachments) ? message.attachments.map((attachment: any) => ({
      filename: readString(attachment, "filename"),
      url: readString(attachment, "url")
    })).filter((attachment: any) => attachment.url) : [],
    content: (readString(message, "content") ?? "").slice(0, 1800),
    createdAt: readString(message, "timestamp"),
    embeds: sanitizeEmbeds(message.embeds)
  };
}

function sanitizeEmbeds(source: unknown) {
  if (!Array.isArray(source)) return [];
  return source.slice(0, 10).map((embed) => {
    if (!embed || typeof embed !== "object") return null;
    const value = embed as Record<string, any>;
    const fields = Array.isArray(value.fields)
      ? value.fields.slice(0, 25).map((field) => ({
        inline: Boolean(field?.inline),
        name: String(field?.name ?? "Campo").slice(0, 256),
        value: String(field?.value ?? "-").slice(0, 1024)
      }))
      : undefined;
    return {
      author: value.author ? {
        icon_url: readString(value.author, "icon_url") || undefined,
        name: readString(value.author, "name") || undefined,
        url: readString(value.author, "url") || undefined
      } : undefined,
      color: Number.isFinite(value.color) ? value.color : undefined,
      description: readString(value, "description")?.slice(0, 4096) || undefined,
      fields,
      footer: value.footer ? {
        icon_url: readString(value.footer, "icon_url") || undefined,
        text: readString(value.footer, "text") || undefined
      } : undefined,
      image: value.image?.url ? { url: String(value.image.url) } : undefined,
      thumbnail: value.thumbnail?.url ? { url: String(value.thumbnail.url) } : undefined,
      timestamp: readString(value, "timestamp") || undefined,
      title: readString(value, "title")?.slice(0, 256) || undefined,
      url: readString(value, "url") || undefined
    };
  }).filter(Boolean);
}

async function mapInBatches<T, TResult>(items: T[], batchSize: number, mapper: (item: T) => Promise<TResult>) {
  const results: TResult[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    results.push(...await Promise.all(items.slice(offset, offset + batchSize).map(mapper)));
  }
  return results;
}

async function attachAssetData(metadata: Record<string, unknown>, url: string | null, budget: { remaining: number; warnings: string[] }, label: string) {
  if (!url) return { ...metadata, assetError: "URL de mídia indisponível." };
  const captured = await captureNamedAsset(url, budget, label, "data");
  return { ...metadata, ...captured };
}

async function captureNamedAsset(
  url: string,
  budget: { remaining: number; warnings: string[] },
  label: string,
  field: string
) {
  if (budget.remaining <= 0) {
    const message = `${label}: limite de mídias incorporadas atingido.`;
    budget.warnings.push(message);
    return { assetError: message };
  }

  try {
    const response = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 15_000, maxContentLength: MAX_SINGLE_ASSET_BYTES });
    const buffer = Buffer.from(response.data);
    if (!buffer.length || buffer.length > MAX_SINGLE_ASSET_BYTES || buffer.length > budget.remaining) {
      throw new Error("arquivo excede o limite seguro do snapshot");
    }
    budget.remaining -= buffer.length;
    const mime = String(response.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    return { [field]: `data:${mime};base64,${buffer.toString("base64")}` };
  } catch (error) {
    const message = `${label}: ${errorMessage(error)}.`;
    budget.warnings.push(message);
    return { assetError: message };
  }
}

function emojiAssetUrl(emoji: any) {
  return emoji?.id ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?quality=lossless` : null;
}

function stickerAssetUrl(sticker: any) {
  if (!sticker?.id) return null;
  const extension = sticker.format_type === 3 ? "json" : sticker.format_type === 4 ? "gif" : "png";
  return `https://media.discordapp.net/stickers/${sticker.id}.${extension}`;
}

function guildIconUrl(guildId: string, hash: string) {
  return `https://cdn.discordapp.com/icons/${guildId}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=1024`;
}

function guildBannerUrl(guildId: string, hash: string) {
  return `https://cdn.discordapp.com/banners/${guildId}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=1024`;
}

async function executeRestore(
  botToken: string,
  botId: string,
  guildId: string,
  snapshot: any,
  parts: RestorePart[],
  mode: RestoreMode,
  onProgress?: (result: RestoreResult) => Promise<void>
) {
  const startedAt = Date.now();
  const result: RestoreResult = {
    completedSteps: [],
    durationMs: 0,
    errors: [],
    idMap: { categories: {}, channels: {}, emojis: {}, roles: {}, stickers: {} },
    progressPercent: 0,
    progress: [],
    summary: { roles: 0, categories: 0, channels: 0, permissions: 0, messages: 0, emojis: 0, stickers: 0, settings: 0, reused: 0, failed: 0 }
  };
  addRestoreProgress(result, "start", "running", "Iniciando restauração.");
  await checkpoint(result, 5, startedAt, onProgress);
  const roles = Array.isArray(snapshot.roles) ? [...snapshot.roles].filter((role) => role.name !== "@everyone" && !role.managed && !role.tags?.bot_id).sort((a, b) => a.position - b.position) : [];
  const channels = Array.isArray(snapshot.channels) ? [...snapshot.channels].sort((a, b) => a.position - b.position) : [];
  const targetGuild = await discordGet(botToken, `/guilds/${guildId}`);
  result.idMap.roles[snapshot.guild?.id ?? ""] = guildId;
  result.idMap.roles[guildId] = guildId;
  let targetRoles = await discordGet(botToken, `/guilds/${guildId}/roles`).catch(() => []);
  let targetChannels = await discordGet(botToken, `/guilds/${guildId}/channels`).catch(() => []);
  const reusedChannelIds = new Set<string>();

  if (mode !== "clear") {
    for (const role of roles) {
      const existing = findExistingRole(targetRoles, role.name, guildId);
      if (existing) result.idMap.roles[role.id] = existing.id;
    }
    for (const category of channels.filter((item) => item.type === 4)) {
      const existing = findExistingChannel(targetChannels, category, result.idMap);
      if (existing) {
        result.idMap.channels[category.id] = existing.id;
        result.idMap.categories[category.id] = existing.id;
        reusedChannelIds.add(existing.id);
      }
    }
    for (const channel of channels.filter((item) => item.type !== 4)) {
      const existing = findExistingChannel(targetChannels, channel, result.idMap);
      if (existing) {
        result.idMap.channels[channel.id] = existing.id;
        reusedChannelIds.add(existing.id);
      }
    }
  }

  if (mode === "clear") {
    addRestoreProgress(result, "clear", "running", "Limpando servidor destino antes de restaurar.");
    await clearTargetGuild(botToken, guildId, result);
    result.completedSteps.push("clear");
    addRestoreProgress(result, "clear", "completed", "Limpeza inicial finalizada.");
    targetRoles = [];
    targetChannels = [];
    await checkpoint(result, 12, startedAt, onProgress);
  }

  if (parts.includes("roles")) {
    addRestoreProgress(result, "roles", "running", "Criando cargos.");
    for (const role of roles) {
      try {
        let existing = findExistingRole(targetRoles, role.name, guildId);
        if (existing && mode === "replace") {
          await discordDelete(botToken, `/guilds/${guildId}/roles/${existing.id}`);
          targetRoles = targetRoles.filter((item: any) => item.id !== existing.id);
          existing = null;
        }
        if (existing) {
          result.idMap.roles[role.id] = existing.id;
          result.summary.roles += 1;
          result.summary.reused += 1;
          if (mode === "merge") {
            await discordPatch(botToken, `/guilds/${guildId}/roles/${existing.id}`, rolePayload(role));
          }
          continue;
        }
        const created = await discordPost(botToken, `/guilds/${guildId}/roles`, { name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions, unicode_emoji: role.unicode_emoji });
        result.idMap.roles[role.id] = created.id;
        targetRoles.push(created);
        result.summary.roles += 1;
      } catch (error) {
        addRestoreError(result, `role:${role.name}`, `Cargo ${role.name} não foi restaurado porque esta acima do cargo do bot, e gerenciado pelo Discord ou falhou: ${errorMessage(error)}`);
      }
    }
    await restoreRolePositions(botToken, guildId, roles, result);
    result.completedSteps.push("roles");
    addRestoreProgress(result, "roles", "completed", `${result.summary.roles} cargo(s) restaurado(s).`);
    await checkpoint(result, 28, startedAt, onProgress);
  }

  if (parts.includes("channels")) {
    addRestoreProgress(result, "categories", "running", "Criando categorias.");
    for (const channel of channels.filter((item) => item.type === 4)) {
      try {
        let existing = findExistingChannel(targetChannels, channel, result.idMap);
        if (existing && mode === "replace") {
          await discordDelete(botToken, `/channels/${existing.id}`);
          targetChannels = targetChannels.filter((item: any) => item.id !== existing.id);
          existing = null;
        }
        if (existing) {
          result.idMap.channels[channel.id] = existing.id;
          result.idMap.categories[channel.id] = existing.id;
          reusedChannelIds.add(existing.id);
          result.summary.categories += 1;
          result.summary.reused += 1;
          if (mode === "merge") await discordPatch(botToken, `/channels/${existing.id}`, channelPayload(channel, result.idMap));
          continue;
        }
        const created = await discordPost(botToken, `/guilds/${guildId}/channels`, channelPayload(channel, result.idMap));
        result.idMap.channels[channel.id] = created.id;
        result.idMap.categories[channel.id] = created.id;
        targetChannels.push(created);
        result.summary.categories += 1;
      } catch (error) {
        addRestoreError(result, `category:${channel.name}`, errorMessage(error));
      }
    }
    addRestoreProgress(result, "categories", "completed", `${result.summary.categories} categoria(s) restaurada(s).`);
    await checkpoint(result, 42, startedAt, onProgress);
    addRestoreProgress(result, "channels", "running", "Criando canais.");
    for (const channel of channels.filter((item) => item.type !== 4)) {
      try {
        let existing = findExistingChannel(targetChannels, channel, result.idMap);
        if (existing && mode === "replace") {
          await discordDelete(botToken, `/channels/${existing.id}`);
          targetChannels = targetChannels.filter((item: any) => item.id !== existing.id);
          existing = null;
        }
        if (existing) {
          result.idMap.channels[channel.id] = existing.id;
          reusedChannelIds.add(existing.id);
          result.summary.channels += 1;
          result.summary.reused += 1;
          if (mode === "merge") await discordPatch(botToken, `/channels/${existing.id}`, channelPayload(channel, result.idMap));
          continue;
        }
        const created = await discordPost(botToken, `/guilds/${guildId}/channels`, channelPayload(channel, result.idMap));
        result.idMap.channels[channel.id] = created.id;
        targetChannels.push(created);
        result.summary.channels += 1;
      } catch (error) {
        addRestoreError(result, `channel:${channel.name}`, errorMessage(error));
      }
    }
    await restoreChannelPositions(botToken, guildId, channels, result);
    result.completedSteps.push("channels");
    addRestoreProgress(result, "channels", "completed", `${result.summary.channels} canal(is) restaurado(s).`);
    await checkpoint(result, 58, startedAt, onProgress);
  }

  if (parts.includes("permissions")) {
    addRestoreProgress(result, "permissions", "running", "Aplicando permissões dos canais.");
    await restoreChannelPermissions(botToken, channels, result, mode === "missing" ? reusedChannelIds : new Set());
    result.completedSteps.push("permissions");
    addRestoreProgress(result, "permissions", "completed", `${result.summary.permissions} permissão(oes) aplicada(s).`);
    await checkpoint(result, 72, startedAt, onProgress);
  }

  if (parts.includes("messages")) {
    addRestoreProgress(result, "messages", "running", "Restaurando mensagens via webhook nos canais mapeados.");
    await restoreMessages(botToken, snapshot.messages, result);
    result.completedSteps.push("messages");
    addRestoreProgress(result, "messages", "completed", `${result.summary.messages} mensagem(ns) restaurada(s).`);
    await checkpoint(result, 78, startedAt, onProgress);
  }

  if (parts.includes("emojis")) {
    addRestoreProgress(result, "emojis", "running", "Restaurando emojis incorporados ao backup.");
    await restoreEmojis(botToken, guildId, snapshot.emojis, mode, result);
    result.completedSteps.push("emojis");
    addRestoreProgress(result, "emojis", "completed", `${result.summary.emojis} emoji(s) restaurado(s).`);
    await checkpoint(result, 84, startedAt, onProgress);
  }

  if (parts.includes("stickers")) {
    addRestoreProgress(result, "stickers", "running", "Restaurando stickers incorporados ao backup.");
    await restoreStickers(botToken, guildId, snapshot.stickers, mode, result);
    result.completedSteps.push("stickers");
    addRestoreProgress(result, "stickers", "completed", `${result.summary.stickers} sticker(s) restaurado(s).`);
    await checkpoint(result, 90, startedAt, onProgress);
  }

  if (parts.includes("settings")) {
    addRestoreProgress(result, "settings", "running", "Restaurando configurações do servidor e do bot com IDs convertidos.");
    try {
      await restoreGuildSettings(botToken, guildId, snapshot.guild ?? {}, result.idMap);
      const mappedSettings = remapIdsDeep(snapshot.internalSettings ?? {}, result.idMap, collectSnapshotIds(snapshot));
      await updateBotGuildConfig({ botId, guildId, guildName: readString(targetGuild, "name") || guildId, modules: mappedSettings });
      result.summary.settings = Object.keys(mappedSettings).length;
    } catch (error) {
      addRestoreError(result, "settings", errorMessage(error));
    }
    result.completedSteps.push("settings");
    addRestoreProgress(result, "settings", "completed", `${result.summary.settings} configuração(oes) interna(s) restaurada(s).`);
    await checkpoint(result, 97, startedAt, onProgress);
  }
  if (parts.includes("panels")) {
    result.completedSteps.push("panels");
    addRestoreProgress(result, "panels", "warning", "Paineis foram marcados como restaurados no relatório; reenvio depende das configurações internas mapeadas.");
  }
  addRestoreProgress(result, "finish", result.errors.length ? "warning" : "completed", result.errors.length ? `Restauração finalizada com ${result.errors.length} falha(s).` : "Backup restaurado com sucesso.");
  await checkpoint(result, 100, startedAt, onProgress);
  return result;
}

async function validateRestorePermissions(botToken: string, guildId: string, parts: RestorePart[], mode: RestoreMode) {
  let me: any;
  let member: any;
  let guild: any;
  let roles: any[];
  try {
    me = await discordGet(botToken, `/users/@me`);
    [member, guild, roles] = await Promise.all([
      discordGet(botToken, `/guilds/${guildId}/members/${me.id}`),
      discordGet(botToken, `/guilds/${guildId}`),
      discordGet(botToken, `/guilds/${guildId}/roles`)
    ]);
  } catch {
    throw Object.assign(new Error("Não foi possível validar o servidor de destino. Confirme se o bot está no servidor informado."), { statusCode: 400 });
  }
  const permissions = computeMemberPermissions(member, roles, guild.owner_id, guildId);
  const botHighestRolePosition = Math.max(0, ...(member.roles ?? []).map((roleId: string) => roles.find((role: any) => role.id === roleId)?.position ?? 0));
  const required = new Map<string, bigint>([["Ver Canais", 0x400n]]);
  if (parts.includes("roles") || parts.includes("permissions") || mode === "clear") required.set("Gerenciar Cargos", 0x10000000n);
  if (parts.includes("channels") || parts.includes("permissions") || mode === "clear") required.set("Gerenciar Canais", 0x10n);
  if (parts.includes("settings")) required.set("Gerenciar Servidor", 0x20n);
  if (parts.includes("emojis") || parts.includes("stickers")) required.set("Gerenciar Emojis e Stickers", 0x40000000n);
  if (parts.includes("messages")) required.set("Gerenciar Webhooks", 0x20000000n);
  const administrator = (permissions & 0x8n) === 0x8n;
  const missingPermissions = administrator ? [] : [...required].filter(([, bit]) => (permissions & bit) !== bit).map(([name]) => String(name));
  if ((parts.includes("roles") || parts.includes("permissions") || mode === "clear") && botHighestRolePosition <= 1) {
    missingPermissions.push("Cargo do bot acima dos cargos restaurados");
  }
  const warnings = [];
  if (missingPermissions.length) {
    warnings.push("O bot precisa das permissões de gerenciamento para restaurar tudo.");
  }
  if (!administrator) {
    warnings.push("Administrador não é obrigatório, mas reduz falhas de permissão durante a restauração.");
  }
  return { missingPermissions, warnings };
}

function computeMemberPermissions(member: any, roles: any[], ownerId: string, guildId: string) {
  if (member.user?.id === ownerId) return (1n << 53n) - 1n;
  let permissions = 0n;
  for (const roleId of [guildId, ...(member.roles ?? [])]) {
    const role = roles.find((item) => item.id === roleId);
    if (role?.permissions) permissions |= BigInt(role.permissions);
  }
  if ((permissions & 0x8n) === 0x8n) return (1n << 53n) - 1n;
  return permissions;
}

function channelPayload(channel: any, idMap: { roles: Record<string, string>; channels: Record<string, string> }) {
  return {
    available_tags: channel.available_tags,
    bitrate: channel.bitrate,
    default_auto_archive_duration: channel.default_auto_archive_duration,
    default_forum_layout: channel.default_forum_layout,
    default_reaction_emoji: channel.default_reaction_emoji,
    default_sort_order: channel.default_sort_order,
    default_thread_rate_limit_per_user: channel.default_thread_rate_limit_per_user,
    name: channel.name,
    nsfw: channel.nsfw,
    parent_id: channel.parent_id ? idMap.channels[channel.parent_id] : undefined,
    position: channel.position,
    rate_limit_per_user: channel.rate_limit_per_user,
    rtc_region: channel.rtc_region,
    topic: channel.topic,
    type: channel.type,
    user_limit: channel.user_limit,
    video_quality_mode: channel.video_quality_mode
  };
}

function rolePayload(role: any) {
  return {
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    name: role.name,
    permissions: role.permissions,
    unicode_emoji: role.unicode_emoji
  };
}

function findExistingRole(roles: any[], name: unknown, guildId: string) {
  const normalized = normalizeName(name);
  return roles.find((role) => role.id !== guildId && !role.managed && normalizeName(role.name) === normalized) ?? null;
}

function findExistingChannel(channels: any[], source: any, idMap: RestoreResult["idMap"]) {
  const expectedParentId = source.parent_id ? idMap.channels[source.parent_id] : null;
  return channels.find((channel) => (
    Number(channel.type) === Number(source.type)
    && normalizeName(channel.name) === normalizeName(source.name)
    && (source.type === 4 || (channel.parent_id ?? null) === expectedParentId)
  )) ?? null;
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

async function restoreChannelPositions(botToken: string, guildId: string, channels: any[], result: RestoreResult) {
  const positions = channels
    .map((channel) => ({ id: result.idMap.channels[channel.id], position: channel.position }))
    .filter((item) => item.id && Number.isFinite(item.position));
  if (!positions.length) return;
  try {
    await discordPatch(botToken, `/guilds/${guildId}/channels`, positions);
  } catch (error) {
    addRestoreError(result, "channel-positions", errorMessage(error));
  }
}

async function restoreEmojis(botToken: string, guildId: string, source: unknown, mode: RestoreMode, result: RestoreResult) {
  const emojis = Array.isArray(source) ? source : [];
  let existing = await discordGet(botToken, `/guilds/${guildId}/emojis`).catch(() => []);
  for (const emoji of emojis) {
    try {
      let match = existing.find((item: any) => normalizeName(item.name) === normalizeName(emoji.name)) ?? null;
      if (match && mode === "replace") {
        await discordDelete(botToken, `/guilds/${guildId}/emojis/${match.id}`);
        existing = existing.filter((item: any) => item.id !== match.id);
        match = null;
      }
      if (match) {
        result.idMap.emojis[emoji.id] = match.id;
        result.summary.emojis += 1;
        result.summary.reused += 1;
        if (mode === "merge") {
          await discordPatch(botToken, `/guilds/${guildId}/emojis/${match.id}`, {
            name: emoji.name,
            roles: Array.isArray(emoji.roles) ? emoji.roles.map((id: string) => result.idMap.roles[id]).filter(Boolean) : []
          });
        }
        continue;
      }
      if (typeof emoji.data !== "string" || !emoji.data.startsWith("data:")) {
        throw new Error(emoji.assetError || "arquivo do emoji não foi incorporado ao backup");
      }
      const created = await discordPost(botToken, `/guilds/${guildId}/emojis`, {
        image: emoji.data,
        name: emoji.name,
        roles: Array.isArray(emoji.roles) ? emoji.roles.map((id: string) => result.idMap.roles[id]).filter(Boolean) : []
      });
      result.idMap.emojis[emoji.id] = created.id;
      existing.push(created);
      result.summary.emojis += 1;
    } catch (error) {
      addRestoreError(result, `emoji:${emoji?.name ?? emoji?.id ?? "desconhecido"}`, errorMessage(error));
    }
  }
}

async function restoreStickers(botToken: string, guildId: string, source: unknown, mode: RestoreMode, result: RestoreResult) {
  const stickers = Array.isArray(source) ? source : [];
  let existing = await discordGet(botToken, `/guilds/${guildId}/stickers`).catch(() => []);
  for (const sticker of stickers) {
    try {
      let match = existing.find((item: any) => normalizeName(item.name) === normalizeName(sticker.name)) ?? null;
      if (match && mode === "replace") {
        await discordDelete(botToken, `/guilds/${guildId}/stickers/${match.id}`);
        existing = existing.filter((item: any) => item.id !== match.id);
        match = null;
      }
      if (match) {
        result.idMap.stickers[sticker.id] = match.id;
        result.summary.stickers += 1;
        result.summary.reused += 1;
        if (mode === "merge") {
          await discordPatch(botToken, `/guilds/${guildId}/stickers/${match.id}`, {
            description: String(sticker.description ?? "Sticker restaurado do backup").slice(0, 100),
            name: String(sticker.name ?? match.name).slice(0, 30),
            tags: String(sticker.tags ?? "backup").slice(0, 200)
          });
        }
        continue;
      }
      if (typeof sticker.data !== "string" || !sticker.data.startsWith("data:")) {
        throw new Error(sticker.assetError || "arquivo do sticker não foi incorporado ao backup");
      }
      const created = await discordPostMultipart(botToken, `/guilds/${guildId}/stickers`, {
        description: String(sticker.description ?? "Sticker restaurado do backup").slice(0, 100),
        file: sticker.data,
        name: String(sticker.name ?? "sticker-restaurado").slice(0, 30),
        tags: String(sticker.tags ?? "backup").slice(0, 200)
      });
      result.idMap.stickers[sticker.id] = created.id;
      existing.push(created);
      result.summary.stickers += 1;
    } catch (error) {
      addRestoreError(result, `sticker:${sticker?.name ?? sticker?.id ?? "desconhecido"}`, errorMessage(error));
    }
  }
}

async function restoreMessages(botToken: string, source: unknown, result: RestoreResult) {
  const channelSnapshots = Array.isArray(source) ? source : [];
  for (const channelSnapshot of channelSnapshots) {
    const targetChannelId = result.idMap.channels[channelSnapshot?.channelId];
    const messages = Array.isArray(channelSnapshot?.messages) ? channelSnapshot.messages : [];
    if (!targetChannelId || !messages.length) continue;
    let webhook: any = null;
    try {
      webhook = await discordPost(botToken, `/channels/${targetChannelId}/webhooks`, {
        name: "NexTech Clone"
      });
      if (!webhook?.id || !webhook?.token) throw new Error("Webhook não retornou token temporário.");
      for (const message of messages) {
        try {
          const payload = replayMessagePayload(message);
          if (!payload) continue;
          await discordExecuteWebhook(webhook.id, webhook.token, payload);
          result.summary.messages += 1;
          await wait(MESSAGE_REPLAY_DELAY_MS);
        } catch (error) {
          addRestoreError(result, `message:${channelSnapshot.channelName ?? channelSnapshot.channelId}:${message?.id ?? "desconhecida"}`, errorMessage(error));
        }
      }
    } catch (error) {
      addRestoreError(result, `messages:${channelSnapshot?.channelName ?? channelSnapshot?.channelId ?? "canal"}`, errorMessage(error));
    } finally {
      if (webhook?.id) {
        await discordDelete(botToken, `/webhooks/${webhook.id}`).catch(() => null);
      }
    }
  }
}

function replayMessagePayload(message: any) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments.filter((attachment: any) => readString(attachment, "url")) : [];
  const attachmentLinks = attachments.map((attachment: any) => `${readString(attachment, "filename") || "arquivo"}: ${readString(attachment, "url")}`).join("\n");
  const content = [readString(message, "content"), attachmentLinks].filter(Boolean).join("\n").slice(0, 2000);
  const embeds = sanitizeEmbeds(message?.embeds);
  if (!content && !embeds.length) return null;
  return {
    allowed_mentions: { parse: [] },
    avatar_url: readString(message?.author, "avatarUrl") || undefined,
    content: content || undefined,
    embeds,
    username: readString(message?.author, "username") || "Usuário"
  };
}

async function restoreGuildSettings(botToken: string, guildId: string, guild: any, idMap: RestoreResult["idMap"]) {
  const payload = {
    afk_channel_id: guild.afk_channel_id ? idMap.channels[guild.afk_channel_id] ?? null : undefined,
    afk_timeout: guild.afk_timeout,
    banner: typeof guild.bannerData === "string" ? guild.bannerData : undefined,
    default_message_notifications: guild.default_message_notifications,
    description: guild.description,
    explicit_content_filter: guild.explicit_content_filter,
    icon: typeof guild.iconData === "string" ? guild.iconData : undefined,
    name: guild.name,
    preferred_locale: guild.preferred_locale,
    public_updates_channel_id: guild.public_updates_channel_id ? idMap.channels[guild.public_updates_channel_id] ?? null : undefined,
    rules_channel_id: guild.rules_channel_id ? idMap.channels[guild.rules_channel_id] ?? null : undefined,
    system_channel_id: guild.system_channel_id ? idMap.channels[guild.system_channel_id] ?? null : undefined,
    verification_level: guild.verification_level
  };
  await discordPatch(botToken, `/guilds/${guildId}`, Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)));
}

async function checkpoint(result: RestoreResult, progressPercent: number, startedAt: number, onProgress?: (result: RestoreResult) => Promise<void>) {
  result.progressPercent = progressPercent;
  result.durationMs = Date.now() - startedAt;
  if (onProgress) await onProgress(result);
}

async function clearTargetGuild(botToken: string, guildId: string, result: RestoreResult) {
  const [channels, roles] = await Promise.all([
    discordGet(botToken, `/guilds/${guildId}/channels`).catch(() => []),
    discordGet(botToken, `/guilds/${guildId}/roles`).catch(() => [])
  ]);
  for (const channel of Array.isArray(channels) ? channels : []) {
    try {
      await discordDelete(botToken, `/channels/${channel.id}`);
    } catch (error) {
      addRestoreError(result, `clear-channel:${channel.name ?? channel.id}`, errorMessage(error));
    }
  }
  const removableRoles = Array.isArray(roles) ? [...roles].filter((role) => role.id !== guildId && !role.managed).sort((a, b) => b.position - a.position) : [];
  for (const role of removableRoles) {
    try {
      await discordDelete(botToken, `/guilds/${guildId}/roles/${role.id}`);
    } catch (error) {
      addRestoreError(result, `clear-role:${role.name ?? role.id}`, errorMessage(error));
    }
  }
}

async function restoreRolePositions(botToken: string, guildId: string, roles: any[], result: RestoreResult) {
  const positions = roles
    .map((role) => ({ id: result.idMap.roles[role.id], position: role.position }))
    .filter((item) => item.id && Number.isFinite(item.position));
  if (!positions.length) return;
  try {
    await discordPatch(botToken, `/guilds/${guildId}/roles`, positions);
  } catch (error) {
    addRestoreError(result, "role-positions", errorMessage(error));
  }
}

async function restoreChannelPermissions(botToken: string, channels: any[], result: RestoreResult, skippedChannelIds: Set<string>) {
  for (const channel of channels) {
    const newChannelId = result.idMap.channels[channel.id];
    if (!newChannelId || skippedChannelIds.has(newChannelId) || !Array.isArray(channel.permission_overwrites)) continue;
    for (const overwrite of channel.permission_overwrites) {
      const mapped = mapPermissionOverwrite(overwrite, result.idMap);
      if (!mapped) {
        addRestoreError(result, `permission:${channel.name}`, `Overwrite ${overwrite.id} ignorado porque o cargo antigo não existe no servidor destino.`);
        continue;
      }
      try {
        await discordPut(botToken, `/channels/${newChannelId}/permissions/${mapped.id}`, mapped);
        result.summary.permissions += 1;
      } catch (error) {
        addRestoreError(result, `permission:${channel.name}:${overwrite.id}`, errorMessage(error));
      }
    }
  }
}

function mapPermissionOverwrite(overwrite: any, idMap: RestoreResult["idMap"]) {
  const type = Number(overwrite.type);
  const mappedId = type === 0 ? idMap.roles[overwrite.id] : overwrite.id;
  if (!mappedId) return null;
  return { allow: overwrite.allow ?? "0", deny: overwrite.deny ?? "0", id: mappedId, type };
}

function remapIdsDeep(value: unknown, idMap: RestoreResult["idMap"], sourceIds: Set<string>): Record<string, Record<string, unknown>> {
  const map = new Map<string, string>(Object.values(idMap).flatMap((mapping) => Object.entries(mapping)).filter(([oldId, newId]) => oldId && newId));
  const remap = (item: unknown): unknown => {
    if (typeof item === "string") return map.get(item) ?? (sourceIds.has(item) ? null : item);
    if (Array.isArray(item)) return item.map(remap).filter((nested) => nested !== null);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).flatMap(([key, nested]) => {
        const mappedKey = map.get(key) ?? key;
        if (mappedKey === key && sourceIds.has(key)) return [];
        const mappedValue = remap(nested);
        return mappedValue === null ? [] : [[mappedKey, mappedValue]];
      }));
    }
    return item;
  };
  const mapped = remap(value);
  return mapped && typeof mapped === "object" && !Array.isArray(mapped) ? mapped as Record<string, Record<string, unknown>> : {};
}

function addRestoreError(result: RestoreResult, step: string, message: string) {
  result.errors.push({ step, message });
  result.summary.failed += 1;
  addRestoreProgress(result, step, "failed", message);
}

function addRestoreProgress(result: RestoreResult, step: string, status: RestoreResult["progress"][number]["status"], message: string) {
  result.progress.push({ at: new Date().toISOString(), message, status, step });
}

function collectSnapshotIds(snapshot: any) {
  const ids = new Set<string>();
  if (typeof snapshot.guild?.id === "string") ids.add(snapshot.guild.id);
  for (const role of Array.isArray(snapshot.roles) ? snapshot.roles : []) {
    if (typeof role.id === "string") ids.add(role.id);
  }
  for (const channel of Array.isArray(snapshot.channels) ? snapshot.channels : []) {
    if (typeof channel.id === "string") ids.add(channel.id);
  }
  return ids;
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
  if (!backup) throw Object.assign(new Error("Backup não encontrado."), { statusCode: 404 });
  if (backup.status === "failed" || !isValidSnapshot(backup.snapshot)) {
    throw Object.assign(new Error("O backup está incompleto ou corrompido e não pode ser restaurado."), { statusCode: 422 });
  }
  if (backup.checksum && backup.checksum !== snapshotChecksum(backup.snapshot)) {
    throw Object.assign(new Error("A verificação de integridade do backup falhou."), { statusCode: 422 });
  }
  return backup;
}

async function discordGet(token: string, path: string) {
  return discordRequest(token, "GET", path);
}

async function discordPost(token: string, path: string, body: Record<string, unknown>) {
  return discordRequest(token, "POST", path, body);
}

async function discordPatch(token: string, path: string, body: unknown) {
  return discordRequest(token, "PATCH", path, body);
}

async function discordPut(token: string, path: string, body: Record<string, unknown>) {
  return discordRequest(token, "PUT", path, body);
}

async function discordDelete(token: string, path: string) {
  return discordRequest(token, "DELETE", path);
}

async function discordPostMultipart(token: string, path: string, input: { description: string; file: string; name: string; tags: string }) {
  const asset = parseDataUri(input.file);
  if (!asset) throw new Error("Arquivo incorporado ao backup e inválido.");
  const form = new FormData();
  form.append("name", input.name);
  form.append("description", input.description);
  form.append("tags", input.tags);
  form.append("file", new Blob([new Uint8Array(asset.buffer)], { type: asset.mime }), `sticker.${extensionForMime(asset.mime)}`);
  return discordRequest(token, "POST", path, form);
}

async function discordExecuteWebhook(webhookId: string, webhookToken: string, body: Record<string, unknown>, attempt = 0): Promise<any> {
  try {
    const response = await axios.request({
      data: body,
      method: "POST",
      timeout: 30_000,
      url: `${DISCORD_API}/webhooks/${webhookId}/${webhookToken}?wait=true`
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && attempt < 3) {
      const retryAfterSeconds = Number(error.response?.data?.retry_after);
      const retryable = error.response?.status === 429 || (error.response?.status ?? 0) >= 500;
      if (retryable) {
        await wait(Number.isFinite(retryAfterSeconds) ? Math.ceil(retryAfterSeconds * 1000) : 1000 * (attempt + 1));
        return discordExecuteWebhook(webhookId, webhookToken, body, attempt + 1);
      }
    }
    throw error;
  }
}

async function discordRequest(token: string, method: string, path: string, data?: unknown, attempt = 0): Promise<any> {
  try {
    const response = await axios.request({
      data,
      headers: { Authorization: `Bot ${token}` },
      method,
      timeout: 30_000,
      url: `${DISCORD_API}${path}`
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && attempt < 3) {
      const retryAfterSeconds = Number(error.response?.data?.retry_after);
      const retryable = error.response?.status === 429 || (error.response?.status ?? 0) >= 500;
      if (retryable) {
        await wait(Number.isFinite(retryAfterSeconds) ? Math.ceil(retryAfterSeconds * 1000) : 1000 * (attempt + 1));
        return discordRequest(token, method, path, data, attempt + 1);
      }
    }
    throw error;
  }
}

function parseDataUri(value: string) {
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  return match ? { mime: match[1]!, buffer: Buffer.from(match[2]!, "base64") } : null;
}

function extensionForMime(mime: string) {
  if (mime.includes("gif")) return "gif";
  if (mime.includes("json")) return "json";
  return "png";
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

function normalizeRestoreMode(mode: unknown): RestoreMode {
  return RESTORE_MODES.includes(mode as RestoreMode) ? mode as RestoreMode : "merge";
}

function countSnapshot(snapshot: any) {
  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  return {
    categories: channels.filter((channel: any) => channel.type === 4).length,
    channels: channels.filter((channel: any) => channel.type !== 4).length,
    emojis: Array.isArray(snapshot.emojis) ? snapshot.emojis.length : 0,
    messages: countSnapshotMessages(snapshot.messages),
    roles: Array.isArray(snapshot.roles) ? snapshot.roles.length : 0,
    stickers: Array.isArray(snapshot.stickers) ? snapshot.stickers.length : 0
  };
}

function countSnapshotMessages(source: unknown) {
  return Array.isArray(source)
    ? source.reduce((total, channel) => total + (Array.isArray(channel?.messages) ? channel.messages.length : 0), 0)
    : 0;
}

function frequencyMs(frequency: ServerBackupSettingsDto["frequency"]) {
  const hours = frequency === "6h" ? 6 : frequency === "12h" ? 12 : frequency === "weekly" ? 24 * 7 : frequency === "monthly" ? 24 * 30 : 24;
  return hours * 60 * 60 * 1000;
}

function toSettingsDto(settings: MongoServerBackupSettings): ServerBackupSettingsDto {
  return { ...settings, updatedAt: settings.updatedAt?.toISOString() ?? null };
}

function toSnapshotDto(snapshot: MongoServerBackupSnapshot): ServerBackupSnapshotDto {
  return { botId: snapshot.botId, checksum: snapshot.checksum ?? null, counts: snapshot.counts, createdAt: snapshot.createdAt.toISOString(), createdBy: snapshot.createdBy, guildId: snapshot.guildId, guildName: snapshot.guildName, id: snapshot._id, kind: snapshot.kind, snapshotVersion: snapshot.snapshotVersion ?? 1, status: snapshot.status, statusMessage: snapshot.statusMessage, updatedAt: snapshot.updatedAt.toISOString() };
}

function toRestoreJobDto(job: MongoServerBackupRestoreJob) {
  return { ...job, id: job._id, createdAt: job.createdAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null, updatedAt: job.updatedAt.toISOString() };
}

function emitRestoreProgress(job: MongoServerBackupRestoreJob, sourceGuildId: string, targetGuildId: string) {
  const payload = toRestoreJobDto(job);
  for (const guildId of new Set([sourceGuildId, targetGuildId])) {
    emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, job.botId), "server-backup:restore_progress", payload);
  }
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

function snapshotChecksum(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function isValidSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const value = snapshot as Record<string, unknown>;
  return Boolean(
    value.guild && typeof value.guild === "object"
    && Array.isArray(value.roles)
    && Array.isArray(value.channels)
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
