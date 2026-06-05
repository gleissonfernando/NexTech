import type { GuildMember } from "discord.js";
import { logRoleChange } from "../services/logService";
import type { BotContext } from "../types";

export async function handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember, context: BotContext) {
  const added = newMember.roles.cache
    .filter((role) => !oldMember.roles.cache.has(role.id))
    .map((role) => role.name);
  const removed = oldMember.roles.cache
    .filter((role) => !newMember.roles.cache.has(role.id))
    .map((role) => role.name);

  await logRoleChange(context, newMember, added, removed);
}
