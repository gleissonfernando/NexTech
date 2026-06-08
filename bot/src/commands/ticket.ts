import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";

export const ticketCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Cria um ticket de atendimento.")
    .addStringOption((option) => option.setName("assunto").setDescription("Assunto do atendimento.").setRequired(false)),
  moduleId: "tickets",
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Comando disponivel apenas em servidores.",
        ephemeral: true
      });
      return;
    }

    const subject = interaction.options.getString("assunto") ?? "Atendimento";
    const ticket = await context.api.createTicket({
      guildId: interaction.guild.id,
      openerId: interaction.user.id,
      subject
    });

    await interaction.reply({
      content: `Ticket criado: ${ticket.ticket.id}`,
      ephemeral: true
    });
  }
};
