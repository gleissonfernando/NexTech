import { EmbedBuilder, PermissionFlagsBits, type Message } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { NexTechInviteRuntimeInvite } from "./apiClient";
import type { BotContext } from "../types";
import { deleteMessageWithAudit } from "./deletedMessageLogService";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

const MODULE_ID = "nextech-invites";
const DISCORD_INVITE_PATTERN = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([a-z0-9-]+)/gi;
const runtimeCache = new Map<string, { expiresAt: number; invite: NexTechInviteRuntimeInvite | null }>();
const RUNTIME_TTL_MS = 5_000;

export async function handleNexTechInviteMessage(message: Message, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID) || !message.guild || message.author.bot || message.webhookId) {
    return false;
  }

  const inviteCodes = extractDiscordInviteCodes(message.content);
  if (!inviteCodes.length) {
    return false;
  }

  if (!(await isRuntimeModuleAuthorized(context, message.guild.id, MODULE_ID))) {
    return false;
  }

  const invite = await getRuntimeInvite(context, message.guild.id).catch((error) => {
    console.warn("[nextech-invites] falha ao buscar configuração:", errorMessage(error));
    return null;
  });

  if (!invite || invite.status !== "active" || !invite.blockUnknownInvites) {
    return false;
  }

  const allowedCodes = officialInviteCodes(invite);
  if (!allowedCodes.size) {
    return false;
  }

  const blockedCode = inviteCodes.find((code) => !allowedCodes.has(code));
  if (!blockedCode) {
    return false;
  }

  await deleteMessageWithAudit(context, message, {
    action: "AUTO_DELETE",
    deletionType: "AUTOMATIC",
    module: "Sistema de Convites NextTech",
    reason: `Convite Discord externo bloqueado: ${blockedCode}.`,
    ruleId: MODULE_ID
  }).catch((error) => {
    console.warn("[nextech-invites] não foi possível apagar convite externo:", errorMessage(error));
  });

  await context.api.recordNexTechInviteBlocked(message.guild.id, {
    channelId: message.channelId,
    inviteCode: blockedCode,
    messageId: message.id,
    userId: message.author.id,
    userName: message.author.tag
  }).catch((error) => {
    console.warn("[nextech-invites] não foi possível registrar convite bloqueado:", errorMessage(error));
  });

  await notifyAuthor(message).catch((error) => {
    console.warn("[nextech-invites] não foi possível avisar usuário:", errorMessage(error));
  });

  await sendInviteLog(message, invite, blockedCode).catch((error) => {
    console.warn("[nextech-invites] não foi possível enviar log:", errorMessage(error));
  });

  return true;
}

export function clearNexTechInviteRuntimeCache(guildId?: string | null) {
  if (!guildId) {
    runtimeCache.clear();
    return;
  }

  for (const key of runtimeCache.keys()) {
    if (key.endsWith(`:${guildId}`)) runtimeCache.delete(key);
  }
}

async function getRuntimeInvite(context: BotContext, guildId: string) {
  const key = `${context.client.user?.id ?? "unknown"}:${guildId}`;
  const cached = runtimeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.invite;
  }

  const runtime = await context.api.getNexTechInviteRuntime(guildId);
  const record = {
    expiresAt: Date.now() + RUNTIME_TTL_MS,
    invite: runtime.invite
  };
  runtimeCache.set(key, record);
  return record.invite;
}

function extractDiscordInviteCodes(content: string) {
  DISCORD_INVITE_PATTERN.lastIndex = 0;
  const codes = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = DISCORD_INVITE_PATTERN.exec(content))) {
    const code = normalizeInviteCode(match[1]);
    if (code) codes.add(code);
  }

  return [...codes];
}

function officialInviteCodes(invite: NexTechInviteRuntimeInvite) {
  const codes = new Set<string>();
  const code = normalizeInviteCode(invite.code);
  const urlCode = normalizeInviteCode(extractInviteCodeFromUrl(invite.inviteUrl));

  if (code) codes.add(code);
  if (urlCode) codes.add(urlCode);

  return codes;
}

function extractInviteCodeFromUrl(value: string | null | undefined) {
  if (!value) return null;
  DISCORD_INVITE_PATTERN.lastIndex = 0;
  return DISCORD_INVITE_PATTERN.exec(value)?.[1] ?? null;
}

function normalizeInviteCode(value: string | null | undefined) {
  const code = value?.trim().replace(/[^\w-]/g, "").toLowerCase() ?? "";
  return code || null;
}

async function notifyAuthor(message: Message) {
  const text = `Seu convite foi bloqueado. Use apenas o convite oficial deste servidor.`;

  await message.author.send(text).catch(async () => {
    if (!message.channel.isSendable()) return;
    const warning = await message.channel.send({
      allowedMentions: { users: [message.author.id] },
      content: `<@${message.author.id}> ${text}`
    });
    const timer = setTimeout(() => void warning.delete().catch(() => undefined), 12_000);
    timer.unref();
  });
}

async function sendInviteLog(message: Message, invite: NexTechInviteRuntimeInvite, blockedCode: string) {
  const guild = message.guild;
  if (!guild) return;
  const channelId = invite.alertChannelId ?? invite.logChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;

  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (me && "permissionsFor" in channel) {
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xffd500)
    .setTitle("Convite externo bloqueado")
    .setDescription([
      `**Usuário:** ${message.author.tag} (${message.author.id})`,
      `**Canal:** <#${message.channelId}>`,
      `**Convite bloqueado:** ${blockedCode}`,
      `**Convite oficial:** ${invite.inviteUrl ?? invite.code}`
    ].join("\n"))
    .setTimestamp();

  await channel.send({ allowedMentions: { parse: [] }, embeds: [embed] });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
