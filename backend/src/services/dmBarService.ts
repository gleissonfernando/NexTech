import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText } from "../config/systemEmojis";
import { ensureGuild, getMongoCollections, type MongoDmBarConfig, type MongoDmBarLog } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";
import { removePersistentImageByUrl, savePersistentImage } from "./persistentImageStorageService";

export const DM_BAR_MODULE_ID = "police-dm";

export type DmBarConfigDto = {
  accentColor: string;
  allowAdmins: boolean;
  allowedRoleIds: string[];
  allowedUserIds: string[];
  allowMentions: boolean;
  botId: string;
  cooldownSeconds: number;
  createdAt: string;
  descriptionTemplate: string;
  enabled: boolean;
  emoji: string;
  footerEnabled: boolean;
  footerIconUrl: string | null;
  footerText: string;
  guildId: string;
  id: string;
  imagePosition: MongoDmBarConfig["imagePosition"];
  logChannelId: string | null;
  logsEnabled: boolean;
  mainImageUrl: string | null;
  showDate: boolean;
  showSender: boolean;
  showServer: boolean;
  showTargetId: boolean;
  signature: string;
  titleTemplate: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type DmBarLogDto = {
  botId: string;
  errorReason: string | null;
  guildId: string;
  id: string;
  message: string;
  senderId: string;
  sentAt: string;
  status: MongoDmBarLog["status"];
  targetId: string | null;
  title: string;
};

export type DmBarDashboardDto = {
  config: DmBarConfigDto;
  logs: DmBarLogDto[];
  stats: {
    lastSenderId: string | null;
    lastSentAt: string | null;
    sentCount: number;
  };
};

export async function getDmBarDashboard(botId: string, guildId: string): Promise<DmBarDashboardDto> {
  const [config, logs] = await Promise.all([getDmBarConfig(botId, guildId), listDmBarLogs(botId, guildId)]);
  const sent = logs.filter((log) => log.status === "sent" || log.status === "test");
  const last = sent[0] ?? null;

  return {
    config,
    logs,
    stats: {
      lastSenderId: last?.senderId ?? null,
      lastSentAt: last?.sentAt ?? null,
      sentCount: sent.length
    }
  };
}

export async function getDmBarConfig(botId: string, guildId: string) {
  const { dmBarConfigs } = await getMongoCollections();
  const row = await dmBarConfigs.findOne({ botId, guildId });
  return toConfigDto(row ?? defaultConfig(botId, guildId));
}

export async function saveDmBarConfig(botId: string, guildId: string, input: Partial<DmBarConfigDto>, actorId: string | null) {
  const { dmBarConfigs } = await getMongoCollections();
  const now = new Date();
  const current = await dmBarConfigs.findOne({ botId, guildId });
  const base = current ?? defaultConfig(botId, guildId);
  const next: MongoDmBarConfig = {
    ...base,
    accentColor: normalizeColor(input.accentColor ?? base.accentColor),
    allowAdmins: input.allowAdmins ?? base.allowAdmins,
    allowedRoleIds: normalizeSnowflakeList(input.allowedRoleIds ?? base.allowedRoleIds),
    allowedUserIds: normalizeSnowflakeList(input.allowedUserIds ?? base.allowedUserIds),
    allowMentions: input.allowMentions ?? base.allowMentions,
    cooldownSeconds: clampNumber(input.cooldownSeconds ?? base.cooldownSeconds, 0, 3600),
    descriptionTemplate: normalizeText(input.descriptionTemplate ?? base.descriptionTemplate, 3000, base.descriptionTemplate),
    enabled: input.enabled ?? base.enabled,
    emoji: normalizeText(input.emoji ?? base.emoji, 80, fixedSystemEmojiText("discord")),
    footerEnabled: input.footerEnabled ?? base.footerEnabled,
    footerIconUrl: normalizeUrl(input.footerIconUrl ?? base.footerIconUrl),
    footerText: normalizeText(input.footerText ?? base.footerText, 300, base.footerText),
    imagePosition: normalizeImagePosition(input.imagePosition ?? base.imagePosition),
    logChannelId: normalizeSnowflake(input.logChannelId ?? base.logChannelId),
    logsEnabled: input.logsEnabled ?? base.logsEnabled,
    mainImageUrl: normalizeUrl(input.mainImageUrl ?? base.mainImageUrl),
    showDate: input.showDate ?? base.showDate,
    showSender: input.showSender ?? base.showSender,
    showServer: input.showServer ?? base.showServer,
    showTargetId: input.showTargetId ?? base.showTargetId,
    signature: normalizeText(input.signature ?? base.signature, 300, base.signature),
    titleTemplate: normalizeText(input.titleTemplate ?? base.titleTemplate, 120, base.titleTemplate),
    updatedAt: now,
    updatedBy: actorId
  };

  await ensureGuild(guildId);
  await dmBarConfigs.updateOne({ botId, guildId }, { $set: next }, { upsert: true });
  await createDmBarLog(botId, guildId, { senderId: actorId ?? "0", targetId: null, title: "Configuração alterada", message: "Configuração da Barra DM atualizada.", status: "test", errorReason: null });
  emitUpdated(botId, guildId);
  return toConfigDto(next);
}

export async function resetDmBarConfig(botId: string, guildId: string, actorId: string | null) {
  const { dmBarConfigs } = await getMongoCollections();
  const current = await dmBarConfigs.findOne({ botId, guildId });
  const next = { ...defaultConfig(botId, guildId), _id: current?._id ?? randomUUID(), createdAt: current?.createdAt ?? new Date(), updatedAt: new Date(), updatedBy: actorId };
  await dmBarConfigs.updateOne({ botId, guildId }, { $set: next }, { upsert: true });
  emitUpdated(botId, guildId);
  return toConfigDto(next);
}

export async function uploadDmBarImage(input: { actorId: string | null; botId: string; buffer: Buffer; guildId: string; imageType: "main" | "footer"; mimeType: string; originalName?: string | null }) {
  const current = await getDmBarConfig(input.botId, input.guildId);
  const previousUrl = input.imageType === "main" ? current.mainImageUrl : current.footerIconUrl;
  const stored = await savePersistentImage({
    actorId: input.actorId,
    botId: input.botId,
    buffer: input.buffer,
    guildId: input.guildId,
    imageType: input.imageType,
    mimeType: input.mimeType,
    moduleId: DM_BAR_MODULE_ID,
    originalName: input.originalName,
    previousUrl
  });
  const config = await saveDmBarConfig(input.botId, input.guildId, input.imageType === "main" ? { mainImageUrl: stored.publicUrl } : { footerIconUrl: stored.publicUrl }, input.actorId);
  return { config, image: stored };
}

export async function removeDmBarImage(botId: string, guildId: string, imageType: "main" | "footer", actorId: string | null) {
  const current = await getDmBarConfig(botId, guildId);
  const url = imageType === "main" ? current.mainImageUrl : current.footerIconUrl;
  if (url) await removePersistentImageByUrl({ actorId, botId, guildId, imageType, moduleId: DM_BAR_MODULE_ID, url });
  return saveDmBarConfig(botId, guildId, imageType === "main" ? { mainImageUrl: null } : { footerIconUrl: null }, actorId);
}

export async function listDmBarLogs(botId: string, guildId: string, limit = 150) {
  const { dmBarLogs } = await getMongoCollections();
  return (await dmBarLogs.find({ botId, guildId }).sort({ sentAt: -1 }).limit(limit).toArray()).map(toLogDto);
}

export async function createDmBarLog(botId: string, guildId: string, input: Omit<DmBarLogDto, "botId" | "guildId" | "id" | "sentAt"> & { sentAt?: Date }) {
  const { dmBarLogs } = await getMongoCollections();
  const row: MongoDmBarLog = {
    _id: randomUUID(),
    botId,
    errorReason: input.errorReason?.slice(0, 1000) ?? null,
    guildId,
    message: input.message.slice(0, 4000),
    senderId: input.senderId,
    sentAt: input.sentAt ?? new Date(),
    status: input.status,
    targetId: input.targetId,
    title: input.title.slice(0, 180)
  };
  await dmBarLogs.insertOne(row);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "dm-bar:log_created", toLogDto(row));
  return toLogDto(row);
}

function defaultConfig(botId: string, guildId: string): MongoDmBarConfig {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    accentColor: "#22c55e",
    allowAdmins: true,
    allowedRoleIds: [],
    allowedUserIds: [],
    allowMentions: false,
    botId,
    cooldownSeconds: 30,
    createdAt: now,
    descriptionTemplate: "Olá, {usuario}.\nVocê recebeu uma mensagem da equipe do {servidor}.\n\n**Mensagem:**\n{mensagem}\n\n**Data:** {data} às {hora}",
    enabled: false,
    emoji: fixedSystemEmojiText("discord"),
    footerEnabled: true,
    footerIconUrl: null,
    footerText: "Sistema de DM • {servidor} • Enviado em {data} às {hora}",
    guildId,
    imagePosition: "top",
    logChannelId: null,
    logsEnabled: true,
    mainImageUrl: null,
    showDate: true,
    showSender: false,
    showServer: true,
    showTargetId: false,
    signature: "Equipe {servidor}",
    titleTemplate: `${fixedSystemEmojiText("discord")} Comunicado Oficial`,
    updatedAt: now,
    updatedBy: null
  };
}

function toConfigDto(row: MongoDmBarConfig): DmBarConfigDto {
  return { ...row, id: row._id, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function toLogDto(row: MongoDmBarLog): DmBarLogDto {
  return { ...row, id: row._id, sentAt: row.sentAt.toISOString() };
}

function normalizeSnowflake(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^\d{5,32}$/.test(trimmed) ? trimmed : null;
}
function normalizeSnowflakeList(values: string[]) { return [...new Set(values.map(normalizeSnowflake).filter((value): value is string => Boolean(value)))].slice(0, 100); }
function normalizeUrl(value: string | null | undefined) { const trimmed = value?.trim(); return trimmed || null; }
function normalizeText(value: string, max: number, fallback: string) { const trimmed = value.trim(); return (trimmed || fallback).slice(0, max); }
function clampNumber(value: number, min: number, max: number) { return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min))); }
function normalizeColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "#22c55e"; }
function normalizeImagePosition(value: unknown): MongoDmBarConfig["imagePosition"] { return value === "top" || value === "middle" || value === "bottom" || value === "gallery" || value === "thumbnail" || value === "none" ? value : "top"; }
function emitUpdated(botId: string, guildId: string) {
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "dm-bar:settings_updated", { botId, guildId });
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "dm-bar:settings_updated", { botId, guildId });
}
