import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction
} from "discord.js";
import type { BotContext } from "../types";
import type { FivemGoalSettings } from "./apiClient";

const PREFIX = "fivem_goal";
const pendingImages = new Map<string, { expiresAt: number; imageUrl: string }>();

export async function ensureFivemGoalChannelForUser(context: BotContext, guild: Guild, userId: string, username: string) {
  const settings = await context.api.getFivemGoalSettings(guild.id).catch(() => null);
  if (!settings?.enabled) return null;

  const existing = await context.api.getFivemGoalChannelByUser(guild.id, userId).catch(() => null);
  if (existing?.channelId) return existing.channelId;

  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  const channelName = renderChannelName(settings.channelNameTemplate, username, userId);
  const channel = await guild.channels.create({
    name: channelName,
    parent: settings.categoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...(settings.viewRoleId ? [{ id: settings.viewRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : []),
      ...(settings.managerRoleId ? [{ id: settings.managerRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory] }] : []),
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ],
    reason: `Canal de metas FiveM para ${userId}`,
    type: ChannelType.GuildText
  });

  await context.api.saveFivemGoalChannel({ channelId: channel.id, guildId: guild.id, userId });
  await channel.send({
    allowedMentions: { users: [userId] },
    content: `<@${userId}> envie suas fotos de meta neste canal. Abaixo de cada imagem vai aparecer o botao para registrar.`
  }).catch(() => null);

  return channel.id;
}

export async function handleFivemGoalMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot || !message.attachments.size) return false;
  const image = message.attachments.find((attachment) => attachment.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(attachment.url));
  if (!image) return false;

  const goalChannel = await context.api.getFivemGoalChannelByChannel(message.channel.id).catch(() => null);
  if (!goalChannel || goalChannel.userId !== message.author.id) return false;

  const settings = await context.api.getFivemGoalSettings(message.guild.id).catch(() => null);
  if (!settings?.enabled) return false;

  await message.reply(createImageReviewPayload(message.author.id, image.url));
  return true;
}

export async function handleFivemGoalInteraction(interaction: Interaction, context: BotContext) {
  if (!("customId" in interaction) || !interaction.customId.startsWith(`${PREFIX}:`)) return false;

  if (interaction.isButton() && interaction.customId.startsWith(`${PREFIX}:register:`)) {
    await showGoalModal(interaction, context);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PREFIX}:modal:`)) {
    await submitGoalModal(interaction, context);
    return true;
  }

  return false;
}

async function showGoalModal(interaction: ButtonInteraction, context: BotContext) {
  if (!interaction.guild) return;
  const [, , imageToken] = interaction.customId.split(":");
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id);
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:${encodeURIComponent(imageToken ?? "")}`)
    .setTitle("Registrar Meta");

  settings.fields.slice(0, 5).forEach((field) => {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label.slice(0, 45))
      .setPlaceholder(field.placeholder ?? "Digite aqui")
      .setRequired(field.required)
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (field.minLength !== null) input.setMinLength(field.minLength);
    if (field.maxLength !== null) input.setMaxLength(field.maxLength);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  });

  await interaction.showModal(modal);
}

async function submitGoalModal(interaction: ModalSubmitInteraction, context: BotContext) {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const token = interaction.customId.split(":")[2] ?? "";
  const imageUrl = pendingImages.get(token)?.imageUrl ?? "";
  const settings = await context.api.getFivemGoalSettings(interaction.guild.id);
  const fields = settings.fields.slice(0, 5).map((field) => ({
    id: field.id,
    label: field.label,
    value: interaction.fields.getTextInputValue(field.id) || "-"
  }));
  const quantityField = fields.find((field) => /quantidade|qtd|euro|valor/i.test(field.id));
  const quantity = quantityField ? Number(quantityField.value.replace(/[^\d.,-]/g, "").replace(",", ".")) : null;

  await context.api.createFivemGoalEntry({
    channelId: interaction.channelId ?? "",
    fields,
    guildId: interaction.guild.id,
    imageUrl,
    quantity: Number.isFinite(quantity) ? quantity : null,
    userId: interaction.user.id
  });

  await interaction.editReply("Meta registrada com sucesso.");
}

function createImageReviewPayload(userId: string, imageUrl: string) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  pendingImages.set(token, { expiresAt: Date.now() + 60 * 60 * 1000, imageUrl });
  cleanupPendingImages();

  return {
    allowedMentions: { parse: [] as never[] },
    components: [
      {
        type: 17,
        accent_color: 0x22c55e,
        components: [
          { type: 12, items: [{ media: { url: imageUrl }, description: "meta image" }] },
          { type: 10, content: `## Foto de meta enviada\nUsuario: <@${userId}>\nData: <t:${Math.floor(Date.now() / 1000)}:F>` }
        ]
      },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:register:${token}`).setLabel("Registrar Meta").setStyle(ButtonStyle.Success)
      )
    ],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function cleanupPendingImages() {
  const now = Date.now();
  for (const [token, item] of pendingImages) {
    if (item.expiresAt < now) pendingImages.delete(token);
  }
}

function renderChannelName(template: string, username: string, userId: string) {
  return (template || "📈・{username}")
    .replace(/\{username\}/gi, username)
    .replace(/\{user\}/gi, username)
    .replace(/\{id\}/gi, userId)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 90);
}
