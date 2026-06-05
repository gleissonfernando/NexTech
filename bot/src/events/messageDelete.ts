import type { Message, PartialMessage } from "discord.js";
import { logMessageDelete } from "../services/logService";
import type { BotContext } from "../types";

export async function handleMessageDelete(message: Message | PartialMessage, context: BotContext) {
  await logMessageDelete(context, message);
}
