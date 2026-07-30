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
  SelfBotPunishmentAction,
  SelfBotPunishmentStep
} from "./apiClient";
import { clearSafeBotSetupCache, ensureSafeBotSetup, ensureSelfBotRole, isSelfBotModuleEnabled } from "./safeBotService";
import { clearRuntimeModuleAuthorization, isRuntimeModuleAuthorized, runtimeScopeKey } from "./runtimeModuleGuard";
import { canModerateMessage, getModerationSettings } from "./moderationChannelPolicy";
import { deleteMessageWithAudit } from "./deletedMessageLogService";

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
  addedRoleId: string | null;
  error: string | null;
  succeeded: boolean;
};

const MODULE_ID = "safe-bot";
const messageHistory = new Map<string, MessageHistoryEntry[]>();
const attachmentHistory = new Map<string, AttachmentHistoryEntry[]>();
const guildJoinWindows = new Map<string, number[]>();
const guildMutationWindows = new Map<string, number[]>();
const stickerHistory = new Map<string, number[]>();
const nicknameHistory = new Map<string, number[]>();
const processingQueues = new Map<string, Promise<boolean>>();
const roleEnsureInFlight = new Map<string, Promise<unknown>>();
const actionRateWindows = new Map<string, number[]>();
const safeModeStates = new Map<string, { errors: number[]; until: number }>();
const URL_PATTERN =
  /(?:^|[\s<([{])((?:https?:\/\/|www\.)[^\s<>()\]]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>()\]]*)?)/gi;
const INVITE_PATTERN = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const SHORTENER_PATTERN = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rebrand\.ly|shrtco\.de|shorturl\.at)\b/i;
const TOKEN_PATTERN = /(?:mfa\.[\w-]{20,}|[\w-]{24}\.[\w-]{6}\.[\w-]{27})/i;
const COMMAND_PATTERN = /^\s*(?:\/|!|\.|\?|;|\$|>|-)[\w-]{2,}/;
let serviceStarted = false;

export function startSelfBotProtectionService(context: BotContext) {
  if (serviceStarted || !shouldCheckSelfBotRuntime()) {
    return;
  }

  serviceStarted = true;
  context.socket.onSelfBotProtectionSettingsUpdated((payload) => {
    if (payload.botId && env.DASHBOARD_BOT_ID && payload.botId !== env.DASHBOARD_BOT_ID) {
      return;
    }

    clearRuntimeModuleAuthorization(payload.guildId);
    clearSafeBotSetupCache(payload.guildId);
    clearGuildWindows(payload.guildId);

    const guild = context.client.guilds.cache.get(payload.guildId);
    if (guild) {
      void ensureSafeBotSetup(guild, context);
    }
  });
}

export async function handleSelfBotProtectionMessage(message: Message, context: BotContext) {
  if (!shouldCheckSelfBotRuntime() || !message.guild || message.author.id === message.client.user?.id) {
    return false;
  }
  if ((await canModerateMessage(message, context, MODULE_ID)).ignored) return false;

  if (!(await isRuntimeModuleAuthorized(context, message.guild.id, MODULE_ID))) {
    return false;
  }

  const key = runtimeScopeKey(message.guild.id, message.author.id);
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
  if (!shouldCheckSelfBotRuntime()) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, member.guild.id, MODULE_ID))) {
    return false;
  }

  const settings = await getCachedSettings(member.guild.id, context).catch((error) => {
    console.warn("[self-bot-protection] não foi possível carregar configuração de entrada:", errorMessage(error));
    return null;
  });

  if (!settings?.enabled || !hasAnyModuleEnabled(settings)) {
    return false;
  }

  await ensureRoleForEnabledGuild(member.guild, context);

  if (isMemberExempt(member, settings)) return false;

  if (member.user.bot && isModuleEnabled(settings, "anti-bots") && settings.antiBotAction !== "allow") {
    if (settings.ignoredBotIds.includes(member.id)) return false;
    if (settings.antiBotAction === "kick" && member.kickable) {
      await member.kick("SafeBot: entrada de bot não autorizado");
      return true;
    }
    if (settings.antiBotAction === "ban" && member.bannable) {
      await member.ban({ reason: "SafeBot: entrada de bot não autorizado" });
      return true;
    }
    await handleViolation({
      context, guild: member.guild, member, settings,
      violation: buildViolation("anti-bots", "Bot aguardando aprovação", "Um bot não autorizado entrou no servidor.", { botUserId: member.id })
    });
    return true;
  }

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
    const joins = pushWindow(guildJoinWindows, runtimeScopeKey(member.guild.id), now, settings.raidWindowSeconds);

    if (joins.length >= settings.raidJoinLimit) {
      if (settings.raidLockdownEnabled) await applyRaidLockdown(member.guild);
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

async function applyRaidLockdown(guild: Guild) {
  const channels = guild.channels.cache.filter((channel) => channel.isTextBased() && !channel.isThread()).first(50);
  await Promise.allSettled(channels.map((channel) => channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: "SafeBot: lockdown anti-raid" })));
}

export async function handleSelfBotProtectionGuildMutation(
  guild: Guild,
  context: BotContext,
  mutation: "channel_create" | "channel_update" | "channel_delete" | "role_create" | "role_update" | "role_delete" | "webhook_create" | "emoji_create" | "emoji_update" | "emoji_delete" | "sticker_create" | "sticker_update" | "sticker_delete",
  channelId: string | null = null,
  rollback?: () => Promise<unknown>
) {
  if (!shouldCheckSelfBotRuntime()) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    return false;
  }

  const settings = await getCachedSettings(guild.id, context).catch((error) => {
    console.warn("[self-bot-protection] não foi possível carregar configuração de raid:", errorMessage(error));
    return null;
  });

  if (!settings?.enabled || !hasAnyModuleEnabled(settings)) {
    return false;
  }

  const antiWebhook = mutation === "webhook_create" && isModuleEnabled(settings, "anti-webhook");
  const specificModule = mutation.startsWith("channel_") ? "anti-canais"
    : mutation.startsWith("role_") ? "anti-cargos"
      : mutation.startsWith("emoji_") ? "anti-emojis-servidor"
        : mutation.startsWith("sticker_") ? "anti-stickers"
          : null;
  const specificProtection = specificModule ? isModuleEnabled(settings, specificModule) : false;
  const antiRaid = isModuleEnabled(settings, "anti-raid");

  if (!antiWebhook && !antiRaid && !specificProtection) {
    return false;
  }

  const now = Date.now();
  const key = runtimeScopeKey(guild.id, mutation);
  const mutations = pushWindow(guildMutationWindows, key, now, settings.raidWindowSeconds);

  if (!antiWebhook && !specificProtection && mutations.length < settings.raidJoinLimit) {
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
  if (isMemberExempt(member, settings)) return false;

  if ((antiWebhook || specificProtection) && rollback) {
    await rollback().catch((error) => console.warn("[self-bot-protection] rollback falhou:", errorMessage(error)));
  }

  await ensureRoleForEnabledGuild(guild, context);

  await handleViolation({
    context,
    guild,
    member,
    settings,
    violation: {
      moduleId: antiWebhook ? "anti-webhook" : specificModule ?? "anti-raid",
      infractionType: antiWebhook ? "Webhook bloqueado" : specificProtection ? "Alteração administrativa bloqueada" : "Raid detectada",
      details: antiWebhook
        ? "Criação de webhook detectada."
        : specificProtection
          ? `${mutationLabel(mutation)} detectada e revertida.`
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

export async function handleSelfBotProtectionMemberUpdate(oldMember: GuildMember, newMember: GuildMember, context: BotContext) {
  if (oldMember.nickname === newMember.nickname || !shouldCheckSelfBotRuntime()) return false;
  const settings = await getCachedSettings(newMember.guild.id, context).catch(() => null);
  if (!settings?.enabled || !isModuleEnabled(settings, "anti-nome") || isMemberExempt(newMember, settings)) return false;
  const changes = pushWindow(nicknameHistory, runtimeScopeKey(newMember.guild.id, newMember.id), Date.now(), settings.nicknameWindowSeconds);
  if (changes.length < settings.nicknameChangeLimit) return false;
  if (newMember.manageable) await newMember.setNickname(oldMember.nickname, "SafeBot: excesso de alteração de nickname").catch(() => undefined);
  return handleViolation({ context, guild: newMember.guild, member: newMember, settings, violation: buildViolation("anti-nome", "Alteração excessiva de nome", `${changes.length} alterações em ${settings.nicknameWindowSeconds} segundos.`, { changes: changes.length }) });
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

  if (isMemberExempt(member, settings)) return false;

  let violation = detectMessageViolation(message, settings);
  if (violation?.moduleId === "anti-convites" && settings.allowedInviteGuildIds.length > 0) {
    const inviteLinks = extractLinks(message.content ?? "").filter((link) => INVITE_PATTERN.test(link));
    if (inviteLinks.length && await allInvitesAllowed(inviteLinks, settings.allowedInviteGuildIds, context)) violation = null;
  }

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
  if (!(await isRuntimeModuleAuthorized(input.context, input.guild.id, input.violation.moduleId))) {
    return false;
  }

  if (isSafeModeActive(input.guild.id, input.violation.moduleId)) {
    await input.context.api.recordSelfBotProtectionIncident({
      guildId: input.guild.id,
      userId: input.member.id,
      username: input.member.user.tag,
      channelId: input.message?.channelId ?? null,
      messageId: input.message?.id ?? null,
      messageContent: input.message?.content ?? null,
      moduleId: input.violation.moduleId,
      infractionType: "Modo seguro ativo",
      punishmentActions: [],
      punishmentSucceeded: false,
      punishmentError: "Ação ignorada porque o modo seguro está ativo para este módulo.",
      metadata: {
        ...input.violation.metadata,
        details: input.violation.details,
        skipped: true,
        skipReason: "safe_mode"
      }
    }).catch((error) => {
      console.warn("[self-bot-protection] não foi possível registrar modo seguro:", errorMessage(error));
    });
    return false;
  }

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
      details: input.violation.details,
      punishmentRoleId: punishment.addedRoleId
    }
  }).catch((error) => {
    console.warn("[self-bot-protection] não foi possível registrar incidente:", errorMessage(error));
  });

  return true;
}

async function getCachedSettings(guildId: string, context: BotContext) {
  return getModerationSettings(guildId, context);
}

async function ensureRoleForEnabledGuild(guild: Guild, context: BotContext) {
  const key = runtimeScopeKey(guild.id);
  const current = roleEnsureInFlight.get(key);

  if (current) {
    return current;
  }

  const task = getCachedSettings(guild.id, context)
    .then((settings) => settings.enabled ? ensureSelfBotRole(guild, context) : null)
    .catch((error) => {
      console.warn("[self-bot-protection] não foi possível garantir cargo Self Bot:", errorMessage(error));
      return null;
    })
    .finally(() => {
      if (roleEnsureInFlight.get(key) === task) {
        roleEnsureInFlight.delete(key);
      }
    });

  roleEnsureInFlight.set(key, task);
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
    return buildViolation("anti-token-grabber", "Token grabber", "Padrão de token Discord detectado.", {});
  }

  if (links.length && linkNotAllowed && isModuleEnabled(settings, "anti-convites") && links.some((link) => INVITE_PATTERN.test(link))) {
    return buildViolation("anti-convites", "Convite bloqueado", "Convite Discord fora dos canais permitidos.", { links });
  }

  const disallowedLinks = links.filter((link) => !isAllowedDomain(link, settings.allowedDomains));
  if (disallowedLinks.length && linkNotAllowed && hasAnyModule(settings, ["anti-links", "anti-divulgacao"])) {
    return buildViolation(activeModule(settings, ["anti-links", "anti-divulgacao"]), "Link bloqueado", "Domínio não permitido fora dos canais liberados.", { links: disallowedLinks });
  }

  if (links.length && hasAnyModule(settings, ["anti-scam", "anti-phishing", "anti-nitro-scam"]) && isSuspiciousLinkOrText(content, links, settings)) {
    return buildViolation(activeModule(settings, ["anti-scam", "anti-phishing", "anti-nitro-scam"]), "Scam ou phishing", "URL ou termo suspeito detectado.", { links });
  }

  if (settings.blockImages && attachmentStats.images > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-imagens")) {
    return buildViolation("anti-imagens", "Imagem bloqueada", "Imagem enviada fora dos canais permitidos.", attachmentStats);
  }

  if (settings.blockGifs && attachmentStats.gifs > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-gif")) {
    return buildViolation("anti-gif", "GIF bloqueado", "GIF enviado fora dos canais permitidos.", attachmentStats);
  }

  if (attachmentStats.total > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-anexos")) {
    const blockedFiles = attachmentStats.extensions.filter((extension) => settings.blockedFileExtensions.includes(extension));
    if (!blockedFiles.length && !attachmentStats.audios && !attachmentStats.videos) {
      // Imagens e GIFs são controlados pelos módulos de mídia.
    } else {
      return buildViolation("anti-anexos", "Arquivo bloqueado", "Arquivo ou mídia com tipo não permitido.", { ...attachmentStats, blockedFiles });
    }
  }

  if (settings.blockVideos && attachmentStats.videos > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-anexos")) {
    return buildViolation("anti-anexos", "Vídeo bloqueado", "Vídeo enviado fora dos canais permitidos.", attachmentStats);
  }
  if (settings.blockAudio && attachmentStats.audios > 0 && mediaNotAllowed && isModuleEnabled(settings, "anti-anexos")) {
    return buildViolation("anti-anexos", "Áudio bloqueado", "Áudio enviado fora dos canais permitidos.", attachmentStats);
  }

  if (attachmentStats.stickers > 0 && isModuleEnabled(settings, "anti-stickers")) {
    const key = keyForMessage(message);
    const stickers = pushWindow(stickerHistory, key, Date.now(), settings.stickerWindowSeconds);
    for (let index = 1; index < attachmentStats.stickers; index += 1) stickers.push(Date.now());
    if (stickers.length >= settings.stickerLimit) {
      return buildViolation("anti-stickers", "Flood de stickers", "Quantidade de stickers acima do limite.", { stickerCount: stickers.length });
    }
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
  let addedRoleId: string | null = null;
  const errors: string[] = [];
  const role = await ensureSelfBotRole(input.guild, input.context).catch(() => null);
  const resolved = await input.context.api.resolveSelfBotPunishment({
    guildId: input.guild.id,
    moduleId: input.violation.moduleId,
    userId: input.member.id
  }).catch((error) => {
    console.warn("[self-bot-protection] não foi possível resolver etapa persistida:", errorMessage(error));
    return null;
  });
  const step = resolved?.step ?? firstLocalPunishmentStep(input.settings);
  const sequence = step ? stepActions(step) : input.settings.punishmentSequence;

  for (const action of sequence) {
    try {
      const rateLimit = consumeSecurityAction(input.guild.id, input.violation.moduleId, action);
      if (!rateLimit.allowed) {
        throw new Error(`Limite interno atingido para ${rateLimit.bucket}.`);
      }

      if (action === "delete_message") {
        if (input.message) {
          await deleteSourceMessage(input.context, input.message, input.violation);
          actions.push(action);
        }
      } else if (action === "warn") {
        await warnMember(input.member, input.message, input.violation.details);
        await sendDmWarning(input.member, input.settings, input.violation);
        actions.push(action);
      } else if (action === "log") {
        await sendLog(input);
        actions.push(action);
      } else if (action === "add_role") {
        const roleId = step?.cargoAdicionarId ?? input.settings.addRoleId ?? role?.id ?? null;
        if (!roleId) {
          throw new Error("Nenhum cargo configurado para adicionar.");
        }
        await input.member.roles.add(roleId, `SelfBot Protection: ${input.violation.infractionType}`);
        addedRoleId = roleId;
        actions.push(action);
      } else if (action === "remove_role") {
        const roleId = step?.cargoRemoverId ?? input.settings.removeRoleId;
        if (!roleId) {
          throw new Error("Nenhum cargo configurado para remover.");
        }
        await input.member.roles.remove(roleId, `SelfBot Protection: ${input.violation.infractionType}`);
        actions.push(action);
      } else if (action === "timeout") {
        if (!input.member.moderatable) {
          throw new Error("O bot não pode aplicar timeout neste membro.");
        }
        await input.member.timeout(timeoutDurationMs(step, input.settings), input.violation.infractionType);
        actions.push(action);
      } else if (action === "kick") {
        if (!input.member.kickable) {
          throw new Error("O bot não pode expulsar este membro.");
        }
        await input.member.kick(input.violation.infractionType);
        actions.push(action);
        break;
      } else if (action === "ban") {
        if (!input.member.bannable) {
          throw new Error("O bot não pode banir este membro.");
        }
        await input.member.ban({
          deleteMessageSeconds: step?.banApagarMensagensSegundos ?? 60 * 60,
          reason: input.violation.infractionType
        });
        actions.push(action);
        break;
      }
    } catch (error) {
      errors.push(`${action}: ${errorMessage(error)}`);
      rememberSecurityActionError(input.guild.id, input.violation.moduleId);
    }
  }

  return {
    actions,
    addedRoleId,
    error: errors.length ? errors.join(" | ") : null,
    succeeded: errors.length === 0
  };
}

function firstLocalPunishmentStep(settings: SelfBotProtectionSettings): SelfBotPunishmentStep | null {
  const configured = settings.punishmentSteps?.find((step) => step.ativado);

  if (configured) {
    return configured;
  }

  const action = settings.punishmentSequence[0];
  if (!action) {
    return null;
  }

  return {
    id: action,
    acao: action,
    ativado: true,
    limite: 1,
    proximaAcao: settings.punishmentSequence[1] ?? null,
    apagarMensagem: action === "delete_message",
    enviarAviso: action === "warn",
    registrarLog: true,
    tempoTimeout: secondsToDuration(settings.timeoutSeconds),
    cargoAdicionarId: settings.addRoleId,
    cargoRemoverId: settings.removeRoleId,
    banApagarMensagensSegundos: 3_600
  };
}

function stepActions(step: SelfBotPunishmentStep) {
  const actions: SelfBotPunishmentAction[] = [];

  if (step.apagarMensagem && step.acao !== "delete_message") {
    actions.push("delete_message");
  }

  if (step.enviarAviso && step.acao !== "warn") {
    actions.push("warn");
  }

  actions.push(step.acao);

  if (step.registrarLog && step.acao !== "log") {
    actions.push("log");
  }

  return [...new Set(actions)];
}

function timeoutDurationMs(step: SelfBotPunishmentStep | null, settings: SelfBotProtectionSettings) {
  if (!step) {
    return settings.timeoutSeconds * 1_000;
  }

  const duration = step.tempoTimeout;
  const seconds =
    duration.dias * 86_400
    + duration.horas * 3_600
    + duration.minutos * 60
    + duration.segundos;
  return Math.max(1_000, seconds * 1_000);
}

function secondsToDuration(totalSeconds: number) {
  let remaining = Math.max(1, Math.trunc(totalSeconds));
  const dias = Math.floor(remaining / 86_400);
  remaining -= dias * 86_400;
  const horas = Math.floor(remaining / 3_600);
  remaining -= horas * 3_600;
  const minutos = Math.floor(remaining / 60);
  const segundos = remaining - minutos * 60;
  return { dias, horas, minutos, segundos };
}

function consumeSecurityAction(guildId: string, moduleId: SelfBotProtectionModuleId, action: SelfBotPunishmentAction) {
  const buckets = actionBuckets(action);

  for (const bucket of buckets) {
    const limit = securityBucketLimit(bucket);

    if (limit <= 0 || !consumeRateWindow(`${guildId}:${moduleId}:${bucket}`, limit, 60_000)) {
      return {
        allowed: false,
        bucket
      };
    }
  }

  return {
    allowed: true,
    bucket: "actions"
  };
}

function actionBuckets(action: SelfBotPunishmentAction) {
  const buckets = ["actions"];

  if (action === "delete_message") {
    buckets.push("deletes");
  } else if (action === "kick") {
    buckets.push("kicks");
  } else if (action === "ban") {
    buckets.push("bans");
  } else if (action === "add_role" || action === "remove_role") {
    buckets.push("role_updates");
  }

  return buckets;
}

function securityBucketLimit(bucket: string) {
  if (bucket === "deletes") return env.SECURITY_MAX_DELETES_PER_MINUTE;
  if (bucket === "kicks") return env.SECURITY_MAX_KICKS_PER_MINUTE;
  if (bucket === "bans") return env.SECURITY_MAX_BANS_PER_MINUTE;
  if (bucket === "role_updates") return env.SECURITY_MAX_ROLE_UPDATES_PER_MINUTE;
  return env.SECURITY_MAX_ACTIONS_PER_MINUTE;
}

function consumeRateWindow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (actionRateWindows.get(key) ?? []).filter((timestamp) => now - timestamp <= windowMs);

  if (recent.length >= limit) {
    actionRateWindows.set(key, recent);
    return false;
  }

  recent.push(now);
  actionRateWindows.set(key, recent);
  return true;
}

function isSafeModeActive(guildId: string, moduleId: SelfBotProtectionModuleId) {
  const key = runtimeScopeKey(guildId, moduleId);
  const state = safeModeStates.get(key);

  if (!state) {
    return false;
  }

  if (state.until <= Date.now()) {
    safeModeStates.delete(key);
    return false;
  }

  return true;
}

function rememberSecurityActionError(guildId: string, moduleId: SelfBotProtectionModuleId) {
  const limit = Math.max(1, env.SECURITY_SAFE_MODE_ERROR_LIMIT);
  const now = Date.now();
  const key = runtimeScopeKey(guildId, moduleId);
  const current = safeModeStates.get(key);
  const errors = (current?.errors ?? []).filter((timestamp) => now - timestamp <= 60_000);

  errors.push(now);
  if (errors.length >= limit) {
    const until = now + Math.max(1, env.SECURITY_SAFE_MODE_TIME_MINUTES) * 60_000;
    safeModeStates.set(key, { errors: [], until });
    console.warn(`[self-bot-protection] modo seguro ativado em ${guildId}/${moduleId} ate ${new Date(until).toISOString()}.`);
    return;
  }

  safeModeStates.set(key, {
    errors,
    until: current?.until ?? 0
  });
}

async function deleteSourceMessage(context: BotContext, message: Message | undefined, violation: Violation) {
  if (!message) {
    throw new Error("Mensagem original não disponível para apagar.");
  }

  await deleteMessageWithAudit(context, message, {
    action: "AUTO_DELETE",
    deletionType: "AUTOMATIC",
    module: "SelfBot Protection",
    reason: violation.details,
    ruleId: violation.moduleId
  });
}

async function warnMember(member: GuildMember, message: Message | undefined, details: string) {
  const content = `SelfBot Protection: ${details}`;

  if (!message?.channel.isSendable()) {
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

async function sendDmWarning(member: GuildMember, settings: SelfBotProtectionSettings, violation: Violation) {
  if (!settings.dmWarningEnabled) return;
  const content = settings.dmWarningMessage
    .replaceAll("{proteção}", violation.infractionType)
    .replaceAll("{modulo}", violation.moduleId)
    .replaceAll("{servidor}", member.guild.name)
    .replaceAll("{usuário}", member.user.username);
  await member.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
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
      { name: "Usuário", value: `${input.member.user.tag}\n\`${input.member.id}\``, inline: true },
      { name: "Infracao", value: input.violation.infractionType, inline: true },
      { name: "Módulo", value: input.violation.moduleId, inline: true },
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
  const punishmentLogChannelId = input.settings.punishmentLogChannelId === input.settings.logChannelId
    ? null
    : input.settings.punishmentLogChannelId;

  const moduleLogChannelId = input.settings.moduleLogChannelIds[input.violation.moduleId] ?? input.settings.logChannelId;
  await Promise.allSettled([
    sendChannelLog(input.guild, moduleLogChannelId, payload),
    sendChannelLog(input.guild, punishmentLogChannelId, payload),
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
  return runtimeScopeKey(message.guildId, message.author.id);
}

function isChannelProtected(message: Message, settings: SelfBotProtectionSettings) {
  if (isAllowedChannel(message, settings.ignoredChannelIds)) {
    return false;
  }

  if (isAllowedChannel(message, settings.ignoredCategoryIds)) return false;
  return settings.protectedChannelIds.length === 0 || isAllowedChannel(message, settings.protectedChannelIds);
}

function isMemberExempt(member: GuildMember, settings: SelfBotProtectionSettings) {
  if (member.id === member.guild.ownerId || member.permissions.has("Administrator")) return true;
  if (settings.ignoredUserIds.includes(member.id)) return true;
  if (member.user.bot && settings.ignoredBotIds.includes(member.id)) return true;
  return member.roles.cache.some((role) => settings.ignoredRoleIds.includes(role.id));
}

function isAllowedChannel(message: Message, channelIds: string[]) {
  if (!channelIds.length) {
    return false;
  }

  if (channelIds.includes(message.channelId)) {
    return true;
  }

  const parentId = "parentId" in message.channel ? message.channel.parentId : null;
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
  const embedUrls = message.embeds.map((embed) => `${embed.url ?? ""} ${embed.image?.url ?? ""} ${embed.thumbnail?.url ?? ""} ${embed.video?.url ?? ""}`.toLowerCase());
  const gifEmbeds = embedUrls.filter((url) => /\.gif(?:$|[?#])/.test(url)).length;
  const embeds = message.embeds.filter((embed) => embed.image || embed.thumbnail || embed.video || embed.url).length;
  const stickers = message.stickers.size;
  let images = 0;
  let gifs = gifEmbeds;
  let videos = 0;
  let audios = 0;
  const extensions: string[] = [];

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    const name = `${attachment.name ?? ""} ${attachment.url}`.toLowerCase();
    const extension = (attachment.name ?? "").toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1];
    if (extension) extensions.push(extension);

    if (contentType.startsWith("image/gif") || /\.gif(?:$|\?)/i.test(name)) {
      gifs += 1;
      images += 1;
    } else if (contentType.startsWith("image/") || /\.(?:avif|jpe?g|png|webp)(?:$|\?)/i.test(name)) {
      images += 1;
    } else if (contentType.startsWith("video/") || /\.(?:mp4|mov|webm|mkv)(?:$|\?)/i.test(name)) {
      videos += 1;
    } else if (contentType.startsWith("audio/") || /\.(?:mp3|wav|ogg|m4a|flac)(?:$|\?)/i.test(name)) {
      audios += 1;
    }
  }

  return {
    embeds,
    gifs,
    images,
    audios,
    extensions,
    mediaTotal: images + videos + audios + embeds + stickers,
    stickers,
    total: message.attachments.size + embeds + stickers,
    videos
  };
}

function isAllowedDomain(link: string, allowedDomains: string[]) {
  try {
    const url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
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

async function allInvitesAllowed(links: string[], allowedGuildIds: string[], context: BotContext) {
  const guildIds = await Promise.all(links.map(async (link) => {
    const code = link.match(INVITE_PATTERN)?.[0]?.split("/").pop();
    if (!code) return null;
    const invite = await context.client.fetchInvite(code).catch(() => null);
    return invite?.guild?.id ?? null;
  }));
  return guildIds.every((guildId) => guildId !== null && allowedGuildIds.includes(guildId));
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
  const prefix = runtimeScopeKey(guildId);

  for (const key of messageHistory.keys()) {
    if (key.startsWith(`${prefix}:`)) {
      messageHistory.delete(key);
    }
  }

  for (const key of attachmentHistory.keys()) {
    if (key.startsWith(`${prefix}:`)) {
      attachmentHistory.delete(key);
    }
  }
  for (const key of stickerHistory.keys()) {
    if (key.startsWith(`${prefix}:`)) stickerHistory.delete(key);
  }
  for (const key of nicknameHistory.keys()) {
    if (key.startsWith(`${prefix}:`)) nicknameHistory.delete(key);
  }

  guildJoinWindows.delete(prefix);

  for (const key of guildMutationWindows.keys()) {
    if (key.startsWith(`${prefix}:`)) {
      guildMutationWindows.delete(key);
    }
  }
}

type GuildMutation = Parameters<typeof handleSelfBotProtectionGuildMutation>[2];

async function findAuditExecutor(guild: Guild, mutation: GuildMutation) {
  const type = mutation === "channel_create" ? AuditLogEvent.ChannelCreate
    : mutation === "channel_update" ? AuditLogEvent.ChannelUpdate
      : mutation === "channel_delete" ? AuditLogEvent.ChannelDelete
        : mutation === "role_create" ? AuditLogEvent.RoleCreate
          : mutation === "role_update" ? AuditLogEvent.RoleUpdate
            : mutation === "role_delete" ? AuditLogEvent.RoleDelete
              : mutation === "emoji_create" ? AuditLogEvent.EmojiCreate
                : mutation === "emoji_update" ? AuditLogEvent.EmojiUpdate
                  : mutation === "emoji_delete" ? AuditLogEvent.EmojiDelete
                    : mutation === "sticker_create" ? AuditLogEvent.StickerCreate
                      : mutation === "sticker_update" ? AuditLogEvent.StickerUpdate
                        : mutation === "sticker_delete" ? AuditLogEvent.StickerDelete
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

function mutationLabel(mutation: GuildMutation) {
  return mutation.replace("_", " ");
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

function shouldCheckSelfBotRuntime() {
  return isSelfBotModuleEnabled() || Boolean(env.DASHBOARD_BOT_ID.trim());
}
