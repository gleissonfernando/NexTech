import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { createLog } from "../services/logService";
import { claimTicket, createTicket, getTicketByChannel, getTicketById, listTickets, recordTicketEvent, updateTicketStatus } from "../services/ticketService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

const ticketSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().optional().nullable(),
  openerId: z.string().min(1),
  subject: z.string().min(1).default("Atendimento"),
  allowedRoleIds: z.array(z.string()).optional(),
  categoryId: z.string().optional().nullable(),
  categoryName: z.string().optional().nullable(),
  responsibleRoleId: z.string().optional().nullable(),
  status: z.enum(["OPEN", "PENDING", "CLOSED", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER", "RESOLVED", "DENIED", "ARCHIVED", "INCOMPLETE"]).optional()
});

const ticketStatusSchema = z.object({
  closeReason: z.string().optional().nullable(),
  closedAt: z.string().datetime().optional().nullable(),
  closedById: z.string().optional().nullable(),
  finalResult: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  isIncomplete: z.boolean().optional(),
  responsibleUserId: z.string().optional().nullable(),
  status: z.enum(["OPEN", "PENDING", "CLOSED", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER", "RESOLVED", "DENIED", "ARCHIVED", "INCOMPLETE"]).optional()
});

const ticketEventSchema = z.object({
  authorId: z.string().optional().nullable(),
  content: z.string().min(1),
  eventType: z.string().min(1),
  guildId: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
});

const ticketClaimSchema = z.object({
  responsibleUserId: z.string().min(1)
});

export const ticketsRouter = Router();

ticketsRouter.use(requireAuthOrBot);

ticketsRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const botId = await resolveRequestBotId(req);
  const tickets = await listTickets(guildId, botId);

  if (isBotRequest(req)) {
    return res.json({
      tickets
    });
  }

  const user = res.locals.dashboardAuth.user;

  if (guildId && !(await canReadScopedGuild(req, guildId, botId))) {
    return res.status(403).json({
      message: "Servidor nao encontrado ou sem o bot."
    });
  }

  const allowedGuildIds = getAccessibleGuildIds(user);

  return res.json({
    tickets: guildId ? tickets : tickets.filter((ticket) => allowedGuildIds.has(ticket.guildId))
  });
});

ticketsRouter.post("/", async (req, res, next) => {
  try {
    const input = ticketSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);

    if (!botId) {
      return res.status(400).json({
        message: "botId obrigatorio para criar ticket."
      });
    }

    if (!isBotRequest(req) && !(await canManageScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const ticket = await createTicket({
      ...input,
      botId
    });
    const log = await createLog({
      botId,
      guildId: input.guildId,
      userId: input.openerId,
      type: "ticket.created",
      message: `Ticket criado: ${input.subject}`,
      metadata: ticket
    });

    emitRealtime("tickets:new", ticket);
    emitRealtime("logs:new", log);

    return res.status(201).json({
      ticket
    });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.get("/bot/channel/:channelId", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const botId = await resolveRequestBotId(req);
    const ticket = await getTicketByChannel(req.params.channelId, botId);
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.get("/bot/:ticketId", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const botId = await resolveRequestBotId(req);
    const ticket = await getTicketById(req.params.ticketId, botId);
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.patch("/bot/:ticketId/status", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const input = ticketStatusSchema.parse(req.body);
    const ticket = await updateTicketStatus(req.params.ticketId, {
      ...input,
      closedAt: input.closedAt ? new Date(input.closedAt) : undefined
    });
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.post("/bot/:ticketId/claim", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const input = ticketClaimSchema.parse(req.body);
    const result = await claimTicket(req.params.ticketId, input.responsibleUserId);
    return res.status(result.claimed ? 200 : 409).json(result);
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.post("/bot/:ticketId/events", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponivel apenas para o bot." });
    }
    const botId = await resolveRequestBotId(req);
    const input = ticketEventSchema.parse(req.body);
    await recordTicketEvent({ ...input, botId, ticketId: req.params.ticketId });
    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

async function canReadScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canReadDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "tickets");
  }

  return canReadDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}

async function canManageScopedGuild(req: Request, guildId: string, botId: string | null) {
  if (botId) {
    return canUseDevBotModule(req.res?.locals.dashboardAuth.user, botId, guildId, "tickets");
  }

  return canManageDashboardGuild(req.res?.locals.dashboardAuth.user, guildId);
}
