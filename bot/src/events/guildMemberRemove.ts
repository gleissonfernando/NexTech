import type { GuildMember, PartialGuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { deleteMaintenanceChannels } from "../services/databaseMaintenanceService";
import { scheduleHierarchyMemberRemoval } from "../services/fivemHierarchyService";
import { refreshFivemGoalRankingPanel } from "../services/fivemGoalService";
import { isLogsRuntimeAuthorized, logMemberLeave } from "../services/logService";
import { sendLeaveMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember, context: BotContext) {
  const tasks: Promise<unknown>[] = [];

  if (await isLogsRuntimeAuthorized(context, member.guild.id)) tasks.push(logMemberLeave(context, member));
  if (isBotModuleEnabled("leave")) tasks.push(sendLeaveMessage(context, member));
  if (isBotModuleEnabled("fivem-hierarchy")) scheduleHierarchyMemberRemoval(member.guild, context, member.id);
  if (isBotModuleEnabled("fivem-goals")) tasks.push(refreshFivemGoalRankingPanel(member.guild, context));
  tasks.push(cleanupMemberDatabaseLinks(member, context));

  await Promise.allSettled(tasks);
}

async function cleanupMemberDatabaseLinks(member: GuildMember | PartialGuildMember, context: BotContext) {
  const result = await context.api.cleanupUserLinksAfterGuildLeave(member.guild.id, member.id);
  await deleteMaintenanceChannels(context.client, context, {
    channelIds: result.channelIds,
    guildId: member.guild.id,
    reason: "Usuário saiu do servidor; limpeza automática de vinculos.",
    userId: member.id
  });
}
