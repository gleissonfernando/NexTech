import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type TextChannel
} from "discord.js";
import { env } from "../config/env";
import type { BotContext, GuildSettings, PanelImageSettings, TicketPanelOption } from "../types";
import { getFreshGuildSettings } from "./guildSettingsCache";
import { renderComponentsV2Panel } from "./panelVisualRenderer";

const TICKET_PANEL_CUSTOM_ID = "ticket_panel_select";

export async function publishTicketPanel(interaction: ChatInputCommandInteraction, context: BotContext) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Comando disponivel apenas em servidores.", ephemeral: true });
    return;
  }

  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id);

  if (!settings.ticketEnabled) {
    await interaction.reply({ content: "O sistema de tickets esta desativado na Dashboard.", ephemeral: true });
    return;
  }

  const payload = createTicketPanelPayload(settings);

  if (!payload) {
    await interaction.reply({ content: "Configure pelo menos uma opcao ativa para o painel de ticket.", ephemeral: true });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: "Nao consegui enviar o painel neste canal.", ephemeral: true });
    return;
  }

  await interaction.channel.send(payload);
  await interaction.reply({ content: "Painel de ticket publicado neste canal.", ephemeral: true });
}

export async function handleTicketPanelInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== TICKET_PANEL_CUSTOM_ID || !interaction.guild) {
    return false;
  }

  const selectedValue = interaction.values[0];
  const settings = await getFreshGuildSettings(context, interaction.guild.id, interaction.client.user?.id).catch(() => null);
  const option = settings?.ticketPanelOptions.find((item) => item.enabled && item.value === selectedValue);

  if (!settings?.ticketEnabled || !option) {
    await interaction.reply({ content: "Esta opcao de ticket nao esta mais disponivel.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  let channelId: string | null = null;
  try {
    const channel = await createTicketChannel(interaction.guild, settings, interaction.user.id, option);
    channelId = channel?.id ?? null;
  } catch (error) {
    console.warn("[ticket-panel] nao foi possivel criar canal de ticket:", error instanceof Error ? error.message : error);
  }

  const ticket = await context.api.createTicket({
    channelId,
    guildId: interaction.guild.id,
    openerId: interaction.user.id,
    subject: option.label
  });

  await interaction.editReply(
    channelId
      ? `Ticket criado: <#${channelId}>`
      : `Ticket registrado: ${ticket.ticket.id}. A equipe foi notificada pelo painel.`
  );

  return true;
}

function createTicketPanelPayload(settings: GuildSettings) {
  const options = settings.ticketPanelOptions.filter((option) => option.enabled).slice(0, 25);

  if (!options.length) {
    return null;
  }

  const contentBlocks = [
    `## ${settings.ticketPanelTitle || "Central de Suporte"}`,
    settings.ticketPanelDescription || "Precisa de ajuda? Abra um ticket e nossa equipe ira atende-lo em breve.",
    settings.ticketPanelInfoText,
    settings.ticketPanelFooterText ? `-# ${settings.ticketPanelFooterText}` : null
  ].filter((block): block is string => Boolean(block?.trim()));
  const imageUrl = resolveImageUrl(settings.ticketPanelImage);
  const action = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_PANEL_CUSTOM_ID)
          .setPlaceholder(settings.ticketPanelPlaceholder || "Selecione o tipo de atendimento")
          .addOptions(options.map(toSelectOption))
      );
  return renderComponentsV2Panel({ accentColor: parseColor(settings.ticketPanelColor), actions: [action], description: contentBlocks[1] ?? "", fields: contentBlocks.slice(2), image: settings.ticketPanelImage && imageUrl ? { ...settings.ticketPanelImage, imageUrl } : null, moduleId: "ticket", title: contentBlocks[0]?.replace(/^##\s*/, "") ?? "Central de Suporte" });
}

async function createTicketChannel(guild: Guild, settings: GuildSettings, openerId: string, option: TicketPanelOption) {
  if (!settings.ticketCategoryId || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return null;
  }

  const safeName = option.label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "ticket";

  return guild.channels.create({
    name: `ticket-${safeName}-${openerId.slice(-4)}`,
    parent: settings.ticketCategoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: openerId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: guild.members.me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory]
      }
    ],
    reason: `Ticket aberto por ${openerId}: ${option.label}`,
    type: ChannelType.GuildText
  }).then(async (channel) => {
    const textChannel = channel as TextChannel;
    await textChannel.send({
      allowedMentions: { users: [openerId] },
      content: `<@${openerId}> ticket aberto para **${option.label}**. Descreva o que precisa e aguarde a equipe.`
    }).catch(() => null);
    return textChannel;
  });
}

function toSelectOption(option: TicketPanelOption) {
  const builder = new StringSelectMenuOptionBuilder()
    .setLabel(option.label)
    .setValue(option.value);

  if (option.description) {
    builder.setDescription(option.description);
  }

  const emoji = parseSelectEmoji(option.emoji);
  if (emoji) {
    builder.setEmoji(emoji);
  }

  return builder;
}

function parseSelectEmoji(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const custom = normalized.match(/^<a?:([a-zA-Z0-9_]+):(\d{5,32})>$/);
  if (custom) {
    return { id: custom[2], name: custom[1], animated: normalized.startsWith("<a:") };
  }

  return normalized;
}

function resolveImageUrl(panelImage: PanelImageSettings | null) {
  if (!panelImage?.imageEnabled || !panelImage.imageUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(panelImage.imageUrl)) {
    return panelImage.imageUrl;
  }

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${panelImage.imageUrl.startsWith("/") ? panelImage.imageUrl : `/${panelImage.imageUrl}`}` : null;
}

function mediaGalleryComponent(imageUrl: string) {
  return {
    type: 12,
    items: [{
      media: { url: imageUrl },
      description: "ticket image"
    }]
  };
}

function parseColor(value: string | null | undefined) {
  const normalized = value?.replace("#", "") ?? "";
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x7c3aed;
}
