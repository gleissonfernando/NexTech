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
import { startFivemFacService } from "../services/fivemFacService";
import { startGiveawayService } from "../services/giveawayService";
import { startGuildSettingsCache } from "../services/guildSettingsCache";
import { startImageAntiSpamService } from "../services/imageAntiSpamService";
import { startKickNotificationMonitor } from "../services/kickNotificationMonitor";
import { startMaintenanceService } from "../services/maintenanceService";
import { startMissionToolsService } from "../services/missionToolsService";
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
import { startTemporaryVoiceService } from "../services/temporaryVoiceService";
import { startAutomatedLogService } from "../services/automatedLogService";
import { startTagVerificationService, stopTagVerificationService } from "../services/tagVerificationService";
import { startXMonitor } from "../services/xMonitor";
import type { BotContext } from "../types";

let lastRuntimeModuleSignature = "";

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
  context.socket.onDevModuleUpdated((payload) => {
    if (!runtimeBotId || payload.botId !== runtimeBotId) {
      return;
    }

    const wasSelfBotEnabled = isSelfBotModuleEnabled();
    const wasMissionToolsEnabled = isBotModuleEnabled("mission-tools");
    const wasTemporaryVoiceEnabled = isBotModuleEnabled("temporary-voice");
    const wereLogsEnabled = isBotModuleEnabled("logs");
    const wasTagVerificationEnabled = isBotModuleEnabled("tag-verification");
    setRuntimeEnabledModules(payload.enabledModules);
    lastRuntimeModuleSignature = runtimeModuleSignature(true, runtimeBotId, payload.enabledModules);
    clearRuntimeModuleAuthorization();

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
    if (!wereLogsEnabled && isBotModuleEnabled("logs")) startAutomatedLogService(client, context);
    if (!wasTagVerificationEnabled && isBotModuleEnabled("tag-verification")) void startTagVerificationService(client, context);
    if (wasTagVerificationEnabled && !isBotModuleEnabled("tag-verification")) stopTagVerificationService();
  });
  context.socket.onSelfBotEnsureSetup((payload) => {
    if (payload.botId && runtimeBotId && payload.botId !== runtimeBotId) {
      return;
    }

    if (!isSelfBotModuleEnabled()) {
      return;
    }

    if (payload.guildId) {
      const guild = client.guilds.cache.get(payload.guildId);

      if (guild) {
        void ensureSafeBotSetup(guild, context);
      }
      return;
    }

    void ensureSelfBotRoles(client, context);
  });
  startGuildSettingsCache(context);
  context.socket.onSettingsUpdated((settings) => {
    void handleSafeBotSettingsUpdated(settings, client, context);
  });
  startDiscordLogDelivery(context);
  if (isBotModuleEnabled("logs")) startAutomatedLogService(client, context);
  startMaintenanceService(context);

  const commandGuildIds = commandRegistrationGuildIds(client);
  const commands = [...context.commands.values()];
  const commandNames = commands.map((command) => command.data.name).join(", ");

  for (const commandGuildId of commandGuildIds) {
    try {
      await registerGuildCommands(commands, client.user.id, commandGuildId);
      console.log(`[bot] comandos sincronizados no servidor ${commandGuildId}: ${commandNames}`);
    } catch (error) {
      console.warn(`[bot] falha ao sincronizar comandos no servidor ${commandGuildId}:`, error instanceof Error ? error.message : error);
    }
  }

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

  const interval = setInterval(() => {
    context.socket.emitStatus(client, true);
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
  const wasTagVerificationEnabled = isBotModuleEnabled("tag-verification");
  const runtimeModules = runtimeAccess.active ? runtimeAccess.enabledModules : [];
  const nextSignature = runtimeModuleSignature(runtimeAccess.active, runtimeAccess.botId, runtimeModules);

  if (nextSignature === lastRuntimeModuleSignature) {
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
  if (!wasTagVerificationEnabled && isBotModuleEnabled("tag-verification")) {
    await startTagVerificationService(client, context);
  }
  if (wasTagVerificationEnabled && !isBotModuleEnabled("tag-verification")) {
    stopTagVerificationService();
  }
}

function runtimeModuleSignature(active: boolean, botId: string | null | undefined, moduleIds: string[]) {
  return [
    active ? "active" : "inactive",
    botId ?? "",
    [...new Set(moduleIds.map((moduleId) => moduleId.trim()).filter(Boolean))].sort().join(",")
  ].join("|");
}
