import {
  ChannelType,
  PermissionFlagsBits,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceState
} from "discord.js";
import { currentRuntimeBotId } from "../config/env";
import type { BotContext } from "../types";
import { getRuntimeModuleAuthorization } from "./runtimeModuleGuard";

type AutoUnmuteConfig = {
  antiSpamSeconds: number;
  delaySeconds: number;
  enabled: boolean;
  requiredRoleId: string | null;
  voiceChannelId: string | null;
};

const MODULE_ID = "auto-unmute";
const DEFAULT_ANTI_SPAM_SECONDS = 10;
const processedUsers = new Map<string, number>();
const configWarningLogs = new Map<string, number>();

export async function handleAutoUnmuteVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  if (!newState.guild || newState.member?.user.bot) {
    return;
  }

  if (!newState.channelId || oldState.channelId === newState.channelId) {
    return;
  }

  const botId = currentRuntimeBotId();

  if (!botId) {
    return;
  }

  const authorization = await getRuntimeModuleAuthorization(context, newState.guild.id, MODULE_ID);

  if (!authorization.allowed || authorization.botId !== botId) {
    return;
  }

  const config = await readAutoUnmuteConfig(context, botId, newState.guild.id);

  if (!config.enabled) {
    return;
  }

  if (config.voiceChannelId && config.voiceChannelId !== newState.channelId) {
    return;
  }

  if (!newState.serverMute) {
    return;
  }

  const antiSpamKey = `${botId}:${newState.guild.id}:${newState.id}`;
  const antiSpamMs = config.antiSpamSeconds * 1000;
  const lastProcessedAt = processedUsers.get(antiSpamKey) ?? 0;

  if (Date.now() - lastProcessedAt < antiSpamMs) {
    return;
  }

  processedUsers.set(antiSpamKey, Date.now());

  if (config.delaySeconds > 0) {
    await wait(config.delaySeconds * 1000);
  }

  const member = await newState.guild.members.fetch(newState.id).catch(() => null);

  if (!member || !member.voice.channelId || (config.voiceChannelId && member.voice.channelId !== config.voiceChannelId) || !member.voice.serverMute) {
    return;
  }

  if (!(await validateConfiguredRole(context, member, config))) {
    return;
  }

  const channel = await resolveConfiguredVoiceChannel(context, member, config);

  if (!channel) {
    return;
  }

  const permissionError = await validateBotPermissions(member, channel);

  if (permissionError) {
    await writeAutoUnmuteLog(context, member.guild.id, "auto_unmute.permission_failed", permissionError, {
      botId,
      channelId: channel.id,
      userId: member.id
    });
    return;
  }

  try {
    await member.voice.setMute(false, config.voiceChannelId ? "Auto Desmutar: usuario entrou no canal configurado." : "Auto Desmutar: usuario entrou em canal de voz do servidor.");
    await writeAutoUnmuteLog(
      context,
      member.guild.id,
      "auto_unmute.executed",
      `Auto Desmutar executado: usuario ${member.user.tag} foi desmutado ao entrar ${config.voiceChannelId ? `no canal #${channel.name}` : `em #${channel.name}`}.`,
      {
        botId,
        channelId: channel.id,
        userId: member.id
      },
      member.id
    );
  } catch (error) {
    await writeAutoUnmuteLog(context, member.guild.id, "auto_unmute.failed", `Auto Desmutar falhou ao remover mute de ${member.user.tag}: ${readError(error)}.`, {
      botId,
      channelId: channel.id,
      userId: member.id
    }, member.id);
  }
}

async function readAutoUnmuteConfig(context: BotContext, botId: string, guildId: string): Promise<AutoUnmuteConfig> {
  const config: Record<string, unknown> = await context.api.getBotGuildConfig(botId, guildId)
    .then((guildConfig) => guildConfig.modules?.[MODULE_ID] ?? {})
    .catch(() => ({}));

  return {
    antiSpamSeconds: boundedNumber(config.antiSpamSeconds, DEFAULT_ANTI_SPAM_SECONDS, 1, 300),
    delaySeconds: boundedNumber(config.delaySeconds, 0, 0, 60),
    enabled: config.enabled === true,
    requiredRoleId: readOptionalId(config.requiredRoleId),
    voiceChannelId: readOptionalId(config.voiceChannelId)
  };
}

async function validateConfiguredRole(context: BotContext, member: GuildMember, config: AutoUnmuteConfig) {
  if (!config.requiredRoleId) {
    return true;
  }

  const role = member.guild.roles.cache.get(config.requiredRoleId);

  if (!role) {
    await writeThrottledConfigLog(
      context,
      member.guild.id,
      `role:${config.requiredRoleId}`,
      "auto_unmute.role_missing",
      `Auto Desmutar pausou a acao: o cargo configurado (${config.requiredRoleId}) nao existe mais.`,
      {
        roleId: config.requiredRoleId
      }
    );
    return false;
  }

  return member.roles.cache.has(config.requiredRoleId);
}

async function resolveConfiguredVoiceChannel(context: BotContext, member: GuildMember, config: AutoUnmuteConfig) {
  if (!config.voiceChannelId) {
    const channel = member.voice.channel;
    return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice ? channel : null;
  }

  const channel = member.guild.channels.cache.get(config.voiceChannelId ?? "");

  if (channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice) {
    return channel as VoiceBasedChannel;
  }

  await writeThrottledConfigLog(
    context,
    member.guild.id,
    `channel:${config.voiceChannelId}`,
    "auto_unmute.channel_missing",
    `Auto Desmutar pausou a acao: o canal configurado (${config.voiceChannelId}) nao existe mais.`,
    {
      channelId: config.voiceChannelId
    }
  );
  return null;
}

async function validateBotPermissions(member: GuildMember, channel: VoiceBasedChannel) {
  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);

  if (!botMember) {
    return "Auto Desmutar nao conseguiu validar o bot no servidor.";
  }

  const channelPermissions = channel.permissionsFor(botMember);

  if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel) || !channelPermissions.has(PermissionFlagsBits.MuteMembers)) {
    return "Auto Desmutar sem permissao para ver o canal ou gerenciar mute de voz.";
  }

  if (member.guild.ownerId !== member.id && botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return "Auto Desmutar sem hierarquia de cargo acima do usuario.";
  }

  return null;
}

async function writeThrottledConfigLog(
  context: BotContext,
  guildId: string,
  key: string,
  type: string,
  message: string,
  metadata: Record<string, unknown>
) {
  const cacheKey = `${guildId}:${key}`;
  const lastLoggedAt = configWarningLogs.get(cacheKey) ?? 0;

  if (Date.now() - lastLoggedAt < 60_000) {
    return;
  }

  configWarningLogs.set(cacheKey, Date.now());
  await writeAutoUnmuteLog(context, guildId, type, message, metadata);
}

async function writeAutoUnmuteLog(
  context: BotContext,
  guildId: string,
  type: string,
  message: string,
  metadata: Record<string, unknown>,
  userId?: string | null
) {
  await context.api.postLog({
    botId: currentRuntimeBotId(),
    guildId,
    message,
    metadata,
    type,
    userId: userId ?? null
  }).catch((error) => {
    console.warn("[auto-unmute] falha ao registrar log:", readError(error));
  });
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readOptionalId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
