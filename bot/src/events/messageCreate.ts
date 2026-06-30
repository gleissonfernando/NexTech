import type { Message } from "discord.js";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { handleLinkAntiSpamMessage } from "../services/linkAntiSpamService";
import { blockMessageIfMaintenance } from "../services/maintenanceService";
import { handleSafeBotMessage, isSelfBotModuleEnabled } from "../services/safeBotService";
import { handleSelfBotProtectionMessage } from "../services/selfBotProtectionService";
import { handleTemporaryVoiceMessage } from "../services/temporaryVoiceService";
import { handleFivemGoalMessage } from "../services/fivemGoalService";
import type { BotContext } from "../types";
import { isBotModuleEnabled } from "../config/env";

const MUSIC_PREFIX_COMMANDS = new Set(["music", "play", "artist", "pause", "resume", "skip", "stop", "queue", "clearqueue", "nowplaying", "volume", "loop", "shuffle"]);

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

  if (isPotentialMusicMessage(message.content) && isBotModuleEnabled("music")) {
    const { handleMusicMessage } = await import("../music/musicService.js");
    if (await handleMusicMessage(message, context)) {
      return;
    }
  }

  if (await handleFivemGoalMessage(message, context)) {
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

function isPotentialMusicMessage(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith(".")) {
    const command = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    return MUSIC_PREFIX_COMMANDS.has(command);
  }

  return /^<?https:\/\/\S+>?$/i.test(trimmed);
}
