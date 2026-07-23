import { Router } from "express";
import { z } from "zod";
import { requireBot } from "../middleware/auth";
import { authorizeBotCommand } from "../services/botCommandAuthorizationService";
import {
  authorizeBotRuntimeModule,
  getBotGuildConfig,
  getBotGuildModuleConfig,
  getBotApiPermissions,
  syncDevBotGuilds,
  syncDevBotProfile,
  updateBotGuildModuleRuntimeStatus,
  updateDevBotRuntimeStatus
} from "../services/devBotService";
import { getMaintenanceState } from "../services/maintenanceService";
import { recordNexTechSaleDeliveryResult } from "../services/nexTechSalesService";
import {
  getNexTechInviteRuntime,
  recordNexTechInviteBlocked,
  updateNexTechInvitePanelState
} from "../services/nexTechInviteService";
import {
  claimSalesTicket,
  closeSalesTicketWithTranscript,
  createSalesTicket,
  getSalesTicketRuntime,
  recordSalesTicketRuntimeLog,
  revealSalesTicketTranscriptPassword,
  toTicketDto as toSalesTicketDto,
  updateSalesTicketChannel,
  updateSalesTicketPanelState
} from "../services/salesTicketService";
import { resolveRequestBotId } from "../services/requestBotScopeService";
import {
  getSystemEmojiRuntimeConfig,
  recordSystemEmojiValidation
} from "../services/systemEmojiService";

export const botDevApiRouter = Router();
const commandAuthorizationSchema = z.object({
  channelId: z.string().nullable().optional(),
  userId: z.string().nullable().optional()
});
const guildIdSchema = z.string().regex(/^\d{5,32}$/);
const runtimeModuleIdSchema = z.string().min(1).max(120);
const runtimeStatusSchema = z.object({
  botGuilds: z.array(z.object({
    id: z.string().regex(/^\d{5,32}$/),
    name: z.string().min(1).max(100)
  })).max(250).optional(),
  botProfile: z.object({
    avatarUrl: z.string().url().nullable().optional(),
    id: z.string().regex(/^\d{5,32}$/),
    username: z.string().min(1).max(100)
  }).optional(),
  online: z.boolean()
});
const tagVerificationStatusSchema = z.object({
  lastCheckAt: z.string().datetime(),
  nextCheckAt: z.string().datetime().nullable(),
  totalChecked: z.number().int().min(0),
  totalAssigned: z.number().int().min(0),
  totalRemoved: z.number().int().min(0),
  totalIgnored: z.number().int().min(0),
  totalUnavailable: z.number().int().min(0),
  totalErrors: z.number().int().min(0),
  lastError: z.string().max(500).nullable()
});
const systemEmojiValidationSchema = z.object({
  extraEmojiNames: z.array(z.string().min(2).max(32)).max(250).optional(),
  guildId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  emojis: z.array(z.object({
    animated: z.boolean().optional(),
    emojiId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
    found: z.boolean(),
    key: z.string().min(1).max(64),
    name: z.string().min(2).max(32).nullable().optional(),
    sourceGuildId: z.string().regex(/^\d{5,32}$/).nullable().optional()
  })).max(100)
});
const nexTechSaleDeliveryResultSchema = z.object({
  deliveredRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).max(20).optional(),
  error: z.string().max(1000).nullable().optional(),
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  saleId: z.string().min(1).max(120),
  status: z.enum(["delivered", "partial", "failed"])
});
const nexTechInviteBlockedSchema = z.object({
  channelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  inviteCode: z.string().max(120).nullable().optional(),
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  userId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  userName: z.string().max(120).nullable().optional()
});
const nexTechInvitePanelStateSchema = z.object({
  inviteId: z.string().min(1).max(120),
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});
const salesTicketCreateSchema = z.object({
  typeId: z.string().min(1).max(120),
  userId: z.string().regex(/^\d{5,32}$/),
  userName: z.string().max(100).nullable().optional()
});
const salesTicketChannelSchema = z.object({
  channelId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});
const salesTicketPanelStateSchema = z.object({
  messageId: z.string().regex(/^\d{5,32}$/).nullable().optional()
});
const salesTicketClaimSchema = z.object({
  actorId: z.string().regex(/^\d{5,32}$/),
  actorName: z.string().max(100).nullable().optional()
});
const salesTicketCloseSchema = z.object({
  actorId: z.string().regex(/^\d{5,32}$/),
  actorName: z.string().max(100).nullable().optional(),
  channelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  closeReason: z.string().max(1000).nullable().optional(),
  messages: z.array(z.record(z.unknown())).max(1000).default([])
});
const salesTicketLogSchema = z.object({
  actorId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  actorName: z.string().max(100).nullable().optional(),
  data: z.record(z.unknown()).optional(),
  event: z.string().min(1).max(80),
  message: z.string().min(1).max(500)
});
const salesTicketPasswordRevealSchema = z.object({
  userId: z.string().regex(/^\d{5,32}$/)
});

botDevApiRouter.use(requireBot);

botDevApiRouter.get("/maintenance", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    return res.json({
      maintenance: await getMaintenanceState(botId)
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/system-emojis", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);

    return res.json(await getSystemEmojiRuntimeConfig(botId));
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/runtime/guilds/:guildId/modules/:moduleId/config", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const moduleId = runtimeModuleIdSchema.parse(req.params.moduleId);

    if (!botId) {
      return res.status(400).json({ message: "Bot vinculado obrigatório para consultar este módulo." });
    }

    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId });
    if (!authorization.allowed) {
      return res.status(403).json({ message: authorization.reason ?? "Módulo não liberado para este bot." });
    }

    return res.json({ module: await getBotGuildModuleConfig(botId, guildId, moduleId) });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/system-emojis/validation", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const input = systemEmojiValidationSchema.parse(req.body ?? {});

    return res.json(await recordSystemEmojiValidation({
      botId,
      extraEmojiNames: input.extraEmojiNames ?? [],
      guildId: input.guildId ?? null,
      emojis: input.emojis
    }));
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/nex-tech-sales/delivery-result", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const input = nexTechSaleDeliveryResultSchema.parse(req.body ?? {});

    return res.json(await recordNexTechSaleDeliveryResult(botId, guildId, input));
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/guilds/:guildId/nextech-invites/runtime", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);

    return res.json(await getNexTechInviteRuntime(botId, guildId));
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/nextech-invites/blocked", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const input = nexTechInviteBlockedSchema.parse(req.body ?? {});

    return res.status(201).json({
      log: await recordNexTechInviteBlocked(botId, guildId, {
        channelId: input.channelId ?? null,
        inviteCode: input.inviteCode ?? null,
        messageId: input.messageId ?? null,
        userId: input.userId ?? null,
        userName: input.userName ?? null
      })
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.put("/guilds/:guildId/nextech-invites/panel-state", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const input = nexTechInvitePanelStateSchema.parse(req.body ?? {});
    const invite = await updateNexTechInvitePanelState(botId, guildId, input.inviteId, input.messageId ?? null);
    if (!invite) return res.status(404).json({ message: "Convite oficial não encontrado." });

    return res.json({ invite });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/guilds/:guildId/nex-tech-sales/tickets/runtime", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    return res.json(await getSalesTicketRuntime(resolvedBotId, guildId));
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.put("/guilds/:guildId/nex-tech-sales/tickets/panel-state", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketPanelStateSchema.parse(req.body ?? {});
    return res.json({ settings: await updateSalesTicketPanelState(resolvedBotId, guildId, input.messageId || null) });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/nex-tech-sales/tickets", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketCreateSchema.parse(req.body ?? {});
    return res.status(201).json(await createSalesTicket(resolvedBotId, guildId, input));
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.patch("/guilds/:guildId/nex-tech-sales/tickets/:ticketId/channel", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketChannelSchema.parse(req.body ?? {});
    const ticket = await updateSalesTicketChannel(resolvedBotId, guildId, req.params.ticketId, input.channelId || null);
    if (!ticket) return res.status(404).json({ message: "Ticket de vendas não encontrado." });
    return res.json({ ticket: toSalesTicketDto(ticket) });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.patch("/guilds/:guildId/nex-tech-sales/tickets/:ticketId/claim", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketClaimSchema.parse(req.body ?? {});
    const ticket = await claimSalesTicket(resolvedBotId, guildId, req.params.ticketId, input.actorId, input.actorName ?? null);
    if (!ticket) return res.status(404).json({ message: "Ticket de vendas não encontrado." });
    return res.json({ ticket: toSalesTicketDto(ticket) });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/nex-tech-sales/tickets/:ticketId/close", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketCloseSchema.parse(req.body ?? {});
    const result = await closeSalesTicketWithTranscript(resolvedBotId, guildId, req.params.ticketId, input);
    if (!result) return res.status(404).json({ message: "Ticket de vendas não encontrado ou já fechado." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/nex-tech-sales/tickets/:ticketId/logs", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketLogSchema.parse(req.body ?? {});

    await recordSalesTicketRuntimeLog(resolvedBotId, guildId, req.params.ticketId === "none" ? null : req.params.ticketId, input);
    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/nex-tech-sales/tickets/transcripts/:transcriptId/reveal-password", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const resolvedBotId = await assertSalesTicketRuntime(botId, guildId);
    const input = salesTicketPasswordRevealSchema.parse(req.body ?? {});
    const result = await revealSalesTicketTranscriptPassword(resolvedBotId, guildId, req.params.transcriptId, input.userId);
    if (!result) return res.status(404).json({ message: "Senha indisponível para este usuário." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/runtime/modules", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const permissions = botId ? await getBotApiPermissions(botId) : null;

    if (!permissions) {
      return res.status(404).json({
        error: "Bot não encontrado."
      });
    }

    return res.json({
      active: permissions.desiredOnline && permissions.status !== "error" && permissions.status !== "invalid_token",
      botId,
      checkedAt: new Date().toISOString(),
      enabledModules: permissions.enabledModules,
      status: permissions.status
    });
  } catch (error) {
    return next(error);
  }
});

async function assertSalesTicketRuntime(botId: string | null, guildId: string) {
  const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "nex-tech-sales" });
  if (!authorization.allowed || !botId) throw Object.assign(new Error(authorization.reason || "Sistema de vendas não liberado."), { statusCode: 403 });
  return botId;
}

botDevApiRouter.post("/runtime/status", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);

    if (!botId) {
      return res.status(400).json({
        message: "Bot não identificado na requisicao runtime."
      });
    }

    const input = runtimeStatusSchema.parse(req.body ?? {});

    if (input.botProfile) {
      await syncDevBotProfile(botId, input.botProfile);
    }

    if (input.botGuilds) {
      await syncDevBotGuilds(botId, input.botGuilds);
    }

    const bot = await updateDevBotRuntimeStatus(
      botId,
      input.online ? "online" : "offline",
      input.online ? "Bot conectado ao Discord." : "Bot offline."
    );

    return res.json({
      botId,
      status: bot?.status ?? (input.online ? "online" : "offline")
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/runtime/guilds/:guildId/modules/:moduleId/authorize", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const authorization = await authorizeBotRuntimeModule({
      botId,
      guildId: req.params.guildId,
      moduleId: req.params.moduleId
    });

    return res.json({
      authorization
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/runtime/guilds/:guildId/tag-verification/status", async (req, res, next) => {
  try {
    const botId = await resolveRequestBotId(req);
    const guildId = guildIdSchema.parse(req.params.guildId);
    const status = tagVerificationStatusSchema.parse(req.body ?? {});
    const authorization = await authorizeBotRuntimeModule({ botId, guildId, moduleId: "tag-verification" });

    if (!authorization.allowed || !botId) {
      return res.status(403).json({ message: authorization.reason });
    }

    await updateBotGuildModuleRuntimeStatus({ botId, guildId, moduleId: "tag-verification", status });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.post("/guilds/:guildId/commands/:commandName/authorize", async (req, res, next) => {
  try {
    const { commandName, guildId } = req.params;
    const input = commandAuthorizationSchema.parse(req.body ?? {});

    if (!commandName || !guildId) {
      return res.status(400).json({
        message: "guildId e commandName são obrigatorios."
      });
    }

    const authorization = await authorizeBotCommand({
      botId: await resolveRequestBotId(req),
      channelId: input.channelId,
      commandName,
      guildId,
      userId: input.userId
    });

    return res.json({
      authorization
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/permissions", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot não encontrado."
      });
    }

    return res.json(permissions);
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/guild/:guildId/modules", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot não encontrado."
      });
    }

    return res.json({
      botId: req.params.botId,
      guildId: req.params.guildId,
      modules: permissions.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});

botDevApiRouter.get("/:botId/guild/:guildId/config", async (req, res, next) => {
  try {
    const permissions = await getBotApiPermissions(req.params.botId);

    if (!permissions) {
      return res.status(404).json({
        error: "Bot não encontrado."
      });
    }

    const config = await getBotGuildConfig(req.params.botId, req.params.guildId);

    return res.json({
      ...config,
      enabledModules: permissions.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});
