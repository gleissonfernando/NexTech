import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env";
import type { GuildSettingsDto } from "./settingsService";

const DISCORD_API_URL = "https://discord.com/api/v10";
const WELCOME_UPLOAD_DIR = path.resolve(__dirname, "../../uploads/welcome");
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

export function createWelcomePanelEmbed(settings: GuildSettingsDto, userMention: string) {
  const displayChannelId = settings.welcomeDisplayChannelId ?? settings.welcomeChannelId;
  const imageUrl = toPublicUrl(settings.welcomeImageUrl ?? "/uploads/welcome/default.gif");

  return {
    color: 0xef4444,
    title: "\u{1F47E} Ricardinn98",
    description: welcomePanelDescription(userMention, displayChannelId),
    image: imageUrl ? { url: imageUrl } : undefined,
    footer: {
      text: "Ricardinn98 - Comunidade de lives"
    }
  };
}

export async function saveWelcomeImage(guildId: string, buffer: Buffer, mimeType: string) {
  const extension = MIME_EXTENSIONS[mimeType];

  if (!extension) {
    throw new Error("Formato invalido. Envie GIF, PNG, JPG ou WEBP.");
  }

  await fs.mkdir(WELCOME_UPLOAD_DIR, { recursive: true });

  const safeGuildId = guildId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fileName = `${safeGuildId}-${Date.now()}-${randomUUID()}.${extension}`;
  const filePath = path.join(WELCOME_UPLOAD_DIR, fileName);

  await fs.writeFile(filePath, buffer);

  return `/uploads/welcome/${fileName}`;
}

export async function sendWelcomePanelToDiscord(settings: GuildSettingsDto, userMention: string) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado.");
  }

  if (!settings.welcomeChannelId) {
    throw new Error("Selecione o canal onde o painel sera enviado.");
  }

  const response = await fetch(`${DISCORD_API_URL}/channels/${settings.welcomeChannelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      embeds: [createWelcomePanelEmbed(settings, userMention)],
      allowed_mentions: {
        parse: []
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Discord API respondeu ${response.status} ao testar boas-vindas.`);
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
