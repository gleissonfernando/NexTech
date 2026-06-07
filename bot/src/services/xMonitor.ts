import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client
} from "discord.js";
import { env } from "../config/env";
import type { XMonitorPostEvent, XMonitorUpdateEvent } from "../websocket/socketClient";
import type { ApiClient, XAccount, XPost } from "./apiClient";
import type { BotSocketClient } from "../websocket/socketClient";

let running = false;
const X_ACCOUNT_CONCURRENCY = 5;

export function startXMonitor(client: Client, api: ApiClient, socket: BotSocketClient) {
  const run = () => {
    void monitorXAccounts(client, api).catch((error) => {
      console.warn("[x-monitor] monitor falhou:", error instanceof Error ? error.message : error);
    });
  };

  socket.onXMonitorUpdate((event) => {
    if (!isEventForThisBot(event) || event.action !== "account_saved" || !event.account?.id) {
      return;
    }

    void processAccountById(client, api, event.account.id).catch((error) => {
      console.warn("[x-monitor] sync imediato falhou:", error instanceof Error ? error.message : error);
    });
  });
  socket.onXMonitorPost((event) => {
    if (!isPostEventForThisBot(event) || !client.guilds.cache.has(event.account.guildId)) {
      return;
    }

    void sendAndRecordPost(client, api, event.account, event.post).catch((error) => {
      console.warn("[x-monitor] envio via webhook falhou:", error instanceof Error ? error.message : error);
    });
  });

  run();
  const interval = setInterval(run, Math.max(15_000, env.X_MONITOR_INTERVAL_MS));
  interval.unref();
}

async function monitorXAccounts(client: Client, api: ApiClient) {
  if (running) {
    return;
  }

  running = true;

  try {
    const accounts = await api.getActiveXAccounts();
    const eligibleAccounts = accounts.filter((account) => client.guilds.cache.has(account.guildId));

    for (let index = 0; index < eligibleAccounts.length; index += X_ACCOUNT_CONCURRENCY) {
      await Promise.all(
        eligibleAccounts
          .slice(index, index + X_ACCOUNT_CONCURRENCY)
          .map((account) => processAccountSafely(client, api, account))
      );
    }
  } finally {
    running = false;
  }
}

async function processAccountById(client: Client, api: ApiClient, accountId: string) {
  const result = await api.syncXAccount(accountId);

  if (!client.guilds.cache.has(result.account.guildId)) {
    return;
  }

  for (const post of result.posts) {
    await sendAndRecordPost(client, api, result.account, post);
    await delay(900);
  }
}

async function processAccountSafely(client: Client, api: ApiClient, account: XAccount) {
  try {
    const result = await api.syncXAccount(account.id);

    for (const post of result.posts) {
      await sendAndRecordPost(client, api, result.account, post);
      await delay(900);
    }
  } catch (error) {
    console.warn(`[x-monitor] conta @${account.username} ignorada:`, error instanceof Error ? error.message : error);
  }
}

async function sendAndRecordPost(client: Client, api: ApiClient, account: XAccount, post: XPost) {
  let messageId: string;

  try {
    messageId = await sendXPostAlert(client, account, post);
  } catch (error) {
    const message = formatErrorMessage(error);
    await api.recordXDiscordFailure(account.id, message).catch(() => undefined);
    console.warn(`[x-monitor] postagem ${post.id} ainda nao enviada ao Discord: ${message}`);
    return;
  }

  await api.recordXPostSent(account.id, {
    channelId: account.channelId,
    discordMessageId: messageId,
    xPostCreatedAt: post.createdAt,
    xPostId: post.id,
    xPostUrl: post.url
  }).catch((error: unknown) => {
    const status = typeof error === "object" && error && "response" in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;

    if (status !== 409) {
      throw error;
    }
  });
}

async function sendXPostAlert(client: Client, account: XAccount, post: XPost) {
  const channel = await client.channels.fetch(account.channelId).catch(() => null);

  if (
    !channel?.isTextBased()
    || !("send" in channel)
    || !("guildId" in channel)
    || channel.guildId !== account.guildId
  ) {
    throw new Error(`Canal Discord ${account.channelId} nao encontrado.`);
  }

  if ("permissionsFor" in channel && client.user) {
    const permissions = channel.permissionsFor(client.user.id);

    if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      throw new Error("Bot sem permissao para enviar mensagens ou embeds no canal do X Monitor.");
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setAuthor({
      iconURL: account.avatar ?? undefined,
      name: `${account.displayName} (@${account.username})`,
      url: `https://x.com/${account.username}`
    })
    .setTitle("Nova publicacao no X")
    .setDescription(truncate(post.text || "Publicacao sem texto.", 3900))
    .addFields(
      {
        name: "Publicado em",
        value: formatDateTime(new Date(post.createdAt)),
        inline: true
      },
      {
        name: "Link",
        value: post.url,
        inline: false
      }
    )
    .setFooter({
      text: "X Monitor"
    })
    .setTimestamp(new Date(post.createdAt));

  if (account.avatar) {
    embed.setThumbnail(account.avatar);
  }

  if (post.mediaUrls[0]) {
    embed.setImage(post.mediaUrls[0]);
  }

  if (post.mediaUrls.length > 1) {
    embed.addFields({
      name: "Imagens adicionais",
      value: post.mediaUrls.slice(1, 4).join("\n")
    });
  }

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Abrir no X")
        .setStyle(ButtonStyle.Link)
        .setURL(post.url)
    )
  ];
  const message = await channel.send({
    allowedMentions: {
      parse: []
    },
    components,
    embeds: [embed]
  });

  return message.id;
}

function isEventForThisBot(event: XMonitorUpdateEvent) {
  return (event.botId ?? null) === (env.DASHBOARD_BOT_ID || null);
}

function isPostEventForThisBot(event: XMonitorPostEvent) {
  return (event.botId ?? null) === (env.DASHBOARD_BOT_ID || null);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(value);
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido.";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
