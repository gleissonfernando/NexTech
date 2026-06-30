import { PermissionFlagsBits, type Message } from "discord.js";
import type { BotContext } from "../types";
import type { SelfBotProtectionSettings } from "./apiClient";
import { runtimeScopeKey } from "./runtimeModuleGuard";

const CACHE_MS = 30_000;
const cache = new Map<string, { expiresAt: number; settings: SelfBotProtectionSettings }>();
let listenerStarted = false;

export type ModerationChannelDecision = {
  ignored: boolean;
  reason: "bot" | "immune" | "whitelisted" | null;
  settings: SelfBotProtectionSettings | null;
};

export async function canModerateMessage(message: Message, context: BotContext, moduleId: string): Promise<ModerationChannelDecision> {
  if (!message.guild || message.author.bot) return decision(true, "bot", null, message, moduleId);
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member && (member.id === message.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator))) {
    return decision(true, "immune", null, message, moduleId);
  }
  const settings = await getModerationSettings(message.guild.id, context).catch((error) => {
    console.warn("[moderation-whitelist] não foi possível consultar a whitelist; processamento seguirá sem bloqueio:", error instanceof Error ? error.message : String(error));
    return null;
  });
  if (!settings) return decision(false, null, null, message, moduleId);
  if (containsChannel(message, effectiveWhitelist(settings))) return decision(true, "whitelisted", settings, message, moduleId);
  return decision(false, null, settings, message, moduleId);
}

export async function getModerationSettings(guildId: string, context: BotContext) {
  startInvalidationListener(context);
  const key = runtimeScopeKey(guildId);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.settings;
  const settings = await context.api.getSelfBotProtectionSettings(guildId);
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, settings });
  return settings;
}

export function isWhitelistedChannel(message: Message, channelIds: string[]) {
  return containsChannel(message, channelIds);
}

export function isChannelIdWhitelisted(channelId: string, parentId: string | null, channelIds: string[]) {
  return channelIds.includes(channelId) || Boolean(parentId && channelIds.includes(parentId));
}

function containsChannel(message: Message, ids: string[]) {
  const parentId = message.channel.isThread() ? message.channel.parentId : null;
  return isChannelIdWhitelisted(message.channelId, parentId, ids);
}

function effectiveWhitelist(settings: SelfBotProtectionSettings) {
  return [...new Set([...settings.ignoredChannelIds, ...settings.mediaChannelIds, ...settings.linkChannelIds])];
}

function startInvalidationListener(context: BotContext) {
  if (listenerStarted) return;
  listenerStarted = true;
  context.socket.onSelfBotProtectionSettingsUpdated(({ guildId }) => cache.delete(runtimeScopeKey(guildId)));
}

function decision(ignored: boolean, reason: ModerationChannelDecision["reason"], settings: SelfBotProtectionSettings | null, message: Message, moduleId: string) {
  if (process.env.MODERATION_WHITELIST_DEBUG === "true") {
    console.debug("[moderation-whitelist]", { moduleId, guildId: message.guildId, channelId: message.channelId, parentId: message.channel.isThread() ? message.channel.parentId : null, whitelisted: reason === "whitelisted", ignored, reason });
  }
  return { ignored, reason, settings };
}
