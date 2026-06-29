import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../types";
import { handleMusicSlashCommand } from "../music/musicService";

type MusicAction = Parameters<typeof handleMusicSlashCommand>[2];

function command(data: BotCommand["data"], action: MusicAction): BotCommand {
  return {
    data,
    moduleId: "music",
    execute: (interaction, context) => handleMusicSlashCommand(interaction, context, action)
  };
}

export const musicCommands: BotCommand[] = [
  command(
    new SlashCommandBuilder().setName("play").setDescription("Toca uma URL ou pesquisa uma música.")
      .addStringOption((option) => option.setName("query").setDescription("URL ou nome da música").setRequired(true).setMaxLength(500)),
    "play"
  ),
  command(new SlashCommandBuilder().setName("pause").setDescription("Pausa a música atual."), "pause"),
  command(new SlashCommandBuilder().setName("resume").setDescription("Continua a música pausada."), "resume"),
  command(new SlashCommandBuilder().setName("skip").setDescription("Pula a música atual."), "skip"),
  command(new SlashCommandBuilder().setName("stop").setDescription("Para a reprodução e limpa toda a fila."), "stop"),
  command(new SlashCommandBuilder().setName("queue").setDescription("Mostra a fila de músicas."), "queue"),
  command(new SlashCommandBuilder().setName("clearqueue").setDescription("Limpa as próximas músicas da fila."), "clearqueue"),
  command(new SlashCommandBuilder().setName("nowplaying").setDescription("Mostra a música que está tocando."), "nowplaying"),
  command(
    new SlashCommandBuilder().setName("volume").setDescription("Altera o volume do player.")
      .addIntegerOption((option) => option.setName("value").setDescription("Volume de 10 a 100").setRequired(true).setMinValue(10).setMaxValue(100)),
    "volume"
  ),
  command(new SlashCommandBuilder().setName("shuffle").setDescription("Embaralha as próximas músicas."), "shuffle"),
  command(new SlashCommandBuilder().setName("loop").setDescription("Alterna o modo de repetição."), "loop")
];
