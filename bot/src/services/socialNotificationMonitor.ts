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
import { getTwitchStreams, type TwitchStream } from "./twitchApiService";

let running = false;
const TWITCH_BATCH_SIZE = 100;
const NOTIFICATION_CONCURRENCY = 25;
const LIVE_PANEL_BRAND = "vortex lives";

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
    const eligibleNotifications = notifications.filter((notification) => client.guilds.cache.has(notification.guildId));
    const streamsByChannel = new Map<string, TwitchStream>();
    const channelNames = [...new Set(
      eligibleNotifications.map((notification) => notification.twitchChannelName.toLowerCase())
    )];

    for (let index = 0; index < channelNames.length; index += TWITCH_BATCH_SIZE) {
      const batchStreams = await getTwitchStreams(channelNames.slice(index, index + TWITCH_BATCH_SIZE));

      for (const [channelName, stream] of batchStreams) {
        streamsByChannel.set(channelName, stream);
      }
    }

    await mapWithConcurrency(eligibleNotifications, NOTIFICATION_CONCURRENCY, async (notification) => {
      try {
        await processNotification(
          client,
          api,
          notification,
          streamsByChannel.get(notification.twitchChannelName.toLowerCase()) ?? null
        );
      } catch (error) {
        console.warn(
          `[social-notifications] notificacao ${notification.id} ignorada:`,
          error instanceof Error ? error.message : error
        );
      }
    });
  } finally {
    running = false;
  }
}

async function processNotification(
  client: Client,
  api: ApiClient,
  notification: SocialNotification,
  stream: TwitchStream | null
) {
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

  if (
    !channel?.isTextBased()
    || !("send" in channel)
    || !("guildId" in channel)
    || channel.guildId !== notification.guildId
  ) {
    throw new Error(`Canal Discord ${notification.discordChannelId} nao encontrado.`);
  }

  const streamUrl = `https://www.twitch.tv/${stream.userLogin}`;
  const thumbnailUrl = stream.thumbnailUrl.replace("{width}", "1280").replace("{height}", "720");
  const streamerName = stream.userName || notification.twitchChannelName;
  const embed = new EmbedBuilder()
    .setColor(normalizeEmbedColor(notification.embedColor))
    .setAuthor({
      name: `${streamerName} is now live on Twitch!`,
      iconURL: notification.twitchAvatar ?? undefined,
      url: streamUrl
    })
    .setTitle(formatLiveTitle(stream.title))
    .setURL(streamUrl)
    .setDescription(renderLiveDescription(notification, stream, streamUrl))
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
      text: livePanelFooter(new Date())
    });

  const mention = formatMention(notification);
  const content = mention.content ?? undefined;
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

function renderLiveDescription(notification: SocialNotification, stream: TwitchStream, streamUrl: string) {
  const channelLine = `[@${stream.userLogin}](${streamUrl})`;
  const customMessage = notification.customMessage?.trim();

  if (!customMessage) {
    return `${channelLine} esta ao vivo!`;
  }

  return `${channelLine} ${customMessage}`;
}

function formatLiveTitle(title?: string | null) {
  const normalizedTitle = title?.trim();
  return normalizedTitle || "Live ao vivo";
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

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;

      if (item !== undefined) {
        await handler(item);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker()
    )
  );
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

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(value);
}

function livePanelFooter(value: Date) {
  return `${LIVE_PANEL_BRAND} - Hoje \u00e0s ${formatTime(value)} - ${formatDateTime(value)}`;
}
