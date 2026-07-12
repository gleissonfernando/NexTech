import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type Role,
  type TextChannel
} from "discord.js";
import { createHash } from "node:crypto";
import { isBotModuleEnabled } from "../config/env";
import type { SystemEmojiKey } from "../config/systemEmojis";
import type { BotContext } from "../types";
import { getRuntimeModuleAuthorization, runtimeModuleDenialMessage } from "./runtimeModuleGuard";
import { systemEmojiText } from "./systemEmojiService";

const MODULE_ID = "server-generator";
const CUSTOM_ID_PREFIX = "server_generator_modal";

type ServerType =
  | "community"
  | "fivem"
  | "gta-rp"
  | "streamer"
  | "gamer"
  | "business"
  | "store"
  | "bot-support"
  | "anime"
  | "music"
  | "programming"
  | "study"
  | "marketplace"
  | "crypto"
  | "roleplay"
  | "technology"
  | "influencer"
  | "clan"
  | "esports"
  | "custom";

type GeneratorInput = {
  categoryMode: "auto" | "custom";
  categoryTarget: number | null;
  language: "pt" | "en" | "es";
  objective: string;
  serverName: string;
  style: string;
  type: ServerType;
};

type GeneratedCategory = {
  channels: GeneratedChannel[];
  name: string;
  privateStaff?: boolean;
};

type GeneratedChannel = {
  name: string;
  topic: string;
  type: ChannelType.GuildText | ChannelType.GuildVoice;
};

type GeneratedRole = {
  color: number;
  hoist?: boolean;
  name: string;
  permissions?: bigint;
};

type ServerPlan = {
  categories: GeneratedCategory[];
  panels: Array<{ body: string; channelHint: string; title: string }>;
  roles: GeneratedRole[];
  summary: string;
};

type RandomSource = {
  int(max: number): number;
  pick<T>(values: readonly T[]): T;
  shuffle<T>(values: readonly T[]): T[];
};

const typeProfiles: Record<ServerType, { categorySeeds: string[]; channelSeeds: string[]; roleSeeds: string[]; systems: string[] }> = {
  community: {
    categorySeeds: ["boas-vindas", "comunidade", "social", "midia", "eventos", "suporte", "staff"],
    channelSeeds: ["regras", "avisos", "chat-geral", "apresentacoes", "memes", "sugestoes", "tickets", "logs"],
    roleSeeds: ["Fundador", "Administrador", "Moderador", "Parceiro", "VIP", "Membro"],
    systems: ["boas-vindas", "sugestoes", "tickets", "eventos"]
  },
  fivem: {
    categorySeeds: ["informacoes", "cidade", "whitelist", "faccoes", "policia", "mecanica", "eventos", "staff", "logs"],
    channelSeeds: ["regras", "avisos", "whitelist", "denuncias", "suporte", "clips", "radio", "patrulha", "oficina", "logs"],
    roleSeeds: ["Fundador", "Prefeitura", "Staff", "Policia", "Mecanico", "Faccoes", "Cidadao"],
    systems: ["whitelist", "denuncias", "tickets", "logs", "faccoes"]
  },
  "gta-rp": {
    categorySeeds: ["entrada", "cidade", "organizacoes", "departamentos", "midia", "voz", "staff"],
    channelSeeds: ["regras", "avisos", "passaporte", "denuncias", "eventos", "clips", "geral", "logs"],
    roleSeeds: ["Fundador", "Direcao", "Admin", "Suporte", "Policia", "Hospital", "Cidadao"],
    systems: ["whitelist", "suporte", "denuncias", "eventos"]
  },
  streamer: {
    categorySeeds: ["live", "comunidade", "clips", "beneficios", "eventos", "staff"],
    channelSeeds: ["avisos-live", "chat", "clips", "memes", "agenda", "subscribers", "parcerias"],
    roleSeeds: ["Streamer", "Editor", "Moderador", "Subscriber", "VIP", "Viewer"],
    systems: ["avisos de live", "clips", "cargos", "eventos"]
  },
  gamer: {
    categorySeeds: ["lobby", "squads", "ranked", "midia", "torneios", "suporte"],
    channelSeeds: ["regras", "procurar-time", "chat", "clips", "partidas", "vitorias", "voz-1", "voz-2"],
    roleSeeds: ["Lider", "Capitao", "Coach", "Player", "Streamer", "Membro"],
    systems: ["squads", "ranked", "torneios", "clips"]
  },
  business: {
    categorySeeds: ["recepcao", "operacao", "projetos", "clientes", "equipe", "gestao"],
    channelSeeds: ["avisos", "reunioes", "tarefas", "relatorios", "suporte", "agenda", "privado"],
    roleSeeds: ["CEO", "Gerente", "Coordenador", "Suporte", "Cliente", "Equipe"],
    systems: ["suporte", "avisos", "projetos", "reunioes"]
  },
  store: {
    categorySeeds: ["loja", "catalogo", "atendimento", "pedidos", "clientes", "staff"],
    channelSeeds: ["produtos", "precos", "comprar", "ticket", "feedbacks", "entregas", "logs"],
    roleSeeds: ["Dono", "Gerente", "Vendedor", "Suporte", "Cliente", "VIP"],
    systems: ["tickets", "pedidos", "feedbacks", "catalogo"]
  },
  "bot-support": {
    categorySeeds: ["central", "documentacao", "suporte", "status", "comunidade", "equipe"],
    channelSeeds: ["como-usar", "updates", "bugs", "sugestoes", "tickets", "status", "logs"],
    roleSeeds: ["Developer", "Admin", "Suporte", "Tester", "Parceiro", "Usuario"],
    systems: ["tickets", "bugs", "status", "sugestoes"]
  },
  anime: {
    categorySeeds: ["entrada", "animes", "mangas", "comunidade", "eventos", "staff"],
    channelSeeds: ["regras", "lancamentos", "recomendacoes", "spoilers", "fanarts", "chat", "voz"],
    roleSeeds: ["Sensei", "Staff", "Artista", "Otaku", "VIP", "Membro"],
    systems: ["recomendacoes", "eventos", "fanart", "cargos"]
  },
  music: {
    categorySeeds: ["palco", "musicas", "playlists", "artistas", "eventos", "staff"],
    channelSeeds: ["pedidos", "playlists", "lancamentos", "voz-musica", "karaoke", "shows", "chat"],
    roleSeeds: ["Produtor", "DJ", "Artista", "Moderador", "Ouvinte", "VIP"],
    systems: ["playlists", "eventos", "palco", "cargos"]
  },
  programming: {
    categorySeeds: ["inicio", "dev", "projetos", "ajuda", "comunidade", "staff"],
    channelSeeds: ["regras", "frontend", "backend", "duvidas", "code-review", "jobs", "recursos"],
    roleSeeds: ["Tech Lead", "Developer", "Mentor", "Reviewer", "Aluno", "Membro"],
    systems: ["duvidas", "code review", "projetos", "recursos"]
  },
  study: {
    categorySeeds: ["inicio", "materias", "salas", "tarefas", "eventos", "equipe"],
    channelSeeds: ["avisos", "cronograma", "duvidas", "resumos", "provas", "sala-estudo", "biblioteca"],
    roleSeeds: ["Professor", "Monitor", "Aluno", "Veterano", "Convidado", "Membro"],
    systems: ["duvidas", "cronograma", "salas", "materiais"]
  },
  marketplace: {
    categorySeeds: ["entrada", "vendas", "compras", "negociacao", "reputacao", "staff"],
    channelSeeds: ["regras", "anuncios", "procurando", "vitrine", "feedbacks", "tickets", "alertas"],
    roleSeeds: ["Admin", "Mediador", "Vendedor", "Comprador", "Verificado", "Membro"],
    systems: ["vitrine", "mediacao", "feedbacks", "tickets"]
  },
  crypto: {
    categorySeeds: ["entrada", "mercado", "projetos", "research", "comunidade", "staff"],
    channelSeeds: ["avisos", "analises", "noticias", "airdrops", "seguranca", "chat", "voz"],
    roleSeeds: ["Founder", "Analista", "Moderador", "Holder", "Trader", "Membro"],
    systems: ["avisos", "research", "seguranca", "comunidade"]
  },
  roleplay: {
    categorySeeds: ["inicio", "lore", "personagens", "cenas", "off-topic", "staff"],
    channelSeeds: ["regras", "fichas", "historias", "rp-texto", "eventos", "avisos", "suporte"],
    roleSeeds: ["Narrador", "Admin", "Moderador", "Personagem", "Visitante", "Membro"],
    systems: ["fichas", "eventos", "lore", "suporte"]
  },
  technology: {
    categorySeeds: ["hub", "noticias", "labs", "projetos", "networking", "staff"],
    channelSeeds: ["avisos", "ia", "hardware", "software", "startups", "duvidas", "eventos"],
    roleSeeds: ["Founder", "Especialista", "Dev", "Maker", "Parceiro", "Membro"],
    systems: ["noticias", "labs", "projetos", "networking"]
  },
  influencer: {
    categorySeeds: ["comunidade", "conteudo", "beneficios", "eventos", "parcerias", "staff"],
    channelSeeds: ["avisos", "agenda", "bastidores", "ideias", "clips", "fans", "vip"],
    roleSeeds: ["Influencer", "Manager", "Moderador", "Creator", "Fan", "VIP"],
    systems: ["agenda", "ideias", "clips", "vip"]
  },
  clan: {
    categorySeeds: ["quartel", "treinos", "squads", "guerras", "midia", "staff"],
    channelSeeds: ["avisos", "recrutamento", "estrategias", "treino", "partidas", "voz-alpha", "voz-bravo"],
    roleSeeds: ["Lider", "Oficial", "Recrutador", "Elite", "Membro", "Recruta"],
    systems: ["recrutamento", "treinos", "guerras", "squads"]
  },
  esports: {
    categorySeeds: ["arena", "times", "campeonatos", "treinos", "midia", "staff"],
    channelSeeds: ["avisos", "lineups", "scrims", "resultados", "clipes", "agenda", "voz-time"],
    roleSeeds: ["Owner", "Manager", "Coach", "Pro Player", "Caster", "Fan"],
    systems: ["campeonatos", "scrims", "resultados", "agenda"]
  },
  custom: {
    categorySeeds: ["inicio", "principal", "comunidade", "projetos", "eventos", "suporte", "staff"],
    channelSeeds: ["regras", "avisos", "geral", "ideias", "midia", "tickets", "logs", "voz"],
    roleSeeds: ["Fundador", "Administrador", "Moderador", "Suporte", "VIP", "Membro"],
    systems: ["boas-vindas", "tickets", "avisos", "eventos"]
  }
};

const styleEmoji: Record<string, string[]> = {
  clean: ["○", "◇", "□", "•"],
  corporate: ["▪", "▫", "◆", "◇"],
  cyberpunk: ["✦", "◆", "▣", "▸"],
  dark: ["◆", "●", "◈", "▸"],
  elegant: ["✧", "◇", "◌", "✦"],
  gamer: ["⚔", "✦", "◆", "▸"],
  minimal: ["•", "○", "□", "◇"],
  modern: ["✦", "•", "◆", "◇"],
  neon: ["✦", "◆", "▸", "◈"],
  premium: ["✧", "◆", "◇", "✦"]
};

const generatedPanelEmojiByHint: Record<string, SystemEmojiKey> = {
  avisos: "alerta",
  regras: "folha",
  sugestoes: "interrogacao",
  ticket: "prancheta"
};

const voiceCategoryNames: Record<string, string[]> = {
  clean: ["○ Calls", "◇ Voz", "□ Salas"],
  corporate: ["▪ Reuniões", "◆ Conferência", "◇ Voice Hub"],
  cyberpunk: ["✦ Neon Calls", "▣ Cyber Voz", "◆ Night Comms"],
  dark: ["◆ Dark Calls", "● Voz Noturna", "◈ Lounge"],
  elegant: ["✧ Salões de Voz", "◇ Lounge", "✦ Conversas"],
  gamer: ["⚔ Calls Gamer", "✦ Squads", "◆ Lobby de Voz"],
  minimal: ["• Calls", "○ Voz", "◇ Lounge"],
  modern: ["✦ Voice Hub", "◆ Calls", "◇ Lounge"],
  neon: ["✦ Neon Voice", "◆ Calls", "◈ Lounge"],
  premium: ["✧ Premium Calls", "◆ Salas VIP", "◇ Lounge"]
};

const voiceSuites: Record<ServerType, string[]> = {
  community: ["☕ Lounge", "🎙️ Bate-papo", "🎧 Música", "🌙 Madrugada", "💤 AFK"],
  fivem: ["📻 Rádio Cidade", "🚓 Patrulha", "🔧 Mecânica", "🏁 Corrida", "💤 AFK"],
  "gta-rp": ["📻 Rádio RP", "🚓 Polícia", "🏥 Hospital", "🎭 Cena RP", "💤 AFK"],
  streamer: ["🔴 Ao vivo", "🎙️ Papo da live", "🎬 Bastidores", "⭐ Subs", "💤 AFK"],
  gamer: ["🎮 Squad 1", "⚔️ Squad 2", "🏆 Ranked", "🎧 Chill", "💤 AFK"],
  business: ["💼 Reunião", "📞 Atendimento", "🧠 Brainstorm", "🔒 Diretoria", "💤 Ausente"],
  store: ["🛒 Atendimento", "💸 Vendas", "📦 Pedidos", "⭐ VIP", "💤 AFK"],
  "bot-support": ["🛠️ Suporte", "🐞 Bugs", "💡 Ideias", "🔒 Staff", "💤 AFK"],
  anime: ["🍜 Lounge", "🎴 Watch Party", "🎨 Fanarts", "🌙 Madrugada", "💤 AFK"],
  music: ["🎧 Lounge", "🎤 Karaokê", "🎹 Studio", "🎵 Playlist", "💤 AFK"],
  programming: ["💻 Dev Call", "🧪 Pair Programming", "🧠 Debug", "📚 Mentoria", "💤 AFK"],
  study: ["📚 Sala 1", "📝 Revisão", "🎧 Foco", "👥 Grupo", "💤 AFK"],
  marketplace: ["🤝 Negociação", "🛒 Vendas", "🔎 Avaliação", "🔒 Mediação", "💤 AFK"],
  crypto: ["📈 Trading", "🧠 Research", "💬 Holders", "🔒 Alpha", "💤 AFK"],
  roleplay: ["🎭 Cena 1", "📖 Lore", "🌙 Off RP", "🔒 Staff RP", "💤 AFK"],
  technology: ["🤖 Tech Talk", "🧪 Lab", "💻 Projetos", "📰 News", "💤 AFK"],
  influencer: ["📸 Conteúdo", "🎬 Bastidores", "⭐ Comunidade", "🤝 Parcerias", "💤 AFK"],
  clan: ["⚔️ Esquadrão", "🎯 Treino", "🛡️ Estratégia", "🏆 Guerra", "💤 AFK"],
  esports: ["🏆 Time A", "🎯 Scrim", "📋 Coach", "🎙️ Caster", "💤 AFK"],
  custom: ["🎙️ Lounge", "🎧 Chill", "👥 Call 1", "🔒 Privada", "💤 AFK"]
};

const roleColors = [0x5865f2, 0x2ecc71, 0xe91e63, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x3498db];

export async function showServerGeneratorModal(interaction: ChatInputCommandInteraction) {
  const type = normalizeServerType(interaction.options.getString("tipo", true));
  const style = interaction.options.getString("estilo", true);
  const language = normalizeLanguage(interaction.options.getString("idioma", true));
  const categoryMode = interaction.options.getString("categorias") === "custom" ? "custom" : "auto";

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId([CUSTOM_ID_PREFIX, type, style, language, categoryMode].join(":"))
      .setTitle("Gerador Inteligente")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("serverName")
            .setLabel("Nome do servidor")
            .setMaxLength(80)
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("objective")
            .setLabel("Objetivo")
            .setMaxLength(900)
            .setPlaceholder("Ex: Comunidade FiveM com whitelist, denuncias, policia e eventos.")
            .setRequired(true)
            .setStyle(TextInputStyle.Paragraph)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("categoryTarget")
            .setLabel(categoryMode === "custom" ? "Quantidade de categorias" : "Categorias (opcional)")
            .setMaxLength(2)
            .setPlaceholder(categoryMode === "custom" ? "Ex: 8" : "Deixe vazio para automatico")
            .setRequired(categoryMode === "custom")
            .setStyle(TextInputStyle.Short)
        )
      )
  );
}

export async function handleServerGeneratorInteraction(interaction: Interaction, context: BotContext) {
  if (!isBotModuleEnabled(MODULE_ID)) return false;
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith(CUSTOM_ID_PREFIX)) return false;
  if (!interaction.inGuild() || !interaction.guild) return false;

  const authorization = await getRuntimeModuleAuthorization(context, interaction.guild.id, MODULE_ID);
  if (!authorization.allowed) {
    await interaction.reply({
      content: runtimeModuleDenialMessage(authorization, "O Gerador de Servidores"),
      ephemeral: true
    });
    return true;
  }

  const member = interaction.member as GuildMember | null;
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Voce precisa da permissao Gerenciar Servidor para usar o gerador.",
      ephemeral: true
    });
    return true;
  }

  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels) || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: "O bot precisa das permissoes Gerenciar Canais e Gerenciar Cargos para criar a estrutura.",
      ephemeral: true
    });
    return true;
  }

  const input = parseInput(interaction);
  const startedAt = Date.now();

  await interaction.reply({
    content: progressText("Analisando objetivo...", 1, 7, interaction.guild),
    ephemeral: true
  });

  try {
    const plan = generatePlan(input, interaction.guild.id, interaction.user.id);
    await interaction.editReply(progressText("Criando cargos...", 2, 7, interaction.guild));
    const createdRoles = await createRoles(interaction.guild, plan.roles);
    await interaction.editReply(progressText("Criando categorias...", 3, 7, interaction.guild));
    const createdCategories = await createCategories(interaction.guild, plan.categories, staffRoleIds(createdRoles));
    await interaction.editReply(progressText("Criando canais...", 4, 7, interaction.guild));
    const createdChannels = await createChannels(createdCategories);
    await interaction.editReply(progressText("Configurando painéis...", 5, 7, interaction.guild));
    await sendPanels(createdChannels.textChannels, plan, input);
    await interaction.editReply(progressText("Validando qualidade...", 6, 7, interaction.guild));
    await ensureNoEmptyCategories(createdCategories.categories, createdChannels.textChannels);
    await interaction.editReply(doneText(plan, createdCategories.categories.length, createdChannels.total, plan.roles.length, Date.now() - startedAt, interaction.guild));
  } catch (error) {
    console.error("[server-generator] falha ao criar servidor:", error);
    await interaction.editReply(`Nao foi possivel finalizar a criacao: ${friendlyError(error)}`);
  }

  return true;
}

function parseInput(interaction: ModalSubmitInteraction): GeneratorInput {
  const [, typeValue, style, language, categoryModeValue] = interaction.customId.split(":");
  const rawCategoryTarget = interaction.fields.getTextInputValue("categoryTarget")?.trim();
  const parsedTarget = rawCategoryTarget ? Number.parseInt(rawCategoryTarget, 10) : null;

  return {
    categoryMode: categoryModeValue === "custom" ? "custom" : "auto",
    categoryTarget: parsedTarget && Number.isFinite(parsedTarget) ? Math.min(12, Math.max(4, parsedTarget)) : null,
    language: normalizeLanguage(language),
    objective: interaction.fields.getTextInputValue("objective").trim(),
    serverName: interaction.fields.getTextInputValue("serverName").trim(),
    style: style || "modern",
    type: normalizeServerType(typeValue)
  };
}

function generatePlan(input: GeneratorInput, guildId: string, userId: string): ServerPlan {
  const random = seededRandom(`${guildId}:${userId}:${Date.now()}:${input.serverName}:${input.objective}`);
  const profile = typeProfiles[input.type];

  if (input.type === "streamer") {
    return generateStreamerPlan(input, random, profile.systems);
  }

  const categoryCount = input.categoryTarget ?? Math.min(10, Math.max(5, 5 + random.int(5)));
  const emojis = styleEmoji[input.style] ?? styleEmoji.modern ?? ["•"];
  const categorySeeds = random.shuffle(profile.categorySeeds).slice(0, categoryCount);
  const channelSeeds = random.shuffle(profile.channelSeeds);
  const categories: GeneratedCategory[] = categorySeeds.map((seed, index) => {
    const channelCount = 2 + random.int(index < 2 ? 3 : 2);
    const channels = random.shuffle(channelSeeds)
      .slice(0, channelCount)
      .map((channelSeed, channelIndex) => buildTextChannel(input, random.pick(emojis), channelSeed, index + channelIndex));

    return {
      channels,
      name: formatCategoryName(random.pick(emojis), seed, input.style),
      privateStaff: /staff|logs|gestao|equipe|privado/i.test(seed)
    };
  });
  categories.splice(Math.min(categories.length, 2 + random.int(2)), 0, buildVoiceCategory(input, random));

  const roles = random.shuffle(profile.roleSeeds).slice(0, 6).map((name, index) => ({
    color: roleColors[(index + random.int(roleColors.length)) % roleColors.length]!,
    hoist: index < 3,
    name,
    permissions: index === 0 ? PermissionFlagsBits.ManageGuild : index <= 2 ? PermissionFlagsBits.ManageMessages : undefined
  }));

  return {
    categories,
    panels: panelDefinitions(input, profile.systems, random),
    roles,
    summary: `${input.serverName} recebeu estrutura ${input.style} para ${profile.systems.join(", ")}.`
  };
}

function generateStreamerPlan(input: GeneratorInput, random: RandomSource, systems: string[]): ServerPlan {
  const voiceNames = random.shuffle([
    "🔴・Ao vivo",
    "🎙️・Papo da live",
    "🎬・Bastidores",
    "⭐・Sala dos subs",
    "💤・AFK"
  ]);
  const categories: GeneratedCategory[] = [
    {
      name: "📢・Central",
      channels: textChannels(input, [
        ["📌・regras", "Regras, conduta e informacoes importantes."],
        ["📣・avisos", "Avisos oficiais da live e da comunidade."],
        ["🔴・lives", "Notificacoes quando a live estiver online."]
      ])
    },
    {
      name: "🎬・Conteúdo",
      channels: textChannels(input, [
        ["🎞️・clips", "Melhores momentos enviados pela comunidade."],
        ["📸・bastidores", "Bastidores, previas e novidades do criador."],
        ["💡・ideias", "Ideias de conteudo, quadros e desafios."]
      ])
    },
    {
      name: "💬・Comunidade",
      channels: textChannels(input, [
        ["💬・chat", "Conversa geral da comunidade."],
        ["😂・memes", "Memes, zoeira leve e momentos da live."],
        ["🤝・parcerias", "Divulgacao de parceiros e conexoes."]
      ])
    },
    {
      name: "⭐・Benefícios",
      channels: textChannels(input, [
        ["⭐・subs", "Area especial para inscritos e apoiadores."],
        ["💎・vip", "Beneficios, sorteios e novidades VIP."],
        ["🎁・sorteios", "Sorteios e recompensas da comunidade."]
      ])
    },
    {
      name: random.pick(["🎙️・Calls da Live", "🔊・Voice Lounge", "⭐・Salas de Voz"]),
      channels: voiceNames.map((name) => ({
        name,
        topic: `Sala de voz para ${input.serverName}`,
        type: ChannelType.GuildVoice as const
      }))
    },
    {
      name: "🛡️・Staff",
      privateStaff: true,
      channels: textChannels(input, [
        ["🧰・staff-chat", "Organizacao interna da equipe."],
        ["📋・logs", "Registros internos e auditoria."],
        ["✅・tarefas", "Checklist de moderacao, lives e eventos."]
      ])
    }
  ];
  const roles = ["Streamer", "Manager", "Moderador", "Editor", "Subscriber", "VIP", "Viewer"].map((name, index) => ({
    color: roleColors[(index + random.int(roleColors.length)) % roleColors.length]!,
    hoist: index < 5,
    name,
    permissions: index === 0 ? PermissionFlagsBits.ManageGuild : index <= 2 ? PermissionFlagsBits.ManageMessages : undefined
  }));

  return {
    categories,
    panels: panelDefinitions(input, systems, random),
    roles,
    summary: `${input.serverName} recebeu estrutura streamer com central, conteudo, comunidade, beneficios, calls e staff.`
  };
}

function textChannels(input: GeneratorInput, channels: Array<[string, string]>): GeneratedChannel[] {
  return channels.map(([name, description]) => ({
    name,
    topic: `${description} ${input.objective.slice(0, 140)}`.trim(),
    type: ChannelType.GuildText as const
  }));
}

function buildTextChannel(input: GeneratorInput, prefix: string, channelSeed: string, salt: number) {
  return {
    name: formatTextChannelName(prefix, channelSeed, salt),
    topic: topicFor(input, channelSeed),
    type: ChannelType.GuildText as const
  };
}

function buildVoiceCategory(input: GeneratorInput, random: RandomSource): GeneratedCategory {
  const categoryNames = voiceCategoryNames[input.style] ?? voiceCategoryNames.modern ?? ["✦ Voice Hub"];
  const suite = random.shuffle(voiceSuites[input.type] ?? voiceSuites.custom).slice(0, 4 + random.int(2));
  const channels = suite.map((name, index) => ({
    name: formatVoiceChannelName(name, index, input.style),
    topic: `Sala de voz para ${input.serverName}`,
    type: ChannelType.GuildVoice as const
  }));

  return {
    channels,
    name: random.pick(categoryNames)
  };
}

async function createRoles(guild: Guild, roles: GeneratedRole[]) {
  const availableRoles = new Map<string, Role>();

  for (const role of [...roles].reverse()) {
    const existing = guild.roles.cache.find((current) => current.name.toLowerCase() === role.name.toLowerCase());
    if (existing) {
      availableRoles.set(role.name, existing);
      continue;
    }

    const created = await guild.roles.create({
      color: role.color,
      hoist: role.hoist ?? false,
      name: role.name,
      permissions: role.permissions,
      reason: "Gerador Inteligente de Servidores"
    });
    availableRoles.set(role.name, created);
  }

  return availableRoles;
}

async function createCategories(guild: Guild, categories: GeneratedCategory[], staffRoleIds: string[]) {
  const createdCategories: Array<{ category: CategoryChannel; spec: GeneratedCategory }> = [];

  for (const spec of categories) {
    const category = await guild.channels.create({
      name: spec.name,
      permissionOverwrites: spec.privateStaff
        ? [
            {
              deny: [PermissionFlagsBits.ViewChannel],
              id: guild.roles.everyone.id
            },
            ...staffRoleIds.map((roleId) => ({
              allow: [PermissionFlagsBits.ViewChannel],
              id: roleId
            }))
          ]
        : undefined,
      reason: "Gerador Inteligente de Servidores",
      type: ChannelType.GuildCategory
    });

    createdCategories.push({ category, spec });
  }

  return {
    categories: createdCategories.map((item) => item.category),
    specs: createdCategories
  };
}

function staffRoleIds(roles: Map<string, Role>) {
  return [...roles.entries()]
    .filter(([name]) => /fundador|admin|moderador|staff|direcao|gerente|ceo|developer|owner|lider/i.test(name))
    .slice(0, 4)
    .map(([, role]) => role.id);
}

async function createChannels(created: Awaited<ReturnType<typeof createCategories>>) {
  const textChannels: TextChannel[] = [];
  let total = 0;

  for (const { category, spec } of created.specs) {
    for (const channel of spec.channels) {
      const createdChannel = await category.guild.channels.create({
        name: channel.name,
        parent: category.id,
        reason: "Gerador Inteligente de Servidores",
        topic: channel.type === ChannelType.GuildText ? channel.topic : undefined,
        type: channel.type
      });

      total += 1;
      if (createdChannel.type === ChannelType.GuildText) {
        textChannels.push(createdChannel);
      }
    }
  }

  return { textChannels, total };
}

async function sendPanels(channels: TextChannel[], plan: ServerPlan, input: GeneratorInput) {
  const firstTextChannel = channels[0];
  if (!firstTextChannel) return;

  for (const panel of plan.panels.slice(0, 4)) {
    const target = channels.find((channel) => channel.name.includes(panel.channelHint)) ?? firstTextChannel;
    const emojiKey = generatedPanelEmojiByHint[panel.channelHint] ?? "prancheta";

    await target.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${systemEmojiText(emojiKey, target.guild)} ${panel.title}`)
          .setDescription(panel.body)
          .setFooter({ text: input.serverName })
          .setTimestamp()
      ]
    }).catch(() => undefined);
  }
}

async function ensureNoEmptyCategories(categories: CategoryChannel[], textChannels: TextChannel[]) {
  if (textChannels.length) return;

  const firstCategory = categories[0];
  if (!firstCategory) return;

  await firstCategory.guild.channels.create({
    name: "inicio",
    parent: firstCategory.id,
    reason: "Gerador Inteligente de Servidores - validacao",
    topic: "Canal inicial criado pela validacao automatica.",
    type: ChannelType.GuildText
  });
}

function panelDefinitions(input: GeneratorInput, systems: string[], random: RandomSource) {
  const greetings = {
    en: "Welcome. Read the rules, choose your roles and open a ticket whenever you need support.",
    es: "Bienvenido. Lee las reglas, elige tus cargos y abre un ticket cuando necesites soporte.",
    pt: "Bem-vindo. Leia as regras, escolha seus cargos e abra um ticket quando precisar de suporte."
  };

  return random.shuffle([
    {
      channelHint: "regras",
      title: "Painel de Regras",
      body: `${greetings[input.language]}\n\nObjetivo: ${input.objective.slice(0, 300)}`
    },
    {
      channelHint: "ticket",
      title: "Painel de Tickets",
      body: `Use este canal para suporte, denuncias e atendimento. Sistemas planejados: ${systems.join(", ")}.`
    },
    {
      channelHint: "sugestoes",
      title: "Painel de Sugestoes",
      body: "Envie ideias com contexto, impacto esperado e exemplos. Sugestoes repetidas serao agrupadas pela staff."
    },
    {
      channelHint: "avisos",
      title: "Painel de Boas-vindas",
      body: `${input.serverName} foi organizado automaticamente com layout ${input.style} e estrutura dinamica.`
    }
  ]);
}

function formatCategoryName(prefix: string, name: string, style: string) {
  const normalized = name.replace(/-/g, " ");
  return ["minimal", "clean", "corporate"].includes(style)
    ? `${prefix} ${normalized}`.toLowerCase()
    : `${prefix} ${titleCase(normalized)}`;
}

function formatTextChannelName(prefix: string, name: string, salt: number) {
  const variants = [
    `${prefix}-${name}`,
    `${name}-${prefix}`,
    `${prefix}-${name}-${salt + 1}`
  ];

  return variants[salt % variants.length]!.toLowerCase().replace(/\s+/g, "-");
}

function formatVoiceChannelName(name: string, index: number, style: string) {
  const separators = ["・", "┃", "•"];
  const separator = ["minimal", "clean"].includes(style) ? "•" : separators[index % separators.length]!;
  const cleaned = name.replace(/\s+/g, " ").trim();

  if (/afk|ausente/i.test(cleaned)) {
    return `💤 ${separator} AFK`;
  }

  return cleaned.includes(separator) ? cleaned : cleaned.replace(/\s+/, ` ${separator} `);
}

function topicFor(input: GeneratorInput, channel: string) {
  return `${channel.replace(/-/g, " ")} para ${input.serverName}: ${input.objective.slice(0, 180)}`;
}

function progressText(step: string, current: number, total: number, guild: Guild | null = null) {
  return [
    `Progresso ${current}/${total}`,
    "",
    `${systemEmojiText("relogio", guild)} ${step}`
  ].join("\n");
}

function doneText(plan: ServerPlan, categories: number, channels: number, roles: number, elapsedMs: number, guild: Guild | null = null) {
  return [
    `${systemEmojiText("visto", guild)} Servidor configurado.`,
    "",
    `${systemEmojiText("prancheta", guild)} Categorias criadas: ${categories}`,
    `${systemEmojiText("discord", guild)} Canais criados: ${channels}`,
    `${systemEmojiText("homem", guild)} Cargos criados: ${roles}`,
    `${systemEmojiText("relogio", guild)} Tempo gasto: ${(elapsedMs / 1000).toFixed(1)}s`,
    "",
    plan.summary
  ].join("\n");
}

function seededRandom(seed: string): RandomSource {
  let state = createHash("sha256").update(seed).digest().readUInt32BE(0);
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  return {
    int(max) {
      return Math.floor(next() * Math.max(1, max));
    },
    pick(values) {
      return values[this.int(values.length)]!;
    },
    shuffle(values) {
      const copy = [...values];

      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = this.int(index + 1);
        [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
      }

      return copy;
    }
  };
}

function normalizeServerType(value: string | null | undefined): ServerType {
  return value && value in typeProfiles ? value as ServerType : "custom";
}

function normalizeLanguage(value: string | null | undefined): "pt" | "en" | "es" {
  return value === "en" || value === "es" ? value : "pt";
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida.";
}
