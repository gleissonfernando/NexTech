import type { GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { logRoleChange } from "../services/logService";
import { scheduleHierarchyRefreshForMember } from "../services/fivemHierarchyService";
import { applyAutomaticRoles } from "../services/roleService";
import { handleBoosterGuildMemberUpdate } from "../services/boosterService";
import type { BotContext } from "../types";

export async function handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember, context: BotContext) {
  const welcomeEnabled = isBotModuleEnabled("welcome");
  const rolesEnabled = isBotModuleEnabled("roles");
  const tasks: Promise<unknown>[] = [];

  if (oldMember.pending && !newMember.pending && (welcomeEnabled || rolesEnabled)) {
    tasks.push(applyAutomaticRoles(context, newMember, rolesEnabled));
  }

  const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
  const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
  const added = addedRoles.map((role) => role.name);
  const removed = removedRoles.map((role) => role.name);
  const displayNameChanged = oldMember.displayName !== newMember.displayName;

  if (isBotModuleEnabled("fivem-hierarchy") && (added.length || removed.length || displayNameChanged)) {
    scheduleHierarchyRefreshForMember(newMember, context, [
      ...addedRoles.map((role) => role.id),
      ...removedRoles.map((role) => role.id)
    ]);
  }

  if (isBotModuleEnabled("logs")) {
    tasks.push(logRoleChange(context, newMember, added, removed));
  }

  if (isBotModuleEnabled("boosters")) {
    tasks.push(handleBoosterGuildMemberUpdate(oldMember, newMember, context));
  }

  await Promise.allSettled(tasks);
}
