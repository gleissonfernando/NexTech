import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { executeManualSetRegistration, publishManualRegistrationPanel, showSetConfigPanel } from "../services/manualRegistrationService";
import type { BotCommand } from "../types";

export const setCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("set")
    .setDescription("Publica e administra o sistema de Set.")
    .addSubcommand((command) => command.setName("painel").setDescription("Publica ou atualiza o painel público de solicitação."))
    .addSubcommand((command) => command.setName("config").setDescription("Abre a configuração administrativa do Set."))
    .addSubcommand((command) => command.setName("status").setDescription("Mostra a configuração atual do sistema."))
    .addSubcommand((command) => command.setName("cadastro-manual").setDescription("Cadastra um usuário sem pedido aberto.")
      .addUserOption((option) => option.setName("usuario").setDescription("Usuário que receberá o set").setRequired(true))
      .addStringOption((option) => option.setName("nome").setDescription("Nome que será utilizado").setMinLength(2).setMaxLength(80).setRequired(true))
      .addStringOption((option) => option.setName("observacao").setDescription("Observação opcional").setMaxLength(500))),
  moduleId: "manual-registration",
  async execute(interaction, context) {
    if (!interaction.guild) return void await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "painel") return void await publishManualRegistrationPanel(interaction, context);
    if (subcommand === "config") return void await showSetConfigPanel(interaction, context);
    if (subcommand === "cadastro-manual") return void await executeManualSetRegistration(interaction, context);
    const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
    await interaction.reply({ content: `Sistema: **${settings.enabled ? "Ativo" : "Inativo"}**\nCargo aprovado: ${settings.approvedRoleId ? `<@&${settings.approvedRoleId}>` : "não configurado"}\nPainel: ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "não configurado"}\nCategoria: ${settings.requestCategoryId ? `<#${settings.requestCategoryId}>` : "não configurada"}`, ephemeral: true });
  }
};
