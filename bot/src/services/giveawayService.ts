import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type GuildTextBasedChannel,
  type Interaction,
  type MessageCreateOptions,
  type MessageEditOptions
} from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";
import type { ApiClient, Giveaway, GiveawayStatus } from "./apiClient";
import { assertPanelChannelPermissions, pinPanelMessage } from "./panelDeliveryService";
import type { BotSocketClient, GiveawayPanelUpdateEvent } from "../websocket/socketClient";

type WritableGuildTextChannel = GuildTextBasedChannel;

const syncingGiveaways = new Set<string>();

export function startGiveawayService(client: Client, api: ApiClient, socket: BotSocketClient) {
  socket.onGiveawayPanelUpdate((event) => {
    if (!isEventForThisBot(event)) {
      return;
    }

    void syncGiveawayById(client, api, event.giveawayId).catch((error) => {
      console.warn("[giveaway] falha ao sincronizar painel:", error instanceof Error ? error.message : error);
    });
  });

  void syncActiveGiveaways(client, api).catch((error) => {
    console.warn("[giveaway] sincronizacao inicial falhou:", error instanceof Error ? error.message : error);
  });
}

export async function handleGiveawayInteraction(interaction: Interaction, context: BotContext) {
  if (!interaction.isButton()) {
    return false;
  }

  if (interaction.customId.startsWith("giveaway_winners:")) {
    const giveawayId = interaction.customId.split(":")[1];

    if (!giveawayId) {
      await interaction.reply({
        content: "Sorteio invalido.",
        ephemeral: true
      });
      return true;
    }

    const giveaway = await context.api.getGiveaway(giveawayId).catch(() => null);

    if (!giveaway) {
      await interaction.reply({
        content: "Sorteio nao encontrado.",
        ephemeral: true
      });
      return true;
    }

    await interaction.reply({
      content: formatWinnersMessage(giveaway),
      ephemeral: true
    });
    return true;
  }

  if (interaction.customId.startsWith("giveaway_closed:")) {
    await interaction.reply({
      content: "Esta roleta ja foi encerrada.",
      ephemeral: true
    });
    return true;
  }

  return false;
}

async function syncActiveGiveaways(client: Client, api: ApiClient) {
  const giveaways = await api.getActiveGiveaways();

  for (const giveaway of giveaways) {
    if (!client.guilds.cache.has(giveaway.guildId)) {
      continue;
    }

    await syncGiveawayPanel(client, api, giveaway);
  }
}

async function syncGiveawayById(client: Client, api: ApiClient, giveawayId: string) {
  if (syncingGiveaways.has(giveawayId)) {
    return;
  }

  syncingGiveaways.add(giveawayId);

  try {
    const giveaway = await api.getGiveaway(giveawayId);

    if (!client.guilds.cache.has(giveaway.guildId)) {
      return;
    }

    await syncGiveawayPanel(client, api, giveaway);
  } finally {
    syncingGiveaways.delete(giveawayId);
  }
}

async function syncGiveawayPanel(client: Client, api: ApiClient, giveaway: Giveaway) {
  if (!giveaway.discordChannelId) {
    return;
  }

  const channel = await fetchWritableChannel(client, giveaway.discordChannelId, giveaway.guildId);

  if (!channel) {
    throw new Error(`Canal ${giveaway.discordChannelId} nao encontrado para o sorteio.`);
  }

  assertPanelChannelPermissions(channel, client, "Sorteio");

  const messagePayload = buildGiveawayMessage(giveaway);
  const existingMessage = giveaway.panelMessageId ? await fetchMessage(channel, giveaway.panelMessageId) : null;

  if (existingMessage) {
    const edited = await existingMessage.edit(messagePayload as MessageEditOptions);
    await pinPanelMessage(edited, "Sorteio");
    await api.updateGiveawayPanelState(giveaway.id, {
      panelMessageId: existingMessage.id
    });
    return;
  }

  const message = await channel.send(messagePayload);
  await pinPanelMessage(message, "Sorteio");
  await api.updateGiveawayPanelState(giveaway.id, {
    panelMessageId: message.id
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

function buildGiveawayMessage(giveaway: Giveaway): MessageCreateOptions {
  const status = giveawayStatus(giveaway.status);
  const winnersText = giveaway.winners.length
    ? giveaway.winners.map((winner, index) => `${index + 1}. ${escapeMarkdownText(winner.displayName)}`).join("\n")
    : "Nenhum ganhador ainda.";
  const description = giveaway.customMessage?.trim()
    || "Sorteio com verificacao Twitch/Kick pela roleta.";
  const totalTickets = giveaway.participants.reduce((total, participant) => total + Math.max(1, participant.tickets ?? 1), 0);
  const embed = new EmbedBuilder()
    .setTitle(giveaway.title)
    .setColor(status.color)
    .setDescription(description)
    .addFields(
      {
        name: "Premio",
        value: escapeMarkdownText(giveaway.prizeName),
        inline: true
      },
      {
        name: "Live",
        value: `[${escapeMarkdownText(giveaway.liveName)}](${giveaway.liveUrl})`,
        inline: true
      },
      {
        name: "Status",
        value: status.label,
        inline: true
      },
      {
        name: "Participantes",
        value: String(giveaway.participants.length),
        inline: true
      },
      {
        name: "Tickets",
        value: String(totalTickets),
        inline: true
      },
      {
        name: "Filtro",
        value: giveawayModeLabel(giveaway.participantMode),
        inline: true
      },
      {
        name: "Ganhadores",
        value: `${giveaway.winners.length}/${giveaway.winnerCount}`,
        inline: true
      },
      {
        name: "Lista de ganhadores",
        value: truncateField(winnersText)
      }
    )
    .setFooter({
      text: `Sorteio atualizado em ${formatDateTime(new Date())}`
    })
    .setTimestamp(new Date());

  return {
    allowedMentions: {
      parse: []
    },
    components: buildComponents(giveaway),
    content: "",
    embeds: [embed]
  };
}

function giveawayModeLabel(mode: Giveaway["participantMode"]) {
  const labels: Record<Giveaway["participantMode"], string> = {
    all: "Todos",
    kick_followers: "Followers Kick",
    kick_subs: "Subs Kick",
    twitch_followers: "Followers Twitch",
    twitch_kick: "Twitch + Kick",
    twitch_subs: "Subs Twitch",
    twitch_subs_followers: "Subs + Followers Twitch"
  };

  return labels[mode] ?? "Subs Twitch";
}

function buildComponents(giveaway: Giveaway) {
  const rouletteButton = giveaway.status === "ended"
    ? new ButtonBuilder()
        .setCustomId(`giveaway_closed:${giveaway.id}`)
        .setDisabled(true)
        .setLabel("Roleta Encerrada")
        .setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder()
        .setLabel(giveaway.status === "running" ? "Abrir Roleta" : "Entrar na Roleta")
        .setStyle(ButtonStyle.Link)
        .setURL(giveaway.rouletteUrl);
  const winnersButton = new ButtonBuilder()
    .setCustomId(`giveaway_winners:${giveaway.id}`)
    .setLabel("Ver Ganhadores")
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(rouletteButton, winnersButton)
  ];
}

function formatWinnersMessage(giveaway: Giveaway) {
  if (!giveaway.winners.length) {
    return `O sorteio "${giveaway.title}" ainda nao tem ganhadores.`;
  }

  return [
    `Ganhadores de "${giveaway.title}":`,
    ...giveaway.winners.map((winner, index) => `${index + 1}. ${winner.displayName} (@${winner.username})`)
  ].join("\n");
}

function giveawayStatus(status: GiveawayStatus) {
  if (status === "running") {
    return {
      color: 0x22c55e,
      label: "Em andamento"
    };
  }

  if (status === "ended") {
    return {
      color: 0xef4444,
      label: "Encerrado"
    };
  }

  return {
    color: 0xeab308,
    label: "Aguardando"
  };
}

function isEventForThisBot(event: GiveawayPanelUpdateEvent) {
  return (event.botId ?? null) === (env.DASHBOARD_BOT_ID || null);
}

function truncateField(value: string) {
  return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
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
