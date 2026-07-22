import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type {
  MongoSalesTicket,
  MongoSalesTicketLog,
  MongoSalesTicketPassword,
  MongoSalesTicketSettings,
  MongoSalesTicketTranscript,
  MongoSalesTicketType
} from "../database/mongo";
import { getMongoCollections } from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import { env } from "../config/env";

export const SALES_TICKET_MODULE_ID = "nex-tech-sales";

export type SalesTicketSettingsDto = Omit<MongoSalesTicketSettings, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type SalesTicketTypeDto = Omit<MongoSalesTicketType, "_id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type SalesTicketDto = Omit<MongoSalesTicket, "_id" | "createdAt" | "updatedAt" | "closedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type SalesTicketLogDto = Omit<MongoSalesTicketLog, "_id" | "createdAt"> & {
  id: string;
  createdAt: string;
};

export type SalesTicketDashboardDto = {
  logs: SalesTicketLogDto[];
  settings: SalesTicketSettingsDto;
  tickets: SalesTicketDto[];
  types: SalesTicketTypeDto[];
};

export type SaveSalesTicketSettingsInput = Partial<Pick<
  MongoSalesTicketSettings,
  | "closeDeleteDelaySeconds"
  | "enabled"
  | "panelChannelId"
  | "panelColor"
  | "panelDescription"
  | "panelImageUrl"
  | "panelPlaceholder"
  | "panelTitle"
>>;

export type SaveSalesTicketTypeInput = Partial<Pick<
  MongoSalesTicketType,
  | "active"
  | "categoryId"
  | "channelNamePattern"
  | "description"
  | "emoji"
  | "initialMessage"
  | "name"
  | "order"
  | "supportRoleIds"
  | "ticketLimit"
>>;

export type CreateSalesTicketInput = {
  typeId: string;
  userId: string;
  userName?: string | null;
};

export type CloseSalesTicketTranscriptInput = {
  actorId: string;
  actorName?: string | null;
  channelId?: string | null;
  closeReason?: string | null;
  messages: Array<Record<string, unknown>>;
};

const DEFAULT_INITIAL_MESSAGE = "Olá {usuario}\n\nSeu atendimento foi iniciado.\nAguarde um membro da equipe.";

export async function getSalesTicketDashboard(botId: string, guildId: string, ownerUserId: string): Promise<SalesTicketDashboardDto> {
  const collections = await getMongoCollections();
  const settings = await ensureSalesTicketSettings(botId, guildId, ownerUserId);
  const [types, tickets, logs] = await Promise.all([
    collections.salesTicketTypes.find({ botId, guildId }).sort({ order: 1, updatedAt: -1 }).limit(100).toArray(),
    collections.salesTickets.find({ botId, guildId }).sort({ createdAt: -1 }).limit(80).toArray(),
    collections.salesTicketLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(80).toArray()
  ]);

  return {
    logs: logs.map(toLogDto),
    settings: toSettingsDto(settings),
    tickets: tickets.map(toTicketDto),
    types: types.map(toTypeDto)
  };
}

export async function getSalesTicketRuntime(botId: string, guildId: string, ownerUserId = "runtime") {
  const collections = await getMongoCollections();
  const settings = await ensureSalesTicketSettings(botId, guildId, ownerUserId);
  const [types, tickets] = await Promise.all([
    collections.salesTicketTypes.find({ botId, guildId, active: true }).sort({ order: 1, updatedAt: -1 }).limit(25).toArray(),
    collections.salesTickets.find({ botId, guildId, status: { $in: ["open", "claimed"] } }).sort({ createdAt: -1 }).limit(300).toArray()
  ]);

  return {
    settings: toSettingsDto(settings),
    tickets: tickets.map(toTicketDto),
    types: types.map(toTypeDto)
  };
}

export async function saveSalesTicketSettings(botId: string, guildId: string, input: SaveSalesTicketSettingsInput, actorId: string) {
  const collections = await getMongoCollections();
  const current = await ensureSalesTicketSettings(botId, guildId, actorId);
  const now = new Date();
  const patch: Partial<MongoSalesTicketSettings> = {
    updatedAt: now,
    updatedBy: actorId
  };

  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (input.panelChannelId !== undefined) patch.panelChannelId = input.panelChannelId;
  if (input.panelTitle !== undefined) patch.panelTitle = limitText(input.panelTitle, 120);
  if (input.panelDescription !== undefined) patch.panelDescription = limitText(input.panelDescription, 1500);
  if (input.panelImageUrl !== undefined) patch.panelImageUrl = input.panelImageUrl;
  if (input.panelColor !== undefined) patch.panelColor = /^#[0-9a-f]{6}$/i.test(input.panelColor) ? input.panelColor : current.panelColor;
  if (input.panelPlaceholder !== undefined) patch.panelPlaceholder = limitText(input.panelPlaceholder, 100);
  if (input.closeDeleteDelaySeconds !== undefined) patch.closeDeleteDelaySeconds = clamp(input.closeDeleteDelaySeconds, 15, 86_400);

  await collections.salesTicketSettings.updateOne({ _id: current._id }, { $set: patch });
  const next = await collections.salesTicketSettings.findOne({ _id: current._id });
  const settings = next ?? current;
  emitSalesTicketRealtime(botId, guildId, "sales-tickets:settings_updated", { botId, guildId, settings: toSettingsDto(settings) });
  await writeSalesTicketLog(botId, guildId, null, "settings_updated", actorId, null, "Configuração de tickets de vendas atualizada.", {});
  return settings;
}

export async function saveSalesTicketType(botId: string, guildId: string, typeId: string | null, input: SaveSalesTicketTypeInput, actorId: string) {
  const collections = await getMongoCollections();
  await ensureSalesTicketSettings(botId, guildId, actorId);
  const now = new Date();
  const id = typeId || randomUUID();
  const existing = typeId ? await collections.salesTicketTypes.findOne({ _id: typeId, botId, guildId }) : null;

  if (!existing && !input.name?.trim()) {
    throw createSalesTicketError("Informe o nome do tipo de ticket.", 400);
  }

  const document: MongoSalesTicketType = {
    _id: id,
    active: input.active ?? existing?.active ?? true,
    botId,
    categoryId: input.categoryId ?? existing?.categoryId ?? null,
    channelNamePattern: limitText(input.channelNamePattern ?? existing?.channelNamePattern ?? "ticket-{usuario}", 90),
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actorId,
    description: limitText(input.description ?? existing?.description ?? "Abrir atendimento de vendas.", 100),
    emoji: input.emoji ?? existing?.emoji ?? null,
    guildId,
    initialMessage: limitText(input.initialMessage ?? existing?.initialMessage ?? DEFAULT_INITIAL_MESSAGE, 1500),
    name: limitText(input.name ?? existing?.name ?? "Atendimento", 80),
    order: input.order ?? existing?.order ?? 0,
    ownerUserId: existing?.ownerUserId ?? actorId,
    supportRoleIds: [...new Set(input.supportRoleIds ?? existing?.supportRoleIds ?? [])].slice(0, 20),
    ticketLimit: input.ticketLimit === undefined ? existing?.ticketLimit ?? 1 : input.ticketLimit,
    updatedAt: now,
    updatedBy: actorId
  };

  await collections.salesTicketTypes.updateOne(
    { _id: id, botId, guildId },
    { $set: document },
    { upsert: true }
  );
  await writeSalesTicketLog(botId, guildId, null, existing ? "type_updated" : "type_created", actorId, null, `Tipo de ticket de vendas salvo: ${document.name}.`, { typeId: id });
  emitSalesTicketRealtime(botId, guildId, "sales-tickets:type_saved", { botId, guildId, type: toTypeDto(document) });
  return document;
}

export async function duplicateSalesTicketType(botId: string, guildId: string, typeId: string, actorId: string) {
  const collections = await getMongoCollections();
  const current = await collections.salesTicketTypes.findOne({ _id: typeId, botId, guildId });
  if (!current) return null;
  return saveSalesTicketType(botId, guildId, null, {
    ...current,
    name: `${current.name} (cópia)`,
    order: current.order + 1
  }, actorId);
}

export async function deleteSalesTicketType(botId: string, guildId: string, typeId: string, actorId: string) {
  const collections = await getMongoCollections();
  const current = await collections.salesTicketTypes.findOne({ _id: typeId, botId, guildId });
  if (!current) return null;
  await collections.salesTicketTypes.deleteOne({ _id: typeId, botId, guildId });
  await writeSalesTicketLog(botId, guildId, null, "type_deleted", actorId, null, `Tipo de ticket de vendas removido: ${current.name}.`, { typeId });
  emitSalesTicketRealtime(botId, guildId, "sales-tickets:type_deleted", { botId, guildId, typeId });
  return current;
}

export async function requestSalesTicketPanelPublish(botId: string, guildId: string, actorId: string) {
  const settings = await saveSalesTicketSettings(botId, guildId, {}, actorId);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "sales-tickets:panel_publish", { botId, guildId, settings: toSettingsDto(settings) });
  await writeSalesTicketLog(botId, guildId, null, "panel_publish_requested", actorId, null, "Publicação do painel de tickets de vendas solicitada.", {});
  return settings;
}

export async function updateSalesTicketPanelState(botId: string, guildId: string, messageId: string | null) {
  const collections = await getMongoCollections();
  const settings = await ensureSalesTicketSettings(botId, guildId, "runtime");
  const now = new Date();
  await collections.salesTicketSettings.updateOne({ _id: settings._id }, { $set: { panelMessageId: messageId, updatedAt: now } });
  return (await collections.salesTicketSettings.findOne({ _id: settings._id })) ?? settings;
}

export async function createSalesTicket(botId: string, guildId: string, input: CreateSalesTicketInput) {
  const collections = await getMongoCollections();
  const [settings, type] = await Promise.all([
    ensureSalesTicketSettings(botId, guildId, "runtime"),
    collections.salesTicketTypes.findOne({ _id: input.typeId, botId, guildId, active: true })
  ]);

  if (!settings.enabled) throw createSalesTicketError("Sistema de tickets de vendas desativado.", 403);
  if (!type) throw createSalesTicketError("Tipo de ticket de vendas indisponível.", 404);

  if (type.ticketLimit !== null) {
    const openCount = await collections.salesTickets.countDocuments({
      botId,
      guildId,
      status: { $in: ["open", "claimed"] },
      typeId: type._id,
      userId: input.userId
    });

    if (openCount >= type.ticketLimit) {
      throw createSalesTicketError(`Você já atingiu o limite de ${type.ticketLimit} ticket(s) aberto(s) deste tipo.`, 409);
    }
  }

  const now = new Date();
  const ticket: MongoSalesTicket = {
    _id: randomUUID(),
    botId,
    channelId: null,
    claimedById: null,
    claimedByName: null,
    closeReason: null,
    closedAt: null,
    createdAt: now,
    guildId,
    ownerUserId: type.ownerUserId,
    passwordId: null,
    status: "open",
    transcriptId: null,
    typeId: type._id,
    typeName: type.name,
    updatedAt: now,
    userId: input.userId,
    userName: input.userName ?? null
  };

  await collections.salesTickets.insertOne(ticket);
  await writeSalesTicketLog(botId, guildId, ticket._id, "ticket_created", input.userId, input.userName ?? null, `Ticket de vendas criado: ${type.name}.`, { typeId: type._id });
  emitSalesTicketRealtime(botId, guildId, "sales-tickets:ticket_created", { botId, guildId, ticket: toTicketDto(ticket) });
  return { settings: toSettingsDto(settings), ticket: toTicketDto(ticket), type: toTypeDto(type) };
}

export async function updateSalesTicketChannel(botId: string, guildId: string, ticketId: string, channelId: string | null) {
  const collections = await getMongoCollections();
  const now = new Date();
  await collections.salesTickets.updateOne({ _id: ticketId, botId, guildId }, { $set: { channelId, updatedAt: now } });
  const ticket = await collections.salesTickets.findOne({ _id: ticketId, botId, guildId });
  if (!ticket) return null;
  emitSalesTicketRealtime(botId, guildId, "sales-tickets:ticket_updated", { botId, guildId, ticket: toTicketDto(ticket) });
  return ticket;
}

export async function claimSalesTicket(botId: string, guildId: string, ticketId: string, actorId: string, actorName: string | null) {
  const collections = await getMongoCollections();
  const now = new Date();
  await collections.salesTickets.updateOne(
    { _id: ticketId, botId, guildId, status: { $in: ["open", "claimed"] } },
    { $set: { claimedById: actorId, claimedByName: actorName, status: "claimed", updatedAt: now } }
  );
  const ticket = await collections.salesTickets.findOne({ _id: ticketId, botId, guildId });
  if (!ticket) return null;
  await writeSalesTicketLog(botId, guildId, ticketId, "ticket_claimed", actorId, actorName, "Ticket de vendas assumido.", {});
  emitSalesTicketRealtime(botId, guildId, "sales-tickets:ticket_updated", { botId, guildId, ticket: toTicketDto(ticket) });
  return ticket;
}

export async function closeSalesTicketWithTranscript(botId: string, guildId: string, ticketId: string, input: CloseSalesTicketTranscriptInput) {
  const collections = await getMongoCollections();
  const ticket = await collections.salesTickets.findOne({ _id: ticketId, botId, guildId });
  if (!ticket) return null;
  if (ticket.status === "closed" && ticket.transcriptId) return null;
  const now = new Date();
  const transcriptId = randomUUID();
  const passwordId = randomUUID();
  const plainPassword = createTranscriptPassword();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashTranscriptPassword(plainPassword, salt);
  const transcript: MongoSalesTicketTranscript = {
    _id: transcriptId,
    botId,
    channelId: input.channelId ?? ticket.channelId,
    createdAt: now,
    guildId,
    messageCount: input.messages.length,
    messages: input.messages.slice(0, 1000),
    ticketId,
    userId: ticket.userId
  };
  const password: MongoSalesTicketPassword = {
    _id: passwordId,
    botId,
    createdAt: now,
    guildId,
    passwordHash,
    salt,
    ticketId,
    transcriptId
  };

  await collections.salesTicketTranscripts.insertOne(transcript);
  await collections.salesTicketPasswords.insertOne(password);
  await collections.salesTickets.updateOne(
    { _id: ticketId, botId, guildId },
    {
      $set: {
        channelId: input.channelId ?? ticket.channelId,
        closeReason: input.closeReason ?? null,
        closedAt: now,
        passwordId,
        status: "closed",
        transcriptId,
        updatedAt: now
      }
    }
  );
  await writeSalesTicketLog(botId, guildId, ticketId, "ticket_closed", input.actorId, input.actorName ?? null, "Ticket de vendas fechado e transcript exclusivo gerado.", {
    messageCount: transcript.messageCount,
    transcriptId
  });
  const updated = await collections.salesTickets.findOne({ _id: ticketId, botId, guildId });
  if (updated) emitSalesTicketRealtime(botId, guildId, "sales-tickets:ticket_updated", { botId, guildId, ticket: toTicketDto(updated) });
  return {
    password: plainPassword,
    ticket: updated ? toTicketDto(updated) : toTicketDto(ticket),
    transcriptId,
    transcriptUrl: `${env.APP_PUBLIC_URL}/api/nex-tech-sales/tickets/transcripts/${encodeURIComponent(transcriptId)}`
  };
}

export async function readSalesTicketTranscript(transcriptId: string) {
  const collections = await getMongoCollections();
  const transcript = await collections.salesTicketTranscripts.findOne({ _id: transcriptId });
  if (!transcript) return null;
  const ticket = await collections.salesTickets.findOne({ _id: transcript.ticketId, botId: transcript.botId, guildId: transcript.guildId });
  return { ticket: ticket ? toTicketDto(ticket) : null, transcript };
}

export async function verifyAndReadSalesTicketTranscript(transcriptId: string, password: string) {
  const collections = await getMongoCollections();
  const [transcript, passwordRecord] = await Promise.all([
    collections.salesTicketTranscripts.findOne({ _id: transcriptId }),
    collections.salesTicketPasswords.findOne({ transcriptId })
  ]);
  if (!transcript || !passwordRecord) return null;
  const hash = hashTranscriptPassword(password, passwordRecord.salt);
  const expected = Buffer.from(passwordRecord.passwordHash, "hex");
  const received = Buffer.from(hash, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const ticket = await collections.salesTickets.findOne({ _id: transcript.ticketId, botId: transcript.botId, guildId: transcript.guildId });
  return { ticket: ticket ? toTicketDto(ticket) : null, transcript };
}

export function toSettingsDto(settings: MongoSalesTicketSettings): SalesTicketSettingsDto {
  return {
    ...settings,
    id: settings._id,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

export function toTypeDto(type: MongoSalesTicketType): SalesTicketTypeDto {
  return {
    ...type,
    id: type._id,
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString()
  };
}

export function toTicketDto(ticket: MongoSalesTicket): SalesTicketDto {
  return {
    ...ticket,
    id: ticket._id,
    closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString()
  };
}

function toLogDto(log: MongoSalesTicketLog): SalesTicketLogDto {
  return {
    ...log,
    id: log._id,
    createdAt: log.createdAt.toISOString()
  };
}

async function ensureSalesTicketSettings(botId: string, guildId: string, ownerUserId: string) {
  const collections = await getMongoCollections();
  const current = await collections.salesTicketSettings.findOne({ botId, guildId });
  if (current) return current;
  const now = new Date();
  const settings: MongoSalesTicketSettings = {
    _id: randomUUID(),
    botId,
    closeDeleteDelaySeconds: 15,
    createdAt: now,
    createdBy: ownerUserId,
    enabled: false,
    guildId,
    ownerUserId,
    panelChannelId: null,
    panelColor: "#FFD500",
    panelDescription: "Selecione abaixo o tipo de atendimento de vendas que deseja abrir.",
    panelImageUrl: null,
    panelMessageId: null,
    panelPlaceholder: "Selecione o atendimento desejado",
    panelTitle: "Sistema de Tickets de Vendas",
    updatedAt: now,
    updatedBy: ownerUserId
  };
  await collections.salesTicketSettings.insertOne(settings);
  return settings;
}

async function writeSalesTicketLog(botId: string, guildId: string, ticketId: string | null, event: string, actorId: string | null, actorName: string | null, message: string, data: Record<string, unknown>) {
  const collections = await getMongoCollections();
  await collections.salesTicketLogs.insertOne({
    _id: randomUUID(),
    actorId,
    actorName,
    botId,
    createdAt: new Date(),
    data,
    event,
    guildId,
    message,
    ticketId
  });
}

function emitSalesTicketRealtime(botId: string, guildId: string, event: string, payload: Record<string, unknown>) {
  emitRealtime(event, payload);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), event, payload);
  emitRealtimeToRoom(devBotRealtimeRoom(botId), "sales-tickets:dashboard_updated", { botId, guildId });
}

function createTranscriptPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = [0, 1, 2].map(() => Array.from({ length: 4 }, () => {
    const index = (randomBytes(1)[0] ?? 0) % alphabet.length;
    return alphabet[index] ?? "A";
  }).join(""));
  return segments.join("-");
}

function hashTranscriptPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function limitText(value: string, max: number) {
  return value.trim().slice(0, max);
}

function createSalesTicketError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}
