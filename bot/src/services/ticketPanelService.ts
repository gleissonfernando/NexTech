import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type Client,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  type PartialMessage,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel
} from "discord.js";
import { env } from "../config/env";
import type { BotContext, GuildSettings, PanelImageSettings, TicketPanelOption } from "../types";
import { resetSelectMenuMessage } from "../utils/selectMenuReset";
import type { TicketRecord } from "./apiClient";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";
import { resolveTranscriptDownloadUrl, resolveTranscriptUrl } from "./transcriptUrlService";

const TICKET_PANEL_CUSTOM_ID = "ticket_panel_select";
const TICKET_ACTION_PREFIX = "ticket_action:";
const TICKET_STATUS_PREFIX = "ticket_status:";
const CLOSE_MODAL_PREFIX = "ticket_close:";
let ticketPanelServiceStarted = false;
const panelPublicationLocks = new Map<string, Promise<string | null>>();
const STATUS_OPTIONS = [
  { label: "Aguardando atendimento", value: "OPEN" },
  { label: "Em análise", value: "IN_ANALYSIS" },
  { label: "Aguardando provas", value: "WAITING_EVIDENCE" },
  { label: "Aguardando usuário", value: "WAITING_USER" },
  { label: "Resolvido", value: "RESOLVED" },
  { label: "Negado", value: "DENIED" },
  { label: "Encerrado", value: "CLOSED" }
];

export async function publishTicketPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Comando disponivel apenas em servidores.", ephemeral: true });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);

  if (!settings.ticketEnabled) {
    await interaction.reply({ content: "O sistema de tickets esta desativado na Dashboard.", ephemeral: true });
    return;
  }

  const payload = createTicketPanelPayload(settings, interaction.guild);

  if (!payload) {
    await interaction.reply({ content: "Configure pelo menos uma opcao ativa para o painel de ticket.", ephemeral: true });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: "Nao consegui enviar o painel neste canal.", ephemeral: true });
    return;
  }

  const message = await interaction.channel.send(payload);
  await context.api.updateTicketPanelState(interaction.guild.id, {
    channelId: message.channelId,
    messageId: message.id
  }).catch((error) => {
    console.error("[ticket-panel] falha ao salvar painel publicado por comando:", error instanceof Error ? error.message : error);
  });
  await interaction.reply({ content: "Painel de ticket publicado neste canal.", ephemeral: true });
}

export function startTicketPanelService(client: Client, context: BotContext) {
  if (ticketPanelServiceStarted) return;
  ticketPanelServiceStarted = true;

  context.socket.onTicketPanelPublish((payload) => {
    void publishConfiguredTicketPanel(client, context, payload.guildId).catch((error) => {
      console.error(`[ticket-panel] falha ao publicar painel em ${payload.guildId}:`, error instanceof Error ? error.message : error);
    });
  });
}

export async function publishConfiguredTicketPanel(client: Client, context: BotContext, guildId: string) {
  const current = panelPublicationLocks.get(guildId);
  if (current) return current;

  const publication = publishConfiguredTicketPanelUnlocked(client, context, guildId)
    .finally(() => panelPublicationLocks.delete(guildId));
  panelPublicationLocks.set(guildId, publication);
  return publication;
}

export async function handleTicketPanelMessageDelete(message: Message | PartialMessage, context: BotContext) {
  if (!message.guild) return;

  const settings = await getFreshGuildSettings(context, message.guild.id, context.client.user?.id).catch(() => null);
  if (!settings?.ticketEnabled || settings.ticketPanelMessageId !== message.id) return;

  await context.api.updateTicketPanelState(message.guild.id, { messageId: null }).catch((error) => {
    console.error("[ticket-panel] falha ao marcar painel como ausente:", error instanceof Error ? error.message : error);
  });
  await context.api.postLog({
    guildId: message.guild.id,
    message: `Painel de tickets marcado como ausente. Mensagem removida: ${message.id}.`,
    metadata: {
      channelId: message.channelId,
      messageId: message.id,
      panel: "tickets"
    },
    type: "ticket.panel_missing",
    userId: context.client.user?.id ?? "system"
  }).catch(() => null);

  if (settings.ticketPanelChannelId) {
    await publishConfiguredTicketPanel(context.client, context, message.guild.id).catch((error) => {
      console.warn("[ticket-panel] republicacao:", error instanceof Error ? error.message : String(error));
    });
  }
}

export async function handleTicketPanelInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild) {
    return false;
  }

  if (interaction.isButton() && interaction.customId.startsWith(TICKET_ACTION_PREFIX)) {
    await handleTicketAction(interaction, context);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(TICKET_STATUS_PREFIX)) {
    await handleTicketStatus(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(CLOSE_MODAL_PREFIX)) {
    await handleTicketCloseModal(interaction, context);
    return true;
  }

  if (!interaction.isStringSelectMenu() || interaction.customId !== TICKET_PANEL_CUSTOM_ID) {
    return false;
  }

  const selectedValue = interaction.values[0];
  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedValue);

  if (!settings?.ticketEnabled || !option) {
    await interaction.reply({ content: "Esta opcao de ticket nao esta mais disponivel.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  void resetSelectMenuMessage(interaction);

  let channelId: string | null = null;
  try {
    const channel = await createTicketChannel(interaction.guild, settings, interaction.user.id, option);
    channelId = channel?.id ?? null;
  } catch (error) {
    console.warn("[ticket-panel] nao foi possivel criar canal de ticket:", error instanceof Error ? error.message : error);
  }

  const ticket = await context.api.createTicket({
    channelId,
    categoryId: option.value,
    categoryName: option.label,
    guildId: interaction.guild.id,
    openerId: interaction.user.id,
    subject: option.label
  });

  if (channelId) {
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send(createOpenTicketPayload(ticket.ticket.id, option.label, interaction.user.id));
    }
    await context.api.recordTicketEvent(ticket.ticket.id, {
      authorId: interaction.user.id,
      content: `Ticket criado na categoria ${option.label}.`,
      eventType: "ticket.created",
      guildId: interaction.guild.id
    }).catch(() => null);
  }

  await interaction.editReply(
    channelId
      ? `Ticket criado: <#${channelId}>`
      : `Ticket registrado: ${ticket.ticket.id}. A equipe foi notificada pelo painel.`
  );

  return true;
}

async function handleTicketAction(interaction: ButtonInteraction, context: BotContext) {
  const [, action, ticketId] = interaction.customId.split(":");
  if (!ticketId) {
    await interaction.reply({ content: "Ticket invalido.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "newpass") {
    const password = await context.api.createTranscriptTemporaryPassword(ticketId);
    await interaction.reply({
      content: `Nova senha temporária criada: ||${password.password}||\nValidade: ${new Date(password.expiresAt).toLocaleString("pt-BR")}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (action === "revoke") {
    await context.api.revokeTranscriptTemporaryPasswords(ticketId);
    await interaction.reply({ content: "Senhas temporárias revogadas para este transcript.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "noop") {
    await interaction.deferUpdate().catch(() => null);
    return;
  }

  const ticket = await context.api.getTicket(ticketId);
  if (!ticket) {
    await interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id)) {
    await interaction.reply({ content: "Quem abriu este ticket nao pode assumir nem usar os botoes internos do atendimento.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "claim") {
    await interaction.deferUpdate();
    const claim = await context.api.claimTicket(ticketId, interaction.user.id);
    if (!claim.claimed) {
      await interaction.followUp({ content: "Este atendimento já foi assumido por outro responsável.", flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    const updatedTicket = claim.ticket;
    await context.api.recordTicketEvent(ticketId, {
      authorId: interaction.user.id,
      content: `Ticket assumido por ${interaction.user.tag}.`,
      eventType: "ticket.claimed",
      guildId: interaction.guildId!
    }).catch(() => null);
    await interaction.message.edit(createOpenTicketPayload(ticketId, updatedTicket?.categoryName ?? ticket.categoryName ?? updatedTicket?.subject ?? ticket.subject ?? "Atendimento", updatedTicket?.openerId ?? ticket.openerId, interaction.user.id, "Em análise")).catch(() => null);
    return;
  }

  if (action === "close") {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${CLOSE_MODAL_PREFIX}${ticketId}`)
        .setTitle("Finalizar Ticket")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo do fechamento").setRequired(true).setStyle(TextInputStyle.Paragraph).setMaxLength(900)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("result").setLabel("Resultado da análise").setRequired(true).setStyle(TextInputStyle.Paragraph).setMaxLength(900)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("notes").setLabel("Observações internas").setRequired(false).setStyle(TextInputStyle.Paragraph).setMaxLength(900)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("generatePassword").setLabel("Gerar senha temporária? Sim/Não").setRequired(true).setStyle(TextInputStyle.Short).setValue("Sim").setMaxLength(3)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("ttl").setLabel("Validade da senha temporária em horas").setRequired(true).setStyle(TextInputStyle.Short).setValue("72").setMaxLength(4))
        )
    );
    return;
  }

  await interaction.reply({ content: "Ação ainda não configurada para este painel.", flags: MessageFlags.Ephemeral });
}

async function handleTicketStatus(interaction: StringSelectMenuInteraction, context: BotContext) {
  const ticketId = interaction.customId.slice(TICKET_STATUS_PREFIX.length);
  const status = interaction.values[0];
  const label = STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
  const ticket = await context.api.getTicket(ticketId);
  if (!ticket) {
    await interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id)) {
    await interaction.reply({ content: "Quem abriu este ticket nao pode alterar status nem usar os botoes internos do atendimento.", flags: MessageFlags.Ephemeral });
    return;
  }
  const updatedTicket = await context.api.updateTicketStatus(ticketId, { status });
  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Status alterado para ${label}.`,
    eventType: "ticket.status_changed",
    guildId: interaction.guildId!
  }).catch(() => null);
  await interaction.update(createOpenTicketPayload(ticketId, updatedTicket?.categoryName ?? ticket.categoryName ?? updatedTicket?.subject ?? ticket.subject ?? "Atendimento", updatedTicket?.openerId ?? ticket.openerId, updatedTicket?.responsibleUserId ?? ticket.responsibleUserId ?? null, label));
}

async function handleTicketCloseModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const ticketId = interaction.customId.slice(CLOSE_MODAL_PREFIX.length);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const currentTicket = await context.api.getTicket(ticketId);
  if (!currentTicket) {
    await interaction.editReply("Nao consegui localizar o ticket.");
    return;
  }
  if (isTicketOpener(currentTicket, interaction.user.id)) {
    await interaction.editReply("Quem abriu este ticket nao pode finalizar nem usar os botoes internos do atendimento.");
    return;
  }

  const ticket = await context.api.updateTicketStatus(ticketId, {
    closedAt: new Date().toISOString(),
    closedById: interaction.user.id,
    closeReason: interaction.fields.getTextInputValue("reason"),
    finalResult: interaction.fields.getTextInputValue("result"),
    internalNotes: interaction.fields.getTextInputValue("notes") || null,
    status: "CLOSED"
  });

  if (!ticket || !interaction.channel || !("messages" in interaction.channel)) {
    await interaction.editReply("Nao consegui localizar o ticket para gerar o transcript.");
    return;
  }

  await lockTicketChannel(interaction.channel as TextChannel, ticket.openerId);
  const messages = await collectChannelMessages(interaction.channel as TextChannel);
  const transcript = await context.api.createTranscript({
    categoryName: ticket.categoryName ?? ticket.subject,
    channelId: ticket.channelId,
    channelName: (interaction.channel as TextChannel).name,
    closeReason: ticket.closeReason,
    closedAt: new Date().toISOString(),
    closedById: interaction.user.id,
    finalResult: ticket.finalResult,
    generateTemporaryPassword: /^s/i.test(interaction.fields.getTextInputValue("generatePassword")),
    guildId: interaction.guildId!,
    guildName: interaction.guild?.name ?? null,
    internalNotes: interaction.fields.getTextInputValue("notes") || null,
    isPartial: false,
    messages,
    openedById: ticket.openerId,
    ownerId: ticket.ownerId ?? ticket.openerId,
    participants: buildParticipants(messages, ticket.openerId, ticket.responsibleUserId),
    responsibleUserId: ticket.responsibleUserId,
    temporaryPasswordTtlHours: Number(interaction.fields.getTextInputValue("ttl")) || 72,
    ticketId,
    type: ticket.categoryName?.toLowerCase().includes("den") ? "Denuncia" : "Ticket"
  });

  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Transcript ${transcript.transcript.id} gerado.`,
    eventType: "transcript.generated",
    guildId: interaction.guildId!
  }).catch(() => null);

  await sendTranscriptLog(interaction.guild!, context, transcript, ticket, interaction.user.id);
  await interaction.editReply(`Ticket finalizado. Transcript gerado: ${transcript.transcript.id}.`);
}

function createTicketPanelPayload(settings: GuildSettings, guild: Guild | null = null) {
  const options = settings.ticketPanelOptions.filter((option) => option.enabled).slice(0, 25);

  if (!options.length) {
    return null;
  }

  const contentBlocks = [
    `## ${settings.ticketPanelTitle || "Central de Suporte"}`,
    settings.ticketPanelDescription || "Precisa de ajuda? Abra um ticket e nossa equipe ira atende-lo em breve.",
    settings.ticketPanelInfoText,
    settings.ticketPanelFooterText ? `-# ${settings.ticketPanelFooterText}` : null
  ].filter((block): block is string => Boolean(block?.trim()));
  const imageUrl = resolveImageUrl(settings.ticketPanelImage);
  const action = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_PANEL_CUSTOM_ID)
          .setPlaceholder(settings.ticketPanelPlaceholder || "Selecione o tipo de atendimento")
          .addOptions(options.map(toSelectOption))
      );
  return renderComponentsV2Panel({ accentColor: parseColor(settings.ticketPanelColor), actions: [action], description: contentBlocks[1] ?? "", fields: contentBlocks.slice(2), guild, image: settings.ticketPanelImage && imageUrl ? { ...settings.ticketPanelImage, imageUrl } : null, moduleId: "ticket", title: `${systemEmojiText("interrogacao", guild)} ${contentBlocks[0]?.replace(/^##\s*/, "") ?? "Central de Suporte"}` });
}

async function publishConfiguredTicketPanelUnlocked(client: Client, context: BotContext, guildId: string) {
  const settings = await getFreshGuildSettings(context, guildId, client.user?.id);

  if (!settings.ticketEnabled) {
    throw new Error("Sistema de tickets desativado.");
  }

  if (!settings.ticketPanelChannelId) {
    throw new Error("Canal do painel de tickets nao configurado.");
  }

  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new Error("Servidor nao encontrado no cache do bot.");
  }

  const channel = await guild.channels.fetch(settings.ticketPanelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("Canal do painel de tickets indisponivel.");
  }

  const payload = createTicketPanelPayload(settings, guild);
  if (!payload) {
    throw new Error("Configure pelo menos uma opcao ativa para o painel de ticket.");
  }

  const textChannel = channel as TextChannel;
  let panelMessage: Message | null = null;

  if (settings.ticketPanelMessageId) {
    panelMessage = await textChannel.messages.fetch(settings.ticketPanelMessageId).catch(() => null);
    if (panelMessage) {
      panelMessage = await panelMessage.edit(payload).catch(() => null);
    }
  }

  if (!panelMessage) {
    panelMessage = await textChannel.send(payload);
  }

  await context.api.updateTicketPanelState(guildId, {
    channelId: textChannel.id,
    messageId: panelMessage.id
  });

  return panelMessage.id;
}

async function createTicketChannel(guild: Guild, settings: GuildSettings, openerId: string, option: TicketPanelOption) {
  if (!settings.ticketCategoryId || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return null;
  }

  const safeName = option.label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "ticket";

  return guild.channels.create({
    name: `ticket-${safeName}-${openerId.slice(-4)}`,
    parent: settings.ticketCategoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: openerId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: guild.members.me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory]
      }
    ],
    reason: `Ticket aberto por ${openerId}: ${option.label}`,
    type: ChannelType.GuildText
  }).then((channel) => channel as TextChannel);
}

function createOpenTicketPayload(ticketId: string, category: string, openerId: string, responsibleUserId: string | null = null, status = "Aguardando atendimento") {
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}claim:${ticketId}`).setEmoji(systemComponentEmoji("homem")).setLabel("Assumir Ticket").setStyle(ButtonStyle.Primary).setDisabled(Boolean(responsibleUserId)),
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}add:${ticketId}`).setEmoji(systemComponentEmoji("acessar")).setLabel("Adicionar Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}remove:${ticketId}`).setEmoji(systemComponentEmoji("porta")).setLabel("Remover Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}close:${ticketId}`).setEmoji(systemComponentEmoji("visto")).setLabel("Finalizar Ticket").setStyle(ButtonStyle.Danger)
  );
  const statusMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${TICKET_STATUS_PREFIX}${ticketId}`)
      .setPlaceholder("Alterar Status")
      .addOptions(STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })))
  );

  return {
    allowedMentions: { users: [openerId, responsibleUserId].filter(Boolean) as string[] },
    components: [actions, statusMenu],
    content: [
      "## Ticket de Denúncia Aberto",
      `Categoria: ${category}`,
      `Autor: <@${openerId}>`,
      `Responsável atual: ${responsibleUserId ? `<@${responsibleUserId}>` : "Nenhum"}`,
      `Status: ${status}`,
      `ID do Ticket: #${ticketId}`,
      "",
      "Explique sua denúncia com o máximo de detalhes possível. Envie prints, vídeos ou provas se necessário."
    ].join("\n")
  };
}

async function collectChannelMessages(channel: TextChannel) {
  const collected: Message[] = [];
  let before: string | undefined;
  do {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
  } while (before);

  return collected
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => ({
      id: message.id,
      authorAvatarUrl: message.author.displayAvatarURL(),
      authorId: message.author.id,
      authorName: message.author.tag,
      authorRoleIds: message.member?.roles.cache.map((role) => role.id) ?? [],
      content: message.content,
      attachments: message.attachments.map((attachment) => ({
        contentType: attachment.contentType,
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        url: attachment.url
      })),
      embeds: message.embeds.map((embed) => embed.toJSON()),
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null
    }));
}

function buildParticipants(messages: Awaited<ReturnType<typeof collectChannelMessages>>, openerId: string, responsibleUserId?: string | null) {
  const participants = new Map<string, { id: string; name: string; role: string | null }>();
  for (const message of messages) {
    if (message.authorId) participants.set(message.authorId, { id: message.authorId, name: message.authorName, role: message.authorId === openerId ? "Autor" : null });
  }
  if (responsibleUserId) participants.set(responsibleUserId, { id: responsibleUserId, name: `@${responsibleUserId}`, role: "Responsável" });
  return [...participants.values()];
}

function isTicketOpener(ticket: TicketRecord, userId: string) {
  return ticket.openerId === userId || ticket.ownerId === userId;
}

async function lockTicketChannel(channel: TextChannel, openerId: string) {
  await channel.permissionOverwrites.edit(openerId, { SendMessages: false }).catch(() => null);
}

async function sendTranscriptLog(guild: Guild, context: BotContext, transcript: Awaited<ReturnType<BotContext["api"]["createTranscript"]>>, ticket: { categoryName?: string | null; subject: string; openerId: string; responsibleUserId?: string | null; createdAt: string; finalResult?: string | null }, closedById: string) {
  const settings = await getFreshGuildSettings(context, guild.id, guild.client.user?.id).catch(() => null);
  const logChannelId = settings?.reportSystem?.transcriptChannelId || settings?.logChannelId;
  const logChannel = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;
  if (!logChannel?.isTextBased() || !("send" in logChannel)) return;

  const url = resolveTranscriptUrl(transcript);
  const downloadUrl = resolveTranscriptDownloadUrl(transcript);
  const createdAt = new Date(ticket.createdAt);
  const closedAt = transcript.transcript.closedAt ? new Date(transcript.transcript.closedAt) : new Date();
  await (logChannel as TextChannel).send(renderComponentsV2Panel({
    accentColor: 0xf2b84b,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setEmoji(systemComponentEmoji("link", guild)).setLabel("Abrir Transcript").setStyle(ButtonStyle.Link).setURL(url),
        new ButtonBuilder().setEmoji(systemComponentEmoji("prancheta", guild)).setLabel("Baixar Transcript").setStyle(ButtonStyle.Link).setURL(downloadUrl),
        new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}noop:${transcript.transcript.id}`).setEmoji(systemComponentEmoji("link", guild)).setLabel("Copiar Link").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}newpass:${transcript.transcript.id}`).setEmoji(systemComponentEmoji("relogio", guild)).setLabel("Gerar Nova Senha").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}revoke:${transcript.transcript.id}`).setEmoji(systemComponentEmoji("perigo", guild)).setLabel("Revogar Senhas").setStyle(ButtonStyle.Danger)
      )
    ],
    description: "O atendimento foi finalizado e o transcript foi salvo com seguranca. O acesso ao link e senha deve permanecer restrito ao canal de logs configurado.",
    fields: [
      `**Informacoes do Ticket**\n**Ticket:** #${transcript.transcript.ticketId ?? transcript.transcript.id}\n**Canal:** ${transcript.transcript.channelName ? `#${transcript.transcript.channelName}` : "-"}\n**Tipo:** ${transcript.transcript.type}\n**Status:** ${formatTranscriptStatus(ticket.finalResult ?? transcript.transcript.status, guild)}`,
      `**Envolvidos**\n**Aberto por:** <@${ticket.openerId}>\n**Finalizado por:** <@${closedById}>\n**Responsavel:** ${ticket.responsibleUserId ? `<@${ticket.responsibleUserId}>` : "Nao assumido"}\n**Categoria:** ${ticket.categoryName ?? ticket.subject}`,
      `**Dados do Caso**\n**Criado em:** <t:${Math.floor(createdAt.getTime() / 1000)}:F>\n**Fechado em:** <t:${Math.floor(closedAt.getTime() / 1000)}:F>\n**Tempo total:** ${formatElapsed(createdAt, closedAt)}\n**Resumo:** ${transcript.transcript.messageCount ?? 0} mensagens, ${transcript.transcript.attachmentCount ?? 0} anexos, ${transcript.transcript.participantCount ?? 0} participantes`,
      `**Transcript e Seguranca**\n**Link:** ${url}\n**Protecao:** Senha obrigatoria\n**Senha temporaria:** gerada e mantida oculta\n**Expira em:** ${transcript.temporaryPasswordExpiresAt ? `<t:${Math.floor(Date.parse(transcript.temporaryPasswordExpiresAt) / 1000)}:D>` : "configuracao padrao"}`
    ],
    guild,
    image: null,
    moduleId: "ticket-transcript",
    title: `${systemEmojiText("folha", guild)} Transcript Gerado`
  })).catch(() => null);
}

function formatTranscriptStatus(status: string, guild: Guild | null = null) {
  const normalized = status.toLowerCase();
  if (normalized.includes("final") || normalized.includes("resolv")) return `${systemStatusEmoji("active", guild)} ${status}`;
  if (normalized.includes("arquiv")) return `${systemEmojiText("caixa", guild)} ${status}`;
  if (normalized.includes("pend") || normalized.includes("aguard")) return `${systemStatusEmoji("pending", guild)} ${status}`;
  if (normalized.includes("recus") || normalized.includes("neg")) return `${systemStatusEmoji("danger", guild)} ${status}`;
  return `${systemEmojiText("perigo", guild)} ${status}`;
}

function formatElapsed(start: Date, end: Date) {
  const totalMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}min` : null
  ].filter(Boolean).join(" ") || "menos de 1min";
}

function toSelectOption(option: TicketPanelOption) {
  const builder = new StringSelectMenuOptionBuilder()
    .setLabel(option.label)
    .setValue(option.value);

  if (option.description) {
    builder.setDescription(option.description);
  }

  const emoji = parseSelectEmoji(option.emoji);
  if (emoji) {
    builder.setEmoji(emoji);
  }

  return builder;
}

function parseSelectEmoji(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const custom = normalized.match(/^<a?:([a-zA-Z0-9_]+):(\d{5,32})>$/);
  if (custom) {
    return { id: custom[2], name: custom[1], animated: normalized.startsWith("<a:") };
  }

  return normalized;
}

function resolveImageUrl(panelImage: PanelImageSettings | null) {
  if (!panelImage?.imageEnabled || !panelImage.imageUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(panelImage.imageUrl)) {
    return panelImage.imageUrl;
  }

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${panelImage.imageUrl.startsWith("/") ? panelImage.imageUrl : `/${panelImage.imageUrl}`}` : null;
}

function mediaGalleryComponent(imageUrl: string) {
  return {
    type: 12,
    items: [{
      media: { url: imageUrl },
      description: "ticket image"
    }]
  };
}

function parseColor(value: string | null | undefined) {
  const normalized = value?.replace("#", "") ?? "";
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0xffd500;
}
