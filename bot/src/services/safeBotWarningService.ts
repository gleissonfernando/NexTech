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

const PREFIX = "safe_warning";
const confirmations = new Map<string, { guildId: string; userId: string; reason: string; staffId: string; expiresAt: number }>();

export async function prepareSafeBotWarning(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }
  const targetUser = interaction.options.getUser("usuario", true);
  const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  const staff = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!target || !staff) {
    await interaction.reply({ content: "The selected member could not be loaded.", ephemeral: true });
    return;
  }
  if (target.id === interaction.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "Server owners and administrators cannot receive Safe Bot warnings.", ephemeral: true });
    return;
  }
  const settings = await context.api.getSafeBotWarningSettings(interaction.guild.id);
  if (!settings.enabled || !settings.levels.length) {
    await interaction.reply({ content: "The warning system is disabled or has no configured levels.", ephemeral: true });
    return;
  }
  if (!staff.permissions.has(PermissionFlagsBits.ModerateMembers) && !settings.authorizedRoleIds.some((roleId) => staff.roles.cache.has(roleId))) {
    await interaction.reply({ content: "You do not have permission to issue Safe Bot warnings.", ephemeral: true });
    return;
  }
  const preview = await context.api.getSafeBotWarningPreview(interaction.guild.id, target.id);
  if (preview.blocked) {
    await interaction.reply({ content: preview.note ?? "New warnings are blocked by the configured overflow rule.", ephemeral: true });
    return;
  }
  const reason = interaction.options.getString("motivo")?.trim() || preview.level?.defaultReason || "No reason provided.";
  const confirmationId = randomUUID();
  confirmations.set(confirmationId, { guildId: interaction.guild.id, userId: target.id, reason, staffId: interaction.user.id, expiresAt: Date.now() + 5 * 60_000 });
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("Confirm Safe Bot warning")
    .setDescription([
      `**User:** <@${target.id}>`,
      `**Current warnings:** ${preview.currentWarnings}`,
      `**Next warning:** ${preview.nextWarningNumber}`,
      `**Level:** ${preview.level?.name ?? "No configured level (record only)"}`,
      `**Configured action:** ${actionLabel(preview.level?.action ?? null)}`,
      `**Reason:** ${reason}`,
      preview.note ? `**Note:** ${preview.note}` : ""
    ].filter(Boolean).join("\n"));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${confirmationId}`).setLabel("Confirm warning").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${confirmationId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:history:${confirmationId}`).setLabel("View history").setStyle(ButtonStyle.Primary)
  );
  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

export async function handleSafeBotWarningInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton() || !interaction.customId.startsWith(`${PREFIX}:`)) return false;
  const [, action, confirmationId] = interaction.customId.split(":");
  const state = confirmationId ? confirmations.get(confirmationId) : null;
  if (!state || state.expiresAt < Date.now()) {
    if (confirmationId) confirmations.delete(confirmationId);
    await interaction.reply({ content: "This warning confirmation expired.", ephemeral: true });
    return true;
  }
  if (interaction.user.id !== state.staffId || interaction.guildId !== state.guildId) {
    await interaction.reply({ content: "Only the staff member who opened this confirmation can use it.", ephemeral: true });
    return true;
  }
  if (action === "cancel") {
    confirmations.delete(confirmationId!);
    await interaction.update({ content: "Warning cancelled. No warning or action was recorded.", embeds: [], components: [] });
    return true;
  }
  if (action === "history") {
    const history = await context.api.getSafeBotWarningHistory(state.guildId, state.userId);
    const lines = history.warnings.slice(0, 10).map((warning) => `#${warning.warningNumber} • ${warning.level?.name ?? "Unconfigured level"} • ${warning.reason} • ${warning.status}`);
    await interaction.reply({ content: lines.length ? lines.join("\n").slice(0, 1900) : "This user has no warning history.", ephemeral: true });
    return true;
  }
  if (action !== "confirm") return true;
  confirmations.delete(confirmationId!);
  await interaction.deferUpdate();
  try {
    const guild = interaction.guild;
    if (!guild) throw new Error("Server unavailable.");
    const target = await guild.members.fetch(state.userId).catch(() => null);
    const staff = await guild.members.fetch(state.staffId).catch(() => null);
    if (!target || !staff) throw new Error("The target member or staff member is unavailable.");
    const settings = await context.api.getSafeBotWarningSettings(state.guildId);
    if (!settings.enabled) throw new Error("The warning system was disabled before confirmation.");
    if (!staff.permissions.has(PermissionFlagsBits.ModerateMembers) && !settings.authorizedRoleIds.some((roleId) => staff.roles.cache.has(roleId))) {
      throw new Error("The staff member no longer has permission to issue warnings.");
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
    await sendWarningLog(completed, settings, target, staff);
    await interaction.editReply({
      content: completed.status === "failed"
        ? `Warning #${completed.warningNumber} was recorded, but no automatic action ran: ${completed.error ?? "configuration check failed"}`
        : `Warning #${completed.warningNumber} recorded. Action: ${completed.executedAction ?? actionLabel(completed.configuredAction)}.`,
      embeds: [],
      components: []
    });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "The warning could not be applied.", embeds: [], components: [] });
  }
  return true;
}

async function executeConfiguredAction(warning: SafeBotWarningRecord, settings: SafeBotWarningSettings, target: GuildMember, staff: GuildMember) {
  if (warning.status !== "pending" || !warning.level || !warning.configuredAction) {
    return { success: warning.status !== "failed", executedAction: "Recorded only", error: warning.error };
  }
  const level = warning.level;
  const action = warning.configuredAction;
  try {
    if (["timeout", "kick", "ban", "add_role", "remove_role"].includes(action)) assertTargetHierarchy(target);
    if (action === "dm") await target.send(render(level.userMessage, warning, target, staff));
    if (action === "channel_message" || action === "notify_staff") await sendConfiguredChannel(level, render(action === "notify_staff" ? level.staffMessage : level.userMessage, warning, target, staff), target);
    if (action === "add_role") await target.roles.add(level.roleId!, `Safe Bot warning #${warning.warningNumber}: ${warning.reason}`);
    if (action === "remove_role") await target.roles.remove(level.roleId!, `Safe Bot warning #${warning.warningNumber}: ${warning.reason}`);
    if (action === "timeout") {
      if (!target.moderatable) throw new Error("The bot cannot timeout this member because of Discord hierarchy or permissions.");
      await target.timeout(level.durationSeconds! * 1000, `Safe Bot warning #${warning.warningNumber}: ${warning.reason}`);
    }
    if (action === "kick") {
      if (!target.kickable) throw new Error("The bot cannot kick this member because of Discord hierarchy or permissions.");
      await target.kick(`Safe Bot warning #${warning.warningNumber}: ${warning.reason}`);
    }
    if (action === "ban") {
      if (!target.bannable) throw new Error("The bot cannot ban this member because of Discord hierarchy or permissions.");
      await target.ban({ reason: `Safe Bot warning #${warning.warningNumber}: ${warning.reason}` });
    }
    if (action === "open_ticket") await openWarningTicket(level, warning, target, staff);
    if (action === "block_channels") {
      for (const channelId of level.targetChannelIds) {
        const channel = await target.guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased() || !("permissionOverwrites" in channel)) throw new Error(`Configured channel ${channelId} is unavailable.`);
        await channel.permissionOverwrites.edit(target.id, { SendMessages: false, ViewChannel: false }, { reason: `Safe Bot warning #${warning.warningNumber}` });
      }
    }
    if (action === "custom") await sendConfiguredChannel(level, render(level.customAction, warning, target, staff), target);
    if (level.userMessage && action !== "dm" && !["kick", "ban"].includes(action)) await target.send(render(level.userMessage, warning, target, staff)).catch(() => null);
    return { success: true, executedAction: actionLabel(action), error: null };
  } catch (error) {
    return { success: false, executedAction: actionLabel(action), error: error instanceof Error ? error.message : String(error) };
  }
}

function assertTargetHierarchy(target: GuildMember) {
  if (target.id === target.guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) throw new Error("Server owners and administrators cannot receive this action.");
  const me = target.guild.members.me;
  if (!me || target.roles.highest.position >= me.roles.highest.position) throw new Error("The target member is above or equal to the bot in the role hierarchy.");
}

async function sendConfiguredChannel(level: SafeBotWarningLevel, content: string, target: GuildMember) {
  const channel = level.channelId ? await target.guild.channels.fetch(level.channelId).catch(() => null) : null;
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("The configured action channel is unavailable.");
  await channel.send({ content, allowedMentions: { parse: [] } });
}

async function openWarningTicket(level: SafeBotWarningLevel, warning: SafeBotWarningRecord, target: GuildMember, staff: GuildMember) {
  if (!target.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) throw new Error("The bot lacks Manage Channels permission for an automatic ticket.");
  const channel = await target.guild.channels.create({
    name: `warning-${target.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: target.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: `Safe Bot warning #${warning.warningNumber}`
  });
  await channel.send({ content: render(level.staffMessage || `Warning #${warning.warningNumber}: {reason}`, warning, target, staff), allowedMentions: { users: [target.id, staff.id] } });
  if (level.channelId) {
    const staffChannel = await target.guild.channels.fetch(level.channelId).catch(() => null);
    if (staffChannel?.isTextBased() && staffChannel.isSendable()) {
      await staffChannel.send({ content: `Automatic warning ticket created: <#${channel.id}>`, allowedMentions: { parse: [] } });
    }
  }
}

async function sendWarningLog(warning: SafeBotWarningRecord, settings: SafeBotWarningSettings, target: GuildMember, staff: GuildMember) {
  const channelId = warning.level?.logChannelId || settings.defaultLogChannelId;
  if (!channelId) return;
  const channel = await target.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;
  const embed = new EmbedBuilder().setColor(warning.status === "failed" ? 0xed4245 : 0xf59e0b).setTitle("⚠️ New Safe Bot warning").setDescription([
    `**User:** <@${target.id}>`, `**ID:** ${target.id}`, `**Staff:** <@${staff.id}>`,
    `**Warning:** ${warning.warningNumber}`, `**Level:** ${warning.level?.name ?? "Unconfigured level"}`,
    `**Reason:** ${warning.reason}`, `**Configured action:** ${actionLabel(warning.configuredAction)}`,
    `**Executed action:** ${warning.executedAction ?? "None"}`, `**Status:** ${warning.status}`,
    warning.error ? `**Error:** ${warning.error}` : ""
  ].filter(Boolean).join("\n")).setTimestamp(new Date());
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

function render(template: string, warning: SafeBotWarningRecord, target: GuildMember, staff: GuildMember) {
  return (template || "Safe Bot warning #{count}: {reason}")
    .replaceAll("{user}", `<@${target.id}>`).replaceAll("{staff}", `<@${staff.id}>`)
    .replaceAll("{reason}", warning.reason).replaceAll("{count}", String(warning.warningNumber))
    .replaceAll("{level}", warning.level?.name ?? "Unconfigured level").slice(0, 1900);
}

function actionLabel(action: SafeBotWarningRecord["configuredAction"] | SafeBotWarningLevel["action"]) {
  return action ? action.replaceAll("_", " ") : "Record only";
}
