import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { publishConfiguredMissionToolsPanel } from "../services/missionToolsService";
import type { BotCommand } from "../types";

export const missionPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mission-panel")
    .setDescription("Publish or update the Mission Tools Control Center.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  moduleId: "mission-tools",
  async execute(interaction, context) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Use this command inside a server.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const settings = await publishConfiguredMissionToolsPanel(context.client, context, interaction.guildId);
      await interaction.editReply({
        content: settings.panelMessageId
          ? `Control Center published or updated in the configured channel. Message: ${settings.panelMessageId}.`
          : "Control Center published or updated."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Control Center could not be published.";
      await interaction.editReply({
        content: `${message} Enable Mission Tools and configure its panel channel in the dashboard.`
      });
    }
  }
};
