import axios from "axios";
import { fixedSystemEmojiText, normalizeFixedSystemEmojiText } from "../config/systemEmojis";
import type { GuildSettingsDto } from "./settingsService";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

const DISCORD_API = "https://discord.com/api/v10";
const PANEL_SELECT_ID = "iab_report_select";
const COMPONENTS_V2_FLAG = 1 << 15;

type DiscordMessage = {
  id: string;
};

export async function publishReportSystemPanelToDiscord(settings: GuildSettingsDto, botToken: string | null) {
  if (!botToken) {
    throw new Error("Token do bot não configurado para publicar o painel de denuncias.");
  }

  const report = settings.reportSystem;
  const panelImage = settings.botId
    ? await getPanelImageSettings(settings.guildId, settings.botId, "police-iab").catch(() => null)
    : null;

  if (!report.enabled) {
    throw new Error("Ative o sistema Corregedoria antes de publicar o painel.");
  }

  if (!report.panelChannelId) {
    throw new Error("Selecione o canal onde o painel será publicado.");
  }

  const options = report.categories
    .filter((category) => category.enabled)
    .slice(0, 25)
    .map((category) => ({
      label: (category.judgeLabel || category.name).slice(0, 100),
      value: category.id.slice(0, 100),
      ...(category.description ? { description: category.description.slice(0, 100) } : {}),
      ...(category.emoji ? { emoji: parseEmoji(normalizePanelEmoji(category.emoji)) } : {})
    }));

  if (!options.length) {
    throw new Error("Ative pelo menos um órgão/categoria antes de publicar.");
  }

  const payload = {
    components: [
      buildV2Container({
        accentColor: parseColor(report.panelColor),
        components: buildReportPanelComponents(settings, options, panelImage),
        footer: {
          image: panelFooterImage(settings, panelImage),
          text: report.footerText ?? "NexTech"
        }
      })
    ],
    flags: COMPONENTS_V2_FLAG
  };

  const { data } = await axios.post<DiscordMessage>(
    `${DISCORD_API}/channels/${report.panelChannelId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      timeout: 10_000
    }
  );

  return data.id;
}

function parseColor(value: string) {
  const normalized = value.replace("#", "").trim();
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xf8c537;
}

function parseEmoji(value: string) {
  const custom = value.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/);

  if (custom) {
    return {
      id: custom[2],
      name: custom[1]
    };
  }

  return {
    name: value
  };
}

function buildReportPanelComponents(
  settings: GuildSettingsDto,
  options: Array<{ label: string; value: string; description?: string; emoji?: { id?: string; name?: string } }>,
  panelImage: PanelImageSettingsDto | null = null
) {
  const report = settings.reportSystem;
  const title = `${normalizePanelEmoji(report.panelEmoji ?? fixedSystemEmojiText("alerta"))} ${report.panelTitle}`.trim();
  const image = resolvePanelImage(report.imageUrl, panelImage);
  const components: unknown[] = [];
  const lead = firstPanelLine(report.panelDescription) || "Sistema institucional de denuncias sigilosas.";
  const description = cleanPanelText(report.panelDescription) || "Selecione o órgão competente para abrir uma denúncia com segurança.";
  const info = cleanPanelText(report.infoMessage) || "As denuncias serão analisadas exclusivamente pela equipe autorizada.";

  const pushImage = () => {
    if (image.mainUrl) components.push(mediaBlock(image.mainUrl, title));
  };

  if (image.mainUrl) pushImage();
  components.push({ type: 10, content: reportPanelHero(title, lead) });
  components.push(separator(2));
  components.push({ type: 10, content: reportPanelCard("📋", "Informações", description) });
  components.push(separator(1));
  components.push({ type: 10, content: reportPanelSteps() });
  components.push(separator(1));
  components.push({ type: 10, content: reportModeCard(report.allowAnonymousReports) });
  components.push(separator(1));
  components.push({ type: 10, content: reportPanelCard("🔒", "Sigilo Institucional", info, "VERIFICADO") });
  components.push(separator(2));
  components.push({ type: 10, content: reportOpenCard(options.length) });
  components.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: PANEL_SELECT_ID,
        placeholder: selectPlaceholder(report.panelPlaceholder),
        min_values: 1,
        max_values: 1,
        options
      }
    ]
  });

  return components;
}

function normalizePanelEmoji(value: string) {
  return normalizeFixedSystemEmojiText(value
    .replace(/🛡️|🛡/g, fixedSystemEmojiText("alerta"))
    .replace(/🎫/g, fixedSystemEmojiText("prancheta"))
    .replace(/📁/g, fixedSystemEmojiText("prancheta"))
    .replace(/👤|👥|👮/g, fixedSystemEmojiText("homem"))
    .replace(/⚠️|⚠/g, fixedSystemEmojiText("perigo"))
    .replace(/✅/g, fixedSystemEmojiText("visto"))
    .replace(/❌/g, fixedSystemEmojiText("exclamacao")));
}

function resolvePanelImage(legacyImageUrl: string | null, panelImage: PanelImageSettingsDto | null) {
  const configuredUrl = panelImage?.imageEnabled && panelImage.imageUrl ? panelImage.imageUrl : legacyImageUrl;
  const position = configuredUrl === panelImage?.imageUrl ? panelImage.imagePosition : "banner";
  if (!configuredUrl) return { footerUrl: null, mainUrl: null, position: "none" };
  if (position === "footer") return { footerUrl: configuredUrl, mainUrl: null, position };
  return { footerUrl: null, mainUrl: configuredUrl, position };
}

function panelFooterImage(settings: GuildSettingsDto, panelImage: PanelImageSettingsDto | null) {
  return resolvePanelImage(settings.reportSystem.imageUrl, panelImage).footerUrl;
}

function mediaBlock(url: string, description: string) {
  return { type: 12, items: [{ media: { url }, description }] };
}

function firstPanelLine(value: string | null | undefined) {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function cleanPanelText(value: string | null | undefined) {
  const lines = (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  return lines.join("\n").slice(0, 1200);
}

function reportPanelHero(title: string, lead: string) {
  return [
    `# ${title}`,
    `-# ${lead}`,
    "",
    "**CONFIDENCIAL** • Sistema institucional • Auditoria autorizada"
  ].join("\n").slice(0, 4000);
}

function reportPanelCard(icon: string, title: string, text: string, badge?: string) {
  return [
    `## ${icon} ${title}${badge ? `  \`${badge}\`` : ""}`,
    "",
    text
  ].join("\n").slice(0, 4000);
}

function reportPanelSteps() {
  return [
    "## 📘 Como funciona",
    "",
    "`01` 🏛️ Escolha o órgão responsável.",
    "`02` 👤 Defina se a denúncia será identificada ou anonima.",
    "`03` 📎 Envie resumo, denunciado, descrição e provas.",
    "`04` 📋 Revise as informações no canal privado.",
    "`05` ✅ Confirme o envio quando estiver pronto.",
    "`06` 🛡️ Aguarde a analise da equipe autorizada."
  ].join("\n");
}

function reportModeCard(anonymousEnabled: boolean) {
  return [
    "## 🌐 Modo de abertura",
    "",
    "✅ **Identificada**",
    "Sua identidade fica visivel para a equipe responsável pelo atendimento.",
    "",
    anonymousEnabled
      ? "👤 **Anonima**\nSua identidade permanece oculta durante a analise operacional."
      : "👤 **Anonima indisponível**\nEste servidor aceita apenas denuncias identificadas no momento."
  ].join("\n").slice(0, 4000);
}

function reportOpenCard(optionCount: number) {
  return [
    "## 📂 Abrir denúncia",
    "",
    `🏛️ Selecione o órgão responsável no menu abaixo. ${optionCount} opção(oes) disponível(is).`
  ].join("\n");
}

function selectPlaceholder(value: string) {
  const text = value.trim() || "Selecione o órgão responsável";
  return `🏛️ ${text}`.slice(0, 150);
}

function separator(spacing: 1 | 2 = 1) {
  return { type: 14, divider: true, spacing };
}

function buildV2Container(input: { accentColor: number; components: unknown[]; footer?: { enabled?: boolean; image?: string | null; text?: string | null } }) {
  const components = [...input.components];
  const footer = createV2Footer(input.footer ?? { text: "NexTech" });
  if (footer) components.push({ type: 14, divider: true, spacing: 1 }, footer);
  return {
    type: 17,
    accent_color: input.accentColor,
    components
  };
}

function createV2Footer(footer: { enabled?: boolean; image?: string | null; text?: string | null } | null | undefined) {
  if (!footer || footer.enabled === false) return null;
  const content = `-# ${footer.text ?? "NexTech"}`.slice(0, 4000) || "-# ";
  return { type: 10, content };
}
