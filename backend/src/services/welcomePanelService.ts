import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env";
import type { GuildSettingsDto } from "./settingsService";

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

export function welcomePanelDescription(userMention: string, channelId: string | null) {
  const channelMention = channelId ? `<#${channelId}>` : "<#coloque_o_id_do_canal_de_lives_aqui>";

  return [
    `Seja bem-vindo(a), ${userMention}, a nossa comunidade de lives.`,
    "Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos.",
    "",
    "**Algumas dicas:**",
    "**1.** Leia as regras antes de participar.",
    "**2.** Aguarde os avisos oficiais de lives e eventos.",
    "**3.** Respeite streamers, espectadores e moderadores.",
    "**4.** Nao divulgue lives, links ou canais sem autorizacao.",
    "**5.** Converse, faca amizades e aproveite sua estadia.",
    "",
    `\u{1F517} Acesse o canal: ${channelMention}`
  ].join("\n");
}

export function leavePanelDescription(userMention: string, channelId: string | null) {
  const channelMention = channelId ? `<#${channelId}>` : "<#coloque_o_id_do_canal_de_lives_aqui>";

  return [
    `Ate mais, ${userMention}. Obrigado por ter feito parte da nossa comunidade de lives.`,
    "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera.",
    "",
    "**Registro de saida:**",
    "**1.** A saida foi registrada automaticamente pelo bot.",
    "**2.** Os canais oficiais continuam disponiveis para a comunidade.",
    "**3.** Respeite as regras se decidir retornar ao servidor.",
    "**4.** A equipe segue por aqui para organizar eventos e avisos.",
    "**5.** Valeu pela passagem e ate a proxima.",
    "",
    `\u{1F517} Canal da comunidade: ${channelMention}`
  ].join("\n");
}

export function createWelcomePanelEmbed(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const imageUrl = toPublicUrl(settings.welcomeImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);

  return createMemberPanelEmbed({
    description: welcomePanelDescription(userMention, displayChannelId),
    imageUrl
  });
}

export function createLeavePanelEmbed(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.leaveDisplayChannelId ?? settings.leaveChannelId;
  const imageUrl = toPublicUrl(settings.leaveImageUrl ?? DEFAULT_WELCOME_IMAGE_URL);

  return createMemberPanelEmbed({
    description: leavePanelDescription(userMention, displayChannelId),
    imageUrl
  });
}

function createMemberPanelEmbed({ description, imageUrl }: { description: string; imageUrl: string | null }) {
  return {
    color: 0xef4444,
    title: "\u{1F47E} Ricardinn98",
    description,
    image: imageUrl ? { url: imageUrl } : undefined,
    footer: {
      text: "Ricardinn98 - Comunidade de lives"
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

export async function sendWelcomePanelToDiscord(settings: GuildSettingsDto, userMention: string) {
  await sendMemberPanelToDiscord({
    channelId: settings.welcomeChannelId,
    embed: createWelcomePanelEmbed(settings, userMention),
    missingChannelMessage: "Selecione o canal onde o painel sera enviado.",
    testErrorLabel: "boas-vindas"
  });
}

export async function sendLeavePanelToDiscord(settings: GuildSettingsDto, userMention: string) {
  await sendMemberPanelToDiscord({
    channelId: settings.leaveChannelId,
    embed: createLeavePanelEmbed(settings, userMention),
    missingChannelMessage: "Selecione o canal onde o painel de saida sera enviado.",
    testErrorLabel: "saida"
  });
}

async function sendMemberPanelToDiscord({
  channelId,
  embed,
  missingChannelMessage,
  testErrorLabel
}: {
  channelId: string | null;
  embed: ReturnType<typeof createWelcomePanelEmbed>;
  missingChannelMessage: string;
  testErrorLabel: string;
}) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado.");
  }

  if (!channelId) {
    throw new Error(missingChannelMessage);
  }

  const response = await fetch(`${DISCORD_API_URL}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
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
