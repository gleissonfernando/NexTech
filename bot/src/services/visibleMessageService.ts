import {
  ActionRowBuilder,
  GuildMember,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type TextBasedChannel,
  type TextChannel
} from "discord.js";
import type { BotCommand, BotContext } from "../types";

const WEBHOOK_NAME = "NexTech Mensagem Visível";
const MODAL_PREFIX = "visible_message_once";
const MESSAGE_INPUT_ID = "message";

export const visibleMessageCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mensagem")
    .setDescription("Envia uma única mensagem visível com seu nome e avatar."),
  async execute(interaction, context) {
    await openVisibleMessageModal(interaction, context);
  }
};

export async function handleVisibleMessageInteraction(interaction: Interaction, _context: BotContext) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith(`${MODAL_PREFIX}:`)) {
    return false;
  }

  await sendVisibleMessageFromModal(interaction);
  return true;
}

async function openVisibleMessageModal(interaction: ChatInputCommandInteraction, _context: BotContext) {
  if (!interaction.guild || !interaction.channel || interaction.channel.isDMBased()) {
    await interaction.reply({ content: "Use este comando dentro de um canal de texto do servidor.", ephemeral: true });
    return;
  }

  if (!interaction.channel.isTextBased() || !("permissionsFor" in interaction.channel)) {
    await interaction.reply({ content: "Este canal não aceita envio de mensagens visíveis.", ephemeral: true });
    return;
  }

  const interactionMember = interaction.member instanceof GuildMember ? interaction.member : null;
  const member = await interaction.guild.members.fetch({ force: true, user: interaction.user.id }).catch(() => interactionMember);
  const channel = interaction.channel as TextBasedChannel & TextChannel;
  const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  const botPermissions = me ? channel.permissionsFor(me) : null;

  if (!botPermissions?.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.ManageWebhooks)) {
    await interaction.reply({
      content: "Não consigo enviar a mensagem visível neste canal. Preciso das permissões Enviar Mensagens e Gerenciar Webhooks.",
      ephemeral: true
    });
    return;
  }

  const memberPermissions = member ? channel.permissionsFor(member) : null;
  if (!memberPermissions?.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({ content: "Você não tem permissão para enviar mensagens neste canal.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(buildModalId(interaction.guild.id, channel.id, interaction.user.id))
    .setTitle("Mensagem visível");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(MESSAGE_INPUT_ID)
        .setLabel("Digite sua mensagem")
        .setMaxLength(1900)
        .setRequired(true)
        .setStyle(TextInputStyle.Paragraph)
    )
  );

  await interaction.showModal(modal);
}

async function sendVisibleMessageFromModal(interaction: ModalSubmitInteraction) {
  const parsed = parseModalId(interaction.customId);
  if (!parsed) {
    await interaction.reply({ content: "Não foi possível identificar o envio da mensagem.", ephemeral: true });
    return;
  }

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "Este envio pertence a outro usuário.", ephemeral: true });
    return;
  }

  if (!interaction.guild || interaction.guild.id !== parsed.guildId) {
    await interaction.reply({ content: "Use este recurso dentro do servidor correto.", ephemeral: true });
    return;
  }

  const text = interaction.fields.getTextInputValue(MESSAGE_INPUT_ID).trim();
  if (!text) {
    await interaction.reply({ content: "Digite uma mensagem para enviar.", ephemeral: true });
    return;
  }

  const fetchedChannel = await interaction.guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!fetchedChannel?.isTextBased() || fetchedChannel.isDMBased() || !("permissionsFor" in fetchedChannel)) {
    await interaction.reply({ content: "O canal onde o comando foi usado não está disponível para envio.", ephemeral: true });
    return;
  }

  const channel = fetchedChannel as TextBasedChannel & TextChannel;
  const interactionMember = interaction.member instanceof GuildMember ? interaction.member : null;
  const member = await interaction.guild.members.fetch({ force: true, user: interaction.user.id }).catch(() => interactionMember);
  const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  const botPermissions = me ? channel.permissionsFor(me) : null;

  if (!botPermissions?.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.ManageWebhooks)) {
    await interaction.reply({
      content: "Não consigo enviar a mensagem visível neste canal. Preciso das permissões Enviar Mensagens e Gerenciar Webhooks.",
      ephemeral: true
    });
    return;
  }

  const memberPermissions = member ? channel.permissionsFor(member) : null;
  if (!memberPermissions?.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({ content: "Você não tem permissão para enviar mensagens neste canal.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const visibleIdentity = resolveVisibleIdentity(interaction, member);
    const webhook = await getOrCreateVisibleWebhook(channel);
    await webhook.send({
      allowedMentions: { parse: [] },
      avatarURL: visibleIdentity.avatarURL,
      content: text,
      username: visibleIdentity.username
    });

    await interaction.editReply(`Mensagem visível enviada como ${visibleIdentity.username}.`);
    setTimeout(() => {
      void interaction.deleteReply().catch(() => undefined);
    }, 5_000).unref();
  } catch (error) {
    console.error("[visible-message] falha ao enviar:", error instanceof Error ? error.message : error);
    await interaction.editReply("Não foi possível enviar a mensagem visível neste canal.");
  }
}

function resolveVisibleIdentity(interaction: ChatInputCommandInteraction | ModalSubmitInteraction, member: GuildMember | null) {
  const displayName = resolveServerDisplayName(interaction, member);
  const avatarURL = member?.avatarURL({ forceStatic: false, size: 256 })
    ?? member?.displayAvatarURL({ forceStatic: false, size: 256 })
    ?? interaction.user.displayAvatarURL({ forceStatic: false, size: 256 });

  return {
    avatarURL,
    username: sanitizeWebhookUsername(displayName)
  };
}

function resolveServerDisplayName(interaction: ChatInputCommandInteraction | ModalSubmitInteraction, member: GuildMember | null) {
  const rawMember = interaction.member;
  const interactionNick = rawMember && typeof rawMember === "object" && "nick" in rawMember && typeof rawMember.nick === "string"
    ? rawMember.nick
    : null;

  return interactionNick
    || member?.nickname
    || member?.displayName
    || interaction.user.globalName
    || interaction.user.username;
}

async function getOrCreateVisibleWebhook(channel: TextChannel) {
  const webhooks = await channel.fetchWebhooks();
  const existing = webhooks.find((webhook) => webhook.name === WEBHOOK_NAME && webhook.owner?.id === channel.client.user?.id);
  if (existing) return existing;
  return channel.createWebhook({ name: WEBHOOK_NAME, reason: "Envio de mensagens visíveis pelo comando /mensagem" });
}

function sanitizeWebhookUsername(username: string) {
  const normalized = username
    .replace(/@everyone/gi, "everyone")
    .replace(/@here/gi, "here")
    .trim()
    .slice(0, 80);

  return normalized || "Usuário";
}

function buildModalId(guildId: string, channelId: string, userId: string) {
  return `${MODAL_PREFIX}:${guildId}:${channelId}:${userId}`;
}

function parseModalId(customId: string) {
  const [prefix, guildId, channelId, userId] = customId.split(":");
  if (prefix !== MODAL_PREFIX || !guildId || !channelId || !userId) return null;
  return { channelId, guildId, userId };
}
