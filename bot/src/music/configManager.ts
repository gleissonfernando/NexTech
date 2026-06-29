import { PermissionFlagsBits, type GuildMember } from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotContext } from "../types";
import type { MusicConfig } from "./types";

const CACHE_MS = 15_000;
const cache = new Map<string, { config: MusicConfig; expiresAt: number }>();

export const defaultMusicConfig: MusicConfig = {
  enabled: false,
  commandChannelId: null,
  allowedChannelIds: [],
  blockedChannelIds: [],
  djRoleId: null,
  permissionMode: "everyone",
  allowedRoleIds: [],
  blockedUserIds: [],
  defaultVolume: 50,
  queueLimit: 100,
  playlistLimit: 50,
  artistLimit: 25,
  cooldownSeconds: 5,
  maxTrackMinutes: 15,
  idleDisconnectSeconds: 30,
  allowPlaylists: true,
  allowLinks: true,
  allowArtistSearch: true,
  logChannelId: null
};

export async function getMusicConfig(context: BotContext, guildId: string) {
  const botId = currentRuntimeBotId();

  if (!botId) return defaultMusicConfig;

  const key = `${botId}:${guildId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const runtime = await context.api.getBotGuildConfig(botId, guildId);
  const raw = runtime.modules.music ?? {};
  const config = normalizeMusicConfig(raw);
  cache.set(key, { config, expiresAt: Date.now() + CACHE_MS });
  return config;
}

export function canUseMusic(member: GuildMember, config: MusicConfig) {
  if (config.blockedUserIds.includes(member.id)) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.djRoleId && member.roles.cache.has(config.djRoleId)) return true;
  if (config.permissionMode === "administrators") return false;
  if (config.permissionMode === "roles") {
    return config.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  }
  return true;
}

function normalizeMusicConfig(raw: Record<string, unknown>): MusicConfig {
  return {
    enabled: raw.enabled === true,
    commandChannelId: optionalId(raw.commandChannelId),
    allowedChannelIds: idArray(raw.allowedChannelIds),
    blockedChannelIds: idArray(raw.blockedChannelIds),
    djRoleId: optionalId(raw.djRoleId),
    permissionMode: ["everyone", "roles", "administrators"].includes(String(raw.permissionMode))
      ? raw.permissionMode as MusicConfig["permissionMode"]
      : defaultMusicConfig.permissionMode,
    allowedRoleIds: idArray(raw.allowedRoleIds),
    blockedUserIds: idArray(raw.blockedUserIds),
    defaultVolume: integer(raw.defaultVolume, 10, 100, 50),
    queueLimit: integer(raw.queueLimit, 1, 500, 100),
    playlistLimit: integer(raw.playlistLimit, 1, 100, 50),
    artistLimit: integer(raw.artistLimit, 1, 50, 25),
    cooldownSeconds: integer(raw.cooldownSeconds, 0, 60, 5),
    maxTrackMinutes: integer(raw.maxTrackMinutes, 1, 180, 15),
    idleDisconnectSeconds: integer(raw.idleDisconnectSeconds, 5, 600, 30),
    allowPlaylists: raw.allowPlaylists !== false,
    allowLinks: raw.allowLinks !== false,
    allowArtistSearch: raw.allowArtistSearch !== false,
    logChannelId: optionalId(raw.logChannelId)
  };
}

function integer(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function optionalId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function idArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^\d{5,32}$/.test(item)))].slice(0, 250)
    : [];
}
