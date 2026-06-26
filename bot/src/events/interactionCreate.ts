import type { Interaction } from "discord.js";
import { isBotModuleEnabled, setRuntimeEnabledModules } from "../config/env";
import { handleFivemFacInteraction } from "../services/fivemFacService";
import { handleGiveawayInteraction } from "../services/giveawayService";
import { blockInteractionIfMaintenance } from "../services/maintenanceService";
import { handleEmojiCloneInteraction } from "../services/emojiCloneService";
import { handleMissionToolsInteraction } from "../services/missionToolsService";
import { handleRulesInteraction } from "../services/rulesService";
import { handleServerCloneInteraction } from "../services/serverCloneService";
import { handleServerGeneratorInteraction } from "../services/serverGeneratorService";
import type { BotContext } from "../types";

export async function handleInteractionCreate(interaction: Interaction, context: BotContext) {
  if (await blockInteractionIfMaintenance(interaction)) {
    return;
  }

  if (await handleFivemFacInteraction(interaction, context)) {
    return;
  }

  if (await handleGiveawayInteraction(interaction, context)) {
    return;
  }

  if (await handleMissionToolsInteraction(interaction, context)) {
    return;
  }

  if (await handleEmojiCloneInteraction(interaction, context)) {
    return;
  }

  if (await handleServerCloneInteraction(interaction, context)) {
    return;
  }

  if (await handleServerGeneratorInteraction(interaction, context)) {
    return;
  }

  if (interaction.isButton() && await handleRulesInteraction(interaction, context)) {
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = context.commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      content: "Comando nao encontrado.",
      ephemeral: true
    });
    return;
  }

  if (command.moduleId && !isBotModuleEnabled(command.moduleId)) {
    const runtimeAccess = await context.api.getRuntimeModules().catch((error) => {
      console.warn("[bot] nao foi possivel recarregar modulos antes de negar comando:", error instanceof Error ? error.message : error);
      return null;
    });

    if (runtimeAccess) {
      setRuntimeEnabledModules(runtimeAccess.active ? runtimeAccess.enabledModules : [], runtimeAccess.botId);
    }
  }

  if (command.moduleId && !isBotModuleEnabled(command.moduleId)) {
    await interaction.reply({
      content: `O modulo ${command.moduleId} ainda nao aparece liberado para este bot na dashboard DEV. Se acabou de ativar, reinicie o bot pelo painel DEV.`,
      ephemeral: true
    });
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (error) {
    console.error("[command]", error);

    const payload = {
      content: "Nao foi possivel executar esse comando.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
}
