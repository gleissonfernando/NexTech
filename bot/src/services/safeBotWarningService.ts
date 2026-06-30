import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction
} from "discord.js";
import type { SafeBotWarningLevel, SafeBotWarningRecord, SafeBotWarningSettings } from "./apiClient";
import type { BotContext } from "../types";
import type { Message } from "discord.js";

const PREFIX = "safe_warning";
const confirmations = new Map<string, { guildId: string; userId: string; reason: string; staffId: string; expiresAt: number }>();

export async function applyAutomaticSafeBotInfraction(
  message: Message,
  context: BotContext,
  rule: { id: string; name: string; reason: string }
) {
  const guild = message.guild;
  if (!guild) return null;
  const settings = await context.api.getSafeBotWarningSettings(guild.id);
  if (!settings.enabled || !settings.levels.some((level) => level.enabled)) return null;
  const target = await guild.members.fetch(message.author.id).catch(() => null);
  const botMember = guild.members.me;
  if (!target || !botMember) return null;

  const warning = await context.api.issueSafeBotWarning(guild.id, {
    userId: target.id,
    username: target.user.tag,
    staffId: botMember.id,
    staffName: botMember.user.tag,
    reason: rule.reason,
    idempotencyKey: `message:${message.id}:${rule.id}`,
    channelId: message.channelId,
    ruleId: rule.id,
    ruleName: rule.name
  });
  const outcome = await executeConfiguredAction(warning, settings, target, botMember);
  const completed = warning.status === "pending"
    ? await context.api.completeSafeBotWarning(guild.id, warning.id, outcome)
    : warning;
  await sendWarningLog(completed, settings, target, botMember);
  return completed;
}

export async function prepareSafeBotWarning(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Este comando só pode ser usado dentro de um servidor.", ephemeral: true });
    return;
  }
  const targetUser = interaction.options.getUser("usuario", true);
  const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  const staff = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!target || !staff) {
    await interaction.reply({ content: "Não foi possível carregar o membro selecionado.", ephemeral: true });
    return;
  }
  if (target.id === interaction.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "Donos do servidor e administradores não podem receber advertências do Safe Bot.", ephemeral: true });
    return;
  }
  const settings = await context.api.getSafeBotWarningSettings(interaction.guild.id);
  if (!settings.enabled || !settings.levels.length) {
    await interaction.reply({ content: "O sistema de advertências está desativado ou não possui níveis configurados.", ephemeral: true });
    return;
  }
  if (!staff.permissions.has(PermissionFlagsBits.ModerateMembers) && !settings.authorizedRoleIds.some((roleId) => staff.roles.cache.has(roleId))) {
    await interaction.reply({ content: "Você não tem permissão para aplicar advertências do Safe Bot.", ephemeral: true });
    return;
  }
  const preview = await context.api.getSafeBotWarningPreview(interaction.guild.id, target.id);
  if (preview.blocked) {
    await interaction.reply({ content: preview.note ?? "Novas advertências estão bloqueadas pela regra de excedente configurada.", ephemeral: true });
    return;
  }
  const reason = interaction.options.getString("motivo")?.trim() || preview.level?.defaultReason || "Nenhum motivo informado.";
  const confirmationId = randomUUID();
  confirmations.set(confirmationId, { guildId: interaction.guild.id, userId: target.id, reason, staffId: interaction.user.id, expiresAt: Date.now() + 5 * 60_000 });
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("Confirmar advertência do Safe Bot")
    .setDescription([
      `**Usuário:** <@${target.id}>`,
      `**Advertências atuais:** ${preview.currentWarnings}`,
      `**Próxima advertência:** ${preview.nextWarningNumber}`,
      `**Nível:** ${preview.level?.name ?? "Sem nível configurado (apenas registrar)"}`,
      `**Ação configurada:** ${actionLabel(preview.level?.action ?? null)}`,
      `**Motivo:** ${reason}`,
      preview.note ? `**Observação:** ${preview.note}` : ""
    ].filter(Boolean).join("\n"));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${confirmationId}`).setLabel("Confirmar advertência").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${confirmationId}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:history:${confirmationId}`).setLabel("Ver histórico").setStyle(ButtonStyle.Primary)
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

export async function handleSafeBotWarningInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  const [, action, confirmationId] = interaction.customId.split(":");
  const state = confirmationId ? confirmations.get(confirmationId) : null;
  if (!state || state.expiresAt < Date.now()) {
    if (confirmationId) confirmations.delete(confirmationId);
    await interaction.reply({ content: "Esta confirmação de advertência expirou.", ephemeral: true });
    return true;
  }
  if (interaction.user.id !== state.staffId || interaction.guildId !== state.guildId) {
    await interaction.reply({ content: "Apenas o staff que abriu esta confirmação pode usá-la.", ephemeral: true });
    return true;
  }
  if (action === "cancel") {
    confirmations.delete(confirmationId!);
    await interaction.update({ content: "Advertência cancelada. Nenhuma advertência ou ação foi registrada.", embeds: [], components: [] });
    return true;
  }
  if (action === "history") {
    const history = await context.api.getSafeBotWarningHistory(state.guildId, state.userId);
    const lines = history.warnings.slice(0, 10).map((warning) => `#${warning.warningNumber} • ${warning.level?.name ?? "Nível não configurado"} • ${warning.reason} • ${warning.status}`);
    await interaction.reply({ content: lines.length ? lines.join("\n").slice(0, 1900) : "Este usuário não possui histórico de advertências.", ephemeral: true });
    return true;
  }
  if (action !== "confirm") return true;
  confirmations.delete(confirmationId!);
  await interaction.deferUpdate();
  try {
    const guild = interaction.guild;
    if (!guild) throw new Error("Servidor indisponível.");
    const target = await guild.members.fetch(state.userId).catch(() => null);
    const staff = await guild.members.fetch(state.staffId).catch(() => null);
    if (!target || !staff) throw new Error("O membro alvo ou o staff está indisponível.");
    const settings = await context.api.getSafeBotWarningSettings(state.guildId);
    if (!settings.enabled) throw new Error("O sistema de advertências foi desativado antes da confirmação.");
    if (!staff.permissions.has(PermissionFlagsBits.ModerateMembers) && !settings.authorizedRoleIds.some((roleId) => staff.roles.cache.has(roleId))) {
      throw new Error("O staff não tem mais permissão para aplicar advertências.");
    }
    const warning = await context.api.issueSafeBotWarning(state.guildId, {
      userId: target.id,
      username: target.user.tag,
      staffId: staff.id,
      staffName: staff.user.tag,
      reason: state.reason
    });
    const outcome = await executeConfiguredAction(warning, settings, target, staff);
    const completed = warning.status === "pending"
      ? await context.api.completeSafeBotWarning(state.guildId, warning.id, outcome)
      : warning;
    await context.api.recordGlobalBlacklistSafeBotInfraction({
      actionTaken: completed.executedAction ?? completed.configuredAction ?? "record_only",
      actorId: staff.id,
      evidence: {
        warningId: completed.id,
        warningNumber: completed.warningNumber,
        status: completed.status,
        configuredAction: completed.configuredAction,
        executedAction: completed.executedAction,
        error: completed.error
      },
      guildId: state.guildId,
      infractionType: completed.configuredAction ?? "safe_bot_warning",
      reason: completed.reason,
      safeBotModule: "safe-bot",
      userId: target.id
    }).catch((error) => {
      console.warn("[safe-warning] nao foi possivel registrar infracao na Blacklist Global:", error instanceof Error ? error.message : error);
    });
    await sendWarningLog(completed, settings, target, staff);
    await interaction.editReply({
      content: completed.status === "failed"
        ? `Advertência #${completed.warningNumber} registrada, mas nenhuma ação automática foi executada: ${completed.error ?? "falha na verificação da configuração"}`
        : `Advertência #${completed.warningNumber} registrada. Ação: ${completed.executedAction ?? actionLabel(completed.configuredAction)}.`,
      embeds: [],
      components: []
    });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Não foi possível aplicar a advertência.", embeds: [], components: [] });
  }
  return true;
}

async function executeConfiguredAction(warning: SafeBotWarningRecord, settings: SafeBotWarningSettings, target: GuildMember, staff: GuildMember) {
  if (warning.status !== "pending" || !warning.level || !warning.configuredAction) {
    return { success: warning.status !== "failed", executedAction: "Apenas registrada", error: warning.error };
  }
  const level = warning.level;
  const configuredActions = level.actions?.length ? level.actions : [warning.configuredAction];
  const executed: string[] = [];
  try {
    for (const action of configuredActions) {
    if (["timeout", "kick", "ban", "add_role", "remove_role"].includes(action)) assertTargetHierarchy(target);
    if (action === "dm") await target.send(render(level.userMessage, warning, target, staff));
    if (action === "channel_message" || action === "notify_staff") await sendConfiguredChannel(level, render(action === "notify_staff" ? level.staffMessage : level.userMessage, warning, target, staff), target);
    if (action === "add_role") await target.roles.add(level.roleId!, `Advertência Safe Bot #${warning.warningNumber}: ${warning.reason}`);
    if (action === "remove_role") await target.roles.remove(level.roleId!, `Advertência Safe Bot #${warning.warningNumber}: ${warning.reason}`);
    if (action === "timeout") {
      if (!target.moderatable) throw new Error("O bot não pode aplicar timeout neste membro por causa da hierarquia ou permissões do Discord.");
      await target.timeout(level.durationSeconds! * 1000, `Advertência Safe Bot #${warning.warningNumber}: ${warning.reason}`);
    }
    if (action === "kick") {
      if (!target.kickable) throw new Error("O bot não pode expulsar este membro por causa da hierarquia ou permissões do Discord.");
      await target.kick(`Advertência Safe Bot #${warning.warningNumber}: ${warning.reason}`);
    }
    if (action === "ban") {
      if (!target.bannable) throw new Error("O bot não pode banir este membro por causa da hierarquia ou permissões do Discord.");
      await target.ban({ reason: `Advertência Safe Bot #${warning.warningNumber}: ${warning.reason}` });
    }
    if (action === "open_ticket") await openWarningTicket(level, warning, target, staff);
    if (action === "block_channels") {
      for (const channelId of level.targetChannelIds) {
        const channel = await target.guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased() || !("permissionOverwrites" in channel)) throw new Error(`O canal configurado ${channelId} está indisponível.`);
        await channel.permissionOverwrites.edit(target.id, { SendMessages: false, ViewChannel: false }, { reason: `Advertência Safe Bot #${warning.warningNumber}` });
      }
    }
    if (action === "custom") await sendConfiguredChannel(level, render(level.customAction, warning, target, staff), target);
    executed.push(actionLabel(action));
    }
    if (level.userMessage && !configuredActions.includes("dm") && !configuredActions.some((action) => ["kick", "ban"].includes(action))) await target.send(render(level.userMessage, warning, target, staff)).catch(() => null);
    return { success: true, executedAction: executed.join(", "), error: null };
  } catch (error) {
    return { success: false, executedAction: executed.join(", ") || "Nenhuma", error: error instanceof Error ? error.message : String(error) };
  }
}

function assertTargetHierarchy(target: GuildMember) {
  if (target.id === target.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) throw new Error("Donos do servidor e administradores não podem receber esta ação.");
  const me = target.guild.members.me;
  if (!me || target.roles.highest.position >= me.roles.highest.position) throw new Error("O membro alvo está acima ou no mesmo nível do bot na hierarquia de cargos.");
}

async function sendConfiguredChannel(level: SafeBotWarningLevel, content: string, target: GuildMember) {
  const channel = level.channelId ? await target.guild.channels.fetch(level.channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("O canal configurado para esta ação está indisponível.");
  await channel.send({ content, allowedMentions: { parse: [] } });
}

async function openWarningTicket(level: SafeBotWarningLevel, warning: SafeBotWarningRecord, target: GuildMember, staff: GuildMember) {
  if (!target.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) throw new Error("O bot não possui a permissão Gerenciar Canais para abrir um ticket automático.");
  const channel = await target.guild.channels.create({
    name: `warning-${target.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: target.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: `Advertência Safe Bot #${warning.warningNumber}`
  });
  await channel.send({ content: render(level.staffMessage || `Advertência #${warning.warningNumber}: {reason}`, warning, target, staff), allowedMentions: { users: [target.id, staff.id] } });
  if (level.channelId) {
    const staffChannel = await target.guild.channels.fetch(level.channelId).catch(() => null);
    if (staffChannel?.isTextBased() && staffChannel.isSendable()) {
      await staffChannel.send({ content: `Ticket automático de advertência criado: <#${channel.id}>`, allowedMentions: { parse: [] } });
    }
  }
}

async function sendWarningLog(warning: SafeBotWarningRecord, settings: SafeBotWarningSettings, target: GuildMember, staff: GuildMember) {
  const channelId = warning.level?.logChannelId || settings.defaultLogChannelId;
  if (!channelId) return;
  const channel = await target.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;
  const embed = new EmbedBuilder().setColor(warning.status === "failed" ? 0xed4245 : 0xf59e0b).setTitle("⚠️ Nova advertência do Safe Bot").setDescription([
    `**Usuário:** <@${target.id}>`, `**ID:** ${target.id}`, `**Staff:** <@${staff.id}>`,
    `**Advertência:** ${warning.warningNumber}`, `**Nível:** ${warning.level?.name ?? "Nível não configurado"}`,
    `**Motivo:** ${warning.reason}`, `**Ação configurada:** ${actionLabel(warning.configuredAction)}`,
    `**Ação executada:** ${warning.executedAction ?? "Nenhuma"}`, `**Status:** ${warning.status}`,
    warning.error ? `**Erro:** ${warning.error}` : ""
  ].filter(Boolean).join("\n")).setTimestamp(new Date());
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

function render(template: string, warning: SafeBotWarningRecord, target: GuildMember, staff: GuildMember) {
  return (template || "Advertência Safe Bot #{count}: {reason}")
    .replaceAll("{user}", `<@${target.id}>`).replaceAll("{staff}", `<@${staff.id}>`)
    .replaceAll("{reason}", warning.reason).replaceAll("{count}", String(warning.warningNumber))
    .replaceAll("{level}", warning.level?.name ?? "Nível não configurado").slice(0, 1900);
}

function actionLabel(action: SafeBotWarningRecord["configuredAction"] | SafeBotWarningLevel["action"]) {
  return action ? action.replaceAll("_", " ") : "Apenas registrar";
}
