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
import { isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext, GuildSettings, ReportSystemSettings } from "../types";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

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
const drafts = new Map<string, Draft>();
const cases = new Map<string, CaseState>();

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
    ]),
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
  if (interaction.isUserSelectMenu() && action === "target") return selectTarget(interaction, context, settings, parts[2] as Competence);
  if (interaction.isModalSubmit() && action === "modal") return submitSubpoena(interaction, context, settings, parts[2] ?? "");
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
  ]));
  return true;
}

async function selectTarget(interaction: UserSelectMenuInteraction, _context: BotContext, settings: GuildSettings, selectedCompetence: Competence) {
  const targetId = interaction.values[0]!;
  const targetMember = await interaction.guild!.members.fetch(targetId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: "Usuário não encontrado no servidor.", ephemeral: true });
    return true;
  }

  const resolution = resolveCompetence(targetMember, selectedCompetence, settings.reportSystem);
  const draftId = `${interaction.id}-${Date.now()}`;
  drafts.set(draftId, {
    autoRedirected: resolution.finalCompetence !== selectedCompetence,
    createdById: interaction.user.id,
    finalCompetence: resolution.finalCompetence,
    guildId: interaction.guildId!,
    redirectReason: resolution.reason,
    responsibleId: interaction.user.id,
    selectedCompetence,
    targetDisplayName: targetMember.displayName,
    targetId
  });

  await interaction.showModal(subpoenaModal(draftId));
  return true;
}

async function submitSubpoena(interaction: ModalSubmitInteraction, context: BotContext, settings: GuildSettings, draftId: string) {
  await interaction.deferReply({ ephemeral: true });
  const draft = drafts.get(draftId);
  if (!draft) {
    await interaction.editReply("Fluxo expirado. Use /intimacao novamente.");
    return true;
  }

  const target = await interaction.guild!.members.fetch(draft.targetId).catch(() => null);
  if (!target) {
    await interaction.editReply("Intimado não encontrado no servidor.");
    return true;
  }

  const title = field(interaction, "title") || "Intimação";
  const description = field(interaction, "description") || "Não informado";
  const channel = await createSubpoenaChannel(interaction.guild!, settings, draft, target, title);
  if (!channel) {
    await interaction.editReply("Não consegui criar o canal temporário. Verifique categoria e permissão de Gerenciar Canais.");
    return true;
  }

  const caseState: CaseState = { ...draft, channelId: channel.id, createdAt: new Date().toISOString(), deadline: settings.reportSystem.defaultDeadline, description, reason: title, status: "open", title };
  cases.set(channel.id, caseState);

  await channel.send(casePanel(settings, caseState));
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

  drafts.delete(draftId);
  await interaction.editReply(`Intimação criada em <#${channel.id}>.`);
  return true;
}

export async function handlePoliceSubpoenaMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) return false;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return false;

  const channel = message.channel as TextChannel;
  const state = cases.get(channel.id) ?? recoverCaseFromTextChannel(channel);
  if (!state || state.status !== "open") return false;

  const settings = await getFreshGuildSettings(context, message.guild.id, message.client.user?.id);
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (message.author.id === state.targetId || !member || !canManageCompetence(member, settings.reportSystem, state.finalCompetence)) return false;

  const me = message.guild.members.me ?? await message.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ManageMessages) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    return false;
  }

  const payload = anonymousIssuerPayload(message, staffDisplayName(settings.reportSystem, state.finalCompetence));
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

  return true;
}

async function handleCaseButton(interaction: ButtonInteraction, context: BotContext, settings: GuildSettings, action: string, channelId: string) {
  const state = cases.get(channelId) ?? await recoverCaseFromChannel(interaction, settings);
  if (!state) {
    await interaction.reply({ content: "Não encontrei os dados desta intimação após reinício. Gere uma nova intimação.", ephemeral: true });
    return true;
  }
  if (!interaction.member || !canManageCompetence(interaction.member as GuildMember, settings.reportSystem, state.finalCompetence)) {
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
  state.status = action === "finish" ? "finished" : "cancelled";
  cases.set(channelId, state);
  await interaction.update(casePanel(settings, state));
  await sendCompetenceLog(interaction.guild!, settings, state, interaction.user.id, `Ação: **${action === "finish" ? "Intimação finalizada" : "Intimação cancelada"}**\nCanal: <#${channelId}>`);
  return true;
}

async function submitNote(interaction: ModalSubmitInteraction, _context: BotContext, settings: GuildSettings, channelId: string) {
  const state = cases.get(channelId) ?? await recoverCaseFromChannel(interaction, settings);
  if (!state || !interaction.member || !canManageCompetence(interaction.member as GuildMember, settings.reportSystem, state.finalCompetence)) {
    await replyDenied(interaction);
    return true;
  }
  const note = field(interaction, "note");
  await interaction.reply(panel(settings, "Observação adicionada", note, []));
  await sendCompetenceLog(interaction.guild!, settings, state, interaction.user.id, `Ação: **Observação adicionada**\n${note}`);
  return true;
}

function resolveCompetence(member: GuildMember, selected: Competence, report: ReportSystemSettings) {
  if (hasAnyRole(member, orgRoleIds(report, "hcmd"))) return { finalCompetence: "comissario" as const, reason: "caso redirecionado por envolver membro do High Command" };
  if (hasAnyRole(member, orgRoleIds(report, "iab"))) return { finalCompetence: "conselho" as const, reason: "caso redirecionado por envolver membro da IAB" };
  return { finalCompetence: selected, reason: null };
}

async function createSubpoenaChannel(guild: Guild, settings: GuildSettings, state: Draft, target: GuildMember, title: string) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  const report = settings.reportSystem;
  const categoryId = categoryFor(report, state.finalCompetence);
  const roleIds = orgRoleIds(report, state.finalCompetence);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
    ...allOrgRoleIds(report).filter((roleId) => !roleIds.includes(roleId)).map((id) => ({ id, deny: [PermissionFlagsBits.ViewChannel] })),
    ...roleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }
  ];
  return guild.channels.create({
    name: `intimacao-${slug(target.displayName)}`.slice(0, 90),
    parent: categoryId ?? undefined,
    permissionOverwrites: overwrites,
    reason: `Intimação ${COMPETENCE_LABEL[state.finalCompetence]}: ${title}`,
    topic: `intimacao:${state.finalCompetence}:${state.targetId}:${state.responsibleId ?? "0"}:${state.createdById}`,
    type: ChannelType.GuildText
  });
}

function casePanel(settings: GuildSettings, state: CaseState) {
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:finish:${state.channelId}`).setLabel("Finalizar intimação").setStyle(ButtonStyle.Success).setDisabled(state.status !== "open"),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${state.channelId}`).setLabel("Cancelar intimação").setStyle(ButtonStyle.Danger).setDisabled(state.status !== "open"),
    new ButtonBuilder().setCustomId(`${PREFIX}:remind:${state.channelId}`).setLabel("Enviar lembrete DM").setStyle(ButtonStyle.Primary).setDisabled(state.status !== "open"),
    new ButtonBuilder().setCustomId(`${PREFIX}:note:${state.channelId}`).setLabel("Adicionar observação").setStyle(ButtonStyle.Secondary)
  );
  return renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    actions: [actions],
    description: "Painel interno sigiloso da intimação. Apenas o órgão competente pode atuar neste caso.",
    fields: [
      `**Usuário intimado:** <@${state.targetId}> (${state.targetDisplayName})\n**Órgão competente:** ${COMPETENCE_LABEL[state.finalCompetence]}`,
      `**Status:** ${statusLabel(state.status)}`,
      `**Descrição**\n${state.description}`.slice(0, 1000),
      `**Criado em:** <t:${Math.floor(new Date(state.createdAt).getTime() / 1000)}:F>`
    ],
    image: settings.reportSystem.subpoenaPanelBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.reportSystem.subpoenaPanelBannerUrl } : null,
    moduleId: "police-subpoena",
    title: `📨 ${state.title}`
  });
}

async function sendTargetDm(target: GuildMember, settings: GuildSettings, state: CaseState, channel: TextChannel) {
  const institutional = state.finalCompetence === "iab" ? "Equipe IAB" : COMPETENCE_LABEL[state.finalCompetence];
  return target.send(renderComponentsV2Panel({
    accentColor: color(settings.reportSystem.panelColor),
    actions: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("Acessar intimação").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${channel.guildId}/${channel.id}`))],
    description: settings.reportSystem.subpoenaDmText,
    fields: [
      `Olá, **${target.displayName}**.\nVocê recebeu uma intimação institucional.`,
      `**Órgão responsável:** ${institutional}\n**Canal:** <#${channel.id}>`
    ],
    image: settings.reportSystem.dmBannerUrl ? { imageEnabled: true, imagePosition: "banner", imageUrl: settings.reportSystem.dmBannerUrl } : null,
    moduleId: "police-subpoena-dm",
    title: "📨 Aviso de Intimação"
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
    image: null,
    moduleId: "police-subpoena-log",
    title: "Log de Intimação"
  })).catch(() => null);
}

function panel(settings: GuildSettings | null, title: string, description: string, actions: unknown[]) {
  return renderComponentsV2Panel({ accentColor: color(settings?.reportSystem.panelColor), actions, description, fields: [], image: null, moduleId: "police-subpoena-flow", title });
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

function subpoenaModal(draftId: string) {
  return new ModalBuilder().setCustomId(`${PREFIX}:modal:${draftId}`).setTitle("Criar intimação").addComponents(
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
function hasAnyRole(member: GuildMember, roleIds: string[]) { return roleIds.some((roleId) => member.roles.cache.has(roleId)); }
function canUseCommand(member: GuildMember, report: ReportSystemSettings) { if (member.permissions.has(PermissionFlagsBits.Administrator)) return true; const ids = [...report.competenceCommandRoleIds, ...report.permissionRoleIds, ...report.adminRoleIds, ...allOrgRoleIds(report)]; return !ids.length || hasAnyRole(member, ids); }
function canManageCompetence(member: GuildMember, report: ReportSystemSettings, competence: Competence) { if (member.permissions.has(PermissionFlagsBits.Administrator)) return true; return hasAnyRole(member, orgRoleIds(report, competence)); }
function staffDisplayName(report: ReportSystemSettings, competence: Competence) { return competence === "iab" ? report.anonymousInvestigatorName || "Equipe IAB" : COMPETENCE_LABEL[competence] || "Equipe Responsável"; }
function orgRoleIds(report: ReportSystemSettings, competence: Competence) { const fallback = competence === "iab" ? [...report.viewRoleIds, ...report.replyRoleIds, ...report.adminRoleIds] : []; return [...new Set((competence === "iab" ? report.iabRoleIds : competence === "conselho" ? report.conselhoRoleIds : competence === "hcmd" ? report.hcmdRoleIds : report.comissarioRoleIds).concat(fallback))]; }
function allOrgRoleIds(report: ReportSystemSettings) { return [...new Set([...orgRoleIds(report, "iab"), ...orgRoleIds(report, "conselho"), ...orgRoleIds(report, "hcmd"), ...orgRoleIds(report, "comissario")])]; }
function categoryFor(report: ReportSystemSettings, competence: Competence) { return competence === "iab" ? report.iabCategoryId ?? report.categoryId : competence === "conselho" ? report.conselhoCategoryId ?? report.categoryId : competence === "hcmd" ? report.hcmdCategoryId ?? report.categoryId : report.comissarioCategoryId ?? report.categoryId; }
function logFor(report: ReportSystemSettings, competence: Competence) { return competence === "iab" ? report.iabLogChannelId ?? report.logChannelId : competence === "conselho" ? report.conselhoLogChannelId ?? report.logChannelId : competence === "hcmd" ? report.hcmdLogChannelId ?? report.logChannelId : report.comissarioLogChannelId ?? report.logChannelId; }
function statusLabel(status: CaseState["status"]) { return status === "open" ? "Aberta" : status === "finished" ? "Finalizada" : "Cancelada"; }
function color(value?: string | null) { return Number.parseInt(value?.replace("#", "") ?? "", 16) || 0xdc2626; }
function slug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "usuario"; }
async function replyDenied(interaction: Interaction) { if (!interaction.isRepliable()) return; const payload = { content: "Você não possui permissão para atuar nesta intimação.", ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null); else await interaction.reply(payload).catch(() => null); }
async function recoverCaseFromChannel(interaction: Interaction, settings: GuildSettings): Promise<CaseState | null> { const channel = interaction.channel as TextChannel | null; const topic = channel?.topic ?? ""; const [, competence, targetId, responsibleId, createdById] = topic.split(":"); const parsed = parseCompetence(competence); if (!channel || !parsed || !targetId || !responsibleId || !createdById) return null; const target = await interaction.guild?.members.fetch(targetId).catch(() => null); return { autoRedirected: false, channelId: channel.id, createdAt: new Date().toISOString(), createdById, deadline: settings.reportSystem.defaultDeadline, description: "Dados recuperados após reinício. Consulte o histórico do canal.", finalCompetence: parsed, guildId: channel.guildId, reason: "Recuperado pelo canal", redirectReason: null, responsibleId, selectedCompetence: parsed, status: "open", targetDisplayName: target?.displayName ?? targetId, targetId, title: "Intimação" }; }
function recoverCaseFromTextChannel(channel: TextChannel): CaseState | null { const topic = channel.topic ?? ""; const [, competence, targetId, responsibleId, createdById] = topic.split(":"); const parsed = parseCompetence(competence); if (!parsed || !targetId || !responsibleId || !createdById) return null; return { autoRedirected: false, channelId: channel.id, createdAt: new Date().toISOString(), createdById, deadline: "Consulte o painel da intimação", description: "Dados recuperados pelo canal.", finalCompetence: parsed, guildId: channel.guildId, reason: "Recuperado pelo canal", redirectReason: null, responsibleId, selectedCompetence: parsed, status: "open", targetDisplayName: targetId, targetId, title: "Intimação" }; }
