import {
  ContainerBuilder,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type GuildMember,
  type Message
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type {
  ImageAntiSpamIncident,
  ImageAntiSpamIncidentResult,
  ImageAntiSpamSettings
} from "./apiClient";
import { clearRuntimeModuleAuthorization, isRuntimeModuleAuthorized, runtimeScopeKey } from "./runtimeModuleGuard";
import { canModerateMessage } from "./moderationChannelPolicy";

type CachedSettings = {
  expiresAt: number;
  settings: ImageAntiSpamSettings;
};

type UserWindow = {
  expiresAt: number;
  incidentKey: string | null;
  logChannelId: string | null;
  logMessageId: string | null;
  mediaCount: number;
  messages: MediaMessageRef[];
  startedAt: number;
};

type DeletionResult = {
  error: string | null;
  messageIds: string[];
  removedMediaCount: number;
  removedMessageCount: number;
  succeeded: boolean;
};

type MediaKind = "attachment" | "embed" | "gif" | "image" | "sticker";

type MediaSummary = {
  attachmentCount: number;
  embedCount: number;
  gifCount: number;
  imageCount: number;
  kinds: MediaKind[];
  mediaCount: number;
  stickerCount: number;
};

type MediaMessageRef = {
  channelId: string;
  createdAt: number;
  deleted: boolean;
  mediaCount: number;
  message: Message;
  messageId: string;
  summary: MediaSummary;
  error: string | null;
};

const SETTINGS_CACHE_MS = 30_000;
const MODULE_ID = "image-anti-spam";
const MAX_TRACKED_MESSAGES_PER_WINDOW = 100;
const settingsCache = new Map<string, CachedSettings>();
const userWindows = new Map<string, UserWindow>();
const processingQueues = new Map<string, Promise<boolean>>();
let serviceStarted = false;

export function startImageAntiSpamService(context: BotContext) {
  if (serviceStarted || !isBotModuleEnabled("image-anti-spam")) {
    return;
  }

  serviceStarted = true;
  context.socket.onImageAntiSpamSettingsUpdated((payload) => {
    if (payload.botId && env.DASHBOARD_BOT_ID && payload.botId !== env.DASHBOARD_BOT_ID) {
      return;
    }

    clearRuntimeModuleAuthorization(payload.guildId, MODULE_ID);
    settingsCache.delete(runtimeScopeKey(payload.guildId));
    clearGuildWindows(payload.guildId);
  });
}

export async function handleImageAntiSpamMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot) {
    return false;
  }
  if ((await canModerateMessage(message, context, MODULE_ID)).ignored) return false;

  if (!isBotModuleEnabled(MODULE_ID) || !(await isRuntimeModuleAuthorized(context, message.guild.id, MODULE_ID))) {
    return false;
  }

  const key = runtimeScopeKey(message.guild.id, message.author.id);
  const previous = processingQueues.get(key) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(() => processImageMessage(message, context))
    .catch((error) => {
      console.warn("[image-anti-spam] falha ao processar mensagem:", errorMessage(error));
      return false;
    })
    .finally(() => {
      if (processingQueues.get(key) === next) {
        processingQueues.delete(key);
      }
    });

  processingQueues.set(key, next);
  return next;
}

async function processImageMessage(message: Message, context: BotContext) {
  const guild = message.guild;

  if (!guild) {
    return false;
  }

  const settings = await getCachedSettings(guild.id, context);

  if (!settings.enabled) {
    return false;
  }

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);

  if (!member || isImmune(member, settings)) {
    return false;
  }

  const media = inspectMediaMessage(message);
  if (media.mediaCount === 0) return false;

  const key = runtimeScopeKey(guild.id, message.author.id);
  const now = Date.now();
  let window = userWindows.get(key);

  if (!window || now >= window.expiresAt) {
    window = {
      expiresAt: now + settings.windowSeconds * 1_000,
      incidentKey: null,
      logChannelId: null,
      logMessageId: null,
      mediaCount: 0,
      messages: [],
      startedAt: now
    };
    userWindows.set(key, window);
    scheduleWindowCleanup(key, window);
  }

  rememberMediaMessage(window, message, media);

  if (window.mediaCount <= settings.maxImages) {
    return false;
  }

  const deletion = await deleteMediaSpamMessages(window.messages);
  window.incidentKey ??= runtimeScopeKey(guild.id, message.author.id, String(window.startedAt));

  const result = await context.api.recordImageAntiSpamIncident({
    guildId: guild.id,
    incidentKey: window.incidentKey,
    userId: message.author.id,
    username: message.author.tag,
    channelId: message.channelId,
    channelIds: collectChannelIds(window.messages),
    mediaTypes: collectMediaTypes(window.messages),
    messageIds: deletion.messageIds,
    removedImages: deletion.removedMediaCount,
    removedMessages: deletion.removedMessageCount
  });

  let incident = result.incident;

  if (!result.duplicate) {
    const outcome = mergeActionOutcome(deletion, await applyPunishment(member, message, result));
    incident = await context.api.completeImageAntiSpamIncident(incident.id, outcome);
  }

  await upsertDiscordLog(message, result.settings, incident, window);
  return deletion.succeeded;
}

function rememberMediaMessage(window: UserWindow, message: Message, media: MediaSummary) {
  const existing = window.messages.find((entry) => entry.messageId === message.id);

  if (existing) {
    window.mediaCount = Math.max(0, window.mediaCount - existing.mediaCount + media.mediaCount);
    existing.channelId = message.channelId;
    existing.mediaCount = media.mediaCount;
    existing.message = message;
    existing.summary = media;
    return;
  }

  window.messages.push({
    channelId: message.channelId,
    createdAt: Date.now(),
    deleted: false,
    error: null,
    mediaCount: media.mediaCount,
    message,
    messageId: message.id,
    summary: media
  });
  window.mediaCount += media.mediaCount;

  if (window.messages.length > MAX_TRACKED_MESSAGES_PER_WINDOW) {
    const removed = window.messages.splice(0, window.messages.length - MAX_TRACKED_MESSAGES_PER_WINDOW);
    window.mediaCount = Math.max(
      0,
      window.mediaCount - removed.reduce((total, entry) => total + entry.mediaCount, 0)
    );
  }
}

async function deleteMediaSpamMessages(messages: MediaMessageRef[]): Promise<DeletionResult> {
  const errors: string[] = [];
  const messageIds: string[] = [];
  let removedMediaCount = 0;
  let removedMessageCount = 0;

  for (const entry of messages) {
    if (entry.deleted) {
      continue;
    }

    try {
      await entry.message.delete();
      entry.deleted = true;
      entry.error = null;
      messageIds.push(entry.messageId);
      removedMediaCount += entry.mediaCount;
      removedMessageCount += 1;
    } catch (error) {
      const messageError = errorMessage(error);
      entry.error = messageError;
      errors.push(`${entry.messageId}: ${messageError}`);
      console.warn(
        `[image-anti-spam] nao foi possivel apagar a mensagem ${entry.messageId}:`,
        messageError
      );
    }
  }

  return {
    error: errors.length ? `delete_messages: ${errors.join(" | ")}` : null,
    messageIds,
    removedMediaCount,
    removedMessageCount,
    succeeded: errors.length === 0
  };
}

function mergeActionOutcome(
  deletion: DeletionResult,
  punishment: {
    actionError: string | null;
    actionSucceeded: boolean;
  }
) {
  const actionError = [deletion.error, punishment.actionError].filter(Boolean).join(" | ") || null;

  return {
    actionError,
    actionSucceeded: deletion.succeeded && punishment.actionSucceeded
  };
}

async function getCachedSettings(guildId: string, context: BotContext) {
  const cacheKey = runtimeScopeKey(guildId);
  const cached = settingsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  const settings = await context.api.getImageAntiSpamSettings(guildId);
  settingsCache.set(cacheKey, {
    expiresAt: Date.now() + SETTINGS_CACHE_MS,
    settings
  });
  return settings;
}

async function applyPunishment(
  member: GuildMember,
  sourceMessage: Message,
  result: ImageAntiSpamIncidentResult
) {
  const { incident, settings } = result;
  let actionSucceeded = true;
  let actionError: string | null = null;

  try {
    if (incident.action === "timeout") {
      if (!member.moderatable) {
        throw new Error("O bot nao pode aplicar timeout por falta de permissao ou hierarquia de cargos.");
      }

      await member.timeout(incident.timeoutMs, incident.reason);
    } else if (incident.action === "kick") {
      await notifyMember(member, sourceMessage, incident, settings).catch(() => undefined);

      if (!member.kickable) {
        throw new Error("O bot nao pode expulsar este membro por falta de permissao ou hierarquia de cargos.");
      }

      await member.kick(incident.reason);
      return {
        actionSucceeded: true,
        actionError: null
      };
    }
  } catch (error) {
    actionSucceeded = false;
    actionError = errorMessage(error);
  }

  if (settings.warningsEnabled) {
    await notifyMember(member, sourceMessage, incident, settings).catch((error) => {
      actionError = [actionError, `Aviso nao entregue: ${errorMessage(error)}`].filter(Boolean).join(" ");
    });
  }

  return {
    actionSucceeded,
    actionError
  };
}

async function notifyMember(
  member: GuildMember,
  sourceMessage: Message,
  incident: ImageAntiSpamIncident,
  settings: ImageAntiSpamSettings
) {
  const timeoutText = incident.timeoutMs > 0
    ? ` Timeout aplicado: ${formatDuration(incident.timeoutMs)}.`
    : "";
  const content = [
    `Anti-Spam de Imagens: ${incident.removedImages} midia(s) excedente(s) foram removidas.`,
    `Advertencia ${incident.warningCount}/${settings.maxWarnings}.${timeoutText}`,
    incident.action === "kick" ? incident.reason : ""
  ].filter(Boolean).join("\n");

  if (!sourceMessage.channel.isSendable()) {
    return;
  }

  const warning = await sourceMessage.channel.send({
    content: `<@${member.id}> ${content}`,
    allowedMentions: {
      users: [member.id]
    }
  });
  const timer = setTimeout(() => {
    void warning.delete().catch(() => undefined);
  }, 12_000);

  timer.unref();
}

async function upsertDiscordLog(
  sourceMessage: Message,
  settings: ImageAntiSpamSettings,
  incident: ImageAntiSpamIncident,
  window: UserWindow
) {
  if (!settings.logChannelId || !sourceMessage.guild) {
    return;
  }

  const channel = await sourceMessage.guild.channels.fetch(settings.logChannelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  const payload = buildLogPayload(incident);

  if (window.logMessageId && window.logChannelId === channel.id) {
    const current = await channel.messages.fetch(window.logMessageId).catch(() => null);

    if (current) {
      await current.edit(payload).catch(() => undefined);
      return;
    }
  }

  const sent = await channel.send(payload);
  window.logChannelId = channel.id;
  window.logMessageId = sent.id;
}

function buildLogPayload(incident: ImageAntiSpamIncident) {
  const title = incident.action === "kick"
    ? "## Expulsao por spam de imagens"
    : "## Anti-Spam de Imagens";
  const timeout = incident.timeoutMs > 0 ? formatDuration(incident.timeoutMs) : "Nenhum";
  const action = punishmentLabel(incident);
  const status = incident.actionSucceeded === false
    ? `Falhou: ${incident.actionError ?? "erro desconhecido"}`
    : action;
  const body = incident.action === "kick"
    ? [
        `**Usuario:** <@${incident.userId}>`,
        `**ID:** \`${incident.userId}\``,
        `**Total de advertencias:** ${incident.warningCount}`,
        `**Data da expulsao:** <t:${Math.floor(new Date(incident.updatedAt).getTime() / 1_000)}:F>`,
        `**Motivo detalhado:** ${incident.reason}`,
        `**Status:** ${status}`
      ]
    : [
        `**Usuario:** <@${incident.userId}>`,
        `**ID:** \`${incident.userId}\``,
        `**Canal principal:** <#${incident.channelId}>`,
        `**Canais envolvidos:** ${formatChannels(incident.channelIds)}`,
        `**Mensagens removidas:** ${incident.removedMessages}`,
        `**Midias removidas:** ${incident.removedImages}`,
        `**Tipos detectados:** ${formatMediaTypes(incident.mediaTypes)}`,
        `**Advertencia atual:** ${incident.warningCount}`,
        `**Timeout aplicado:** ${timeout}`,
        `**Data e horario:** <t:${Math.floor(new Date(incident.updatedAt).getTime() / 1_000)}:F>`,
        `**Motivo:** ${incident.reason}`,
        `**Acao:** ${status}`
      ];
  const container = new ContainerBuilder()
    .setAccentColor(incident.action === "kick" ? 0xed4245 : 0x7c3aed)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(title),
      new TextDisplayBuilder().setContent(body.join("\n"))
    );

  return {
    allowedMentions: {
      parse: [] as never[]
    },
    components: [container],
    flags: "IsComponentsV2" as const
  };
}

function isImmune(member: GuildMember, settings: ImageAntiSpamSettings) {
  if (settings.ignoreAdministrators && member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return settings.immuneRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function isIgnoredChannel(message: Message, settings: ImageAntiSpamSettings) {
  if (settings.ignoredChannelIds.includes(message.channelId)) {
    return true;
  }

  const parentId = message.channel.isThread() ? message.channel.parentId : null;
  return Boolean(parentId && settings.ignoredChannelIds.includes(parentId));
}

function inspectMediaMessage(message: Message): MediaSummary {
  let attachmentCount = 0;
  let embedCount = 0;
  let gifCount = 0;
  let imageCount = 0;
  let stickerCount = message.stickers.size;
  const kinds = new Set<MediaKind>();

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    const name = `${attachment.name ?? ""} ${attachment.url}`.toLowerCase();

    attachmentCount += 1;

    if (contentType.startsWith("image/gif") || /\.gif(?:$|[?#])/i.test(name)) {
      gifCount += 1;
      imageCount += 1;
      kinds.add("gif");
      continue;
    }

    if (contentType.startsWith("image/") || /\.(?:avif|jpe?g|png|webp)(?:$|[?#])/i.test(name)) {
      imageCount += 1;
      kinds.add("image");
      continue;
    }

    kinds.add("attachment");
  }

  for (const embed of message.embeds) {
    if (embed.image || embed.thumbnail || embed.video || embed.url) {
      const embedUrl = `${embed.url ?? ""} ${embed.image?.url ?? ""} ${embed.thumbnail?.url ?? ""} ${embed.video?.url ?? ""}`.toLowerCase();
      embedCount += 1;
      kinds.add(/\.gif(?:$|[?#])/.test(embedUrl) ? "gif" : "embed");
    }
  }

  if (stickerCount > 0) {
    kinds.add("sticker");
  }

  const mediaCount = attachmentCount + embedCount + stickerCount;

  return {
    attachmentCount,
    embedCount,
    gifCount,
    imageCount,
    kinds: [...kinds],
    mediaCount,
    stickerCount
  };
}

function collectChannelIds(messages: MediaMessageRef[]) {
  return [...new Set(messages.map((entry) => entry.channelId))];
}

function collectMediaTypes(messages: MediaMessageRef[]) {
  return [...new Set(messages.flatMap((entry) => entry.summary.kinds))];
}

function formatChannels(channelIds: string[] | undefined) {
  const ids = channelIds?.length ? channelIds : [];
  return ids.length ? ids.map((channelId) => `<#${channelId}>`).join(", ") : "Nao informado";
}

function formatMediaTypes(mediaTypes: string[] | undefined) {
  const labels: Record<string, string> = {
    attachment: "Anexos",
    embed: "Embeds",
    gif: "GIFs",
    image: "Imagens",
    sticker: "Stickers"
  };
  const types = mediaTypes?.length ? mediaTypes : [];
  return types.length ? types.map((type) => labels[type] ?? type).join(", ") : "Midia";
}

function punishmentLabel(incident: ImageAntiSpamIncident) {
  if (incident.action === "kick") return "Expulsao";
  if (incident.action === "timeout") return `Timeout de ${formatDuration(incident.timeoutMs)}`;
  if (incident.action === "warning") return "Advertencia registrada";
  return "Imagens excedentes removidas";
}

function formatDuration(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} hora(s)`;
  }

  return `${minutes} minuto(s)`;
}

function clearGuildWindows(guildId: string) {
  const prefix = runtimeScopeKey(guildId);

  for (const key of userWindows.keys()) {
    if (key.startsWith(`${prefix}:`)) {
      userWindows.delete(key);
    }
  }
}

function scheduleWindowCleanup(key: string, window: UserWindow) {
  const timer = setTimeout(() => {
    if (userWindows.get(key) === window) {
      userWindows.delete(key);
    }
  }, Math.max(1_000, window.expiresAt - Date.now() + 1_000));

  timer.unref();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
