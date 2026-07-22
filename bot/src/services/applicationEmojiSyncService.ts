import type { Client, Guild, GuildEmoji } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

const MODULE_ID = "emoji-cloner";
const startupSyncedClients = new Set<string>();
const guildSyncs = new Map<string, Promise<unknown>>();

export async function handleApplicationEmojiGuildCreate(emoji: GuildEmoji, context: BotContext) {
  await notifyApplicationEmojiEvent(emoji, context, "created");
}

export async function handleApplicationEmojiGuildUpdate(_oldEmoji: GuildEmoji, newEmoji: GuildEmoji, context: BotContext) {
  await notifyApplicationEmojiEvent(newEmoji, context, "updated");
}

export async function handleApplicationEmojiGuildDelete(emoji: GuildEmoji, context: BotContext) {
  await notifyApplicationEmojiEvent(emoji, context, "deleted");
}

export function startApplicationEmojiAutoSync(client: Client<true>, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return;
  const key = client.user.id;
  if (startupSyncedClients.has(key)) return;
  startupSyncedClients.add(key);

  void syncClientGuildApplicationEmojis(client, context).catch((error) => {
    console.warn("[application-emojis] falha na sincronização inicial:", error instanceof Error ? error.message : error);
  });
}

export async function syncGuildApplicationEmojis(guild: Guild, context: BotContext, reason: string) {
  if (!isBotModuleEnabled(MODULE_ID)) return { skipped: true, reason: "module_disabled" };
  if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
    return { skipped: true, reason: "module_not_authorized" };
  }

  const key = `${guild.id}:${reason}`;
  const running = guildSyncs.get(key);
  if (running) return running;

  const task = context.api.syncApplicationEmojiGuild({ guildId: guild.id, reason })
    .catch((error) => {
      console.warn("[application-emojis] falha ao solicitar sincronização:", error instanceof Error ? error.message : error);
      return { error: error instanceof Error ? error.message : String(error), skipped: true };
    })
    .finally(() => {
      if (guildSyncs.get(key) === task) {
        guildSyncs.delete(key);
      }
    });
  guildSyncs.set(key, task);
  return task;
}

async function syncClientGuildApplicationEmojis(client: Client<true>, context: BotContext) {
  for (const guild of client.guilds.cache.values()) {
    await syncGuildApplicationEmojis(guild, context, "startup");
    await wait(1_500);
  }
}

async function notifyApplicationEmojiEvent(emoji: GuildEmoji, context: BotContext, action: "created" | "deleted" | "updated") {
  if (!isBotModuleEnabled(MODULE_ID)) return;

  const guildId = emoji.guild.id;

  if (!(await isRuntimeModuleAuthorized(context, guildId, MODULE_ID))) {
    return;
  }

  await context.api.notifyApplicationEmojiGuildEvent({
    action,
    animated: Boolean(emoji.animated),
    emojiId: emoji.id,
    guildId,
    name: emoji.name ?? "emoji"
  }).catch((error) => {
    console.warn("[application-emojis] falha ao notificar backend:", error instanceof Error ? error.message : error);
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
