import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { isBotRequest, requireAuthOrBot } from "../middleware/auth";
import { emitRealtime } from "../realtime/events";
import { canManageDashboardGuild, canReadDashboardGuild, getAccessibleGuildIds } from "../services/dashboardGuildAccessService";
import { canReadDevBotModule, canUseDevBotModule } from "../services/devBotService";
import { createLog } from "../services/logService";
import { beginTicketClosing, claimTicket, createTicket, findOpenTicket, getTicketByChannel, getTicketById, listTickets, recordTicketEvent, updateTicketChannel, updateTicketStatus } from "../services/ticketService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import { findTicketCategory, getTicketCategories } from "../services/settingsService";

const ticketSchema = z.object({
  ticketId: z.string().uuid().optional(),
  guildId: z.string().min(1),
  channelId: z.string().optional().nullable(),
  openerId: z.string().min(1),
  subject: z.string().min(1).default("Atendimento"),
  allowedRoleIds: z.array(z.string()).optional(),
  categoryId: z.string().optional().nullable(),
  categoryName: z.string().optional().nullable(),
  isClient: z.boolean().optional().nullable(),
  moduleType: z.enum(["default", "police"]).optional().default("default"),
  panelId: z.string().optional().nullable(),
  responsibleRoleId: z.string().optional().nullable(),
  status: z.enum(["OPEN", "PENDING", "CLOSING", "CLOSED", "IN_ANALYSIS", "ASSIGNED", "WAITING_EVIDENCE", "WAITING_USER", "RESOLVED", "DENIED", "ARCHIVED", "INCOMPLETE"]).optional(),
  ticketType: z.string().min(1).max(80).optional().nullable()
});

const ticketStatusSchema = z.object({
  categoryId: z.string().optional().nullable(),
  categoryName: z.string().optional().nullable(),
  closeReason: z.string().optional().nullable(),
  closedAt: z.string().datetime().optional().nullable(),
  closedById: z.string().optional().nullable(),
  finalResult: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  isIncomplete: z.boolean().optional(),
  lastUserCallAt: z.string().datetime().optional().nullable(),
  panelId: z.string().optional().nullable(),
  responsibleRoleId: z.string().optional().nullable(),
  responsibleUserId: z.string().optional().nullable(),
  status: z.enum(["OPEN", "PENDING", "CLOSING", "CLOSED", "IN_ANALYSIS", "ASSIGNED", "WAITING_EVIDENCE", "WAITING_USER", "RESOLVED", "DENIED", "ARCHIVED", "INCOMPLETE"]).optional(),
  subject: z.string().min(1).max(120).optional(),
  ticketType: z.string().min(1).max(80).optional().nullable()
});

const ticketEventSchema = z.object({
  authorId: z.string().optional().nullable(),
  content: z.string().min(1),
  eventType: z.string().min(1),
  guildId: z.string().min(1),
  metadata: z.record(z.unknown()).optional()
});

const ticketClaimSchema = z.object({
  responsibleUserId: z.string().min(1),
  responsibleUserName: z.string().min(1).optional().nullable()
});

const ticketCloseBeginSchema = z.object({
  closedById: z.string().min(1),
  closeReason: z.string().min(1),
  finalResult: z.string().min(1),
  internalNotes: z.string().optional().nullable()
});

export const ticketsRouter = Router();

ticketsRouter.use(requireAuthOrBot);

ticketsRouter.get("/categories", async (req, res, next) => {
  try {
    const guildId = typeof req.query.guildId === "string" ? req.query.guildId : "";
    const botId = await resolveRequestBotId(req);

    if (!guildId) {
      return res.status(400).json({
        message: "guildId obrigatório."
      });
    }

    if (!botId) {
      return res.status(400).json({
        message: "botId obrigatório."
      });
    }

    if (!isBotRequest(req) && !(await canReadScopedGuild(req, guildId, botId))) {
      return res.status(403).json({
        message: "Servidor não encontrado ou sem o bot."
      });
    }

    return res.json({
      categories: await getTicketCategories(guildId, botId, true)
    });
  } catch (error) {
    return next(error);
  }
});

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
      message: "Servidor não encontrado ou sem o bot."
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
        message: "botId obrigatório para criar ticket."
      });
    }

    if (!isBotRequest(req) && !(await canManageScopedGuild(req, input.guildId, botId))) {
      return res.status(403).json({
        message: "Servidor não encontrado ou sem o bot."
      });
    }

    const category = await resolvePanelTicketCategory(input, botId);
    const result = await createTicket({
      ...input,
      botId,
      categoryName: category?.label ?? input.categoryName,
      ticketType: category?.ticketType ?? input.ticketType
    });
    if (result.created) {
      const log = await createLog({
        botId,
        guildId: input.guildId,
        userId: input.openerId,
        type: "ticket.created",
        message: `Ticket criado: ${input.subject}`,
        metadata: result.ticket
      });

      emitRealtime("tickets:new", result.ticket);
      emitRealtime("logs:new", log);
    }

    return res.status(201).json({
      created: result.created,
      ticket: result.ticket
    });
  } catch (error) {
    return next(error);
  }
});

export async function resolvePanelTicketCategory(
  input: z.infer<typeof ticketSchema>,
  botId: string | null,
  findCategoryFn: typeof findTicketCategory = findTicketCategory
) {
  if (input.ticketId || !input.categoryId || input.panelId !== input.categoryId || input.ticketType === "report-system") {
    return null;
  }

  const category = await findCategoryFn(input.guildId, botId, input.categoryId);
  if (!category) {
    console.warn("[tickets] categoria informada não encontrada ou desativada; seguindo sem vínculo:", {
      botId,
      categoryId: input.categoryId,
      guildId: input.guildId,
      panelId: input.panelId ?? null,
      ticketType: input.ticketType ?? null
    });
    return null;
  }

  return category;
}

ticketsRouter.get("/bot/channel/:channelId", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
    }
    const botId = await resolveRequestBotId(req);
    const guildId = typeof req.query.guildId === "string" ? req.query.guildId : undefined;
    const ticket = await getTicketByChannel(req.params.channelId, botId, guildId);
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.get("/bot/open", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
    }
    const botId = await resolveRequestBotId(req);
    const guildId = typeof req.query.guildId === "string" ? req.query.guildId : "";
    const openerId = typeof req.query.openerId === "string" ? req.query.openerId : "";
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : null;
    const moduleType = req.query.moduleType === "police" ? "police" : "default";
    if (!guildId || !openerId) {
      return res.status(400).json({ message: "guildId e openerId são obrigatórios." });
    }
    const ticket = await findOpenTicket(guildId, botId, openerId, categoryId, moduleType);
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.get("/bot/:ticketId", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
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
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
    }
    const input = ticketStatusSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const lastUserCallAt = input.lastUserCallAt === undefined
      ? undefined
      : input.lastUserCallAt === null
        ? null
        : new Date(input.lastUserCallAt);
    const ticket = await updateTicketStatus(req.params.ticketId, botId, {
      ...input,
      closedAt: input.closedAt ? new Date(input.closedAt) : undefined,
      lastUserCallAt
    });
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.post("/bot/:ticketId/close/begin", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
    }
    const input = ticketCloseBeginSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const result = await beginTicketClosing(req.params.ticketId, botId, input);
    return res.status(result.closing ? 200 : 409).json(result);
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.patch("/bot/:ticketId/channel", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
    }
    const input = z.object({ channelId: z.string().nullable() }).parse(req.body);
    const botId = await resolveRequestBotId(req);
    const ticket = await updateTicketChannel(req.params.ticketId, botId, input.channelId);
    return res.json({ ticket });
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.post("/bot/:ticketId/claim", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
    }
    const input = ticketClaimSchema.parse(req.body);
    const botId = await resolveRequestBotId(req);
    const result = await claimTicket(req.params.ticketId, botId, input.responsibleUserId, input.responsibleUserName ?? null);
    return res.status(result.claimed ? 200 : 409).json(result);
  } catch (error) {
    return next(error);
  }
});

ticketsRouter.post("/bot/:ticketId/events", async (req, res, next) => {
  try {
    if (!isBotRequest(req)) {
      return res.status(403).json({ message: "Rota disponível apenas para o bot." });
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
