import {
  ActionRowBuilder,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalSubmitInteraction,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type TextChannel,
  type TextBasedChannel
} from "discord.js";
import { env } from "../config/env";
import type { BotContext, GuildSettings, ReportSystemButtonKey, ReportSystemLogKey, ReportSystemSettings } from "../types";
import { resetSelectMenuMessage, showModalAndResetSelect } from "../utils/selectMenuReset";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";
import type { TicketRecord } from "./apiClient";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { resolveTranscriptUrl } from "./transcriptUrlService";

const PREFIX = "iab_admin";
const PANEL_SELECT_ID = "iab_report_select";
const PUBLIC_PREFIX = "iab";
const TOPIC_PREFIX = "nex-tech-iab:";
const LEGACY_IDENTIFIED_BUTTON_ID = "iab_denuncia_identificada";
const LEGACY_ANONYMOUS_BUTTON_ID = "iab_denuncia_anonima";
const ANONYMOUS_DISABLED_MESSAGE = "A denuncia anonima foi desativada. Abra o ticket com identificacao.";
const BUTTON_LABELS: Record<ReportSystemButtonKey, string> = {
  addMember: "Adicionar membro",
  claim: "Assumir denuncia",
  close: "Fechar denuncia",
  delete: "Excluir denuncia",
  removeMember: "Remover membro",
  reopen: "Reabrir denuncia",
  reply: "Responder",
  requestEvidence: "Solicitar provas",
  status: "Alterar status",
  transcript: "Exportar transcript"
};
const LOG_LABELS: Record<ReportSystemLogKey, string> = {
  admin: "Logs administrativos",
  anonymous: "Denuncias anonimas",
  closed: "Fechamento",
  messagesDeleted: "Mensagens apagadas",
  opened: "Abertura",
  replies: "Respostas",
  statusChanged: "Alteracao de status"
};
const ROLE_GROUPS = [
  ["viewRoleIds", "Visualizar denuncias"],
  ["replyRoleIds", "Responder denuncias"],
  ["closeRoleIds", "Fechar denuncias"],
  ["reopenRoleIds", "Reabrir denuncias"],
  ["adminRoleIds", "Administradores"],
  ["createRoleIds", "Criar denuncias"],
  ["permissionRoleIds", "Usar sistema"],
  ["mentionRoleIds", "Mencionar cargos"],
  ["statusRoleIds", "Alterar status"]
] as const;

type ReportMode = "anonymous" | "identified";
type ReportCompetence = "iab" | "conselho" | "hcmd" | "comissario";
type ReportTopic = {
  categoryId: string;
  categoryName: string;
  channelId: string;
  competence: ReportCompetence;
  mode: ReportMode;
  openerId: string;
  reporterCalled?: boolean;
  submittedAt?: string | null;
  status: "preparing" | "open" | "archived" | "closed";
  ticketId: string;
};

export async function openReportSystemAdmin(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  if (!canManageReportSystem(interaction.member as GuildMember, settings.reportSystem)) {
    await interaction.reply({ content: "Apenas administradores ou cargos configurados podem acessar este painel.", ephemeral: true });
    return;
  }

  await interaction.reply({ ...createAdminPayload(settings, "overview"), ephemeral: true });
}

export async function handleReportSystemInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable()) return false;

  if (interaction.isStringSelectMenu() && interaction.customId === PANEL_SELECT_ID) {
    await handlePublicReportSelect(interaction, context);
    return true;
  }

  if ("customId" in interaction && isPublicReportCustomId(String(interaction.customId))) {
    await handlePublicReportInteraction(interaction, context);
    return true;
  }

  if (!("customId" in interaction) || !String(interaction.customId).startsWith(PREFIX)) return false;

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  if (!interaction.member || !canManageReportSystem(interaction.member as GuildMember, settings.reportSystem)) {
    await interaction.reply({ content: "Voce nao tem permissao para configurar este sistema.", ephemeral: true });
    return true;
  }

  const [, action, target] = String(interaction.customId).split(":");

  if (interaction.isButton()) {
    if (action === "modal") {
      await interaction.showModal(createModal(target ?? "panel", settings.reportSystem));
      return true;
    }
    if (action === "toggle") {
      const next = patchToggle(settings.reportSystem, target ?? "");
      await saveAndRefresh(interaction, context, settings, next, "overview");
      return true;
    }
    if (action === "publish") {
      await interaction.update(createPublishPayload(settings));
      return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (action === "section") {
      await interaction.update(createAdminPayload(settings, interaction.values[0] ?? "overview"));
      return true;
    }
    if (action === "buttons") {
      const enabled = new Set(interaction.values);
      await saveAndRefresh(interaction, context, settings, { buttons: mapFromKeys(Object.keys(settings.reportSystem.buttons), enabled) as ReportSystemSettings["buttons"] }, "buttons");
      return true;
    }
    if (action === "logs") {
      const enabled = new Set(interaction.values);
      await saveAndRefresh(interaction, context, settings, { logs: mapFromKeys(Object.keys(settings.reportSystem.logs), enabled) as ReportSystemSettings["logs"] }, "logs");
      return true;
    }
    if (action === "category") {
      await handleCategoryAction(interaction, context, settings, interaction.values[0] ?? "");
      return true;
    }
    if (action === "status") {
      await handleStatusAction(interaction, context, settings, interaction.values[0] ?? "");
      return true;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    if (target === "publish-to") {
      await publishReportPanel(interaction.channel as TextBasedChannel | null, interaction, settings, channelId);
      return true;
    }
    await saveAndRefresh(interaction, context, settings, { [target ?? "panelChannelId"]: channelId }, "channels");
    return true;
  }

  if (interaction.isRoleSelectMenu()) {
    await saveAndRefresh(interaction, context, settings, { [target ?? "viewRoleIds"]: interaction.values }, "roles");
    return true;
  }

  if (interaction.isModalSubmit()) {
    await handleModal(interaction, context, settings, action ?? "");
    return true;
  }

  return false;
}

export async function handleReportSystemMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.channel.isTextBased() || message.channel.isDMBased() || !("topic" in message.channel)) {
    return false;
  }

  const settings = await getFreshGuildSettings(context, message.guild.id, message.client.user?.id).catch(() => null);
  if (!settings) return false;

  const topic = await resolveReportTopic(message.channel as TextChannel, context, settings);
  if (!topic || topic.status === "archived" || topic.status === "closed") {
    return false;
  }

  const report = settings.reportSystem;
  const isReporter = message.author.id === topic.openerId;
  const isStaff = !isReporter && (
    Boolean(message.member?.permissions.has(PermissionFlagsBits.Administrator))
    || reportCompetenceRoleIds(report, topic.competence).some((roleId) => message.member?.roles.cache.has(roleId))
  );
  const shouldRelay = topic.mode === "anonymous"
    ? isReporter || isStaff
    : isStaff;
  if (!shouldRelay) return false;

  const displayName = isReporter && topic.mode === "anonymous" ? report.anonymousReporterName : report.anonymousInvestigatorName;
  const files = message.attachments.map((attachment) => attachment.url);
  const content = [
    `**${displayName}:**`,
    message.content || (files.length ? "" : "(sem texto)"),
    files.join("\n")
  ].filter(Boolean).join("\n").slice(0, 1900);

  await message.delete().catch(() => null);
  const relayed = await (message.channel as TextChannel).send({
    allowedMentions: { parse: [] },
    content
  }).catch(() => null);

  await logIabEvent(context, message.guild, settings, topic, isReporter ? "Mensagem anonima" : "Resposta oculta da equipe", [
    `Autor real: ${message.author.tag} (${message.author.id})`,
    `Nome no servidor: ${message.member?.displayName ?? "-"}`,
    `Mensagem original: ${message.content || "(sem texto)"}`,
    relayed ? `Mensagem reenviada: ${relayed.id}` : "Mensagem reenviada: falhou",
    files.length ? `Anexos: ${files.join(", ")}` : null
  ].filter(Boolean).join("\n"), message.author.id);

  return true;
}

async function handlePublicReportSelect(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) {
    await safeReply(interaction, "Use este painel dentro de um servidor.");
    return;
  }

  const selectedCategoryId = interaction.values[0] ?? "";
  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  const report = settings.reportSystem;
  const category = report.categories.find((item) => item.enabled && item.id === selectedCategoryId);

  if (!report.enabled || !category) {
    await safeReply(interaction, "Esta opcao de denuncia nao esta mais disponivel.");
    return;
  }

  if (!canCreateReport(interaction.member as GuildMember | null, report)) {
    await safeReply(interaction, "Voce nao tem permissao para abrir denuncias neste servidor.");
    return;
  }

  if (!report.allowAnonymousReports) {
    await interaction.reply({ ...anonymousDisabledPayload(selectedCategoryId), flags: MessageFlags.Ephemeral });
    void resetSelectMenuMessage(interaction);
    return;
  }

  await interaction.reply({
    components: [
      {
        type: 17,
        accent_color: parseColor(report.panelColor),
        components: [
          { type: 10, content: replaceSystemEmojis(`# ${category.emoji ?? systemEmojiText("alerta", interaction.guild)} ${category.name}\nEscolha a modalidade da denúncia. A modalidade anônima protege a identidade no canal operacional, mantendo auditoria real apenas nos logs autorizados.`, interaction.guild) },
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${PUBLIC_PREFIX}:id:${selectedCategoryId}:identified`)
              .setLabel("Denuncia Identificada")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`${PUBLIC_PREFIX}:id:${selectedCategoryId}:anonymous`)
              .setLabel("Denuncia Anonima")
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      }
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  });
  void resetSelectMenuMessage(interaction);
}

async function handlePublicReportInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction)) return;

  const customId = String(interaction.customId);

  if (interaction.isButton()) {
    await handlePublicReportButton(interaction, context, customId);
    return;
  }

  if (interaction.isModalSubmit() && customId.startsWith(`${PUBLIC_PREFIX}:m:`)) {
    await submitPublicReport(interaction, context);
  }
}

async function handlePublicReportButton(interaction: ButtonInteraction, context: BotContext, customId: string) {
  if (customId === LEGACY_IDENTIFIED_BUTTON_ID || customId === LEGACY_ANONYMOUS_BUTTON_ID) {
    const settings = await getFreshGuildSettings(context, interaction.guildId!, interaction.client.user?.id);
    const category = settings.reportSystem.categories.find((item) => item.enabled);
    if (!category) {
      await safeReply(interaction, "Nenhum tipo de denuncia ativo foi encontrado. Avise a equipe para revisar o painel.");
      return;
    }
    const mode = customId === LEGACY_ANONYMOUS_BUTTON_ID ? "anonymous" : "identified";
    if (mode === "anonymous" && !settings.reportSystem.allowAnonymousReports) {
      await interaction.reply({ ...anonymousDisabledPayload(category.id), flags: MessageFlags.Ephemeral });
      return;
    }
    await openReportFromPanel(interaction, context, category.id, mode);
    return;
  }

  const [, action, categoryId, mode, extra] = customId.split(":");
  if (action === "id") {
    if (!categoryId) return safeReply(interaction, "Opcao de denuncia invalida.");
    await openReportFromPanel(interaction, context, categoryId, mode === "anonymous" ? "anonymous" : "identified");
    return;
  }

  if (action === "submit" || action === "submit-confirm" || action === "cancel" || action === "cancel-confirm" || action === "claim" || action === "call" || action === "archive" || action === "finish" || action === "finish-confirm") {
    if (!categoryId) return safeReply(interaction, "Ticket invalido.");
    await handleReportTicketButton(interaction, context, action, categoryId, mode);
    return;
  }

  if (action === "noop") {
    await interaction.deferUpdate().catch(() => null);
    return;
  }

  await safeReply(interaction, "Esta acao da denuncia nao esta disponivel no momento.");
}

async function openReportFromPanel(interaction: StringSelectMenuInteraction | ButtonInteraction, context: BotContext, categoryId: string, mode: ReportMode) {
  await interaction.deferReply({ ephemeral: true });
  const settings = await getFreshGuildSettings(context, interaction.guildId!, interaction.client.user?.id);
  const report = settings.reportSystem;
  const category = report.categories.find((item) => item.enabled && item.id === categoryId);

  if (!report.enabled || !category) {
    await interaction.editReply("Esta opcao de denuncia nao esta mais disponivel.");
    return;
  }
  if (mode === "anonymous" && !report.allowAnonymousReports) {
    await interaction.editReply(anonymousDisabledPayload(category.id));
    return;
  }
  if (!canCreateReport(interaction.member as GuildMember | null, report)) {
    await interaction.editReply("Voce nao tem permissao para abrir denuncias neste servidor.");
    return;
  }

  const channel = await createReportChannel(interaction.guild!, settings, {
    categoryId: category.id,
    categoryName: category.name,
    mode,
    openerId: interaction.user.id,
    summary: category.name
  }) as TextChannel | null;

  if (!channel) {
    await interaction.editReply("Nao consegui criar o canal da denuncia. Verifique categoria/permissoes do bot.");
    return;
  }

  const ticket = await context.api.createTicket({
    allowedRoleIds: reportCompetenceRoleIds(report, reportCompetence(category.id, category.name)),
    categoryId: category.id,
    categoryName: category.name,
    channelId: channel.id,
    guildId: interaction.guildId!,
    openerId: interaction.user.id,
    status: mode === "anonymous" ? "PENDING" : "OPEN",
    subject: `${mode === "anonymous" ? "Denuncia anonima" : "Denuncia identificada"} - ${category.name}`
  });
  const topic = makeTopic({
    categoryId: category.id,
    categoryName: category.name,
    channelId: channel.id,
    competence: reportCompetence(category.id, category.name),
    mode,
    openerId: interaction.user.id,
    status: mode === "anonymous" ? "preparing" : "open",
    ticketId: ticket.ticket.id
  });
  await channel.setTopic(topic).catch(() => null);

  if (mode === "anonymous") {
    await channel.send(createAnonymousPreparationPayload(settings, ticket.ticket, interaction.guild));
    await logIabEvent(context, interaction.guild!, settings, topicFromString(topic)!, "Criado", `Denuncia anonima criada em preparacao por ${interaction.user.tag}.`, interaction.user.id);
    await interaction.editReply(`Canal privado criado para preparar sua denuncia: <#${channel.id}>`);
    return;
  }

  await channel.send(withManagementMention(settings, createManagementPayload(settings, ticket.ticket, topicFromString(topic)!, "Aberto", undefined, interaction.guild)));
  await logIabEvent(context, interaction.guild!, settings, topicFromString(topic)!, "Criado", `Denuncia identificada criada por ${interaction.user.tag}.`, interaction.user.id);
  await interaction.editReply(`Denuncia identificada aberta: <#${channel.id}>`);
}

async function handleReportTicketButton(interaction: ButtonInteraction, context: BotContext, action: string, ticketId: string, arg1?: string) {
  const channel = interaction.channel;
  if (!channel?.isTextBased() || channel.isDMBased() || !("permissionOverwrites" in channel)) {
    await safeReply(interaction, "Esta acao precisa ser usada no canal da denuncia.");
    return;
  }
  const textChannel = channel as TextChannel;
  const settings = await getFreshGuildSettings(context, interaction.guildId!, interaction.client.user?.id);
  const topic = await resolveReportTopic(textChannel, context, settings);
  if (!topic || topic.ticketId !== ticketId) {
    await safeReply(interaction, "Nao consegui identificar esta denuncia.");
    return;
  }
  const ticket = await context.api.getTicket(ticketId);
  if (!ticket) {
    await safeReply(interaction, "Ticket nao encontrado no backend.");
    return;
  }

  if (isReportManagementAction(action)) {
    if (interaction.user.id === topic.openerId) {
      await safeReply(interaction, "Quem abriu esta denuncia nao pode assumir nem usar os botoes internos do atendimento.");
      return;
    }
    if (!canUseReportManagementAction(interaction.member as GuildMember | null, settings.reportSystem, topic)) {
      await safeReply(interaction, "Apenas a equipe responsavel pode usar os botoes internos desta denuncia.");
      return;
    }
  }

  if (action === "submit") {
    await interaction.reply({
      ...confirmPayload(settings, "Encaminhar denuncia", "Tem certeza que deseja encaminhar esta denuncia para a Corregedoria? Apos confirmar, voce perdera acesso ao canal.", `${PUBLIC_PREFIX}:submit-confirm:${ticketId}:${interaction.message.id}`, `${PUBLIC_PREFIX}:noop:${ticketId}`),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
    } as never);
    return;
  }
  if (action === "cancel") {
    await interaction.reply({
      ...confirmPayload(settings, "Cancelar denuncia", "Tem certeza que deseja cancelar esta denuncia? O canal sera apagado.", `${PUBLIC_PREFIX}:cancel-confirm:${ticketId}`, `${PUBLIC_PREFIX}:noop:${ticketId}`),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
    } as never);
    return;
  }
  if (action === "submit-confirm") {
    await submitAnonymousReport(interaction, context, settings, textChannel, ticket, topic, arg1);
    return;
  }
  if (action === "cancel-confirm") {
    await interaction.deferUpdate();
    await logIabEvent(context, interaction.guild!, settings, topic, "Cancelado", `Denuncia anonima cancelada por <@${interaction.user.id}> antes do envio.`, interaction.user.id);
    await textChannel.delete("Denuncia IAB cancelada antes do envio.").catch(() => null);
    return;
  }
  if (action === "claim") {
    await claimReport(interaction, context, settings, textChannel, ticket, topic);
    return;
  }
  if (action === "call") {
    await callReporter(interaction, context, settings, textChannel, ticket, topic);
    return;
  }
  if (action === "archive") {
    await archiveReport(interaction, context, settings, textChannel, ticket, topic);
    return;
  }
  if (action === "finish") {
    if (!canFinalizeReport(interaction.member as GuildMember | null, settings.reportSystem, ticket, topic, interaction.user.id)) {
      await safeReply(interaction, "Apenas a equipe responsável pode finalizar este ticket.");
      return;
    }
    await interaction.reply({
      ...confirmPayload(settings, "Finalizar denuncia", "Tem certeza que deseja finalizar esta denuncia? Apos confirmar, o canal sera apagado em 10 segundos e a acao sera registrada nas logs.", `${PUBLIC_PREFIX}:finish-confirm:${ticketId}:${interaction.message.id}`, `${PUBLIC_PREFIX}:noop:${ticketId}`),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
    } as never);
    return;
  }
  if (action === "finish-confirm") {
    if (!canFinalizeReport(interaction.member as GuildMember | null, settings.reportSystem, ticket, topic, interaction.user.id)) {
      await safeReply(interaction, "Apenas a equipe responsável pode finalizar este ticket.");
      return;
    }
    await interaction.deferUpdate();
    await closeReportChannel(context, interaction.guild!, settings, textChannel, ticket, topic, interaction.user.id, arg1);
  }
}

async function submitAnonymousReport(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, channel: TextChannel, ticket: TicketRecord, topic: ReportTopic, preparationPanelMessageId?: string) {
  await interaction.deferUpdate();
  const report = settings.reportSystem;
  const staffRoleIds = reportCompetenceRoleIds(report, topic.competence);
  const preparationPanel = preparationPanelMessageId
    ? await channel.messages.fetch(preparationPanelMessageId).catch(() => null)
    : null;
  const preparationId = preparationPanel?.id ?? interaction.message.id;
  const stats = await anonymizePreparedReporterMessages(channel, settings, topic, preparationId);
  await channel.permissionOverwrites.edit(topic.openerId, { ViewChannel: false, SendMessages: false }).catch(() => null);
  for (const roleId of staffRoleIds) {
    await channel.permissionOverwrites.edit(roleId, { AttachFiles: false, CreatePublicThreads: false, CreatePrivateThreads: false, ReadMessageHistory: true, SendMessages: false, ViewChannel: true }).catch(() => null);
  }
  if (channel.guild.members.me) {
    await channel.permissionOverwrites.edit(channel.guild.members.me.id, {
      AttachFiles: true,
      EmbedLinks: true,
      ManageChannels: true,
      ManageMessages: true,
      ReadMessageHistory: true,
      SendMessages: true,
      ViewChannel: true
    }).catch(() => null);
  }
  const submittedAt = new Date().toISOString();
  const nextTopic = { ...topic, status: "open" as const, submittedAt };
  await channel.setTopic(makeTopic(nextTopic)).catch(() => null);
  const updatedTicket = await context.api.updateTicketStatus(ticket.id, { status: "OPEN" });
  const managementPayload = withManagementMention(settings, createManagementPayload(settings, updatedTicket ?? ticket, nextTopic, "Em analise", stats, channel.guild));
  if (preparationPanel) {
    await preparationPanel.edit(managementPayload as never).catch(async () => {
      await channel.send(managementPayload).catch(() => null);
    });
  } else {
    await channel.send(managementPayload).catch(() => null);
  }
  await logIabEvent(context, interaction.guild!, settings, nextTopic, "Encaminhado", `Denuncia anonima encaminhada para a equipe por <@${interaction.user.id}>.`, interaction.user.id);
}

async function claimReport(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, channel: TextChannel, ticket: TicketRecord, topic: ReportTopic) {
  if (ticket.responsibleUserId && ticket.responsibleUserId !== interaction.user.id) {
    await safeReply(interaction, topic.mode === "anonymous" ? "Esta denuncia ja foi assumida por um responsavel." : `Esta denuncia ja foi assumida por <@${ticket.responsibleUserId}>.`);
    return;
  }
  if (topic.status === "archived" || topic.status === "closed") {
    await safeReply(interaction, "Esta denuncia nao pode mais ser assumida.");
    return;
  }
  await interaction.deferUpdate();
  const updated = await context.api.updateTicketStatus(ticket.id, { responsibleUserId: interaction.user.id, status: "IN_ANALYSIS" });
  const staffRoleIds = reportCompetenceRoleIds(settings.reportSystem, topic.competence);
  for (const roleId of staffRoleIds) {
    await channel.permissionOverwrites.edit(roleId, { AttachFiles: false, CreatePrivateThreads: false, CreatePublicThreads: false, ReadMessageHistory: true, SendMessages: false, ViewChannel: true }).catch(() => null);
  }
  await channel.permissionOverwrites.edit(interaction.user.id, { AttachFiles: true, ReadMessageHistory: true, SendMessages: true, ViewChannel: true }).catch(() => null);
  await interaction.message.edit(createManagementPayload(settings, updated ?? ticket, topic, "Em analise", undefined, interaction.guild) as never).catch(() => null);
  await logIabEvent(context, interaction.guild!, settings, topic, "Assumido", `Denuncia assumida por <@${interaction.user.id}>.`, interaction.user.id);
}

async function callReporter(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, channel: TextChannel, ticket: TicketRecord, topic: ReportTopic) {
  if (topic.reporterCalled) {
    await safeReply(interaction, "O denunciante ja foi chamado de volta uma vez.");
    return;
  }
  if (topic.status === "archived" || topic.status === "closed") {
    await safeReply(interaction, "Esta denuncia nao permite chamar o denunciante neste status.");
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  await channel.permissionOverwrites.edit(topic.openerId, { ViewChannel: true, SendMessages: true, AttachFiles: true, ReadMessageHistory: true }).catch(() => null);
  const url = `https://discord.com/channels/${channel.guild.id}/${channel.id}`;
  const user = await interaction.client.users.fetch(topic.openerId).catch(() => null);
  if (user) {
    await user.send({
      ...renderComponentsV2Panel({
        accentColor: parseColor(settings.reportSystem.panelColor),
        actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Acessar denuncia").setStyle(ButtonStyle.Link).setURL(url))],
        description: settings.reportSystem.subpoenaDmText || "Voce foi chamado de volta para complementar uma denuncia anonima.\nSua identidade continuara protegida no atendimento.\nAcesse o canal temporario para responder as informacoes solicitadas.",
        fields: [],
        image: settings.reportSystem.dmBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.reportSystem.dmBannerUrl } : null,
        moduleId: "iab-call",
        title: "A Corregedoria precisa de mais informacoes"
      })
    }).catch(() => null);
  }
  const nextTopic = { ...topic, reporterCalled: true };
  await channel.setTopic(makeTopic(nextTopic)).catch(() => null);
  await logIabEvent(context, interaction.guild!, settings, nextTopic, "Denunciante chamado", `Denunciante chamado por <@${interaction.user.id}>.`, interaction.user.id);
  await channel.send({ allowedMentions: { parse: [] }, content: "O denunciante foi chamado de volta para complementar a denuncia." }).catch(() => null);
  await interaction.message.edit(createManagementPayload(settings, ticket, nextTopic, "Denunciante chamado", undefined, interaction.guild) as never).catch(() => null);
  await interaction.editReply(`Acesso devolvido para <@${topic.openerId}>.`);
  void ticket;
}

async function archiveReport(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, channel: TextChannel, ticket: TicketRecord, topic: ReportTopic) {
  if (topic.status === "archived") {
    await safeReply(interaction, "Esta denuncia ja foi arquivada.");
    return;
  }
  if (topic.status === "closed") {
    await safeReply(interaction, "Esta denuncia ja foi finalizada.");
    return;
  }
  await interaction.deferUpdate();
  const updatedTicket = await context.api.updateTicketStatus(ticket.id, { status: "ARCHIVED" });
  const archiveCategoryId = settings.reportSystem.finishedCategoryId;
  if (archiveCategoryId) await channel.setParent(archiveCategoryId).catch(() => null);
  await channel.permissionOverwrites.edit(topic.openerId, { ViewChannel: false, SendMessages: false, AttachFiles: false }).catch(() => null);
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { SendMessages: false, AttachFiles: false, CreatePrivateThreads: false, CreatePublicThreads: false }).catch(() => null);
  const staffRoleIds = reportCompetenceRoleIds(settings.reportSystem, topic.competence);
  for (const roleId of staffRoleIds) {
    await channel.permissionOverwrites.edit(roleId, { AttachFiles: false, ReadMessageHistory: true, SendMessages: false, ViewChannel: true }).catch(() => null);
  }
  if (ticket.responsibleUserId) await channel.permissionOverwrites.edit(ticket.responsibleUserId, { AttachFiles: false, SendMessages: false, ViewChannel: true }).catch(() => null);
  const nextTopic = { ...topic, status: "archived" as const };
  await channel.setTopic(makeTopic(nextTopic)).catch(() => null);
  await finishReport(context, interaction.guild!, settings, channel, updatedTicket ?? ticket, nextTopic, "Arquivado", false, interaction.user.id, interaction.message);
}

async function finishReport(context: BotContext, guild: Guild, settings: GuildSettings, channel: TextChannel, ticket: TicketRecord, topic: ReportTopic, status: "Arquivado" | "Finalizado", deleteChannel: boolean, actorId: string, managementMessage?: Message) {
  const messages = await collectTranscriptMessages(channel, topic, settings);
  const transcript = await context.api.createTranscript({
    categoryName: topic.categoryName,
    channelId: channel.id,
    channelName: channel.name,
    closeReason: status,
    closedAt: new Date().toISOString(),
    closedById: actorId,
    finalResult: status,
    generateTemporaryPassword: true,
    guildId: guild.id,
    guildName: guild.name,
    isPartial: false,
    messages,
    openedById: topic.openerId,
    ownerId: topic.openerId,
    participants: participantsFromMessages(messages, topic, settings),
    responsibleUserId: ticket.responsibleUserId ?? null,
    temporaryPasswordTtlHours: 24 * 365,
    ticketId: ticket.id,
    type: "Denuncia"
  });
  const finalStatus = status === "Finalizado" ? "CLOSED" : "ARCHIVED";
  await context.api.updateTicketStatus(ticket.id, { closedAt: new Date().toISOString(), closedById: actorId, closeReason: status, finalResult: status, status: finalStatus });
  await sendTranscriptPanel(guild, settings, topic, ticket, transcript, status, messages);
  await logIabEvent(context, guild, settings, topic, status, `Denuncia ${status.toLowerCase()} por <@${actorId}>.`, actorId);
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { SendMessages: false }).catch(() => null);
  const nextTopic = { ...topic, status: status === "Finalizado" ? "closed" as const : "archived" as const };
  await channel.setTopic(makeTopic(nextTopic)).catch(() => null);
  if (deleteChannel) await channel.delete(`Denuncia IAB finalizada por ${actorId}`).catch(() => null);
  else if (managementMessage) await managementMessage.edit(createManagementPayload(settings, { ...ticket, status: finalStatus }, nextTopic, status, undefined, guild) as never).catch(() => null);
  else await channel.send(createManagementPayload(settings, { ...ticket, status: finalStatus }, nextTopic, status, undefined, guild)).catch(() => null);
}

async function closeReportChannel(context: BotContext, guild: Guild, settings: GuildSettings, channel: TextChannel, ticket: TicketRecord, topic: ReportTopic, actorId: string, managementMessageId?: string) {
  if (topic.status === "closed") return;
  const managementMessage = managementMessageId ? await channel.messages.fetch(managementMessageId).catch(() => null) : null;
  await channel.send({ allowedMentions: { parse: [] }, content: "Este canal sera finalizado em 10 segundos." }).catch(() => null);
  await finishReport(context, guild, settings, channel, ticket, topic, "Finalizado", false, actorId, managementMessage ?? undefined);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await channel.delete(`Denuncia IAB finalizada por ${actorId}`).catch(() => null);
}

function createAnonymousPreparationPayload(settings: GuildSettings, ticket: TicketRecord, guild: Guild | null = null): MessageCreateOptions {
  const report = settings.reportSystem;
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:submit:${ticket.id}`).setEmoji(systemComponentEmoji("acessar")).setLabel("Encaminhar denuncia").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:cancel:${ticket.id}`).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar envio da denuncia").setStyle(ButtonStyle.Danger)
  );
  return renderComponentsV2Panel({
    accentColor: parseColor(report.anonymousEmbedColor),
    actions: [actions],
    description: "Este canal privado serve apenas para preparar a denuncia antes de enviar para a equipe responsavel.",
    fields: [
      "Envie todas as provas antes de confirmar.\nAguarde todos os arquivos terminarem o upload.\nApos confirmar, voce perdera acesso ao canal.",
      "A equipe recebera a denuncia sem ver sua identidade no painel. Sua identidade sera registrada apenas nas logs internas administrativas."
    ],
    guild,
    image: report.thumbnailUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.thumbnailUrl } : null,
    moduleId: "iab-anonymous-prep",
    title: "Preparacao da Denuncia Anonima"
  });
}

function createReporterCalledPayload(settings: GuildSettings, ticket: TicketRecord, topic: ReportTopic, guild: Guild | null = null): MessageCreateOptions {
  const report = settings.reportSystem;
  return renderComponentsV2Panel({
    accentColor: parseColor(topic.mode === "anonymous" ? report.anonymousEmbedColor : report.panelColor),
    actions: [],
    description: topic.mode === "anonymous"
      ? "O denunciante recebeu acesso temporario. Tudo que ele enviar aqui sera apagado e reenviado pelo bot como Denunciante Anonimo."
      : "O denunciante recebeu acesso ao canal para complementar as informacoes.",
    fields: [
      `**Ticket:** ${ticket.id}\n**Status:** Denunciante chamado\n**Orgao:** ${topic.categoryName}`,
      topic.mode === "anonymous" ? "**Identidade no canal:** Denunciante Anonimo" : `**Denunciante:** <@${topic.openerId}>`
    ],
    guild,
    image: report.dmBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.dmBannerUrl } : null,
    moduleId: "iab-reporter-called",
    title: "Denunciante chamado"
  });
}

async function anonymizePreparedReporterMessages(channel: TextChannel, settings: GuildSettings, topic: ReportTopic, panelMessageId: string) {
  const collected: Message[] = [];
  let before: string | undefined;
  do {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
  } while (before && collected.length < 500);

  const reporterMessages = collected
    .filter((message) => message.author.id === topic.openerId && message.id !== panelMessageId)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let attachmentCount = 0;
  for (const message of reporterMessages) {
    const files = message.attachments.map((attachment) => attachment.url);
    attachmentCount += files.length;
    const content = [
      `**${settings.reportSystem.anonymousReporterName}:**`,
      message.content || (files.length ? "" : "(sem texto)"),
      files.join("\n")
    ].filter(Boolean).join("\n").slice(0, 1900);

    await channel.send({ allowedMentions: { parse: [] }, content }).catch(() => null);
    await message.delete().catch(() => null);
  }

  return { attachmentCount, messageCount: reporterMessages.length };
}

function createManagementPayload(settings: GuildSettings, ticket: TicketRecord, topic: ReportTopic, statusLabel: string, stats?: { attachmentCount: number; messageCount: number }, guild: Guild | null = null): MessageCreateOptions {
  const report = settings.reportSystem;
  const isAnonymous = topic.mode === "anonymous";
  const isArchived = topic.status === "archived";
  const isClosed = topic.status === "closed";
  const claimed = Boolean(ticket.responsibleUserId);
  const calledBack = Boolean(topic.reporterCalled);
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:claim:${ticket.id}`).setEmoji(systemComponentEmoji("homem", guild)).setLabel(topic.mode === "anonymous" ? "Assumir denuncia" : "Assumir ticket").setStyle(ButtonStyle.Primary).setDisabled(!report.buttons.claim || isArchived || isClosed || (isAnonymous && claimed)),
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:call:${ticket.id}`).setEmoji(systemComponentEmoji("acessar", guild)).setLabel("Chamar denunciante de volta").setStyle(ButtonStyle.Secondary).setDisabled(isArchived || isClosed || (isAnonymous && calledBack)),
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:archive:${ticket.id}`).setEmoji(systemComponentEmoji("caixa", guild)).setLabel("Arquivar").setStyle(ButtonStyle.Secondary).setDisabled(isArchived || isClosed),
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:finish:${ticket.id}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Finalizar").setStyle(ButtonStyle.Danger).setDisabled(isClosed)
  );
  return renderComponentsV2Panel({
    accentColor: topic.mode === "anonymous" ? 0xf2b84b : parseColor(report.panelColor),
    actions: [actions],
    description: topic.mode === "anonymous"
      ? "Uma nova denuncia anonima foi encaminhada para analise.\n\nAs provas enviadas pelo denunciante estao disponiveis neste canal. A identidade do denunciante permanece oculta para a equipe responsavel.\n\nSomente as logs administrativas internas registram a identidade real do denunciante."
      : "Denuncia identificada aberta. O denunciante fica visivel, mas as respostas da equipe continuam sendo encaminhadas pelo bot.",
    fields: [
      `**Numero da denuncia:** ${ticket.id}\n**Orgao responsavel:** ${topic.categoryName}\n**Status:** ${statusLabel}\n**Denunciante:** ${topic.mode === "anonymous" ? "Anonimo" : `<@${topic.openerId}>`}`,
      `**Data de envio:** ${topic.submittedAt ? `<t:${Math.floor(Date.parse(topic.submittedAt) / 1000)}:F>` : "-"}\n**Mensagens enviadas:** ${stats?.messageCount ?? "-"}\n**Anexos enviados:** ${stats?.attachmentCount ?? "-"}`,
      `**Responsavel atual:** ${ticket.responsibleUserId ? (topic.mode === "anonymous" ? "Equipe responsavel" : `<@${ticket.responsibleUserId}>`) : "Ninguem assumiu ainda"}\n**Denunciante chamado de volta:** ${topic.reporterCalled ? "Sim" : "Nao"}\n**Transcript:** ${topic.status === "archived" || topic.status === "closed" ? "Gerado" : "Aguardando arquivamento/finalizacao"}`,
      `**Canal de origem:** <#${topic.channelId}>\n**Categoria atual:** ${topic.categoryName}`
    ],
    guild,
    image: report.imageUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.imageUrl } : null,
    moduleId: "iab-management",
    title: topic.mode === "anonymous" && topic.status === "archived" ? "Denuncia Anonima Arquivada" : topic.mode === "anonymous" ? "Denuncia Anonima Recebida" : "Painel de Gerenciamento da Denuncia"
  });
}

function withManagementMention(settings: GuildSettings, payload: MessageCreateOptions): MessageCreateOptions {
  const roleIds = settings.reportSystem.mentionRoleIds.slice(0, 10);
  if (!roleIds.length) return payload;
  const mentions = roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
  const components = Array.isArray(payload.components) ? [...payload.components] as Array<Record<string, unknown>> : [];
  const container = components[0];
  const containerComponents = Array.isArray(container?.components) ? [...container.components] : null;
  if (!container || !containerComponents) return payload;
  const firstActionIndex = containerComponents.findIndex((component) => {
    if (!component || typeof component !== "object") return false;
    return (component as { type?: unknown }).type === 1;
  });
  const mentionComponent = { type: 10, content: `**Equipe notificada:** ${mentions}` };
  if (firstActionIndex >= 0) containerComponents.splice(firstActionIndex, 0, mentionComponent);
  else containerComponents.push(mentionComponent);
  return {
    ...payload,
    allowedMentions: { roles: roleIds },
    components: ([{ ...container, components: containerComponents }, ...components.slice(1)] as unknown) as MessageCreateOptions["components"]
  };
}

function confirmPayload(settings: GuildSettings, title: string, description: string, confirmId: string, cancelId: string): MessageCreateOptions {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.reportSystem.panelColor),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setEmoji(systemComponentEmoji("perigo")).setLabel(title).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar").setStyle(ButtonStyle.Secondary)
    )],
    description,
    fields: [],
    image: null,
    moduleId: "iab-confirm",
    title
  });
}

function anonymousDisabledPayload(categoryId: string) {
  return {
    allowedMentions: { parse: [] },
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PUBLIC_PREFIX}:id:${categoryId}:identified`)
        .setEmoji(systemComponentEmoji("acessar"))
        .setLabel("Abrir Denuncia Identificada")
        .setStyle(ButtonStyle.Primary)
    )],
    content: ANONYMOUS_DISABLED_MESSAGE
  };
}

async function sendTranscriptPanel(guild: Guild, settings: GuildSettings, topic: ReportTopic, ticket: TicketRecord, transcript: Awaited<ReturnType<BotContext["api"]["createTranscript"]>>, status: string, messages: Awaited<ReturnType<typeof collectTranscriptMessages>>) {
  const report = settings.reportSystem;
  const channelId = report.transcriptChannelId ?? reportCompetenceLogChannelId(report, topic.competence);
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const url = resolveTranscriptUrl(transcript);
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  const closedAt = new Date();
  const attachmentCount = messages.reduce((total, message) => total + message.attachments.length, 0);
  const participants = new Set(messages.map((message) => message.authorId).filter(Boolean));
  const expiresAt = transcript.temporaryPasswordExpiresAt ?? transcript.transcript.expiresAt;
  await (channel as TextChannel).send(renderComponentsV2Panel({
    accentColor: 0xf2b84b,
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setEmoji(systemComponentEmoji("link", guild)).setLabel("Abrir Transcript").setStyle(ButtonStyle.Link).setURL(url),
      new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:copylink:${ticket.id}`).setEmoji(systemComponentEmoji("link", guild)).setLabel("Copiar Link").setStyle(ButtonStyle.Secondary).setDisabled(true)
    )],
    description: "O atendimento foi finalizado e o transcript foi salvo com seguranca. Apenas pessoas autorizadas neste canal de logs devem acessar este registro.",
    fields: [
      `**Informacoes do Ticket**\n**Ticket:** ${ticket.id}\n**Canal:** <#${topic.channelId}>\n**Tipo:** ${topic.mode === "anonymous" ? "Denuncia Anonima" : "Denuncia Identificada"}\n**Status:** ${formatTranscriptStatus(status, guild)}`,
      `**Envolvidos**\n**Denunciante real:** <@${topic.openerId}> (${topic.openerId})\n**Responsavel:** ${ticket.responsibleUserId ? `<@${ticket.responsibleUserId}>` : "Nao assumido"}\n**Orgao:** ${topic.categoryName}`,
      `**Dados do Caso**\n**Criado em:** ${createdAt ? `<t:${Math.floor(createdAt.getTime() / 1000)}:F>` : "-"}\n**Fechado em:** <t:${Math.floor(closedAt.getTime() / 1000)}:F>\n**Tempo total:** ${createdAt ? formatElapsed(createdAt, closedAt) : "-"}\n**Resumo:** ${messages.length} mensagens, ${attachmentCount} anexos, ${participants.size} participantes`,
      `**Transcript e Seguranca**\n**Link:** ${url}\n**Protecao:** Senha obrigatoria\n**Senha:** ${transcript.temporaryPassword ? `||${transcript.temporaryPassword}||` : "nao gerada"}\n**Expira em:** ${expiresAt ? `<t:${Math.floor(Date.parse(expiresAt) / 1000)}:D>` : "configuracao padrao"}`
    ],
    guild,
    image: report.thumbnailUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.thumbnailUrl } : null,
    moduleId: "iab-transcript",
    title: `${systemEmojiText("folha", guild)} Transcript Gerado`
  })).catch(() => null);
}

function formatTranscriptStatus(status: string, guild: Guild | null = null) {
  const normalized = status.toLowerCase();
  if (normalized.includes("final")) return `${systemStatusEmoji("active", guild)} ${status}`;
  if (normalized.includes("arquiv")) return `${systemEmojiText("caixa", guild)} ${status}`;
  if (normalized.includes("pend")) return `${systemStatusEmoji("pending", guild)} ${status}`;
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

async function logIabEvent(context: BotContext, guild: Guild, settings: GuildSettings, topic: ReportTopic, action: string, message: string, actorId: string | null) {
  const report = settings.reportSystem;
  await context.api.recordTicketEvent(topic.ticketId, {
    authorId: actorId,
    content: message,
    eventType: `iab.${slug(action)}`,
    guildId: guild.id,
    metadata: {
      action,
      channelId: topic.channelId,
      competence: topic.competence,
      mode: topic.mode,
      openerId: topic.openerId,
      status: topic.status
    }
  }).catch(() => null);

  const channelId = reportCompetenceLogChannelId(report, topic.competence);
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  await (channel as TextChannel).send(renderComponentsV2Panel({
    accentColor: parseColor(topic.mode === "anonymous" ? report.anonymousEmbedColor : report.panelColor),
    actions: [],
    description: message,
    fields: [
      `**Ticket:** ${topic.ticketId}\n**Tipo:** ${topic.mode === "anonymous" ? "Denuncia Anonima" : "Denuncia Identificada"}\n**Orgao:** ${topic.categoryName}`,
      `**Denunciante real:** <@${topic.openerId}> (${topic.openerId})\n${actorId ? `**Executor:** <@${actorId}> (${actorId})` : "**Executor:** Sistema"}\n**Canal:** <#${topic.channelId}>`,
      `**Status:** ${topic.status}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`
    ],
    image: report.thumbnailUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.thumbnailUrl } : null,
    moduleId: "iab-log",
    title: `IAB | ${action}`
  })).catch(() => null);
}

async function collectTranscriptMessages(channel: TextChannel, topic: ReportTopic, settings: GuildSettings) {
  const collected: Message[] = [];
  let before: string | undefined;
  do {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
  } while (before && collected.length < 1000);

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp).map((message) => ({
    anonymous: topic.mode === "anonymous",
    attachments: message.attachments.map((attachment) => ({ contentType: attachment.contentType, id: attachment.id, name: attachment.name, size: attachment.size, url: attachment.url })),
    authorAvatarUrl: message.author.displayAvatarURL(),
    authorId: message.author.id,
    authorName: maskedNameForMessage(message, topic, settings),
    authorRoleIds: message.member?.roles.cache.map((role) => role.id) ?? [],
    botRelayed: message.author.id === message.client.user.id,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    embeds: message.embeds.map((embed) => embed.toJSON()),
    id: message.id,
    system: message.system
  }));
}

function participantsFromMessages(messages: Awaited<ReturnType<typeof collectTranscriptMessages>>, topic: ReportTopic, settings: GuildSettings) {
  const participants = new Map<string, { id: string; name: string; role: string | null }>();
  participants.set(topic.openerId, { id: topic.openerId, name: topic.mode === "anonymous" ? settings.reportSystem.anonymousReporterName : `@${topic.openerId}`, role: "Denunciante" });
  for (const message of messages) {
    if (message.authorId) participants.set(message.authorId, { id: message.authorId, name: message.authorName, role: null });
  }
  return [...participants.values()];
}

function maskedNameForMessage(message: Message, topic: ReportTopic, settings: GuildSettings) {
  if (topic.mode !== "anonymous") return message.author.tag;
  if (message.author.id === topic.openerId) return settings.reportSystem.anonymousReporterName;
  if (message.author.bot) return message.author.tag;
  return settings.reportSystem.anonymousInvestigatorName;
}

function makeTopic(topic: ReportTopic) {
  return `${TOPIC_PREFIX}${Buffer.from(JSON.stringify(topic), "utf8").toString("base64url")}`;
}

async function resolveReportTopic(channel: TextChannel, context: BotContext, settings: GuildSettings) {
  const fromTopic = topicFromString(channel.topic);
  if (fromTopic) return fromTopic;

  const ticket = await context.api.getTicketByChannel(channel.id).catch(() => null);
  if (!ticket || ticket.status === "CLOSED") return null;

  const categoryId = ticket.categoryId ?? "iab";
  const categoryName = ticket.categoryName ?? "IAB";
  const mode: ReportMode = /anonim|anonima|anonymous/i.test(ticket.subject) || ticket.status === "PENDING" ? "anonymous" : "identified";
  const status: ReportTopic["status"] = ticket.status === "ARCHIVED"
    ? "archived"
    : ticket.status === "CLOSED"
      ? "closed"
      : ticket.status === "PENDING"
        ? "preparing"
        : "open";
  const topic: ReportTopic = {
    categoryId,
    categoryName,
    channelId: channel.id,
    competence: reportCompetence(categoryId, categoryName),
    mode,
    openerId: ticket.openerId,
    status,
    ticketId: ticket.id
  };

  await channel.setTopic(makeTopic(topic)).catch(() => null);
  await logIabEvent(context, channel.guild, settings, topic, "Estado restaurado", "Estado da denuncia restaurado pelo ticket persistido no backend apos reinicio ou perda do topico do canal.", null);
  return topic;
}

function topicFromString(value: string | null | undefined): ReportTopic | null {
  if (!value?.startsWith(TOPIC_PREFIX)) return null;
  try {
    return JSON.parse(Buffer.from(value.slice(TOPIC_PREFIX.length), "base64url").toString("utf8")) as ReportTopic;
  } catch {
    return null;
  }
}

function createPublicReportModal(categoryId: string, mode: "anonymous" | "identified", categoryName: string) {
  return new ModalBuilder()
    .setCustomId(`${PUBLIC_PREFIX}:m:${categoryId}:${mode}`)
    .setTitle(mode === "anonymous" ? "Denuncia anonima" : "Denuncia identificada")
    .addComponents(
      inputRow("summary", "Resumo da denuncia", categoryName, TextInputStyle.Short, 120),
      inputRow("reported", "Denunciado(s) ou envolvidos", "", TextInputStyle.Short, 180, false),
      inputRow("description", "Descreva o ocorrido", "", TextInputStyle.Paragraph, 1800),
      inputRow("evidence", "Provas / links / observacoes", "", TextInputStyle.Paragraph, 1000, false)
    );
}

async function submitPublicReport(interaction: ModalSubmitInteraction, context: BotContext) {
  await interaction.deferReply({ ephemeral: true });

  const [, , categoryId, modeValue] = interaction.customId.split(":");
  const mode = modeValue === "anonymous" ? "anonymous" : "identified";
  const settings = await getFreshGuildSettings(context, interaction.guildId!, interaction.client.user?.id);
  const report = settings.reportSystem;
  const category = report.categories.find((item) => item.enabled && item.id === categoryId);

  if (!report.enabled || !category) {
    await interaction.editReply("Este tipo de denuncia nao esta mais disponivel.");
    return;
  }

  if (mode === "anonymous" && !report.allowAnonymousReports) {
    await interaction.editReply(anonymousDisabledPayload(category.id));
    return;
  }

  if (!canCreateReport(interaction.member as GuildMember | null, report)) {
    await interaction.editReply("Voce nao tem permissao para abrir denuncias neste servidor.");
    return;
  }

  const summary = fieldValue(interaction, "summary") || category.name;
  const reported = fieldValue(interaction, "reported") || "Nao informado";
  const description = fieldValue(interaction, "description");
  const evidence = fieldValue(interaction, "evidence") || "Nao informado";
  if (!description) {
    await interaction.editReply("A descricao da denuncia e obrigatoria.");
    return;
  }

  const channel = await createReportChannel(interaction.guild!, settings, {
    categoryId: category.id,
    categoryName: category.name,
    mode,
    openerId: interaction.user.id,
    summary
  });

  if (!channel) {
    await interaction.editReply("Nao consegui criar o canal da denuncia. Verifique categoria/permissoes do bot e tente novamente.");
    return;
  }

  await channel.send(createOpenedReportPayload(settings, {
    categoryName: category.name,
    description,
    evidence,
    mode,
    openerId: interaction.user.id,
    reported,
    summary
  }));

  await sendReportLog(interaction.guild!, settings, {
    categoryName: category.name,
    channelId: channel.id,
    competence: reportCompetence(category.id, category.name),
    mode,
    openerId: interaction.user.id,
    summary
  });

  await interaction.editReply(
    mode === "anonymous"
      ? "Sua denuncia anonima foi enviada para a equipe autorizada."
      : `Sua denuncia foi aberta: <#${channel.id}>`
  );
}

async function createReportChannel(guild: Guild, settings: GuildSettings, input: { categoryId: string; categoryName: string; mode: "anonymous" | "identified"; openerId: string; summary: string }) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return null;
  }

  const report = settings.reportSystem;
  const competence = reportCompetence(input.categoryId, input.categoryName);
  const staffRoleIds = reportCompetenceRoleIds(report, competence);
  const otherRoleIds = allReportCompetenceRoleIds(report).filter((roleId) => !staffRoleIds.includes(roleId));
  const parent = reportCompetenceCategoryId(report, competence) ?? report.categoryId ?? undefined;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ...otherRoleIds.map((id) => ({ id, deny: [PermissionFlagsBits.ViewChannel] }))
  ];

  if (input.mode === "identified") {
    overwrites.push(...staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })));
    overwrites.push({ id: input.openerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] });
  } else {
    overwrites.push(...staffRoleIds.map((id) => ({ id, deny: [PermissionFlagsBits.ViewChannel] })));
    overwrites.push({ id: input.openerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] });
  }

  const channelName = `denuncia-${input.mode === "anonymous" ? "anonima" : "id"}-${slug(input.categoryName)}-${input.openerId.slice(-4)}`.slice(0, 90);
  return guild.channels.create({
    name: channelName,
    parent,
    permissionOverwrites: overwrites,
    reason: `Denuncia ${input.mode} aberta por ${input.openerId}: ${input.summary}`,
    type: ChannelType.GuildText
  });
}

function createOpenedReportPayload(settings: GuildSettings, input: { categoryName: string; description: string; evidence: string; mode: "anonymous" | "identified"; openerId: string; reported: string; summary: string }): MessageCreateOptions {
  const report = settings.reportSystem;
  const reporterLabel = input.mode === "anonymous" ? report.anonymousReporterName : `<@${input.openerId}>`;
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:ack:claim`).setLabel(BUTTON_LABELS.claim).setStyle(ButtonStyle.Primary).setDisabled(!report.buttons.claim),
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:ack:status`).setLabel(BUTTON_LABELS.status).setStyle(ButtonStyle.Secondary).setDisabled(!report.buttons.status),
    new ButtonBuilder().setCustomId(`${PUBLIC_PREFIX}:ack:close`).setLabel(BUTTON_LABELS.close).setStyle(ButtonStyle.Danger).setDisabled(!report.buttons.close)
  );

  return renderComponentsV2Panel({
    accentColor: parseColor(input.mode === "anonymous" ? report.anonymousEmbedColor : report.panelColor),
    actions: [actions],
    description: report.openMessage,
    fields: [
      `**Tipo:** ${input.categoryName}\n**Modo:** ${input.mode === "anonymous" ? "Anonima" : "Identificada"}\n**Denunciante:** ${reporterLabel}`,
      `**Resumo:** ${input.summary}\n**Envolvidos:** ${input.reported}`,
      `**Descricao**\n${input.description}`,
      `**Provas / observacoes**\n${input.evidence}`
    ],
    image: null,
    moduleId: "iab-report",
    title: replaceSystemEmojis(`${report.panelEmoji ?? systemEmojiText("alerta")} Nova denuncia`)
  });
}

async function sendReportLog(guild: Guild, settings: GuildSettings, input: { categoryName: string; channelId: string; competence: "iab" | "conselho" | "hcmd" | "comissario"; mode: "anonymous" | "identified"; openerId: string; summary: string }) {
  const report = settings.reportSystem;
  const logChannelId = reportCompetenceLogChannelId(report, input.competence);
  if (!logChannelId || !report.logs.opened) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({
    content: `Nova denuncia ${input.mode === "anonymous" ? "anonima" : "identificada"} em <#${input.channelId}> | Tipo: **${input.categoryName}** | Resumo: **${input.summary}**${input.mode === "identified" ? ` | Autor: <@${input.openerId}>` : ""}`
  }).catch(() => null);
}

function canCreateReport(member: GuildMember | null, report: ReportSystemSettings) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (!report.permissionRoleIds.length && !report.createRoleIds.length) return true;
  return [...report.permissionRoleIds, ...report.createRoleIds].some((roleId) => member.roles.cache.has(roleId));
}

function canFinalizeReport(member: GuildMember | null, report: ReportSystemSettings, ticket: TicketRecord, topic: ReportTopic, userId: string) {
  if (!member) return false;
  if (userId === topic.openerId) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (ticket.responsibleUserId && ticket.responsibleUserId === userId) return true;
  const authorizedRoleIds = [...report.adminRoleIds, ...report.closeRoleIds, ...reportCompetenceRoleIds(report, topic.competence)];
  return authorizedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function isReportManagementAction(action: string) {
  return ["claim", "call", "archive", "finish", "finish-confirm"].includes(action);
}

function canUseReportManagementAction(member: GuildMember | null, report: ReportSystemSettings, topic: ReportTopic) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const authorizedRoleIds = [
    ...report.adminRoleIds,
    ...report.replyRoleIds,
    ...report.closeRoleIds,
    ...report.reopenRoleIds,
    ...report.statusRoleIds,
    ...reportCompetenceRoleIds(report, topic.competence)
  ];
  return [...new Set(authorizedRoleIds)].some((roleId) => member.roles.cache.has(roleId));
}

function reportCompetence(categoryId: string, categoryName: string): "iab" | "conselho" | "hcmd" | "comissario" {
  const value = `${categoryId} ${categoryName}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (value.includes("comiss")) return "comissario";
  if (value.includes("high") || value.includes("hcmd") || value.includes("command")) return "hcmd";
  if (value.includes("conselho")) return "conselho";
  return "iab";
}

function reportCompetenceRoleIds(report: ReportSystemSettings, competence: "iab" | "conselho" | "hcmd" | "comissario") {
  const fallbackIab = [...report.viewRoleIds, ...report.replyRoleIds, ...report.closeRoleIds, ...report.reopenRoleIds, ...report.adminRoleIds];
  const ids = competence === "iab"
    ? [...report.iabRoleIds, ...fallbackIab]
    : competence === "conselho"
      ? report.conselhoRoleIds
      : competence === "hcmd"
        ? report.hcmdRoleIds
        : report.comissarioRoleIds;
  return [...new Set(ids)];
}

function allReportCompetenceRoleIds(report: ReportSystemSettings) {
  return [...new Set([
    ...reportCompetenceRoleIds(report, "iab"),
    ...reportCompetenceRoleIds(report, "conselho"),
    ...reportCompetenceRoleIds(report, "hcmd"),
    ...reportCompetenceRoleIds(report, "comissario")
  ])];
}

function reportCompetenceCategoryId(report: ReportSystemSettings, competence: "iab" | "conselho" | "hcmd" | "comissario") {
  return competence === "iab"
    ? report.iabCategoryId
    : competence === "conselho"
      ? report.conselhoCategoryId
      : competence === "hcmd"
        ? report.hcmdCategoryId
        : report.comissarioCategoryId;
}

function reportCompetenceLogChannelId(report: ReportSystemSettings, competence: "iab" | "conselho" | "hcmd" | "comissario") {
  return competence === "iab"
    ? report.iabLogChannelId ?? report.logChannelId
    : competence === "conselho"
      ? report.conselhoLogChannelId ?? report.logChannelId
      : competence === "hcmd"
        ? report.hcmdLogChannelId ?? report.logChannelId
        : report.comissarioLogChannelId ?? report.logChannelId;
}

function isPublicReportCustomId(customId: string) {
  return customId.startsWith(`${PUBLIC_PREFIX}:`) || customId === LEGACY_IDENTIFIED_BUTTON_ID || customId === LEGACY_ANONYMOUS_BUTTON_ID;
}

async function safeReply(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) return;
  const payload = { content, ephemeral: true };
  if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
}

function fieldValue(interaction: ModalSubmitInteraction, id: string) {
  return interaction.fields.getTextInputValue(id).trim();
}

function createAdminPayload(settings: GuildSettings, section: string) {
  const report = settings.reportSystem;
  const fields = [
    `Sistema: **${report.enabled ? "ativo" : "inativo"}**`,
    `Painel: ${report.panelChannelId ? `<#${report.panelChannelId}>` : "nao definido"}`,
    `Categoria: ${report.categoryId ? `<#${report.categoryId}>` : "nao definida"}`,
    `Categorias: **${report.categories.length}** | Status: **${report.statuses.length}**`,
    sectionText(section, report)
  ];

  return renderComponentsV2Panel({
    accentColor: parseColor(report.panelColor),
    actions: sectionActions(section, report),
    description: "IAB Config. Configure cargos, categorias, logs, banners, órgãos e publicação do painel. As alterações são salvas na mesma configuração usada pela dashboard.",
    fields,
    image: null,
    moduleId: "iab-admin",
    title: replaceSystemEmojis(`${report.panelEmoji ?? systemEmojiText("alerta")} IAB Config`)
  });
}

function sectionActions(section: string, report: ReportSystemSettings) {
  const rows: unknown[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:section`)
        .setPlaceholder("Escolha a area de configuracao")
        .addOptions([
          option("overview", "Resumo"),
          option("panel", "Painel de denuncias"),
          option("channels", "Cargos e categorias"),
          option("roles", "Cargos responsaveis"),
          option("categories", "Orgaos"),
          option("anonymity", "Anonimato"),
          option("permissions", "Permissoes"),
          option("status", "Status"),
          option("buttons", "Botoes"),
          option("logs", "Logs"),
          option("publish", "Publicar painel")
        ])
    )
  ];

  if (section === "panel") rows.push(buttonRow([["modal:panel", "Editar painel", ButtonStyle.Primary], ["toggle:enabled", report.enabled ? "Desativar" : "Ativar", ButtonStyle.Secondary]]));
  if (section === "channels") rows.push(...channelRows());
  if (section === "roles") rows.push(...roleRows(report, 0));
  if (section === "permissions") rows.push(...roleRows(report, 5));
  if (section === "categories") rows.push(categoryRow(report), buttonRow([["modal:category-new", "Adicionar tipo", ButtonStyle.Primary]]));
  if (section === "anonymity") rows.push(buttonRow([["modal:anonymity", "Editar anonimato", ButtonStyle.Primary], ["toggle:anonymousReports", report.allowAnonymousReports ? "Bloquear anonimas" : "Permitir anonimas", ButtonStyle.Secondary], ["toggle:anonymousStaff", report.allowAnonymousStaffReplies ? "Bloquear equipe anonima" : "Permitir equipe anonima", ButtonStyle.Secondary]]));
  if (section === "status") rows.push(statusRow(report), buttonRow([["modal:status-new", "Adicionar status", ButtonStyle.Primary]]));
  if (section === "buttons") rows.push(multiToggleRow(`${PREFIX}:buttons`, "Botoes exibidos", BUTTON_LABELS, report.buttons));
  if (section === "logs") rows.push(multiToggleRow(`${PREFIX}:logs`, "Logs ativos", LOG_LABELS, report.logs));
  if (section === "publish") rows.push(buttonRow([["publish", "Publicar Painel", ButtonStyle.Success]]));

  return rows;
}

function sectionText(section: string, report: ReportSystemSettings) {
  if (section === "channels") return "Configure categoria temporaria, canais de logs, transcript e auditoria.";
  if (section === "roles") return "Defina cargos administrativos e operacionais. Administradores do Discord sempre podem acessar.";
  if (section === "categories") return report.categories.map((item) => replaceSystemEmojis(`${item.enabled ? "ON" : "OFF"} ${item.emoji ?? ""} **${item.name}**`)).join("\n");
  if (section === "anonymity") return `Denuncias anonimas: **${report.allowAnonymousReports ? "sim" : "nao"}**\nRespostas anonimas da equipe: **${report.allowAnonymousStaffReplies ? "sim" : "nao"}**`;
  if (section === "status") return report.statuses.map((item) => `**${item.order}.** ${item.name}`).join("\n");
  if (section === "buttons") return "Marque os botoes que devem aparecer nas denuncias.";
  if (section === "logs") return "Marque quais eventos serao enviados aos canais de log/auditoria.";
  if (section === "publish") return "Clique em Publicar Painel e escolha o canal onde o painel de denuncias sera enviado.";
  return `Titulo: **${report.panelTitle}**\nDescricao: ${report.panelDescription.slice(0, 220)}`;
}

function channelRows() {
  return [
    channelRow("panelChannelId", "Canal do painel", [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
    channelRow("categoryId", "Categoria das denuncias", [ChannelType.GuildCategory]),
    channelRow("finishedCategoryId", "Categoria fixa de arquivamento", [ChannelType.GuildCategory]),
    channelRow("logChannelId", "Canal de logs", [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
    channelRow("transcriptChannelId", "Canal de transcripts", [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
    channelRow("auditChannelId", "Canal de auditoria", [ChannelType.GuildText, ChannelType.GuildAnnouncement])
  ];
}

function roleRows(report: ReportSystemSettings, offset: number) {
  return ROLE_GROUPS.slice(offset, offset + 5).map(([key, label]) => new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:roles:${key}`).setPlaceholder(`${label} (${report[key].length})`).setMinValues(0).setMaxValues(10)
  ));
}

function categoryRow(report: ReportSystemSettings) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:category`)
      .setPlaceholder("Editar, remover ou reordenar tipo")
      .addOptions(report.categories.flatMap((item) => [
        option(`edit:${item.id}`, `Editar ${item.name}`),
        option(`toggle:${item.id}`, `${item.enabled ? "Desativar" : "Ativar"} ${item.name}`),
        option(`up:${item.id}`, `Subir ${item.name}`),
        option(`down:${item.id}`, `Descer ${item.name}`),
        option(`delete:${item.id}`, `Remover ${item.name}`)
      ]).slice(0, 25))
  );
}

function statusRow(report: ReportSystemSettings) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:status`)
      .setPlaceholder("Editar, remover ou reordenar status")
      .addOptions(report.statuses.flatMap((item) => [
        option(`edit:${item.id}`, `Editar ${item.name}`),
        option(`up:${item.id}`, `Subir ${item.name}`),
        option(`down:${item.id}`, `Descer ${item.name}`),
        option(`delete:${item.id}`, `Remover ${item.name}`)
      ]).slice(0, 25))
  );
}

function createModal(kind: string, report: ReportSystemSettings) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:${kind}`).setTitle("Sistema de Denuncias");
  if (kind === "panel") {
    return modal.addComponents(
      inputRow("panelTitle", "Titulo", report.panelTitle, TextInputStyle.Short, 120),
      inputRow("panelDescription", "Descricao", report.panelDescription, TextInputStyle.Paragraph, 1000),
      inputRow("panelColor", "Cor da embed (#RRGGBB)", report.panelColor, TextInputStyle.Short, 7),
      inputRow("panelPlaceholder", "Placeholder do menu", report.panelPlaceholder, TextInputStyle.Short, 120),
      inputRow("footerText", "Footer", report.footerText ?? "", TextInputStyle.Short, 180)
    );
  }
  if (kind === "anonymity") {
    return modal.addComponents(
      inputRow("anonymousReporterName", "Nome do denunciante anonimo", report.anonymousReporterName, TextInputStyle.Short, 80),
      inputRow("anonymousInvestigatorName", "Nome dos investigadores", report.anonymousInvestigatorName, TextInputStyle.Short, 80),
      inputRow("anonymousAvatarUrl", "Avatar anonimo (URL)", report.anonymousAvatarUrl ?? "", TextInputStyle.Short, 2048, false),
      inputRow("anonymousEmbedColor", "Cor das embeds anonimas", report.anonymousEmbedColor, TextInputStyle.Short, 7),
      inputRow("openMessage", "Mensagem padrao de abertura", report.openMessage, TextInputStyle.Paragraph, 1000)
    );
  }
  if (kind === "category-new") {
    return modal.addComponents(inputRow("name", "Nome", "", TextInputStyle.Short, 80), inputRow("emoji", "Emoji", "", TextInputStyle.Short, 80, false), inputRow("description", "Descricao", "", TextInputStyle.Short, 100, false), inputRow("color", "Cor", "#dc2626", TextInputStyle.Short, 7), inputRow("channelOrCategoryId", "Canal/categoria especifica (ID)", "", TextInputStyle.Short, 32, false));
  }
  if (kind === "status-new") {
    return modal.addComponents(inputRow("name", "Nome", "", TextInputStyle.Short, 80), inputRow("color", "Cor", "#64748b", TextInputStyle.Short, 7));
  }
  const [, id] = kind.split("-");
  const category = report.categories.find((item) => item.id === id);
  if (kind.startsWith("category-edit") && category) {
    return modal.addComponents(inputRow("name", "Nome", category.name, TextInputStyle.Short, 80), inputRow("emoji", "Emoji", category.emoji ?? "", TextInputStyle.Short, 80, false), inputRow("description", "Descricao", category.description ?? "", TextInputStyle.Short, 100, false), inputRow("color", "Cor", category.color, TextInputStyle.Short, 7), inputRow("channelOrCategoryId", "Canal/categoria especifica (ID)", category.channelOrCategoryId ?? "", TextInputStyle.Short, 32, false));
  }
  const status = report.statuses.find((item) => item.id === id);
  if (kind.startsWith("status-edit") && status) {
    return modal.addComponents(inputRow("name", "Nome", status.name, TextInputStyle.Short, 80), inputRow("color", "Cor", status.color, TextInputStyle.Short, 7));
  }
  return modal.addComponents(inputRow("infoMessage", "Mensagem informativa", report.infoMessage, TextInputStyle.Paragraph, 1800));
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext, settings: GuildSettings, action: string) {
  const report = settings.reportSystem;
  const value = (id: string) => interaction.fields.getTextInputValue(id).trim();
  if (action === "panel") {
    await saveAndRefresh(interaction, context, settings, { footerText: value("footerText") || null, panelColor: value("panelColor"), panelDescription: value("panelDescription"), panelPlaceholder: value("panelPlaceholder"), panelTitle: value("panelTitle") }, "panel");
    return;
  }
  if (action === "anonymity") {
    await saveAndRefresh(interaction, context, settings, { anonymousAvatarUrl: value("anonymousAvatarUrl") || null, anonymousEmbedColor: value("anonymousEmbedColor"), anonymousInvestigatorName: value("anonymousInvestigatorName"), anonymousReporterName: value("anonymousReporterName"), openMessage: value("openMessage") }, "anonymity");
    return;
  }
  if (action === "category-new") {
    const name = value("name");
    await saveAndRefresh(interaction, context, settings, { categories: [...report.categories, { channelOrCategoryId: value("channelOrCategoryId") || null, color: value("color") || "#dc2626", description: value("description") || null, emoji: value("emoji") || null, enabled: true, id: slug(name), name, order: report.categories.length + 1 }] }, "categories");
    return;
  }
  if (action.startsWith("category-edit-")) {
    const id = action.replace("category-edit-", "");
    await saveAndRefresh(interaction, context, settings, {
      categories: report.categories.map((item) => item.id === id
        ? { ...item, channelOrCategoryId: value("channelOrCategoryId") || null, color: value("color") || item.color, description: value("description") || null, emoji: value("emoji") || null, name: value("name") || item.name }
        : item)
    }, "categories");
    return;
  }
  if (action === "status-new") {
    const name = value("name");
    await saveAndRefresh(interaction, context, settings, { statuses: [...report.statuses, { color: value("color") || "#64748b", id: slug(name), name, order: report.statuses.length + 1 }] }, "status");
    return;
  }
  if (action.startsWith("status-edit-")) {
    const id = action.replace("status-edit-", "");
    await saveAndRefresh(interaction, context, settings, {
      statuses: report.statuses.map((item) => item.id === id ? { ...item, color: value("color") || item.color, name: value("name") || item.name } : item)
    }, "status");
    return;
  }
  await interaction.reply({ content: "Modal nao reconhecido.", ephemeral: true });
}

async function handleCategoryAction(interaction: StringSelectMenuInteraction, context: BotContext, settings: GuildSettings, selected: string) {
  const [op, id] = selected.split(":");
  const categories = [...settings.reportSystem.categories];
  const index = categories.findIndex((item) => item.id === id);
  if (index < 0) return interaction.update(createAdminPayload(settings, "categories"));
  if (op === "edit") return showModalAndResetSelect(interaction, createModal(`category-edit-${id}`, settings.reportSystem));
  if (op === "delete") categories.splice(index, 1);
  if (op === "toggle") {
    const current = categories[index];
    if (current) categories[index] = { ...current, enabled: !current.enabled };
  }
  if (op === "up" && index > 0) {
    const current = categories[index];
    const previous = categories[index - 1];
    if (current && previous) [categories[index - 1], categories[index]] = [current, previous];
  }
  if (op === "down" && index < categories.length - 1) {
    const current = categories[index];
    const next = categories[index + 1];
    if (current && next) [categories[index + 1], categories[index]] = [current, next];
  }
  await saveAndRefresh(interaction, context, settings, { categories: categories.map((item, order) => ({ ...item, order: order + 1 })) }, "categories");
}

async function handleStatusAction(interaction: StringSelectMenuInteraction, context: BotContext, settings: GuildSettings, selected: string) {
  const [op, id] = selected.split(":");
  const statuses = [...settings.reportSystem.statuses];
  const index = statuses.findIndex((item) => item.id === id);
  if (index < 0) return interaction.update(createAdminPayload(settings, "status"));
  if (op === "edit") return showModalAndResetSelect(interaction, createModal(`status-edit-${id}`, settings.reportSystem));
  if (op === "delete") statuses.splice(index, 1);
  if (op === "up" && index > 0) {
    const current = statuses[index];
    const previous = statuses[index - 1];
    if (current && previous) [statuses[index - 1], statuses[index]] = [current, previous];
  }
  if (op === "down" && index < statuses.length - 1) {
    const current = statuses[index];
    const next = statuses[index + 1];
    if (current && next) [statuses[index + 1], statuses[index]] = [current, next];
  }
  await saveAndRefresh(interaction, context, settings, { statuses: statuses.map((item, order) => ({ ...item, order: order + 1 })) }, "status");
}

async function saveAndRefresh(interaction: Interaction, context: BotContext, settings: GuildSettings, patch: Partial<ReportSystemSettings>, section: string) {
  const next = await context.api.updateSettingsFromBot(settings.guildId, { reportSystem: { ...settings.reportSystem, ...patch } as ReportSystemSettings });
  const payload = createAdminPayload(next, section);
  if (interaction.isMessageComponent()) await interaction.update(payload);
  else if (interaction.isModalSubmit()) await interaction.reply({ ...payload, ephemeral: true });
}

function createPublishPayload(settings: GuildSettings) {
  return renderComponentsV2Panel({
    accentColor: parseColor(settings.reportSystem.panelColor),
    actions: [channelRow("publish-to", "Canal para publicar", [ChannelType.GuildText, ChannelType.GuildAnnouncement])],
    description: "Selecione o canal onde o painel de denuncias sera publicado.",
    fields: [],
    image: null,
    moduleId: "iab-publish",
    title: "Publicar Painel"
  });
}

async function publishReportPanel(_: TextBasedChannel | null, interaction: ChannelSelectMenuInteraction, settings: GuildSettings, channelId: string | null) {
  const channel = channelId ? await interaction.guild?.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.reply({ content: "Selecione um canal de texto valido.", ephemeral: true });
    return;
  }
  await channel.send(createReportPanelPayload(settings));
  await interaction.update(createAdminPayload(settings, "publish"));
}

function createReportPanelPayload(settings: GuildSettings): MessageCreateOptions {
  const report = settings.reportSystem;
  const options = report.categories.filter((item) => item.enabled).slice(0, 25).map((item) => {
    const optionBuilder = new StringSelectMenuOptionBuilder().setLabel(item.name).setValue(item.id);
    if (item.description) optionBuilder.setDescription(item.description);
    if (item.emoji) optionBuilder.setEmoji(replaceSystemEmojis(item.emoji));
    return optionBuilder;
  });
  const action = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(PANEL_SELECT_ID).setPlaceholder(report.panelPlaceholder).addOptions(options));
  return renderComponentsV2Panel({
    accentColor: parseColor(report.panelColor),
    actions: [action],
    description: report.panelDescription,
    fields: [report.infoMessage].filter(Boolean),
    footer: { text: report.footerText ?? "OrviteK" },
    image: report.imageUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: report.imageUrl } : null,
    moduleId: "iab-panel",
    title: replaceSystemEmojis(`${report.panelEmoji ?? systemEmojiText("alerta")} ${report.panelTitle}`.trim())
  });
}

function canManageReportSystem(member: GuildMember, report: ReportSystemSettings) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return report.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function patchToggle(report: ReportSystemSettings, target: string): Partial<ReportSystemSettings> {
  if (target === "enabled") return { enabled: !report.enabled };
  if (target === "anonymousReports") return { allowAnonymousReports: !report.allowAnonymousReports };
  if (target === "anonymousStaff") return { allowAnonymousStaffReplies: !report.allowAnonymousStaffReplies };
  return {};
}

function mapFromKeys(keys: string[], enabled: Set<string>) {
  return Object.fromEntries(keys.map((key) => [key, enabled.has(key)]));
}

function option(value: string, label: string) {
  return new StringSelectMenuOptionBuilder().setLabel(label.slice(0, 100)).setValue(value.slice(0, 100));
}

function buttonRow(items: Array<[string, string, ButtonStyle]>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(items.map(([id, label, style]) => new ButtonBuilder().setCustomId(`${PREFIX}:${id}`).setLabel(label).setStyle(style)));
}

function channelRow(key: string, placeholder: string, channelTypes: ChannelType[]) {
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channels:${key}`).setPlaceholder(placeholder).setChannelTypes(...channelTypes).setMinValues(1).setMaxValues(1));
}

function multiToggleRow<T extends string>(customId: string, placeholder: string, labels: Record<T, string>, current: Record<T, boolean>) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(0)
      .setMaxValues(Object.keys(labels).length)
      .addOptions(Object.entries(labels).map(([key, label]) => new StringSelectMenuOptionBuilder().setLabel(String(label)).setValue(key).setDefault(Boolean(current[key as T]))))
  );
}

function inputRow(id: string, label: string, value: string, style: TextInputStyle, maxLength: number, required = true) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(maxLength).setRequired(required).setValue(value.slice(0, maxLength)));
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || `item-${Date.now()}`;
}

function parseColor(value: string | null | undefined) {
  const parsed = Number.parseInt(value?.replace("#", "") ?? "", 16);
  return Number.isFinite(parsed) ? parsed : 0xdc2626;
}
