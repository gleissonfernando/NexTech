import { SlashCommandBuilder } from "discord.js";
import { serverClonePanelPayload } from "../services/serverCloneService";
import type { BotCommand } from "../types";

export const serverClonerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("clonar-servidor")
    .setDescription("Clona somente a estrutura autorizada entre dois servidores."),
  moduleId: "server-cloner",
  async execute(interaction) {
    await interaction.reply(serverClonePanelPayload(true));
  }
};
