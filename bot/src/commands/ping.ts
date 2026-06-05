import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Mostra a latencia do bot."),
  async execute(interaction, context) {
    await interaction.reply({
      content: `Pong: ${Math.round(context.client.ws.ping)}ms`,
      ephemeral: true
    });
  }
};
