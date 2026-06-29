import type { ButtonInteraction, GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";

const RULES_ACCEPT_BUTTON_ID = "rules_accept";

export async function handleRulesInteraction(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId !== RULES_ACCEPT_BUTTON_ID) {
    return false;
  }

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "Esse painel de regras so funciona dentro do servidor.",
      ephemeral: true
    });
    return true;
  }

  if (!isBotModuleEnabled("rules")) {
    await interaction.reply({
      content: "O sistema de regras nao foi liberado para este bot na dashboard DEV.",
      ephemeral: true
    });
    return true;
  }

  const settings = await context.api.getSettings(interaction.guildId, interaction.client.user?.id);

  if (!settings.rulesEnabled) {
    await interaction.reply({
      content: "O sistema de regras esta desativado neste servidor.",
      ephemeral: true
    });
    return true;
  }

  if (!settings.rulesRoleId) {
    await interaction.reply({
      content: "Regras aceitas.",
      ephemeral: true
    });
    return true;
  }

  const member = await resolveGuildMember(interaction);

  if (!member) {
    await interaction.reply({
      content: "Nao consegui localizar seu membro neste servidor.",
      ephemeral: true
    });
    return true;
  }

  if (member.roles.cache.has(settings.rulesRoleId)) {
    await interaction.reply({
      content: "Voce ja aceitou as regras.",
      ephemeral: true
    });
    return true;
  }

  try {
    await member.roles.add(settings.rulesRoleId, "Aceitou as regras pelo painel do bot.");
    await context.api.postLog({
      guildId: interaction.guildId,
      userId: member.id,
      type: "verification.discord",
      message: `${member.user.tag} was verified successfully through the rules panel.`,
      metadata: { method: "Rules panel", status: "Verified", releasedBy: "Automatic", guildName: interaction.guild.name, roleId: settings.rulesRoleId }
    }).catch(() => null);
    await interaction.reply({
      content: "Regras aceitas. Cargo liberado com sucesso.",
      ephemeral: true
    });
  } catch (error) {
    console.warn("[rules] nao foi possivel adicionar cargo de regras:", error instanceof Error ? error.message : error);
    await interaction.reply({
      content: "Nao consegui liberar o cargo. Confira se o cargo do bot esta acima do cargo configurado.",
      ephemeral: true
    });
  }

  return true;
}

async function resolveGuildMember(interaction: ButtonInteraction) {
  if (interaction.member && "roles" in interaction.member) {
    return interaction.member as GuildMember;
  }

  return interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
}
