import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";

export const banCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bane um usuario do servidor.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario que sera banido.").setRequired(true))
    .addStringOption((option) => option.setName("motivo").setDescription("Motivo do banimento.").setRequired(false)),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Comando disponivel apenas em servidores.",
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getUser("usuario", true);
    const reason = interaction.options.getString("motivo") ?? "Sem motivo informado";

    await interaction.guild.members.ban(user, {
      reason
    });

    await context.api.postLog({
      guildId: interaction.guild.id,
      userId: user.id,
      type: "moderation.ban",
      message: `${user.tag} foi banido por ${interaction.user.tag}.`,
      metadata: {
        reason
      }
    });

    context.socket.emitLog({
      guildId: interaction.guild.id,
      userId: user.id,
      type: "moderation.ban",
      message: `${user.tag} foi banido.`,
      metadata: {
        reason
      }
    });

    await interaction.reply({
      content: `${user.tag} banido.`,
      ephemeral: true
    });
  }
};
