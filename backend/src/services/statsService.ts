import axios from "axios";
import { env } from "../config/env";
import type { DashboardGuild } from "./guildService";
import { discordGuildIconUrl } from "./guildService";

const DISCORD_API = "https://discord.com/api/v10";

export type BotGuildDto = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount?: number;
  channelCount?: number;
  shardId?: number;
};

export type BotResponseTimeStatus = "good" | "warn" | "critical" | "offline";

export type BotResponseTimePoint = {
  at: string;
  latencyMs: number | null;
  status: BotResponseTimeStatus;
};

export type BotResponseTimeStats = {
  averageMs: number | null;
  currentMs: number | null;
  history: BotResponseTimePoint[];
  maxMs: number | null;
  minMs: number | null;
  samples: number;
  status: BotResponseTimeStatus;
  updatedAt: string;
};

export type BotStatusDto = {
  botId?: string | null;
  botProfile?: {
    avatarUrl: string | null;
    id: string;
    username: string;
  } | null;
  online: boolean;
  latency: number;
  guilds: number;
  users: number;
  botGuilds: BotGuildDto[];
  shardIds?: number[];
  shardCount?: number;
  instanceId?: string;
  memory?: {
    heapUsedMb: number;
    rssMb: number;
  };
  responseTime: BotResponseTimeStats;
  updatedAt: string;
};

let botStatus: BotStatusDto = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  botGuilds: [],
  responseTime: emptyResponseTimeStats(),
  updatedAt: new Date().toISOString()
};

type BotStatusInput = Partial<Omit<BotStatusDto, "updatedAt" | "botGuilds">> & {
  botGuilds?: BotGuildDto[];
};

type ShardReport = {
  input: BotStatusInput;
  receivedAt: number;
};

const SHARD_REPORT_TTL_MS = 90_000;
const shardReports = new Map<string, Map<string, ShardReport>>();
const MAX_RESPONSE_TIME_SAMPLES = 120;
const responseTimeHistory = new Map<string, BotResponseTimePoint[]>();

type DiscordBotGuild = {
  id: string;
  name: string;
  icon: string | null;
  approximate_member_count?: number;
};

export function getBotStatus() {
  return botStatus;
}

export function updateBotStatus(input: BotStatusInput) {
  const aggregatedInput = aggregateShardStatus(input);
  const botGuilds = aggregatedInput.botGuilds ? normalizeBotGuilds(aggregatedInput.botGuilds) : botStatus.botGuilds;
  const nextStatus = {
    ...botStatus,
    ...aggregatedInput,
    botGuilds,
    guilds: aggregatedInput.guilds ?? botGuilds.length
  };
  const botKey = responseTimeKey(nextStatus);
  const shouldRecordResponseTime = typeof aggregatedInput.latency === "number" || typeof aggregatedInput.online === "boolean";
  const responseTime = shouldRecordResponseTime
    ? recordResponseTime(botKey, nextStatus.online, nextStatus.latency)
    : getResponseTimeStats(botKey);

  botStatus = {
    ...nextStatus,
    responseTime,
    updatedAt: new Date().toISOString()
  };

  return botStatus;
}

function responseTimeKey(status: Pick<BotStatusDto, "botId" | "botProfile">) {
  return status.botId?.trim() || status.botProfile?.id || "default";
}

function recordResponseTime(botKey: string, online: boolean, latency: number) {
  const point: BotResponseTimePoint = {
    at: new Date().toISOString(),
    latencyMs: online ? Math.max(0, Math.round(latency)) : null,
    status: online ? classifyResponseTime(latency) : "offline"
  };
  const history = [...(responseTimeHistory.get(botKey) ?? []), point].slice(-MAX_RESPONSE_TIME_SAMPLES);
  responseTimeHistory.set(botKey, history);
  return summarizeResponseTime(history);
}

function getResponseTimeStats(botKey: string) {
  const history = responseTimeHistory.get(botKey) ?? [];
  return history.length ? summarizeResponseTime(history) : emptyResponseTimeStats();
}

function summarizeResponseTime(history: BotResponseTimePoint[]): BotResponseTimeStats {
  const samples = history.map((point) => point.latencyMs).filter((value): value is number => typeof value === "number");
  const last = history.at(-1);

  return {
    averageMs: samples.length ? Math.round(samples.reduce((total, value) => total + value, 0) / samples.length) : null,
    currentMs: last?.latencyMs ?? null,
    history,
    maxMs: samples.length ? Math.max(...samples) : null,
    minMs: samples.length ? Math.min(...samples) : null,
    samples: history.length,
    status: last?.status ?? "offline",
    updatedAt: last?.at ?? new Date().toISOString()
  };
}

function emptyResponseTimeStats(): BotResponseTimeStats {
  const now = new Date().toISOString();
  return {
    averageMs: null,
    currentMs: null,
    history: [],
    maxMs: null,
    minMs: null,
    samples: 0,
    status: "offline",
    updatedAt: now
  };
}

function classifyResponseTime(latency: number): BotResponseTimeStatus {
  if (latency >= 800) return "critical";
  if (latency >= 250) return "warn";
  return "good";
}

function aggregateShardStatus(input: BotStatusInput): BotStatusInput {
  if (!input.instanceId || !input.shardIds?.length || (input.shardCount ?? 1) <= 1) {
    return input;
  }

  const now = Date.now();
  const botKey = input.botId?.trim() || input.botProfile?.id || "default";
  const reports = shardReports.get(botKey) ?? new Map<string, ShardReport>();
  reports.set(input.instanceId, { input, receivedAt: now });

  for (const [instanceId, report] of reports) {
    if (now - report.receivedAt > SHARD_REPORT_TTL_MS) {
      reports.delete(instanceId);
    }
  }

  shardReports.set(botKey, reports);
  const currentReports = [...reports.values()].map((report) => report.input);
  const guildsById = new Map<string, BotGuildDto>();
  const ids = new Set<number>();

  for (const report of currentReports) {
    for (const guild of report.botGuilds ?? []) {
      guildsById.set(guild.id, guild);
    }
    if (report.online !== false) {
      for (const shardId of report.shardIds ?? []) {
        ids.add(shardId);
      }
    }
  }

  const onlineReports = currentReports.filter((report) => report.online !== false);
  const latencySamples = onlineReports.map((report) => report.latency).filter((value): value is number => typeof value === "number");
  const memorySamples = onlineReports.map((report) => report.memory).filter((value): value is NonNullable<BotStatusDto["memory"]> => Boolean(value));
  const botGuilds = [...guildsById.values()];

  return {
    ...input,
    botProfile: currentReports.find((report) => report.botProfile)?.botProfile ?? input.botProfile,
    online: onlineReports.length > 0,
    latency: latencySamples.length ? Math.round(latencySamples.reduce((total, value) => total + value, 0) / latencySamples.length) : 0,
    guilds: botGuilds.length,
    users: botGuilds.reduce((total, guild) => total + (guild.memberCount ?? 0), 0),
    botGuilds,
    shardIds: [...ids].sort((left, right) => left - right),
    shardCount: Math.max(...currentReports.map((report) => report.shardCount ?? 1)),
    memory: memorySamples.length
      ? {
          heapUsedMb: memorySamples.reduce((total, value) => total + value.heapUsedMb, 0),
          rssMb: memorySamples.reduce((total, value) => total + value.rssMb, 0)
        }
      : undefined
  };
}

export function getBotGuildIds() {
  return new Set([...botStatus.botGuilds.map((guild) => guild.id), ...getConfiguredDashboardGuildIds()]);
}

export function filterGuildsForBot(guilds: DashboardGuild[]) {
  const botGuildsById = new Map(botStatus.botGuilds.map((guild) => [guild.id, guild]));

  return guilds
    .filter((guild) => botGuildsById.has(guild.id))
    .map((guild) => {
      const botGuild = botGuildsById.get(guild.id);

      return {
        ...guild,
        name: botGuild?.name ?? guild.name,
        iconUrl: botGuild?.iconUrl ?? guild.iconUrl,
        botEnabled: true,
        memberCount: botGuild?.memberCount ?? guild.memberCount,
        channelCount: botGuild?.channelCount ?? guild.channelCount
      };
    });
}

export function mergeAuthorizedBotGuilds(guilds: DashboardGuild[]) {
  const filteredGuilds = filterGuildsForBot(guilds);
  const persistedBotGuilds = guilds.filter((guild) => guild.botEnabled);
  const guildsById = new Map([...persistedBotGuilds, ...filteredGuilds].map((guild) => [guild.id, {
    ...guild,
    isAdmin: true,
    botEnabled: true
  }]));

  for (const guildId of getConfiguredDashboardGuildIds()) {
    const fallbackGuild = guildsById.get(guildId) ?? guilds.find((guild) => guild.id === guildId);
    const botGuild = botStatus.botGuilds.find((guild) => guild.id === guildId);

    guildsById.set(guildId, {
      id: guildId,
      name: botGuild?.name ?? fallbackGuild?.name ?? "Servidor configurado",
      iconUrl: botGuild?.iconUrl ?? fallbackGuild?.iconUrl ?? null,
      owner: false,
      isAdmin: true,
      botEnabled: true,
      memberCount: botGuild?.memberCount ?? fallbackGuild?.memberCount ?? 0,
      channelCount: botGuild?.channelCount ?? fallbackGuild?.channelCount ?? 0
    });
  }

  for (const botGuild of botStatus.botGuilds) {
    guildsById.set(botGuild.id, {
      id: botGuild.id,
      name: botGuild.name,
      iconUrl: botGuild.iconUrl,
      owner: false,
      isAdmin: true,
      botEnabled: true,
      memberCount: botGuild.memberCount ?? 0,
      channelCount: botGuild.channelCount ?? 0
    });
  }

  return [...guildsById.values()];
}

export async function refreshBotGuildsFromDiscord() {
  if (!env.DISCORD_BOT_TOKEN) {
    return botStatus.botGuilds;
  }

  try {
    const { data } = await axios.get<DiscordBotGuild[]>(`${DISCORD_API}/users/@me/guilds`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`
      },
      params: {
        with_counts: true
      },
      timeout: 3500
    });
    const botGuilds = data.map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: discordGuildIconUrl(guild),
      memberCount: guild.approximate_member_count
    }));

    updateBotStatus({
      botGuilds,
      guilds: botGuilds.length,
      users: botGuilds.reduce((total, guild) => total + (guild.memberCount ?? 0), 0)
    });

    return botGuilds;
  } catch (error) {
    console.warn("[discord] não foi possível sincronizar servidores do bot:", error instanceof Error ? error.message : error);
    return botStatus.botGuilds;
  }
}

export function createDashboardStats() {
  return {
    botStatus,
    activeLives: 0,
    ticketsOpen: 0,
    logsToday: 0,
    updatedAt: new Date().toISOString()
  };
}

function normalizeBotGuilds(guilds: BotGuildDto[]) {
  return guilds
    .filter((guild) => guild.id)
    .map((guild) => ({
      ...guild,
      name: guild.name || `Guild ${guild.id}`,
      iconUrl: guild.iconUrl ?? null
    }));
}

function getConfiguredDashboardGuildIds() {
  return env.DASHBOARD_GUILD_IDS.split(",")
    .map((guildId) => guildId.trim())
    .filter(Boolean);
}
