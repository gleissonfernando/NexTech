import { currentRuntimeBotId, env, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { BotRuntimeModuleAuthorization } from "./apiClient";

type CachedAuthorization = {
  authorization: BotRuntimeModuleAuthorization;
  expiresAt: number;
};

const AUTHORIZATION_CACHE_MS = 15_000;
const authorizationCache = new Map<string, CachedAuthorization>();
const authorizationRequests = new Map<string, Promise<BotRuntimeModuleAuthorization>>();

export async function isRuntimeModuleAuthorized(context: BotContext, guildId: string, moduleId: string) {
  return (await getRuntimeModuleAuthorization(context, guildId, moduleId)).allowed;
}

export function runtimeModuleDenialMessage(authorization: BotRuntimeModuleAuthorization, label = "Este sistema") {
  switch (authorization.reasonCode) {
    case "module_disabled":
      return `${label} esta liberado para este bot, mas esta desativado nas configuracoes deste servidor. Ative o sistema no painel e tente novamente.`;
    case "module_not_released":
      return `${label} nao foi liberado para este bot na dashboard DEV.`;
    case "dashboard_unavailable":
      return `Nao foi possivel validar ${label.toLowerCase()} na dashboard agora. Tente novamente em instantes.`;
    case "guild_not_registered":
    case "guild_inactive":
      return `${label} nao esta ativo para este servidor: ${authorization.reason}`;
    default:
      return authorization.reason?.trim()
        ? `${label} nao esta disponivel neste servidor: ${authorization.reason}`
        : `${label} nao esta disponivel neste servidor.`;
  }
}

export async function getRuntimeModuleAuthorization(context: BotContext, guildId: string, moduleId: string): Promise<BotRuntimeModuleAuthorization> {
  const botId = currentRuntimeBotId();

  if (!botId) {
    const allowed = isBotModuleEnabled(moduleId);

    return {
      allowed,
      botAuthorized: allowed,
      botId,
      botStatus: null,
      checkedAt: new Date().toISOString(),
      guildAuthorized: allowed,
      guildId,
      licenseExpiresAt: null,
      licenseStatus: null,
      licenseValid: true,
      moduleEnabled: allowed,
      moduleId,
      moduleReleased: allowed,
      plan: null,
      policy: "fail_closed",
      reason: allowed ? "Modulo autorizado pela configuracao local do bot." : "Modulo nao foi liberado na configuracao local do bot.",
      reasonCode: allowed ? "allowed" : "module_not_released",
      releaseModuleId: moduleId
    };
  }

  const key = runtimeModuleCacheKey(botId, guildId, moduleId);
  const cached = authorizationCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.authorization;
  }

  const pending = authorizationRequests.get(key);

  if (pending) {
    return pending;
  }

  const request = context.api.authorizeRuntimeModule(guildId, moduleId)
    .then((authorization) => {
      if (authorization.botId && authorization.botId !== botId) {
        return deniedRuntimeModuleAuthorization(botId, guildId, moduleId, "A dashboard respondeu com outro bot para este modulo.", "bot_mismatch");
      }

      authorizationCache.set(key, {
        authorization,
        expiresAt: Date.now() + AUTHORIZATION_CACHE_MS
      });
      return authorization;
    })
    .catch((error) => {
      console.warn(
        `[runtime] modulo ${moduleId} bloqueado em ${guildId}:`,
        error instanceof Error ? error.message : error
      );
      authorizationCache.delete(key);
      return deniedRuntimeModuleAuthorization(botId, guildId, moduleId, "Nao foi possivel validar este modulo na dashboard.", "dashboard_unavailable");
    })
    .finally(() => {
      if (authorizationRequests.get(key) === request) {
        authorizationRequests.delete(key);
      }
    });

  authorizationRequests.set(key, request);
  return request;
}

export function clearRuntimeModuleAuthorization(guildId?: string | null, moduleId?: string | null) {
  const botId = currentRuntimeBotId();

  if (!botId) {
    authorizationCache.clear();
    authorizationRequests.clear();
    return;
  }

  const prefix = guildId ? `${botId}:${guildId}:` : `${botId}:`;

  for (const key of authorizationCache.keys()) {
    if (key.startsWith(prefix) && (!moduleId || key.endsWith(`:${moduleId}`))) {
      authorizationCache.delete(key);
    }
  }

  for (const key of authorizationRequests.keys()) {
    if (key.startsWith(prefix) && (!moduleId || key.endsWith(`:${moduleId}`))) {
      authorizationRequests.delete(key);
    }
  }
}

export function runtimeScopeKey(...parts: Array<string | null | undefined>) {
  const botId = (currentRuntimeBotId() ?? env.DASHBOARD_BOT_ID.trim()) || "unknown";
  return [botId, ...parts].join(":");
}

function runtimeModuleCacheKey(botId: string, guildId: string, moduleId: string) {
  return `${botId}:${guildId}:${moduleId.trim().toLowerCase()}`;
}

function deniedRuntimeModuleAuthorization(
  botId: string | null,
  guildId: string,
  moduleId: string,
  reason: string,
  reasonCode: string
): BotRuntimeModuleAuthorization {
  return {
    allowed: false,
    botAuthorized: Boolean(botId),
    botId,
    botStatus: null,
    checkedAt: new Date().toISOString(),
    guildAuthorized: false,
    guildId,
    licenseExpiresAt: null,
    licenseStatus: null,
    licenseValid: false,
    moduleEnabled: false,
    moduleId,
    moduleReleased: false,
    plan: null,
    policy: "fail_closed",
    reason,
    reasonCode,
    releaseModuleId: moduleId
  };
}
