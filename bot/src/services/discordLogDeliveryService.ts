import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, MessageFlags, TextDisplayBuilder, type Guild } from "discord.js";
import { currentRuntimeBotId, env } from "../config/env";
import type { BotContext, LogCategory } from "../types";
import type { DiscordLogDispatchEvent } from "../websocket/socketClient";
import { getCachedGuildSettings } from "./guildSettingsCache";
import { automatedLogChannelForType } from "./automatedLogService";
import { isLogsRuntimeAuthorized } from "./logService";

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
  if (log.type === "audit.dev_bot" || !belongsToRuntime(log.botId)) {
    return;
  }

  const guild = context.client.guilds.cache.get(log.guildId);

  if (!guild) {
    return;
  }

  if (!(await isLogsRuntimeAuthorized(context, guild.id))) {
    return;
  }

  const settings = await getCachedGuildSettings(context, log.guildId, context.client.user?.id).catch(() => null);
  const category = logCategoryForType(log.type);
  const automated = await context.api.getAutomatedLogSettings(guild.id).catch(() => null);
  const automatedChannelId = automated?.enabled ? automatedLogChannelForType(automated, log.type) : null;

  if (!settings) {
    return;
  }

  if (!automatedChannelId && (!settings.discordLogsEnabled || !settings.discordLogCategories.includes(category))) {
    return;
  }
  const targetChannelId = log.logChannelId ?? automatedChannelId ?? settings.logChannelId;
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
  const channelName = metadata.channelName ? `#${metadata.channelName}` : metadata.channelId ? `<#${metadata.channelId}>` : "canal desconhecido";
  const authorName = metadata.authorDisplayName || metadata.authorTag || metadata.authorUsername || "Autor desconhecido";
  const content = messageContentForLog(metadata);
  const deletedAt = metadata.deletedAt ? formatDate(metadata.deletedAt) : formatDate(log.createdAt);
  const createdAt = metadata.createdAt ? formatDate(metadata.createdAt) : "horário original desconhecido";
  const maxContentInPanel = 2_800;
  const previewFileName = `mensagem-apagada-${metadata.messageId || log.id}.svg`;
  const files = [buildDeletedMessagePreview(metadata, fallbackGuildName, previewFileName)];
  const textOverflow = content.length > maxContentInPanel;

  if (textOverflow) {
    files.push(new AttachmentBuilder(Buffer.from(content, "utf8"), {
      name: `mensagem-apagada-${metadata.messageId || log.id}.txt`
    }));
  }

  const container = new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${authorNameForPanel(authorName)}\n${metadata.authorId ? `<@${metadata.authorId}>` : ""}`.trim()),
      new TextDisplayBuilder().setContent([
        "📝 **Mensagem de texto deletada**",
        "",
        `**Canal de texto:** ${channelName}`,
        `**Horário original:** ${createdAt}`,
        `**Horário da exclusão:** ${deletedAt}`,
        "",
        "**Mensagem:**",
        limitCodeBlock(content, maxContentInPanel),
        textOverflow ? "\nConteudo completo anexado em `.txt`." : "",
        "",
        metadata.attachments.length ? `**Anexos:** ${metadata.attachments.map(formatAttachmentLine).join(" • ")}` : null,
        metadata.stickers.length ? `**Figurinhas:** ${metadata.stickers.map((item) => item.name).join(", ")}` : null,
        metadata.embeds.length ? `**Embeds:** ${metadata.embeds.length}` : null
      ].filter(Boolean).join("\n"))
    );

  container.addMediaGalleryComponents({
    items: [
      {
        description: "Print da mensagem apagada",
        media: { url: `attachment://${previewFileName}` }
      }
    ],
    type: 12
  });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      metadata.authorId ? `**ID do usuário:** \`${metadata.authorId}\`` : null,
      metadata.messageId ? `**ID da mensagem:** \`${metadata.messageId}\`` : null,
      metadata.channelId ? `**ID do canal:** \`${metadata.channelId}\`` : null,
      `**Apagada em:** ${deletedAt}`
    ].filter(Boolean).join(" • "))
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
  attachments: Array<{ contentType: string | null; height: number | null; name: string; size: number; spoiler: boolean; url: string; width: number | null }>;
  authorAvatarUrl: string | null;
  authorDisplayName: string | null;
  authorId: string | null;
  authorRoleColor: number | null;
  authorTag: string | null;
  authorUsername: string | null;
  authorBot: boolean;
  channelId: string | null;
  channelName: string | null;
  content: string | null;
  createdAt: string | null;
  deletedAt: string | null;
  deletionType: string | null;
  editedAt: string | null;
  embeds: Array<{ description: string | null; imageUrl: string | null; thumbnailUrl: string | null; title: string | null; url: string | null }>;
  executorId: string | null;
  executorTag: string | null;
  guildId: string | null;
  guildName: string | null;
  links: string[];
  messageId: string | null;
  module: string | null;
  reason: string | null;
  reference: { authorDisplayName: string | null; authorId: string | null; authorUsername: string | null; content: string | null; messageId: string } | null;
  referenceMessageId: string | null;
  ruleId: string | null;
  stickers: Array<{ id: string; name: string; url: string | null }>;
  unavailableReason: string | null;
  webhookId: string | null;
};

function deletedMessageMetadata(metadata: unknown): DeletedMessageLogMetadata {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};

  return {
    action: optionalString(record.action),
    attachments: arrayOfRecords(record.attachments).map((item) => ({
      contentType: optionalString(item.contentType),
      height: numberValue(item.height),
      name: optionalString(item.name) ?? "arquivo",
      size: typeof item.size === "number" ? item.size : 0,
      spoiler: Boolean(item.spoiler),
      url: optionalString(item.url) ?? "",
      width: numberValue(item.width)
    })),
    authorAvatarUrl: optionalString(record.authorAvatarUrl),
    authorDisplayName: optionalString(record.authorDisplayName),
    authorId: optionalString(record.authorId),
    authorRoleColor: numberValue(record.authorRoleColor),
    authorTag: optionalString(record.authorTag),
    authorUsername: optionalString(record.authorUsername),
    authorBot: Boolean(record.authorBot),
    channelId: optionalString(record.channelId),
    channelName: optionalString(record.channelName),
    content: optionalString(record.content),
    createdAt: optionalString(record.createdAt),
    deletedAt: optionalString(record.deletedAt),
    deletionType: optionalString(record.deletionType),
    editedAt: optionalString(record.editedAt),
    embeds: arrayOfRecords(record.embeds).map((item) => ({
      description: optionalString(item.description),
      imageUrl: optionalString(item.imageUrl),
      thumbnailUrl: optionalString(item.thumbnailUrl),
      title: optionalString(item.title),
      url: optionalString(item.url) ?? ""
    })),
    executorId: optionalString(record.executorId),
    executorTag: optionalString(record.executorTag),
    guildId: optionalString(record.guildId),
    guildName: optionalString(record.guildName),
    links: arrayOfStrings(record.links),
    messageId: optionalString(record.messageId),
    module: optionalString(record.module),
    reason: optionalString(record.reason),
    reference: referenceMetadata(record.reference),
    referenceMessageId: optionalString(record.referenceMessageId),
    ruleId: optionalString(record.ruleId),
    stickers: arrayOfRecords(record.stickers).map((item) => ({
      id: optionalString(item.id) ?? "",
      name: optionalString(item.name) ?? "sticker",
      url: optionalString(item.url)
    })),
    unavailableReason: optionalString(record.unavailableReason),
    webhookId: optionalString(record.webhookId)
  };
}

function referenceMetadata(value: unknown): DeletedMessageLogMetadata["reference"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const messageId = optionalString(record.messageId);
  if (!messageId) return null;
  return {
    authorDisplayName: optionalString(record.authorDisplayName),
    authorId: optionalString(record.authorId),
    authorUsername: optionalString(record.authorUsername),
    content: optionalString(record.content),
    messageId
  };
}

function messageContentForLog(metadata: DeletedMessageLogMetadata) {
  const text = metadata.content?.trim();
  if (text) return text;

  const summary = [
    metadata.attachments.length ? `${metadata.attachments.length} anexo(s)` : null,
    metadata.embeds.length ? `${metadata.embeds.length} embed(s)` : null,
    metadata.stickers.length ? `${metadata.stickers.length} sticker(s)` : null
  ].filter(Boolean).join(", ");

  return summary
    ? `Mensagem sem texto contendo ${summary}.`
    : metadata.unavailableReason || "Conteúdo não disponível no cache do bot.";
}

function formatAttachmentLine(item: DeletedMessageLogMetadata["attachments"][number]) {
  const details = [
    item.name,
    formatBytes(item.size),
    item.contentType,
    item.width && item.height ? `${item.width}x${item.height}` : null,
    item.spoiler ? "spoiler" : null
  ].filter(Boolean).join(" · ");

  return details || "arquivo";
}

type VoiceLogMetadata = {
  channelId: string | null;
  durationSeconds: number | null;
  fromChannelId: string | null;
  toChannelId: string | null;
};

export function voiceLogMetadata(metadata: unknown): VoiceLogMetadata {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const details = record.details && typeof record.details === "object" && !Array.isArray(record.details)
    ? record.details as Record<string, unknown>
    : {};

  return {
    channelId: optionalString(record.channelId) ?? optionalString(details.channelId),
    durationSeconds: numberValue(record.durationSeconds) ?? numberValue(details.durationSeconds),
    fromChannelId: optionalString(record.fromChannelId) ?? optionalString(details.fromChannelId),
    toChannelId: optionalString(record.toChannelId) ?? optionalString(details.toChannelId)
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

function buildDeletedMessagePreview(metadata: DeletedMessageLogMetadata, guildName: string, fileName: string) {
  const authorName = metadata.authorDisplayName || metadata.authorTag || metadata.authorUsername || "Autor desconhecido";
  const channelName = metadata.channelName ? `#${metadata.channelName}` : metadata.channelId ? `#${metadata.channelId}` : "canal desconhecido";
  const content = messageContentForLog(metadata);
  const contentLines = wrapText(content, 82).slice(0, 18);
  const attachmentLines = metadata.attachments.map((item) => `Anexo: ${item.name} (${formatBytes(item.size)})${item.url ? "" : " - indisponivel"}`).slice(0, 6);
  const embedLines = metadata.embeds.map((item, index) => `Embed ${index + 1}: ${item.title || item.description || item.url || "sem titulo"}`).slice(0, 4);
  const stickerLines = metadata.stickers.map((item) => `Sticker: ${item.name}`).slice(0, 4);
  const referenceLines = metadata.reference
    ? wrapText(`Respondendo ${metadata.reference.authorDisplayName || metadata.reference.authorUsername || metadata.reference.authorId || "mensagem"}: ${metadata.reference.content || "conteudo indisponivel"}`, 78).slice(0, 3)
    : [];
  const contentHeight = Math.max(
    230,
    contentLines.length * 27
      + attachmentLines.length * 24
      + embedLines.length * 24
      + stickerLines.length * 24
      + referenceLines.length * 22
      + 100
  );
  const metaLines = [
    metadata.authorId ? `ID do usuario: ${metadata.authorId}` : null,
    metadata.messageId ? `ID da mensagem: ${metadata.messageId}` : null,
    metadata.channelId ? `ID do canal: ${metadata.channelId}` : null,
    metadata.webhookId ? `Webhook: ${metadata.webhookId}` : null
  ].filter((item): item is string => Boolean(item));
  const height = Math.min(980, 190 + contentHeight + metaLines.length * 22 + 80);
  const messageY = 136;
  const contentY = messageY + 84;
  const footerY = contentY + contentHeight + 34;
  const roleColor = metadata.authorRoleColor ? `#${metadata.authorRoleColor.toString(16).padStart(6, "0")}` : "#5865f2";
  const referenceStartY = contentY + 68;
  const contentStartY = referenceStartY + referenceLines.length * 22 + (referenceLines.length ? 26 : 0);
  const attachmentsStartY = contentStartY + contentLines.length * 27 + 20;
  const embedsStartY = attachmentsStartY + attachmentLines.length * 24 + 8;
  const stickersStartY = embedsStartY + embedLines.length * 24 + 8;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="${height}" viewBox="0 0 1120 ${height}">`,
    "<rect width=\"1120\" height=\"100%\" rx=\"12\" fill=\"#2b2d31\"/>",
    "<rect x=\"0\" y=\"0\" width=\"8\" height=\"100%\" fill=\"#ef4444\"/>",
    "<rect x=\"28\" y=\"26\" width=\"1064\" height=\"72\" rx=\"8\" fill=\"#31343b\"/>",
    `<text x="54" y="58" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="18" font-weight="700">Mensagem removida no servidor ${escapeXml(limitInline(guildName, 90))}</text>`,
    `<text x="54" y="82" fill="#b5bac1" font-family="Arial, sans-serif" font-size="15">Canal: ${escapeXml(limitInline(channelName, 80))} • ${escapeXml(metadata.deletedAt ? formatDate(metadata.deletedAt) : "apagada agora")}</text>`,
    `<circle cx="70" cy="${messageY + 28}" r="24" fill="${roleColor}"/>`,
    `<text x="60" y="${messageY + 38}" fill="#ffffff" font-family="Arial, sans-serif" font-size="24" font-weight="700">${escapeXml(authorName.slice(0, 1).toUpperCase() || "?")}</text>`,
    `<text x="108" y="${messageY + 22}" fill="#f2f3f5" font-family="Arial, sans-serif" font-size="21" font-weight="700">${escapeXml(limitInline(authorName, 64))}${metadata.authorBot ? " BOT" : ""}</text>`,
    `<text x="108" y="${messageY + 48}" fill="#b5bac1" font-family="Arial, sans-serif" font-size="15">${escapeXml(metadata.createdAt ? formatDate(metadata.createdAt) : "horario original desconhecido")}${metadata.editedAt ? " (editada)" : ""}</text>`,
    `<rect x="54" y="${contentY}" width="1012" height="${contentHeight}" rx="6" fill="#383b4d" stroke="#4e5268"/>`,
    `<text x="82" y="${contentY + 34}" fill="#f2f3f5" font-family="Consolas, monospace" font-size="18" font-weight="700">Mensagem:</text>`,
    ...referenceLines.map((line, index) => `<text x="94" y="${referenceStartY + index * 22}" fill="#b5bac1" font-family="Arial, sans-serif" font-size="15">${escapeXml(line)}</text>`),
    referenceLines.length ? `<rect x="82" y="${referenceStartY - 18}" width="4" height="${Math.max(22, referenceLines.length * 22)}" rx="2" fill="#4e5268"/>` : "",
    ...contentLines.map((line, index) => `<text x="82" y="${contentStartY + index * 27}" fill="#ffffff" font-family="Consolas, monospace" font-size="18" font-weight="700">${escapeXml(line)}</text>`),
    ...attachmentLines.map((line, index) => `<text x="82" y="${attachmentsStartY + index * 24}" fill="#dbdee1" font-family="Arial, sans-serif" font-size="16">📎 ${escapeXml(line)}</text>`),
    ...embedLines.map((line, index) => `<text x="82" y="${embedsStartY + index * 24}" fill="#dbdee1" font-family="Arial, sans-serif" font-size="16">▣ ${escapeXml(line)}</text>`),
    ...stickerLines.map((line, index) => `<text x="82" y="${stickersStartY + index * 24}" fill="#dbdee1" font-family="Arial, sans-serif" font-size="16">◇ ${escapeXml(line)}</text>`),
    ...metaLines.map((line, index) => `<text x="54" y="${footerY + index * 22}" fill="#dbdee1" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeXml(line)}</text>`),
    `<text x="54" y="${height - 34}" fill="#949ba4" font-family="Arial, sans-serif" font-size="14">Feito com a NexTech • Snapshot automatico da mensagem apagada</text>`,
    "</svg>"
  ].join("");

  return new AttachmentBuilder(Buffer.from(svg, "utf8"), {
    name: fileName
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

function authorNameForPanel(value: string) {
  return limitInline(value.startsWith("@") ? value : `@${value}`, 90);
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
