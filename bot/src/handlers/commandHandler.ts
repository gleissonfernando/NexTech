import { REST, Routes } from "discord.js";
import { env } from "../config/env";
import type { BotCommand } from "../types";

type RegisteredDiscordCommand = {
  id: string;
  name: string;
};

export async function registerGuildCommands(commands: BotCommand[], clientId: string, guildId: string) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN não configurado.");
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
  const route = Routes.applicationGuildCommands(clientId, guildId);
  const desiredNames = new Set(commands.map((command) => command.data.name));

  await deleteStaleCommands(rest, route, desiredNames);

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

  await deleteStaleCommands(rest, route, new Set());

  await rest.put(route, {
    body: []
  });
}

async function deleteStaleCommands(rest: REST, route: `/${string}`, desiredNames: Set<string>) {
  const current = await rest.get(route).catch(() => []) as RegisteredDiscordCommand[];
  const stale = current.filter((command) => !desiredNames.has(command.name));

  for (const command of stale) {
    await rest.delete(`${route}/${command.id}` as `/${string}`).catch(() => null);
  }
}
