import {
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type Role
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings } from "../types";
import type {
  SelfBotProtectionModuleId,
  SelfBotProtectionSettings,
  SelfBotPunishmentAction
} from "./apiClient";

const MODULE_ID = "safe-bot";
const SELF_BOT_ROLE_NAME = "Self Bot";
const FILTER_CHANNEL_NAME = "♻・filter";
const LOG_CHANNEL_NAME = "📋・selfbot-logs";
const SETUP_CACHE_MS = 30_000;
const SELF_BOT_COLOR = 0x7f1d1d;
const processingQueues = new Map<string, Promise<boolean>>();
const messageHistory = new Map<string, SafeBotHistoryEntry[]>();
const setupCache = new Map<string, SafeBotRuntime>();
const URL_PATTERN = /(?:https?:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/|(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>()\]]*)?)/i;
const IMAGE_PATTERN = /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i;
const VIDEO_PATTERN = /\.(?:mp4|mov|avi|webm)(?:$|[?#])/i;
const FILE_PATTERN = /\.(?:zip|rar|7z|exe|bat)(?:$|[?#])/i;

type SafeBotRuntime = {
  expiresAt: number;
  filterChannelId: string;
  logChannelId: string;
  protectionSettings: SelfBotProtectionSettings | null;
  roleId: string;
  settings: GuildSettings;
};

type SafeBotHistoryEntry = {
  at: number;
  hasImage: boolean;
  hasLink: boolean;
  message: Message;
};

type DetectedPayload = {
  label: "Arquivo" | "Imagem" | "Link" | "Video";
  moduleId: SelfBotProtectionModuleId;
  reason: string;
};

type PunishmentOutcome = {
  action: SelfBotPunishmentAction | "none";
  error: string | null;
  succeeded: boolean;
};

const FILTER_WARNING_MESSAGE = [
  "⚠️ Qualquer mensagem enviada nesta sala resultará automaticamente em punição.",
  "Sistema criado para identificar contas invadidas que realizam flood de links maliciosos, imagens e conteúdos automáticos, ajudando a impedir a divulgação de spam no servidor."
].join("\n");

export async function ensureSafeBotSetup(guild: Guild, context: BotContext, knownSettings?: GuildSettings | null) {
  if (!isSelfBotModuleEnabled()) {
    return null;
  }

  const settings = knownSettings ?? await context.api.getSettings(guild.id, guild.client.user?.id).catch((error) => {
    console.warn("[safe-bot] nao foi possivel carregar configuracoes:", errorMessage(error));
    return null;
  });
  const protectionSettings = await context.api.getSelfBotProtectionSettings(guild.id).catch((error) => {
    console.warn("[safe-bot] nao foi possivel carregar configuracao avancada:", errorMessage(error));
    return null;
  });

  const setupRequested = settings?.safeBotEnabled || protectionSettings?.enabled;
  const setupAlreadySynced = Boolean(settings?.safeBotChannelId && settings.safeBotLogChannelId && settings.safeBotRoleId);
  const shouldBootstrapReleasedModule = isDevBotMainGuild(guild.id) && !setupAlreadySynced;

  if (!setupRequested && !shouldBootstrapReleasedModule) {
    setupCache.delete(guild.id);
    return null;
  }

  const role = await findOrCreateSelfBotRole(guild);
  const filterChannel = await findOrCreateFilterChannel(guild);
  const logChannel = await findOrCreateLogChannel(guild);

  if (!role || !filterChannel || !logChannel) {
    return null;
  }

  await ensureFilterWarning(filterChannel).catch((error) => {
    console.warn("[safe-bot] nao foi possivel enviar aviso no canal filter:", errorMessage(error));
  });

  const syncedSettings = await context.api.syncSafeBotSetup({
    filterChannelId: filterChannel.id,
    filterChannelName: filterChannel.name,
    guildId: guild.id,
    logChannelId: logChannel.id,
    logChannelName: logChannel.name,
    roleId: role.id,
    roleName: role.name
  }).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel sincronizar setup no servidor ${guild.id}:`, errorMessage(error));
    return settings ?? null;
  });

  const runtime: SafeBotRuntime = {
    expiresAt: Date.now() + SETUP_CACHE_MS,
    filterChannelId: filterChannel.id,
    logChannelId: logChannel.id,
    protectionSettings,
    roleId: role.id,
    settings: syncedSettings ?? settings ?? {
      botId: null,
      guildId: guild.id,
      safeBotChannelId: filterChannel.id,
      safeBotEnabled: true,
      safeBotLogChannelId: logChannel.id,
      safeBotRoleId: role.id
    } as GuildSettings
  };

  setupCache.set(guild.id, runtime);
  return runtime;
}

export async function ensureSelfBotRole(guild: Guild, context: BotContext) {
  const runtime = await ensureSafeBotSetup(guild, context);

  if (!runtime) {
    return null;
  }

  return guild.roles.fetch(runtime.roleId).catch(() => null);
}

export async function ensureSelfBotRoles(client: Client<true>, context: BotContext) {
  if (!isSelfBotModuleEnabled()) {
    return;
  }

  await Promise.allSettled(
    client.guilds.cache.map((guild) => ensureSafeBotSetup(guild, context))
  );
}

export async function disableUnreleasedSafeBotChannels(client: Client<true>, context: BotContext) {
  if (isSelfBotModuleEnabled()) {
    return;
  }

  await Promise.allSettled(
    client.guilds.cache.map(async (guild) => {
      clearSafeBotSetupCache(guild.id);
      const settings = await context.api.getSettings(guild.id, client.user.id).catch((error) => {
        console.warn(`[safe-bot] nao foi possivel carregar canal para desativar em ${guild.id}:`, errorMessage(error));
        return null;
      });

      if (!settings?.safeBotChannelId) {
        return;
      }

      const channel = await guild.channels.fetch(settings.safeBotChannelId).catch(() => null);

      if (channel?.type !== ChannelType.GuildText) {
        return;
      }

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        {
          SendMessages: false
        },
        {
          reason: "Self Bot: modulo nao liberado para este bot"
        }
      ).catch((error) => {
        console.warn(`[safe-bot] nao foi possivel desativar o canal em ${guild.id}:`, errorMessage(error));
      });
    })
  );
}

export function clearSafeBotSetupCache(guildId: string) {
  setupCache.delete(guildId);

  for (const key of messageHistory.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      messageHistory.delete(key);
    }
  }
}

export async function handleSafeBotMessage(message: Message, context: BotContext) {
  if (!isSelfBotModuleEnabled() || !message.guild || message.author.bot) {
    return false;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const previous = processingQueues.get(key) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(() => processSafeBotMessage(message, context))
    .catch((error) => {
      console.warn("[safe-bot] falha ao processar mensagem:", errorMessage(error));
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

async function processSafeBotMessage(message: Message, context: BotContext) {
  const guild = message.guild;

  if (!guild) {
    return false;
  }

  const runtime = await getSafeBotRuntime(guild, context);

  if (!runtime) {
    return false;
  }

  const member = await resolveMember(message);

  if (!member) {
    return false;
  }

  if (member.roles.cache.has(runtime.roleId)) {
    const detected = detectMarkedUserPayload(message);

    if (!detected) {
      rememberSafeBotMessage(message);
      return false;
    }

    await deleteMessages([message]);
    const punishment = await punishMarkedUser(member, message, runtime, detected);
    await Promise.allSettled([
      sendSelfBotDetectedLog(message, runtime, detected, punishment),
      recordSafeBotIncident(context, message, runtime, {
        actionError: punishment.error,
        actions: ["delete_message", "log", punishment.action].filter((action) => action !== "none") as SelfBotPunishmentAction[],
        details: "Usuario marcado com cargo Self Bot enviou conteudo bloqueado.",
        moduleId: detected.moduleId,
        punishmentSucceeded: punishment.succeeded,
        type: `Self Bot detectado: ${detected.label}`
      })
    ]);
    return true;
  }

  if (message.channelId === runtime.filterChannelId) {
    await deleteMessages([message]);
    const assigned = await applySelfBotRole(member, runtime.roleId);
    await Promise.allSettled([
      sendFilterLog(message, runtime, assigned.error),
      recordSafeBotIncident(context, message, runtime, {
        actionError: assigned.error,
        actions: ["delete_message", "add_role", "log"],
        details: "Mensagem enviada no canal de filtro. Cargo Self Bot aplicado.",
        moduleId: "anti-auto-spam",
        punishmentSucceeded: assigned.succeeded,
        type: "Canal de filtro acionado"
      })
    ]);
    return true;
  }

  const flood = rememberAndDetectFlood(message);

  if (flood) {
    await deleteMessages(flood.messages);
    const assigned = await applySelfBotRole(member, runtime.roleId);
    await Promise.allSettled([
      sendFloodLog(message, runtime, flood.reason, assigned.error),
      recordSafeBotIncident(context, message, runtime, {
        actionError: assigned.error,
        actions: ["delete_message", "add_role", "log"],
        details: flood.reason,
        moduleId: flood.moduleId,
        punishmentSucceeded: assigned.succeeded,
        type: flood.type
      })
    ]);
    return true;
  }

  return false;
}

async function getSafeBotRuntime(guild: Guild, context: BotContext) {
  const cached = setupCache.get(guild.id);

  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const settings = await context.api.getSettings(guild.id, guild.client.user?.id).catch((error) => {
    console.warn("[safe-bot] nao foi possivel carregar configuracoes:", errorMessage(error));
    return null;
  });

  return ensureSafeBotSetup(guild, context, settings);
}

async function resolveMember(message: Message): Promise<GuildMember | null> {
  if (message.member) {
    return message.member;
  }

  return message.guild?.members.fetch(message.author.id).catch(() => null) ?? null;
}

async function applySelfBotRole(member: GuildMember, roleId: string) {
  try {
    if (member.roles.cache.has(roleId)) {
      return {
        error: null,
        succeeded: true
      };
    }

    const role = await member.guild.roles.fetch(roleId).catch(() => null);

    if (!role?.editable) {
      throw new Error("O cargo Self Bot nao pode ser atribuido pelo bot.");
    }

    await member.roles.add(role, "SafeBot: comportamento suspeito detectado");
    return {
      error: null,
      succeeded: true
    };
  } catch (error) {
    return {
      error: errorMessage(error),
      succeeded: false
    };
  }
}

async function punishMarkedUser(
  member: GuildMember,
  message: Message,
  runtime: SafeBotRuntime,
  detected: DetectedPayload
): Promise<PunishmentOutcome> {
  const action = resolveConfiguredPunishment(runtime.protectionSettings);
  const reason = `SafeBot: ${detected.label} enviado por usuario marcado como Self Bot.`;

  try {
    if (action === "ban") {
      if (!member.bannable) {
        throw new Error("O bot nao pode banir este membro por falta de permissao ou hierarquia.");
      }

      await member.ban({
        deleteMessageSeconds: 60 * 60,
        reason
      });
    } else if (action === "kick") {
      if (!member.kickable) {
        throw new Error("O bot nao pode expulsar este membro por falta de permissao ou hierarquia.");
      }

      await member.kick(reason);
    } else if (action === "timeout") {
      if (!member.moderatable) {
        throw new Error("O bot nao pode aplicar mute neste membro por falta de permissao ou hierarquia.");
      }

      await member.timeout((runtime.protectionSettings?.timeoutSeconds ?? 300) * 1_000, reason);
    } else if (action === "warn") {
      await member.send(`SafeBot: ${detected.label} bloqueado no servidor ${message.guild?.name ?? ""}.`).catch(() => undefined);
    }

    return {
      action,
      error: null,
      succeeded: true
    };
  } catch (error) {
    return {
      action,
      error: errorMessage(error),
      succeeded: false
    };
  }
}

function resolveConfiguredPunishment(settings: SelfBotProtectionSettings | null): SelfBotPunishmentAction | "none" {
  const sequence = settings?.punishmentSequence?.length ? settings.punishmentSequence : ["ban"];

  if (sequence.includes("ban")) return "ban";
  if (sequence.includes("kick")) return "kick";
  if (sequence.includes("timeout")) return "timeout";
  if (sequence.includes("warn")) return "warn";
  return "none";
}

function rememberSafeBotMessage(message: Message) {
  const key = `${message.guildId}:${message.author.id}`;
  const entries = (messageHistory.get(key) ?? [])
    .filter((entry) => Date.now() - entry.at <= 15_000);
  const detected = detectMessageContent(message);

  entries.push({
    at: Date.now(),
    hasImage: detected?.label === "Imagem",
    hasLink: detected?.label === "Link",
    message
  });
  messageHistory.set(key, entries.slice(-50));
  return entries;
}

function rememberAndDetectFlood(message: Message) {
  const entries = rememberSafeBotMessage(message);
  const now = Date.now();
  const fastMessages = entries.filter((entry) => now - entry.at <= 10_000);
  const imageMessages = entries.filter((entry) => entry.hasImage && now - entry.at <= 15_000);
  const linkMessages = entries.filter((entry) => entry.hasLink && now - entry.at <= 15_000);

  if (fastMessages.length >= 5) {
    return {
      messages: fastMessages.map((entry) => entry.message),
      moduleId: "anti-flood" as SelfBotProtectionModuleId,
      reason: "5 mensagens em 10 segundos.",
      type: "Flood de mensagens"
    };
  }

  if (imageMessages.length >= 3) {
    return {
      messages: imageMessages.map((entry) => entry.message),
      moduleId: "anti-imagens" as SelfBotProtectionModuleId,
      reason: "3 imagens em 15 segundos.",
      type: "Flood de imagens"
    };
  }

  if (linkMessages.length >= 3) {
    return {
      messages: linkMessages.map((entry) => entry.message),
      moduleId: "anti-links" as SelfBotProtectionModuleId,
      reason: "3 links em 15 segundos.",
      type: "Flood de links"
    };
  }

  return null;
}

function detectMarkedUserPayload(message: Message) {
  return detectMessageContent(message);
}

function detectMessageContent(message: Message): DetectedPayload | null {
  const text = message.content ?? "";

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    const name = `${attachment.name ?? ""} ${attachment.url}`.toLowerCase();

    if (contentType.startsWith("application/") || FILE_PATTERN.test(name)) {
      return {
        label: "Arquivo",
        moduleId: "anti-anexos",
        reason: attachment.name ?? attachment.url
      };
    }

    if (contentType.startsWith("video/") || VIDEO_PATTERN.test(name)) {
      return {
        label: "Video",
        moduleId: "anti-anexos",
        reason: attachment.name ?? attachment.url
      };
    }

    if (contentType.startsWith("image/") || IMAGE_PATTERN.test(name)) {
      return {
        label: "Imagem",
        moduleId: contentType.includes("gif") || /\.gif(?:$|[?#])/i.test(name) ? "anti-gif" : "anti-imagens",
        reason: attachment.name ?? attachment.url
      };
    }
  }

  if (message.stickers.size > 0) {
    return {
      label: "Imagem",
      moduleId: "anti-imagens",
      reason: "Sticker enviado"
    };
  }

  for (const embed of message.embeds) {
    const embedUrl = `${embed.url ?? ""} ${embed.image?.url ?? ""} ${embed.thumbnail?.url ?? ""} ${embed.video?.url ?? ""}`.toLowerCase();

    if (VIDEO_PATTERN.test(embedUrl) || embed.video) {
      return {
        label: "Video",
        moduleId: "anti-anexos",
        reason: embed.url ?? "Embed com video"
      };
    }

    if (IMAGE_PATTERN.test(embedUrl) || embed.image || embed.thumbnail) {
      return {
        label: "Imagem",
        moduleId: /\.gif(?:$|[?#])/i.test(embedUrl) ? "anti-gif" : "anti-imagens",
        reason: embed.url ?? "Embed com imagem"
      };
    }
  }

  if (URL_PATTERN.test(text)) {
    return {
      label: "Link",
      moduleId: "anti-links",
      reason: truncate(text, 500)
    };
  }

  return null;
}

async function deleteMessages(messages: Message[]) {
  await Promise.allSettled(
    [...new Map(messages.map((message) => [message.id, message])).values()]
      .map((message) => message.delete().catch((error) => {
        console.warn(`[safe-bot] nao foi possivel apagar mensagem ${message.id}:`, errorMessage(error));
      }))
  );
}

async function sendFilterLog(message: Message, runtime: SafeBotRuntime, error: string | null) {
  const embed = new EmbedBuilder()
    .setColor(error ? 0xf59e0b : SELF_BOT_COLOR)
    .setTitle("[SAFEBOT]")
    .setDescription([
      `**Usuario:** ${message.author.tag}`,
      `**ID:** \`${message.author.id}\``,
      `**Acao:** Mensagem enviada no canal de filtro.`,
      error ? `**Erro:** ${error}` : "**Cargo Self Bot aplicado.**"
    ].join("\n"))
    .setTimestamp(new Date());

  await sendLogEmbed(message.guild, runtime.logChannelId, embed);
}

async function sendFloodLog(message: Message, runtime: SafeBotRuntime, reason: string, error: string | null) {
  const embed = new EmbedBuilder()
    .setColor(error ? 0xf59e0b : SELF_BOT_COLOR)
    .setTitle("[SAFEBOT] Flood detectado")
    .setDescription([
      `**Usuario:** ${message.author.tag}`,
      `**ID:** \`${message.author.id}\``,
      `**Canal:** <#${message.channelId}>`,
      `**Motivo:** ${reason}`,
      error ? `**Erro:** ${error}` : "**Cargo Self Bot aplicado.**"
    ].join("\n"))
    .setTimestamp(new Date());

  await sendLogEmbed(message.guild, runtime.logChannelId, embed);
}

async function sendSelfBotDetectedLog(
  message: Message,
  runtime: SafeBotRuntime,
  detected: DetectedPayload,
  punishment: PunishmentOutcome
) {
  const embed = new EmbedBuilder()
    .setColor(punishment.succeeded ? 0xed4245 : 0xf59e0b)
    .setTitle("🚨 SELF BOT DETECTADO")
    .setDescription([
      `**Usuario:** ${message.author.tag}`,
      `**ID:** \`${message.author.id}\``,
      `**Canal:** <#${message.channelId}>`,
      `**Tipo detectado:** ${detected.label}`,
      "**Conteudo removido.**",
      `**Acao executada:** ${punishmentLabel(punishment.action)}`,
      punishment.error ? `**Erro:** ${punishment.error}` : ""
    ].filter(Boolean).join("\n"))
    .setTimestamp(new Date());

  await sendLogEmbed(message.guild, runtime.logChannelId, embed);
}

async function recordSafeBotIncident(
  context: BotContext,
  message: Message,
  runtime: SafeBotRuntime,
  input: {
    actionError: string | null;
    actions: SelfBotPunishmentAction[];
    details: string;
    moduleId: SelfBotProtectionModuleId;
    punishmentSucceeded: boolean;
    type: string;
  }
) {
  await context.api.recordSelfBotProtectionIncident({
    channelId: message.channelId,
    guildId: message.guildId ?? runtime.settings.guildId,
    messageContent: truncate(message.content, 1900),
    messageId: message.id,
    metadata: {
      details: input.details,
      filterChannelId: runtime.filterChannelId,
      logChannelId: runtime.logChannelId,
      roleId: runtime.roleId
    },
    moduleId: input.moduleId,
    punishmentActions: input.actions,
    punishmentError: input.actionError,
    punishmentSucceeded: input.punishmentSucceeded,
    infractionType: input.type,
    userId: message.author.id,
    username: message.author.tag
  }).catch((error) => {
    console.warn("[safe-bot] nao foi possivel registrar incidente:", errorMessage(error));
  });
}

async function sendLogEmbed(guild: Guild | null, channelId: string, embed: EmbedBuilder) {
  if (!guild) {
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  await channel.send({
    allowedMentions: {
      parse: []
    },
    embeds: [embed]
  });
}

async function findOrCreateSelfBotRole(guild: Guild) {
  const roles = await guild.roles.fetch().catch((error) => {
    console.warn(`[safe-bot] nao foi possivel buscar cargos em ${guild.name}:`, errorMessage(error));
    return null;
  });
  const existing = roles?.find((role) => role.name.toLowerCase() === SELF_BOT_ROLE_NAME.toLowerCase()) ?? null;

  if (existing) {
    return normalizeSelfBotRole(existing);
  }

  const me = await guild.members.fetchMe().catch(() => null);

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.warn(`[safe-bot] sem permissao Gerenciar Cargos em ${guild.name}.`);
    return null;
  }

  return guild.roles.create({
    color: SELF_BOT_COLOR,
    name: SELF_BOT_ROLE_NAME,
    permissions: [],
    reason: "SafeBot: cargo Self Bot criado automaticamente"
  }).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel criar o cargo em ${guild.name}:`, errorMessage(error));
    return null;
  });
}

async function normalizeSelfBotRole(role: Role) {
  if (!role.editable) {
    return role;
  }

  if (role.color === SELF_BOT_COLOR && role.permissions.bitfield === 0n) {
    return role;
  }

  return role.edit({
    color: SELF_BOT_COLOR,
    permissions: [],
    reason: "SafeBot: padronizar cargo Self Bot"
  }).catch(() => role);
}

async function findOrCreateFilterChannel(guild: Guild) {
  const channel = await findTextChannel(guild, FILTER_CHANNEL_NAME);
  const overwrites = baseFilterOverwrites(guild);

  if (channel) {
    await channel.permissionOverwrites.set(overwrites, "SafeBot: padronizar canal filter").catch(() => undefined);
    return channel;
  }

  const me = await guild.members.fetchMe().catch(() => null);

  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    console.warn(`[safe-bot] sem permissao Gerenciar Canais em ${guild.name}.`);
    return null;
  }

  return guild.channels.create({
    name: FILTER_CHANNEL_NAME,
    permissionOverwrites: overwrites,
    reason: "SafeBot: canal filter criado automaticamente",
    type: ChannelType.GuildText
  }).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel criar canal filter em ${guild.name}:`, errorMessage(error));
    return null;
  });
}

async function findOrCreateLogChannel(guild: Guild) {
  const channel = await findTextChannel(guild, LOG_CHANNEL_NAME);
  const overwrites = await logChannelOverwrites(guild);

  if (channel) {
    await channel.permissionOverwrites.set(overwrites, "SafeBot: padronizar canal de logs").catch(() => undefined);
    return channel;
  }

  const me = await guild.members.fetchMe().catch(() => null);

  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    console.warn(`[safe-bot] sem permissao Gerenciar Canais em ${guild.name}.`);
    return null;
  }

  return guild.channels.create({
    name: LOG_CHANNEL_NAME,
    permissionOverwrites: overwrites,
    reason: "SafeBot: canal de logs criado automaticamente",
    type: ChannelType.GuildText
  }).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel criar canal de logs em ${guild.name}:`, errorMessage(error));
    return null;
  });
}

async function findTextChannel(guild: Guild, name: string) {
  const channels = await guild.channels.fetch().catch(() => null);
  return channels?.find((channel) => channel?.type === ChannelType.GuildText && channel.name === name) ?? null;
}

function baseFilterOverwrites(guild: Guild) {
  const botId = guild.client.user?.id;
  const overwrites: Array<{ allow?: bigint[]; deny?: bigint[]; id: string }> = [
    {
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ],
      id: guild.roles.everyone.id
    }
  ];

  if (botId) {
    overwrites.push({
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory
      ],
      id: botId
    });
  }

  return overwrites;
}

async function logChannelOverwrites(guild: Guild) {
  const roles = await guild.roles.fetch().catch(() => null);
  const botId = guild.client.user?.id;
  const overwrites: Array<{ allow?: bigint[]; deny?: bigint[]; id: string }> = [
    {
      deny: [PermissionFlagsBits.ViewChannel],
      id: guild.roles.everyone.id
    }
  ];

  if (botId) {
    overwrites.push({
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory
      ],
      id: botId
    });
  }

  for (const role of roles?.values() ?? []) {
    if (role.managed || role.id === guild.roles.everyone.id) {
      continue;
    }

    if (
      role.permissions.has(PermissionFlagsBits.Administrator)
      || role.permissions.has(PermissionFlagsBits.ManageGuild)
      || role.permissions.has(PermissionFlagsBits.ManageMessages)
      || role.permissions.has(PermissionFlagsBits.ModerateMembers)
    ) {
      overwrites.push({
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ],
        id: role.id
      });
    }
  }

  return overwrites;
}

async function ensureFilterWarning(channel: Awaited<ReturnType<typeof findTextChannel>>) {
  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const warning = messages?.find((message) => {
    if (message.author.id !== channel.client.user?.id) {
      return false;
    }

    const serializedComponents = JSON.stringify(message.components.map((component) => component.toJSON()));
    return message.content.includes("Qualquer mensagem enviada nesta sala")
      || serializedComponents.includes("Qualquer mensagem enviada nesta sala");
  });
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(FILTER_WARNING_MESSAGE)
    );

  if (warning) {
    try {
      await warning.edit({
        allowedMentions: {
          parse: []
        },
        components: [container],
        content: null,
        embeds: [],
        flags: "IsComponentsV2"
      });
      return;
    } catch (editError) {
      const deleted = await warning.delete().then(() => true).catch(() => false);

      if (!deleted) {
        throw editError;
      }
    }
  }

  await channel.send({
    allowedMentions: {
      parse: []
    },
    components: [container],
    flags: "IsComponentsV2"
  });
}

function punishmentLabel(action: SelfBotPunishmentAction | "none") {
  if (action === "ban") return "BANIMENTO AUTOMATICO";
  if (action === "kick") return "EXPULSAO AUTOMATICA";
  if (action === "timeout") return "MUTE AUTOMATICO";
  if (action === "warn") return "ADVERTENCIA";
  return "REGISTRO";
}

export function isSelfBotModuleEnabled() {
  return isBotModuleEnabled(MODULE_ID);
}

function isDevBotMainGuild(guildId: string) {
  return Boolean(env.DASHBOARD_BOT_ID && env.BOT_MAIN_GUILD_ID.trim() === guildId);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
