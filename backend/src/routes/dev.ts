import { Router } from "express";
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
  getDevBot,
  ensurePrimaryDevBotListed,
  listAccessibleDevBots,
  listBotGuildConfigs,
  registerPrimaryDevBot,
  testDiscordBotToken,
  updateBotGuildConfig,
  updateDevBot,
  updateDevBotModules,
  validateDevBotConnection
} from "../services/devBotService";
import {
  restartDevBotProcess,
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

export const devRouter = Router();

devRouter.use(requireDevAccess);

devRouter.get("/modules", (_req, res) => {
  return res.json({
    modules: DEV_MODULES
  });
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
      input.active ? "Modo de manutencao global ativado." : "Modo de manutencao global desativado.",
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
      "Alerta manual de manutencao enviado.",
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

    return res.json({
      bots: await listAccessibleDevBots(auth.user)
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

    await restartDevBotProcess(updatedBot.id);
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

    const stoppedBot = await stopDevBotProcess(req.params.botId, {
      message: "Bot desligado pelo painel DEV.",
      notifyBot: true
    });
    const bot = stoppedBot ?? (await getDevBot(req.params.botId)) ?? currentBot;
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
    const updatedBot = await updateDevBotModules(req.params.botId, input.enabledModules);

    if (!updatedBot) {
      return res.status(404).json({
        message: "Bot nao encontrado."
      });
    }

    await restartDevBotProcess(updatedBot.id);
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
