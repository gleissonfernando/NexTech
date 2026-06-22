import {
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
  type TextChannel
} from "discord.js";
import { env, isBotModuleEnabled } from "../config/env";
import type { BotContext, GuildSettings } from "../types";
import type {
  SelfBotProtectionModuleId,
  SelfBotProtectionSettings,
  SelfBotPunishmentAction
} from "./apiClient";
import { isRuntimeModuleAuthorized, runtimeScopeKey } from "./runtimeModuleGuard";

const MODULE_ID = "safe-bot";
const SELF_BOT_ROLE_NAME = "Self Bot";
const FILTER_CHANNEL_NAME = "♻・filter";
const LOG_CHANNEL_NAME = "📋・selfbot-logs";
const SETUP_CACHE_MS = 30_000;
const SELF_BOT_COLOR = 0x7f1d1d;
const FILTER_WARNING_COLOR = 0xf59e0b;
const processingQueues = new Map<string, Promise<boolean>>();
const filterWarningQueues = new Map<string, Promise<void>>();
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

type SequencePunishmentOutcome = {
  actions: SelfBotPunishmentAction[];
  error: string | null;
  succeeded: boolean;
};

const FILTER_WARNING_TITLE = "## :warning: Não envie mensagens aqui";
const FILTER_WARNING_DESCRIPTION = [
  "**Você receberá um banimento se enviar mensagens neste canal**",
  "",
  "Isso serve para remover usuários self bot que mandam spam em todos os canais do servidor tentando infectar mais usuários."
].join("\n");

export async function ensureSafeBotSetup(guild: Guild, context: BotContext, knownSettings?: GuildSettings | null) {
  if (!shouldCheckSelfBotRuntime()) {
    return null;
  }

  if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    setupCache.delete(runtimeScopeKey(guild.id));
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

  setupCache.set(runtimeScopeKey(guild.id), runtime);
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
  if (!shouldCheckSelfBotRuntime()) {
    return;
  }

  await Promise.allSettled(
    client.guilds.cache.map((guild) => ensureSafeBotSetup(guild, context))
  );
}

export async function reconcileSelfBotPunishmentRoles(client: Client<true>, context: BotContext) {
  if (!shouldCheckSelfBotRuntime()) {
    return;
  }

  await Promise.allSettled(
    client.guilds.cache.map((guild) => reconcileGuildPunishmentRoles(guild, context))
  );
}

export async function disableUnreleasedSafeBotChannels(client: Client<true>, context: BotContext) {
  await Promise.allSettled(
    client.guilds.cache.map(async (guild) => {
      if (shouldCheckSelfBotRuntime() && await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID)) {
        return;
      }

      clearSafeBotSetupCache(guild.id);
      const settings = await context.api.getSettings(guild.id, client.user.id).catch((error) => {
        console.warn(`[safe-bot] nao foi possivel carregar canal para desativar em ${guild.id}:`, errorMessage(error));
        return null;
      });

      if (!settings?.safeBotChannelId) {
        const channelByName = await findTextChannel(guild, FILTER_CHANNEL_NAME);

        if (!channelByName) {
          return;
        }

        await disableFilterChannel(channelByName, guild.id);
        return;
      }

      const channel = await guild.channels.fetch(settings.safeBotChannelId).catch(() => null)
        ?? await findTextChannel(guild, FILTER_CHANNEL_NAME);

      if (channel?.type !== ChannelType.GuildText) {
        return;
      }

      await disableFilterChannel(channel, guild.id);
    })
  );
}

export function clearSafeBotSetupCache(guildId: string) {
  const prefix = runtimeScopeKey(guildId);
  setupCache.delete(prefix);

  for (const key of messageHistory.keys()) {
    if (key.startsWith(`${prefix}:`)) {
      messageHistory.delete(key);
    }
  }
}

export async function handleSafeBotMessage(message: Message, context: BotContext) {
  if (!shouldCheckSelfBotRuntime() || !message.guild || message.author.bot) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, message.guild.id, MODULE_ID))) {
    return false;
  }

  const key = runtimeScopeKey(message.guild.id, message.author.id);
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

export async function restoreSelfBotWarningAfterDelete(message: Message | { channelId?: string | null; guild?: Guild | null }, context: BotContext) {
  const guild = message.guild ?? null;

  if (!shouldCheckSelfBotRuntime() || !guild || !message.channelId) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    return false;
  }

  const runtime = await getSafeBotRuntime(guild, context).catch((error) => {
    console.warn("[safe-bot] nao foi possivel restaurar aviso no canal filter:", errorMessage(error));
    return null;
  });

  if (!runtime || message.channelId !== runtime.filterChannelId) {
    return false;
  }

  const channel = await guild.channels.fetch(runtime.filterChannelId).catch(() => null);

  if (channel?.type !== ChannelType.GuildText) {
    return false;
  }

  await ensureFilterWarning(channel).catch((error) => {
    console.warn("[safe-bot] nao foi possivel recriar aviso no canal filter:", errorMessage(error));
  });
  return true;
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

  if (message.channelId === runtime.filterChannelId) {
    const punishment = await applyFilterChannelPunishment(member, message, runtime);
    await Promise.allSettled([
      sendFilterLog(message, runtime, punishment),
      recordSafeBotIncident(context, message, runtime, {
        actionError: punishment.error,
        actions: punishment.actions,
        details: "Mensagem enviada no canal de filtro. Cargo Self Bot aplicado.",
        moduleId: "anti-auto-spam",
        punishmentSucceeded: punishment.succeeded,
        type: "Canal de filtro acionado"
      })
    ]);
    return true;
  }

  if (member.roles.cache.has(runtime.roleId)) {
    const detected = detectMarkedUserPayload(message);

    if (!detected) {
      rememberSafeBotMessage(message);
      return false;
    }

    if (!(await isRuntimeModuleAuthorized(context, guild.id, detected.moduleId))) {
      return false;
    }

    const punishment = await applyConfiguredPunishment(
      member,
      message,
      runtime,
      `SafeBot: ${detected.label} enviado por usuario marcado como Self Bot.`
    );
    await Promise.allSettled([
      sendSelfBotDetectedLog(message, runtime, detected, punishment),
      recordSafeBotIncident(context, message, runtime, {
        actionError: punishment.error,
        actions: punishment.actions,
        details: "Usuario marcado com cargo Self Bot enviou conteudo bloqueado.",
        moduleId: detected.moduleId,
        punishmentSucceeded: punishment.succeeded,
        type: `Self Bot detectado: ${detected.label}`
      })
    ]);
    return true;
  }

  const flood = rememberAndDetectFlood(message);

  if (flood) {
    if (!(await isRuntimeModuleAuthorized(context, guild.id, flood.moduleId))) {
      return false;
    }

    const punishment = await applyConfiguredPunishment(member, message, runtime, `SafeBot: ${flood.reason}`, flood.messages);
    await Promise.allSettled([
      sendFloodLog(message, runtime, flood.reason, punishment),
      recordSafeBotIncident(context, message, runtime, {
        actionError: punishment.error,
        actions: punishment.actions,
        details: flood.reason,
        moduleId: flood.moduleId,
        punishmentSucceeded: punishment.succeeded,
        type: flood.type
      })
    ]);
    return true;
  }

  return false;
}

async function applyFilterChannelPunishment(
  member: GuildMember,
  message: Message,
  runtime: SafeBotRuntime
): Promise<SequencePunishmentOutcome> {
  return applyConfiguredPunishment(
    member,
    message,
    runtime,
    "SafeBot: mensagem enviada no canal de filtro."
  );
}

async function applyConfiguredPunishment(
  member: GuildMember,
  message: Message,
  runtime: SafeBotRuntime,
  reason: string,
  messagesToDelete: Message[] = [message]
): Promise<SequencePunishmentOutcome> {
  const sequence = runtime.protectionSettings?.punishmentSequence?.length
    ? runtime.protectionSettings.punishmentSequence
    : ["delete_message", "add_role", "log"] as SelfBotPunishmentAction[];
  const actions: SelfBotPunishmentAction[] = [];
  const errors: string[] = [];

  for (const action of sequence) {
    try {
      if (action === "delete_message") {
        await deleteMessagesOrThrow(messagesToDelete);
        actions.push(action);
      } else if (action === "warn") {
        await warnInChannel(member, message, reason);
        actions.push(action);
      } else if (action === "log") {
        actions.push(action);
      } else if (action === "add_role") {
        const assigned = await applySelfBotRole(member, punishmentAddRoleId(runtime));
        if (!assigned.succeeded) {
          throw new Error(assigned.error ?? "Nao foi possivel aplicar o cargo de castigo.");
        }
        actions.push(action);
      } else if (action === "remove_role") {
        const roleId = runtime.protectionSettings?.removeRoleId;
        if (!roleId) {
          throw new Error("Nenhum cargo configurado para remover.");
        }
        await member.roles.remove(roleId, reason);
        actions.push(action);
      } else if (action === "timeout") {
        if (!member.moderatable) {
          throw new Error("O bot nao pode aplicar mute neste membro por falta de permissao ou hierarquia.");
        }
        await member.timeout((runtime.protectionSettings?.timeoutSeconds ?? 300) * 1_000, reason);
        actions.push(action);
      } else if (action === "kick") {
        if (!member.kickable) {
          throw new Error("O bot nao pode expulsar este membro por falta de permissao ou hierarquia.");
        }
        await member.kick(reason);
        actions.push(action);
        break;
      } else if (action === "ban") {
        if (!member.bannable) {
          throw new Error("O bot nao pode banir este membro por falta de permissao ou hierarquia.");
        }
        await member.ban({
          deleteMessageSeconds: 60 * 60,
          reason
        });
        actions.push(action);
        break;
      }
    } catch (error) {
      errors.push(`${action}: ${errorMessage(error)}`);
    }
  }

  return {
    actions,
    error: errors.length ? errors.join(" | ") : null,
    succeeded: errors.length === 0
  };
}

function primaryPunishmentAction(actions: SelfBotPunishmentAction[]): SelfBotPunishmentAction | "none" {
  if (actions.includes("ban")) return "ban";
  if (actions.includes("kick")) return "kick";
  if (actions.includes("timeout")) return "timeout";
  if (actions.includes("add_role")) return "add_role";
  if (actions.includes("warn")) return "warn";
  if (actions.includes("delete_message")) return "delete_message";
  if (actions.includes("log")) return "log";
  return "none";
}

async function getSafeBotRuntime(guild: Guild, context: BotContext) {
  const key = runtimeScopeKey(guild.id);
  const cached = setupCache.get(key);

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

async function reconcileGuildPunishmentRoles(guild: Guild, context: BotContext) {
  if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    return;
  }

  const runtime = await getSafeBotRuntime(guild, context).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel carregar runtime para reconciliar cargos em ${guild.id}:`, errorMessage(error));
    return null;
  });

  if (!runtime) {
    return;
  }

  const assignments = await context.api.getSelfBotRoleAssignments(guild.id).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel buscar castigos persistidos em ${guild.id}:`, errorMessage(error));
    return [];
  });

  await Promise.allSettled(
    assignments.map(async (assignment) => {
      const roleId = assignment.roleId ?? punishmentAddRoleId(runtime);
      const member = await guild.members.fetch(assignment.userId).catch(() => null);

      if (!member || member.roles.cache.has(roleId)) {
        return;
      }

      const assigned = await applySelfBotRole(member, roleId);

      if (!assigned.succeeded) {
        console.warn(
          `[safe-bot] nao foi possivel reaplicar cargo de castigo para ${assignment.userId} em ${guild.id}:`,
          assigned.error
        );
      }
    })
  );
}

function punishmentAddRoleId(runtime: SafeBotRuntime) {
  return runtime.protectionSettings?.addRoleId ?? runtime.roleId;
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
      await warnInChannel(member, message, `SafeBot: ${detected.label} bloqueado no servidor ${message.guild?.name ?? ""}.`);
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
  const key = runtimeScopeKey(message.guildId, message.author.id);
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

async function deleteMessagesOrThrow(messages: Message[]) {
  const uniqueMessages = [...new Map(messages.map((message) => [message.id, message])).values()];
  const results = await Promise.allSettled(uniqueMessages.map((message) => deleteMessageOrThrow(message)));
  const errors = results
    .map((result, index) => result.status === "rejected"
      ? `${uniqueMessages[index]?.id ?? "mensagem"}: ${errorMessage(result.reason)}`
      : null)
    .filter((error): error is string => Boolean(error));

  if (errors.length) {
    throw new Error(errors.join(" | "));
  }
}

async function deleteMessageOrThrow(message: Message) {
  if (!message.deletable) {
    throw new Error("O bot nao tem permissao para apagar esta mensagem.");
  }

  await message.delete();
}

async function sendFilterLog(message: Message, runtime: SafeBotRuntime, punishment: SequencePunishmentOutcome) {
  const embed = new EmbedBuilder()
    .setColor(punishment.error ? 0xf59e0b : SELF_BOT_COLOR)
    .setTitle("[SAFEBOT]")
    .setDescription([
      `**Usuario:** ${message.author.tag}`,
      `**ID:** \`${message.author.id}\``,
      `**Acao:** Mensagem enviada no canal de filtro.`,
      `**Punicao:** ${formatPunishmentActions(punishment.actions)}`,
      punishment.error ? `**Erro:** ${punishment.error}` : "**Punicao executada.**"
    ].join("\n"))
    .setTimestamp(new Date());

  await sendPunishmentLogEmbeds(message.guild, runtime, embed);
}

async function sendFloodLog(message: Message, runtime: SafeBotRuntime, reason: string, punishment: SequencePunishmentOutcome) {
  const embed = new EmbedBuilder()
    .setColor(punishment.error ? 0xf59e0b : SELF_BOT_COLOR)
    .setTitle("[SAFEBOT] Flood detectado")
    .setDescription([
      `**Usuario:** ${message.author.tag}`,
      `**ID:** \`${message.author.id}\``,
      `**Canal:** <#${message.channelId}>`,
      `**Motivo:** ${reason}`,
      `**Punicao:** ${formatPunishmentActions(punishment.actions)}`,
      punishment.error ? `**Erro:** ${punishment.error}` : "**Punicao executada.**"
    ].join("\n"))
    .setTimestamp(new Date());

  await sendPunishmentLogEmbeds(message.guild, runtime, embed);
}

async function sendSelfBotDetectedLog(
  message: Message,
  runtime: SafeBotRuntime,
  detected: DetectedPayload,
  punishment: SequencePunishmentOutcome
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
      `**Acao executada:** ${punishmentLabel(primaryPunishmentAction(punishment.actions))}`,
      `**Sequencia:** ${formatPunishmentActions(punishment.actions)}`,
      punishment.error ? `**Erro:** ${punishment.error}` : ""
    ].filter(Boolean).join("\n"))
    .setTimestamp(new Date());

  await sendPunishmentLogEmbeds(message.guild, runtime, embed);
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
      punishmentRoleId: punishmentAddRoleId(runtime),
      roleId: punishmentAddRoleId(runtime)
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

async function sendPunishmentLogEmbeds(guild: Guild | null, runtime: SafeBotRuntime, embed: EmbedBuilder) {
  const punishmentLogChannelId = runtime.protectionSettings?.punishmentLogChannelId ?? null;
  const sends = [sendLogEmbed(guild, runtime.logChannelId, embed)];

  if (punishmentLogChannelId && punishmentLogChannelId !== runtime.logChannelId) {
    sends.push(sendLogEmbed(guild, punishmentLogChannelId, EmbedBuilder.from(embed)));
  }

  await Promise.allSettled(sends);
}

async function warnInChannel(member: GuildMember, message: Message, content: string) {
  if (!message.channel.isSendable()) {
    return;
  }

  const warning = await message.channel.send({
    allowedMentions: {
      users: [member.id]
    },
    content: `<@${member.id}> ${content}`
  });
  const timer = setTimeout(() => {
    void warning.delete().catch(() => undefined);
  }, 12_000);

  timer.unref();
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

async function findTextChannel(guild: Guild, name: string): Promise<TextChannel | null> {
  const channels = await guild.channels.fetch().catch(() => null);
  const channel = channels?.find((item) => item?.type === ChannelType.GuildText && item.name === name) ?? null;
  return channel?.type === ChannelType.GuildText ? channel : null;
}

async function disableFilterChannel(channel: Awaited<ReturnType<typeof findTextChannel>>, guildId: string) {
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }

  await channel.permissionOverwrites.edit(
    channel.guild.roles.everyone,
    {
      SendMessages: false
    },
    {
      reason: "Self Bot: modulo nao liberado para este bot"
    }
  ).catch((error) => {
    console.warn(`[safe-bot] nao foi possivel desativar o canal em ${guildId}:`, errorMessage(error));
  });
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

  const key = `${channel.guild.id}:${channel.id}`;
  const previous = filterWarningQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => reconcileFilterWarning(channel))
    .finally(() => {
      if (filterWarningQueues.get(key) === next) {
        filterWarningQueues.delete(key);
      }
    });

  filterWarningQueues.set(key, next);
  await next;
}

async function reconcileFilterWarning(channel: NonNullable<Awaited<ReturnType<typeof findTextChannel>>>) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const warnings = messages.filter((message) => isFilterWarningMessage(message));
  const currentWarning = warnings.find((message) => isCurrentFilterWarning(message));
  const created = !currentWarning;
  const container = new ContainerBuilder()
    .setAccentColor(FILTER_WARNING_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(FILTER_WARNING_TITLE),
      new TextDisplayBuilder().setContent(FILTER_WARNING_DESCRIPTION)
    );
  const warning = currentWarning ?? await channel.send({
    allowedMentions: {
      parse: []
    },
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });

  const removals = await Promise.allSettled(
    warnings
      .filter((message) => message.id !== warning.id)
      .map((message) => message.delete())
  );
  const removed = removals.filter((result) => result.status === "fulfilled").length;

  console.log(
    `[safe-bot] aviso Components V2 ${created ? "publicado" : "confirmado"} no canal ${channel.id}; avisos antigos removidos: ${removed}.`
  );
}

function isFilterWarningMessage(message: Message) {
  if (message.author.id !== message.client.user?.id) {
    return false;
  }

  const components = serializedMessageComponents(message);
  return components.includes(FILTER_WARNING_TITLE)
    || components.includes("Não envie mensagens aqui")
    || components.includes("Nao envie mensagens aqui")
    || message.content.includes("Qualquer mensagem enviada nesta sala")
    || components.includes("Qualquer mensagem enviada nesta sala");
}

function isCurrentFilterWarning(message: Message) {
  if (!message.flags.has(MessageFlags.IsComponentsV2)) {
    return false;
  }

  const components = serializedMessageComponents(message);
  return components.includes(FILTER_WARNING_TITLE)
    && components.includes(FILTER_WARNING_DESCRIPTION);
}

function serializedMessageComponents(message: Message) {
  try {
    return JSON.stringify(message.components.map((component) => component.toJSON()));
  } catch {
    return "";
  }
}

function punishmentLabel(action: SelfBotPunishmentAction | "none") {
  if (action === "ban") return "BANIMENTO AUTOMATICO";
  if (action === "kick") return "EXPULSAO AUTOMATICA";
  if (action === "timeout") return "MUTE AUTOMATICO";
  if (action === "warn") return "ADVERTENCIA";
  if (action === "add_role") return "CARGO SELF BOT";
  if (action === "delete_message") return "MENSAGEM REMOVIDA";
  if (action === "remove_role") return "CARGO REMOVIDO";
  if (action === "log") return "LOG";
  return "REGISTRO";
}

function formatPunishmentActions(actions: SelfBotPunishmentAction[]) {
  return actions.length
    ? actions.map((action) => punishmentLabel(action)).join(", ")
    : "Nenhuma";
}

export function isSelfBotModuleEnabled() {
  return isBotModuleEnabled(MODULE_ID);
}

function shouldCheckSelfBotRuntime() {
  return isSelfBotModuleEnabled() || Boolean(env.DASHBOARD_BOT_ID.trim());
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
