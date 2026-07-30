import type { Message, PartialMessage } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { isLogsRuntimeAuthorized, logMessageUpdate } from "../services/logService";
import { rememberDeletedMessageSnapshot } from "../services/deletedMessageLogService";
import { isSelfBotModuleEnabled } from "../services/safeBotService";
import type { BotContext } from "../types";

export async function handleMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, context: BotContext) {
  const snapshotSource = await resolveMessage(newMessage);
  if (snapshotSource) {
    await rememberDeletedMessageSnapshot(snapshotSource).catch((error) => {
      console.warn("[deleted-message-log] falha ao atualizar snapshot:", error instanceof Error ? error.message : error);
    });
  }

  if (newMessage.guild && await isLogsRuntimeAuthorized(context, newMessage.guild.id)) {
    await logMessageUpdate(context, oldMessage, newMessage);
  }

  if (!isBotModuleEnabled("image-anti-spam") || isSelfBotModuleEnabled()) {
    return;
  }

  const resolved = snapshotSource ?? await resolveMessage(newMessage);

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
