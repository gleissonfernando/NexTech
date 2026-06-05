import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoTicket } from "../database/mongo";

export type TicketDto = {
  id: string;
  guildId: string;
  channelId?: string | null;
  openerId: string;
  subject: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  createdAt: string;
  closedAt?: string | null;
};

const memoryTickets: TicketDto[] = [];

export async function createTicket(input: Pick<TicketDto, "guildId" | "channelId" | "openerId" | "subject">) {
  const ticket: TicketDto = {
    id: randomUUID(),
    guildId: input.guildId,
    channelId: input.channelId,
    openerId: input.openerId,
    subject: input.subject,
    status: "OPEN",
    createdAt: new Date().toISOString(),
    closedAt: null
  };

  memoryTickets.unshift(ticket);

  try {
    await ensureGuild(input.guildId);

    const { tickets } = await getMongoCollections();
    const doc: MongoTicket = {
      _id: randomUUID(),
      guildId: input.guildId,
      channelId: input.channelId ?? null,
      openerId: input.openerId,
      subject: input.subject,
      status: "OPEN",
      createdAt: new Date(),
      closedAt: null
    };

    await tickets.insertOne(doc);

    return {
      ...ticket,
      id: doc._id,
      channelId: doc.channelId,
      status: doc.status,
      createdAt: doc.createdAt.toISOString()
    };
  } catch (error) {
    console.warn("[mongo] ticket mantido em memoria:", error instanceof Error ? error.message : error);
    return ticket;
  }
}

export async function listTickets(guildId?: string) {
  try {
    const { tickets } = await getMongoCollections();
    const rows = await tickets
      .find(guildId ? { guildId } : {})
      .sort({
        createdAt: -1
      })
      .limit(50)
      .toArray();

    return rows.map((ticket) => ({
      id: ticket._id,
      guildId: ticket.guildId,
      channelId: ticket.channelId,
      openerId: ticket.openerId,
      subject: ticket.subject,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null
    }));
  } catch {
    return guildId ? memoryTickets.filter((ticket) => ticket.guildId === guildId) : memoryTickets.slice(0, 50);
  }
}
