import type { Message } from "discord.js";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { handleLinkAntiSpamMessage } from "../services/linkAntiSpamService";
import { blockMessageIfMaintenance } from "../services/maintenanceService";
import { handleSafeBotMessage, isSelfBotModuleEnabled } from "../services/safeBotService";
import { handleSelfBotProtectionMessage } from "../services/selfBotProtectionService";
import { handleTemporaryVoiceMessage } from "../services/temporaryVoiceService";
import type { BotContext } from "../types";
import { handleMusicMessage } from "../music/musicService";

export async function handleMessageCreate(message: Message, context: BotContext) {
  if (await blockMessageIfMaintenance(message)) {
    return;
  }

  if (await handleTemporaryVoiceMessage(message, context)) {
    return;
  }

  const safeBotBlocked = await handleSafeBotMessage(message, context);

  if (safeBotBlocked) {
    return;
  }

  const selfBotBlocked = await handleSelfBotProtectionMessage(message, context);

  if (selfBotBlocked) {
    return;
  }

  if (await handleMusicMessage(message, context)) {
    return;
  }

  if (isSelfBotModuleEnabled()) {
    return;
  }

  const imageBlocked = await handleImageAntiSpamMessage(message, context);

  if (imageBlocked) {
    return;
  }

  const linkBlocked = await handleLinkAntiSpamMessage(message, context);

  if (linkBlocked) {
    return;
  }
}
