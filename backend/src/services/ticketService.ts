import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoTicket } from "../database/mongo";

export type TicketDto = {
  id: string;
  botId: string | null;
  guildId: string;
  channelId?: string | null;
  openerId: string;
  ownerId?: string;
  subject: string;
  categoryId?: string | null;
  categoryName?: string | null;
  responsibleRoleId?: string | null;
  responsibleUserId?: string | null;
  status: MongoTicket["status"];
  closeReason?: string | null;
  finalResult?: string | null;
  isIncomplete?: boolean;
  createdAt: string;
  closedAt?: string | null;
};

const memoryTickets: TicketDto[] = [];

type CreateTicketInput = Pick<TicketDto, "guildId" | "channelId" | "openerId" | "subject"> & {
  allowedRoleIds?: string[];
  botId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  responsibleRoleId?: string | null;
  status?: MongoTicket["status"];
};

export async function createTicket(input: CreateTicketInput) {
  const ticket: TicketDto = {
    id: randomUUID(),
    botId: normalizeBotId(input.botId),
    guildId: input.guildId,
    channelId: input.channelId,
    openerId: input.openerId,
    ownerId: input.openerId,
    subject: input.subject,
    categoryId: input.categoryId ?? null,
    categoryName: input.categoryName ?? null,
    responsibleRoleId: input.responsibleRoleId ?? null,
    responsibleUserId: null,
    status: input.status ?? "OPEN",
    closeReason: null,
    finalResult: null,
    isIncomplete: false,
    createdAt: new Date().toISOString(),
    closedAt: null
  };

  memoryTickets.unshift(ticket);

  try {
    await ensureGuild(input.guildId);

    const { tickets } = await getMongoCollections();
    const doc: MongoTicket = {
      _id: randomUUID(),
      botId: normalizeBotId(input.botId),
      guildId: input.guildId,
      channelId: input.channelId ?? null,
      openerId: input.openerId,
      ownerId: input.openerId,
      subject: input.subject,
      categoryId: input.categoryId ?? null,
      categoryName: input.categoryName ?? null,
      responsibleRoleId: input.responsibleRoleId ?? null,
      responsibleUserId: null,
      allowedRoleIds: input.allowedRoleIds ?? [],
      status: input.status ?? "OPEN",
      closeReason: null,
      finalResult: null,
      internalNotes: null,
      closedById: null,
      isIncomplete: false,
      logs: {},
      createdAt: new Date(),
      closedAt: null
    };

    await tickets.insertOne(doc);

    return {
      ...ticket,
      id: doc._id,
      botId: normalizeBotId(doc.botId),
      channelId: doc.channelId,
      status: doc.status,
      createdAt: doc.createdAt.toISOString()
    };
  } catch (error) {
    console.warn("[mongo] ticket mantido em memória:", error instanceof Error ? error.message : error);
    return ticket;
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
      openerId: ticket.openerId,
      ownerId: ticket.ownerId ?? ticket.openerId,
      subject: ticket.subject,
      categoryId: ticket.categoryId ?? null,
      categoryName: ticket.categoryName ?? null,
      responsibleRoleId: ticket.responsibleRoleId ?? null,
      responsibleUserId: ticket.responsibleUserId ?? null,
      status: ticket.status,
      closeReason: ticket.closeReason ?? null,
      finalResult: ticket.finalResult ?? null,
      isIncomplete: Boolean(ticket.isIncomplete),
      createdAt: ticket.createdAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null
    }));
  } catch {
    return memoryTickets
      .filter((ticket) => (!guildId || ticket.guildId === guildId) && ticket.botId === normalizedBotId)
      .slice(0, 50);
  }
}

export async function getTicketByChannel(channelId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  try {
    const { tickets } = await getMongoCollections();
    const ticket = await tickets.findOne({ channelId, ...scopedQuery(undefined, normalizedBotId) });
    return ticket ? toDto(ticket) : null;
  } catch {
    return memoryTickets.find((ticket) => ticket.channelId === channelId && ticket.botId === normalizedBotId) ?? null;
  }
}

export async function getTicketById(ticketId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  try {
    const { tickets } = await getMongoCollections();
    const ticket = await tickets.findOne({ _id: ticketId, ...scopedQuery(undefined, normalizedBotId) });
    return ticket ? toDto(ticket) : null;
  } catch {
    return memoryTickets.find((ticket) => ticket.id === ticketId && ticket.botId === normalizedBotId) ?? null;
  }
}

export async function updateTicketStatus(ticketId: string, input: Partial<Pick<MongoTicket, "status" | "responsibleUserId" | "closeReason" | "finalResult" | "internalNotes" | "closedById" | "closedAt" | "isIncomplete">>) {
  const { tickets } = await getMongoCollections();
  const $set: Partial<MongoTicket> = {};
  for (const [key, value] of Object.entries(input) as Array<[keyof typeof input, unknown]>) {
    if (value !== undefined) {
      ($set as Record<string, unknown>)[key] = value;
    }
  }
  await tickets.updateOne({ _id: ticketId }, { $set });
  const ticket = await tickets.findOne({ _id: ticketId });
  return ticket ? toDto(ticket) : null;
}

export async function claimTicket(ticketId: string, userId: string) {
  try {
    const { tickets } = await getMongoCollections();
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
    const ticket = memoryTickets.find((item) => item.id === ticketId);
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
    openerId: ticket.openerId,
    ownerId: ticket.ownerId ?? ticket.openerId,
    subject: ticket.subject,
    categoryId: ticket.categoryId ?? null,
    categoryName: ticket.categoryName ?? null,
    responsibleRoleId: ticket.responsibleRoleId ?? null,
    responsibleUserId: ticket.responsibleUserId ?? null,
    status: ticket.status,
    closeReason: ticket.closeReason ?? null,
    finalResult: ticket.finalResult ?? null,
    isIncomplete: Boolean(ticket.isIncomplete),
    createdAt: ticket.createdAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null
  };
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
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
