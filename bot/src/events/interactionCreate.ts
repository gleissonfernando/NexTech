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
import { handleSafeBotWarningInteraction } from "../services/safeBotWarningService";
import { handleTemporaryVoiceInteraction } from "../services/temporaryVoiceService";
import { handleTicketPanelInteraction } from "../services/ticketPanelService";
import { handleReportSystemInteraction } from "../services/reportSystemService";
import { handleManualRegistrationInteraction } from "../services/manualRegistrationService";
import { handleFivemGoalInteraction } from "../services/fivemGoalService";
import { handleFivemFinanceInteraction } from "../services/fivemFinanceService";
import { handleFivemOrderInteraction } from "../services/fivemOrderService";
import { handleFivemHierarchyInteraction } from "../services/fivemHierarchyService";
import { handleFivemActionInteraction } from "../services/fivemActionService";
import { handlePolicePatrolInteraction } from "../services/policePatrolReportService";
import { handlePoliceHiddenChannelInteraction } from "../services/policeHiddenChannelService";
import { handleDmBarInteraction } from "../services/dmBarService";
import { handlePoliceSubpoenaInteraction } from "../services/policeSubpoenaService";
import { handleManualPaymentInteraction } from "../services/manualPaymentService";
import { handlePriceTableInteraction } from "../services/priceTableService";

export async function handleInteractionCreate(interaction: Interaction, context: BotContext) {
  try {
    await dispatchInteractionCreate(interaction, context);
  } catch (error) {
    console.error(JSON.stringify({
      action: interaction.id,
      at: new Date().toISOString(),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      guildId: interaction.guildId,
      level: "error",
      module: "interactions",
      userId: interaction.user.id
    }));
    if (!interaction.isRepliable()) return;
    const payload = { content: "Nao foi possivel concluir esta interacao.", ephemeral: true } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }
}

async function dispatchInteractionCreate(interaction: Interaction, context: BotContext) {
  if (await blockInteractionIfMaintenance(interaction)) {
    return;
  }

  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith("music_")) {
    const { handleMusicInteraction } = await import("../music/musicService.js");
    if (await handleMusicInteraction(interaction, context)) {
      return;
    }
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

  if (await handleSafeBotWarningInteraction(interaction, context)) {
    return;
  }

  if (await handleTemporaryVoiceInteraction(interaction, context)) {
    return;
  }

  if (await handleTicketPanelInteraction(interaction, context)) {
    return;
  }

  if (await handleReportSystemInteraction(interaction, context)) {
    return;
  }

  if (await handleManualRegistrationInteraction(interaction, context)) {
    return;
  }

  if (await handleFivemGoalInteraction(interaction, context)) {
    return;
  }
  if (await handleFivemFinanceInteraction(interaction, context)) return;
  if (await handleFivemOrderInteraction(interaction, context)) return;

  if (await handleFivemHierarchyInteraction(interaction, context)) {
    return;
  }
  if (await handleFivemActionInteraction(interaction, context)) return;
  if (await handlePolicePatrolInteraction(interaction, context)) return;
  if (await handlePoliceHiddenChannelInteraction(interaction, context)) return;
  if (await handleDmBarInteraction(interaction, context)) return;
  if (await handlePoliceSubpoenaInteraction(interaction, context)) return;

  if (await handlePriceTableInteraction(interaction, context)) {
    return;
  }

  if (await handleManualPaymentInteraction(interaction, context)) {
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
      content: "Comando não encontrado.",
      ephemeral: true
    });
    return;
  }

  if (command.moduleId && !isBotModuleEnabled(command.moduleId)) {
    const runtimeAccess = await context.api.getRuntimeModules().catch((error) => {
      console.warn("[bot] não foi possível recarregar módulos antes de negar comando:", error instanceof Error ? error.message : error);
      return null;
    });

    if (runtimeAccess) {
      setRuntimeEnabledModules(runtimeAccess.active ? runtimeAccess.enabledModules : [], runtimeAccess.botId);
    }
  }

  if (command.moduleId && !isBotModuleEnabled(command.moduleId)) {
    await interaction.reply({
      content: `O módulo ${command.moduleId} ainda não aparece liberado para este bot na dashboard DEV. Se acabou de ativar, reinicie o bot pelo painel DEV.`,
      ephemeral: true
    });
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (error) {
    console.error("[command]", error);

    const payload = {
      content: "Não foi possível executar esse comando.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
}
