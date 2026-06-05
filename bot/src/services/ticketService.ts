import type { Guild, User } from "discord.js";
import type { BotContext } from "../types";

export async function createTicket(context: BotContext, guild: Guild, opener: User, subject: string) {
  return context.api.createTicket({
    guildId: guild.id,
    openerId: opener.id,
    subject
  });
}
