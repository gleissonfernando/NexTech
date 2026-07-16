import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type RoleSelectMenuInteraction
} from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { PoliceHiddenChannelSettings } from "./apiClient";
import type { BotCommand, BotContext } from "../types";
import { isUserInVisibleMode } from "./visibleModeService";

const MODULE_ID = "police-hidden-channel";
const PREFIX = "police_hidden_channel";
const SETTINGS_TTL_MS = 30_000;
const FLOOD_WINDOW_MS = 60_000;
const FLOOD_LIMIT = 5;

const settingsCache = new Map<string, { expiresAt: number; settings: PoliceHiddenChannelSettings }>();
const floodBuckets = new Map<string, { count: number; resetAt: number }>();

export const policeHiddenChannelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("canal-oculto")
    .setDescription("Configura o Canal Oculto da Polícia.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  moduleId: MODULE_ID,
  async execute(interaction, context) {
    await openPoliceHiddenChannelSetup(interaction, context);
  }
};

export async function openPoliceHiddenChannelSetup(interaction: ChatInputCommandInteraction, _context: BotContext) {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  if (!canManage(interaction.member as GuildMember)) {
    await interaction.reply({ content: "Apenas Administrador ou Gerenciar Servidor pode configurar o Canal Oculto.", ephemeral: true });
    return;
  }

  await interaction.reply({
    components: [channelSelectRow("channel", "Selecione o canal que será utilizado pelo Canal Oculto.")],
    content: "Selecione o canal que será utilizado pelo Canal Oculto.",
    ephemeral: true
  });
}

export async function handlePoliceHiddenChannelInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.guild || !interaction.isRepliable() || !("customId" in interaction)) return false;
  const customId = String(interaction.customId);
  if (!customId.startsWith(`${PREFIX}:`)) return false;

  if (!interaction.member || !canManage(interaction.member as GuildMember)) {
    await interaction.reply({ content: "Voce nao tem permissao para configurar o Canal Oculto.", ephemeral: true });
    return true;
  }

  if (interaction.isChannelSelectMenu() && customId === `${PREFIX}:channel`) {
    await selectHiddenChannel(interaction);
    return true;
  }

  if (interaction.isChannelSelectMenu() && customId === `${PREFIX}:logs`) {
    await selectLogChannel(interaction, context);
    return true;
  }

  if (interaction.isRoleSelectMenu() && customId.startsWith(`${PREFIX}:role:`)) {
    await selectAllowedRole(interaction, context, customId.slice(`${PREFIX}:role:`.length));
    return true;
  }

  return false;
}

export async function handlePoliceHiddenChannelMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) return false;

  const settings = await getSettings(context, message.guild.id).catch(() => null);
  if (!settings?.enabled || !settings.channelId || !settings.allowedRoleId || message.channelId !== settings.channelId) return false;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.roles.cache.has(settings.allowedRoleId)) return false;
  if (await isUserInVisibleMode(context, message.guild.id, message.author.id)) return false;

  const channel = message.channel;
  if (!("permissionsFor" in channel) || !("send" in channel)) {
    return false;
  }

  const me = message.guild.members.me ?? await message.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ManageMessages) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    await writeRelayLog(context, message, settings, "failed", null, "Permissoes insuficientes para apagar ou enviar mensagens.");
    return true;
  }

  if (!consumeFlood(message.guild.id, message.author.id)) {
    await message.delete().catch(() => null);
    await writeRelayLog(context, message, settings, "failed", null, "Limite de mensagens por minuto excedido.");
    return true;
  }

  const payload = relayPayload(message);

  if (!payload.content && !payload.files?.length && !payload.embeds?.length && !payload.stickers?.length) {
    await message.delete().catch(() => null);
    await writeRelayLog(context, message, settings, "failed", null, "Mensagem sem conteudo retransmissivel.");
    return true;
  }

  await message.delete();
  const relayed = await channel.send(payload);
  await writeRelayLog(context, message, settings, "relayed", relayed.id, null);
  await sendAdminLog(message, settings, relayed.id);
  return true;
}

export function clearPoliceHiddenChannelSettingsCache(guildId?: string | null) {
  if (!guildId) {
    settingsCache.clear();
    return;
  }

  for (const key of settingsCache.keys()) {
    if (key.endsWith(`:${guildId}`)) settingsCache.delete(key);
  }
}

async function selectHiddenChannel(interaction: ChannelSelectMenuInteraction) {
  const channelId = interaction.values[0];
  if (!channelId) {
    await interaction.update({ content: "Nenhum canal selecionado.", components: [] });
    return;
  }

  await interaction.update({
    components: [roleSelectRow(channelId)],
    content: "Selecione o cargo que poderá utilizar este Canal Oculto."
  });
}

async function selectAllowedRole(interaction: RoleSelectMenuInteraction, context: BotContext, channelId: string) {
  const roleId = interaction.values[0];
  if (!roleId) {
    await interaction.update({ content: "Nenhum cargo selecionado.", components: [] });
    return;
  }

  const settings = await context.api.savePoliceHiddenChannelSettings(interaction.guildId!, {
    allowedRoleId: roleId,
    channelId,
    enabled: true
  }, interaction.user.id);
  cacheSettings(settings);

  await interaction.update({
    components: [channelSelectRow("logs", "Selecione o canal de logs administrativos.")],
    content: `Canal Oculto ativado em <#${settings.channelId}> para <@&${settings.allowedRoleId}>.\nAgora selecione o canal de logs administrativos.`
  });
}

async function selectLogChannel(interaction: ChannelSelectMenuInteraction, context: BotContext) {
  const logChannelId = interaction.values[0] ?? null;
  const settings = await context.api.savePoliceHiddenChannelSettings(interaction.guildId!, { logChannelId }, interaction.user.id);
  cacheSettings(settings);
  await interaction.update({
    components: [],
    content: `Canal Oculto configurado.\nCanal: <#${settings.channelId}>\nCargo autorizado: <@&${settings.allowedRoleId}>\nLogs: ${settings.logChannelId ? `<#${settings.logChannelId}>` : "nao configurado"}`
  });
}

async function getSettings(context: BotContext, guildId: string) {
  const key = cacheKey(guildId);
  const cached = settingsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  const settings = await context.api.getPoliceHiddenChannelSettings(guildId);
  cacheSettings(settings);
  return settings;
}

function cacheSettings(settings: PoliceHiddenChannelSettings) {
  settingsCache.set(cacheKey(settings.guildId), { expiresAt: Date.now() + SETTINGS_TTL_MS, settings });
}

function relayPayload(message: Message): MessageCreateOptions {
  const embeds = message.embeds.map((embed) => embed.toJSON()).slice(0, 10);
  const files = message.attachments.map((attachment) => ({
    attachment: attachment.url,
    name: attachment.name ?? `arquivo-${attachment.id}`
  })).slice(0, 10);
  const stickers = message.stickers.map((sticker) => sticker.id).slice(0, 3);
  const options: MessageCreateOptions = {};

  if (message.content) options.content = message.content.slice(0, 2000);
  if (embeds.length) options.embeds = embeds;
  if (files.length) options.files = files;
  if (stickers.length) options.stickers = stickers;

  return options;
}

async function writeRelayLog(
  context: BotContext,
  message: Message,
  settings: PoliceHiddenChannelSettings,
  status: "relayed" | "failed",
  relayedMessageId: string | null,
  errorMessage: string | null
) {
  await context.api.createPoliceHiddenChannelLog({
    attachmentUrls: message.attachments.map((attachment) => attachment.url),
    authorId: message.author.id,
    authorTag: message.author.tag,
    channelId: message.channelId,
    content: message.content,
    embedCount: message.embeds.length,
    errorMessage,
    guildId: message.guild!.id,
    logChannelId: settings.logChannelId,
    originalMessageId: message.id,
    relayedMessageId,
    status,
    stickerIds: message.stickers.map((sticker) => sticker.id)
  }).catch((error) => {
    console.warn("[police-hidden-channel] falha ao registrar log:", error instanceof Error ? error.message : error);
  });
}

async function sendAdminLog(message: Message, settings: PoliceHiddenChannelSettings, relayedMessageId: string) {
  if (!settings.logChannelId || !message.guild) return;
  const channel = await message.guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  const attachmentLines = message.attachments.map((attachment) => `- ${attachment.name ?? attachment.id}: ${attachment.url}`).join("\n") || "Nenhum";
  const content = [
    "## Canal Oculto - mensagem retransmitida",
    `**Autor real:** <@${message.author.id}> (${message.author.tag})`,
    `**ID:** ${message.author.id}`,
    `**Canal:** <#${message.channelId}>`,
    `**Horario:** <t:${Math.floor(message.createdTimestamp / 1000)}:F>`,
    `**Mensagem:** ${message.content ? `\n${message.content.slice(0, 1500)}` : "Sem texto"}`,
    `**Arquivos:**\n${attachmentLines}`,
    `**Link retransmitido:** https://discord.com/channels/${message.guild.id}/${message.channelId}/${relayedMessageId}`
  ].join("\n");

  await channel.send({ content: content.slice(0, 2000) }).catch(() => null);
}

function channelSelectRow(kind: "channel" | "logs", placeholder: string) {
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${PREFIX}:${kind}`)
      .setPlaceholder(placeholder)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function roleSelectRow(channelId: string) {
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`${PREFIX}:role:${channelId}`)
      .setPlaceholder("Selecione o cargo autorizado.")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function canManage(member: GuildMember) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function consumeFlood(guildId: string, userId: string) {
  const now = Date.now();
  const key = `${guildId}:${userId}`;
  const bucket = floodBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    floodBuckets.set(key, { count: 1, resetAt: now + FLOOD_WINDOW_MS });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= FLOOD_LIMIT;
}

function cacheKey(guildId: string) {
  return `${MODULE_ID}:${guildId}`;
}
