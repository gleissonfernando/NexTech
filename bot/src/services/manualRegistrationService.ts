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
import { ensureFivemGoalChannelForUser } from "./fivemGoalService";
import { buildV2Container, renderPanelBlocks } from "./panelVisualRenderer";
import { replaceSystemEmojis, systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const PREFIX = "manual_registration";
const formSessions = new Map<string, { answers: Array<{ id: string; label: string; value: string }>; expiresAt: number; guildId: string; page: number; requestedRoleId: string | null; userId: string }>();
const configDrafts = new Map<string, { approvedRoleId?: string | null; approverRoleIds?: string[]; manualRegistrationRoleIds?: string[]; panelChannelId?: string | null; requestCategoryId?: string | null; logChannelId?: string | null }>();

export function startManualRegistrationService(client: Client<true>, context: BotContext) {
  context.socket.onManualRegistrationPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredPanel(guild, context);
  });
  context.socket.onManualRegistrationExecute((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void executeDashboardRegistration(guild, context, payload);
  });
  context.socket.onManualRegistrationRemove((payload) => { const guild = client.guilds.cache.get(payload.guildId); if (!guild) return; void guild.members.fetch(payload.userId).then(async (member) => { if (payload.roleId) await member.roles.remove(payload.roleId, "Cadastro de Set removido pela dashboard"); }).catch((error) => context.api.postLog({ guildId: payload.guildId, type: "manual-registration.role_removal_failed", message: error instanceof Error ? error.message : "Usuário não encontrado ou cargo não removido", userId: payload.userId }).catch(() => null)); });
}

async function executeDashboardRegistration(guild: Guild, context: BotContext, payload: { goalCategoryId: string; requestedRoleId: string; submissionId: string; userId: string; username: string }) {
  try {
    const member = await guild.members.fetch(payload.userId);
    const role = await guild.roles.fetch(payload.requestedRoleId);
    if (!role?.editable) throw new Error("O cargo selecionado nao pode ser entregue pelo bot.");
    await member.roles.add(role, "Cadastro manual realizado pela dashboard");
    const settings = await context.api.getManualRegistrationSettings(guild.id); const saved = await context.api.reviewManualRegistrationSubmission({ actorId: guild.members.me?.id ?? member.client.user.id, actorRoleIds: settings.approverRoleIds, guildId: guild.id, id: payload.submissionId, status: "approved" });
    const channelId = await ensureFivemGoalChannelForUser(context, guild, payload.userId, payload.username, payload.goalCategoryId);
    await context.api.postLog({ guildId: guild.id, message: channelId ? "Cadastro manual concluido e canal de meta criado." : "Cadastro manual concluido; canal de meta ja existente ou modulo de metas indisponivel.", metadata: { channelId, roleId: payload.requestedRoleId, submissionId: saved.id }, type: "manual-registration.dashboard_completed", userId: payload.userId }).catch(() => null);
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
    await interaction.reply({ content: "O Pedido de Set esta desativado na dashboard.", ephemeral: true });
    return;
  }
  const configured = await resolveOrCreatePanelChannel(interaction.guild, settings);
  const channel = configured?.isSendable() ? configured : interaction.channel?.isSendable() ? interaction.channel : null;
  if (!channel) {
    await interaction.reply({ content: "Configure um canal valido para o painel.", ephemeral: true });
    return;
  }
  if (settings.panelMessageId && "messages" in channel) {
    const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (!message) {
      await interaction.reply({ content: "A mensagem salva do painel nao foi encontrada. Limpe o ID salvo ou remova o painel antigo antes de publicar outro.", ephemeral: true });
      return;
    }
    await message.edit(createPanelPayload(settings));
    await context.api.saveManualRegistrationSettings(interaction.guild.id, { panelChannelId: channel.id, panelMessageId: message.id });
    await interaction.reply({ content: `Painel de Pedido de Set atualizado em <#${channel.id}>.`, ephemeral: true });
    return;
  }
  const message = await channel.send(createPanelPayload(settings));
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
    await member.roles.add(role, `Cadastro manual por ${interaction.user.tag}`);
    await member.setNickname(requestedName, "Cadastro manual de Set").catch((error) => context.api.postLog({ guildId: interaction.guild!.id, type: "manual-registration.nickname_failed", message: error instanceof Error ? error.message : "Falha ao alterar apelido", userId: user.id, executorId: interaction.user.id }).catch(() => null));
    const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, actorRoleIds: [...actor.roles.cache.keys()], guildId: interaction.guild.id, id: submission.id, status: "approved" });
    await linkApprovedSetToGoals(context, interaction.guild, user.id, requestedName, saved.id);
    await sendActionLog(interaction.guild, settings, `Cadastro manual\nUsuário: <@${user.id}>\nNome: ${requestedName}\nResponsável: <@${interaction.user.id}>\nObservação: ${note}`);
    await interaction.editReply(`Cadastro manual concluído para <@${user.id}> como **${requestedName}**.`);
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
      await message.edit(createPanelPayload(settings));
      return;
    }
  }
  const message = await channel.send(createPanelPayload(settings));
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
    reason: "Canal automatico do sistema de Pedido de Set",
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
  if (interaction.isRoleSelectMenu()) { const field = action === "approved_select" ? "approvedRoleId" : action === "reviewers_select" ? "approverRoleIds" : "manualRegistrationRoleIds"; configDrafts.set(key, { ...draft, [field]: field === "approvedRoleId" ? interaction.values[0] ?? null : interaction.values }); return void await interaction.deferUpdate(); }
  if (interaction.isChannelSelectMenu()) { const field = action === "panel_select" ? "panelChannelId" : action === "category_select" ? "requestCategoryId" : "logChannelId"; configDrafts.set(key, { ...draft, [field]: interaction.values[0] ?? null }); return void await interaction.deferUpdate(); }
  if (action === "back") { configDrafts.delete(key); return void await interaction.update(configMainPayload(settings)); }
  if (action.startsWith("save_")) { const module = action.slice(5); const patch = module === "approved" ? { approvedRoleId: draft.approvedRoleId } : module === "reviewers" ? { approverRoleIds: draft.approverRoleIds } : module === "manual" ? { manualRegistrationRoleIds: draft.manualRegistrationRoleIds } : { panelChannelId: draft.panelChannelId, requestCategoryId: draft.requestCategoryId, logChannelId: draft.logChannelId }; if (!Object.values(patch).some((value) => value !== undefined)) return void await interaction.reply({ content: "Nenhuma alteração pendente neste módulo.", ephemeral: true }); const saved = await context.api.saveManualRegistrationSettings(interaction.guild.id, patch); configDrafts.delete(key); return void await interaction.update(configMainPayload(saved)); }
  const backSave = (module: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:config:save_${module}`).setEmoji(systemComponentEmoji("salvar")).setLabel("Salvar").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`${PREFIX}:config:back`).setEmoji(systemComponentEmoji("porta")).setLabel("Voltar").setStyle(ButtonStyle.Secondary));
  if (action === "approved") return void await interaction.update({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: `# ${systemEmojiText("visto")} Cargo atribuído ao aprovar\nSelecione um cargo e clique em **Salvar**.` }, new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:config:approved_select`).setPlaceholder("Selecione o cargo aprovado").setMinValues(1).setMaxValues(1)), backSave("approved")] }] });
  if (action === "reviewers" || action === "manual") { const module = action; return void await interaction.update({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: module === "reviewers" ? `# ${systemEmojiText("homem")} Cargos que aprovam ou recusam` : `# ${systemEmojiText("prancheta_caneta")} Cargos para cadastro manual` }, new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:config:${module}_select`).setPlaceholder("Selecione um ou vários cargos").setMinValues(1).setMaxValues(20)), backSave(module)] }] }); }
  if (action === "channels") return void await interaction.update({ components: [{ type: 17, accent_color: 0x7c3aed, components: [{ type: 10, content: `# ${systemEmojiText("discord")} Canais do sistema de Set\nSelecione o painel, a categoria privada e o canal de logs.` }, new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:config:panel_select`).setPlaceholder("Canal do painel").setChannelTypes(ChannelType.GuildText)), new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:config:category_select`).setPlaceholder("Categoria dos pedidos").setChannelTypes(ChannelType.GuildCategory)), new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:config:log_select`).setPlaceholder("Canal de logs").setChannelTypes(ChannelType.GuildText)), backSave("channels")] }] });
}
async function isSetAdministrator(guild: Guild, userId: string) { const member = await guild.members.fetch(userId).catch(() => null); return Boolean(member && (guild.ownerId === userId || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild))); }

export async function showManualRegistrationQuickConfig(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:quick_config`).setTitle("Configurar Pedido de Set");
  const fields = [
    ["panelChannelId", "ID do canal do painel", false],
    ["approvalChannelId", "ID do canal de analise", true],
    ["logChannelId", "ID do canal de logs", false],
    ["staffRoleId", "ID do cargo da staff", false],
    ["defaultRoleId", "ID do cargo/set padrao", false]
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
        "2. Escolha o set desejado, quando houver mais de uma opcao.",
        "3. Preencha todos os dados solicitados e envie o formulario.",
        "4. Use **Meu Status** para acompanhar a analise.",
        "",
        "Se precisar corrigir alguma informacao, procure a equipe responsavel."
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
    await interaction.reply({ content: "Voce nao possui permissao para editar pedidos.", ephemeral: true });
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
    await interaction.reply({ content: "Voce nao possui permissao para editar pedidos.", ephemeral: true });
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const saved = await context.api.updateManualRegistrationSubmissionRole({ actorId: interaction.user.id, guildId: interaction.guild.id, id, requestedRoleId: interaction.values[0] ?? "" });
  const channel = settings.approvalChannelId ? await interaction.guild.channels.fetch(settings.approvalChannelId).catch(() => null) : null;
  if (saved.messageId && channel && "messages" in channel) {
    const message = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (message) await message.edit(createReviewPayload(settings, saved)).catch(() => null);
  }
  await interaction.update({ components: [], content: "Set solicitado atualizado." });
}

async function cancelSubmission(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.editReply("Voce nao possui permissao para cancelar pedidos.");
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const actor = await interaction.guild.members.fetch(interaction.user.id); const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, actorRoleIds: [...actor.roles.cache.keys()], guildId: interaction.guild.id, id, rejectionReason: "Cancelado pela equipe responsavel.", status: "rejected" });
  await interaction.message.edit(createReviewPayload(settings, saved)).catch(() => null);
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
    await interaction.editReply("Use apenas IDs validos do Discord nos campos de configuracao.");
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
    await interaction.reply({ content: "O Pedido de Set esta desativado.", ephemeral: true });
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
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:form_next:${token}`).setLabel(`Continuar para etapa ${session.page + 1}`).setStyle(ButtonStyle.Primary))],
      content: `Etapa ${page + 1} salva. Continue para preencher as proximas perguntas.`
    });
    return;
  }
  formSessions.delete(token);
  const requestedRoleId = session.requestedRoleId;
  const fields = session.answers;
  let submission: ManualRegistrationSubmission;
  try {
    submission = await context.api.createManualRegistrationSubmission({ fields, guildId: interaction.guild.id, requestedRoleId, userAvatar: interaction.user.displayAvatarURL(), userId: interaction.user.id, username: interaction.user.tag });
  } catch (error) {
    await interaction.editReply(manualRegistrationErrorMessage(error));
    return;
  }
  let automaticError: string | null = null;
  if (settings.automaticApproval) {
    try {
      const member = await assignSetRoles(interaction.guild, settings, submission);
      submission = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.client.user.id, actorRoleIds: settings.approverRoleIds, guildId: interaction.guild.id, id: submission.id, status: "approved" });
      if (settings.dmNotifications) await member.send(settings.approvalMessage).catch(() => null);
      await linkApprovedSetToGoals(context, interaction.guild, submission.userId, member.user.username, submission.id);
      await sendActionLog(interaction.guild, settings, `Pedido aprovado automaticamente\nUsuario: <@${submission.userId}>\nSet: ${submission.requestedRoleId ? `<@&${submission.requestedRoleId}>` : "padrao"}`);
    } catch (error) {
      automaticError = error instanceof Error ? error.message : "Nao foi possivel aplicar o cargo automaticamente.";
      await context.api.postLog({ guildId: interaction.guild.id, message: automaticError, metadata: { submissionId: submission.id }, type: "manual-registration.auto_approval_failed", userId: interaction.user.id }).catch(() => null);
    }
  }
  const category = settings.requestCategoryId ? await interaction.guild.channels.fetch(settings.requestCategoryId).catch(() => null) : null;
  if (category?.type !== ChannelType.GuildCategory) { await interaction.editReply("O pedido foi salvo, mas a categoria privada não está configurada ou foi removida. Avise a administração."); return; }
  const botMember = interaction.guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) { await interaction.editReply("O bot precisa da permissão **Gerenciar Canais** para abrir o pedido."); return; }
  const requestedName = submission.requestedName || interaction.user.username;
  const channel = await interaction.guild.channels.create({ name: `set-${slug(requestedName)}-${submission.id.slice(0, 4)}`.slice(0, 95), parent: category.id, type: ChannelType.GuildText, permissionOverwrites: [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: submission.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }, { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }, ...settings.approverRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))] });
  const message = await channel.send(createReviewPayload(settings, submission));
  submission = await context.api.updateManualRegistrationSubmissionChannel(submission.id, channel.id, message.id);
  await interaction.editReply(automaticError ? `${settings.successMessage}\n\nA aprovacao automatica ficou pendente: ${automaticError}` : settings.automaticApproval ? settings.approvalMessage : settings.successMessage);
}

async function assignSetRoles(guild: Guild, settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission) {
  const member = await guild.members.fetch(submission.userId).catch(() => null);
  if (!member) throw new Error("O membro nao foi encontrado no servidor.");
  const roleIds = [...new Set([...(settings.autoRoleIds ?? []), ...(submission.requestedRoleId ? [submission.requestedRoleId] : [])])];
  for (const roleId of roleIds) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role || !role.editable) throw new Error(`O bot nao pode entregar o cargo ${roleId}; verifique a hierarquia.`);
  }
  for (const roleId of settings.removeRoleIds) await member.roles.remove(roleId).catch(() => null);
  for (const roleId of roleIds) await member.roles.add(roleId);
  return member;
}

async function approveSubmission(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.editReply("Voce nao possui permissao para aprovar pedidos de set.");
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const targetId = interaction.customId.split(":")[3] ?? null;
  const submission = targetId ? await context.api.getLatestManualRegistrationSubmission(interaction.guild.id, targetId).catch(() => null) : null;
  if (!targetId) {
    await interaction.editReply("Nao foi possivel identificar o membro deste pedido.");
    return;
  }
  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    await interaction.editReply("O membro nao foi encontrado no servidor.");
    return;
  }
  const roleIds = [...new Set([settings.approvedRoleId ?? submission?.requestedRoleId, ...(settings.autoRoleIds ?? [])].filter((value): value is string => Boolean(value)))];
  if (!roleIds.length) { await interaction.editReply("O cargo de aprovado não está configurado."); return; }
  for (const roleId of roleIds) {
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role || !role.editable) {
      await context.api.postLog({ guildId: interaction.guild.id, message: "Falha ao entregar cargo do Pedido de Set.", metadata: { roleId, submissionId: id }, type: "manual-registration.role_delivery_failed", userId: interaction.user.id }).catch(() => null);
      await interaction.editReply(`Nao posso entregar o cargo <@&${roleId}>. Verifique a hierarquia e a permissao Gerenciar Cargos.`);
      return;
    }
  }
  for (const roleId of settings.removeRoleIds) await member.roles.remove(roleId).catch(() => null);
  for (const roleId of roleIds) await member.roles.add(roleId);
  const actor = await interaction.guild.members.fetch(interaction.user.id); const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, actorRoleIds: [...actor.roles.cache.keys()], guildId: interaction.guild.id, id, status: "approved" });
  await member.setNickname(saved.requestedName, "Pedido de Set aprovado").catch((error) => context.api.postLog({ guildId: interaction.guild!.id, message: error instanceof Error ? error.message : "Falha ao alterar apelido", metadata: { submissionId: id }, type: "manual-registration.nickname_failed", userId: saved.userId, executorId: interaction.user.id }).catch(() => null));
  await context.api.postLog({ guildId: interaction.guild.id, message: "Cargo do Pedido de Set entregue.", metadata: { roleIds, submissionId: id }, type: "manual-registration.role_delivered", userId: saved.userId }).catch(() => null);
  if (settings.dmNotifications) await member.send(settings.approvalMessage).catch(() => null);
  await linkApprovedSetToGoals(context, interaction.guild, saved.userId, member.user.username, saved.id);
  await interaction.message.edit(createReviewPayload(settings, saved)).catch(() => null);
  if (interaction.channel?.isThread() === false && "permissionOverwrites" in interaction.channel) await interaction.channel.permissionOverwrites.edit(saved.userId, { SendMessages: false }).catch(() => null);
  await sendActionLog(interaction.guild, settings, `Pedido aprovado\nUsuario: <@${saved.userId}>\nStaff: <@${interaction.user.id}>\nSet: ${saved.requestedRoleId ? `<@&${saved.requestedRoleId}>` : "padrao"}`);
  await interaction.editReply("Pedido de set aprovado e cargo entregue.");
}

async function showRejectionModal(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  if (!(await canReview(interaction, settings))) {
    await interaction.reply({ content: "Voce nao possui permissao para recusar pedidos.", ephemeral: true });
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
    await interaction.editReply("Voce nao possui permissao para recusar pedidos.");
    return;
  }
  const id = interaction.customId.split(":")[2] ?? "";
  const reason = interaction.fields.getTextInputValue("reason");
  const actor = await interaction.guild.members.fetch(interaction.user.id); const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, actorRoleIds: [...actor.roles.cache.keys()], guildId: interaction.guild.id, id, rejectionReason: reason, status: "rejected" });
  await context.api.postLog({ guildId: interaction.guild.id, message: "Pedido de Set recusado.", metadata: { reason, submissionId: id }, type: "manual-registration.rejected", userId: saved.userId }).catch(() => null);
  const member = await interaction.guild.members.fetch(saved.userId).catch(() => null);
  if (member && settings.dmNotifications) await member.send(`${settings.rejectionMessage}\n\nMotivo: ${reason}`).catch(() => null);
  if (interaction.message) await interaction.message.edit(createReviewPayload(settings, saved)).catch(() => null);
  if (interaction.channel?.isThread() === false && "permissionOverwrites" in interaction.channel) await interaction.channel.permissionOverwrites.edit(saved.userId, { SendMessages: false }).catch(() => null);
  await sendActionLog(interaction.guild, settings, `Pedido recusado\nUsuario: <@${saved.userId}>\nStaff: <@${interaction.user.id}>\nMotivo: ${reason}`);
  await interaction.editReply("Pedido de set recusado.");
}

async function showRequestStatus(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guildId) return;
  const submission = await context.api.getLatestManualRegistrationSubmission(interaction.guildId, interaction.user.id);
  if (!submission) {
    await interaction.reply({ content: "Voce ainda nao possui pedidos de set.", ephemeral: true });
    return;
  }
  const status = submission.status === "approved" ? "Aprovado" : submission.status === "rejected" ? "Recusado" : "Pendente";
  await interaction.reply({ content: `Status: **${status}**\nCriado: <t:${Math.floor(new Date(submission.createdAt ?? Date.now()).getTime() / 1000)}:F>${submission.rejectionReason ? `\nMotivo: ${submission.rejectionReason}` : ""}`, ephemeral: true });
}

async function showSubmissionDetails(interaction: ButtonInteraction) {
  const content = interaction.message.components.length ? "Os dados completos estao exibidos no painel desta solicitacao." : "Detalhes indisponiveis.";
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

function createPanelPayload(settings: ManualRegistrationSettings) {
  const imageUrl = resolveImageUrl(settings.panelImage?.imageUrl ?? null);
  const imagePosition = imageUrl ? settings.panelImage?.imagePosition ?? settings.bannerPosition : "none";
  const thumbnailUrl = resolveImageUrl(settings.thumbnailUrl ?? null);
  const availableSets = settings.setRoles.filter((item) => item.enabled && item.requestable).length;
  const components: unknown[] = [];
  const blockComponents = renderPanelBlocks(settings.panelImage?.blocks ?? []);
  if (blockComponents.length) components.push(...blockComponents);
  if (!blockComponents.length && imageUrl && ["top", "banner"].includes(imagePosition)) components.push(mediaGallery(imageUrl));
  const panelName = settings.title?.trim() || settings.name?.trim() || "Pedido de Set";
  const introText = settings.description?.trim() || "Preencha seu cadastro para liberar o acesso.";
  const heading = {
    type: 10,
    content: [
      replaceSystemEmojis(`# ${settings.emoji ? `${settings.emoji} ` : `${systemEmojiText("prancheta_caneta")} `}${panelName}`),
      introText
    ].join("\n\n")
  };
  const sideImageUrl = imageUrl && ["thumbnail", "side"].includes(imagePosition) ? imageUrl : thumbnailUrl;
  components.push(sideImageUrl ? {
    type: 9,
    components: [{
      type: 10,
      content: heading.content
    }],
    accessory: { type: 11, media: { url: sideImageUrl } }
  } : heading);
  if (!blockComponents.length && imageUrl && ["below_title", "below_text"].includes(imagePosition)) components.push(mediaGallery(imageUrl));
  components.push({ type: 14, divider: false, spacing: 1 });
  if (!blockComponents.length && imageUrl && imagePosition === "middle") components.push(mediaGallery(imageUrl));
  components.push({
    type: 10,
    content: [
      replaceSystemEmojis(`### ${settings.emoji ? "" : `${systemEmojiText("prancheta")} `}Antes de começar`),
      `- Tenha em mãos ${registrationFieldSummary(settings)}.`,
      "- Revise os dados antes de enviar.",
      availableSets > 1 ? `- Escolha um dos ${availableSets} sets disponíveis.` : "- Confirme o set disponível."
    ].join("\n")
  });
  components.push({ type: 14, divider: false, spacing: 1 });
  components.push({
    type: 10,
    content: [
      "### Iniciar formulário",
      "Clique no botão abaixo para continuar."
    ].join("\n")
  });
  if (!blockComponents.length && imageUrl && ["before_buttons", "above_buttons", "bottom"].includes(imagePosition)) components.push(mediaGallery(imageUrl));
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:start`).setEmoji(normalizeComponentEmoji(settings.emoji) ?? systemComponentEmoji("prancheta_caneta")).setLabel("Iniciar Registro").setStyle(ButtonStyle.Secondary)
  ));
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: settings.footerText ? replaceSystemEmojis(`-# ${settings.footerText}`) : "-# Todos os direitos reservados" });
  return {
    allowedMentions: { parse: [] as never[] },
    components: [buildV2Container({
      accentColor: parseColor(settings.color),
      components,
      footer: imageUrl && imagePosition === "footer" ? { image: imageUrl, text: settings.footerText ?? "© NexTech Systems" } : undefined
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

function createReviewPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission) {
  const statusText = submission.status === "approved" ? "Aprovado" : submission.status === "rejected" ? submission.rejectionReason?.startsWith("Cancelado") ? "Cancelado" : "Recusado" : "Pendente";
  const imageUrl = resolveImageUrl(settings.panelImage?.imageUrl ?? null);
  const content: Array<Record<string, unknown>> = [
    { type: 10, content: replaceSystemEmojis(`# ${settings.emoji ?? systemEmojiText("prancheta_caneta")} Pedido de Set`) },
    { type: 10, content: `Usuario: <@${submission.userId}>\nID: ${submission.userId}\nSet solicitado: ${submission.requestedRoleId ? `<@&${submission.requestedRoleId}>` : "Padrao"}\nData: <t:${Math.floor(new Date(submission.createdAt ?? Date.now()).getTime() / 1000)}:F>\nStatus: **${statusText}**` },
    { type: 14 },
    { type: 10, content: submission.fields.map((field) => `**${field.label}:** ${field.value}`).join("\n").slice(0, 3500) }
  ];
  if (submission.rejectionReason) content.push({ type: 10, content: `**Motivo da recusa:** ${submission.rejectionReason}` });
  if (imageUrl) content.push(mediaGallery(imageUrl));
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      { type: 17, accent_color: parseColor(settings.color), components: content },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("visto")).setLabel("Aprovar").setStyle(ButtonStyle.Success).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("exclamacao")).setLabel("Recusar").setStyle(ButtonStyle.Danger).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:view:${submission.id}`).setEmoji(systemComponentEmoji("prancheta")).setLabel("Ver Detalhes").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:edit_set:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("prancheta_caneta")).setLabel("Editar Set").setStyle(ButtonStyle.Secondary).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${submission.id}:${submission.userId}`).setEmoji(systemComponentEmoji("porta")).setLabel("Cancelar").setStyle(ButtonStyle.Secondary).setDisabled(submission.status !== "pending")
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendActionLog(guild: Guild, settings: ManualRegistrationSettings, text: string) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({ components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# ${systemEmojiText("prancheta")} Log de Pedido de Set\n${text}\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }] }], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
}

async function linkApprovedSetToGoals(context: BotContext, guild: Guild, userId: string, username: string, submissionId: string) {
  const goalSettings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  if (!goalSettings?.enabled) {
    await context.api.postLog({ guildId: guild.id, message: "Pedido de Set aprovado sem canal de meta: sistema de metas desativado ou indisponivel.", metadata: { submissionId }, type: "manual-registration.goal_link_skipped", userId }).catch(() => null);
    return null;
  }
  if (!goalSettings.autoCreateWithManualRegistration) {
    await context.api.postLog({ guildId: guild.id, message: "Pedido de Set aprovado sem canal de meta: vinculo automatico desativado.", metadata: { submissionId }, type: "manual-registration.goal_link_disabled", userId }).catch(() => null);
    return null;
  }
  const channelId = await ensureFivemGoalChannelForUser(context, guild, userId, username).catch(() => null);
  await context.api.postLog({ guildId: guild.id, message: channelId ? "Pedido de Set vinculado ao canal individual de meta." : "Nao foi possivel criar o canal individual de meta apos aprovar o set.", metadata: { channelId, submissionId }, type: channelId ? "manual-registration.goal_linked" : "manual-registration.goal_link_failed", userId }).catch(() => null);
  return channelId;
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
  return "Nao foi possivel enviar o pedido de set. Tente novamente em alguns instantes.";
}
