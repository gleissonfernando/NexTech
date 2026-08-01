import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { showSetConfigPanel } from "../services/manualRegistrationService";
import type { BotCommand } from "../types";

export const setCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("painel7")
    .setDescription("Abre o painel administrativo do sistema de PD7/Set.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: "manual-registration",
  async execute(interaction, context) {
    if (!interaction.guild) return void await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
    await showSetConfigPanel(interaction, context);
  }
};
