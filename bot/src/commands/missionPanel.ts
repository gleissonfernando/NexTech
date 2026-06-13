import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import {
  handleMissionCancelCommand,
  handleMissionCompleteCommand,
  handleMissionCreateCommand,
  handleMissionPanelPublishCommand,
  handleMissionStartCommand
} from "../services/missionToolsService";

export const missionPanelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("mission-panel")
    .setDescription("Gerencia o painel Mission Tools.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enviar")
        .setDescription("Publica ou atualiza o painel Mission Tools configurado.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("criar")
        .setDescription("Cria uma nova missao.")
        .addStringOption((option) =>
          option
            .setName("titulo")
            .setDescription("Titulo da missao.")
            .setMaxLength(120)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("descricao")
            .setDescription("Descricao da missao.")
            .setMaxLength(1000)
        )
        .addIntegerOption((option) =>
          option
            .setName("limite")
            .setDescription("Limite de participantes. Use 0 para sem limite.")
            .setMaxValue(500)
            .setMinValue(0)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("iniciar")
        .setDescription("Inicia a missao ativa.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("concluir")
        .setDescription("Conclui a missao ativa.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancelar")
        .setDescription("Cancela a missao ativa.")
    ),
  moduleId: "mission-tools",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "enviar") {
      await handleMissionPanelPublishCommand(interaction, context);
      return;
    }

    if (subcommand === "criar") {
      await handleMissionCreateCommand(interaction, context);
      return;
    }

    if (subcommand === "iniciar") {
      await handleMissionStartCommand(interaction, context);
      return;
    }

    if (subcommand === "concluir") {
      await handleMissionCompleteCommand(interaction, context);
      return;
    }

    await handleMissionCancelCommand(interaction, context);
  }
};
