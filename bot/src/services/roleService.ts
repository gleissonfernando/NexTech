import type { Client, Guild, GuildMember, Role } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import type { BotContext } from "../types";
import { getCachedGuildSettings } from "./guildSettingsCache";
import { isRuntimeModuleAuthorized } from "./runtimeModuleGuard";

const MAX_AUTOMATIC_ROLES = 2;
const ROLE_ASSIGNMENT_ATTEMPTS = 3;
const ROLE_ASSIGNMENT_RETRY_MS = 500;
const ROLE_SYNC_ASSIGNMENT_DELAY_MS = 350;
const ROLE_SYNC_GUILD_DELAY_MS = 1_000;
const MODULE_ID = "roles";
const syncGuildsInFlight = new Set<string>();

export async function applyAutomaticRoles(context: BotContext, member: GuildMember, includeBoosterRole = true) {
  if (member.user.bot) {
    return;
  }

  if (member.pending) {
    console.log(`[roles] aguardando ${member.user.tag} concluir a verificação de entrada em ${member.guild.name}.`);
    return;
  }

  if (!(await isRuntimeModuleAuthorized(context, member.guild.id, MODULE_ID))) {
    return;
  }

  const settings = await loadSettings(context, member);

  if (!settings?.autoRoleEnabled) {
    return;
  }

  const roleIds = new Set(settings.autoRoleIds.slice(0, MAX_AUTOMATIC_ROLES));

  if (includeBoosterRole && member.premiumSince && settings.boosterRoleId) {
    roleIds.add(settings.boosterRoleId);
  }

  if (!roleIds.size) {
    return;
  }

  let roles: Role[];

  try {
    roles = await resolveAssignableRoles(member, [...roleIds]);
  } catch (error) {
    void writeRoleLog(context, member, settings.botId, "dashboard.roles.assignment_failed", "Falha ao verificar os cargos automaticos.", {
      error: errorMessage(error),
      roleIds: [...roleIds]
    });
    console.error(
      `[roles] falha ao verificar cargos em ${member.guild.name}:`,
      errorMessage(error)
    );
    return;
  }

  if (!roles.length) {
    void writeRoleLog(context, member, settings.botId, "dashboard.roles.assignment_failed", "Nenhum cargo automático pode ser atribuido.", {
      roleIds: [...roleIds]
    });
    console.warn(`[roles] nenhum cargo configurado pode ser atribuido em ${member.guild.name}.`);
    return;
  }

  const missingRoleIds = roles
    .map((role) => role.id)
    .filter((roleId) => !member.roles.cache.has(roleId));

  if (!missingRoleIds.length) {
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ROLE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    try {
      await member.roles.add(missingRoleIds, "Cargos automaticos via dashboard");

      void writeRoleLog(context, member, settings.botId, "dashboard.roles.assigned", `${missingRoleIds.length} cargo(s) automático(s) aplicado(s).`, {
        roleIds: missingRoleIds
      });
      console.log(`[roles] ${missingRoleIds.length} cargo(s) aplicado(s) a ${member.user.tag} em ${member.guild.name}.`);
      return;
    } catch (error) {
      lastError = error;

      if (attempt < ROLE_ASSIGNMENT_ATTEMPTS) {
        await delay(ROLE_ASSIGNMENT_RETRY_MS);
      }
    }
  }

  void writeRoleLog(context, member, settings.botId, "dashboard.roles.assignment_failed", "Não foi possível aplicar os cargos automaticos.", {
    error: errorMessage(lastError),
    roleIds: missingRoleIds
  });
  console.error(
    `[roles] falha ao aplicar cargos a ${member.user.tag} em ${member.guild.name}:`,
    errorMessage(lastError)
  );
}

export async function syncAutomaticRolesAfterReady(client: Client, context: BotContext, reason = "ready") {
  if (!client.user || !isBotModuleEnabled(MODULE_ID)) {
    return;
  }

  await delay(2_000);

  for (const guild of client.guilds.cache.values()) {
    await syncAutomaticRolesForGuild(context, guild, reason).catch((error) => {
      console.warn(`[roles] falha na sincronização pós-redeploy em ${guild.name}:`, errorMessage(error));
    });
    await delay(ROLE_SYNC_GUILD_DELAY_MS);
  }
}

async function syncAutomaticRolesForGuild(context: BotContext, guild: Guild, reason: string) {
  if (syncGuildsInFlight.has(guild.id)) {
    return;
  }

  syncGuildsInFlight.add(guild.id);
  const startedAt = Date.now();
  const stats = {
    assignedMembers: 0,
    assignedRoles: 0,
    failedMembers: 0,
    skippedBots: 0,
    skippedPending: 0,
    totalMembers: 0
  };
  const failures: Array<{ error: string; userId: string }> = [];

  try {
    if (!(await isRuntimeModuleAuthorized(context, guild.id, MODULE_ID))) {
      return;
    }

    const settings = await getCachedGuildSettings(context, guild.id, guild.client.user.id).catch((error) => {
      console.warn(`[roles] não foi possível carregar configurações para sincronização em ${guild.name}:`, errorMessage(error));
      return null;
    });

    if (!settings?.autoRoleEnabled) {
      return;
    }

    const baseRoleIds = settings.autoRoleIds.slice(0, MAX_AUTOMATIC_ROLES);
    const configuredRoleIds = [...baseRoleIds, settings.boosterRoleId].filter((roleId): roleId is string => Boolean(roleId));

    if (!configuredRoleIds.length) {
      return;
    }

    await writeSyncLog(context, guild, settings.botId, "dashboard.roles.sync_started", "Sincronização pós-redeploy de cargos automáticos iniciada.", {
      configuredRoleIds,
      reason
    });

    await guild.roles.fetch().catch(() => null);
    await guild.members.fetchMe().catch(() => null);

    const baseRoles = await resolveAssignableGuildRoles(guild, baseRoleIds);
    const boosterRole = settings.boosterRoleId
      ? (await resolveAssignableGuildRoles(guild, [settings.boosterRoleId]))[0] ?? null
      : null;

    if (!baseRoles.length && !boosterRole) {
      await writeSyncLog(context, guild, settings.botId, "dashboard.roles.sync_completed", "Sincronização encerrada: nenhum cargo configurado pode ser atribuído pelo bot.", {
        configuredRoleIds,
        durationMs: Date.now() - startedAt,
        stats
      });
      return;
    }

    const members = await guild.members.fetch();
    stats.totalMembers = members.size;

    for (const member of members.values()) {
      if (member.user.bot) {
        stats.skippedBots += 1;
        continue;
      }

      if (member.pending) {
        stats.skippedPending += 1;
        continue;
      }

      const expectedRoleIds = new Set(baseRoles.map((role) => role.id));

      if (member.premiumSince && boosterRole) {
        expectedRoleIds.add(boosterRole.id);
      }

      const missingRoleIds = [...expectedRoleIds].filter((roleId) => !member.roles.cache.has(roleId));

      if (!missingRoleIds.length) {
        continue;
      }

      try {
        await member.roles.add(missingRoleIds, "Sincronização pós-redeploy: cargos automáticos ausentes");
        stats.assignedMembers += 1;
        stats.assignedRoles += missingRoleIds.length;
        void writeRoleLog(context, member, settings.botId, "dashboard.roles.sync_assigned", `${missingRoleIds.length} cargo(s) automático(s) sincronizado(s) após retorno do bot.`, {
          roleIds: missingRoleIds
        });
        await delay(ROLE_SYNC_ASSIGNMENT_DELAY_MS);
      } catch (error) {
        stats.failedMembers += 1;
        if (failures.length < 10) {
          failures.push({ error: errorMessage(error), userId: member.id });
        }
      }
    }

    await writeSyncLog(context, guild, settings.botId, "dashboard.roles.sync_completed", "Sincronização pós-redeploy de cargos automáticos concluída.", {
      durationMs: Date.now() - startedAt,
      failures,
      stats
    });
    console.log(`[roles] sincronização pós-redeploy concluída em ${guild.name}: ${stats.assignedMembers} membro(s), ${stats.assignedRoles} cargo(s).`);
  } catch (error) {
    await writeSyncLog(context, guild, null, "dashboard.roles.sync_failed", "Falha na sincronização pós-redeploy de cargos automáticos.", {
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
      stats
    });
    throw error;
  } finally {
    syncGuildsInFlight.delete(guild.id);
  }
}

async function loadSettings(context: BotContext, member: GuildMember) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ROLE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    try {
      return await getCachedGuildSettings(context, member.guild.id, member.client.user.id);
    } catch (error) {
      lastError = error;

      if (attempt < ROLE_ASSIGNMENT_ATTEMPTS) {
        await delay(ROLE_ASSIGNMENT_RETRY_MS);
      }
    }
  }

  console.error(
    `[roles] não foi possível carregar as configuracoes de ${member.guild.name}:`,
    errorMessage(lastError)
  );
  return null;
}

async function resolveAssignableRoles(member: GuildMember, roleIds: string[]) {
  if (!member.guild.members.me) {
    await member.guild.members.fetchMe();
  }

  const missingFromCache = roleIds.filter((roleId) => !member.guild.roles.cache.has(roleId));

  if (missingFromCache.length) {
    await member.guild.roles.fetch();
  }

  const availableRoles = member.guild.roles.cache;

  return roleIds
    .map((roleId) => availableRoles.get(roleId))
    .filter((role): role is Role => Boolean(role?.editable));
}

async function resolveAssignableGuildRoles(guild: Guild, roleIds: string[]) {
  if (!guild.members.me) {
    await guild.members.fetchMe();
  }

  const missingFromCache = roleIds.filter((roleId) => !guild.roles.cache.has(roleId));

  if (missingFromCache.length) {
    await guild.roles.fetch();
  }

  return roleIds
    .map((roleId) => guild.roles.cache.get(roleId))
    .filter((role): role is Role => Boolean(role?.editable));
}

async function writeRoleLog(
  context: BotContext,
  member: GuildMember,
  botId: string | null,
  type: string,
  message: string,
  metadata: Record<string, unknown>
) {
  await context.api.postLog({
    botId,
    guildId: member.guild.id,
    userId: member.id,
    type,
    message,
    metadata
  }).catch(() => null);
}

async function writeSyncLog(
  context: BotContext,
  guild: Guild,
  botId: string | null,
  type: string,
  message: string,
  metadata: Record<string, unknown>
) {
  await context.api.postLog({
    botId,
    guildId: guild.id,
    type,
    message,
    metadata
  }).catch(() => null);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
