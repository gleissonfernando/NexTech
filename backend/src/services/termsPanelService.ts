import axios from "axios";
import { env } from "../config/env";
import { createLog } from "./logService";
import type { GuildSettingsDto } from "./settingsService";
import { updateGuildSettings } from "./settingsService";

const DISCORD_API = "https://discord.com/api/v10";
const COMPONENTS_V2_FLAG = 1 << 15;
const DEFAULT_TERMS_BANNER_PATH = "/terms-banner.png";
const DEFAULT_TERMS_BANNER_VERSION = "20260804-terms-panel";

type DiscordMessage = {
  id: string;
};

type DiscordComponent = Record<string, unknown>;

export async function publishTermsPanelToDiscord(settings: GuildSettingsDto, botToken: string | null) {
  if (!botToken) {
    throw new Error("Token do bot não configurado para publicar o painel de termos.");
  }

  if (!settings.termsPanelEnabled) {
    throw new Error("Ative o painel de termos antes de publicar.");
  }

  if (!settings.termsPanelChannelId) {
    throw new Error("Selecione o canal onde o painel de termos será enviado.");
  }

  const payload = buildTermsPanelPayload(settings);
  const headers = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json"
  };

  if (settings.termsPanelMessageId) {
    try {
      const { data } = await axios.patch<DiscordMessage>(
        `${DISCORD_API}/channels/${settings.termsPanelChannelId}/messages/${settings.termsPanelMessageId}`,
        payload,
        { headers, timeout: 10_000 }
      );

      await logTermsPanelEvent(settings, "terms.panel_updated", "Painel de termos atualizado.", data.id);
      return data.id;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : null;
      if (status !== 404) throw formatDiscordTermsPanelError(error);
    }
  }

  const { data } = await axios.post<DiscordMessage>(
    `${DISCORD_API}/channels/${settings.termsPanelChannelId}/messages`,
    payload,
    { headers, timeout: 10_000 }
  ).catch((error) => {
    throw formatDiscordTermsPanelError(error);
  });

  await updateGuildSettings(settings.guildId, { termsPanelMessageId: data.id }, settings.botId);
  await logTermsPanelEvent(settings, "terms.panel_created", "Painel de termos criado.", data.id);
  return data.id;
}

export function buildTermsPanelPayload(settings: GuildSettingsDto) {
  const components: DiscordComponent[] = [];
  const imageUrl = resolveTermsImageUrl(settings);
  const textComponents = buildTermsTextComponents(settings);

  if (imageUrl && (settings.termsPanelImageFormat === "square" || settings.termsPanelImageFormat === "vertical")) {
    components.push({
      type: 9,
      components: textComponents.slice(0, 2),
      accessory: { type: 11, media: { url: imageUrl } }
    });
    components.push(...textComponents.slice(2));
  } else {
    components.push(...textComponents);
  }

  if (imageUrl && settings.termsPanelImageFormat !== "square" && settings.termsPanelImageFormat !== "vertical") {
    components.push({ type: 12, items: [{ media: { url: imageUrl } }] });
  }

  return {
    allowed_mentions: { parse: [] },
    components: [{
      type: 17,
      accent_color: parseColor(settings.termsPanelColor),
      components
    }],
    embeds: [],
    flags: COMPONENTS_V2_FLAG
  };
}

function buildTermsTextComponents(settings: GuildSettingsDto): DiscordComponent[] {
  const title = displayTermsTitle(settings.termsPanelTitle);
  const company = extractCompanyName(settings.termsPanelTitle);
  const description = settings.termsPanelDescription?.trim();
  if (!description) {
    return defaultTermsComponents(title, company, settings.termsPanelSubtitle, settings.termsPanelFooterText);
  }

  const lines = [`# ${title}`, settings.termsPanelSubtitle?.trim() ? `**${settings.termsPanelSubtitle.trim()}**` : null, description, settings.termsPanelFooterText?.trim() ? `-# ${settings.termsPanelFooterText.trim()}` : null].filter(Boolean);
  return chunkText(lines.join("\n\n"), 3900).map((content) => ({ type: 10, content }));
}

function displayTermsTitle(value: string | null) {
  const normalized = value?.trim();
  if (!normalized || /^Termos de Servi[cç]o da NexTech$/i.test(normalized)) return "Termos & Serviço";
  return normalized;
}

function extractCompanyName(value: string | null) {
  const normalized = value?.trim() || "";
  const company = normalized.replace(/^Termos\s+(?:de|&)\s+Servi[cç]o\s+(?:da|do|dos)?\s*/i, "").trim();
  return company && !/^Termos\s*&?\s*Servi[cç]o$/i.test(company) ? company : "NexTech";
}

function resolveTermsImageUrl(settings: GuildSettingsDto) {
  const source = settings.termsPanelImageFormat === "none"
    ? DEFAULT_TERMS_BANNER_PATH
    : settings.termsPanelImageUrl || DEFAULT_TERMS_BANNER_PATH;
  if (!source) return null;
  const url = /^https?:\/\//i.test(source)
    ? source
    : `${publicOrigin()}${source.startsWith("/") ? source : `/${source}`}`;
  return versionDefaultTermsBannerUrl(url);
}

function versionDefaultTermsBannerUrl(url: string) {
  if (!/\/terms-banner\.png(?:$|\?)/i.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return url.includes("v=") ? url : `${url}${separator}v=${DEFAULT_TERMS_BANNER_VERSION}`;
}

function defaultTermsComponents(title: string, company: string, subtitle: string | null, footer: string | null) {
  const header = [
    `# ${title}`,
    subtitle?.trim() ? `**${subtitle.trim()}**` : "**Contratação, pagamento e reembolso**",
    "-# Leia as regras abaixo antes de contratar qualquer serviço."
  ].join("\n");

  const sections = [
    header,
    [
      "## 🤝 Aceitação dos Termos & Serviço",
      `- Ao utilizar os serviços oferecidos pela **${company}**, você concorda com os termos e condições estabelecidos abaixo.`
    ].join("\n"),
    [
      "## 💰 Pagamento e Orçamento",
      `- **Valores:** os serviços apresentados no Discord da **${company}** são pré-estabelecidos, mas podem mudar conforme a dificuldade do projeto.`,
      "- **Responsabilidade:** não nos responsabilizamos por pagamentos enviados ao destinatário errado ou por falhas fora do nosso controle.",
      "- **Prazo:** a entrega é combinada de acordo com a demanda do cliente.",
      "- **Uso exclusivo:** os produtos são destinados somente aos nossos clientes; revenda a terceiros não é permitida."
    ].join("\n"),
    [
      "## ☑️ Política de Reembolso",
      "- **Entrega concluída:** após a entrega, não haverá reembolso.",
      "- **Comunicação:** fale sempre por tickets para evitar transtornos.",
      "- **Golpes:** em caso de suspeita, confira os membros com cargo **Dev** e envie uma mensagem com as provas do caso."
    ].join("\n")
  ];

  if (footer?.trim()) sections.push(`-# ${footer.trim()}`);

  return sections.map((content) => ({ type: 10, content }));
}

function publicOrigin() {
  return env.APP_PUBLIC_URL || env.FRONTEND_PUBLIC_URL || "https://nextech.discloud.app";
}

function chunkText(text: string, maxLength: number) {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const splitAt = Math.max(slice.lastIndexOf("\n## "), slice.lastIndexOf("\n\n"));
    const end = splitAt > 500 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.slice(0, 4);
}

function parseColor(value: string | null) {
  const normalized = value?.replace("#", "").trim();
  return normalized && /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xffd500;
}

function formatDiscordTermsPanelError(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error("Não foi possível publicar o painel de termos.");
  }

  const status = error.response?.status;
  const discordMessage = typeof error.response?.data === "object" && error.response.data
    ? JSON.stringify(error.response.data).slice(0, 500)
    : null;

  if (status === 401) return new Error("Token do bot inválido ao publicar o painel de termos.");
  if (status === 403) return new Error("O bot não tem permissão para enviar ou editar mensagens no canal de termos.");
  if (status === 404) return new Error("Canal de termos não encontrado. Selecione outro canal e publique novamente.");
  if (status === 400) return new Error(`Discord recusou o painel de termos. ${discordMessage ?? "Confira URL, imagem e texto configurados."}`);

  return new Error(`Não foi possível publicar o painel de termos${status ? ` (Discord ${status})` : ""}.`);
}

async function logTermsPanelEvent(settings: GuildSettingsDto, type: string, message: string, messageId: string) {
  if (!settings.botId) return;

  await createLog({
    botId: settings.botId,
    channelId: settings.termsPanelChannelId,
    guildId: settings.guildId,
    message,
    metadata: { messageId, title: settings.termsPanelTitle },
    module: "terms-panel",
    type
  }).catch(() => null);
}
