import { EmbedBuilder } from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext, LogCategory } from "../types";
import type { DiscordLogDispatchEvent } from "../websocket/socketClient";
import { getCachedGuildSettings } from "./guildSettingsCache";

const CATEGORY_LABELS: Record<LogCategory, string> = {
  members: "Membros",
  messages: "Mensagens",
  roles: "Cargos",
  moderation: "Moderacao",
  dashboard: "Dashboard",
  automation: "Automacoes"
};

const CATEGORY_COLORS: Record<LogCategory, number> = {
  members: 0x23a55a,
  messages: 0x5865f2,
  roles: 0xf0b232,
  moderation: 0xed4245,
  dashboard: 0x9b59b6,
  automation: 0x2b2d31
};

let started = false;

export function startDiscordLogDelivery(context: BotContext) {
  if (started) {
    return;
  }

  started = true;
  context.socket.onDiscordLogDispatch((log) => {
    void deliverDiscordLog(context, log);
  });
}

async function deliverDiscordLog(context: BotContext, log: DiscordLogDispatchEvent) {
  if (!isBotModuleEnabled("logs") || log.type === "audit.dev_bot" || !belongsToRuntime(log.botId)) {
    return;
  }

  const guild = context.client.guilds.cache.get(log.guildId);

  if (!guild) {
    return;
  }

  const settings = await getCachedGuildSettings(context, log.guildId, context.client.user?.id).catch(() => null);
  const category = logCategoryForType(log.type);

  if (
    !settings?.discordLogsEnabled
    || !settings.logChannelId
    || !settings.discordLogCategories.includes(category)
  ) {
    return;
  }

  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    console.warn(`[logs] canal ${settings.logChannelId} indisponivel no servidor ${guild.id}.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(CATEGORY_COLORS[category])
    .setTitle(logTitle(log))
    .setDescription(limitText(log.message, 2_000))
    .addFields(
      {
        name: "Categoria",
        value: CATEGORY_LABELS[category],
        inline: true
      },
      {
        name: "Tipo",
        value: `\`${limitText(log.type, 240)}\``,
        inline: true
      }
    )
    .setFooter({
      text: `Log ID ${log.id}`
    })
    .setTimestamp(new Date(log.createdAt));

  if (log.userId) {
    embed.addFields({
      name: "Usuario",
      value: `<@${log.userId}> (\`${log.userId}\`)`
    });
  }

  for (const field of metadataFields(log.metadata)) {
    embed.addFields(field);
  }

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds: [embed]
  }).catch((error) => {
    console.warn("[logs] falha ao enviar log no Discord:", error instanceof Error ? error.message : error);
  });
}

function belongsToRuntime(botId: string | null) {
  const runtimeBotId = currentRuntimeBotId() ?? (env.DASHBOARD_BOT_ID.trim() || null);
  return runtimeBotId ? botId === runtimeBotId : botId === null;
}

function logCategoryForType(type: string): LogCategory {
  const normalized = type.trim().toLowerCase();

  if (normalized.startsWith("member.")) return "members";
  if (normalized.startsWith("message.")) return "messages";
  if (normalized.startsWith("roles.")) return "roles";
  if (
    normalized.startsWith("moderation.")
    || normalized.startsWith("security.")
    || normalized.startsWith("image_anti_spam.")
    || normalized.startsWith("self_bot_protection.")
  ) {
    return "moderation";
  }
  if (
    normalized.startsWith("dashboard.")
    || normalized.startsWith("audit.")
    || normalized.startsWith("access.")
  ) {
    return "dashboard";
  }

  return "automation";
}

function logTitle(log: DiscordLogDispatchEvent) {
  const titles: Record<string, string> = {
    "member.join": "Membro entrou",
    "member.leave": "Membro saiu",
    "message.delete": "Mensagem apagada",
    "message.update": "Mensagem editada",
    "roles.update": "Cargos atualizados",
    "dashboard.settings.updated": "Configuracao atualizada"
  };

  return titles[log.type] ?? CATEGORY_LABELS[logCategoryForType(log.type)];
}

function metadataFields(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const record = metadata as Record<string, unknown>;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  addMetadataField(fields, "Conteudo", record.content);
  addMetadataField(fields, "Antes", record.before);
  addMetadataField(fields, "Depois", record.after);
  addMetadataField(fields, "Motivo", record.reason);
  addMetadataField(fields, "Cargos adicionados", record.added);
  addMetadataField(fields, "Cargos removidos", record.removed);

  return fields.slice(0, 4);
}

function addMetadataField(
  fields: Array<{ name: string; value: string; inline?: boolean }>,
  name: string,
  value: unknown
) {
  const formatted = formatMetadataValue(value);

  if (formatted) {
    fields.push({
      name,
      value: limitText(formatted, 500)
    });
  }
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean).join(", ");
  }

  return "";
}

function limitText(value: string, maxLength: number) {
  const normalized = value.trim() || "Evento registrado.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
