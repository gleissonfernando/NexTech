import { REST, Routes } from "discord.js";
import { env } from "../config/env";
import type { BotCommand } from "../types";

export async function registerGuildCommands(commands: BotCommand[], clientId: string, guildId: string) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado.");
  }

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((command) => command.data.toJSON())
  });
}
