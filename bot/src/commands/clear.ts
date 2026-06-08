import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";

type BulkDeletableChannel = {
  bulkDelete: (messages: ClearableMessage[], filterOld?: boolean) => Promise<{ size: number }>;
  id: string;
  messages: {
    fetch: (options: { limit: number }) => Promise<Map<string, ClearableMessage>>;
  };
  name?: string;
};

type ClearableMessage = {
  createdTimestamp: number;
  delete: () => Promise<unknown>;
  id: string;
};

const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

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
  moduleId: "moderation",
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

    const result = await deleteChannelMessages(channel, amount).catch((error) => {
      console.warn("[clear] falha ao apagar mensagens:", error instanceof Error ? error.message : error);
      return null;
    });

    if (!result) {
      await interaction.editReply({
        content: "Nao consegui buscar ou apagar mensagens neste canal. Confira se tenho Gerenciar Mensagens, Ver Canal e Ler Historico de Mensagens."
      });
      return;
    }

    await context.api.postLog({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      type: "moderation.clear",
      message: `${interaction.user.tag} apagou ${result.deleted} mensagens em #${"name" in channel ? channel.name : "canal"}.`,
      metadata: {
        amount,
        deleted: result.deleted,
        failed: result.failed,
        channelId: channel.id
      }
    }).catch(() => undefined);

    try {
      context.socket.emitLog({
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        type: "moderation.clear",
        message: `${result.deleted} mensagens apagadas.`,
        metadata: {
          amount,
          deleted: result.deleted,
          failed: result.failed,
          channelId: channel.id
        }
      });
    } catch {
      // A limpeza ja foi executada; falha no realtime nao deve falhar o comando.
    }

    await interaction.editReply({
      content: clearResultMessage(result)
    });
  }
};

async function deleteChannelMessages(channel: BulkDeletableChannel, amount: number) {
  const fetched = await channel.messages.fetch({
    limit: amount
  });
  const messages = [...fetched.values()].filter(isClearableMessage);
  const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
  const recentMessages = messages.filter((message) => message.createdTimestamp > cutoff);
  const oldMessages = messages.filter((message) => message.createdTimestamp <= cutoff);
  let deleted = 0;
  let failed = 0;

  if (recentMessages.length > 1) {
    try {
      const deletedMessages = await channel.bulkDelete(recentMessages, true);
      deleted += deletedMessages.size;
      failed += recentMessages.length - deletedMessages.size;
    } catch {
      const fallback = await deleteOneByOne(recentMessages);
      deleted += fallback.deleted;
      failed += fallback.failed;
    }
  } else if (recentMessages.length === 1) {
    const fallback = await deleteOneByOne(recentMessages);
    deleted += fallback.deleted;
    failed += fallback.failed;
  }

  if (oldMessages.length) {
    const oldResult = await deleteOneByOne(oldMessages);
    deleted += oldResult.deleted;
    failed += oldResult.failed;
  }

  return {
    deleted,
    failed,
    requested: amount,
    scanned: messages.length
  };
}

async function deleteOneByOne(messages: ClearableMessage[]) {
  let deleted = 0;
  let failed = 0;

  for (const message of messages) {
    try {
      await message.delete();
      deleted += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    deleted,
    failed
  };
}

function clearResultMessage(result: Awaited<ReturnType<typeof deleteChannelMessages>>) {
  if (result.deleted > 0) {
    return result.failed > 0
      ? `${result.deleted} mensagens apagadas. ${result.failed} mensagem(ns) nao puderam ser apagadas.`
      : `${result.deleted} mensagens apagadas.`;
  }

  if (result.scanned === 0) {
    return "Nao encontrei mensagens recentes para apagar neste canal.";
  }

  return "Nao consegui apagar as mensagens encontradas. Confira se tenho permissao Gerenciar Mensagens e acesso ao historico do canal.";
}

function isBulkDeletableChannel(channel: unknown): channel is BulkDeletableChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const candidate = channel as {
    bulkDelete?: unknown;
    id?: unknown;
    messages?: {
      fetch?: unknown;
    };
    type?: ChannelType;
  };

  return (
    typeof candidate.id === "string"
    && (
      candidate.type === ChannelType.GuildText
      || candidate.type === ChannelType.GuildAnnouncement
      || candidate.type === ChannelType.PublicThread
      || candidate.type === ChannelType.PrivateThread
    )
    && typeof candidate.bulkDelete === "function"
    && typeof candidate.messages?.fetch === "function"
  );
}

function isClearableMessage(message: unknown): message is ClearableMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as Partial<ClearableMessage>;

  return (
    typeof candidate.id === "string"
    && typeof candidate.createdTimestamp === "number"
    && typeof candidate.delete === "function"
  );
}
