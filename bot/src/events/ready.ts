import type { Client } from "discord.js";
import {
  configuredBotModules,
  env,
  isBotModuleEnabled,
  setRuntimeEnabledModules
} from "../config/env";
import { clearGlobalCommands, registerGuildCommands } from "../handlers/commandHandler";
import { startClipsMonitor } from "../services/clipsMonitor";
import { startDiscordLogDelivery } from "../services/discordLogDeliveryService";
import { startDatabaseMaintenanceService } from "../services/databaseMaintenanceService";
import { startFivemFacService } from "../services/fivemFacService";
import { startFivemGoalService } from "../services/fivemGoalService";
import { startFooterRuntimeService } from "../services/footerRuntimeService";
import { startFivemFinanceService } from "../services/fivemFinanceService";
import { startFivemExpenseService } from "../services/fivemExpenseService";
import { startAmmunitionService } from "../services/ammunitionService";
import { startWeaponSaleService } from "../services/weaponSaleService";
import { startFivemOrderService } from "../services/fivemOrderService";
import { startFivemHierarchyService } from "../services/fivemHierarchyService";
import { startFivemActionService } from "../services/fivemActionService";
import { startFivemCaptchaService } from "../services/fivemCaptchaService";
import { startFivemCommandsService } from "../services/fivemCommandsService";
import { startFactionChestService } from "../services/factionChestService";
import { startZtkWebhookService } from "../services/ztkWebhookService";
import { startPolicePatrolReportService } from "../services/policePatrolReportService";
import { startPoliceRecruitmentService } from "../services/policeRecruitmentService";
import { clearPoliceHiddenChannelSettingsCache } from "../services/policeHiddenChannelService";
import { clearVehicleAbandonmentSettingsCache } from "../services/vehicleAbandonmentService";
import { clearPoliceQruSettingsCache, startPoliceQruRankingService } from "../services/policeQruService";
import { clearPolicePromotionSettingsCache, startPolicePromotionService } from "../services/policePromotionService";
import { clearPoliceRankUpSettingsCache, startPoliceRankUpService } from "../services/policeRankUpService";
import { clearMessageControlCache } from "../services/messageControlService";
import { clearVisibleMessageCache } from "../services/visibleMessageService";
import { clearDmBarConfigCache } from "../services/dmBarService";
import { startGiveawayService } from "../services/giveawayService";
import { startGuildSettingsCache } from "../services/guildSettingsCache";
import { startImageAntiSpamService } from "../services/imageAntiSpamService";
import { startKickNotificationMonitor } from "../services/kickNotificationMonitor";
import { startLiveDetectionService } from "../services/liveService";
import { isMaintenanceModeActive, onMaintenanceStateChanged, refreshMaintenanceState, startMaintenanceService } from "../services/maintenanceService";
import { startNexTechSalesDeliveryService } from "../services/nexTechSalesDeliveryService";
import { startNexTechInviteService } from "../services/nexTechInviteService";
import { startSalesTicketService } from "../services/salesTicketService";
import { startManualPaymentService } from "../services/manualPaymentService";
import { startCustomBotOrderService } from "../services/customBotOrderService";
import { startContractBillingDmService } from "../services/contractBillingDmService";
import { startPriceTableService } from "../services/priceTableService";
import { startManualRegistrationService } from "../services/manualRegistrationService";
import { startRhAdminService } from "../services/rhAdminService";
import { startCourseSystemService } from "../services/courseSystemService";
import { startTicketPanelService } from "../services/ticketPanelService";
import { startReportSystemService } from "../services/reportSystemService";
import { syncAutomaticRolesAfterReady, syncAutomaticRolesForGuild } from "../services/roleService";
import {
  disableUnreleasedSafeBotChannels,
  ensureSafeBotSetup,
  ensureSelfBotRoles,
  handleSafeBotSettingsUpdated,
  isSelfBotModuleEnabled,
  reconcileSelfBotPunishmentRoles
} from "../services/safeBotService";
import { clearRuntimeModuleAuthorization } from "../services/runtimeModuleGuard";
import { startSelfBotProtectionService } from "../services/selfBotProtectionService";
import { startCustomPanelSync } from "../services/customPanelRuntimeService";
import { startSocialNetworkPanelSync } from "../services/socialNetworkPanelService";
import { startSocialNotificationMonitor } from "../services/socialNotificationMonitor";
import { validateSystemEmojisOnStartup } from "../services/systemEmojiService";
import { startTemporaryVoiceService } from "../services/temporaryVoiceService";
import { startAutomatedLogService } from "../services/automatedLogService";
import { startAutoActivityClockService } from "../services/autoActivityClockBotService";
import { startApplicationEmojiAutoSync } from "../services/applicationEmojiSyncService";
import { botBootController, type BotBootTask, type BotBootTier } from "../services/bootController";
import { startTagVerificationService, stopTagVerificationService } from "../services/tagVerificationService";
import { startXMonitor } from "../services/xMonitor";
import type { BotCommand, BotContext } from "../types";

let lastRuntimeModuleSignature = "";
let lastRuntimeStatusWarningAt = 0;
let commandSyncPromise: Promise<void> | null = null;
const startedRuntimeServices = new Set<string>();
const COMMAND_SYNC_ATTEMPTS = 3;
const COMMAND_SYNC_RETRY_DELAY_MS = 5_000;

export async function handleReady(client: Client<true>, context: BotContext) {
  console.log(`[bot] conectado como ${client.user.tag}`);
  botBootController.setState("STARTING_DISCORD");
  botBootController.markReady("Discord Gateway", "critical");
  context.api.setDiscordClientId(client.user.id);
  botBootController.setState("STARTING_CORE");
  const runtimeAccess = await loadRuntimeAccess(context);
  const fallbackModules = configuredBotModules();
  const shouldApplyRuntimeModules = Boolean(runtimeAccess || env.DASHBOARD_BOT_ID || env.BOT_ENABLED_MODULES.trim());
  const runtimeBotId = runtimeAccess?.botId ?? (env.DASHBOARD_BOT_ID || null);

  const runtimeModules = runtimeAccess
    ? (runtimeAccess.active ? runtimeAccess.enabledModules : [])
    : fallbackModules;

  if (shouldApplyRuntimeModules) {
    setRuntimeEnabledModules(runtimeModules, runtimeBotId);
    lastRuntimeModuleSignature = runtimeModuleSignature(runtimeAccess?.active ?? true, runtimeBotId, runtimeModules);
  }
  botBootController.markReady("RuntimeAccess", "critical");
  void validateSystemEmojisOnStartup(client, context);
  context.socket.onDevModuleUpdated((payload) => {
    if (!runtimeBotId || payload.botId !== runtimeBotId) {
      return;
    }

    const wasSelfBotEnabled = isSelfBotModuleEnabled();
    const wasRolesEnabled = isBotModuleEnabled("roles");
    const wasTagVerificationEnabled = isBotModuleEnabled("tag-verification");
    setRuntimeEnabledModules(payload.enabledModules);
    lastRuntimeModuleSignature = runtimeModuleSignature(true, runtimeBotId, payload.enabledModules);
    clearRuntimeModuleAuthorization();
    void syncVisibleGuildCommands(client, context, "module_update");

    if (!wasSelfBotEnabled && isSelfBotModuleEnabled()) {
      startSelfBotProtectionService(context);
      void ensureSelfBotRoles(client, context);
      void reconcileSelfBotPunishmentRoles(client, context);
    }

    if (wasSelfBotEnabled && !isSelfBotModuleEnabled()) {
      void disableUnreleasedSafeBotChannels(client, context);
    }

    void startRuntimeModuleServices(client, context);
    if (!wasRolesEnabled && isBotModuleEnabled("roles")) {
      void syncAutomaticRolesAfterReady(client, context, "roles_module_update").catch((error) => {
        console.warn("[roles] falha ao sincronizar cargos após liberar módulo:", error instanceof Error ? error.message : error);
      });
    }
    if (wasTagVerificationEnabled && !isBotModuleEnabled("tag-verification")) stopTagVerificationService();
  });
  context.socket.onSelfBotEnsureSetup(async (payload, acknowledge) => {
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) {
      acknowledge?.({ error: "Evento destinado a outro bot.", ok: false });
      return;
    }

    if (!isSelfBotModuleEnabled()) {
      acknowledge?.({ error: "O módulo SafeBot não está ativo neste bot.", ok: false });
      return;
    }

    try {
      if (payload.guildId) {
        const guild = client.guilds.cache.get(payload.guildId);
        if (!guild) {
          acknowledge?.({ error: "O bot não está conectado ao servidor selecionado.", ok: false });
          return;
        }
        const setup = await ensureSafeBotSetup(guild, context);
        acknowledge?.(setup
          ? { ok: true }
          : { error: "Não foi possível criar os canais. Verifique Gerenciar Canais e Gerenciar Cargos.", ok: false });
        return;
      }

      await ensureSelfBotRoles(client, context);
      acknowledge?.({ ok: true });
    } catch (error) {
      acknowledge?.({ error: error instanceof Error ? error.message : String(error), ok: false });
    }
  });
  startGuildSettingsCache(context);
  startFooterRuntimeService(client, context);
  context.socket.onSettingsUpdated((settings) => {
    void handleSafeBotSettingsUpdated(settings, client, context);
    if ((!runtimeBotId || settings.botId === runtimeBotId) && settings.autoRoleEnabled) {
      const guild = client.guilds.cache.get(settings.guildId);
      if (guild) {
        void syncAutomaticRolesForGuild(context, guild, "settings_update").catch((error) => {
          console.warn("[roles] falha ao sincronizar cargos após atualização de configuração:", error instanceof Error ? error.message : error);
        });
      }
    }
  });
  context.socket.onPoliceHiddenChannelSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearPoliceHiddenChannelSettingsCache(payload.guildId);
    }
  });
  context.socket.onVehicleAbandonmentSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearVehicleAbandonmentSettingsCache(payload.guildId);
    }
  });
  context.socket.onPoliceQruSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearPoliceQruSettingsCache(payload.guildId);
    }
  });
  context.socket.onPolicePromotionSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearPolicePromotionSettingsCache(payload.guildId);
    }
  });
  context.socket.onPoliceRankUpSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearPoliceRankUpSettingsCache(payload.guildId);
    }
  });
  context.socket.onVisibleMessageUsersUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearVisibleMessageCache(payload.guildId);
    }
  });
  context.socket.onMessageControlUsersUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearMessageControlCache(payload.guildId);
    }
  });
  context.socket.onDmBarSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearDmBarConfigCache(payload.guildId);
      void syncVisibleGuildCommands(client, context, "dm_bar_settings_update");
    }
  });
  startDiscordLogDelivery(context);
  startDatabaseMaintenanceService(client, context);
  startMaintenanceService(context, { refreshImmediately: false });
  await refreshMaintenanceState(context);
  botBootController.markReady("Core", "critical");
  onMaintenanceStateChanged((state, previousActive) => {
    if (previousActive && !state.active) {
      void startOperationalRuntime(client, context, "maintenance_ended").catch((error) => {
        console.warn("[bot] falha ao iniciar serviços após manutenção:", error instanceof Error ? error.message : error);
      });
    }
  });

  await botBootController.runTier("STARTING_CRITICAL_MODULES", [
    {
      enabled: true,
      name: "DiscordRequestManager",
      run: () => undefined,
      tier: "critical"
    },
    {
      enabled: true,
      name: "CommandSync",
      run: () => syncVisibleGuildCommands(client, context, "ready"),
      tier: "critical",
      dependencies: ["Discord Gateway", "DiscordRequestManager"]
    },
    {
      enabled: true,
      name: "RealtimeStatus",
      run: async () => {
        context.socket.connect(client);
        context.socket.emitStatus(client, true);
        await reportRuntimeStatus(context, client, true);
      },
      tier: "critical",
      dependencies: ["Core"]
    }
  ], 1);

  if (isMaintenanceModeActive()) {
    console.log("[maintenance] serviços operacionais adiados até o fim da manutenção.");
    botBootController.finish();
  } else {
    await startOperationalRuntime(client, context, "ready").catch((error) => {
      console.warn("[bot] falha ao iniciar runtime operacional:", error instanceof Error ? error.message : error);
    });
  }

  const statusInterval = setInterval(() => {
    context.socket.emitStatus(client, true);
  }, 5_000);

  statusInterval.unref();

  const interval = setInterval(() => {
    context.socket.emitStatus(client, true);
    void reportRuntimeStatus(context, client, true);
  }, 30_000);

  interval.unref();

  const moduleReconcileInterval = setInterval(() => {
    void reconcileRuntimeModules(client, context);
  }, 45_000);

  moduleReconcileInterval.unref();
}

function commandRegistrationGuildIds(client: Client<true>) {
  const connectedGuildIds = new Set(client.guilds.cache.map((guild) => guild.id));

  return unique([
    ...csv(env.BOT_COMMAND_GUILD_IDS),
    env.BOT_MAIN_GUILD_ID.trim(),
    ...csv(env.DASHBOARD_GUILD_IDS),
    ...client.guilds.cache.map((guild) => guild.id)
  ]).filter((guildId) => connectedGuildIds.has(guildId));
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function syncVisibleGuildCommands(client: Client<true>, context: BotContext, reason: string) {
  if (commandSyncPromise) {
    await commandSyncPromise;
  }

  commandSyncPromise = syncVisibleGuildCommandsNow(client, context, reason).finally(() => {
    commandSyncPromise = null;
  });

  await commandSyncPromise;
}

async function syncVisibleGuildCommandsNow(client: Client<true>, context: BotContext, reason: string) {
  const commandGuildIds = commandRegistrationGuildIds(client);
  const commands = visibleCommands([...context.commands.values()]);
  const commandNames = commands.map((command) => command.data.name).join(", ") || "nenhum comando";

  try {
    await clearGlobalCommands(client.user.id);
    console.log(`[bot] comandos globais limpos (${reason}).`);
  } catch (error) {
    console.warn(`[bot] falha ao limpar comandos globais (${reason}):`, error instanceof Error ? error.message : error);
  }

  for (const commandGuildId of commandGuildIds) {
    try {
      await registerGuildCommandsWithRetry(commands, client.user.id, commandGuildId, reason);
      console.log(`[bot] comandos sincronizados no servidor ${commandGuildId} (${reason}): ${commandNames}`);
    } catch (error) {
      console.warn(`[bot] falha ao sincronizar comandos no servidor ${commandGuildId} (${reason}):`, error instanceof Error ? error.message : error);
    }
  }
}

async function registerGuildCommandsWithRetry(commands: BotCommand[], clientId: string, guildId: string, reason: string) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= COMMAND_SYNC_ATTEMPTS; attempt += 1) {
    try {
      await registerGuildCommands(commands, clientId, guildId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= COMMAND_SYNC_ATTEMPTS) break;
      console.warn(`[bot] tentativa ${attempt}/${COMMAND_SYNC_ATTEMPTS} falhou ao sincronizar comandos em ${guildId} (${reason}); tentando novamente em ${COMMAND_SYNC_RETRY_DELAY_MS / 1_000}s:`, error instanceof Error ? error.message : error);
      await delay(COMMAND_SYNC_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

function visibleCommands(commands: BotCommand[]) {
  return commands;
}

async function startOperationalRuntime(client: Client<true>, context: BotContext, reason: string) {
  if (isMaintenanceModeActive()) {
    console.log(`[maintenance] serviços operacionais seguem adiados (${reason}).`);
    return;
  }

  await startRuntimeModuleServices(client, context, ["critical"]);
  await botBootController.runTier("STARTING_CRITICAL_MODULES", [
    {
      enabled: true,
      name: "SelfBotProtection",
      run: async () => {
        startSelfBotProtectionService(context);
        if (isSelfBotModuleEnabled()) {
          await ensureSelfBotRoles(client, context);
          await reconcileSelfBotPunishmentRoles(client, context);
        } else {
          await disableUnreleasedSafeBotChannels(client, context);
        }
      },
      tier: "critical",
      dependencies: ["Discord Gateway", "Core"]
    }
  ], 1);
  await startRuntimeModuleServices(client, context, ["normal"]);
  await botBootController.runTier("HEALTH_CHECK", [
    {
      enabled: true,
      name: "BotHealth",
      run: () => {
        if (!client.isReady()) throw new Error("Discord client ainda não está ready.");
      },
      tier: "critical",
      dependencies: ["Discord Gateway"]
    }
  ], 1);
  botBootController.finish();
  await startRuntimeModuleServices(client, context, ["background"]);

  void syncAutomaticRolesAfterReady(client, context, reason).catch((error) => {
    console.warn("[roles] falha na sincronização pós-redeploy:", error instanceof Error ? error.message : error);
  });
}

async function startRuntimeModuleServices(client: Client<true>, context: BotContext, tiers: BotBootTier[] = ["critical", "normal", "background"]) {
  const tasks = runtimeModuleTasks(client, context).filter((task) => tiers.includes(task.tier));
  const critical = tasks.filter((task) => task.tier === "critical");
  const normal = tasks.filter((task) => task.tier === "normal");
  const background = tasks.filter((task) => task.tier === "background");

  if (critical.length) await botBootController.runTier("STARTING_CRITICAL_MODULES", critical, 1);
  if (normal.length) await botBootController.runTier("STARTING_NORMAL_MODULES", normal, 2);
  if (background.length) botBootController.startBackground(background, 1);
}

function runtimeModuleTasks(client: Client<true>, context: BotContext): BotBootTask[] {
  return [
  runtimeModuleTask("logs", "critical", isBotModuleEnabled("logs"), () => startAutomatedLogService(client, context)),
  runtimeModuleTask("live", "background", isBotModuleEnabled("live"), () => {
    startLiveDetectionService(client, context);
    startSocialNotificationMonitor(client, context.api);
  }),
  runtimeModuleTask("kick-integration", "background", isBotModuleEnabled("live") || isBotModuleEnabled("kick-integration"), () => startKickNotificationMonitor(client, context.api)),
  runtimeModuleTask("network", "normal", isBotModuleEnabled("network"), () => startSocialNetworkPanelSync(client, context.api, context.socket)),
  runtimeModuleTask("panels", "normal", isBotModuleEnabled("panels"), () => startCustomPanelSync(client, context.api, context.socket)),
  runtimeModuleTask("x-monitor", "background", isBotModuleEnabled("x-monitor"), () => startXMonitor(client, context.api, context.socket)),
  runtimeModuleTask("clips", "background", isBotModuleEnabled("clips") || isBotModuleEnabled("kick-clips"), () => startClipsMonitor(client, context.api)),
  runtimeModuleTask("giveaway", "normal", isBotModuleEnabled("giveaway"), () => startGiveawayService(client, context.api, context.socket)),
  runtimeModuleTask("fivem-absences", "normal", isBotModuleEnabled("fivem-absences"), () => startFivemFacService(client, context)),
  runtimeModuleTask("fivem-goals", "normal", isBotModuleEnabled("fivem-goals"), () => startFivemGoalService(client, context)),
  runtimeModuleTask("ztk-webhook", "normal", isBotModuleEnabled("ztk-webhook"), () => startZtkWebhookService(client, context)),
  runtimeModuleTask("fivem-finance", "normal", isBotModuleEnabled("fivem-finance"), () => startFivemFinanceService(client, context)),
  runtimeModuleTask("fivem-expenses", "normal", isBotModuleEnabled("fivem-expenses"), () => startFivemExpenseService(client, context)),
  runtimeModuleTask("fivem-ammunition", "normal", isBotModuleEnabled("fivem-ammunition"), () => startAmmunitionService(client, context)),
  runtimeModuleTask("fivem-weapons", "normal", isBotModuleEnabled("fivem-weapons"), () => startWeaponSaleService(client, context)),
  runtimeModuleTask("fivem-orders", "normal", isBotModuleEnabled("fivem-drugs") || isBotModuleEnabled("fivem-washing"), () => startFivemOrderService(client, context)),
  runtimeModuleTask("manual-payments", "critical", isBotModuleEnabled("manual-payments"), () => startManualPaymentService(client, context)),
  runtimeModuleTask("custom-bot-orders", "normal", isBotModuleEnabled("custom-bot-orders"), () => startCustomBotOrderService(client, context)),
  runtimeModuleTask("contract-billing-dm", "critical", true, () => startContractBillingDmService(client, context)),
  runtimeModuleTask("price-tables", "normal", isBotModuleEnabled("price-tables"), () => startPriceTableService(client, context)),
  runtimeModuleTask("nex-tech-sales", "critical", isBotModuleEnabled("nex-tech-sales") || isBotModuleEnabled("subscription-presence"), () => startNexTechSalesDeliveryService(client, context)),
  runtimeModuleTask("nextech-invites", "normal", isBotModuleEnabled("nextech-invites"), () => startNexTechInviteService(client, context)),
  runtimeModuleTask("sales-tickets", "critical", isBotModuleEnabled("nex-tech-sales"), () => startSalesTicketService(client, context)),
  runtimeModuleTask("emoji-cloner", "background", isBotModuleEnabled("emoji-cloner"), () => startApplicationEmojiAutoSync(client, context)),
  runtimeModuleTask("rh-admin", "normal", isBotModuleEnabled("rh-admin"), () => startRhAdminService(client, context)),
  runtimeModuleTask("courses", "normal", isBotModuleEnabled("courses"), () => startCourseSystemService(client, context)),
  runtimeModuleTask("tickets", "critical", isBotModuleEnabled("tickets"), () => startTicketPanelService(client, context)),
  runtimeModuleTask("report-system", "critical", isReportSystemModuleEnabled(), () => startReportSystemService(client, context)),
  runtimeModuleTask("fivem-hierarchy", "normal", isBotModuleEnabled("fivem-hierarchy"), () => startFivemHierarchyService(client, context)),
  runtimeModuleTask("fivem-actions", "normal", isBotModuleEnabled("fivem-actions") || isBotModuleEnabled("police-actions"), () => startFivemActionService(client, context)),
  runtimeModuleTask("fivem-captcha", "normal", isBotModuleEnabled("fivem-captcha"), () => startFivemCaptchaService(client, context)),
  runtimeModuleTask("fivem-commands", "normal", isBotModuleEnabled("fivem-commands"), () => startFivemCommandsService(client, context)),
  runtimeModuleTask("faction-chest", "normal", isBotModuleEnabled("faction-chest"), () => startFactionChestService(client, context)),
  runtimeModuleTask("police-patrol-reports", "normal", isBotModuleEnabled("police-patrol-reports"), () => startPolicePatrolReportService(client, context)),
  runtimeModuleTask("police-recruitment", "normal", isBotModuleEnabled("police-recruitment"), () => startPoliceRecruitmentService(client, context)),
  runtimeModuleTask("police-qru-ranking", "background", true, () => startPoliceQruRankingService(client, context)),
  runtimeModuleTask("police-promotions", "normal", isBotModuleEnabled("police-promotions"), () => startPolicePromotionService(client, context)),
  runtimeModuleTask("police-rank-up", "normal", isBotModuleEnabled("police-rank-up"), () => startPoliceRankUpService(context)),
  runtimeModuleTask("manual-registration", "normal", isBotModuleEnabled("manual-registration"), () => startManualRegistrationService(client, context)),
  runtimeModuleTask("image-anti-spam", "normal", isBotModuleEnabled("image-anti-spam") && !isSelfBotModuleEnabled(), () => startImageAntiSpamService(context)),
  runtimeModuleTask("voice-recorder", "normal", isBotModuleEnabled("voice-recorder"), async () => {
    const { startVoiceRecorderService } = await import("../services/voiceRecorderService.js");
    await startVoiceRecorderService(context);
  }),
  runtimeModuleTask("auto-activity-clock", "background", isBotModuleEnabled("auto-activity-clock"), () => startAutoActivityClockService(client, context)),
  runtimeModuleTask("temporary-voice", "normal", isBotModuleEnabled("temporary-voice"), () => startTemporaryVoiceService(client, context)),
  runtimeModuleTask("tag-verification", "normal", isBotModuleEnabled("tag-verification"), () => startTagVerificationService(client, context))
  ];
}

function runtimeModuleTask(key: string, tier: BotBootTier, enabled: boolean, starter: () => void | Promise<void>): BotBootTask {
  return {
    dependencies: ["Discord Gateway", "Core"],
    enabled,
    name: `module:${key}`,
    run: () => startRuntimeService(key, enabled, starter),
    tier
  };
}

async function startRuntimeService(key: string, enabled: boolean, starter: () => void | Promise<void>) {
  if (!enabled || startedRuntimeServices.has(key)) {
    return;
  }

  startedRuntimeServices.add(key);
  try {
    const result = starter();
    if (result instanceof Promise) await result;
  } catch (error) {
    startedRuntimeServices.delete(key);
    throw error;
  }
}

async function reportRuntimeStatus(context: BotContext, client: Client, online: boolean) {
  try {
    await context.api.reportRuntimeStatus({
      botGuilds: client.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name
      })),
      botProfile: client.user
        ? {
            avatarUrl: client.user.displayAvatarURL({ size: 256 }),
            id: client.user.id,
            username: client.user.username
          }
        : undefined,
      online
    });
  } catch (error) {
    const now = Date.now();

    if (now - lastRuntimeStatusWarningAt > 60_000) {
      lastRuntimeStatusWarningAt = now;
      console.warn("[bot] não foi possível sincronizar status runtime:", error instanceof Error ? error.message : error);
    }
  }
}

async function loadRuntimeAccess(context: BotContext) {
  return context.api.getRuntimeModules().catch((error) => {
    console.warn("[bot] não foi possível carregar módulos liberados:", error instanceof Error ? error.message : error);
    return null;
  });
}

async function reconcileRuntimeModules(client: Client<true>, context: BotContext) {
  const runtimeAccess = await loadRuntimeAccess(context);

  if (!runtimeAccess) {
    return;
  }

  const wasSelfBotEnabled = isSelfBotModuleEnabled();
  const wasTemporaryVoiceEnabled = isBotModuleEnabled("temporary-voice");
  const wasFivemHierarchyEnabled = isBotModuleEnabled("fivem-hierarchy");
  const wasTagVerificationEnabled = isBotModuleEnabled("tag-verification");
  const runtimeModules = runtimeAccess.active ? runtimeAccess.enabledModules : [];
  const nextSignature = runtimeModuleSignature(runtimeAccess.active, runtimeAccess.botId, runtimeModules);

  if (nextSignature === lastRuntimeModuleSignature) {
    // Recover SafeBot activation events that happened during a socket reconnect.
    if (isSelfBotModuleEnabled()) await ensureSelfBotRoles(client, context);
    if (isBotModuleEnabled("fivem-hierarchy")) void startRuntimeModuleServices(client, context);
    return;
  }

  setRuntimeEnabledModules(runtimeModules, runtimeAccess.botId);
  lastRuntimeModuleSignature = nextSignature;
  clearRuntimeModuleAuthorization();

  if (isSelfBotModuleEnabled()) {
    startSelfBotProtectionService(context);
    await ensureSelfBotRoles(client, context);
    await reconcileSelfBotPunishmentRoles(client, context);
  } else if (wasSelfBotEnabled) {
    await disableUnreleasedSafeBotChannels(client, context);
  }

  await startRuntimeModuleServices(client, context);
  if (wasTagVerificationEnabled && !isBotModuleEnabled("tag-verification")) {
    stopTagVerificationService();
  }

  await syncVisibleGuildCommands(client, context, "module_reconcile");
}

function isReportSystemModuleEnabled() {
  return isBotModuleEnabled("police-iab") || isBotModuleEnabled("police-subpoenas");
}

function runtimeModuleSignature(active: boolean, botId: string | null | undefined, moduleIds: string[]) {
  return [
    active ? "active" : "inactive",
    botId ?? "",
    [...new Set(moduleIds.map((moduleId) => moduleId.trim()).filter(Boolean))].sort().join(",")
  ].join("|");
}
