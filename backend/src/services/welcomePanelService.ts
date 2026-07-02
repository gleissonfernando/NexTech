import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env";
import {
  DEFAULT_LEAVE_CHANNEL_LABEL,
  DEFAULT_LEAVE_FOOTER_TEXT,
  DEFAULT_LEAVE_MESSAGE,
  DEFAULT_LEAVE_RULES,
  DEFAULT_LEAVE_RULES_TITLE,
  DEFAULT_LEAVE_TITLE,
  DEFAULT_WELCOME_CHANNEL_LABEL,
  DEFAULT_WELCOME_FOOTER_TEXT,
  DEFAULT_WELCOME_MESSAGE,
  DEFAULT_WELCOME_RULES,
  DEFAULT_WELCOME_RULES_TITLE,
  DEFAULT_WELCOME_TITLE,
  type GuildSettingsDto
} from "./settingsService";

const DISCORD_API_URL = "https://discord.com/api/v10";
const WELCOME_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/welcome");
type MemberPanelMode = "welcome" | "leave";
type DiscordMessagePayload = {
  allowed_mentions: {
    parse: never[];
  };
  components: Array<Record<string, unknown>>;
  flags: number;
};

const MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function welcomePanelDescription(settings: GuildSettingsDto, userMention: string, channelId: string | null) {
  return memberPanelDescription({
    channelId,
    channelLabel: settings.welcomeChannelLabel,
    defaultChannelLabel: DEFAULT_WELCOME_CHANNEL_LABEL,
    defaultMessage: DEFAULT_WELCOME_MESSAGE,
    defaultRules: DEFAULT_WELCOME_RULES,
    defaultRulesTitle: DEFAULT_WELCOME_RULES_TITLE,
    message: settings.welcomeMessage,
    rules: settings.welcomeRules,
    rulesTitle: settings.welcomeRulesTitle,
    userMention
  });
}

export function leavePanelDescription(settings: GuildSettingsDto, userMention: string, channelId: string | null) {
  return memberPanelDescription({
    channelId,
    channelLabel: settings.leaveChannelLabel,
    defaultChannelLabel: DEFAULT_LEAVE_CHANNEL_LABEL,
    defaultMessage: DEFAULT_LEAVE_MESSAGE,
    defaultRules: DEFAULT_LEAVE_RULES,
    defaultRulesTitle: DEFAULT_LEAVE_RULES_TITLE,
    message: settings.leaveMessage,
    rules: settings.leaveRules,
    rulesTitle: settings.leaveRulesTitle,
    userMention
  });
}

function memberPanelDescription({
  channelId,
  channelLabel,
  defaultChannelLabel,
  defaultMessage,
  defaultRules,
  defaultRulesTitle,
  message,
  rules,
  rulesTitle,
  userMention
}: {
  channelId: string | null;
  channelLabel: string | null;
  defaultChannelLabel: string;
  defaultMessage: string;
  defaultRules: string;
  defaultRulesTitle: string;
  message: string | null;
  rules: string | null;
  rulesTitle: string | null;
  userMention: string;
}) {
  const channelMention = channelId ? `<#${channelId}>` : "<#coloque_o_id_do_canal_de_lives_aqui>";
  const ruleLines = formatRuleLines(rules, defaultRules);

  return [
    formatPanelMessage(message, userMention, defaultMessage),
    "",
    `**${rulesTitle?.trim() || defaultRulesTitle}**`,
    ...ruleLines.map((rule, index) => `**${index + 1}.** ${rule}`),
    "",
    `\u{1F517} ${channelLabel?.trim() || defaultChannelLabel} ${channelMention}`
  ].join("\n");
}

export function createWelcomePanelEmbeds(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  return createMemberPanelPayload(settings, userMention, {
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
    title: settings.welcomeTitle
  });
}

export function createLeavePanelEmbed(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  return createMemberPanelPayload(settings, userMention, {
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
    title: settings.leaveTitle
  });
}

export async function saveWelcomeImage(guildId: string, buffer: Buffer, mimeType: string) {
  return saveMemberPanelImage("welcome", guildId, buffer, mimeType);
}

export async function saveLeaveImage(guildId: string, buffer: Buffer, mimeType: string) {
  return saveMemberPanelImage("leave", guildId, buffer, mimeType);
}

async function saveMemberPanelImage(mode: MemberPanelMode, guildId: string, buffer: Buffer, mimeType: string) {
  const extension = MIME_EXTENSIONS[mimeType];

  if (!extension) {
    throw new Error("Formato invalido. Envie GIF, PNG, JPG ou WEBP.");
  }

  await fs.mkdir(WELCOME_UPLOAD_DIR, { recursive: true });

  const safeGuildId = guildId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `${safeGuildId}-${mode}-${Date.now()}-${randomUUID()}.${extension}`;
  const filePath = path.join(WELCOME_UPLOAD_DIR, fileName);

  await fs.writeFile(filePath, buffer);

  return `/uploads/welcome/${fileName}`;
}

export async function sendWelcomePanelToDiscord(settings: GuildSettingsDto, userMention: string, botToken?: string | null) {
  await sendMemberPanelToDiscord({
    botToken,
    channelId: settings.welcomeChannelId,
    payload: createWelcomePanelEmbeds(settings, userMention),
    missingChannelMessage: "Selecione o canal onde o painel sera enviado.",
    testErrorLabel: "boas-vindas"
  });
}

export async function sendLeavePanelToDiscord(settings: GuildSettingsDto, userMention: string, botToken?: string | null) {
  await sendMemberPanelToDiscord({
    botToken,
    channelId: settings.leaveChannelId,
    payload: createLeavePanelEmbed(settings, userMention),
    missingChannelMessage: "Selecione o canal onde o painel de saida sera enviado.",
    testErrorLabel: "saida"
  });
}

async function sendMemberPanelToDiscord({
  channelId,
  botToken,
  payload,
  missingChannelMessage,
  testErrorLabel
}: {
  channelId: string | null;
  botToken?: string | null;
  payload: DiscordMessagePayload | null;
  missingChannelMessage: string;
  testErrorLabel: string;
}) {
  const token = botToken || env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado.");
  }

  if (!channelId) {
    throw new Error(missingChannelMessage);
  }

  if (!payload) {
    throw new Error("Configure titulo, texto, dicas, rodape ou imagem antes de testar.");
  }

  const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Discord API respondeu ${response.status} ao testar ${testErrorLabel}.`);
  }
}

function toPublicUrl(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const origin = env.SITE_ORIGIN || env.FRONTEND_URL;
  return origin ? `${origin}${value.startsWith("/") ? value : `/${value}`}` : value;
}

function createMemberPanelPayload(
  settings: GuildSettingsDto,
  userMention: string,
  input: {
    channelId: string | null;
    channelLabel: string | null;
    color: string;
    description: string | null;
    footerText: string | null;
    imageUrl: string | null;
    mode: MemberPanelMode;
    panelImage: GuildSettingsDto["welcomePanelImage"];
    rules: string | null;
    rulesTitle: string | null;
    title: string | null;
  }
): DiscordMessagePayload | null {
  const variables: Record<"botName" | "channel" | "memberCount" | "server" | "user" | "username", string> = {
    botName: "Bot",
    channel: input.channelId ? `<#${input.channelId}>` : "",
    memberCount: "",
    server: settings.guildId,
    user: userMention,
    username: userMention.replace(/[<@>]/g, "")
  };
  const panelImage = input.panelImage?.imageEnabled ? input.panelImage : null;
  const imageUrl = toPublicUrl(panelImage?.imageUrl || input.imageUrl);
  const imagePosition = imageUrl ? panelImage?.imagePosition ?? "top" : "none";
  const title = renderTemplate(input.title, variables);
  const description = renderTemplate(input.description, variables);
  const rulesTitle = renderTemplate(input.rulesTitle, variables);
  const rules = formatRuleLines(renderTemplate(input.rules, variables));
  const channelLabel = renderTemplate(input.channelLabel, variables);
  const footerText = renderTemplate(input.footerText, variables);
  const components: Array<Record<string, unknown>> = [];

  if (imageUrl && ["top", "banner"].includes(imagePosition)) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  const contentBlocks = [
    title ? `## ${title}` : "",
    description,
    rulesTitle || rules.length
      ? [rulesTitle ? `**${rulesTitle}**` : "", ...rules.map((rule, index) => `**${index + 1}.** ${rule}`)].filter(Boolean).join("\n")
      : "",
    channelLabel || input.channelId ? [channelLabel, variables.channel].filter(Boolean).join(" ") : "",
    footerText ? `-# ${footerText}` : ""
  ].filter(Boolean);

  if (imageUrl && ["thumbnail", "side"].includes(imagePosition) && contentBlocks.length) {
    const sectionBlocks = contentBlocks.splice(0, 3);
    components.push({
      type: 9,
      components: sectionBlocks.map(textDisplayComponent),
      accessory: {
        type: 11,
        media: {
          url: imageUrl
        },
        description: `${input.mode} image`
      }
    });
  }

  for (const content of contentBlocks) {
    if (content) {
      components.push(textDisplayComponent(content));
    }
  }

  if (imageUrl && ["below_title", "middle", "bottom", "before_buttons", "below_text", "above_buttons", "footer"].includes(imagePosition)) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  if (imageUrl && ["thumbnail", "side"].includes(imagePosition) && !components.length) {
    components.push(mediaGalleryComponent(imageUrl, input.mode));
  }

  if (!components.length) {
    return null;
  }

  return {
    allowed_mentions: {
      parse: []
    },
    components: [{
      type: 17,
      accent_color: parseColor(input.color),
      components
    }],
    flags: 32768
  };
}

function textDisplayComponent(content: string) {
  return {
    type: 10,
    content
  };
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

function renderTemplate(value: string | null | undefined, variables: Record<"botName" | "channel" | "memberCount" | "server" | "user" | "username", string>) {
  const template = value?.trim() ?? "";
  return template
    .replace(/\{user\}/gi, variables.user)
    .replace(/\{username\}/gi, variables.username)
    .replace(/\{server\}/gi, variables.server)
    .replace(/\{memberCount\}/gi, variables.memberCount)
    .replace(/\{botName\}/gi, variables.botName)
    .replace(/\{channel\}/gi, variables.channel);
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0xef4444;
}

function formatPanelMessage(message: string | null, userMention: string, fallback: string) {
  return (message?.trim() || fallback).replace(/\{user\}/gi, userMention);
}

function formatRuleLines(rules: string | null, fallback = "") {
  return (rules?.trim() || fallback)
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
}
