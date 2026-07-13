import type { Message, PartialMessage } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { logMessageDelete } from "../services/logService";
import { restoreSelfBotWarningAfterDelete } from "../services/safeBotService";
import { handleTemporaryVoicePanelMessageDelete } from "../services/temporaryVoiceService";
import { handleTicketPanelMessageDelete } from "../services/ticketPanelService";
import type { BotContext } from "../types";

export async function handleMessageDelete(message: Message | PartialMessage, context: BotContext) {
  await restoreSelfBotWarningAfterDelete(message, context);
  await handleTemporaryVoicePanelMessageDelete(message, context);
  await handleTicketPanelMessageDelete(message, context);

  if (!isBotModuleEnabled("logs")) {
    return;
  }

  await logMessageDelete(context, message);
}
