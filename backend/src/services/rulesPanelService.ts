import axios from "axios";
import type { GuildSettingsDto } from "./settingsService";
import { updateGuildSettings } from "./settingsService";

const DISCORD_API = "https://discord.com/api/v10";
export const RULES_ACCEPT_BUTTON_ID = "rules_accept";

type DiscordMessage = {
  id: string;
};

export async function publishRulesPanelToDiscord(settings: GuildSettingsDto, botToken: string | null) {
  if (!botToken) {
    throw new Error("Token do bot nao configurado para publicar o painel de regras.");
  }

  if (!settings.rulesChannelId) {
    throw new Error("Selecione o canal onde o painel de regras sera enviado.");
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

  return data.id;
}

function buildRulesPanelPayload(settings: GuildSettingsDto) {
  const rules = formatRuleLines(settings.rulesMessage);
  const columns = splitRulesIntoFields(rules);
  const roleLine = settings.rulesRoleId
    ? `Ao aceitar, voce recebe automaticamente o cargo <@&${settings.rulesRoleId}>.`
    : "Ao aceitar, voce confirma que leu e concorda com as regras do servidor.";

  return {
    embeds: [
      {
        title: `📜 ${settings.rulesTitle || "Regras do servidor"}`,
        description: [
          "Leia com atenção antes de liberar seu acesso.",
          "A equipe pode aplicar advertência, timeout, kick ou banimento conforme a gravidade."
        ].join("\n"),
        color: parseColor(settings.rulesColor),
        fields: [
          ...columns.map((lines, index) => ({
            name: index === 0 ? "Conduta" : "Segurança e convivência",
            value: lines.join("\n")
          })),
          {
            name: "Aceite",
            value: roleLine
          }
        ],
        footer: {
          text: "Obrigado por ajudar a manter a comunidade organizada."
        },
        timestamp: new Date().toISOString()
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: RULES_ACCEPT_BUTTON_ID,
            label: settings.rulesButtonLabel || "Li e aceito",
            style: 3
          }
        ]
      }
    ]
  };
}

function formatRuleLines(value: string | null) {
  const lines = (value ?? "")
    .split(/\r?\n/)
    .map(cleanRuleLine)
    .filter(Boolean)
    .slice(0, 10)
    .map((line, index) => `**${index + 1}.** ${line}`);

  return lines.length ? lines : ["**1.** Respeite as regras do servidor."];
}

function cleanRuleLine(line: string) {
  return line
    .replace(/^\s*(?:\d+[.)-]\s*)/, "")
    .replace(/\(?\s*puni[cç][aã]o\s*:\s*banimento\s+permanente\s*[!|]*\s*\)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.!?。]*$/, ".");
}

function splitRulesIntoFields(lines: string[]) {
  const midpoint = Math.ceil(lines.length / 2);
  return [
    lines.slice(0, midpoint),
    lines.slice(midpoint)
  ].filter((group) => group.length);
}

function parseColor(value: string | null) {
  const normalized = value?.replace("#", "").trim();
  return normalized && /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0xef4444;
}
