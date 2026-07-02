import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { publishFivemFinancePanel, showFivemFinanceBalance } from "../services/fivemFinanceService";
import type { BotCommand } from "../types";

export const fivemFinanceCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("financeiro")
    .setDescription("Sistema Financeiro da FAC.")
    .addSubcommand((cmd) => cmd.setName("painel").setDescription("Publica ou atualiza o painel financeiro."))
    .addSubcommand((cmd) => cmd.setName("saldo").setDescription("Consulta o saldo atual."))
    .addSubcommand((cmd) => cmd.setName("historico").setDescription("Mostra as ultimas movimentacoes.")),
  moduleId: "fivem-finance",
  async execute(interaction, context) {
    if (!interaction.guild) { await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true }); return; }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "saldo") { await showFivemFinanceBalance(interaction, context); return; }
    const runtime = await context.api.getFivemFinanceRuntime(interaction.guild.id);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const admin = interaction.guild.ownerId === interaction.user.id || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((role) => runtime.settings.adminRoleIds.includes(role.id));
    if (!admin) { await interaction.reply({ content: "Voce nao possui permissao administrativa no financeiro.", ephemeral: true }); return; }
    if (subcommand === "painel") { await publishFivemFinancePanel(interaction, context); return; }
    if (subcommand === "historico") {
      const lines = runtime.transactions.slice(0, 10).map((item) => `${item.type === "add" ? "+" : "-"} ${item.amount.toLocaleString("pt-BR")} - ${item.username} - ${item.transactionId}`);
      await interaction.reply({ content: lines.length ? lines.join("\n") : "Nenhuma movimentacao registrada.", ephemeral: true });
    }
  }
};
