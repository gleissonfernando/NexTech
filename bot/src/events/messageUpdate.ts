import type { Message, PartialMessage } from "discord.js";
import { logMessageUpdate } from "../services/logService";
import type { BotContext } from "../types";

export async function handleMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, context: BotContext) {
  await logMessageUpdate(context, oldMessage, newMessage);
}
