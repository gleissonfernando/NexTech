import { AuditLogEvent, Events, type Client, type GuildMember, type PartialGuildMember } from "discord.js";
import { handleGuildMemberAdd } from "../events/guildMemberAdd";
import { handleGuildMemberRemove } from "../events/guildMemberRemove";
import { handleGuildMemberUpdate } from "../events/guildMemberUpdate";
import { handleInteractionCreate } from "../events/interactionCreate";
import { handleMessageCreate } from "../events/messageCreate";
import { handleMessageDelete } from "../events/messageDelete";
import { logMessageBulkDelete } from "../services/logService";
import { handleMessageUpdate } from "../events/messageUpdate";
import { handlePresenceEvent } from "../events/presenceUpdate";
import { handleReady } from "../events/ready";
import { env, isBotModuleEnabled } from "../config/env";
import { isLinkAntiSpamEnabled } from "../services/linkAntiSpamService";
import { isMaintenanceModeActive } from "../services/maintenanceService";
import { handleApplicationEmojiGuildCreate, handleApplicationEmojiGuildDelete, handleApplicationEmojiGuildUpdate } from "../services/applicationEmojiSyncService";
import { clearSafeBotSetupCache, ensureSafeBotSetup, isSelfBotModuleEnabled } from "../services/safeBotService";
import { handleSelfBotProtectionGuildMutation } from "../services/selfBotProtectionService";
import { handleAutoUnmuteVoiceStateUpdate } from "../services/autoUnmuteService";
import { handleAntiDisconnectVoiceStateUpdate } from "../services/antiDisconnectService";
import { handleAntiAbuseVoiceStateUpdate } from "../services/antiAbuseService";
import { handleVoiceRecorderVoiceStateUpdate } from "../services/voiceRecorderService";
import { handleMusicVoiceStateUpdate } from "../music/musicService";
import { handleTemporaryCallChannelDelete, handleTemporaryVoiceStateUpdate } from "../services/temporaryVoiceService";
import { handleVoiceLogStateUpdate } from "../services/voiceLogService";
import type { BotContext } from "../types";
import { handleAntiBanDetection, recoverDeletedProtectedRole, recoverMemberProtectedRoles, recoverUpdatedProtectedRole } from "../services/antiBanService";

export function registerEvents(client: Client, context: BotContext) {
  const managedRuntimeBot = Boolean(env.DASHBOARD_BOT_ID.trim());

  client.on(Events.Error, (error) => {
    console.error("[discord] erro no client:", error);
  });
  client.on(Events.Warn, (message) => {
    console.warn("[discord] aviso:", message);
  });
  client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn(`[discord] shard ${shardId} desconectado: code=${event.code} reason=${event.reason || "sem motivo"}`);
    context.socket.emitStatus(client, false);
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    console.warn(`[discord] shard ${shardId} reconectando ao gateway.`);
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`[discord] shard ${shardId} reconectado; eventos reproduzidos=${replayedEvents}.`);
    context.socket.emitStatus(client, true);
  });
  client.once(Events.ClientReady, (readyClient) => runEvent("ready", () => handleReady(readyClient, context)));
  client.on(Events.InteractionCreate, (interaction) => runEvent("interactionCreate", () => handleInteractionCreate(interaction, context)));
  client.on(Events.UserUpdate, (_oldUser, newUser) => {
    if (client.user && newUser.id === client.user.id) {
      context.socket.emitStatus(client, true);
    }
  });
  client.on(Events.GuildCreate, (guild) => {
    runEvent("guildCreate", () => ensureSafeBotSetup(guild, context));
  });

  if (env.BOT_MEMBER_EVENTS_ENABLED && (managedRuntimeBot || ["welcome", "leave", "roles", "logs", "fivem-fac", "account-age-security", "safe-bot", "anti-ban"].some(isBotModuleEnabled))) {
    client.on(Events.GuildMemberAdd, (member) => {
      runEvent("guildMemberAdd", async () => {
        const resolved = await resolveMember(member);
        if (resolved) {
          await handleGuildMemberAdd(resolved, context);
        }
      });
    });
    client.on(Events.GuildMemberRemove, (member) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildMemberRemove", async () => {
        await handleGuildMemberRemove(member, context);
        if (managedRuntimeBot || isBotModuleEnabled("anti-ban")) {
          await handleAntiBanDetection(context, { actionType: "kick", auditType: AuditLogEvent.MemberKick, guild: member.guild, targetId: member.id });
        }
      });
    });
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildMemberUpdate", async () => {
        const [oldResolved, newResolved] = await Promise.all([resolveMember(oldMember), resolveMember(newMember)]);
        if (oldResolved && newResolved) {
          await handleGuildMemberUpdate(oldResolved, newResolved, context);
          if (managedRuntimeBot || isBotModuleEnabled("anti-ban")) {
            const removedRoleIds = oldResolved.roles.cache.filter((role) => !newResolved.roles.cache.has(role.id)).map((role) => role.id);
            const addedRoleIds = newResolved.roles.cache.filter((role) => !oldResolved.roles.cache.has(role.id)).map((role) => role.id);
            const rolesChanged = removedRoleIds.length > 0 || addedRoleIds.length > 0;
            await handleAntiBanDetection(context, {
              actionType: rolesChanged ? "member_role_update" : "member_update",
              auditType: rolesChanged ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate,
              guild: newResolved.guild,
              targetId: newResolved.id,
              affectedRoleIds: [...removedRoleIds, ...addedRoleIds],
              recovery: removedRoleIds.length ? (config) => recoverMemberProtectedRoles(newResolved, removedRoleIds, config) : undefined
            });
          }
        }
      });
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("anti-ban")) {
    client.on(Events.GuildBanAdd, (ban) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildBanAdd.antiBan", () => handleAntiBanDetection(context, {
        actionType: "ban",
        auditType: AuditLogEvent.MemberBanAdd,
        guild: ban.guild,
        targetId: ban.user.id,
        recovery: async (config) => {
          if (config.autoRecovery !== "unban") return null;
          await ban.guild.members.unban(ban.user.id, "Recuperação automática do Anti Ban");
          return "usuário desbanido automaticamente";
        }
      }));
    });
    client.on(Events.ChannelUpdate, (_oldChannel, newChannel) => {
      if (isMaintenanceModeActive() || !("guild" in newChannel)) return;
      runEvent("channelUpdate.antiBan", () => handleAntiBanDetection(context, { actionType: "channel_update", auditType: AuditLogEvent.ChannelUpdate, guild: newChannel.guild, targetId: newChannel.id }));
    });
    client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildRoleUpdate.antiBan", () => handleAntiBanDetection(context, {
        actionType: "role_update",
        auditType: AuditLogEvent.RoleUpdate,
        guild: newRole.guild,
        targetId: newRole.id,
        affectedRoleIds: [newRole.id],
        recovery: (config) => recoverUpdatedProtectedRole(oldRole, newRole, config)
      }));
    });
    client.on(Events.GuildUpdate, (_oldGuild, newGuild) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildUpdate.antiBan", () => handleAntiBanDetection(context, { actionType: "guild_update", auditType: AuditLogEvent.GuildUpdate, guild: newGuild, targetId: newGuild.id }));
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("logs") || isSelfBotModuleEnabled()) {
    client.on(Events.MessageDelete, (message) => {
      if (isMaintenanceModeActive()) return;
      runEvent("messageDelete", () => handleMessageDelete(message, context));
    });
    client.on(Events.MessageBulkDelete, (messages) => {
      if (isMaintenanceModeActive() || !isBotModuleEnabled("logs")) return;
      runEvent("messageBulkDelete.logs", () => logMessageBulkDelete(context, messages));
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("logs") || (isBotModuleEnabled("image-anti-spam") && !isSelfBotModuleEnabled())) {
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
      if (isMaintenanceModeActive()) return;
      runEvent("messageUpdate", () => handleMessageUpdate(oldMessage, newMessage, context));
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("music") || isBotModuleEnabled("temporary-voice") || isBotModuleEnabled("image-anti-spam") || isLinkAntiSpamEnabled() || isSelfBotModuleEnabled()) {
    client.on(Events.MessageCreate, (message) => runEvent("messageCreate", () => handleMessageCreate(message, context)));
  }

  if (managedRuntimeBot || isSelfBotModuleEnabled() || isBotModuleEnabled("anti-ban") || isBotModuleEnabled("temporary-voice")) {
    client.on(Events.ChannelDelete, (channel) => {
      if (isMaintenanceModeActive()) return;
      if ("guild" in channel) {
        if (managedRuntimeBot || isBotModuleEnabled("temporary-voice")) {
          runEvent("channelDelete.temporaryVoice", () => handleTemporaryCallChannelDelete(channel, context));
        }
        if (managedRuntimeBot || isBotModuleEnabled("anti-ban")) {
          runEvent("channelDelete.antiBan", () => handleAntiBanDetection(context, { actionType: "channel_delete", auditType: AuditLogEvent.ChannelDelete, guild: channel.guild, targetId: channel.id }));
        }
        if (managedRuntimeBot || isSelfBotModuleEnabled()) {
          clearSafeBotSetupCache(channel.guild.id);
          runEvent("channelDelete.ensureSafeBotSetup", () => ensureSafeBotSetup(channel.guild, context));
        }
      }
    });
    client.on(Events.ChannelCreate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if (!(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if ("guild" in channel) {
        runEvent("channelCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(channel.guild, context, "channel_create", channel.id));
      }
    });
    client.on(Events.GuildRoleCreate, (role) => {
      if (isMaintenanceModeActive()) return;
      if (!(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      runEvent("guildRoleCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(role.guild, context, "role_create", null));
    });
    client.on(Events.GuildRoleDelete, (role) => {
      if (isMaintenanceModeActive()) return;
      if (managedRuntimeBot || isBotModuleEnabled("anti-ban")) {
        runEvent("guildRoleDelete.antiBan", () => handleAntiBanDetection(context, {
          actionType: "role_delete",
          auditType: AuditLogEvent.RoleDelete,
          guild: role.guild,
          targetId: role.id,
          affectedRoleIds: [role.id],
          recovery: (config) => recoverDeletedProtectedRole(role, config)
        }));
      }
      if (managedRuntimeBot || isSelfBotModuleEnabled()) {
        clearSafeBotSetupCache(role.guild.id);
        runEvent("guildRoleDelete.ensureSafeBotSetup", () => ensureSafeBotSetup(role.guild, context));
      }
    });
    client.on(Events.WebhooksUpdate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if (!(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if ("guild" in channel) {
        runEvent("webhooksUpdate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(channel.guild, context, "webhook_create", channel.id));
      }
    });
  }

  if (env.BOT_PRESENCE_MONITOR_ENABLED && isBotModuleEnabled("live")) {
    client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
      if (isMaintenanceModeActive()) return;
      runEvent("presenceUpdate", () => handlePresenceEvent(oldPresence, newPresence, context));
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("music") || isBotModuleEnabled("voice-recorder") || isBotModuleEnabled("anti-abuse") || isBotModuleEnabled("anti-disconnect") || isBotModuleEnabled("auto-unmute") || isBotModuleEnabled("temporary-voice") || isBotModuleEnabled("logs")) {
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (isMaintenanceModeActive()) return;
      if (managedRuntimeBot || isBotModuleEnabled("anti-abuse")) {
        runEvent("voiceStateUpdate.antiAbuse", () => handleAntiAbuseVoiceStateUpdate(oldState, newState, context));
      }
      if (isBotModuleEnabled("voice-recorder")) {
        runEvent("voiceStateUpdate.voiceRecorder", () => handleVoiceRecorderVoiceStateUpdate(oldState, newState, context));
      }
      if (isBotModuleEnabled("music")) {
        handleMusicVoiceStateUpdate(oldState, newState, context);
      }
      if (isBotModuleEnabled("auto-unmute")) {
        runEvent("voiceStateUpdate.autoUnmute", () => handleAutoUnmuteVoiceStateUpdate(oldState, newState, context));
      }
      if (managedRuntimeBot || isBotModuleEnabled("anti-disconnect")) {
        runEvent("voiceStateUpdate.antiDisconnect", () => handleAntiDisconnectVoiceStateUpdate(oldState, newState, context));
      }
      if (isBotModuleEnabled("temporary-voice")) {
        runEvent("voiceStateUpdate.temporaryVoice", () => handleTemporaryVoiceStateUpdate(oldState, newState, context));
      }
      if (isBotModuleEnabled("logs")) {
        runEvent("voiceStateUpdate.logs", () => handleVoiceLogStateUpdate(oldState, newState, context));
      }
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("emoji-cloner")) {
    client.on(Events.GuildEmojiCreate, (emoji) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildEmojiCreate.applicationSync", () => handleApplicationEmojiGuildCreate(emoji, context));
    });
    client.on(Events.GuildEmojiUpdate, (oldEmoji, newEmoji) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildEmojiUpdate.applicationSync", () => handleApplicationEmojiGuildUpdate(oldEmoji, newEmoji, context));
    });
    client.on(Events.GuildEmojiDelete, (emoji) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildEmojiDelete.applicationSync", () => handleApplicationEmojiGuildDelete(emoji, context));
    });
  }
}

function runEvent(name: string, handler: () => Promise<unknown>) {
  void handler().catch((error) => {
    console.error(`[event:${name}] falha capturada:`, error instanceof Error ? error.stack ?? error.message : error);
  });
}

async function resolveMember(member: GuildMember | PartialGuildMember) {
  if (!member.partial) {
    return member;
  }

  return member.fetch().catch(() => null);
}
