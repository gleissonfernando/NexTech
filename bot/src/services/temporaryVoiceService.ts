import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, EmbedBuilder, MessageFlags,
  ModalBuilder, PermissionFlagsBits, SeparatorBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
  UserSelectMenuBuilder, StringSelectMenuBuilder, type ButtonInteraction, type Channel, type Client, type Interaction, type ModalSubmitInteraction,
  type UserSelectMenuInteraction, type StringSelectMenuInteraction, type VoiceState, type VoiceChannel, type Guild, type Message
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { TemporaryCall, TemporaryVoiceSettings } from "./apiClient";

const IDs = { private: "tempcall_private", public: "tempcall_public", limit: "tempcall_limit", create: "tempcall_create", allow: "tempcall_allow", disconnect: "tempcall_disconnect", ban: "tempcall_ban", delete: "tempcall_delete" } as const;
const emptyTimers = new Map<string, NodeJS.Timeout>();
let started = false;

export function startTemporaryVoiceService(client: Client<true>, context: BotContext) {
  if (started || !isBotModuleEnabled("temporary-voice")) return;
  started = true;
  void reconcileAll(client, context);
  const timer = setInterval(() => void reconcileAll(client, context), 60_000); timer.unref();
}

export async function handleTemporaryVoiceMessage(message: Message, context: BotContext) {
  if (message.author.bot || !message.guild || message.content.trim().toLowerCase() !== ".call") return false;

  if (!isBotModuleEnabled("temporary-voice")) return false;

  const settings = await context.api.getTemporaryVoiceSettings(message.guild.id).catch(() => null);
  if (!settings?.enabled) {
    await message.reply("Temporary calls are disabled in the dashboard.").catch(() => null);
    return true;
  }

  if (!message.channel.isSendable()) {
    await message.reply("I cannot publish the temporary-call panel in this channel.").catch(() => null);
    return true;
  }

  if (settings.panelChannelId === message.channelId && settings.panelMessageId) {
    const previousPanel = await message.channel.messages.fetch(settings.panelMessageId).catch(() => null);
    await previousPanel?.delete().catch(() => null);
  }

  await message.delete().catch(() => null);
  const panel = await message.channel.send(panelPayload());

  if (settings.panelChannelId === message.channelId) {
    await context.api.updateTemporaryVoicePanelState(message.guild.id, panel.id).catch(() => null);
  }

  return true;
}

export async function handleTemporaryVoiceInteraction(interaction: Interaction, context: BotContext) {
  if (!(interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu())) return false;
  if (!interaction.customId.startsWith("tempcall_")) return false;
  if (!interaction.guild) { await ephemeral(interaction, "❌ This action is only available in a server."); return true; }
  try {
    if (interaction.isModalSubmit()) await handleModal(interaction, context);
    else if (interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) await handleUserSelect(interaction, context);
    else await handleButton(interaction, context);
  } catch (error) { await ephemeral(interaction, `❌ ${error instanceof Error ? error.message : "The temporary call action failed."}`); }
  return true;
}

async function handleButton(interaction: ButtonInteraction, context: BotContext) {
  const settings = await context.api.getTemporaryVoiceSettings(interaction.guildId!);
  if (!settings.enabled) throw new Error("Temporary calls are disabled in the dashboard.");
  if (interaction.customId === IDs.create) { await createCall(interaction, context, settings); return; }
  const call = await ownedCall(interaction, context);
  if (interaction.customId === IDs.private) { await setPrivacy(interaction, context, call, true); return; }
  if (interaction.customId === IDs.public) { await setPrivacy(interaction, context, call, false); return; }
  if (interaction.customId === IDs.limit) {
    const input = new TextInputBuilder().setCustomId("limit").setLabel("New call limit").setMinLength(1).setMaxLength(2).setRequired(true).setStyle(TextInputStyle.Short).setValue(String(call.userLimit));
    await interaction.showModal(new ModalBuilder().setCustomId("tempcall_limit_modal").setTitle("Change call limit").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))); return;
  }
  if (interaction.customId === IDs.allow || interaction.customId === IDs.ban) {
    const mode = interaction.customId === IDs.allow ? "allow" : "ban";
    const menu = new UserSelectMenuBuilder().setCustomId(`tempcall_${mode}_select`).setPlaceholder(mode === "allow" ? "Select a user to allow" : "Select a user to ban").setMinValues(1).setMaxValues(1);
    await interaction.reply({ content: mode === "allow" ? "Select the user who may join your call." : "Select the user to ban from your call.", components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu)], ephemeral: true }); return;
  }
  if (interaction.customId === IDs.disconnect) {
    const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Your temporary call no longer exists.");
    const options = channel.members.filter((member) => member.id !== call.ownerId).map((member) => ({ label: member.displayName.slice(0, 100), value: member.id }));
    if (!options.length) { await ephemeral(interaction, "❌ There is nobody to disconnect from your call."); return; }
    const menu = new StringSelectMenuBuilder().setCustomId("tempcall_disconnect_select").setPlaceholder("Select a user to disconnect").setMinValues(1).setMaxValues(1).addOptions(options);
    await interaction.reply({ content: "Select a member currently inside your call.", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ephemeral: true }); return;
  }
  if (interaction.customId === IDs.delete) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("tempcall_delete_confirm").setLabel("Confirm").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("tempcall_delete_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: "Delete your temporary call?", components: [row], ephemeral: true }); return;
  }
  if (interaction.customId === "tempcall_delete_cancel") { await interaction.update({ content: "Deletion cancelled.", components: [] }); return; }
  if (interaction.customId === "tempcall_delete_confirm") { await deleteCall(interaction, context, call, "Deleted by owner"); return; }
}

async function handleModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (interaction.customId !== "tempcall_limit_modal") return;
  const call = await ownedCall(interaction, context);
  const raw = interaction.fields.getTextInputValue("limit").trim();
  if (!/^\d+$/.test(raw)) throw new Error("The call limit must contain numbers only.");
  const limit = Number(raw); if (limit < 1 || limit > 99) throw new Error("The call limit must be between 1 and 99.");
  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Your temporary call no longer exists.");
  await channel.setUserLimit(limit, `Temporary call limit changed by ${interaction.user.tag}`);
  await context.api.updateTemporaryCall(interaction.guildId!, call.id, { userLimit: limit });
  await ephemeral(interaction, `✅ Your call limit was changed to ${limit}.`);
}

async function handleUserSelect(interaction: UserSelectMenuInteraction | StringSelectMenuInteraction, context: BotContext) {
  const call = await ownedCall(interaction, context); const userId = interaction.values[0]; if (!userId) throw new Error("No user was selected.");
  if (userId === call.ownerId) throw new Error("The call owner cannot be selected for this action.");
  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Your temporary call no longer exists.");
  if (interaction.customId === "tempcall_allow_select") {
    const allowedUsers = [...new Set([...call.allowedUsers, userId])]; const bannedUsers = call.bannedUsers.filter((id) => id !== userId);
    await channel.permissionOverwrites.edit(userId, { ViewChannel: true, Connect: true }, { reason: "Temporary call allow list" });
    await context.api.updateTemporaryCall(interaction.guildId!, call.id, { allowedUsers, bannedUsers }); await interaction.update({ content: "✅ User allowed in your call.", components: [] }); return;
  }
  if (interaction.customId === "tempcall_ban_select") {
    const bannedUsers = [...new Set([...call.bannedUsers, userId])]; const allowedUsers = call.allowedUsers.filter((id) => id !== userId);
    await channel.permissionOverwrites.edit(userId, { Connect: false }, { reason: "Temporary call ban list" });
    const member = await interaction.guild!.members.fetch(userId).catch(() => null); if (member?.voice.channelId === channel.id) await member.voice.disconnect("Banned from temporary call");
    await context.api.updateTemporaryCall(interaction.guildId!, call.id, { allowedUsers, bannedUsers }); await interaction.update({ content: "✅ User banned from your call.", components: [] }); return;
  }
  if (interaction.customId === "tempcall_disconnect_select") {
    const member = await interaction.guild!.members.fetch(userId).catch(() => null); if (!member || member.voice.channelId !== channel.id) throw new Error("That user is not inside your call.");
    await member.voice.disconnect("Disconnected by temporary call owner"); await interaction.update({ content: "✅ User disconnected from your call.", components: [] });
  }
}

async function createCall(interaction: ButtonInteraction, context: BotContext, settings: TemporaryVoiceSettings) {
  const existing = await context.api.getTemporaryCallByOwner(interaction.guildId!, interaction.user.id); if (existing) throw new Error("You already have an active temporary call.");
  const member = await interaction.guild!.members.fetch(interaction.user.id); if (!member.voice.channelId) throw new Error("Join a voice channel before creating your temporary call.");
  const me = interaction.guild!.members.me; if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.MoveMembers)) throw new Error("The bot needs Manage Channels and Move Members permissions.");
  const parent = settings.categoryId ? await interaction.guild!.channels.fetch(settings.categoryId).catch(() => null) : null;
  const name = `Call de ${member.displayName}`.slice(0, 100);
  const channel = await interaction.guild!.channels.create({ name, type: ChannelType.GuildVoice, parent: parent?.type === ChannelType.GuildCategory ? parent.id : undefined, userLimit: settings.defaultUserLimit, permissionOverwrites: [{ id: interaction.guild!.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }, { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }], reason: `Temporary call created by ${member.user.tag}` });
  try {
    const call = await context.api.createTemporaryCall(interaction.guildId!, { ownerId: member.id, channelId: channel.id, channelName: channel.name, userLimit: settings.defaultUserLimit, isPrivate: false, allowedUsers: [], bannedUsers: [] });
    await member.voice.setChannel(channel, "Moved to own temporary call"); await logCall(context, settings, call, "Temporary call created", member.id); await ephemeral(interaction, "✅ Your temporary call was created.");
  } catch (error) { await channel.delete("Temporary call persistence failed").catch(() => null); throw error; }
}

async function setPrivacy(interaction: ButtonInteraction, context: BotContext, call: TemporaryCall, isPrivate: boolean) {
  const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null); if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Your temporary call no longer exists.");
  await channel.permissionOverwrites.edit(interaction.guild!.roles.everyone.id, { ViewChannel: true, Connect: isPrivate ? false : true }, { reason: `Temporary call set ${isPrivate ? "private" : "public"}` });
  for (const userId of call.allowedUsers) await channel.permissionOverwrites.edit(userId, { ViewChannel: true, Connect: true }).catch(() => null);
  for (const userId of call.bannedUsers) await channel.permissionOverwrites.edit(userId, { Connect: false }).catch(() => null);
  await context.api.updateTemporaryCall(interaction.guildId!, call.id, { isPrivate }); await ephemeral(interaction, `✅ Your call is now ${isPrivate ? "private" : "public"}.`);
}

async function ownedCall(interaction: Interaction & { guildId: string | null }, context: BotContext) { const call = await context.api.getTemporaryCallByOwner(interaction.guildId!, interaction.user.id); if (!call) throw new Error("You do not have an active temporary call."); if (call.ownerId !== interaction.user.id) throw new Error("You are not the owner of this temporary call."); return call; }

export async function handleTemporaryVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  if (!isBotModuleEnabled("temporary-voice")) return;
  if (newState.channelId) { const call = await context.api.getTemporaryCallByChannel(newState.guild.id, newState.channelId).catch(() => null); if (call) { cancelEmpty(call.channelId); if (call.emptySince) await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: null }).catch(() => null); if (call.bannedUsers.includes(newState.id)) await newState.disconnect("Banned from temporary call").catch(() => null); } }
  if (oldState.channelId && oldState.channelId !== newState.channelId) { const call = await context.api.getTemporaryCallByChannel(oldState.guild.id, oldState.channelId).catch(() => null); if (call) { const channel = oldState.guild.channels.cache.get(call.channelId); if (channel?.type === ChannelType.GuildVoice && channel.members.size === 1) await context.api.postLog({ guildId: call.guildId, userId: channel.members.first()?.id ?? call.ownerId, type: "voice.temporary_alone", message: `A user is alone in temporary call ${call.channelName}.`, metadata: { channelId: call.channelId, ownerId: call.ownerId } }).catch(() => null); await inspectEmpty(channel, context, call); } }
}

export async function handleTemporaryCallChannelDelete(channel: Channel, context: BotContext) { if (!("guild" in channel) || !isBotModuleEnabled("temporary-voice")) return; const call = await context.api.getTemporaryCallByChannel(channel.guild.id, channel.id).catch(() => null); if (call) { cancelEmpty(channel.id); await context.api.deleteTemporaryCall(channel.guild.id, call.id).catch(() => null); } }

async function inspectEmpty(raw: Channel | undefined, context: BotContext, call: TemporaryCall) { if (!raw || raw.type !== ChannelType.GuildVoice || raw.members.size) { cancelEmpty(call.channelId); if (call.emptySince) await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: null }); return; } if (emptyTimers.has(call.channelId)) return; const settings = await context.api.getTemporaryVoiceSettings(call.guildId); const emptySince = call.emptySince ? new Date(call.emptySince).getTime() : Date.now(); if (!call.emptySince) await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: new Date(emptySince).toISOString() }); const delay = Math.max(0, settings.emptyDeleteMinutes * 60_000 - (Date.now() - emptySince)); const timer = setTimeout(() => void deleteEmpty(raw, context, call, settings), delay); timer.unref(); emptyTimers.set(call.channelId, timer); }
async function deleteEmpty(channel: VoiceChannel, context: BotContext, call: TemporaryCall, settings: TemporaryVoiceSettings) { emptyTimers.delete(call.channelId); const fresh = await channel.guild.channels.fetch(call.channelId).catch(() => null); if (!fresh || fresh.type !== ChannelType.GuildVoice) { await context.api.deleteTemporaryCall(call.guildId, call.id).catch(() => null); return; } if (fresh.members.size) { await context.api.updateTemporaryCall(call.guildId, call.id, { emptySince: null }); return; } await fresh.delete("Temporary call empty timeout"); await context.api.deleteTemporaryCall(call.guildId, call.id).catch(() => null); await logCall(context, settings, call, "Temporary call deleted after empty timeout", call.ownerId); }
async function deleteCall(interaction: ButtonInteraction, context: BotContext, call: TemporaryCall, reason: string) { cancelEmpty(call.channelId); const settings = await context.api.getTemporaryVoiceSettings(call.guildId); const channel = await interaction.guild!.channels.fetch(call.channelId).catch(() => null); if (channel) await channel.delete(reason); await context.api.deleteTemporaryCall(call.guildId, call.id).catch(() => null); await logCall(context, settings, call, "Temporary call deleted", interaction.user.id); if (interaction.deferred || interaction.replied) await interaction.editReply({ content: "✅ Your temporary call was deleted.", components: [] }); else await ephemeral(interaction, "✅ Your temporary call was deleted."); }
function cancelEmpty(channelId: string) { const timer = emptyTimers.get(channelId); if (timer) clearTimeout(timer); emptyTimers.delete(channelId); }

async function reconcileAll(client: Client<true>, context: BotContext) { for (const guild of client.guilds.cache.values()) { const settings = await context.api.getTemporaryVoiceSettings(guild.id).catch(() => null); if (!settings?.enabled) continue; await publishPanel(guild, context, settings).catch((error) => console.warn("[temporary-voice] panel:", String(error))); const calls = await context.api.listTemporaryCalls(guild.id).catch(() => []); for (const call of calls) { const channel = await guild.channels.fetch(call.channelId).catch(() => null); if (!channel) { await context.api.deleteTemporaryCall(guild.id, call.id).catch(() => null); continue; } await inspectEmpty(channel, context, call); } } }
async function publishPanel(guild: Guild, context: BotContext, settings: TemporaryVoiceSettings) { if (!settings.panelChannelId) return; const channel = await guild.channels.fetch(settings.panelChannelId).catch(() => null); if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("Configured temporary-call panel channel is unavailable."); if (settings.panelMessageId) { const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null); if (message) return; } const message = await channel.send(panelPayload()); await context.api.updateTemporaryVoicePanelState(guild.id, message.id); }
function panelPayload() { const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(button(IDs.private, "🔒", ButtonStyle.Danger), button(IDs.public, "🔓", ButtonStyle.Success), button(IDs.limit, "🖊️", ButtonStyle.Primary), button(IDs.create, "🎧", ButtonStyle.Secondary)); const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(button(IDs.allow, "➕", ButtonStyle.Success), button(IDs.disconnect, "➖", ButtonStyle.Secondary), button(IDs.ban, "🛡️", ButtonStyle.Danger), button(IDs.delete, "🗑️", ButtonStyle.Danger)); const container = new ContainerBuilder().setAccentColor(0x111827).addTextDisplayComponents(new TextDisplayBuilder().setContent("# 🛡️ Gerenciamento das calls temporarias !\nAqui voce vera todas as formas de gerenciar sua call temporaria.")).addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🖊️ Edicao\n🔒 | Deixar privada\n🔓 | Deixar publica\n🖊️ | Alterar limite")).addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🛡️ Gerenciamento\n➕ | Permitir alguem\n➖ | Desconectar alguem\n🛡️ | Banir alguem")).addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎧 Gerenciamento Call\n🎧 | Cria Call\n🗑️ | Deletar call")).addActionRowComponents(row1, row2); return { components: [container], flags: MessageFlags.IsComponentsV2 as const }; }
function button(id: string, emoji: string, style: ButtonStyle) { return new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(style); }
async function logCall(context: BotContext, settings: TemporaryVoiceSettings, call: TemporaryCall, action: string, userId: string) { await context.api.postLog({ guildId: call.guildId, userId, type: "voice.temporary_call", message: `${action}: ${call.channelName}.`, metadata: { action, channelId: call.channelId, ownerId: call.ownerId } }).catch(() => null); if (!settings.logChannelId) return; const guild = context.client.guilds.cache.get(call.guildId); const channel = await guild?.channels.fetch(settings.logChannelId).catch(() => null); if (channel?.isTextBased() && channel.isSendable()) await channel.send({ embeds: [new EmbedBuilder().setColor(0x3b82f6).setTitle("🔊 Temporary Call").setDescription(`**Action:** ${action}\n**Owner:** <@${call.ownerId}>\n**Channel:** ${call.channelName}`).setTimestamp()] }); }
async function ephemeral(interaction: Interaction, content: string) { if (!interaction.isRepliable()) return; if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true }); else await interaction.reply({ content, ephemeral: true }); }
