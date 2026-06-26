import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { publishConfiguredMissionToolsPanel } from "../services/missionToolsService";
import type { BotCommand } from "../types";

export const missionPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mission-panel")
    .setDescription("Publica ou atualiza o Control Center do Mission Tools.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  moduleId: "mission-tools",
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Use este comando dentro de um servidor.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const settings = await publishConfiguredMissionToolsPanel(context.client, context, interaction.guildId);
      await interaction.editReply({
        content: settings.panelMessageId
          ? `Control Center publicado/atualizado no canal configurado. Mensagem: ${settings.panelMessageId}.`
          : "Control Center publicado/atualizado."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível publicar o Control Center.";
      await interaction.editReply({
        content: `${message} Ative o Mission Tools e configure o canal do painel na dashboard.`
      });
    }
  }
};
