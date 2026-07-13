import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext, GuildSettings, ReportSystemSettings } from "../types";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";
import { resolveTranscriptDownloadUrl, resolveTranscriptUrl } from "./transcriptUrlService";

type Competence = "iab" | "conselho" | "hcmd" | "comissario";
type Draft = {
  autoRedirected: boolean;
  createdById: string;
  finalCompetence: Competence;
  guildId: string;
  redirectReason: string | null;
  responsibleId: string;
  selectedCompetence: Competence;
  targetDisplayName: string;
  targetId: string;
};
type CaseState = Draft & {
  channelId: string;
  createdAt: string;
  deadline: string;
  description: string;
  reason: string;
  status: "open" | "finished" | "cancelled";
  title: string;
};

const PREFIX = "police_subpoena";
const MODULE_ID = "police-subpoenas";
const cases = new Map<string, CaseState>();
const flowDrafts = new Map<string, { selectedCompetence: Competence; targetId: string }>();
const relayingMessages = new Set<string>();

const COMPETENCE_LABEL: Record<Competence, string> = {
  comissario: "Comissário",
  conselho: "Conselho",
  hcmd: "High Command",
  iab: "IAB"
};

export const policeSubpoenaCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("intimacao")
    .setDescription("Cria uma intimação sigilosa com competência institucional."),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await openSubpoenaFlow(interaction, context);
  }
};

export async function openSubpoenaFlow(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  const report = settings.reportSystem;
  if (!report.enabled) {
    await interaction.reply({ content: "O sistema de intimações está desativado.", ephemeral: true });
    return;
  }
  if (!canUseCommand(interaction.member as GuildMember, report)) {
    await interaction.reply({ content: "Você não possui permissão para usar /intimacao.", ephemeral: true });
    return;
  }

  await interaction.reply({
    ...panel(settings, "Sistema de Competência das Intimações", "Selecione o órgão competente inicial da ocorrência.", [
      competenceSelect(`${PREFIX}:competence`, "Órgão competente")
    ], interaction.guild),
    ephemeral: true
  });
}

export async function handlePoliceSubpoenaInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable() || !("customId" in interaction)) return false;
  const customId = String(interaction.customId);
  if (!customId.startsWith(`${PREFIX}:`)) return false;

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);
  const parts = customId.split(":");
  const action = parts[1];

  if (!interaction.member || !canUseCommand(interaction.member as GuildMember, settings.reportSystem)) {
    await replyDenied(interaction);
    return true;
  }

  if (interaction.isStringSelectMenu() && action === "competence") return selectCompetence(interaction);
  if (interaction.isUserSelectMenu() && action === "target") return selectTarget(interaction, settings, parts[2]);
  if (interaction.isButton() && action === "open-modal") return openSubpoenaModal(interaction, parts[2], parts[3] ?? "");
  if (interaction.isModalSubmit() && action === "modal") return submitSubpoena(interaction, context, settings, parts[2], parts[3] ?? "");
  if (interaction.isButton() && ["finish", "cancel", "remind", "note"].includes(action ?? "")) return handleCaseButton(interaction, context, settings, action ?? "", parts[2] ?? "");
  if (interaction.isModalSubmit() && action === "note-modal") return submitNote(interaction, context, settings, parts[2] ?? "");

  return true;
}

async function selectCompetence(interaction: StringSelectMenuInteraction) {
  const competence = parseCompetence(interaction.values[0]) ?? "iab";
  await interaction.update(panel(null, "Selecionar intimado", "Selecione o membro que receberá a intimação.", [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${PREFIX}:target:${competence}`).setPlaceholder("Usuário intimado").setMinValues(1).setMaxValues(1)
    )
  ], interaction.guild));
  return true;
}

async function selectTarget(interaction: UserSelectMenuInteraction, settings: GuildSettings, selectedCompetenceInput: string | undefined) {
  const selectedCompetence = parseCompetence(selectedCompetenceInput);
  const targetId = interaction.values[0];
  if (!selectedCompetence || !targetId) {
    await interaction.reply({ content: "Seleção inválida. Use /intimacao novamente.", ephemeral: true });
    return true;
  }
  const targetMember = await interaction.guild!.members.fetch(targetId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: "Usuário não encontrado no servidor.", ephemeral: true });
    return true;
  }

  flowDrafts.set(flowKey(interaction), { selectedCompetence, targetId });
  await interaction.update(targetSelectedPanel(settings, selectedCompetence, targetMember));
  return true;
}

async function openSubpoenaModal(interaction: ButtonInteraction, selectedCompetenceInput: string | undefined, targetIdInput: string) {
  const fallback = flowDrafts.get(flowKey(interaction));
  const competence = parseCompetence(selectedCompetenceInput) ?? fallback?.selectedCompetence ?? null;
  const targetId = targetIdInput || fallback?.targetId || "";
  if (!competence || !targetId) {
    await interaction.reply({ content: "Seleção inválida. Selecione o intimado novamente.", ephemeral: true });
    return true;
  }
  const targetMember = await interaction.guild!.members.fetch(targetId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: "Usuário não encontrado no servidor. Selecione o intimado novamente.", ephemeral: true });
    return true;
  }
  await interaction.showModal(subpoenaModal(competence, targetId));
  return true;
}

async function submitSubpoena(interaction: ModalSubmitInteraction, context: BotContext, settings: GuildSettings, selectedCompetenceInput: string | undefined, targetIdInput: string) {
  await interaction.deferReply({ ephemeral: true });
  const fallback = flowDrafts.get(flowKey(interaction));
  const selectedCompetence = parseCompetence(selectedCompetenceInput) ?? fallback?.selectedCompetence ?? null;
  const targetId = targetIdInput || fallback?.targetId || "";
  if (!selectedCompetence || !targetId) {
    await interaction.editReply("Fluxo inválido: não consegui identificar o intimado selecionado. Use /intimacao novamente.");
    return true;
  }

  const target = await interaction.guild!.members.fetch(targetId).catch(() => null);
  if (!target) {
    await interaction.editReply("Intimado não encontrado no servidor.");
    return true;
  }

  const resolution = resolveCompetence(target, selectedCompetence, settings.reportSystem);
  const draft: Draft = {
    autoRedirected: resolution.finalCompetence !== selectedCompetence,
    createdById: interaction.user.id,
    finalCompetence: resolution.finalCompetence,
    guildId: interaction.guildId!,
    redirectReason: resolution.reason,
    responsibleId: interaction.user.id,
    selectedCompetence,
    targetDisplayName: target.displayName,
    targetId
  };
  const title = field(interaction, "title") || "Intimação";
  const description = field(interaction, "description") || "Não informado";
  const created = await createSubpoenaChannel(interaction.guild!, settings, draft, target, title);
  if (!created.channel) {
    await interaction.editReply(created.error);
    return true;
  }
  const channel = created.channel;

  const caseState: CaseState = { ...draft, channelId: channel.id, createdAt: new Date().toISOString(), deadline: settings.reportSystem.defaultDeadline, description, reason: title, status: "open", title };
  cases.set(channel.id, caseState);
  flowDrafts.delete(flowKey(interaction));

  await channel.send(casePanel(settings, caseState, channel.guild));
  const dmSent = await sendTargetDm(target, settings, caseState, channel);
  await sendCompetenceLog(interaction.guild!, settings, caseState, interaction.user.id, [
    `Ação: **Intimação criada**`,
    `Criada por: <@${interaction.user.id}> (${interaction.user.id})`,
    `Órgão selecionado: **${COMPETENCE_LABEL[draft.selectedCompetence]}**`,
    `Órgão final: **${COMPETENCE_LABEL[draft.finalCompetence]}**`,
    `Intimado: <@${target.id}> (${target.displayName})`,
    `Título: **${title}**`,
    `Canal: <#${channel.id}>`,
    `DM: **${dmSent ? "enviada" : "falhou"}**`,
    caseState.redirectReason ? `Redirecionamento: **${caseState.redirectReason}**` : null
  ].filter(Boolean).join("\n"));
  await sendCompetenceDestinationNotice(interaction.guild!, settings, caseState, interaction.user.id, channel);

  await interaction.editReply(`Intimação criada em <#${channel.id}>.`);
  return true;
}

export async function handlePoliceSubpoenaMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) return false;
  if (relayingMessages.has(message.id)) return true;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return false;

  const channel = message.channel as TextChannel;
  const state = cases.get(channel.id) ?? recoverCaseFromTextChannel(channel);
  if (!state || state.status !== "open") return false;

  const settings = await getFreshGuildSettings(context, message.guild.id, message.client.user?.id);
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (message.author.id === state.targetId || !member) return false;

  const me = message.guild.members.me ?? await message.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!canManageCase(member, settings.reportSystem, state)) {
    if (permissions?.has(PermissionFlagsBits.ManageMessages)) await message.delete().catch(() => null);
    if (permissions?.has(PermissionFlagsBits.SendMessages)) {
      const warning = await channel.send({ allowedMentions: { parse: [] }, content: "Apenas os responsáveis pelo órgão competente podem responder nesta intimação." }).catch(() => null);
      if (warning) setTimeout(() => void warning.delete().catch(() => null), 8_000).unref();
    }
    return true;
  }
  if (!permissions?.has(PermissionFlagsBits.ManageMessages) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    return false;
  }

  relayingMessages.add(message.id);
  try {
    const payload = anonymousIssuerPayload(message, subpoenaStaffDisplayName(settings.reportSystem, state));
    if (!payload.content && !payload.files?.length && !payload.stickers?.length) {
      await message.delete().catch(() => null);
      return true;
    }

    await message.delete().catch(() => null);
    const relayed = await channel.send(payload).catch(() => null);

    await sendCompetenceLog(message.guild, settings, state, message.author.id, [
      "Ação: **Mensagem anônima retransmitida**",
      `Autor real: <@${message.author.id}> (${message.author.tag})`,
      `Canal: <#${message.channelId}>`,
      relayed ? `Mensagem do bot: https://discord.com/channels/${message.guild.id}/${message.channelId}/${relayed.id}` : "Mensagem do bot: falhou",
      `Conteúdo: ${message.content ? message.content.slice(0, 1000) : "Sem texto"}`,
      `Anexos: ${message.attachments.size ? message.attachments.map((attachment) => attachment.url).join("\n") : "Nenhum"}`
    ].join("\n"));
  } finally {
    setTimeout(() => relayingMessages.delete(message.id), 30_000).unref();
  }

  return true;
}

async function handleCaseButton(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, action: string, channelId: string) {
  const state = cases.get(channelId) ?? await recoverCaseFromChannel(interaction, settings);
  if (!state) {
    await interaction.reply({ content: "Não encontrei os dados desta intimação após reinício. Gere uma nova intimação.", ephemeral: true });
    return true;
  }
  if (!interaction.member || !canManageCase(interaction.member as GuildMember, settings.reportSystem, state)) {
    await replyDenied(interaction);
    return true;
  }
  if (action === "note") {
    await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}:note-modal:${channelId}`).setTitle("Adicionar observação").addComponents(inputRow("note", "Observação", "", TextInputStyle.Paragraph, 1000)));
    return true;
  }
  if (action === "remind") {
    const target = await interaction.guild!.members.fetch(state.targetId).catch(() => null);
    const channel = interaction.channel?.isTextBased() ? interaction.channel as TextChannel : null;
    const sent = target && channel ? await sendTargetDm(target, settings, state, channel) : false;
    await sendCompetenceLog(interaction.guild!, settings, state, interaction.user.id, `Ação: **Lembrete por DM**\nResultado: **${sent ? "enviado" : "falhou"}**`);
    await interaction.reply({ content: sent ? "Lembrete enviado por DM." : "Não consegui enviar a DM.", ephemeral: true });
    return true;
  }
  if (action === "finish" || action === "cancel") {
    await closeSubpoena(interaction, context, settings, state, channelId, action === "finish" ? "Finalizada" : "Cancelada");
    return true;
  }
  return true;
}

async function closeSubpoena(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, state: CaseState, channelId: string, status: "Cancelada" | "Finalizada") {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.channel?.id === channelId && interaction.channel.isTextBased()
    ? interaction.channel as TextChannel
    : await interaction.guild!.channels.fetch(channelId).catch(() => null);
  if (!channel || !("delete" in channel) || !channel.isTextBased()) {
    await interaction.editReply("Não encontrei o canal da intimação para encerrar.");
    return;
  }

  state.status = status === "Finalizada" ? "finished" : "cancelled";
  cases.set(channelId, state);
  const transcript = await createSubpoenaTranscript(context, interaction.guild!, settings, channel as TextChannel, state, interaction.user.id, status).catch((error) => {
    console.error("[police-subpoena] failed to create transcript:", error instanceof Error ? error.message : error);
    return null;
  });
  if (!transcript) {
    state.status = "open";
    cases.set(channelId, state);
    await interaction.editReply("Não foi possível concluir o encerramento porque o transcript não foi salvo corretamente. O canal foi mantido para evitar perda de informações.");
    return;
  }
  await sendCompetenceLog(interaction.guild!, settings, state, interaction.user.id, [
    `Ação: **Intimação ${status.toLowerCase()}**`,
    status === "Cancelada" ? `Canal apagado: <#${channelId}>` : `Canal mantido: <#${channelId}>`,
    `Transcript: ${resolveTranscriptUrl(transcript)}`
  ].join("\n"));
  await interaction.message.edit(casePanel(settings, state, interaction.guild)).catch(() => null);
  if (status === "Finalizada") {
    if (settings.reportSystem.finishedCategoryId) {
      await (channel as TextChannel).setParent(settings.reportSystem.finishedCategoryId).catch(() => null);
    }
    await (channel as TextChannel).permissionOverwrites.edit(interaction.guild!.roles.everyone.id, { SendMessages: false }).catch(() => null);
    await interaction.editReply("Intimação finalizada. Transcript gerado e canal mantido para auditoria.");
    return;
  }

  cases.delete(channelId);
  await interaction.editReply("Intimação cancelada. Transcript gerado e canal será apagado.");
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await (channel as TextChannel).delete(`Intimação ${status.toLowerCase()} por ${interaction.user.tag} (${interaction.user.id})`).catch(() => null);
}

async function submitNote(interaction: ModalSubmitInteraction, _context: BotContext, settings: GuildSettings, channelId: string) {
  const state = cases.get(channelId) ?? await recoverCaseFromChannel(interaction, settings);
  if (!state || !interaction.member || !canManageCase(interaction.member as GuildMember, settings.reportSystem, state)) {
    await replyDenied(interaction);
    return true;
  }
  const note = field(interaction, "note");
  await interaction.reply(panel(settings, "Observação adicionada", note, [], interaction.guild));
  await sendCompetenceLog(interaction.guild!, settings, state, interaction.user.id, `Ação: **Observação adicionada**\n${note}`);
  return true;
}

function resolveCompetence(member: GuildMember, selected: Competence, report: ReportSystemSettings) {
  if (hasAnyRole(member, orgRoleIds(report, "hcmd"))) return { finalCompetence: "comissario" as const, reason: "caso redirecionado por envolver membro do High Command" };
  if (hasAnyRole(member, orgRoleIds(report, "iab"))) return { finalCompetence: "conselho" as const, reason: "caso redirecionado por envolver membro da IAB" };
  return { finalCompetence: selected, reason: null };
}

async function createSubpoenaChannel(guild: Guild, settings: GuildSettings, state: Draft, target: GuildMember, title: string) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { channel: null, error: "Não consegui criar o canal da intimação: falta a permissão Gerenciar Canais para o bot." };
  }

  const report = settings.reportSystem;
  const parent = await resolveSubpoenaParent(guild, report, state.finalCompetence);
  const roleIds = filterExistingRoles(guild, orgRoleIds(report, state.finalCompetence));
  if (!roleIds.length) {
    return { channel: null, error: `Configure pelo menos um cargo responsável para o órgão ${COMPETENCE_LABEL[state.finalCompetence]} antes de criar intimações.` };
  }
  const deniedRoleIds = filterExistingRoles(guild, allOrgRoleIds(report).filter((roleId) => !roleIds.includes(roleId)));
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    ...deniedRoleIds.map((id) => ({ id, deny: [PermissionFlagsBits.ViewChannel] })),
    ...roleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] })),
    { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }
  ];

  try {
    const channel = await guild.channels.create({
      name: `intimacao-${slug(target.displayName)}`.slice(0, 90),
      parent,
      permissionOverwrites: overwrites,
      reason: `Intimação ${COMPETENCE_LABEL[state.finalCompetence]}: ${title}`,
      topic: `intimacao:${state.finalCompetence}:${state.targetId}:${state.responsibleId ?? "0"}:${state.createdById}`,
      type: ChannelType.GuildText
    });
    return { channel, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[police-subpoena] failed to create channel in ${guild.id}:`, message);
    return { channel: null, error: `Não consegui criar o canal da intimação. Verifique as permissões do bot e se os cargos/canais configurados ainda existem. Detalhe: ${message.slice(0, 300)}` };
  }
}

function casePanel(settings: GuildSettings, state: CaseState, guild: Guild | null = null) {
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:finish:${state.channelId}`).setEmoji(systemComponentEmoji("visto", guild)).setLabel("Finalizar intimação").setStyle(ButtonStyle.Success).setDisabled(state.status !== "open"),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${state.channelId}`).setEmoji(systemComponentEmoji("exclamacao", guild)).setLabel("Cancelar intimação").setStyle(ButtonStyle.Danger).setDisabled(state.status !== "open"),
    new ButtonBuilder().setCustomId(`${PREFIX}:remind:${state.channelId}`).setEmoji(systemComponentEmoji("alerta", guild)).setLabel("Enviar lembrete DM").setStyle(ButtonStyle.Primary).setDisabled(state.status !== "open"),
    new ButtonBuilder().setCustomId(`${PREFIX}:note:${state.channelId}`).setEmoji(systemComponentEmoji("prancheta_caneta", guild)).setLabel("Adicionar observação").setStyle(ButtonStyle.Secondary)
  );
  const description = [
    "Painel interno sigiloso da intimação. A equipe responsável fica oculta para o intimado.",
    "",
    `**Usuário intimado:** <@${state.targetId}> (${state.targetDisplayName})`,
    "**Equipe responsável:** Sigilosa",
    "",
    `**Status:** ${statusLabel(state.status)}`,
    "",
    "**Descrição**",
    state.description || "Não informado",
    "",
    `**Criado em:** ${formatSubpoenaPanelDate(state.createdAt)}`
  ].join("\n").slice(0, 4000);

  return renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    actions: [actions],
    description,
    fields: [],
    guild,
    image: settings.reportSystem.subpoenaPanelBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.reportSystem.subpoenaPanelBannerUrl } : null,
    moduleId: "police-subpoena",
    title: "Intimação"
  });
}

async function sendTargetDm(target: GuildMember, settings: GuildSettings, state: CaseState, channel: TextChannel) {
  return target.send(renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setEmoji(systemComponentEmoji("acessar", channel.guild)).setLabel("Acessar intimação").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${channel.guildId}/${channel.id}`))],
    description: settings.reportSystem.subpoenaDmText,
    fields: [
      `Olá, **${target.displayName}**.\nVocê recebeu uma intimação institucional.`,
      `**Equipe responsável:** Sigilosa\n**Canal:** <#${channel.id}>`
    ],
    guild: channel.guild,
    image: settings.reportSystem.dmBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.reportSystem.dmBannerUrl } : null,
    moduleId: "police-subpoena-dm",
    title: `${systemEmojiText("alerta", channel.guild)} Aviso de Intimação`
  })).then(() => true, () => false);
}

async function sendCompetenceLog(guild: Guild, settings: GuildSettings, state: CaseState, executorId: string, description: string) {
  const channelId = logFor(settings.reportSystem, state.finalCompetence);
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send(renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    description,
    fields: [`**Executor:** <@${executorId}>\n**Competência:** ${COMPETENCE_LABEL[state.finalCompetence]}\n**Caso:** <#${state.channelId}>`],
    guild,
    image: null,
    moduleId: "police-subpoena-log",
    title: `${systemEmojiText("folha", guild)} Log de Intimação`
  })).catch(() => null);
}

async function createSubpoenaTranscript(context: BotContext, guild: Guild, settings: GuildSettings, channel: TextChannel, state: CaseState, actorId: string, status: "Cancelada" | "Finalizada") {
  const messages = await collectSubpoenaTranscriptMessages(channel, settings, state);
  const transcript = await context.api.createTranscript({
    categoryName: COMPETENCE_LABEL[state.finalCompetence],
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
    metadata: {
      competence: state.finalCompetence,
      module: MODULE_ID,
      targetId: state.targetId
    },
    openedById: state.createdById,
    ownerId: state.targetId,
    participants: subpoenaParticipantsFromMessages(messages, settings, state),
    responsibleUserId: state.responsibleId || null,
    temporaryPasswordTtlHours: 24 * 365,
    ticketId: `subpoena:${state.channelId}`,
    type: "Outro"
  });
  await sendSubpoenaTranscriptPanel(guild, settings, state, transcript, messages, status);
  return transcript;
}

async function sendSubpoenaTranscriptPanel(guild: Guild, settings: GuildSettings, state: CaseState, transcript: Awaited<ReturnType<BotContext["api"]["createTranscript"]>>, messages: Awaited<ReturnType<typeof collectSubpoenaTranscriptMessages>>, status: string) {
  const channelId = settings.reportSystem.transcriptChannelId ?? logFor(settings.reportSystem, state.finalCompetence);
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const url = resolveTranscriptUrl(transcript);
  const downloadUrl = resolveTranscriptDownloadUrl(transcript);
  const attachmentCount = messages.reduce((total, message) => total + message.attachments.length, 0);
  const participants = new Set(messages.map((message) => message.authorId).filter(Boolean));
  const expiresAt = transcript.temporaryPasswordExpiresAt ?? transcript.transcript.expiresAt;
  await (channel as TextChannel).send(renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setEmoji(systemComponentEmoji("acessar", guild)).setLabel("Abrir Transcript").setStyle(ButtonStyle.Link).setURL(url),
      new ButtonBuilder().setEmoji(systemComponentEmoji("prancheta", guild)).setLabel("Baixar Transcript").setStyle(ButtonStyle.Link).setURL(downloadUrl)
    )],
    description: "A intimação foi encerrada e o canal temporário foi apagado. O transcript foi salvo para auditoria autorizada.",
    fields: [
      `**Intimação**\n**Canal:** ${state.channelId}\n**Status:** ${status}\n**Órgão:** ${COMPETENCE_LABEL[state.finalCompetence]}`,
      `**Envolvidos**\n**Intimado:** <@${state.targetId}> (${state.targetId})\n**Criada por:** <@${state.createdById}>\n**Responsável:** <@${state.responsibleId}>`,
      `**Resumo**\n**Criada em:** <t:${Math.floor(new Date(state.createdAt).getTime() / 1000)}:F>\n**Mensagens:** ${messages.length}\n**Anexos:** ${attachmentCount}\n**Participantes:** ${participants.size}`,
      `**Acesso**\n**Link:** ${url}\n**Senha:** ${transcript.temporaryPassword ? `||${transcript.temporaryPassword}||` : "não gerada"}\n**Expira em:** ${expiresAt ? `<t:${Math.floor(Date.parse(expiresAt) / 1000)}:D>` : "configuração padrão"}`
    ],
    guild,
    image: settings.reportSystem.subpoenaPanelBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.reportSystem.subpoenaPanelBannerUrl } : null,
    moduleId: "police-subpoena-transcript",
    title: `${systemEmojiText("folha", guild)} Transcript de Intimação`
  })).catch(() => null);
}

async function sendCompetenceDestinationNotice(guild: Guild, settings: GuildSettings, state: CaseState, executorId: string, subpoenaChannel: TextChannel) {
  const destinationId = categoryFor(settings.reportSystem, state.finalCompetence);
  if (!destinationId || destinationId === subpoenaChannel.id) return;
  const destination = await guild.channels.fetch(destinationId).catch(() => null);
  if (!destination?.isTextBased() || !("send" in destination)) return;
  await (destination as TextChannel).send(renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    description: "Uma nova intimação foi registrada para este órgão.",
    fields: [
      `**Intimado:** <@${state.targetId}>\n**Órgão:** ${COMPETENCE_LABEL[state.finalCompetence]}`,
      `**Canal da intimação:** <#${subpoenaChannel.id}>\n**Criada por:** <@${executorId}>`
    ],
    guild,
    image: null,
    moduleId: "police-subpoena-destination",
    title: `${systemEmojiText("alerta", guild)} Nova Intimação`
  })).catch(() => null);
}

function panel(settings: GuildSettings | null, title: string, description: string, actions: unknown[], guild: Guild | null = null) {
  return renderComponentsV2Panel({ accentColor: color(settings?.reportSystem.panelColor), actions, description, fields: [], guild, image: null, moduleId: "police-subpoena-flow", title: `${systemEmojiText("prancheta", guild)} ${title}` });
}

function targetSelectedPanel(settings: GuildSettings, competence: Competence, target: GuildMember) {
  return panel(settings, "Intimado selecionado", `Intimado: <@${target.id}>\nÓrgão inicial: **${COMPETENCE_LABEL[competence]}**`, [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${PREFIX}:target:${competence}`).setPlaceholder("Trocar intimado").setMinValues(1).setMaxValues(1)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:open-modal:${competence}:${target.id}`).setEmoji(systemComponentEmoji("acessar", target.guild)).setLabel("Continuar").setStyle(ButtonStyle.Primary)
    )
  ], target.guild);
}

function anonymousIssuerPayload(message: Message, displayName: string): MessageCreateOptions {
  const files = message.attachments.map((attachment) => ({
    attachment: attachment.url,
    name: attachment.name ?? `arquivo-${attachment.id}`
  })).slice(0, 10);
  const stickers = message.stickers.map((sticker) => sticker.id).slice(0, 3);
  const options: MessageCreateOptions = { allowedMentions: { parse: [] } };

  const body = message.content || (files.length || stickers.length ? "" : "(sem texto)");
  options.content = `**${displayName}:**${body ? `\n${body}` : ""}`.slice(0, 2000);
  if (files.length) options.files = files;
  if (stickers.length) options.stickers = stickers;

  return options;
}

async function collectSubpoenaTranscriptMessages(channel: TextChannel, settings: GuildSettings, state: CaseState) {
  const collected: Message[] = [];
  let before: string | undefined;
  do {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
  } while (before);

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp).map((message) => ({
    anonymous: message.author.id !== state.targetId,
    attachments: message.attachments.map((attachment) => ({ contentType: attachment.contentType, id: attachment.id, name: attachment.name ?? `arquivo-${attachment.id}`, size: attachment.size, url: attachment.url })),
    authorAvatarUrl: message.author.displayAvatarURL(),
    authorId: message.author.id,
    authorName: subpoenaTranscriptAuthorName(message, settings, state),
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

function subpoenaParticipantsFromMessages(messages: Awaited<ReturnType<typeof collectSubpoenaTranscriptMessages>>, settings: GuildSettings, state: CaseState) {
  const participants = new Map<string, { id: string; name: string; role: string | null }>();
  participants.set(state.targetId, { id: state.targetId, name: state.targetDisplayName || `@${state.targetId}`, role: "Intimado" });
  participants.set("staff", { id: "staff", name: subpoenaStaffDisplayName(settings.reportSystem, state), role: "Equipe" });
  for (const message of messages) {
    if (!message.authorId || message.authorId === state.targetId) continue;
    participants.set("staff", { id: "staff", name: subpoenaStaffDisplayName(settings.reportSystem, state), role: "Equipe" });
  }
  return [...participants.values()];
}

function subpoenaTranscriptAuthorName(message: Message, settings: GuildSettings, state: CaseState) {
  if (message.author.id === state.targetId) return message.member?.displayName ?? message.author.tag;
  if (message.author.bot) return message.author.username;
  return subpoenaStaffDisplayName(settings.reportSystem, state);
}

function subpoenaModal(selectedCompetence: Competence, targetId: string) {
  return new ModalBuilder().setCustomId(`${PREFIX}:modal:${selectedCompetence}:${targetId}`).setTitle("Criar intimação").addComponents(
    inputRow("title", "Título da intimação", "", TextInputStyle.Short, 100, true, "Exemplo: Intimação Administrativa"),
    inputRow("description", "Descrição da intimação", "", TextInputStyle.Paragraph, 1200, true, "Descreva o motivo, orientações e informações da intimação")
  );
}

function competenceSelect(customId: string, placeholder: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions([
        option("iab", "IAB"),
        option("conselho", "Conselho"),
        option("hcmd", "High Command"),
        option("comissario", "Comissário")
      ])
  );
}

function option(value: Competence, label: string) { return new StringSelectMenuOptionBuilder().setLabel(label).setValue(value); }
function inputRow(id: string, label: string, value: string, style: TextInputStyle, max: number, required = true, placeholder?: string) { const input = new TextInputBuilder().setCustomId(id).setLabel(label).setValue(value.slice(0, max)).setStyle(style).setMaxLength(max).setRequired(required); if (placeholder) input.setPlaceholder(placeholder.slice(0, 100)); return new ActionRowBuilder<TextInputBuilder>().addComponents(input); }
function field(interaction: ModalSubmitInteraction, id: string) { return interaction.fields.getTextInputValue(id).trim(); }
function parseCompetence(value: string | undefined): Competence | null { return value === "iab" || value === "conselho" || value === "hcmd" || value === "comissario" ? value : null; }
function flowKey(interaction: { guildId: string | null; user: { id: string } }) { return `${interaction.guildId ?? "dm"}:${interaction.user.id}`; }
function hasAnyRole(member: GuildMember, roleIds: string[]) { return roleIds.some((roleId) => member.roles.cache.has(roleId)); }
function canUseCommand(member: GuildMember, report: ReportSystemSettings) { if (member.permissions.has(PermissionFlagsBits.Administrator)) return true; const ids = [...report.competenceCommandRoleIds, ...report.permissionRoleIds, ...report.adminRoleIds, ...allOrgRoleIds(report)]; return !ids.length || hasAnyRole(member, ids); }
function canManageCompetence(member: GuildMember, report: ReportSystemSettings, competence: Competence) { if (member.permissions.has(PermissionFlagsBits.Administrator)) return true; return hasAnyRole(member, orgRoleIds(report, competence)); }
function canManageCase(member: GuildMember, report: ReportSystemSettings, state: CaseState) { if (member.permissions.has(PermissionFlagsBits.Administrator)) return true; return canManageCompetence(member, report, state.finalCompetence); }
function subpoenaStaffDisplayName(report: ReportSystemSettings, state: CaseState) { return state.finalCompetence === "iab" ? report.anonymousInvestigatorName || "Equipe IAB" : `Equipe ${COMPETENCE_LABEL[state.finalCompetence]}`; }
function orgRoleIds(report: ReportSystemSettings, competence: Competence) { const fallback = competence === "iab" ? [...report.viewRoleIds, ...report.replyRoleIds, ...report.adminRoleIds] : []; return [...new Set((competence === "iab" ? report.iabRoleIds : competence === "conselho" ? report.conselhoRoleIds : competence === "hcmd" ? report.hcmdRoleIds : report.comissarioRoleIds).concat(fallback))]; }
function allOrgRoleIds(report: ReportSystemSettings) { return [...new Set([...orgRoleIds(report, "iab"), ...orgRoleIds(report, "conselho"), ...orgRoleIds(report, "hcmd"), ...orgRoleIds(report, "comissario")])]; }
function categoryFor(report: ReportSystemSettings, competence: Competence) { return competence === "iab" ? report.iabCategoryId ?? report.categoryId : competence === "conselho" ? report.conselhoCategoryId ?? report.categoryId : competence === "hcmd" ? report.hcmdCategoryId ?? report.categoryId : report.comissarioCategoryId ?? report.categoryId; }
async function resolveSubpoenaParent(guild: Guild, report: ReportSystemSettings, competence: Competence) {
  const destinationId = categoryFor(report, competence);
  const destination = destinationId ? await guild.channels.fetch(destinationId).catch(() => null) : null;
  if (destination?.type === ChannelType.GuildCategory) return destination.id;
  const fallback = report.categoryId && report.categoryId !== destinationId ? await guild.channels.fetch(report.categoryId).catch(() => null) : null;
  return fallback?.type === ChannelType.GuildCategory ? fallback.id : undefined;
}
function filterExistingRoles(guild: Guild, roleIds: string[]) { return [...new Set(roleIds)].filter((roleId) => guild.roles.cache.has(roleId)); }
function logFor(report: ReportSystemSettings, competence: Competence) { return competence === "iab" ? report.iabLogChannelId ?? report.logChannelId : competence === "conselho" ? report.conselhoLogChannelId ?? report.logChannelId : competence === "hcmd" ? report.hcmdLogChannelId ?? report.logChannelId : report.comissarioLogChannelId ?? report.logChannelId; }
function statusLabel(status: CaseState["status"]) { return status === "open" ? "Aberta" : status === "finished" ? "Finalizada" : "Cancelada"; }
function formatSubpoenaPanelDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    year: "numeric"
  }).format(date).replace(",", "");
}
function color(value?: string | null) { return Number.parseInt(value?.replace("#", "") ?? "", 16) || 0xdc2626; }
function slug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "usuario"; }
async function replyDenied(interaction: Interaction) { if (!interaction.isRepliable()) return; const payload = { content: "Você não possui permissão para atuar nesta intimação.", ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null); else await interaction.reply(payload).catch(() => null); }
async function recoverCaseFromChannel(interaction: Interaction, settings: GuildSettings): Promise<CaseState | null> { const channel = interaction.channel as TextChannel | null; const topic = channel?.topic ?? ""; const [, competence, targetId, responsibleId, createdById] = topic.split(":"); const parsed = parseCompetence(competence); if (!channel || !parsed || !targetId || !responsibleId || !createdById) return null; const target = await interaction.guild?.members.fetch(targetId).catch(() => null); return { autoRedirected: false, channelId: channel.id, createdAt: new Date().toISOString(), createdById, deadline: settings.reportSystem.defaultDeadline, description: "Dados recuperados após reinício. Consulte o histórico do canal.", finalCompetence: parsed, guildId: channel.guildId, reason: "Recuperado pelo canal", redirectReason: null, responsibleId, selectedCompetence: parsed, status: "open", targetDisplayName: target?.displayName ?? targetId, targetId, title: "Intimação" }; }
function recoverCaseFromTextChannel(channel: TextChannel): CaseState | null { const topic = channel.topic ?? ""; const [, competence, targetId, responsibleId, createdById] = topic.split(":"); const parsed = parseCompetence(competence); if (!parsed || !targetId || !responsibleId || !createdById) return null; return { autoRedirected: false, channelId: channel.id, createdAt: new Date().toISOString(), createdById, deadline: "Consulte o painel da intimação", description: "Dados recuperados pelo canal.", finalCompetence: parsed, guildId: channel.guildId, reason: "Recuperado pelo canal", redirectReason: null, responsibleId, selectedCompetence: parsed, status: "open", targetDisplayName: targetId, targetId, title: "Intimação" }; }
