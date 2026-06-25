import { Events, type Client, type GuildMember, type PartialGuildMember } from "discord.js";
import { handleGuildMemberAdd } from "../events/guildMemberAdd";
import { handleGuildMemberRemove } from "../events/guildMemberRemove";
import { handleGuildMemberUpdate } from "../events/guildMemberUpdate";
import { handleInteractionCreate } from "../events/interactionCreate";
import { handleMessageCreate } from "../events/messageCreate";
import { handleMessageDelete } from "../events/messageDelete";
import { handleMessageUpdate } from "../events/messageUpdate";
import { handlePresenceEvent } from "../events/presenceUpdate";
import { handleReady } from "../events/ready";
import { env, isBotModuleEnabled } from "../config/env";
import { isLinkAntiSpamEnabled } from "../services/linkAntiSpamService";
import { isMaintenanceModeActive } from "../services/maintenanceService";
import { clearSafeBotSetupCache, ensureSafeBotSetup, isSelfBotModuleEnabled } from "../services/safeBotService";
import { handleSelfBotProtectionGuildMutation } from "../services/selfBotProtectionService";
import { handleVoiceRecorderVoiceStateUpdate } from "../services/voiceRecorderService";
import type { BotContext } from "../types";

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

  if (env.BOT_MEMBER_EVENTS_ENABLED && (managedRuntimeBot || ["welcome", "leave", "roles", "logs", "fivem-fac", "account-age-security", "safe-bot"].some(isBotModuleEnabled))) {
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
      runEvent("guildMemberRemove", () => handleGuildMemberRemove(member, context));
    });
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildMemberUpdate", async () => {
        const [oldResolved, newResolved] = await Promise.all([resolveMember(oldMember), resolveMember(newMember)]);
        if (oldResolved && newResolved) {
          await handleGuildMemberUpdate(oldResolved, newResolved, context);
        }
      });
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("logs") || isSelfBotModuleEnabled()) {
    client.on(Events.MessageDelete, (message) => {
      if (isMaintenanceModeActive()) return;
      runEvent("messageDelete", () => handleMessageDelete(message, context));
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("logs") || (isBotModuleEnabled("image-anti-spam") && !isSelfBotModuleEnabled())) {
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
      if (isMaintenanceModeActive()) return;
      runEvent("messageUpdate", () => handleMessageUpdate(oldMessage, newMessage, context));
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("image-anti-spam") || isLinkAntiSpamEnabled() || isSelfBotModuleEnabled()) {
    client.on(Events.MessageCreate, (message) => runEvent("messageCreate", () => handleMessageCreate(message, context)));
  }

  if (managedRuntimeBot || isSelfBotModuleEnabled()) {
    client.on(Events.ChannelDelete, (channel) => {
      if (isMaintenanceModeActive()) return;
      if ("guild" in channel) {
        clearSafeBotSetupCache(channel.guild.id);
        runEvent("channelDelete.ensureSafeBotSetup", () => ensureSafeBotSetup(channel.guild, context));
      }
    });
    client.on(Events.ChannelCreate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if ("guild" in channel) {
        runEvent("channelCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(channel.guild, context, "channel_create", channel.id));
      }
    });
    client.on(Events.GuildRoleCreate, (role) => {
      if (isMaintenanceModeActive()) return;
      runEvent("guildRoleCreate.selfBotMutation", () => handleSelfBotProtectionGuildMutation(role.guild, context, "role_create", null));
    });
    client.on(Events.GuildRoleDelete, (role) => {
      if (isMaintenanceModeActive()) return;
      clearSafeBotSetupCache(role.guild.id);
      runEvent("guildRoleDelete.ensureSafeBotSetup", () => ensureSafeBotSetup(role.guild, context));
    });
    client.on(Events.WebhooksUpdate, (channel) => {
      if (isMaintenanceModeActive()) return;
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

  if (isBotModuleEnabled("voice-recorder")) {
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (isMaintenanceModeActive()) return;
      runEvent("voiceStateUpdate", () => handleVoiceRecorderVoiceStateUpdate(oldState, newState, context));
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
