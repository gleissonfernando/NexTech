import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoTicket } from "../database/mongo";

export type TicketDto = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId?: string | null;
  panelId?: string | null;
  openerId: string;
  ownerId?: string;
  subject: string;
  categoryId?: string | null;
  categoryName?: string | null;
  isClient?: boolean | null;
  moduleType: string;
  ticketType: string | null;
  migrationStatus?: string | null;
  responsibleRoleId?: string | null;
  responsibleUserId?: string | null;
  status: MongoTicket["status"];
  closeReason?: string | null;
  closedById?: string | null;
  finalResult?: string | null;
  isIncomplete?: boolean;
  lastUserCallAt?: string | null;
  createdAt: string;
  closedAt?: string | null;
};

const memoryTickets: TicketDto[] = [];

type CreateTicketInput = Pick<TicketDto, "guildId" | "channelId" | "openerId" | "subject"> & {
  allowedRoleIds?: string[];
  botId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  isClient?: boolean | null;
  moduleType?: string | null;
  panelId?: string | null;
  responsibleRoleId?: string | null;
  status?: MongoTicket["status"];
  ticketId?: string;
  ticketType?: string | null;
};

export async function createTicket(input: CreateTicketInput) {
  const normalizedBotId = normalizeBotId(input.botId);
  const moduleType = normalizeModuleType(input.moduleType);
  if (input.ticketId) {
    const exact = await getTicketById(input.ticketId, normalizedBotId);
    if (exact) return { created: false, ticket: exact };
  } else {
    const existing = await findOpenTicket(input.guildId, normalizedBotId, input.openerId, input.categoryId ?? null, moduleType);
    if (existing) {
      return { created: false, ticket: existing };
    }
  }

  const ticket: TicketDto = {
    id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    channelId: input.channelId,
    panelId: input.panelId ?? input.categoryId ?? null,
    openerId: input.openerId,
    ownerId: input.openerId,
    subject: input.subject,
    categoryId: input.categoryId ?? null,
    categoryName: input.categoryName ?? null,
    isClient: input.isClient ?? null,
    moduleType,
    ticketType: normalizeTicketType(input.ticketType, moduleType, input.categoryId),
    migrationStatus: "ok",
    responsibleRoleId: input.responsibleRoleId ?? null,
    responsibleUserId: null,
    status: input.status ?? "OPEN",
    closeReason: null,
    finalResult: null,
    isIncomplete: false,
    createdAt: new Date().toISOString(),
    closedAt: null
  };

  try {
    await ensureGuild(input.guildId);

    const { tickets } = await getMongoCollections();
    const doc: MongoTicket = {
      _id: input.ticketId ?? randomUUID(),
      activeKey: input.ticketId
        ? ticketRecoveryActiveKey(input.guildId, normalizedBotId, input.openerId, input.categoryId ?? null, input.ticketId, moduleType)
        : ticketActiveKey(input.guildId, normalizedBotId, input.openerId, input.categoryId ?? null, moduleType),
      botId: normalizedBotId,
      guildId: input.guildId,
      channelId: input.channelId ?? null,
      panelId: input.panelId ?? input.categoryId ?? null,
      openerId: input.openerId,
      ownerId: input.openerId,
      subject: input.subject,
      categoryId: input.categoryId ?? null,
      categoryName: input.categoryName ?? null,
      isClient: input.isClient ?? null,
      moduleType,
      ticketType: normalizeTicketType(input.ticketType, moduleType, input.categoryId),
      migrationStatus: "ok",
      responsibleRoleId: input.responsibleRoleId ?? null,
      responsibleUserId: null,
      allowedRoleIds: input.allowedRoleIds ?? [],
      status: input.status ?? "OPEN",
      closeReason: null,
      finalResult: null,
      internalNotes: null,
      closedById: null,
      lastUserCallAt: null,
      isIncomplete: false,
      logs: {},
      createdAt: new Date(),
      closedAt: null
    };

    await tickets.insertOne(doc);
    memoryTickets.unshift({ ...ticket, id: doc._id });

    return {
      created: true,
      ticket: {
      ...ticket,
      id: doc._id,
      botId: normalizeBotId(doc.botId),
      channelId: doc.channelId,
      status: doc.status,
      createdAt: doc.createdAt.toISOString()
      }
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const concurrent = input.ticketId
        ? await getTicketById(input.ticketId, normalizedBotId)
        : await findOpenTicket(input.guildId, normalizedBotId, input.openerId, input.categoryId ?? null, moduleType);
      if (concurrent) return { created: false, ticket: concurrent };
    }
    throw error;
  }
}

export async function findOpenTicket(guildId: string, botId: string | null | undefined, openerId: string, categoryId?: string | null, moduleTypeInput?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const moduleType = normalizeModuleType(moduleTypeInput);
  const activeStatuses: MongoTicket["status"][] = ["OPEN", "PENDING", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER"];
  const categoryQuery = categoryId ? { categoryId } : {};

  try {
    const { tickets } = await getMongoCollections();
    const ticket = await tickets.findOne({
      ...scopedQuery(guildId, normalizedBotId),
      ...categoryQuery,
      moduleType,
      openerId,
      status: { $in: activeStatuses }
    }, { sort: { createdAt: -1 } });
    return ticket ? toDto(ticket) : null;
  } catch {
    return memoryTickets.find((ticket) =>
      ticket.guildId === guildId
      && ticket.botId === normalizedBotId
      && ticket.openerId === openerId
      && (!categoryId || ticket.categoryId === categoryId)
      && ticket.moduleType === moduleType
      && activeStatuses.includes(ticket.status)
    ) ?? null;
  }
}

export async function listTickets(guildId?: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { tickets } = await getMongoCollections();
    const rows = await tickets
      .find(scopedQuery(guildId, normalizedBotId))
      .sort({
        createdAt: -1
      })
      .limit(50)
      .toArray();

    return rows.map((ticket) => ({
      id: ticket._id,
      botId: normalizeBotId(ticket.botId),
      guildId: ticket.guildId,
      channelId: ticket.channelId,
      panelId: ticket.panelId ?? ticket.categoryId ?? null,
      openerId: ticket.openerId,
      ownerId: ticket.ownerId ?? ticket.openerId,
      subject: ticket.subject,
      categoryId: ticket.categoryId ?? null,
      categoryName: ticket.categoryName ?? null,
      isClient: ticket.isClient ?? null,
      moduleType: normalizeModuleType(ticket.moduleType),
      ticketType: normalizeTicketType(ticket.ticketType, normalizeModuleType(ticket.moduleType), ticket.categoryId),
      migrationStatus: ticket.migrationStatus ?? null,
      responsibleRoleId: ticket.responsibleRoleId ?? null,
      responsibleUserId: ticket.responsibleUserId ?? null,
      status: ticket.status,
      closeReason: ticket.closeReason ?? null,
      finalResult: ticket.finalResult ?? null,
      isIncomplete: Boolean(ticket.isIncomplete),
      createdAt: ticket.createdAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null,
      closedById: ticket.closedById ?? null,
      lastUserCallAt: ticket.lastUserCallAt?.toISOString() ?? null
    }));
  } catch {
    return memoryTickets
      .filter((ticket) => (!guildId || ticket.guildId === guildId) && ticket.botId === normalizedBotId)
      .slice(0, 50);
  }
}

export async function getTicketByChannel(channelId: string, botId?: string | null, guildId?: string) {
  const normalizedBotId = normalizeBotId(botId);
  try {
    const { tickets } = await getMongoCollections();
    for (const query of ticketChannelLookupQueries(channelId, guildId, normalizedBotId)) {
      const ticket = await tickets.findOne(query);
      if (ticket) return toDto(ticket);
    }
    return null;
  } catch {
    return memoryTickets.find((ticket) => ticket.channelId === channelId && ticket.botId === normalizedBotId && (!guildId || ticket.guildId === guildId)) ?? null;
  }
}

export async function getTicketById(ticketId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  try {
    const { tickets } = await getMongoCollections();
    for (const query of ticketIdLookupQueries(ticketId, normalizedBotId)) {
      const ticket = await tickets.findOne(query);
      if (ticket) return toDto(ticket);
    }
    return null;
  } catch {
    return memoryTickets.find((ticket) => ticket.id === ticketId && ticket.botId === normalizedBotId) ?? null;
  }
}

export async function updateTicketStatus(ticketId: string, botId: string | null, input: Partial<Pick<MongoTicket, "status" | "responsibleUserId" | "responsibleRoleId" | "categoryId" | "categoryName" | "panelId" | "subject" | "ticketType" | "closeReason" | "finalResult" | "internalNotes" | "closedById" | "closedAt" | "isIncomplete" | "lastUserCallAt">>) {
  const { tickets } = await getMongoCollections();
  const $set: Partial<MongoTicket> = {};
  for (const [key, value] of Object.entries(input) as Array<[keyof typeof input, unknown]>) {
    if (value !== undefined) {
      ($set as Record<string, unknown>)[key] = value;
    }
  }
  const closesReservation = input.status ? !isActiveTicketStatus(input.status) : false;
  const ticket = await getTicketById(ticketId, botId);
  if (!ticket) return null;
  await tickets.updateOne(
    { _id: ticketId },
    closesReservation ? { $set, $unset: { activeKey: "" } } : { $set }
  );
  const updated = await tickets.findOne({ _id: ticketId });
  return updated ? toDto(updated) : null;
}

export async function beginTicketClosing(ticketId: string, botId: string | null, input: Pick<MongoTicket, "closedById" | "closeReason" | "finalResult"> & Pick<Partial<MongoTicket>, "internalNotes">) {
  const { tickets } = await getMongoCollections();
  const ticket = await getTicketById(ticketId, botId);
  if (!ticket) return { closing: false, ticket: null };
  const now = new Date();
  const closed = await tickets.findOneAndUpdate(
    {
      _id: ticketId,
      status: { $in: ["OPEN", "PENDING", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER"] }
    },
    {
      $set: {
        closedAt: now,
        closedById: input.closedById,
        closeReason: input.closeReason,
        finalResult: input.finalResult,
        internalNotes: input.internalNotes ?? null,
        status: "CLOSING"
      },
      $unset: { activeKey: "" }
    },
    { returnDocument: "after" }
  );
  if (closed) return { closing: true, ticket: toDto(closed) };
  const existing = await tickets.findOne({ _id: ticketId });
  return { closing: false, ticket: existing ? toDto(existing) : null };
}

export async function updateTicketChannel(ticketId: string, botId: string | null, channelId: string | null) {
  const { tickets } = await getMongoCollections();
  const ticket = await getTicketById(ticketId, botId);
  if (!ticket) return null;
  await tickets.updateOne({ _id: ticketId }, { $set: { channelId } });
  const updated = await tickets.findOne({ _id: ticketId });
  return updated ? toDto(updated) : null;
}

export async function claimTicket(ticketId: string, botId: string | null, userId: string) {
  try {
    const { tickets } = await getMongoCollections();
    const ticket = await getTicketById(ticketId, botId);
    if (!ticket) {
      return { claimed: false, ticket: null };
    }
    const claimed = await tickets.findOneAndUpdate(
      {
        _id: ticketId,
        responsibleUserId: { $in: [null, ""] },
        status: { $nin: ["CLOSED", "ARCHIVED", "RESOLVED", "DENIED"] }
      },
      {
        $set: {
          responsibleUserId: userId,
          status: "IN_ANALYSIS"
        }
      },
      { returnDocument: "after" }
    );

    if (claimed) {
      return { claimed: true, ticket: toDto(claimed) };
    }

    const existing = await tickets.findOne({ _id: ticketId });
    return { claimed: false, ticket: existing ? toDto(existing) : null };
  } catch (error) {
    const normalizedBotId = normalizeBotId(botId);
    const ticket = memoryTickets.find((item) => item.id === ticketId && (item.botId === normalizedBotId || (!normalizedBotId && item.botId === null)));
    if (!ticket || ticket.responsibleUserId || ["CLOSED", "ARCHIVED", "RESOLVED", "DENIED"].includes(ticket.status)) {
      return { claimed: false, ticket: ticket ?? null };
    }
    ticket.responsibleUserId = userId;
    ticket.status = "IN_ANALYSIS";
    return { claimed: true, ticket };
  }
}

export async function recordTicketEvent(input: {
  authorId?: string | null;
  botId?: string | null;
  content: string;
  eventType: string;
  guildId: string;
  metadata?: Record<string, unknown>;
  ticketId: string;
}) {
  const { ticketEvents } = await getMongoCollections();
  await ticketEvents.insertOne({
    _id: randomUUID(),
    ticketId: input.ticketId,
    guildId: input.guildId,
    botId: normalizeBotId(input.botId),
    eventType: input.eventType,
    authorId: input.authorId ?? null,
    content: input.content,
    metadata: input.metadata ?? {},
    createdAt: new Date()
  });
}

function toDto(ticket: MongoTicket): TicketDto {
  return {
    id: ticket._id,
    botId: normalizeBotId(ticket.botId),
    guildId: ticket.guildId,
    channelId: ticket.channelId,
    panelId: ticket.panelId ?? ticket.categoryId ?? null,
    openerId: ticket.openerId,
    ownerId: ticket.ownerId ?? ticket.openerId,
    subject: ticket.subject,
    categoryId: ticket.categoryId ?? null,
    categoryName: ticket.categoryName ?? null,
    isClient: ticket.isClient ?? null,
    moduleType: normalizeModuleType(ticket.moduleType),
    ticketType: normalizeTicketType(ticket.ticketType, normalizeModuleType(ticket.moduleType), ticket.categoryId),
    migrationStatus: ticket.migrationStatus ?? null,
    responsibleRoleId: ticket.responsibleRoleId ?? null,
    responsibleUserId: ticket.responsibleUserId ?? null,
    status: ticket.status,
    closeReason: ticket.closeReason ?? null,
    finalResult: ticket.finalResult ?? null,
    isIncomplete: Boolean(ticket.isIncomplete),
    createdAt: ticket.createdAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
    closedById: ticket.closedById ?? null,
    lastUserCallAt: ticket.lastUserCallAt?.toISOString() ?? null
  };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

export function ticketIdLookupQueries(ticketId: string, botId: string | null): Array<Record<string, unknown>> {
  const queries: Array<Record<string, unknown>> = [{ _id: ticketId, ...scopedQuery(undefined, botId) }];
  queries.push({ _id: ticketId });
  return queries;
}

export function ticketChannelLookupQueries(channelId: string, guildId: string | undefined, botId: string | null): Array<Record<string, unknown>> {
  const queries: Array<Record<string, unknown>> = [{ channelId, ...scopedQuery(guildId, botId) }];
  queries.push(guildId ? { channelId, guildId } : { channelId });
  return queries;
}

function scopedQuery(guildId: string | undefined, botId: string | null) {
  const botScope = botId
    ? { botId }
    : {
        $or: [
          {
            botId: null
          },
          {
            botId: {
              $exists: false
            }
          }
        ]
      };

  return guildId ? { guildId, ...botScope } : botScope;
}

export function ticketActiveKey(guildId: string, botId: string | null, openerId: string, categoryId: string | null, moduleType = "default") {
  return [botId ?? "primary", guildId, normalizeModuleType(moduleType), openerId, categoryId ?? "default"].join(":");
}

export function ticketRecoveryActiveKey(guildId: string, botId: string | null, openerId: string, categoryId: string | null, ticketId: string, moduleType = "default") {
  return `${ticketActiveKey(guildId, botId, openerId, categoryId, moduleType)}:${ticketId}`;
}

export function isActiveTicketStatus(status: MongoTicket["status"]) {
  return ["OPEN", "PENDING", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER"].includes(status);
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && Number((error as { code?: unknown }).code) === 11000;
}

function normalizeModuleType(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "police" ? "police" : "default";
}

function normalizeTicketType(value: string | null | undefined, moduleType: string, categoryId?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (normalized) return normalized;
  return moduleType === "police" ? "police" : categoryId?.trim() || "support";
}
