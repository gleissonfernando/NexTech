import axios from "axios";
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
    throw new Error("Token do bot nao configurado para publicar o painel de denuncias.");
  }

  const report = settings.reportSystem;
  const panelImage = settings.botId
    ? await getPanelImageSettings(settings.guildId, settings.botId, "police-iab").catch(() => null)
    : null;

  if (!report.enabled) {
    throw new Error("Ative o sistema Denuncias Corregedoria antes de publicar o painel.");
  }

  if (!report.panelChannelId) {
    throw new Error("Selecione o canal onde o painel sera publicado.");
  }

  const options = report.categories
    .filter((category) => category.enabled)
    .slice(0, 25)
    .map((category) => ({
      label: category.name.slice(0, 100),
      value: category.id.slice(0, 100),
      ...(category.description ? { description: category.description.slice(0, 100) } : {}),
      ...(category.emoji ? { emoji: parseEmoji(category.emoji) } : {})
    }));

  if (!options.length) {
    throw new Error("Ative pelo menos um orgao/categoria antes de publicar.");
  }

  const payload = {
    components: [
      buildV2Container({
        accentColor: parseColor(report.panelColor),
        components: buildReportPanelComponents(settings, options, panelImage),
        footer: {
          image: panelFooterImage(settings, panelImage),
          text: report.footerText ?? "OrviteK"
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
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xdc2626;
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
  const title = `${report.panelEmoji ?? "🛡️"} ${report.panelTitle}`.trim();
  const image = resolvePanelImage(report.imageUrl, panelImage);
  const components: unknown[] = [];
  const lead = firstPanelLine(report.panelDescription) || "Registre uma denuncia de forma segura e sigilosa.";
  const body = formatPanelBody(withoutFirstPanelLine(report.panelDescription));
  const info = formatPanelBody(report.infoMessage);
  const titleText = `# ${title}\n-# ${lead}`.slice(0, 4000);

  const pushImage = () => {
    if (image.mainUrl) components.push(mediaBlock(image.mainUrl, title));
  };

  if (image.mainUrl && ["top", "banner"].includes(image.position)) pushImage();

  if (image.mainUrl && ["thumbnail", "side"].includes(image.position)) {
    components.push({
      type: 9,
      components: [{ type: 10, content: titleText }],
      accessory: { type: 11, media: { url: image.mainUrl }, description: title }
    });
  } else {
    components.push({ type: 10, content: titleText });
  }

  if (image.mainUrl && image.position === "below_title") pushImage();
  if (body) components.push({ type: 10, content: body });
  if (image.mainUrl && image.position === "middle") pushImage();

  components.push({
    type: 10,
    content: report.allowAnonymousReports
      ? "### Modo de abertura\nA denuncia anonima esta disponivel. Voce tambem pode seguir identificado quando essa opcao aparecer."
      : "### Modo de abertura\n**A denuncia anonima esta desativada.** Abra o ticket com identificacao; seu nome aparecera no atendimento."
  });

  if (info) {
    components.push({ type: 14, divider: true, spacing: 1 });
    components.push({ type: 10, content: `### Sigilo institucional\n${info}`.slice(0, 4000) });
  }

  if (image.mainUrl && ["before_buttons", "above_buttons"].includes(image.position)) pushImage();

  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: "### Abrir denuncia\nSelecione o orgao competente no menu abaixo." });
  components.push({
    type: 1,
    components: [
      {
        type: 3,
        custom_id: PANEL_SELECT_ID,
        placeholder: report.panelPlaceholder.slice(0, 150),
        min_values: 1,
        max_values: 1,
        options
      }
    ]
  });

  if (image.mainUrl && image.position === "bottom") pushImage();

  return components;
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

function withoutFirstPanelLine(value: string | null | undefined) {
  const lines = (value ?? "").split(/\r?\n/);
  const firstIndex = lines.findIndex((line) => line.trim());
  if (firstIndex >= 0) lines.splice(firstIndex, 1);
  return lines.join("\n");
}

function formatPanelBody(value: string | null | undefined) {
  const lines = (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  return lines.map((line) => {
    const normalized = line.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/^(como funciona|importante|sigilo|privacidade|orientacoes|regras)$/i.test(normalized)) {
      return `### ${line}`;
    }
    return line;
  }).join("\n").slice(0, 4000);
}

function buildV2Container(input: { accentColor: number; components: unknown[]; footer?: { enabled?: boolean; image?: string | null; text?: string | null } }) {
  const components = [...input.components];
  const footer = createV2Footer(input.footer ?? { text: "OrviteK" });
  if (footer) components.push({ type: 14, divider: true, spacing: 1 }, footer);
  return {
    type: 17,
    accent_color: input.accentColor,
    components
  };
}

function createV2Footer(footer: { enabled?: boolean; image?: string | null; text?: string | null } | null | undefined) {
  if (!footer || footer.enabled === false) return null;
  const content = `-# ${footer.text ?? "OrviteK"}`.slice(0, 4000) || "-# ";
  if (!footer.image) return { type: 10, content };
  return {
    type: 9,
    components: [{ type: 10, content }],
    accessory: {
      type: 11,
      media: { url: footer.image },
      description: "Imagem de rodape"
    }
  };
}
