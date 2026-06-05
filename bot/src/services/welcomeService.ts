import type { GuildMember } from "discord.js";
import type { BotContext } from "../types";

export async function sendWelcomeMessage(context: BotContext, member: GuildMember) {
  const settings = await context.api.getSettings(member.guild.id).catch(() => null);

  if (!settings?.welcomeEnabled || !settings.welcomeChannelId) {
    return;
  }

  const channel = member.guild.channels.cache.get(settings.welcomeChannelId);

  if (!channel?.isTextBased()) {
    return;
  }

  const content = (settings.welcomeMessage ?? "Bem-vindo(a), {user}!").replace("{user}", `<@${member.id}>`);
  await channel.send({
    content
  });
}
