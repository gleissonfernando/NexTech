import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type TextChannel
} from "discord.js";
import type { BotContext } from "../types";
import type { PriceTable, PriceTableItem } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "price_table";

export function startPriceTableService(client: import("discord.js").Client<true>, context: BotContext) {
  context.socket.onPriceTablePanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishPriceTablePanel(guild, context, payload.tableId);
  });
}

export async function handlePriceTableInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:quote:`)) { await showQuoteModal(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:plans:`)) { await showPlans(interaction, context); return true; }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:support:`)) { await createSupportTicket(interaction, context); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:quote_modal:`)) { await submitQuote(interaction, context); return true; }
  return false;
}

async function publishPriceTablePanel(guild: Guild, context: BotContext, tableId: string) {
  const table = await context.api.getPriceTableRuntime(guild.id, tableId);
  const channelId = table.discordChannelId;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return null;
  const payload = createPanelPayload(table);
  let message = table.messageId && "messages" in channel ? await channel.messages.fetch(table.messageId).catch(() => null) : null;
  if (message) await message.edit(payload).catch(() => null); else message = await channel.send(payload);
  await context.api.updatePriceTablePanelState(guild.id, table.id, message.id);
  return channel.id;
}

function createPanelPayload(table: PriceTable) {
  const activeItems = table.items.filter((item) => item.active).sort((a, b) => a.order - b.order);
  const rows = activeItems.slice(0, 12).map((item) => {
    const marker = item.highlight ? "**" : "";
    return `${marker}${item.name}${marker} - ${formatPrice(table, item)}${billingSuffix(item)}${item.description ? `\n${item.description}` : ""}`;
  });
  const actions = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:quote:${table.id}`).setLabel(table.buttonText.quote).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:plans:${table.id}`).setLabel(table.buttonText.plans).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:support:${table.id}`).setLabel(table.buttonText.support).setStyle(ButtonStyle.Primary)
    )
  ];

  return renderComponentsV2Panel({
    accentColor: parseColor(table.color),
    actions,
    description: table.description ?? "",
    fields: rows,
    footer: { text: table.footerText ?? "OrviteK" },
    image: table.imageUrl ? { imageEnabled: true, imagePosition: table.imagePosition === "thumbnail" ? "thumbnail" : table.imagePosition, imageUrl: table.imageUrl } : null,
    moduleId: "price-tables",
    title: table.title
  });
}

async function showQuoteModal(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const tableId = interaction.customId.split(":")[2] ?? "";
  const table = await context.api.getPriceTableRuntime(interaction.guild.id, tableId);
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:quote_modal:${tableId}`)
    .setTitle(table.modalText.title)
    .addComponents(
      inputRow("userName", table.modalText.userNameLabel, table.modalText.userNamePlaceholder, true),
      inputRow("itemName", table.modalText.productLabel, table.modalText.productPlaceholder, true),
      inputRow("details", table.modalText.detailsLabel, table.modalText.detailsPlaceholder, true, true),
      inputRow("contact", table.modalText.contactLabel, table.modalText.contactPlaceholder, true)
    );
  await interaction.showModal(modal);
}

async function submitQuote(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const tableId = interaction.customId.split(":")[2] ?? "";
  const table = await context.api.getPriceTableRuntime(interaction.guild.id, tableId);
  const itemName = interaction.fields.getTextInputValue("itemName");
  const item = table.items.find((candidate) => candidate.name.toLowerCase() === itemName.trim().toLowerCase()) ?? null;
  const ticket = await createTicketChannel(interaction.guild, table, interaction.user.id, itemName, interaction.fields.getTextInputValue("details"));
  await context.api.createPriceTableRequest(interaction.guild.id, {
    contact: interaction.fields.getTextInputValue("contact"),
    details: interaction.fields.getTextInputValue("details"),
    itemId: item?.id ?? null,
    itemName,
    tableId,
    ticketChannelId: ticket?.id ?? null,
    userId: interaction.user.id,
    userName: interaction.fields.getTextInputValue("userName")
  });
  await interaction.editReply(ticket ? `Orcamento registrado. Atendimento: <#${ticket.id}>.` : "Orcamento registrado. A equipe foi notificada.");
}

async function showPlans(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const tableId = interaction.customId.split(":")[2] ?? "";
  const table = await context.api.getPriceTableRuntime(interaction.guild.id, tableId);
  const lines = table.items
    .filter((item) => item.active)
    .sort((a, b) => a.order - b.order)
    .map((item) => `**${item.name}** - ${formatPrice(table, item)}${billingSuffix(item)}${item.description ? `\n${item.description}` : ""}`);
  await interaction.reply({ content: lines.join("\n\n").slice(0, 1900) || "Nenhum plano ativo.", ephemeral: true });
}

async function createSupportTicket(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const tableId = interaction.customId.split(":")[2] ?? "";
  const table = await context.api.getPriceTableRuntime(interaction.guild.id, tableId);
  const channel = await createTicketChannel(interaction.guild, table, interaction.user.id, "Atendimento", "Contato iniciado pela tabela de precos.");
  if (channel) {
    await context.api.createTicket({ channelId: channel.id, guildId: interaction.guild.id, openerId: interaction.user.id, subject: table.name });
  }
  await interaction.editReply(channel ? `Atendimento criado: <#${channel.id}>.` : "Nao consegui criar o atendimento. Chame a equipe diretamente.");
}

async function createTicketChannel(guild: Guild, table: PriceTable, openerId: string, subject: string, details: string) {
  if (!table.supportCategoryId || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  const safeName = subject.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "orcamento";
  const channel = await guild.channels.create({
    name: `orcamento-${safeName}-${openerId.slice(-4)}`,
    parent: table.supportCategoryId,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: openerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: `Atendimento de tabela de precos aberto por ${openerId}`,
    type: ChannelType.GuildText
  }).catch(() => null);
  if (!channel) return null;
  const textChannel = channel as TextChannel;
  await textChannel.send({ allowedMentions: { users: [openerId] }, content: `<@${openerId}> atendimento aberto para **${subject}**.\n${details}` }).catch(() => null);
  return textChannel;
}

function inputRow(id: string, label: string, placeholder: string, required: boolean, paragraph = false) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setPlaceholder(placeholder.slice(0, 100)).setRequired(required).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
  );
}

function formatPrice(table: PriceTable, item: PriceTableItem) {
  if (item.priceText) return item.priceText;
  if (table.currency === "BRL") return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(item.price);
  if (table.currency === "USD") return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(item.price);
  if (table.currency === "EUR") return new Intl.NumberFormat("de-DE", { currency: "EUR", style: "currency" }).format(item.price);
  return `${table.currencyFormat}${item.price.toFixed(2)}`;
}

function billingSuffix(item: PriceTableItem) {
  if (item.billingText) return ` / ${item.billingText}`;
  return ({ custom: "", monthly: " / mensal", one_time: " / unico", weekly: " / semanal" } as const)[item.billingType];
}

function parseColor(value: string) {
  const parsed = Number.parseInt(value.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x7c3aed;
}
