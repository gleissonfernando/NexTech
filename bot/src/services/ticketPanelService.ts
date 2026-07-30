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
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings, PanelImageSettings, TicketPanelOption } from "../types";
import { resetSelectMenuMessage } from "../utils/selectMenuReset";
import type { TicketPanelPublishAck } from "../websocket/socketClient";
import type { TicketRecord } from "./apiClient";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { componentsV2Payload, renderComponentsV2Panel, resolvePanelImageUrl } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";
import { buildTranscriptLuaCommand, resolveTranscriptTemporaryPassword, resolveTranscriptUrl } from "./transcriptUrlService";

const TICKET_PANEL_CUSTOM_ID = "ticket_panel_select";
const TICKET_ACTION_PREFIX = "ticket_action:";
const TICKET_STATUS_PREFIX = "ticket_status:";
const CLOSE_MODAL_PREFIX = "ticket_close:";
const OPEN_MODAL_PREFIX = "ticket_open:";
const OPEN_BUTTON_ID = "ticket_open_button";
const OPEN_CATEGORY_PREFIX = "ticket_open_category:";
const OPEN_CLIENT_PREFIX = "ticket_open_client:";
const OPEN_CONTINUE_PREFIX = "ticket_open_continue:";
let ticketPanelServiceStarted = false;
const panelPublicationLocks = new Map<string, Promise<string | null>>();
const openTicketSessions = new Map<string, { clientStatus: "yes" | "no" | null; createdAt: number; optionValue: string | null; userId: string }>();
const OPEN_TICKET_SESSION_TTL_MS = 10 * 60 * 1000;
const STATUS_OPTIONS = [
  { label: "Aguardando atendimento", value: "OPEN" },
  { label: "Em análise", value: "IN_ANALYSIS" },
  { label: "Aguardando provas", value: "WAITING_EVIDENCE" },
  { label: "Aguardando usuário", value: "WAITING_USER" },
  { label: "Resolvido", value: "RESOLVED" },
  { label: "Negado", value: "DENIED" },
  { label: "Encerrado", value: "CLOSED" }
];
type TranscriptCreateResult = Awaited<ReturnType<BotContext["api"]["createTranscript"]>>;

export async function publishTicketPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Comando disponível apenas em servidores.", ephemeral: true });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);

  if (!settings.ticketEnabled) {
    await interaction.reply({ content: "O sistema de tickets está desativado na Dashboard.", ephemeral: true });
    return;
  }

  const payload = createTicketPanelPayload(settings, interaction.guild);

  if (!payload) {
    await interaction.reply({ content: "Configure pelo menos uma opção ativa para o painel de ticket.", ephemeral: true });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: "Não consegui enviar o painel neste canal.", ephemeral: true });
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

  context.socket.onTicketPanelPublish((payload, ack?: TicketPanelPublishAck) => {
    const runtimeBotId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null;
    if (!isBotModuleEnabled("tickets") || (payload.botId && runtimeBotId && payload.botId !== runtimeBotId)) return;

    void publishConfiguredTicketPanel(client, context, payload.guildId)
      .then((messageId) => ack?.({ ok: true, messageId }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ticket-panel] falha ao publicar painel em ${payload.guildId}:`, message);
        ack?.({ ok: false, error: message });
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

  if (interaction.isButton() && interaction.customId === OPEN_BUTTON_ID) {
    await handleTicketOpenButton(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(OPEN_CONTINUE_PREFIX)) {
    await handleTicketOpenContinue(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(TICKET_ACTION_PREFIX)) {
    await handleTicketAction(interaction, context);
    return true;
  }

  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith(OPEN_CATEGORY_PREFIX) || interaction.customId.startsWith(OPEN_CLIENT_PREFIX))) {
    await handleTicketPreOpenSelect(interaction, context);
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

  if (interaction.isModalSubmit() && interaction.customId.startsWith(OPEN_MODAL_PREFIX)) {
    await handleTicketOpenModal(interaction, context);
    return true;
  }

  if (!interaction.isStringSelectMenu() || interaction.customId !== TICKET_PANEL_CUSTOM_ID) {
    return false;
  }

  const selectedValue = interaction.values[0];
  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedValue);

  if (!settings?.ticketEnabled || !option) {
    await interaction.reply({ content: "Esta opção de ticket não está mais disponível.", ephemeral: true });
    return true;
  }

  void resetSelectMenuMessage(interaction);

  const token = createOpenTicketSession(interaction.user.id, option.value);
  await interaction.reply(renderTicketPreOpenPayload(settings, token, interaction.guild, getOpenTicketSession(token), "Categoria selecionada. Informe se você é cliente para continuar."));

  return true;
}

async function handleTicketOpenButton(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const options = activeTicketOptions(settings);
  if (!settings?.ticketEnabled || !options.length) {
    await interaction.reply({ content: "Nenhuma categoria de ticket ativa foi configurada na Dashboard.", flags: MessageFlags.Ephemeral });
    return;
  }

  const token = createOpenTicketSession(interaction.user.id);
  await interaction.reply(renderTicketPreOpenPayload(settings, token, interaction.guild, getOpenTicketSession(token)));
}

async function handleTicketPreOpenSelect(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;

  const isCategory = interaction.customId.startsWith(OPEN_CATEGORY_PREFIX);
  const token = interaction.customId.slice((isCategory ? OPEN_CATEGORY_PREFIX : OPEN_CLIENT_PREFIX).length);
  const session = getOpenTicketSession(token);
  if (!session || session.userId !== interaction.user.id || isExpiredOpenTicketSession(session)) {
    openTicketSessions.delete(token);
    await interaction.reply({ content: "Esta abertura expirou. Clique em Abrir Ticket novamente.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const selectedValue = interaction.values[0] ?? null;
  if (isCategory) {
    const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedValue);
    if (!settings?.ticketEnabled || !option) {
      await interaction.reply({ content: "Esta categoria de ticket não está mais disponível.", flags: MessageFlags.Ephemeral });
      return;
    }
    session.optionValue = option.value;
  } else if (selectedValue === "yes" || selectedValue === "no") {
    session.clientStatus = selectedValue;
  }

  await interaction.update(ticketPreOpenUpdatePayload(settings, token, interaction.guild, session));
}

async function handleTicketOpenContinue(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;

  const token = interaction.customId.slice(OPEN_CONTINUE_PREFIX.length);
  const session = getOpenTicketSession(token);
  if (!session || session.userId !== interaction.user.id || isExpiredOpenTicketSession(session)) {
    openTicketSessions.delete(token);
    await interaction.reply({ content: "Esta abertura expirou. Clique em Abrir Ticket novamente.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!session.optionValue || !session.clientStatus) {
    const missing = [
      !session.optionValue ? "categoria" : null,
      !session.clientStatus ? "se você é cliente" : null
    ].filter(Boolean).join(" e ");
    await interaction.reply({ content: `Antes de continuar, selecione ${missing}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === session.optionValue);
  if (!settings?.ticketEnabled || !option) {
    await interaction.reply({ content: "Esta categoria de ticket não está mais disponível.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(createOpenTicketModal(token));
}

async function handleTicketOpenModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;

  const token = interaction.customId.slice(OPEN_MODAL_PREFIX.length);
  const session = consumeOpenTicketSession(token);
  if (!session || session.userId !== interaction.user.id) {
    await interaction.reply({ content: "Este formulário expirou. Selecione a categoria novamente no painel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === session.optionValue);

  if (!settings?.ticketEnabled || !option || !session.clientStatus) {
    await interaction.reply({ content: "Esta categoria de ticket não está mais disponível.", flags: MessageFlags.Ephemeral });
    return;
  }

  const subject = normalizeTicketSubject(interaction.fields.getTextInputValue("subject"));
  const details = interaction.fields.getTextInputValue("details")?.trim() || null;
  const clientLabel = session.clientStatus === "yes" ? "Sim" : "Não";
  if (!subject) {
    await interaction.reply({ content: "Informe um assunto com pelo menos 10 caracteres.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let channelId: string | null = null;
  try {
    const channel = await createTicketChannel(interaction.guild, settings, interaction.user.id, option, subject);
    channelId = channel?.id ?? null;
  } catch (error) {
    console.warn("[ticket-panel] não foi possível criar canal de ticket:", error instanceof Error ? error.message : error);
    await context.api.postLog({
      guildId: interaction.guild.id,
      message: `Falha ao criar canal de ticket para ${interaction.user.tag}: ${error instanceof Error ? error.message : String(error)}`,
      metadata: {
        categoryId: option.value,
        categoryName: option.label,
        client: clientLabel,
        openerId: interaction.user.id,
        subject
      },
      type: "ticket.channel_create_failed",
      userId: interaction.user.id
    }).catch(() => null);
  }

  const ticket = await context.api.createTicket({
    channelId,
    categoryId: option.value,
    categoryName: option.label,
    guildId: interaction.guild.id,
    openerId: interaction.user.id,
    responsibleRoleId: option.mentionRoleId ?? null,
    subject
  });

  if (channelId) {
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send(createOpenTicketPayload(ticket.ticket.id, option.label, interaction.user.id, null, "Aguardando atendimento", option.mentionRoleId ?? null, subject, details, interaction.guild, clientLabel));
    }
    await context.api.recordTicketEvent(ticket.ticket.id, {
      authorId: interaction.user.id,
      content: `Ticket criado na categoria ${option.label}. Assunto: ${subject}. Cliente: ${clientLabel}.`,
      eventType: "ticket.created",
      guildId: interaction.guild.id,
      metadata: {
        categoryId: option.value,
        categoryName: option.label,
        client: clientLabel,
        details,
        subject
      }
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
    await interaction.reply({ content: "Ticket inválido.", flags: MessageFlags.Ephemeral });
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
    await interaction.reply({ content: "Ticket não encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id)) {
    await interaction.reply({ content: "Quem abriu este ticket não pode assumir nem usar os botões internos do atendimento.", flags: MessageFlags.Ephemeral });
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
    await interaction.message.edit(createOpenTicketPayload(
      ticketId,
      updatedTicket?.categoryName ?? ticket.categoryName ?? updatedTicket?.subject ?? ticket.subject ?? "Atendimento",
      updatedTicket?.openerId ?? ticket.openerId,
      interaction.user.id,
      "Em análise",
      updatedTicket?.responsibleRoleId ?? ticket.responsibleRoleId ?? null,
      updatedTicket?.subject ?? ticket.subject,
      null,
      interaction.guild
    )).catch(() => null);
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
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("notes").setLabel("Observações internas").setRequired(false).setStyle(TextInputStyle.Paragraph).setMaxLength(900))
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
    await interaction.reply({ content: "Ticket não encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id)) {
    await interaction.reply({ content: "Quem abriu este ticket não pode alterar status nem usar os botões internos do atendimento.", flags: MessageFlags.Ephemeral });
    return;
  }
  const updatedTicket = await context.api.updateTicketStatus(ticketId, { status });
  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Status alterado para ${label}.`,
    eventType: "ticket.status_changed",
    guildId: interaction.guildId!
  }).catch(() => null);
  await interaction.update(createOpenTicketPayload(
    ticketId,
    updatedTicket?.categoryName ?? ticket.categoryName ?? updatedTicket?.subject ?? ticket.subject ?? "Atendimento",
    updatedTicket?.openerId ?? ticket.openerId,
    updatedTicket?.responsibleUserId ?? ticket.responsibleUserId ?? null,
    label,
    updatedTicket?.responsibleRoleId ?? ticket.responsibleRoleId ?? null,
    updatedTicket?.subject ?? ticket.subject,
    null,
    interaction.guild
  ));
}

async function handleTicketCloseModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const ticketId = interaction.customId.slice(CLOSE_MODAL_PREFIX.length);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const currentTicket = await context.api.getTicket(ticketId);
  if (!currentTicket) {
    await interaction.editReply("Não consegui localizar o ticket.");
    return;
  }
  if (isTicketOpener(currentTicket, interaction.user.id)) {
    await interaction.editReply("Quem abriu este ticket não pode finalizar nem usar os botões internos do atendimento.");
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
    await interaction.editReply("Não consegui localizar o ticket para gerar o transcript.");
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
    generateTemporaryPassword: true,
    guildId: interaction.guildId!,
    guildName: interaction.guild?.name ?? null,
    internalNotes: interaction.fields.getTextInputValue("notes") || null,
    isPartial: false,
    messages,
    openedById: ticket.openerId,
    ownerId: ticket.ownerId ?? ticket.openerId,
    participants: buildParticipants(messages, ticket.openerId, ticket.responsibleUserId),
    responsibleUserId: ticket.responsibleUserId,
    ticketId,
    type: ticket.categoryName?.toLowerCase().includes("den") ? "Denúncia" : "Ticket"
  });

  const dmSent = await sendTranscriptDm(interaction.guild!, transcript, ticket).catch((error) => {
    console.warn("[ticket-panel] falha ao enviar DM do transcript:", error instanceof Error ? error.message : error);
    return false;
  });

  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Transcript ${transcript.transcript.id} gerado. DM ao autor: ${dmSent ? "enviada" : "falhou"}.`,
    eventType: "transcript.generated",
    guildId: interaction.guildId!,
    metadata: {
      dmSent,
      expiresAt: transcript.temporaryPasswordExpiresAt ?? transcript.transcript.expiresAt ?? null,
      transcriptId: transcript.transcript.id,
      url: resolveTranscriptUrl(transcript)
    }
  }).catch(() => null);

  await sendTranscriptLog(interaction.guild!, context, transcript, ticket, interaction.user.id);
  await interaction.editReply(`Ticket finalizado. Transcript gerado: ${transcript.transcript.id}. DM ${dmSent ? "enviada ao autor" : "não enviada; verifique se a DM do usuário está aberta"}.`);
}

function createTicketPanelPayload(settings: GuildSettings, guild: Guild | null = null): ReturnType<typeof renderComponentsV2Panel> | null {
  const options = activeTicketOptions(settings);

  if (!options.length) {
    return null;
  }

  const title = normalizeTicketPanelTitle(settings.ticketPanelTitle, guild);
  const description = normalizeTicketPanelDescription(settings.ticketPanelDescription);
  const infoText = normalizeTicketPanelInfo(settings.ticketPanelInfoText);
  const configuredMedia = [
    resolveTicketPanelMedia(settings.ticketPanelBannerImage ?? settings.ticketPanelImage, "below_title"),
    resolveTicketPanelMedia(settings.ticketPanelSecondaryBannerImage, "below_title")
  ].filter((item): item is PanelImageSettings & { imageUrl: string } => Boolean(item));
  const bannerUrl = configuredMedia
    .map((item) => resolvePanelImageUrl(item.imageUrl, item))
    .find((url): url is string => Boolean(url))
    ?? defaultTicketBannerUrl();
  const action = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_BUTTON_ID)
      .setEmoji(systemComponentEmoji("prancheta", guild))
      .setLabel("Abrir Ticket")
      .setStyle(ButtonStyle.Primary)
  );

  const components: unknown[] = [
    { type: 10, content: `## ${title}\n${description}` }
  ];

  if (bannerUrl) {
    components.push({
      type: 12,
      items: [{ media: { url: bannerUrl }, description: "Banner do atendimento" }]
    });
  }

  components.push(
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `## Regras Importantes\n${formatTicketRules(infoText)}` },
    { type: 14, divider: true, spacing: 1 },
    action
  );

  return componentsV2Payload({
    accentColor: parseColor(settings.ticketPanelColor),
    components,
    footer: null,
    guild
  }) as ReturnType<typeof renderComponentsV2Panel>;
}

function ticketPanelTitle(guild: Guild | null) {
  return `ATENDIMENTO |${guild?.name ?? "&F Studio"}`;
}

function normalizeTicketPanelTitle(value: string | null | undefined, guild: Guild | null) {
  const normalized = value?.trim();
  if (!normalized || normalized === "Central de Suporte") return ticketPanelTitle(guild);
  return normalized;
}

function normalizeTicketPanelDescription(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "Precisa de ajuda? Abra um ticket e nossa equipe ira atende-lo em breve.") {
    return "Para abrir um ticket selecione uma categoria abaixo";
  }
  return normalized;
}

function normalizeTicketPanelInfo(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "Horario de atendimento: Seg-Sex, 9h-18h\nDescreva seu problema com detalhes para um atendimento mais rapido.") {
    return "Não flode menções à equipe\nEm caso de transferência de bot é necessário comprovante";
  }
  return normalized;
}

function normalizeTicketPanelPlaceholder(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "Selecione o tipo de atendimento") {
    return "Selecione uma categoria de atendimento...";
  }
  return normalized;
}

function defaultTicketBannerUrl() {
  return resolvePanelImageUrl("/ticket-atendimento-banner.png");
}

function formatTicketRules(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const normalized = line.replace(/^[•\-]\s*/, "");
      return `> - **${normalized}**`;
    })
    .join("\n");
}

function createOpenTicketSession(userId: string, optionValue: string | null = null) {
  cleanupOpenTicketSessions();
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 24);
  openTicketSessions.set(token, { clientStatus: null, createdAt: Date.now(), optionValue, userId });
  return token;
}

function getOpenTicketSession(token: string) {
  cleanupOpenTicketSessions();
  return openTicketSessions.get(token) ?? null;
}

function consumeOpenTicketSession(token: string) {
  cleanupOpenTicketSessions();
  const session = openTicketSessions.get(token);
  openTicketSessions.delete(token);
  if (!session || isExpiredOpenTicketSession(session)) {
    return null;
  }
  return session;
}

function isExpiredOpenTicketSession(session: { createdAt: number }) {
  return Date.now() - session.createdAt > OPEN_TICKET_SESSION_TTL_MS;
}

function cleanupOpenTicketSessions() {
  const expiresBefore = Date.now() - OPEN_TICKET_SESSION_TTL_MS;
  for (const [token, session] of openTicketSessions) {
    if (session.createdAt < expiresBefore) {
      openTicketSessions.delete(token);
    }
  }
}

function normalizeTicketSubject(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 100);
  return normalized.length >= 10 ? normalized : null;
}

function activeTicketOptions(settings: GuildSettings | null | undefined) {
  return (settings?.ticketPanelOptions ?? [])
    .filter((option) => option.enabled)
    .slice(0, 25);
}

function createOpenTicketModal(token: string) {
  return new ModalBuilder()
    .setCustomId(`${OPEN_MODAL_PREFIX}${token}`)
    .setTitle("Abrir Novo Ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("subject")
          .setLabel("Assunto do Ticket")
          .setPlaceholder("Descreva resumidamente o motivo do seu ticket.")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
          .setMinLength(10)
          .setMaxLength(100)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Detalhes")
          .setPlaceholder("Não compartilhe senhas, tokens ou dados confidenciais.")
          .setRequired(false)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(900)
      )
    );
}

function renderTicketPreOpenPayload(
  settings: GuildSettings,
  token: string,
  guild: Guild,
  session: { clientStatus: "yes" | "no" | null; optionValue: string | null } | null,
  notice: string | null = null
) : InteractionReplyOptions {
  return componentsV2Payload({
    accentColor: parseColor(settings.ticketPanelColor),
    components: ticketPreOpenComponents(settings, token, guild, session, notice),
    ephemeral: true,
    footer: null,
    guild
  }) as InteractionReplyOptions;
}

function ticketPreOpenUpdatePayload(
  settings: GuildSettings | null,
  token: string,
  guild: Guild,
  session: { clientStatus: "yes" | "no" | null; optionValue: string | null } | null,
  notice: string | null = null
) : InteractionUpdateOptions {
  const payload = componentsV2Payload({
    accentColor: parseColor(settings?.ticketPanelColor ?? null),
    components: ticketPreOpenComponents(settings, token, guild, session, notice),
    footer: null,
    guild
  });

  return {
    allowedMentions: payload.allowedMentions,
    components: payload.components
  } as InteractionUpdateOptions;
}

function ticketPreOpenComponents(
  settings: GuildSettings | null,
  token: string,
  guild: Guild,
  session: { clientStatus: "yes" | "no" | null; optionValue: string | null } | null,
  notice: string | null
) {
  const options = activeTicketOptions(settings);
  const selectedOption = options.find((option) => option.value === session?.optionValue) ?? null;
  const selectedClient = session?.clientStatus === "yes" ? "Sim, sou cliente" : session?.clientStatus === "no" ? "Não sou cliente" : null;
  const canContinue = Boolean(selectedOption && selectedClient);
  const categorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${OPEN_CATEGORY_PREFIX}${token}`)
      .setPlaceholder("Selecione a categoria do ticket")
      .addOptions(options.map((option) => toSelectOption(option).setDefault(option.value === session?.optionValue)))
  );
  const clientSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${OPEN_CLIENT_PREFIX}${token}`)
      .setPlaceholder("Você é cliente?")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setEmoji(systemStatusEmoji("success", guild))
          .setLabel("Sim, sou cliente")
          .setValue("yes")
          .setDescription("Já sou cliente e preciso de atendimento.")
          .setDefault(session?.clientStatus === "yes"),
        new StringSelectMenuOptionBuilder()
          .setEmoji(systemStatusEmoji("danger", guild))
          .setLabel("Não sou cliente")
          .setValue("no")
          .setDescription("Ainda não sou cliente ou quero conhecer os serviços.")
          .setDefault(session?.clientStatus === "no")
      )
  );
  const continueButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${OPEN_CONTINUE_PREFIX}${token}`)
      .setEmoji(systemActionEmojiCompat("open", guild))
      .setLabel("Continuar")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canContinue)
  );

  return [
    {
      type: 10,
      content: [
        `## ${systemEmojiText("prancheta", guild)} Abrir Novo Ticket`,
        `${systemStatusEmoji("warning", guild)} Este formulário será enviado para a equipe de suporte. Não compartilhe senhas ou informações confidenciais.`,
        "",
        `**Categoria:** ${selectedOption ? `${selectedOption.emoji ? `${selectedOption.emoji} ` : ""}${selectedOption.label}` : "Não selecionada"}`,
        `**Cliente:** ${selectedClient ?? "Não informado"}`,
        notice ? `\n${notice}` : ""
      ].filter(Boolean).join("\n")
    },
    { type: 14, divider: true, spacing: 1 },
    categorySelect,
    clientSelect,
    continueButton
  ];
}

function systemActionEmojiCompat(action: "open", guild: Guild) {
  void action;
  return systemComponentEmoji("acessar", guild);
}

async function publishConfiguredTicketPanelUnlocked(client: Client, context: BotContext, guildId: string) {
  const settings = await getFreshGuildSettings(context, guildId, client.user?.id);

  if (!settings.ticketEnabled) {
    throw new Error("Sistema de tickets desativado.");
  }

  if (!settings.ticketPanelChannelId) {
    throw new Error("Canal do painel de tickets não configurado.");
  }

  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new Error("Servidor não encontrado no cache do bot.");
  }

  const channel = await guild.channels.fetch(settings.ticketPanelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("Canal do painel de tickets indisponível.");
  }

  const payload = createTicketPanelPayload(settings, guild);
  if (!payload) {
    throw new Error("Configure pelo menos uma opção ativa para o painel de ticket.");
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

async function createTicketChannel(guild: Guild, settings: GuildSettings, openerId: string, option: TicketPanelOption, subject: string) {
  const categoryId = option.categoryId ?? settings.ticketCategoryId;
  const mentionRoleId = option.mentionRoleId && guild.roles.cache.has(option.mentionRoleId) && option.mentionRoleId !== guild.roles.everyone.id
    ? option.mentionRoleId
    : null;

  if (!categoryId || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return null;
  }

  const safeName = subject
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "ticket";

  return guild.channels.create({
    name: `ticket-${safeName}-${openerId.slice(-4)}`,
    parent: categoryId,
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
      },
      ...(mentionRoleId ? [{
        id: mentionRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }] : [])
    ],
    reason: `Ticket aberto por ${openerId}: ${option.label} - ${subject}`,
    type: ChannelType.GuildText
  }).then((channel) => channel as TextChannel);
}

function createOpenTicketPayload(ticketId: string, category: string, openerId: string, responsibleUserId: string | null = null, status = "Aguardando atendimento", mentionRoleId: string | null = null, subject = category, details: string | null = null, guild: Guild | null = null, clientLabel: string | null = null) {
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}claim:${ticketId}`).setEmoji(systemComponentEmoji("homem", guild)).setLabel("Assumir Ticket").setStyle(ButtonStyle.Primary).setDisabled(Boolean(responsibleUserId)),
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}add:${ticketId}`).setEmoji(systemComponentEmoji("acessar", guild)).setLabel("Adicionar Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}remove:${ticketId}`).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Remover Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}close:${ticketId}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Finalizar Ticket").setStyle(ButtonStyle.Danger)
  );
  const statusMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${TICKET_STATUS_PREFIX}${ticketId}`)
      .setPlaceholder("Alterar Status")
      .addOptions(STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })))
  );
  const mentionLine = mentionRoleId ? `<@&${mentionRoleId}>` : "";
  const createdAt = new Date();

  return {
    allowedMentions: { roles: mentionRoleId ? [mentionRoleId] : [], users: [openerId, responsibleUserId].filter(Boolean) as string[] },
    components: [actions, statusMenu],
    content: [
      mentionLine,
      "## Ticket Aberto",
      `Categoria: ${category}`,
      `Assunto: ${subject}`,
      `Cliente: ${clientLabel ?? "Não informado"}`,
      `Autor: <@${openerId}>`,
      `ID do usuário: ${openerId}`,
      `Servidor: ${guild?.name ?? "Não informado"}`,
      `Data: ${formatTicketDate(createdAt)}`,
      `Hora: ${formatTicketTime(createdAt)}`,
      `Responsável atual: ${responsibleUserId ? `<@${responsibleUserId}>` : "Nenhum"}`,
      `Status: ${status}`,
      `ID do Ticket: #${ticketId}`,
      "",
      details ? `Detalhes iniciais:\n${details}` : "Explique seu atendimento com o máximo de detalhes possível. Envie prints, vídeos ou provas se necessário."
    ].filter(Boolean).join("\n")
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

async function sendTranscriptDm(guild: Guild, transcript: TranscriptCreateResult, ticket: { categoryName?: string | null; subject: string; openerId: string; createdAt: string }) {
  const password = resolveTranscriptTemporaryPassword(transcript);
  if (!password) return false;

  const user = await guild.client.users.fetch(ticket.openerId).catch(() => null);
  if (!user) return false;

  const url = resolveTranscriptUrl(transcript);
  const expiresAt = transcript.temporaryPasswordExpiresAt ?? transcript.transcript.expiresAt ?? null;
  const expiresLine = expiresAt ? `<t:${Math.floor(Date.parse(expiresAt) / 1000)}:D>` : "1 ano após a criação";
  await user.send({
    allowedMentions: { parse: [] },
    content: [
      "Seu atendimento foi finalizado com sucesso.",
      "",
      "Você pode acessar o histórico completo da conversa utilizando o link abaixo.",
      "",
      `Transcript: ${url}`,
      `Senha: ||${password}||`,
      `Validade: ${expiresLine}`,
      "",
      "Por motivos de segurança, compartilhe essa senha apenas com pessoas autorizadas."
    ].join("\n")
  });
  return true;
}

async function sendTranscriptLog(guild: Guild, context: BotContext, transcript: TranscriptCreateResult, ticket: { categoryName?: string | null; subject: string; openerId: string; responsibleUserId?: string | null; createdAt: string; finalResult?: string | null }, closedById: string) {
  const settings = await getFreshGuildSettings(context, guild.id, guild.client.user?.id).catch(() => null);
  const logChannelId = settings?.reportSystem?.transcriptChannelId || settings?.logChannelId;
  const logChannel = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;
  if (!logChannel?.isTextBased() || !("send" in logChannel)) return;

  const url = resolveTranscriptUrl(transcript);
  const createdAt = new Date(ticket.createdAt);
  const closedAt = transcript.transcript.closedAt ? new Date(transcript.transcript.closedAt) : new Date();
  const temporaryPassword = resolveTranscriptTemporaryPassword(transcript);
  const luaCommand = buildTranscriptLuaCommand(transcript);
  await (logChannel as TextChannel).send(renderComponentsV2Panel({
    accentColor: 0xf2b84b,
    actions: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setEmoji(systemComponentEmoji("link", guild)).setLabel("Abrir Transcript").setStyle(ButtonStyle.Link).setURL(url),
        new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}noop:${transcript.transcript.id}`).setEmoji(systemComponentEmoji("link", guild)).setLabel("Copiar Link").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}newpass:${transcript.transcript.id}`).setEmoji(systemComponentEmoji("relogio", guild)).setLabel("Gerar Nova Senha").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${TICKET_ACTION_PREFIX}revoke:${transcript.transcript.id}`).setEmoji(systemComponentEmoji("perigo", guild)).setLabel("Revogar Senhas").setStyle(ButtonStyle.Danger)
      )
    ],
    description: "O atendimento foi finalizado e o transcript foi salvo com segurança. O acesso ao link e senha deve permanecer restrito ao canal de logs configurado.",
    fields: [
      `**Informações do Ticket**\n**Ticket:** #${transcript.transcript.ticketId ?? transcript.transcript.id}\n**Canal:** ${transcript.transcript.channelName ? `#${transcript.transcript.channelName}` : "-"}\n**Tipo:** ${transcript.transcript.type}\n**Status:** ${formatTranscriptStatus(ticket.finalResult ?? transcript.transcript.status, guild)}`,
      `**Envolvidos**\n**Aberto por:** <@${ticket.openerId}>\n**Finalizado por:** <@${closedById}>\n**Responsável:** ${ticket.responsibleUserId ? `<@${ticket.responsibleUserId}>` : "Não assumido"}\n**Categoria:** ${ticket.categoryName ?? ticket.subject}`,
      `**Dados do Caso**\n**Criado em:** <t:${Math.floor(createdAt.getTime() / 1000)}:F>\n**Fechado em:** <t:${Math.floor(closedAt.getTime() / 1000)}:F>\n**Tempo total:** ${formatElapsed(createdAt, closedAt)}\n**Resumo:** ${transcript.transcript.messageCount ?? 0} mensagens, ${transcript.transcript.attachmentCount ?? 0} anexos, ${transcript.transcript.participantCount ?? 0} participantes`,
      `**Transcript e Seguranca**\n**Link:** ${url}\n**Protecao:** Senha obrigatória\n**Senha temporaria:** ${temporaryPassword ? `\`${temporaryPassword}\`` : "não gerada"}\n**Expira em:** ${transcript.temporaryPasswordExpiresAt ? `<t:${Math.floor(Date.parse(transcript.temporaryPasswordExpiresAt) / 1000)}:D>` : "configuração padrão"}\n**ComandoLua:** \`${luaCommand}\``
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

function formatTicketDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

function formatTicketTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
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

  return resolvePanelMediaUrlValue(panelImage.imageUrl);
}

function resolvePanelMediaUrlValue(value: string | null | undefined) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

function resolveTicketPanelMedia(panelImage: PanelImageSettings | null, fallbackPosition: PanelImageSettings["imagePosition"]) {
  const imageUrl = resolveImageUrl(panelImage);
  return panelImage && imageUrl
    ? { ...panelImage, imagePosition: fallbackPosition, imageUrl }
    : null;
}

function parseColor(value: string | null | undefined) {
  const normalized = value?.replace("#", "") ?? "";
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0xffd500;
}
