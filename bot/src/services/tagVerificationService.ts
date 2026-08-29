import {
  ActivityType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type Role
} from "discord.js";
import { currentRuntimeBotId, isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import type { TagVerificationRunResult } from "../websocket/socketClient";
import { clearRuntimeModuleAuthorization, getRuntimeModuleAuthorization } from "./runtimeModuleGuard";

type TagVerificationConfig = {
  autoRemove: boolean;
  enabled: boolean;
  requiredTag: string;
  roleId: string | null;
  updateIntervalMinutes: number;
};

type SchedulerEntry = {
  generation: number;
  timeout: NodeJS.Timeout | null;
};

type VerificationResult = TagVerificationRunResult & {
  unavailableUserIds: string[];
};

const MODULE_ID = "tag-verification";
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 250;
const INITIAL_BACKGROUND_CHECK_DELAY_MS = 30_000;
const schedulers = new Map<string, SchedulerEntry>();
const runningChecks = new Map<string, Promise<TagVerificationRunResult>>();
let socketHandlersRegistered = false;
let schedulerGeneration = 0;

export async function startTagVerificationService(client: Client, context: BotContext) {
  registerSocketHandlers(client, context);

  if (!isBotModuleEnabled(MODULE_ID)) {
    stopTagVerificationService();
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    await restartGuildScheduler(guild, context, false).catch((error) => {
      console.warn(`[tag-verification] falha ao iniciar ${guild.id}:`, readError(error));
    });
  }
}

export function stopTagVerificationService() {
  for (const entry of schedulers.values()) {
    if (entry.timeout) clearTimeout(entry.timeout);
  }
  schedulers.clear();
}

export function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function hasRequiredTag(userText: string, requiredTag: string) {
  const normalizedTag = normalizeText(requiredTag);
  return Boolean(normalizedTag && normalizeText(userText).includes(normalizedTag));
}

function registerSocketHandlers(client: Client, context: BotContext) {
  if (socketHandlersRegistered) return;
  socketHandlersRegistered = true;

  context.socket.onTagVerificationConfigUpdated((payload) => {
    if (!belongsToRuntime(payload.botId)) return;
    clearRuntimeModuleAuthorization(payload.guildId, MODULE_ID);
    const guild = client.guilds.cache.get(payload.guildId);
    if (guild) void restartGuildScheduler(guild, context, true);
  });

  context.socket.onTagVerificationRun(async (payload) => {
    if (!belongsToRuntime(payload.botId)) {
      throw new Error("A solicitação pertence a outro bot.");
    }

    const guild = client.guilds.cache.get(payload.guildId) ?? await client.guilds.fetch(payload.guildId).catch(() => null);
    if (!guild) throw new Error("Servidor não encontrado pelo bot.");
    clearRuntimeModuleAuthorization(payload.guildId, MODULE_ID);
    const result = await restartGuildScheduler(guild, context, true);
    if (!result) throw new Error("A Verificação de Tag está desativada ou sem configuração válida.");
    return result;
  });
}

async function restartGuildScheduler(guild: Guild, context: BotContext, runImmediately: boolean) {
  const key = schedulerKey(guild.id);
  const previous = schedulers.get(key);
  if (previous?.timeout) clearTimeout(previous.timeout);

  const generation = ++schedulerGeneration;
  const entry: SchedulerEntry = { generation, timeout: null };
  schedulers.set(key, entry);

  const authorization = await getRuntimeModuleAuthorization(context, guild.id, MODULE_ID);
  const config = await readConfig(context, guild.id);

  if (!authorization.allowed || !config.enabled || !config.requiredTag || !config.roleId) {
    if (schedulers.get(key)?.generation === generation) schedulers.delete(key);
    return null;
  }

  let result: TagVerificationRunResult | null = null;
  if (runImmediately) {
    result = await runVerificationDeduplicated(guild, context, config, null);
  }

  if (schedulers.get(key)?.generation !== generation) return result;

  const intervalMs = config.updateIntervalMinutes * 60_000;
  const delayMs = runImmediately ? intervalMs : Math.min(INITIAL_BACKGROUND_CHECK_DELAY_MS, intervalMs);
  const nextCheckAt = new Date(Date.now() + delayMs).toISOString();
  entry.timeout = setTimeout(() => {
    void restartGuildScheduler(guild, context, true);
  }, delayMs);
  entry.timeout.unref();

  if (result) {
    result.nextCheckAt = nextCheckAt;
    await reportStatus(context, result);
  }

  return result;
}

async function runVerificationDeduplicated(
  guild: Guild,
  context: BotContext,
  config: TagVerificationConfig,
  nextCheckAt: string | null
) {
  const key = schedulerKey(guild.id);
  const active = runningChecks.get(key);
  if (active) return active;

  const run = runVerification(guild, context, config, nextCheckAt).finally(() => {
    if (runningChecks.get(key) === run) runningChecks.delete(key);
  });
  runningChecks.set(key, run);
  return run;
}

async function runVerification(
  guild: Guild,
  context: BotContext,
  config: TagVerificationConfig,
  nextCheckAt: string | null
): Promise<TagVerificationRunResult> {
  const botId = currentRuntimeBotId() ?? "local";
  const result: VerificationResult = {
    botId,
    guildId: guild.id,
    checked: 0,
    assigned: 0,
    removed: 0,
    ignored: 0,
    unavailable: 0,
    errors: 0,
    lastCheckAt: new Date().toISOString(),
    nextCheckAt,
    lastError: null,
    unavailableUserIds: []
  };
  let roleLabel = config.roleId ?? "não configurado";

  try {
    if (!config.roleId) throw new Error("Cargo não encontrado.");
    const role = await guild.roles.fetch(config.roleId);
    const roleError = await validateRole(guild, role);
    if (roleError) throw new Error(roleError);
    roleLabel = `${role!.name}/${role!.id}`;

    const members = await guild.members.fetch({ withPresences: true });
    const targets = [...members.values()].filter((member) => !member.user.bot);

    for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
      const batch = targets.slice(offset, offset + BATCH_SIZE);
      await Promise.all(batch.map((member) => syncMemberTagRole(member, role!, config, result, context)));
      if (offset + BATCH_SIZE < targets.length) await wait(BATCH_DELAY_MS);
    }
  } catch (error) {
    result.errors += 1;
    result.lastError = readError(error);
  }

  result.lastCheckAt = new Date().toISOString();
  await writeSummaryLog(context, config, result, roleLabel);
  return result;
}

async function syncMemberTagRole(
  member: GuildMember,
  role: Role,
  config: TagVerificationConfig,
  result: VerificationResult,
  context: BotContext
) {
  result.checked += 1;

  try {
    const texts = readableMemberTexts(member);
    const matches = texts.some((text) => hasRequiredTag(text, config.requiredTag));
    const hasRole = member.roles.cache.has(role.id);

    if (matches) {
      if (hasRole) {
        result.ignored += 1;
        return;
      }

      await member.roles.add(role, `Verificação de Tag: tag ${config.requiredTag} encontrada.`);
      result.assigned += 1;
      await writeMemberLog(context, member, role, "tag_verification.role_assigned", "Cargo entregue após validar a tag.");
      return;
    }

    if (!member.presence) {
      result.unavailable += 1;
      if (result.unavailableUserIds.length < 50) result.unavailableUserIds.push(member.id);
      return;
    }

    if (config.autoRemove && hasRole) {
      await member.roles.remove(role, `Verificação de Tag: tag ${config.requiredTag} removida.`);
      result.removed += 1;
      await writeMemberLog(context, member, role, "tag_verification.role_removed", "Cargo removido porque a tag não foi encontrada.");
      return;
    }

    result.ignored += 1;
  } catch (error) {
    result.errors += 1;
    result.lastError = readError(error);
  }
}

function readableMemberTexts(member: GuildMember) {
  const customStatuses = member.presence?.activities
    .filter((activity) => activity.type === ActivityType.Custom)
    .flatMap((activity) => [activity.state, activity.name])
    .filter((value): value is string => Boolean(value?.trim())) ?? [];

  return [member.user.username, member.user.globalName, member.nickname, member.displayName, ...customStatuses]
    .filter((value): value is string => Boolean(value?.trim()));
}

async function validateRole(guild: Guild, role: Role | null) {
  if (!role) return "Cargo não encontrado.";
  if (role.managed) return "O cargo selecionado e gerenciado por uma integração.";

  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "Bot sem permissão para gerenciar cargos.";
  }
  if (role.comparePositionTo(botMember.roles.highest) >= 0) {
    return "Cargo selecionado está acima do cargo do bot.";
  }
  return null;
}

async function readConfig(context: BotContext, guildId: string): Promise<TagVerificationConfig> {
  const botId = currentRuntimeBotId();
  if (!botId) return { autoRemove: true, enabled: false, requiredTag: "", roleId: null, updateIntervalMinutes: 10 };

  const raw: Record<string, unknown> = await context.api.getBotGuildConfig(botId, guildId)
    .then((config) => config.modules?.[MODULE_ID] ?? {})
    .catch(() => ({}));

  return {
    autoRemove: raw.autoRemove !== false && raw.removeOnMismatch !== false,
    enabled: raw.enabled === true,
    requiredTag: typeof raw.requiredTag === "string" ? raw.requiredTag.trim() : "",
    roleId: readId(raw.roleId),
    updateIntervalMinutes: boundedNumber(raw.updateIntervalMinutes ?? raw.intervalMinutes, 10, 1, 1440)
  };
}

async function reportStatus(context: BotContext, result: TagVerificationRunResult) {
  await context.api.reportTagVerificationStatus(result.guildId, {
    lastCheckAt: result.lastCheckAt,
    nextCheckAt: result.nextCheckAt,
    totalChecked: result.checked,
    totalAssigned: result.assigned,
    totalRemoved: result.removed,
    totalIgnored: result.ignored,
    totalUnavailable: result.unavailable,
    totalErrors: result.errors,
    lastError: result.lastError
  }).catch((error) => {
    console.warn(`[tag-verification] falha ao salvar status de ${result.guildId}:`, readError(error));
  });
}

async function writeSummaryLog(context: BotContext, config: TagVerificationConfig, result: VerificationResult, roleLabel: string) {
  await context.api.postLog({
    botId: currentRuntimeBotId(),
    guildId: result.guildId,
    type: result.lastError ? "tag_verification.failed" : "tag_verification.completed",
    message: `[Verificação de Tag] Guild: ${result.guildId} | Bot: ${result.botId} | Tag: ${config.requiredTag} | Cargo: ${roleLabel} | Verificados: ${result.checked} | Entregues: ${result.assigned} | Removidos: ${result.removed} | Ignorados: ${result.ignored} | Não foi possível validar: ${result.unavailable} | Erros: ${result.errors}.`,
    metadata: { ...result, requiredTag: config.requiredTag, roleId: config.roleId, roleLabel }
  }).catch(() => undefined);
}

async function writeMemberLog(context: BotContext, member: GuildMember, role: Role, type: string, message: string) {
  await context.api.postLog({
    botId: currentRuntimeBotId(),
    guildId: member.guild.id,
    userId: member.id,
    type,
    message: `Verificação de Tag: ${message} Usuário: ${member.user.tag}. Cargo: ${role.name}/${role.id}.`,
    metadata: { roleId: role.id, roleName: role.name, userId: member.id }
  }).catch(() => undefined);
}

function belongsToRuntime(botId: string) {
  const runtimeBotId = currentRuntimeBotId();
  return Boolean(runtimeBotId && botId === runtimeBotId);
}

function schedulerKey(guildId: string) {
  return `${currentRuntimeBotId() ?? "local"}:${guildId}`;
}

function readId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
