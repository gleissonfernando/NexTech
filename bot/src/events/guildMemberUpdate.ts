import type { GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { logRoleChange } from "../services/logService";
import { applyAutomaticRoles } from "../services/roleService";
import type { BotContext } from "../types";

export async function handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember, context: BotContext) {
  const welcomeEnabled = isBotModuleEnabled("welcome");
  const rolesEnabled = isBotModuleEnabled("roles");
  const tasks: Promise<unknown>[] = [];

  if (oldMember.pending && !newMember.pending && (welcomeEnabled || rolesEnabled)) {
    tasks.push(applyAutomaticRoles(context, newMember, rolesEnabled));
  }

  if (!isBotModuleEnabled("logs")) {
    await Promise.allSettled(tasks);
    return;
  }

  const added = newMember.roles.cache
    .filter((role) => !oldMember.roles.cache.has(role.id))
    .map((role) => role.name);
  const removed = oldMember.roles.cache
    .filter((role) => !newMember.roles.cache.has(role.id))
    .map((role) => role.name);

  tasks.push(logRoleChange(context, newMember, added, removed));

  await Promise.allSettled(tasks);
}
