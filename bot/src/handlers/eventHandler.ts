import { Events, type Client, type GuildMember, type PartialGuildMember } from "discord.js";
import { handleGuildMemberAdd } from "../events/guildMemberAdd";
import { handleGuildMemberRemove } from "../events/guildMemberRemove";
import { handleGuildMemberUpdate } from "../events/guildMemberUpdate";
import { handleInteractionCreate } from "../events/interactionCreate";
import { handleMessageDelete } from "../events/messageDelete";
import { handleMessageUpdate } from "../events/messageUpdate";
import { handlePresenceEvent } from "../events/presenceUpdate";
import { handleReady } from "../events/ready";
import { env } from "../config/env";
import type { BotContext } from "../types";

export function registerEvents(client: Client, context: BotContext) {
  client.once(Events.ClientReady, (readyClient) => handleReady(readyClient, context));
  client.on(Events.InteractionCreate, (interaction) => void handleInteractionCreate(interaction, context));

  if (env.BOT_MEMBER_EVENTS_ENABLED) {
    client.on(Events.GuildMemberAdd, (member) => {
      void resolveMember(member).then((resolved) => {
        if (resolved) {
          void handleGuildMemberAdd(resolved, context);
        }
      });
    });
    client.on(Events.GuildMemberRemove, (member) => {
      void resolveMember(member).then((resolved) => {
        if (resolved) {
          void handleGuildMemberRemove(resolved, context);
        }
      });
    });
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
      void Promise.all([resolveMember(oldMember), resolveMember(newMember)]).then(([oldResolved, newResolved]) => {
        if (oldResolved && newResolved) {
          void handleGuildMemberUpdate(oldResolved, newResolved, context);
        }
      });
    });
  }

  if (env.BOT_MESSAGE_LOGS_ENABLED) {
    client.on(Events.MessageDelete, (message) => void handleMessageDelete(message, context));
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => void handleMessageUpdate(oldMessage, newMessage, context));
  }

  if (env.BOT_PRESENCE_MONITOR_ENABLED) {
    client.on(Events.PresenceUpdate, (oldPresence, newPresence) => void handlePresenceEvent(oldPresence, newPresence, context));
  }
}

async function resolveMember(member: GuildMember | PartialGuildMember) {
  if (!member.partial) {
    return member;
  }

  return member.fetch().catch(() => null);
}
