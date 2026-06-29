import { randomUUID } from "node:crypto";
import {
  getMongoCollections,
  type MongoAntiBanAction,
  type MongoAntiBanConfig,
  type MongoAntiBanLog,
  type MongoAntiBanRecovery
} from "../database/mongo";
import { getDevBotToken } from "./devBotService";

export type AntiBanConfigInput = {
  enabled: boolean;
  banLimit: number;
  kickLimit: number;
  timeWindow: number;
  logChannelId: string | null;
  whitelistUsers: string[];
  whitelistRoles: string[];
  whitelistRoleMode: "ignore" | "log_only";
  protectedRoles: string[];
  actionOnTrigger: MongoAntiBanAction;
  autoRecovery: MongoAntiBanRecovery;
};

const DEFAULT_CONFIG: AntiBanConfigInput = {
  enabled: false,
  banLimit: 3,
  kickLimit: 3,
  timeWindow: 60,
  logChannelId: null,
  whitelistUsers: [],
  whitelistRoles: [],
  whitelistRoleMode: "ignore",
  protectedRoles: [],
  actionOnTrigger: "remove_admin_roles",
  autoRecovery: "unban"
};

const PERMISSION_FLAGS = {
  kickMembers: 1n << 1n,
  banMembers: 1n << 2n,
  administrator: 1n << 3n,
  viewAuditLog: 1n << 7n,
  manageRoles: 1n << 28n
} as const;

type DiscordUser = { id: string };
type DiscordMember = { roles: string[] };
type DiscordRole = { id: string; permissions: string };

export async function getAntiBanConfig(botId: string, guildId: string) {
  const { antiBanConfigs, botGuildConfigs } = await getMongoCollections();
  const stored = await antiBanConfigs.findOne({ botId, guildId });
  if (stored) return toConfigDto(stored);

  const legacy = await botGuildConfigs.findOne({ botId, guildId });
  const legacyConfig = legacy?.modules?.["anti-ban"] as Record<string, unknown> | undefined;
  return {
    id: null,
    botId,
    guildId,
    ...normalizeLegacyConfig(legacyConfig),
    createdAt: null,
    updatedAt: legacy?.updatedAt?.toISOString() ?? null
  };
}

export async function saveAntiBanConfig(botId: string, guildId: string, input: AntiBanConfigInput) {
  const { antiBanConfigs, botGuildConfigs } = await getMongoCollections();
  const now = new Date();
  await antiBanConfigs.updateOne(
    { botId, guildId },
    {
      $set: { ...input, updatedAt: now },
      $setOnInsert: { _id: randomUUID(), botId, guildId, createdAt: now }
    },
    { upsert: true }
  );
  await botGuildConfigs.updateOne(
    { botId, guildId },
    { $set: { "modules.anti-ban": input, updatedAt: now } }
  );
  const saved = await antiBanConfigs.findOne({ botId, guildId });
  if (!saved) throw new Error("A configuração Anti Ban não foi persistida.");
  return toConfigDto(saved);
}

export async function listAntiBanLogs(botId: string, guildId: string, limit = 50) {
  const { antiBanLogs } = await getMongoCollections();
  const logs = await antiBanLogs.find({ botId, guildId }).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(100, limit))).toArray();
  return logs.map(toLogDto);
}

export async function createAntiBanLog(input: Omit<MongoAntiBanLog, "_id" | "createdAt">) {
  const { antiBanLogs } = await getMongoCollections();
  const record: MongoAntiBanLog = { _id: randomUUID(), createdAt: new Date(), ...input };
  await antiBanLogs.insertOne(record);
  return toLogDto(record);
}

export async function getAntiBanReadiness(botId: string, guildId: string) {
  const token = await getDevBotToken(botId);
  if (!token) return unavailableReadiness("Token oficial do bot não está disponível.");
  try {
    const bot = await discordRequest<DiscordUser>("/users/@me", token);
    const [member, roles] = await Promise.all([
      discordRequest<DiscordMember>(`/guilds/${guildId}/members/${bot.id}`, token),
      discordRequest<DiscordRole[]>(`/guilds/${guildId}/roles`, token)
    ]);
    const roleIds = new Set([guildId, ...member.roles]);
    const permissions = roles
      .filter((role) => roleIds.has(role.id))
      .reduce((total, role) => total | BigInt(role.permissions), 0n);
    const administrator = hasPermission(permissions, PERMISSION_FLAGS.administrator);
    const checks = {
      administrator,
      banMembers: administrator || hasPermission(permissions, PERMISSION_FLAGS.banMembers),
      kickMembers: administrator || hasPermission(permissions, PERMISSION_FLAGS.kickMembers),
      manageRoles: administrator || hasPermission(permissions, PERMISSION_FLAGS.manageRoles),
      viewAuditLog: administrator || hasPermission(permissions, PERMISSION_FLAGS.viewAuditLog)
    };
    const missingPermissions = [
      !checks.administrator ? "Administrador" : null,
      !checks.banMembers ? "Banir membros" : null,
      !checks.kickMembers ? "Expulsar membros" : null,
      !checks.manageRoles ? "Gerenciar cargos" : null,
      !checks.viewAuditLog ? "Ver registro de auditoria" : null
    ].filter((value): value is string => Boolean(value));
    return { botId, guildId, checks, missingPermissions, ready: missingPermissions.length === 0, error: null };
  } catch (error) {
    return unavailableReadiness(error instanceof Error ? error.message : String(error));
  }

  function unavailableReadiness(error: string) {
    return {
      botId,
      guildId,
      checks: { administrator: false, banMembers: false, kickMembers: false, manageRoles: false, viewAuditLog: false },
      missingPermissions: ["Administrador", "Banir membros", "Expulsar membros", "Gerenciar cargos", "Ver registro de auditoria"],
      ready: false,
      error
    };
  }
}

export async function sendAntiBanTest(botId: string, guildId: string) {
  const [config, readiness, token] = await Promise.all([
    getAntiBanConfig(botId, guildId),
    getAntiBanReadiness(botId, guildId),
    getDevBotToken(botId)
  ]);
  if (!config.logChannelId) throw Object.assign(new Error("Selecione um canal de logs antes de testar."), { statusCode: 400 });
  if (!token) throw Object.assign(new Error("Token oficial do bot indisponível."), { statusCode: 409 });

  await discordRequest(`/channels/${config.logChannelId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      embeds: [{
        color: readiness.ready ? 0x7c3aed : 0xef4444,
        title: "🛡️ Teste do Sistema Anti Ban",
        description: readiness.ready
          ? "A proteção está pronta para monitorar este servidor."
          : `Teste recebido, mas faltam permissões: ${readiness.missingPermissions.join(", ")}.`,
        fields: [
          { name: "Servidor", value: guildId, inline: true },
          { name: "Bot", value: botId, inline: true },
          { name: "Status", value: readiness.ready ? "Pronto" : "Configuração incompleta", inline: true }
        ],
        timestamp: new Date().toISOString()
      }],
      allowed_mentions: { parse: [] }
    })
  });
  return { delivered: true, readiness };
}

function normalizeLegacyConfig(config?: Record<string, unknown>): AntiBanConfigInput {
  if (!config) return { ...DEFAULT_CONFIG };
  return {
    ...DEFAULT_CONFIG,
    // Legacy generic configs were never a real protection runtime. Require an explicit save in the dedicated panel.
    enabled: false,
    banLimit: readNumber(config.banLimit, DEFAULT_CONFIG.banLimit),
    kickLimit: readNumber(config.kickLimit, DEFAULT_CONFIG.kickLimit),
    timeWindow: readNumber(config.timeWindow, DEFAULT_CONFIG.timeWindow),
    logChannelId: readNullableString(config.logChannelId),
    whitelistUsers: readStringArray(config.whitelistUsers),
    whitelistRoles: readStringArray(config.whitelistRoles),
    whitelistRoleMode: config.whitelistRoleMode === "log_only" ? "log_only" : "ignore",
    protectedRoles: readStringArray(config.protectedRoles),
    actionOnTrigger: readAction(config.actionOnTrigger),
    autoRecovery: readRecovery(config.autoRecovery)
  };
}

function toConfigDto(config: MongoAntiBanConfig) {
  return { id: config._id, ...config, _id: undefined, createdAt: config.createdAt.toISOString(), updatedAt: config.updatedAt.toISOString() };
}

function toLogDto(log: MongoAntiBanLog) {
  return { id: log._id, ...log, _id: undefined, createdAt: log.createdAt.toISOString() };
}

async function discordRequest<T = unknown>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { authorization: `Bot ${token}`, "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord respondeu HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function hasPermission(value: bigint, flag: bigint) { return (value & flag) === flag; }
function readNumber(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function readNullableString(value: unknown) { return typeof value === "string" && value ? value : null; }
function readStringArray(value: unknown) { return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : []; }
function readAction(value: unknown): MongoAntiBanAction {
  return ["log_only", "remove_admin_roles", "kick_executor", "ban_executor", "remove_dangerous_permissions", "block_future_actions"].includes(String(value))
    ? value as MongoAntiBanAction : DEFAULT_CONFIG.actionOnTrigger;
}
function readRecovery(value: unknown): MongoAntiBanRecovery {
  return ["alert_only", "unban", "restore_permissions"].includes(String(value)) ? value as MongoAntiBanRecovery : DEFAULT_CONFIG.autoRecovery;
}
