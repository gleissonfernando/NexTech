import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type MessageMentionOptions
} from "discord.js";
import { env } from "../config/env";
import type { ApiClient, ClipsConfig } from "./apiClient";
import { getTwitchClips, type TwitchClip } from "./twitchApiService";

let running = false;

export function startClipsMonitor(client: Client, api: ApiClient) {
  const run = () => {
    void monitorClips(client, api).catch((error) => {
      console.warn("[clips] monitor falhou:", error instanceof Error ? error.message : error);
    });
  };

  run();
  const interval = setInterval(run, env.CLIPS_MONITOR_INTERVAL_MS);
  interval.unref();
}

async function monitorClips(client: Client, api: ApiClient) {
  if (running) {
    return;
  }

  running = true;

  try {
    const configs = await api.getActiveClipConfigs();

    for (const config of configs) {
      try {
        await processConfig(client, api, config);
      } catch (error) {
        await api.postLog({
          guildId: config.guildId,
          type: "clips.error",
          message: error instanceof Error ? error.message : "Erro ao processar clips.",
          metadata: {
            module: "clips",
            configId: config.id,
            twitchChannelName: config.twitchChannelName
          }
        }).catch(() => undefined);
        console.warn(`[clips] config ${config.id} ignorada:`, error instanceof Error ? error.message : error);
      }

      await delay(700);
    }
  } finally {
    running = false;
  }
}

async function processConfig(client: Client, api: ApiClient, config: ClipsConfig) {
  if (!config.twitchBroadcasterId) {
    return;
  }

  const lastCheckAt = config.lastCheckAt ? new Date(config.lastCheckAt) : null;
  const now = new Date();

  const effectiveCheckInterval = Math.min(config.checkInterval, env.CLIPS_MONITOR_INTERVAL_MS);

  if (lastCheckAt && now.getTime() - lastCheckAt.getTime() < effectiveCheckInterval) {
    return;
  }

  const lookupBaseTime = lastCheckAt?.getTime() ?? now.getTime();
  const startedAt = new Date(Math.max(0, lookupBaseTime - env.CLIPS_LOOKBACK_MS));
  const clips = await getTwitchClips({
    broadcasterId: config.twitchBroadcasterId,
    endedAt: now.toISOString(),
    first: 20,
    startedAt: startedAt.toISOString()
  });
  const candidateClips = clips
    .filter((clip) => new Date(clip.createdAt).getTime() >= startedAt.getTime())
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  let recordedClips = 0;
  const maxClipsPerCheck = Math.max(1, env.CLIPS_MAX_PER_CHECK);

  for (const clip of candidateClips) {
    if (recordedClips >= maxClipsPerCheck) {
      break;
    }

    if (await api.isClipSent(config.id, clip.id)) {
      continue;
    }

    let messageId: string | null = null;
    let discordErrorMessage: string | null = null;

    if (config.discordChannelId) {
      try {
        messageId = await sendClipAlert(client, config, clip);
      } catch (error) {
        discordErrorMessage = formatErrorMessage(error);
      }
    }

    await api.recordClipSent(config.id, {
      clipId: clip.id,
      clipTitle: clip.title,
      clipUrl: clip.url,
      clipThumbnail: clip.thumbnailUrl,
      clipCreatorName: clip.creatorName,
      createdAtTwitch: clip.createdAt,
      discordChannelId: config.discordChannelId,
      discordMessageId: messageId
    }).catch((error: unknown) => {
      const status = typeof error === "object" && error && "response" in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;

      if (status !== 409) {
        throw error;
      }
    });
    recordedClips += 1;

    if (discordErrorMessage) {
      console.warn(`[clips] clip ${clip.id} registrado, mas nao enviado ao Discord: ${discordErrorMessage}`);
      await api.postLog({
        guildId: config.guildId,
        type: "clips.discord_error",
        message: `Clip registrado na aba, mas nao enviado ao Discord: ${discordErrorMessage}`,
        metadata: {
          module: "clips",
          configId: config.id,
          clipId: clip.id,
          clipUrl: clip.url,
          twitchChannelName: config.twitchChannelName
        }
      }).catch(() => undefined);
    }

    await delay(900);
  }

  await api.updateClipConfigCheck(config.id, now.toISOString());
}

async function sendClipAlert(client: Client, config: ClipsConfig, clip: TwitchClip) {
  const channel = await client.channels.fetch(config.discordChannelId ?? "").catch(() => null);

  if (
    !channel?.isTextBased()
    || !("send" in channel)
    || !("guildId" in channel)
    || channel.guildId !== config.guildId
  ) {
    throw new Error(`Canal Discord ${config.discordChannelId} nao encontrado.`);
  }

  if ("permissionsFor" in channel && client.user) {
    const permissions = channel.permissionsFor(client.user.id);

    if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      throw new Error("Bot sem permissao para enviar mensagens ou embeds no canal de clips.");
    }
  }

  const streamerName = config.twitchDisplayName || config.twitchChannelName;
  const embed = new EmbedBuilder()
    .setColor(normalizeEmbedColor(config.embedColor))
    .setTitle("Novo clipe criado!")
    .setDescription(`Um novo corte foi criado na live de ${streamerName}.`)
    .addFields(
      {
        name: "Titulo",
        value: clip.title || "Sem titulo"
      },
      {
        name: "Criado por",
        value: clip.creatorName || "Desconhecido",
        inline: true
      },
      {
        name: "Canal",
        value: streamerName,
        inline: true
      },
      {
        name: "Assistir",
        value: clip.url
      }
    )
    .setFooter({
      text: `Sistema de Clips - ${"guild" in channel ? channel.guild.name : config.guildId}`
    })
    .setTimestamp(new Date(clip.createdAt));

  if (clip.thumbnailUrl) {
    embed.setImage(clip.thumbnailUrl);
  }

  const mention = formatMention(config);
  const content = [mention.content, renderClipMessage(config.customMessage, streamerName)].filter(Boolean).join("\n");
  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Assistir Clipe")
        .setStyle(ButtonStyle.Link)
        .setURL(clip.url)
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

function formatMention(config: ClipsConfig): { content: string | null; allowedMentions: MessageMentionOptions } {
  if (config.mentionType === "everyone") {
    return {
      content: "@everyone",
      allowedMentions: {
        parse: ["everyone"] as const
      }
    };
  }

  if (config.mentionType === "role" && config.mentionRoleId) {
    return {
      content: `<@&${config.mentionRoleId}>`,
      allowedMentions: {
        parse: [],
        roles: [config.mentionRoleId]
      }
    };
  }

  return {
    content: null,
    allowedMentions: {
      parse: []
    }
  };
}

function renderClipMessage(message: string | null, streamer: string) {
  return message?.replace(/\{streamer\}/gi, streamer) ?? null;
}

function normalizeEmbedColor(value?: string | null) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as `#${string}`) : "#9146FF";
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido.";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
