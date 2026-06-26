import type { GuildEmoji } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

const MODULE_ID = "emoji-cloner";

export async function handleApplicationEmojiGuildCreate(emoji: GuildEmoji, context: BotContext) {
  await notifyApplicationEmojiEvent(emoji, context, "created");
}

export async function handleApplicationEmojiGuildUpdate(_oldEmoji: GuildEmoji, newEmoji: GuildEmoji, context: BotContext) {
  await notifyApplicationEmojiEvent(newEmoji, context, "updated");
}

export async function handleApplicationEmojiGuildDelete(emoji: GuildEmoji, context: BotContext) {
  await notifyApplicationEmojiEvent(emoji, context, "deleted");
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
