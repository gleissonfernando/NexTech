import { SlashCommandBuilder } from "discord.js";
import { openTicketFromCommand } from "../services/ticketPanelService";
import type { BotCommand } from "../types";

export const ticketCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Abre o formulário de atendimento."),
  moduleId: "tickets",
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Comando disponível apenas em servidores.",
        ephemeral: true
      });
      return;
    }

    await openTicketFromCommand(interaction, context);
  }
};
