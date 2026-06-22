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

  client.once(Events.ClientReady, (readyClient) => void handleReady(readyClient, context));
  client.on(Events.InteractionCreate, (interaction) => void handleInteractionCreate(interaction, context));
  client.on(Events.UserUpdate, (_oldUser, newUser) => {
    if (client.user && newUser.id === client.user.id) {
      context.socket.emitStatus(client, true);
    }
  });
  client.on(Events.GuildCreate, (guild) => {
    void ensureSafeBotSetup(guild, context);
  });

  if (env.BOT_MEMBER_EVENTS_ENABLED && (managedRuntimeBot || ["welcome", "leave", "roles", "logs", "fivem-fac", "account-age-security", "safe-bot"].some(isBotModuleEnabled))) {
    client.on(Events.GuildMemberAdd, (member) => {
      void resolveMember(member).then((resolved) => {
        if (resolved) {
          void handleGuildMemberAdd(resolved, context);
        }
      });
    });
    client.on(Events.GuildMemberRemove, (member) => {
      if (isMaintenanceModeActive()) return;
      void handleGuildMemberRemove(member, context);
    });
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
      if (isMaintenanceModeActive()) return;
      void Promise.all([resolveMember(oldMember), resolveMember(newMember)]).then(([oldResolved, newResolved]) => {
        if (oldResolved && newResolved) {
          void handleGuildMemberUpdate(oldResolved, newResolved, context);
        }
      });
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("logs") || isSelfBotModuleEnabled()) {
    client.on(Events.MessageDelete, (message) => {
      if (isMaintenanceModeActive()) return;
      void handleMessageDelete(message, context);
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("logs") || (isBotModuleEnabled("image-anti-spam") && !isSelfBotModuleEnabled())) {
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
      if (isMaintenanceModeActive()) return;
      void handleMessageUpdate(oldMessage, newMessage, context);
    });
  }

  if (managedRuntimeBot || isBotModuleEnabled("image-anti-spam") || isLinkAntiSpamEnabled() || isSelfBotModuleEnabled()) {
    client.on(Events.MessageCreate, (message) => void handleMessageCreate(message, context));
  }

  if (managedRuntimeBot || isSelfBotModuleEnabled()) {
    client.on(Events.ChannelDelete, (channel) => {
      if (isMaintenanceModeActive()) return;
      if ("guild" in channel) {
        clearSafeBotSetupCache(channel.guild.id);
        void ensureSafeBotSetup(channel.guild, context);
      }
    });
    client.on(Events.ChannelCreate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if ("guild" in channel) {
        void handleSelfBotProtectionGuildMutation(channel.guild, context, "channel_create", channel.id);
      }
    });
    client.on(Events.GuildRoleCreate, (role) => {
      if (isMaintenanceModeActive()) return;
      void handleSelfBotProtectionGuildMutation(role.guild, context, "role_create", null);
    });
    client.on(Events.GuildRoleDelete, (role) => {
      if (isMaintenanceModeActive()) return;
      clearSafeBotSetupCache(role.guild.id);
      void ensureSafeBotSetup(role.guild, context);
    });
    client.on(Events.WebhooksUpdate, (channel) => {
      if (isMaintenanceModeActive()) return;
      if ("guild" in channel) {
        void handleSelfBotProtectionGuildMutation(channel.guild, context, "webhook_create", channel.id);
      }
    });
  }

  if (env.BOT_PRESENCE_MONITOR_ENABLED && isBotModuleEnabled("live")) {
    client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
      if (isMaintenanceModeActive()) return;
      void handlePresenceEvent(oldPresence, newPresence, context);
    });
  }

  if (isBotModuleEnabled("voice-recorder")) {
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (isMaintenanceModeActive()) return;
      void handleVoiceRecorderVoiceStateUpdate(oldState, newState, context);
    });
  }
}

async function resolveMember(member: GuildMember | PartialGuildMember) {
  if (!member.partial) {
    return member;
  }

  return member.fetch().catch(() => null);
}
