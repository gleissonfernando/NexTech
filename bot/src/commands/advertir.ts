import { SlashCommandBuilder } from "discord.js";
import { prepareSafeBotWarning } from "../services/safeBotWarningService";
import type { BotCommand } from "../types";

export const advertirCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("advertir")
    .setDescription("Open a confirmation panel for a configured Safe Bot warning.")
    .addUserOption((option) => option.setName("usuario").setDescription("Member who will receive the warning.").setRequired(true))
    .addStringOption((option) => option.setName("motivo").setDescription("Warning reason; otherwise the configured default is used.").setMaxLength(500)),
  moduleId: "safe-bot",
  execute: prepareSafeBotWarning
};
