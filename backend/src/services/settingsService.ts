import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoGuildSettings, type MongoSafeBotMessageState } from "../database/mongo";
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
  welcomeColor: string;
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
  leaveColor: string;
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
  emojiCloneEnabled: boolean;
  emojiCloneAllowedRoleIds: string[];
  emojiCloneLogChannelId: string | null;
  emojiCloneDefaultPrefix: string | null;
  emojiCloneAllowAnimated: boolean;
  emojiCloneMaxPerRun: number;
  emojiCloneAllowedBotIds: string[];
  rulesEnabled: boolean;
  rulesChannelId: string | null;
  rulesRoleId: string | null;
  rulesTitle: string | null;
  rulesMessage: string | null;
  rulesButtonLabel: string | null;
  rulesColor: string;
  rulesPanelMessageId: string | null;
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

export type SafeBotMessageStateDto = {
  botId: string | null;
  guildId: string;
  channelId: string;
  messageId: string;
  updatedAt: string;
};

const memorySettings = new Map<string, GuildSettingsDto>();
const DEFAULT_PANEL_COLOR = "#ef4444";
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
const PREVIOUS_WELCOME_FOOTER_TEXT = "OrviteK - Comunidade de lives";
export const DEFAULT_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, \u00e0 nossa comunidade de lives.",
  "Aqui a galera acompanha transmiss\u00f5es, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
export const DEFAULT_WELCOME_TITLE = "OrviteK";
export const DEFAULT_WELCOME_RULES_TITLE = "Algumas dicas:";
export const DEFAULT_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "N\u00e3o divulgue links ou canais sem autoriza\u00e7\u00e3o.",
  "Converse, fa\u00e7a amizades e aproveite sua estadia."
].join("\n");
export const DEFAULT_WELCOME_CHANNEL_LABEL = "Acesse o canal:";
export const DEFAULT_WELCOME_FOOTER_TEXT = "OrviteK - Comunidade de Lives";
export const DEFAULT_LEAVE_MESSAGE = [
  "Ate mais, {user}. Obrigado por ter feito parte da nossa comunidade de lives.",
  "As portas continuam abertas para quando quiser voltar e acompanhar as transmissoes com a galera."
].join("\n");
export const DEFAULT_LEAVE_TITLE = "OrviteK";
export const DEFAULT_LEAVE_RULES_TITLE = "Registro de saida:";
export const DEFAULT_LEAVE_RULES = [
  "A saida foi registrada automaticamente pelo bot.",
  "Os canais oficiais continuam disponiveis para a comunidade.",
  "Respeite as regras se decidir retornar ao servidor.",
  "A equipe segue por aqui para organizar eventos e avisos.",
  "Valeu pela passagem e ate a proxima."
].join("\n");
export const DEFAULT_LEAVE_CHANNEL_LABEL = "Canal da comunidade:";
export const DEFAULT_LEAVE_FOOTER_TEXT = "OrviteK - Comunidade de lives";
const LEGACY_WELCOME_MESSAGE = "Bem-vindo(a), {user}!";
const LEGACY_LEAVE_MESSAGE = "Ate mais, {user}.";
export const MAX_AUTOMATIC_ROLES = 2;
const DEFAULT_ACCOUNT_AGE_MIN_DAYS = 10;
const MAX_ACCOUNT_AGE_MIN_DAYS = 3_650;
const DEFAULT_LOG_CATEGORIES = [...LOG_CATEGORIES];
const DEFAULT_EMOJI_CLONE_MAX_PER_RUN = 25;
const MAX_EMOJI_CLONE_MAX_PER_RUN = 100;
const DEFAULT_RULES_TITLE = "Regras da comunidade";
const DEFAULT_RULES_MESSAGE = [
  "Respeite todos os membros. Ofensas, preconceito, assedio ou discriminacao nao serao tolerados.",
  "Nao publique conteudo adulto, violento, chocante ou ilegal.",
  "Evite spam, flood, mensagens repetitivas, emojis em excesso e links desnecessarios.",
  "Nao divulgue golpes, arquivos suspeitos ou sites maliciosos.",
  "Proteja informacoes pessoais. Nao compartilhe telefone, endereco, fotos privadas ou dados sensiveis.",
  "Use os canais corretos e siga as orientacoes da equipe."
].join("\n");
const DEFAULT_RULES_BUTTON_LABEL = "Li e aceito";

export function defaultSettings(guildId: string, botId: string | null = null): GuildSettingsDto {
  return {
    botId,
    guildId,
    welcomeEnabled: true,
    welcomeChannelId: null,
    welcomeDisplayChannelId: null,
    welcomeImageUrl: null,
    welcomeTitle: "",
    welcomeMessage: "",
    welcomeRulesTitle: "",
    welcomeRules: "",
    welcomeChannelLabel: "",
    welcomeFooterText: "",
    welcomeColor: DEFAULT_PANEL_COLOR,
    leaveEnabled: true,
    leaveChannelId: null,
    leaveDisplayChannelId: null,
    leaveImageUrl: null,
    leaveTitle: "",
    leaveMessage: "",
    leaveRulesTitle: "",
    leaveRules: "",
    leaveChannelLabel: "",
    leaveFooterText: "",
    leaveColor: DEFAULT_PANEL_COLOR,
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
    emojiCloneEnabled: false,
    emojiCloneAllowedRoleIds: [],
    emojiCloneLogChannelId: null,
    emojiCloneDefaultPrefix: null,
    emojiCloneAllowAnimated: true,
    emojiCloneMaxPerRun: DEFAULT_EMOJI_CLONE_MAX_PER_RUN,
    emojiCloneAllowedBotIds: [],
    rulesEnabled: false,
    rulesChannelId: null,
    rulesRoleId: null,
    rulesTitle: DEFAULT_RULES_TITLE,
    rulesMessage: DEFAULT_RULES_MESSAGE,
    rulesButtonLabel: DEFAULT_RULES_BUTTON_LABEL,
    rulesColor: DEFAULT_PANEL_COLOR,
    rulesPanelMessageId: null,
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
    console.warn("[mongo] usando settings em memória:", error instanceof Error ? error.message : error);
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
  const emojiCloneAllowedRoleIds = "emojiCloneAllowedRoleIds" in input
    ? normalizeSnowflakes(input.emojiCloneAllowedRoleIds ?? [])
    : current.emojiCloneAllowedRoleIds;
  const emojiCloneAllowedBotIds = "emojiCloneAllowedBotIds" in input
    ? normalizeSnowflakes(input.emojiCloneAllowedBotIds ?? [])
    : current.emojiCloneAllowedBotIds;
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
    emojiCloneAllowedRoleIds,
    emojiCloneLogChannelId: normalizeSnowflake(
      "emojiCloneLogChannelId" in input ? input.emojiCloneLogChannelId : current.emojiCloneLogChannelId
    ),
    emojiCloneDefaultPrefix: normalizePrefix(
      "emojiCloneDefaultPrefix" in input ? input.emojiCloneDefaultPrefix : current.emojiCloneDefaultPrefix
    ),
    emojiCloneMaxPerRun: clampInteger(
      "emojiCloneMaxPerRun" in input ? input.emojiCloneMaxPerRun : current.emojiCloneMaxPerRun,
      1,
      MAX_EMOJI_CLONE_MAX_PER_RUN,
      DEFAULT_EMOJI_CLONE_MAX_PER_RUN
    ),
    emojiCloneAllowedBotIds,
    rulesChannelId: normalizeSnowflake(
      "rulesChannelId" in input ? input.rulesChannelId : current.rulesChannelId
    ),
    rulesRoleId: normalizeSnowflake(
      "rulesRoleId" in input ? input.rulesRoleId : current.rulesRoleId
    ),
    rulesTitle: normalizePanelText("rulesTitle" in input ? input.rulesTitle : current.rulesTitle) || DEFAULT_RULES_TITLE,
    rulesMessage: normalizePanelText("rulesMessage" in input ? input.rulesMessage : current.rulesMessage) || DEFAULT_RULES_MESSAGE,
    rulesButtonLabel: normalizePanelText("rulesButtonLabel" in input ? input.rulesButtonLabel : current.rulesButtonLabel) || DEFAULT_RULES_BUTTON_LABEL,
    rulesColor: normalizePanelColor("rulesColor" in input ? input.rulesColor : current.rulesColor),
    rulesPanelMessageId: normalizeSnowflake("rulesPanelMessageId" in input ? input.rulesPanelMessageId : current.rulesPanelMessageId),
    autoRoleIds,
    welcomeTitle: normalizePanelText("welcomeTitle" in input ? input.welcomeTitle : current.welcomeTitle),
    welcomeMessage: normalizePanelMessage("welcomeMessage" in input ? input.welcomeMessage : current.welcomeMessage),
    welcomeRulesTitle: normalizePanelText("welcomeRulesTitle" in input ? input.welcomeRulesTitle : current.welcomeRulesTitle),
    welcomeRules: normalizePanelText("welcomeRules" in input ? input.welcomeRules : current.welcomeRules),
    welcomeChannelLabel: normalizePanelText("welcomeChannelLabel" in input ? input.welcomeChannelLabel : current.welcomeChannelLabel),
    welcomeFooterText: normalizePanelText("welcomeFooterText" in input ? input.welcomeFooterText : current.welcomeFooterText),
    welcomeColor: normalizePanelColor("welcomeColor" in input ? input.welcomeColor : current.welcomeColor),
    leaveTitle: normalizePanelText("leaveTitle" in input ? input.leaveTitle : current.leaveTitle),
    leaveMessage: normalizePanelMessage("leaveMessage" in input ? input.leaveMessage : current.leaveMessage),
    leaveRulesTitle: normalizePanelText("leaveRulesTitle" in input ? input.leaveRulesTitle : current.leaveRulesTitle),
    leaveRules: normalizePanelText("leaveRules" in input ? input.leaveRules : current.leaveRules),
    leaveChannelLabel: normalizePanelText("leaveChannelLabel" in input ? input.leaveChannelLabel : current.leaveChannelLabel),
    leaveFooterText: normalizePanelText("leaveFooterText" in input ? input.leaveFooterText : current.leaveFooterText),
    leaveColor: normalizePanelColor("leaveColor" in input ? input.leaveColor : current.leaveColor),
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
          welcomeColor: next.welcomeColor,
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
          leaveColor: next.leaveColor,
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
          emojiCloneEnabled: next.emojiCloneEnabled,
          emojiCloneAllowedRoleIds: next.emojiCloneAllowedRoleIds,
          emojiCloneLogChannelId: next.emojiCloneLogChannelId,
          emojiCloneDefaultPrefix: next.emojiCloneDefaultPrefix,
          emojiCloneAllowAnimated: next.emojiCloneAllowAnimated,
          emojiCloneMaxPerRun: next.emojiCloneMaxPerRun,
          emojiCloneAllowedBotIds: next.emojiCloneAllowedBotIds,
          rulesEnabled: next.rulesEnabled,
          rulesChannelId: next.rulesChannelId,
          rulesRoleId: next.rulesRoleId,
          rulesTitle: next.rulesTitle,
          rulesMessage: next.rulesMessage,
          rulesButtonLabel: next.rulesButtonLabel,
          rulesColor: next.rulesColor,
          rulesPanelMessageId: next.rulesPanelMessageId,
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

export async function getSafeBotMessageState(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { safeBotMessageStates } = await getMongoCollections();
  const state = await safeBotMessageStates.findOne(settingsQuery(guildId, normalizedBotId));
  return state ? toSafeBotMessageStateDto(state) : null;
}

export async function saveSafeBotMessageState(
  guildId: string,
  input: {
    channelId: string;
    messageId: string;
  },
  botId?: string | null
) {
  const normalizedBotId = normalizeBotId(botId);
  const now = new Date();
  const { safeBotMessageStates } = await getMongoCollections();
  const saved = await safeBotMessageStates.findOneAndUpdate(
    {
      botId: normalizedBotId,
      guildId
    },
    {
      $set: {
        botId: normalizedBotId,
        channelId: input.channelId,
        guildId,
        messageId: input.messageId,
        updatedAt: now
      },
      $setOnInsert: {
        _id: randomUUID()
      }
    },
    {
      returnDocument: "after",
      upsert: true
    }
  );

  return saved ? toSafeBotMessageStateDto(saved) : {
    botId: normalizedBotId,
    guildId,
    channelId: input.channelId,
    messageId: input.messageId,
    updatedAt: now.toISOString()
  };
}

export async function clearSafeBotMessageState(guildId: string, botId?: string | null) {
  const normalizedBotId = normalizeBotId(botId);
  const { safeBotMessageStates } = await getMongoCollections();
  await safeBotMessageStates.deleteOne({
    botId: normalizedBotId,
    guildId
  });
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
    welcomeTitle: normalizePanelText(settings.welcomeTitle),
    welcomeMessage: normalizePanelMessage(settings.welcomeMessage),
    welcomeRulesTitle: normalizePanelText(settings.welcomeRulesTitle),
    welcomeRules: normalizePanelText(settings.welcomeRules),
    welcomeChannelLabel: normalizePanelText(settings.welcomeChannelLabel),
    welcomeFooterText: normalizePanelText(settings.welcomeFooterText),
    welcomeColor: normalizePanelColor(settings.welcomeColor),
    leaveEnabled: settings.leaveEnabled ?? defaults.leaveEnabled,
    leaveChannelId: settings.leaveChannelId ?? defaults.leaveChannelId,
    leaveDisplayChannelId: settings.leaveDisplayChannelId ?? defaults.leaveDisplayChannelId,
    leaveImageUrl: normalizeWelcomeImageUrl(settings.leaveImageUrl ?? defaults.leaveImageUrl),
    leaveTitle: normalizePanelText(settings.leaveTitle),
    leaveMessage: normalizePanelMessage(settings.leaveMessage),
    leaveRulesTitle: normalizePanelText(settings.leaveRulesTitle),
    leaveRules: normalizePanelText(settings.leaveRules),
    leaveChannelLabel: normalizePanelText(settings.leaveChannelLabel),
    leaveFooterText: normalizePanelText(settings.leaveFooterText),
    leaveColor: normalizePanelColor(settings.leaveColor),
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
    emojiCloneEnabled: settings.emojiCloneEnabled ?? defaults.emojiCloneEnabled,
    emojiCloneAllowedRoleIds: normalizeSnowflakes(settings.emojiCloneAllowedRoleIds ?? []),
    emojiCloneLogChannelId: normalizeSnowflake(settings.emojiCloneLogChannelId),
    emojiCloneDefaultPrefix: normalizePrefix(settings.emojiCloneDefaultPrefix),
    emojiCloneAllowAnimated: settings.emojiCloneAllowAnimated ?? defaults.emojiCloneAllowAnimated,
    emojiCloneMaxPerRun: clampInteger(
      settings.emojiCloneMaxPerRun,
      1,
      MAX_EMOJI_CLONE_MAX_PER_RUN,
      DEFAULT_EMOJI_CLONE_MAX_PER_RUN
    ),
    emojiCloneAllowedBotIds: normalizeSnowflakes(settings.emojiCloneAllowedBotIds ?? []),
    rulesEnabled: settings.rulesEnabled ?? defaults.rulesEnabled,
    rulesChannelId: normalizeSnowflake(settings.rulesChannelId),
    rulesRoleId: normalizeSnowflake(settings.rulesRoleId),
    rulesTitle: normalizePanelText(settings.rulesTitle) || DEFAULT_RULES_TITLE,
    rulesMessage: normalizePanelText(settings.rulesMessage) || DEFAULT_RULES_MESSAGE,
    rulesButtonLabel: normalizePanelText(settings.rulesButtonLabel) || DEFAULT_RULES_BUTTON_LABEL,
    rulesColor: normalizePanelColor(settings.rulesColor),
    rulesPanelMessageId: normalizeSnowflake(settings.rulesPanelMessageId),
    verificationEnabled: settings.verificationEnabled,
    verificationRoleId: verificationRoleIds[0] ?? null,
    verificationRoleIds,
    dashboardRolePermissions,
    dashboardUserPermissions
  });
}

function toSafeBotMessageStateDto(state: MongoSafeBotMessageState): SafeBotMessageStateDto {
  return {
    botId: normalizeBotId(state.botId),
    guildId: state.guildId,
    channelId: state.channelId,
    messageId: state.messageId,
    updatedAt: state.updatedAt.toISOString()
  };
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
  return access.roleIds.length > 0 || Object.keys(access.userPermissions).length > 0;
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

function normalizePrefix(value: string | null | undefined) {
  const normalized = value?.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 24);
  return normalized || null;
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
  const normalized = value?.trim();
  return !normalized || normalized.startsWith("/uploads/welcome/default.gif") ? null : normalized;
}

function normalizePanelMessage(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function normalizePanelText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function normalizePanelColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : DEFAULT_PANEL_COLOR;
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
