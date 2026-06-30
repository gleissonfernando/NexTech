import {
  AuditLogEvent,
  ChannelType,
  PermissionFlagsBits,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceState
} from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotContext } from "../types";
import { getRuntimeModuleAuthorization } from "./runtimeModuleGuard";

type AntiDisconnectConfig = {
  allowedRoleIds: string[];
  cooldownSeconds: number;
  enabled: boolean;
  logChannelId: string | null;
  protectedRoleIds: string[];
  reconnectDelayMs: number;
};

const MODULE_ID = "anti-disconnect";
const reconnectCooldown = new Map<string, number>();

export async function handleAntiDisconnectVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  if (!oldState.guild || oldState.member?.user.bot) return;
  if (!oldState.channel || newState.channel) return;

  const botId = currentRuntimeBotId();
  if (!botId) return;

  const authorization = await getRuntimeModuleAuthorization(context, oldState.guild.id, MODULE_ID);
  if (!authorization.allowed || authorization.botId !== botId) return;

  const config = await readAntiDisconnectConfig(context, botId, oldState.guild.id);
  if (!config.enabled) return;

  const member = oldState.member;
  if (!member || !isMemberProtected(member, config)) return;

  const cooldownKey = `${botId}:${oldState.guild.id}:${member.id}`;
  const lastReconnect = reconnectCooldown.get(cooldownKey) ?? 0;
  if (Date.now() - lastReconnect < config.cooldownSeconds * 1000) return;

  const audit = await findRecentDisconnectExecutor(oldState);
  if (!audit.executorId) {
    if (audit.reason) {
      await writeAntiDisconnectLog(context, oldState.guild.id, config, "anti_disconnect.audit_failed", `Anti Disconnect nao conseguiu ler o audit log para ${member.user.tag}: ${audit.reason}.`, { botId, channelId: oldState.channel.id, reason: audit.reason, userId: member.id }, member.id);
    }
    return;
  }
  if (audit.executorId === member.id || audit.executorId === oldState.client.user?.id) return;

  const executorMember = await oldState.guild.members.fetch(audit.executorId).catch(() => null);
  if (executorHasSystemPermission(executorMember, config)) return;

  reconnectCooldown.set(cooldownKey, Date.now());
  setTimeout(() => {
    void reconnectMember(oldState, oldState.channel!, member, config, context, botId, audit.executorId);
  }, config.reconnectDelayMs);
}

async function readAntiDisconnectConfig(context: BotContext, botId: string, guildId: string): Promise<AntiDisconnectConfig> {
  const config: Record<string, unknown> = await context.api.getBotGuildConfig(botId, guildId)
    .then((guildConfig) => guildConfig.modules?.[MODULE_ID] ?? {})
    .catch(() => ({}));

  return {
    allowedRoleIds: readIdArray(config.allowedRoleIds),
    cooldownSeconds: boundedNumber(config.cooldownSeconds, 5, 1, 60),
    enabled: config.enabled === true,
    logChannelId: readOptionalId(config.logChannelId),
    protectedRoleIds: readIdArray(config.protectedRoleIds),
    reconnectDelayMs: boundedNumber(config.reconnectDelayMs, 800, 250, 5000)
  };
}

async function findRecentDisconnectExecutor(oldState: VoiceState) {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await sleep(500);
    }

    const logs = await oldState.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberDisconnect }).catch((error) => {
      lastError = readError(error);
      return null;
    });
    const entry = logs?.entries.find((item) => Date.now() - item.createdTimestamp < 10_000);
    if (entry?.executor) {
      return { executorId: entry.executor.id, reason: null };
    }
  }

  return { executorId: null, reason: lastError };
}

function isMemberProtected(member: GuildMember, config: AntiDisconnectConfig) {
  if (!config.protectedRoleIds.length) return true;
  return config.protectedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function executorHasSystemPermission(member: GuildMember | null, config: AntiDisconnectConfig) {
  if (!member) return false;
  if (member.guild.ownerId === member.id) return true;
  return config.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function reconnectMember(
  oldState: VoiceState,
  channel: VoiceBasedChannel,
  member: GuildMember,
  config: AntiDisconnectConfig,
  context: BotContext,
  botId: string,
  executorId: string
) {
  const freshMember = await oldState.guild.members.fetch(member.id).catch(() => null);
  if (!freshMember || freshMember.voice.channelId) return;

  const botMember = oldState.guild.members.me ?? await oldState.guild.members.fetchMe().catch(() => null);
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.MoveMembers)) {
    await writeAntiDisconnectLog(context, oldState.guild.id, config, "anti_disconnect.permission_failed", "Anti Disconnect sem permissao para conectar ou mover membros.", { botId, channelId: channel.id, executorId, userId: member.id }, member.id);
    return;
  }

  try {
    await freshMember.voice.setChannel(channel, "Anti Disconnect: reconexao automatica apos disconnect indevido.");
    await writeAntiDisconnectLog(context, oldState.guild.id, config, "anti_disconnect.reconnected", `Anti Disconnect reconectou ${freshMember.user.tag} apos remocao indevida.`, { botId, channelId: channel.id, executorId, userId: member.id }, member.id);
  } catch (error) {
    await writeAntiDisconnectLog(context, oldState.guild.id, config, "anti_disconnect.failed", `Anti Disconnect falhou ao reconectar ${freshMember.user.tag}: ${readError(error)}.`, { botId, channelId: channel.id, executorId, userId: member.id }, member.id);
  }
}

async function writeAntiDisconnectLog(context: BotContext, guildId: string, config: AntiDisconnectConfig, type: string, message: string, metadata: Record<string, unknown>, userId?: string | null) {
  await context.api.postLog({ botId: currentRuntimeBotId(), guildId, message, metadata, type, userId: userId ?? null }).catch((error) => {
    console.warn("[anti-disconnect] falha ao registrar log:", readError(error));
  });

  if (!config.logChannelId) return;
  const channel = await context.client.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel || !("send" in channel)) return;
  if ("type" in channel && channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return;
  await channel.send(message).catch(() => null);
}

function readIdArray(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^\d{5,32}$/.test(item)))] : [];
}

function readOptionalId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
