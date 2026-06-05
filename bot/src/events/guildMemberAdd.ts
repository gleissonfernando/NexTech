import type { GuildMember } from "discord.js";
import { logMemberJoin } from "../services/logService";
import { applyAutomaticRoles } from "../services/roleService";
import { sendWelcomeMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberAdd(member: GuildMember, context: BotContext) {
  await Promise.allSettled([
    logMemberJoin(context, member),
    applyAutomaticRoles(context, member),
    sendWelcomeMessage(context, member)
  ]);
}
