import type { Client } from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import { registerGuildCommands } from "../handlers/commandHandler";
import { startClipsMonitor } from "../services/clipsMonitor";
import { startSocialNetworkPanelSync } from "../services/socialNetworkPanelService";
import { startSocialNotificationMonitor } from "../services/socialNotificationMonitor";
import { startXMonitor } from "../services/xMonitor";
import type { BotCommand, BotContext } from "../types";

export async function handleReady(client: Client<true>, context: BotContext) {
  console.log(`[bot] conectado como ${client.user.tag}`);
  context.api.setDiscordClientId(client.user.id);

  const commandGuildId = primaryCommandGuildId();

  if (commandGuildId) {
    try {
      await registerGuildCommands(commandsEnabledForBot([...context.commands.values()]), client.user.id, commandGuildId);
      console.log(`[bot] comandos sincronizados no servidor ${commandGuildId}`);
    } catch (error) {
      console.warn("[bot] falha ao sincronizar comandos:", error instanceof Error ? error.message : error);
    }
  }

  context.socket.connect(client);
  context.socket.emitStatus(client, true);
  if (isBotModuleEnabled("live")) {
    startSocialNotificationMonitor(client, context.api);
  }
  if (isBotModuleEnabled("network")) {
    startSocialNetworkPanelSync(client, context.api, context.socket);
  }
  if (isBotModuleEnabled("x-monitor")) {
    startXMonitor(client, context.api, context.socket);
  }
  if (isBotModuleEnabled("clips")) {
    startClipsMonitor(client, context.api);
  }

  const interval = setInterval(() => {
    context.socket.emitStatus(client, true);
  }, 30_000);

  interval.unref();
}

function primaryCommandGuildId() {
  return env.BOT_MAIN_GUILD_ID.trim() || env.DASHBOARD_GUILD_IDS.split(",").map((guildId) => guildId.trim()).find(Boolean) || "";
}

function commandsEnabledForBot(commands: BotCommand[]) {
  return commands.filter((command) => !command.moduleId || isBotModuleEnabled(command.moduleId));
}
