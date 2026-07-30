import type { Request } from "express";
import { isBotRequest } from "../middleware/auth";
import { findDevBotIdByClientId, getDevBot } from "./devBotService";

const BOT_IDENTITY_CONFLICT_FLAG = Symbol("botIdentityConflict");

export function readConfiguredBotId(req: Request) {
  const queryBotId = typeof req.query.botId === "string" ? req.query.botId : null;
  const headerBotId = req.header("x-dashboard-bot-id");
  const botId = queryBotId ?? headerBotId ?? null;
  const normalized = botId?.trim();

  return normalized ? normalized : null;
}

export async function resolveRequestBotId(req: Request) {
  if (!isBotRequest(req)) {
    return readConfiguredBotId(req);
  }

  const headerBotId = req.header("x-dashboard-bot-id")?.trim();
  const clientId = req.header("x-discord-bot-client-id")?.trim();
  const hasValidClientId = Boolean(clientId && /^\d{5,32}$/.test(clientId));

  if (headerBotId) {
    const bot = await getDevBot(headerBotId).catch(() => null);

    if (bot) {
      if (!isRegisteredBotIdentityMatch(bot.clientId, clientId)) {
        markBotIdentityConflict(req);
        return null;
      }

      return bot.id;
    }

    if (/^\d{5,32}$/.test(headerBotId)) {
      const botId = await findDevBotIdByClientId(headerBotId).catch(() => null);

      if (botId) {
        if (!isRegisteredBotIdentityMatch(headerBotId, clientId)) {
          markBotIdentityConflict(req);
          return null;
        }

        return botId;
      }
    }
  }

  if (!hasValidClientId || !clientId) {
    return null;
  }

  return findDevBotIdByClientId(clientId).catch(() => null);
}

export function hasBotIdentityConflict(req: Request) {
  return Boolean((req as Request & { [BOT_IDENTITY_CONFLICT_FLAG]?: boolean })[BOT_IDENTITY_CONFLICT_FLAG]);
}

export function isRegisteredBotIdentityMatch(registeredClientId: string | null | undefined, requestClientId: string | null | undefined) {
  const normalizedRegisteredClientId = registeredClientId?.trim() ?? "";
  const normalizedRequestClientId = requestClientId?.trim() ?? "";

  return !normalizedRequestClientId || normalizedRegisteredClientId === normalizedRequestClientId;
}

function markBotIdentityConflict(req: Request) {
  (req as Request & { [BOT_IDENTITY_CONFLICT_FLAG]?: boolean })[BOT_IDENTITY_CONFLICT_FLAG] = true;
}
