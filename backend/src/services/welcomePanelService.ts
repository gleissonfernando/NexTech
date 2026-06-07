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
const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";
type MemberPanelMode = "welcome" | "leave";

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

export function createWelcomePanelEmbed(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const imageUrl = toPublicUrl(settings.welcomeImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);

  return createMemberPanelEmbed({
    description: welcomePanelDescription(settings, userMention, displayChannelId),
    footerText: settings.welcomeFooterText ?? DEFAULT_WELCOME_FOOTER_TEXT,
    imageUrl,
    title: settings.welcomeTitle ?? DEFAULT_WELCOME_TITLE
  });
}

export function createLeavePanelEmbed(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  const imageUrl = toPublicUrl(settings.leaveImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);

  return createMemberPanelEmbed({
    description: leavePanelDescription(settings, userMention, displayChannelId),
    footerText: settings.leaveFooterText ?? DEFAULT_LEAVE_FOOTER_TEXT,
    imageUrl,
    title: settings.leaveTitle ?? DEFAULT_LEAVE_TITLE
  });
}

function createMemberPanelEmbed({
  description,
  footerText,
  imageUrl,
  title
}: {
  description: string;
  footerText: string;
  imageUrl: string | null;
  title: string;
}) {
  return {
    color: 0xef4444,
    title,
    description,
    image: imageUrl ? { url: imageUrl } : undefined,
    footer: {
      text: footerText
    }
  };
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
    embed: createWelcomePanelEmbed(settings, userMention),
    missingChannelMessage: "Selecione o canal onde o painel sera enviado.",
    testErrorLabel: "boas-vindas"
  });
}

export async function sendLeavePanelToDiscord(settings: GuildSettingsDto, userMention: string, botToken?: string | null) {
  await sendMemberPanelToDiscord({
    botToken,
    channelId: settings.leaveChannelId,
    embed: createLeavePanelEmbed(settings, userMention),
    missingChannelMessage: "Selecione o canal onde o painel de saida sera enviado.",
    testErrorLabel: "saida"
  });
}

async function sendMemberPanelToDiscord({
  channelId,
  botToken,
  embed,
  missingChannelMessage,
  testErrorLabel
}: {
  channelId: string | null;
  botToken?: string | null;
  embed: ReturnType<typeof createWelcomePanelEmbed>;
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

  const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      embeds: [embed],
      allowed_mentions: {
        parse: []
      }
    })
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

function formatPanelMessage(message: string | null, userMention: string, fallback: string) {
  return (message?.trim() || fallback).replace(/\{user\}/gi, userMention);
}

function formatRuleLines(rules: string | null, fallback: string) {
  return (rules?.trim() || fallback)
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
}
