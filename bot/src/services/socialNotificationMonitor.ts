import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type Message,
  type MessageMentionOptions
} from "discord.js";
import { env } from "../config/env";
import type { ApiClient, SocialNotification } from "./apiClient";
import { getTwitchStreams, type TwitchStream } from "./twitchApiService";

let running = false;
const TWITCH_BATCH_SIZE = 100;
const NOTIFICATION_CONCURRENCY = 25;
const LIVE_PREVIEW_REFRESH_DELAY_MS = 30_000;
const LIVE_PANEL_BRAND = "vortex lives";
const TWITCH_LOOKUP_PREFIX = {
  login: "login:",
  user: "user:"
} as const;

export function startSocialNotificationMonitor(client: Client, api: ApiClient) {
  console.log(`[social-notifications] monitor Twitch iniciado; intervalo ${env.TWITCH_MONITOR_INTERVAL_MS}ms.`);

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
    const streamsByLookupKey = new Map<string, TwitchStream>();
    const unresolvedLookupKeys = new Set<string>();
    const twitchUserIds = [...new Set(
      eligibleNotifications
        .map((notification) => notification.twitchUserId?.trim())
        .filter((value): value is string => Boolean(value))
    )];
    const channelNames = [...new Set(
      eligibleNotifications
        .filter((notification) => !notification.twitchUserId?.trim())
        .map((notification) => notification.twitchChannelName.toLowerCase())
    )];

    for (let index = 0; index < twitchUserIds.length; index += TWITCH_BATCH_SIZE) {
      const userIdBatch = twitchUserIds.slice(index, index + TWITCH_BATCH_SIZE);

      try {
        const batchStreams = await getTwitchStreams({ userIds: userIdBatch });

        for (const userId of userIdBatch) {
          const stream = batchStreams.get(userId);

          if (stream) {
            streamsByLookupKey.set(twitchUserLookupKey(userId), stream);
            streamsByLookupKey.set(channelLookupKey(stream.userLogin), stream);
          }
        }
      } catch (error) {
        for (const userId of userIdBatch) {
          unresolvedLookupKeys.add(twitchUserLookupKey(userId));
        }

        console.warn("[social-notifications] lote Twitch por ID falhou:", error instanceof Error ? error.message : error);
      }
    }

    for (let index = 0; index < channelNames.length; index += TWITCH_BATCH_SIZE) {
      const channelBatch = channelNames.slice(index, index + TWITCH_BATCH_SIZE);

      try {
        const batchStreams = await getTwitchStreams(channelBatch);

        for (const channelName of channelBatch) {
          const stream = batchStreams.get(channelName);

          if (stream) {
            streamsByLookupKey.set(channelLookupKey(channelName), stream);
            streamsByLookupKey.set(twitchUserLookupKey(stream.userId), stream);
          }
        }
      } catch (error) {
        for (const channelName of channelBatch) {
          unresolvedLookupKeys.add(channelLookupKey(channelName));
        }

        console.warn("[social-notifications] lote Twitch por canal falhou:", error instanceof Error ? error.message : error);
      }
    }

    await mapWithConcurrency(eligibleNotifications, NOTIFICATION_CONCURRENCY, async (notification) => {
      try {
        await processNotification(
          client,
          api,
          notification,
          streamsByLookupKey.get(notificationLookupKey(notification)) ?? null,
          unresolvedLookupKeys.has(notificationLookupKey(notification))
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
  stream: TwitchStream | null,
  lookupUnresolved: boolean
) {
  if (lookupUnresolved) {
    return;
  }

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

function notificationLookupKey(notification: SocialNotification) {
  const twitchUserId = notification.twitchUserId?.trim();

  if (twitchUserId) {
    return twitchUserLookupKey(twitchUserId);
  }

  return channelLookupKey(notification.twitchChannelName);
}

function twitchUserLookupKey(userId: string) {
  return `${TWITCH_LOOKUP_PREFIX.user}${userId.trim()}`;
}

function channelLookupKey(channelName: string) {
  return `${TWITCH_LOOKUP_PREFIX.login}${channelName.trim().toLowerCase()}`;
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
  const previewImageUrl = buildLivePreviewImageUrl(stream.thumbnailUrl, stream.userLogin);
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
    .setImage(previewImageUrl)
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

  scheduleLivePreviewRefresh(message, embed, stream);

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

function scheduleLivePreviewRefresh(message: Message, embed: EmbedBuilder, stream: TwitchStream) {
  const timer = setTimeout(() => {
    const refreshedEmbed = EmbedBuilder.from(embed)
      .setImage(buildLivePreviewImageUrl(stream.thumbnailUrl, stream.userLogin));

    void message.edit({
      embeds: [refreshedEmbed]
    }).catch((error) => {
      console.warn("[social-notifications] nao foi possivel atualizar a preview da live:", error instanceof Error ? error.message : error);
    });
  }, LIVE_PREVIEW_REFRESH_DELAY_MS);

  timer.unref();
}

function buildLivePreviewImageUrl(thumbnailUrl: string | null | undefined, channelName: string) {
  const normalizedChannelName = channelName.trim().toLowerCase();
  const sizedThumbnailUrl = thumbnailUrl?.trim()
    .replace("{width}", "1280")
    .replace("{height}", "720");
  const previewUrl = sizedThumbnailUrl || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${normalizedChannelName}-1280x720.jpg`;

  return appendCacheBuster(previewUrl);
}

function appendCacheBuster(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`;
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
