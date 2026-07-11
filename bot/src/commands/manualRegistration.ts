import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { publishManualRegistrationPanel, showManualRegistrationQuickConfig } from "../services/manualRegistrationService";
import type { BotCommand } from "../types";

export const manualRegistrationCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("pedido-set")
    .setDescription("Configura e publica o sistema de Pedido de Set.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) => command.setName("painel").setDescription("Publica o painel no canal configurado ou atual."))
    .addSubcommand((command) => command.setName("configurar").setDescription("Abre a configuracao rapida do sistema."))
    .addSubcommand((command) => command.setName("ativar").setDescription("Ativa o Pedido de Set neste servidor."))
    .addSubcommand((command) => command.setName("desativar").setDescription("Desativa o Pedido de Set neste servidor."))
    .addSubcommand((command) => command.setName("status").setDescription("Mostra o status atual do sistema."))
    .addSubcommand((command) => command.setName("resetar").setDescription("Desativa e limpa os vinculos principais.")),
  moduleId: "manual-registration",
  async execute(interaction, context) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "painel") {
      await publishManualRegistrationPanel(interaction, context);
      return;
    }
    if (subcommand === "configurar") {
      await showManualRegistrationQuickConfig(interaction);
      return;
    }
    if (subcommand === "status") {
      const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
      await interaction.reply({ content: `Pedido de Set: **${settings.enabled ? "Ativado" : "Desativado"}**\nPainel: ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "nao configurado"}\nAnalise: ${settings.approvalChannelId ? `<#${settings.approvalChannelId}>` : "nao configurado"}\nSets ativos: ${settings.setRoles.filter((item) => item.enabled).length}`, ephemeral: true });
      return;
    }
    if (subcommand === "resetar") {
      await context.api.saveManualRegistrationSettings(interaction.guild.id, { approvalChannelId: null, approverRoleIds: [], autoRoleIds: [], enabled: false, logChannelId: null, panelChannelId: null, panelMessageId: null, setRoles: [], staffRoleIds: [] });
      await interaction.reply({ content: "Pedido de Set desativado e vinculos principais removidos.", ephemeral: true });
      return;
    }
    const enabled = subcommand === "ativar";
    await context.api.saveManualRegistrationSettings(interaction.guild.id, { enabled });
    await interaction.reply({ content: `Pedido de Set ${enabled ? "ativado" : "desativado"}.`, ephemeral: true });
  }
};

export const legacyManualRegistrationCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("cadastro-manual")
    .setDescription("Publica o painel de Pedido de Set (comando legado).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: "manual-registration",
  async execute(interaction, context) {
    await publishManualRegistrationPanel(interaction, context);
  }
};

export const configSetCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("config-set")
    .setDescription("Configura rapidamente os canais e cargos do Pedido de Set da FAC.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: "manual-registration",
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
      return;
    }
    await showManualRegistrationQuickConfig(interaction);
  }
};
