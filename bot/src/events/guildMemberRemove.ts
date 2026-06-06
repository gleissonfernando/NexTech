import type { GuildMember } from "discord.js";
import { logMemberLeave } from "../services/logService";
import { sendLeaveMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberRemove(member: GuildMember, context: BotContext) {
  await Promise.allSettled([
    logMemberLeave(context, member),
    sendLeaveMessage(context, member)
  ]);
}
