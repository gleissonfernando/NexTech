import { randomUUID } from "node:crypto";
import { ensureGuild, getMongoCollections, type MongoGuildSettings, type MongoSafeBotMessageState } from "../database/mongo";
import {
  normalizeDashboardAccessLevel,
  type DashboardAccessLevel
} from "./dashboardPermissionService";
import { getPanelImageSettings, type PanelImageSettingsDto } from "./panelImageSettingsService";

export type GuildSettingsDto = {
  botId: string | null;
  guildId: string;
  leavePanelImage: PanelImageSettingsDto | null;
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeDisplayChannelId: string | null;
  welcomeImageUrl: string | null;
  welcomePanelImage: PanelImageSettingsDto | null;
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
  ticketPanelImage: PanelImageSettingsDto | null;
  ticketPanelTitle: string | null;
  ticketPanelDescription: string | null;
  ticketPanelInfoText: string | null;
  ticketPanelFooterText: string | null;
  ticketPanelColor: string;
  ticketPanelPlaceholder: string | null;
  ticketPanelOptions: TicketPanelOptionDto[];
  reportSystem: ReportSystemSettingsDto;
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

export type TicketPanelOptionDto = {
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  label: string;
  value: string;
};

export type ReportSystemCategoryDto = {
  channelOrCategoryId: string | null;
  color: string;
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
};

export type ReportSystemStatusDto = {
  color: string;
  id: string;
  name: string;
  order: number;
};

export type ReportSystemButtonKey =
  | "claim"
  | "reply"
  | "status"
  | "requestEvidence"
  | "addMember"
  | "removeMember"
  | "transcript"
  | "close"
  | "reopen"
  | "delete";

export type ReportSystemLogKey =
  | "opened"
  | "closed"
  | "replies"
  | "statusChanged"
  | "messagesDeleted"
  | "anonymous"
  | "admin";

export type ReportSystemSettingsDto = {
  adminRoleIds: string[];
  allowAnonymousReports: boolean;
  allowAnonymousStaffReplies: boolean;
  anonymousAvatarUrl: string | null;
  anonymousEmbedColor: string;
  anonymousInvestigatorName: string;
  anonymousReporterName: string;
  auditChannelId: string | null;
  buttonText: string;
  buttons: Record<ReportSystemButtonKey, boolean>;
  categories: ReportSystemCategoryDto[];
  categoryId: string | null;
  closeRoleIds: string[];
  createRoleIds: string[];
  enabled: boolean;
  footerText: string | null;
  imageUrl: string | null;
  infoMessage: string;
  logChannelId: string | null;
  logs: Record<ReportSystemLogKey, boolean>;
  mentionRoleIds: string[];
  name: string;
  openMessage: string;
  panelChannelId: string | null;
  panelColor: string;
  panelDescription: string;
  panelEmoji: string | null;
  panelPlaceholder: string;
  panelTitle: string;
  permissionRoleIds: string[];
  reopenRoleIds: string[];
  replyRoleIds: string[];
  statusRoleIds: string[];
  statuses: ReportSystemStatusDto[];
  thumbnailUrl: string | null;
  transcriptChannelId: string | null;
  viewRoleIds: string[];
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
const DEFAULT_TICKET_PANEL_TITLE = "Central de Suporte";
const DEFAULT_TICKET_PANEL_DESCRIPTION = "Precisa de ajuda? Abra um ticket e nossa equipe ira atende-lo em breve.";
const DEFAULT_TICKET_PANEL_INFO_TEXT = [
  "Horario de atendimento: Seg-Sex, 9h-18h",
  "Descreva seu problema com detalhes para um atendimento mais rapido."
].join("\n");
const DEFAULT_TICKET_PANEL_PLACEHOLDER = "Selecione o tipo de atendimento";
const DEFAULT_TICKET_PANEL_OPTIONS: TicketPanelOptionDto[] = [
  {
    description: "Abrir um atendimento com a equipe.",
    emoji: "🎫",
    enabled: true,
    label: "Suporte",
    value: "suporte"
  }
];
const REPORT_BUTTON_KEYS: ReportSystemButtonKey[] = ["claim", "reply", "status", "requestEvidence", "addMember", "removeMember", "transcript", "close", "reopen", "delete"];
const REPORT_LOG_KEYS: ReportSystemLogKey[] = ["opened", "closed", "replies", "statusChanged", "messagesDeleted", "anonymous", "admin"];
const DEFAULT_REPORT_CATEGORIES: ReportSystemCategoryDto[] = [
  { channelOrCategoryId: null, color: "#dc2626", description: "Denuncias contra oficiais.", emoji: "👮", enabled: true, id: "oficial", name: "Contra Oficial", order: 1 },
  { channelOrCategoryId: null, color: "#991b1b", description: "Denuncias contra alto comando.", emoji: "⭐", enabled: true, id: "alto-comando", name: "Contra Alto Comando", order: 2 },
  { channelOrCategoryId: null, color: "#7f1d1d", description: "Denuncias contra corregedoria.", emoji: "🛡️", enabled: true, id: "corregedoria", name: "Contra Corregedoria", order: 3 },
  { channelOrCategoryId: null, color: "#b91c1c", description: "Denuncias contra conselho.", emoji: "⚖️", enabled: true, id: "conselho", name: "Contra Conselho", order: 4 },
  { channelOrCategoryId: null, color: "#ef4444", description: "Denuncias contra unidade.", emoji: "🏢", enabled: true, id: "unidade", name: "Contra Unidade", order: 5 },
  { channelOrCategoryId: null, color: "#f97316", description: "Outros assuntos da corregedoria.", emoji: "📌", enabled: true, id: "outros", name: "Outros Assuntos", order: 6 }
];
const DEFAULT_REPORT_STATUSES: ReportSystemStatusDto[] = [
  { color: "#22c55e", id: "aberta", name: "Aberta", order: 1 },
  { color: "#f59e0b", id: "em-analise", name: "Em analise", order: 2 },
  { color: "#38bdf8", id: "aguardando-resposta", name: "Aguardando resposta", order: 3 },
  { color: "#818cf8", id: "respondida", name: "Respondida", order: 4 },
  { color: "#64748b", id: "finalizada", name: "Finalizada", order: 5 },
  { color: "#475569", id: "arquivada", name: "Arquivada", order: 6 }
];

export function defaultSettings(guildId: string, botId: string | null = null): GuildSettingsDto {
  return {
    botId,
    guildId,
    leavePanelImage: null,
    welcomeEnabled: true,
    welcomeChannelId: null,
    welcomeDisplayChannelId: null,
    welcomeImageUrl: null,
    welcomePanelImage: null,
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
    ticketPanelImage: null,
    ticketPanelTitle: DEFAULT_TICKET_PANEL_TITLE,
    ticketPanelDescription: DEFAULT_TICKET_PANEL_DESCRIPTION,
    ticketPanelInfoText: DEFAULT_TICKET_PANEL_INFO_TEXT,
    ticketPanelFooterText: "",
    ticketPanelColor: "#7c3aed",
    ticketPanelPlaceholder: DEFAULT_TICKET_PANEL_PLACEHOLDER,
    ticketPanelOptions: DEFAULT_TICKET_PANEL_OPTIONS.map((option) => ({ ...option })),
    reportSystem: defaultReportSystemSettings(),
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
      return withPanelImageSettings(toDto(settings));
    }
  } catch (error) {
    console.warn("[mongo] usando settings em memória:", error instanceof Error ? error.message : error);
  }

  return withPanelImageSettings(memorySettings.get(settingsKey(guildId, normalizedBotId)) ?? defaultSettings(guildId, normalizedBotId));
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

export async function updateGuildSettings(
  guildId: string,
  input: Partial<Omit<GuildSettingsDto, "reportSystem"> & { reportSystem?: unknown }>,
  botId?: string | null
) {
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
    reportSystem: normalizeReportSystemSettings("reportSystem" in input ? input.reportSystem : current.reportSystem, current.reportSystem),
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
          ticketPanelTitle: next.ticketPanelTitle,
          ticketPanelDescription: next.ticketPanelDescription,
          ticketPanelInfoText: next.ticketPanelInfoText,
          ticketPanelFooterText: next.ticketPanelFooterText,
          ticketPanelColor: next.ticketPanelColor,
          ticketPanelPlaceholder: next.ticketPanelPlaceholder,
          ticketPanelOptions: next.ticketPanelOptions,
          reportSystem: next.reportSystem,
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
    leavePanelImage: null,
    welcomeEnabled: settings.welcomeEnabled,
    welcomeChannelId: settings.welcomeChannelId,
    welcomeDisplayChannelId: settings.welcomeDisplayChannelId ?? null,
    welcomeImageUrl: normalizeWelcomeImageUrl(settings.welcomeImageUrl),
    welcomePanelImage: null,
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
    ticketPanelImage: null,
    ticketPanelTitle: normalizePanelText(settings.ticketPanelTitle) || defaults.ticketPanelTitle,
    ticketPanelDescription: normalizePanelMessage(settings.ticketPanelDescription) || defaults.ticketPanelDescription,
    ticketPanelInfoText: normalizePanelText(settings.ticketPanelInfoText) || defaults.ticketPanelInfoText,
    ticketPanelFooterText: normalizePanelText(settings.ticketPanelFooterText),
    ticketPanelColor: normalizeTicketPanelColor(settings.ticketPanelColor),
    ticketPanelPlaceholder: normalizePanelText(settings.ticketPanelPlaceholder) || defaults.ticketPanelPlaceholder,
    ticketPanelOptions: normalizeTicketPanelOptions(settings.ticketPanelOptions),
    reportSystem: normalizeReportSystemSettings(settings.reportSystem, defaults.reportSystem),
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

async function withPanelImageSettings(settings: GuildSettingsDto): Promise<GuildSettingsDto> {
  if (!settings.botId) {
    return {
      ...settings,
      leavePanelImage: null,
      ticketPanelImage: null,
      welcomePanelImage: null
    };
  }

  try {
    const [welcomePanelImage, leavePanelImage, ticketPanelImage] = await Promise.all([
      getPanelImageSettings(settings.guildId, settings.botId, "welcome"),
      getPanelImageSettings(settings.guildId, settings.botId, "leave"),
      getPanelImageSettings(settings.guildId, settings.botId, "ticket")
    ]);

    return {
      ...settings,
      leavePanelImage: leavePanelImage.imageEnabled ? leavePanelImage : null,
      ticketPanelImage: ticketPanelImage.imageEnabled ? ticketPanelImage : null,
      welcomePanelImage: welcomePanelImage.imageEnabled ? welcomePanelImage : null
    };
  } catch (error) {
    console.warn("[settings] nao foi possivel carregar imagens dos paineis:", error instanceof Error ? error.message : error);
    return {
      ...settings,
      leavePanelImage: null,
      ticketPanelImage: null,
      welcomePanelImage: null
    };
  }
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

function normalizeTicketPanelColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#7c3aed";
}

function normalizeTicketPanelOptions(value: unknown): TicketPanelOptionDto[] {
  if (!Array.isArray(value)) {
    return DEFAULT_TICKET_PANEL_OPTIONS.map((option) => ({ ...option }));
  }

  const seen = new Set<string>();
  const options = value
    .map((item): TicketPanelOptionDto | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = String(record.label ?? "").trim().slice(0, 80);
      const fallbackValue = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const valueText = String(record.value ?? fallbackValue).trim().slice(0, 80);
      const value = valueText || fallbackValue || `opcao-${seen.size + 1}`;

      if (!label || seen.has(value)) return null;
      seen.add(value);

      return {
        description: normalizeNullableText(record.description, 100),
        emoji: normalizeNullableText(record.emoji, 80),
        enabled: record.enabled !== false,
        label,
        value
      };
    })
    .filter((item): item is TicketPanelOptionDto => Boolean(item))
    .slice(0, 25);

  return options.length ? options : DEFAULT_TICKET_PANEL_OPTIONS.map((option) => ({ ...option }));
}

function defaultReportSystemSettings(): ReportSystemSettingsDto {
  return {
    adminRoleIds: [],
    allowAnonymousReports: true,
    allowAnonymousStaffReplies: true,
    anonymousAvatarUrl: null,
    anonymousEmbedColor: "#dc2626",
    anonymousInvestigatorName: "Equipe IAB",
    anonymousReporterName: "Denunciante Anonimo",
    auditChannelId: null,
    buttonText: "Abrir denuncia",
    buttons: Object.fromEntries(REPORT_BUTTON_KEYS.map((key) => [key, true])) as Record<ReportSystemButtonKey, boolean>,
    categories: DEFAULT_REPORT_CATEGORIES.map((item) => ({ ...item })),
    categoryId: null,
    closeRoleIds: [],
    createRoleIds: [],
    enabled: true,
    footerText: "IAB / Corregedoria",
    imageUrl: null,
    infoMessage: "Este sistema garante total confidencialidade aos denunciantes. Caso escolha o modo anonimo, sua identidade permanecera oculta para todos os participantes do atendimento. As denuncias serao analisadas exclusivamente pela equipe autorizada.",
    logChannelId: null,
    logs: Object.fromEntries(REPORT_LOG_KEYS.map((key) => [key, true])) as Record<ReportSystemLogKey, boolean>,
    mentionRoleIds: [],
    name: "IAB",
    openMessage: "Sua denuncia foi aberta. Envie as informacoes solicitadas e aguarde a equipe autorizada.",
    panelChannelId: null,
    panelColor: "#dc2626",
    panelDescription: "Selecione abaixo o tipo de denuncia e informe os detalhes com seguranca.",
    panelEmoji: "🛡️",
    panelPlaceholder: "Selecione o tipo de denuncia",
    panelTitle: "Sistema de Denuncias",
    permissionRoleIds: [],
    reopenRoleIds: [],
    replyRoleIds: [],
    statusRoleIds: [],
    statuses: DEFAULT_REPORT_STATUSES.map((item) => ({ ...item })),
    thumbnailUrl: null,
    transcriptChannelId: null,
    viewRoleIds: []
  };
}

function normalizeReportSystemSettings(value: unknown, fallback = defaultReportSystemSettings()): ReportSystemSettingsDto {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    ...fallback,
    adminRoleIds: normalizeSnowflakes(asArray(record.adminRoleIds)),
    allowAnonymousReports: record.allowAnonymousReports !== false,
    allowAnonymousStaffReplies: record.allowAnonymousStaffReplies !== false,
    anonymousAvatarUrl: normalizeUrl(record.anonymousAvatarUrl),
    anonymousEmbedColor: normalizePanelColor(String(record.anonymousEmbedColor ?? fallback.anonymousEmbedColor)),
    anonymousInvestigatorName: normalizeNullableText(record.anonymousInvestigatorName, 80) ?? fallback.anonymousInvestigatorName,
    anonymousReporterName: normalizeNullableText(record.anonymousReporterName, 80) ?? fallback.anonymousReporterName,
    auditChannelId: normalizeSnowflake(String(record.auditChannelId ?? "")),
    buttonText: normalizeNullableText(record.buttonText, 80) ?? fallback.buttonText,
    buttons: normalizeBooleanMap(record.buttons, REPORT_BUTTON_KEYS, fallback.buttons),
    categories: normalizeReportCategories(record.categories),
    categoryId: normalizeSnowflake(String(record.categoryId ?? "")),
    closeRoleIds: normalizeSnowflakes(asArray(record.closeRoleIds)),
    createRoleIds: normalizeSnowflakes(asArray(record.createRoleIds)),
    enabled: record.enabled !== false,
    footerText: normalizeNullableText(record.footerText, 180),
    imageUrl: normalizeUrl(record.imageUrl),
    infoMessage: normalizeNullableText(record.infoMessage, 1800) ?? fallback.infoMessage,
    logChannelId: normalizeSnowflake(String(record.logChannelId ?? "")),
    logs: normalizeBooleanMap(record.logs, REPORT_LOG_KEYS, fallback.logs),
    mentionRoleIds: normalizeSnowflakes(asArray(record.mentionRoleIds)),
    name: normalizeNullableText(record.name, 80) ?? fallback.name,
    openMessage: normalizeNullableText(record.openMessage, 1000) ?? fallback.openMessage,
    panelChannelId: normalizeSnowflake(String(record.panelChannelId ?? "")),
    panelColor: normalizePanelColor(String(record.panelColor ?? fallback.panelColor)),
    panelDescription: normalizeNullableText(record.panelDescription, 1000) ?? fallback.panelDescription,
    panelEmoji: normalizeNullableText(record.panelEmoji, 80),
    panelPlaceholder: normalizeNullableText(record.panelPlaceholder, 120) ?? fallback.panelPlaceholder,
    panelTitle: normalizeNullableText(record.panelTitle, 120) ?? fallback.panelTitle,
    permissionRoleIds: normalizeSnowflakes(asArray(record.permissionRoleIds)),
    reopenRoleIds: normalizeSnowflakes(asArray(record.reopenRoleIds)),
    replyRoleIds: normalizeSnowflakes(asArray(record.replyRoleIds)),
    statusRoleIds: normalizeSnowflakes(asArray(record.statusRoleIds)),
    statuses: normalizeReportStatuses(record.statuses),
    thumbnailUrl: normalizeUrl(record.thumbnailUrl),
    transcriptChannelId: normalizeSnowflake(String(record.transcriptChannelId ?? "")),
    viewRoleIds: normalizeSnowflakes(asArray(record.viewRoleIds))
  };
}

function normalizeReportCategories(value: unknown): ReportSystemCategoryDto[] {
  const seen = new Set<string>();
  const source = Array.isArray(value) ? value : DEFAULT_REPORT_CATEGORIES;
  const items = source.map((item, index): ReportSystemCategoryDto | null => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const name = normalizeNullableText(record.name, 80);
    if (!name) return null;
    const fallbackId = slug(name) || `categoria-${index + 1}`;
    const id = normalizeNullableText(record.id, 80) ?? fallbackId;
    if (seen.has(id)) return null;
    seen.add(id);
    return {
      channelOrCategoryId: normalizeSnowflake(String(record.channelOrCategoryId ?? "")),
      color: normalizePanelColor(String(record.color ?? "#dc2626")),
      description: normalizeNullableText(record.description, 100),
      emoji: normalizeNullableText(record.emoji, 80),
      enabled: record.enabled !== false,
      id,
      name,
      order: clampInteger(Number(record.order ?? index + 1), 1, 1000, index + 1)
    };
  }).filter((item): item is ReportSystemCategoryDto => Boolean(item)).slice(0, 25);
  return (items.length ? items : DEFAULT_REPORT_CATEGORIES.map((item) => ({ ...item }))).sort((a, b) => a.order - b.order);
}

function normalizeReportStatuses(value: unknown): ReportSystemStatusDto[] {
  const seen = new Set<string>();
  const source = Array.isArray(value) ? value : DEFAULT_REPORT_STATUSES;
  const items = source.map((item, index): ReportSystemStatusDto | null => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const name = normalizeNullableText(record.name, 80);
    if (!name) return null;
    const id = normalizeNullableText(record.id, 80) ?? (slug(name) || `status-${index + 1}`);
    if (seen.has(id)) return null;
    seen.add(id);
    return { color: normalizePanelColor(String(record.color ?? "#64748b")), id, name, order: clampInteger(Number(record.order ?? index + 1), 1, 1000, index + 1) };
  }).filter((item): item is ReportSystemStatusDto => Boolean(item)).slice(0, 25);
  return (items.length ? items : DEFAULT_REPORT_STATUSES.map((item) => ({ ...item }))).sort((a, b) => a.order - b.order);
}

function normalizeBooleanMap<T extends string>(value: unknown, keys: T[], fallback: Record<T, boolean>): Record<T, boolean> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(keys.map((key) => [key, typeof record[key] === "boolean" ? record[key] : fallback[key]])) as Record<T, boolean>;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeUrl(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().slice(0, 2048) : "";
  return normalized && /^https?:\/\//i.test(normalized) ? normalized : null;
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function normalizeNullableText(value: unknown, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return normalized || null;
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
