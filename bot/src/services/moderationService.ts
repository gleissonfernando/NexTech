import type { Guild, User } from "discord.js";
import type { BotContext } from "../types";
import { logModeration } from "./logService";

export async function warnUser(context: BotContext, guild: Guild, user: User, reason: string) {
  await logModeration(context, guild.id, user, "moderation.warn", reason);
}
