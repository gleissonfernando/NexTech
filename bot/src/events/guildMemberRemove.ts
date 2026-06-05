import type { GuildMember } from "discord.js";
import { logMemberLeave } from "../services/logService";
import type { BotContext } from "../types";

export async function handleGuildMemberRemove(member: GuildMember, context: BotContext) {
  await logMemberLeave(context, member);
}
