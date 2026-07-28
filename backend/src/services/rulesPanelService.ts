import axios from "axios";
import { env } from "../config/env";
import { createLog } from "./logService";
import type { GuildSettingsDto, RulesPanelButtonDto, RulesPanelCategoryDto } from "./settingsService";
import { updateGuildSettings } from "./settingsService";

const DISCORD_API = "https://discord.com/api/v10";
const COMPONENTS_V2_FLAG = 1 << 15;
export const RULES_ACCEPT_BUTTON_ID = "rules_accept";
export const RULES_ACTION_BUTTON_PREFIX = "rules_action:";

type DiscordMessage = {
  id: string;
};

type DiscordComponent = Record<string, unknown>;

export async function publishRulesPanelToDiscord(settings: GuildSettingsDto, botToken: string | null) {
  if (!botToken) {
    throw new Error("Token do bot não configurado para publicar o painel de regras.");
  }

  if (!settings.rulesChannelId) {
    throw new Error("Selecione o canal onde o painel de regras será enviado.");
  }

  const payload = buildRulesPanelPayload(settings);
  const headers = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json"
  };

  if (settings.rulesPanelMessageId) {
    try {
      const { data } = await axios.patch<DiscordMessage>(
        `${DISCORD_API}/channels/${settings.rulesChannelId}/messages/${settings.rulesPanelMessageId}`,
        payload,
        {
          headers,
          timeout: 10_000
        }
      );

      await logRulesPanelEvent(settings, "rules.panel_updated", "Painel de regras atualizado.", data.id);
      return data.id;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : null;

      if (status !== 404) {
        throw error;
      }
    }
  }

  const { data } = await axios.post<DiscordMessage>(
    `${DISCORD_API}/channels/${settings.rulesChannelId}/messages`,
    payload,
    {
      headers,
      timeout: 10_000
    }
  );

  await updateGuildSettings(settings.guildId, {
    rulesPanelMessageId: data.id
  }, settings.botId);
  await logRulesPanelEvent(settings, "rules.panel_created", "Painel de regras criado.", data.id);

  return data.id;
}

export function buildRulesPanelPayload(settings: GuildSettingsDto) {
  const components: DiscordComponent[] = [];
  const imageUrl = resolveRulesImageUrl(settings);
  const textComponents = buildRulesTextComponents(settings);

  if (imageUrl && settings.rulesImageFormat === "horizontal") {
    components.push({
      type: 12,
      items: [
        {
          media: {
            url: imageUrl
          }
        }
      ]
    });
  }

  if (imageUrl && (settings.rulesImageFormat === "square" || settings.rulesImageFormat === "vertical")) {
    components.push({
      type: 9,
      components: textComponents.slice(0, 3),
      accessory: {
        type: 11,
        media: {
          url: imageUrl
        }
      }
    });
    components.push(...textComponents.slice(3));
  } else {
    components.push(...textComponents);
  }

  const buttonRow = buildRulesButtonRow(settings.rulesButtons);
  if (buttonRow) {
    components.push(buttonRow);
  }

  const accentColor = parseColor(settings.rulesColor);

  return {
    allowed_mentions: {
      parse: []
    },
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components
      }
    ],
    embeds: [],
    flags: COMPONENTS_V2_FLAG
  };
}

function buildRulesTextComponents(settings: GuildSettingsDto): DiscordComponent[] {
  const title = settings.rulesTitle || "Regras e Diretrizes da Loja";
  const subtitle = settings.rulesSubtitle || "Regras Oficiais do Servidor";
  const categories = activeRulesCategories(settings.rulesCategories);
  const lines = [
    `# 📜 ${title}`,
    subtitle ? `**${subtitle}**` : null,
    ...categories.flatMap((category, index) => formatCategory(category, index)),
    settings.rulesFooterText ? `*${settings.rulesFooterText}*` : null
  ].filter((line): line is string => Boolean(line));

  return chunkText(lines.join("\n\n"), 3900).map((content) => ({
    type: 10,
    content
  }));
}

function formatCategory(category: RulesPanelCategoryDto, index: number) {
  const lines = [
    `## ${category.emoji || "💜"} ${index + 1}. ${category.name}`,
    category.description ? `> ${category.description}` : null,
    ...category.rules.map((rule) => `• ${rule}`)
  ];

  return lines.filter((line): line is string => Boolean(line));
}

function activeRulesCategories(categories: RulesPanelCategoryDto[]) {
  const active = categories
    .filter((category) => category.enabled !== false && category.rules.length)
    .sort((left, right) => left.order - right.order);

  return active.length
    ? active
    : [
      {
        description: "Leia com atenção antes de participar.",
        emoji: "📜",
        enabled: true,
        id: "regras-gerais",
        name: "Regras gerais",
        order: 1,
        rules: ["Respeite as regras do servidor."]
      }
    ];
}

function buildRulesButtonRow(buttons: RulesPanelButtonDto[]) {
  const components = buttons
    .filter((button) => button.enabled !== false)
    .sort((left, right) => left.order - right.order)
    .slice(0, 5)
    .map(buildRulesButton)
    .filter((button): button is DiscordComponent => Boolean(button));

  return components.length
    ? {
      type: 1,
      components
    }
    : null;
}

function buildRulesButton(button: RulesPanelButtonDto): DiscordComponent | null {
  const emoji = parseEmoji(button.emoji);
  const base = {
    type: 2,
    label: button.label,
    ...(emoji ? { emoji } : {})
  };

  if (button.action === "url") {
    if (!button.url) return null;
    return {
      ...base,
      style: 5,
      url: button.url
    };
  }

  return {
    ...base,
    custom_id: button.action === "accept" ? RULES_ACCEPT_BUTTON_ID : `${RULES_ACTION_BUTTON_PREFIX}${button.id}`,
    style: buttonStyleToDiscord(button.style)
  };
}

function parseEmoji(value: string | null) {
  if (!value) return null;
  const custom = value.match(/^<(a?):([a-zA-Z0-9_]{2,32}):(\d{5,32})>$/);
  if (custom) {
    return {
      animated: custom[1] === "a",
      id: custom[3],
      name: custom[2]
    };
  }

  return {
    name: value
  };
}

function buttonStyleToDiscord(style: RulesPanelButtonDto["style"]) {
  switch (style) {
    case "danger":
      return 4;
    case "secondary":
      return 2;
    case "success":
      return 3;
    case "primary":
    default:
      return 1;
  }
}

function resolveRulesImageUrl(settings: GuildSettingsDto) {
  if (settings.rulesImageFormat === "none") {
    return null;
  }

  const source = settings.rulesPanelImage?.imageUrl || settings.rulesImageUrl;
  if (!source) {
    return null;
  }

  if (/^https?:\/\//i.test(source)) {
    return source;
  }

  const origin = env.APP_PUBLIC_URL || env.FRONTEND_PUBLIC_URL || "https://nextech.discloud.app";
  return `${origin}${source.startsWith("/") ? source : `/${source}`}`;
}

function chunkText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const splitAt = Math.max(slice.lastIndexOf("\n## "), slice.lastIndexOf("\n\n"));
    const end = splitAt > 500 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.slice(0, 4);
}

function parseColor(value: string | null) {
  const normalized = value?.replace("#", "").trim();
  return normalized && /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xef4444;
}

async function logRulesPanelEvent(settings: GuildSettingsDto, type: string, message: string, messageId: string) {
  if (!settings.botId) {
    return;
  }

  await createLog({
    botId: settings.botId,
    channelId: settings.rulesChannelId,
    guildId: settings.guildId,
    message,
    metadata: {
      messageId,
      title: settings.rulesTitle
    },
    module: "rules",
    type
  }).catch(() => null);
}
