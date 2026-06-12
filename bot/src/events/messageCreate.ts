import type { Message } from "discord.js";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { handleLinkAntiSpamMessage } from "../services/linkAntiSpamService";
import { handleSafeBotMessage } from "../services/safeBotService";
import { handleSelfBotProtectionMessage } from "../services/selfBotProtectionService";
import type { BotContext } from "../types";

export async function handleMessageCreate(message: Message, context: BotContext) {
  await handleSafeBotMessage(message, context);

  const imageBlocked = await handleImageAntiSpamMessage(message, context);

  if (imageBlocked) {
    return;
  }

  const selfBotBlocked = await handleSelfBotProtectionMessage(message, context);

  if (selfBotBlocked) {
    return;
  }

  const linkBlocked = await handleLinkAntiSpamMessage(message, context);

  if (linkBlocked) {
    return;
  }
}
