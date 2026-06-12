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

type CachedSettings = {
  expiresAt: number;
  settings: ImageAntiSpamSettings;
};

type UserWindow = {
  expiresAt: number;
  imageCount: number;
  incidentKey: string | null;
  logChannelId: string | null;
  logMessageId: string | null;
  startedAt: number;
};

const SETTINGS_CACHE_MS = 30_000;
const settingsCache = new Map<string, CachedSettings>();
const userWindows = new Map<string, UserWindow>();
const processingQueues = new Map<string, Promise<void>>();
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

    settingsCache.delete(payload.guildId);
    clearGuildWindows(payload.guildId);
  });
}

export async function handleImageAntiSpamMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled("image-anti-spam") || !message.guild || message.author.bot) {
    return;
  }

  const imageCount = countImages(message);

  if (imageCount === 0) {
    return;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const previous = processingQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => processImageMessage(message, imageCount, context))
    .catch((error) => {
      console.warn("[image-anti-spam] falha ao processar mensagem:", errorMessage(error));
    })
    .finally(() => {
      if (processingQueues.get(key) === next) {
        processingQueues.delete(key);
      }
    });

  processingQueues.set(key, next);
  await next;
}

async function processImageMessage(message: Message, imageCount: number, context: BotContext) {
  const guild = message.guild;

  if (!guild) {
    return;
  }

  const settings = await getCachedSettings(guild.id, context);

  if (!settings.enabled || isIgnoredChannel(message, settings)) {
    return;
  }

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);

  if (!member || isImmune(member, settings)) {
    return;
  }

  const key = `${guild.id}:${message.author.id}`;
  const now = Date.now();
  let window = userWindows.get(key);

  if (!window || now >= window.expiresAt) {
    window = {
      expiresAt: now + settings.windowSeconds * 1_000,
      imageCount: 0,
      incidentKey: null,
      logChannelId: null,
      logMessageId: null,
      startedAt: now
    };
    userWindows.set(key, window);
    scheduleWindowCleanup(key, window);
  }

  const nextImageCount = window.imageCount + imageCount;
  window.imageCount = nextImageCount;

  if (nextImageCount <= settings.maxImages) {
    return;
  }

  const deleted = await message.delete().then(() => true).catch((error) => {
    console.warn(
      `[image-anti-spam] nao foi possivel apagar a mensagem ${message.id}:`,
      errorMessage(error)
    );
    return false;
  });
  window.incidentKey ??= `${guild.id}:${message.author.id}:${window.startedAt}`;

  const result = await context.api.recordImageAntiSpamIncident({
    guildId: guild.id,
    incidentKey: window.incidentKey,
    userId: message.author.id,
    username: message.author.tag,
    channelId: message.channelId,
    removedImages: deleted ? imageCount : 0
  });

  let incident = result.incident;

  if (!result.duplicate) {
    const outcome = await applyPunishment(member, message, result);
    incident = await context.api.completeImageAntiSpamIncident(incident.id, outcome);
  }

  await upsertDiscordLog(message, result.settings, incident, window);
}

async function getCachedSettings(guildId: string, context: BotContext) {
  const cached = settingsCache.get(guildId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  const settings = await context.api.getImageAntiSpamSettings(guildId);
  settingsCache.set(guildId, {
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
    `Anti-Spam de Imagens: ${incident.removedImages} imagem(ns) excedente(s) foram removidas.`,
    `Advertencia ${incident.warningCount}/${settings.maxWarnings}.${timeoutText}`,
    incident.action === "kick" ? incident.reason : ""
  ].filter(Boolean).join("\n");

  const sentByDm = await member.send(content).then(() => true).catch(() => false);

  if (sentByDm || !sourceMessage.channel.isSendable()) {
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
        `**Canal:** <#${incident.channelId}>`,
        `**Quantidade de imagens removidas:** ${incident.removedImages}`,
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

function countImages(message: Message) {
  return message.attachments.filter((attachment) => {
    if (attachment.contentType?.toLowerCase().startsWith("image/")) {
      return true;
    }

    return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(attachment.name ?? attachment.url);
  }).size;
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
  for (const key of userWindows.keys()) {
    if (key.startsWith(`${guildId}:`)) {
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
