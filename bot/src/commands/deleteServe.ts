import { PermissionFlagsBits, SlashCommandBuilder, type GuildBasedChannel, type Role } from "discord.js";
import type { BotCommand } from "../types";

const CONFIRMATION_TEXT = "APAGAR TUDO";

export const deleteServeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("delete-serve")
    .setDescription("Apaga canais e cargos editaveis do servidor com confirmacao do dono.")
    .addStringOption((option) => option
      .setName("confirmar")
      .setDescription(`Digite exatamente: ${CONFIRMATION_TEXT}`)
      .setRequired(true)),
  moduleId: "server-generator",
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: "Esse comando so pode ser usado dentro de um servidor.",
        ephemeral: true
      });
      return;
    }

    if (interaction.user.id !== interaction.guild.ownerId) {
      await interaction.reply({
        content: "Somente o dono do servidor pode usar este comando.",
        ephemeral: true
      });
      return;
    }

    const confirmation = interaction.options.getString("confirmar", true).trim();
    if (confirmation !== CONFIRMATION_TEXT) {
      await interaction.reply({
        content: `Confirmacao invalida. Para apagar, use /delete-serve confirmar:${CONFIRMATION_TEXT}`,
        ephemeral: true
      });
      return;
    }

    const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: "O bot precisa das permissoes Gerenciar Canais e Gerenciar Cargos.",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: "Confirmado. Limpando canais e cargos editaveis do servidor...",
      ephemeral: true
    });

    const result = await deleteEditableServerStructure(interaction.guild);

    await interaction.editReply([
      "Limpeza finalizada.",
      `Canais apagados: ${result.deletedChannels}`,
      `Cargos apagados: ${result.deletedRoles}`,
      result.failed ? `Itens ignorados/falharam: ${result.failed}` : null
    ].filter(Boolean).join("\n"));
  }
};

async function deleteEditableServerStructure(guild: NonNullable<Parameters<BotCommand["execute"]>[0]["guild"]>) {
  const result = {
    deletedChannels: 0,
    deletedRoles: 0,
    failed: 0
  };

  await guild.channels.fetch().catch(() => null);
  const channels = [...guild.channels.cache.values()]
    .filter((channel): channel is GuildBasedChannel => Boolean(channel))
    .sort((left, right) => {
      const leftIsCategory = left.type === 4 ? 1 : 0;
      const rightIsCategory = right.type === 4 ? 1 : 0;
      return leftIsCategory - rightIsCategory;
    });

  for (const channel of channels) {
    try {
      await channel.delete("delete-serve confirmado pelo dono do servidor");
      result.deletedChannels += 1;
      await wait(350);
    } catch {
      result.failed += 1;
    }
  }

  await guild.roles.fetch().catch(() => null);
  const roles = [...guild.roles.cache.values()]
    .filter((role): role is Role => role.id !== guild.id && !role.managed)
    .sort((left, right) => right.position - left.position);

  for (const role of roles) {
    if (!role.editable) {
      result.failed += 1;
      continue;
    }

    try {
      await role.delete("delete-serve confirmado pelo dono do servidor");
      result.deletedRoles += 1;
      await wait(350);
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
