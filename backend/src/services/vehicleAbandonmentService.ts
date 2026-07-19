import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoVehicleAbandonmentRecord, type MongoVehicleAbandonmentSettings } from "../database/mongo";
import { dashboardLogRealtimeRoom, devBotRealtimeRoom, emitRealtimeToRoom } from "../realtime/events";

export const VEHICLE_ABANDONMENT_MODULE_ID = "vehicle-abandonment";

export type VehicleAbandonmentSettingsDto = Omit<MongoVehicleAbandonmentSettings, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  id: string;
  updatedAt: string;
};

export type VehicleAbandonmentRecordDto = Omit<MongoVehicleAbandonmentRecord, "_id" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  id: string;
  updatedAt: string;
};

export type SaveVehicleAbandonmentSettingsInput = Partial<Pick<
  MongoVehicleAbandonmentSettings,
  | "allowMultipleAttachments"
  | "allowRecordEditing"
  | "allowedRoleIds"
  | "color"
  | "confirmationBeforeSend"
  | "defaultImageUrl"
  | "deleteOriginalMessage"
  | "embedTitle"
  | "emoji"
  | "enabled"
  | "errorMessage"
  | "explanatoryPanelAllowedRoleIds"
  | "explanatoryPanelButtonEnabled"
  | "explanatoryPanelChannelId"
  | "explanatoryPanelColor"
  | "explanatoryPanelCommandEnabled"
  | "explanatoryPanelCommonErrorsText"
  | "explanatoryPanelDescription"
  | "explanatoryPanelEmoji"
  | "explanatoryPanelExampleText"
  | "explanatoryPanelFinalText"
  | "explanatoryPanelHowItWorksText"
  | "explanatoryPanelImageUrl"
  | "explanatoryPanelModalContent"
  | "explanatoryPanelModalTitle"
  | "explanatoryPanelNotesText"
  | "explanatoryPanelRequiredFieldsText"
  | "explanatoryPanelThumbnailUrl"
  | "explanatoryPanelTitle"
  | "footerText"
  | "logChannelId"
  | "logsEnabled"
  | "maxImages"
  | "mentionRoleId"
  | "recordChannelId"
  | "successMessage"
  | "systemChannelId"
  | "systemName"
  | "thumbnailUrl"
>>;

export type CreateVehicleAbandonmentRecordInput = {
  authorId: string;
  authorName: string;
  guildId: string;
  imageUrls: string[];
  model: string;
  plate: string;
  recordChannelId: string;
  recordMessageId?: string | null;
  report: string;
  sourceMessageId: string;
  status?: "registered" | "failed";
  systemChannelId: string;
};

export async function getVehicleAbandonmentDashboard(botId: string, guildId: string) {
  return {
    records: await listVehicleAbandonmentRecords(botId, guildId),
    settings: await getVehicleAbandonmentSettings(botId, guildId)
  };
}

export async function getVehicleAbandonmentSettings(botId: string, guildId: string) {
  const { vehicleAbandonmentSettings } = await getMongoCollections();
  const found = await vehicleAbandonmentSettings.findOne({ botId, guildId });
  return settingsDto(found ? { ...defaultSettings(botId, guildId), ...found } : defaultSettings(botId, guildId));
}

export async function saveVehicleAbandonmentSettings(
  botId: string,
  guildId: string,
  input: SaveVehicleAbandonmentSettingsInput,
  actorId: string | null
) {
  const { vehicleAbandonmentSettings } = await getMongoCollections();
  const now = new Date();
  const current = await vehicleAbandonmentSettings.findOne({ botId, guildId });
  const next: MongoVehicleAbandonmentSettings = {
    ...defaultSettings(botId, guildId),
    ...current,
    ...sanitizeSettingsInput(input),
    _id: current?._id ?? randomUUID(),
    botId,
    createdAt: current?.createdAt ?? now,
    guildId,
    updatedAt: now,
    updatedBy: actorId
  };

  await ensureGuild(guildId);
  await vehicleAbandonmentSettings.updateOne({ botId, guildId }, { $set: next }, { upsert: true });
  emitSettingsUpdated(botId, guildId);
  return settingsDto(next);
}

export async function listVehicleAbandonmentRecords(botId: string, guildId: string, limit = 100) {
  const { vehicleAbandonmentRecords } = await getMongoCollections();
  const rows = await vehicleAbandonmentRecords.find({ botId, guildId }).sort({ createdAt: -1 }).limit(Math.min(500, limit)).toArray();
  return rows.map(recordDto);
}

export async function createVehicleAbandonmentRecord(botId: string, input: CreateVehicleAbandonmentRecordInput) {
  const { vehicleAbandonmentRecords, vehicleAbandonmentLogs } = await getMongoCollections();
  const now = new Date();
  const row: MongoVehicleAbandonmentRecord = {
    _id: randomUUID(),
    authorId: input.authorId,
    authorName: input.authorName.slice(0, 100),
    botId,
    createdAt: now,
    errorMessage: null,
    guildId: input.guildId,
    imageUrls: input.imageUrls.slice(0, 10),
    model: input.model.slice(0, 300),
    plate: input.plate.slice(0, 80),
    recordChannelId: input.recordChannelId,
    recordMessageId: input.recordMessageId ?? null,
    report: input.report.slice(0, 2000),
    sourceMessageId: input.sourceMessageId,
    status: input.status ?? "registered",
    systemChannelId: input.systemChannelId,
    updatedAt: now
  };

  try {
    await vehicleAbandonmentRecords.insertOne(row);
  } catch (error: any) {
    if (error?.code === 11000) {
      const duplicate = await vehicleAbandonmentRecords.findOne({ botId, sourceMessageId: input.sourceMessageId });
      if (duplicate) return recordDto(duplicate);
    }

    throw error;
  }

  await vehicleAbandonmentLogs.insertOne({
    _id: randomUUID(),
    action: "record_registered",
    actorId: input.authorId,
    botId,
    createdAt: now,
    guildId: input.guildId,
    metadata: {
      imageCount: row.imageUrls.length,
      plate: row.plate,
      recordChannelId: row.recordChannelId,
      recordMessageId: row.recordMessageId,
      sourceMessageId: row.sourceMessageId,
      systemChannelId: row.systemChannelId
    },
    recordId: row._id
  });

  const dto = recordDto(row);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(input.guildId, botId), "vehicle-abandonment:record_created", dto);
  return dto;
}

export async function getVehicleAbandonmentRecord(botId: string, recordId: string) {
  const { vehicleAbandonmentRecords } = await getMongoCollections();
  const row = await vehicleAbandonmentRecords.findOne({ _id: recordId, botId });
  if (!row) throw serviceError("Registro não encontrado.", 404);
  return recordDto(row);
}

export async function updateVehicleAbandonmentRecord(
  botId: string,
  recordId: string,
  input: Partial<Pick<MongoVehicleAbandonmentRecord, "model" | "plate" | "recordMessageId" | "report">>
) {
  const { vehicleAbandonmentRecords, vehicleAbandonmentLogs } = await getMongoCollections();
  const current = await vehicleAbandonmentRecords.findOne({ _id: recordId, botId });
  if (!current) throw serviceError("Registro não encontrado.", 404);
  const now = new Date();
  const $set: Partial<MongoVehicleAbandonmentRecord> = { updatedAt: now };
  if (input.model !== undefined) $set.model = input.model.trim().slice(0, 300);
  if (input.plate !== undefined) $set.plate = input.plate.trim().slice(0, 80);
  if (input.report !== undefined) $set.report = input.report.trim().slice(0, 2000);
  if (input.recordMessageId !== undefined) $set.recordMessageId = normalizeSnowflake(input.recordMessageId);

  await vehicleAbandonmentRecords.updateOne({ _id: recordId, botId }, { $set });
  await vehicleAbandonmentLogs.insertOne({
    _id: randomUUID(),
    action: "record_updated",
    actorId: null,
    botId,
    createdAt: now,
    guildId: current.guildId,
    metadata: { fields: Object.keys($set).filter((key) => key !== "updatedAt") },
    recordId
  });
  return getVehicleAbandonmentRecord(botId, recordId);
}

function defaultSettings(botId: string, guildId: string): MongoVehicleAbandonmentSettings {
  const now = new Date();
  return {
    _id: `${botId}:${guildId}`,
    allowMultipleAttachments: true,
    allowRecordEditing: false,
    allowedRoleIds: [],
    botId,
    color: "#2563eb",
    confirmationBeforeSend: false,
    createdAt: now,
    defaultImageUrl: null,
    deleteOriginalMessage: false,
    embedTitle: "{emoji} Abandono de Veículo — {user} | {userId}",
    emoji: "🚗",
    enabled: false,
    errorMessage: "❌ Não foi possível registrar. Verifique os campos obrigatórios.",
    explanatoryPanelAllowedRoleIds: [],
    explanatoryPanelButtonEnabled: true,
    explanatoryPanelChannelId: null,
    explanatoryPanelColor: "#2563eb",
    explanatoryPanelCommandEnabled: true,
    explanatoryPanelCommonErrorsText: "❌ Enviar apenas a foto.\n\n❌ Não informar a placa.\n\n❌ Não informar o modelo.\n\n❌ Não informar o relatório.\n\n❌ Enviar em outro canal.",
    explanatoryPanelDescription: "Este sistema é utilizado para registrar veículos abandonados encontrados durante o patrulhamento.\n\nPara que seu registro seja aceito, siga corretamente as instruções abaixo.",
    explanatoryPanelEmoji: "🚗",
    explanatoryPanelExampleText: "Modelo:\nLittle Bird\n\nPlaca:\nKQ34354\n\nRelatório:\nVeículo abandonado próximo ao hospital, sem proprietário aparente.\n\n(Foto anexada)",
    explanatoryPanelFinalText: "Após enviar corretamente as informações, o sistema criará automaticamente o registro oficial do veículo abandonado.",
    explanatoryPanelHowItWorksText: "📸 1. Tire uma foto do veículo.\n\n📝 2. Na mesma mensagem escreva:\n\n• Modelo do veículo\n• Placa\n• Relatório\n\n📤 3. Envie tudo junto no canal configurado.\n\n🤖 O sistema identificará automaticamente as informações e criará o registro.",
    explanatoryPanelImageUrl: null,
    explanatoryPanelModalContent: "Modelo:\nLittle Bird\n\nPlaca:\nKQ34354\n\nRelatório:\nVeículo encontrado abandonado próximo à praça central. Sem ocupantes e sem movimentação há várias horas.\n\nFoto:\n(Anexar junto da mensagem enviada no canal.)",
    explanatoryPanelModalTitle: "Exemplo Completo",
    explanatoryPanelNotesText: "• A ordem dos campos não importa.\n\n• Você pode escrever \"Modelo\", \"Placa\" e \"Relatório\" em qualquer ordem.\n\n• O sistema identifica automaticamente os campos.\n\n• É obrigatório anexar uma foto.\n\n• O registro só funciona no canal configurado pelo servidor.",
    explanatoryPanelRequiredFieldsText: "✅ Modelo do veículo\n\n✅ Placa\n\n✅ Relatório\n\n✅ Foto do veículo",
    explanatoryPanelThumbnailUrl: null,
    explanatoryPanelTitle: "🚗 Sistema de Abandono de Veículo",
    footerText: "Registrado por {user} | {userId} • {date} • {time}",
    guildId,
    logChannelId: null,
    logsEnabled: true,
    maxImages: 1,
    mentionRoleId: null,
    recordChannelId: null,
    successMessage: "✅ Registro de abandono de veículo enviado.",
    systemChannelId: null,
    systemName: "🚗 Abandono de Veículo",
    thumbnailUrl: null,
    updatedAt: now,
    updatedBy: null
  };
}

function sanitizeSettingsInput(input: SaveVehicleAbandonmentSettingsInput) {
  const next: SaveVehicleAbandonmentSettingsInput = { ...input };
  if (next.systemChannelId !== undefined) next.systemChannelId = normalizeSnowflake(next.systemChannelId);
  if (next.recordChannelId !== undefined) next.recordChannelId = normalizeSnowflake(next.recordChannelId);
  if (next.logChannelId !== undefined) next.logChannelId = normalizeSnowflake(next.logChannelId);
  if (next.mentionRoleId !== undefined) next.mentionRoleId = normalizeSnowflake(next.mentionRoleId);
  if (next.explanatoryPanelChannelId !== undefined) next.explanatoryPanelChannelId = normalizeSnowflake(next.explanatoryPanelChannelId);
  if (next.allowedRoleIds !== undefined) next.allowedRoleIds = uniqueSnowflakes(next.allowedRoleIds).slice(0, 100);
  if (next.explanatoryPanelAllowedRoleIds !== undefined) next.explanatoryPanelAllowedRoleIds = uniqueSnowflakes(next.explanatoryPanelAllowedRoleIds).slice(0, 100);
  if (next.maxImages !== undefined) next.maxImages = Math.min(10, Math.max(1, Math.trunc(Number(next.maxImages) || 1)));
  if (next.color !== undefined) next.color = normalizeColor(next.color);
  if (next.explanatoryPanelColor !== undefined) next.explanatoryPanelColor = normalizeColor(next.explanatoryPanelColor);
  if (next.emoji !== undefined) next.emoji = next.emoji.trim().slice(0, 80) || "🚗";
  if (next.explanatoryPanelEmoji !== undefined) next.explanatoryPanelEmoji = next.explanatoryPanelEmoji.trim().slice(0, 80) || "🚗";
  if (next.systemName !== undefined) next.systemName = next.systemName.trim().slice(0, 120) || "🚗 Abandono de Veículo";
  if (next.embedTitle !== undefined) next.embedTitle = next.embedTitle.trim().slice(0, 200) || "{emoji} Abandono de Veículo — {user} | {userId}";
  if (next.footerText !== undefined) next.footerText = next.footerText.trim().slice(0, 200) || "Registrado por {user} | {userId} • {date} • {time}";
  if (next.successMessage !== undefined) next.successMessage = next.successMessage.trim().slice(0, 500) || "✅ Registro de abandono de veículo enviado.";
  if (next.errorMessage !== undefined) next.errorMessage = next.errorMessage.trim().slice(0, 500) || "❌ Não foi possível registrar. Verifique os campos obrigatórios.";
  if (next.explanatoryPanelTitle !== undefined) next.explanatoryPanelTitle = sanitizeText(next.explanatoryPanelTitle, 200, "🚗 Sistema de Abandono de Veículo");
  if (next.explanatoryPanelDescription !== undefined) next.explanatoryPanelDescription = sanitizeText(next.explanatoryPanelDescription, 1200, "Este sistema é utilizado para registrar veículos abandonados encontrados durante o patrulhamento.");
  if (next.explanatoryPanelHowItWorksText !== undefined) next.explanatoryPanelHowItWorksText = sanitizeText(next.explanatoryPanelHowItWorksText, 1800, "📸 1. Tire uma foto do veículo.");
  if (next.explanatoryPanelRequiredFieldsText !== undefined) next.explanatoryPanelRequiredFieldsText = sanitizeText(next.explanatoryPanelRequiredFieldsText, 1000, "✅ Modelo do veículo\n\n✅ Placa\n\n✅ Relatório\n\n✅ Foto do veículo");
  if (next.explanatoryPanelExampleText !== undefined) next.explanatoryPanelExampleText = sanitizeText(next.explanatoryPanelExampleText, 1800, "Modelo:\nLittle Bird\n\nPlaca:\nKQ34354\n\nRelatório:\nVeículo abandonado próximo ao hospital, sem proprietário aparente.\n\n(Foto anexada)");
  if (next.explanatoryPanelNotesText !== undefined) next.explanatoryPanelNotesText = sanitizeText(next.explanatoryPanelNotesText, 1800, "• É obrigatório anexar uma foto.");
  if (next.explanatoryPanelCommonErrorsText !== undefined) next.explanatoryPanelCommonErrorsText = sanitizeText(next.explanatoryPanelCommonErrorsText, 1600, "❌ Enviar apenas a foto.");
  if (next.explanatoryPanelFinalText !== undefined) next.explanatoryPanelFinalText = sanitizeText(next.explanatoryPanelFinalText, 1000, "Após enviar corretamente as informações, o sistema criará automaticamente o registro oficial do veículo abandonado.");
  if (next.explanatoryPanelModalTitle !== undefined) next.explanatoryPanelModalTitle = sanitizeText(next.explanatoryPanelModalTitle, 45, "Exemplo Completo");
  if (next.explanatoryPanelModalContent !== undefined) next.explanatoryPanelModalContent = sanitizeText(next.explanatoryPanelModalContent, 3800, "Modelo:\nLittle Bird\n\nPlaca:\nKQ34354\n\nRelatório:\nVeículo encontrado abandonado próximo à praça central.\n\nFoto:\n(Anexar junto da mensagem enviada no canal.)");
  if (next.thumbnailUrl !== undefined) next.thumbnailUrl = normalizeUrl(next.thumbnailUrl);
  if (next.defaultImageUrl !== undefined) next.defaultImageUrl = normalizeUrl(next.defaultImageUrl);
  if (next.explanatoryPanelThumbnailUrl !== undefined) next.explanatoryPanelThumbnailUrl = normalizeUrl(next.explanatoryPanelThumbnailUrl);
  if (next.explanatoryPanelImageUrl !== undefined) next.explanatoryPanelImageUrl = normalizeUrl(next.explanatoryPanelImageUrl);
  return next;
}

function settingsDto(row: MongoVehicleAbandonmentSettings): VehicleAbandonmentSettingsDto {
  return {
    ...row,
    id: row._id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function recordDto(row: MongoVehicleAbandonmentRecord): VehicleAbandonmentRecordDto {
  return {
    ...row,
    id: row._id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function normalizeSnowflake(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^\d{5,32}$/.test(trimmed) ? trimmed : null;
}

function uniqueSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => normalizeSnowflake(value)).filter((value): value is string => Boolean(value)))];
}

function normalizeColor(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : "#2563eb";
}

function normalizeUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeText(value: string | null | undefined, maxLength: number, fallback: string) {
  const trimmed = value?.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function emitSettingsUpdated(botId: string, guildId: string) {
  const payload = { botId, guildId };
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "vehicle-abandonment:settings_updated", payload);
  emitRealtimeToRoom(dashboardLogRealtimeRoom(guildId, botId), "vehicle-abandonment:settings_updated", payload);
}

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
