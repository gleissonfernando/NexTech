import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoGuildSettings } from "../database/mongo";
import {
  normalizeDashboardAccessLevel,
  type DashboardAccessLevel
} from "./dashboardPermissionService";

export type GuildSettingsDto = {
  botId: string | null;
  guildId: string;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
  welcomeTitle: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle: string | null;
  welcomeRules: string | null;
  welcomeChannelLabel: string | null;
  welcomeFooterText: string | null;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveDisplayChannelId: string | null;
  leaveImageUrl: string | null;
  leaveTitle: string | null;
  leaveMessage: string | null;
  leaveRulesTitle: string | null;
  leaveRules: string | null;
  leaveChannelLabel: string | null;
  leaveFooterText: string | null;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  logChannelId: string | null;
  discordLogsEnabled: boolean;
  siteLogsEnabled: boolean;
  discordLogCategories: LogCategory[];
  siteLogCategories: LogCategory[];
  moderationEnabled: boolean;
  accountAgeSecurityEnabled: boolean;
  accountAgeMinDays: number;
  accountAgeLogChannelId: string | null;
  accountAgeAllowedUserIds: string[];
  safeBotEnabled: boolean;
  safeBotChannelId: string | null;
  safeBotRoleId: string | null;
  safeBotLogChannelId: string | null;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds: string[];
  dashboardRolePermissions: Record<string, DashboardAccessLevel>;
  dashboardUserPermissions: Record<string, DashboardAccessLevel>;
};

export const LOG_CATEGORIES = [
  "members",
  "messages",
  "roles",
  "moderation",
  "dashboard",
  "automation"
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export type PersistedDashboardAccess = {
  botId: string;
  guildId: string;
  enabled: boolean;
  roleIds: string[];
  rolePermissions: Record<string, DashboardAccessLevel>;
  userPermissions: Record<string, DashboardAccessLevel>;
};

const memorySettings = new Map<string, GuildSettingsDto>();
const DEFAULT_WELCOME_IMAGE_URL = "/uploads/welcome/default.gif?v=3";
const PREVIOUS_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, a nossa comunidade de lives.",
  "Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
const PREVIOUS_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "Nao divulgue lives, links ou canais sem autorizacao.",
  "Converse, faca amizades e aproveite sua estadia."
].join("\n");
const PREVIOUS_WELCOME_FOOTER_TEXT = "Ricardinn98 - Comunidade de lives";
export const DEFAULT_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, \u00e0 nossa comunidade de lives.",
  "Aqui a galera acompanha transmiss\u00f5es, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
export const DEFAULT_WELCOME_TITLE = "Ricardin98";
export const DEFAULT_WELCOME_RULES_TITLE = "Algumas dicas:";
export const DEFAULT_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "N\u00e3o divulgue links ou canais sem autoriza\u00e7\u00e3o.",
  "Converse, fa\u00e7a amizades e aproveite sua estadia."
].join("\n");
export const DEFAULT_WELCOME_CHANNEL_LABEL = "Acesse o canal:";
export const DEFAULT_WELCOME_FOOTER_TEXT = "Ricardin98 - Comunidade de Lives";
export const DEFAULT_LEAVE_MESSAGE = [
  "Ate mais, {user}. Obrigado por ter feito parte da nossa comunidade de lives.",
  "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera."
].join("\n");
export const DEFAULT_LEAVE_TITLE = "Ricardinn98";
export const DEFAULT_LEAVE_RULES_TITLE = "Registro de saida:";
export const DEFAULT_LEAVE_RULES = [
  "A saida foi registrada automaticamente pelo bot.",
  "Os canais oficiais continuam disponiveis para a comunidade.",
  "Respeite as regras se decidir retornar ao servidor.",
  "A equipe segue por aqui para organizar eventos e avisos.",
  "Valeu pela passagem e ate a proxima."
].join("\n");
export const DEFAULT_LEAVE_CHANNEL_LABEL = "Canal da comunidade:";
export const DEFAULT_LEAVE_FOOTER_TEXT = "Ricardinn98 - Comunidade de lives";
const LEGACY_WELCOME_MESSAGE = "Bem-vindo(a), {user}!";
const LEGACY_LEAVE_MESSAGE = "Ate mais, {user}.";
export const MAX_AUTOMATIC_ROLES = 2;
const DEFAULT_ACCOUNT_AGE_MIN_DAYS = 10;
const MAX_ACCOUNT_AGE_MIN_DAYS = 3_650;
const DEFAULT_LOG_CATEGORIES = [...LOG_CATEGORIES];

export function defaultSettings(guildId: string, botId: string | null = null): GuildSettingsDto {
  return {
    botId,
    guildId,
    welcomeEnabled: true,
    welcomeChannelId: null,
    welcomeDisplayChannelId: null,
    welcomeImageUrl: DEFAULT_WELCOME_IMAGE_URL,
    welcomeTitle: DEFAULT_WELCOME_TITLE,
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    welcomeRulesTitle: DEFAULT_WELCOME_RULES_TITLE,
    welcomeRules: DEFAULT_WELCOME_RULES,
    welcomeChannelLabel: DEFAULT_WELCOME_CHANNEL_LABEL,
    welcomeFooterText: DEFAULT_WELCOME_FOOTER_TEXT,
    leaveEnabled: true,
    leaveChannelId: null,
    leaveDisplayChannelId: null,
    leaveImageUrl: DEFAULT_WELCOME_IMAGE_URL,
    leaveTitle: DEFAULT_LEAVE_TITLE,
    leaveMessage: DEFAULT_LEAVE_MESSAGE,
    leaveRulesTitle: DEFAULT_LEAVE_RULES_TITLE,
    leaveRules: DEFAULT_LEAVE_RULES,
    leaveChannelLabel: DEFAULT_LEAVE_CHANNEL_LABEL,
    leaveFooterText: DEFAULT_LEAVE_FOOTER_TEXT,
    autoRoleEnabled: false,
    autoRoleIds: [],
    twitchRoleId: null,
    boosterRoleId: null,
    ticketEnabled: true,
    ticketCategoryId: null,
    logChannelId: null,
    discordLogsEnabled: false,
    siteLogsEnabled: true,
    discordLogCategories: [...DEFAULT_LOG_CATEGORIES],
    siteLogCategories: [...DEFAULT_LOG_CATEGORIES],
    moderationEnabled: true,
    accountAgeSecurityEnabled: false,
    accountAgeMinDays: DEFAULT_ACCOUNT_AGE_MIN_DAYS,
    accountAgeLogChannelId: null,
    accountAgeAllowedUserIds: [],
    safeBotEnabled: false,
    safeBotChannelId: null,
    safeBotRoleId: null,
    safeBotLogChannelId: null,
    verificationEnabled: false,
    verificationRoleId: null,
    verificationRoleIds: [],
    dashboardRolePermissions: {},
    dashboardUserPermissions: {}
  };
}

export async function getGuildSettings(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);

  try {
    const { guildSettings } = await getMongoCollections();
    const settings = await guildSettings.findOne(settingsQuery(guildId, normalizedBotId));

    if (settings) {
      return toDto(settings);
    }
  } catch (error) {
    console.warn("[mongo] usando settings em memoria:", error instanceof Error ? error.message : error);
  }

  return memorySettings.get(settingsKey(guildId, normalizedBotId)) ?? defaultSettings(guildId, normalizedBotId);
}

export async function getPersistedDashboardAccess(
  guildId: string,
  botId: string
): Promise<PersistedDashboardAccess | null> {
  const normalizedBotId = normalizeBotId(botId);

  if (!normalizedBotId) {
    return null;
  }

  const { guildSettings } = await getMongoCollections();
  const projection = {
    botId: 1,
    guildId: 1,
    verificationEnabled: 1,
    verificationRoleId: 1,
    verificationRoleIds: 1,
    dashboardRolePermissions: 1,
    dashboardUserPermissions: 1
  };
  const specificSettings = await guildSettings.findOne(
    {
      botId: normalizedBotId,
      guildId
    },
    {
      projection
    }
  );
  const legacySettings = await guildSettings.findOne(
    settingsQuery(guildId, null),
    {
      projection
    }
  );
  const specificAccess = specificSettings ? toPersistedDashboardAccess(specificSettings, normalizedBotId) : null;
  const legacyAccess = legacySettings ? toPersistedDashboardAccess(legacySettings, normalizedBotId) : null;

  if (specificAccess?.enabled && accessHasEntries(specificAccess)) return specificAccess;
  if (legacyAccess?.enabled && accessHasEntries(legacyAccess)) return legacyAccess;
  return specificAccess ?? legacyAccess;
}

export async function updateGuildSettings(guildId: string, input: Partial<GuildSettingsDto>, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const current = await getGuildSettings(guildId, normalizedBotId);
  const autoRoleIds = "autoRoleIds" in input
    ? normalizeRoleIds(input.autoRoleIds ?? []).slice(0, MAX_AUTOMATIC_ROLES)
    : current.autoRoleIds;
  const verificationRoleIds = "verificationRoleIds" in input
    ? normalizeRoleIds(input.verificationRoleIds ?? [])
    : "verificationRoleId" in input
      ? normalizeRoleIds(input.verificationRoleId ? [input.verificationRoleId] : [])
      : current.verificationRoleIds;
  const dashboardRolePermissions = normalizeRolePermissionMap(
    "dashboardRolePermissions" in input ? input.dashboardRolePermissions ?? {} : current.dashboardRolePermissions,
    verificationRoleIds,
    current.dashboardRolePermissions
  );
  const dashboardUserPermissions = normalizeUserPermissionMap(
    "dashboardUserPermissions" in input ? input.dashboardUserPermissions ?? {} : current.dashboardUserPermissions,
    current.dashboardUserPermissions
  );
  const accountAgeAllowedUserIds = "accountAgeAllowedUserIds" in input
    ? normalizeSnowflakes(input.accountAgeAllowedUserIds ?? [])
    : current.accountAgeAllowedUserIds;
  const discordLogCategories = "discordLogCategories" in input
    ? normalizeLogCategories(input.discordLogCategories)
    : current.discordLogCategories;
  const siteLogCategories = "siteLogCategories" in input
    ? normalizeLogCategories(input.siteLogCategories)
    : current.siteLogCategories;
  const next = normalizeVerificationRoles({
    ...current,
    ...input,
    accountAgeMinDays: clampInteger(
      "accountAgeMinDays" in input ? input.accountAgeMinDays : current.accountAgeMinDays,
      0,
      MAX_ACCOUNT_AGE_MIN_DAYS,
      DEFAULT_ACCOUNT_AGE_MIN_DAYS
    ),
    accountAgeLogChannelId: normalizeSnowflake(
      "accountAgeLogChannelId" in input ? input.accountAgeLogChannelId : current.accountAgeLogChannelId
    ),
    accountAgeAllowedUserIds,
    discordLogCategories,
    siteLogCategories,
    safeBotChannelId: normalizeSnowflake(
      "safeBotChannelId" in input ? input.safeBotChannelId : current.safeBotChannelId
    ),
    safeBotRoleId: normalizeSnowflake(
      "safeBotRoleId" in input ? input.safeBotRoleId : current.safeBotRoleId
    ),
    safeBotLogChannelId: normalizeSnowflake(
      "safeBotLogChannelId" in input ? input.safeBotLogChannelId : current.safeBotLogChannelId
    ),
    autoRoleIds,
    welcomeTitle: normalizePanelText(
      "welcomeTitle" in input ? input.welcomeTitle : current.welcomeTitle,
      DEFAULT_WELCOME_TITLE
    ),
    welcomeMessage: normalizePanelMessage(
      "welcomeMessage" in input ? input.welcomeMessage : current.welcomeMessage,
      DEFAULT_WELCOME_MESSAGE,
      [LEGACY_WELCOME_MESSAGE, PREVIOUS_WELCOME_MESSAGE]
    ),
    welcomeRulesTitle: normalizePanelText(
      "welcomeRulesTitle" in input ? input.welcomeRulesTitle : current.welcomeRulesTitle,
      DEFAULT_WELCOME_RULES_TITLE
    ),
    welcomeRules: normalizePanelText(
      "welcomeRules" in input ? input.welcomeRules : current.welcomeRules,
      DEFAULT_WELCOME_RULES,
      [PREVIOUS_WELCOME_RULES]
    ),
    welcomeChannelLabel: normalizePanelText(
      "welcomeChannelLabel" in input ? input.welcomeChannelLabel : current.welcomeChannelLabel,
      DEFAULT_WELCOME_CHANNEL_LABEL
    ),
    welcomeFooterText: normalizePanelText(
      "welcomeFooterText" in input ? input.welcomeFooterText : current.welcomeFooterText,
      DEFAULT_WELCOME_FOOTER_TEXT,
      [PREVIOUS_WELCOME_FOOTER_TEXT]
    ),
    leaveTitle: normalizePanelText(
      "leaveTitle" in input ? input.leaveTitle : current.leaveTitle,
      DEFAULT_LEAVE_TITLE
    ),
    leaveMessage: normalizePanelMessage(
      "leaveMessage" in input ? input.leaveMessage : current.leaveMessage,
      DEFAULT_LEAVE_MESSAGE,
      LEGACY_LEAVE_MESSAGE
    ),
    leaveRulesTitle: normalizePanelText(
      "leaveRulesTitle" in input ? input.leaveRulesTitle : current.leaveRulesTitle,
      DEFAULT_LEAVE_RULES_TITLE
    ),
    leaveRules: normalizePanelText(
      "leaveRules" in input ? input.leaveRules : current.leaveRules,
      DEFAULT_LEAVE_RULES
    ),
    leaveChannelLabel: normalizePanelText(
      "leaveChannelLabel" in input ? input.leaveChannelLabel : current.leaveChannelLabel,
      DEFAULT_LEAVE_CHANNEL_LABEL
    ),
    leaveFooterText: normalizePanelText(
      "leaveFooterText" in input ? input.leaveFooterText : current.leaveFooterText,
      DEFAULT_LEAVE_FOOTER_TEXT
    ),
    verificationRoleIds,
    dashboardRolePermissions,
    dashboardUserPermissions,
    botId: normalizedBotId,
    guildId
  });

  try {
    await ensureGuild(guildId);

    const { guildSettings } = await getMongoCollections();
    await guildSettings.updateOne(
      {
        botId: normalizedBotId,
        guildId
      },
      {
        $set: {
          botId: normalizedBotId,
          guildId,
          welcomeEnabled: next.welcomeEnabled,
          welcomeChannelId: next.welcomeChannelId,
          welcomeDisplayChannelId: next.welcomeDisplayChannelId,
          welcomeImageUrl: next.welcomeImageUrl,
          welcomeTitle: next.welcomeTitle,
          welcomeMessage: next.welcomeMessage,
          welcomeRulesTitle: next.welcomeRulesTitle,
          welcomeRules: next.welcomeRules,
          welcomeChannelLabel: next.welcomeChannelLabel,
          welcomeFooterText: next.welcomeFooterText,
          leaveEnabled: next.leaveEnabled,
          leaveChannelId: next.leaveChannelId,
          leaveDisplayChannelId: next.leaveDisplayChannelId,
          leaveImageUrl: next.leaveImageUrl,
          leaveTitle: next.leaveTitle,
          leaveMessage: next.leaveMessage,
          leaveRulesTitle: next.leaveRulesTitle,
          leaveRules: next.leaveRules,
          leaveChannelLabel: next.leaveChannelLabel,
          leaveFooterText: next.leaveFooterText,
          autoRoleEnabled: next.autoRoleEnabled,
          autoRoleIds: next.autoRoleIds,
          twitchRoleId: next.twitchRoleId,
          boosterRoleId: next.boosterRoleId,
          ticketEnabled: next.ticketEnabled,
          ticketCategoryId: next.ticketCategoryId,
          logChannelId: next.logChannelId,
          discordLogsEnabled: next.discordLogsEnabled,
          siteLogsEnabled: next.siteLogsEnabled,
          discordLogCategories: next.discordLogCategories,
          siteLogCategories: next.siteLogCategories,
          moderationEnabled: next.moderationEnabled,
          accountAgeSecurityEnabled: next.accountAgeSecurityEnabled,
          accountAgeMinDays: next.accountAgeMinDays,
          accountAgeLogChannelId: next.accountAgeLogChannelId,
          accountAgeAllowedUserIds: next.accountAgeAllowedUserIds,
          safeBotEnabled: next.safeBotEnabled,
          safeBotChannelId: next.safeBotChannelId,
          safeBotRoleId: next.safeBotRoleId,
          safeBotLogChannelId: next.safeBotLogChannelId,
          verificationEnabled: next.verificationEnabled,
          verificationRoleId: next.verificationRoleId,
          verificationRoleIds: next.verificationRoleIds,
          dashboardRolePermissions: next.dashboardRolePermissions,
          dashboardUserPermissions: next.dashboardUserPermissions,
          updatedAt: new Date()
        },
        $setOnInsert: {
          _id: randomUUID()
        }
      },
      {
        upsert: true
      }
    );
  } catch (error) {
    console.error("[mongo] nao foi possivel persistir settings:", error);
    throw createSettingsPersistenceError(error);
  }

  memorySettings.set(settingsKey(guildId, normalizedBotId), next);
  return next;
}

function toDto(settings: MongoGuildSettings): GuildSettingsDto {
  const botId = normalizeBotId(settings.botId);
  const defaults = defaultSettings(settings.guildId, botId);
  const verificationRoleIds = normalizeRoleIds(
    Array.isArray(settings.verificationRoleIds)
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );
  const dashboardRolePermissions = normalizeRolePermissionMap(
    settings.dashboardRolePermissions ?? {},
    verificationRoleIds,
    Object.fromEntries(verificationRoleIds.map((roleId) => [roleId, "admin" as const]))
  );
  const dashboardUserPermissions = normalizeUserPermissionMap(settings.dashboardUserPermissions ?? {});

  return normalizeVerificationRoles({
    botId,
    guildId: settings.guildId,
    welcomeEnabled: settings.welcomeEnabled,
    welcomeChannelId: settings.welcomeChannelId,
    welcomeDisplayChannelId: settings.welcomeDisplayChannelId ?? null,
    welcomeImageUrl: normalizeWelcomeImageUrl(settings.welcomeImageUrl),
    welcomeTitle: normalizePanelText(settings.welcomeTitle, DEFAULT_WELCOME_TITLE),
    welcomeMessage: normalizePanelMessage(
      settings.welcomeMessage,
      DEFAULT_WELCOME_MESSAGE,
      [LEGACY_WELCOME_MESSAGE, PREVIOUS_WELCOME_MESSAGE]
    ),
    welcomeRulesTitle: normalizePanelText(settings.welcomeRulesTitle, DEFAULT_WELCOME_RULES_TITLE),
    welcomeRules: normalizePanelText(settings.welcomeRules, DEFAULT_WELCOME_RULES, [PREVIOUS_WELCOME_RULES]),
    welcomeChannelLabel: normalizePanelText(settings.welcomeChannelLabel, DEFAULT_WELCOME_CHANNEL_LABEL),
    welcomeFooterText: normalizePanelText(settings.welcomeFooterText, DEFAULT_WELCOME_FOOTER_TEXT, [PREVIOUS_WELCOME_FOOTER_TEXT]),
    leaveEnabled: settings.leaveEnabled ?? defaults.leaveEnabled,
    leaveChannelId: settings.leaveChannelId ?? defaults.leaveChannelId,
    leaveDisplayChannelId: settings.leaveDisplayChannelId ?? defaults.leaveDisplayChannelId,
    leaveImageUrl: normalizeWelcomeImageUrl(settings.leaveImageUrl ?? defaults.leaveImageUrl),
    leaveTitle: normalizePanelText(settings.leaveTitle, DEFAULT_LEAVE_TITLE),
    leaveMessage: normalizePanelMessage(
      settings.leaveMessage,
      DEFAULT_LEAVE_MESSAGE,
      LEGACY_LEAVE_MESSAGE
    ),
    leaveRulesTitle: normalizePanelText(settings.leaveRulesTitle, DEFAULT_LEAVE_RULES_TITLE),
    leaveRules: normalizePanelText(settings.leaveRules, DEFAULT_LEAVE_RULES),
    leaveChannelLabel: normalizePanelText(settings.leaveChannelLabel, DEFAULT_LEAVE_CHANNEL_LABEL),
    leaveFooterText: normalizePanelText(settings.leaveFooterText, DEFAULT_LEAVE_FOOTER_TEXT),
    autoRoleEnabled: settings.autoRoleEnabled,
    autoRoleIds: normalizeRoleIds(settings.autoRoleIds ?? []).slice(0, MAX_AUTOMATIC_ROLES),
    twitchRoleId: settings.twitchRoleId,
    boosterRoleId: settings.boosterRoleId,
    ticketEnabled: settings.ticketEnabled,
    ticketCategoryId: settings.ticketCategoryId,
    logChannelId: settings.logChannelId,
    discordLogsEnabled: settings.discordLogsEnabled ?? Boolean(settings.logChannelId),
    siteLogsEnabled: settings.siteLogsEnabled ?? defaults.siteLogsEnabled,
    discordLogCategories: normalizeLogCategories(settings.discordLogCategories),
    siteLogCategories: normalizeLogCategories(settings.siteLogCategories),
    moderationEnabled: settings.moderationEnabled,
    accountAgeSecurityEnabled: settings.accountAgeSecurityEnabled ?? defaults.accountAgeSecurityEnabled,
    accountAgeMinDays: clampInteger(
      settings.accountAgeMinDays,
      0,
      MAX_ACCOUNT_AGE_MIN_DAYS,
      DEFAULT_ACCOUNT_AGE_MIN_DAYS
    ),
    accountAgeLogChannelId: normalizeSnowflake(settings.accountAgeLogChannelId),
    accountAgeAllowedUserIds: normalizeSnowflakes(settings.accountAgeAllowedUserIds ?? []),
    safeBotEnabled: settings.safeBotEnabled ?? defaults.safeBotEnabled,
    safeBotChannelId: normalizeSnowflake(settings.safeBotChannelId),
    safeBotRoleId: normalizeSnowflake(settings.safeBotRoleId),
    safeBotLogChannelId: normalizeSnowflake(settings.safeBotLogChannelId),
    verificationEnabled: settings.verificationEnabled,
    verificationRoleId: verificationRoleIds[0] ?? null,
    verificationRoleIds,
    dashboardRolePermissions,
    dashboardUserPermissions
  });
}

function normalizeVerificationRoles(settings: GuildSettingsDto): GuildSettingsDto {
  const verificationRoleIds = normalizeRoleIds(
    settings.verificationRoleIds.length
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );

  return {
    ...settings,
    verificationRoleId: verificationRoleIds[0] ?? null,
    verificationRoleIds,
    dashboardRolePermissions: normalizeRolePermissionMap(
      settings.dashboardRolePermissions,
      verificationRoleIds,
      settings.dashboardRolePermissions
    ),
    dashboardUserPermissions: normalizeUserPermissionMap(settings.dashboardUserPermissions)
  };
}

function toPersistedDashboardAccess(
  settings: Pick<MongoGuildSettings, "botId" | "guildId" | "verificationEnabled" | "verificationRoleId" | "verificationRoleIds" | "dashboardRolePermissions" | "dashboardUserPermissions">,
  fallbackBotId: string
): PersistedDashboardAccess {
  const roleIds = normalizeRoleIds(
    Array.isArray(settings.verificationRoleIds) && settings.verificationRoleIds.length
      ? settings.verificationRoleIds
      : settings.verificationRoleId
        ? [settings.verificationRoleId]
        : []
  );
  const rolePermissions = normalizeRolePermissionMap(
    settings.dashboardRolePermissions ?? {},
    roleIds,
    Object.fromEntries(roleIds.map((roleId) => [roleId, "admin" as const]))
  );
  const userPermissions = normalizeUserPermissionMap(settings.dashboardUserPermissions ?? {});

  return {
    botId: normalizeBotId(settings.botId) ?? fallbackBotId,
    guildId: settings.guildId,
    enabled: settings.verificationEnabled === true,
    roleIds,
    rolePermissions,
    userPermissions
  };
}

function normalizeRoleIds(roleIds: string[]) {
  return [...new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean))];
}

function accessHasEntries(access: PersistedDashboardAccess) {
  return Object.keys(access.userPermissions).length > 0;
}

function normalizeRolePermissionMap(
  value: Record<string, unknown> | undefined,
  allowedRoleIds: string[],
  fallback: Record<string, DashboardAccessLevel> = {}
) {
  const allowed = new Set(allowedRoleIds);
  const permissions: Record<string, DashboardAccessLevel> = {};

  for (const roleId of allowedRoleIds) {
    permissions[roleId] = normalizeDashboardAccessLevel(value?.[roleId] ?? fallback[roleId], "basic");
  }

  for (const [roleId, level] of Object.entries(value ?? {})) {
    if (allowed.has(roleId)) {
      permissions[roleId] = normalizeDashboardAccessLevel(level, permissions[roleId] ?? "basic");
    }
  }

  return permissions;
}

function normalizeUserPermissionMap(
  value: Record<string, unknown> | undefined,
  fallback: Record<string, DashboardAccessLevel> = {}
) {
  const permissions: Record<string, DashboardAccessLevel> = {};

  for (const [userId, level] of Object.entries(value ?? {})) {
    const normalizedUserId = userId.trim();

    if (/^\d{5,32}$/.test(normalizedUserId)) {
      permissions[normalizedUserId] = normalizeDashboardAccessLevel(level, fallback[normalizedUserId] ?? "basic");
    }
  }

  return permissions;
}

function normalizeSnowflakes(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => /^\d{5,32}$/.test(value)))];
}

function normalizeLogCategories(values: LogCategory[] | null | undefined) {
  if (!Array.isArray(values)) {
    return [...DEFAULT_LOG_CATEGORIES];
  }

  const allowed = new Set<string>(LOG_CATEGORIES);
  return [...new Set(values.filter((value): value is LogCategory => allowed.has(value)))];
}

function normalizeSnowflake(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^\d{5,32}$/.test(normalized) ? normalized : null;
}

function clampInteger(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(Number(value))));
}

function createSettingsPersistenceError(cause: unknown) {
  return Object.assign(new Error("Nao foi possivel salvar a configuracao no banco de dados. Tente novamente."), {
    cause,
    statusCode: 503
  });
}

function normalizeWelcomeImageUrl(value: string | null | undefined) {
  return !value || value === "/uploads/welcome/default.gif" ? DEFAULT_WELCOME_IMAGE_URL : value;
}

function normalizePanelMessage(value: string | null | undefined, fallback: string, legacyValue: string | string[]) {
  const normalized = value?.trim();
  const legacyValues = Array.isArray(legacyValue) ? legacyValue : [legacyValue];
  return !normalized || legacyValues.includes(normalized) ? fallback : normalized;
}

function normalizePanelText(value: string | null | undefined, fallback: string, legacyValues: string[] = []) {
  const normalized = value?.trim();
  return !normalized || legacyValues.includes(normalized) ? fallback : normalized;
}

function normalizeBotId(botId: string | null | undefined) {
  const normalized = botId?.trim();
  return normalized ? normalized : null;
}

function settingsKey(guildId: string, botId: string | null) {
  return `${botId ?? "default"}:${guildId}`;
}

function settingsQuery(guildId: string, botId: string | null) {
  if (botId) {
    return {
      guildId,
      botId
    };
  }

  return {
    guildId,
    $or: [
      {
        botId: null
      },
      {
        botId: {
          $exists: false
        }
      }
    ]
  };
}
