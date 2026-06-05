import type { GuildMember } from "discord.js";
import type { BotContext } from "../types";

export async function applyAutomaticRoles(context: BotContext, member: GuildMember) {
  const settings = await context.api.getSettings(member.guild.id).catch(() => null);

  if (!settings?.autoRoleEnabled) {
    return;
  }

  const roleIds = new Set(settings.autoRoleIds);

  if (member.premiumSince && settings.boosterRoleId) {
    roleIds.add(settings.boosterRoleId);
  }

  if (!roleIds.size) {
    return;
  }

  await member.roles.add([...roleIds], "Cargos automaticos via dashboard");
}
