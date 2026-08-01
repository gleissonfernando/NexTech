import type { Message } from "discord.js";
import type { TicketRecord } from "./apiClient";
import type { BotContext } from "../types";

const CACHE_TTL_MS = 10_000;
const inactiveStatuses = new Set(["ARCHIVED", "CLOSED", "DENIED", "INCOMPLETE", "RESOLVED"]);
const ticketChannelCache = new Map<string, { expiresAt: number; ticket: TicketRecord | null }>();

export async function getActiveTicketForMessageChannel(message: Message, context: BotContext) {
  if (!message.guild || !message.channelId) return null;
  const botId = message.client.user?.id ?? context.client.user?.id ?? null;
  const key = `${message.guild.id}:${botId ?? "unknown"}:${message.channelId}`;
  const cached = ticketChannelCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.ticket;

  const ticket = await context.api.getTicketByChannel(message.channelId, message.guild.id).catch((error) => {
    console.warn("[tickets] falha ao verificar canal de ticket:", error instanceof Error ? error.message : error);
    return null;
  });

  const activeTicket = isActiveTicketForChannel(ticket, message.guild.id, botId, message.channelId) ? ticket : null;
  ticketChannelCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, ticket: activeTicket });
  return activeTicket;
}

export function clearTicketChannelGuardCache(channelId?: string | null) {
  if (!channelId) {
    ticketChannelCache.clear();
    return;
  }

  for (const key of ticketChannelCache.keys()) {
    if (key.endsWith(`:${channelId}`)) ticketChannelCache.delete(key);
  }
}

function isActiveTicketForChannel(ticket: TicketRecord | null, guildId: string, botId: string | null, channelId: string): ticket is TicketRecord {
  return Boolean(
    ticket
    && ticket.guildId === guildId
    && (!ticket.botId || !botId || ticket.botId === botId)
    && ticket.channelId === channelId
    && !inactiveStatuses.has(String(ticket.status).toUpperCase())
  );
}
