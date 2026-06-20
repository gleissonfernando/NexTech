import type { ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types";

export async function requireModerationLogDestination(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    return null;
  }

  const settings = await context.api.getSettings(interaction.guild.id, context.client.user?.id).catch(() => null);

  if (
    settings?.discordLogsEnabled
    && settings.logChannelId
    && settings.discordLogCategories.includes("moderation")
  ) {
    return settings.logChannelId;
  }

  const content = "Configure um canal em Dashboard > Logs: ative Logs no Discord, selecione o Canal de logs e marque Moderacao e seguranca.";

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }

  return null;
}
