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
import { startFivemFinanceService } from "../services/fivemFinanceService";
import { startFivemOrderService } from "../services/fivemOrderService";
import { startFivemHierarchyService } from "../services/fivemHierarchyService";
import { startFivemActionService } from "../services/fivemActionService";
import { startFactionChestService } from "../services/factionChestService";
import { startFivemPd7Service } from "../services/fivemPd7Service";
import { startZtkWebhookService } from "../services/ztkWebhookService";
import { startPolicePatrolReportService } from "../services/policePatrolReportService";
import { clearPoliceHiddenChannelSettingsCache } from "../services/policeHiddenChannelService";
import { clearVehicleAbandonmentSettingsCache } from "../services/vehicleAbandonmentService";
import { clearPoliceQruSettingsCache } from "../services/policeQruService";
import { clearPolicePromotionSettingsCache, startPolicePromotionService } from "../services/policePromotionService";
import { clearMessageControlCache } from "../services/messageControlService";
import { clearVisibleMessageCache } from "../services/visibleMessageService";
import { clearDmBarConfigCache } from "../services/dmBarService";
import { startGiveawayService } from "../services/giveawayService";
import { startGuildSettingsCache } from "../services/guildSettingsCache";
import { startImageAntiSpamService } from "../services/imageAntiSpamService";
import { startKickNotificationMonitor } from "../services/kickNotificationMonitor";
import { startLiveDetectionService } from "../services/liveService";
import { isMaintenanceModeActive, onMaintenanceStateChanged, refreshMaintenanceState, startMaintenanceService } from "../services/maintenanceService";
import { startMissionToolsService } from "../services/missionToolsService";
import { startNexTechSalesDeliveryService } from "../services/nexTechSalesDeliveryService";
import { startSalesTicketService } from "../services/salesTicketService";
import { startManualPaymentService } from "../services/manualPaymentService";
import { startPriceTableService } from "../services/priceTableService";
import { startManualRegistrationService } from "../services/manualRegistrationService";
import { startRhAdminService } from "../services/rhAdminService";
import { startCourseSystemService } from "../services/courseSystemService";
import { startTicketPanelService } from "../services/ticketPanelService";
import { startReportSystemService } from "../services/reportSystemService";
import { syncAutomaticRolesAfterReady } from "../services/roleService";
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
import { startSocialNetworkPanelSync } from "../services/socialNetworkPanelService";
import { startSocialNotificationMonitor } from "../services/socialNotificationMonitor";
import { validateSystemEmojisOnStartup } from "../services/systemEmojiService";
import { startTemporaryVoiceService } from "../services/temporaryVoiceService";
import { startAutomatedLogService } from "../services/automatedLogService";
import { startAutoActivityClockService } from "../services/autoActivityClockBotService";
import { startApplicationEmojiAutoSync } from "../services/applicationEmojiSyncService";
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
  context.api.setDiscordClientId(client.user.id);
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
  void validateSystemEmojisOnStartup(client, context);
  context.socket.onDevModuleUpdated((payload) => {
    if (!runtimeBotId || payload.botId !== runtimeBotId) {
      return;
    }

    const wasSelfBotEnabled = isSelfBotModuleEnabled();
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
  context.socket.onSettingsUpdated((settings) => {
    void handleSafeBotSettingsUpdated(settings, client, context);
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
  onMaintenanceStateChanged((state, previousActive) => {
    if (previousActive && !state.active) {
      void startOperationalRuntime(client, context, "maintenance_ended").catch((error) => {
        console.warn("[bot] falha ao iniciar serviços após manutenção:", error instanceof Error ? error.message : error);
      });
    }
  });

  await syncVisibleGuildCommands(client, context, "ready");

  context.socket.connect(client);
  context.socket.emitStatus(client, true);
  void reportRuntimeStatus(context, client, true);

  if (isMaintenanceModeActive()) {
    console.log("[maintenance] serviços operacionais adiados até o fim da manutenção.");
  } else {
    await startOperationalRuntime(client, context, "ready");
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
  return commands.filter((command) => !command.moduleId || isBotModuleEnabled(command.moduleId));
}

async function startOperationalRuntime(client: Client<true>, context: BotContext, reason: string) {
  if (isMaintenanceModeActive()) {
    console.log(`[maintenance] serviços operacionais seguem adiados (${reason}).`);
    return;
  }

  await startRuntimeModuleServices(client, context);
  startSelfBotProtectionService(context);
  if (isSelfBotModuleEnabled()) {
    await ensureSelfBotRoles(client, context);
    await reconcileSelfBotPunishmentRoles(client, context);
  } else {
    await disableUnreleasedSafeBotChannels(client, context);
  }

  void syncAutomaticRolesAfterReady(client, context, reason).catch((error) => {
    console.warn("[roles] falha na sincronização pós-redeploy:", error instanceof Error ? error.message : error);
  });
}

async function startRuntimeModuleServices(client: Client<true>, context: BotContext) {
  startRuntimeService("logs", isBotModuleEnabled("logs"), () => startAutomatedLogService(client, context));
  startRuntimeService("live", isBotModuleEnabled("live"), () => {
    startLiveDetectionService(client, context);
    startSocialNotificationMonitor(client, context.api);
  });
  startRuntimeService("kick-integration", isBotModuleEnabled("live") || isBotModuleEnabled("kick-integration"), () => startKickNotificationMonitor(client, context.api));
  startRuntimeService("network", isBotModuleEnabled("network"), () => startSocialNetworkPanelSync(client, context.api, context.socket));
  startRuntimeService("x-monitor", isBotModuleEnabled("x-monitor"), () => startXMonitor(client, context.api, context.socket));
  startRuntimeService("clips", isBotModuleEnabled("clips") || isBotModuleEnabled("kick-clips"), () => startClipsMonitor(client, context.api));
  startRuntimeService("giveaway", isBotModuleEnabled("giveaway"), () => startGiveawayService(client, context.api, context.socket));
  startRuntimeService("mission-tools", isBotModuleEnabled("mission-tools"), () => startMissionToolsService(client, context));
  startRuntimeService("fivem-fac", isBotModuleEnabled("fivem-fac"), () => startFivemFacService(client, context));
  startRuntimeService("fivem-pd7", isBotModuleEnabled("fivem-factions"), () => startFivemPd7Service(client, context));
  startRuntimeService("fivem-goals", isBotModuleEnabled("fivem-goals"), () => startFivemGoalService(client, context));
  startRuntimeService("ztk-webhook", isBotModuleEnabled("ztk-webhook"), () => startZtkWebhookService(client, context));
  startRuntimeService("fivem-finance", isBotModuleEnabled("fivem-finance"), () => startFivemFinanceService(client, context));
  startRuntimeService("fivem-orders", isBotModuleEnabled("fivem-orders") || isBotModuleEnabled("fivem-drugs") || isBotModuleEnabled("fivem-washing"), () => startFivemOrderService(client, context));
  startRuntimeService("manual-payments", isBotModuleEnabled("manual-payments"), () => startManualPaymentService(client, context));
  startRuntimeService("price-tables", isBotModuleEnabled("price-tables"), () => startPriceTableService(client, context));
  startRuntimeService("nex-tech-sales", isBotModuleEnabled("nex-tech-sales") || isBotModuleEnabled("subscription-presence"), () => startNexTechSalesDeliveryService(client, context));
  startRuntimeService("sales-tickets", isBotModuleEnabled("nex-tech-sales"), () => startSalesTicketService(client, context));
  startRuntimeService("emoji-cloner", isBotModuleEnabled("emoji-cloner"), () => startApplicationEmojiAutoSync(client, context));
  startRuntimeService("rh-admin", isBotModuleEnabled("rh-admin"), () => startRhAdminService(client, context));
  startRuntimeService("courses", isBotModuleEnabled("courses"), () => startCourseSystemService(client, context));
  startRuntimeService("tickets", isBotModuleEnabled("tickets"), () => startTicketPanelService(client, context));
  startRuntimeService("report-system", isReportSystemModuleEnabled(), () => startReportSystemService(client, context));
  startRuntimeService("fivem-hierarchy", isBotModuleEnabled("fivem-hierarchy"), () => startFivemHierarchyService(client, context));
  startRuntimeService("fivem-actions", isBotModuleEnabled("fivem-actions") || isBotModuleEnabled("police-actions"), () => startFivemActionService(client, context));
  startRuntimeService("faction-chest", isBotModuleEnabled("faction-chest"), () => startFactionChestService(client, context));
  startRuntimeService("police-patrol-reports", isBotModuleEnabled("police-patrol-reports"), () => startPolicePatrolReportService(client, context));
  startRuntimeService("police-promotions", isBotModuleEnabled("police-promotions"), () => startPolicePromotionService(client, context));
  startRuntimeService("manual-registration", isBotModuleEnabled("manual-registration"), () => startManualRegistrationService(client, context));
  startRuntimeService("image-anti-spam", isBotModuleEnabled("image-anti-spam") && !isSelfBotModuleEnabled(), () => startImageAntiSpamService(context));
  await startRuntimeService("voice-recorder", isBotModuleEnabled("voice-recorder"), async () => {
    const { startVoiceRecorderService } = await import("../services/voiceRecorderService.js");
    await startVoiceRecorderService(context);
  });
  startRuntimeService("auto-activity-clock", isBotModuleEnabled("auto-activity-clock"), () => startAutoActivityClockService(client, context));
  startRuntimeService("temporary-voice", isBotModuleEnabled("temporary-voice"), () => startTemporaryVoiceService(client, context));
  await startRuntimeService("tag-verification", isBotModuleEnabled("tag-verification"), () => startTagVerificationService(client, context));
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
  const wasMissionToolsEnabled = isBotModuleEnabled("mission-tools");
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
  return isBotModuleEnabled("police-iab") || isBotModuleEnabled("police-subpoenas") || isBotModuleEnabled("tickets");
}

function runtimeModuleSignature(active: boolean, botId: string | null | undefined, moduleIds: string[]) {
  return [
    active ? "active" : "inactive",
    botId ?? "",
    [...new Set(moduleIds.map((moduleId) => moduleId.trim()).filter(Boolean))].sort().join(",")
  ].join("|");
}
