import axios from "axios";
import {
  AuditLogEvent,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Message
} from "discord.js";
import { env } from "../config/env";
import type { BotContext } from "../types";
import type {
  SelfBotProtectionModuleId,
  SelfBotProtectionSettings,
  SelfBotPunishmentAction
} from "./apiClient";
import { ensureSelfBotRole, isSelfBotModuleEnabled } from "./safeBotService";

type CachedSettings = {
  expiresAt: number;
  settings: SelfBotProtectionSettings;
};

type MessageHistoryEntry = {
  at: number;
  channelId: string;
  normalized: string;
};

type AttachmentHistoryEntry = {
  at: number;
  images: number;
  mediaTotal: number;
};

type Violation = {
  moduleId: SelfBotProtectionModuleId;
  infractionType: string;
  details: string;
  metadata: Record<string, unknown>;
};

type PunishmentResult = {
  actions: SelfBotPunishmentAction[];
  error: string | null;
  succeeded: boolean;
};

const SETTINGS_CACHE_MS = 30_000;
const settingsCache = new Map<string, CachedSettings>();
const messageHistory = new Map<string, MessageHistoryEntry[]>();
const attachmentHistory = new Map<string, AttachmentHistoryEntry[]>();
const guildJoinWindows = new Map<string, number[]>();
const guildMutationWindows = new Map<string, number[]>();
const processingQueues = new Map<string, Promise<boolean>>();
const roleEnsureInFlight = new Map<string, Promise<unknown>>();
const URL_PATTERN =
  /(?:^|[\s<([{])((?:https?:\/\/|www\.)[^\s<>()\]]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>()\]]*)?)/gi;
const INVITE_PATTERN = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const SHORTENER_PATTERN = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rebrand\.ly|shrtco\.de|shorturl\.at)\b/i;
const TOKEN_PATTERN = /(?:mfa\.[\w-]{20,}|[\w-]{24}\.[\w-]{6}\.[\w-]{27})/i;
const COMMAND_PATTERN = /^\s*(?:\/|!|\.|\?|;|\$|>|-)[\w-]{2,}/;
let serviceStarted = false;

export function startSelfBotProtectionService(context: BotContext) {
  if (serviceStarted || !isSelfBotModuleEnabled()) {
    return;
  }

  serviceStarted = true;
  context.socket.onSelfBotProtectionSettingsUpdated((payload) => {
    if (payload.botId && env.DASHBOARD_BOT_ID && payload.botId !== env.DASHBOARD_BOT_ID) {
      return;
    }

    settingsCache.delete(payload.guildId);
    clearGuildWindows(payload.guildId);

    const guild = context.client.guilds.cache.get(payload.guildId);
    if (guild) {
      void ensureRoleForEnabledGuild(guild, context);
    }
  });
}

export async function handleSelfBotProtectionMessage(message: Message, context: BotContext) {
  if (!isSelfBotModuleEnabled() || !message.guild || message.author.id === message.client.user?.id) {
    return false;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const previous = processingQueues.get(key) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(() => processMessage(message, context))
    .catch((error) => {
      console.warn("[self-bot-protection] falha ao processar mensagem:", errorMessage(error));
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

export async function handleSelfBotProtectionMemberAdd(member: GuildMember, context: BotContext) {
  if (!isSelfBotModuleEnabled()) {
    return false;
  }

  const settings = await getCachedSettings(member.guild.id, context).catch((error) => {
    console.warn("[self-bot-protection] nao foi possivel carregar configuracao de entrada:", errorMessage(error));
    return null;
  });

  if (!settings?.enabled || !hasAnyModuleEnabled(settings)) {
    return false;
  }

  await ensureRoleForEnabledGuild(member.guild, context);

  const now = Date.now();
  const createdAt = member.user.createdTimestamp;
  const accountAgeHours = Math.max(0, Math.floor((now - createdAt) / 3_600_000));

  if (isModuleEnabled(settings, "anti-contas-novas") && accountAgeHours < settings.newAccountMaxAgeHours) {
    await handleViolation({
      context,
      guild: member.guild,
      member,
      settings,
      violation: {
        moduleId: "anti-contas-novas",
        infractionType: "Conta nova",
        details: `Conta criada ha ${accountAgeHours} hora(s).`,
        metadata: {
          accountAgeHours,
          maxAgeHours: settings.newAccountMaxAgeHours
        }
      }
    });
    return true;
  }

  if (isModuleEnabled(settings, "anti-raid")) {
    const joins = pushWindow(guildJoinWindows, member.guild.id, now, settings.raidWindowSeconds);

    if (joins.length >= settings.raidJoinLimit) {
      await handleViolation({
        context,
        guild: member.guild,
        member,
        settings,
        violation: {
          moduleId: "anti-raid",
          infractionType: "Raid detectada",
          details: `${joins.length} entrada(s) em ${settings.raidWindowSeconds} segundo(s).`,
          metadata: {
            joinCount: joins.length,
            raidJoinLimit: settings.raidJoinLimit,
            raidWindowSeconds: settings.raidWindowSeconds
          }
        }
      });
      return true;
    }
  }

  return false;
}

export async function handleSelfBotProtectionGuildMutation(
  guild: Guild,
  context: BotContext,
  mutation: "channel_create" | "role_create" | "webhook_create",
  channelId: string | null = null
) {
  if (!isSelfBotModuleEnabled()) {
    return false;
  }

  const settings = await getCachedSettings(guild.id, context).catch((error) => {
    console.warn("[self-bot-protection] nao foi possivel carregar configuracao de raid:", errorMessage(error));
    return null;
  });

  if (!settings?.enabled || !hasAnyModuleEnabled(settings)) {
    return false;
  }

  const antiWebhook = mutation === "webhook_create" && isModuleEnabled(settings, "anti-webhook");
  const antiRaid = isModuleEnabled(settings, "anti-raid");

  if (!antiWebhook && !antiRaid) {
    return false;
  }

  const now = Date.now();
  const key = `${guild.id}:${mutation}`;
  const mutations = pushWindow(guildMutationWindows, key, now, settings.raidWindowSeconds);

  if (!antiWebhook && mutations.length < settings.raidJoinLimit) {
    return false;
  }

  const executor = await findAuditExecutor(guild, mutation);

  if (!executor || executor.id === context.client.user?.id) {
    return false;
  }

  const member = await guild.members.fetch(executor.id).catch(() => null);

  if (!member) {
    return false;
  }

  await ensureRoleForEnabledGuild(guild, context);

  await handleViolation({
    context,
    guild,
    member,
    settings,
    violation: {
      moduleId: antiWebhook ? "anti-webhook" : "anti-raid",
      infractionType: antiWebhook ? "Webhook bloqueado" : "Raid detectada",
      details: antiWebhook
        ? "Criacao de webhook detectada."
        : `${mutations.length} evento(s) de ${mutationLabel(mutation)} em ${settings.raidWindowSeconds} segundo(s).`,
      metadata: {
        channelId,
        mutation,
        mutationCount: mutations.length,
        raidJoinLimit: settings.raidJoinLimit,
        raidWindowSeconds: settings.raidWindowSeconds
      }
    }
  });
  return true;
}

async function processMessage(message: Message, context: BotContext) {
  const guild = message.guild;

  if (!guild) {
    return false;
  }

  const settings = await getCachedSettings(guild.id, context);

  if (!settings.enabled || !hasAnyModuleEnabled(settings) || !isChannelProtected(message, settings)) {
    return false;
  }

  if (message.author.bot && !isModuleEnabled(settings, "anti-bots") && !message.webhookId) {
    return false;
  }

  await ensureRoleForEnabledGuild(guild, context);

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);

  if (!member) {
    return false;
  }

  const violation = detectMessageViolation(message, settings);

  if (!violation) {
    rememberMessageState(message, settings);
    return false;
  }

  const result = await handleViolation({
    context,
    guild,
    member,
    message,
    settings,
    violation
  });

  rememberMessageState(message, settings);
  return result;
}

async function handleViolation(input: {
  context: BotContext;
  guild: Guild;
  member: GuildMember;
  message?: Message;
  settings: SelfBotProtectionSettings;
  violation: Violation;
}) {
  const punishment = await applyPunishment(input);

  await input.context.api.recordSelfBotProtectionIncident({
    guildId: input.guild.id,
    userId: input.member.id,
    username: input.member.user.tag,
    channelId: input.message?.channelId ?? null,
    messageId: input.message?.id ?? null,
    messageContent: input.message?.content ?? null,
    moduleId: input.violation.moduleId,
    infractionType: input.violation.infractionType,
    punishmentActions: punishment.actions,
    punishmentSucceeded: punishment.succeeded,
    punishmentError: punishment.error,
    metadata: {
      ...input.violation.metadata,
      details: input.violation.details
    }
  }).catch((error) => {
    console.warn("[self-bot-protection] nao foi possivel registrar incidente:", errorMessage(error));
  });

  return true;
}

async function getCachedSettings(guildId: string, context: BotContext) {
  const cached = settingsCache.get(guildId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  const settings = await context.api.getSelfBotProtectionSettings(guildId);
  settingsCache.set(guildId, {
    expiresAt: Date.now() + SETTINGS_CACHE_MS,
    settings
  });
  return settings;
}

async function ensureRoleForEnabledGuild(guild: Guild, context: BotContext) {
  const current = roleEnsureInFlight.get(guild.id);

  if (current) {
    return current;
  }

  const task = getCachedSettings(guild.id, context)
    .then((settings) => settings.enabled ? ensureSelfBotRole(guild, context) : null)
    .catch((error) => {
      console.warn("[self-bot-protection] nao foi possivel garantir cargo Self Bot:", errorMessage(error));
      return null;
    })
    .finally(() => {
      if (roleEnsureInFlight.get(guild.id) === task) {
        roleEnsureInFlight.delete(guild.id);
      }
    });

  roleEnsureInFlight.set(guild.id, task);
  return task;
}

function detectMessageViolation(message: Message, settings: SelfBotProtectionSettings): Violation | null {
  const content = message.content ?? "";
  const normalized = normalizeMessage(content);
  const links = extractLinks(content);
  const attachmentStats = countAttachments(message);
  const mediaNotAllowed = !isAllowedChannel(message, settings.mediaChannelIds);
  const linkNotAllowed = !isAllowedChannel(message, settings.linkChannelIds);
  const recentAttachments = recentAttachmentEntries(message, settings.imageWindowSeconds);
  const mediaWindowTotal = recentAttachments.reduce((total, entry) => total + entry.mediaTotal, 0) + attachmentStats.mediaTotal;
  const imageWindowTotal = recentAttachments.reduce((total, entry) => total + entry.images, 0) + attachmentStats.images;
  const now = Date.now();

  if (message.webhookId && isModuleEnabled(settings, "anti-webhook")) {
    return buildViolation("anti-webhook", "Webhook bloqueado", "Mensagem enviada por webhook.", { webhookId: message.webhookId });
  }

  if (message.author.bot && isModuleEnabled(settings, "anti-bots")) {
    return buildViolation("anti-bots", "Bot bloqueado", "Mensagem enviada por bot.", { botUserId: message.author.id });
  }

  if (content && isModuleEnabled(settings, "anti-token-grabber") && TOKEN_PATTERN.test(content)) {
    return buildViolation("anti-token-grabber", "Token grabber", "Padrao de token Discord detectado.", {});
  }

  if (links.length && linkNotAllowed && isModuleEnabled(settings, "anti-convites") && links.some((link) => INVITE_PATTERN.test(link))) {
    return buildViolation("anti-convites", "Convite bloqueado", "Convite Discord fora dos canais permitidos.", { links });
  }

  if (links.length && linkNotAllowed && hasAnyModule(settings, ["anti-links", "anti-divulgacao"])) {
    return buildViolation(activeModule(settings, ["anti-links", "anti-divulgacao"]), "Link bloqueado", "Link fora dos canais de divulgacao.", { links });
  }

  if (links.length && hasAnyModule(settings, ["anti-scam", "anti-phishing", "anti-nitro-scam"]) && isSuspiciousLinkOrText(content, links, settings)) {
    return buildViolation(activeModule(settings, ["anti-scam", "anti-phishing", "anti-nitro-scam"]), "Scam ou phishing", "URL ou termo suspeito detectado.", { links });
  }

  if (attachmentStats.images > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-imagens")) {
    return buildViolation("anti-imagens", "Imagem bloqueada", "Imagem enviada fora dos canais permitidos.", attachmentStats);
  }

  if (attachmentStats.gifs > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-gif")) {
    return buildViolation("anti-gif", "GIF bloqueado", "GIF enviado fora dos canais permitidos.", attachmentStats);
  }

  if (attachmentStats.total > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-anexos")) {
    return buildViolation("anti-anexos", "Anexo bloqueado", "Anexo enviado fora dos canais permitidos.", attachmentStats);
  }

  if (attachmentStats.mediaTotal > 0 && mediaWindowTotal > settings.imageLimit && hasAnyModule(settings, ["anti-imagens", "anti-anexos"])) {
    return buildViolation(activeModule(settings, ["anti-imagens", "anti-anexos"]), "Flood de anexos", "Quantidade de midias acima do limite.", {
      ...attachmentStats,
      imageWindowSeconds: settings.imageWindowSeconds,
      imageWindowTotal,
      mediaWindowTotal
    });
  }

  const mentionCount = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? settings.mentionLimit : 0);
  if (mentionCount >= settings.mentionLimit && hasAnyModule(settings, ["anti-mencoes", "anti-mass-ping"])) {
    return buildViolation(activeModule(settings, ["anti-mass-ping", "anti-mencoes"]), "Mass ping", "Quantidade de mencoes acima do limite.", { mentionCount });
  }

  const emojiCount = countEmojis(content);
  if (emojiCount >= settings.emojiLimit && isModuleEnabled(settings, "anti-emojis")) {
    return buildViolation("anti-emojis", "Flood de emojis", "Quantidade de emojis acima do limite.", { emojiCount });
  }

  if (isCapsLock(content, settings) && isModuleEnabled(settings, "anti-caps-lock")) {
    return buildViolation("anti-caps-lock", "Caps lock", "Mensagem com excesso de letras maiusculas.", {});
  }

  if (COMMAND_PATTERN.test(content) && isModuleEnabled(settings, "anti-comandos-em-massa")) {
    const commandEntries = recentEntries(message, settings.floodWindowSeconds)
      .filter((entry) => entry.normalized.startsWith("cmd:"));

    if (commandEntries.length + 1 >= settings.floodLimit) {
      return buildViolation("anti-comandos-em-massa", "Comandos em massa", "Comandos enviados em alta frequencia.", { commandCount: commandEntries.length + 1 });
    }
  }

  const history = recentEntries(message, Math.max(
    settings.floodWindowSeconds,
    settings.repeatedTextWindowSeconds,
    settings.multiChannelWindowSeconds
  ));
  const floodCount = history.filter((entry) => now - entry.at <= settings.floodWindowSeconds * 1_000).length + 1;

  if (floodCount >= settings.floodLimit && isModuleEnabled(settings, "anti-flood")) {
    return buildViolation("anti-flood", "Flood", "Mensagens acima do limite configurado.", { floodCount });
  }

  if (normalized) {
    const repeatedCount = history
      .filter((entry) => now - entry.at <= settings.repeatedTextWindowSeconds * 1_000)
      .filter((entry) => entry.normalized === normalized || similarity(entry.normalized, normalized) >= 0.86)
      .length + 1;

    if (repeatedCount >= settings.repeatedTextLimit && hasAnyModule(settings, ["anti-spam", "anti-texto-repetido", "anti-copypasta", "anti-auto-spam"])) {
      return buildViolation(
        activeModule(settings, ["anti-spam", "anti-texto-repetido", "anti-copypasta", "anti-auto-spam"]),
        "Spam inteligente",
        "Mensagens repetidas ou similares detectadas.",
        {
          repeatedCount,
          normalized
        }
      );
    }
  }

  const channelCount = new Set(
    history
      .filter((entry) => now - entry.at <= settings.multiChannelWindowSeconds * 1_000)
      .map((entry) => entry.channelId)
      .concat(message.channelId)
  ).size;

  if (channelCount >= settings.multiChannelLimit && isModuleEnabled(settings, "anti-flood-multi-canais")) {
    return buildViolation("anti-flood-multi-canais", "Flood multi-canais", "Mensagens distribuidas em varios canais.", { channelCount });
  }

  return null;
}

async function applyPunishment(input: {
  context: BotContext;
  guild: Guild;
  member: GuildMember;
  message?: Message;
  settings: SelfBotProtectionSettings;
  violation: Violation;
}): Promise<PunishmentResult> {
  const actions: SelfBotPunishmentAction[] = [];
  const errors: string[] = [];
  const role = await ensureSelfBotRole(input.guild, input.context).catch(() => null);

  for (const action of input.settings.punishmentSequence) {
    try {
      if (action === "delete_message") {
        await deleteSourceMessage(input.message);
        actions.push(action);
      } else if (action === "warn") {
        await warnMember(input.member, input.message, input.violation.details);
        actions.push(action);
      } else if (action === "log") {
        await sendLog(input);
        actions.push(action);
      } else if (action === "add_role") {
        const roleId = input.settings.addRoleId ?? role?.id ?? null;
        if (!roleId) {
          throw new Error("Nenhum cargo configurado para adicionar.");
        }
        await input.member.roles.add(roleId, `SelfBot Protection: ${input.violation.infractionType}`);
        actions.push(action);
      } else if (action === "remove_role") {
        if (!input.settings.removeRoleId) {
          throw new Error("Nenhum cargo configurado para remover.");
        }
        await input.member.roles.remove(input.settings.removeRoleId, `SelfBot Protection: ${input.violation.infractionType}`);
        actions.push(action);
      } else if (action === "timeout") {
        if (!input.member.moderatable) {
          throw new Error("O bot nao pode aplicar timeout neste membro.");
        }
        await input.member.timeout(input.settings.timeoutSeconds * 1_000, input.violation.infractionType);
        actions.push(action);
      } else if (action === "kick") {
        if (!input.member.kickable) {
          throw new Error("O bot nao pode expulsar este membro.");
        }
        await input.member.kick(input.violation.infractionType);
        actions.push(action);
        break;
      } else if (action === "ban") {
        if (!input.member.bannable) {
          throw new Error("O bot nao pode banir este membro.");
        }
        await input.member.ban({
          deleteMessageSeconds: 60 * 60,
          reason: input.violation.infractionType
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

async function deleteSourceMessage(message: Message | undefined) {
  if (!message) {
    throw new Error("Mensagem original nao disponivel para apagar.");
  }

  await message.delete();
}

async function warnMember(member: GuildMember, message: Message | undefined, details: string) {
  const content = `SelfBot Protection: ${details}`;
  const dmSent = await member.send(content).then(() => true).catch(() => false);

  if (dmSent || !message?.channel.isSendable()) {
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

async function sendLog(input: {
  guild: Guild;
  member: GuildMember;
  message?: Message;
  settings: SelfBotProtectionSettings;
  violation: Violation;
}) {
  const embed = new EmbedBuilder()
    .setColor(parseColor(input.settings.embedColor))
    .setTitle("SelfBot Protection")
    .setDescription(input.violation.details)
    .addFields(
      { name: "Usuario", value: `${input.member.user.tag}\n\`${input.member.id}\``, inline: true },
      { name: "Infracao", value: input.violation.infractionType, inline: true },
      { name: "Modulo", value: input.violation.moduleId, inline: true },
      { name: "Canal", value: input.message ? `<#${input.message.channelId}>` : "Entrada no servidor", inline: true },
      { name: "Punicao", value: input.settings.punishmentSequence.join(", ") || "Nenhuma", inline: false }
    )
    .setTimestamp(new Date());

  if (input.message?.content) {
    embed.addFields({
      name: "Mensagem",
      value: truncate(input.message.content, 900)
    });
  }

  if (input.message?.url) {
    embed.setURL(input.message.url);
  }

  const payload = {
    allowedMentions: {
      parse: [] as never[]
    },
    embeds: [embed]
  };

  await Promise.allSettled([
    sendChannelLog(input.guild, input.settings.logChannelId, payload),
    sendWebhookLog(input.settings.logWebhookUrl, embed)
  ]);
}

async function sendChannelLog(guild: Guild, channelId: string | null, payload: { allowedMentions: { parse: never[] }; embeds: EmbedBuilder[] }) {
  if (!channelId) {
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    return;
  }

  await channel.send(payload);
}

async function sendWebhookLog(webhookUrl: string | null, embed: EmbedBuilder) {
  if (!webhookUrl) {
    return;
  }

  await axios.post(webhookUrl, {
    embeds: [embed.toJSON()],
    allowed_mentions: {
      parse: []
    }
  }, {
    timeout: 8_000
  });
}

function rememberMessageState(message: Message, settings: SelfBotProtectionSettings) {
  rememberMessage(message, settings);
  rememberAttachments(message, settings);
}

function rememberMessage(message: Message, settings: SelfBotProtectionSettings) {
  const key = keyForMessage(message);
  const normalized = COMMAND_PATTERN.test(message.content)
    ? `cmd:${normalizeMessage(message.content)}`
    : normalizeMessage(message.content);
  const maxWindowSeconds = Math.max(
    settings.floodWindowSeconds,
    settings.repeatedTextWindowSeconds,
    settings.multiChannelWindowSeconds,
    60
  );
  const entries = recentEntries(message, maxWindowSeconds);

  entries.push({
    at: Date.now(),
    channelId: message.channelId,
    normalized
  });
  messageHistory.set(key, entries.slice(-100));
}

function rememberAttachments(message: Message, settings: SelfBotProtectionSettings) {
  const stats = countAttachments(message);

  if (stats.mediaTotal === 0) {
    return;
  }

  const entries = recentAttachmentEntries(message, settings.imageWindowSeconds);
  entries.push({
    at: Date.now(),
    images: stats.images,
    mediaTotal: stats.mediaTotal
  });
  attachmentHistory.set(keyForMessage(message), entries.slice(-100));
}

function recentEntries(message: Message, windowSeconds: number) {
  const key = keyForMessage(message);
  const minAt = Date.now() - windowSeconds * 1_000;
  const entries = (messageHistory.get(key) ?? []).filter((entry) => entry.at >= minAt);

  messageHistory.set(key, entries);
  return entries;
}

function recentAttachmentEntries(message: Message, windowSeconds: number) {
  const key = keyForMessage(message);
  const minAt = Date.now() - windowSeconds * 1_000;
  const entries = (attachmentHistory.get(key) ?? []).filter((entry) => entry.at >= minAt);

  attachmentHistory.set(key, entries);
  return entries;
}

function keyForMessage(message: Message) {
  return `${message.guildId}:${message.author.id}`;
}

function isChannelProtected(message: Message, settings: SelfBotProtectionSettings) {
  if (isAllowedChannel(message, settings.ignoredChannelIds)) {
    return false;
  }

  return settings.protectedChannelIds.length === 0 || isAllowedChannel(message, settings.protectedChannelIds);
}

function isAllowedChannel(message: Message, channelIds: string[]) {
  if (!channelIds.length) {
    return false;
  }

  if (channelIds.includes(message.channelId)) {
    return true;
  }

  const parentId = message.channel.isThread() ? message.channel.parentId : null;
  return Boolean(parentId && channelIds.includes(parentId));
}

function hasAnyModuleEnabled(settings: SelfBotProtectionSettings) {
  return Object.values(settings.moduleToggles).some(Boolean);
}

function hasAnyModule(settings: SelfBotProtectionSettings, moduleIds: SelfBotProtectionModuleId[]) {
  return moduleIds.some((moduleId) => isModuleEnabled(settings, moduleId));
}

function isModuleEnabled(settings: SelfBotProtectionSettings, moduleId: SelfBotProtectionModuleId) {
  return settings.moduleToggles[moduleId] === true;
}

function activeModule(settings: SelfBotProtectionSettings, moduleIds: SelfBotProtectionModuleId[]) {
  return moduleIds.find((moduleId) => isModuleEnabled(settings, moduleId)) ?? moduleIds[0] ?? "anti-spam";
}

function buildViolation(
  moduleId: SelfBotProtectionModuleId,
  infractionType: string,
  details: string,
  metadata: Record<string, unknown>
): Violation {
  return {
    moduleId,
    infractionType,
    details,
    metadata
  };
}

function countAttachments(message: Message) {
  let images = 0;
  let gifs = 0;
  let videos = 0;

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    const name = `${attachment.name ?? ""} ${attachment.url}`.toLowerCase();

    if (contentType.startsWith("image/gif") || /\.gif(?:$|\?)/i.test(name)) {
      gifs += 1;
      images += 1;
    } else if (contentType.startsWith("image/") || /\.(?:avif|jpe?g|png|webp)(?:$|\?)/i.test(name)) {
      images += 1;
    } else if (contentType.startsWith("video/") || /\.(?:mp4|mov|webm|mkv)(?:$|\?)/i.test(name)) {
      videos += 1;
    }
  }

  return {
    gifs,
    images,
    mediaTotal: images + videos,
    total: message.attachments.size,
    videos
  };
}

function extractLinks(content: string) {
  URL_PATTERN.lastIndex = 0;
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = URL_PATTERN.exec(content))) {
    if (match[1]) {
      links.push(match[1].replace(/[)>.,!?]+$/, ""));
    }
  }

  return links;
}

function isSuspiciousLinkOrText(content: string, links: string[], settings: SelfBotProtectionSettings) {
  const lowerContent = normalizeSearchText(content);

  if (settings.blockedTerms.some((term) => lowerContent.includes(normalizeSearchText(term)))) {
    return true;
  }

  if (links.some((link) => SHORTENER_PATTERN.test(link))) {
    return true;
  }

  return links.some((link) => {
    const lowered = link.toLowerCase();
    return settings.suspiciousDomains.some((domain) => lowered.includes(domain.toLowerCase()));
  });
}

function countEmojis(content: string) {
  const customEmojiCount = content.match(/<a?:\w{2,32}:\d{5,32}>/g)?.length ?? 0;
  const unicodeEmojiCount = content.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  return customEmojiCount + unicodeEmojiCount;
}

function isCapsLock(content: string, settings: SelfBotProtectionSettings) {
  const letters = content.replace(/[^a-zA-ZÀ-ÿ]/g, "");

  if (letters.length < settings.capsMinLength) {
    return false;
  }

  const upper = letters.replace(/[^A-ZÀ-Ý]/g, "").length;
  return (upper / letters.length) * 100 >= settings.capsPercentage;
}

function normalizeMessage(content: string) {
  return normalizeSearchText(content)
    .replace(/<a?:\w{2,32}:\d{5,32}>/g, " emoji ")
    .replace(/\p{Extended_Pictographic}/gu, " emoji ")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(content: string) {
  return content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function similarity(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;

  return intersection / union;
}

function pushWindow(store: Map<string, number[]>, key: string, now: number, windowSeconds: number) {
  const minAt = now - windowSeconds * 1_000;
  const entries = (store.get(key) ?? []).filter((entry) => entry >= minAt);

  entries.push(now);
  store.set(key, entries);
  return entries;
}

function clearGuildWindows(guildId: string) {
  for (const key of messageHistory.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      messageHistory.delete(key);
    }
  }

  for (const key of attachmentHistory.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      attachmentHistory.delete(key);
    }
  }

  guildJoinWindows.delete(guildId);

  for (const key of guildMutationWindows.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      guildMutationWindows.delete(key);
    }
  }
}

async function findAuditExecutor(guild: Guild, mutation: "channel_create" | "role_create" | "webhook_create") {
  const type = mutation === "channel_create"
    ? AuditLogEvent.ChannelCreate
    : mutation === "role_create"
      ? AuditLogEvent.RoleCreate
      : AuditLogEvent.WebhookCreate;
  const logs = await guild.fetchAuditLogs({
    limit: 1,
    type
  }).catch(() => null);
  const entry = logs?.entries.first();

  if (!entry || Date.now() - entry.createdTimestamp > 10_000) {
    return null;
  }

  return entry.executor ?? null;
}

function mutationLabel(mutation: "channel_create" | "role_create" | "webhook_create") {
  if (mutation === "channel_create") return "criacao de canais";
  if (mutation === "role_create") return "criacao de cargos";
  return "criacao de webhooks";
}

function parseColor(value: string) {
  return Number.parseInt(value.replace("#", ""), 16) || 0x7c3aed;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
