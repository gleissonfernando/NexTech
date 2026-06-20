import { SlashCommandBuilder } from "discord.js";
import { emojiClonePanelPayload } from "../services/emojiCloneService";
import type { BotCommand } from "../types";

export const emojiClonerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("emoji-cloner")
    .setDescription("Publica o painel de clonagem de emojis.")
    .addSubcommand((subcommand) => subcommand
      .setName("painel")
      .setDescription("Envia o painel Components V2 no canal atual.")),
  moduleId: "emoji-cloner",
  async execute(interaction) {
    await interaction.reply(emojiClonePanelPayload(false));
  }
};
