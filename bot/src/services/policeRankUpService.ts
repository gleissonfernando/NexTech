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
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type TextChannel
} from "discord.js";
import { currentRuntimeBotId, isBotModuleEnabled } from "../config/env";
import type { BotCommand, BotContext } from "../types";
import type { PoliceRankUpPanelPublishAck } from "../websocket/socketClient";
import type { PoliceRankUpRank, PoliceRankUpRequest, PoliceRankUpSettings } from "./apiClient";
import { getRuntimeModuleAuthorization, runtimeModuleDenialMessage } from "./runtimeModuleGuard";
import { systemComponentEmoji, systemEmojiText } from "./systemEmojiService";

const MODULE_ID = "police-rank-up";
const PREFIX = "police_rank_up";
const SETTINGS_TTL_MS = 30_000;
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";
const settingsCache = new Map<string, { expiresAt: number; settings: PoliceRankUpSettings }>();
let serviceStarted = false;

export const policeRankUpConfigCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("configuracao-up")
    .setDescription("Abre as configurações do sistema policial de UP.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await openConfigPanel(interaction, context);
  }
};

export function startPoliceRankUpService(context: BotContext) {
  if (serviceStarted) return;
  serviceStarted = true;

  context.socket.onPoliceRankUpSettingsUpdated((payload) => {
    if (!sameRuntimeBot(payload.botId)) return;
    clearPoliceRankUpSettingsCache(payload.guildId);
  });

  context.socket.onPoliceRankUpPanelPublish((payload, ack?: PoliceRankUpPanelPublishAck) => {
    if (!sameRuntimeBot(payload.botId)) {
      ack?.({ error: "Evento destinado a outro bot.", ok: false });
      return;
    }

    void publishPanelFromSocket(payload.guildId, context, ack);
  });
}

export function clearPoliceRankUpSettingsCache(guildId?: string | null) {
  if (!guildId) {
    settingsCache.clear();
    return;
  }
  settingsCache.delete(guildId);
}

export async function handlePoliceRankUpInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return false;
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith(`${PREFIX}:`)) return false;
  if (!interaction.guild || !interaction.inCachedGuild()) {
    if (interaction.isRepliable()) await interaction.reply({ content: "Interação inválida.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const authorization = await getRuntimeModuleAuthorization(context, interaction.guild.id, MODULE_ID);
  if (!authorization.allowed) {
    await interaction.reply({ content: runtimeModuleDenialMessage(authorization, "Sistema de UP"), flags: MessageFlags.Ephemeral });
    return true;
  }

  const [, action] = interaction.customId.split(":");
  if (action === "request" && interaction.isStringSelectMenu()) return requestRank(interaction, context);
  if (action === "approve" && interaction.isButton()) return showApprovalConfirmation(interaction, context);
  if (action === "approve_confirm" && interaction.isButton()) return approveRequest(interaction, context);
  if (action === "reject" && interaction.isButton()) return openRejectModal(interaction);
  if (action === "reject_modal" && interaction.isModalSubmit()) return rejectRequest(interaction, context);
  if (action === "cancel" && interaction.isButton()) return cancelRequest(interaction, context);
  if (action === "refresh" && interaction.isButton()) return refreshRequestPanel(interaction, context);
  if (action === "retry" && interaction.isButton()) return approveRequest(interaction, context);
  if (action === "config" && interaction.isButton()) return handleConfigButton(interaction, context);

  return true;
}

async function openConfigPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild || !interaction.inCachedGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getSettings(context, interaction.guild.id);
  const member = interaction.member as GuildMember;
  if (!canManageSettings(member, settings, interaction.guild.ownerId)) {
    await interaction.reply({ content: "Você não possui permissão para acessar as configurações do sistema de UP.", flags: MessageFlags.Ephemeral });
    await context.api.createPoliceRankUpLog({ action: "rank_up.unauthorized_config_access", actorId: interaction.user.id, actorName: interaction.user.username, guildId: interaction.guild.id });
    return;
  }

  await interaction.reply(configPayload(settings, interaction.guild));
}

async function handleConfigButton(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.guild || !interaction.inCachedGuild()) return true;
  const settings = await getSettings(context, interaction.guild.id, true);
  const member = interaction.member as GuildMember;
  if (!canManageSettings(member, settings, interaction.guild.ownerId)) {
    await interaction.reply({ content: "Você não possui permissão para acessar as configurações do sistema de UP.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const target = interaction.customId.split(":")[2];
  if (target === "publish") {
    const messageId = await publishPublicPanel(interaction.guild, context, settings);
    await context.api.savePoliceRankUpSettings(interaction.guild.id, { panelMessageId: messageId }, interaction.user.id).catch(() => null);
    clearPoliceRankUpSettingsCache(interaction.guild.id);
    await interaction.reply({ content: `Painel publicado/atualizado: ${messageId}.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.reply({ content: "Configure canais, patentes e responsáveis pela dashboard em Sistema de UP.", flags: MessageFlags.Ephemeral });
  return true;
}

async function publishPanelFromSocket(guildId: string, context: BotContext, ack?: PoliceRankUpPanelPublishAck) {
  const guild = context.client.guilds.cache.get(guildId);
  if (!guild) {
    ack?.({ error: "Bot não está conectado ao servidor selecionado.", ok: false });
    return;
  }

  try {
    const settings = await getSettings(context, guildId, true);
    const messageId = await publishPublicPanel(guild, context, settings);
    ack?.({ messageId, ok: true });
  } catch (error) {
    ack?.({ error: error instanceof Error ? error.message : String(error), ok: false });
  }
}

async function publishPublicPanel(guild: Guild, context: BotContext, settings: PoliceRankUpSettings) {
  if (!settings.enabled) throw new Error("Sistema de UP desativado.");
  if (!settings.panelChannelId) throw new Error("Canal do painel não configurado.");
  const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Canal do painel inválido ou excluído.");
  const payload = publicPanelPayload(settings, guild);

  if (settings.panelMessageId) {
    const existing = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return existing.id;
    }
  }

  const message = await channel.send(payload);
  await context.api.createPoliceRankUpLog({ action: "rank_up.panel_published", actorId: guild.client.user?.id ?? null, actorName: guild.client.user?.username ?? null, guildId: guild.id, metadata: { channelId: channel.id, messageId: message.id } });
  return message.id;
}

async function requestRank(interaction: Interaction, context: BotContext) {
  if (!interaction.isStringSelectMenu() || !interaction.guild || !interaction.inCachedGuild()) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getSettings(context, interaction.guild.id, true);
  if (!settings.enabled) {
    await interaction.editReply("Sistema de UP desativado neste servidor.");
    return true;
  }

  const rank = activeRanks(settings).find((item) => item.id === interaction.values[0]);
  if (!rank) {
    await interaction.editReply("Patente não encontrada ou desativada.");
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply("Você não está mais no servidor.");
    return true;
  }

  const validation = validateBotRoleAccess(interaction.guild, rank);
  if (validation) {
    await interaction.editReply(validation);
    return true;
  }

  const current = resolveCurrentRank(member, settings);
  const channel = await createRequestChannel(interaction.guild, member, settings, rank).catch(async (error) => {
    const message = errorMessage(error);
    await context.api.createPoliceRankUpLog({ action: "rank_up.channel_create_failed", actorId: interaction.user.id, actorName: interaction.user.username, guildId: interaction.guild!.id, metadata: { error: error instanceof Error ? error.message : String(error), rankId: rank.id } });
    return { error: message, channel: null };
  });
  if (!channel.channel) {
    await interaction.editReply(`Não foi possível criar o canal da solicitação de patente: ${channel.error}`);
    return true;
  }

  let request: PoliceRankUpRequest;
  try {
    request = await context.api.createPoliceRankUpRequest({
      currentRankId: current?.id ?? null,
      currentRoleId: current?.roleId ?? null,
      guildId: interaction.guild.id,
      requestedRankId: rank.id,
      temporaryChannelId: channel.channel.id,
      userDisplayName: member.displayName,
      userId: interaction.user.id,
      username: interaction.user.username
    });
  } catch (error) {
    await channel.channel.delete("Solicitação de UP não persistida").catch(() => null);
    await interaction.editReply(errorMessage(error));
    return true;
  }

  const message = await channel.channel.send(requestPanelPayload(request, settings, interaction.guild)).catch(async (error) => {
    const reason = errorMessage(error);
    await context.api.decidePoliceRankUpRequest(request.id, { actorId: interaction.client.user.id, actorName: interaction.client.user.username, errorReason: reason, result: "error" }).catch(() => null);
    await interaction.editReply(`A solicitação foi registrada, mas não foi possível enviar o painel no canal criado: ${reason}`);
    return null;
  });
  if (!message) return true;
  await context.api.updatePoliceRankUpRequestChannel(request.id, { messageId: message.id, temporaryChannelId: channel.channel.id }).catch(() => null);
  await notifyResponsibles(channel.channel, settings, request);
  await interaction.editReply(`Sua solicitação foi criada: ${channel.channel}. Protocolo ${request.protocol}.`);
  return true;
}

async function showApprovalConfirmation(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.guild || !interaction.inCachedGuild()) return true;
  const request = await requestFromCustomId(interaction, context);
  if (!request) return true;
  const settings = await getSettings(context, interaction.guild.id, true);
  if (!canReview(interaction.member as GuildMember, settings, "approve", interaction.guild.ownerId)) {
    await interaction.reply({ content: "Você não tem permissão para aprovar solicitações de UP.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.reply(approvalConfirmPayload(request, settings, interaction.guild));
  return true;
}

async function approveRequest(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.guild || !interaction.inCachedGuild()) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const request = await requestFromCustomId(interaction, context, false);
  if (!request) {
    await interaction.editReply("Solicitação não encontrada.");
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id, true);
  if (!canReview(interaction.member as GuildMember, settings, "approve", interaction.guild.ownerId)) {
    await interaction.editReply("Você não tem permissão para aprovar solicitações de UP.");
    return true;
  }

  const result = await safelyApplyRank(interaction.guild, request, settings);
  if (!result.ok) {
    await context.api.decidePoliceRankUpRequest(request.id, { actorId: interaction.user.id, actorName: interaction.user.username, errorReason: result.error, result: "error" }).catch(() => null);
    await sendLog(interaction.guild, settings, `# ${icon("perigo", interaction.guild)} Erro na aprovação de UP\n**Usuário:** <@${request.userId}>\n**Protocolo:** ${request.protocol}\n**Erro:** ${result.error}`);
    await interaction.editReply(`Não foi possível aprovar com segurança: ${result.error}`);
    await updateRequestMessage(interaction.guild, context, request.id);
    return true;
  }

  const updated = await context.api.decidePoliceRankUpRequest(request.id, { actorId: interaction.user.id, actorName: interaction.user.username, result: "approved" });
  await sendLog(interaction.guild, settings, approvalLogText(updated, settings, interaction.user.id));
  await notifyUser(interaction.guild, updated, settings, "approved", null);
  await updateRequestMessage(interaction.guild, context, updated.id);
  await interaction.editReply(`Solicitação ${updated.protocol} aprovada.`);
  await scheduleChannelDelete(interaction.guild, updated.temporaryChannelId, settings.approvedDeleteSeconds, settings);
  return true;
}

async function openRejectModal(interaction: Interaction) {
  if (!interaction.isButton()) return true;
  const requestId = interaction.customId.split(":")[2];
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:reject_modal:${requestId}`)
    .setTitle("Recusar solicitação de UP")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo da recusa").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("notes").setLabel("Observação adicional").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
    );
  await interaction.showModal(modal);
  return true;
}

async function rejectRequest(interaction: Interaction, context: BotContext) {
  if (!interaction.isModalSubmit() || !interaction.guild || !interaction.inCachedGuild()) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const request = await requestFromCustomId(interaction, context, false);
  if (!request) {
    await interaction.editReply("Solicitação não encontrada.");
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id, true);
  if (!canReview(interaction.member as GuildMember, settings, "reject", interaction.guild.ownerId)) {
    await interaction.editReply("Você não tem permissão para recusar solicitações de UP.");
    return true;
  }
  const reason = interaction.fields.getTextInputValue("reason").trim();
  const notes = interaction.fields.getTextInputValue("notes").trim();
  const updated = await context.api.decidePoliceRankUpRequest(request.id, { actorId: interaction.user.id, actorName: interaction.user.username, reason: notes ? `${reason}\n${notes}` : reason, result: "rejected" });
  await sendLog(interaction.guild, settings, `# ${icon("porta", interaction.guild)} Solicitação de UP recusada\n**Usuário:** <@${updated.userId}>\n**Patente solicitada:** ${rankName(settings, updated.requestedRankId)}\n**Analisado por:** <@${interaction.user.id}>\n**Motivo:** ${reason}\n**Protocolo:** ${updated.protocol}`);
  await notifyUser(interaction.guild, updated, settings, "rejected", reason);
  await updateRequestMessage(interaction.guild, context, updated.id);
  await interaction.editReply(`Solicitação ${updated.protocol} recusada.`);
  await scheduleChannelDelete(interaction.guild, updated.temporaryChannelId, settings.rejectedDeleteSeconds, settings);
  return true;
}

async function cancelRequest(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.guild || !interaction.inCachedGuild()) return true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const request = await requestFromCustomId(interaction, context, false);
  if (!request) {
    await interaction.editReply("Solicitação não encontrada.");
    return true;
  }
  const settings = await getSettings(context, interaction.guild.id, true);
  const member = interaction.member as GuildMember;
  const requesterCancel = settings.allowRequesterCancel && interaction.user.id === request.userId;
  if (!requesterCancel && !canReview(member, settings, "cancel", interaction.guild.ownerId)) {
    await interaction.editReply("Você não tem permissão para cancelar solicitações de UP.");
    return true;
  }
  const updated = await context.api.decidePoliceRankUpRequest(request.id, { actorId: interaction.user.id, actorName: interaction.user.username, reason: "Solicitação cancelada.", result: "cancelled" });
  await updateRequestMessage(interaction.guild, context, updated.id);
  await interaction.editReply(`Solicitação ${updated.protocol} cancelada.`);
  await scheduleChannelDelete(interaction.guild, updated.temporaryChannelId, settings.rejectedDeleteSeconds, settings);
  return true;
}

async function refreshRequestPanel(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.guild) return true;
  const requestId = interaction.customId.split(":")[2];
  if (!requestId) {
    await interaction.reply({ content: "Solicitação não encontrada.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await updateRequestMessage(interaction.guild, context, requestId);
  await interaction.reply({ content: "Dados atualizados.", flags: MessageFlags.Ephemeral });
  return true;
}

async function safelyApplyRank(guild: Guild, request: PoliceRankUpRequest, settings: PoliceRankUpSettings) {
  const member = await guild.members.fetch(request.userId).catch(() => null);
  if (!member) return { error: "Usuário não está mais no servidor.", ok: false as const };
  const targetRank = settings.ranks.find((rank) => rank.id === request.requestedRankId);
  if (!targetRank?.roleId) return { error: "Patente solicitada não possui cargo configurado.", ok: false as const };
  const accessError = validateBotRoleAccess(guild, targetRank);
  if (accessError) return { error: accessError, ok: false as const };

  const rankRoleIds = new Set(settings.ranks.map((rank) => rank.roleId).filter(Boolean));
  const oldRoleIds = member.roles.cache.filter((role) => rankRoleIds.has(role.id) && role.id !== targetRank.roleId).map((role) => role.id);
  await member.roles.add(targetRank.roleId, `UP policial aprovado: ${request.protocol}`);
  const refreshed = await guild.members.fetch(request.userId);
  if (!refreshed.roles.cache.has(targetRank.roleId)) return { error: "Discord não confirmou a atribuição do novo cargo.", ok: false as const };
  if (oldRoleIds.length) await refreshed.roles.remove(oldRoleIds, `Removendo patentes antigas após UP ${request.protocol}`);
  return { ok: true as const };
}

function publicPanelPayload(settings: PoliceRankUpSettings, guild: Guild) {
  const ranks = activeRanks(settings).slice(0, 25);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:request`)
    .setPlaceholder("Escolha a patente para solicitar seu UP")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(ranks.map((rank) => ({
      description: (rank.description || `Posição ${rank.hierarchyPosition}`).slice(0, 100),
      emoji: rank.emoji || undefined,
      label: rank.name.slice(0, 100),
      value: rank.id
    })));

  return {
    components: [{
      type: 17,
      accent_color: 0xfacc15,
      components: [
        { type: 10, content: `# ${icon("trofeu", guild)} PAINEL DE SOLICITAÇÃO DE UP\n${DIVIDER}\n\n${settings.panelMessage}` },
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  } as const;
}

function requestPanelPayload(request: PoliceRankUpRequest, settings: PoliceRankUpSettings, guild: Guild) {
  const currentRank = request.currentRankId ? rankName(settings, request.currentRankId) : "Nenhuma patente identificada";
  const requestedRank = rankName(settings, request.requestedRankId);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:approve:${request.id}`).setLabel("Aprovar solicitação").setEmoji(systemComponentEmoji("visto", guild)).setStyle(ButtonStyle.Success).setDisabled(request.status !== "pending"),
    new ButtonBuilder().setCustomId(`${PREFIX}:reject:${request.id}`).setLabel("Recusar solicitação").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Danger).setDisabled(request.status !== "pending"),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${request.id}`).setLabel("Cancelar solicitação").setEmoji(systemComponentEmoji("perigo", guild)).setStyle(ButtonStyle.Secondary).setDisabled(request.status !== "pending"),
    new ButtonBuilder().setCustomId(`${PREFIX}:refresh:${request.id}`).setLabel("Atualizar dados").setEmoji(systemComponentEmoji("relogio", guild)).setStyle(ButtonStyle.Primary)
  );
  const retry = request.status === "error"
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:retry:${request.id}`).setLabel("Tentar novamente").setEmoji(systemComponentEmoji("relogio", guild)).setStyle(ButtonStyle.Danger))
    : null;

  return {
    components: [{
      type: 17,
      accent_color: request.status === "approved" ? 0x22c55e : request.status === "rejected" ? 0xef4444 : request.status === "error" ? 0xf97316 : 0xfacc15,
      components: [
        { type: 10, content: `# ${icon("prancheta", guild)} SOLICITAÇÃO DE PATENTE\n${DIVIDER}\n\n**Solicitante:** <@${request.userId}>\n**Nome no servidor:** ${request.userDisplayName}\n**Usuário:** ${request.username}\n**ID do Discord:** ${request.userId}\n\n**Patente atual:** ${currentRank}\n**Cargo atual:** ${request.currentRoleId ? `<@&${request.currentRoleId}>` : "não identificado"}\n**Patente solicitada:** ${requestedRank}\n**Cargo que será atribuído:** <@&${request.requestedRoleId}>\n\n**Status:** ${statusLabel(request.status)}\n**Protocolo:** ${request.protocol}\n**Data:** <t:${Math.floor(Date.parse(request.createdAt) / 1000)}:F>${request.reviewReason ? `\n\n**Motivo:** ${request.reviewReason}` : ""}${request.errorReason ? `\n\n**Erro:** ${request.errorReason}` : ""}` },
        buttons,
        ...(retry ? [retry] : [])
      ]
    }],
    flags: MessageFlags.IsComponentsV2
  } as const;
}

function configPayload(settings: PoliceRankUpSettings, guild: Guild) {
  return {
    components: [{
      type: 17,
      accent_color: 0xfacc15,
      components: [
        { type: 10, content: `# ${icon("engrenagem", guild)} Sistema de UP\n${DIVIDER}\n\n**Status:** ${settings.enabled ? "Ativo" : "Desativado"}\n**Patentes:** ${settings.ranks.length}\n**Canal do painel:** ${settings.panelChannelId ? `<#${settings.panelChannelId}>` : "não configurado"}\n**Categoria temporária:** ${settings.temporaryCategoryId ?? "não configurada"}\n**Logs:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : "não configurado"}\n\nUse a dashboard para cadastrar patentes, cargos, canais e responsáveis.` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:config:publish`).setLabel("Publicar painel").setEmoji(systemComponentEmoji("caixa", guild)).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:config:dashboard`).setLabel("Abrir pela dashboard").setEmoji(systemComponentEmoji("link", guild)).setStyle(ButtonStyle.Secondary)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as const;
}

function approvalConfirmPayload(request: PoliceRankUpRequest, settings: PoliceRankUpSettings, guild: Guild) {
  return {
    components: [{
      type: 17,
      accent_color: 0x22c55e,
      components: [
        { type: 10, content: `# ${icon("visto", guild)} Confirmar aprovação\n\n**Usuário:** <@${request.userId}>\n**Patente atual:** ${request.currentRankId ? rankName(settings, request.currentRankId) : "não identificada"}\n**Patente nova:** ${rankName(settings, request.requestedRankId)}\n**Cargo removido:** ${request.currentRoleId ? `<@&${request.currentRoleId}>` : "patentes antigas detectadas"}\n**Cargo adicionado:** <@&${request.requestedRoleId}>` },
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:approve_confirm:${request.id}`).setLabel("Confirmar aprovação").setEmoji(systemComponentEmoji("visto", guild)).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${PREFIX}:refresh:${request.id}`).setLabel("Voltar").setEmoji(systemComponentEmoji("porta", guild)).setStyle(ButtonStyle.Secondary)
        )
      ]
    }],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
  } as const;
}

async function createRequestChannel(guild: Guild, member: GuildMember, settings: PoliceRankUpSettings, rank: PoliceRankUpRank) {
  if (!settings.temporaryCategoryId) throw new Error("Categoria temporária não configurada.");
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const category = await guild.channels.fetch(settings.temporaryCategoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Categoria temporária inválida ou excluída.");
  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) throw new Error("O bot não possui permissão Gerenciar Canais.");
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ...settings.responsibleUserIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ...settings.adminUserIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ...[...settings.responsibleRoleIds, ...settings.adminRoleIds]
      .filter((id) => guild.roles.cache.has(id))
      .map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
  ];
  const channel = await guild.channels.create({
    name: channelName(settings, member, rank),
    parent: category.id,
    permissionOverwrites: overwrites,
    reason: "Solicitação de UP policial",
    type: ChannelType.GuildText
  });
  return { channel };
}

async function updateRequestMessage(guild: Guild, context: BotContext, requestId: string) {
  const request = await context.api.getPoliceRankUpRequest(requestId);
  const settings = await getSettings(context, guild.id, true);
  if (!request.temporaryChannelId || !request.messageId) return;
  const channel = await guild.channels.fetch(request.temporaryChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const message = await channel.messages.fetch(request.messageId).catch(() => null);
  if (message) await message.edit(requestPanelPayload(request, settings, guild));
}

async function requestFromCustomId(interaction: Interaction, context: BotContext, replyOnError = true) {
  const requestId = "customId" in interaction ? String(interaction.customId).split(":")[2] : "";
  const request = requestId ? await context.api.getPoliceRankUpRequest(requestId).catch(() => null) : null;
  if (!request && replyOnError && interaction.isRepliable()) {
    await interaction.reply({ content: "Solicitação não encontrada.", flags: MessageFlags.Ephemeral });
  }
  return request;
}

async function getSettings(context: BotContext, guildId: string, force = false) {
  const cached = settingsCache.get(guildId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.settings;
  const settings = await context.api.getPoliceRankUpSettings(guildId);
  settingsCache.set(guildId, { expiresAt: Date.now() + SETTINGS_TTL_MS, settings });
  return settings;
}

function activeRanks(settings: PoliceRankUpSettings) {
  return settings.ranks.filter((rank) => rank.enabled && rank.roleId).sort((a, b) => a.hierarchyPosition - b.hierarchyPosition);
}

function resolveCurrentRank(member: GuildMember, settings: PoliceRankUpSettings) {
  return activeRanks(settings).filter((rank) => member.roles.cache.has(rank.roleId)).sort((a, b) => b.hierarchyPosition - a.hierarchyPosition)[0] ?? null;
}

function validateBotRoleAccess(guild: Guild, rank: PoliceRankUpRank) {
  const role = guild.roles.cache.get(rank.roleId);
  if (!role) return "O cargo vinculado à patente não existe.";
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "O bot não possui permissão Gerenciar Cargos.";
  if (role.position >= me.roles.highest.position) return "O cargo da patente precisa estar abaixo do cargo principal do bot.";
  return null;
}

function canManageSettings(member: GuildMember, settings: PoliceRankUpSettings, ownerId: string) {
  if (member.id === ownerId || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return settings.adminUserIds.includes(member.id)
    || settings.responsibleUserIds.includes(member.id)
    || settings.adminRoleIds.some((id) => member.roles.cache.has(id))
    || settings.responsibleRoleIds.some((id) => member.roles.cache.has(id));
}

function canReview(member: GuildMember, settings: PoliceRankUpSettings, action: "approve" | "reject" | "cancel", ownerId: string) {
  if (canManageSettings(member, settings, ownerId)) return true;
  return permissionAllowed(settings.permissions.users[member.id], action)
    || member.roles.cache.some((role) => permissionAllowed(settings.permissions.roles[role.id], action));
}

function permissionAllowed(values: string[] | undefined, action: string) {
  return values?.includes(action) || values?.includes("manage_ranks") || false;
}

async function notifyResponsibles(channel: TextChannel, settings: PoliceRankUpSettings, request: PoliceRankUpRequest) {
  if (!settings.mentionResponsibles) return;
  const mentions = [...settings.responsibleUserIds.map((id) => `<@${id}>`), ...settings.responsibleRoleIds.map((id) => `<@&${id}>`)];
  if (!mentions.length) return;
  await channel.send({ allowedMentions: { roles: settings.responsibleRoleIds, users: settings.responsibleUserIds }, content: `${mentions.join(" ")} nova solicitação de UP: ${request.protocol}` }).catch(() => null);
}

async function notifyUser(guild: Guild, request: PoliceRankUpRequest, settings: PoliceRankUpSettings, result: "approved" | "rejected", reason: string | null) {
  if (!settings.notifyByDm) return;
  const user = await guild.client.users.fetch(request.userId).catch(() => null);
  if (!user) return;
  const text = result === "approved"
    ? `Sua solicitação de patente foi aprovada.\n\nPatente atribuída: ${rankName(settings, request.requestedRankId)}\nProtocolo: ${request.protocol}`
    : `Sua solicitação de patente foi recusada.\n\nPatente solicitada: ${rankName(settings, request.requestedRankId)}\nMotivo: ${reason ?? "Não informado."}\nProtocolo: ${request.protocol}`;
  await user.send(text).catch(() => null);
}

async function sendLog(guild: Guild, settings: PoliceRankUpSettings, content: string) {
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await channel.send({ components: [{ type: 17, accent_color: 0xfacc15, components: [{ type: 10, content }] }], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
}

async function scheduleChannelDelete(guild: Guild, channelId: string | null, seconds: number, settings: PoliceRankUpSettings) {
  if (!settings.autoDeleteChannels || !channelId) return;
  setTimeout(() => {
    void (async () => {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel && "delete" in channel) await channel.delete("Solicitação de UP finalizada").catch(() => null);
    })();
  }, Math.max(0, seconds) * 1000).unref();
}

function approvalLogText(request: PoliceRankUpRequest, settings: PoliceRankUpSettings, actorId: string) {
  return `# SOLICITAÇÃO DE UP APROVADA\n\n**Usuário:** <@${request.userId}>\n**ID:** ${request.userId}\n**Patente anterior:** ${request.currentRankId ? rankName(settings, request.currentRankId) : "não identificada"}\n**Patente atribuída:** ${rankName(settings, request.requestedRankId)}\n**Cargo removido:** ${request.currentRoleId ? `<@&${request.currentRoleId}>` : "patentes antigas detectadas"}\n**Cargo adicionado:** <@&${request.requestedRoleId}>\n**Aprovado por:** <@${actorId}>\n**Protocolo:** ${request.protocol}\n**Data:** <t:${Math.floor(Date.now() / 1000)}:F>`;
}

function channelName(settings: PoliceRankUpSettings, member: GuildMember, rank: PoliceRankUpRank) {
  const raw = settings.temporaryChannelName
    .replace(/\{user\}/g, member.displayName)
    .replace(/\{id\}/g, member.id)
    .replace(/\{rank\}/g, rank.name);
  return raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || `up-${member.id}`;
}

function rankName(settings: PoliceRankUpSettings, rankId: string) {
  return settings.ranks.find((rank) => rank.id === rankId)?.name ?? rankId;
}

function statusLabel(status: PoliceRankUpRequest["status"]) {
  return ({ approved: "Aprovada", cancelled: "Cancelada", error: "Erro", pending: "Aguardando análise", rejected: "Recusada" } as const)[status];
}

function icon(key: Parameters<typeof systemEmojiText>[0], guild: Guild) {
  return systemEmojiText(key, guild);
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const data = (error as { response?: { data?: { message?: string } } }).response?.data;
    if (data?.message) return data.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function sameRuntimeBot(botId?: string | null) {
  const runtimeBotId = currentRuntimeBotId();
  return !botId || !runtimeBotId || botId === runtimeBotId;
}

export async function handlePoliceRankUpMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || message.author.bot || !message.guild) return false;
  const request = await context.api.getPoliceRankUpRequestByChannel(message.channelId).catch(() => null);
  if (!request) return false;
  await context.api.createPoliceRankUpLog({ action: "rank_up.ticket_message", actorId: message.author.id, actorName: message.author.username, guildId: message.guild.id, metadata: { attachmentUrls: message.attachments.map((item) => item.url), content: message.content.slice(0, 1500), messageId: message.id }, requestId: request.id }).catch(() => null);
  return false;
}
