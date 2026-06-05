import { randomUUID } from "node:crypto";
import { prisma } from "../database/prisma";

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
    await prisma.guild.upsert({
      where: {
        discordId: input.guildId
      },
      create: {
        discordId: input.guildId,
        name: `Guild ${input.guildId}`
      },
      update: {}
    });

    const saved = await prisma.ticket.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        openerId: input.openerId,
        subject: input.subject
      }
    });

    return {
      ...ticket,
      id: saved.id,
      status: saved.status,
      createdAt: saved.createdAt.toISOString()
    };
  } catch (error) {
    console.warn("[prisma] ticket mantido em memoria:", error instanceof Error ? error.message : error);
    return ticket;
  }
}

export async function listTickets(guildId?: string) {
  try {
    const tickets = await prisma.ticket.findMany({
      where: guildId
        ? {
            guildId
          }
        : undefined,
      orderBy: {
        createdAt: "desc"
      },
      take: 50
    });

    return tickets.map((ticket) => ({
      id: ticket.id,
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
