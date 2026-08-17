import axios from "axios";
import { env } from "../config/env";

const DISCORD_API = "https://discord.com/api/v10";
const DEV_BOT_LOG_GUILD_ID = "1505184193766752386";
const DEV_BOT_LOG_CATEGORY_ID = "1505623725293441217";
const RESOLVED_CHANNEL_DELETE_DELAY_MS = 5_000;
const RESOLVED_LOG_FLUSH_DELAY_MS = 1_000;
const DISCORD_CHANNEL_MUTATION_DELAY_MS = 600;
const channelCache = new Map<string, string>();
const pendingResolvedLogs = new Map<string, DevBotResolvedLogInput>();
let resolvedLogFlushTimer: NodeJS.Timeout | null = null;
let resolvedLogFlushRunning = false;
let lastLogTargetWarningAt = 0;

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

export type DevBotResolvedLogInput = {
  botId: string;
  botName: string;
  clientId: string;
  message?: string;
};

export async function sendDevBotUnexpectedExitLog(input: DevBotUnexpectedExitLogInput) {
  if (!env.DISCORD_BOT_TOKEN.trim()) {
    console.warn("[dev-bot-log] DISCORD_BOT_TOKEN não configurado; log Discord ignorado.");
    return;
  }

  try {
    const channelId = await ensureBotLogChannel(input);
    await discordRequest("POST", `/channels/${channelId}/messages`, {
      embeds: [buildUnexpectedExitEmbed(input)]
    });
  } catch (error) {
    console.warn("[dev-bot-log] falha ao enviar log de queda do bot:", discordErrorDetails(error));
  }
}

export async function resolveDevBotUnexpectedExitLog(input: DevBotResolvedLogInput) {
  if (!env.DISCORD_BOT_TOKEN.trim()) {
    console.warn("[dev-bot-log] DISCORD_BOT_TOKEN não configurado; resolução de log Discord ignorada.");
    return;
  }

  pendingResolvedLogs.set(input.botId, input);
  scheduleResolvedLogFlush();
}

function scheduleResolvedLogFlush() {
  if (resolvedLogFlushTimer || resolvedLogFlushRunning) {
    return;
  }

  resolvedLogFlushTimer = setTimeout(() => {
    resolvedLogFlushTimer = null;
    void flushResolvedLogQueue();
  }, RESOLVED_LOG_FLUSH_DELAY_MS);
  resolvedLogFlushTimer.unref();
}

async function flushResolvedLogQueue() {
  if (resolvedLogFlushRunning) {
    return;
  }

  resolvedLogFlushRunning = true;

  try {
    while (pendingResolvedLogs.size > 0) {
      const inputs = [...pendingResolvedLogs.values()];
      pendingResolvedLogs.clear();
      await resolveBotLogChannels(inputs);
    }
  } finally {
    resolvedLogFlushRunning = false;

    if (pendingResolvedLogs.size > 0) {
      scheduleResolvedLogFlush();
    }
  }
}

async function resolveBotLogChannels(inputs: DevBotResolvedLogInput[]) {
  const channels = await safeFetchBotLogChannels();

  if (!channels) {
    return;
  }

  const deleteCandidates: Array<{ botId: string; channelId: string }> = [];

  for (const input of inputs) {
    const channel = findChannelByBotId(channels, input.botId);

    if (!channel) {
      channelCache.delete(input.botId);
      continue;
    }

    try {
      await discordRequest("POST", `/channels/${channel.id}/messages`, {
        embeds: [buildResolvedEmbed(input)]
      });
      deleteCandidates.push({ botId: input.botId, channelId: channel.id });
    } catch (error) {
      if (isDiscordStatus(error, 404)) {
        channelCache.delete(input.botId);
      } else {
        console.warn("[dev-bot-log] falha ao enviar aviso de resolução:", discordErrorDetails(error));
      }
    }

    await delay(DISCORD_CHANNEL_MUTATION_DELAY_MS);
  }

  if (deleteCandidates.length === 0) {
    return;
  }

  await delay(RESOLVED_CHANNEL_DELETE_DELAY_MS);

  for (const candidate of deleteCandidates) {
    try {
      await discordRequest("DELETE", `/channels/${candidate.channelId}`);
    } catch (error) {
      if (!isDiscordStatus(error, 404)) {
        console.warn("[dev-bot-log] falha ao apagar canal temporario resolvido:", discordErrorDetails(error));
      }
    } finally {
      channelCache.delete(candidate.botId);
    }

    await delay(DISCORD_CHANNEL_MUTATION_DELAY_MS);
  }
}

async function ensureBotLogChannel(input: DevBotUnexpectedExitLogInput) {
  const existingChannelId = await findBotLogChannel(input.botId);

  if (existingChannelId) {
    return existingChannelId;
  }

  const created = await discordRequest<DiscordChannel>("POST", `/guilds/${devBotLogGuildId()}/channels`, {
    name: channelName(input),
    parent_id: devBotLogCategoryId(),
    topic: `Logs automaticos do bot ${input.botName} | ${channelMarker(input.botId)}`,
    type: 0
  });

  channelCache.set(input.botId, created.id);
  return created.id;
}

async function findBotLogChannel(botId: string) {
  const cachedChannelId = channelCache.get(botId);

  if (cachedChannelId) {
    return cachedChannelId;
  }

  const channels = await discordRequest<DiscordChannel[]>("GET", `/guilds/${devBotLogGuildId()}/channels`);
  const existing = findChannelByBotId(channels, botId);

  if (existing) {
    channelCache.set(botId, existing.id);
    return existing.id;
  }

  return null;
}

async function safeFetchBotLogChannels() {
  try {
    return await discordRequest<DiscordChannel[]>("GET", `/guilds/${devBotLogGuildId()}/channels`);
  } catch (error) {
    if (isDiscordStatus(error, 403) || isDiscordStatus(error, 404)) {
      warnLogTargetAccessOnce("[dev-bot-log] servidor/categoria de logs temporarios não acessível; resolução de canais ignorada.");
      return null;
    }

    console.warn("[dev-bot-log] falha ao listar canais de logs temporarios:", discordErrorDetails(error));
    return null;
  }
}

function findChannelByBotId(channels: DiscordChannel[], botId: string) {
  const cachedChannelId = channelCache.get(botId);
  const marker = channelMarker(botId);
  const existing = channels.find((channel) => (
    channel.type === 0
    && channel.parent_id === devBotLogCategoryId()
    && (channel.id === cachedChannelId || channel.topic?.includes(marker))
  ));

  if (existing) {
    channelCache.set(botId, existing.id);
  }

  return existing ?? null;
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
        name: "Saída",
        value: input.detail,
        inline: false
      }
    ],
    timestamp: new Date().toISOString()
  };
}

function buildResolvedEmbed(input: DevBotResolvedLogInput) {
  return {
    color: 0x22c55e,
    title: "Erro resolvido",
    description: input.message ?? "O bot voltou a ficar pronto. Este canal temporario sera removido automaticamente.",
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
        value: "ready",
        inline: true
      }
    ],
    timestamp: new Date().toISOString()
  };
}

async function discordRequest<T>(method: "GET" | "POST" | "DELETE", path: string, data?: unknown) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
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
    } catch (error) {
      if (attempt === 0 && isDiscordStatus(error, 429)) {
        await delay(discordRetryAfterMs(error));
        continue;
      }

      throw error;
    }
  }

  throw new Error("Falha inesperada na requisição Discord.");
}

function devBotLogGuildId() {
  return process.env.DEV_BOT_LOG_GUILD_ID?.trim()
    || process.env.DISCORD_DEV_BOT_LOG_GUILD_ID?.trim()
    || DEV_BOT_LOG_GUILD_ID;
}

function devBotLogCategoryId() {
  return process.env.DEV_BOT_LOG_CATEGORY_ID?.trim()
    || process.env.DISCORD_DEV_BOT_LOG_CATEGORY_ID?.trim()
    || DEV_BOT_LOG_CATEGORY_ID;
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

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isDiscordStatus(error: unknown, status: number) {
  return axios.isAxiosError(error) && error.response?.status === status;
}

function discordRetryAfterMs(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return 2_000;
  }

  const retryAfter = Number((error.response?.data as { retry_after?: unknown } | undefined)?.retry_after);
  const headerRetryAfter = Number(error.response?.headers?.["retry-after"]);
  const seconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter
    : Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
      ? headerRetryAfter
      : 2;

  return Math.ceil(seconds * 1_000) + 250;
}

function warnLogTargetAccessOnce(message: string) {
  const now = Date.now();

  if (now - lastLogTargetWarningAt < 60_000) {
    return;
  }

  lastLogTargetWarningAt = now;
  console.warn(message);
}

function discordErrorDetails(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const status = error.response?.status;
  const method = error.config?.method?.toUpperCase() ?? "HTTP";
  const url = sanitizeDiscordUrl(error.config?.url);
  const message = readDiscordErrorMessage(error.response?.data) ?? error.message;
  return `Discord ${method} ${url} falhou${status ? ` com ${status}` : ""}: ${message}`;
}

function sanitizeDiscordUrl(url: string | undefined) {
  if (!url) {
    return "request";
  }

  return url.replace(DISCORD_API, "");
}

function readDiscordErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}
