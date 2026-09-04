import { getMongoCollections, type MongoDevBot } from "../database/mongo";

export type PublicConnectedServer = {
  botNames: string[];
  connectedBots: number;
  guildId: string;
  iconUrl: string | null;
  memberCount: number;
  name: string;
  online: boolean;
};

export type PublicConnectedServersResponse = {
  generatedAt: string;
  servers: PublicConnectedServer[];
  totalBots: number;
  totalUniqueServers: number;
};

export type PublicMarketingFeature = {
  category: string;
  fullDescription: string;
  icon: string;
  id: string;
  shortDescription: string;
  title: string;
};

export type PublicMarketingFeaturesResponse = {
  features: PublicMarketingFeature[];
  generatedAt: string;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type FeatureDefinition = PublicMarketingFeature & {
  categoryBonus: number;
  enabled: boolean;
  marketingPriority: number;
  moduleIds: string[];
  public: boolean;
};

type PublicServerAccumulator = PublicConnectedServer & {
  botIds: Set<string>;
  lastSeenAt: number;
};

const CACHE_TTL_MS = 30_000;
const MAX_PUBLIC_SERVERS = 24;
const MAX_BOT_NAMES_PER_SERVER = 6;
const RECENT_GUILD_WINDOW_MS = 10 * 60_000;

let serversCache: CacheEntry<PublicConnectedServersResponse> | null = null;
let featuresCache: CacheEntry<PublicMarketingFeaturesResponse> | null = null;

const fallbackFeatures: [FeatureDefinition, FeatureDefinition, FeatureDefinition] = [
  {
    category: "Automação",
    categoryBonus: 3,
    enabled: true,
    fullDescription: "Crie sistemas de tickets, cursos, ações, verificações, logs e outros módulos integrados ao Discord e à dashboard NexTech.",
    icon: "bot",
    id: "automation",
    marketingPriority: 10,
    moduleIds: ["tickets", "courses", "fivem-actions", "tag-verification", "automated-logs"],
    public: true,
    shortDescription: "Automatize tarefas, processos e fluxos do seu servidor.",
    title: "Automação completa"
  },
  {
    category: "Dashboard",
    categoryBonus: 2,
    enabled: true,
    fullDescription: "Controle configurações, canais, cargos, módulos e integrações sem precisar alterar o código manualmente.",
    icon: "monitor",
    id: "central-control",
    marketingPriority: 9,
    moduleIds: ["dashboard", "settings", "plans", "nextech-sales"],
    public: true,
    shortDescription: "Gerencie bots, servidores e permissões em um único painel.",
    title: "Controle centralizado"
  },
  {
    category: "Monitoramento",
    categoryBonus: 2,
    enabled: true,
    fullDescription: "Visualize bots online, servidores conectados, tempo de resposta, logs operacionais e informações essenciais da plataforma.",
    icon: "gauge",
    id: "monitoring",
    marketingPriority: 8,
    moduleIds: ["logs", "automated-logs", "status", "voice-recorder"],
    public: true,
    shortDescription: "Acompanhe status, desempenho e atividade em tempo real.",
    title: "Monitoramento inteligente"
  }
];

const featureCatalog: FeatureDefinition[] = [
  ...fallbackFeatures,
  {
    category: "Suporte",
    categoryBonus: 1,
    enabled: true,
    fullDescription: "Organize atendimentos, tickets, vendas e fluxos de suporte com rastreio e histórico integrado ao painel.",
    icon: "headphones",
    id: "tickets-support",
    marketingPriority: 7,
    moduleIds: ["tickets", "sales-ticket", "nextech-sales"],
    public: true,
    shortDescription: "Atenda usuários com fluxos organizados e rastreáveis.",
    title: "Suporte estruturado"
  },
  {
    category: "Segurança",
    categoryBonus: 2,
    enabled: true,
    fullDescription: "Aplique verificações, proteções, permissões e auditorias para reduzir riscos operacionais no servidor.",
    icon: "shield",
    id: "security",
    marketingPriority: 7,
    moduleIds: ["anti-ban", "self-bot-protection", "account-age", "global-blacklist", "tag-verification"],
    public: true,
    shortDescription: "Proteja servidores com validações e controles integrados.",
    title: "Segurança operacional"
  }
];

export async function getPublicConnectedServers(): Promise<PublicConnectedServersResponse> {
  const cached = readCache(serversCache);
  if (cached) return cached;

  try {
    const { botGuildConfigs, devBots, guilds } = await getMongoCollections();
    const [bots, configs, guildDocs] = await Promise.all([
      devBots.find({}, {
        projection: {
          _id: 1,
          avatarUrl: 1,
          mainGuildId: 1,
          mainGuildIconUrl: 1,
          mainGuildMemberCount: 1,
          mainGuildName: 1,
          name: 1,
          status: 1
        }
      }).toArray(),
      botGuildConfigs.find({}, {
        projection: {
          botId: 1,
          guildId: 1,
          guildName: 1,
          updatedAt: 1
        }
      }).sort({ updatedAt: -1 }).limit(300).toArray(),
      guilds.find({}, {
        projection: {
          _id: 1,
          icon: 1,
          name: 1
        }
      }).toArray()
    ]);
    const botsById = new Map(bots.map((bot) => [bot._id, bot]));
    const guildsById = new Map(guildDocs.map((guild) => [guild._id, guild]));
    const uniqueServers = new Map<string, PublicServerAccumulator>();
    const now = Date.now();

    for (const bot of bots) {
      addPublicServer(uniqueServers, {
        bot,
        guildId: bot.mainGuildId,
        guildName: bot.mainGuildName ?? null,
        iconUrl: bot.mainGuildIconUrl ?? null,
        memberCount: bot.mainGuildMemberCount ?? 0,
        seenAt: bot.updatedAt?.getTime?.() ?? now
      });
    }

    for (const config of configs) {
      const bot = botsById.get(config.botId);
      if (!bot) continue;
      const guild = guildsById.get(config.guildId);
      addPublicServer(uniqueServers, {
        bot,
        guildId: config.guildId,
        guildName: config.guildName || guild?.name || null,
        iconUrl: normalizeDiscordIconUrl(config.guildId, guild?.icon ?? null),
        memberCount: config.guildId === bot.mainGuildId ? bot.mainGuildMemberCount ?? 0 : 0,
        seenAt: config.updatedAt?.getTime?.() ?? now
      });
    }

    const servers = [...uniqueServers.values()]
      .filter(isShowcaseWorthyPublicServer)
      .sort((left, right) => Number(right.online) - Number(left.online) || right.connectedBots - left.connectedBots || right.lastSeenAt - left.lastSeenAt)
      .slice(0, MAX_PUBLIC_SERVERS)
      .map(({ botIds: _botIds, lastSeenAt: _lastSeenAt, ...server }) => server);
    const value = {
      generatedAt: new Date().toISOString(),
      servers,
      totalBots: bots.length,
      totalUniqueServers: uniqueServers.size
    };

    serversCache = writeCache(value);
    return value;
  } catch (error) {
    console.warn("[public-landing] falha ao carregar servidores conectados:", error instanceof Error ? error.message : error);
    const fallback = {
      generatedAt: new Date().toISOString(),
      servers: [],
      totalBots: 0,
      totalUniqueServers: 0
    };
    serversCache = writeCache(fallback, 10_000);
    return fallback;
  }
}

export async function getPublicMarketingFeatures(): Promise<PublicMarketingFeaturesResponse> {
  const cached = readCache(featuresCache);
  if (cached) return cached;

  try {
    const { devBots } = await getMongoCollections();
    const bots = await devBots.find({}, { projection: { enabledModules: 1 } }).limit(250).toArray();
    const moduleUsage = countModuleUsage(bots);
    const maxUsage = Math.max(1, ...moduleUsage.values());
    const features = featureCatalog
      .filter((feature) => feature.enabled && feature.public)
      .map((feature) => ({
        feature,
        score: scoreFeature(feature, moduleUsage, maxUsage)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(({ feature }) => toPublicFeature(feature));
    const value = {
      features: ensureThreeFeatures(features),
      generatedAt: new Date().toISOString()
    };

    featuresCache = writeCache(value);
    return value;
  } catch (error) {
    console.warn("[public-landing] falha ao carregar recursos de marketing:", error instanceof Error ? error.message : error);
    const value = {
      features: fallbackFeatures.map(toPublicFeature),
      generatedAt: new Date().toISOString()
    };
    featuresCache = writeCache(value, 10_000);
    return value;
  }
}

function addPublicServer(
  uniqueServers: Map<string, PublicServerAccumulator>,
  input: {
    bot: Pick<MongoDevBot, "_id" | "name" | "status">;
    guildId: string | null | undefined;
    guildName: string | null;
    iconUrl: string | null;
    memberCount: number;
    seenAt: number;
  }
) {
  if (!input.guildId || !/^\d{5,32}$/.test(input.guildId)) return;

  const current = uniqueServers.get(input.guildId);
  const botName = sanitizePublicText(input.bot.name, 80) || "Bot NexTech";
  const online = input.bot.status === "online" || input.bot.status === "ready";

  if (!current) {
    uniqueServers.set(input.guildId, {
      botNames: [botName],
      botIds: new Set([input.bot._id]),
      connectedBots: 1,
      guildId: input.guildId,
      iconUrl: input.iconUrl,
      lastSeenAt: input.seenAt,
      memberCount: clampNumber(input.memberCount, 0, 1_000_000),
      name: sanitizePublicText(input.guildName, 80) || "Servidor NexTech",
      online
    });
    return;
  }

  const alreadyCounted = current.botIds.has(input.bot._id);

  if (!alreadyCounted) {
    current.botIds.add(input.bot._id);
    current.connectedBots += 1;
    if (!current.botNames.includes(botName) && current.botNames.length < MAX_BOT_NAMES_PER_SERVER) {
      current.botNames.push(botName);
    }
  }
  current.iconUrl = current.iconUrl ?? input.iconUrl;
  current.memberCount = Math.max(current.memberCount, clampNumber(input.memberCount, 0, 1_000_000));
  current.online = current.online || online || Date.now() - input.seenAt < RECENT_GUILD_WINDOW_MS;
  current.lastSeenAt = Math.max(current.lastSeenAt, input.seenAt);
}

// Sem filtro, a vitrine pública mostrava qualquer guild que um bot já tocou —
// inclusive servidor de teste com 0 membros e sem ícone, ou com o avatar
// padrão do Discord. Nada disso passa credibilidade numa landing page pública.
// memberCount pode ficar 0 em guilds secundárias por limitação do modelo de
// dados (só a guild principal do bot tem contagem real), por isso o critério
// combina os dois sinais em OU: falta qualquer um já derruba do showcase.
const MIN_PUBLIC_SERVER_MEMBERS = 5;

function isShowcaseWorthyPublicServer(server: Pick<PublicConnectedServer, "iconUrl" | "memberCount">) {
  if (!server.iconUrl || /\/embed\/avatars\//.test(server.iconUrl)) {
    return false;
  }

  return server.memberCount >= MIN_PUBLIC_SERVER_MEMBERS;
}

function countModuleUsage(bots: Array<Pick<MongoDevBot, "enabledModules">>) {
  const usage = new Map<string, number>();

  for (const bot of bots) {
    for (const moduleId of bot.enabledModules ?? []) {
      usage.set(moduleId, (usage.get(moduleId) ?? 0) + 1);
    }
  }

  return usage;
}

function scoreFeature(feature: FeatureDefinition, moduleUsage: Map<string, number>, maxUsage: number) {
  const usageCount = feature.moduleIds.reduce((total, moduleId) => total + (moduleUsage.get(moduleId) ?? 0), 0);
  const normalizedUsage = usageCount / maxUsage;
  return feature.marketingPriority * 10 + normalizedUsage * 3 + (feature.enabled ? 5 : 0) + feature.categoryBonus;
}

function ensureThreeFeatures(features: PublicMarketingFeature[]) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));

  for (const fallback of fallbackFeatures.map(toPublicFeature)) {
    if (byId.size >= 3) break;
    byId.set(fallback.id, fallback);
  }

  return [...byId.values()].slice(0, 3);
}

function toPublicFeature(feature: FeatureDefinition): PublicMarketingFeature {
  return {
    category: sanitizePublicText(feature.category, 40),
    fullDescription: sanitizePublicText(feature.fullDescription, 280),
    icon: sanitizePublicText(feature.icon, 32),
    id: sanitizePublicText(feature.id, 64),
    shortDescription: sanitizePublicText(feature.shortDescription, 140),
    title: sanitizePublicText(feature.title, 70)
  };
}

function sanitizePublicText(value: string | null | undefined, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeDiscordIconUrl(guildId: string, icon: string | null | undefined) {
  if (!icon) return null;
  if (icon.startsWith("https://cdn.discordapp.com/")) return icon;
  if (!/^[a-zA-Z0-9_]+$/.test(icon)) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp?size=128`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

function readCache<T>(entry: CacheEntry<T> | null) {
  return entry && entry.expiresAt > Date.now() ? entry.value : null;
}

function writeCache<T>(value: T, ttl = CACHE_TTL_MS): CacheEntry<T> {
  return {
    expiresAt: Date.now() + ttl,
    value
  };
}
