import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChannelSelectMenuBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import type { BotContext } from "../types";
import { showModalAndResetSelect } from "../utils/selectMenuReset";
import type { ManualRegistrationSettings, ManualRegistrationSubmission } from "./apiClient";
import type { ManualRegistrationRemoveEvent } from "../websocket/socketClient";
import { ensureFivemGoalChannelForApprovedSet } from "./fivemGoalService";
import { buildV2Container, renderPanelBlocks, resolvePanelImageUrl } from "./panelVisualRenderer";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText, systemStatusEmoji } from "./systemEmojiService";

const PREFIX = "manual_registration";
const formSessions = new Map<string, { answers: Array<{ id: string; label: string; value: string }>; expiresAt: number; guildId: string; page: number; requestedRoleId: string | null; userId: string }>();
const configDrafts = new Map<string, { approvedRoleId?: string | null; approverRoleIds?: string[]; manualRegistrationRoleIds?: string[]; panelChannelId?: string | null; requestCategoryId?: string | null; logChannelId?: string | null; logMentionRoleId?: string | null }>();
const registrationProcesses = new Set<string>();
type SetApprovalResult = { farmChannelId: string | null; metaChannelId: string; roleIds: string[]; submission: ManualRegistrationSubmission };

export function startManualRegistrationService(client: Client<true>, context: BotContext) {
  context.socket.onManualRegistrationPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredPanel(guild, context);
  });
  context.socket.onManualRegistrationExecute((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void executeDashboardRegistration(guild, context, payload);
  });
  context.socket.onManualRegistrationRemove((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void removeManualRegistrationFromDiscord(guild, context, payload);
  });
}

async function removeManualRegistrationFromDiscord(guild: Guild, context: BotContext, payload: ManualRegistrationRemoveEvent) {
  if (payload.roleId) {
    await guild.members.fetch(payload.userId)
      .then((member) => member.roles.remove(payload.roleId!, "Cadastro de Set removido pela dashboard"))
      .catch((error) => context.api.postLog({
        guildId: payload.guildId,
        message: error instanceof Error ? error.message : "Usuário não encontrado ou cargo não removido",
        metadata: { roleId: payload.roleId, submissionId: payload.submissionId },
        type: "manual-registration.role_removal_failed",
        userId: payload.userId
      }).catch(() => null));
  }

  if (!payload.channelId) return;
  const channel = await guild.channels.fetch(payload.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  if (payload.previousStatus === "pending" && channel.deletable) {
    await channel.delete("Pedido de Set pendente removido pela dashboard").catch((error) => context.api.postLog({
      guildId: payload.guildId,
      message: error instanceof Error ? error.message : "Canal pendente não removido",
      metadata: { channelId: payload.channelId, submissionId: payload.submissionId },
      type: "manual-registration.channel_removal_failed",
      userId: payload.userId
    }).catch(() => null));
    return;
  }

  if (!payload.messageId || !("messages" in channel)) return;
  const message = await channel.messages.fetch(payload.messageId).catch(() => null);
  await message?.delete().catch(() => null);
}

async function executeDashboardRegistration(guild: Guild, context: BotContext, payload: { goalCategoryId: string; requestedRoleId: string; submissionId: string; userId: string; username: string }) {
  try {
    const settings = await context.api.getManualRegistrationSettings(guild.id);
    const actorId = guild.members.me?.id ?? guild.client.user.id;
    const result = await processSetApproval({
      actorId,
      actorIsAdministrator: true,
      actorLabel: guild.client.user.username,
      actorRoleIds: settings.manualRegistrationRoleIds,
      context,
      goalCategoryId: payload.goalCategoryId,
      guild,
      settings,
      submissionId: payload.submissionId,
      targetUserId: payload.userId
    });
    await context.api.postLog({ guildId: guild.id, message: "Cadastro manual concluído e canal de meta criado.", metadata: { channelId: result.metaChannelId, farmChannelId: result.farmChannelId, roleId: payload.requestedRoleId, submissionId: result.submission.id }, type: "manual-registration.dashboard_completed", userId: payload.userId }).catch(() => null);
  } catch (error) {
    await context.api.postLog({ guildId: guild.id, message: error instanceof Error ? error.message : "Falha no cadastro manual.", metadata: { submissionId: payload.submissionId }, type: "manual-registration.dashboard_failed", userId: payload.userId }).catch(() => null);
  }
}

export async function publishManualRegistrationPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use este comando em um servidor.", ephemeral: true });
    return;
  }
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!settings.enabled) {
    await interaction.reply({ content: "O Pedido de Set está desativado na dashboard.", ephemeral: true });
    return;
  }
  const configured = await resolveOrCreatePanelChannel(interaction.guild, settings);
  const channel = configured?.isSendable() ? configured : interaction.channel?.isSendable() ? interaction.channel : null;
  if (!channel) {
    await interaction.reply({ content: "Configure um canal válido para o painel.", ephemeral: true });
    return;
  }
  if (settings.panelMessageId && "messages" in channel) {
    const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (!message) {
      await interaction.reply({ content: "A mensagem salva do painel não foi encontrada. Limpe o ID salvo ou remova o painel antigo antes de publicar outro.", ephemeral: true });
      return;
    }
    await message.edit(createPanelPayload(settings, interaction.guild));
    await context.api.saveManualRegistrationSettings(interaction.guild.id, { panelChannelId: channel.id, panelMessageId: message.id });
    await interaction.reply({ content: `Painel de Pedido de Set atualizado em <#${channel.id}>.`, ephemeral: true });
    return;
  }
  const message = await channel.send(createPanelPayload(settings, interaction.guild));
  await context.api.saveManualRegistrationSettings(interaction.guild.id, { panelChannelId: channel.id, panelMessageId: message.id });
  await interaction.reply({ content: `Painel de Pedido de Set publicado em <#${channel.id}>.`, ephemeral: true });
}

export async function showSetConfigPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !(await isSetAdministrator(interaction.guild, interaction.user.id))) return void await interaction.reply({ content: "Você não possui permissão para configurar o Set.", ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  await interaction.reply({ ...configMainPayload(settings), ephemeral: true });
}

export async function executeManualSetRegistration(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  const actor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!actor || (!actor.permissions.has(PermissionFlagsBits.Administrator) && !actor.roles.cache.some((role) => settings.manualRegistrationRoleIds.includes(role.id)))) return void await interaction.reply({ content: "Seu cargo não permite cadastro manual.", ephemeral: true });
  const user = interaction.options.getUser("usuario", true), requestedName = interaction.options.getString("nome", true), note = interaction.options.getString("observacao") ?? "-";
  const roleId = settings.approvedRoleId;
  if (!roleId) return void await interaction.reply({ content: "O cargo de aprovado ainda não foi configurado.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(user.id).catch(() => null), role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!member) return void await interaction.editReply("O usuário não está mais no servidor.");
  if (!role?.editable) return void await interaction.editReply("O cargo configurado não existe ou está acima do cargo do bot.");
  try {
    const submission = await context.api.createManualRegistrationSubmission({ guildId: interaction.guild.id, userId: user.id, username: user.username, userAvatar: user.displayAvatarURL(), requestedRoleId: roleId, registrationType: "manual", fields: [{ id: "nome_personagem", label: "Nome solicitado", value: requestedName }, { id: "observacoes", label: "Observação", value: note }] });
    const result = await processSetApproval({
      actorId: interaction.user.id,
      actorIsAdministrator: actor.permissions.has(PermissionFlagsBits.Administrator) || actor.permissions.has(PermissionFlagsBits.ManageGuild) || interaction.guild.ownerId === interaction.user.id,
      actorLabel: actor.displayName || interaction.user.username,
      actorRoleIds: [...actor.roles.cache.keys()],
      context,
      guild: interaction.guild,
      settings,
      submissionId: submission.id,
      targetUserId: user.id
    });
    await sendActionLog(interaction.guild, settings, `Cadastro manual\nUsuário: <@${user.id}>\nNome: ${requestedName}\nResponsável: <@${interaction.user.id}>\nObservação: ${note}`);
    await interaction.editReply(`Cadastro manual concluído para <@${user.id}> como **${requestedName}**. Canal de meta: <#${result.metaChannelId}>`);
  } catch (error) { await interaction.editReply(manualRegistrationErrorMessage(error)); }
}

async function publishConfiguredPanel(guild: Guild, context: BotContext) {
  const settings = await context.api.getManualRegistrationSettings(guild.id);
  if (!settings.enabled || (!settings.panelChannelId && !settings.panelCategoryId)) return;
  const channel = await resolveOrCreatePanelChannel(guild, settings);
  if (!channel?.isSendable()) return;
  if (settings.panelMessageId && "messages" in channel) {
    const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (message) {
      await message.edit(createPanelPayload(settings, guild));
      return;
    }
  }
  const message = await channel.send(createPanelPayload(settings, guild));
  await context.api.saveManualRegistrationSettings(guild.id, { panelChannelId: channel.id, panelMessageId: message.id });
}

async function resolveOrCreatePanelChannel(guild: Guild, settings: ManualRegistrationSettings) {
  const configured = settings.panelChannelId ? await guild.channels.fetch(settings.panelChannelId).catch(() => null) : null;
  if (configured?.isSendable()) return configured;
  if (!settings.panelCategoryId) return null;
  const category = await guild.channels.fetch(settings.panelCategoryId).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) return null;
  return guild.channels.create({
    name: "pedido-set",
    parent: category.id,
    reason: "Canal automático do sistema de Pedido de Set",
    type: ChannelType.GuildText
  }).catch(() => null);
}

function configKey(guildId: string, userId: string) { return `${guildId}:${userId}`; }
function configMainPayload(settings: ManualRegistrationSettings) {
  return { components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# ${systemEmojiText("engrenagem")} Configuração do Set\n**Cargo aprovado:** ${settings.approvedRoleId ? `<@&${settings.approvedRoleId}>` : "Não configurado"}\n**Cargos revisores:** ${settings.approverRoleIds.length ? settings.approverRoleIds.map((id) => `<@&${id}>`).join(", ") : "Nenhum"}\n**Cadastro manual:** ${settings.manualRegistrationRoleIds.length ? settings.manualRegistrationRoleIds.map((id) => `<@&${id}>`).join(", ") : "Nenhum"}\n**Canal do painel:** ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "Não configurado"}\n**Categoria dos pedidos:** ${settings.requestCategoryId ? `<#${settings.requestCategoryId}>` : "Não configurada"}` }, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:config:approved`).setEmoji(systemComponentEmoji("visto")).setLabel("Configurar cargo de aprovado").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`${PREFIX}:config:reviewers`).setEmoji(systemComponentEmoji("homem")).setLabel("Cargos de aprovação/recusa").setStyle(ButtonStyle.Secondary)), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:config:channels`).setEmoji(systemComponentEmoji("discord")).setLabel("Configurações de canais").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`${PREFIX}:config:manual`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Permissão cadastro manual").setStyle(ButtonStyle.Secondary))] }], flags: MessageFlags.IsComponentsV2 as const };
}
async function handleSetConfigInteraction(interaction: ButtonInteraction | any, context: BotContext) {
  if (!interaction.guild || !(await isSetAdministrator(interaction.guild, interaction.user.id))) return void await interaction.reply({ content: "Você não possui permissão administrativa.", ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id), key = configKey(interaction.guild.id, interaction.user.id), draft = configDrafts.get(key) ?? {};
  const action = interaction.customId.split(":")[2] ?? "main";
  if (interaction.isRoleSelectMenu()) { const field = action === "approved_select" ? "approvedRoleId" : action === "reviewers_select" ? "approverRoleIds" : action === "log_mention_select" ? "logMentionRoleId" : "manualRegistrationRoleIds"; configDrafts.set(key, { ...draft, [field]: field === "approvedRoleId" || field === "logMentionRoleId" ? interaction.values[0] ?? null : interaction.values }); return void await interaction.deferUpdate(); }
  if (interaction.isChannelSelectMenu()) { const field = action === "panel_select" ? "panelChannelId" : action === "category_select" ? "requestCategoryId" : "logChannelId"; configDrafts.set(key, { ...draft, [field]: interaction.values[0] ?? null }); return void await interaction.deferUpdate(); }
  if (action === "back") { configDrafts.delete(key); return void await interaction.update(configMainPayload(settings)); }
  if (action.startsWith("save_")) { const module = action.slice(5); const patch = module === "approved" ? { approvedRoleId: draft.approvedRoleId } : module === "reviewers" ? { approverRoleIds: draft.approverRoleIds } : module === "manual" ? { manualRegistrationRoleIds: draft.manualRegistrationRoleIds } : { panelChannelId: draft.panelChannelId, requestCategoryId: draft.requestCategoryId, logChannelId: draft.logChannelId, logMentionRoleId: draft.logMentionRoleId }; if (!Object.values(patch).some((value) => value !== undefined)) return void await interaction.reply({ content: "Nenhuma alteração pendente neste módulo.", ephemeral: true }); const saved = await context.api.saveManualRegistrationSettings(interaction.guild.id, patch); configDrafts.delete(key); return void await interaction.update(configMainPayload(saved)); }
  const backSave = (module: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:config:save_${module}`).setEmoji(systemComponentEmoji("salvar")).setLabel("Salvar").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`${PREFIX}:config:back`).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary));
  if (action === "approved") return void await interaction.update({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: `# ${systemEmojiText("visto")} Cargo atribuído ao aprovar\nSelecione um cargo e clique em **Salvar**.` }, new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:config:approved_select`).setPlaceholder("Selecione o cargo aprovado").setMinValues(1).setMaxValues(1)), backSave("approved")] }] });
  if (action === "reviewers" || action === "manual") { const module = action; return void await interaction.update({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: module === "reviewers" ? `# ${systemEmojiText("homem")} Cargos que aprovam ou recusam` : `# ${systemEmojiText("prancheta_caneta")} Cargos para cadastro manual` }, new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:config:${module}_select`).setPlaceholder("Selecione um ou vários cargos").setMinValues(1).setMaxValues(20)), backSave(module)] }] }); }
  if (action === "channels") return void await interaction.update({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: `# ${systemEmojiText("discord")} Canais do sistema de Set\nSelecione o painel, a categoria privada, o canal de logs e o cargo mencionado nos logs.` }, new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:config:panel_select`).setPlaceholder("Canal do painel").setChannelTypes(ChannelType.GuildText)), new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:config:category_select`).setPlaceholder("Categoria dos pedidos").setChannelTypes(ChannelType.GuildCategory)), new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:config:log_select`).setPlaceholder("Canal de logs").setChannelTypes(ChannelType.GuildText)), new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:config:log_mention_select`).setPlaceholder("Cargo mencionado nos logs").setMinValues(0).setMaxValues(1)), backSave("channels")] }] });
}
async function isSetAdministrator(guild: Guild, userId: string) { const member = await guild.members.fetch(userId).catch(() => null); return Boolean(member && (guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild))); }

export async function showManualRegistrationQuickConfig(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:quick_config`).setTitle("Configurar Pedido de Set");
  const fields = [
    ["panelChannelId", "ID do canal do painel", false],
    ["approvalChannelId", "ID do canal de analise", true],
    ["logChannelId", "ID do canal de logs", false],
    ["staffRoleId", "ID do cargo da staff", false],
    ["defaultRoleId", "ID do cargo/set padrão", false]
  ] as const;
  for (const [id, label, required] of fields) {
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setMinLength(required ? 5 : 0).setMaxLength(32).setRequired(required).setStyle(TextInputStyle.Short)));
  }
  if (interaction.isStringSelectMenu()) await showModalAndResetSelect(interaction, modal);
  else await interaction.showModal(modal);
}

export async function handleManualRegistrationInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

  if ((interaction.isButton() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) && interaction.customId.startsWith(`${PREFIX}:config`)) {
    await handleSetConfigInteraction(interaction, context); return true;
  }

  if (interaction.isButton() && interaction.customId === `${PREFIX}:start`) {
    await startSetRequest(interaction, context);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId === `${PREFIX}:quick_config`) {
    await saveQuickConfig(interaction, context);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}:select_set`) {
    await showRegistrationModal(interaction, context, interaction.values[0] ?? null);
    return true;
  }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:status`) {
    await showRequestStatus(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId === `${PREFIX}:help`) {
    await interaction.reply({
      content: [
        "## Como solicitar seu set",
        "1. Clique em **Solicitar Set**.",
        "2. Escolha o set desejado, quando houver mais de uma opção.",
        "3. Preencha todos os dados solicitados e envie o formulario.",
        "4. Use **Meu Status** para acompanhar a analise.",
        "",
        "Se precisar corrigir alguma informacao, procure a equipe responsável."
      ].join("\n"),
      ephemeral: true
    });
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
    await handleRegistrationSubmit(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:form_next:`)) {
    await continueRegistrationForm(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:approve:`)) {
    await approveSubmission(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:reject:`)) {
    await showRejectionModal(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:edit_set:`)) {
    await showEditSetMenu(interaction, context);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${PREFIX}:edit_set_select:`)) {
    await updateRequestedSet(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:cancel:`)) {
    await cancelSubmission(interaction, context);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:reject_modal:`)) {
    await rejectSubmission(interaction, context);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:view:`)) {
    await showSubmissionDetails(interaction);
    return true;
  }
  return false;
}

async function showEditSetMenu(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.reply({ content: "Você não possui permissão para editar pedidos.", ephemeral: true });
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const userId = interaction.customId.split(":")[3] ?? "";
  const roles = settings.setRoles.filter((item) => item.enabled);
  if (!roles.length) {
    await interaction.reply({ content: "Nenhum set ativo foi configurado.", ephemeral: true });
    return;
  }
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:edit_set_select:${id}:${userId}`).setPlaceholder("Selecione o novo set").addOptions(roles.slice(0, 25).map((item) => ({ label: item.name, value: item.roleId, description: item.description?.slice(0, 100) || undefined, emoji: normalizeComponentEmoji(item.emoji) })));
  await interaction.reply({ components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], ephemeral: true });
}

async function updateRequestedSet(interaction: StringSelectMenuInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.reply({ content: "Você não possui permissão para editar pedidos.", ephemeral: true });
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const saved = await context.api.updateManualRegistrationSubmissionRole({ actorId: interaction.user.id, guildId: interaction.guild.id, id, requestedRoleId: interaction.values[0] ?? "" });
  const channel = settings.approvalChannelId ? await interaction.guild.channels.fetch(settings.approvalChannelId).catch(() => null) : null;
  if (saved.messageId && channel && "messages" in channel) {
    const message = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (message) await message.edit(createReviewPayload(settings, saved, interaction.guild)).catch(() => null);
  }
  await interaction.update({ components: [], content: "Set solicitado atualizado." });
}

async function cancelSubmission(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.editReply("Você não possui permissão para cancelar pedidos.");
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const actor = await interaction.guild.members.fetch(interaction.user.id); const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, actorRoleIds: [...actor.roles.cache.keys()], guildId: interaction.guild.id, id, rejectionReason: "Cancelado pela equipe responsável.", status: "rejected" });
  await interaction.message.edit(createReviewPayload(settings, saved, interaction.guild)).catch(() => null);
  await sendActionLog(interaction.guild, settings, `Pedido cancelado\nUsuario: <@${saved.userId}>\nStaff: <@${interaction.user.id}>`);
  await interaction.editReply("Pedido cancelado.");
}

async function saveQuickConfig(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const readId = (id: string) => interaction.fields.getTextInputValue(id).trim() || null;
  const values = {
    approvalChannelId: readId("approvalChannelId"),
    defaultRoleId: readId("defaultRoleId"),
    logChannelId: readId("logChannelId"),
    panelChannelId: readId("panelChannelId"),
    staffRoleId: readId("staffRoleId")
  };
  if (Object.values(values).some((value) => value && !/^\d{5,32}$/.test(value))) {
    await interaction.editReply("Use apenas IDs validos do Discord nos campos de configuração.");
    return;
  }
  await context.api.saveManualRegistrationSettings(interaction.guild.id, {
    approvalChannelId: values.approvalChannelId,
    approverRoleIds: values.staffRoleId ? [values.staffRoleId] : [],
    autoRoleIds: values.defaultRoleId ? [values.defaultRoleId] : [],
    enabled: true,
    logChannelId: values.logChannelId,
    panelChannelId: values.panelChannelId,
    staffRoleIds: values.staffRoleId ? [values.staffRoleId] : []
  });
  await interaction.editReply("Pedido de Set configurado e ativado. Use `/pedido-set painel` para publicar.");
}

async function startSetRequest(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guildId) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guildId);
  if (!settings.enabled) {
    await interaction.reply({ content: "O Pedido de Set está desativado.", ephemeral: true });
    return;
  }
  const roles = settings.setRoles.filter((item) => item.enabled && item.requestable);
  if (roles.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:select_set`)
      .setPlaceholder("Selecione o set desejado")
      .addOptions(roles.slice(0, 25).map((item) => ({ description: item.description?.slice(0, 100) || undefined, emoji: normalizeComponentEmoji(item.emoji), label: item.name.slice(0, 100), value: item.roleId })));
    await interaction.reply({ components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], ephemeral: true });
    return;
  }
  await showRegistrationModal(interaction, context, roles[0]?.roleId ?? settings.autoRoleIds[0] ?? null);
}

async function showRegistrationModal(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext, requestedRoleId: string | null) {
  if (!interaction.guildId) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guildId);
  const activeSubmission = await context.api.getLatestManualRegistrationSubmission(interaction.guildId, interaction.user.id).catch(() => null);
  if (activeSubmission?.status === "pending" || activeSubmission?.status === "approved") {
    await interaction.reply({
      content: activeSubmission.status === "pending" ? "Você já possui um pedido de set pendente." : "Você já possui um cadastro de set ativo.",
      ephemeral: true
    });
    return;
  }
  const fields = settings.fields.filter((field) => field.enabled !== false);
  if (!fields.length) {
    await interaction.reply({ content: "Nenhum campo foi configurado para o pedido.", ephemeral: true });
    return;
  }
  const token = randomUUID().replaceAll("-", "").slice(0, 20);
  formSessions.set(token, { answers: [], expiresAt: Date.now() + 15 * 60_000, guildId: interaction.guildId, page: 0, requestedRoleId, userId: interaction.user.id });
  await showRegistrationModalPage(interaction, settings, token, 0);
}

async function showRegistrationModalPage(interaction: ButtonInteraction | StringSelectMenuInteraction, settings: ManualRegistrationSettings, token: string, page: number) {
  const fields = settings.fields.filter((field) => field.enabled !== false).slice(page * 5, page * 5 + 5);
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${token}:${page}`)
    .setTitle(`${settings.name || "Pedido de Set"} ${page + 1}/${Math.ceil(settings.fields.filter((field) => field.enabled !== false).length / 5)}`.slice(0, 45));
  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label.slice(0, 45))
      .setPlaceholder(field.placeholder?.slice(0, 100) || "Digite aqui")
      .setRequired(field.required)
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (field.minLength !== null) input.setMinLength(field.minLength);
    if (field.maxLength !== null) input.setMaxLength(field.maxLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  await interaction.showModal(modal);
}

async function continueRegistrationForm(interaction: ButtonInteraction, context: BotContext) {
  const token = interaction.customId.split(":")[2] ?? "";
  const session = formSessions.get(token);
  if (!session || session.expiresAt < Date.now() || session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    formSessions.delete(token);
    await interaction.reply({ content: "Este formulario expirou. Inicie um novo pedido.", ephemeral: true });
    return;
  }
  const settings = await context.api.getManualRegistrationSettings(session.guildId);
  await showRegistrationModalPage(interaction, settings, token, session.page);
}

async function handleRegistrationSubmit(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  const token = interaction.customId.split(":")[2] ?? "";
  const page = Number(interaction.customId.split(":")[3] ?? 0);
  const session = formSessions.get(token);
  if (!session || session.expiresAt < Date.now() || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id || session.page !== page) {
    formSessions.delete(token);
    await interaction.editReply("Este formulario expirou. Inicie um novo pedido.");
    return;
  }
  const activeFields = settings.fields.filter((field) => field.enabled !== false);
  const pageFields = activeFields.slice(page * 5, page * 5 + 5);
  session.answers.push(...pageFields.map((field) => ({ id: field.id, label: field.label, value: interaction.fields.getTextInputValue(field.id) || "-" })));
  session.page += 1;
  if (session.page * 5 < activeFields.length) {
    formSessions.set(token, session);
    await interaction.editReply({
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:form_next:${token}`).setEmoji(systemComponentEmoji("acessar", interaction.guild, interaction.client)).setLabel(`Continuar para etapa ${session.page + 1}`).setStyle(ButtonStyle.Primary))],
      content: `Etapa ${page + 1} salva. Continue para preencher as proximas perguntas.`
    });
    return;
  }
  formSessions.delete(token);
  const requestedRoleId = session.requestedRoleId;
  const fields = session.answers;
  const processingKey = `${interaction.guild.id}:${interaction.user.id}`;
  if (registrationProcesses.has(processingKey)) {
    await interaction.editReply("Seu pedido já está sendo processado. Aguarde a conclusão antes de tentar novamente.");
    return;
  }
  registrationProcesses.add(processingKey);
  let submission: ManualRegistrationSubmission;
  try {
    console.log("[REGISTRO] Iniciando registro", { guildId: interaction.guild.id, userId: interaction.user.id });
    if (!settings.automaticApproval) {
      const validation = await validateManualRegistrationRequestConfig(interaction.guild, settings);
      if (!validation.ok) {
        await interaction.editReply(validation.message);
        registrationProcesses.delete(processingKey);
        return;
      }
    }
    submission = await context.api.createManualRegistrationSubmission({ fields, guildId: interaction.guild.id, requestedRoleId, userAvatar: interaction.user.displayAvatarURL(), userId: interaction.user.id, username: interaction.user.tag });
  } catch (error) {
    console.error("[REGISTRO] Falha no fluxo", { error, guildId: interaction.guild.id, stage: "create_submission", userId: interaction.user.id });
    await interaction.editReply(manualRegistrationErrorMessage(error));
    registrationProcesses.delete(processingKey);
    return;
  }
  let automaticError: string | null = null;
  if (settings.automaticApproval) {
    try {
      const result = await processSetApproval({
        actorId: interaction.client.user.id,
        actorLabel: interaction.client.user.username,
        actorRoleIds: settings.approverRoleIds,
        context,
        guild: interaction.guild,
        settings,
        submissionId: submission.id,
        targetUserId: submission.userId
      });
      submission = result.submission;
      const member = await interaction.guild.members.fetch(submission.userId).catch(() => null);
      const goalChannelId = result.metaChannelId;
      if (member && settings.dmNotifications) await member.send(createDecisionDmPayload(settings, submission, { goalChannelId, guild: interaction.guild, status: "approved" })).catch(() => null);
      await sendRegistrationDecisionLog(interaction.guild, settings, submission, { actorId: interaction.client.user.id, actorLabel: interaction.client.user.username, decidedAt: new Date(), farmChannelId: result.farmChannelId, metaChannelId: result.metaChannelId, roleIds: result.roleIds, status: "approved" });
    } catch (error) {
      automaticError = error instanceof Error ? error.message : "Não foi possível aplicar o cargo automaticamente.";
      await context.api.postLog({ guildId: interaction.guild.id, message: automaticError, metadata: { submissionId: submission.id }, type: "manual-registration.auto_approval_failed", userId: interaction.user.id }).catch(() => null);
    }
  }
  if (settings.automaticApproval && !automaticError && submission.status === "approved") {
    await interaction.editReply(settings.approvalMessage);
    registrationProcesses.delete(processingKey);
    return;
  }
  try {
    const category = settings.requestCategoryId ? await interaction.guild.channels.fetch(settings.requestCategoryId).catch(() => null) : null;
    if (category?.type !== ChannelType.GuildCategory) throw new Error("Categoria privada não encontrada.");
    const requestedName = submission.requestedName || interaction.user.username;
    const teamRoleIds = manualRegistrationTeamRoleIds(settings);
    const channel = await interaction.guild.channels.create({
      name: registrationRequestChannelName(requestedName, submission.id),
      parent: category.id,
      reason: `Pedido de Set ${submission.id}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
        ...teamRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }))
      ]
    });
    console.log("[REGISTRO] Canal criado", { channelId: channel.id, guildId: interaction.guild.id, userId: interaction.user.id });
    const message = await channel.send(createReviewPayload(settings, submission, interaction.guild));
    submission = await context.api.updateManualRegistrationSubmissionChannel(submission.id, channel.id, message.id);
    try {
      const logMessage = await sendRegistrationCreatedLog(interaction.guild, settings, submission);
      await context.api.updateManualRegistrationSubmissionLogState(submission.id, { logError: null, logMessageId: logMessage?.id ?? null, logStatus: "sent" });
      console.log("[REGISTRO] Log enviada", { guildId: interaction.guild.id, logChannelId: settings.logChannelId, messageId: logMessage?.id ?? null, userId: interaction.user.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enviar log do registro.";
      console.error("[REGISTRO] Falha no fluxo", { error, guildId: interaction.guild.id, stage: "send_log", userId: interaction.user.id });
      await context.api.updateManualRegistrationSubmissionLogState(submission.id, { logError: message, logMessageId: null, logStatus: "failed" }).catch((apiError) => console.error("[REGISTRO] Falha ao marcar log como failed", apiError));
      await context.api.postLog({ guildId: interaction.guild.id, message, metadata: { channelId: channel.id, submissionId: submission.id }, type: "manual-registration.log_failed", userId: interaction.user.id }).catch(() => null);
    }
    await interaction.editReply(automaticError ? `${settings.successMessage}\n\nA aprovacao automática ficou pendente: ${automaticError}` : settings.successMessage);
  } catch (error) {
    console.error("[REGISTRO] Falha no fluxo", { error, guildId: interaction.guild.id, stage: "create_channel", submissionId: submission.id, userId: interaction.user.id });
    await context.api.postLog({ guildId: interaction.guild.id, message: error instanceof Error ? error.message : "Falha ao criar canal do Pedido de Set.", metadata: { submissionId: submission.id }, type: "manual-registration.channel_create_failed", userId: interaction.user.id }).catch(() => null);
    await interaction.editReply("Não foi possível criar o canal da solicitação. Verifique a categoria configurada e as permissões do bot.");
  } finally {
    registrationProcesses.delete(processingKey);
  }
}

async function processSetApproval(input: {
  actorId: string;
  actorIsAdministrator?: boolean;
  actorLabel: string;
  actorRoleIds: string[];
  context: BotContext;
  goalCategoryId?: string | null;
  guild: Guild;
  settings: ManualRegistrationSettings;
  submissionId: string;
  targetUserId: string;
}) {
  const { actorId, actorRoleIds, context, guild, settings, submissionId, targetUserId } = input;
  const traceBase = { actorId, guildId: guild.id, requestId: submissionId, userId: targetUserId };
  await traceSetApproval(context, "[SET_APPROVAL_START]", traceBase);

  const processing = await context.api.beginManualRegistrationApproval({ actorId, actorIsAdministrator: input.actorIsAdministrator, actorRoleIds, guildId: guild.id, id: submissionId });
  await traceSetApproval(context, "[SET_CONFIG_LOADED]", { ...traceBase, botId: processing.botId, logChannelId: settings.logChannelId });

  let member: GuildMember | null = null;
  let roleIds: string[] = [];
  const appliedRoleIds: string[] = [];

  try {
    if (!settings.enabled) throw new ApprovalFlowError("O sistema de Pedido de Set está desativado.");
    if (!settings.logChannelId) throw new ApprovalFlowError("Configure o canal de logs do Pedido de Set antes de aprovar.");

    member = await guild.members.fetch(targetUserId).catch(() => null);
    if (!member) throw new ApprovalFlowError("O usuário não está mais no servidor.");

    roleIds = [...new Set([processing.requestedRoleId, settings.approvedRoleId, ...(settings.autoRoleIds ?? [])].filter((value): value is string => Boolean(value)))];
    if (!roleIds.length) throw new ApprovalFlowError("Nenhum cargo de aprovado está configurado.");

    for (const roleId of roleIds) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role || !role.editable) throw new ApprovalFlowError(`O bot não pode entregar o cargo ${roleId}; verifique hierarquia e permissão Gerenciar Cargos.`);
    }
    const goalCategoryId = input.goalCategoryId ?? selectedGoalCategoryId(settings, processing);
    await traceSetApproval(context, "[META_CHANNEL_CREATING]", { ...traceBase, categoryId: goalCategoryId });
    const goal = await ensureFivemGoalChannelForApprovedSet(context, guild, processing.userId, processing.requestedName || member.displayName || member.user.username, goalCategoryId, true, submissionGameId(processing));
    if (!goal.channelId || goal.error) throw new ApprovalFlowError(goal.error || "Canal de meta não foi criado.");
    await traceSetApproval(context, "[META_CHANNEL_CREATED]", { ...traceBase, channelId: goal.channelId, moved: goal.moved, targetCategoryId: goal.targetCategoryId });
    await traceSetApproval(context, "[META_PANEL_SENT]", { ...traceBase, channelId: goal.channelId });
    await traceSetApproval(context, "[FARM_CHANNEL_CREATED]", { ...traceBase, channelId: goal.channelId, mode: "same_as_meta" });
    await traceSetApproval(context, "[FARM_PANEL_SENT]", { ...traceBase, channelId: goal.channelId, mode: "same_as_meta" });

    for (const roleId of settings.removeRoleIds) await member.roles.remove(roleId).catch(() => null);
    for (const roleId of roleIds) {
      await member.roles.add(roleId);
      appliedRoleIds.push(roleId);
    }
    await traceSetApproval(context, "[SET_ROLE_APPLIED]", { ...traceBase, roleIds });

    await member.setNickname(processing.requestedName, "Pedido de Set aprovado").catch((error) => context.api.postLog({ guildId: guild.id, message: error instanceof Error ? error.message : "Falha ao alterar apelido", metadata: { submissionId }, type: "manual-registration.nickname_failed", userId: processing.userId, executorId: actorId }).catch(() => null));

    const saved = await context.api.completeManualRegistrationApproval({ actorId, farmChannelId: goal.channelId, guildId: guild.id, id: processing.id, metaChannelId: goal.channelId, roleIds });
    await traceSetApproval(context, "[SET_APPROVAL_COMPLETED]", { ...traceBase, farmChannelId: goal.channelId, metaChannelId: goal.channelId, status: saved.status });
    return { farmChannelId: goal.channelId, metaChannelId: goal.channelId, roleIds, submission: saved } satisfies SetApprovalResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao aprovar Pedido de Set.";
    if (member) for (const roleId of appliedRoleIds) await member.roles.remove(roleId, "Rollback da aprovação do Pedido de Set").catch(() => null);
    const failed = await context.api.failManualRegistrationApproval({ actorId, guildId: guild.id, id: processing.id, reason: message }).catch(() => null);
    await traceSetApproval(context, "[SET_APPROVAL_ERROR]", { ...traceBase, appliedRoleIds, error: message, rolledBack: appliedRoleIds.length > 0, stack: error instanceof Error ? error.stack : null });
    if (failed) await sendRegistrationDecisionLog(guild, settings, failed, { actorId, actorLabel: input.actorLabel, decidedAt: new Date(), failureReason: message, roleIds, status: "failed" });
    throw error;
  }
}

class ApprovalFlowError extends Error {}

async function traceSetApproval(context: BotContext, step: string, metadata: Record<string, unknown>) {
  await context.api.postLog({
    executorId: typeof metadata.actorId === "string" ? metadata.actorId : undefined,
    guildId: String(metadata.guildId ?? ""),
    message: step,
    metadata: { ...metadata, step },
    type: step === "[SET_APPROVAL_ERROR]" ? "manual-registration.approval_error" : "manual-registration.approval_trace",
    userId: typeof metadata.userId === "string" ? metadata.userId : undefined
  }).catch(() => null);
}

async function approveSubmission(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.editReply("Você não possui permissão para aprovar pedidos de set.");
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const targetId = interaction.customId.split(":")[3] ?? null;
  const submission = targetId ? await context.api.getLatestManualRegistrationSubmission(interaction.guild.id, targetId).catch(() => null) : null;
  if (!targetId) {
    await interaction.editReply("Não foi possível identificar o membro deste pedido.");
    return;
  }
  if (!submission || submission.status !== "pending" && submission.status !== "failed") {
    await interaction.editReply("Este pedido já está sendo processado ou já foi concluído.");
    return;
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  const processingPreview = { ...submission, status: "processing" as const };
  await interaction.message.edit(createReviewPayload(settings, processingPreview, interaction.guild)).catch(() => null);
  await interaction.editReply("Aprovação em processamento. Validando cargos, canal de meta, painel e logs...");
  try {
    const result = await processSetApproval({
      actorId: interaction.user.id,
      actorIsAdministrator: actor.permissions.has(PermissionFlagsBits.Administrator) || actor.permissions.has(PermissionFlagsBits.ManageGuild) || interaction.guild.ownerId === interaction.user.id,
      actorLabel: actor.displayName || interaction.user.username,
      actorRoleIds: [...actor.roles.cache.keys()],
      context,
      guild: interaction.guild,
      settings,
      submissionId: id,
      targetUserId: targetId
    });
    const member = await interaction.guild.members.fetch(result.submission.userId).catch(() => null);
    if (member && settings.dmNotifications) await member.send(createDecisionDmPayload(settings, result.submission, { goalChannelId: result.metaChannelId, guild: interaction.guild, status: "approved" })).catch(() => null);
    await interaction.message.edit(createReviewPayload(settings, result.submission, interaction.guild, { farmChannelId: result.farmChannelId, metaChannelId: result.metaChannelId, roleIds: result.roleIds })).catch(() => null);
    await sendRegistrationDecisionLog(interaction.guild, settings, result.submission, { actorId: interaction.user.id, actorLabel: actor.displayName || interaction.user.username, decidedAt: new Date(), farmChannelId: result.farmChannelId, metaChannelId: result.metaChannelId, roleIds: result.roleIds, status: "approved" });
    await traceSetApproval(context, "[SET_LOG_SENT]", { actorId: interaction.user.id, guildId: interaction.guild.id, requestId: result.submission.id, userId: result.submission.userId });
    await interaction.editReply(`Usuário aprovado com sucesso. O canal de meta foi criado e o sistema de farm foi vinculado: <#${result.metaChannelId}>`);
    await closeRequestChannel(interaction.guild, context, result.submission, "Pedido de Set aprovado");
  } catch (error) {
    const reason = manualRegistrationErrorMessage(error);
    const failed = targetId ? await context.api.getLatestManualRegistrationSubmission(interaction.guild.id, targetId).catch(() => null) : null;
    if (failed) await interaction.message.edit(createReviewPayload(settings, failed, interaction.guild)).catch(() => null);
    await interaction.editReply(`Não foi possível concluir a aprovação. O canal de meta não foi criado.\n\n${reason}`);
  }
}

async function showRejectionModal(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.reply({ content: "Você não possui permissão para recusar pedidos.", ephemeral: true });
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const userId = interaction.customId.split(":")[3] ?? "";
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:reject_modal:${id}:${userId}`).setTitle("Recusar Pedido de Set");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo da recusa").setMaxLength(800).setMinLength(3).setRequired(true).setStyle(TextInputStyle.Paragraph)));
  await interaction.showModal(modal);
}

async function rejectSubmission(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.editReply("Você não possui permissão para recusar pedidos.");
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const reason = interaction.fields.getTextInputValue("reason");
  const actor = await interaction.guild.members.fetch(interaction.user.id); const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, actorRoleIds: [...actor.roles.cache.keys()], guildId: interaction.guild.id, id, rejectionReason: reason, status: "rejected" });
  await context.api.postLog({ guildId: interaction.guild.id, message: "Pedido de Set recusado.", metadata: { reason, submissionId: id }, type: "manual-registration.rejected", userId: saved.userId }).catch(() => null);
  const member = await interaction.guild.members.fetch(saved.userId).catch(() => null);
  if (member && settings.dmNotifications) await member.send(createDecisionDmPayload(settings, saved, { guild: interaction.guild, reason, status: "rejected" })).catch(() => null);
  if (interaction.message) await interaction.message.edit(createReviewPayload(settings, saved, interaction.guild)).catch(() => null);
  await sendRegistrationDecisionLog(interaction.guild, settings, saved, { actorId: interaction.user.id, actorLabel: actor.displayName || interaction.user.username, decidedAt: new Date(), reason, status: "rejected" });
  await interaction.editReply("Pedido de set recusado.");
  await closeRequestChannel(interaction.guild, context, saved, "Pedido de Set recusado");
}

async function showRequestStatus(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guildId) return;
  const submission = await context.api.getLatestManualRegistrationSubmission(interaction.guildId, interaction.user.id);
  if (!submission) {
    await interaction.reply({ content: "Você ainda não possui pedidos de set.", ephemeral: true });
    return;
  }
  const status = submission.status === "approved" ? "Aprovado" : submission.status === "processing" ? "Processando" : submission.status === "failed" ? "Falha na aprovação" : submission.status === "rejected" ? "Recusado" : submission.status === "removed" ? "Removido" : "Pendente";
  await interaction.reply({ content: `Status: **${status}**\nCriado: <t:${Math.floor(new Date(submission.createdAt ?? Date.now()).getTime() / 1000)}:F>${submission.rejectionReason ? `\nMotivo: ${submission.rejectionReason}` : ""}`, ephemeral: true });
}

async function showSubmissionDetails(interaction: ButtonInteraction) {
  const content = interaction.message.components.length ? "Os dados completos estao exibidos no painel desta solicitação." : "Detalhes indisponiveis.";
  await interaction.reply({ content, ephemeral: true });
}

async function canReview(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction, settings: ManualRegistrationSettings) {
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  if (interaction.guild.ownerId === interaction.user.id || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const allowed = new Set([...settings.staffRoleIds, ...settings.approverRoleIds]);
  return member.roles.cache.some((role) => allowed.has(role.id));
}

export function createPanelPayload(settings: ManualRegistrationSettings, guild: Guild | null = null) {
  const imageUrl = settings.panelImage ? resolvePanelImageUrl(settings.panelImage.imageUrl, settings.panelImage) : null;
  const imageIsVideo = isVideoPanelMedia(settings.panelImage, imageUrl);
  const posterUrl = imageIsVideo ? resolvePanelImageUrl(settings.panelImage?.mediaPosterUrl ?? settings.panelImage?.mediaThumbnailUrl ?? null) : null;
  const thumbnailUrl = resolveImageUrl(settings.thumbnailUrl ?? null);
  const components: unknown[] = [];
  const blockComponents = renderPanelBlocks(settings.panelImage?.blocks ?? []);
  if (blockComponents.length) components.push(...blockComponents);
  const panelName = settings.title?.trim() || settings.name?.trim() || "Pedido de Set";
  const introText = settings.description?.trim() || "Preencha seu cadastro para liberar o acesso.";
  const heading = {
    type: 10,
    content: [
      replaceSystemEmojis(`# ${settings.emoji ? `${settings.emoji} ` : `${systemEmojiText("prancheta_caneta", guild, guild?.client)} `}${panelName}`, guild, guild?.client ?? null),
      "",
      `${systemEmojiText("interrogacao", guild, guild?.client)} ${introText}`
    ].join("\n\n")
  };
  const sideImageUrl = imageUrl ? (imageIsVideo ? posterUrl : imageUrl) : thumbnailUrl;
  components.push(sideImageUrl ? {
    type: 9,
    components: [{
      type: 10,
      content: heading.content
    }],
    accessory: { type: 11, media: { url: sideImageUrl } }
  } : heading);
  components.push({ type: 14, divider: false, spacing: 2 });
  components.push({
    type: 10,
    content: [
      replaceSystemEmojis(`### ${systemEmojiText("prancheta", guild, guild?.client)} Antes de começar`, guild, guild?.client ?? null),
      `- Tenha em mãos ${registrationFieldSummary(settings)}.`,
      "- Revise os dados antes de enviar."
    ].join("\n")
  });
  components.push({
    type: 10,
    content: `> ${systemEmojiText("alerta", guild, guild?.client)} Em caso de divergência, a equipe pode solicitar ajuste manual.`
  });
  components.push({ type: 14, divider: true, spacing: 1 });
  const startButton = new ButtonBuilder()
    .setCustomId(`${PREFIX}:start`)
    .setEmoji(normalizeComponentEmoji(settings.emoji) ?? systemComponentEmoji("prancheta_caneta", guild, guild?.client))
    .setLabel("INICIAR REGISTRO")
    .setStyle(ButtonStyle.Secondary);
  components.push({
    type: 9,
    components: [{
      type: 10,
      content: [
        `### ${systemEmojiText("prancheta_caneta", guild, guild?.client)} Iniciar formulário`,
        "Clique no botão ao lado para continuar."
      ].join("\n")
    }],
    accessory: startButton.toJSON()
  });
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: settings.footerText ? replaceSystemEmojis(`-# *${settings.footerText}*`, guild, guild?.client ?? null) : "-# *NexTech - Todos os direitos reservados*" });
  return {
    allowedMentions: { parse: [] as never[] },
    components: [buildV2Container({
      accentColor: parseColor(settings.color),
      components
    })],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function registrationFieldSummary(settings: ManualRegistrationSettings) {
  const labels = settings.fields
    .filter((field) => field.enabled !== false)
    .map((field) => field.label.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!labels.length) return "as informações solicitadas";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

function manualRegistrationTeamRoleIds(settings: ManualRegistrationSettings) {
  return [...new Set([...settings.approverRoleIds, ...settings.staffRoleIds, ...settings.manualRegistrationRoleIds].filter(Boolean))];
}

function registrationRequestChannelName(username: string, id: string) {
  const base = `solicitacao-${username}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 86);
  return `${base || "solicitacao"}-${id.slice(0, 4)}`.slice(0, 95);
}

async function validateManualRegistrationRequestConfig(guild: Guild, settings: ManualRegistrationSettings): Promise<{ ok: true } | { ok: false; message: string }> {
  const pending: string[] = [];
  if (!settings.requestCategoryId) pending.push("Categoria das solicitações.");
  if (!settings.logChannelId) pending.push("Canal de logs.");
  if (pending.length) return { ok: false, message: manualRegistrationConfigError(pending) };

  const category = await guild.channels.fetch(settings.requestCategoryId!).catch(() => null);
  const logChannel = await guild.channels.fetch(settings.logChannelId!).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) pending.push("Categoria das solicitações inválida ou removida.");
  if (!logChannel?.isSendable()) pending.push("Canal de logs inválido ou sem envio de mensagens.");

  const botMember = guild.members.me;
  if (!botMember) pending.push("Bot não localizado como membro do servidor.");
  if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) pending.push("Permissão Gerenciar Canais para o bot.");
  if (category && "permissionsFor" in category && botMember) {
    const permissions = category.permissionsFor(botMember);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) pending.push("Permissão Ver Canal na categoria das solicitações.");
    if (!permissions?.has(PermissionFlagsBits.ManageChannels)) pending.push("Permissão Gerenciar Canais na categoria das solicitações.");
  }
  if (logChannel && "permissionsFor" in logChannel && botMember) {
    const permissions = logChannel.permissionsFor(botMember);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) pending.push("Permissão Ver Canal no canal de logs.");
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) pending.push("Permissão Enviar Mensagens no canal de logs.");
  }

  return pending.length ? { ok: false, message: manualRegistrationConfigError(pending) } : { ok: true };
}

function manualRegistrationConfigError(items: string[]) {
  return [
    "O sistema não está totalmente configurado.",
    "",
    "Configurações pendentes:",
    ...items.map((item) => `- ${item}`),
    "",
    "Utilize o painel de configurações para concluir a configuração."
  ].join("\n");
}

function createReviewPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission, guild: Guild | null = null, approval?: { farmChannelId?: string | null; metaChannelId?: string | null; roleIds?: string[] }) {
  const statusText = submission.status === "approved" ? "Aprovado" : submission.status === "processing" ? "Processando" : submission.status === "failed" ? "Falha na aprovação" : submission.status === "rejected" ? submission.rejectionReason?.startsWith("Cancelado") ? "Cancelado" : "Recusado" : "Pendente";
  const imageUrl = settings.panelImage ? resolvePanelImageUrl(settings.panelImage.imageUrl, settings.panelImage) : null;
  const content: Array<Record<string, unknown>> = [
    { type: 10, content: replaceSystemEmojis(`# ${settings.emoji ?? systemEmojiText("prancheta_caneta", guild, guild?.client)} Pedido de Set`, guild, guild?.client ?? null) },
    { type: 10, content: `${systemEmojiText("homem", guild, guild?.client)} Usuário: <@${submission.userId}>\nID: ${submission.userId}\nSet solicitado: ${submission.requestedRoleId ? `<@&${submission.requestedRoleId}>` : "Padrão"}\nData: <t:${Math.floor(new Date(submission.createdAt ?? Date.now()).getTime() / 1000)}:F>\nStatus: ${reviewStatusEmoji(submission.status, guild)} **${statusText}**` },
    { type: 14 },
    { type: 10, content: submission.fields.map((field) => `**${field.label}:** ${field.value}`).join("\n").slice(0, 3500) }
  ];
  if (submission.rejectionReason) content.push({ type: 10, content: submission.status === "failed" ? `**Falha:** ${submission.rejectionReason}` : `**Motivo da recusa:** ${submission.rejectionReason}` });
  if (submission.status === "approved" && approval?.metaChannelId) {
    content.push({
      type: 10,
      content: [
        `**Canal de meta:** <#${approval.metaChannelId}>`,
        `**Canal de farm:** ${approval.farmChannelId ? `<#${approval.farmChannelId}>` : "Mesmo canal de meta"}`,
        approval.roleIds?.length ? `**Cargos aplicados:** ${approval.roleIds.map((roleId) => `<@&${roleId}>`).join(", ")}` : null
      ].filter(Boolean).join("\n")
    });
  }
  if (imageUrl) content.push(mediaGallery(imageUrl));
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      { type: 17, accent_color: parseColor(settings.color), components: content },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("visto", guild, guild?.client)).setLabel(submission.status === "failed" ? "Tentar novamente" : "Aprovar").setStyle(ButtonStyle.Success).setDisabled(submission.status !== "pending" && submission.status !== "failed"),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("exclamacao", guild, guild?.client)).setLabel("Recusar").setStyle(ButtonStyle.Danger).setDisabled(submission.status !== "pending" && submission.status !== "failed"),
        new ButtonBuilder().setCustomId(`${PREFIX}:view:${submission.id}`).setEmoji(systemComponentEmoji("prancheta", guild, guild?.client)).setLabel("Ver Detalhes").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:edit_set:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("prancheta_caneta", guild, guild?.client)).setLabel("Editar Set").setStyle(ButtonStyle.Secondary).setDisabled(submission.status !== "pending" && submission.status !== "failed"),
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("porta", guild, guild?.client)).setLabel("Cancelar").setStyle(ButtonStyle.Secondary).setDisabled(submission.status !== "pending" && submission.status !== "failed")
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

export function createManualRegistrationCreatedLogPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission, input: { channelId: string; guildId: string; guildName: string; memberDisplayName: string; serverIconUrl?: string | null }, guild: Guild | null = null) {
  const createdAt = new Date(submission.createdAt ?? Date.now());
  const fieldLines = submission.fields.length
    ? submission.fields.map((field) => `- ${field.label}: ${field.value}`).join("\n").slice(0, 2500)
    : "- Nenhum campo informado.";
  const body = {
    type: 10,
    content: replaceSystemEmojis([
      `# ${systemEmojiText("prancheta", guild, guild?.client)} Novo registro realizado`,
      "",
      `${systemEmojiText("homem", guild, guild?.client)} **Usuário:** <@${submission.userId}>`,
      `- Nome no servidor: ${input.memberDisplayName}`,
      `- ID do usuário: ${submission.userId}`,
      "",
      `${systemEmojiText("discord", guild, guild?.client)} **Servidor:** ${input.guildName}`,
      `- ID do servidor: ${input.guildId}`,
      `- Canal criado: <#${input.channelId}>`,
      `- ID do canal: ${input.channelId}`,
      `- Link direto: https://discord.com/channels/${input.guildId}/${input.channelId}`,
      "",
      `${systemEmojiText("folha", guild, guild?.client)} **Registro:** ${submission.id}`,
      "- Status: Aguardando atendimento",
      `- Data: ${formatBrazilDateTime(createdAt)}`,
      "",
      `${systemEmojiText("prancheta_caneta", guild, guild?.client)} **Dados preenchidos**`,
      fieldLines
    ].join("\n"), guild, guild?.client ?? null)
  };
  const components: unknown[] = [
    input.serverIconUrl ? { type: 9, components: [body], accessory: { type: 11, media: { url: input.serverIconUrl } } } : body,
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: settings.footerText ? replaceSystemEmojis(`-# *${settings.footerText}*`, guild, guild?.client ?? null) : "-# *NexTech - Todos os direitos reservados*" }
  ];
  const mentionRoleId = settings.logMentionRoleId ?? null;
  return {
    allowedMentions: { parse: [] as never[], roles: mentionRoleId ? [mentionRoleId] : [], users: [submission.userId] },
    components: [{ type: 17, accent_color: parseColor(settings.color), components }],
    content: mentionRoleId ? `<@&${mentionRoleId}>` : undefined,
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendRegistrationCreatedLog(guild: Guild, settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission) {
  if (!settings.logChannelId) throw new Error("Canal de logs não configurado.");
  if (!submission.channelId) throw new Error("Canal da solicitação não está salvo no registro.");
  const channel = await guild.channels.fetch(settings.logChannelId).catch((error) => {
    console.error("[REGISTRO] Falha ao buscar canal de logs", { error, guildId: guild.id, logChannelId: settings.logChannelId });
    return null;
  });
  if (!channel?.isSendable()) throw new Error("Canal de logs não encontrado ou sem permissão de envio.");
  const member = await guild.members.fetch(submission.userId).catch(() => null);
  return channel.send(createManualRegistrationCreatedLogPayload(settings, submission, {
    channelId: submission.channelId,
    guildId: guild.id,
    guildName: guild.name,
    memberDisplayName: member?.displayName ?? submission.username,
    serverIconUrl: guild.iconURL({ size: 256 })
  }, guild));
}

function reviewStatusEmoji(status: ManualRegistrationSubmission["status"], guild: Guild | null) {
  if (status === "approved") return systemStatusEmoji("success", guild, guild?.client);
  if (status === "processing") return systemEmojiText("relogio", guild, guild?.client);
  if (status === "failed") return systemEmojiText("alerta", guild, guild?.client);
  if (status === "rejected" || status === "removed") return systemStatusEmoji("danger", guild, guild?.client);
  return systemStatusEmoji("pending", guild, guild?.client);
}

type DecisionLogInput = {
  actorId: string;
  actorLabel: string;
  decidedAt: Date;
  failureReason?: string | null;
  farmChannelId?: string | null;
  metaChannelId?: string | null;
  reason?: string | null;
  roleIds?: string[];
  serverIconUrl?: string | null;
  status: "approved" | "failed" | "rejected";
};

export function createManualRegistrationDecisionLogPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission, input: DecisionLogInput, guild: Guild | null = null) {
  const approved = input.status === "approved";
  const failed = input.status === "failed";
  const statusText = approved ? "Aprovado" : failed ? "Falha na aprovação" : "Reprovado";
  const titleEmoji = approved ? systemEmojiText("visto", guild, guild?.client) : systemEmojiText("exclamacao", guild, guild?.client);
  const characterName = submissionFieldValue(submission, ["nome_personagem", "personagem", "nome_do_personagem", "nome"]) ?? submission.requestedName ?? submission.username;
  const gameId = submissionFieldValue(submission, ["id_fivem", "id", "id_in_game", "id_ingame"]) ?? "-";
  const phone = submissionFieldValue(submission, ["telefone", "telefone_in_game", "telefone_ingame"]) ?? "-";
  const recruiter = submissionFieldValue(submission, ["recrutador", "quem_recrutou"]) ?? "-";
  const decisionLines = [
    `- Por: <@${input.actorId}> | ${input.actorLabel}`,
    `- Em: ${formatBrazilDateTime(input.decidedAt)}`
  ];
  if (approved) {
    decisionLines.push(`- Cargos aplicados: ${input.roleIds?.length ? input.roleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "não informado"}`);
    decisionLines.push(`- Canal de meta: ${input.metaChannelId ? `<#${input.metaChannelId}>` : "não informado"}`);
    decisionLines.push(`- Canal de farm: ${input.farmChannelId ? `<#${input.farmChannelId}>` : "mesmo canal de meta"}`);
    decisionLines.push("- Banco de dados: atualizado");
  }
  if (failed && input.failureReason?.trim()) decisionLines.push(`- Falha: ${input.failureReason.trim()}`);
  if (!approved && input.reason?.trim()) decisionLines.push(`- Motivo: ${input.reason.trim()}`);
  const body = {
    type: 10,
    content: replaceSystemEmojis([
      `# ${titleEmoji} Registro - ${statusText}`,
      "",
      `${systemEmojiText("homem", guild, guild?.client)} **Usuario:** <@${submission.userId}> | ${gameId} (${submission.username})`,
      "",
      `${systemEmojiText("prancheta", guild, guild?.client)} **Dados do registro**`,
      `- Personagem: ${characterName}`,
      `- ID: ${gameId}`,
      `- Telefone: ${phone}`,
      `- Recrutador: ${recruiter}`,
      "",
      `- Enviado em: ${formatBrazilDateTime(submission.createdAt)}`,
      `${titleEmoji} Status: ${statusText}`,
      "",
      `${systemEmojiText("homem", guild, guild?.client)} **Decisao**`,
      ...decisionLines
    ].join("\n"), guild, guild?.client ?? null)
  };
  const components: unknown[] = [
    input.serverIconUrl ? { type: 9, components: [body], accessory: { type: 11, media: { url: input.serverIconUrl } } } : body,
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: "-# *NexTech - Todos os direitos reservados*" }
  ];
  const mentionRoleId = settings.logMentionRoleId ?? null;
  return {
    allowedMentions: { parse: [] as never[], roles: mentionRoleId ? [mentionRoleId] : [], users: [submission.userId, input.actorId] },
    components: [{ type: 17, accent_color: approved ? 0x22c55e : failed ? 0xf59e0b : 0xef4444, components }],
    content: mentionRoleId ? `<@&${mentionRoleId}>` : undefined,
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendRegistrationDecisionLog(guild: Guild, settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission, input: DecisionLogInput) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch((error) => {
    console.error("[REGISTRO] Falha ao buscar canal de log de decisão", { error, guildId: guild.id, logChannelId: settings.logChannelId, submissionId: submission.id });
    return null;
  });
  if (!channel?.isSendable()) {
    console.error("[REGISTRO] Canal de log de decisão inválido ou sem permissão", { guildId: guild.id, logChannelId: settings.logChannelId, submissionId: submission.id });
    return;
  }
  await channel.send(createManualRegistrationDecisionLogPayload(settings, submission, { ...input, serverIconUrl: guild.iconURL({ size: 256 }) }, guild)).catch((error) => {
    console.error("[REGISTRO] Falha ao enviar log de decisão", { error, guildId: guild.id, logChannelId: settings.logChannelId, submissionId: submission.id });
  });
}

export function createDecisionDmPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission, input: { goalChannelId?: string | null; guild: Guild; reason?: string | null; status: "approved" | "rejected" }) {
  const approved = input.status === "approved";
  const title = approved ? "Registro aprovado" : "Registro recusado";
  const statusEmoji = approved ? systemEmojiText("visto", input.guild, input.guild.client) : systemEmojiText("exclamacao", input.guild, input.guild.client);
  const managerMention = settings.logMentionRoleId ? `<@&${settings.logMentionRoleId}>` : "alguém da gerência";
  const goalChannelText = input.goalChannelId ? goalChannelDmText(input.guild, input.goalChannelId) : null;
  const lines = approved ? [
    `# ${statusEmoji} ${title}`,
    "",
    settings.approvalMessage || "Seu pedido de set foi aprovado.",
    "",
    goalChannelText ? `${systemEmojiText("prancheta_acertos", input.guild, input.guild.client)} Canal de meta: ${goalChannelText}` : `${systemEmojiText("alerta", input.guild, input.guild.client)} Canal de meta ainda não foi localizado. Entre em contato com a gerência se ele não aparecer.`,
    `${systemEmojiText("homem", input.guild, input.guild.client)} Usuário: ${submission.requestedName || submission.username}`
  ] : [
    `# ${statusEmoji} ${title}`,
    "",
    settings.rejectionMessage || "Seu pedido de set foi recusado.",
    "",
    input.reason?.trim() ? `${systemEmojiText("folha", input.guild, input.guild.client)} Motivo: ${input.reason.trim()}` : null,
    `${systemEmojiText("interrogacao", input.guild, input.guild.client)} Entre em contato com ${managerMention} para verificar o que aconteceu.`,
    "Nenhum cargo foi entregue por causa desta recusa."
  ].filter((line): line is string => Boolean(line));

  return {
    allowedMentions: { parse: [] as never[] },
    components: [{
      type: 17,
      accent_color: approved ? 0x22c55e : 0xef4444,
      components: [
        { type: 10, content: replaceSystemEmojis(lines.join("\n"), input.guild, input.guild.client) },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: settings.footerText ? replaceSystemEmojis(`-# *${settings.footerText}*`, input.guild, input.guild.client) : "-# *NexTech - Todos os direitos reservados*" }
      ]
    }],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function goalChannelDmText(guild: Guild, channelId: string) {
  const channel = guild.channels.cache.get(channelId);
  const channelName = channel && "name" in channel && typeof channel.name === "string" ? channel.name : "canal-de-meta";
  return `#${channelName}\nhttps://discord.com/channels/${guild.id}/${channelId}`;
}

async function sendActionLog(guild: Guild, settings: ManualRegistrationSettings, text: string) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch((error) => {
    console.error("[REGISTRO] Falha ao buscar canal de log de ação", { error, guildId: guild.id, logChannelId: settings.logChannelId });
    return null;
  });
  if (!channel?.isSendable()) {
    console.error("[REGISTRO] Canal de log de ação inválido ou sem permissão", { guildId: guild.id, logChannelId: settings.logChannelId });
    return;
  }
  await channel.send({ allowedMentions: { parse: [] as never[], roles: settings.logMentionRoleId ? [settings.logMentionRoleId] : [] }, components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# ${systemEmojiText("prancheta", guild, guild.client)} Log de Pedido de Set\n${text}\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }] }], content: settings.logMentionRoleId ? `<@&${settings.logMentionRoleId}>` : undefined, flags: MessageFlags.IsComponentsV2 }).catch((error) => {
    console.error("[REGISTRO] Falha ao enviar log de ação", { error, guildId: guild.id, logChannelId: settings.logChannelId });
  });
}

async function closeRequestChannel(guild: Guild, context: BotContext, submission: ManualRegistrationSubmission, reason: string) {
  if (!submission.channelId) return;
  const channel = await guild.channels.fetch(submission.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText || !channel.deletable) return;
  const deleted = await channel.delete(reason).then(() => true).catch((error) => {
    void context.api.postLog({
      guildId: guild.id,
      message: error instanceof Error ? error.message : "Falha ao apagar canal do Pedido de Set.",
      metadata: { channelId: submission.channelId, submissionId: submission.id },
      type: "manual-registration.channel_close_failed",
      userId: submission.userId
    }).catch(() => null);
    return false;
  });
  if (deleted) await context.api.updateManualRegistrationSubmissionChannel(submission.id, null, null).catch(() => null);
}

function selectedGoalCategoryId(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission) {
  return settings.setRoles.find((item) => item.roleId === submission.requestedRoleId)?.categoryId ?? null;
}

function submissionGameId(submission: ManualRegistrationSubmission) {
  return submissionFieldValue(submission, ["id_fivem", "id", "id_in_game", "id_ingame"]);
}

function submissionFieldValue(submission: ManualRegistrationSubmission, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeFieldKey));
  const field = submission.fields.find((item) => normalizedAliases.has(normalizeFieldKey(item.id)) || normalizedAliases.has(normalizeFieldKey(item.label)));
  const value = field?.value?.trim();
  return value && value !== "-" ? value : null;
}

function normalizeFieldKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatBrazilDateTime(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
}

function mediaGallery(imageUrl: string) {
  return { type: 12, items: [{ media: { url: imageUrl }, description: "pedido de set" }] };
}

function resolveImageUrl(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

function isVideoPanelMedia(panelImage: ManualRegistrationSettings["panelImage"], imageUrl: string | null) {
  if (!imageUrl) return false;
  if (panelImage?.imageMimeType?.startsWith("video/")) return true;
  const extension = panelImage?.imageExtension?.trim().toLowerCase();
  return Boolean(extension && VIDEO_EXTENSIONS.has(extension)) || /\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(imageUrl);
}

const VIDEO_EXTENSIONS = new Set(["3gp", "3g2", "asf", "avi", "f4v", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "mxf", "ogv", "rmvb", "ts", "vob", "webm", "wmv"]);

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x7c3aed;
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "usuario";
}

function normalizeComponentEmoji(value: string | null) {
  const emoji = replaceSystemEmojis(value?.trim() ?? "");
  if (!emoji) return undefined;
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{5,32}>$/.test(emoji)) return emoji;
  if (/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic})*$/u.test(emoji)) return emoji;
  return undefined;
}

function manualRegistrationErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data && typeof error.response.data === "object" && "message" in error.response.data
      ? error.response.data.message
      : null;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Não foi possível enviar o pedido de set. Tente novamente em alguns instantes.";
}
