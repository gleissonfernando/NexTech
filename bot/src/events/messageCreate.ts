import type { Message } from "discord.js";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import type { BotContext } from "../types";

export async function handleMessageCreate(message: Message, context: BotContext) {
  await handleImageAntiSpamMessage(message, context);
}
