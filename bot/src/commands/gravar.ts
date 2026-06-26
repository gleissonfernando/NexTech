import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import {
  handleVoiceRecordStartCommand,
  handleVoiceRecordStopCommand
} from "../services/voiceRecorderService";

export const gravarCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("gravar")
    .setDescription("Gerencia gravacoes de canais de voz.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("iniciar")
        .setDescription("Inicia a gravação do canal de voz em que você está.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("parar")
        .setDescription("Encerra a gravacao de voz em andamento.")
    ),
  moduleId: "voice-recorder",
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "iniciar") {
      await handleVoiceRecordStartCommand(interaction, context);
      return;
    }

    await handleVoiceRecordStopCommand(interaction, context);
  }
};
