import type { GuildMember } from "discord.js";
import { isBotModuleEnabled } from "../config/env";
import { enforceAccountAgeSecurity } from "../services/accountAgeSecurityService";
import { logMemberJoin } from "../services/logService";
import { isMaintenanceModeActive } from "../services/maintenanceService";
import { applyAutomaticRoles } from "../services/roleService";
import { handleSelfBotProtectionMemberAdd } from "../services/selfBotProtectionService";
import { scheduleHierarchyRefreshForMember } from "../services/fivemHierarchyService";
import { handleFivemFacMemberAdd } from "../services/fivemFacService";
import { sendWelcomeMessage } from "../services/welcomeService";
import type { BotContext } from "../types";

export async function handleGuildMemberAdd(member: GuildMember, context: BotContext) {
  const welcomeEnabled = isBotModuleEnabled("welcome");
  const rolesEnabled = isBotModuleEnabled("roles");
  const automaticRolesTask = welcomeEnabled || rolesEnabled
    ? applyAutomaticRoles(context, member, rolesEnabled).catch((error) => {
        console.warn("[roles] falha ao aplicar cargos automaticos no evento de entrada:", error instanceof Error ? error.message : error);
      })
    : null;

  if (isMaintenanceModeActive()) {
    await automaticRolesTask;
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
  if (automaticRolesTask) tasks.push(automaticRolesTask);
  if (welcomeEnabled) tasks.push(sendWelcomeMessage(context, member));
  if (isBotModuleEnabled("fivem-fac")) tasks.push(handleFivemFacMemberAdd(member, context));
  if (isBotModuleEnabled("fivem-hierarchy")) scheduleHierarchyRefreshForMember(member, context);

  await Promise.allSettled(tasks);
}
