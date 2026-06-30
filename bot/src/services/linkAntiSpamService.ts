import type { Message } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import { logModeration } from "./logService";
import { isRuntimeModuleAuthorized, runtimeScopeKey } from "./runtimeModuleGuard";
import { canModerateMessage } from "./moderationChannelPolicy";

type UserLinkWindow = {
  expiresAt: number;
  lastAllowedAt: number;
};

const MODULE_ID = "link-anti-spam";
const LINK_COOLDOWN_MS = 3 * 60_000;
const LINK_PATTERN =
  /(?:^|[\s<([{])((?:https?:\/\/|www\.)[^\s<>()\]]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>()\]]*)?)/gi;
const userLinkWindows = new Map<string, UserLinkWindow>();
const processingQueues = new Map<string, Promise<boolean>>();

export async function handleLinkAntiSpamMessage(message: Message, context: BotContext) {
  if (!message.guild || message.author.bot) {
    return false;
  }
  if ((await canModerateMessage(message, context, MODULE_ID)).ignored) return false;

  if (!(await isRuntimeModuleAuthorized(context, message.guild.id, MODULE_ID))) {
    return false;
  }

  const linkCount = countLinks(message.content);

  if (linkCount === 0) {
    return false;
  }

  const key = runtimeScopeKey(message.guild.id, message.author.id);
  const previous = processingQueues.get(key) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(() => processLinkMessage(message, linkCount, context))
    .catch((error) => {
      console.warn("[link-anti-spam] falha ao processar mensagem:", errorMessage(error));
      return false;
    })
    .finally(() => {
      if (processingQueues.get(key) === next) {
        processingQueues.delete(key);
      }
    });

  processingQueues.set(key, next);
  return next;
}

async function processLinkMessage(message: Message, linkCount: number, context: BotContext) {
  const guild = message.guild;

  if (!guild) {
    return false;
  }

  const key = runtimeScopeKey(guild.id, message.author.id);
  const now = Date.now();
  const currentWindow = userLinkWindows.get(key);
  const cooldownActive = Boolean(currentWindow && now < currentWindow.expiresAt);
  const tooManyLinks = linkCount > 1;

  if (!cooldownActive && !tooManyLinks) {
    setUserWindow(key, {
      expiresAt: now + LINK_COOLDOWN_MS,
      lastAllowedAt: now
    });
    return false;
  }

  const activeWindow = currentWindow && now < currentWindow.expiresAt
    ? currentWindow
    : {
        expiresAt: now + LINK_COOLDOWN_MS,
        lastAllowedAt: now
      };
  setUserWindow(key, activeWindow);

  const retryAfterMs = Math.max(1_000, activeWindow.expiresAt - now);
  await message.delete().catch((error) => {
    console.warn(
      `[link-anti-spam] nao foi possivel apagar a mensagem ${message.id}:`,
      errorMessage(error)
    );
  });

  await notifyUser(message, retryAfterMs, tooManyLinks).catch((error) => {
    console.warn("[link-anti-spam] nao foi possivel avisar usuario:", errorMessage(error));
  });

  await logModeration(
    context,
    guild.id,
    message.author,
    "moderation.link_anti_spam",
    `Link bloqueado: ${linkCount} link(s) em ${message.channelId}. Aguarde ${formatDuration(retryAfterMs)}.`
  ).catch((error) => {
    console.warn("[link-anti-spam] nao foi possivel registrar log:", errorMessage(error));
  });

  return true;
}

async function notifyUser(message: Message, retryAfterMs: number, tooManyLinks: boolean) {
  if (!message.channel.isSendable()) {
    return;
  }

  const rule = tooManyLinks
    ? "Voce so pode enviar 1 link por vez e 1 link a cada 3 minutos."
    : "Voce so pode enviar 1 link a cada 3 minutos.";
  const warning = await message.channel.send({
    content: `<@${message.author.id}> ${rule} Aguarde ${formatDuration(retryAfterMs)}.`,
    allowedMentions: {
      users: [message.author.id]
    }
  });
  const timer = setTimeout(() => {
    void warning.delete().catch(() => undefined);
  }, 12_000);

  timer.unref();
}

function countLinks(content: string) {
  LINK_PATTERN.lastIndex = 0;
  let count = 0;

  while (LINK_PATTERN.exec(content)) {
    count += 1;
  }

  return count;
}

export function isLinkAntiSpamEnabled() {
  return isBotModuleEnabled(MODULE_ID);
}

function setUserWindow(key: string, window: UserLinkWindow) {
  userLinkWindows.set(key, window);
  scheduleWindowCleanup(key, window);
}

function scheduleWindowCleanup(key: string, window: UserLinkWindow) {
  const timer = setTimeout(() => {
    if (userLinkWindows.get(key) === window) {
      userLinkWindows.delete(key);
    }
  }, Math.max(1_000, window.expiresAt - Date.now() + 1_000));

  timer.unref();
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} segundo(s)`;
  }

  if (seconds === 0) {
    return `${minutes} minuto(s)`;
  }

  return `${minutes} minuto(s) e ${seconds} segundo(s)`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
