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
};

export type BotStatusDto = {
  online: boolean;
  latency: number;
  guilds: number;
  users: number;
  botGuilds: BotGuildDto[];
  updatedAt: string;
};

let botStatus: BotStatusDto = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  botGuilds: [],
  updatedAt: new Date().toISOString()
};

type BotStatusInput = Partial<Omit<BotStatusDto, "updatedAt" | "botGuilds">> & {
  botGuilds?: BotGuildDto[];
};

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
  const botGuilds = input.botGuilds ? normalizeBotGuilds(input.botGuilds) : botStatus.botGuilds;

  botStatus = {
    ...botStatus,
    ...input,
    botGuilds,
    guilds: input.guilds ?? botGuilds.length,
    updatedAt: new Date().toISOString()
  };

  return botStatus;
}

export function getBotGuildIds() {
  return new Set([...botStatus.botGuilds.map((guild) => guild.id), ...getConfiguredDashboardGuildIds()]);
}

export function filterGuildsForBot(guilds: DashboardGuild[]) {
  if (!env.DASHBOARD_AUTH_REQUIRED && botStatus.botGuilds.length === 0) {
    return guilds;
  }

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
  const guildsById = new Map(filteredGuilds.map((guild) => [guild.id, guild]));

  for (const guildId of getConfiguredDashboardGuildIds()) {
    const botGuild = botStatus.botGuilds.find((guild) => guild.id === guildId);

    guildsById.set(guildId, {
      id: guildId,
      name: botGuild?.name ?? `Servidor ${guildId}`,
      iconUrl: botGuild?.iconUrl ?? null,
      owner: false,
      isAdmin: true,
      botEnabled: true,
      memberCount: botGuild?.memberCount ?? 0,
      channelCount: botGuild?.channelCount ?? 0
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
    console.warn("[discord] nao foi possivel sincronizar servidores do bot:", error instanceof Error ? error.message : error);
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
