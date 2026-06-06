import { Router } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { createLog } from "../services/logService";
import { createTicket, listTickets } from "../services/ticketService";

const ticketSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().optional().nullable(),
  openerId: z.string().min(1),
  subject: z.string().min(1).default("Atendimento")
});

export const ticketsRouter = Router();

ticketsRouter.use(requireAuthOrBot);

ticketsRouter.get("/", async (req, res) => {
  const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
  const tickets = await listTickets(guildId);

  if (isBotRequest(req)) {
    return res.json({
      tickets
    });
  }

  const user = res.locals.dashboardAuth.user;

  if (guildId && !canReadDashboardGuild(user, guildId)) {
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

    if (!isBotRequest(req) && !canReadDashboardGuild(res.locals.dashboardAuth.user, input.guildId)) {
      return res.status(403).json({
        message: "Servidor nao encontrado ou sem o bot."
      });
    }

    const ticket = await createTicket(input);
    const log = await createLog({
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
