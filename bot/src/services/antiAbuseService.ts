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

type AntiAbuseConfig = {
  allowedRoleIds: string[];
  antiDeafenAbuseEnabled: boolean;
  antiDisconnectEnabled: boolean;
  antiKickVoiceEnabled: boolean;
  antiMoveAbuseEnabled: boolean;
  antiMuteAbuseEnabled: boolean;
  autoReconnectEnabled: boolean;
  autoUnmuteEnabled: boolean;
  cooldownSeconds: number;
  enabled: boolean;
  immuneRoleIds: string[];
  logChannelId: string | null;
  masterEnabled: boolean;
  protectedRoleIds: string[];
  revertDelayMs: number;
  strictDevOverride: boolean;
};

type AbuseAction = "disconnect" | "move" | "mute" | "deafen" | "stage_suppress";

const MODULE_ID = "anti-abuse";
const actionCooldown = new Map<string, number>();

export async function handleAntiAbuseVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  const guild = newState.guild ?? oldState.guild;
  const member = newState.member ?? oldState.member;

  if (!guild || !member || member.user.bot) return;

  const botId = currentRuntimeBotId();
  if (!botId) return;

  const authorization = await getRuntimeModuleAuthorization(context, guild.id, MODULE_ID);
  if (!authorization.allowed || authorization.botId !== botId) return;

  const config = await readAntiAbuseConfig(context, botId, guild.id);
  if (!config.enabled || !config.masterEnabled || !isVictimProtected(member, config)) return;

  const action = detectAbuseAction(oldState, newState, config);
  if (!action) return;

  const cooldownKey = `${botId}:${guild.id}:${member.id}:${action}`;
  const lastActionAt = actionCooldown.get(cooldownKey) ?? 0;
  if (Date.now() - lastActionAt < config.cooldownSeconds * 1000) return;

  const audit = await findVoiceAbuseExecutor(oldState, newState, action);
  if (!audit.executorId) {
    if (audit.reason) {
      await writeAntiAbuseLog(context, guild.id, config, "anti_abuse.audit_failed", `Anti Abuse nao conseguiu ler o audit log para ${member.user.tag}: ${audit.reason}.`, {
        action,
        botId,
        channelId: oldState.channelId ?? newState.channelId,
        reason: audit.reason,
        userId: member.id
      }, member.id);
    }

    if (action === "mute" || action === "deafen" || action === "stage_suppress") {
      actionCooldown.set(cooldownKey, Date.now());
      setTimeout(() => {
        void revertAbuseAction(oldState, newState, member, null, action, config, context, botId);
      }, config.revertDelayMs);
    }

    return;
  }

  if (audit.executorId === member.id || audit.executorId === guild.client.user?.id) return;

  const executor = await guild.members.fetch(audit.executorId).catch(() => null);
  if (executorCanRunVoiceAction(executor, config)) return;

  actionCooldown.set(cooldownKey, Date.now());
  setTimeout(() => {
    void revertAbuseAction(oldState, newState, member, executor, action, config, context, botId);
  }, config.revertDelayMs);
}

async function readAntiAbuseConfig(context: BotContext, botId: string, guildId: string): Promise<AntiAbuseConfig> {
  const config: Record<string, unknown> = await context.api.getBotGuildConfig(botId, guildId)
    .then((guildConfig) => guildConfig.modules?.[MODULE_ID] ?? {})
    .catch(() => ({}));

  return {
    allowedRoleIds: readIdArray(config.allowedRoleIds),
    antiDeafenAbuseEnabled: config.antiDeafenAbuseEnabled !== false,
    antiDisconnectEnabled: config.antiDisconnectEnabled !== false,
    antiKickVoiceEnabled: config.antiKickVoiceEnabled !== false,
    antiMoveAbuseEnabled: config.antiMoveAbuseEnabled !== false,
    antiMuteAbuseEnabled: config.antiMuteAbuseEnabled !== false,
    autoReconnectEnabled: config.autoReconnectEnabled !== false,
    autoUnmuteEnabled: config.autoUnmuteEnabled !== false,
    cooldownSeconds: boundedNumber(config.cooldownSeconds, 5, 1, 60),
    enabled: config.enabled === true,
    immuneRoleIds: readIdArray(config.immuneRoleIds),
    logChannelId: readOptionalId(config.logChannelId),
    masterEnabled: config.masterEnabled !== false,
    protectedRoleIds: readIdArray(config.protectedRoleIds),
    revertDelayMs: boundedNumber(config.revertDelayMs, 600, 100, 5000),
    strictDevOverride: config.strictDevOverride !== false
  };
}

function detectAbuseAction(oldState: VoiceState, newState: VoiceState, config: AntiAbuseConfig): AbuseAction | null {
  if (oldState.channelId && !newState.channelId && (config.antiDisconnectEnabled || config.antiKickVoiceEnabled || config.autoReconnectEnabled)) {
    return "disconnect";
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId && config.antiMoveAbuseEnabled) {
    return "move";
  }

  if (!oldState.serverMute && newState.serverMute && (config.antiMuteAbuseEnabled || config.autoUnmuteEnabled)) {
    return "mute";
  }

  if (!oldState.serverDeaf && newState.serverDeaf && config.antiDeafenAbuseEnabled) {
    return "deafen";
  }

  if (!oldState.suppress && newState.suppress && config.antiMuteAbuseEnabled) {
    return "stage_suppress";
  }

  return null;
}

async function findVoiceAbuseExecutor(oldState: VoiceState, newState: VoiceState, action: AbuseAction) {
  const targetId = newState.id ?? oldState.id;
  const auditType = action === "disconnect"
    ? AuditLogEvent.MemberDisconnect
    : action === "move"
      ? AuditLogEvent.MemberMove
      : AuditLogEvent.MemberUpdate;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(500);

    const logs = await oldState.guild.fetchAuditLogs({ limit: 8, type: auditType }).catch((error) => {
      lastError = readError(error);
      return null;
    });

    const entry = logs?.entries.find((item) => {
      if (Date.now() - item.createdTimestamp > 10_000) return false;
      if (auditType !== AuditLogEvent.MemberUpdate) return true;
      const target = item.target as { id?: string } | null;
      if (target?.id !== targetId) return false;
      return memberUpdateMatchesAction(item.changes as Array<{ key?: string }> | null | undefined, action);
    });

    if (entry?.executor) {
      return { executorId: entry.executor.id, reason: null };
    }
  }

  return { executorId: null, reason: lastError };
}

function memberUpdateMatchesAction(changes: Array<{ key?: string }> | null | undefined, action: AbuseAction) {
  if (!Array.isArray(changes) || !changes.length) return true;
  const keys = changes.map((change) => String(change.key ?? "").toLowerCase());
  if (action === "mute" || action === "stage_suppress") return keys.some((key) => key.includes("mute") || key.includes("suppress"));
  if (action === "deafen") return keys.some((key) => key.includes("deaf"));
  return true;
}

function executorCanRunVoiceAction(member: GuildMember | null, config: AntiAbuseConfig) {
  if (!member) return false;
  if (member.guild.ownerId === member.id) return true;
  if (config.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId))) return true;
  if (!config.strictDevOverride && config.immuneRoleIds.some((roleId) => member.roles.cache.has(roleId))) return true;
  return false;
}

function isVictimProtected(member: GuildMember, config: AntiAbuseConfig) {
  if (!config.protectedRoleIds.length) return true;
  return config.protectedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function revertAbuseAction(
  oldState: VoiceState,
  newState: VoiceState,
  member: GuildMember,
  executor: GuildMember | null,
  action: AbuseAction,
  config: AntiAbuseConfig,
  context: BotContext,
  botId: string
) {
  const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
  if (!freshMember) return;

  try {
    if (action === "disconnect" || action === "move") {
      const channel = oldState.channel;
      if (!channel || freshMember.voice.channelId === channel.id) return;
      const permissionError = await validateMovePermissions(freshMember, channel);
      if (permissionError) {
        await writeAntiAbuseLog(context, member.guild.id, config, "anti_abuse.permission_failed", permissionError, buildMetadata(action, botId, oldState, newState, member, executor), member.id);
        return;
      }
      await freshMember.voice.setChannel(channel, `Anti Abuse: revertendo ${action}.`);
    }

    if (action === "mute" && freshMember.voice.serverMute) {
      const permissionError = await validateMutePermissions(freshMember, newState.channel ?? oldState.channel, "mute");
      if (permissionError) {
        await writeAntiAbuseLog(context, member.guild.id, config, "anti_abuse.permission_failed", permissionError, buildMetadata(action, botId, oldState, newState, member, executor), member.id);
        return;
      }
      await freshMember.voice.setMute(false, "Anti Abuse: removendo mute indevido.");
    }

    if (action === "deafen" && freshMember.voice.serverDeaf) {
      const permissionError = await validateMutePermissions(freshMember, newState.channel ?? oldState.channel, "deafen");
      if (permissionError) {
        await writeAntiAbuseLog(context, member.guild.id, config, "anti_abuse.permission_failed", permissionError, buildMetadata(action, botId, oldState, newState, member, executor), member.id);
        return;
      }
      await freshMember.voice.setDeaf(false, "Anti Abuse: removendo deafen indevido.");
    }

    if (action === "stage_suppress" && freshMember.voice.suppress) {
      await freshMember.voice.setSuppressed(false);
    }

    await writeAntiAbuseLog(context, member.guild.id, config, "anti_abuse.reverted", `Anti Abuse reverteu ${action} contra ${freshMember.user.tag}.`, buildMetadata(action, botId, oldState, newState, freshMember, executor), freshMember.id);
  } catch (error) {
    await writeAntiAbuseLog(context, member.guild.id, config, "anti_abuse.failed", `Anti Abuse falhou ao reverter ${action} contra ${freshMember.user.tag}: ${readError(error)}.`, buildMetadata(action, botId, oldState, newState, freshMember, executor), freshMember.id);
  }
}

async function validateMovePermissions(member: GuildMember, channel: VoiceBasedChannel) {
  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
  if (!botMember) return "Anti Abuse nao conseguiu validar o bot no servidor.";
  const permissions = channel.permissionsFor(botMember);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.MoveMembers)) {
    return "Anti Abuse sem permissao para ver, conectar ou mover membros no canal.";
  }
  if (member.guild.ownerId !== member.id && botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return "Anti Abuse sem hierarquia acima da vitima.";
  }
  return null;
}

async function validateMutePermissions(member: GuildMember, channel: VoiceBasedChannel | null, action: "mute" | "deafen") {
  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
  if (!botMember) return "Anti Abuse nao conseguiu validar o bot no servidor.";
  const permissions = channel ? channel.permissionsFor(botMember) : botMember.permissions;
  const required = action === "mute" ? PermissionFlagsBits.MuteMembers : PermissionFlagsBits.DeafenMembers;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(required)) {
    return action === "mute" ? "Anti Abuse sem permissao para ver o canal ou mutar/desmutar membros." : "Anti Abuse sem permissao para ver o canal ou gerenciar deafen.";
  }
  if (member.guild.ownerId !== member.id && botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return "Anti Abuse sem hierarquia acima da vitima.";
  }
  return null;
}

function buildMetadata(action: AbuseAction, botId: string, oldState: VoiceState, newState: VoiceState, member: GuildMember, executor: GuildMember | null) {
  return {
    action,
    botId,
    channelId: newState.channelId ?? oldState.channelId,
    executorId: executor?.id ?? null,
    guildId: member.guild.id,
    oldChannelId: oldState.channelId,
    newChannelId: newState.channelId,
    userId: member.id
  };
}

async function writeAntiAbuseLog(context: BotContext, guildId: string, config: AntiAbuseConfig, type: string, message: string, metadata: Record<string, unknown>, userId?: string | null) {
  await context.api.postLog({ botId: currentRuntimeBotId(), guildId, message, metadata, type, userId: userId ?? null }).catch((error) => {
    console.warn("[anti-abuse] falha ao registrar log:", readError(error));
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
