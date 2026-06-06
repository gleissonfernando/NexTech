import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type MessageMentionOptions
} from "discord.js";
import { env } from "../config/env";
import type { ApiClient, SocialNotification } from "./apiClient";
import { getTwitchStream, type TwitchStream } from "./twitchApiService";

let running = false;

export function startSocialNotificationMonitor(client: Client, api: ApiClient) {
  const run = () => {
    void monitorTwitchNotifications(client, api).catch((error) => {
      console.warn("[social-notifications] monitor falhou:", error instanceof Error ? error.message : error);
    });
  };

  run();
  const interval = setInterval(run, env.TWITCH_MONITOR_INTERVAL_MS);
  interval.unref();
}

async function monitorTwitchNotifications(client: Client, api: ApiClient) {
  if (running) {
    return;
  }

  running = true;

  try {
    const notifications = await api.getActiveTwitchNotifications();

    for (const notification of notifications) {
      if (!client.guilds.cache.has(notification.guildId)) {
        continue;
      }

      await processNotification(client, api, notification);
      await delay(700);
    }
  } finally {
    running = false;
  }
}

async function processNotification(client: Client, api: ApiClient, notification: SocialNotification) {
  const stream = await getTwitchStream(notification.twitchChannelName);

  if (!stream) {
    if (notification.isLive) {
      await api.updateTwitchNotificationState(notification.id, {
        isLive: false
      });
      await api.notifyLive({
        guildId: notification.guildId,
        type: "ended",
        streamer: notification.twitchChannelName,
        url: notification.twitchChannelUrl
      });
    }

    return;
  }

  if (notification.lastStreamId === stream.id) {
    if (!notification.isLive) {
      await api.updateTwitchNotificationState(notification.id, {
        isLive: true
      });
    }

    return;
  }

  const messageId = await sendLiveAlert(client, notification, stream);

  await api.updateTwitchNotificationState(notification.id, {
    isLive: true,
    lastLiveAt: stream.startedAt,
    lastStreamId: stream.id,
    lastMessageId: messageId
  });
  await api.notifyLive({
    guildId: notification.guildId,
    type: "started",
    streamer: stream.userName || notification.twitchChannelName,
    title: stream.title,
    url: `https://www.twitch.tv/${stream.userLogin}`
  });
}

async function sendLiveAlert(client: Client, notification: SocialNotification, stream: TwitchStream) {
  const channel = await client.channels.fetch(notification.discordChannelId).catch(() => null);

  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error(`Canal Discord ${notification.discordChannelId} nao encontrado.`);
  }

  const streamUrl = `https://www.twitch.tv/${stream.userLogin}`;
  const thumbnailUrl = stream.thumbnailUrl.replace("{width}", "1280").replace("{height}", "720");
  const embed = new EmbedBuilder()
    .setColor(normalizeEmbedColor(notification.embedColor))
    .setAuthor({
      name: `${stream.userName || notification.twitchChannelName} is now live on Twitch!`,
      iconURL: notification.twitchAvatar ?? undefined,
      url: streamUrl
    })
    .setDescription(`[@${stream.userLogin}](${streamUrl}) esta ao vivo!`)
    .addFields(
      {
        name: "Game",
        value: stream.gameName || "Sem categoria",
        inline: true
      },
      {
        name: "Viewers",
        value: String(stream.viewerCount || 0),
        inline: true
      }
    )
    .setImage(thumbnailUrl)
    .setFooter({
      text: `Ricardinn98 lives - Hoje as ${formatTime(new Date())}`
    })
    .setTimestamp(new Date(stream.startedAt));

  const mention = formatMention(notification);
  const content = [mention.content, notification.customMessage || null].filter(Boolean).join("\n");
  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Watch Stream")
        .setStyle(ButtonStyle.Link)
        .setURL(streamUrl)
    )
  ];

  const message = await channel.send({
    allowedMentions: mention.allowedMentions,
    content,
    components,
    embeds: [embed]
  });

  return message.id;
}

function formatMention(notification: SocialNotification): { content: string | null; allowedMentions: MessageMentionOptions } {
  if (!notification.mentionRoleId) {
    return {
      content: null,
      allowedMentions: {
        parse: []
      }
    };
  }

  if (notification.mentionRoleId === "everyone" || notification.mentionRoleId === notification.guildId) {
    return {
      content: "@everyone",
      allowedMentions: {
        parse: ["everyone"] as const
      }
    };
  }

  return {
    content: `<@&${notification.mentionRoleId}>`,
    allowedMentions: {
      parse: [],
      roles: [notification.mentionRoleId]
    }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEmbedColor(value?: string | null) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as `#${string}`) : "#9146FF";
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}
