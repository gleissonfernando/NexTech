import { Router } from "express";
import { z } from "zod";
import { requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
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

  return res.json({
    tickets: await listTickets(guildId)
  });
});

ticketsRouter.post("/", async (req, res, next) => {
  try {
    const input = ticketSchema.parse(req.body);
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
