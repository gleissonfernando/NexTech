import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions
} from "discord.js";
import { env } from "../config/env";
import type { BotSocketClient, SocialPanelUpdateEvent } from "../websocket/socketClient";
import type { ApiClient, SocialMember, SocialPanelPayload, SocialPlatform } from "./apiClient";

type WritableGuildTextChannel = {
  guildId: string;
  messages: {
    fetch: (messageId: string) => Promise<Message>;
  };
  send: (options: MessageCreateOptions) => Promise<Message>;
};

const syncingPanels = new Set<string>();
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

  const messagePayload = buildPanelMessage(payload);
  const existingMessage = panel.messageId ? await fetchMessage(channel, panel.messageId) : null;

  if (existingMessage) {
    await existingMessage.edit(messagePayload as MessageEditOptions);
    await api.updateSocialPanelState(panel.id, {
      messageId: existingMessage.id,
      published: true
    });
    return;
  }

  const message = await channel.send(messagePayload);
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
  const embed = new EmbedBuilder()
    .setTitle("🌐 Network")
    .setColor(parseEmbedColor(payload.panel.embedColor))
    .setDescription(buildDescription(payload.members))
    .setFooter({
      text: `Network atualizada em ${formatDateTime(new Date())}`
    })
    .setTimestamp(new Date());

  return {
    allowedMentions: {
      parse: []
    },
    components: buildComponents(payload.members),
    content: "",
    embeds: [embed]
  };
}

function buildDescription(members: SocialMember[]) {
  const separator = "━━━━━━━━━━━━━━";
  let description = `Todas as redes sociais dos nossos membros.\n\n${separator}`;

  if (!members.length) {
    return `${description}\n\nNenhum membro cadastrado ainda.\n\n${separator}`;
  }

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];

    if (!member) {
      continue;
    }

    const section = `\n\n${formatMemberSection(member)}\n\n${separator}`;

    if (description.length + section.length > 3900) {
      const remaining = members.length - index;
      description += `\n\nMais ${remaining} membro${remaining === 1 ? "" : "s"} cadastrado${remaining === 1 ? "" : "s"} no painel.`;
      break;
    }

    description += section;
  }

  return description;
}

function formatMemberSection(member: SocialMember) {
  const links = activeLinks(member);
  const lines = [`👤 ${escapeMarkdownText(member.name)}`];

  if (member.role) {
    lines.push(`Cargo: ${escapeMarkdownText(member.role)}`);
  }

  if (!links.length) {
    lines.push("Sem redes cadastradas.");
    return lines.join("\n");
  }

  for (const link of links) {
    lines.push(`${link.icon} [${link.label}](${link.url})`);
  }

  return lines.join("\n");
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
          .setLabel(truncateButtonLabel(`${member.name} - ${link.buttonLabel}`))
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

function activeLinks(member: SocialMember) {
  return SOCIAL_META.map((meta) => ({
    ...meta,
    url: member.links[meta.id]?.trim() ?? ""
  })).filter((link) => isHttpUrl(link.url));
}

function isEventForThisBot(event: SocialPanelUpdateEvent) {
  return (event.botId ?? null) === (env.DASHBOARD_BOT_ID || null);
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
