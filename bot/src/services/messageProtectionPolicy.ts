import { PermissionFlagsBits, type GuildMember, type Message } from "discord.js";
import type { SelfBotProtectionModuleId, SelfBotProtectionSettings } from "./apiClient";

const LINK_MODULES = new Set<SelfBotProtectionModuleId>([
  "anti-links",
  "anti-convites",
  "anti-divulgacao",
  "anti-scam",
  "anti-phishing",
  "anti-token-grabber",
  "anti-nitro-scam"
]);
const MEDIA_MODULES = new Set<SelfBotProtectionModuleId>(["anti-imagens", "anti-gif", "anti-anexos"]);
const URL_CANDIDATE_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()\]]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>()\]]*)?/gi;

export type MessageProtectionReason =
  | "system_disabled"
  | "module_disabled"
  | "channel_allowed"
  | "category_allowed"
  | "user_ignored"
  | "role_ignored"
  | "administrator"
  | "domain_allowed"
  | "channel_not_protected"
  | null;

export type MessageProtectionDecision = {
  allowed: boolean;
  categoryId: string | null;
  channelId: string;
  matchedId: string | null;
  moduleId: SelfBotProtectionModuleId;
  parentChannelId: string | null;
  reason: MessageProtectionReason;
};

export function isChannelIgnoredOrAllowed(
  message: Message,
  settings: SelfBotProtectionSettings,
  moduleId: SelfBotProtectionModuleId,
  options: { domains?: string[]; member?: GuildMember | null; respectAdministrator?: boolean } = {}
): MessageProtectionDecision {
  const channel = resolveMessageChannel(message);
  const base = { ...channel, allowed: true, matchedId: null, moduleId };

  if (settings.enabled !== true) return { ...base, reason: "system_disabled" };
  if (settings.moduleToggles[moduleId] !== true) return { ...base, reason: "module_disabled" };

  const moduleAllowedIds = MEDIA_MODULES.has(moduleId)
    ? settings.mediaChannelIds
    : LINK_MODULES.has(moduleId)
      ? settings.linkChannelIds
      : [];
  const moduleMatch = matchChannelContext(channel, moduleAllowedIds);
  if (moduleMatch) {
    return { ...base, matchedId: moduleMatch.id, reason: moduleMatch.kind === "category" ? "category_allowed" : "channel_allowed" };
  }

  const globalMatch = matchChannelContext(channel, settings.ignoredChannelIds);
  if (globalMatch) {
    return { ...base, matchedId: globalMatch.id, reason: globalMatch.kind === "category" ? "category_allowed" : "channel_allowed" };
  }
  if (channel.categoryId && settings.ignoredCategoryIds.includes(channel.categoryId)) {
    return { ...base, matchedId: channel.categoryId, reason: "category_allowed" };
  }

  if (settings.ignoredUserIds.includes(message.author.id)) {
    return { ...base, matchedId: message.author.id, reason: "user_ignored" };
  }

  const member = options.member ?? message.member;
  const ignoredRoleId = member?.roles.cache.find((role) => settings.ignoredRoleIds.includes(role.id))?.id ?? null;
  if (ignoredRoleId) return { ...base, matchedId: ignoredRoleId, reason: "role_ignored" };

  if ((options.respectAdministrator ?? true) && member && (
    member.id === message.guild?.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)
  )) {
    return { ...base, matchedId: member.id, reason: "administrator" };
  }

  if (LINK_MODULES.has(moduleId) && options.domains?.length && options.domains.every((domain) => isDomainAllowed(domain, settings.allowedDomains, settings.allowSubdomains))) {
    return { ...base, matchedId: options.domains.join(","), reason: "domain_allowed" };
  }

  if (settings.protectedChannelIds.length && !matchChannelContext(channel, settings.protectedChannelIds)) {
    return { ...base, reason: "channel_not_protected" };
  }

  return { ...base, allowed: false, reason: null };
}

export function extractMessageDomains(content: string) {
  return extractUrlCandidates(content)
    .filter((value) => !isDiscordInternalUrl(value) && !isDiscordAttachmentUrl(value))
    .map(normalizeDomain)
    .filter((value): value is string => Boolean(value));
}

export function extractUrlCandidates(content: string) {
  return content.match(URL_CANDIDATE_PATTERN) ?? [];
}

export function normalizeDomain(value: string) {
  const candidate = value.trim().replace(/[),.;!?]+$/, "");
  if (!candidate) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function isDomainAllowed(domain: string, allowedDomains: string[], allowSubdomains = true) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return allowedDomains.some((allowed) => {
    const normalizedAllowed = normalizeDomain(allowed);
    return Boolean(normalizedAllowed && (
      normalized === normalizedAllowed || (allowSubdomains && normalized.endsWith(`.${normalizedAllowed}`))
    ));
  });
}

export function isDiscordInternalUrl(value: string) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "discord.com" || host === "discordapp.com") && /^\/channels\/\d+\/\d+(?:\/\d+)?\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isDiscordAttachmentUrl(value: string) {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase();
    return host === "cdn.discordapp.com" || host === "media.discordapp.net";
  } catch {
    return false;
  }
}

function resolveMessageChannel(message: Message) {
  const parentChannelId = message.channel.isThread() ? message.channel.parentId : null;
  const categoryId = message.channel.isThread()
    ? message.channel.parent?.parentId ?? null
    : "parentId" in message.channel ? message.channel.parentId : null;
  return { categoryId, channelId: message.channelId, parentChannelId };
}

function matchChannelContext(
  channel: ReturnType<typeof resolveMessageChannel>,
  ids: string[]
): { id: string; kind: "category" | "channel" } | null {
  if (ids.includes(channel.channelId)) return { id: channel.channelId, kind: "channel" };
  if (channel.parentChannelId && ids.includes(channel.parentChannelId)) return { id: channel.parentChannelId, kind: "channel" };
  if (channel.categoryId && ids.includes(channel.categoryId)) return { id: channel.categoryId, kind: "category" };
  return null;
}
