import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { SalesTicket, SalesTicketSettings, SalesTicketType } from "./apiClient";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const PREFIX = "sales_ticket";

export function startSalesTicketService(client: Client<true>, context: BotContext) {
  context.socket.onSalesTicketPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishSalesTicketPanel(guild, context);
  });
}

export async function handleSalesTicketInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:show_password:`)) {
    await showTranscriptPassword(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:close_confirm:`)) {
    await closeSalesTicket(interaction, context);
    return true;
  }
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
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:add_member:`)) {
    await showMemberAccessModal(interaction, "add");
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:remove_member:`)) {
    await showMemberAccessModal(interaction, "remove");
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:member_access:`)) {
    await submitMemberAccessModal(interaction, context);
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

  return renderComponentsV2Panel({
    accentColor: parseColor(settings.panelColor),
    actions: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    description: settings.panelDescription || "Selecione abaixo o tipo de atendimento de vendas que deseja abrir.",
    footer: "NexTech • Sistema de Vendas • Tickets exclusivos",
    image: settings.panelImageUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.panelImageUrl } : null,
    moduleId: "sales-tickets",
    title: settings.panelTitle || "Sistema de Tickets de Vendas"
  });
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
  const ticketRoleIds = [...new Set([...type.supportRoleIds, type.mentionRoleId].filter((id): id is string => Boolean(id)))];
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    { id: botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...ticketRoleIds
      .filter((id) => guild.roles.cache.has(id) && id !== guild.roles.everyone.id)
      .map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }))
  ];
}

function createTicketMessage(settings: SalesTicketSettings, type: SalesTicketType, ticket: SalesTicket, userId: string) {
  const content = renderTemplate(type.initialMessage, userId, ticket.userName ?? userId, type.name);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:claim:${ticket.id}`).setEmoji("🙋").setLabel("Assumir Atendimento").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:add_member:${ticket.id}`).setEmoji("➕").setLabel("Adicionar Membro").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:remove_member:${ticket.id}`).setEmoji("➖").setLabel("Remover Membro").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:close:${ticket.id}`).setEmoji("🔒").setLabel("Fechar Ticket").setStyle(ButtonStyle.Danger)
  );
  const mentionRoleId = type.mentionRoleId;
  const supportMention = mentionRoleId ? `<@&${mentionRoleId}>` : "";
  const payload = renderComponentsV2Panel({
    accentColor: parseColor(settings.panelColor),
    actions: [row],
    description: content,
    fields: [
      `**Usuário:** <@${userId}>`,
      `**Tipo:** ${type.name}`,
      `**ID:** \`${ticket.id}\``
    ],
    footer: "NexTech • Ticket exclusivo de vendas",
    moduleId: "sales-tickets",
    title: `${type.emoji ?? "🎫"} ${type.name}`
  });

  return {
    ...payload,
    allowedMentions: { parse: [], roles: mentionRoleId ? [mentionRoleId] : [], users: [userId] },
    content: [`<@${userId}>`, supportMention].filter(Boolean).join(" ")
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
    await interaction.channel.send({
      components: [{ type: 17, accent_color: 0xFFD500, components: [{ type: 10, content: `# Atendimento assumido\n${interaction.user} assumiu este ticket de vendas.\nTicket: \`${ticket.id}\`` }] }],
      flags: MessageFlags.IsComponentsV2
    }).catch(() => null);
  }
}

async function confirmCloseSalesTicket(interaction: ButtonInteraction) {
  const ticketId = interaction.customId.split(":")[2] ?? "";
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:close_confirm:${ticketId}`).setLabel("Confirmar fechamento").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:noop:${ticketId}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
  await interaction.reply({
    components: [row],
    content: "Confirme para fechar este ticket de vendas, gerar transcript e enviar DM ao usuário.",
    flags: MessageFlags.Ephemeral
  });
}

async function showMemberAccessModal(interaction: ButtonInteraction, action: "add" | "remove") {
  const ticketId = interaction.customId.split(":")[2] ?? "";
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:member_access:${action}:${ticketId}`)
    .setTitle(action === "add" ? "Adicionar membro" : "Remover membro");
  const input = new TextInputBuilder()
    .setCustomId("user_id")
    .setLabel("ID Discord do membro")
    .setMaxLength(32)
    .setMinLength(5)
    .setPlaceholder("Ex: 123456789012345678")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

async function submitMemberAccessModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
  const [, , action] = interaction.customId.split(":");
  const userId = interaction.fields.getTextInputValue("user_id").replace(/\D/g, "");
  if (!/^\d{5,32}$/.test(userId)) {
    await interaction.reply({ content: "Informe um ID Discord válido.", ephemeral: true });
    return;
  }
  const channel = interaction.channel as TextChannel;
  if (action === "add") {
    await channel.permissionOverwrites.edit(userId, {
      AttachFiles: true,
      ReadMessageHistory: true,
      SendMessages: true,
      ViewChannel: true
    }, { reason: "Membro adicionado ao ticket de vendas." });
    await interaction.reply({ content: `<@${userId}> foi adicionado ao ticket de vendas.`, ephemeral: true });
    await channel.send(`➕ <@${userId}> foi adicionado ao ticket por ${interaction.user}.`).catch(() => null);
    await recordTicketRuntimeLog(context, interaction, ticketIdFromCustomId(interaction.customId), "member_added", `Membro ${userId} adicionado ao ticket de vendas.`, { targetUserId: userId });
    return;
  }
  await channel.permissionOverwrites.edit(userId, {
    SendMessages: false,
    ViewChannel: false
  }, { reason: "Membro removido do ticket de vendas." });
  await interaction.reply({ content: `<@${userId}> foi removido do ticket de vendas.`, ephemeral: true });
  await channel.send(`➖ <@${userId}> foi removido do ticket por ${interaction.user}.`).catch(() => null);
  await recordTicketRuntimeLog(context, interaction, ticketIdFromCustomId(interaction.customId), "member_removed", `Membro ${userId} removido do ticket de vendas.`, { targetUserId: userId });
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
  await sendTranscriptDm(interaction, context, result.ticket.id, result.transcriptId, result.transcriptUrl);
  await interaction.editReply("Ticket fechado. Transcript gerado e DM enviada quando possível.");
  setTimeout(() => void (interaction.channel as TextChannel).delete("Ticket de vendas fechado.").catch(() => null), runtime.settings.closeDeleteDelaySeconds * 1000).unref();
}

async function collectTranscriptMessages(channel: TextChannel) {
  const messages: Message[] = [];
  let before: string | undefined;

  while (messages.length < 1000) {
    const fetched = await channel.messages.fetch({ before, limit: Math.min(100, 1000 - messages.length) }).catch(() => null);
    if (!fetched?.size) break;
    const batch = [...fetched.values()];
    messages.push(...batch);
    before = batch[batch.length - 1]?.id;
    if (!before || batch.length < 100) break;
  }

  return messages.reverse().map((message: Message) => ({
    attachments: message.attachments.map((attachment) => ({ contentType: attachment.contentType, name: attachment.name, url: attachment.url })),
    authorId: message.author.id,
    authorName: message.author.username,
    components: message.components.map((component) => component.toJSON()),
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
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

async function sendTranscriptDm(interaction: ButtonInteraction, context: BotContext, ticketId: string, transcriptId: string, transcriptUrl: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:show_password:${interaction.guild!.id}:${transcriptId}`)
      .setLabel("Mostrar senha")
      .setStyle(ButtonStyle.Secondary)
  );
  const payload = renderComponentsV2Panel({
    accentColor: 0xFFD500,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("Abrir Transcript").setStyle(ButtonStyle.Link).setURL(transcriptUrl)
      ),
      row
    ],
    description: `Seu transcript está disponível.\n\n**Link:** ${transcriptUrl}\n\n**Senha:** ••••••••••••`,
    footer: "NexTech • Transcript exclusivo de vendas",
    moduleId: "sales-tickets",
    title: "Seu atendimento foi finalizado"
  });

  const sent = await interaction.user.send(payload).then(() => true).catch(() => false);
  await context.api.recordSalesTicketLog(interaction.guildId!, ticketId, {
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    data: { transcriptId },
    event: sent ? "dm_sent" : "dm_failed",
    message: sent ? "DM com transcript enviada ao usuário." : "Falha ao enviar DM com transcript ao usuário."
  }).catch(() => null);
}

async function showTranscriptPassword(interaction: ButtonInteraction, context: BotContext) {
  const [, , , guildId, transcriptId] = interaction.customId.split(":");
  if (!guildId || !transcriptId) {
    await interaction.reply({ content: "Senha indisponível para este transcript.", ephemeral: true });
    return;
  }

  try {
    const result = await context.api.revealSalesTicketTranscriptPassword(guildId, transcriptId, interaction.user.id);
    await interaction.reply({ content: `Senha do transcript: ||${result.password}||`, flags: MessageFlags.Ephemeral });
  } catch {
    await interaction.reply({ content: "Senha indisponível para este usuário.", flags: MessageFlags.Ephemeral });
  }
}

async function recordTicketRuntimeLog(context: BotContext, interaction: ModalSubmitInteraction, ticketId: string, event: string, message: string, data: Record<string, unknown>) {
  if (!interaction.guildId) return;
  await context.api.recordSalesTicketLog(interaction.guildId, ticketId, {
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    data,
    event,
    message
  }).catch(() => null);
}

function ticketIdFromCustomId(customId: string) {
  return customId.split(":")[3] ?? "none";
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
