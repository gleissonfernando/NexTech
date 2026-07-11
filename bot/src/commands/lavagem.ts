import { SlashCommandBuilder } from "discord.js";
import { showFivemLaundryConfig } from "../services/fivemOrderService";
import type { BotCommand } from "../types";

export const lavagemCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("lavagem")
    .setDescription("Sistema de lavagem.")
    .addSubcommand((cmd) => cmd.setName("config").setDescription("Abre o painel privado de configuracao da lavagem.")),
  moduleId: "fivem-washing",
  async execute(interaction, context) {
    if (interaction.options.getSubcommand() === "config") {
      await showFivemLaundryConfig(interaction, context);
    }
  }
};
