import type { Message, PartialMessage } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { logMessageUpdate } from "../services/logService";
import { isSelfBotModuleEnabled } from "../services/safeBotService";
import type { BotContext } from "../types";

export async function handleMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, context: BotContext) {
  if (isBotModuleEnabled("logs")) {
    await logMessageUpdate(context, oldMessage, newMessage);
  }

  if (!isBotModuleEnabled("image-anti-spam") || isSelfBotModuleEnabled()) {
    return;
  }

  const resolved = await resolveMessage(newMessage);

  if (resolved) {
    await handleImageAntiSpamMessage(resolved, context);
  }
}

async function resolveMessage(message: Message | PartialMessage) {
  if (!message.partial) {
    return message;
  }

  return message.fetch().catch(() => null);
}
