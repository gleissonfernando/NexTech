import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { publishFivemOrderPanel, showFivemOrderCreate, showFivemOrderReport, showFivemOrderStatus, updateFivemOrderByNumber } from "../services/fivemOrderService";
import type { BotCommand } from "../types";

export const fivemOrdersCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("encomendas").setDescription("Sistema de Encomendas RP.")
    .addSubcommand((cmd) => cmd.setName("painel").setDescription("Publica ou atualiza o painel."))
    .addSubcommand((cmd) => cmd.setName("criar").setDescription("Abre a selecao de produtos."))
    .addSubcommand((cmd) => cmd.setName("status").setDescription("Consulta uma encomenda.").addIntegerOption((option) => option.setName("numero").setDescription("Numero da encomenda").setRequired(true).setMinValue(1)))
    .addSubcommand((cmd) => cmd.setName("entregar").setDescription("Marca uma encomenda como entregue.").addIntegerOption((option) => option.setName("numero").setDescription("Numero da encomenda").setRequired(true).setMinValue(1)))
    .addSubcommand((cmd) => cmd.setName("cancelar").setDescription("Cancela uma encomenda.").addIntegerOption((option) => option.setName("numero").setDescription("Numero da encomenda").setRequired(true).setMinValue(1)))
    .addSubcommand((cmd) => cmd.setName("produto-adicionar").setDescription("Adiciona um produto.").addStringOption((option) => option.setName("nome").setDescription("Nome").setRequired(true)).addStringOption((option) => option.setName("categoria").setDescription("Categoria").setRequired(true)).addNumberOption((option) => option.setName("preco").setDescription("Valor unitario").setRequired(true).setMinValue(0)).addNumberOption((option) => option.setName("custo").setDescription("Custo unitario").setMinValue(0)))
    .addSubcommand((cmd) => cmd.setName("produto-remover").setDescription("Remove um produto.").addStringOption((option) => option.setName("produto-id").setDescription("ID do produto").setRequired(true)))
    .addSubcommand((cmd) => cmd.setName("relatorio").setDescription("Mostra o resumo de produtos e valores."))
    .addSubcommand((cmd) => cmd.setName("configurar").setDescription("Mostra onde configurar o sistema.")),
  moduleId: "fivem-orders",
  async execute(interaction, context) {
    if (!interaction.guild) { await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true }); return; }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "criar") { await showFivemOrderCreate(interaction, context); return; }
    if (subcommand === "status") { await showFivemOrderStatus(interaction, context, interaction.options.getInteger("numero", true)); return; }
    const runtime = await context.api.getFivemOrderRuntime(interaction.guild.id);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const admin = interaction.guild.ownerId === interaction.user.id || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((role) => runtime.settings.adminRoleIds.includes(role.id));
    if (!admin) { await interaction.reply({ content: "Voce nao possui permissao administrativa no sistema de encomendas.", ephemeral: true }); return; }
    if (subcommand === "painel") { await publishFivemOrderPanel(interaction, context); return; }
    if (subcommand === "entregar") { await updateFivemOrderByNumber(interaction, context, interaction.options.getInteger("numero", true), "delivered"); return; }
    if (subcommand === "cancelar") { await updateFivemOrderByNumber(interaction, context, interaction.options.getInteger("numero", true), "cancelled"); return; }
    if (subcommand === "relatorio") { await showFivemOrderReport(interaction, context); return; }
    if (subcommand === "configurar") { await interaction.reply({ content: "Use a aba **Encomendas RP** na dashboard para configurar canais, cargos, produtos, mensagens e permissoes.", ephemeral: true }); return; }
    if (subcommand === "produto-adicionar") {
      const product = await context.api.createFivemOrderProduct(interaction.guild.id, { actorId: interaction.user.id, category: interaction.options.getString("categoria", true), cost: interaction.options.getNumber("custo") ?? 0, name: interaction.options.getString("nome", true), price: interaction.options.getNumber("preco", true) });
      await interaction.reply({ content: `Produto **${product.name}** criado. ID: \`${product.id}\`.`, ephemeral: true }); return;
    }
    const productId = interaction.options.getString("produto-id", true);
    if (subcommand === "produto-remover") {
      await context.api.deleteFivemOrderProduct(interaction.guild.id, productId, interaction.user.id);
      await interaction.reply({ content: "Produto removido.", ephemeral: true }); return;
    }
  }
};
