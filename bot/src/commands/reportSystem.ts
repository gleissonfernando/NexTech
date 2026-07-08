import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import { openReportSystemAdmin } from "../services/reportSystemService";

function createReportSystemCommand(name: "iab" | "sistema"): BotCommand {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription("Abre o painel administrativo do Sistema de Denuncias IAB/Corregedoria."),
    execute: openReportSystemAdmin,
    moduleId: "tickets"
  };
}

export const sistemaCommand = createReportSystemCommand("sistema");
export const iabCommand = createReportSystemCommand("iab");
