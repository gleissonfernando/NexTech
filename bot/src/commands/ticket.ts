import { SlashCommandBuilder } from "discord.js";
import { openTicketFromCommand, publishTicketPanel } from "../services/ticketPanelService";
import type { BotCommand } from "../types";

export const ticketCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Cria um ticket de atendimento.")
    .addBooleanOption((option) => option.setName("painel").setDescription("Publica o painel visual de tickets neste canal.").setRequired(false))
    .addStringOption((option) => option.setName("assunto").setDescription("Assunto do atendimento.").setRequired(false)),
  moduleId: "tickets",
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Comando disponível apenas em servidores.",
        ephemeral: true
      });
      return;
    }

    if (interaction.options.getBoolean("painel") === true) {
      await publishTicketPanel(interaction, context);
      return;
    }

    const subject = interaction.options.getString("assunto") ?? "Atendimento";
    await openTicketFromCommand(interaction, context, subject);
  }
};
