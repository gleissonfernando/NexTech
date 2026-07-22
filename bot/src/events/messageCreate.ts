import type { Message } from "discord.js";
import { handleImageAntiSpamMessage } from "../services/imageAntiSpamService";
import { handleLinkAntiSpamMessage } from "../services/linkAntiSpamService";
import { blockMessageIfMaintenance } from "../services/maintenanceService";
import { handleSafeBotMessage, isSelfBotModuleEnabled } from "../services/safeBotService";
import { handleSelfBotProtectionMessage } from "../services/selfBotProtectionService";
import { handleTemporaryVoiceMessage } from "../services/temporaryVoiceService";
import { handleFivemGoalMessage } from "../services/fivemGoalService";
import { handleManualPaymentMessage } from "../services/manualPaymentService";
import { handleNexTechInviteMessage } from "../services/nexTechInviteService";
import { handleZtkWebhookMessage } from "../services/ztkWebhookService";
import type { BotContext } from "../types";
import { isBotModuleEnabled } from "../config/env";
import { canModerateMessage } from "../services/moderationChannelPolicy";
import { capturePolicePatrolMessage } from "../services/policePatrolReportService";
import { handlePoliceHiddenChannelMessage } from "../services/policeHiddenChannelService";
import { handlePoliceSubpoenaMessage } from "../services/policeSubpoenaService";
import { handleReportSystemMessage } from "../services/reportSystemService";
import { handleCourseExamMessage } from "../services/courseSystemService";
import { rememberDeletedMessageSnapshot } from "../services/deletedMessageLogService";
import { handleMessageControlMessage } from "../services/messageControlService";
import { handleVisibleMessageMessage } from "../services/visibleMessageService";
import { handleVehicleAbandonmentMessage } from "../services/vehicleAbandonmentService";
import { handlePoliceQruMessage } from "../services/policeQruService";
import { handlePolicePromotionMessage } from "../services/policePromotionService";

const MUSIC_PREFIX_COMMANDS = new Set(["music", "play", "artist", "pause", "resume", "skip", "stop", "queue", "clearqueue", "nowplaying", "volume", "loop", "shuffle"]);

export async function handleMessageCreate(message: Message, context: BotContext) {
  await rememberDeletedMessageSnapshot(message).catch((error) => {
    console.warn("[deleted-message-log] falha ao guardar snapshot:", error instanceof Error ? error.message : error);
  });

  if (await blockMessageIfMaintenance(message, context)) {
    return;
  }

  if (await handleZtkWebhookMessage(message, context)) {
    return;
  }

  if (await handleNexTechInviteMessage(message, context)) {
    return;
  }

  await capturePolicePatrolMessage(message, context).catch((error) => {
    console.error("[police-patrol] falha ao salvar mensagem:", error instanceof Error ? error.message : error);
  });

  if (await handleManualPaymentMessage(message, context)) {
    return;
  }

  if (await handleMessageControlMessage(message, context)) {
    return;
  }

  if (await handleReportSystemMessage(message, context)) {
    return;
  }

  if (await handleVehicleAbandonmentMessage(message, context)) {
    return;
  }

  if (await handlePoliceQruMessage(message, context)) {
    return;
  }

  if (await handlePolicePromotionMessage(message, context)) {
    return;
  }

  if (await handlePoliceSubpoenaMessage(message, context)) {
    return;
  }

  if (await handleTemporaryVoiceMessage(message, context)) {
    return;
  }
  if (await handleCourseExamMessage(message, context)) {
    return;
  }

  const safeBotBlocked = await handleSafeBotMessage(message, context);
  if (safeBotBlocked) return;

  const moderation = await canModerateMessage(message, context, "message-create");
  if (!moderation.ignored) {
    const selfBotBlocked = await handleSelfBotProtectionMessage(message, context);
    if (selfBotBlocked) return;
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

  if (await handleVisibleMessageMessage(message, context)) {
    return;
  }

  if (await handlePoliceHiddenChannelMessage(message, context)) {
    return;
  }

  if (isSelfBotModuleEnabled()) {
    return;
  }

  if (moderation.ignored) return;

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
