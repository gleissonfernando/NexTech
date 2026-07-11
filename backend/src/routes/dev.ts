import { Router, raw } from "express";
import { z } from "zod";
import { emitRealtime } from "../realtime/events";
import { requireDevAccess } from "../services/devAccessService";
import {
  createDevBot,
  canManageDevBot,
  detectDiscordBotGuild,
  deleteDevBot,
  DEV_MODULES,
  getBotGuildConfig,
  getSecurityProtectionAccess,
  getDevBot,
  ensurePrimaryDevBotListed,
  listDevBots,
  listAccessibleDevBots,
  listBotGuildConfigs,
  registerPrimaryDevBot,
  testDiscordBotToken,
  setSecurityProtectionAccess,
  setDevBotDesiredOnline,
  syncSecurityProtectionAccessFromModules,
  updateBotGuildConfig,
  updateDevBot,
  updateDevBotModules,
  validateDevBotConnection
} from "../services/devBotService";
import {
  restartDevBotProcess,
  scheduleDevBotModuleRestart,
  startAllDevBotProcesses,
  startDevBotProcess,
  stopDevBotProcess,
  stopSelectedDevBotProcesses
} from "../services/devBotRuntimeService";
import {
  createFivemModule,
  deleteFivemModule,
  isCustomFivemModuleId,
  listFivemModules,
  updateFivemModule
} from "../services/fivemModuleService";
import { createDashboardAuditLog } from "../services/dashboardAuditService";
import { createLog } from "../services/logService";
import {
  getMaintenanceState,
  sendMaintenanceManualAlert,
  setMaintenanceMode
} from "../services/maintenanceService";
import {
  canManageDevPermissions,
  deleteDevPermission,
  listDevPermissions,
  upsertDevPermission
} from "../services/devPermissionService";
import {
  getDiscloudLogsForBot,
  getDiscloudMonitoring,
  runDiscloudBotAction,
  runDiscloudConsoleCommand
} from "../services/discloudMonitoringService";
import {
  deleteOrvitechPaymentProvider,
  deleteOrvitechProduct,
  deleteScopedOrvitechSalesPlan,
  duplicateOrvitechProduct,
  getOrvitechSalesDashboard,
  ORVITECH_SALES_MODULE_ID,
  saveOrvitechPaymentProvider,
  saveOrvitechProduct,
  saveOrvitechProductBannerUpload,
  saveOrvitechSale,
  saveOrvitechSalesPlan,
  saveOrvitechSalesSettings,
  toProductDto,
  toPlanDto,
  toSaleDto,
  toSettingsDto,
  updateOrvitechSaleStatus
} from "../services/orvitechSalesService";
import { devPlansRouter } from "./plans";
import type { DashboardAuth } from "../services/tokenService";

const moduleIds = DEV_MODULES.map((module) => module.id) as [string, ...string[]];
const devModuleIdSchema = z.string().refine((moduleId) => (
  (moduleIds as readonly string[]).includes(moduleId) || isCustomFivemModuleId(moduleId)
), "Modulo invalido.");

const createBotSchema = z.object({
  token: z.string().min(10),
  mainGuildId: z.string().regex(/^\d{5,32}$/)
});

const updateBotSchema = z.object({
  name: z.string().min(2).max(80).optional().or(z.literal("")),
  clientId: z.string().regex(/^\d{5,32}$/).optional(),
  token: z.string().min(10).optional(),
  secret: z.string().max(256).nullable().optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  ownerName: z.string().min(2).max(80).optional(),
  ownerId: z.string().regex(/^\d{5,32}$/).optional(),
  mainGuildId: z.string().regex(/^\d{5,32}$/).optional(),
  enabledModules: z.array(devModuleIdSchema).optional()
});

const modulesSchema = z.object({
  enabledModules: z.array(devModuleIdSchema)
});

const securityAccessSchema = z.object({
  enabledByDev: z.boolean()
});

const registerPrimaryBotSchema = z.object({
  name: z.string().min(2).max(80).optional().or(z.literal("")),
  ownerName: z.string().min(2).max(80).optional(),
  ownerId: z.string().regex(/^\d{5,32}$/).optional(),
  mainGuildId: z.string().regex(/^\d{5,32}$/),
  enabledModules: z.array(devModuleIdSchema).default([])
});

const fivemModuleSchema = z.object({
  description: z.string().min(1).max(240),
  permissions: z.string().min(1).max(120).default("Admin FiveM"),
  title: z.string().min(2).max(80)
});

const fivemModulePatchSchema = fivemModuleSchema.partial();

const guildConfigSchema = z.object({
  guildName: z.string().min(1).max(100).default("Servidor"),
  modules: z.record(z.record(z.unknown())).default({})
});

const orvitechSalesSettingsSchema = z.object({
  currency: z.enum(["BRL", "USD", "EUR"]).optional(),
  customerRoleId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  enabled: z.boolean().optional(),
  logChannelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  panelColor: z.string().min(4).max(24).optional(),
  panelDescription: z.string().min(1).max(1200).optional(),
  panelImageUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  panelTitle: z.string().min(2).max(120).optional(),
  publicUrl: z.string().min(1).max(2048).optional(),
  saleChannelId: z.string().regex(/^\d{5,32}$/).nullable().optional(),
  supportRoleIds: z.array(z.string().regex(/^\d{5,32}$/)).optional(),
  termsUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  thumbnailUrl: z.string().url().max(2048).nullable().optional().or(z.literal(""))
});

const orvitechPaymentProviderSchema = z.object({
  enabled: z.boolean().default(true),
  id: z.string().min(1).max(120).nullable().optional(),
  instructions: z.string().max(1200).nullable().optional().or(z.literal("")),
  label: z.string().min(2).max(80),
  provider: z.enum(["manual", "pix", "mercadopago", "stripe", "paypal", "custom"]),
  publicKey: z.string().max(512).nullable().optional().or(z.literal("")),
  secret: z.string().max(2048).nullable().optional().or(z.literal("")),
  webhookSecret: z.string().max(2048).nullable().optional().or(z.literal("")),
  webhookUrl: z.string().url().max(2048).nullable().optional().or(z.literal(""))
});

const orvitechSalesPlanSchema = z.object({
  checkoutMessage: z.string().max(1200).nullable().optional().or(z.literal("")),
  description: z.string().max(1200).nullable().optional().or(z.literal("")),
  durationDays: z.number().int().min(1).max(3650).nullable().optional(),
  enabled: z.boolean().default(true),
  imageUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  moduleIds: z.array(devModuleIdSchema).default([ORVITECH_SALES_MODULE_ID]),
  name: z.string().min(2).max(100),
  priceCents: z.number().int().min(0).max(100000000)
});

const productPlanSchema = z.object({
  benefits: z.array(z.string().max(220)).default([]),
  buttonColor: z.string().min(4).max(24).default("#7c3aed"),
  buttonText: z.string().min(1).max(40),
  description: z.string().max(1200).default(""),
  enabled: z.boolean(),
  name: z.string().min(1).max(100),
  paymentProviderId: z.string().max(120).nullable().optional(),
  priceCents: z.number().int().min(0).max(100000000),
  priceText: z.string().max(80).default("")
});

const orvitechProductSchema = z.object({
  active: z.boolean().default(true),
  additionalInfo: z.string().max(3000).nullable().optional().or(z.literal("")),
  bannerUrl: z.string().url().max(2048).nullable().optional().or(z.literal("")),
  category: z.string().min(1).max(80),
  fullDescription: z.string().max(6000).nullable().optional().or(z.literal("")),
  howItWorks: z.string().max(4000).nullable().optional().or(z.literal("")),
  layout: z.object({
    accentColor: z.string().min(4).max(24).optional(),
    glassEffect: z.boolean().optional(),
    theme: z.enum(["dark", "purple"]).optional()
  }).optional(),
  name: z.string().min(2).max(120),
  observations: z.string().max(3000).nullable().optional().or(z.literal("")),
  plans: z.object({
    lifetime: productPlanSchema,
    monthly: productPlanSchema
  }).refine((plans) => plans.monthly.enabled || plans.lifetime.enabled, "Ative ao menos um plano."),
  seo: z.object({
    description: z.string().max(180).nullable().optional().or(z.literal("")),
    title: z.string().max(80).nullable().optional().or(z.literal(""))
  }).optional(),
  shortDescription: z.string().max(400).nullable().optional().or(z.literal("")),
  slug: z.string().max(120).nullable().optional().or(z.literal("")),
  toggles: z.record(z.boolean()).optional(),
  warnings: z.string().max(3000).nullable().optional().or(z.literal(""))
});
const orvitechProductBannerUpload = raw({
  limit: "10mb",
  type: ["image/gif", "image/jpeg", "image/png", "image/webp"]
});

const orvitechSaleSchema = z.object({
  amountCents: z.number().int().min(0).max(100000000).nullable().optional(),
  buyerId: z.string().regex(/^\d{5,32}$/),
  buyerName: z.string().max(100).nullable().optional().or(z.literal("")),
  externalReference: z.string().max(200).nullable().optional().or(z.literal("")),
  notes: z.string().max(1200).nullable().optional().or(z.literal("")),
  paymentProviderId: z.string().max(120).nullable().optional(),
  planId: z.string().max(120).nullable().optional(),
  status: z.enum(["pending", "paid", "cancelled", "refunded"]).default("pending")
});

const orvitechSaleStatusSchema = z.object({
  status: z.enum(["pending", "paid", "cancelled", "refunded"])
});

const devAccessSchema = z.object({
  role: z.enum(["owner", "admin", "dev"]).default("dev"),
  userId: z.string().regex(/^\d{5,32}$/)
});

const discloudActionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "redeploy"])
});

const discloudConsoleSchema = z.object({
  command: z.string().min(1).max(300)
});

export const devRouter = Router();

devRouter.use(requireDevAccess);
devRouter.use((req, res, next) => {
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.removeHeader("ETag");
  next();
});
devRouter.use(devPlansRouter);

devRouter.get("/modules", (_req, res) => {
  return res.json({
    modules: DEV_MODULES
  });
});

devRouter.get("/discloud/monitoring", async (req, res, next) => {
  try {
    return res.json(await getDiscloudMonitoring(req.query.refresh === "1"));
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/discloud/bots/:botId/logs", async (req, res, next) => {
  try {
    return res.json({
      logs: await getDiscloudLogsForBot(req.params.botId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/discloud/bots/:botId/actions", async (req, res, next) => {
  try {
    const input = discloudActionSchema.parse(req.body ?? {});
    return res.json(await runDiscloudBotAction(req.params.botId, input.action));
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/discloud/bots/:botId/console", async (req, res, next) => {
  try {
    const input = discloudConsoleSchema.parse(req.body ?? {});
    return res.json({
      result: await runDiscloudConsoleCommand(req.params.botId, input.command)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/access", async (_req, res, next) => {
  try {
    return res.json({
      entries: await listDevPermissions()
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/access", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = devAccessSchema.parse(req.body);

    if (!(await canManageDevPermissions(auth.user.discordId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para gerenciar acessos DEV."
      });
    }

    return res.status(201).json({
      entry: await upsertDevPermission({
        actorId: auth.user.discordId,
        role: input.role,
        userId: input.userId
      })
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/access/:userId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const userId = z.string().regex(/^\d{5,32}$/).parse(req.params.userId);

    if (!(await canManageDevPermissions(auth.user.discordId))) {
      return res.status(403).json({
        message: "Voce nao tem permissao para gerenciar acessos DEV."
      });
    }

    const entry = await deleteDevPermission(auth.user.discordId, userId);

    if (!entry) {
      return res.status(404).json({
        message: "Acesso DEV nao encontrado."
      });
    }

    return res.json({ entry });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/maintenance", async (_req, res, next) => {
  try {
    return res.json({
      maintenance: await getMaintenanceState()
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/maintenance", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = z.object({
      active: z.boolean()
    }).parse(req.body ?? {});
    const maintenance = await setMaintenanceMode({
      active: input.active,
      actorId: auth.user.discordId,
      actorName: auth.user.globalName || auth.user.username
    });

    await writeDevBotAudit(
      auth,
      auth.user.selectedGuildId ?? "global",
      null,
      input.active ? "maintenance_enabled" : "maintenance_disabled",
      input.active ? "Modo de manutenção global ativado." : "Modo de manutenção global desativado.",
      {
        maintenance: true
      }
    );

    return res.json({
      maintenance
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/maintenance/alert", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const maintenance = await sendMaintenanceManualAlert({
      actorId: auth.user.discordId,
      actorName: auth.user.globalName || auth.user.username
    });

    await writeDevBotAudit(
      auth,
      auth.user.selectedGuildId ?? "global",
      null,
      "maintenance_manual_alert",
      "Alerta manual de manutenção enviado.",
      {
        maintenance: true
      }
    );

    return res.json({
      maintenance
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/fivem/modules", async (_req, res, next) => {
  try {
    return res.json({
      modules: await listFivemModules()
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/fivem/modules", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = fivemModuleSchema.parse(req.body);

    const module = await createFivemModule(input, auth.user.discordId);

    await writeDevBotAudit(auth, auth.user.selectedGuildId ?? "global", null, "fivem_module_create", `Modulo FiveM criado: ${module.title}.`, {
      moduleId: module.id
    });

    return res.status(201).json({
      module
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/fivem/modules/:moduleId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = fivemModulePatchSchema.parse(req.body);
    const module = await updateFivemModule(req.params.moduleId, input, auth.user.discordId);

    if (!module) {
      return res.status(404).json({
        message: "Modulo FiveM personalizado nao encontrado."
      });
    }

    await writeDevBotAudit(auth, auth.user.selectedGuildId ?? "global", null, "fivem_module_update", `Modulo FiveM atualizado: ${module.title}.`, {
      moduleId: module.id
    });

    return res.json({
      module
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/fivem/modules/:moduleId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const deleted = await deleteFivemModule(req.params.moduleId);

    if (!deleted) {
      return res.status(404).json({
        message: "Modulo FiveM personalizado nao encontrado."
      });
    }

    await writeDevBotAudit(auth, auth.user.selectedGuildId ?? "global", null, "fivem_module_delete", "Modulo FiveM removido.", {
      moduleId: req.params.moduleId
    });

    return res.json({
      ok: true
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const primaryBot = await ensurePrimaryDevBotListed({
      ownerName: auth.user.globalName || auth.user.username,
      ownerId: auth.user.discordId,
      createdBy: auth.user.discordId
    }).catch((error) => {
      console.warn("[dev-bot] bot principal nao foi sincronizado:", error instanceof Error ? error.message : error);
      return null;
    });

    if (primaryBot?.created) {
      await startDevBotProcess(primaryBot.bot.id);
    }

    const bots = await listDevBots();
    const summary = {
      registered: bots.length,
      online: bots.filter((bot) => bot.status === "online").length,
      offline: bots.filter((bot) => bot.status === "offline").length,
      error: bots.filter((bot) => bot.status === "error" || bot.status === "invalid_token").length
    };
    console.info(`[dev-bot] listagem DEV: collection=Bot user=${auth.user.discordId} bots=${bots.length} ids=${bots.map((bot) => bot.id).join(",") || "none"}`);

    return res.json({
      success: true,
      bots,
      summary
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/test-connection", async (req, res, next) => {
  try {
    const input = z.object({
      token: z.string().min(10),
      clientId: z.string().regex(/^\d{5,32}$/).optional()
    }).parse(req.body);

    return res.json(await testDiscordBotToken(input.token, input.clientId));
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/detect-guild", async (req, res, next) => {
  try {
    const input = z.object({
      token: z.string().min(10),
      guildId: z.string().regex(/^\d{5,32}$/)
    }).parse(req.body);

    return res.json({
      guild: await detectDiscordBotGuild(input.token, input.guildId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/create", async (req, res, next) => {
  try {
    const input = createBotSchema.parse(req.body);
    const auth = res.locals.dashboardAuth as DashboardAuth;

    const createdBot = await createDevBot({
      token: input.token,
      mainGuildId: input.mainGuildId,
      ownerName: auth.user.globalName || auth.user.username,
      ownerId: auth.user.discordId,
      createdBy: auth.user.discordId,
      verifyOwnerUserId: auth.user.discordId
    });
    await startDevBotProcess(createdBot.id);
    const bot = await getDevBot(createdBot.id) ?? createdBot;
    await writeDevBotAudit(auth, bot.mainGuildId, bot.id, "create", `Bot ${bot.name} conectado ao painel.`, {
      clientId: bot.clientId,
      modules: bot.enabledModules
    });

    return res.status(201).json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/register-primary", async (req, res, next) => {
  try {
    const input = registerPrimaryBotSchema.parse(req.body);
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const result = await registerPrimaryDevBot({
      ...input,
      name: input.name || null,
      ownerName: input.ownerName || auth.user.globalName || auth.user.username,
      ownerId: input.ownerId || auth.user.discordId,
      createdBy: auth.user.discordId
    });

    await startDevBotProcess(result.bot.id);
    const bot = await getDevBot(result.bot.id) ?? result.bot;
    await writeDevBotAudit(
      auth,
      bot.mainGuildId,
      bot.id,
      result.created ? "register_primary" : "update_primary",
      result.created ? `Bot principal ${bot.name} conectado ao painel.` : `Bot principal ${bot.name} atualizado no painel.`,
      {
        clientId: bot.clientId,
        modules: bot.enabledModules
      }
    );

    return res.status(result.created ? 201 : 200).json({
      bot,
      created: result.created
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/start-all", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const bots = await listManageableDevBots(auth);

    await Promise.all(bots.map((bot) => setDevBotDesiredOnline(bot.id, true)));
    await startAllDevBotProcesses(bots.map((bot) => bot.id));
    const updatedBots = await listAccessibleDevBots(auth.user);

    await writeDevBotAudit(
      auth,
      auth.user.selectedGuildId ?? "global",
      null,
      "start_all",
      `${bots.length} bot${bots.length === 1 ? "" : "s"} ligado${bots.length === 1 ? "" : "s"} pelo controle geral DEV.`,
      {
        botIds: bots.map((bot) => bot.id)
      }
    );

    return res.json({
      bots: updatedBots,
      affected: bots.length
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/stop-all", async (_req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const bots = await listManageableDevBots(auth);

    await Promise.all(bots.map((bot) => setDevBotDesiredOnline(bot.id, false)));
    await stopSelectedDevBotProcesses(bots.map((bot) => bot.id), {
      message: "Bots desligados pelo controle geral DEV.",
      notifyBot: true
    });
    const updatedBots = await listAccessibleDevBots(auth.user);

    await writeDevBotAudit(
      auth,
      auth.user.selectedGuildId ?? "global",
      null,
      "stop_all",
      `${bots.length} bot${bots.length === 1 ? "" : "s"} desligado${bots.length === 1 ? "" : "s"} pelo controle geral DEV.`,
      {
        botIds: bots.map((bot) => bot.id)
      }
    );

    return res.json({
      bots: updatedBots,
      affected: bots.length
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/security-access", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    return res.json({
      access: await getSecurityProtectionAccess(req.params.botId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/security-access", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;
    const input = securityAccessSchema.parse(req.body ?? {});

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const access = await setSecurityProtectionAccess({
      botId: req.params.botId,
      enabledByDev: input.enabledByDev,
      actorId: auth.user.discordId
    });
    const bot = await getDevBot(req.params.botId);

    await writeDevBotAudit(
      auth,
      bot?.mainGuildId ?? auth.user.selectedGuildId ?? "global",
      req.params.botId,
      input.enabledByDev ? "security_access_enabled" : "security_access_disabled",
      input.enabledByDev
        ? "Protecao/SafeBot liberada para este bot."
        : "Protecao/SafeBot bloqueada para este bot.",
      {
        featureKey: access.featureKey
      }
    );

    return res.json({
      access,
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const bot = await getDevBot(req.params.botId);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = updateBotSchema.parse(req.body);

    const updatedBot = await updateDevBot(req.params.botId, {
      ...input,
      avatarUrl: input.avatarUrl === "" ? null : input.avatarUrl,
      verifyOwnerUserId: input.token ? auth.user.discordId : null
    });

    if (!updatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    if (input.enabledModules !== undefined) {
      await syncSecurityProtectionAccessFromModules(updatedBot.id, updatedBot.enabledModules, auth.user.discordId);
    }

    if (updatedBot.desiredOnline) await restartDevBotProcess(updatedBot.id);
    const bot = await getDevBot(updatedBot.id) ?? updatedBot;
    await writeDevBotAudit(auth, bot.mainGuildId, bot.id, "update", `Bot ${bot.name} atualizado no painel.`, {
      clientId: bot.clientId
    });

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/bots/:botId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    await stopDevBotProcess(req.params.botId, {
      message: "Bot desconectado pelo painel DEV.",
      notifyBot: true
    });
    const bot = await deleteDevBot(req.params.botId);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }
    await writeDevBotAudit(auth, bot.mainGuildId, bot.id, "delete", `Bot ${bot.name} removido do painel.`, {
      clientId: bot.clientId
    });

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/stop", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const currentBot = await getDevBot(req.params.botId);

    if (!currentBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    await setDevBotDesiredOnline(req.params.botId, false);
    await stopDevBotProcess(req.params.botId, {
      message: "Bot desligado pelo painel DEV.",
      notifyBot: true
    });
    const bot = (await getDevBot(req.params.botId)) ?? currentBot;
    await writeDevBotAudit(auth, bot.mainGuildId, bot.id, "stop", `Bot ${bot.name} desligado pelo painel.`, {
      status: bot.status
    });

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/restart", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const validatedBot = await validateDevBotConnection(req.params.botId);

    if (!validatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    if (validatedBot.status === "invalid_token" || validatedBot.status === "error") {
      return res.status(400).json({
        message: validatedBot.statusMessage ?? "Nao foi possivel validar o bot."
      });
    }

    await setDevBotDesiredOnline(req.params.botId, true);
    await restartDevBotProcess(req.params.botId);
    const bot = await getDevBot(req.params.botId) ?? validatedBot;
    await writeDevBotAudit(auth, bot.mainGuildId, bot.id, "restart", `Bot ${bot.name} reiniciado/sincronizado.`, {
      status: bot.status
    });

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/modules", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const bot = await getDevBot(req.params.botId);

    if (!bot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      modules: bot.enabledModules
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/modules", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = modulesSchema.parse(req.body);
    const updatedBot = await updateDevBotModules(req.params.botId, input.enabledModules, {
      actorId: auth.user.discordId
    });

    if (!updatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    // Apply rapid menu changes in one restart. Restarting synchronously for
    // every switch produced overlapping SIGTERMs and kept the bot offline.
    if (updatedBot.desiredOnline) scheduleDevBotModuleRestart(updatedBot.id);
    const bot = await getDevBot(updatedBot.id) ?? updatedBot;
    await writeDevBotAudit(auth, bot.mainGuildId, bot.id, "modules", `Modulos do bot ${bot.name} atualizados.`, {
      enabledModules: bot.enabledModules
    });

    return res.json({
      bot
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/guilds", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!(await getDevBot(req.params.botId))) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      configs: await listBotGuildConfigs(req.params.botId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/guilds/:guildId/config", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!(await getDevBot(req.params.botId))) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    return res.json({
      config: await getBotGuildConfig(req.params.botId, req.params.guildId)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/guilds/:guildId/config", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!(await getDevBot(req.params.botId))) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    const input = guildConfigSchema.parse(req.body);
    const config = await updateBotGuildConfig({
      botId: req.params.botId,
      guildId: req.params.guildId,
      guildName: input.guildName,
      modules: input.modules
    });

    emitRealtime("dev:config_saved", config);
    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "guild_config", "Configuracao do bot salva para o servidor.", {
      modules: Object.keys(input.modules)
    });

    return res.json({
      config
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.get("/bots/:botId/guilds/:guildId/orvitech-sales", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    return res.json(await getOrvitechSalesDashboard(req.params.botId, req.params.guildId, auth.user.discordId));
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/guilds/:guildId/orvitech-sales/settings", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechSalesSettingsSchema.parse(req.body ?? {});
    const settings = await saveOrvitechSalesSettings(req.params.botId, req.params.guildId, {
      ...input,
      panelImageUrl: input.panelImageUrl === "" ? null : input.panelImageUrl,
      termsUrl: input.termsUrl === "" ? null : input.termsUrl,
      thumbnailUrl: input.thumbnailUrl === "" ? null : input.thumbnailUrl
    }, auth.user.discordId);

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_settings", "Configuracao do sistema de vendas OrviTech atualizada.", {
      enabled: settings.enabled
    });

    return res.json({
      settings: toSettingsDto(settings)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/guilds/:guildId/orvitech-sales/providers", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechPaymentProviderSchema.parse(req.body ?? {});
    const settings = await saveOrvitechPaymentProvider(req.params.botId, req.params.guildId, {
      ...input,
      instructions: input.instructions === "" ? null : input.instructions,
      publicKey: input.publicKey === "" ? null : input.publicKey,
      secret: input.secret === "" ? null : input.secret,
      webhookSecret: input.webhookSecret === "" ? null : input.webhookSecret,
      webhookUrl: input.webhookUrl === "" ? null : input.webhookUrl
    }, auth.user.discordId);

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_provider", `Pagamento OrviTech salvo: ${input.label}.`, {
      provider: input.provider
    });

    return res.json({
      settings: toSettingsDto(settings)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/bots/:botId/guilds/:guildId/orvitech-sales/providers/:providerId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const settings = await deleteOrvitechPaymentProvider(req.params.botId, req.params.guildId, req.params.providerId, auth.user.discordId);

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_provider_delete", "Pagamento OrviTech removido.");

    return res.json({
      settings: toSettingsDto(settings)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/guilds/:guildId/orvitech-sales/products", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechProductSchema.parse(req.body ?? {});
    const product = await saveOrvitechProduct(req.params.botId, req.params.guildId, null, sanitizeOrvitechProductInput(input), auth.user.discordId);

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_product_create", `Produto OrviTech criado: ${input.name}.`);

    return res.status(201).json({
      product: product ? toProductDto(product) : null
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/guilds/:guildId/orvitech-sales/products/:productId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechProductSchema.parse(req.body ?? {});
    const product = await saveOrvitechProduct(req.params.botId, req.params.guildId, req.params.productId, sanitizeOrvitechProductInput(input), auth.user.discordId);

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_product_update", `Produto OrviTech atualizado: ${input.name}.`);

    return res.json({
      product: toProductDto(product)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/guilds/:guildId/orvitech-sales/products/:productId/duplicate", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const product = await duplicateOrvitechProduct(req.params.botId, req.params.guildId, req.params.productId, auth.user.discordId);

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_product_duplicate", `Produto OrviTech duplicado: ${product.name}.`);

    return res.status(201).json({
      product: toProductDto(product)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.put("/bots/:botId/guilds/:guildId/orvitech-sales/products/:productId/banner", orvitechProductBannerUpload, async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        message: "Envie uma imagem para o produto."
      });
    }

    const product = await saveOrvitechProductBannerUpload({
      actorId: auth.user.discordId,
      botId: req.params.botId,
      buffer: req.body,
      guildId: req.params.guildId,
      mimeType: req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
      productId: req.params.productId
    });

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_product_banner", `Banner do produto OrviTech atualizado: ${product.name}.`);

    return res.json({
      product: toProductDto(product)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/bots/:botId/guilds/:guildId/orvitech-sales/products/:productId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const product = await deleteOrvitechProduct(req.params.botId, req.params.guildId, req.params.productId, auth.user.discordId);

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_product_delete", `Produto OrviTech removido: ${product.name}.`);

    return res.json({
      product: toProductDto(product)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/guilds/:guildId/orvitech-sales/plans", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechSalesPlanSchema.parse(req.body ?? {});
    const plan = await saveOrvitechSalesPlan(req.params.botId, req.params.guildId, null, {
      ...input,
      checkoutMessage: input.checkoutMessage === "" ? null : input.checkoutMessage,
      description: input.description === "" ? null : input.description,
      imageUrl: input.imageUrl === "" ? null : input.imageUrl
    }, auth.user.discordId);

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_plan_create", `Plano OrviTech criado: ${input.name}.`);

    return res.status(201).json({
      plan: plan ? toPlanDto(plan) : null
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/guilds/:guildId/orvitech-sales/plans/:planId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechSalesPlanSchema.parse(req.body ?? {});
    const plan = await saveOrvitechSalesPlan(req.params.botId, req.params.guildId, req.params.planId, {
      ...input,
      checkoutMessage: input.checkoutMessage === "" ? null : input.checkoutMessage,
      description: input.description === "" ? null : input.description,
      imageUrl: input.imageUrl === "" ? null : input.imageUrl
    }, auth.user.discordId);

    if (!plan) {
      return res.status(404).json({
        message: "Plano de venda nao encontrado."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_plan_update", `Plano OrviTech atualizado: ${input.name}.`);

    return res.json({
      plan: toPlanDto(plan)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.delete("/bots/:botId/guilds/:guildId/orvitech-sales/plans/:planId", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const deleted = await deleteScopedOrvitechSalesPlan(req.params.botId, req.params.guildId, req.params.planId, auth.user.discordId);

    if (!deleted) {
      return res.status(404).json({
        message: "Plano de venda nao encontrado."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_plan_delete", `Plano OrviTech removido: ${deleted.name}.`);

    return res.json({
      plan: toPlanDto(deleted)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.post("/bots/:botId/guilds/:guildId/orvitech-sales/sales", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechSaleSchema.parse(req.body ?? {});
    const sale = await saveOrvitechSale(req.params.botId, req.params.guildId, {
      ...input,
      buyerName: input.buyerName === "" ? null : input.buyerName,
      externalReference: input.externalReference === "" ? null : input.externalReference,
      notes: input.notes === "" ? null : input.notes
    }, auth.user.discordId);

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_sale_create", `Venda OrviTech registrada para ${input.buyerId}.`, {
      status: sale.status
    });

    return res.status(201).json({
      sale: toSaleDto(sale)
    });
  } catch (error) {
    return next(error);
  }
});

devRouter.patch("/bots/:botId/guilds/:guildId/orvitech-sales/sales/:saleId/status", async (req, res, next) => {
  try {
    const auth = res.locals.dashboardAuth as DashboardAuth;

    if (!(await canManageDevBot(auth.user, req.params.botId))) {
      return res.status(403).json({
        message: "Voce nao tem acesso a este bot."
      });
    }

    const input = orvitechSaleStatusSchema.parse(req.body ?? {});
    const sale = await updateOrvitechSaleStatus(req.params.botId, req.params.guildId, req.params.saleId, input.status, auth.user.discordId);

    if (!sale) {
      return res.status(404).json({
        message: "Venda nao encontrada."
      });
    }

    await writeDevBotAudit(auth, req.params.guildId, req.params.botId, "orvitech_sales_status", `Venda OrviTech marcada como ${input.status}.`);

    return res.json({
      sale: toSaleDto(sale)
    });
  } catch (error) {
    return next(error);
  }
});

async function listManageableDevBots(auth: DashboardAuth) {
  const bots = await listAccessibleDevBots(auth.user);
  const manageable = await Promise.all(bots.map(async (bot) => (
    (await canManageDevBot(auth.user, bot.id)) ? bot : null
  )));

  return manageable.filter((bot): bot is NonNullable<(typeof manageable)[number]> => Boolean(bot));
}

async function writeDevBotAudit(
  auth: DashboardAuth,
  guildId: string,
  botId: string | null,
  action: string,
  message: string,
  metadata: Record<string, unknown> = {}
) {
  const bot = botId ? await getDevBot(botId).catch(() => null) : null;

  await createLog({
    botId,
    guildId,
    userId: auth.user.discordId,
    type: "audit.dev_bot",
    message,
    metadata: {
      module: "dev_bots",
      action,
      ...metadata
    }
  });

  await createDashboardAuditLog({
    action: `dev_bot.${action}`,
    botId,
    dashboardSlug: bot?.slug ?? null,
    guildId,
    metadata: {
      module: "dev_bots",
      message,
      ...metadata
    },
    userId: auth.user.discordId
  }).catch((error) => {
    console.warn("[audit] nao foi possivel registrar auditoria da dashboard:", error instanceof Error ? error.message : error);
  });
}

function sanitizeOrvitechProductInput(input: z.infer<typeof orvitechProductSchema>) {
  return {
    ...input,
    additionalInfo: input.additionalInfo === "" ? null : input.additionalInfo,
    bannerUrl: input.bannerUrl === "" ? null : input.bannerUrl,
    fullDescription: input.fullDescription === "" ? null : input.fullDescription,
    howItWorks: input.howItWorks === "" ? null : input.howItWorks,
    observations: input.observations === "" ? null : input.observations,
    seo: input.seo ? {
      description: input.seo.description === "" ? null : input.seo.description,
      title: input.seo.title === "" ? null : input.seo.title
    } : undefined,
    shortDescription: input.shortDescription === "" ? null : input.shortDescription,
    slug: input.slug === "" ? null : input.slug,
    warnings: input.warnings === "" ? null : input.warnings
  };
}
