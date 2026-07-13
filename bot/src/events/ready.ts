import type { Client } from "discord.js";
import {
  configuredBotModules,
  env,
  isBotModuleEnabled,
  setRuntimeEnabledModules
} from "../config/env";
import { registerGuildCommands } from "../handlers/commandHandler";
import { startClipsMonitor } from "../services/clipsMonitor";
import { startDiscordLogDelivery } from "../services/discordLogDeliveryService";
import { startDatabaseMaintenanceService } from "../services/databaseMaintenanceService";
import { startFivemFacService } from "../services/fivemFacService";
import { startFivemGoalService } from "../services/fivemGoalService";
import { startFivemFinanceService } from "../services/fivemFinanceService";
import { startFivemOrderService } from "../services/fivemOrderService";
import { startFivemHierarchyService } from "../services/fivemHierarchyService";
import { startFivemActionService } from "../services/fivemActionService";
import { startFivemPd7Service } from "../services/fivemPd7Service";
import { startPolicePatrolReportService } from "../services/policePatrolReportService";
import { clearPoliceHiddenChannelSettingsCache } from "../services/policeHiddenChannelService";
import { clearDmBarConfigCache } from "../services/dmBarService";
import { startGiveawayService } from "../services/giveawayService";
import { startGuildSettingsCache } from "../services/guildSettingsCache";
import { startImageAntiSpamService } from "../services/imageAntiSpamService";
import { startKickNotificationMonitor } from "../services/kickNotificationMonitor";
import { startMaintenanceService } from "../services/maintenanceService";
import { startMissionToolsService } from "../services/missionToolsService";
import { startNexTechSalesDeliveryService } from "../services/nexTechSalesDeliveryService";
import { startManualPaymentService } from "../services/manualPaymentService";
import { startPriceTableService } from "../services/priceTableService";
import { startManualRegistrationService } from "../services/manualRegistrationService";
import { startRhAdminService } from "../services/rhAdminService";
import { startCourseSystemService } from "../services/courseSystemService";
import { startTicketPanelService } from "../services/ticketPanelService";
import { startReportSystemService } from "../services/reportSystemService";
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
import { startTagVerificationService, stopTagVerificationService } from "../services/tagVerificationService";
import { startXMonitor } from "../services/xMonitor";
import type { BotCommand, BotContext } from "../types";

let lastRuntimeModuleSignature = "";
let lastRuntimeStatusWarningAt = 0;
let commandSyncPromise: Promise<void> | null = null;

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
    const wasMissionToolsEnabled = isBotModuleEnabled("mission-tools");
    const wasTemporaryVoiceEnabled = isBotModuleEnabled("temporary-voice");
    const wereLogsEnabled = isBotModuleEnabled("logs");
    const wasFivemHierarchyEnabled = isBotModuleEnabled("fivem-hierarchy");
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

    if (!wasMissionToolsEnabled && isBotModuleEnabled("mission-tools")) {
      startMissionToolsService(client, context);
    }
    if (!wasTemporaryVoiceEnabled && isBotModuleEnabled("temporary-voice")) startTemporaryVoiceService(client, context);
    if (isBotModuleEnabled("manual-payments")) startManualPaymentService(client, context);
    if (isBotModuleEnabled("price-tables")) startPriceTableService(client, context);
    if (isBotModuleEnabled("nex-tech-sales")) startNexTechSalesDeliveryService(client, context);
    if (isBotModuleEnabled("rh-admin")) startRhAdminService(client, context);
    if (isBotModuleEnabled("courses")) startCourseSystemService(client, context);
    if (isBotModuleEnabled("tickets")) startTicketPanelService(client, context);
    if (isReportSystemModuleEnabled()) startReportSystemService(client, context);
    if (!wasFivemHierarchyEnabled && isBotModuleEnabled("fivem-hierarchy")) startFivemHierarchyService(client, context);
    if (!wereLogsEnabled && isBotModuleEnabled("logs")) startAutomatedLogService(client, context);
    if (!wasTagVerificationEnabled && isBotModuleEnabled("tag-verification")) void startTagVerificationService(client, context);
    if (wasTagVerificationEnabled && !isBotModuleEnabled("tag-verification")) stopTagVerificationService();
  });
  context.socket.onSelfBotEnsureSetup(async (payload, acknowledge) => {
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) {
      acknowledge?.({ error: "Evento destinado a outro bot.", ok: false });
      return;
    }

    if (!isSelfBotModuleEnabled()) {
      acknowledge?.({ error: "O modulo SafeBot nao esta ativo neste bot.", ok: false });
      return;
    }

    try {
      if (payload.guildId) {
        const guild = client.guilds.cache.get(payload.guildId);
        if (!guild) {
          acknowledge?.({ error: "O bot nao esta conectado ao servidor selecionado.", ok: false });
          return;
        }
        const setup = await ensureSafeBotSetup(guild, context);
        acknowledge?.(setup
          ? { ok: true }
          : { error: "Nao foi possivel criar os canais. Verifique Gerenciar Canais e Gerenciar Cargos.", ok: false });
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
  context.socket.onDmBarSettingsUpdated((payload) => {
    if (!runtimeBotId || !payload.botId || payload.botId === runtimeBotId) {
      clearDmBarConfigCache(payload.guildId);
      void syncVisibleGuildCommands(client, context, "dm_bar_settings_update");
    }
  });
  startDiscordLogDelivery(context);
  startDatabaseMaintenanceService(client, context);
  if (isBotModuleEnabled("logs")) startAutomatedLogService(client, context);
  startMaintenanceService(context);

  await syncVisibleGuildCommands(client, context, "ready");

  if (isBotModuleEnabled("live")) {
    startSocialNotificationMonitor(client, context.api);
  }
  if (isBotModuleEnabled("live") || isBotModuleEnabled("kick-integration")) {
    startKickNotificationMonitor(client, context.api);
  }
  if (isBotModuleEnabled("network")) {
    startSocialNetworkPanelSync(client, context.api, context.socket);
  }
  if (isBotModuleEnabled("x-monitor")) {
    startXMonitor(client, context.api, context.socket);
  }
  if (isBotModuleEnabled("clips") || isBotModuleEnabled("kick-clips")) {
    startClipsMonitor(client, context.api);
  }
  if (isBotModuleEnabled("giveaway")) {
    startGiveawayService(client, context.api, context.socket);
  }
  if (isBotModuleEnabled("mission-tools")) {
    startMissionToolsService(client, context);
  }
  if (isBotModuleEnabled("fivem-fac")) {
    startFivemFacService(client, context);
  }
  if (isBotModuleEnabled("fivem-factions")) startFivemPd7Service(client, context);
  if (isBotModuleEnabled("fivem-goals")) {
    startFivemGoalService(client, context);
  }
  if (isBotModuleEnabled("fivem-finance")) {
    startFivemFinanceService(client, context);
  }
  if (isBotModuleEnabled("fivem-orders") || isBotModuleEnabled("fivem-drugs") || isBotModuleEnabled("fivem-washing")) startFivemOrderService(client, context);
  if (isBotModuleEnabled("manual-payments")) startManualPaymentService(client, context);
  if (isBotModuleEnabled("price-tables")) startPriceTableService(client, context);
  if (isBotModuleEnabled("nex-tech-sales")) startNexTechSalesDeliveryService(client, context);
  if (isBotModuleEnabled("rh-admin")) startRhAdminService(client, context);
  if (isBotModuleEnabled("courses")) startCourseSystemService(client, context);
  if (isBotModuleEnabled("tickets")) startTicketPanelService(client, context);
  if (isReportSystemModuleEnabled()) startReportSystemService(client, context);
  if (isBotModuleEnabled("fivem-hierarchy")) {
    startFivemHierarchyService(client, context);
  }
  if (isBotModuleEnabled("fivem-actions") || isBotModuleEnabled("police-actions")) {
    startFivemActionService(client, context);
  }
  if (isBotModuleEnabled("police-patrol-reports")) {
    startPolicePatrolReportService(client, context);
  }
  if (isBotModuleEnabled("manual-registration")) {
    startManualRegistrationService(client, context);
  }
  if (isBotModuleEnabled("image-anti-spam") && !isSelfBotModuleEnabled()) {
    startImageAntiSpamService(context);
  }
  if (isBotModuleEnabled("voice-recorder")) {
    const { startVoiceRecorderService } = await import("../services/voiceRecorderService.js");
    await startVoiceRecorderService(context);
  }
  if (isBotModuleEnabled("temporary-voice")) {
    startTemporaryVoiceService(client, context);
  }
  if (isBotModuleEnabled("tag-verification")) {
    await startTagVerificationService(client, context);
  }
  startSelfBotProtectionService(context);
  if (isSelfBotModuleEnabled()) {
    await ensureSelfBotRoles(client, context);
    await reconcileSelfBotPunishmentRoles(client, context);
  } else {
    await disableUnreleasedSafeBotChannels(client, context);
  }
  context.socket.connect(client);
  context.socket.emitStatus(client, true);
  void reportRuntimeStatus(context, client, true);

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
  return unique([
    ...csv(env.BOT_COMMAND_GUILD_IDS),
    env.BOT_MAIN_GUILD_ID.trim(),
    ...csv(env.DASHBOARD_GUILD_IDS),
    ...client.guilds.cache.map((guild) => guild.id)
  ]);
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
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

  for (const commandGuildId of commandGuildIds) {
    try {
      await registerGuildCommands(commands, client.user.id, commandGuildId);
      console.log(`[bot] comandos sincronizados no servidor ${commandGuildId} (${reason}): ${commandNames}`);
    } catch (error) {
      console.warn(`[bot] falha ao sincronizar comandos no servidor ${commandGuildId} (${reason}):`, error instanceof Error ? error.message : error);
    }
  }
}

function visibleCommands(commands: BotCommand[]) {
  return commands.filter((command) => !command.moduleId || isBotModuleEnabled(command.moduleId));
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
      console.warn("[bot] nao foi possivel sincronizar status runtime:", error instanceof Error ? error.message : error);
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
    if (isBotModuleEnabled("fivem-hierarchy")) startFivemHierarchyService(client, context);
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

  if (!wasMissionToolsEnabled && isBotModuleEnabled("mission-tools")) {
    startMissionToolsService(client, context);
  }
  if (!wasTemporaryVoiceEnabled && isBotModuleEnabled("temporary-voice")) {
    startTemporaryVoiceService(client, context);
  }
  if (isBotModuleEnabled("manual-payments")) {
    startManualPaymentService(client, context);
  }
  if (!wasFivemHierarchyEnabled && isBotModuleEnabled("fivem-hierarchy")) {
    startFivemHierarchyService(client, context);
  }
  if (isReportSystemModuleEnabled()) {
    startReportSystemService(client, context);
  }
  if (!wasTagVerificationEnabled && isBotModuleEnabled("tag-verification")) {
    await startTagVerificationService(client, context);
  }
  if (wasTagVerificationEnabled && !isBotModuleEnabled("tag-verification")) {
    stopTagVerificationService();
  }

  await syncVisibleGuildCommands(client, context, "module_reconcile");
}

function isReportSystemModuleEnabled() {
  return isBotModuleEnabled("police-iab") || isBotModuleEnabled("tickets");
}

function runtimeModuleSignature(active: boolean, botId: string | null | undefined, moduleIds: string[]) {
  return [
    active ? "active" : "inactive",
    botId ?? "",
    [...new Set(moduleIds.map((moduleId) => moduleId.trim()).filter(Boolean))].sort().join(",")
  ].join("|");
}
