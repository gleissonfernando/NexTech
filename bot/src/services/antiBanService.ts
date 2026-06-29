import {
  AuditLogEvent,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildMember,
  type Role
} from "discord.js";
import type { AntiBanConfig } from "./apiClient";
import type { BotContext } from "../types";

type DetectionInput = {
  actionType: "ban" | "kick" | "member_role_update" | "member_update" | "role_delete" | "role_update" | "channel_delete" | "channel_update" | "guild_update";
  auditType: AuditLogEvent;
  guild: Guild;
  targetId: string | null;
  affectedRoleIds?: string[];
  recovery?: (config: AntiBanConfig) => Promise<string | null>;
};

const configCache = new Map<string, { expiresAt: number; config: AntiBanConfig | null }>();
const actionBuckets = new Map<string, number[]>();
const processedAuditEntries = new Map<string, number>();
const punishmentCooldowns = new Map<string, number>();
const blockedExecutors = new Set<string>();
const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks
];

export async function handleAntiBanDetection(context: BotContext, input: DetectionInput) {
  const config = await readConfig(context, input.guild.id);
  if (!config?.enabled) return;
  const entry = await findAuditEntry(input);
  if (!entry?.executorId || !entry.id) return;
  if (entry.executorId === context.client.user?.id) return;
  const processedKey = `${input.guild.id}:${entry.id}`;
  cleanupMaps();
  if (processedAuditEntries.has(processedKey)) return;
  processedAuditEntries.set(processedKey, Date.now() + 60_000);

  const executor = await input.guild.members.fetch(entry.executorId).catch(() => null);
  const owner = entry.executorId === input.guild.ownerId;
  const userWhitelisted = config.whitelistUsers.includes(entry.executorId);
  const roleWhitelisted = Boolean(executor && executor.roles.cache.some((role) => config.whitelistRoles.includes(role.id)));
  const whitelisted = owner || userWhitelisted || roleWhitelisted;
  const limit = input.actionType === "ban"
    ? config.banLimit
    : input.actionType === "kick"
      ? config.kickLimit
      : Math.max(2, Math.min(config.banLimit, config.kickLimit));
  const amount = recordAction(config, input.guild.id, entry.executorId, input.actionType);
  const protectedRoleTouched = Boolean(input.affectedRoleIds?.some((roleId) => config.protectedRoles.includes(roleId)));
  const thresholdReached = amount >= limit || protectedRoleTouched || blockedExecutors.has(`${input.guild.id}:${entry.executorId}`);

  let punishment = whitelisted ? "executor confiável; somente log" : "limite ainda não atingido";
  let success = true;
  let errorMessage: string | null = null;
  let recoveryResult: string | null = null;

  if (thresholdReached && !whitelisted) {
    const cooldownKey = `${input.guild.id}:${entry.executorId}`;
    if ((punishmentCooldowns.get(cooldownKey) ?? 0) > Date.now()) {
      punishment = "punição em cooldown; evento registrado";
    } else {
      punishmentCooldowns.set(cooldownKey, Date.now() + 30_000);
      try {
        punishment = await punishExecutor(config, input.guild, executor, entry.executorId);
      } catch (error) {
        success = false;
        errorMessage = errorText(error);
        punishment = "falha ao aplicar punição";
      }
    }
    if (input.recovery && (protectedRoleTouched || config.autoRecovery !== "alert_only")) {
      try { recoveryResult = await input.recovery(config); }
      catch (error) { success = false; errorMessage = [errorMessage, `Recuperação: ${errorText(error)}`].filter(Boolean).join(" | "); }
    }
  }

  await Promise.allSettled([
    sendAntiBanLog(config, input, entry.executorId, amount, limit, punishment, success, errorMessage, recoveryResult, whitelisted),
    context.api.createAntiBanLog(input.guild.id, {
      executorId: entry.executorId,
      targetId: input.targetId,
      actionType: input.actionType,
      amount,
      limit,
      punishment,
      success,
      errorMessage,
      metadata: { auditLogId: entry.id, protectedRoleTouched, recoveryResult, whitelisted }
    })
  ]);
}

export async function recoverMemberProtectedRoles(member: GuildMember, roleIds: string[], config: AntiBanConfig) {
  if (config.autoRecovery !== "restore_permissions") return null;
  const manageable = roleIds.filter((roleId) => config.protectedRoles.includes(roleId) && member.guild.roles.cache.get(roleId)?.editable);
  if (!manageable.length) return null;
  await member.roles.add(manageable, "Recuperação automática do Anti Ban");
  return `${manageable.length} cargo(s) protegido(s) restaurado(s)`;
}

export async function recoverDeletedProtectedRole(role: Role, config: AntiBanConfig) {
  if (config.autoRecovery !== "restore_permissions" || !config.protectedRoles.includes(role.id)) return null;
  const recreated = await role.guild.roles.create({
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions,
    reason: "Recuperação automática do Anti Ban"
  });
  return `cargo protegido recriado como ${recreated.id}`;
}

export async function recoverUpdatedProtectedRole(previous: Role, current: Role, config: AntiBanConfig) {
  if (config.autoRecovery !== "restore_permissions" || !config.protectedRoles.includes(current.id) || !current.editable) return null;
  await current.edit({
    name: previous.name,
    color: previous.color,
    hoist: previous.hoist,
    mentionable: previous.mentionable,
    permissions: previous.permissions,
    reason: "Recuperação automática do Anti Ban"
  });
  return "configuração do cargo protegido restaurada";
}

async function readConfig(context: BotContext, guildId: string) {
  const cached = configCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  try {
    const config = await context.api.getAntiBanConfig(guildId);
    configCache.set(guildId, { expiresAt: Date.now() + 15_000, config });
    return config;
  } catch {
    configCache.set(guildId, { expiresAt: Date.now() + 15_000, config: null });
    return null;
  }
}

async function findAuditEntry(input: DetectionInput): Promise<GuildAuditLogsEntry | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const logs = await input.guild.fetchAuditLogs({ type: input.auditType, limit: 6 });
      const now = Date.now();
      const found = logs.entries.find((entry) => {
        if (now - entry.createdTimestamp > 12_000) return false;
        if (processedAuditEntries.has(`${input.guild.id}:${entry.id}`)) return false;
        if (!input.targetId) return true;
        return entry.targetId === input.targetId;
      }) ?? null;
      if (found) return found;
      if (attempt < 2) await wait(450 * (attempt + 1));
    } catch (error) {
      console.warn(`[anti-ban:${input.guild.id}] não foi possível consultar Audit Log:`, errorText(error));
      return null;
    }
  }
  return null;
}

function recordAction(config: AntiBanConfig, guildId: string, executorId: string, actionType: string) {
  const key = `${guildId}:${executorId}:${actionType}`;
  const cutoff = Date.now() - config.timeWindow * 1000;
  const entries = (actionBuckets.get(key) ?? []).filter((time) => time >= cutoff);
  entries.push(Date.now());
  actionBuckets.set(key, entries);
  return entries.length;
}

async function punishExecutor(config: AntiBanConfig, guild: Guild, member: GuildMember | null, executorId: string) {
  if (executorId === guild.ownerId) return "dono do servidor nunca é punido";
  if (!member) throw new Error("Executor não está mais no servidor.");
  if (!member.manageable) throw new Error("O executor está acima ou no mesmo nível do cargo do bot.");
  if (config.actionOnTrigger === "log_only") return "apenas log";
  if (config.actionOnTrigger === "kick_executor") {
    if (!member.kickable) throw new Error("Executor não pode ser expulso pela hierarquia atual.");
    await member.kick("Proteção Anti Ban acionada");
    return "executor expulso";
  }
  if (config.actionOnTrigger === "ban_executor") {
    if (!member.bannable) throw new Error("Executor não pode ser banido pela hierarquia atual.");
    await member.ban({ reason: "Proteção Anti Ban acionada", deleteMessageSeconds: 0 });
    return "executor banido";
  }
  const dangerousRoles = member.roles.cache.filter((role) => role.id !== guild.id && !role.managed && role.editable && DANGEROUS_PERMISSIONS.some((permission) => role.permissions.has(permission)));
  if (dangerousRoles.size) await member.roles.remove([...dangerousRoles.keys()], "Proteção Anti Ban acionada");
  if (config.actionOnTrigger === "block_future_actions") {
    blockedExecutors.add(`${guild.id}:${executorId}`);
    return `${dangerousRoles.size} cargo(s) perigoso(s) removido(s); executor bloqueado nesta sessão`;
  }
  return `${dangerousRoles.size} cargo(s) administrativo(s) removido(s)`;
}

async function sendAntiBanLog(
  config: AntiBanConfig,
  input: DetectionInput,
  executorId: string,
  amount: number,
  limit: number,
  punishment: string,
  success: boolean,
  errorMessage: string | null,
  recoveryResult: string | null,
  whitelisted: boolean
) {
  if (!config.logChannelId) return;
  const channel = await input.guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;
  const embed = new EmbedBuilder()
    .setColor(success ? 0x7c3aed : 0xef4444)
    .setTitle("🚨 Proteção Anti Ban acionada")
    .addFields(
      { name: "Executor", value: `<@${executorId}> (${executorId})` },
      { name: "Usuário/objeto afetado", value: input.targetId ? `<@${input.targetId}> (${input.targetId})` : "Não identificado" },
      { name: "Ação detectada", value: input.actionType, inline: true },
      { name: "Quantidade", value: `${amount} em ${config.timeWindow}s`, inline: true },
      { name: "Limite", value: String(limit), inline: true },
      { name: "Ação tomada", value: punishment },
      { name: "Resultado", value: success ? (whitelisted ? "Confiável — somente log" : "Sucesso") : `Erro: ${errorMessage ?? "desconhecido"}` },
      { name: "Escopo", value: `Servidor: ${input.guild.id}\nBot: ${input.guild.members.me?.id ?? "desconhecido"}` }
    )
    .setTimestamp();
  if (recoveryResult) embed.addFields({ name: "Recuperação", value: recoveryResult });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

function cleanupMaps() {
  const now = Date.now();
  for (const [key, expiresAt] of processedAuditEntries) if (expiresAt <= now) processedAuditEntries.delete(key);
  for (const [key, expiresAt] of punishmentCooldowns) if (expiresAt <= now) punishmentCooldowns.delete(key);
}

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function wait(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
