import type { GuildMember, Role } from "discord.js";
import type { BotContext } from "../types";

const MAX_AUTOMATIC_ROLES = 2;

export async function applyAutomaticRoles(context: BotContext, member: GuildMember, includeBoosterRole = true) {
  if (member.user.bot) {
    return;
  }

  const settings = await context.api.getSettings(member.guild.id, member.client.user.id).catch((error) => {
    console.error(
      `[roles] nao foi possivel carregar as configuracoes de ${member.guild.name}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

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

  const roles = [...roleIds]
    .map((roleId) => member.guild.roles.cache.get(roleId))
    .filter((role): role is Role => Boolean(role?.editable));

  if (!roles.length) {
    console.warn(`[roles] nenhum cargo configurado pode ser atribuido em ${member.guild.name}.`);
    return;
  }

  try {
    await member.roles.add(roles, "Cargos automaticos via dashboard");
    console.log(`[roles] ${roles.length} cargo(s) aplicado(s) a ${member.user.tag} em ${member.guild.name}.`);
  } catch (error) {
    console.error(
      `[roles] falha ao aplicar cargos a ${member.user.tag} em ${member.guild.name}:`,
      error instanceof Error ? error.message : error
    );
  }
}
