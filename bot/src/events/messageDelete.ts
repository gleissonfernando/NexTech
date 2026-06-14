import type { Message, PartialMessage } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { logMessageDelete } from "../services/logService";
import type { BotContext } from "../types";

export async function handleMessageDelete(message: Message | PartialMessage, context: BotContext) {
  if (!isBotModuleEnabled("logs")) {
    return;
  }

  await logMessageDelete(context, message);
}
