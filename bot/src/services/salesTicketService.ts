import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { SalesTicket, SalesTicketSettings, SalesTicketType } from "./apiClient";

const PREFIX = "sales_ticket";

export function startSalesTicketService(client: Client<true>, context: BotContext) {
  context.socket.onSalesTicketPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishSalesTicketPanel(guild, context);
  });
}

export async function handleSalesTicketInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}:open`) {
    await openSalesTicket(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:claim:`)) {
    await claimSalesTicket(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:close:`)) {
    await confirmCloseSalesTicket(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:close_confirm:`)) {
    await closeSalesTicket(interaction, context);
    return true;
  }
  if (interaction.isButton() && (interaction.customId.startsWith(`${PREFIX}:add_member:`) || interaction.customId.startsWith(`${PREFIX}:remove_member:`))) {
    await interaction.reply({ content: "Ajuste o acesso do ticket pelas permissões do canal. Esta ação pertence somente ao ticket de vendas.", ephemeral: true });
    return true;
  }
  return false;
}

async function publishSalesTicketPanel(guild: Guild, context: BotContext) {
  const runtime = await context.api.getSalesTicketRuntime(guild.id);
  if (!runtime.settings.enabled) return null;
  const channelId = runtime.settings.panelChannelId;
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable() || !("messages" in channel)) return null;
  const payload = createPublicPanel(runtime.settings, runtime.types);
  if (runtime.settings.panelMessageId) {
    const previous = await channel.messages.fetch(runtime.settings.panelMessageId).catch(() => null);
    if (previous) {
      await previous.edit(payload);
      return previous.id;
    }
  }
  const message = await channel.send(payload);
  await context.api.updateSalesTicketPanelState(guild.id, message.id);
  return message.id;
}

function createPublicPanel(settings: SalesTicketSettings, types: SalesTicketType[]) {
  const activeTypes = types.filter((type) => type.active).sort((a, b) => a.order - b.order).slice(0, 25);
  const embed = new EmbedBuilder()
    .setColor(parseColor(settings.panelColor))
    .setTitle(settings.panelTitle || "Sistema de Tickets de Vendas")
    .setDescription(settings.panelDescription || "Selecione abaixo o tipo de atendimento de vendas que deseja abrir.")
    .setFooter({ text: "NexTech • Sistema de Vendas • Tickets exclusivos" });
  if (settings.panelImageUrl) embed.setImage(settings.panelImageUrl);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:open`)
    .setPlaceholder(settings.panelPlaceholder || "Selecione o atendimento desejado")
    .setDisabled(activeTypes.length === 0)
    .addOptions(activeTypes.length ? activeTypes.map((type) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(limitText(type.name, 100))
        .setDescription(limitText(type.description || "Abrir atendimento", 100))
        .setValue(type.id);
      if (type.emoji) option.setEmoji(type.emoji);
      return option;
    }) : [new StringSelectMenuOptionBuilder().setLabel("Nenhum ticket configurado").setValue("disabled")]);

  return {
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    embeds: [embed]
  };
}

async function openSalesTicket(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const typeId = interaction.values[0] ?? "";
  if (!typeId || typeId === "disabled") return interaction.editReply("Nenhum tipo de ticket de vendas disponível.");
  const runtime = await context.api.createSalesTicket(interaction.guild.id, {
    typeId,
    userId: interaction.user.id,
    userName: interaction.user.username
  });
  const channel = await createTicketChannel(interaction.guild, runtime.settings, runtime.type, runtime.ticket, interaction.user.id);
  await context.api.updateSalesTicketChannel(interaction.guild.id, runtime.ticket.id, channel.id);
  await channel.send(createTicketMessage(runtime.settings, runtime.type, { ...runtime.ticket, channelId: channel.id }, interaction.user.id));
  await interaction.editReply(`Ticket de vendas aberto: <#${channel.id}>.`);
}

async function createTicketChannel(guild: Guild, settings: SalesTicketSettings, type: SalesTicketType, ticket: SalesTicket, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const name = channelName(type.channelNamePattern, member?.displayName ?? ticket.userName ?? userId, type.name, ticket.id);
  const channel = await guild.channels.create({
    name,
    parent: type.categoryId ?? undefined,
    permissionOverwrites: buildTicketOverwrites(guild, type, userId),
    reason: `Ticket de vendas ${type.name} ${ticket.id}`,
    type: ChannelType.GuildText
  }) as TextChannel;
  await channel.permissionOverwrites.set(buildTicketOverwrites(guild, type, userId), "Canal privado do ticket de vendas.").catch(() => null);
  return channel;
}

function buildTicketOverwrites(guild: Guild, type: SalesTicketType, userId: string) {
  const botUserId = guild.members.me?.id ?? guild.client.user.id;
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    { id: botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...type.supportRoleIds
      .filter((id) => guild.roles.cache.has(id) && id !== guild.roles.everyone.id)
      .map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }))
  ];
}

function createTicketMessage(settings: SalesTicketSettings, type: SalesTicketType, ticket: SalesTicket, userId: string) {
  const content = renderTemplate(type.initialMessage, userId, ticket.userName ?? userId, type.name);
  const embed = new EmbedBuilder()
    .setColor(parseColor(settings.panelColor))
    .setTitle(`${type.emoji ?? "🎫"} ${type.name}`)
    .setDescription(content)
    .addFields(
      { inline: true, name: "Usuário", value: `<@${userId}>` },
      { inline: true, name: "Tipo", value: type.name },
      { inline: true, name: "ID", value: ticket.id }
    )
    .setFooter({ text: "NexTech • Ticket exclusivo de vendas" })
    .setTimestamp(new Date());
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:claim:${ticket.id}`).setEmoji("🙋").setLabel("Assumir Atendimento").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:add_member:${ticket.id}`).setEmoji("➕").setLabel("Adicionar Membro").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove_member:${ticket.id}`).setEmoji("➖").setLabel("Remover Membro").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:close:${ticket.id}`).setEmoji("🔒").setLabel("Fechar Ticket").setStyle(ButtonStyle.Danger)
  );
  const supportMentions = type.supportRoleIds.map((id) => `<@&${id}>`).join(" ");
  return {
    allowedMentions: { parse: [], roles: type.supportRoleIds, users: [userId] },
    components: [row],
    content: [`<@${userId}>`, supportMentions].filter(Boolean).join(" "),
    embeds: [embed]
  };
}

async function claimSalesTicket(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const ticketId = interaction.customId.split(":")[2] ?? "";
  const ticket = await context.api.claimSalesTicket(interaction.guild.id, ticketId, {
    actorId: interaction.user.id,
    actorName: interaction.user.username
  });
  await interaction.editReply(`Atendimento assumido por ${interaction.user}.`);
  if (interaction.channel?.isSendable()) {
    await interaction.channel.send(`🙋 Atendimento assumido por ${interaction.user}. Ticket: ${ticket.id}`).catch(() => null);
  }
}

async function confirmCloseSalesTicket(interaction: ButtonInteraction) {
  const ticketId = interaction.customId.split(":")[2] ?? "";
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:close_confirm:${ticketId}`).setLabel("Confirmar fechamento").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:noop:${ticketId}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
  await interaction.reply({ components: [row], content: "Confirme para fechar este ticket de vendas, gerar transcript e enviar DM ao usuário.", ephemeral: true });
}

async function closeSalesTicket(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
  await interaction.deferReply({ ephemeral: true });
  const ticketId = interaction.customId.split(":")[2] ?? "";
  const runtime = await context.api.getSalesTicketRuntime(interaction.guild.id);
  const ticket = runtime.tickets.find((item) => item.id === ticketId || item.channelId === interaction.channelId);
  if (!ticket) return interaction.editReply("Ticket de vendas não encontrado.");
  const messages = await collectTranscriptMessages(interaction.channel as TextChannel);
  const result = await context.api.closeSalesTicket(interaction.guild.id, ticket.id, {
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    channelId: interaction.channelId,
    closeReason: "Fechado pelo painel do ticket.",
    messages
  });
  await freezeTicketChannel(interaction.channel as TextChannel, ticket.userId);
  await sendTranscriptDm(interaction, result.transcriptUrl, result.password);
  await interaction.editReply("Ticket fechado. Transcript gerado e DM enviada quando possível.");
  setTimeout(() => void (interaction.channel as TextChannel).delete("Ticket de vendas fechado.").catch(() => null), runtime.settings.closeDeleteDelaySeconds * 1000).unref();
}

async function collectTranscriptMessages(channel: TextChannel) {
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  return [...(fetched?.values() ?? [])].reverse().map((message: Message) => ({
    attachments: message.attachments.map((attachment) => ({ contentType: attachment.contentType, name: attachment.name, url: attachment.url })),
    authorId: message.author.id,
    authorName: message.author.username,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    embeds: message.embeds.map((embed) => embed.toJSON()),
    id: message.id
  }));
}

async function freezeTicketChannel(channel: TextChannel, userId: string) {
  await channel.permissionOverwrites.edit(userId, {
    SendMessages: false,
    ViewChannel: true
  }, { reason: "Ticket de vendas fechado." }).catch(() => null);
}

async function sendTranscriptDm(interaction: ButtonInteraction, transcriptUrl: string, password: string) {
  const embed = new EmbedBuilder()
    .setColor(0xFFD500)
    .setTitle("Seu atendimento foi finalizado")
    .setDescription(`Seu transcript está disponível.\n\nLink:\n${transcriptUrl}\n\nSenha:\n••••••••••••`)
    .setFooter({ text: "NexTech • Transcript exclusivo de vendas" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:password_once`)
      .setLabel("Mostrar senha")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );
  await interaction.user.send({ components: [row], embeds: [embed] }).catch(() => null);
  await interaction.user.send({ content: `Senha do transcript: ||${password}||` }).catch(() => null);
}

function channelName(pattern: string, username: string, typeName: string, ticketId: string) {
  return slug(pattern
    .replaceAll("{usuario}", username)
    .replaceAll("{user}", username)
    .replaceAll("{tipo}", typeName)
    .replaceAll("{id}", ticketId.slice(0, 8))).slice(0, 90);
}

function renderTemplate(template: string, userId: string, username: string, typeName: string) {
  return template
    .replaceAll("{usuario}", `<@${userId}>`)
    .replaceAll("{user}", `<@${userId}>`)
    .replaceAll("{nome}", username)
    .replaceAll("{tipo}", typeName);
}

function slug(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "ticket-vendas";
}

function parseColor(value: string) {
  const normalized = value.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xFFD500;
}

function limitText(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}
