import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import axios from "axios";
import { isDashboardDevUserId } from "../config/devOwner";
import { env } from "../config/env";
import {
  getMongoCollections,
  type MongoBotGuildConfig,
  type MongoBotGuildModuleConfig,
  type MongoDevBot,
  type MongoDevBotStatus,
  type MongoSecurityFeatureAccess
} from "../database/mongo";
import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";
import type { AuthSessionUser } from "../types/session";
import {
  canManageModuleAtLevel,
  canReadModuleAtLevel,
  dashboardPermissionsForLevel,
  highestDashboardAccessLevel,
  type DashboardAccessLevel,
  type DashboardPermissionFlags,
  type SessionAccessLevel
} from "./dashboardPermissionService";
import { getDiscordAvatarUrl, getGuildIconUrl } from "./discordAssetService";
import { fetchDiscordCurrentUserGuildMember, refreshDiscordTokens } from "./discordOAuthService";
import { getGuildSettings, getPersistedDashboardAccess, updateGuildSettings } from "./settingsService";
import { getImageAntiSpamSettings } from "./imageAntiSpamService";
import { saveSelfBotProtectionSettings } from "./selfBotProtectionService";
import { getSelfBotProtectionSettings, type SelfBotProtectionModuleId } from "./selfBotProtectionService";
import { createLog } from "./logService";
import { getStoredDiscordTokens, updateStoredDiscordTokens } from "./userService";
import { isCustomFivemModuleId } from "./fivemModuleService";

const DISCORD_API = "https://discord.com/api/v10";
const SECURITY_PROTECTION_FEATURE_KEY = "security_protection" as const;

export const DEV_MODULES = [
  { id: "live", label: "Sistema de Live" },
  { id: "kick-integration", label: "Kick Integration" },
  { id: "clips", label: "Sistema de Clips" },
  { id: "kick-clips", label: "Clipes Kick" },
  { id: "giveaway", label: "Sistema de Sorteio" },
  { id: "network", label: "Rede Social dos Membros" },
  { id: "x-monitor", label: "X Monitor" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "rules", label: "Sistema de Regras" },
  { id: "mission-tools", label: "Mission Tools" },
  { id: "voice-recorder", label: "Voice Recorder" },
  { id: "emoji-cloner", label: "Clonagem de Emojis" },
  { id: "server-cloner", label: "Clonagem de Servidor" },
  { id: "server-generator", label: "Gerador Inteligente de Servidores" },
  { id: "safe-bot", label: "SelfBot Protection" },
  { id: "account-age-security", label: "Seguranca por Idade da Conta" },
  { id: "anti-ban", label: "Sistema Anti Ban" },
  { id: "suspicious-servers", label: "Servidores Suspeitos" },
  { id: "global-blacklist", label: "Blacklist Global" },
  { id: "advanced-permissions", label: "Gerenciamento de Permissoes" },
  { id: "invite-cleanup", label: "Limpeza Automatica de Convites" },
  { id: "server-backup", label: "Backup Completo" },
  { id: "vanity-url-protection", label: "Protecao da URL Personalizada" },
  { id: "hide-empty-voice", label: "Esconder Chamadas Vazias" },
  { id: "auto-unmute", label: "Auto Desmutar" },
  { id: "temporary-voice", label: "Chamadas Temporarias" },
  { id: "tag-verification", label: "Verificacao de Tag" },
  { id: "bio-url-verification", label: "Verificacao de URL na Bio" },
  { id: "first-lady", label: "Sistema Primeira Dama" },
  { id: "fivem", label: "FiveM" },
  { id: "fivem-factions", label: "FiveM - Sistema de Faccao" },
  { id: "fivem-corporations", label: "FiveM - Sistema de Corporacoes" },
  { id: "fivem-absences", label: "FiveM - Sistema de Ausencias" },
  { id: "fivem-orders", label: "FiveM - Sistema de Encomendas" },
  { id: "fivem-ammo", label: "FiveM - Sistema de Municoes" },
  { id: "fivem-finance", label: "FiveM - Sistema Financeiro" },
  { id: "fivem-fac", label: "FiveM - FAC Ausencia" },
  { id: "avisos", label: "Mensagens e Personalizacao" }
] as const;

const DEV_MODULE_IDS = new Set(DEV_MODULES.map((module) => module.id));
const LEGACY_MODULE_ALIASES: Record<string, (typeof DEV_MODULES)[number]["id"]> = {
  "fivem-fac": "fivem-absences",
  "image-anti-spam": "safe-bot",
  "link-anti-spam": "safe-bot"
};
const RUNTIME_MODULE_RELEASE_ALIASES: Record<string, (typeof DEV_MODULES)[number]["id"]> = {
  "anti-flood": "safe-bot",
  "anti-imagens": "safe-bot",
  "anti-link": "safe-bot",
  "anti-links": "safe-bot",
  "anti-spam": "safe-bot",
  "fivem-fac": "fivem-absences",
  "image-anti-spam": "safe-bot",
  "link-anti-spam": "safe-bot"
};
const RUNTIME_INACTIVE_BOT_STATUSES = new Set<MongoDevBotStatus>(["error", "invalid_token"]);
const RUNTIME_ACTIVE_LICENSE_STATUSES = new Set(["active", "ativo", "approved", "aprovado", "enabled", "liberado", "valid", "valido"]);
const RUNTIME_EXPIRED_LICENSE_STATUSES = new Set(["expired", "expirado", "expirada"]);
const RUNTIME_BLOCKED_LICENSE_STATUSES = new Set([
  "blocked",
  "bloqueado",
  "bloqueada",
  "cancelled",
  "canceled",
  "deleted",
  "removed",
  "removido",
  "removida",
  "suspended",
  "suspenso",
  "suspensa"
]);
const SELF_BOT_RUNTIME_MODULES = new Set([
  "anti-anexos",
  "anti-auto-spam",
  "anti-bots",
  "anti-caps-lock",
  "anti-comandos-em-massa",
  "anti-contas-novas",
  "anti-convites",
  "anti-copypasta",
  "anti-divulgacao",
  "anti-emojis",
  "anti-flood",
  "anti-flood-multi-canais",
  "anti-gif",
  "anti-imagens",
  "anti-link",
  "anti-links",
  "anti-mass-ping",
  "anti-mencoes",
  "anti-nitro-scam",
  "anti-phishing",
  "anti-raid",
  "anti-scam",
  "anti-spam",
  "anti-texto-repetido",
  "anti-token-grabber",
  "anti-webhook",
  "image-anti-spam",
  "link-anti-spam",
  "safe-bot"
]);
const SELF_BOT_PROTECTION_RUNTIME_TOGGLES = new Set([
  "anti-anexos",
  "anti-auto-spam",
  "anti-bots",
  "anti-caps-lock",
  "anti-comandos-em-massa",
  "anti-contas-novas",
  "anti-convites",
  "anti-copypasta",
  "anti-divulgacao",
  "anti-emojis",
  "anti-flood",
  "anti-flood-multi-canais",
  "anti-gif",
  "anti-imagens",
  "anti-links",
  "anti-mass-ping",
  "anti-mencoes",
  "anti-nitro-scam",
  "anti-phishing",
  "anti-raid",
  "anti-scam",
  "anti-spam",
  "anti-texto-repetido",
  "anti-token-grabber",
  "anti-webhook"
]);

type DiscordBotUser = {
  id: string;
  username: string;
  avatar: string | null;
};

type DiscordApplicationOwner = {
  id: string;
};

type DiscordApplicationTeamMember = {
  user?: DiscordApplicationOwner;
  membership_state?: number;
};

type DiscordApplication = {
  id: string;
  owner?: DiscordApplicationOwner;
  team?: {
    members?: DiscordApplicationTeamMember[];
    owner_user_id?: string;
  } | null;
};

type DiscordGuildDetails = {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  approximate_member_count?: number;
  approximate_presence_count?: number;
};

type DiscordGuildChannel = {
  id: string;
};

type DiscordRole = {
  id: string;
  permissions: string;
};

type DiscordGuildMember = {
  roles: string[];
};

type DetectedDiscordGuildRecord = DetectedDiscordGuild & {
  iconHash: string | null;
};

export type DetectedDiscordGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
  onlineCount: number;
  channelCount: number;
  botId: string;
  botName: string;
  botAvatarUrl: string | null;
  botCreatedAt: string | null;
  hasAdministrator: boolean;
};

export type DevBotDto = {
  id: string;
  name: string;
  slug: string;
  dashboardUrl: string;
  clientId: string;
  tokenMasked: string;
  secretConfigured: boolean;
  avatarUrl: string | null;
  ownerId: string;
  ownerName: string;
  mainGuildId: string;
  mainGuildName: string;
  mainGuildIconUrl: string | null;
  mainGuildMemberCount: number;
  mainGuildChannelCount: number;
  botCreatedAt: string | null;
  guildIds: string[];
  status: MongoDevBotStatus;
  statusMessage: string | null;
  enabledModules: string[];
  accessLevel: DashboardAccessLevel;
  permissions: DashboardPermissionFlags;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardBotDto = Pick<
  DevBotDto,
  | "id"
  | "name"
  | "slug"
  | "dashboardUrl"
  | "clientId"
  | "avatarUrl"
  | "ownerId"
  | "mainGuildId"
  | "mainGuildName"
  | "mainGuildIconUrl"
  | "mainGuildMemberCount"
  | "mainGuildChannelCount"
  | "botCreatedAt"
  | "guildIds"
  | "status"
  | "statusMessage"
  | "enabledModules"
  | "accessLevel"
  | "permissions"
  | "createdBy"
>;

export type DevBotRuntimeConfig = {
  id: string;
  clientId: string;
  name: string;
  token: string;
  mainGuildId: string;
  guildIds: string[];
  enabledModules: string[];
};

export type BotRuntimeModuleAuthorization = {
  allowed: boolean;
  botAuthorized: boolean;
  botId: string | null;
  botStatus: MongoDevBotStatus | null;
  checkedAt: string;
  guildAuthorized: boolean;
  guildId: string;
  licenseExpiresAt: string | null;
  licenseStatus: string | null;
  licenseValid: boolean;
  moduleEnabled: boolean;
  moduleId: string;
  moduleReleased: boolean;
  plan: string | null;
  policy: "fail_closed";
  reason: string;
  reasonCode: string;
  releaseModuleId: string | null;
};

export type SecurityFeatureAccessDto = {
  botId: string;
  enabledAt: string | null;
  enabledBy: string | null;
  enabledByDev: boolean;
  featureKey: typeof SECURITY_PROTECTION_FEATURE_KEY;
  updatedAt: string;
};

export type DevBotAccessDiagnostic = {
  allowed: boolean;
  botId: string;
  botName: string;
  configuredRoleCount: number;
  configuredUserCount: number;
  guildId: string;
  guildName: string;
  accessLevel: DashboardAccessLevel | null;
  matchedRoleIds: string[];
  matchedUserIds: string[];
  matchedRoleCount: number;
  memberRoleIds: string[];
  reason: string;
  requiredRoleIds: string[];
  requiredUserIds: string[];
};

type CreateDevBotInput = {
  token: string;
  ownerName: string;
  ownerId: string;
  mainGuildId: string;
  enabledModules?: string[];
  createdBy: string;
  verifyOwnerUserId?: string | null;
};

type UpdateDevBotInput = {
  name?: string | null;
  clientId?: string;
  token?: string;
  secret?: string | null;
  avatarUrl?: string | null;
  ownerName?: string;
  ownerId?: string;
  mainGuildId?: string;
  enabledModules?: string[];
  verifyOwnerUserId?: string | null;
};

type RegisterPrimaryDevBotInput = {
  name?: string | null;
  ownerName: string;
  ownerId: string;
  mainGuildId: string;
  enabledModules: string[];
  createdBy: string;
};

export type RegisterPrimaryDevBotResult = {
  bot: DevBotDto;
  created: boolean;
};

type EnsurePrimaryDevBotListedInput = {
  ownerName: string;
  ownerId: string;
  createdBy: string;
};

type AccessibleDevBotsOptions = {
  botSlug?: string | null;
  discordAccessToken?: string | null;
  discordRefreshToken?: string | null;
  onDiscordTokensRefreshed?: (tokens: { accessToken: string; refreshToken: string | null }) => Promise<void> | void;
};

type PanelRoleAccessResult = {
  allowed: boolean;
  accessLevel: DashboardAccessLevel | null;
  configuredRoleCount: number;
  configuredUserCount: number;
  matchedRoleIds: string[];
  matchedUserIds: string[];
  matchedRoleCount: number;
  memberRoleIds: string[];
  reason: string;
  requiredRoleIds: string[];
  requiredUserIds: string[];
};

type MemberRoleLookupResult = {
  roleIds: Set<string> | null;
  reason: string | null;
  source: "oauth" | "bot" | null;
};

export async function listDevBots() {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bots, configs] = await Promise.all([
    devBots.find().sort({ createdAt: -1 }).toArray(),
    botGuildConfigs.find().toArray()
  ]);
  const guildIdsByBot = groupGuildIdsByBot(configs);

  return bots.map((bot) => toDevBotDto(bot, allBotGuildIds(bot, guildIdsByBot.get(bot._id))));
}

export async function listAccessibleDevBots(user: AuthSessionUser, options: AccessibleDevBotsOptions = {}) {
  return (await scanAccessibleDevBots(user, options)).accessibleBots;
}

export async function scanAccessibleDevBots(user: AuthSessionUser, options: AccessibleDevBotsOptions = {}) {
  if (isDashboardDevUserId(user.discordId)) {
    if (options.botSlug) {
      const bot = await getDevBotBySlug(options.botSlug);
      return {
        accessibleBots: bot ? [bot] : [],
        diagnostics: []
      };
    }

    return {
      accessibleBots: await listDevBots(),
      diagnostics: []
    };
  }

  const { botGuildConfigs, devBots } = await getMongoCollections();
  const botQuery = options.botSlug ? { slug: slugifyBotName(options.botSlug) } : {};
  const [bots, configs] = await Promise.all([
    devBots.find(botQuery).sort({ createdAt: -1 }).toArray(),
    botGuildConfigs.find().toArray()
  ]);
  const guildIdsByBot = groupGuildIdsByBot(configs);
  const scans = await Promise.all(bots.map(async (bot) => {
    const allGuildIds = allBotGuildIds(bot, guildIdsByBot.get(bot._id));
    const candidateGuildIds = allGuildIds;

    if (!candidateGuildIds.length) {
      return {
        bot: null,
        diagnostics: [{
          allowed: false,
          accessLevel: null,
          botId: bot._id,
          botName: bot.name,
          configuredRoleCount: 0,
          configuredUserCount: 0,
          guildId: bot.mainGuildId,
          guildName: bot.mainGuildName ?? `Servidor ${bot.mainGuildId}`,
          matchedRoleIds: [],
          matchedUserIds: [],
          matchedRoleCount: 0,
          memberRoleIds: [],
          requiredRoleIds: [],
          requiredUserIds: [],
          reason: "Sua conta Discord nao aparece como membro do servidor deste painel."
        }]
      };
    }

    const results = await Promise.all(candidateGuildIds.map((guildId) => checkAccessDevBotGuild(user, bot, guildId, options)));
    const authorizedGuildIds = results
      .filter((result) => result.allowed)
      .map((result) => result.guildId);
    const accessLevel = highestDashboardAccessLevel(results.map((result) => result.accessLevel)) ?? "basic";

    return {
      bot: authorizedGuildIds.length ? toDevBotDto(bot, authorizedGuildIds, accessLevel) : null,
      diagnostics: results
    };
  }));

  return {
    accessibleBots: scans.map((scan) => scan.bot).filter((bot): bot is DevBotDto => Boolean(bot)),
    diagnostics: scans.flatMap((scan) => scan.diagnostics)
  };
}

export async function listAccessibleDashboardBots(user: AuthSessionUser, options: AccessibleDevBotsOptions = {}) {
  return (await listAccessibleDevBots(user, options)).map(toDashboardBotDto);
}

export async function userHasAccessibleDevBot(user: AuthSessionUser) {
  if (isDashboardDevUserId(user.discordId)) {
    return true;
  }

  return (await listAccessibleDevBots(user)).length > 0;
}

export async function getDevBot(botId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bot, configs] = await Promise.all([
    devBots.findOne({ _id: botId }),
    botGuildConfigs.find({ botId }).toArray()
  ]);

  return bot ? toDevBotDto(bot, allBotGuildIds(bot, configs.map((config) => config.guildId))) : null;
}

export async function getDevBotBySlug(slug: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const normalizedSlug = slugifyBotName(slug);
  const bot = await devBots.findOne({ slug: normalizedSlug });

  if (!bot) {
    return null;
  }

  const configs = await botGuildConfigs.find({ botId: bot._id }).toArray();
  return toDevBotDto(bot, allBotGuildIds(bot, configs.map((config) => config.guildId)));
}

export async function getAccessibleDashboardBotBySlug(user: AuthSessionUser, slug: string) {
  return (await listAccessibleDevBots(user, { botSlug: slug }))[0] ?? null;
}

export async function findDevBotIdByClientId(clientId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      clientId
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return bot?._id ?? null;
}

export async function canManageDevBot(user: AuthSessionUser, botId: string) {
  if (isDashboardDevUserId(user.discordId)) {
    return true;
  }

  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      _id: botId,
      $or: [
        {
          ownerId: user.discordId
        },
        {
          createdBy: user.discordId
        }
      ]
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function canManageDevBotGuild(user: AuthSessionUser, botId: string | null, guildId: string) {
  const access = await getDevBotGuildAccess(user, botId, guildId);
  const permissions = dashboardPermissionsForLevel(access.accessLevel);

  return access.allowed && (permissions.canManageDashboard || permissions.canManageOwnServices);
}

export async function canAccessDevBotGuild(user: AuthSessionUser, botId: string | null, guildId: string) {
  const access = await getDevBotGuildAccess(user, botId, guildId);

  return access.allowed;
}

export async function getDevBotGuildAccess(
  user: AuthSessionUser,
  botId: string | null,
  guildId: string
): Promise<{
  allowed: boolean;
  accessLevel: SessionAccessLevel;
  permissions: DashboardPermissionFlags;
}> {
  if (!botId) {
    return {
      allowed: false,
      accessLevel: "viewer" as SessionAccessLevel,
      permissions: dashboardPermissionsForLevel("viewer")
    };
  }

  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return {
      allowed: false,
      accessLevel: "viewer" as SessionAccessLevel,
      permissions: dashboardPermissionsForLevel("viewer")
    };
  }

  const botUsesGuild = bot.mainGuildId === guildId || Boolean(await botGuildConfigs.findOne(
    {
      botId,
      guildId
    },
    {
      projection: {
        _id: 1
      }
    }
  ));

  if (!botUsesGuild) {
    return {
      allowed: false,
      accessLevel: "viewer" as SessionAccessLevel,
      permissions: dashboardPermissionsForLevel("viewer")
    };
  }

  const result = await checkAccessDevBotGuild(user, bot, guildId);
  const accessLevel: SessionAccessLevel = result.allowed ? result.accessLevel ?? "basic" : "viewer";

  return {
    allowed: result.allowed,
    accessLevel,
    permissions: dashboardPermissionsForLevel(accessLevel)
  };
}

export async function canUseDevBotModule(
  user: AuthSessionUser,
  botId: string | null,
  guildId: string,
  moduleId: string
) {
  const access = await getDevBotGuildAccess(user, botId, guildId);

  if (!botId || !access.allowed || !canManageModuleAtLevel(access.accessLevel, moduleId)) {
    return false;
  }

  const { devBots } = await getMongoCollections();
  const moduleIds = devBotModuleReleaseIds(moduleId);
  const bot = await devBots.findOne(
    {
      _id: botId,
      enabledModules: {
        $in: moduleIds
      }
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function canReadDevBotModule(
  user: AuthSessionUser,
  botId: string | null,
  guildId: string,
  moduleId: string
) {
  const access = await getDevBotGuildAccess(user, botId, guildId);

  if (!botId || !access.allowed || !canReadModuleAtLevel(access.accessLevel, moduleId)) {
    return false;
  }

  const { devBots } = await getMongoCollections();
  const moduleIds = devBotModuleReleaseIds(moduleId);
  const bot = await devBots.findOne(
    {
      _id: botId,
      enabledModules: {
        $in: moduleIds
      }
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  return Boolean(bot);
}

export async function createDevBot(input: CreateDevBotInput) {
  const { botGuildConfigs, devBots, guilds } = await getMongoCollections();
  const now = new Date();
  const token = normalizeDiscordBotToken(input.token);
  const detectedGuild = await fetchDiscordBotGuild(token, input.mainGuildId);
  const clientId = detectedGuild.botId;

  if (input.verifyOwnerUserId) {
    await assertDiscordBotOwnedByUser(token, input.verifyOwnerUserId, clientId);
  }

  const existingBot = await devBots.findOne(
    {
      clientId
    },
    {
      projection: {
        _id: 1
      }
    }
  );

  if (existingBot) {
    throw createDevBotError("Este Client ID ja esta cadastrado no sistema.", 409);
  }

  const botName = detectedGuild.botName || `Bot ${clientId}`;
  const bot: MongoDevBot = {
    _id: randomUUID(),
    name: botName,
    slug: await generateUniqueDevBotSlug(botName),
    clientId,
    tokenEncrypted: encryptSecret(token),
    tokenPrefix: tokenPrefix(token),
    tokenLast4: tokenLast4(token),
    secretEncrypted: null,
    avatarUrl: detectedGuild.botAvatarUrl,
    botCreatedAt: detectedGuild.botCreatedAt ? new Date(detectedGuild.botCreatedAt) : null,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    mainGuildId: input.mainGuildId,
    mainGuildName: detectedGuild.name,
    mainGuildIconUrl: detectedGuild.iconUrl,
    mainGuildMemberCount: detectedGuild.memberCount,
    mainGuildChannelCount: detectedGuild.channelCount,
    status: "offline",
    statusMessage: "Token validado. Aguardando inicializacao.",
    enabledModules: sanitizeModules(input.enabledModules ?? ["live"]),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now
  };

  await devBots.insertOne(bot);
  await Promise.all([
    guilds.updateOne(
      {
        _id: detectedGuild.id
      },
      {
        $set: {
          name: detectedGuild.name,
          icon: detectedGuild.iconHash,
          ownerId: detectedGuild.ownerId,
          botEnabled: true,
          updatedAt: now
        },
        $setOnInsert: {
          _id: detectedGuild.id,
          createdAt: now
        }
      },
      {
        upsert: true
      }
    ),
    botGuildConfigs.updateOne(
      {
        botId: bot._id,
        guildId: detectedGuild.id
      },
      {
        $set: {
          guildName: detectedGuild.name,
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId: bot._id,
          guildId: detectedGuild.id,
          modules: {},
          createdAt: now
        }
      },
      {
        upsert: true
      }
    )
  ]);
  emitRealtime("dev:bot_created", toDashboardBotDto(toDevBotDto(bot)));

  return toDevBotDto(bot);
}

export async function registerPrimaryDevBot(input: RegisterPrimaryDevBotInput): Promise<RegisterPrimaryDevBotResult> {
  const token = normalizeDiscordBotToken(env.DISCORD_BOT_TOKEN);

  if (!token) {
    throw createDevBotError("DISCORD_BOT_TOKEN nao configurado no servidor.", 400);
  }

  const expectedClientId = env.DISCORD_CLIENT_ID.trim() || undefined;
  const connection = await testDiscordBotToken(token, expectedClientId);

  if (connection.status !== "online" || !connection.clientId) {
    throw createDevBotError(connection.message, 400);
  }

  const detectedGuild = await fetchDiscordBotGuild(token, input.mainGuildId);
  const existingBotId = await findDevBotIdByClientId(connection.clientId);

  if (!existingBotId) {
    const bot = await createDevBot({
      token,
      ownerName: input.ownerName,
      ownerId: input.ownerId,
      mainGuildId: input.mainGuildId,
      enabledModules: input.enabledModules,
      createdBy: input.createdBy
    });

    return {
      bot,
      created: true
    };
  }

  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne({ _id: existingBotId });

  if (!current) {
    throw createDevBotError("Bot nao encontrado para atualizar.", 404);
  }

  const now = new Date();
  const nextName = input.name?.trim() || connection.username || current.name;
  const nextSlug = current.slug?.trim() || await generateUniqueDevBotSlug(nextName, existingBotId);

  await devBots.updateOne(
    {
      _id: existingBotId
    },
    {
      $set: {
        name: nextName,
        slug: nextSlug,
        clientId: connection.clientId,
        tokenEncrypted: encryptSecret(token),
        tokenPrefix: tokenPrefix(token),
        tokenLast4: tokenLast4(token),
        avatarUrl: connection.avatarUrl ?? current.avatarUrl,
        botCreatedAt: connection.createdAt ? new Date(connection.createdAt) : current.botCreatedAt ?? null,
        ownerId: input.ownerId,
        ownerName: input.ownerName,
        mainGuildId: input.mainGuildId,
        mainGuildName: detectedGuild.name,
        mainGuildIconUrl: detectedGuild.iconUrl,
        mainGuildMemberCount: detectedGuild.memberCount,
        mainGuildChannelCount: detectedGuild.channelCount,
        status: "offline",
        statusMessage: "Token validado. Aguardando reinicializacao.",
        enabledModules: sanitizeModules(input.enabledModules),
        updatedAt: now
      }
    }
  );
  await upsertDetectedGuildConfig(existingBotId, detectedGuild, now);

  const bot = await getDevBot(existingBotId);

  if (!bot) {
    throw createDevBotError("Bot nao encontrado depois da atualizacao.", 404);
  }

  emitRealtime("dev:bot_updated", toDashboardBotDto(bot));
  return {
    bot,
    created: false
  };
}

export async function ensurePrimaryDevBotListed(input: EnsurePrimaryDevBotListedInput): Promise<RegisterPrimaryDevBotResult | null> {
  const configuredClientId = env.DISCORD_CLIENT_ID.trim();

  if (configuredClientId) {
    const existingBotId = await findDevBotIdByClientId(configuredClientId);
    const existingBot = existingBotId ? await getDevBot(existingBotId) : null;

    if (existingBot) {
      return {
        bot: existingBot,
        created: false
      };
    }
  }

  const mainGuildId = firstConfiguredDashboardGuildId();

  if (!mainGuildId || !env.DISCORD_BOT_TOKEN.trim()) {
    return null;
  }

  const connection = await testDiscordBotToken(env.DISCORD_BOT_TOKEN, configuredClientId || undefined);

  if (connection.status !== "online" || !connection.clientId) {
    throw createDevBotError(connection.message, 400);
  }

  const existingBotId = await findDevBotIdByClientId(connection.clientId);
  const existingBot = existingBotId ? await getDevBot(existingBotId) : null;

  if (existingBot) {
    return {
      bot: existingBot,
      created: false
    };
  }

  return registerPrimaryDevBot({
    name: connection.username || "Bot OrviteK",
    ownerName: input.ownerName,
    ownerId: input.ownerId,
    mainGuildId,
    enabledModules: DEV_MODULES.map((module) => module.id),
    createdBy: input.createdBy
  });
}

export async function updateDevBot(botId: string, input: UpdateDevBotInput) {
  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne({ _id: botId });

  if (!current) {
    return null;
  }

  const $set: Partial<MongoDevBot> = {
    updatedAt: new Date()
  };

  if (input.name !== undefined) $set.name = input.name?.trim() || current.name;
  if (!current.slug?.trim()) $set.slug = await generateUniqueDevBotSlug($set.name ?? current.name, botId);
  if (input.clientId !== undefined) $set.clientId = input.clientId;
  if (input.secret !== undefined) $set.secretEncrypted = input.secret ? encryptSecret(input.secret) : null;
  if (input.avatarUrl !== undefined) $set.avatarUrl = input.avatarUrl;
  if (input.ownerName !== undefined) $set.ownerName = input.ownerName;
  if (input.ownerId !== undefined) $set.ownerId = input.ownerId;
  if (input.mainGuildId !== undefined) $set.mainGuildId = input.mainGuildId;
  if (input.enabledModules !== undefined) $set.enabledModules = sanitizeModules(input.enabledModules);

  if (input.token) {
    const token = normalizeDiscordBotToken(input.token);
    const connection = await testDiscordBotToken(token, input.clientId ?? current.clientId);

    if (connection.status !== "online") {
      throw createDevBotError(connection.message, 400);
    }

    if (input.verifyOwnerUserId && connection.clientId) {
      await assertDiscordBotOwnedByUser(token, input.verifyOwnerUserId, connection.clientId);
    }

    $set.tokenEncrypted = encryptSecret(token);
    $set.tokenPrefix = tokenPrefix(token);
    $set.tokenLast4 = tokenLast4(token);
    $set.status = connection.status === "online" ? "offline" : connection.status;
    $set.statusMessage = connection.status === "online" ? "Token atualizado. Aguardando reinicializacao." : connection.message;
    $set.avatarUrl = input.avatarUrl || connection.avatarUrl || current.avatarUrl;
    $set.botCreatedAt = connection.createdAt ? new Date(connection.createdAt) : current.botCreatedAt ?? null;
  }

  await devBots.updateOne({ _id: botId }, { $set });
  const updated = await devBots.findOne({ _id: botId });

  if (!updated) {
    return null;
  }

  emitRealtime("dev:bot_updated", toDashboardBotDto(toDevBotDto(updated)));
  return toDevBotDto(updated);
}

export async function deleteDevBot(botId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return null;
  }

  await Promise.all([
    devBots.deleteOne({ _id: botId }),
    botGuildConfigs.deleteMany({ botId })
  ]);

  const dto = toDevBotDto(bot);
  emitRealtime("dev:bot_deleted", toDashboardBotDto(dto));
  return dto;
}

export async function updateDevBotModules(
  botId: string,
  enabledModules: string[],
  options: { actorId?: string | null; syncSecurityAccess?: boolean } = {}
) {
  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne(
    { _id: botId },
    {
      projection: {
        enabledModules: 1
      }
    }
  );
  const hadSelfBot = sanitizeModules(current?.enabledModules ?? []).includes("safe-bot");
  const bot = await updateDevBot(botId, {
    enabledModules
  });

  if (bot) {
    if (!hadSelfBot && bot.enabledModules.includes("safe-bot")) {
      await enableSelfBotDefaults(bot);
    }
    if (hadSelfBot && !bot.enabledModules.includes("safe-bot")) {
      await disableSelfBotDefaults(bot);
    }
    if (options.syncSecurityAccess !== false) {
      await syncSecurityProtectionAccessFromModules(botId, bot.enabledModules, options.actorId ?? null);
    }

    emitRealtime("dev:module_updated", {
      type: "MODULE_UPDATED",
      botId,
      enabledModules: bot.enabledModules
    });
    if (bot.enabledModules.includes("safe-bot")) {
      emitRealtimeToRoom(devBotRealtimeRoom(bot.id), "self-bot:ensure_setup", {
        botId: bot.id,
        guildId: null
      });
    }
  }

  return bot;
}

export async function validateDevBotConnection(botId: string) {
  const { devBots } = await getMongoCollections();
  const bot = await devBots.findOne({ _id: botId });

  if (!bot) {
    return null;
  }

  const connection = await testDiscordBotToken(decryptSecret(bot.tokenEncrypted), bot.clientId);

  await devBots.updateOne(
    { _id: botId },
    {
      $set: {
        status: connection.status === "online" ? "offline" : connection.status,
        statusMessage: connection.status === "online" ? "Token validado. Reiniciando processo." : connection.message,
        avatarUrl: connection.avatarUrl ?? bot.avatarUrl,
        updatedAt: new Date()
      }
    }
  );

  const updated = await devBots.findOne({ _id: botId });
  const dto = updated ? toDevBotDto(updated) : toDevBotDto(bot);
  emitRealtime("dev:bot_restarted", toDashboardBotDto(dto));

  return dto;
}

async function testDiscordBotTokenForClient(token: string, expectedClientId?: string) {
  const normalizedToken = normalizeDiscordBotToken(token);

  if (!normalizedToken) {
    return {
      status: "invalid_token" as const,
      message: "Token invalido.",
      avatarUrl: null,
      clientId: null,
      botId: null,
      username: null,
      createdAt: null
    };
  }

  try {
    const { data } = await axios.get<DiscordBotUser>(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bot ${normalizedToken}`
      },
      timeout: 3500
    });

    if (expectedClientId && data.id !== expectedClientId) {
      return {
        status: "invalid_token" as const,
        message: `O token pertence ao Client ID ${data.id}, nao ao Client ID informado.`,
        avatarUrl: getDiscordAvatarUrl(data.id, data.avatar, "bot"),
        clientId: data.id,
        botId: data.id,
        username: data.username,
        createdAt: snowflakeDate(data.id)?.toISOString() ?? null
      };
    }

    return {
      status: "online" as const,
      message: `Bot conectado como ${data.username}.`,
      avatarUrl: getDiscordAvatarUrl(data.id, data.avatar, "bot"),
      clientId: data.id,
      botId: data.id,
      username: data.username,
      createdAt: snowflakeDate(data.id)?.toISOString() ?? null
    };
  } catch (error) {
    const status = axios.isAxiosError(error) && error.response?.status === 401 ? "invalid_token" : "error";

    return {
      status: status as MongoDevBotStatus,
      message: status === "invalid_token" ? "Token invalido. Verifique os dados do bot." : "Erro ao conectar com a API do Discord.",
      avatarUrl: null,
      clientId: null,
      botId: null,
      username: null,
      createdAt: null
    };
  }
}

async function generateUniqueDevBotSlug(name: string, excludedBotId?: string) {
  const { devBots } = await getMongoCollections();
  const baseSlug = slugifyBotName(name);
  let slug = baseSlug;
  let suffix = 2;

  while (await devBots.findOne(
    excludedBotId
      ? {
          slug,
          _id: {
            $ne: excludedBotId
          }
        }
      : {
          slug
        },
    {
      projection: {
        _id: 1
      }
    }
  )) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

function slugifyBotName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "bot";
}

function buildDashboardUrl(slug: string) {
  const origin = env.SITE_ORIGIN || env.FRONTEND_URL;
  const path = `/${slug}/dashboard`;

  return origin ? `${origin}${path}` : path;
}

export async function testDiscordBotToken(token: string, expectedClientId?: string) {
  return testDiscordBotTokenForClient(token, expectedClientId);
}

async function assertDiscordBotOwnedByUser(token: string, userId: string, expectedClientId: string) {
  const normalizedToken = normalizeDiscordBotToken(token);

  try {
    const { data } = await axios.get<DiscordApplication>(`${DISCORD_API}/oauth2/applications/@me`, {
      headers: {
        Authorization: `Bot ${normalizedToken}`
      },
      timeout: 5_000
    });
    const teamMemberIds = data.team?.members
      ?.filter((member) => member.membership_state === undefined || member.membership_state === 2)
      .map((member) => member.user?.id)
      .filter((memberId): memberId is string => Boolean(memberId)) ?? [];
    const allowedOwnerIds = new Set([
      data.owner?.id,
      data.team?.owner_user_id,
      ...teamMemberIds
    ].filter((ownerId): ownerId is string => Boolean(ownerId)));

    if (data.id !== expectedClientId) {
      throw createDevBotError("O token informado nao pertence ao Client ID detectado.", 400);
    }

    if (!allowedOwnerIds.has(userId)) {
      throw createDevBotError("Este bot nao pertence a sua conta Discord ou ao seu time de aplicativos.", 403);
    }
  } catch (error) {
    if (isDevBotError(error)) {
      throw error;
    }

    const status = axios.isAxiosError(error) ? error.response?.status : null;
    const message = status === 401
      ? "Token invalido. Verifique os dados do bot."
      : "Nao foi possivel confirmar se este bot pertence a sua conta Discord.";

    throw createDevBotError(message, status === 401 ? 400 : 403);
  }
}

export async function detectDiscordBotGuild(token: string, guildId: string): Promise<DetectedDiscordGuild> {
  const guild = await fetchDiscordBotGuild(token, guildId);

  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    onlineCount: guild.onlineCount,
    channelCount: guild.channelCount,
    botId: guild.botId,
    botName: guild.botName,
    botAvatarUrl: guild.botAvatarUrl,
    botCreatedAt: guild.botCreatedAt,
    hasAdministrator: guild.hasAdministrator
  };
}

export async function listDevBotRuntimeConfigs() {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bots, configs] = await Promise.all([
    devBots.find().toArray(),
    botGuildConfigs.find().toArray()
  ]);
  const guildIdsByBot = groupGuildIdsByBot(configs);

  return bots.map((bot) => toDevBotRuntimeConfig(bot, guildIdsByBot.get(bot._id)));
}

export async function listGuildBotRuntimeConfigs(guildId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const configs = await botGuildConfigs.find({ guildId }).toArray();
  const configuredBotIds = configs.map((config) => config.botId);
  const bots = await devBots.find({
    $or: [
      {
        mainGuildId: guildId
      },
      {
        _id: {
          $in: configuredBotIds
        }
      }
    ]
  }).toArray();
  const allConfigs = await botGuildConfigs.find({
    botId: {
      $in: bots.map((bot) => bot._id)
    }
  }).toArray();
  const guildIdsByBot = groupGuildIdsByBot(allConfigs);

  return bots.map((bot) => toDevBotRuntimeConfig(bot, guildIdsByBot.get(bot._id)));
}

export async function getDevBotRuntimeConfig(botId: string) {
  const { botGuildConfigs, devBots } = await getMongoCollections();
  const [bot, configs] = await Promise.all([
    devBots.findOne({ _id: botId }),
    botGuildConfigs.find({ botId }).toArray()
  ]);

  return bot ? toDevBotRuntimeConfig(bot, configs.map((config) => config.guildId)) : null;
}

export async function getDevBotToken(botId: string | null | undefined) {
  if (!botId) {
    return null;
  }

  return (await getDevBotRuntimeConfig(botId))?.token ?? null;
}

export async function updateDevBotRuntimeStatus(botId: string, status: MongoDevBotStatus, statusMessage: string) {
  const { devBots } = await getMongoCollections();

  await devBots.updateOne(
    {
      _id: botId
    },
    {
      $set: {
        status,
        statusMessage: maskSensitiveText(statusMessage),
        updatedAt: new Date()
      }
    }
  );

  const bot = await getDevBot(botId);

  if (bot) {
    emitRealtime("dev:bot_updated", toDashboardBotDto(bot));
  }

  return bot;
}

export async function markDevBotsOfflineAfterBackendRestart() {
  const { devBots } = await getMongoCollections();
  const restartedAt = new Date();
  const previouslyOnline = await devBots.find({
    status: "online"
  }, {
    projection: {
      _id: 1
    }
  }).toArray();

  if (!previouslyOnline.length) {
    return 0;
  }

  await devBots.updateMany(
    {
      _id: {
        $in: previouslyOnline.map((bot) => bot._id)
      }
    },
    {
      $set: {
        status: "offline",
        statusMessage: "Backend reiniciado. Aguardando inicializacao do processo do bot.",
        updatedAt: restartedAt
      }
    }
  );

  await Promise.all(previouslyOnline.map(async (bot) => {
    const updatedBot = await getDevBot(bot._id);

    if (updatedBot) {
      emitRealtime("dev:bot_updated", toDashboardBotDto(updatedBot));
    }
  }));

  return previouslyOnline.length;
}

export async function syncDevBotProfile(
  botId: string,
  profile: {
    avatarUrl?: string | null;
    id?: string | null;
    username?: string | null;
  } | null | undefined
) {
  const profileId = profile?.id?.trim();
  const username = profile?.username?.trim();

  if (!profileId || !username) {
    return null;
  }

  const { devBots } = await getMongoCollections();
  const current = await devBots.findOne({ _id: botId });

  if (!current) {
    return null;
  }

  if (current.clientId !== profileId) {
    console.warn(`[dev-bot] perfil ignorado para ${botId}: clientId recebido ${profileId} difere do cadastro ${current.clientId}.`);
    return toDevBotDto(current);
  }

  const avatarUrl = normalizeProfileAvatarUrl(profile?.avatarUrl);
  const changed = current.name !== username || (current.avatarUrl ?? null) !== avatarUrl;

  if (!changed) {
    return toDevBotDto(current);
  }

  const now = new Date();

  await devBots.updateOne(
    {
      _id: botId
    },
    {
      $set: {
        name: username,
        avatarUrl,
        updatedAt: now
      }
    }
  );

  const updated = await devBots.findOne({ _id: botId });
  const dto = updated ? toDevBotDto(updated) : toDevBotDto({
    ...current,
    name: username,
    avatarUrl,
    updatedAt: now
  });

  await createLog({
    botId,
    guildId: current.mainGuildId,
    type: "dev.bot.profile_synced",
    message: `Perfil do bot atualizado automaticamente: ${username}.`,
    metadata: {
      avatarChanged: (current.avatarUrl ?? null) !== avatarUrl,
      botId,
      clientId: profileId,
      nameChanged: current.name !== username,
      newAvatarUrl: avatarUrl,
      newName: username,
      oldAvatarUrl: current.avatarUrl ?? null,
      oldName: current.name
    }
  }).catch((error) => {
    console.warn("[dev-bot] nao foi possivel registrar log de perfil atualizado:", error instanceof Error ? error.message : error);
  });

  emitRealtime("dev:bot_updated", toDashboardBotDto(dto));
  console.log(`[dev-bot] perfil sincronizado para ${botId}: ${current.name} -> ${username}`);

  return dto;
}

export async function syncDevBotGuilds(botId: string, guilds: Array<{ id: string; name: string }>) {
  const { botGuildConfigs, devBots, guilds: guildCollection } = await getMongoCollections();
  const bot = await devBots.findOne(
    {
      _id: botId
    },
    {
      projection: {
        mainGuildId: 1
      }
    }
  );

  if (!bot) {
    return;
  }

  const now = new Date();
  const uniqueGuilds = [...new Map(guilds.map((guild) => [guild.id, guild])).values()];

  if (uniqueGuilds.length) {
    await Promise.all([
      guildCollection.bulkWrite(
        uniqueGuilds.map((guild) => ({
          updateOne: {
            filter: {
              _id: guild.id
            },
            update: {
              $set: {
                name: guild.name,
                botEnabled: true,
                updatedAt: now
              },
              $setOnInsert: {
                _id: guild.id,
                icon: null,
                ownerId: null,
                createdAt: now
              }
            },
            upsert: true
          }
        }))
      ),
      botGuildConfigs.bulkWrite(
        uniqueGuilds.map((guild) => ({
          updateOne: {
            filter: {
              botId,
              guildId: guild.id
            },
            update: {
              $set: {
                guildName: guild.name,
                updatedAt: now
              },
              $setOnInsert: {
                _id: randomUUID(),
                botId,
                guildId: guild.id,
                modules: {},
                createdAt: now
              }
            },
            upsert: true
          }
        }))
      )
    ]);
  }

  const retainedGuildIds = [...new Set([bot.mainGuildId, ...uniqueGuilds.map((guild) => guild.id)])];
  await botGuildConfigs.deleteMany({
    botId,
    guildId: {
      $nin: retainedGuildIds
    }
  });
}

export async function listBotGuildConfigs(botId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const configs = await botGuildConfigs.find({ botId }).sort({ updatedAt: -1 }).toArray();

  return configs.map(toBotGuildConfigDto);
}

export async function getBotGuildConfig(botId: string, guildId: string) {
  const { botGuildConfigs } = await getMongoCollections();
  const config = await botGuildConfigs.findOne({ botId, guildId });

  return config ? toBotGuildConfigDto(config) : defaultBotGuildConfig(botId, guildId);
}

export async function getBotGuildModuleConfig(botId: string, guildId: string, moduleId: string) {
  const config = await getBotGuildConfig(botId, guildId);
  const releaseModuleId = resolveRuntimeReleaseModuleId(moduleId) ?? moduleId;
  const modules = config.modules as Record<string, Record<string, unknown>>;
  const moduleConfig = modules[moduleId] ?? modules[releaseModuleId] ?? {};

  return {
    botId,
    config: moduleConfig,
    guildId,
    moduleId,
    updatedAt: config.updatedAt
  };
}

export async function updateBotGuildModuleConfig(input: {
  botId: string;
  guildId: string;
  guildName: string;
  moduleId: string;
  config: Record<string, unknown>;
}) {
  const current = await getBotGuildConfig(input.botId, input.guildId);
  const currentModules = current.modules as Record<string, Record<string, unknown>>;
  const nextModules = {
    ...currentModules,
    [input.moduleId]: sanitizeBotGuildModuleConfig(input.config)
  };
  const saved = await updateBotGuildConfig({
    botId: input.botId,
    guildId: input.guildId,
    guildName: input.guildName,
    modules: nextModules
  });

  return {
    botId: input.botId,
    config: (saved.modules as Record<string, Record<string, unknown>>)[input.moduleId] ?? {},
    guildId: input.guildId,
    moduleId: input.moduleId,
    updatedAt: saved.updatedAt
  };
}

export async function updateBotGuildConfig(input: {
  botId: string;
  guildId: string;
  guildName: string;
  modules: Record<string, Record<string, unknown>>;
}) {
  const { botGuildConfigs } = await getMongoCollections();
  const now = new Date();

  await botGuildConfigs.updateOne(
    {
      botId: input.botId,
      guildId: input.guildId
    },
    {
      $set: {
        guildName: input.guildName,
        modules: input.modules,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        botId: input.botId,
        guildId: input.guildId,
        createdAt: now
      }
    },
    {
      upsert: true
    }
  );

  const config = await botGuildConfigs.findOne({
    botId: input.botId,
    guildId: input.guildId
  });
  const dto = config ? toBotGuildConfigDto(config) : defaultBotGuildConfig(input.botId, input.guildId);

  emitRealtime("dev:config_updated", {
    type: "CONFIG_UPDATED",
    botId: input.botId,
    guildId: input.guildId
  });

  return dto;
}

function sanitizeBotGuildModuleConfig(config: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => /^[a-zA-Z0-9_-]{1,80}$/.test(key))
  );
}

export async function getBotApiPermissions(botId: string) {
  const bot = await getDevBot(botId);

  if (!bot) {
    return null;
  }

  return {
    botId: bot.id,
    enabledModules: sanitizeModules(bot.enabledModules),
    status: bot.status
  };
}

export async function getSecurityProtectionAccess(botId: string): Promise<SecurityFeatureAccessDto> {
  const bot = await getDevBot(botId);

  if (!bot) {
    throw new Error("Bot nao encontrado.");
  }

  const access = await readSecurityProtectionAccess(botId);
  return toSecurityFeatureAccessDto(botId, access, bot.enabledModules.includes("safe-bot"));
}

export async function setSecurityProtectionAccess(input: {
  botId: string;
  enabledByDev: boolean;
  actorId: string | null;
}): Promise<SecurityFeatureAccessDto> {
  const bot = await getDevBot(input.botId);

  if (!bot) {
    throw new Error("Bot nao encontrado.");
  }

  const { securityFeatureAccess } = await getMongoCollections();
  const now = new Date();
  await securityFeatureAccess.updateOne(
    {
      botId: input.botId,
      featureKey: SECURITY_PROTECTION_FEATURE_KEY
    },
    {
      $set: {
        botId: input.botId,
        enabledBy: input.actorId,
        enabledByDev: input.enabledByDev,
        enabledAt: input.enabledByDev ? now : null,
        featureKey: SECURITY_PROTECTION_FEATURE_KEY,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    { upsert: true }
  );

  const modules = input.enabledByDev
    ? [...new Set([...bot.enabledModules, "safe-bot"])]
    : bot.enabledModules.filter((moduleId) => moduleId !== "safe-bot");
  const updatedBot = await updateDevBotModules(input.botId, modules, {
    syncSecurityAccess: false
  });
  const saved = await readSecurityProtectionAccess(input.botId);

  return toSecurityFeatureAccessDto(input.botId, saved, Boolean(updatedBot?.enabledModules.includes("safe-bot")));
}

export async function syncSecurityProtectionAccessFromModules(
  botId: string,
  enabledModules: string[],
  actorId: string | null = null
) {
  const enabledByDev = sanitizeModules(enabledModules).includes("safe-bot");
  const { securityFeatureAccess } = await getMongoCollections();
  const now = new Date();
  const current = await securityFeatureAccess.findOne({
    botId,
    featureKey: SECURITY_PROTECTION_FEATURE_KEY
  });

  if (current?.enabledByDev === enabledByDev) {
    return toSecurityFeatureAccessDto(botId, current, enabledByDev);
  }

  await securityFeatureAccess.updateOne(
    {
      botId,
      featureKey: SECURITY_PROTECTION_FEATURE_KEY
    },
    {
      $set: {
        botId,
        enabledBy: actorId ?? current?.enabledBy ?? null,
        enabledByDev,
        enabledAt: enabledByDev ? now : null,
        featureKey: SECURITY_PROTECTION_FEATURE_KEY,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now
      }
    },
    { upsert: true }
  );

  const saved = await readSecurityProtectionAccess(botId);
  return toSecurityFeatureAccessDto(botId, saved, enabledByDev);
}

export async function isSecurityProtectionReleasedForBot(botId: string) {
  const bot = await getDevBot(botId);

  if (!bot) {
    return false;
  }

  const access = await readSecurityProtectionAccess(botId);
  return toSecurityFeatureAccessDto(botId, access, bot.enabledModules.includes("safe-bot")).enabledByDev;
}

async function readSecurityProtectionAccess(botId: string) {
  const { securityFeatureAccess } = await getMongoCollections();
  return securityFeatureAccess.findOne({
    botId,
    featureKey: SECURITY_PROTECTION_FEATURE_KEY
  });
}

function toSecurityFeatureAccessDto(
  botId: string,
  access: MongoSecurityFeatureAccess | null,
  legacySafeBotReleased: boolean
): SecurityFeatureAccessDto {
  const updatedAt = access?.updatedAt ?? new Date(0);
  return {
    botId: access?.botId ?? botId,
    enabledAt: access?.enabledAt?.toISOString() ?? (legacySafeBotReleased ? updatedAt.toISOString() : null),
    enabledBy: access?.enabledBy ?? null,
    enabledByDev: access?.enabledByDev ?? legacySafeBotReleased,
    featureKey: SECURITY_PROTECTION_FEATURE_KEY,
    updatedAt: updatedAt.toISOString()
  };
}

export async function authorizeBotRuntimeModule(input: {
  botId: string | null | undefined;
  guildId: string;
  moduleId: string;
}): Promise<BotRuntimeModuleAuthorization> {
  const checkedAt = new Date().toISOString();
  const botId = normalizeNullableId(input.botId);
  const moduleId = normalizeRuntimeModuleId(input.moduleId);
  const releaseModuleId = resolveRuntimeReleaseModuleId(moduleId);

  if (!botId) {
    return runtimeDenied({
      botId: null,
      checkedAt,
      guildId: input.guildId,
      moduleId,
      reason: "Bot nao identificado na requisicao runtime.",
      reasonCode: "missing_bot_id",
      releaseModuleId
    });
  }

  if (!releaseModuleId) {
    return runtimeDenied({
      botId,
      checkedAt,
      guildId: input.guildId,
      moduleId,
      reason: "Modulo nao reconhecido pela dashboard.",
      reasonCode: "unknown_module",
      releaseModuleId: null
    });
  }

  const { botGuildConfigs, devBots, guilds } = await getMongoCollections();
  const [bot, guild, guildConfig] = await Promise.all([
    devBots.findOne({ _id: botId }),
    guilds.findOne({ _id: input.guildId }),
    botGuildConfigs.findOne({
      botId,
      guildId: input.guildId
    })
  ]);

  if (!bot) {
    return runtimeDenied({
      botId,
      checkedAt,
      guildId: input.guildId,
      moduleId,
      reason: "Bot nao encontrado na dashboard.",
      reasonCode: "bot_not_found",
      releaseModuleId
    });
  }

  if (RUNTIME_INACTIVE_BOT_STATUSES.has(bot.status)) {
    return runtimeDenied({
      botAuthorized: false,
      botId,
      botStatus: bot.status,
      checkedAt,
      guildId: input.guildId,
      moduleId,
      reason: `Bot esta com status ${bot.status}.`,
      reasonCode: "bot_inactive",
      releaseModuleId
    });
  }

  if (!guild || guild.botEnabled === false) {
    return runtimeDenied({
      botAuthorized: true,
      botId,
      botStatus: bot.status,
      checkedAt,
      guildAuthorized: false,
      guildId: input.guildId,
      moduleId,
      reason: "Servidor nao esta aprovado para este bot.",
      reasonCode: "guild_inactive",
      releaseModuleId
    });
  }

  if (!guildConfig) {
    return runtimeDenied({
      botAuthorized: true,
      botId,
      botStatus: bot.status,
      checkedAt,
      guildAuthorized: false,
      guildId: input.guildId,
      moduleId,
      reason: "Servidor nao esta vinculado a este bot.",
      reasonCode: "guild_not_registered",
      releaseModuleId
    });
  }

  const enabledModules = sanitizeModules(bot.enabledModules);
  const moduleReleased = enabledModules.includes(releaseModuleId as (typeof DEV_MODULES)[number]["id"]);
  const securityReleased = releaseModuleId === "safe-bot"
    ? await isSecurityProtectionReleasedForBot(botId)
    : true;
  const moduleConfig = readRuntimeModuleConfig(guildConfig.modules, moduleId, releaseModuleId);
  const license = evaluateRuntimeLicenseState(
    moduleConfig,
    guildConfig.modules?.license,
    guildConfig.modules?.dashboard
  );

  if (!moduleReleased || !securityReleased) {
    return runtimeDenied({
      botAuthorized: true,
      botId,
      botStatus: bot.status,
      checkedAt,
      guildAuthorized: true,
      guildId: input.guildId,
      license,
      moduleId,
      moduleReleased: false,
      reason: !securityReleased
        ? "Protecao/SafeBot nao foi liberada pelo Dev para este bot."
        : "Modulo nao foi liberado para este bot.",
      reasonCode: !securityReleased ? "security_feature_not_released" : "module_not_released",
      releaseModuleId
    });
  }

  if (!license.valid) {
    return runtimeDenied({
      botAuthorized: true,
      botId,
      botStatus: bot.status,
      checkedAt,
      guildAuthorized: true,
      guildId: input.guildId,
      license,
      moduleId,
      moduleReleased: true,
      reason: license.reason,
      reasonCode: license.reasonCode,
      releaseModuleId
    });
  }

  const moduleEnabled = await isRuntimeModuleEnabled({
    botId,
    guildId: input.guildId,
    moduleConfig,
    moduleId,
    releaseModuleId
  });

  if (!moduleEnabled) {
    return runtimeDenied({
      botAuthorized: true,
      botId,
      botStatus: bot.status,
      checkedAt,
      guildAuthorized: true,
      guildId: input.guildId,
      license,
      moduleEnabled: false,
      moduleId,
      moduleReleased: true,
      reason: "Modulo esta desativado para este bot/servidor.",
      reasonCode: "module_disabled",
      releaseModuleId
    });
  }

  return {
    allowed: true,
    botAuthorized: true,
    botId,
    botStatus: bot.status,
    checkedAt,
    guildAuthorized: true,
    guildId: input.guildId,
    licenseExpiresAt: license.expiresAt?.toISOString() ?? null,
    licenseStatus: license.status,
    licenseValid: true,
    moduleEnabled: true,
    moduleId,
    moduleReleased: true,
    plan: license.plan,
    policy: "fail_closed",
    reason: "Modulo autorizado para este bot e servidor.",
    reasonCode: "allowed",
    releaseModuleId
  };
}

export function runtimeModuleIdForLogType(type: string) {
  const normalized = type.trim().toLowerCase();

  if (normalized.startsWith("self_bot_protection.") || normalized.startsWith("security.self_bot")) {
    return "safe-bot";
  }

  if (normalized.startsWith("image_anti_spam.")) {
    return "safe-bot";
  }

  if (normalized === "moderation.link_anti_spam") {
    return "safe-bot";
  }

  if (normalized.startsWith("moderation.")) {
    return "moderation";
  }

  if (
    normalized.startsWith("dashboard.roles.")
    || normalized.startsWith("roles.")
  ) {
    return "roles";
  }

  if (
    normalized.startsWith("server_clone.")
    || normalized.startsWith("server-clone.")
  ) {
    return "server-cloner";
  }

  if (normalized.startsWith("emoji_clone.")) {
    return "emoji-cloner";
  }

  if (
    normalized.startsWith("message.")
    || normalized.startsWith("member.")
  ) {
    return "logs";
  }

  return null;
}

function runtimeDenied(input: {
  botAuthorized?: boolean;
  botId: string | null;
  botStatus?: MongoDevBotStatus | null;
  checkedAt: string;
  guildAuthorized?: boolean;
  guildId: string;
  license?: ReturnType<typeof evaluateRuntimeLicenseState>;
  moduleEnabled?: boolean;
  moduleId: string;
  moduleReleased?: boolean;
  reason: string;
  reasonCode: string;
  releaseModuleId: string | null;
}): BotRuntimeModuleAuthorization {
  const license = input.license ?? {
    expiresAt: null,
    plan: null,
    reason: input.reason,
    reasonCode: input.reasonCode,
    status: null,
    valid: true
  };

  return {
    allowed: false,
    botAuthorized: input.botAuthorized ?? false,
    botId: input.botId,
    botStatus: input.botStatus ?? null,
    checkedAt: input.checkedAt,
    guildAuthorized: input.guildAuthorized ?? false,
    guildId: input.guildId,
    licenseExpiresAt: license.expiresAt?.toISOString() ?? null,
    licenseStatus: license.status,
    licenseValid: license.valid,
    moduleEnabled: input.moduleEnabled ?? false,
    moduleId: input.moduleId,
    moduleReleased: input.moduleReleased ?? false,
    plan: license.plan,
    policy: "fail_closed",
    reason: input.reason,
    reasonCode: input.reasonCode,
    releaseModuleId: input.releaseModuleId
  };
}

async function isRuntimeModuleEnabled(input: {
  botId: string;
  guildId: string;
  moduleConfig: MongoBotGuildModuleConfig | null;
  moduleId: string;
  releaseModuleId: string;
}) {
  if (input.moduleConfig?.enabled === false) {
    return false;
  }

  if (input.releaseModuleId === "safe-bot" || SELF_BOT_RUNTIME_MODULES.has(input.moduleId)) {
    const [guildSettings, settings] = await Promise.all([
      getGuildSettings(input.guildId, input.botId),
      getSelfBotProtectionSettings(input.guildId, input.botId)
    ]);

    if (!guildSettings.safeBotEnabled || !settings.enabled) {
      return false;
    }

    const moduleToggle = selfBotToggleForRuntimeModule(input.moduleId);
    return moduleToggle ? settings.moduleToggles[moduleToggle] === true : true;
  }

  if (input.moduleId === "image-anti-spam") {
    const settings = await getImageAntiSpamSettings(input.guildId, input.botId);
    return settings.enabled;
  }

  if (input.moduleId === "logs") {
    const settings = await getGuildSettings(input.guildId, input.botId);
    return settings.siteLogsEnabled || (settings.discordLogsEnabled && Boolean(settings.logChannelId));
  }

  const guildSettingsModuleEnabled = await isGuildSettingsModuleEnabled(input);

  if (guildSettingsModuleEnabled !== null) {
    return guildSettingsModuleEnabled;
  }

  if (input.moduleConfig?.enabled === true) {
    return true;
  }

  return true;
}

async function isGuildSettingsModuleEnabled(input: {
  botId: string;
  guildId: string;
  moduleId: string;
  releaseModuleId: string;
}) {
  const settingsKeyByModule: Record<string, keyof Pick<
    Awaited<ReturnType<typeof getGuildSettings>>,
    | "accountAgeSecurityEnabled"
    | "autoRoleEnabled"
    | "emojiCloneEnabled"
    | "leaveEnabled"
    | "moderationEnabled"
    | "rulesEnabled"
    | "ticketEnabled"
    | "verificationEnabled"
    | "welcomeEnabled"
  >> = {
    "account-age-security": "accountAgeSecurityEnabled",
    "emoji-cloner": "emojiCloneEnabled",
    leave: "leaveEnabled",
    moderation: "moderationEnabled",
    roles: "autoRoleEnabled",
    rules: "rulesEnabled",
    tickets: "ticketEnabled",
    verification: "verificationEnabled",
    welcome: "welcomeEnabled"
  };
  const settingsKey = settingsKeyByModule[input.releaseModuleId] ?? settingsKeyByModule[input.moduleId];

  if (!settingsKey) {
    return null;
  }

  const settings = await getGuildSettings(input.guildId, input.botId);
  return settings[settingsKey] === true;
}

function selfBotToggleForRuntimeModule(moduleId: string): SelfBotProtectionModuleId | null {
  const normalized = normalizeRuntimeModuleId(moduleId);

  if (normalized === "safe-bot") {
    return null;
  }

  if (normalized === "anti-link" || normalized === "link-anti-spam") {
    return "anti-links";
  }

  if (normalized === "image-anti-spam") {
    return "anti-imagens";
  }

  return SELF_BOT_PROTECTION_RUNTIME_TOGGLES.has(normalized)
    ? normalized as SelfBotProtectionModuleId
    : null;
}

function readRuntimeModuleConfig(
  modules: Record<string, MongoBotGuildModuleConfig> | null | undefined,
  moduleId: string,
  releaseModuleId: string
) {
  return modules?.[moduleId] ?? modules?.[releaseModuleId] ?? null;
}

function evaluateRuntimeLicenseState(...configs: Array<MongoBotGuildModuleConfig | null | undefined>) {
  let status: string | null = null;
  let expiresAt: Date | null = null;
  let plan: string | null = null;

  for (const config of configs) {
    const record = asRuntimeRecord(config);

    if (!record) {
      continue;
    }

    status ??= normalizeRuntimeStatus(
      readRuntimeString(record.licenseStatus)
      ?? readRuntimeString(record.licenceStatus)
      ?? readRuntimeString(record.status)
      ?? readRuntimeString(record.state)
    );
    expiresAt ??= readRuntimeDate(record.licenseExpiresAt)
      ?? readRuntimeDate(record.licenceExpiresAt)
      ?? readRuntimeDate(record.expiresAt)
      ?? readRuntimeDate(record.expirationDate);
    plan ??= readRuntimeString(record.plan)
      ?? readRuntimeString(record.licensePlan)
      ?? readRuntimeString(record.licencePlan);

    if (
      record.licenseActive === false
      || record.licenceActive === false
      || record.active === false
      || record.approved === false
    ) {
      return {
        expiresAt,
        plan,
        reason: "Licenca do modulo esta inativa na dashboard.",
        reasonCode: "license_inactive",
        status,
        valid: false
      };
    }
  }

  if (status && !RUNTIME_ACTIVE_LICENSE_STATUSES.has(status)) {
    if (RUNTIME_EXPIRED_LICENSE_STATUSES.has(status)) {
      return {
        expiresAt,
        plan,
        reason: "Licenca do modulo esta expirada.",
        reasonCode: "license_expired",
        status,
        valid: false
      };
    }

    if (RUNTIME_BLOCKED_LICENSE_STATUSES.has(status)) {
      return {
        expiresAt,
        plan,
        reason: "Licenca do modulo esta bloqueada.",
        reasonCode: "license_blocked",
        status,
        valid: false
      };
    }

    return {
      expiresAt,
      plan,
      reason: "Licenca do modulo nao esta ativa.",
      reasonCode: "license_inactive",
      status,
      valid: false
    };
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return {
      expiresAt,
      plan,
      reason: "Licenca do modulo esta expirada.",
      reasonCode: "license_expired",
      status,
      valid: false
    };
  }

  return {
    expiresAt,
    plan,
    reason: "Licenca valida.",
    reasonCode: "license_valid",
    status,
    valid: true
  };
}

function resolveRuntimeReleaseModuleId(moduleId: string) {
  const alias = RUNTIME_MODULE_RELEASE_ALIASES[moduleId];

  if (alias) {
    return alias;
  }

  if (DEV_MODULE_IDS.has(moduleId as (typeof DEV_MODULES)[number]["id"])) {
    return moduleId;
  }

  if (SELF_BOT_RUNTIME_MODULES.has(moduleId)) {
    return "safe-bot";
  }

  return null;
}

function normalizeRuntimeModuleId(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNullableId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function asRuntimeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRuntimeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRuntimeDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRuntimeStatus(value: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase() ?? null;
}

function sanitizeModules(modules: string[]) {
  return [...new Set(
    modules
      .map((module) => LEGACY_MODULE_ALIASES[module] ?? module)
      .filter((module) => DEV_MODULE_IDS.has(module as (typeof DEV_MODULES)[number]["id"]) || isCustomFivemModuleId(module))
  )];
}

function devBotModuleReleaseIds(moduleId: string) {
  const canonicalModuleId = LEGACY_MODULE_ALIASES[moduleId] ?? moduleId;

  return [...new Set([moduleId, canonicalModuleId])];
}

async function enableSelfBotDefaults(bot: DevBotDto) {
  const [settings, protection] = await Promise.all([
    updateGuildSettings(bot.mainGuildId, {
      safeBotEnabled: true
    }, bot.id),
    saveSelfBotProtectionSettings(bot.mainGuildId, bot.id, {
      enabled: true
    }, null)
  ]);

  emitRealtime("settings:updated", settings);
  emitRealtime("self-bot-protection:settings_updated", protection);
  emitRealtimeToRoom(devBotRealtimeRoom(bot.id), "self-bot:ensure_setup", {
    botId: bot.id,
    guildId: null
  });
}

async function disableSelfBotDefaults(bot: DevBotDto) {
  const runtime = await getDevBotRuntimeConfig(bot.id);
  const guildIds = runtime?.guildIds ?? [bot.mainGuildId];
  const updates = await Promise.all(
    guildIds.map(async (guildId) => {
      const [settings, protection] = await Promise.all([
        updateGuildSettings(guildId, {
          safeBotEnabled: false
        }, bot.id),
        saveSelfBotProtectionSettings(guildId, bot.id, {
          enabled: false
        }, null)
      ]);

      return {
        protection,
        settings
      };
    })
  );

  for (const update of updates) {
    emitRealtime("settings:updated", update.settings);
    emitRealtime("self-bot-protection:settings_updated", update.protection);
  }
}

function toDevBotDto(bot: MongoDevBot, guildIds: string[] = [bot.mainGuildId], accessLevel: DashboardAccessLevel = "admin"): DevBotDto {
  const slug = bot.slug || slugifyBotName(bot.name);
  const permissions = dashboardPermissionsForLevel(accessLevel);

  return {
    id: bot._id,
    name: bot.name,
    slug,
    dashboardUrl: buildDashboardUrl(slug),
    clientId: bot.clientId,
    tokenMasked: bot.tokenEncrypted ? maskedToken(bot) : "",
    secretConfigured: Boolean(bot.secretEncrypted),
    avatarUrl: bot.avatarUrl ?? null,
    ownerId: bot.ownerId,
    ownerName: bot.ownerName,
    mainGuildId: bot.mainGuildId,
    mainGuildName: bot.mainGuildName ?? `Servidor ${bot.mainGuildId}`,
    mainGuildIconUrl: bot.mainGuildIconUrl ?? null,
    mainGuildMemberCount: bot.mainGuildMemberCount ?? 0,
    mainGuildChannelCount: bot.mainGuildChannelCount ?? 0,
    botCreatedAt: bot.botCreatedAt?.toISOString?.() ?? null,
    guildIds: [...new Set(guildIds)],
    status: bot.status,
    statusMessage: bot.statusMessage ? maskSensitiveText(bot.statusMessage) : null,
    enabledModules: sanitizeModules(bot.enabledModules),
    accessLevel,
    permissions,
    createdBy: bot.createdBy,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString()
  };
}

async function fetchDiscordBotGuild(token: string, guildId: string): Promise<DetectedDiscordGuildRecord> {
  const normalizedToken = normalizeDiscordBotToken(token);

  if (!normalizedToken) {
    throw createDevBotError("Informe o token do bot para detectar o servidor.", 400);
  }

  try {
    const { data: botUser } = await axios.get<DiscordBotUser>(`${DISCORD_API}/users/@me`, {
      headers: {
        Authorization: `Bot ${normalizedToken}`
      },
      timeout: 3500
    });
    const [{ data: guild }, { data: channels }, { data: roles }, { data: botMember }] = await Promise.all([
      axios.get<DiscordGuildDetails>(`${DISCORD_API}/guilds/${guildId}`, {
        headers: {
          Authorization: `Bot ${normalizedToken}`
        },
        params: {
          with_counts: true
        },
        timeout: 5000
      }),
      axios.get<DiscordGuildChannel[]>(`${DISCORD_API}/guilds/${guildId}/channels`, {
        headers: {
          Authorization: `Bot ${normalizedToken}`
        },
        timeout: 5000
      }),
      axios.get<DiscordRole[]>(`${DISCORD_API}/guilds/${guildId}/roles`, {
        headers: {
          Authorization: `Bot ${normalizedToken}`
        },
        timeout: 5000
      }),
      axios.get<DiscordGuildMember>(`${DISCORD_API}/guilds/${guildId}/members/${botUser.id}`, {
        headers: {
          Authorization: `Bot ${normalizedToken}`
        },
        timeout: 5000
      })
    ]);
    const botRoleIds = new Set([guildId, ...botMember.roles]);
    const botPermissions = roles
      .filter((role) => botRoleIds.has(role.id))
      .reduce((permissions, role) => permissions | parsePermissions(role.permissions), 0n);
    const hasAdministrator = (botPermissions & 0x8n) === 0x8n;

    if (!hasAdministrator) {
      throw createDevBotError("O bot precisa estar no servidor com permissao de Administrador para liberar o painel completo.", 400);
    }

    return {
      id: guild.id,
      name: guild.name,
      iconHash: guild.icon,
      iconUrl: getGuildIconUrl(guild.id, guild.icon),
      ownerId: guild.owner_id,
      memberCount: guild.approximate_member_count ?? 0,
      onlineCount: guild.approximate_presence_count ?? 0,
      channelCount: channels.length,
      botId: botUser.id,
      botName: botUser.username,
      botAvatarUrl: getDiscordAvatarUrl(botUser.id, botUser.avatar, "bot"),
      botCreatedAt: snowflakeDate(botUser.id)?.toISOString() ?? null,
      hasAdministrator
    };
  } catch (error) {
    if (isDevBotError(error)) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw createDevBotError("Token do bot invalido.", 400);
      }

      if (error.response?.status === 403 || error.response?.status === 404) {
        throw createDevBotError("O bot nao esta no servidor informado ou nao consegue acessar os dados dele.", 400);
      }
    }

    throw createDevBotError("Nao foi possivel detectar o servidor no Discord.", 502);
  }
}

function toDevBotRuntimeConfig(bot: MongoDevBot, guildIds: string[] = [bot.mainGuildId]): DevBotRuntimeConfig {
  return {
    id: bot._id,
    clientId: bot.clientId,
    name: bot.name,
    token: decryptSecret(bot.tokenEncrypted),
    mainGuildId: bot.mainGuildId,
    guildIds: allBotGuildIds(bot, guildIds),
    enabledModules: sanitizeModules(bot.enabledModules)
  };
}

function toDashboardBotDto(bot: DevBotDto): DashboardBotDto {
  return {
    id: bot.id,
    name: bot.name,
    slug: bot.slug,
    dashboardUrl: bot.dashboardUrl,
    clientId: bot.clientId,
    avatarUrl: bot.avatarUrl,
    ownerId: bot.ownerId,
    mainGuildId: bot.mainGuildId,
    mainGuildName: bot.mainGuildName,
    mainGuildIconUrl: bot.mainGuildIconUrl,
    mainGuildMemberCount: bot.mainGuildMemberCount,
    mainGuildChannelCount: bot.mainGuildChannelCount,
    botCreatedAt: bot.botCreatedAt,
    guildIds: bot.guildIds,
    status: bot.status,
    statusMessage: bot.statusMessage,
    enabledModules: bot.enabledModules,
    accessLevel: bot.accessLevel,
    permissions: bot.permissions,
    createdBy: bot.createdBy
  };
}

function toBotGuildConfigDto(config: MongoBotGuildConfig) {
  return {
    id: config._id,
    botId: config.botId,
    guildId: config.guildId,
    guildName: config.guildName,
    modules: config.modules,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function defaultBotGuildConfig(botId: string, guildId: string) {
  const now = new Date().toISOString();

  return {
    id: "",
    botId,
    guildId,
    guildName: `Servidor ${guildId}`,
    modules: {},
    createdAt: now,
    updatedAt: now
  };
}

async function upsertDetectedGuildConfig(botId: string, detectedGuild: DetectedDiscordGuildRecord, now = new Date()) {
  const { botGuildConfigs, guilds } = await getMongoCollections();

  await Promise.all([
    guilds.updateOne(
      {
        _id: detectedGuild.id
      },
      {
        $set: {
          name: detectedGuild.name,
          icon: detectedGuild.iconHash,
          ownerId: detectedGuild.ownerId,
          botEnabled: true,
          updatedAt: now
        },
        $setOnInsert: {
          _id: detectedGuild.id,
          createdAt: now
        }
      },
      {
        upsert: true
      }
    ),
    botGuildConfigs.updateOne(
      {
        botId,
        guildId: detectedGuild.id
      },
      {
        $set: {
          guildName: detectedGuild.name,
          updatedAt: now
        },
        $setOnInsert: {
          _id: randomUUID(),
          botId,
          guildId: detectedGuild.id,
          modules: {},
          createdAt: now
        }
      },
      {
        upsert: true
      }
    )
  ]);
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Token protegido invalido.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  return createHash("sha256").update(env.JWT_SECRET || env.SESSION_SECRET).digest();
}

function createDevBotError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

function isDevBotError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

function normalizeDiscordBotToken(value: string) {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Bot\s+/i, "")
    .trim();
}

function tokenPrefix(token: string) {
  return token.trim().slice(0, 8) || null;
}

function tokenLast4(token: string) {
  return token.trim().slice(-4) || null;
}

function maskedToken(bot: Pick<MongoDevBot, "tokenEncrypted" | "tokenPrefix" | "tokenLast4">) {
  const parts = tokenMaskParts(bot);

  if (parts.prefix && parts.tail) {
    return `${parts.prefix}${"*".repeat(11)}${parts.tail}`;
  }

  return "******** protegido";
}

function normalizeProfileAvatarUrl(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized || null;
}

function tokenMaskParts(bot: Pick<MongoDevBot, "tokenEncrypted" | "tokenPrefix" | "tokenLast4">) {
  const prefix = bot.tokenPrefix?.trim() || null;
  const tail = bot.tokenLast4?.trim().slice(-3) || null;

  if (prefix && tail) {
    return {
      prefix,
      tail
    };
  }

  try {
    const token = decryptSecret(bot.tokenEncrypted);

    return {
      prefix: prefix ?? tokenPrefix(token),
      tail: tail ?? tokenLast4(token)?.slice(-3) ?? null
    };
  } catch {
    return {
      prefix,
      tail
    };
  }
}

function snowflakeDate(id: string) {
  try {
    return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
  } catch {
    return null;
  }
}

function parsePermissions(value: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function firstConfiguredDashboardGuildId() {
  return env.DASHBOARD_GUILD_IDS.split(",")
    .map((guildId) => guildId.trim())
    .find(Boolean) ?? null;
}

async function checkAccessDevBotGuild(
  user: AuthSessionUser,
  bot: MongoDevBot,
  guildId: string,
  options: AccessibleDevBotsOptions = {}
): Promise<DevBotAccessDiagnostic> {
  const { botGuildConfigs } = await getMongoCollections();
  const guildName = bot.mainGuildId === guildId ? bot.mainGuildName ?? `Servidor ${guildId}` : `Servidor ${guildId}`;
  const botUsesGuild = bot.mainGuildId === guildId || Boolean(await botGuildConfigs.findOne(
    {
      botId: bot._id,
      guildId
    },
    {
      projection: {
        _id: 1
      }
    }
  ));

  if (!botUsesGuild) {
    return {
      allowed: false,
      accessLevel: null,
      botId: bot._id,
      botName: bot.name,
      configuredRoleCount: 0,
      configuredUserCount: 0,
      guildId,
      guildName,
      matchedRoleIds: [],
      matchedUserIds: [],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: [],
      requiredUserIds: [],
      reason: "Este bot nao esta vinculado ao servidor selecionado."
    };
  }

  if (isDashboardDevUserId(user.discordId)) {
    return {
      allowed: true,
      accessLevel: "admin",
      botId: bot._id,
      botName: bot.name,
      configuredRoleCount: 0,
      configuredUserCount: 0,
      guildId,
      guildName,
      matchedRoleIds: [],
      matchedUserIds: [],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: [],
      requiredUserIds: [],
      reason: "Usuario Dev liberado."
    };
  }

  if (bot.ownerId === user.discordId || bot.createdBy === user.discordId) {
    return {
      allowed: true,
      accessLevel: "admin",
      botId: bot._id,
      botName: bot.name,
      configuredRoleCount: 0,
      configuredUserCount: 1,
      guildId,
      guildName,
      matchedRoleIds: [],
      matchedUserIds: [user.discordId],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: [],
      requiredUserIds: [user.discordId],
      reason: "Dono/criador do bot liberado para acessar esta dashboard."
    };
  }

  const panelRoleAccess = await checkConfiguredPanelRole(user.discordId, bot, guildId, options);

  return {
    ...panelRoleAccess,
    botId: bot._id,
    botName: bot.name,
    guildId,
    guildName
  };
}

async function checkConfiguredPanelRole(
  userId: string,
  bot: MongoDevBot,
  guildId: string,
  options: AccessibleDevBotsOptions = {}
): Promise<PanelRoleAccessResult> {
  const access = await getPersistedDashboardAccess(guildId, bot._id).catch((error) => {
    console.warn(
      `[access] nao foi possivel ler usuarios liberados do bot ${bot._id} no servidor ${guildId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  });

  if (!access) {
    const result = {
      allowed: false,
      accessLevel: null,
      configuredRoleCount: 0,
      configuredUserCount: 0,
      matchedRoleIds: [],
      matchedUserIds: [],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: [],
      requiredUserIds: [],
      reason: "Nenhuma configuracao de usuarios liberados foi encontrada para este bot/servidor."
    };

    await writeAccessValidationLog(userId, bot, guildId, result);
    return result;
  }

  if (!access.enabled) {
    const requiredUserIds = Object.keys(access.userPermissions);
    const result = {
      allowed: false,
      accessLevel: null,
      configuredRoleCount: access.roleIds.length,
      configuredUserCount: requiredUserIds.length,
      matchedRoleIds: [],
      matchedUserIds: [],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: access.roleIds,
      requiredUserIds,
      reason: "O acesso ao site por usuario esta desativado neste servidor."
    };

    await writeAccessValidationLog(userId, bot, guildId, result);
    return result;
  }

  const requiredUserIds = Object.keys(access.userPermissions);
  const requiredRoleIds = access.roleIds;
  const directUserAccessLevel = access.userPermissions[userId] ?? null;

  if (!requiredUserIds.length && !requiredRoleIds.length) {
    const result = {
      allowed: false,
      accessLevel: null,
      configuredRoleCount: 0,
      configuredUserCount: 0,
      matchedRoleIds: [],
      matchedUserIds: [],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: [],
      requiredUserIds: [],
      reason: "Nenhum usuario foi salvo como liberado para acessar este painel."
    };

    await writeAccessValidationLog(userId, bot, guildId, result);
    return result;
  }

  if (directUserAccessLevel) {
    const result = {
      allowed: true,
      accessLevel: directUserAccessLevel,
      configuredRoleCount: access.roleIds.length,
      configuredUserCount: requiredUserIds.length,
      matchedRoleIds: [],
      matchedUserIds: [userId],
      matchedRoleCount: 0,
      memberRoleIds: [],
      requiredRoleIds: [],
      requiredUserIds,
      reason: "Usuario liberado diretamente encontrado na configuracao do painel."
    };

    await writeAccessValidationLog(userId, bot, guildId, result);
    return result;
  }

  if (requiredRoleIds.length) {
    const memberRoleLookup = await getDashboardMemberRoleIds(userId, bot, guildId, options);
    const memberRoleIds = [...(memberRoleLookup.roleIds ?? new Set<string>())];
    const matchedRoleIds = requiredRoleIds.filter((roleId) => memberRoleLookup.roleIds?.has(roleId));
    const accessLevel = highestDashboardAccessLevel(matchedRoleIds.map((roleId) => access.rolePermissions[roleId])) ?? null;
    const result = {
      allowed: Boolean(accessLevel),
      accessLevel,
      configuredRoleCount: requiredRoleIds.length,
      configuredUserCount: requiredUserIds.length,
      matchedRoleIds,
      matchedUserIds: [],
      matchedRoleCount: matchedRoleIds.length,
      memberRoleIds,
      requiredRoleIds,
      requiredUserIds,
      reason: accessLevel
        ? "Cargo liberado encontrado na configuracao do painel."
        : memberRoleLookup.reason ?? "Seu usuario Discord nao possui nenhum cargo liberado para este painel."
    };

    await writeAccessValidationLog(userId, bot, guildId, result, memberRoleLookup.source);
    return result;
  }

  const result = {
    allowed: false,
    accessLevel: null,
    configuredRoleCount: access.roleIds.length,
    configuredUserCount: requiredUserIds.length,
    matchedRoleIds: [],
    matchedUserIds: [],
    matchedRoleCount: 0,
    memberRoleIds: [],
    requiredRoleIds: [],
    requiredUserIds,
    reason: "Seu usuario Discord nao esta na lista de pessoas liberadas para este painel."
  };

  await writeAccessValidationLog(userId, bot, guildId, result);
  return result;
}

async function getDashboardMemberRoleIds(
  userId: string,
  bot: MongoDevBot,
  guildId: string,
  options: AccessibleDevBotsOptions = {}
): Promise<MemberRoleLookupResult> {
  const oauthRoleIds = await fetchOAuthGuildMemberRoleIds(userId, guildId, options);

  if (oauthRoleIds.roleIds) {
    return oauthRoleIds;
  }

  const botRoleIds = await fetchBotGuildMemberRoleIds(userId, bot, guildId);

  if (botRoleIds.roleIds) {
    return botRoleIds;
  }

  return {
    roleIds: null,
    source: null,
    reason: [
      oauthRoleIds.reason,
      botRoleIds.reason,
      "Entre novamente pelo Discord e confira se o Server Members Intent esta ativo no bot."
    ].filter(Boolean).join(" ")
  };
}

async function fetchBotGuildMemberRoleIds(userId: string, bot: MongoDevBot, guildId: string): Promise<MemberRoleLookupResult> {
  const token = decryptSecret(bot.tokenEncrypted);

  try {
    const { data: member } = await axios.get<DiscordGuildMember>(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
      headers: {
        Authorization: `Bot ${token}`
      },
      timeout: 5000
    });
    const memberRoleIds = new Set(member.roles);
    memberRoleIds.add(guildId);

    return {
      roleIds: memberRoleIds,
      source: "bot",
      reason: null
    };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status ?? null : null;

    if (status === 403 || status === 404) {
      console.warn(
        `[discord] bot ${bot._id} nao conseguiu ler o membro ${userId} no servidor ${guildId} (HTTP ${status}). Tentando OAuth do usuario.`
      );
    } else {
      console.warn(
        `[discord] nao foi possivel validar cargo do painel em ${guildId}:`,
        error instanceof Error ? error.message : error
      );
    }

    return {
      roleIds: null,
      source: "bot",
      reason: status === 403 || status === 404
        ? `O bot nao conseguiu ler este membro no Discord (HTTP ${status}).`
        : "O bot nao conseguiu consultar os cargos do membro no Discord."
    };
  }
}

async function fetchOAuthGuildMemberRoleIds(
  userId: string,
  guildId: string,
  options: AccessibleDevBotsOptions = {}
): Promise<MemberRoleLookupResult> {
  const storedTokens = options.discordAccessToken ? null : await getStoredDiscordTokens(userId);
  const accessToken = options.discordAccessToken?.trim() || storedTokens?.accessToken;
  const refreshToken = options.discordRefreshToken?.trim() || storedTokens?.refreshToken;

  if (!accessToken) {
    console.warn(`[access] usuario ${userId} precisa entrar novamente pelo Discord para validar cargos do servidor ${guildId}.`);
    return {
      roleIds: null,
      source: null,
      reason: "A sessao Discord nao tem token OAuth salvo para ler cargos."
    };
  }

  const firstLookup = await fetchOAuthGuildMemberRoleIdsWithToken(accessToken, guildId);

  if (firstLookup.roleIds || firstLookup.status !== 401 || !refreshToken) {
    return {
      roleIds: firstLookup.roleIds,
      source: "oauth",
      reason: firstLookup.reason
    };
  }

  try {
    const refreshedTokens = await refreshDiscordTokens(refreshToken);
    await updateStoredDiscordTokens(userId, refreshedTokens);
    await options.onDiscordTokensRefreshed?.({
      accessToken: refreshedTokens.access_token,
      refreshToken: refreshedTokens.refresh_token ?? refreshToken
    });
    const refreshedLookup = await fetchOAuthGuildMemberRoleIdsWithToken(refreshedTokens.access_token, guildId);

    return {
      roleIds: refreshedLookup.roleIds,
      source: "oauth",
      reason: refreshedLookup.reason
    };
  } catch (error) {
    console.warn(
      `[discord] nao foi possivel renovar OAuth do usuario ${userId} para validar cargos:`,
      readDiscordErrorMessage(error)
    );
    return {
      roleIds: null,
      source: "oauth",
      reason: "Nao foi possivel renovar a autorizacao Discord para ler cargos."
    };
  }
}

async function fetchOAuthGuildMemberRoleIdsWithToken(accessToken: string, guildId: string) {
  try {
    const member = await fetchDiscordCurrentUserGuildMember(accessToken, guildId);
    const memberRoleIds = new Set(member.roles ?? []);
    memberRoleIds.add(guildId);

    return {
      roleIds: memberRoleIds,
      status: null,
      reason: null
    };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status ?? null : null;

    if (status === 403) {
      console.warn(`[discord] OAuth sem permissao guilds.members.read para validar cargos do servidor ${guildId}.`);
    } else if (status === 404) {
      console.warn(`[discord] usuario OAuth nao encontrado como membro do servidor ${guildId}.`);
    } else if (status !== 401) {
      console.warn(
        `[discord] nao foi possivel validar cargo via OAuth no servidor ${guildId}:`,
        readDiscordErrorMessage(error)
      );
    }

    return {
      roleIds: null,
      status,
      reason: status === 403
        ? "A autorizacao Discord nao liberou a leitura de cargos. Clique em Sair e entre novamente pelo Discord."
        : status === 404
          ? "Sua conta nao foi encontrada como membro do servidor no OAuth do Discord."
          : status === 401
            ? "A autorizacao Discord expirou."
            : "Nao foi possivel consultar os cargos pelo OAuth do Discord."
    };
  }
}

function readDiscordErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const responseMessage = error.response?.data;

    if (
      responseMessage &&
      typeof responseMessage === "object" &&
      "message" in responseMessage &&
      typeof responseMessage.message === "string"
    ) {
      return maskSensitiveText(`HTTP ${error.response?.status ?? "?"}: ${responseMessage.message}`);
    }

    return maskSensitiveText(error.response?.status ? `HTTP ${error.response.status}: ${error.message}` : error.message);
  }

  return maskSensitiveText(error instanceof Error ? error.message : String(error));
}

function maskSensitiveText(value: string) {
  return value.replace(/mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,}/gi, "[token-protegido]");
}

async function writeAccessValidationLog(
  userId: string,
  bot: MongoDevBot,
  guildId: string,
  result: PanelRoleAccessResult,
  source: "oauth" | "bot" | null = null
) {
  await createLog({
    botId: bot._id,
    guildId,
    userId,
    type: result.allowed ? "access.validation.allowed" : "access.validation.denied",
    message: result.allowed
      ? `Acesso liberado para ${userId} como ${result.accessLevel}.`
      : `Acesso negado para ${userId}: ${result.reason}`,
    metadata: {
      accessLevel: result.accessLevel,
      allowed: result.allowed,
      botId: bot._id,
      botName: bot.name,
      checkedAt: new Date().toISOString(),
      configuredRoleCount: result.configuredRoleCount,
      configuredUserCount: result.configuredUserCount,
      guildId,
      matchedRoleIds: result.matchedRoleIds,
      matchedRoleCount: result.matchedRoleCount,
      matchedUserIds: result.matchedUserIds,
      memberRoleIds: result.memberRoleIds,
      requiredRoleIds: result.requiredRoleIds,
      requiredUserIds: result.requiredUserIds,
      result: result.allowed ? "allowed" : "denied",
      roleSource: source,
      userId
    }
  }).catch((error) => {
    console.warn("[access] nao foi possivel registrar auditoria de acesso:", error instanceof Error ? error.message : error);
  });
}

function groupGuildIdsByBot(configs: MongoBotGuildConfig[]) {
  const guildIdsByBot = new Map<string, string[]>();

  for (const config of configs) {
    const guildIds = guildIdsByBot.get(config.botId) ?? [];
    guildIds.push(config.guildId);
    guildIdsByBot.set(config.botId, guildIds);
  }

  return guildIdsByBot;
}

function allBotGuildIds(bot: MongoDevBot, configuredGuildIds: string[] = []) {
  return [...new Set([bot.mainGuildId, ...configuredGuildIds])];
}
