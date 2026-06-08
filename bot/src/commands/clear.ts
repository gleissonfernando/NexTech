import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";

type BulkDeletableChannel = {
  bulkDelete: (limit: number, filterOld?: boolean) => Promise<{ size: number }>;
  id: string;
  name?: string;
};

export const clearCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Apaga mensagens recentes do canal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName("quantidade")
        .setDescription("Quantidade de mensagens para apagar, de 1 a 100.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Comando disponivel apenas em servidores.",
        ephemeral: true
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: "Voce precisa da permissao Gerenciar Mensagens para usar este comando.",
        ephemeral: true
      });
      return;
    }

    const channel = interaction.channel;
    const amount = interaction.options.getInteger("quantidade", true);

    if (!isBulkDeletableChannel(channel)) {
      await interaction.reply({
        content: "Este canal nao permite apagar mensagens em massa.",
        ephemeral: true
      });
      return;
    }

    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);

    if (!botMember?.permissionsIn(channel.id).has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: "Eu preciso da permissao Gerenciar Mensagens neste canal para usar o /clear.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({
      ephemeral: true
    });

    const deleted = await channel.bulkDelete(amount, true);

    await context.api.postLog({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      type: "moderation.clear",
      message: `${interaction.user.tag} apagou ${deleted.size} mensagens em #${"name" in channel ? channel.name : "canal"}.`,
      metadata: {
        amount,
        deleted: deleted.size,
        channelId: channel.id
      }
    });

    context.socket.emitLog({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      type: "moderation.clear",
      message: `${deleted.size} mensagens apagadas.`,
      metadata: {
        amount,
        deleted: deleted.size,
        channelId: channel.id
      }
    });

    await interaction.editReply({
      content: `${deleted.size} mensagens apagadas. Mensagens com mais de 14 dias sao ignoradas pelo Discord.`
    });
  }
};

function isBulkDeletableChannel(channel: unknown): channel is BulkDeletableChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const candidate = channel as { bulkDelete?: unknown; id?: unknown; type?: ChannelType };

  return (
    typeof candidate.id === "string"
    && (
      candidate.type === ChannelType.GuildText
      || candidate.type === ChannelType.GuildAnnouncement
      || candidate.type === ChannelType.PublicThread
      || candidate.type === ChannelType.PrivateThread
    )
    && typeof candidate.bulkDelete === "function"
  );
}
