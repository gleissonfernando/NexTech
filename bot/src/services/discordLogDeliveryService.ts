import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, MessageFlags, TextDisplayBuilder, type Guild } from "discord.js";
import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext, LogCategory } from "../types";
import type { DiscordLogDispatchEvent } from "../websocket/socketClient";
import { getCachedGuildSettings } from "./guildSettingsCache";
import { automatedLogChannelForType } from "./automatedLogService";

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

  if (!settings?.discordLogsEnabled || !settings.discordLogCategories.includes(category)) {
    return;
  }
  const automated = await context.api.getAutomatedLogSettings(guild.id).catch(() => null);
  const targetChannelId = automated?.enabled ? automatedLogChannelForType(automated, log.type) : settings.logChannelId;
  if (!targetChannelId) return;
  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    console.warn(`[logs] canal ${targetChannelId} indisponível no servidor ${guild.id}.`);
    return;
  }

  if (log.type === "message.delete") {
    await deliverDeletedMessageLog(channel, guild.name, log).catch((error) => {
      console.warn("[logs] falha ao enviar log de mensagem apagada:", error instanceof Error ? error.message : error);
    });
    return;
  }

  if (log.type === "voice.join" || log.type === "voice.leave" || log.type === "voice.move") {
    await deliverVoiceLog(channel, guild, log).catch((error) => {
      console.warn("[logs] falha ao enviar log de voz:", error instanceof Error ? error.message : error);
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(colorForType(log.type, category))
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
      },
      {
        name: "Data e hora",
        value: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date(log.createdAt)),
        inline: false
      }
    )
    .setFooter({
      text: `${guild.client.user.username} • Log ID ${log.id}`
    })
    .setTimestamp(new Date(log.createdAt));

  if (log.userId) {
    embed.addFields({
      name: "Usuário",
      value: `<@${log.userId}> (\`${log.userId}\`)`
    });
    const user = await guild.client.users.fetch(log.userId).catch(() => null);
    if (user) embed.setThumbnail(user.displayAvatarURL({ size: 128 }));
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

async function deliverVoiceLog(
  channel: { send: (options: Record<string, unknown>) => Promise<unknown> },
  guild: Guild,
  log: DiscordLogDispatchEvent
) {
  const metadata = voiceLogMetadata(log.metadata);
  const user = log.userId ? await guild.client.users.fetch(log.userId).catch(() => null) : null;
  const displayName = user?.tag ?? log.userId ?? "Membro desconhecido";
  const avatarUrl = user?.displayAvatarURL({ size: 128 }) ?? null;
  const channelId = metadata.channelId ?? metadata.toChannelId ?? metadata.fromChannelId;
  const fromChannelName = await voiceChannelLabel(guild, metadata.fromChannelId);
  const toChannelName = await voiceChannelLabel(guild, metadata.toChannelId);
  const channelName = await voiceChannelLabel(guild, channelId);
  const duration = typeof metadata.durationSeconds === "number" && metadata.durationSeconds > 0
    ? formatDuration(metadata.durationSeconds)
    : null;
  const config = voiceLogConfig(log.type);

  const lines = log.type === "voice.move"
    ? [
        `${config.pin} **Um membro mudou de canal de voz:**`,
        "",
        `${config.memberIcon} **Membro:** ${log.userId ? `<@${log.userId}> (\`${log.userId}\`)` : `\`${displayName}\``}`,
        `🔴 **Canal anterior:** ${fromChannelName}`,
        `🟢 **Novo canal:** ${toChannelName}`,
        duration ? `⏱️ **Tempo no canal anterior:** ${duration}` : null
      ]
    : [
        `${config.pin} **Um membro ${log.type === "voice.join" ? "entrou em" : "saiu de"} um canal de voz:**`,
        "",
        `${config.memberIcon} **Membro:** ${log.userId ? `<@${log.userId}> (\`${log.userId}\`)` : `\`${displayName}\``}`,
        `${config.channelIcon} **Canal:** ${channelName}`,
        duration ? `⏱️ **Tempo na call:** ${duration}` : null
      ];

  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(config.title)
    .setDescription(lines.filter(Boolean).join("\n"))
    .setFooter({ text: `${guild.client.user.username} - Logs de Voz` })
    .setTimestamp(new Date(log.createdAt));

  if (avatarUrl) embed.setThumbnail(avatarUrl);

  await channel.send({
    allowedMentions: { parse: [] },
    embeds: [embed]
  });
}

async function deliverDeletedMessageLog(
  channel: { send: (options: Record<string, unknown>) => Promise<unknown> },
  fallbackGuildName: string,
  log: DiscordLogDispatchEvent
) {
  const metadata = deletedMessageMetadata(log.metadata);
  const guildName = metadata.guildName || fallbackGuildName;
  const channelName = metadata.channelName ? `#${metadata.channelName}` : metadata.channelId ? `<#${metadata.channelId}>` : "canal desconhecido";
  const authorName = metadata.authorDisplayName || metadata.authorTag || metadata.authorUsername || "Autor desconhecido";
  const content = metadata.content?.trim() || metadata.unavailableReason || "Conteúdo não disponível no cache do bot.";
  const sentAt = metadata.createdAt ? formatDate(metadata.createdAt) : "Não informado";
  const deletedAt = metadata.deletedAt ? formatDate(metadata.deletedAt) : formatDate(log.createdAt);
  const executor = metadata.executorId
    ? `<@${metadata.executorId}>${metadata.executorTag ? ` (${metadata.executorTag})` : ""}`
    : "Não identificado";
  const moduleName = metadata.module || "Logs de mensagens apagadas";
  const reason = metadata.reason || "Não informado";
  const maxContentInPanel = 2_800;
  const files = [buildDeletedMessagePreview(metadata, guildName)];
  const textOverflow = content.length > maxContentInPanel;

  if (textOverflow) {
    files.push(new AttachmentBuilder(Buffer.from(content, "utf8"), {
      name: `mensagem-apagada-${metadata.messageId || log.id}.txt`
    }));
  }

  const mediaLines = [
    metadata.attachments.length ? `**Anexos:** ${metadata.attachments.length}\n${metadata.attachments.slice(0, 5).map((item, index) => `${index + 1}. ${item.name} (${formatBytes(item.size)}${item.contentType ? `, ${item.contentType}` : ""})\n${item.url}`).join("\n")}` : null,
    metadata.stickers.length ? `**Figurinhas:** ${metadata.stickers.map((item) => `${item.name} (${item.id})`).join(", ")}` : null,
    metadata.embeds.length ? `**Embeds:** ${metadata.embeds.length}${metadata.embeds[0]?.title ? ` - ${metadata.embeds[0].title}` : ""}` : null,
    metadata.links.length ? `**Links:** ${metadata.links.slice(0, 5).join("\n")}` : null
  ].filter(Boolean).join("\n\n") || "Sem anexos, figurinhas, embeds ou links registrados.";

  const container = new ContainerBuilder()
    .setAccentColor(0xf0b232)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# Mensagem apagada\nMensagem apagada no servidor **${limitInline(guildName, 120)}** no canal ${channelName}.`),
      new TextDisplayBuilder().setContent([
        "## Autor",
        `**Nome:** ${limitInline(authorName, 120)}`,
        metadata.authorUsername ? `**Usuário:** ${limitInline(metadata.authorUsername, 120)}` : null,
        metadata.authorId ? `**ID:** \`${metadata.authorId}\`` : "**ID:** não informado",
        `**Mensagem enviada em:** ${sentAt}`
      ].filter(Boolean).join("\n")),
      new TextDisplayBuilder().setContent([
        "## Mensagem apagada",
        limitCodeBlock(content, maxContentInPanel),
        textOverflow ? "\nConteudo completo anexado em `.txt`." : ""
      ].join("\n")),
      new TextDisplayBuilder().setContent([
        "## Midias e links",
        limitText(mediaLines, 1_500)
      ].join("\n")),
      new TextDisplayBuilder().setContent([
        "## Detalhes da exclusão",
        metadata.channelId ? `**Canal:** ${channelName}\n**ID do canal:** \`${metadata.channelId}\`` : null,
        metadata.authorId ? `**Autor:** ${metadata.authorUsername ? `@${metadata.authorUsername}` : authorName}\n**ID do autor:** \`${metadata.authorId}\`` : null,
        metadata.messageId ? `**ID da mensagem:** \`${metadata.messageId}\`` : null,
        `**Módulo responsável:** ${limitInline(moduleName, 120)}`,
        metadata.ruleId ? `**Regra acionada:** \`${metadata.ruleId}\`` : null,
        `**Ação:** ${metadata.action || "DELETE"}`,
        `**Tipo:** ${metadata.deletionType || "UNKNOWN"}`,
        `**Executor:** ${executor}`,
        `**Motivo:** ${limitInline(reason, 240)}`,
        `**Excluida em:** ${deletedAt}`
      ].filter(Boolean).join("\n"))
    );

  if (metadata.guildId && metadata.channelId) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Abrir canal")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${metadata.guildId}/${metadata.channelId}`)
    );
    container.addActionRowComponents(row);
  }

  await channel.send({
    allowedMentions: {
      parse: []
    },
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2
  });
}

type DeletedMessageLogMetadata = {
  action: string | null;
  attachments: Array<{ contentType: string | null; name: string; size: number; url: string }>;
  authorDisplayName: string | null;
  authorId: string | null;
  authorTag: string | null;
  authorUsername: string | null;
  channelId: string | null;
  channelName: string | null;
  content: string | null;
  createdAt: string | null;
  deletedAt: string | null;
  deletionType: string | null;
  embeds: Array<{ title: string | null; url: string | null }>;
  executorId: string | null;
  executorTag: string | null;
  guildId: string | null;
  guildName: string | null;
  links: string[];
  messageId: string | null;
  module: string | null;
  reason: string | null;
  ruleId: string | null;
  stickers: Array<{ id: string; name: string }>;
  unavailableReason: string | null;
};

function deletedMessageMetadata(metadata: unknown): DeletedMessageLogMetadata {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};

  return {
    action: optionalString(record.action),
    attachments: arrayOfRecords(record.attachments).map((item) => ({
      contentType: optionalString(item.contentType),
      name: optionalString(item.name) ?? "arquivo",
      size: typeof item.size === "number" ? item.size : 0,
      url: optionalString(item.url) ?? ""
    })),
    authorDisplayName: optionalString(record.authorDisplayName),
    authorId: optionalString(record.authorId),
    authorTag: optionalString(record.authorTag),
    authorUsername: optionalString(record.authorUsername),
    channelId: optionalString(record.channelId),
    channelName: optionalString(record.channelName),
    content: optionalString(record.content),
    createdAt: optionalString(record.createdAt),
    deletedAt: optionalString(record.deletedAt),
    deletionType: optionalString(record.deletionType),
    embeds: arrayOfRecords(record.embeds).map((item) => ({
      title: optionalString(item.title),
      url: optionalString(item.url)
    })),
    executorId: optionalString(record.executorId),
    executorTag: optionalString(record.executorTag),
    guildId: optionalString(record.guildId),
    guildName: optionalString(record.guildName),
    links: arrayOfStrings(record.links),
    messageId: optionalString(record.messageId),
    module: optionalString(record.module),
    reason: optionalString(record.reason),
    ruleId: optionalString(record.ruleId),
    stickers: arrayOfRecords(record.stickers).map((item) => ({
      id: optionalString(item.id) ?? "",
      name: optionalString(item.name) ?? "sticker"
    })),
    unavailableReason: optionalString(record.unavailableReason)
  };
}

type VoiceLogMetadata = {
  channelId: string | null;
  durationSeconds: number | null;
  fromChannelId: string | null;
  toChannelId: string | null;
};

function voiceLogMetadata(metadata: unknown): VoiceLogMetadata {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};

  return {
    channelId: optionalString(record.channelId),
    durationSeconds: typeof record.durationSeconds === "number" ? record.durationSeconds : null,
    fromChannelId: optionalString(record.fromChannelId),
    toChannelId: optionalString(record.toChannelId)
  };
}

function voiceLogConfig(type: string) {
  if (type === "voice.join") {
    return {
      channelIcon: "🔊",
      color: 0x22c55e,
      memberIcon: "📌",
      pin: "📌",
      title: "✅ LOG DE ENTRADA NO CANAL DE VOZ"
    };
  }

  if (type === "voice.move") {
    return {
      channelIcon: "🔁",
      color: 0x3b82f6,
      memberIcon: "📌",
      pin: "📌",
      title: "🔁 LOG DE MUDANÇA DE CANAL DE VOZ"
    };
  }

  return {
    channelIcon: "📍",
    color: 0xef4444,
    memberIcon: "📌",
    pin: "📌",
    title: "❌ LOG DE SAÍDA DO CANAL DE VOZ"
  };
}

async function voiceChannelLabel(guild: Guild, channelId: string | null | undefined) {
  if (!channelId) return "`Canal não informado`";
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  const name = channel && "name" in channel && typeof channel.name === "string" ? channel.name : null;
  return name ? `[${name}](https://discord.com/channels/${guild.id}/${channelId})` : `<#${channelId}>`;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function buildDeletedMessagePreview(metadata: DeletedMessageLogMetadata, guildName: string) {
  const authorName = metadata.authorDisplayName || metadata.authorTag || metadata.authorUsername || "Autor desconhecido";
  const channelName = metadata.channelName ? `#${metadata.channelName}` : metadata.channelId ? `#${metadata.channelId}` : "canal desconhecido";
  const content = metadata.content?.trim() || metadata.unavailableReason || "Conteúdo não disponível.";
  const contentLines = wrapText(content, 78).slice(0, 18);
  const height = Math.min(920, 250 + contentLines.length * 24);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="${height}" viewBox="0 0 1120 ${height}">`,
    "<rect width=\"1120\" height=\"100%\" fill=\"#0b0b0d\"/>",
    "<rect x=\"0\" y=\"0\" width=\"1120\" height=\"8\" fill=\"#f0b232\"/>",
    `<text x="48" y="58" fill="#f8fafc" font-family="Arial, sans-serif" font-size="28" font-weight="700">Mensagem apagada</text>`,
    `<text x="48" y="95" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="18">Servidor: ${escapeXml(limitInline(guildName, 90))}</text>`,
    `<text x="48" y="123" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="18">Canal: ${escapeXml(limitInline(channelName, 90))}</text>`,
    "<rect x=\"48\" y=\"154\" width=\"1024\" height=\"120\" rx=\"8\" fill=\"#1f2027\" stroke=\"#383a45\"/>",
    "<circle cx=\"94\" cy=\"211\" r=\"28\" fill=\"#f0b232\"/>",
    `<text x="84" y="222" fill="#0b0b0d" font-family="Arial, sans-serif" font-size="26" font-weight="700">${escapeXml(authorName.slice(0, 1).toUpperCase() || "?")}</text>`,
    `<text x="138" y="198" fill="#ffffff" font-family="Arial, sans-serif" font-size="21" font-weight="700">${escapeXml(limitInline(authorName, 70))}</text>`,
    `<text x="138" y="229" fill="#a1a1aa" font-family="Arial, sans-serif" font-size="16">Enviada em ${escapeXml(metadata.createdAt ? formatDate(metadata.createdAt) : "horario desconhecido")}</text>`,
    "<rect x=\"48\" y=\"306\" width=\"1024\" height=\"" + Math.max(130, contentLines.length * 28 + 40) + "\" rx=\"8\" fill=\"#15161b\" stroke=\"#383a45\"/>",
    `<text x="76" y="344" fill="#f8fafc" font-family="Arial, sans-serif" font-size="20" font-weight="700">Conteúdo removido</text>`,
    ...contentLines.map((line, index) => `<text x="76" y="${384 + index * 24}" fill="#e4e4e7" font-family="Consolas, monospace" font-size="17">${escapeXml(line)}</text>`),
    `<text x="48" y="${height - 80}" fill="#a1a1aa" font-family="Arial, sans-serif" font-size="16">ID usuário: ${escapeXml(metadata.authorId ?? "não informado")} | ID mensagem: ${escapeXml(metadata.messageId ?? "não informado")}</text>`,
    `<text x="48" y="${height - 50}" fill="#a1a1aa" font-family="Arial, sans-serif" font-size="16">ID servidor: ${escapeXml(metadata.guildId ?? "não informado")} | ID canal: ${escapeXml(metadata.channelId ?? "não informado")}</text>`,
    "</svg>"
  ].join("");

  return new AttachmentBuilder(Buffer.from(svg, "utf8"), {
    name: `mensagem-apagada-${metadata.messageId ?? "preview"}.svg`
  });
}

function limitCodeBlock(value: string, maxLength: number) {
  const limited = limitText(value, maxLength).replace(/```/g, "`\u200b``");
  return `\`\`\`\n${limited}\n\`\`\``;
}

function limitInline(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1).replace(".", ",")} ${units[unit]}`;
}

function wrapText(value: string, width: number) {
  const lines: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    let line = rawLine;
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
    lines.push(line || " ");
  }
  return lines;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
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
    "message.bulk_delete": "Mensagens apagadas em massa",
    "voice.join": "🔊 Entrada em Call",
    "voice.leave": "🔇 Saída de Call",
    "voice.move": "🔁 Movimentação em Call",
    "voice.temporary_call": "🎧 Call Temporária",
    "roles.update": "Cargos atualizados",
    "dashboard.settings.updated": "Configuração atualizada"
  };

  return titles[log.type] ?? CATEGORY_LABELS[logCategoryForType(log.type)];
}

function colorForType(type: string, category: LogCategory) {
  const value = type.toLowerCase();
  if (value.startsWith("voice.")) return 0x3b82f6;
  if (value.startsWith("message.") || value.includes("spam") || value.includes("link")) return 0xf97316;
  if (value.includes("verification")) return 0x22c55e;
  if (value.includes("absence") || value.includes("ausencia") || value.includes("fivem.fac")) return 0x8b5cf6;
  if (value.includes("punish") || value.includes("warning") || category === "moderation") return 0xef4444;
  if (category === "dashboard") return 0x27272a;
  return CATEGORY_COLORS[category];
}

function metadataFields(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const record = metadata as Record<string, unknown>;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  addMetadataField(fields, "Conteúdo", record.content);
  addMetadataField(fields, "Antes", record.before);
  addMetadataField(fields, "Depois", record.after);
  addMetadataField(fields, "Motivo", record.reason);
  addMetadataField(fields, "Cargos adicionados", record.added);
  addMetadataField(fields, "Cargos removidos", record.removed);
  addMetadataField(fields, "Canal", record.channelId);
  addMetadataField(fields, "Canal anterior", record.fromChannelId);
  addMetadataField(fields, "Novo canal", record.toChannelId);
  addMetadataField(fields, "ID da mensagem", record.messageId);
  addMetadataField(fields, "Tempo na call (segundos)", record.durationSeconds);

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

  if (typeof value === "number" || typeof value === "boolean") return String(value);

  return "";
}

function limitText(value: string, maxLength: number) {
  const normalized = value.trim() || "Evento registrado.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
