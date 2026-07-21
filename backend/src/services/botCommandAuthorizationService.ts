import { isDashboardDevUserId } from '../config/devOwner';
import { getMongoCollections, type MongoBotGuildModuleConfig } from "../database/mongo";
import { createLog } from "./logService";

type CommandAuthorizationConfig = {
  moduleId: string;
  settingKey: "moderationEnabled";
};

export type BotCommandAuthorizationResult = {
  allowed: boolean;
  botId: string | null;
  checkedAt: string;
  commandName: string;
  guildId: string;
  moduleId: string | null;
  policy: "fail_closed";
  reason: string;
  reasonCode: string;
};

export type BotCommandAuthorizationInput = {
  botId: string | null;
  channelId?: string | null;
  commandName: string;
  guildId: string;
  userId?: string | null;
};

const COMMAND_AUTHORIZATION: Record<string, CommandAuthorizationConfig> = {
  clear: {
    moduleId: "moderation",
    settingKey: "moderationEnabled"
  }
};

const INACTIVE_BOT_STATUSES = new Set(["error", "invalid_token"]);
const ACTIVE_LICENSE_STATUSES = new Set(["active", "ativo", "approved", "aprovado", "enabled", "liberado"]);
const EXPIRED_LICENSE_STATUSES = new Set(["expired", "expirado", "expirada"]);
const SUSPENDED_LICENSE_STATUSES = new Set(["suspended", "suspenso", "suspensa", "blocked", "bloqueado", "bloqueada"]);
const REMOVED_LICENSE_STATUSES = new Set(["removed", "removido", "removida", "deleted", "cancelled", "canceled"]);

export async function authorizeBotCommand(input: BotCommandAuthorizationInput) {
  const normalizedInput = normalizeInput(input);
  const checkedAt = new Date().toISOString();
  const config = COMMAND_AUTHORIZATION[normalizedInput.commandName] ?? null;

  try {
    if (!config) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, null, "unknown_command", "Comando não registrado para validação na dashboard.", checkedAt));
    }

    if (!normalizedInput.botId) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "missing_bot_id", "Não foi possível identificar o bot na dashboard.", checkedAt));
    }

    const { botGuildConfigs, devBots, guilds, guildSettings } = await getMongoCollections();
    const [bot, guild, guildConfig, settings] = await Promise.all([
      devBots.findOne({ _id: normalizedInput.botId }),
      guilds.findOne({ _id: normalizedInput.guildId }),
      botGuildConfigs.findOne({
        botId: normalizedInput.botId,
        guildId: normalizedInput.guildId
      }),
      guildSettings.findOne({
        botId: normalizedInput.botId,
        guildId: normalizedInput.guildId
      })
    ]);

    if (!bot) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "bot_not_found", "Bot não encontrado na dashboard.", checkedAt));
    }

    if (INACTIVE_BOT_STATUSES.has(bot.status)) {
      return writeAuthorizationLog(
        normalizedInput,
        denied(normalizedInput, config.moduleId, "bot_inactive", `Bot esta com status ${bot.status} na dashboard.`, checkedAt)
      );
    }

    if (!guild) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "guild_not_found", "Servidor não encontrado no cadastro da dashboard.", checkedAt));
    }

    if (!guild.botEnabled) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "guild_inactive", "Servidor não está ativo na dashboard.", checkedAt));
    }

    if (!guildConfig) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "guild_not_registered", "Servidor não está vinculado a este bot na dashboard.", checkedAt));
    }

    if (isDashboardDevUserId(normalizedInput.userId)) {
      return writeAuthorizationLog(normalizedInput, {
        allowed: true,
        botId: normalizedInput.botId,
        checkedAt,
        commandName: normalizedInput.commandName,
        guildId: normalizedInput.guildId,
        moduleId: config.moduleId,
        policy: "fail_closed",
        reason: "Comando autorizado para usuário owner DEV do dashboard.",
        reasonCode: "dev_user_override"
      });
    }

    if (!bot.enabledModules.includes(config.moduleId)) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "module_disabled", "Módulo de moderação não foi liberado para este bot.", checkedAt));
    }

    const moduleConfig = guildConfig.modules?.[config.moduleId] ?? null;

    if (moduleConfig?.enabled === false) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "module_disabled_for_guild", "Módulo de moderação está desativado para este servidor.", checkedAt));
    }

    const licenseBlock = evaluateLicenseState(
      moduleConfig,
      guildConfig.modules?.license,
      guildConfig.modules?.dashboard
    );

    if (licenseBlock) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, licenseBlock.reasonCode, licenseBlock.reason, checkedAt));
    }

    if (!settings) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "setting_missing", "Sistema de moderação ainda não foi ativado na dashboard.", checkedAt));
    }

    if (settings[config.settingKey] !== true) {
      return writeAuthorizationLog(normalizedInput, denied(normalizedInput, config.moduleId, "setting_disabled", "Sistema de moderação está desativado na dashboard.", checkedAt));
    }

    return writeAuthorizationLog(normalizedInput, {
      allowed: true,
      botId: normalizedInput.botId,
      checkedAt,
      commandName: normalizedInput.commandName,
      guildId: normalizedInput.guildId,
      moduleId: config.moduleId,
      policy: "fail_closed",
      reason: "Comando autorizado pela dashboard.",
      reasonCode: "allowed"
    });
  } catch (error) {
    console.error("[bot-command-auth] falha ao validar comando:", error);

    return writeAuthorizationLog(
      normalizedInput,
      denied(
        normalizedInput,
        config?.moduleId ?? null,
        "dashboard_unavailable",
        "Não foi possível validar a autorizacao do servidor na dashboard.",
        checkedAt
      ),
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

function normalizeInput(input: BotCommandAuthorizationInput) {
  return {
    botId: normalizeNullableId(input.botId),
    channelId: normalizeNullableId(input.channelId),
    commandName: input.commandName.trim().replace(/^\//, "").toLowerCase(),
    guildId: input.guildId.trim(),
    userId: normalizeNullableId(input.userId)
  };
}

function denied(
  input: ReturnType<typeof normalizeInput>,
  moduleId: string | null,
  reasonCode: string,
  reason: string,
  checkedAt: string
): BotCommandAuthorizationResult {
  return {
    allowed: false,
    botId: input.botId,
    checkedAt,
    commandName: input.commandName,
    guildId: input.guildId,
    moduleId,
    policy: "fail_closed",
    reason,
    reasonCode
  };
}

async function writeAuthorizationLog(
  input: ReturnType<typeof normalizeInput>,
  result: BotCommandAuthorizationResult,
  extraMetadata: Record<string, unknown> = {}
) {
  if (!input.botId) {
    return;
  }

  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    userId: input.userId,
    type: result.allowed ? `commands.${result.commandName}.authorization.allowed` : `commands.${result.commandName}.authorization.denied`,
    message: result.allowed
      ? `Comando /${result.commandName} autorizado pela dashboard.`
      : `Comando /${result.commandName} bloqueado: ${result.reason}`,
    metadata: {
      ...extraMetadata,
      allowed: result.allowed,
      botId: input.botId,
      channelId: input.channelId,
      checkedAt: result.checkedAt,
      commandName: result.commandName,
      guildId: input.guildId,
      moduleId: result.moduleId,
      policy: result.policy,
      reason: result.reason,
      reasonCode: result.reasonCode,
      userId: input.userId
    }
  }).catch((error) => {
    console.warn("[bot-command-auth] não foi possível registrar log de autorizacao:", error instanceof Error ? error.message : error);
  });

  return result;
}

function evaluateLicenseState(...configs: Array<MongoBotGuildModuleConfig | null | undefined>) {
  for (const config of configs) {
    const record = asRecord(config);

    if (!record) {
      continue;
    }

    const status = normalizeStatus(
      readString(record.licenseStatus)
      ?? readString(record.licenceStatus)
      ?? readString(record.status)
      ?? readString(record.state)
    );

    if (status && !ACTIVE_LICENSE_STATUSES.has(status)) {
      if (EXPIRED_LICENSE_STATUSES.has(status)) {
        return {
          reasonCode: "license_expired",
          reason: "Licença do servidor expirada na dashboard."
        };
      }

      if (SUSPENDED_LICENSE_STATUSES.has(status)) {
        return {
          reasonCode: "license_suspended",
          reason: "Licença do servidor suspensa na dashboard."
        };
      }

      if (REMOVED_LICENSE_STATUSES.has(status)) {
        return {
          reasonCode: "license_removed",
          reason: "Licença do servidor removida na dashboard."
        };
      }

      return {
        reasonCode: "license_inactive",
        reason: "Licença do servidor não está ativa na dashboard."
      };
    }

    if (record.licenseActive === false || record.licenceActive === false || record.active === false) {
      return {
        reasonCode: "license_inactive",
        reason: "Licença do servidor não está ativa na dashboard."
      };
    }

    const expiresAt = readDate(record.licenseExpiresAt)
      ?? readDate(record.licenceExpiresAt)
      ?? readDate(record.expiresAt)
      ?? readDate(record.expirationDate);

    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return {
        reasonCode: "license_expired",
        reason: "Licença do servidor expirada na dashboard."
      };
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeStatus(value: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase() ?? null;
}

function normalizeNullableId(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}
