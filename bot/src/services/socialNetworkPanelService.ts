import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
  type MessageEditOptions
} from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { BotSocketClient, SocialPanelUpdateEvent } from "../websocket/socketClient";
import type { ApiClient, SocialMember, SocialPanelPayload, SocialPlatform } from "./apiClient";
import { assertPanelChannelPermissions, pinPanelMessage } from "./panelDeliveryService";

type WritableGuildTextChannel = GuildTextBasedChannel;

const syncingPanels = new Set<string>();
const MAX_EMBED_TOTAL_CHARS = 5400;
const MAX_MEMBER_FIELDS = 20;
const SOCIAL_META: Array<{
  buttonLabel: string;
  icon: string;
  id: SocialPlatform;
  label: string;
}> = [
  {
    buttonLabel: "Twitter",
    icon: "𝕏",
    id: "twitter",
    label: "Twitter"
  },
  {
    buttonLabel: "Instagram",
    icon: "📸",
    id: "instagram",
    label: "Instagram"
  },
  {
    buttonLabel: "Twitch",
    icon: "🎮",
    id: "twitch",
    label: "Twitch"
  },
  {
    buttonLabel: "YouTube",
    icon: "▶️",
    id: "youtube",
    label: "YouTube"
  },
  {
    buttonLabel: "TikTok",
    icon: "🎵",
    id: "tiktok",
    label: "TikTok"
  },
  {
    buttonLabel: "Kick",
    icon: "🟢",
    id: "kick",
    label: "Kick"
  },
  {
    buttonLabel: "Facebook",
    icon: "f",
    id: "facebook",
    label: "Facebook"
  },
  {
    buttonLabel: "Site",
    icon: "🔗",
    id: "website",
    label: "Site Pessoal"
  }
];

export function startSocialNetworkPanelSync(client: Client, api: ApiClient, socket: BotSocketClient) {
  socket.onSocialPanelUpdate((event) => {
    if (!isEventForThisBot(event)) {
      return;
    }

    void syncPanelById(client, api, event.panelId).catch((error) => {
      console.warn("[network] falha ao sincronizar painel:", error instanceof Error ? error.message : error);
    });
  });

  void syncAllSocialPanels(client, api).catch((error) => {
    console.warn("[network] sincronizacao inicial falhou:", error instanceof Error ? error.message : error);
  });
}

async function syncAllSocialPanels(client: Client, api: ApiClient) {
  const panels = await api.getSocialPanels();

  for (const payload of panels) {
    if (!client.guilds.cache.has(payload.panel.guildId)) {
      continue;
    }

    await syncSocialPanel(client, api, payload);
  }
}

async function syncPanelById(client: Client, api: ApiClient, panelId: string) {
  if (syncingPanels.has(panelId)) {
    return;
  }

  syncingPanels.add(panelId);

  try {
    const payload = await api.getSocialPanel(panelId);

    if (!client.guilds.cache.has(payload.panel.guildId)) {
      return;
    }

    await syncSocialPanel(client, api, payload);
  } finally {
    syncingPanels.delete(panelId);
  }
}

async function syncSocialPanel(client: Client, api: ApiClient, payload: SocialPanelPayload) {
  const { panel } = payload;

  if (!panel.channelId) {
    return;
  }

  const channel = await fetchWritableChannel(client, panel.channelId, panel.guildId);

  if (!channel) {
    throw new Error(`Canal ${panel.channelId} nao encontrado para a Network.`);
  }

  if (!panel.published) {
    if (panel.messageId) {
      const message = await fetchMessage(channel, panel.messageId);
      await message?.delete().catch(() => undefined);
      await api.updateSocialPanelState(panel.id, {
        messageId: null,
        published: false
      });
    }

    return;
  }

  assertPanelChannelPermissions(channel, client, "Network");

  const messagePayload = buildPanelMessage(payload);
  const existingMessage = panel.messageId ? await fetchMessage(channel, panel.messageId) : null;

  if (existingMessage) {
    const edited = await existingMessage.edit(messagePayload as MessageEditOptions);
    await pinPanelMessage(edited, "Network");
    await api.updateSocialPanelState(panel.id, {
      messageId: existingMessage.id,
      published: true
    });
    return;
  }

  const message = await channel.send(messagePayload);
  await pinPanelMessage(message, "Network");
  await api.updateSocialPanelState(panel.id, {
    messageId: message.id,
    published: true
  });
}

async function fetchWritableChannel(client: Client, channelId: string, guildId: string) {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (
    !channel
    || !channel.isTextBased()
    || !("send" in channel)
    || !("messages" in channel)
    || !("guildId" in channel)
    || channel.guildId !== guildId
  ) {
    return null;
  }

  return channel as WritableGuildTextChannel;
}

async function fetchMessage(channel: WritableGuildTextChannel, messageId: string) {
  return channel.messages.fetch(messageId).catch(() => null);
}

function buildPanelMessage(payload: SocialPanelPayload): MessageCreateOptions {
  const summary = buildSummary(payload.members);
  const embed = new EmbedBuilder()
    .setTitle("Network da comunidade")
    .setColor(parseEmbedColor(payload.panel.embedColor))
    .setDescription(summary)
    .setFooter({
      text: `Atualizado em ${formatDateTime(new Date())}`
    })
    .setTimestamp(new Date());

  const thumbnail = singleMemberAvatar(payload.members);

  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  const fields = buildMemberFields(payload.members, summary.length);

  if (fields.length) {
    embed.addFields(fields);
  }

  return {
    allowedMentions: {
      parse: []
    },
    components: buildComponents(payload.members),
    content: "",
    embeds: [embed]
  };
}

function buildSummary(members: SocialMember[]) {
  if (!members.length) {
    return "Nenhum membro cadastrado ainda. Adicione membros pelo painel para publicar as redes da comunidade.";
  }

  const linkCount = members.reduce((total, member) => total + activeLinks(member).length, 0);

  return [
    "Acesse as redes oficiais dos membros da comunidade.",
    `**${members.length} ${members.length === 1 ? "membro cadastrado" : "membros cadastrados"}** - **${linkCount} ${linkCount === 1 ? "link ativo" : "links ativos"}**`
  ].join("\n");
}

function buildMemberFields(members: SocialMember[], baseLength: number) {
  const fields: Array<{ inline: boolean; name: string; value: string }> = [];
  let totalLength = baseLength;

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];

    if (!member) {
      continue;
    }

    const field = formatMemberField(member);
    const nextLength = totalLength + field.name.length + field.value.length;

    if (fields.length >= MAX_MEMBER_FIELDS || nextLength > MAX_EMBED_TOTAL_CHARS) {
      const remaining = members.length - index;

      if (remaining > 0) {
        fields.push({
          inline: false,
          name: "Mais membros",
          value: `Mais ${remaining} ${remaining === 1 ? "membro cadastrado" : "membros cadastrados"} no painel.`
        });
      }

      break;
    }

    fields.push(field);
    totalLength = nextLength;
  }

  return fields;
}

function formatMemberField(member: SocialMember) {
  const links = activeLinks(member);
  const name = truncateFieldName(
    member.role
      ? `${escapeMarkdownText(member.name)} - ${escapeMarkdownText(member.role)}`
      : escapeMarkdownText(member.name)
  );

  if (!links.length) {
    return {
      inline: false,
      name,
      value: "Nenhuma rede cadastrada."
    };
  }

  return {
    inline: false,
    name,
    value: truncateFieldValue(
      links.map((link) => `**${platformTag(link.id)}** [${escapeMarkdownText(link.label)}](${link.url})`).join("  |  ")
    )
  };
}

function buildComponents(members: SocialMember[]) {
  const buttons: ButtonBuilder[] = [];

  for (const member of members) {
    for (const link of activeLinks(member)) {
      if (buttons.length >= 25) {
        break;
      }

      buttons.push(
        new ButtonBuilder()
          .setLabel(buttonLabel(member, link, members.length))
          .setStyle(ButtonStyle.Link)
          .setURL(link.url)
      );
    }

    if (buttons.length >= 25) {
      break;
    }
  }

  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
}

function buttonLabel(member: SocialMember, link: ReturnType<typeof activeLinks>[number], memberCount: number) {
  return truncateButtonLabel(memberCount === 1 ? link.buttonLabel : `${member.name} - ${link.buttonLabel}`);
}

function activeLinks(member: SocialMember) {
  return SOCIAL_META.map((meta) => ({
    ...meta,
    url: member.links[meta.id]?.trim() ?? ""
  })).filter((link) => isHttpUrl(link.url));
}

function isEventForThisBot(event: SocialPanelUpdateEvent) {
  return (event.botId ?? null) === ((currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID) || null);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function truncateButtonLabel(value: string) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function truncateFieldName(value: string) {
  return value.length > 256 ? `${value.slice(0, 253)}...` : value;
}

function truncateFieldValue(value: string) {
  return value.length > 1024 ? `${value.slice(0, 1020)}...` : value;
}

function singleMemberAvatar(members: SocialMember[]) {
  if (members.length !== 1) {
    return null;
  }

  const avatar = members[0]?.avatar?.trim() ?? "";
  return isHttpUrl(avatar) ? avatar : null;
}

function platformTag(platform: SocialPlatform) {
  const tags: Record<SocialPlatform, string> = {
    facebook: "FB",
    instagram: "IG",
    kick: "KICK",
    tiktok: "TT",
    twitch: "TV",
    twitter: "X",
    website: "WEB",
    youtube: "YT"
  };

  return tags[platform];
}

function parseEmbedColor(value?: string | null) {
  const color = /^#[0-9a-f]{6}$/i.test(value ?? "") ? value ?? "#00D4FF" : "#00D4FF";
  return Number.parseInt(color.replace("#", ""), 16);
}

function escapeMarkdownText(value: string) {
  return value.replace(/([\\*_`~|>\[\]()])/g, "\\$1");
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(value);
}
