import { SlashCommandBuilder } from "discord.js";
import { showServerGeneratorModal } from "../services/serverGeneratorService";
import type { BotCommand } from "../types";

export const serverGeneratorCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("criar-server")
    .setDescription("Gera uma estrutura inteligente e variada para o servidor.")
    .addStringOption((option) => option
      .setName("tipo")
      .setDescription("Tipo principal do servidor")
      .setRequired(true)
      .addChoices(
        { name: "Comunidade", value: "community" },
        { name: "FiveM", value: "fivem" },
        { name: "GTA RP", value: "gta-rp" },
        { name: "Streamer", value: "streamer" },
        { name: "Gamer", value: "gamer" },
        { name: "Empresa", value: "business" },
        { name: "Loja", value: "store" },
        { name: "Bot Support", value: "bot-support" },
        { name: "Anime", value: "anime" },
        { name: "Musica", value: "music" },
        { name: "Programacao", value: "programming" },
        { name: "Estudos", value: "study" },
        { name: "Marketplace", value: "marketplace" },
        { name: "Crypto", value: "crypto" },
        { name: "Roleplay", value: "roleplay" },
        { name: "Tecnologia", value: "technology" },
        { name: "Influenciador", value: "influencer" },
        { name: "Clan", value: "clan" },
        { name: "Esports", value: "esports" },
        { name: "Personalizado", value: "custom" }
      ))
    .addStringOption((option) => option
      .setName("estilo")
      .setDescription("Estilo visual e textual")
      .setRequired(true)
      .addChoices(
        { name: "Moderno", value: "modern" },
        { name: "Minimalista", value: "minimal" },
        { name: "Elegante", value: "elegant" },
        { name: "Neon", value: "neon" },
        { name: "Cyberpunk", value: "cyberpunk" },
        { name: "Escuro", value: "dark" },
        { name: "Clean", value: "clean" },
        { name: "Premium", value: "premium" },
        { name: "Corporativo", value: "corporate" },
        { name: "Gamer", value: "gamer" }
      ))
    .addStringOption((option) => option
      .setName("idioma")
      .setDescription("Idioma das mensagens criadas")
      .setRequired(true)
      .addChoices(
        { name: "Portugues", value: "pt" },
        { name: "Ingles", value: "en" },
        { name: "Espanhol", value: "es" }
      ))
    .addStringOption((option) => option
      .setName("categorias")
      .setDescription("Quantidade de categorias")
      .setRequired(false)
      .addChoices(
        { name: "Automatico", value: "auto" },
        { name: "Personalizado", value: "custom" }
      )),
  moduleId: "server-generator",
  async execute(interaction) {
    await showServerGeneratorModal(interaction);
  }
};
