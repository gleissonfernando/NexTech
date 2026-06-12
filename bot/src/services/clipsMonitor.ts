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
import type { ApiClient, ClipRewardAssignment, ClipsConfig } from "./apiClient";
import { createKickClipProvider } from "./clips/providers/kick";
import { createTwitchClipProvider } from "./clips/providers/twitch";
import type { ClipProvider, ProviderClip } from "./clips/providers/types";

let running = false;
const CLIPS_MONITOR_INTERVAL_MS = 30_000;
const CLIPS_CONFIG_CONCURRENCY = 5;
const providers: Record<ClipsConfig["platform"], ClipProvider> = {
  twitch: createTwitchClipProvider(),
  kick: createKickClipProvider()
};

export function startClipsMonitor(client: Client, api: ApiClient) {
  const run = () => {
    void monitorClips(client, api).catch((error) => {
      console.warn("[clips] monitor falhou:", error instanceof Error ? error.message : error);
    });
  };

  run();
  const interval = setInterval(run, CLIPS_MONITOR_INTERVAL_MS);
  interval.unref();
}

async function monitorClips(client: Client, api: ApiClient) {
  if (running) {
    return;
  }

  running = true;

  try {
    const configs = await api.getActiveClipConfigs();

    for (let index = 0; index < configs.length; index += CLIPS_CONFIG_CONCURRENCY) {
      await Promise.all(
        configs
          .slice(index, index + CLIPS_CONFIG_CONCURRENCY)
          .map((config) => processConfigSafely(client, api, config))
      );
    }
  } finally {
    running = false;
  }
}

async function processConfigSafely(client: Client, api: ApiClient, config: ClipsConfig) {
  try {
    await processConfig(client, api, config);
  } catch (error) {
    await api.postLog({
      guildId: config.guildId,
      type: "clips.error",
      message: error instanceof Error ? error.message : "Erro ao processar clipes.",
      metadata: {
        module: config.platform === "kick" ? "kick-clips" : "clips",
        configId: config.id,
        platform: config.platform,
        channelName: config.channelName
      }
    }).catch(() => undefined);
    console.warn(`[clips] config ${config.id} ignorada:`, error instanceof Error ? error.message : error);
  }
}

async function processConfig(client: Client, api: ApiClient, config: ClipsConfig) {
  const provider = providers[config.platform] ?? providers.twitch;
  const now = new Date();
  const liveSession = await provider.getLiveSession(config);

  await api.updateClipLiveSession(config.id, liveSession).catch((error: unknown) => {
    console.warn(`[clips] nao foi possivel atualizar sessao de live ${config.id}:`, formatErrorMessage(error));
  });

  if (!provider.supportsClipCapture) {
    await api.updateClipConfigCheck(config.id, now.toISOString());
    return;
  }

  if (!config.discordChannelId) {
    throw new Error("Canal do Discord nao configurado para o sistema de clipes.");
  }

  const lastCheckAt = config.lastCheckAt ? new Date(config.lastCheckAt) : null;
  const lookupBaseTime = lastCheckAt?.getTime() ?? now.getTime();
  const startedAt = new Date(Math.max(0, lookupBaseTime - env.CLIPS_LOOKBACK_MS));
  const clips = await provider.listClips(config, {
    endedAt: now.toISOString(),
    first: 20,
    startedAt: startedAt.toISOString()
  });
  const candidateClips = clips
    .filter((clip) => new Date(clip.createdAt).getTime() >= startedAt.getTime())
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  let attemptedClips = 0;
  const maxClipsPerCheck = Math.max(1, env.CLIPS_MAX_PER_CHECK);

  for (const clip of candidateClips) {
    if (attemptedClips >= maxClipsPerCheck) {
      break;
    }

    if (await api.isClipSent(config.id, clip.id)) {
      continue;
    }

    attemptedClips += 1;
    let messageId: string;

    try {
      messageId = await sendClipAlert(client, config, clip);
    } catch (error) {
      const discordErrorMessage = formatErrorMessage(error);
      console.warn(`[clips] clipe ${clip.id} ainda nao enviado ao Discord: ${discordErrorMessage}`);
      await api.postLog({
        guildId: config.guildId,
        type: "clips.discord_retry",
        message: `Falha temporaria ao enviar clipe; nova tentativa em ate 30 segundos: ${discordErrorMessage}`,
        metadata: {
          module: config.platform === "kick" ? "kick-clips" : "clips",
          configId: config.id,
          clipId: clip.id,
          clipUrl: clip.url,
          platform: config.platform,
          channelName: config.channelName
        }
      }).catch(() => undefined);
      continue;
    }

    const result = await api.recordClipSent(config.id, {
      clipId: clip.id,
      clipTitle: clip.title,
      clipUrl: clip.url,
      clipThumbnail: clip.thumbnailUrl,
      clipCreatorName: clip.creatorName,
      clipDuration: clip.durationSeconds,
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

      return null;
    });

    if (result?.rewards?.length) {
      await applyClipRewards(client, api, config, result.rewards);
    }

    await delay(900);
  }

  await api.updateClipConfigCheck(config.id, now.toISOString());
}

async function sendClipAlert(client: Client, config: ClipsConfig, clip: ProviderClip) {
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
      throw new Error("Bot sem permissao para enviar mensagens ou embeds no canal de clipes.");
    }
  }

  const streamerName = config.displayName || config.channelName || config.twitchChannelName || config.kickChannelName || "Canal";
  const embed = new EmbedBuilder()
    .setColor(normalizeEmbedColor(config.embedColor))
    .setTitle("Novo Clipe Detectado")
    .setDescription(`Um novo corte foi criado na live de ${streamerName}.`)
    .addFields(
      {
        name: "Canal",
        value: streamerName,
        inline: true
      },
      {
        name: "Nome do Clipe",
        value: clip.title || "Sem titulo"
      },
      {
        name: "Criador",
        value: clip.creatorName || "Desconhecido",
        inline: true
      },
      {
        name: "Data",
        value: new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short"
        }).format(new Date(clip.createdAt)),
        inline: true
      },
      {
        name: "Link",
        value: clip.url
      }
    )
    .setFooter({
      text: `Sistema de Clips ${config.platform === "kick" ? "Kick" : "Twitch"} - ${"guild" in channel ? channel.guild.name : config.guildId}`
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

async function applyClipRewards(client: Client, api: ApiClient, config: ClipsConfig, rewards: ClipRewardAssignment[]) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);

  if (!guild) {
    return;
  }

  const uniqueRewards = new Map(rewards.map((reward) => [`${reward.userId}:${reward.roleId}`, reward]));

  for (const reward of uniqueRewards.values()) {
    try {
      const member = await guild.members.fetch(reward.userId);

      if (member.roles.cache.has(reward.roleId)) {
        continue;
      }

      await member.roles.add(reward.roleId, `Recompensa por ${reward.clipCount} clipes`);
      await api.postLog({
        guildId: config.guildId,
        type: "clips.reward_role",
        message: `Cargo ${reward.label} entregue para ${reward.userId} por ${reward.clipCount} clipes.`,
        metadata: {
          module: config.platform === "kick" ? "kick-clips" : "clips",
          platform: config.platform,
          configId: config.id,
          roleId: reward.roleId,
          userId: reward.userId
        }
      }).catch(() => undefined);
    } catch (error) {
      await api.postLog({
        guildId: config.guildId,
        type: "clips.reward_error",
        message: `Nao foi possivel entregar recompensa de clipes para ${reward.userId}: ${formatErrorMessage(error)}`,
        metadata: {
          module: config.platform === "kick" ? "kick-clips" : "clips",
          platform: config.platform,
          configId: config.id,
          roleId: reward.roleId,
          userId: reward.userId
        }
      }).catch(() => undefined);
    }
  }
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
