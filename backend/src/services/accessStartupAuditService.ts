import { getMongoCollections, type MongoGuildSettings } from "../database/mongo";
import { areGuildRoles } from "./discordOptionsService";
import { getDevBotToken } from "./devBotService";
import { createLog } from "./logService";
import { normalizeDashboardAccessLevel, type DashboardAccessLevel } from "./dashboardPermissionService";

type AuditCorrection = {
  botId: string | null;
  disabled?: boolean;
  guildId: string;
  removedRoleIds: string[];
  retainedRoleIds: string[];
};

export async function runAccessControlStartupAudit() {
  const { guildSettings } = await getMongoCollections();
  const settings = await guildSettings
    .find({
      verificationEnabled: true
    })
    .toArray();
  const corrections: AuditCorrection[] = [];

  for (const item of settings) {
    const correction = await auditGuildAccessSettings(item);

    if (correction) {
      corrections.push(correction);
    }
  }

  if (corrections.length) {
    console.log(`[access-audit] ${corrections.length} configuracao(oes) de acesso corrigida(s).`);
  } else {
    console.log("[access-audit] configuracoes de acesso verificadas sem inconsistencias.");
  }

  return corrections;
}

async function auditGuildAccessSettings(settings: MongoGuildSettings): Promise<AuditCorrection | null> {
  const roleIds = normalizeRoleIds(
    Array.isArray(settings.verificationRoleIds) && settings.verificationRoleIds.length
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );
  const rolePermissions = normalizeRolePermissions(settings.dashboardRolePermissions ?? {}, roleIds);
  const userPermissions = normalizeUserPermissions(settings.dashboardUserPermissions ?? {});
  const botId = normalizeBotId(settings.botId);
  const update: Partial<MongoGuildSettings> = {
    verificationRoleId: roleIds[0] ?? null,
    verificationRoleIds: roleIds,
    dashboardRolePermissions: rolePermissions,
    dashboardUserPermissions: userPermissions,
    updatedAt: new Date()
  };

  if (!roleIds.length && !Object.keys(userPermissions).length) {
    await persistAuditCorrection(settings, {
      ...update,
      verificationEnabled: false
    });
    await writeStartupAuditLog({
      botId,
      disabled: true,
      guildId: settings.guildId,
      removedRoleIds: [],
      retainedRoleIds: []
    });

    return {
      botId,
      disabled: true,
      guildId: settings.guildId,
      removedRoleIds: [],
      retainedRoleIds: []
    };
  }

  if (!botId) {
    await persistAuditCorrection(settings, update);
    return null;
  }

  const botToken = await getDevBotToken(botId).catch(() => null);

  if (!botToken) {
    await persistAuditCorrection(settings, update);
    return null;
  }

  const retainedRoleIds: string[] = [];
  const removedRoleIds: string[] = [];

  for (const roleId of roleIds) {
    if (await areGuildRoles(settings.guildId, [roleId], botToken)) {
      retainedRoleIds.push(roleId);
    } else {
      removedRoleIds.push(roleId);
    }
  }

  if (!removedRoleIds.length) {
    await persistAuditCorrection(settings, update);
    return null;
  }

  const nextRolePermissions = normalizeRolePermissions(rolePermissions, retainedRoleIds);
  const hasDirectUsers = Object.keys(userPermissions).length > 0;
  await persistAuditCorrection(settings, {
    verificationEnabled: retainedRoleIds.length > 0 || hasDirectUsers,
    verificationRoleId: retainedRoleIds[0] ?? null,
    verificationRoleIds: retainedRoleIds,
    dashboardRolePermissions: nextRolePermissions,
    dashboardUserPermissions: userPermissions,
    updatedAt: new Date()
  });
  await writeStartupAuditLog({
    botId,
    disabled: retainedRoleIds.length === 0 && !hasDirectUsers,
    guildId: settings.guildId,
    removedRoleIds,
    retainedRoleIds
  });

  return {
    botId,
    disabled: retainedRoleIds.length === 0 && !hasDirectUsers,
    guildId: settings.guildId,
    removedRoleIds,
    retainedRoleIds
  };
}

async function persistAuditCorrection(settings: MongoGuildSettings, update: Partial<MongoGuildSettings>) {
  const { guildSettings } = await getMongoCollections();
  await guildSettings.updateOne(
    {
      _id: settings._id
    },
    {
      $set: update
    }
  );
}

async function writeStartupAuditLog(correction: AuditCorrection) {
  await createLog({
    botId: correction.botId,
    guildId: correction.guildId,
    userId: null,
    type: "access.startup_audit",
    message: correction.disabled
      ? "Auditoria de acesso desativou liberacao sem cargos validos."
      : "Auditoria de acesso removeu cargos invalidos da liberacao.",
    metadata: {
      checkedAt: new Date().toISOString(),
      disabled: correction.disabled === true,
      removedRoleIds: correction.removedRoleIds,
      retainedRoleIds: correction.retainedRoleIds
    }
  }).catch((error) => {
    console.warn("[access-audit] nao foi possivel registrar log:", error instanceof Error ? error.message : error);
  });
}

function normalizeRoleIds(roleIds: string[]) {
  return [...new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean))];
}

function normalizeRolePermissions(value: Record<string, unknown>, roleIds: string[]) {
  const permissions: Record<string, DashboardAccessLevel> = {};

  for (const roleId of roleIds) {
    permissions[roleId] = normalizeDashboardAccessLevel(value[roleId], "admin");
  }

  return permissions;
}

function normalizeUserPermissions(value: Record<string, unknown>) {
  const permissions: Record<string, DashboardAccessLevel> = {};

  for (const [userId, level] of Object.entries(value)) {
    const normalizedUserId = userId.trim();

    if (/^\d{5,32}$/.test(normalizedUserId)) {
      permissions[normalizedUserId] = normalizeDashboardAccessLevel(level, "basic");
    }
  }

  return permissions;
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}
