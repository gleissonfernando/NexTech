import { MessageFlags, type GuildMember, type PartialGuildMember } from "discord.js";
import { env } from "../config/env";
import type { BotContext, MemberPanelSection, PanelImageSettings } from "../types";
import { ensureGuildEmojiCache, resolveComponentEmoji } from "../utils/componentEmoji";
import { getCachedGuildSettings } from "./guildSettingsCache";
import { buildV2Container, renderPanelBlocks, resolvePanelImageUrl } from "./panelVisualRenderer";
import { replaceSystemEmojis } from "./systemEmojiService";

type MemberPanelMode = "welcome" | "leave";

type MemberPanelInput = {
  channelId: string | null;
  channelLabel: string | null;
  color: string;
  description: string | null;
  footerText: string | null;
  imageUrl: string | null;
  mode: MemberPanelMode;
  panelImage: PanelImageSettings | null;
  rules: string | null;
  rulesTitle: string | null;
  sections: MemberPanelSection[] | null;
  subtitle: string | null;
  title: string | null;
};

type VariableContext = {
  botName: string;
  channel: string;
  memberCount: string;
  server: string;
  user: string;
  username: string;
};

export async function sendWelcomeMessage(context: BotContext, member: GuildMember) {
  const settings = await getCachedGuildSettings(context, member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.welcomeEnabled || !settings.welcomeChannelId) {
    return;
  }

  const channel = await resolveTextChannel(member, settings.welcomeChannelId);

  if (!channel?.isSendable()) {
    return;
  }

  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const variables = panelVariables(member, displayChannelId);
  const payload = await createMemberPanelPayload(member, variables, {
    channelId: displayChannelId,
    channelLabel: settings.welcomeChannelLabel,
    color: settings.welcomeColor,
    description: settings.welcomeMessage,
    footerText: settings.welcomeFooterText,
    imageUrl: settings.welcomeImageUrl,
    mode: "welcome",
    panelImage: settings.welcomePanelImage,
    rules: settings.welcomeRules,
    rulesTitle: settings.welcomeRulesTitle,
    sections: settings.welcomeSections,
    subtitle: settings.welcomeSubtitle,
    title: settings.welcomeTitle
  });

  if (!payload) {
    return;
  }

  await channel.send(payload);
}

export async function sendLeaveMessage(context: BotContext, member: GuildMember | PartialGuildMember) {
  const settings = await getCachedGuildSettings(context, member.guild.id, member.client.user.id).catch(() => null);

  if (!settings?.leaveEnabled || !settings.leaveChannelId) {
    return;
  }

  const channel = await resolveTextChannel(member, settings.leaveChannelId);

  if (!channel?.isSendable()) {
    return;
  }

  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  const variables = panelVariables(member, displayChannelId);
  const payload = await createMemberPanelPayload(member, variables, {
    channelId: displayChannelId,
    channelLabel: settings.leaveChannelLabel,
    color: settings.leaveColor,
    description: settings.leaveMessage,
    footerText: settings.leaveFooterText,
    imageUrl: settings.leaveImageUrl,
    mode: "leave",
    panelImage: settings.leavePanelImage,
    rules: settings.leaveRules,
    rulesTitle: settings.leaveRulesTitle,
    sections: settings.leaveSections,
    subtitle: settings.leaveSubtitle,
    title: settings.leaveTitle
  });

  if (!payload) {
    return;
  }

  await channel.send(payload);
}

export async function createMemberPanelPayload(
  member: GuildMember | PartialGuildMember,
  variables: VariableContext,
  input: MemberPanelInput
) {
  await ensureGuildEmojiCache(member.guild);

  const panelImage = input.panelImage?.imageEnabled ? input.panelImage : null;
  const imageUrl = panelImage ? resolvePanelImageUrl(panelImage.imageUrl, panelImage) : resolveImageUrl(input.imageUrl);
  const imageIsVideo = isVideoPanelMedia(panelImage, imageUrl);
  const posterUrl = imageIsVideo ? resolvePanelImageUrl(panelImage?.mediaPosterUrl ?? panelImage?.mediaThumbnailUrl ?? null) : null;
  const imagePosition = imageUrl ? panelImage?.imagePosition ?? "top" : "none";
  const title = renderTemplate(input.title, variables);
  const subtitle = renderTemplate(input.subtitle, variables);
  const description = renderTemplate(input.description, variables);
  const rulesTitle = renderTemplate(input.rulesTitle, variables);
  const rules = formatRuleLines(renderTemplate(input.rules, variables));
  const channelLabel = renderTemplate(input.channelLabel, variables);
  const footerText = renderTemplate(input.footerText, variables);
  const contentBlocks: string[] = [];
  const customSections = normalizePanelSections(member, input.sections, variables);

  if (title) {
    contentBlocks.push([
      `# ${title}`,
      subtitle ? `**${subtitle}**` : null,
      description || null
    ].filter(Boolean).join("\n"));
  } else if (subtitle || description) {
    contentBlocks.push([subtitle ? `**${subtitle}**` : null, description || null].filter(Boolean).join("\n"));
  }

  if (customSections.length) {
    contentBlocks.push(...customSections.flatMap((section, index) => {
      const heading = [section.emoji, section.title].filter(Boolean).join(" ");
      return [
        sectionBlock(heading, section.description),
        index < customSections.length - 1 ? "__separator__" : null
      ].filter((item): item is string => Boolean(item));
    }));
  }

  if (!customSections.length && (rulesTitle || rules.length)) {
    contentBlocks.push([
      rulesTitle ? `**${rulesTitle}**` : null,
      ...rules.map((rule, index) => `**${index + 1}.** ${rule}`)
    ].filter(Boolean).join("\n"));
  }

  if (channelLabel || input.channelId) {
    contentBlocks.push([channelLabel, variables.channel].filter(Boolean).join(" "));
  }

  if (!imageUrl && !contentBlocks.length && !footerText) {
    return null;
  }

  const components: Array<Record<string, unknown>> = [];
  const blockComponents = renderPanelBlocks(panelImage?.blocks ?? []);

  if (blockComponents.length) {
    components.push(...blockComponents as Array<Record<string, unknown>>);
  }

  if (!blockComponents.length && imageUrl && ["top", "banner"].includes(imagePosition)) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  const accessoryImageUrl = imageIsVideo ? posterUrl : imageUrl;

  if (!blockComponents.length && accessoryImageUrl && ["thumbnail", "side"].includes(imagePosition) && contentBlocks.length) {
    const sectionBlocks = contentBlocks.splice(0, 3);
    components.push({
      type: 9,
      components: sectionBlocks.map(textDisplayComponent),
      accessory: {
        type: 11,
        media: {
          url: accessoryImageUrl
        },
        description: `${input.mode} image`
      }
    });
  }

  for (const block of contentBlocks) {
    components.push(block === "__separator__" ? separatorComponent() : textDisplayComponent(block));
  }

  if (!blockComponents.length && imageUrl && ["thumbnail", "side"].includes(imagePosition) && !accessoryImageUrl) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  if (!blockComponents.length && imageUrl && ["below_title", "middle", "bottom", "before_buttons", "below_text", "above_buttons"].includes(imagePosition)) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  if (!blockComponents.length && imageUrl && ["thumbnail", "side"].includes(imagePosition) && !components.length) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  return {
    allowedMentions: {
      parse: [] as never[]
    },
    components: [buildV2Container({
      accentColor: parseColor(input.color),
      components,
      footer: { image: imagePosition === "footer" ? (imageIsVideo ? posterUrl : imageUrl) : null, text: footerText || "NexTech" }
    })],
    flags: MessageFlags.IsComponentsV2 as const
  };
}

function textDisplayComponent(content: string) {
  return {
    type: 10,
    content
  };
}

function separatorComponent() {
  return {
    divider: true,
    spacing: 2,
    type: 14
  };
}

function sectionBlock(heading: string, description: string) {
  return [`### ${heading}`, description].filter(Boolean).join("\n");
}

function mediaGalleryComponent(imageUrl: string, mode: MemberPanelMode) {
  return {
    type: 12,
    items: [{
      media: {
        url: imageUrl
      },
      description: `${mode} image`
    }]
  };
}

function panelVariables(member: GuildMember | PartialGuildMember, channelId: string | null): VariableContext {
  const username = member.user?.username ?? member.displayName ?? member.id;
  const botName = member.client.user?.username ?? "Bot";

  return {
    botName,
    channel: channelId ? `<#${channelId}>` : "",
    memberCount: String(member.guild.memberCount ?? ""),
    server: member.guild.name,
    user: `<@${member.id}>`,
    username
  };
}

function renderTemplate(value: string | null | undefined, variables: VariableContext) {
  const template = value?.trim() ?? "";

  if (!template) {
    return "";
  }

  return template
    .replace(/\{user\}/gi, variables.user)
    .replace(/\{username\}/gi, variables.username)
    .replace(/\{server\}/gi, variables.server)
    .replace(/\{memberCount\}/gi, variables.memberCount)
    .replace(/\{botName\}/gi, variables.botName)
    .replace(/\{channel\}/gi, variables.channel);
}

function normalizePanelSections(
  member: GuildMember | PartialGuildMember,
  sections: MemberPanelSection[] | null | undefined,
  variables: VariableContext
) {
  return (sections ?? [])
    .filter((section) => section?.enabled !== false && Boolean(section.title?.trim()) && Boolean(section.description?.trim()))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .slice(0, 8)
    .map((section) => ({
      description: renderTemplate(section.description, variables),
      emoji: section.emoji ? resolveMemberPanelEmoji(member.guild, section.emoji) : "",
      title: renderTemplate(section.title, variables)
    }))
    .filter((section) => section.title || section.description);
}

export function resolveMemberPanelEmoji(memberGuild: GuildMember["guild"], value: string) {
  const normalized = value.trim();
  if (!normalized) return "";

  const systemInput = /^:/.test(normalized) || /^<a?:/i.test(normalized) ? normalized : `:${normalized}:`;
  const fromSystem = replaceSystemEmojis(systemInput, memberGuild, memberGuild.client);
  if (fromSystem !== systemInput) return fromSystem;

  return resolveComponentEmoji(memberGuild, normalized, "");
}

function resolveImageUrl(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const backendOrigin = env.BACKEND_API_URL ? new URL(env.BACKEND_API_URL).origin : "";
  return backendOrigin ? `${backendOrigin}${value.startsWith("/") ? value : `/${value}`}` : null;
}

function isVideoPanelMedia(panelImage: PanelImageSettings | null, imageUrl: string | null) {
  if (!imageUrl) return false;
  if (panelImage?.imageMimeType?.startsWith("video/")) return true;
  const extension = panelImage?.imageExtension?.trim().toLowerCase();
  return Boolean(extension && VIDEO_EXTENSIONS.has(extension)) || /\.(3gp|3g2|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(imageUrl);
}

const VIDEO_EXTENSIONS = new Set(["3gp", "3g2", "asf", "avi", "f4v", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "mxf", "ogv", "rmvb", "ts", "vob", "webm", "wmv"]);

async function resolveTextChannel(member: GuildMember | PartialGuildMember, channelId: string) {
  const channel = member.guild.channels.cache.get(channelId)
    ?? await member.guild.channels.fetch(channelId).catch(() => null);

  return channel?.isTextBased() ? channel : null;
}

function formatRuleLines(rules: string) {
  return rules
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0xef4444;
}
