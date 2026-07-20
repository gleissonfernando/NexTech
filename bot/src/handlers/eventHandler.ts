import { AuditLogEvent, Events, type Client, type GuildMember, type PartialGuildMember, type Presence } from "discord.js";
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
import { handleSelfBotProtectionGuildMutation, handleSelfBotProtectionMemberUpdate } from "../services/selfBotProtectionService";
import { handleAutoUnmuteVoiceStateUpdate } from "../services/autoUnmuteService";
import { handleAntiDisconnectVoiceStateUpdate } from "../services/antiDisconnectService";
import { handleAntiAbuseVoiceStateUpdate } from "../services/antiAbuseService";
import { handleTemporaryCallChannelDelete, handleTemporaryVoiceStateUpdate } from "../services/temporaryVoiceService";
import { handleVoiceLogStateUpdate } from "../services/voiceLogService";
import { scheduleHierarchyRefresh, scheduleHierarchyRefreshForRoles } from "../services/fivemHierarchyService";
import { cacheGuildSystemEmojis, handleSystemEmojiGuildMutation } from "../services/systemEmojiService";
import type { BotContext } from "../types";
import { handleAntiBanDetection, recoverDeletedProtectedRole, recoverMemberProtectedRoles, recoverUpdatedProtectedRole } from "../services/antiBanService";
import { BoundedTaskQueue } from "../services/boundedTaskQueue";

const eventQueue = new BoundedTaskQueue(env.BOT_EVENT_CONCURRENCY, env.BOT_EVENT_QUEUE_MAX, (name, error) => {
  console.error(JSON.stringify({
    action: name,
    at: new Date().toISOString(),
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    level: "error",
    module: "gateway-events",
    queue: eventQueue.snapshot()
  }));
});
const PRESENCE_COALESCE_MS = 250;
const pendingPresenceEvents = new Map<string, { oldPresence: Presence | null; newPresence: Presence; timer: NodeJS.Timeout }>();

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
  client.on(Events.InteractionCreate, (interaction) => {
    const accepted = runEvent("interactionCreate", () => handleInteractionCreate(interaction, context));
    if (!accepted && interaction.isRepliable()) {
      void interaction.reply({ content: "O sistema está processando muitas solicitacoes. Tente novamente em instantes.", ephemeral: true }).catch(() => undefined);
    }
  });
  client.on(Events.UserUpdate, (_oldUser, newUser) => {
    if (client.user && newUser.id === client.user.id) {
      context.socket.emitStatus(client, true);
    }
  });
  client.on(Events.GuildCreate, (guild) => {
    runEvent("guildCreate", async () => {
      await cacheGuildSystemEmojis(guild, context);
      await ensureSafeBotSetup(guild, context);
      if (isBotModuleEnabled("fivem-hierarchy")) scheduleHierarchyRefresh(guild, context);
    });
  });

  client.on(Events.GuildEmojiCreate, (emoji) => {
    if (isMaintenanceModeActive()) return;
    runEvent("guildEmojiCreate.systemEmojis", () => handleSystemEmojiGuildMutation(emoji, context));
  });
  client.on(Events.GuildEmojiUpdate, (_oldEmoji, newEmoji) => {
    if (isMaintenanceModeActive()) return;
    runEvent("guildEmojiUpdate.systemEmojis", () => handleSystemEmojiGuildMutation(newEmoji, context));
  });
  client.on(Events.GuildEmojiDelete, (emoji) => {
    if (isMaintenanceModeActive()) return;
    runEvent("guildEmojiDelete.systemEmojis", () => handleSystemEmojiGuildMutation(emoji, context));
  });

  const memberEventsEnabled = env.BOT_MEMBER_EVENTS_ENABLED
    || managedRuntimeBot
    || isBotModuleEnabled("fivem-hierarchy")
    || isSelfBotModuleEnabled();

  if (memberEventsEnabled && (managedRuntimeBot || ["welcome", "leave", "roles", "logs", "fivem-fac", "fivem-hierarchy", "account-age-security", "safe-bot", "anti-ban"].some(isBotModuleEnabled))) {
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
          if (managedRuntimeBot || isSelfBotModuleEnabled()) {
            await handleSelfBotProtectionMemberUpdate(oldResolved, newResolved, context);
          }
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

  if (isBotModuleEnabled("fivem-hierarchy")) {
    client.on(Events.GuildRoleUpdate, (_oldRole, newRole) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildRoleUpdate.fivemHierarchy", async () => {
        scheduleHierarchyRefreshForRoles(newRole.guild, context, [newRole.id]);
      });
    });
    client.on(Events.GuildRoleDelete, (role) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildRoleDelete.fivemHierarchy", async () => {
        scheduleHierarchyRefreshForRoles(role.guild, context, [role.id], { deleted: true });
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

  if (managedRuntimeBot || isBotModuleEnabled("logs") || isBotModuleEnabled("temporary-voice") || isBotModuleEnabled("tickets") || isSelfBotModuleEnabled()) {
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

  if (managedRuntimeBot || shouldHandleMessageCreateEvents()) {
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
          runEvent("channelDelete.selfBotMutation", () => handleSelfBotProtectionGuildMutation(channel.guild, context, "channel_delete", channel.id));
          clearSafeBotSetupCache(channel.guild.id);
          runEvent("channelDelete.ensureSafeBotSetup", () => ensureSafeBotSetup(channel.guild, context));
        }
      }
    });
    client.on(Events.ChannelCreate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if (!(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if ("guild" in channel) {
        runEvent("channelCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(channel.guild, context, "channel_create", channel.id, () => channel.delete("SafeBot: criação não autorizada")));
      }
    });
    client.on(Events.GuildRoleCreate, (role) => {
      if (isMaintenanceModeActive()) return;
      if (!(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      runEvent("guildRoleCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(role.guild, context, "role_create", null, () => role.delete("SafeBot: criação não autorizada")));
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
        runEvent("guildRoleDelete.selfBotMutation", () => handleSelfBotProtectionGuildMutation(role.guild, context, "role_delete"));
        clearSafeBotSetupCache(role.guild.id);
        runEvent("guildRoleDelete.ensureSafeBotSetup", () => ensureSafeBotSetup(role.guild, context));
      }
    });
    client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
      if (isMaintenanceModeActive() || !(managedRuntimeBot || isSelfBotModuleEnabled()) || !("guild" in newChannel)) return;
      runEvent("channelUpdate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(newChannel.guild, context, "channel_update", newChannel.id, async () => {
        if ("edit" in newChannel && "name" in oldChannel) await newChannel.edit({ name: oldChannel.name, reason: "SafeBot: rollback" });
      }));
    });
    client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
      if (isMaintenanceModeActive() || !(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      runEvent("guildRoleUpdate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(newRole.guild, context, "role_update", null, () => newRole.edit({ name: oldRole.name, permissions: oldRole.permissions, color: oldRole.color, hoist: oldRole.hoist, mentionable: oldRole.mentionable, reason: "SafeBot: rollback" })));
    });
    client.on(Events.WebhooksUpdate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if (!(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if ("guild" in channel) {
        runEvent("webhooksUpdate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(channel.guild, context, "webhook_create", channel.id));
      }
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("live") || isBotModuleEnabled("auto-activity-clock")) {
    client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
      if (isMaintenanceModeActive()) return;
      schedulePresenceEvent(oldPresence, newPresence, context);
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("music") || isBotModuleEnabled("voice-recorder") || isBotModuleEnabled("anti-abuse") || isBotModuleEnabled("anti-disconnect") || isBotModuleEnabled("auto-unmute") || isBotModuleEnabled("temporary-voice") || isBotModuleEnabled("logs")) {
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (isMaintenanceModeActive()) return;
      if (managedRuntimeBot || isBotModuleEnabled("anti-abuse")) {
        runEvent("voiceStateUpdate.antiAbuse", () => handleAntiAbuseVoiceStateUpdate(oldState, newState, context));
      }
      if (isBotModuleEnabled("voice-recorder")) {
        runEvent("voiceStateUpdate.voiceRecorder", async () => {
          const { handleVoiceRecorderVoiceStateUpdate } = await import("../services/voiceRecorderService.js");
          await handleVoiceRecorderVoiceStateUpdate(oldState, newState, context);
        });
      }
      if (isBotModuleEnabled("music")) {
        void import("../music/musicService.js")
          .then(({ handleMusicVoiceStateUpdate }) => handleMusicVoiceStateUpdate(oldState, newState, context))
          .catch((error) => console.warn("[music] falha ao carregar handler de voz:", error instanceof Error ? error.message : error));
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

  if (managedRuntimeBot || isBotModuleEnabled("emoji-cloner") || isSelfBotModuleEnabled()) {
    client.on(Events.GuildEmojiCreate, (emoji) => {
      if (isMaintenanceModeActive()) return;
      if (managedRuntimeBot || isBotModuleEnabled("emoji-cloner")) runEvent("guildEmojiCreate.applicationSync", () => handleApplicationEmojiGuildCreate(emoji, context));
      if (managedRuntimeBot || isSelfBotModuleEnabled()) runEvent("guildEmojiCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(emoji.guild, context, "emoji_create", null, () => emoji.delete("SafeBot: criação não autorizada")));
    });
    client.on(Events.GuildEmojiUpdate, (oldEmoji, newEmoji) => {
      if (isMaintenanceModeActive()) return;
      if (managedRuntimeBot || isBotModuleEnabled("emoji-cloner")) runEvent("guildEmojiUpdate.applicationSync", () => handleApplicationEmojiGuildUpdate(oldEmoji, newEmoji, context));
      if (managedRuntimeBot || isSelfBotModuleEnabled()) runEvent("guildEmojiUpdate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(newEmoji.guild, context, "emoji_update", null, () => newEmoji.edit({ name: oldEmoji.name ?? "emoji", reason: "SafeBot: rollback" })));
    });
    client.on(Events.GuildEmojiDelete, (emoji) => {
      if (isMaintenanceModeActive()) return;
      if (managedRuntimeBot || isBotModuleEnabled("emoji-cloner")) runEvent("guildEmojiDelete.applicationSync", () => handleApplicationEmojiGuildDelete(emoji, context));
      if (managedRuntimeBot || isSelfBotModuleEnabled()) runEvent("guildEmojiDelete.selfBotMutation", () => handleSelfBotProtectionGuildMutation(emoji.guild, context, "emoji_delete", null, () => emoji.guild.emojis.create({ attachment: emoji.imageURL(), name: emoji.name ?? "emoji", reason: "SafeBot: restauração" })));
    });
    client.on(Events.GuildStickerCreate, (sticker) => {
      if (isMaintenanceModeActive() || !(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if (!sticker.guild) return;
      runEvent("guildStickerCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(sticker.guild!, context, "sticker_create", null, () => sticker.delete()));
    });
    client.on(Events.GuildStickerUpdate, (oldSticker, newSticker) => {
      if (isMaintenanceModeActive() || !(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if (!newSticker.guild) return;
      runEvent("guildStickerUpdate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(newSticker.guild!, context, "sticker_update", null, () => newSticker.edit({ name: oldSticker.name, description: oldSticker.description ?? undefined, tags: oldSticker.tags ?? undefined })));
    });
    client.on(Events.GuildStickerDelete, (sticker) => {
      if (isMaintenanceModeActive() || !(managedRuntimeBot || isSelfBotModuleEnabled())) return;
      if (!sticker.guild) return;
      runEvent("guildStickerDelete.selfBotMutation", () => handleSelfBotProtectionGuildMutation(sticker.guild!, context, "sticker_delete"));
    });
  }
}

export function stopEventProcessing(timeoutMs = 10_000) {
  return eventQueue.stopAndDrain(timeoutMs);
}

function runEvent(name: string, handler: () => Promise<unknown>) {
  const accepted = eventQueue.enqueue(name, handler, name === "interactionCreate" || name === "ready");
  if (!accepted) {
    console.warn(`[event:${name}] descartado para proteger o processo contra sobrecarga.`);
  }
  return accepted;
}

function schedulePresenceEvent(oldPresence: Presence | null, newPresence: Presence, context: BotContext) {
  const guildId = newPresence.guild?.id ?? oldPresence?.guild?.id ?? "unknown";
  const key = `${guildId}:${newPresence.userId}`;
  const current = pendingPresenceEvents.get(key);
  if (current) clearTimeout(current.timer);

  const timer = setTimeout(() => {
    const event = pendingPresenceEvents.get(key);
    if (!event) return;
    pendingPresenceEvents.delete(key);
    runEvent("presenceUpdate", () => handlePresenceEvent(event.oldPresence, event.newPresence, context));
  }, PRESENCE_COALESCE_MS);

  timer.unref();
  pendingPresenceEvents.set(key, {
    oldPresence: current?.oldPresence ?? oldPresence,
    newPresence,
    timer
  });
}

function shouldHandleMessageCreateEvents() {
  return [
    "courses",
    "fivem-goals",
    "manual-payments",
    "music",
    "police-hidden-channel",
    "police-iab",
    "police-promotions",
    "police-subpoenas",
    "temporary-voice",
    "logs"
  ].some(isBotModuleEnabled)
    || isBotModuleEnabled("image-anti-spam")
    || isLinkAntiSpamEnabled()
    || isSelfBotModuleEnabled();
}

async function resolveMember(member: GuildMember | PartialGuildMember) {
  if (!member.partial) {
    return member;
  }

  return member.fetch().catch(() => null);
}
