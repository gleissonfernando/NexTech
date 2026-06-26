import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotCommand, BotContext } from "../types";
import { requireModerationLogDestination } from "../services/moderationLogGuard";

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
const CLEAR_COMMAND_NAME = "clear";

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

    await interaction.deferReply({
      ephemeral: true
    });

    const authorization = await authorizeClearCommand(interaction, context);

    if (!authorization.allowed) {
      await interaction.editReply({
        content: `O /clear esta bloqueado neste servidor: ${authorization.reason}`
      });
      return;
    }

    const logDestination = await requireModerationLogDestination(interaction, context);

    if (!logDestination) {
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await logClearDiagnostic(context, interaction, "moderation.clear.permission_denied", "Usuário sem permissão Gerenciar Mensagens tentou usar /clear.", {
        reasonCode: "user_missing_manage_messages"
      });
      await interaction.editReply({
        content: "Você precisa da permissão Gerenciar Mensagens para usar este comando."
      });
      return;
    }

    const channel = interaction.channel;
    const amount = interaction.options.getInteger("quantidade", true);

    if (!isBulkDeletableChannel(channel)) {
      await logClearDiagnostic(context, interaction, "moderation.clear.channel_denied", "Canal não suporta limpeza em massa para /clear.", {
        reasonCode: "channel_not_bulk_deletable"
      });
      await interaction.editReply({
        content: "Este canal não permite apagar mensagens em massa."
      });
      return;
    }

    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);

    if (!botMember?.permissionsIn(channel.id).has(PermissionFlagsBits.ManageMessages)) {
      await logClearDiagnostic(context, interaction, "moderation.clear.permission_denied", "Bot sem permissão Gerenciar Mensagens no canal.", {
        reasonCode: "bot_missing_manage_messages"
      });
      await interaction.editReply({
        content: "Eu preciso da permissão Gerenciar Mensagens neste canal para usar o /clear."
      });
      return;
    }

    const result = await deleteChannelMessages(channel, amount).catch((error) => {
      console.warn(
        `[clear] falha ao apagar mensagens no guild ${interaction.guild?.id} canal ${channel.id}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    });

    if (!result) {
      await logClearDiagnostic(context, interaction, "moderation.clear.failed", "Falha ao buscar ou apagar mensagens no /clear.", {
        amount,
        reasonCode: "delete_failed"
      });
      await interaction.editReply({
        content: "Não consegui buscar ou apagar mensagens neste canal. Confira se tenho Gerenciar Mensagens, Ver Canal e Ler Histórico de Mensagens."
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

    await interaction.editReply({
      content: clearResultMessage(result)
    });
  }
};

async function authorizeClearCommand(interaction: ChatInputCommandInteraction, context: BotContext) {
  try {
    const authorization = await context.api.authorizeCommand({
      channelId: interaction.channelId,
      commandName: CLEAR_COMMAND_NAME,
      guildId: interaction.guild!.id,
      userId: interaction.user.id
    });

    console.log(
      `[clear] dashboard auth guild=${interaction.guild!.id} user=${interaction.user.id} allowed=${authorization.allowed} reason=${authorization.reasonCode}`
    );

    return authorization;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(
      `[clear] falha de comunicacao com a dashboard guild=${interaction.guild!.id} user=${interaction.user.id}:`,
      message
    );
    await logClearDiagnostic(context, interaction, "moderation.clear.authorization_failed", "Falha ao validar /clear na dashboard.", {
      error: message,
      policy: "fail_closed",
      reasonCode: "dashboard_unavailable"
    });

    return {
      allowed: false,
      botId: null,
      checkedAt: new Date().toISOString(),
      commandName: CLEAR_COMMAND_NAME,
      guildId: interaction.guild!.id,
      moduleId: "moderation",
      policy: "fail_closed" as const,
      reason: "não consegui comunicar com a dashboard para validar a licença.",
      reasonCode: "dashboard_unavailable"
    };
  }
}

async function logClearDiagnostic(
  context: BotContext,
  interaction: ChatInputCommandInteraction,
  type: string,
  message: string,
  metadata: Record<string, unknown> = {}
) {
  const payload = {
    guildId: interaction.guild!.id,
    userId: interaction.user.id,
    type,
    message,
    metadata: {
      ...metadata,
      channelId: interaction.channelId,
      commandName: CLEAR_COMMAND_NAME,
      guildId: interaction.guild!.id,
      userId: interaction.user.id
    }
  };

  await context.api.postLog(payload).catch((error) => {
    console.warn("[clear] não foi possível registrar log na API:", error instanceof Error ? error.message : error);
  });

}

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
    } catch (error) {
      console.warn("[clear] bulkDelete falhou, tentando apagar uma por uma:", error instanceof Error ? error.message : error);
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
    } catch (error) {
      console.warn(`[clear] não foi possível apagar mensagem ${message.id}:`, error instanceof Error ? error.message : error);
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
      ? `${result.deleted} mensagens apagadas. ${result.failed} mensagem(ns) não puderam ser apagadas.`
      : `${result.deleted} mensagens apagadas.`;
  }

  if (result.scanned === 0) {
    return "Não encontrei mensagens recentes para apagar neste canal.";
  }

  return "Não consegui apagar as mensagens encontradas. Confira se tenho permissão Gerenciar Mensagens e acesso ao histórico do canal.";
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
