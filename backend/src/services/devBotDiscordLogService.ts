import axios from "axios";
import { env } from "../config/env";

const DISCORD_API = "https://discord.com/api/v10";
const DEV_BOT_LOG_GUILD_ID = "1505184193766752386";
const DEV_BOT_LOG_CATEGORY_ID = "1505623725293441217";
const channelCache = new Map<string, string>();

type DiscordChannel = {
  id: string;
  name: string;
  parent_id?: string | null;
  topic?: string | null;
  type: number;
};

export type DevBotUnexpectedExitLogInput = {
  botId: string;
  botName: string;
  clientId: string;
  detail: string;
  message: string;
  status: "offline" | "error" | "invalid_token";
};

export async function sendDevBotUnexpectedExitLog(input: DevBotUnexpectedExitLogInput) {
  if (!env.DISCORD_BOT_TOKEN.trim()) {
    console.warn("[dev-bot-log] DISCORD_BOT_TOKEN nao configurado; log Discord ignorado.");
    return;
  }

  try {
    const channelId = await ensureBotLogChannel(input);
    await discordRequest("POST", `/channels/${channelId}/messages`, {
      embeds: [buildUnexpectedExitEmbed(input)]
    });
  } catch (error) {
    console.warn("[dev-bot-log] falha ao enviar log de queda do bot:", error instanceof Error ? error.message : error);
  }
}

async function ensureBotLogChannel(input: DevBotUnexpectedExitLogInput) {
  const cachedChannelId = channelCache.get(input.botId);

  if (cachedChannelId) {
    return cachedChannelId;
  }

  const marker = channelMarker(input.botId);
  const channels = await discordRequest<DiscordChannel[]>("GET", `/guilds/${DEV_BOT_LOG_GUILD_ID}/channels`);
  const existing = channels.find((channel) => (
    channel.type === 0
    && channel.parent_id === DEV_BOT_LOG_CATEGORY_ID
    && channel.topic?.includes(marker)
  ));

  if (existing) {
    channelCache.set(input.botId, existing.id);
    return existing.id;
  }

  const created = await discordRequest<DiscordChannel>("POST", `/guilds/${DEV_BOT_LOG_GUILD_ID}/channels`, {
    name: channelName(input),
    parent_id: DEV_BOT_LOG_CATEGORY_ID,
    topic: `Logs automaticos do bot ${input.botName} | ${marker}`,
    type: 0
  });

  channelCache.set(input.botId, created.id);
  return created.id;
}

function buildUnexpectedExitEmbed(input: DevBotUnexpectedExitLogInput) {
  const errorColor = input.status === "error" ? 0xef4444 : 0xf59e0b;

  return {
    color: errorColor,
    title: "Bot desligou sozinho",
    description: input.message,
    fields: [
      {
        name: "Bot",
        value: `${input.botName}\n\`${input.botId}\``,
        inline: false
      },
      {
        name: "Client ID",
        value: `\`${input.clientId}\``,
        inline: true
      },
      {
        name: "Status",
        value: input.status,
        inline: true
      },
      {
        name: "Saida",
        value: input.detail,
        inline: false
      }
    ],
    timestamp: new Date().toISOString()
  };
}

async function discordRequest<T>(method: "GET" | "POST", path: string, data?: unknown) {
  const response = await axios.request<T>({
    method,
    url: `${DISCORD_API}${path}`,
    data,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    timeout: 10_000
  });

  return response.data;
}

function channelMarker(botId: string) {
  return `dev-bot-log:${botId}`;
}

function channelName(input: DevBotUnexpectedExitLogInput) {
  const name = input.botName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 70);
  const suffix = input.clientId.slice(-6) || input.botId.slice(0, 6);

  return `logs-${name || "bot"}-${suffix}`;
}
