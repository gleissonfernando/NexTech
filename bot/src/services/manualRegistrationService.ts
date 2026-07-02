import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
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
import { env } from "../config/env";
import type { BotContext } from "../types";
import type { ManualRegistrationSettings, ManualRegistrationSubmission } from "./apiClient";
import { ensureFivemGoalChannelForUser } from "./fivemGoalService";

const PREFIX = "manual_registration";

export function startManualRegistrationService(client: Client<true>, context: BotContext) {
  context.socket.onManualRegistrationPanelPublish((payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void publishConfiguredPanel(guild, context);
  });
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
  const configured = settings.panelChannelId
    ? await interaction.guild.channels.fetch(settings.panelChannelId).catch(() => null)
    : null;
  const channel = configured?.isSendable() ? configured : interaction.channel?.isSendable() ? interaction.channel : null;
  if (!channel) {
    await interaction.reply({ content: "Configure um canal valido para o painel.", ephemeral: true });
    return;
  }
  const message = await channel.send(createPanelPayload(settings));
  await context.api.saveManualRegistrationSettings(interaction.guild.id, { panelChannelId: channel.id, panelMessageId: message.id });
  await interaction.reply({ content: `Painel de Pedido de Set publicado em <#${channel.id}>.`, ephemeral: true });
}

async function publishConfiguredPanel(guild: Guild, context: BotContext) {
  const settings = await context.api.getManualRegistrationSettings(guild.id);
  if (!settings.enabled || !settings.panelChannelId) return;
  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  let message = settings.panelMessageId && "messages" in channel ? await channel.messages.fetch(settings.panelMessageId).catch(() => null) : null;
  if (message) await message.edit(createPanelPayload(settings));
  else message = await channel.send(createPanelPayload(settings));
  await context.api.saveManualRegistrationSettings(guild.id, { panelMessageId: message.id });
}

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
  await interaction.showModal(modal);
}

export async function handleManualRegistrationInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

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
  const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}:edit_set_select:${id}:${userId}`).setPlaceholder("Selecione o novo set").addOptions(roles.slice(0, 25).map((item) => ({ label: item.name, value: item.roleId, description: item.description?.slice(0, 100) || undefined, emoji: item.emoji || undefined })));
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
  const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, guildId: interaction.guild.id, id, rejectionReason: "Cancelado pela equipe responsavel.", status: "rejected" });
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
      .addOptions(roles.slice(0, 25).map((item) => ({ description: item.description?.slice(0, 100) || undefined, emoji: item.emoji || undefined, label: item.name.slice(0, 100), value: item.roleId })));
    await interaction.reply({ components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], ephemeral: true });
    return;
  }
  await showRegistrationModal(interaction, context, roles[0]?.roleId ?? settings.autoRoleIds[0] ?? null);
}

async function showRegistrationModal(interaction: ButtonInteraction | StringSelectMenuInteraction, context: BotContext, requestedRoleId: string | null) {
  if (!interaction.guildId) return;
  const settings = await context.api.getManualRegistrationSettings(interaction.guildId);
  const fields = settings.fields.slice(0, 5);
  if (!fields.length) {
    await interaction.reply({ content: "Nenhum campo foi configurado para o pedido.", ephemeral: true });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${requestedRoleId ?? "default"}`)
    .setTitle((settings.name || "Pedido de Set").slice(0, 45));
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

async function handleRegistrationSubmit(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const settings = await context.api.getManualRegistrationSettings(interaction.guild.id);
  const requestedRoleId = interaction.customId.split(":")[2] === "default" ? null : interaction.customId.split(":")[2] ?? null;
  const fields = settings.fields.slice(0, 5).map((field) => ({ id: field.id, label: field.label, value: interaction.fields.getTextInputValue(field.id) || "-" }));
  let submission = await context.api.createManualRegistrationSubmission({ fields, guildId: interaction.guild.id, requestedRoleId, userAvatar: interaction.user.displayAvatarURL(), userId: interaction.user.id, username: interaction.user.tag });
  let automaticError: string | null = null;
  if (settings.automaticApproval) {
    try {
      const member = await assignSetRoles(interaction.guild, settings, submission);
      submission = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.client.user.id, guildId: interaction.guild.id, id: submission.id, status: "approved" });
      if (settings.dmNotifications) await member.send(settings.approvalMessage).catch(() => null);
      await linkApprovedSetToGoals(context, interaction.guild, submission.userId, member.user.username, submission.id);
      await sendActionLog(interaction.guild, settings, `Pedido aprovado automaticamente\nUsuario: <@${submission.userId}>\nSet: ${submission.requestedRoleId ? `<@&${submission.requestedRoleId}>` : "padrao"}`);
    } catch (error) {
      automaticError = error instanceof Error ? error.message : "Nao foi possivel aplicar o cargo automaticamente.";
      await context.api.postLog({ guildId: interaction.guild.id, message: automaticError, metadata: { submissionId: submission.id }, type: "manual-registration.auto_approval_failed", userId: interaction.user.id }).catch(() => null);
    }
  }
  const approvalChannel = settings.approvalChannelId ? await interaction.guild.channels.fetch(settings.approvalChannelId).catch(() => null) : null;
  if (!approvalChannel?.isSendable()) {
    await interaction.editReply("O pedido foi salvo, mas o canal de analise nao esta configurado. Avise a administracao.");
    return;
  }
  const message = await approvalChannel.send(createReviewPayload(settings, submission));
  await context.api.updateManualRegistrationSubmissionMessage(submission.id, message.id).catch(() => null);
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
  const roleIds = [...new Set([...(settings.autoRoleIds ?? []), ...(submission?.requestedRoleId ? [submission.requestedRoleId] : [])])];
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
  const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, guildId: interaction.guild.id, id, status: "approved" });
  await context.api.postLog({ guildId: interaction.guild.id, message: "Cargo do Pedido de Set entregue.", metadata: { roleIds, submissionId: id }, type: "manual-registration.role_delivered", userId: saved.userId }).catch(() => null);
  if (settings.dmNotifications) await member.send(settings.approvalMessage).catch(() => null);
  await linkApprovedSetToGoals(context, interaction.guild, saved.userId, member.user.username, saved.id);
  await interaction.message.edit(createReviewPayload(settings, saved)).catch(() => null);
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
  const saved = await context.api.reviewManualRegistrationSubmission({ actorId: interaction.user.id, guildId: interaction.guild.id, id, rejectionReason: reason, status: "rejected" });
  await context.api.postLog({ guildId: interaction.guild.id, message: "Pedido de Set recusado.", metadata: { reason, submissionId: id }, type: "manual-registration.rejected", userId: saved.userId }).catch(() => null);
  const member = await interaction.guild.members.fetch(saved.userId).catch(() => null);
  if (member && settings.dmNotifications) await member.send(`${settings.rejectionMessage}\n\nMotivo: ${reason}`).catch(() => null);
  if (interaction.message) await interaction.message.edit(createReviewPayload(settings, saved)).catch(() => null);
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
  const components: Array<Record<string, unknown>> = [];
  if (imageUrl && ["top", "banner"].includes(imagePosition)) components.push(mediaGallery(imageUrl));
  const heading = {
    type: 10,
    content: [
      `# ${settings.emoji ? `${settings.emoji} ` : ""}${settings.title}`,
      settings.description || "Solicite seu set de forma rapida e acompanhe a analise da equipe."
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
  if (imageUrl && ["below_title", "below_text"].includes(imagePosition)) components.push(mediaGallery(imageUrl));
  components.push({ type: 14, divider: true, spacing: 1 });
  if (imageUrl && imagePosition === "middle") components.push(mediaGallery(imageUrl));
  components.push({
    type: 10,
    content: [
      "### Como funciona",
      "`1` Clique em **Solicitar Set**.",
      availableSets > 1 ? "`2` Escolha o set que deseja receber." : "`2` Confirme o set disponivel.",
      "`3` Preencha o formulario com seus dados.",
      "`4` Acompanhe o resultado em **Meu Status**."
    ].join("\n")
  });
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({
    type: 10,
    content: [
      "### Informacoes importantes",
      `> **Sets disponiveis:** ${availableSets || "definido pela equipe"}`,
      "> **Analise:** realizada pela equipe responsavel",
      settings.cooldownMinutes > 0 ? `> **Novo pedido:** liberado apos ${settings.cooldownMinutes} minuto(s)` : "> **Novo pedido:** sem tempo de espera",
      "",
      settings.footerText ? `-# ${settings.footerText}` : "-# Preencha os dados corretamente para evitar atrasos na analise."
    ].join("\n")
  });
  if (imageUrl && ["before_buttons", "above_buttons", "bottom", "footer"].includes(imagePosition)) components.push(mediaGallery(imageUrl));
  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      { type: 17, accent_color: parseColor(settings.color), components },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:start`).setEmoji("📝").setLabel("Solicitar Set").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:status`).setEmoji("🔎").setLabel("Meu Status").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:help`).setEmoji("❔").setLabel("Como funciona").setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function createReviewPayload(settings: ManualRegistrationSettings, submission: ManualRegistrationSubmission) {
  const statusText = submission.status === "approved" ? "Aprovado" : submission.status === "rejected" ? submission.rejectionReason?.startsWith("Cancelado") ? "Cancelado" : "Recusado" : "Pendente";
  const imageUrl = resolveImageUrl(settings.panelImage?.imageUrl ?? null);
  const content: Array<Record<string, unknown>> = [
    { type: 10, content: `# ${settings.emoji ?? ""} Pedido de Set` },
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
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${submission.id}:${submission.userId}`).setLabel("Aprovar").setStyle(ButtonStyle.Success).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${submission.id}:${submission.userId}`).setLabel("Recusar").setStyle(ButtonStyle.Danger).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:view:${submission.id}`).setLabel("Ver Detalhes").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${PREFIX}:edit_set:${submission.id}:${submission.userId}`).setLabel("Editar Set").setStyle(ButtonStyle.Secondary).setDisabled(submission.status !== "pending"),
        new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${submission.id}:${submission.userId}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary).setDisabled(submission.status !== "pending")
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

async function sendActionLog(guild: Guild, settings: ManualRegistrationSettings, text: string) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({ components: [{ type: 17, accent_color: parseColor(settings.color), components: [{ type: 10, content: `# Log de Pedido de Set\n${text}\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }] }], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
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
