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
  type GuildMember,
  type Interaction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  LabelBuilder,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
  type ModalSubmitInteraction,
  RadioGroupBuilder,
  type StringSelectMenuInteraction,
  type TextChannel
} from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings, PanelImageSettings, TicketPanelOption } from "../types";
import { resetSelectMenuMessage } from "../utils/selectMenuReset";
import type { TicketPanelPublishAck } from "../websocket/socketClient";
import type { TicketRecord } from "./apiClient";
import { getCachedGuildSettings, getFreshGuildSettings } from "./guildSettingsCache";
import { componentsV2Payload, renderComponentsV2Panel, resolvePanelImageUrl } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";
import { buildTranscriptLuaCommand, resolveTranscriptTemporaryPassword, resolveTranscriptUrl } from "./transcriptUrlService";

const TICKET_PANEL_CUSTOM_ID = "ticket_panel_select";
const TICKET_ACTION_PREFIX = "ticket_action:";
const TICKET_STATUS_PREFIX = "ticket_status:";
const CLOSE_MODAL_PREFIX = "ticket_close:";
const CLOSE_CONFIRM_PREFIX = "ticket_close_confirm:";
const CLOSE_CANCEL_PREFIX = "ticket_close_cancel:";
const OPEN_MODAL_PREFIX = "ticket_open:";
const OPEN_BUTTON_ID = "ticket_open_button";
const OPEN_CATEGORY_PREFIX = "ticket_open_category:";
const OPEN_CLIENT_PREFIX = "ticket_open_client:";
const OPEN_CONTINUE_PREFIX = "ticket_open_continue:";
const OPEN_CANCEL_PREFIX = "ticket_open_cancel:";
const TICKET_MEMBER_MODAL_PREFIX = "ticket_member:";
const TICKET_RENAME_MODAL_PREFIX = "ticket_rename:";
const TICKET_CATEGORY_CHANGE_PREFIX = "ticket_category_change:";
let ticketPanelServiceStarted = false;
const panelPublicationLocks = new Map<string, Promise<string | null>>();
const openTicketSessions = new Map<string, { botId: string | null; clientStatus: "yes" | "no" | null; createdAt: number; guildId: string; optionValue: string | null; userId: string }>();
const ticketCreationLocks = new Map<string, Promise<void>>();
const OPEN_TICKET_SESSION_TTL_MS = 10 * 60 * 1000;
const PENDING_TICKET_LEASE_MS = 2 * 60 * 1000;
const USER_CALL_COOLDOWN_MS = Number(process.env.TICKET_USER_CALL_COOLDOWN_SECONDS ?? "60") * 1000;
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
type TicketModuleType = "default" | "police";
type TicketScopedId = {
  action: string;
  botId: string | null;
  guildId: string | null;
  legacy: boolean;
  targetId: string;
};
type TicketRecoveryMetadata = {
  botId: string | null;
  categoryId: string;
  guildId: string | null;
  moduleType: TicketModuleType;
  openerId: string;
  panelId: string;
  responsibleRoleId?: string | null;
  subject?: string | null;
  ticketId: string;
  ticketType: string;
};

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

  if (interaction.isButton() && (interaction.customId === OPEN_BUTTON_ID || interaction.customId.startsWith(`${OPEN_BUTTON_ID}:`))) {
    await handleTicketOpenButton(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(OPEN_CONTINUE_PREFIX)) {
    await handleTicketOpenContinue(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(OPEN_CANCEL_PREFIX)) {
    await handleTicketOpenCancel(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(TICKET_ACTION_PREFIX)) {
    await handleTicketAction(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLOSE_CONFIRM_PREFIX)) {
    const parsed = parseScopedComponentId(interaction.customId, CLOSE_CONFIRM_PREFIX, "confirm");
    if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
      await interaction.reply({ content: "Ticket inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(createTicketCloseModal(parsed.targetId, interaction.guildId, interaction.client.user?.id ?? null));
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLOSE_CANCEL_PREFIX)) {
    await interaction.update({ components: [], content: "Fechamento cancelado." }).catch(async () => {
      await interaction.reply({ content: "Fechamento cancelado.", flags: MessageFlags.Ephemeral }).catch(() => null);
    });
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

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(TICKET_CATEGORY_CHANGE_PREFIX)) {
    await handleTicketCategoryChange(interaction, context);
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

  if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_MEMBER_MODAL_PREFIX)) {
    await handleTicketMemberModal(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_RENAME_MODAL_PREFIX)) {
    await handleTicketRenameModal(interaction, context);
    return true;
  }

  if (!interaction.isStringSelectMenu() || interaction.customId !== TICKET_PANEL_CUSTOM_ID) {
    return false;
  }

  const selectedValue = interaction.values[0];
  const settings = await getCachedGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedValue);

  if (!settings?.ticketEnabled || !option) {
    await interaction.reply({ content: "Esta opção de ticket não está mais disponível.", flags: MessageFlags.Ephemeral });
    return true;
  }

  void resetSelectMenuMessage(interaction);

  const token = createOpenTicketSession(interaction.guild.id, interaction.client.user?.id ?? null, interaction.user.id, option.value);
  await interaction.showModal(createOpenTicketModal(token, settings));

  return true;
}

async function handleTicketOpenButton(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  if (interaction.customId.startsWith(`${OPEN_BUTTON_ID}:`) && !validatePanelOpenButton(interaction)) {
    await interaction.reply({ content: "Este painel pertence a outro bot ou servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getCachedGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const options = activeTicketOptions(settings);
  if (!settings?.ticketEnabled || !options.length) {
    await interaction.reply({ content: "Nenhuma categoria de ticket ativa foi configurada na Dashboard.", flags: MessageFlags.Ephemeral });
    return;
  }

  const token = createOpenTicketSession(interaction.guild.id, interaction.client.user?.id ?? null, interaction.user.id);
  await interaction.showModal(createOpenTicketModal(token, settings));
}

async function handleTicketPreOpenSelect(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;

  await interaction.deferUpdate();
  const isCategory = interaction.customId.startsWith(OPEN_CATEGORY_PREFIX);
  const token = interaction.customId.slice((isCategory ? OPEN_CATEGORY_PREFIX : OPEN_CLIENT_PREFIX).length);
  const session = getOpenTicketSession(token);
  if (!session || !isOpenTicketSessionForInteraction(session, interaction) || isExpiredOpenTicketSession(session)) {
    openTicketSessions.delete(token);
    await interaction.followUp({ content: "Esta abertura expirou. Clique em Abrir Ticket novamente.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getCachedGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const selectedValue = interaction.values[0] ?? null;
  if (isCategory) {
    const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedValue);
    if (!settings?.ticketEnabled || !option) {
      await interaction.followUp({ content: "Esta categoria de ticket não está mais disponível.", flags: MessageFlags.Ephemeral });
      return;
    }
    session.optionValue = option.value;
  } else if (selectedValue === "yes" || selectedValue === "no") {
    session.clientStatus = selectedValue;
  }

  await interaction.editReply(ticketPreOpenUpdatePayload(settings, token, interaction.guild, session));
}

async function handleTicketOpenContinue(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;

  const token = interaction.customId.slice(OPEN_CONTINUE_PREFIX.length);
  const session = getOpenTicketSession(token);
  if (!session || !isOpenTicketSessionForInteraction(session, interaction) || isExpiredOpenTicketSession(session)) {
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

  const settings = await getCachedGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === session.optionValue);
  if (!settings?.ticketEnabled || !option) {
    await interaction.reply({ content: "Esta categoria de ticket não está mais disponível.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(createOpenTicketModal(token, settings));
}

async function handleTicketOpenCancel(interaction: ButtonInteraction) {
  const token = interaction.customId.slice(OPEN_CANCEL_PREFIX.length);
  const session = getOpenTicketSession(token);
  if (session && isOpenTicketSessionForInteraction(session, interaction)) {
    openTicketSessions.delete(token);
  }
  await interaction.update({
    components: [],
    content: "Abertura de ticket cancelada."
  }).catch(async () => {
    await interaction.reply({ content: "Abertura de ticket cancelada.", flags: MessageFlags.Ephemeral }).catch(() => null);
  });
}

async function handleTicketOpenModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;

  const token = interaction.customId.slice(OPEN_MODAL_PREFIX.length);
  const session = consumeOpenTicketSession(token);
  if (!session || !isOpenTicketSessionForInteraction(session, interaction)) {
    await interaction.reply({ content: "Este formulário expirou. Selecione a categoria novamente no painel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const selectedCategory = selectedModalStringValue(interaction, "category") ?? session.optionValue;
  const clientStatus = selectedModalRadioValue(interaction, "isClient") ?? session.clientStatus;
  const subject = normalizeTicketDescription(interaction.fields.getTextInputValue("description"));
  const clientLabel = clientStatus === "yes" ? "Sim" : "Não";
  if (!subject) {
    await interaction.reply({ content: "Informe o motivo do ticket.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch((error) => {
    logTicketTechnical("settings_load_failed", interaction, { error });
    return null;
  });
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedCategory);

  if (!settings?.ticketEnabled || !option || !clientStatus) {
    await interaction.editReply("Esta categoria de ticket não está mais disponível.");
    return;
  }

  const lockKey = ticketCreationLockKey(interaction.guild.id, interaction.client.user?.id ?? null, interaction.user.id, option.value, resolveTicketModuleType(option));
  if (ticketCreationLocks.has(lockKey)) {
    await interaction.editReply("Já existe uma solicitação de ticket em andamento para esta categoria. Aguarde alguns segundos.");
    return;
  }

  const creation = createTicketForInteraction(interaction, context, settings, option, subject, clientLabel)
    .finally(() => {
      if (ticketCreationLocks.get(lockKey) === creation) {
        ticketCreationLocks.delete(lockKey);
      }
    });
  ticketCreationLocks.set(lockKey, creation);
  await creation;

  return true;
}

export async function openTicketFromCommand(interaction: ChatInputCommandInteraction, context: BotContext, _rawSubject = "") {
  if (!interaction.guild) return;
  const settings = await getCachedGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch((error) => {
    logTicketTechnical("settings_load_failed", interaction, { error });
    return null;
  });
  if (!settings?.ticketEnabled || !activeTicketOptions(settings).length) {
    await interaction.reply({ content: "O sistema de tickets está desativado ou não possui categoria ativa.", flags: MessageFlags.Ephemeral });
    return;
  }

  const token = createOpenTicketSession(interaction.guild.id, interaction.client.user?.id ?? null, interaction.user.id);
  await interaction.showModal(createOpenTicketModal(token, settings));
}

async function createTicketForInteraction(
  interaction: ModalSubmitInteraction | ChatInputCommandInteraction,
  context: BotContext,
  settings: GuildSettings,
  option: TicketPanelOption,
  subject: string,
  clientLabel: string
) {
  const guild = interaction.guild;
  if (!guild) return;
  const startedAt = performance.now();
  logTicketTechnical("request_started", interaction, { categoryId: option.value, categoryChannelId: option.categoryId ?? settings.ticketCategoryId });
  const moduleType = resolveTicketModuleType(option);
  const ticketType = resolveTicketType(option, moduleType);

  const opener = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!opener) {
    logTicketTechnical("opener_left_guild", interaction, { categoryId: option.value });
    await interaction.editReply("Você não está mais neste servidor, então o ticket não pôde ser criado.");
    return;
  }

  let prerequisiteInfo: Awaited<ReturnType<typeof validateTicketChannelPrerequisites>>;
  try {
    prerequisiteInfo = await validateTicketChannelPrerequisites(guild, settings, option);
  } catch (error) {
    logTicketTechnical("prerequisite_check_failed", interaction, { error });
    await interaction.editReply(ticketUserFacingError(error));
    return;
  }

  if ((option.maxOpenTicketsPerUser ?? 1) <= 1) {
    const categoryId = option.categoryId ?? settings.ticketCategoryId;
    const orphanChannel = guild.channels.cache.find((channel): channel is TextChannel => {
      if (channel.type !== ChannelType.GuildText || channel.parentId !== categoryId) return false;
      const metadata = parseTicketChannelTopic(channel.topic);
      return metadata?.openerId === interaction.user.id
        && metadata.categoryId === option.value
        && metadata.moduleType === moduleType
        && (!metadata.botId || metadata.botId === interaction.client.user?.id);
    }) ?? null;
    if (orphanChannel) {
      const recovered = await recoverTicketRecord(orphanChannel, context);
      if (recovered?.channelId === orphanChannel.id && ["OPEN", "PENDING", "IN_ANALYSIS", "WAITING_EVIDENCE", "WAITING_USER"].includes(recovered.status)) {
        logTicketTechnical("orphan_channel_recovered", interaction, { channelId: orphanChannel.id, ticketId: recovered.id });
        await interaction.editReply(`Você já possui um ticket aberto nesta categoria: <#${orphanChannel.id}>`);
        return;
      }
    }

    const databaseStartedAt = performance.now();
    const existing = await context.api.getOpenTicket({
      categoryId: option.value,
      guildId: guild.id,
      moduleType,
      openerId: interaction.user.id
    }).catch((error) => {
      logTicketTechnical("duplicate_check_failed", interaction, { categoryId: option.value, error });
      throw error;
    });
    logTicketTechnical("duplicate_check_completed", interaction, { databaseMs: elapsed(databaseStartedAt), existingTicketId: existing?.id ?? null });

    if (existing) {
      const existingChannel = existing.channelId
        ? await guild.channels.fetch(existing.channelId).catch(() => null)
        : null;

      if (existingChannel) {
        await interaction.editReply(`Você já possui um ticket aberto nesta categoria: <#${existing.channelId}>`);
        return;
      }

      if (existing.status === "PENDING" && isPendingTicketLeaseActive(existing.createdAt)) {
        await interaction.editReply("Já existe uma solicitação de ticket em andamento para esta categoria. Aguarde alguns segundos.");
        return;
      }

      const invalidated = await context.api.updateTicketStatus(existing.id, {
        isIncomplete: true,
        status: "INCOMPLETE"
      });
      if (!invalidated) throw new Error(`Ticket inconsistente ${existing.id} não pôde ser invalidado.`);
      logTicketTechnical("stale_ticket_invalidated", interaction, { staleTicketId: existing.id });
    }
  }

  const ticket = await context.api.createTicket({
    allowedRoleIds: prerequisiteInfo.staffRoleIds,
    channelId: null,
    categoryId: option.value,
    categoryName: option.label,
    guildId: guild.id,
    isClient: clientLabel === "Sim" ? true : clientLabel === "Não" ? false : null,
    moduleType,
    openerId: interaction.user.id,
    panelId: option.value,
    responsibleRoleId: prerequisiteInfo.staffRoleIds[0] ?? null,
    status: "PENDING",
    subject,
    ticketType
  });

  if (ticket.created === false) {
    if (ticket.ticket.channelId) {
      const existingChannel = await guild.channels.fetch(ticket.ticket.channelId).catch(() => null);
      if (existingChannel) {
        await interaction.editReply(`Você já possui um ticket aberto nesta categoria: <#${ticket.ticket.channelId}>`);
        return;
      }
    }

    await interaction.editReply("Já existe uma solicitação de ticket em andamento para esta categoria. Aguarde alguns segundos.");
    return;
  }

  let channel: TextChannel | null = null;
  try {
    const channelStartedAt = performance.now();
    channel = await createTicketChannel(guild, settings, opener, option, subject, ticket.ticket.id);
    logTicketTechnical("channel_created", interaction, { channelId: channel.id, channelMs: elapsed(channelStartedAt), ticketId: ticket.ticket.id });
    const linked = await context.api.updateTicketChannel(ticket.ticket.id, channel.id);
    if (!linked?.channelId) throw new Error("A API não confirmou o vínculo entre ticket e canal.");
  } catch (error) {
    logTicketTechnical("channel_create_failed", interaction, { error, ticketId: ticket.ticket.id });
    if (channel) await channel.delete("Rollback: falha ao persistir vínculo do ticket").catch((cleanupError) => {
      logTicketTechnical("channel_rollback_failed", interaction, { channelId: channel?.id, error: cleanupError, ticketId: ticket.ticket.id });
    });
    await context.api.updateTicketStatus(ticket.ticket.id, {
      isIncomplete: true,
      status: "INCOMPLETE"
    }).catch(() => null);
    await context.api.postLog({
      guildId: guild.id,
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
    await interaction.editReply(ticketUserFacingError(error));
    return;
  }

  try {
    await channel.send(createOpenTicketPayload({
      category: option.label,
      clientLabel,
      guild,
      initialMessage: option.initialMessage ?? null,
      mentionRoleId: prerequisiteInfo.staffRoleIds[0] ?? null,
      openerId: interaction.user.id,
      priority: option.priority ?? "normal",
      responsibleUserId: null,
      status: "Aguardando atendimento",
      subject,
      ticketId: ticket.ticket.id
    }));
    const opened = await context.api.updateTicketStatus(ticket.ticket.id, { status: "OPEN" });
    if (!opened) throw new Error("A API não confirmou a ativação do ticket.");
  } catch (error) {
    logTicketTechnical("initial_panel_failed", interaction, { channelId: channel.id, error, ticketId: ticket.ticket.id });
    await channel.delete("Rollback: falha ao finalizar criação do ticket").catch(() => null);
    await context.api.updateTicketStatus(ticket.ticket.id, { isIncomplete: true, status: "INCOMPLETE" }).catch(() => null);
    await interaction.editReply("O ticket não pôde ser finalizado. Nenhum canal incompleto foi mantido; tente novamente.");
    return;
  }
  await context.api.recordTicketEvent(ticket.ticket.id, {
    authorId: interaction.user.id,
    content: `Ticket criado na categoria ${option.label}. Assunto: ${subject}. Cliente: ${clientLabel}.`,
    eventType: "TICKET_CREATED",
    guildId: guild.id,
    metadata: {
      categoryId: option.value,
      categoryName: option.label,
      channelId: channel.id,
      client: clientLabel,
      moduleType,
      panelId: option.value,
      subject
    }
  }).catch(() => null);

  await sendTicketOpeningLog(guild, settings, interaction.user.id, option, channel.id, ticket.ticket.id, subject, clientLabel).catch((error) => {
    logTicketTechnical("opening_log_failed", interaction, { channelId: channel.id, error, ticketId: ticket.ticket.id });
  });

  await sendTicketOpenedDm(guild, interaction.user.id, {
    channelId: channel.id,
    createdAt: new Date().toISOString(),
    guildName: guild.name,
    status: "Aguardando atendimento",
    ticketId: ticket.ticket.id
  }).then((sent) => {
    if (!sent) {
      logTicketTechnical("opening_dm_failed", interaction, { channelId: channel.id, ticketId: ticket.ticket.id });
    }
    return context.api.recordTicketEvent(ticket.ticket.id, {
      authorId: interaction.client.user?.id ?? null,
      content: sent ? "DM de abertura enviada ao usuário." : "Não foi possível enviar DM ao usuário.",
      eventType: sent ? "TICKET_OPENING_DM_SENT" : "TICKET_OPENING_DM_FAILED",
      guildId: guild.id,
      metadata: { channelId: channel.id }
    });
  }).catch(() => null);

  logTicketTechnical("request_completed", interaction, { channelId: channel.id, ticketId: ticket.ticket.id, totalMs: elapsed(startedAt) });
  await interaction.editReply(`Ticket criado: <#${channel.id}>`);
}

async function handleTicketAction(interaction: ButtonInteraction, context: BotContext) {
  const parsed = parseScopedComponentId(interaction.customId, TICKET_ACTION_PREFIX);
  if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
    await interaction.reply({ content: "Ticket inválido.", flags: MessageFlags.Ephemeral });
    return;
  }
  const { action, targetId: ticketId } = parsed;

  if (action === "newpass") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await canManageSensitiveTicketLogAction(interaction))) {
      await interaction.editReply("Você não possui permissão para gerar senhas de transcript.");
      return;
    }
    const password = await context.api.createTranscriptTemporaryPassword(ticketId);
    await interaction.editReply(`Nova senha temporária criada: ||${password.password}||\nValidade: ${new Date(password.expiresAt).toLocaleString("pt-BR")}`);
    return;
  }

  if (action === "revoke") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await canManageSensitiveTicketLogAction(interaction))) {
      await interaction.editReply("Você não possui permissão para revogar senhas de transcript.");
      return;
    }
    await context.api.revokeTranscriptTemporaryPasswords(ticketId);
    await interaction.editReply("Senhas temporárias revogadas para este transcript.");
    return;
  }

  if (action === "noop") {
    await interaction.deferUpdate().catch(() => null);
    return;
  }

  if (["add", "remove", "transfer"].includes(action ?? "")) {
    await interaction.showModal(createTicketMemberModal(action as "add" | "remove" | "transfer", ticketId, interaction.guildId, interaction.client.user?.id ?? null));
    return;
  }

  if (action === "close") {
    await handleTicketCloseRequest(interaction, context, ticketId);
    return;
  }

  if (action === "rename") {
    await interaction.showModal(createTicketRenameModal(ticketId, interaction.guildId, interaction.client.user?.id ?? null));
    return;
  }

  if (action === "category") {
    await handleTicketCategoryButton(interaction, context, ticketId);
    return;
  }

  if (action === "call") {
    await handleTicketUserCall(interaction, context, ticketId);
    return;
  }

  if (action !== "claim") {
    await interaction.reply({ content: "Ação ainda não configurada para este painel.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  const ticket = await getTicketOrRecover(interaction, context, ticketId);
  if (!ticket) {
    await interaction.followUp({ content: "Ticket não encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id)) {
    await interaction.followUp({ content: "Quem abriu este ticket não pode assumir nem usar os botões internos do atendimento.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.followUp({ content: "Você não possui permissão da equipe para gerenciar este ticket.", flags: MessageFlags.Ephemeral });
    return;
  }

  const claim = await context.api.claimTicket(ticketId, interaction.user.id);
  if (!claim.claimed) {
    const responsible = claim.ticket?.responsibleUserId ? `<@${claim.ticket.responsibleUserId}>` : "outro responsável";
    await interaction.followUp({ content: `Este ticket já está sendo atendido por ${responsible}.`, flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const updatedTicket = claim.ticket;
  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Ticket assumido por ${interaction.user.tag}.`,
    eventType: "TICKET_CLAIMED",
    guildId: interaction.guildId!
  }).catch(() => null);
  await interaction.message.edit(createOpenTicketPayload({
    category: updatedTicket?.categoryName ?? ticket.categoryName ?? updatedTicket?.subject ?? ticket.subject ?? "Atendimento",
    clientLabel: ticket.isClient === true ? "Sim" : ticket.isClient === false ? "Não" : null,
    guild: interaction.guild,
    mentionRoleId: updatedTicket?.responsibleRoleId ?? ticket.responsibleRoleId ?? null,
    openerId: updatedTicket?.openerId ?? ticket.openerId,
    responsibleUserId: interaction.user.id,
    status: "Em atendimento",
    subject: updatedTicket?.subject ?? ticket.subject,
    ticketId
  })).catch(() => null);
}

async function handleTicketCloseRequest(interaction: ButtonInteraction, context: BotContext, ticketId: string) {
  const ticket = await getTicketOrRecover(interaction, context, ticketId);
  if (!ticket) {
    await interaction.reply({ content: "Ticket não encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketClosedLike(ticket.status)) {
    await interaction.reply({ content: "Este ticket já foi encerrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id) || !(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.reply({ content: "Você não possui permissão da equipe para finalizar este ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(scopedComponentId(CLOSE_CONFIRM_PREFIX, "confirm", interaction.guildId, interaction.client.user?.id ?? null, ticketId))
          .setLabel("Confirmar fechamento")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(scopedComponentId(CLOSE_CANCEL_PREFIX, "cancel", interaction.guildId, interaction.client.user?.id ?? null, ticketId))
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary)
      )
    ],
    content: "Deseja realmente fechar este ticket?",
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketUserCall(interaction: ButtonInteraction, context: BotContext, ticketId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticket = await getTicketOrRecover(interaction, context, ticketId);
  if (!ticket || !interaction.guild || interaction.channel?.type !== ChannelType.GuildText) {
    await interaction.editReply("Não consegui localizar o canal ou o registro deste ticket.");
    return;
  }
  if (isTicketClosedLike(ticket.status)) {
    await interaction.editReply("Este ticket já foi encerrado.");
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id) || !(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.editReply("Você não possui permissão da equipe para chamar o usuário deste ticket.");
    return;
  }
  const lastCallAt = ticket.lastUserCallAt ? Date.parse(ticket.lastUserCallAt) : 0;
  const remainingMs = lastCallAt + USER_CALL_COOLDOWN_MS - Date.now();
  if (remainingMs > 0) {
    await interaction.editReply(`Aguarde ${Math.ceil(remainingMs / 1000)}s para chamar o usuário novamente.`);
    return;
  }

  const ticketUrl = ticketChannelUrl(interaction.guild.id, interaction.channel.id);
  await interaction.channel.send({
    allowedMentions: { users: [ticket.openerId] },
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("Acessar meu ticket").setEmoji("🎫").setStyle(ButtonStyle.Link).setURL(ticketUrl)
      )
    ],
    content: `<@${ticket.openerId}> A equipe responsável pelo seu ticket está aguardando sua resposta.`
  });
  const dmSent = await sendTicketCallDm(interaction.guild, ticket.openerId, ticketUrl);
  const calledAt = new Date().toISOString();
  await context.api.updateTicketStatus(ticketId, { lastUserCallAt: calledAt }).catch(() => null);
  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: dmSent ? "Usuário chamado por DM." : "Usuário chamado no canal; não foi possível enviar DM.",
    eventType: "USER_CALLED",
    guildId: interaction.guild.id,
    metadata: { channelId: interaction.channel.id, dmSent, ticketUrl }
  }).catch(() => null);
  await interaction.editReply(dmSent ? "Usuário chamado no canal e por DM." : "Usuário chamado no canal. Não foi possível enviar DM ao usuário.");
}

async function handleTicketStatus(interaction: StringSelectMenuInteraction, context: BotContext) {
  const parsed = parseScopedComponentId(interaction.customId, TICKET_STATUS_PREFIX, "status");
  if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
    await interaction.reply({ content: "Ticket inválido.", flags: MessageFlags.Ephemeral });
    return;
  }
  const ticketId = parsed.targetId;
  const status = interaction.values[0];
  const label = STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
  await interaction.deferUpdate();
  const ticket = await getTicketOrRecover(interaction, context, ticketId);
  if (!ticket) {
    await interaction.followUp({ content: "Ticket não encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id)) {
    await interaction.followUp({ content: "Quem abriu este ticket não pode alterar status nem usar os botões internos do atendimento.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.followUp({ content: "Você não possui permissão da equipe para gerenciar este ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  const updatedTicket = await context.api.updateTicketStatus(ticketId, { status });
  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Status alterado para ${label}.`,
    eventType: "ticket.status_changed",
    guildId: interaction.guildId!
  }).catch(() => null);
  await interaction.message.edit(createOpenTicketPayload({
    category: updatedTicket?.categoryName ?? ticket.categoryName ?? updatedTicket?.subject ?? ticket.subject ?? "Atendimento",
    clientLabel: ticket.isClient === true ? "Sim" : ticket.isClient === false ? "Não" : null,
    guild: interaction.guild,
    mentionRoleId: updatedTicket?.responsibleRoleId ?? ticket.responsibleRoleId ?? null,
    openerId: updatedTicket?.openerId ?? ticket.openerId,
    responsibleUserId: updatedTicket?.responsibleUserId ?? ticket.responsibleUserId ?? null,
    status: label,
    subject: updatedTicket?.subject ?? ticket.subject,
    ticketId
  }));
}

async function handleTicketMemberModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const parsed = parseScopedComponentId(interaction.customId, TICKET_MEMBER_MODAL_PREFIX);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const action = parsed?.action as "add" | "remove" | "transfer" | undefined;
  const ticketId = parsed?.targetId;
  if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
    await interaction.editReply("Ação de membro inválida.");
    return;
  }
  if (!ticketId || !action || !["add", "remove", "transfer"].includes(action)) {
    await interaction.editReply("Ação de membro inválida.");
    return;
  }
  const ticket = await getTicketOrRecover(interaction, context, ticketId);
  if (!ticket || !interaction.guild || interaction.channel?.type !== ChannelType.GuildText) {
    await interaction.editReply("Não consegui localizar o canal ou o registro deste ticket.");
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id) || !(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.editReply("Você não possui permissão da equipe para gerenciar membros deste ticket.");
    return;
  }

  const targetId = interaction.fields.getTextInputValue("user_id").replace(/[^0-9]/g, "");
  if (!/^\d{5,32}$/.test(targetId)) {
    await interaction.editReply("Informe um ID de usuário válido.");
    return;
  }
  if (targetId === ticket.openerId && action === "remove") {
    await interaction.editReply("O autor principal não pode ser removido do próprio ticket.");
    return;
  }

  const target = await interaction.guild.members.fetch(targetId).catch(() => null);
  if ((action === "add" || action === "transfer") && !target) {
    await interaction.editReply("Esse usuário não está mais no servidor.");
    return;
  }

  if (action === "remove") {
    await interaction.channel.permissionOverwrites.delete(targetId, `Ticket ${ticketId}: usuário removido por ${interaction.user.id}`);
  } else if (action === "add") {
    await interaction.channel.permissionOverwrites.edit(targetId, {
      AttachFiles: true,
      EmbedLinks: true,
      ReadMessageHistory: true,
      SendMessages: true,
      UseApplicationCommands: true,
      ViewChannel: true
    }, { reason: `Ticket ${ticketId}: usuário adicionado por ${interaction.user.id}` });
  } else {
    const targetCanManage = target && (
      target.permissions.has(PermissionFlagsBits.Administrator)
      || target.permissions.has(PermissionFlagsBits.ManageChannels)
      || Boolean(ticket.responsibleRoleId && target.roles.cache.has(ticket.responsibleRoleId))
    );
    if (!targetCanManage) {
      await interaction.editReply("O novo responsável precisa possuir o cargo da equipe ou permissão para gerenciar canais.");
      return;
    }
    await context.api.updateTicketStatus(ticketId, { responsibleUserId: targetId, status: "IN_ANALYSIS" });
  }

  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: `Membro ${targetId} ${action === "add" ? "adicionado" : action === "remove" ? "removido" : "definido como responsável"} por ${interaction.user.tag}.`,
    eventType: action === "add" ? "MEMBER_ADDED" : action === "remove" ? "MEMBER_REMOVED" : "TICKET_TRANSFERRED",
    guildId: interaction.guild.id,
    metadata: { targetId }
  }).catch(() => null);
  await interaction.editReply(action === "add" ? "Usuário adicionado ao ticket." : action === "remove" ? "Usuário removido do ticket." : "Ticket transferido para o novo responsável.");
}

function createTicketMemberModal(action: "add" | "remove" | "transfer", ticketId: string, guildId: string | null, botId: string | null) {
  const labels = { add: "Adicionar Usuário", remove: "Remover Usuário", transfer: "Transferir Ticket" };
  return new ModalBuilder()
    .setCustomId(scopedComponentId(TICKET_MEMBER_MODAL_PREFIX, action, guildId, botId, ticketId))
    .setTitle(labels[action])
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("user_id")
        .setLabel("ID do usuário")
        .setPlaceholder("Cole o ID numérico do usuário")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
        .setMinLength(5)
        .setMaxLength(32)
    ));
}

function createTicketRenameModal(ticketId: string, guildId: string | null, botId: string | null) {
  return new ModalBuilder()
    .setCustomId(scopedComponentId(TICKET_RENAME_MODAL_PREFIX, "rename", guildId, botId, ticketId))
    .setTitle("Renomear Ticket")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
        .setCustomId("subject")
        .setLabel("Novo assunto do ticket")
        .setPlaceholder("Informe o novo assunto")
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(100)
    ));
}

async function handleTicketRenameModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const parsed = parseScopedComponentId(interaction.customId, TICKET_RENAME_MODAL_PREFIX, "rename");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
    await interaction.editReply("Ticket inválido.");
    return;
  }
  const ticket = await getTicketOrRecover(interaction, context, parsed.targetId);
  if (!ticket || !interaction.guild || interaction.channel?.type !== ChannelType.GuildText) {
    await interaction.editReply("Não consegui localizar o canal ou o registro deste ticket.");
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id) || !(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.editReply("Você não possui permissão da equipe para renomear este ticket.");
    return;
  }
  const subject = normalizeTicketSubject(interaction.fields.getTextInputValue("subject"));
  if (!subject) {
    await interaction.editReply("Informe o assunto do ticket.");
    return;
  }

  const oldSubject = ticket.subject;
  const updated = await context.api.updateTicketStatus(ticket.id, { subject });
  const categorySlug = slugTicketChannelName(ticket.ticketType ?? ticket.categoryId ?? ticket.categoryName ?? "ticket");
  const opener = await interaction.guild.members.fetch(ticket.openerId).catch(() => null);
  const userSlug = slugTicketChannelName(opener?.displayName || opener?.user.username || ticket.openerId).slice(0, 32);
  await interaction.channel.setName(`${categorySlug}-${userSlug}-${ticket.openerId.slice(-4)}`.slice(0, 96), `Ticket ${ticket.id} renomeado por ${interaction.user.id}`).catch(() => null);
  await editTicketPanelMessage(interaction.channel, ticket.id, createOpenTicketPayload({
    category: updated?.categoryName ?? ticket.categoryName ?? "Atendimento",
    clientLabel: ticket.isClient === true ? "Sim" : ticket.isClient === false ? "Não" : null,
    guild: interaction.guild,
    mentionRoleId: updated?.responsibleRoleId ?? ticket.responsibleRoleId ?? null,
    openerId: ticket.openerId,
    responsibleUserId: updated?.responsibleUserId ?? ticket.responsibleUserId ?? null,
    status: STATUS_OPTIONS.find((item) => item.value === (updated?.status ?? ticket.status))?.label ?? updated?.status ?? ticket.status,
    subject,
    ticketId: ticket.id
  }));
  await context.api.recordTicketEvent(ticket.id, {
    authorId: interaction.user.id,
    content: `Ticket renomeado de "${oldSubject}" para "${subject}".`,
    eventType: "TICKET_RENAMED",
    guildId: interaction.guild.id,
    metadata: { newSubject: subject, oldSubject }
  }).catch(() => null);
  await interaction.editReply("Ticket renomeado.");
}

async function handleTicketCategoryButton(interaction: ButtonInteraction, context: BotContext, ticketId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticket = await getTicketOrRecover(interaction, context, ticketId);
  if (!ticket || !interaction.guild) {
    await interaction.editReply("Ticket não encontrado.");
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id) || !(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.editReply("Você não possui permissão da equipe para alterar a categoria deste ticket.");
    return;
  }
  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const options = activeTicketOptions(settings).filter((option) => option.value !== ticket.categoryId);
  if (!settings?.ticketEnabled || !options.length) {
    await interaction.editReply("Não existem outras categorias ativas para este ticket.");
    return;
  }
  await interaction.editReply({
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(scopedComponentId(TICKET_CATEGORY_CHANGE_PREFIX, "category", interaction.guildId, interaction.client.user?.id ?? null, ticketId))
          .setPlaceholder("Selecione a nova categoria do ticket")
          .addOptions(options.map(toSelectOption))
      )
    ],
    content: "Selecione a nova categoria."
  } as InteractionEditReplyOptions);
}

async function handleTicketCategoryChange(interaction: StringSelectMenuInteraction, context: BotContext) {
  const parsed = parseScopedComponentId(interaction.customId, TICKET_CATEGORY_CHANGE_PREFIX, "category");
  await interaction.deferUpdate();
  if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
    await interaction.followUp({ content: "Ticket inválido.", flags: MessageFlags.Ephemeral });
    return;
  }
  const ticket = await getTicketOrRecover(interaction, context, parsed.targetId);
  if (!ticket || !interaction.guild || interaction.channel?.type !== ChannelType.GuildText) {
    await interaction.followUp({ content: "Não consegui localizar o canal ou o registro deste ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (isTicketOpener(ticket, interaction.user.id) || !(await canManageTicketInteraction(interaction, ticket))) {
    await interaction.followUp({ content: "Você não possui permissão da equipe para alterar a categoria deste ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === interaction.values[0]);
  if (!settings?.ticketEnabled || !option) {
    await interaction.followUp({ content: "Categoria indisponível.", flags: MessageFlags.Ephemeral });
    return;
  }
  const prerequisites = await validateTicketChannelPrerequisites(interaction.guild, settings, option).catch((error) => {
    void interaction.followUp({ content: ticketUserFacingError(error), flags: MessageFlags.Ephemeral });
    return null;
  });
  if (!prerequisites) return;

  const oldCategory = ticket.categoryName ?? ticket.categoryId ?? "Atendimento";
  await interaction.channel.setParent(prerequisites.categoryId, { lockPermissions: false, reason: `Ticket ${ticket.id} alterado para ${option.label} por ${interaction.user.id}` });
  await applyTicketCategoryPermissions(interaction.channel, interaction.guild, ticket.openerId, settings, option, prerequisites.staffRoleIds);
  const updated = await context.api.updateTicketStatus(ticket.id, {
    categoryId: option.value,
    categoryName: option.label,
    panelId: option.value,
    responsibleRoleId: prerequisites.staffRoleIds[0] ?? null,
    ticketType: resolveTicketType(option, resolveTicketModuleType(option))
  });
  await interaction.channel.setTopic(createTicketChannelTopic({
    botId: interaction.client.user?.id ?? null,
    categoryId: option.value,
    guildId: interaction.guild.id,
    moduleType: resolveTicketModuleType(option),
    openerId: ticket.openerId,
    panelId: option.value,
    ticketId: ticket.id,
    ticketType: resolveTicketType(option, resolveTicketModuleType(option))
  })).catch(() => null);
  await editTicketPanelMessage(interaction.channel, ticket.id, createOpenTicketPayload({
    category: option.label,
    clientLabel: ticket.isClient === true ? "Sim" : ticket.isClient === false ? "Não" : null,
    guild: interaction.guild,
    initialMessage: option.initialMessage ?? null,
    mentionRoleId: prerequisites.staffRoleIds[0] ?? null,
    openerId: ticket.openerId,
    priority: option.priority ?? "normal",
    responsibleUserId: updated?.responsibleUserId ?? ticket.responsibleUserId ?? null,
    status: STATUS_OPTIONS.find((item) => item.value === (updated?.status ?? ticket.status))?.label ?? updated?.status ?? ticket.status,
    subject: updated?.subject ?? ticket.subject,
    ticketId: ticket.id
  }));
  await context.api.recordTicketEvent(ticket.id, {
    authorId: interaction.user.id,
    content: `Categoria alterada de ${oldCategory} para ${option.label}.`,
    eventType: "ticket.category_changed",
    guildId: interaction.guild.id,
    metadata: { newCategoryId: option.value, newCategoryName: option.label, oldCategory }
  }).catch(() => null);
  await interaction.editReply({ components: [], content: `Categoria alterada para ${option.label}.` }).catch(() => null);
}

function createTicketCloseModal(ticketId: string, guildId: string | null, botId: string | null) {
  return new ModalBuilder()
    .setCustomId(scopedComponentId(CLOSE_MODAL_PREFIX, "close", guildId, botId, ticketId))
    .setTitle("Finalizar Ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo do fechamento").setRequired(true).setStyle(TextInputStyle.Paragraph).setMaxLength(900)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("result").setLabel("Resultado da análise").setRequired(true).setStyle(TextInputStyle.Paragraph).setMaxLength(900)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("notes").setLabel("Observações internas").setRequired(false).setStyle(TextInputStyle.Paragraph).setMaxLength(900))
    );
}

async function handleTicketCloseModal(interaction: ModalSubmitInteraction, context: BotContext) {
  const parsed = parseScopedComponentId(interaction.customId, CLOSE_MODAL_PREFIX, "close");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!parsed || !validateScopedComponentInteraction(interaction, parsed)) {
    await interaction.editReply("Ticket inválido.");
    return;
  }
  const ticketId = parsed.targetId;

  const currentTicket = await getTicketOrRecover(interaction, context, ticketId);
  if (!currentTicket) {
    await interaction.editReply("Não consegui localizar o ticket.");
    return;
  }
  if (isTicketOpener(currentTicket, interaction.user.id)) {
    await interaction.editReply("Quem abriu este ticket não pode finalizar nem usar os botões internos do atendimento.");
    return;
  }
  if (!(await canManageTicketInteraction(interaction, currentTicket))) {
    await interaction.editReply("Você não possui permissão da equipe para finalizar este ticket.");
    return;
  }

  if (isTicketClosedLike(currentTicket.status)) {
    await interaction.editReply("Este ticket já foi encerrado.");
    return;
  }

  const closing = await context.api.beginTicketClose(ticketId, {
    closedById: interaction.user.id,
    closeReason: interaction.fields.getTextInputValue("reason"),
    finalResult: interaction.fields.getTextInputValue("result"),
    internalNotes: interaction.fields.getTextInputValue("notes") || null
  });

  if (!closing.closing) {
    await interaction.editReply(closing.ticket?.status === "CLOSING" ? "Este ticket já está em fechamento." : "Este ticket já foi encerrado.");
    return;
  }
  const ticket = closing.ticket;

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
    closedAt: ticket.closedAt ?? new Date().toISOString(),
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
    eventType: "TRANSCRIPT_CREATED",
    guildId: interaction.guildId!,
    metadata: {
      dmSent,
      expiresAt: transcript.temporaryPasswordExpiresAt ?? transcript.transcript.expiresAt ?? null,
      transcriptId: transcript.transcript.id,
      url: resolveTranscriptUrl(transcript)
    }
  }).catch(() => null);

  await sendTranscriptLog(interaction.guild!, context, transcript, ticket, interaction.user.id);
  await context.api.recordTicketEvent(ticketId, {
    authorId: interaction.user.id,
    content: "Ticket encerrado com transcript enviado aos destinos configurados.",
    eventType: "TICKET_CLOSED",
    guildId: interaction.guildId!,
    metadata: { transcriptId: transcript.transcript.id }
  }).catch(() => null);
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
      .setCustomId(`${OPEN_BUTTON_ID}:${settings.guildId}:${guild?.client.user?.id ?? settings.botId ?? "unknown"}`)
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

function createOpenTicketSession(guildId: string, botId: string | null, userId: string, optionValue: string | null = null) {
  cleanupOpenTicketSessions();
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 24);
  openTicketSessions.set(token, { botId, clientStatus: null, createdAt: Date.now(), guildId, optionValue, userId });
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

function isOpenTicketSessionForInteraction(session: { botId: string | null; guildId: string; userId: string }, interaction: Interaction) {
  const currentBotId = interaction.client.user?.id ?? null;
  return session.userId === interaction.user.id
    && session.guildId === interaction.guildId
    && (!session.botId || !currentBotId || session.botId === currentBotId);
}

function cleanupOpenTicketSessions() {
  const expiresBefore = Date.now() - OPEN_TICKET_SESSION_TTL_MS;
  for (const [token, session] of openTicketSessions) {
    if (session.createdAt < expiresBefore) {
      openTicketSessions.delete(token);
    }
  }
}

export function normalizeTicketSubject(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 100);
  return normalized.length > 0 ? normalized : null;
}

export function normalizeTicketDescription(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 1000);
  return normalized.length > 0 ? normalized : null;
}

function activeTicketOptions(settings: GuildSettings | null | undefined) {
  return (settings?.ticketPanelOptions ?? [])
    .filter((option) => option.enabled)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
    .slice(0, 25);
}

function selectedModalStringValue(interaction: ModalSubmitInteraction, customId: string) {
  try {
    const values = interaction.fields.getStringSelectValues(customId);
    return values.length === 1 ? values[0] ?? null : null;
  } catch {
    return null;
  }
}

function selectedModalRadioValue(interaction: ModalSubmitInteraction, customId: string) {
  try {
    return interaction.fields.getRadioGroup(customId) ?? null;
  } catch {
    return null;
  }
}

function createOpenTicketModal(token: string, settings: GuildSettings) {
  const options = activeTicketOptions(settings);
  const session = getOpenTicketSession(token);
  return new ModalBuilder()
    .setCustomId(`${OPEN_MODAL_PREFIX}${token}`)
    .setTitle("Abrir Novo Ticket")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Categoria")
        .setDescription("Selecione a categoria do atendimento")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("category")
            .setPlaceholder("Selecione uma categoria")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options.map((option) => toSelectOption(option).setDefault(option.value === session?.optionValue)))
        ),
      new LabelBuilder()
        .setLabel("O que aconteceu?")
        .setDescription("Digite o motivo do seu atendimento")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("description")
            .setPlaceholder("Digite o motivo do seu atendimento...")
            .setRequired(true)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(1)
            .setMaxLength(1000)
        ),
      new LabelBuilder()
        .setLabel("Você é cliente?")
        .setDescription("Selecione uma opção")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId("isClient")
            .setRequired(true)
            .addOptions(
              { default: session?.clientStatus === "yes", label: "Sim", value: "yes" },
              { default: session?.clientStatus === "no", label: "Não", value: "no" }
            )
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

function renderTicketPreOpenEditPayload(
  settings: GuildSettings,
  token: string,
  guild: Guild,
  session: { clientStatus: "yes" | "no" | null; optionValue: string | null } | null,
  notice: string | null = null
): InteractionEditReplyOptions {
  const payload = renderTicketPreOpenPayload(settings, token, guild, session, notice);
  return { ...payload, flags: MessageFlags.IsComponentsV2 } as InteractionEditReplyOptions;
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
  const selectedClient = session?.clientStatus === "yes" ? "Sim, já sou cliente" : session?.clientStatus === "no" ? "Não, ainda não sou cliente" : null;
  const canContinue = Boolean(selectedOption && selectedClient);
  const categorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${OPEN_CATEGORY_PREFIX}${token}`)
      .setPlaceholder("Selecione a Categoria do Ticket")
      .addOptions(options.map((option) => toSelectOption(option).setDefault(option.value === session?.optionValue)))
  );
  const clientSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${OPEN_CLIENT_PREFIX}${token}`)
      .setPlaceholder("Você já é cliente da Nextech?")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setEmoji(systemStatusEmoji("success", guild))
          .setLabel("Sim, já sou cliente")
          .setValue("yes")
          .setDescription("Já sou cliente e preciso de atendimento.")
          .setDefault(session?.clientStatus === "yes"),
        new StringSelectMenuOptionBuilder()
          .setEmoji(systemStatusEmoji("danger", guild))
          .setLabel("Não, ainda não sou cliente")
          .setValue("no")
          .setDescription("Ainda não sou cliente ou quero conhecer os serviços.")
          .setDefault(session?.clientStatus === "no")
      )
  );
  const actionButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${OPEN_CANCEL_PREFIX}${token}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${OPEN_CONTINUE_PREFIX}${token}`)
      .setEmoji(systemActionEmojiCompat("open", guild))
      .setLabel("Abrir Ticket")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canContinue)
  );

  return [
    {
      type: 10,
      content: [
        `## ${systemEmojiText("prancheta", guild)} Abrir Novo Ticket`,
        `${systemStatusEmoji("warning", guild)} Selecione corretamente a categoria e informe o motivo do atendimento. As informações serão utilizadas para direcionar o atendimento.`,
        "",
        `**Categoria:** ${selectedOption ? `${selectedOption.emoji ? `${selectedOption.emoji} ` : ""}${selectedOption.label}` : "Não selecionada"}`,
        `**Cliente:** ${selectedClient ?? "Não informado"}`,
        notice ? `\n${notice}` : ""
      ].filter(Boolean).join("\n")
    },
    { type: 14, divider: true, spacing: 1 },
    categorySelect,
    clientSelect,
    actionButtons
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

async function createTicketChannel(guild: Guild, settings: GuildSettings, opener: GuildMember, option: TicketPanelOption, subject: string, ticketId: string) {
  const { categoryId, me, staffRoleIds } = await validateTicketChannelPrerequisites(guild, settings, option);
  const moduleType = resolveTicketModuleType(option);
  const ticketType = resolveTicketType(option, moduleType);
  const categorySlug = slugTicketChannelName(option.ticketType ?? option.value ?? option.label);
  const userSlug = slugTicketChannelName(opener.displayName || opener.user.username || opener.id).slice(0, 32);

  return guild.channels.create({
    name: `${categorySlug}-${userSlug}-${opener.id.slice(-4)}`.slice(0, 96),
    parent: categoryId,
    topic: createTicketChannelTopic({
      botId: guild.client.user?.id ?? null,
      categoryId: option.value,
      guildId: guild.id,
      moduleType,
      openerId: opener.id,
      panelId: option.value,
      ticketId,
      ticketType
    }),
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: opener.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.UseApplicationCommands]
      },
      {
        id: me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.UseApplicationCommands]
      },
      ...staffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.UseApplicationCommands]
      }))
    ],
    reason: `Ticket aberto por ${opener.id}: ${option.label} - ${subject}`,
    type: ChannelType.GuildText
  }).then((channel) => channel as TextChannel);
}

async function validateTicketChannelPrerequisites(guild: Guild, settings: GuildSettings, option: TicketPanelOption) {
  const categoryId = option.categoryId ?? settings.ticketCategoryId;
  if (!categoryId) throw new Error("Categoria de tickets não configurada.");
  const category = await guild.channels.fetch(categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Categoria de tickets não encontrada ou inválida.");

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error("Não foi possível localizar o membro do bot neste servidor.");
  const requiredPermissions = [
    [PermissionFlagsBits.ViewChannel, "Ver canais"],
    [PermissionFlagsBits.ManageChannels, "Gerenciar canais"],
    [PermissionFlagsBits.ManageRoles, "Gerenciar cargos"],
    [PermissionFlagsBits.SendMessages, "Enviar mensagens"],
    [PermissionFlagsBits.EmbedLinks, "Inserir links"],
    [PermissionFlagsBits.AttachFiles, "Anexar arquivos"],
    [PermissionFlagsBits.ReadMessageHistory, "Ver histórico de mensagens"]
  ] as const;
  const categoryPermissions = category.permissionsFor(me);
  const missingPermissions = requiredPermissions.filter(([permission]) => !categoryPermissions?.has(permission)).map(([, label]) => label);
  if (missingPermissions.length) throw new Error(`Permissões ausentes para o bot: ${missingPermissions.join(", ")}.`);

  const staffRoleIds = [...new Set([
    option.mentionRoleId,
    ...(option.supportRoleIds ?? []),
    ...(settings.reportSystem?.adminRoleIds ?? [])
  ].filter((roleId): roleId is string => Boolean(roleId && guild.roles.cache.has(roleId) && roleId !== guild.roles.everyone.id)))];
  return { categoryId, me, staffRoleIds };
}

async function applyTicketCategoryPermissions(channel: TextChannel, guild: Guild, openerId: string, settings: GuildSettings, option: TicketPanelOption, staffRoleIds: string[]) {
  await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false }).catch(() => null);
  await channel.permissionOverwrites.edit(openerId, {
    AttachFiles: true,
    EmbedLinks: true,
    ReadMessageHistory: true,
    SendMessages: true,
    UseApplicationCommands: true,
    ViewChannel: true
  }).catch(() => null);
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (me) {
    await channel.permissionOverwrites.edit(me.id, {
      AttachFiles: true,
      EmbedLinks: true,
      ManageChannels: true,
      ManageMessages: true,
      ReadMessageHistory: true,
      SendMessages: true,
      UseApplicationCommands: true,
      ViewChannel: true
    }).catch(() => null);
  }
  const allConfiguredRoleIds = new Set((settings.ticketPanelOptions ?? []).flatMap((item) => [item.mentionRoleId, ...(item.supportRoleIds ?? [])]).filter((roleId): roleId is string => Boolean(roleId)));
  const allowedRoleIds = new Set(staffRoleIds);
  for (const roleId of allConfiguredRoleIds) {
    if (!allowedRoleIds.has(roleId)) await channel.permissionOverwrites.delete(roleId, `Ticket ${channel.id}: cargo removido ao alterar categoria`).catch(() => null);
  }
  for (const roleId of allowedRoleIds) {
    await channel.permissionOverwrites.edit(roleId, {
      AttachFiles: true,
      EmbedLinks: true,
      ManageMessages: true,
      ReadMessageHistory: true,
      SendMessages: true,
      UseApplicationCommands: true,
      ViewChannel: true
    }, { reason: `Ticket ${channel.id}: permissões da categoria ${option.label}` }).catch(() => null);
  }
}

async function editTicketPanelMessage(channel: TextChannel, ticketId: string, payload: MessageEditOptions) {
  const messages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const panel = messages?.find((message) => (
    message.author.id === channel.client.user?.id
    && (
      message.content.includes(ticketId)
      || JSON.stringify(message.components.map((component) => component.toJSON())).includes(ticketId)
    )
  ));
  if (panel) {
    await panel.edit(payload).catch(() => null);
  }
}

async function sendTicketOpeningLog(guild: Guild, settings: GuildSettings, openerId: string, option: TicketPanelOption, channelId: string, ticketId: string, subject: string, clientLabel = "Não informado") {
  const logChannelId = option.logChannelId || settings.logChannelId || settings.reportSystem?.logChannelId;
  if (!logChannelId) return;
  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased() || !("send" in logChannel)) throw new Error("Canal de logs de tickets indisponível.");
  const roleIds = [...new Set([option.mentionRoleId, ...(option.supportRoleIds ?? [])].filter(Boolean))];
  await logChannel.send({
    allowedMentions: { parse: [] },
    content: [
      `[SafeBot][TicketCreate][Handler:main] Ticket ${ticketId} aberto por ${openerId} em <#${channelId}>.`,
      `Categoria: ${option.label}.`,
      `Assunto: ${subject}.`,
      `Cliente: ${clientLabel}.`,
      `Prioridade: ${priorityLabel(option.priority ?? "normal")}.`,
      roleIds.length ? `Cargos responsáveis: ${roleIds.map((roleId) => `<@&${roleId}>`).join(", ")}.` : "Cargos responsáveis: não configurados."
    ].join(" ")
  });
}

function logTicketTechnical(stage: string, interaction: ModalSubmitInteraction | ChatInputCommandInteraction, data: Record<string, unknown>) {
  const serialized = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    value instanceof Error ? value.stack ?? value.message : value
  ]));
  console.info(JSON.stringify({
    at: new Date().toISOString(),
    guildId: interaction.guildId,
    handler: "[SafeBot][TicketCreate][Handler:main]",
    interactionId: interaction.id,
    stage,
    userId: interaction.user.id,
    ...serialized
  }));
}

function ticketUserFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Permissões ausentes para o bot:")) {
    return `${message} Peça a um administrador para corrigir as permissões na categoria configurada.`;
  }
  if (message.startsWith("Categoria de tickets")) {
    return `${message} Peça a um administrador para atualizar o painel na Dashboard.`;
  }
  return "Não consegui criar o canal do ticket. Verifique a categoria e as permissões do bot.";
}

function elapsed(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function ticketCreationLockKey(guildId: string, botId: string | null, userId: string, categoryId: string, moduleType: TicketModuleType) {
  return `${guildId}:${botId ?? "unknown"}:${moduleType}:${userId}:${categoryId}`;
}

async function getTicketOrRecover(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  context: BotContext,
  ticketId: string
) {
  const ticket = await context.api.getTicket(ticketId).catch(() => null);
  if (ticket) {
    const currentBotId = interaction.client.user?.id ?? null;
    if (ticket.guildId !== interaction.guildId || (ticket.botId && currentBotId && ticket.botId !== currentBotId)) {
      console.warn("[ticket-panel] ticket rejeitado por escopo divergente", {
        currentBotId,
        expectedBotId: ticket.botId,
        expectedGuildId: ticket.guildId,
        guildId: interaction.guildId,
        ticketId
      });
      return null;
    }
    return ticket;
  }
  if (interaction.channel?.type !== ChannelType.GuildText) return null;
  const channelTicket = await context.api.getTicketByChannel(interaction.channel.id, interaction.guildId ?? undefined).catch(() => null);
  if (channelTicket && channelTicket.id === ticketId) return channelTicket;
  return recoverTicketRecord(interaction.channel, context, ticketId);
}

async function recoverTicketRecord(channel: TextChannel, context: BotContext, expectedTicketId?: string) {
  const metadata = parseTicketChannelTopic(channel.topic) ?? await recoverTicketMetadataFromPanelMessage(channel, context, expectedTicketId);
  if (!metadata || (expectedTicketId && metadata.ticketId !== expectedTicketId)) return null;
  const currentBotId = context.client.user?.id ?? null;
  if ((metadata.guildId && metadata.guildId !== channel.guild.id) || (metadata.botId && currentBotId && metadata.botId !== currentBotId)) {
    console.warn("[SafeBot][TicketReconcile][Handler:main] reconstrução rejeitada por escopo divergente", {
      channelId: channel.id,
      currentBotId,
      guildId: channel.guild.id,
      metadata
    });
    return null;
  }
  const existing = await context.api.getTicket(metadata.ticketId).catch(() => null);
  if (existing) {
    if (existing.status !== "PENDING" || (existing.channelId && existing.channelId !== channel.id)) return existing;
    if (!existing.channelId) await context.api.updateTicketChannel(existing.id, channel.id);
    const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const hasInitialPanel = recent?.some((message) => message.author.id === context.client.user?.id && JSON.stringify(message.components.map((component) => component.toJSON())).includes(existing.id));
    if (!hasInitialPanel) {
      await channel.send(createOpenTicketPayload({
        category: existing.categoryName ?? metadata.categoryId,
        clientLabel: existing.isClient === true ? "Sim" : existing.isClient === false ? "Não" : null,
        guild: channel.guild,
        mentionRoleId: existing.responsibleRoleId ?? null,
        openerId: existing.openerId,
        responsibleUserId: existing.responsibleUserId ?? null,
        status: "Aguardando atendimento",
        subject: existing.subject,
        ticketId: existing.id
      }));
    }
    return await context.api.updateTicketStatus(existing.id, { status: "OPEN" }) ?? existing;
  }
  const recovered = await context.api.createTicket({
    categoryId: metadata.categoryId,
    categoryName: metadata.categoryId,
    channelId: channel.id,
    guildId: channel.guild.id,
    moduleType: metadata.moduleType as TicketModuleType,
    openerId: metadata.openerId,
    panelId: metadata.panelId,
    responsibleRoleId: metadata.responsibleRoleId ?? null,
    status: "OPEN",
    subject: metadata.subject ?? channel.name,
    ticketId: metadata.ticketId,
    ticketType: metadata.ticketType
  }).catch((error) => {
    console.error("[SafeBot][TicketReconcile][Handler:main]", {
      channelId: channel.id,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      guildId: channel.guild.id,
      ticketId: metadata.ticketId
    });
    return null;
  });
  if (!recovered?.ticket || recovered.ticket.channelId !== channel.id) return null;
  if (!channel.topic?.startsWith("SafeBot ")) {
    await channel.setTopic(createTicketChannelTopic({
      botId: currentBotId,
      categoryId: metadata.categoryId,
      guildId: channel.guild.id,
      moduleType: metadata.moduleType,
      openerId: metadata.openerId,
      panelId: metadata.panelId,
      ticketId: recovered.ticket.id,
      ticketType: metadata.ticketType
    })).catch(() => null);
  }
  await context.api.recordTicketEvent(recovered.ticket.id, {
    authorId: context.client.user?.id ?? null,
    content: `Registro reconstruído a partir do tópico do canal ${channel.id}.`,
    eventType: "ticket.recovered_from_channel",
    guildId: channel.guild.id,
    metadata: { channelId: channel.id }
  }).catch(() => null);
  console.warn("[SafeBot][TicketReconcile][Handler:main] registro reconstruído", {
    channelId: channel.id,
    guildId: channel.guild.id,
    ticketId: recovered.ticket.id
  });
  return recovered.ticket;
}

async function recoverTicketMetadataFromPanelMessage(channel: TextChannel, context: BotContext, expectedTicketId?: string) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent?.size) return null;
  const botId = context.client.user?.id ?? null;
  for (const message of recent.values()) {
    if (botId && message.author.id !== botId) continue;
    const metadata = parseTicketPanelText(messageSearchText(message), channel, expectedTicketId, botId);
    if (metadata) return metadata;
  }
  for (const message of recent.values()) {
    const metadata = parseTicketPanelText(messageSearchText(message), channel, expectedTicketId, botId);
    if (metadata) return metadata;
  }
  return null;
}

function messageSearchText(message: Message) {
  return [
    message.content,
    JSON.stringify(message.components.map((component) => component.toJSON())),
    JSON.stringify(message.embeds.map((embed) => embed.toJSON()))
  ].join("\n").replace(/\\n/g, "\n").replace(/\\"/g, "\"");
}

export function parseTicketPanelText(text: string, channel: Pick<TextChannel, "guildId" | "parentId" | "name">, expectedTicketId?: string, botId: string | null = null): TicketRecoveryMetadata | null {
  const ticketId = text.match(/ID do Ticket:\s*#?([0-9a-f-]{36})/i)?.[1] ?? expectedTicketId ?? null;
  if (!ticketId || !/^[0-9a-f-]{36}$/i.test(ticketId) || (expectedTicketId && ticketId !== expectedTicketId)) return null;
  const openerId = text.match(/Autor:\s*<@!?(\d{5,32})>/i)?.[1] ?? text.match(/ID do usu[aá]rio:\s*(\d{5,32})/i)?.[1] ?? null;
  if (!openerId) return null;
  const categoryName = cleanRecoveredTicketText(text.match(/Categoria:\s*([^\n\r]+)/i)?.[1]) ?? "Atendimento";
  const subject = cleanRecoveredTicketText(text.match(/Acontecido:\s*([^\n\r]+)/i)?.[1] ?? text.match(/Assunto:\s*([^\n\r]+)/i)?.[1]) ?? channel.name;
  const categoryId = channel.parentId ?? slugRecoveredTicketToken(categoryName) ?? "ticket";
  const responsibleRoleId = text.match(/<@&(\d{5,32})>/)?.[1] ?? null;
  return {
    botId,
    categoryId,
    guildId: channel.guildId,
    moduleType: "default" as const,
    openerId,
    panelId: categoryId,
    responsibleRoleId,
    subject,
    ticketId,
    ticketType: slugRecoveredTicketToken(categoryName) ?? categoryId
  };
}

export function parseTicketChannelTopic(topic: string | null): TicketRecoveryMetadata | null {
  const normalized = topic?.trim();
  if (!normalized?.startsWith("SafeBot ")) return null;
  const metadata = Object.fromEntries([...normalized.slice("SafeBot ".length).matchAll(/([a-zA-Z]+)=([^\s]+)/g)].map(([, key, value]) => [key, value]));
  const ticketId = metadata.ticket;
  const openerId = metadata.opener;
  const categoryId = metadata.category;
  if (!ticketId || !/^[0-9a-f-]{36}$/i.test(ticketId) || !openerId || !/^\d{5,32}$/.test(openerId) || !categoryId) return null;
  const moduleType = metadata.module === "police" ? "police" : "default";
  return {
    botId: metadata.bot && /^\d{5,32}$/.test(metadata.bot) ? metadata.bot : null,
    categoryId,
    guildId: metadata.guild && /^\d{5,32}$/.test(metadata.guild) ? metadata.guild : null,
    moduleType,
    openerId,
    panelId: metadata.panel ?? categoryId,
    ticketId,
    ticketType: metadata.type ?? (moduleType === "police" ? "police" : categoryId)
  };
}

function cleanRecoveredTicketText(value: string | null | undefined) {
  const text = value?.replace(/[*_`]/g, "").replace(/\\+/g, "").trim();
  if (!text || text === "-" || text === "Não informado") return null;
  return text.slice(0, 120);
}

function slugRecoveredTicketToken(value: string) {
  const slug = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || null;
}

export function createTicketChannelTopic(input: {
  botId: string | null;
  categoryId: string;
  guildId: string;
  moduleType: TicketModuleType;
  openerId: string;
  panelId: string;
  ticketId: string;
  ticketType: string;
}) {
  return [
    "SafeBot",
    `ticket=${input.ticketId}`,
    `guild=${input.guildId}`,
    input.botId ? `bot=${input.botId}` : null,
    `opener=${input.openerId}`,
    `panel=${sanitizeTopicToken(input.panelId)}`,
    `category=${sanitizeTopicToken(input.categoryId)}`,
    `module=${input.moduleType}`,
    `type=${sanitizeTopicToken(input.ticketType)}`
  ].filter(Boolean).join(" ").slice(0, 1024);
}

export function scopedComponentId(prefix: string, action: string, guildId: string | null, botId: string | null, targetId: string) {
  return `${prefix}${action}:${guildId ?? "unknown"}:${botId ?? "unknown"}:${targetId}`;
}

export function parseScopedComponentId(customId: string, prefix: string, defaultAction?: string): TicketScopedId | null {
  if (!customId.startsWith(prefix)) return null;
  const payload = customId.slice(prefix.length);
  const parts = payload.split(":");

  if (defaultAction && parts.length === 1) {
    return { action: defaultAction, botId: null, guildId: null, legacy: true, targetId: parts[0] ?? "" };
  }

  if (!defaultAction && parts.length === 2) {
    return { action: parts[0] ?? "", botId: null, guildId: null, legacy: true, targetId: parts[1] ?? "" };
  }

  if (parts.length === 4) {
    return {
      action: parts[0] ?? defaultAction ?? "",
      botId: parts[2] === "unknown" ? null : parts[2] ?? null,
      guildId: parts[1] === "unknown" ? null : parts[1] ?? null,
      legacy: false,
      targetId: parts[3] ?? ""
    };
  }

  return null;
}

function validateScopedComponentInteraction(interaction: Interaction, parsed: TicketScopedId) {
  const currentBotId = interaction.client.user?.id ?? null;
  if (!parsed.targetId) return false;
  if (parsed.guildId && parsed.guildId !== interaction.guildId) {
    console.warn("[ticket-panel] interação rejeitada por guildId divergente", {
      action: parsed.action,
      currentGuildId: interaction.guildId,
      expectedGuildId: parsed.guildId,
      targetId: parsed.targetId
    });
    return false;
  }
  if (parsed.botId && currentBotId && parsed.botId !== currentBotId) {
    console.warn("[ticket-panel] interação rejeitada por botId divergente", {
      action: parsed.action,
      currentBotId,
      expectedBotId: parsed.botId,
      guildId: interaction.guildId,
      targetId: parsed.targetId
    });
    return false;
  }
  return true;
}

function validatePanelOpenButton(interaction: ButtonInteraction) {
  const [, guildId, botId] = interaction.customId.split(":");
  const currentBotId = interaction.client.user?.id ?? null;
  if (guildId && guildId !== interaction.guildId) return false;
  if (botId && botId !== "unknown" && currentBotId && botId !== currentBotId) return false;
  return true;
}

function resolveTicketModuleType(option: TicketPanelOption): TicketModuleType {
  return option.moduleType === "police" ? "police" : "default";
}

function resolveTicketType(option: TicketPanelOption, moduleType: TicketModuleType) {
  const normalized = option.ticketType?.trim().toLowerCase();
  if (normalized) return sanitizeTopicToken(normalized);
  return moduleType === "police" ? "police" : sanitizeTopicToken(option.value || "support");
}

function sanitizeTopicToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "default";
}

function slugTicketChannelName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "ticket";
}

function priorityLabel(value: TicketPanelOption["priority"] | string | null | undefined) {
  if (value === "low") return "Baixa";
  if (value === "high") return "Alta";
  if (value === "urgent") return "Urgente";
  return "Normal";
}

export function isPendingTicketLeaseActive(createdAt: string, now = Date.now()) {
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs) && now - createdAtMs >= 0 && now - createdAtMs < PENDING_TICKET_LEASE_MS;
}

async function canManageTicketInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ticket: TicketRecord
) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(member && (
    member.id === interaction.guild.ownerId
    || member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageChannels)
    || (ticket.responsibleRoleId && member.roles.cache.has(ticket.responsibleRoleId))
  ));
}

async function canManageSensitiveTicketLogAction(interaction: ButtonInteraction) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(member && (
    member.id === interaction.guild.ownerId
    || member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageChannels)
  ));
}

function createOpenTicketPayload(input: {
  category: string;
  clientLabel?: string | null;
  guild?: Guild | null;
  initialMessage?: string | null;
  mentionRoleId?: string | null;
  openerId: string;
  priority?: TicketPanelOption["priority"] | null;
  responsibleUserId?: string | null;
  status?: string;
  subject: string;
  ticketId: string;
}): MessageCreateOptions & MessageEditOptions {
  const {
    category,
    clientLabel = null,
    guild = null,
    initialMessage = null,
    mentionRoleId = null,
    openerId,
    priority = "normal",
    responsibleUserId = null,
    status = "Aguardando atendimento",
    subject,
    ticketId
  } = input;
  const guildId = guild?.id ?? null;
  const botId = guild?.client.user?.id ?? null;
  const firstActions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "claim", guildId, botId, ticketId)).setEmoji(systemComponentEmoji("homem", guild)).setLabel("Assumir Ticket").setStyle(ButtonStyle.Primary).setDisabled(Boolean(responsibleUserId)),
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "add", guildId, botId, ticketId)).setEmoji(systemComponentEmoji("acessar", guild)).setLabel("Adicionar Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "remove", guildId, botId, ticketId)).setEmoji(systemComponentEmoji("porta", guild)).setLabel("Remover Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "rename", guildId, botId, ticketId)).setEmoji(systemComponentEmoji("prancheta", guild)).setLabel("Renomear Ticket").setStyle(ButtonStyle.Secondary)
  );
  const secondActions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "call", guildId, botId, ticketId)).setEmoji("🔔").setLabel("Chamar Usuário").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "category", guildId, botId, ticketId)).setEmoji(systemComponentEmoji("prancheta", guild)).setLabel("Alterar Categoria").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "close", guildId, botId, ticketId)).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Fechar Ticket").setStyle(ButtonStyle.Danger)
  );
  const statusMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scopedComponentId(TICKET_STATUS_PREFIX, "status", guildId, botId, ticketId))
      .setPlaceholder("Alterar Status")
      .addOptions(STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })))
  );
  const mentionLine = mentionRoleId ? `<@&${mentionRoleId}>` : "";
  const createdAt = new Date();

  const content = [
      mentionLine,
      "## TICKET ABERTO",
      `Usuário: <@${openerId}>`,
      `ID: ${openerId}`,
      `Categoria: ${category}`,
      `Acontecido: ${subject}`,
      `Cliente: ${clientLabel ?? "Não informado"}`,
      `Servidor: ${guild?.name ?? "Não informado"}`,
      `Data: ${formatTicketDate(createdAt)}`,
      `Hora: ${formatTicketTime(createdAt)}`,
      `Responsável atual: ${responsibleUserId ? `<@${responsibleUserId}>` : "Nenhum atendente assumiu este ticket."}`,
      `Status: ${status}`,
      `Prioridade: ${priorityLabel(priority ?? "normal")}`,
      `ID do Ticket: #${ticketId}`,
      "",
      initialMessage ?? "Explique seu atendimento com o máximo de detalhes possível. Envie prints, vídeos ou provas se necessário."
    ].filter(Boolean).join("\n");

  return componentsV2Payload({
    accentColor: 0xffd500,
    allowedMentions: { roles: mentionRoleId ? [mentionRoleId] : [], users: [openerId, responsibleUserId].filter(Boolean) as string[] },
    components: [
      { type: 10, content },
      { type: 14, divider: true, spacing: 1 },
      firstActions,
      secondActions,
      statusMenu
    ],
    footer: null,
    guild
  }) as MessageCreateOptions & MessageEditOptions;
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

async function sendTicketOpenedDm(guild: Guild, userId: string, input: { channelId: string; createdAt: string; guildName: string; status: string; ticketId: string }) {
  try {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) return false;
    const url = ticketChannelUrl(guild.id, input.channelId);
    const payload = componentsV2Payload({
      accentColor: 0x5865f2,
      allowedMentions: { parse: [] },
      components: [
        { type: 10, content: [
          "## 🎫 Ticket aberto com sucesso",
          "",
          "Seu ticket foi criado.",
          "",
          `Número: #${input.ticketId}`,
          `Servidor: ${input.guildName}`,
          `Status: ${input.status}`,
          `Aberto em: <t:${Math.floor(Date.parse(input.createdAt) / 1000)}:F>`,
          "",
          "Nossa equipe foi avisada e responderá assim que possível."
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Acessar Ticket").setEmoji("🎫").setStyle(ButtonStyle.Link).setURL(url)
        )
      ]
    }) as MessageCreateOptions;
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

async function sendTicketCallDm(guild: Guild, userId: string, ticketUrl: string) {
  try {
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user) return false;
    const payload = componentsV2Payload({
      accentColor: 0x5865f2,
      allowedMentions: { parse: [] },
      components: [
        { type: 10, content: [
          "## 🔔 A equipe está aguardando sua resposta",
          "",
          "A equipe responsável pelo seu ticket está aguardando sua resposta."
        ].join("\n") },
        { type: 14, divider: true, spacing: 1 },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Acessar meu ticket").setEmoji("🎫").setStyle(ButtonStyle.Link).setURL(ticketUrl)
        )
      ]
    }) as MessageCreateOptions;
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

function ticketChannelUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function isTicketClosedLike(status: string | null | undefined) {
  return ["CLOSING", "CLOSED", "ARCHIVED", "RESOLVED", "DENIED", "INCOMPLETE"].includes(String(status ?? "").toUpperCase());
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
        new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "noop", guild.id, guild.client.user?.id ?? null, transcript.transcript.id)).setEmoji(systemComponentEmoji("link", guild)).setLabel("Copiar Link").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "newpass", guild.id, guild.client.user?.id ?? null, transcript.transcript.id)).setEmoji(systemComponentEmoji("relogio", guild)).setLabel("Gerar Nova Senha").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(scopedComponentId(TICKET_ACTION_PREFIX, "revoke", guild.id, guild.client.user?.id ?? null, transcript.transcript.id)).setEmoji(systemComponentEmoji("perigo", guild)).setLabel("Revogar Senhas").setStyle(ButtonStyle.Danger)
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
