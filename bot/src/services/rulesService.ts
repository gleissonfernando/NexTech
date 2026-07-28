import type { ButtonInteraction, GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext, RulesPanelButton } from "../types";

const RULES_ACCEPT_BUTTON_ID = "rules_accept";
const RULES_ACTION_BUTTON_PREFIX = "rules_action:";

export async function handleRulesInteraction(interaction: ButtonInteraction, context: BotContext) {
  if (interaction.customId !== RULES_ACCEPT_BUTTON_ID && !interaction.customId.startsWith(RULES_ACTION_BUTTON_PREFIX)) {
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
      content: "O sistema de regras não foi liberado para este bot na dashboard DEV.",
      ephemeral: true
    });
    return true;
  }

  const settings = await context.api.getSettings(interaction.guildId, interaction.client.user?.id);

  if (!settings.rulesEnabled) {
    await interaction.reply({
      content: "O sistema de regras está desativado neste servidor.",
      ephemeral: true
    });
    return true;
  }

  if (interaction.customId.startsWith(RULES_ACTION_BUTTON_PREFIX)) {
    const buttonId = interaction.customId.slice(RULES_ACTION_BUTTON_PREFIX.length);
    const button = settings.rulesButtons.find((item) => item.id === buttonId && item.enabled !== false);

    if (!button) {
      await interaction.reply({
        content: "Esse botão não está mais disponível.",
        ephemeral: true
      });
      return true;
    }

    await handleRulesActionButton(interaction, button, context);
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
      content: "Não consegui localizar seu membro neste servidor.",
      ephemeral: true
    });
    return true;
  }

  if (member.roles.cache.has(settings.rulesRoleId)) {
    await interaction.reply({
      content: "Você já aceitou as regras.",
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
    console.warn("[rules] não foi possível adicionar cargo de regras:", error instanceof Error ? error.message : error);
    await interaction.reply({
      content: "Não consegui liberar o cargo. Confira se o cargo do bot está acima do cargo configurado.",
      ephemeral: true
    });
  }

  return true;
}

async function handleRulesActionButton(
  interaction: ButtonInteraction,
  button: RulesPanelButton,
  context: BotContext
) {
  if (button.action === "message") {
    await interaction.reply({
      content: button.message || "Mensagem configurada no painel de regras.",
      ephemeral: true
    });
    await logRulesButton(interaction, context, button.id, "message");
    return;
  }

  if (button.action === "ticket") {
    const settings = await context.api.getSettings(interaction.guildId!, interaction.client.user?.id);
    await interaction.reply({
      content: settings.ticketPanelChannelId
        ? `Abra um atendimento em <#${settings.ticketPanelChannelId}>.`
        : "O atendimento por ticket ainda não foi configurado neste servidor.",
      ephemeral: true
    });
    await logRulesButton(interaction, context, button.id, "ticket");
    return;
  }

  if (button.action === "command") {
    await interaction.reply({
      content: button.command ? `Use o comando \`/${button.command.replace(/^\//, "")}\`.` : "Nenhum comando foi configurado para este botão.",
      ephemeral: true
    });
    await logRulesButton(interaction, context, button.id, "command");
    return;
  }

  await interaction.reply({
    content: "Ação indisponível.",
    ephemeral: true
  });
}

async function logRulesButton(interaction: ButtonInteraction, context: BotContext, buttonId: string, action: string) {
  if (!interaction.guildId) return;

  await context.api.postLog({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    type: "rules.button_clicked",
    message: `${interaction.user.tag} acionou um botão do painel de regras.`,
    metadata: {
      action,
      buttonId
    }
  }).catch(() => null);
}

async function resolveGuildMember(interaction: ButtonInteraction) {
  if (interaction.member && "roles" in interaction.member) {
    return interaction.member as GuildMember;
  }

  return interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
}
