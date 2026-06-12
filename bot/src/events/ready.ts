import type { Client } from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import { registerGuildCommands } from "../handlers/commandHandler";
import { startClipsMonitor } from "../services/clipsMonitor";
import { startFivemFacService } from "../services/fivemFacService";
import { startGiveawayService } from "../services/giveawayService";
import { startImageAntiSpamService } from "../services/imageAntiSpamService";
import { startKickNotificationMonitor } from "../services/kickNotificationMonitor";
import { startSocialNetworkPanelSync } from "../services/socialNetworkPanelService";
import { startSocialNotificationMonitor } from "../services/socialNotificationMonitor";
import { startXMonitor } from "../services/xMonitor";
import type { BotContext } from "../types";

export async function handleReady(client: Client<true>, context: BotContext) {
  console.log(`[bot] conectado como ${client.user.tag}`);
  context.api.setDiscordClientId(client.user.id);

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
  if (isBotModuleEnabled("fivem-fac")) {
    startFivemFacService(client, context);
  }
  if (isBotModuleEnabled("image-anti-spam")) {
    startImageAntiSpamService(context);
  }
  context.socket.connect(client);
  context.socket.emitStatus(client, true);

  const interval = setInterval(() => {
    context.socket.emitStatus(client, true);
  }, 30_000);

  interval.unref();
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
