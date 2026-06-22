import type { GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { enforceAccountAgeSecurity } from "../services/accountAgeSecurityService";
import { logMemberJoin } from "../services/logService";
import { isMaintenanceModeActive } from "../services/maintenanceService";
import { applyAutomaticRoles } from "../services/roleService";
import { handleSelfBotProtectionMemberAdd } from "../services/selfBotProtectionService";
import { sendWelcomeMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberAdd(member: GuildMember, context: BotContext) {
  const welcomeEnabled = isBotModuleEnabled("welcome");
  const rolesEnabled = isBotModuleEnabled("roles");

  if (isMaintenanceModeActive()) {
    if (welcomeEnabled || rolesEnabled) {
      await applyAutomaticRoles(context, member, rolesEnabled);
    }
    return;
  }

  const selfBotBlocked = await handleSelfBotProtectionMemberAdd(member, context);

  if (selfBotBlocked) {
    return;
  }

  const blocked = await enforceAccountAgeSecurity(context, member);

  if (blocked) {
    return;
  }

  const tasks: Promise<unknown>[] = [];

  if (isBotModuleEnabled("logs")) tasks.push(logMemberJoin(context, member));
  if (welcomeEnabled || rolesEnabled) tasks.push(applyAutomaticRoles(context, member, rolesEnabled));
  if (welcomeEnabled) tasks.push(sendWelcomeMessage(context, member));

  await Promise.allSettled(tasks);
}
