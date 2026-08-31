import { REST, Routes } from "discord.js";
import { env } from "../config/env";
import type { BotCommand } from "../types";

export async function registerGuildCommands(commands: BotCommand[], clientId: string, guildId: string) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN não configurado.");
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
  const route = Routes.applicationGuildCommands(clientId, guildId);

  await rest.put(route, {
    body: commands.map((command) => command.data.toJSON())
  });
}

export async function clearGlobalCommands(clientId: string) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN não configurado.");
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
  const route = Routes.applicationCommands(clientId);

  await rest.put(route, {
    body: []
  });
}
