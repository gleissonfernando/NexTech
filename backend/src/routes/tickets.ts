import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { createLog } from "../services/logService";
import { createTicket, listTickets } from "../services/ticketService";
import { resolveRequestBotId } from "../services/requestBotScopeService";

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
