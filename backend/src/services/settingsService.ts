import { randomUUID } from "node:crypto";
import { fixedSystemEmojiText, normalizeFixedSystemEmojiText } from "../config/systemEmojis";
import { ensureGuild, getMongoCollections, type MongoGuildSettings, type MongoSafeBotMessageState } from "../database/mongo";
import {
  highestDashboardAccessLevel,
  normalizeDashboardAccessLevel,
  type DashboardAccessLevel
} from "./dashboardPermissionService";
import { resolveMemberPanelAssetUrl } from "./memberPanelAssetStorageService";
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
  welcomeSubtitle: string | null;
  welcomeMessage: string | null;
  welcomeRulesTitle: string | null;
  welcomeRules: string | null;
  welcomeSections: MemberPanelSectionDto[];
  welcomeChannelLabel: string | null;
  welcomeFooterText: string | null;
  welcomeColor: string;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveDisplayChannelId: string | null;
  leaveImageUrl: string | null;
  leaveTitle: string | null;
  leaveSubtitle: string | null;
  leaveMessage: string | null;
  leaveRulesTitle: string | null;
  leaveRules: string | null;
  leaveSections: MemberPanelSectionDto[];
  leaveChannelLabel: string | null;
  leaveFooterText: string | null;
  leaveColor: string;
  autoRoleEnabled: boolean;
  autoRoleIds: string[];
  twitchRoleId: string | null;
  boosterRoleId: string | null;
  ticketEnabled: boolean;
  ticketCategoryId: string | null;
  ticketPanelChannelId: string | null;
  ticketPanelMessageId: string | null;
  ticketPanelImage: PanelImageSettingsDto | null;
  ticketPanelLogoImage: PanelImageSettingsDto | null;
  ticketPanelBannerImage: PanelImageSettingsDto | null;
  ticketPanelSecondaryBannerImage: PanelImageSettingsDto | null;
  ticketPanelFooterImage: PanelImageSettingsDto | null;
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
  globalLogConfig: GlobalLogConfigDto;
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
  rulesSubtitle: string | null;
  rulesMessage: string | null;
  rulesButtonLabel: string | null;
  rulesColor: string;
  rulesFooterText: string | null;
  rulesImageFormat: RulesPanelImageFormat;
  rulesImageUrl: string | null;
  rulesPanelImage: PanelImageSettingsDto | null;
  rulesButtons: RulesPanelButtonDto[];
  rulesCategories: RulesPanelCategoryDto[];
  rulesPanelMessageId: string | null;
  verificationEnabled: boolean;
  verificationRoleId: string | null;
  verificationRoleIds: string[];
  dashboardRolePermissions: Record<string, DashboardAccessLevel>;
  dashboardUserPermissions: Record<string, DashboardAccessLevel>;
};

export type RulesPanelImageFormat = "horizontal" | "square" | "vertical" | "none";
export type RulesPanelButtonAction = "accept" | "url" | "message" | "ticket" | "command";
export type RulesPanelButtonStyle = "primary" | "secondary" | "success" | "danger";

export type RulesPanelButtonDto = {
  action: RulesPanelButtonAction;
  command: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  label: string;
  message: string | null;
  order: number;
  style: RulesPanelButtonStyle;
  url: string | null;
};

export type RulesPanelCategoryDto = {
  description: string | null;
  emoji: string | null;
  enabled: boolean;
  id: string;
  name: string;
  order: number;
  rules: string[];
};

export type GlobalLogConfigDto = {
  transcriptChannelId: string | null;
  logViewRoleId: string | null;
  transcriptViewRoleId: string | null;
  transcriptRequired: boolean;
  transcriptWebsiteEnabled: boolean;
  transcriptTextEnabled: boolean;
  transcriptExpirationDays: number | null;
  panelBannerUrl: string | null;
  panelFooterText: string | null;
  panelColor: string;
  moduleEmoji: string | null;
  moduleName: string | null;
  showAnonymousAuthorToRoleIds: string[];
};

export type TicketPanelOptionDto = {
  categoryId: string | null;
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
  escalateToCategoryId: string | null;
  id: string;
  judgeLabel: string | null;
  logChannelId: string | null;
  name: string;
  order: number;
  responsibleRoleIds: string[];
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
  comissarioCategoryId: string | null;
  comissarioLogChannelId: string | null;
  comissarioRoleIds: string[];
  competenceCommandRoleIds: string[];
  conselhoCategoryId: string | null;
  conselhoLogChannelId: string | null;
  conselhoRoleIds: string[];
  createRoleIds: string[];
  defaultDeadline: string;
  dmBannerUrl: string | null;
  enabled: boolean;
  footerText: string | null;
  finishedCategoryId: string | null;
  hcmdCategoryId: string | null;
  hcmdLogChannelId: string | null;
  hcmdRoleIds: string[];
  iabCategoryId: string | null;
  iabLogChannelId: string | null;
  iabRoleIds: string[];
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
  subpoenaCategoryId: string | null;
  subpoenaDmText: string;
  subpoenaPanelBannerUrl: string | null;
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

export type MemberPanelSectionDto = {
  description: string;
  emoji: string | null;
  enabled: boolean;
  id: string;
  order: number;
  title: string;
};

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

type GuildSettingsUpdateInput = Partial<
  Omit<
    GuildSettingsDto,
    "globalLogConfig" | "reportSystem" | "rulesButtons" | "rulesCategories" | "rulesImageFormat"
  > & {
    globalLogConfig?: unknown;
    reportSystem?: unknown;
    rulesButtons?: unknown;
    rulesCategories?: unknown;
    rulesImageFormat?: unknown;
  }
>;

const memorySettings = new Map<string, GuildSettingsDto>();
const DEFAULT_PANEL_COLOR = "#ef4444";
const DEFAULT_MEMBER_PANEL_COLOR = "#f5c542";
const PREVIOUS_WELCOME_MESSAGE = [
  "Seja bem-vindo(a), {user}, a nossa comunidade de lives.",
  "Aqui a galera acompanha transmissoes, eventos da comunidade, avisos e momentos ao vivo juntos."
].join("\n");
const PREVIOUS_WELCOME_RULES = [
  "Leia as regras antes de participar.",
  "Aguarde os avisos oficiais de lives e eventos.",
  "Respeite streamers, espectadores e moderadores.",
  "Não divulgue lives, links ou canais sem autorizacao.",
  "Converse, faca amizades e aproveite sua estadia."
].join("\n");
const PREVIOUS_WELCOME_FOOTER_TEXT = "NexTech - Comunidade de lives";
export const DEFAULT_WELCOME_TITLE = "Bem-vindo à NextTech";
export const DEFAULT_WELCOME_SUBTITLE = "A comunidade está pronta para receber você.";
export const DEFAULT_WELCOME_MESSAGE = [
  "{user}, seja bem-vindo(a) à comunidade NextTech.",
  "Explore os canais, participe das conversas e fique à vontade para acompanhar os avisos, novidades e espaços de interação."
].join("\n");
export const DEFAULT_WELCOME_RULES_TITLE = "Regras e verificação";
export const DEFAULT_WELCOME_RULES = [
  "Leia as regras para entender como a comunidade funciona.",
  "Conclua a verificação caso ela esteja disponível.",
  "Use cada canal para o assunto correto e mantenha uma convivência respeitosa."
].join("\n");
export const DEFAULT_WELCOME_CHANNEL_LABEL = "Comece por";
export const DEFAULT_WELCOME_FOOTER_TEXT = "NextTech - Comunidade";
export const DEFAULT_LEAVE_MESSAGE = [
  "{user}, obrigado por ter feito parte da NextTech.",
  "Sua participação foi respeitada e as portas continuarão abertas caso decida retornar."
].join("\n");
export const DEFAULT_LEAVE_TITLE = "Até breve";
export const DEFAULT_LEAVE_SUBTITLE = "Obrigado por ter caminhado com a NextTech.";
export const DEFAULT_LEAVE_RULES_TITLE = "Despedida";
export const DEFAULT_LEAVE_RULES = [
  "Agradecemos pelo tempo dedicado à comunidade.",
  "Desejamos sucesso na sua jornada.",
  "Quando quiser voltar, a NextTech estará de portas abertas."
].join("\n");
export const DEFAULT_LEAVE_CHANNEL_LABEL = "Comunidade";
export const DEFAULT_LEAVE_FOOTER_TEXT = "NextTech - As portas seguem abertas";
const DEFAULT_WELCOME_SECTIONS: MemberPanelSectionDto[] = [
  {
    description: "{user}, sua entrada foi registrada com sucesso. A partir de agora você faz parte de uma comunidade organizada, acolhedora e preparada para receber você.",
    emoji: fixedSystemEmojiText("aniversario"),
    enabled: true,
    id: "boas-vindas",
    order: 1,
    title: "Chegada confirmada"
  },
  {
    description: "Conheça os canais, acompanhe os avisos e participe dos espaços que combinam com o que você procura dentro da NextTech.",
    emoji: fixedSystemEmojiText("discord"),
    enabled: true,
    id: "comunidade",
    order: 2,
    title: "Explore a comunidade"
  },
  {
    description: "Antes de interagir, leia as regras e conclua a verificação quando ela estiver disponível. Isso mantém o servidor seguro, claro e bem organizado.",
    emoji: fixedSystemEmojiText("folha"),
    enabled: true,
    id: "regras",
    order: 3,
    title: "Regras e verificação"
  },
  {
    description: "Se precisar de orientação, a equipe está disponível para ajudar com dúvidas, acesso aos canais e primeiros passos na comunidade.",
    emoji: fixedSystemEmojiText("interrogacao"),
    enabled: true,
    id: "suporte",
    order: 4,
    title: "Equipe disponível"
  }
];
const DEFAULT_LEAVE_SECTIONS: MemberPanelSectionDto[] = [
  {
    description: "{user}, obrigado por ter dedicado parte do seu tempo à NextTech. Sua presença fez parte da história da comunidade.",
    emoji: fixedSystemEmojiText("prancheta_acertos"),
    enabled: true,
    id: "agradecimento",
    order: 1,
    title: "Obrigado pela participação"
  },
  {
    description: "Respeitamos sua decisão e desejamos que a sua próxima etapa seja produtiva, leve e cheia de boas oportunidades.",
    emoji: fixedSystemEmojiText("trofeu_alt"),
    enabled: true,
    id: "jornada",
    order: 2,
    title: "Sucesso na jornada"
  },
  {
    description: "Caso queira retornar no futuro, a NextTech continuará de portas abertas para receber você novamente.",
    emoji: fixedSystemEmojiText("porta"),
    enabled: true,
    id: "retorno",
    order: 3,
    title: "Portas abertas"
  },
  {
    description: "Fica o nosso agradecimento final e uma despedida sincera, elegante e respeitosa em nome de toda a comunidade.",
    emoji: fixedSystemEmojiText("visto"),
    enabled: true,
    id: "despedida",
    order: 4,
    title: "Até breve"
  }
];
const LEGACY_WELCOME_MESSAGE = "Bem-vindo(a), {user}!";
const LEGACY_LEAVE_MESSAGE = "Até mais, {user}.";
export const MAX_AUTOMATIC_ROLES = 2;
const DEFAULT_ACCOUNT_AGE_MIN_DAYS = 10;
const MAX_ACCOUNT_AGE_MIN_DAYS = 3_650;
const DEFAULT_LOG_CATEGORIES = [...LOG_CATEGORIES];
const DEFAULT_GLOBAL_LOG_CONFIG: GlobalLogConfigDto = {
  transcriptChannelId: null,
  logViewRoleId: null,
  transcriptViewRoleId: null,
  transcriptRequired: true,
  transcriptWebsiteEnabled: true,
  transcriptTextEnabled: true,
  transcriptExpirationDays: 30,
  panelBannerUrl: null,
  panelFooterText: "Logs do sistema - acesso restrito",
  panelColor: "#2563eb",
  moduleEmoji: fixedSystemEmojiText("prancheta"),
  moduleName: null,
  showAnonymousAuthorToRoleIds: []
};
const DEFAULT_EMOJI_CLONE_MAX_PER_RUN = 1000;
const MAX_EMOJI_CLONE_MAX_PER_RUN = 1000;
const DEFAULT_RULES_TITLE = "Regras da comunidade";
const DEFAULT_RULES_SUBTITLE = "Regras Oficiais do Servidor";
const DEFAULT_RULES_MESSAGE = [
  "Respeite todos os membros. Ofensas, preconceito, assedio ou discriminacao não serão tolerados.",
  "Não publique conteúdo adulto, violento, chocante ou ilegal.",
  "Evite spam, flood, mensagens repetitivas, emojis em excesso e links desnecessarios.",
  "Não divulgue golpes, arquivos suspeitos ou sites maliciosos.",
  "Proteja informações pessoais. Não compartilhe telefone, endereco, fotos privadas ou dados sensíveis.",
  "Use os canais corretos e siga as orientacoes da equipe."
].join("\n");
const DEFAULT_RULES_BUTTON_LABEL = "Li e aceito";
const DEFAULT_RULES_FOOTER_TEXT = "NexTech © Todos os direitos reservados";
const DEFAULT_RULES_CATEGORIES: RulesPanelCategoryDto[] = [
  {
    description: "Trate todos com cordialidade e respeito.",
    emoji: "💜",
    enabled: true,
    id: "convivencia",
    name: "Convivência",
    order: 1,
    rules: [
      "Seja respeitoso com todos.",
      "Não será aceito qualquer tipo de drama, preconceito, assédio ou discurso de ódio."
    ]
  },
  {
    description: "Use os canais de forma clara e adequada.",
    emoji: "💬",
    enabled: true,
    id: "comunicacao",
    name: "Comunicação",
    order: 2,
    rules: [
      "Utilize uma linguagem adequada.",
      "Evite excesso de palavrões ou termos agressivos para manter um ambiente agradável."
    ]
  },
  {
    description: "Conteúdos ofensivos, ilegais ou perigosos são proibidos.",
    emoji: "🚫",
    enabled: true,
    id: "conteudos-proibidos",
    name: "Conteúdos proibidos",
    order: 3,
    rules: [
      "Não compartilhe materiais que sejam ilegais.",
      "Pornográficos.",
      "Violentos ou perturbadores.",
      "Obscenos ou ofensivos."
    ]
  }
];
const DEFAULT_RULES_BUTTONS: RulesPanelButtonDto[] = [
  {
    action: "accept",
    command: null,
    emoji: "📖",
    enabled: true,
    id: "read-rules",
    label: "Ler Regras",
    message: null,
    order: 1,
    style: "primary",
    url: null
  }
];
const RULES_IMAGE_FORMATS = new Set<RulesPanelImageFormat>(["horizontal", "square", "vertical", "none"]);
const RULES_BUTTON_ACTIONS = new Set<RulesPanelButtonAction>(["accept", "url", "message", "ticket", "command"]);
const RULES_BUTTON_STYLES = new Set<RulesPanelButtonStyle>(["primary", "secondary", "success", "danger"]);
const DEFAULT_TICKET_PANEL_TITLE = "Central de Suporte";
const DEFAULT_TICKET_PANEL_DESCRIPTION = "Precisa de ajuda? Abra um ticket e nossa equipe ira atende-lo em breve.";
const DEFAULT_TICKET_PANEL_INFO_TEXT = [
  "Horario de atendimento: Seg-Sex, 9h-18h",
  "Descreva seu problema com detalhes para um atendimento mais rapido."
].join("\n");
const DEFAULT_TICKET_PANEL_PLACEHOLDER = "Selecione o tipo de atendimento";
const DEFAULT_TICKET_PANEL_OPTIONS: TicketPanelOptionDto[] = [
  {
    categoryId: null,
    description: "Abrir um atendimento com a equipe.",
    emoji: fixedSystemEmojiText("prancheta"),
    enabled: true,
    label: "Suporte",
    value: "suporte"
  }
];
const REPORT_BUTTON_KEYS: ReportSystemButtonKey[] = ["claim", "reply", "status", "requestEvidence", "addMember", "removeMember", "transcript", "close", "reopen", "delete"];
const REPORT_LOG_KEYS: ReportSystemLogKey[] = ["opened", "closed", "replies", "statusChanged", "messagesDeleted", "anonymous", "admin"];
const DEFAULT_REPORT_CATEGORIES: ReportSystemCategoryDto[] = [
  { channelOrCategoryId: null, color: "#dc2626", description: "Casos contra oficiais encaminhados para Corregedoria.", emoji: fixedSystemEmojiText("alerta"), enabled: true, escalateToCategoryId: "conselho", id: "iab", judgeLabel: "Denuncias contra oficiais", logChannelId: null, name: "Corregedoria", order: 1, responsibleRoleIds: [] },
  { channelOrCategoryId: null, color: "#7f1d1d", description: "Casos contra Corregedoria encaminhados para Conselho.", emoji: fixedSystemEmojiText("interrogacao"), enabled: true, escalateToCategoryId: "alto-comando", id: "conselho", judgeLabel: "Denuncias contra membros da Corregedoria", logChannelId: null, name: "Conselho", order: 2, responsibleRoleIds: [] },
  { channelOrCategoryId: null, color: "#111827", description: "Casos contra Conselho encaminhados para Alto Comando.", emoji: fixedSystemEmojiText("trofeu"), enabled: true, escalateToCategoryId: "comissario", id: "alto-comando", judgeLabel: "Denuncias contra membros do Conselho", logChannelId: null, name: "Alto Comando", order: 3, responsibleRoleIds: [] },
  { channelOrCategoryId: null, color: "#0f172a", description: "Ultima instancia de competencia.", emoji: fixedSystemEmojiText("trofeu_alt"), enabled: true, escalateToCategoryId: null, id: "comissario", judgeLabel: "Denuncias contra membros do Alto Comando", logChannelId: null, name: "Comissario", order: 4, responsibleRoleIds: [] }
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
    welcomeTitle: DEFAULT_WELCOME_TITLE,
    welcomeSubtitle: DEFAULT_WELCOME_SUBTITLE,
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    welcomeRulesTitle: DEFAULT_WELCOME_RULES_TITLE,
    welcomeRules: DEFAULT_WELCOME_RULES,
    welcomeSections: DEFAULT_WELCOME_SECTIONS.map((section) => ({ ...section })),
    welcomeChannelLabel: DEFAULT_WELCOME_CHANNEL_LABEL,
    welcomeFooterText: DEFAULT_WELCOME_FOOTER_TEXT,
    welcomeColor: DEFAULT_MEMBER_PANEL_COLOR,
    leaveEnabled: true,
    leaveChannelId: null,
    leaveDisplayChannelId: null,
    leaveImageUrl: null,
    leaveTitle: DEFAULT_LEAVE_TITLE,
    leaveSubtitle: DEFAULT_LEAVE_SUBTITLE,
    leaveMessage: DEFAULT_LEAVE_MESSAGE,
    leaveRulesTitle: DEFAULT_LEAVE_RULES_TITLE,
    leaveRules: DEFAULT_LEAVE_RULES,
    leaveSections: DEFAULT_LEAVE_SECTIONS.map((section) => ({ ...section })),
    leaveChannelLabel: DEFAULT_LEAVE_CHANNEL_LABEL,
    leaveFooterText: DEFAULT_LEAVE_FOOTER_TEXT,
    leaveColor: DEFAULT_MEMBER_PANEL_COLOR,
    autoRoleEnabled: false,
    autoRoleIds: [],
    twitchRoleId: null,
    boosterRoleId: null,
    ticketEnabled: true,
    ticketCategoryId: null,
    ticketPanelChannelId: null,
    ticketPanelMessageId: null,
    ticketPanelImage: null,
    ticketPanelLogoImage: null,
    ticketPanelBannerImage: null,
    ticketPanelSecondaryBannerImage: null,
    ticketPanelFooterImage: null,
    ticketPanelTitle: DEFAULT_TICKET_PANEL_TITLE,
    ticketPanelDescription: DEFAULT_TICKET_PANEL_DESCRIPTION,
    ticketPanelInfoText: DEFAULT_TICKET_PANEL_INFO_TEXT,
    ticketPanelFooterText: "",
    ticketPanelColor: "#FFD500",
    ticketPanelPlaceholder: DEFAULT_TICKET_PANEL_PLACEHOLDER,
    ticketPanelOptions: DEFAULT_TICKET_PANEL_OPTIONS.map((option) => ({ ...option })),
    reportSystem: defaultReportSystemSettings(),
    logChannelId: null,
    discordLogsEnabled: false,
    siteLogsEnabled: true,
    discordLogCategories: [...DEFAULT_LOG_CATEGORIES],
    siteLogCategories: [...DEFAULT_LOG_CATEGORIES],
    globalLogConfig: { ...DEFAULT_GLOBAL_LOG_CONFIG },
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
    rulesSubtitle: DEFAULT_RULES_SUBTITLE,
    rulesMessage: DEFAULT_RULES_MESSAGE,
    rulesButtonLabel: DEFAULT_RULES_BUTTON_LABEL,
    rulesColor: DEFAULT_PANEL_COLOR,
    rulesFooterText: DEFAULT_RULES_FOOTER_TEXT,
    rulesImageFormat: "none",
    rulesImageUrl: null,
    rulesPanelImage: null,
    rulesButtons: DEFAULT_RULES_BUTTONS.map((button) => ({ ...button })),
    rulesCategories: DEFAULT_RULES_CATEGORIES.map((category) => ({ ...category, rules: [...category.rules] })),
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
      return withPanelImageSettings(await withResolvedMemberPanelAssets(toDto(settings)));
    }
  } catch (error) {
    console.warn("[mongo] usando settings em memória:", error instanceof Error ? error.message : error);
  }

  return withPanelImageSettings(await withResolvedMemberPanelAssets(memorySettings.get(settingsKey(guildId, normalizedBotId)) ?? defaultSettings(guildId, normalizedBotId)));
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
  const globalUserPermissions = await getGlobalDashboardUserPermissions(guildId);

  if (specificAccess?.enabled && accessHasEntries(specificAccess)) return withGlobalDashboardUserPermissions(specificAccess, globalUserPermissions);
  if (legacyAccess?.enabled && accessHasEntries(legacyAccess)) return withGlobalDashboardUserPermissions(legacyAccess, globalUserPermissions);
  if (specificAccess) return withGlobalDashboardUserPermissions(specificAccess, globalUserPermissions);
  if (legacyAccess) return withGlobalDashboardUserPermissions(legacyAccess, globalUserPermissions);
  if (Object.keys(globalUserPermissions).length) {
    return {
      botId: normalizedBotId,
      guildId,
      enabled: true,
      roleIds: [],
      rolePermissions: {},
      userPermissions: globalUserPermissions
    };
  }
  return null;
}

export async function updateGuildSettings(
  guildId: string,
  input: GuildSettingsUpdateInput,
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
  const globalLogConfig = "globalLogConfig" in input
    ? normalizeGlobalLogConfig(input.globalLogConfig, current.globalLogConfig)
    : current.globalLogConfig;
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
    globalLogConfig,
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
    rulesSubtitle: normalizePanelText("rulesSubtitle" in input ? input.rulesSubtitle : current.rulesSubtitle) || DEFAULT_RULES_SUBTITLE,
    rulesMessage: normalizePanelText("rulesMessage" in input ? input.rulesMessage : current.rulesMessage) || DEFAULT_RULES_MESSAGE,
    rulesButtonLabel: normalizePanelText("rulesButtonLabel" in input ? input.rulesButtonLabel : current.rulesButtonLabel) || DEFAULT_RULES_BUTTON_LABEL,
    rulesColor: normalizePanelColor("rulesColor" in input ? input.rulesColor : current.rulesColor),
    rulesFooterText: normalizePanelText("rulesFooterText" in input ? input.rulesFooterText : current.rulesFooterText) || DEFAULT_RULES_FOOTER_TEXT,
    rulesImageFormat: normalizeRulesImageFormat("rulesImageFormat" in input ? input.rulesImageFormat : current.rulesImageFormat),
    rulesImageUrl: normalizeOptionalUrl("rulesImageUrl" in input ? input.rulesImageUrl : current.rulesImageUrl),
    rulesPanelImage: current.rulesPanelImage,
    rulesButtons: normalizeRulesButtons("rulesButtons" in input ? input.rulesButtons : current.rulesButtons),
    rulesCategories: normalizeRulesCategories("rulesCategories" in input ? input.rulesCategories : current.rulesCategories, "rulesMessage" in input ? input.rulesMessage ?? null : current.rulesMessage),
    rulesPanelMessageId: normalizeSnowflake("rulesPanelMessageId" in input ? input.rulesPanelMessageId : current.rulesPanelMessageId),
    ticketPanelChannelId: normalizeSnowflake("ticketPanelChannelId" in input ? input.ticketPanelChannelId : current.ticketPanelChannelId),
    ticketPanelMessageId: normalizeSnowflake("ticketPanelMessageId" in input ? input.ticketPanelMessageId : current.ticketPanelMessageId),
    autoRoleIds,
    welcomeTitle: normalizeWelcomeTitle("welcomeTitle" in input ? input.welcomeTitle : current.welcomeTitle) || DEFAULT_WELCOME_TITLE,
    welcomeSubtitle: normalizePanelText("welcomeSubtitle" in input ? input.welcomeSubtitle : current.welcomeSubtitle) || DEFAULT_WELCOME_SUBTITLE,
    welcomeMessage: normalizeWelcomeMessage("welcomeMessage" in input ? input.welcomeMessage : current.welcomeMessage) || DEFAULT_WELCOME_MESSAGE,
    welcomeRulesTitle: normalizeWelcomeRulesTitle("welcomeRulesTitle" in input ? input.welcomeRulesTitle : current.welcomeRulesTitle) || DEFAULT_WELCOME_RULES_TITLE,
    welcomeRules: normalizeWelcomeRules("welcomeRules" in input ? input.welcomeRules : current.welcomeRules) || DEFAULT_WELCOME_RULES,
    welcomeSections: normalizeMemberPanelSections("welcomeSections" in input ? input.welcomeSections : current.welcomeSections, DEFAULT_WELCOME_SECTIONS),
    welcomeChannelLabel: normalizeWelcomeChannelLabel("welcomeChannelLabel" in input ? input.welcomeChannelLabel : current.welcomeChannelLabel) || DEFAULT_WELCOME_CHANNEL_LABEL,
    welcomeFooterText: normalizeWelcomeFooterText("welcomeFooterText" in input ? input.welcomeFooterText : current.welcomeFooterText) || DEFAULT_WELCOME_FOOTER_TEXT,
    welcomeColor: normalizeMemberPanelColor("welcomeColor" in input ? input.welcomeColor : current.welcomeColor),
    leaveTitle: normalizePanelText("leaveTitle" in input ? input.leaveTitle : current.leaveTitle) || DEFAULT_LEAVE_TITLE,
    leaveSubtitle: normalizePanelText("leaveSubtitle" in input ? input.leaveSubtitle : current.leaveSubtitle) || DEFAULT_LEAVE_SUBTITLE,
    leaveMessage: normalizePanelMessage("leaveMessage" in input ? input.leaveMessage : current.leaveMessage) || DEFAULT_LEAVE_MESSAGE,
    leaveRulesTitle: normalizePanelText("leaveRulesTitle" in input ? input.leaveRulesTitle : current.leaveRulesTitle) || DEFAULT_LEAVE_RULES_TITLE,
    leaveRules: normalizePanelText("leaveRules" in input ? input.leaveRules : current.leaveRules) || DEFAULT_LEAVE_RULES,
    leaveSections: normalizeMemberPanelSections("leaveSections" in input ? input.leaveSections : current.leaveSections, DEFAULT_LEAVE_SECTIONS),
    leaveChannelLabel: normalizePanelText("leaveChannelLabel" in input ? input.leaveChannelLabel : current.leaveChannelLabel) || DEFAULT_LEAVE_CHANNEL_LABEL,
    leaveFooterText: normalizePanelText("leaveFooterText" in input ? input.leaveFooterText : current.leaveFooterText) || DEFAULT_LEAVE_FOOTER_TEXT,
    leaveColor: normalizeMemberPanelColor("leaveColor" in input ? input.leaveColor : current.leaveColor),
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
          welcomeSubtitle: next.welcomeSubtitle,
          welcomeMessage: next.welcomeMessage,
          welcomeRulesTitle: next.welcomeRulesTitle,
          welcomeRules: next.welcomeRules,
          welcomeSections: next.welcomeSections,
          welcomeChannelLabel: next.welcomeChannelLabel,
          welcomeFooterText: next.welcomeFooterText,
          welcomeColor: next.welcomeColor,
          leaveEnabled: next.leaveEnabled,
          leaveChannelId: next.leaveChannelId,
          leaveDisplayChannelId: next.leaveDisplayChannelId,
          leaveImageUrl: next.leaveImageUrl,
          leaveTitle: next.leaveTitle,
          leaveSubtitle: next.leaveSubtitle,
          leaveMessage: next.leaveMessage,
          leaveRulesTitle: next.leaveRulesTitle,
          leaveRules: next.leaveRules,
          leaveSections: next.leaveSections,
          leaveChannelLabel: next.leaveChannelLabel,
          leaveFooterText: next.leaveFooterText,
          leaveColor: next.leaveColor,
          autoRoleEnabled: next.autoRoleEnabled,
          autoRoleIds: next.autoRoleIds,
          twitchRoleId: next.twitchRoleId,
          boosterRoleId: next.boosterRoleId,
          ticketEnabled: next.ticketEnabled,
          ticketCategoryId: next.ticketCategoryId,
          ticketPanelChannelId: next.ticketPanelChannelId,
          ticketPanelMessageId: next.ticketPanelMessageId,
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
          globalLogConfig: next.globalLogConfig,
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
          rulesSubtitle: next.rulesSubtitle,
          rulesMessage: next.rulesMessage,
          rulesButtonLabel: next.rulesButtonLabel,
          rulesColor: next.rulesColor,
          rulesFooterText: next.rulesFooterText,
          rulesImageFormat: next.rulesImageFormat,
          rulesImageUrl: next.rulesImageUrl,
          rulesButtons: next.rulesButtons,
          rulesCategories: next.rulesCategories,
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

    if ("dashboardUserPermissions" in input) {
      await syncDashboardUserPermissionsAcrossGuild(guildId, normalizedBotId, next.dashboardUserPermissions);
    }
  } catch (error) {
    console.error("[mongo] não foi possível persistir settings:", error);
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
    welcomeTitle: normalizeWelcomeTitle(settings.welcomeTitle) || defaults.welcomeTitle,
    welcomeSubtitle: normalizePanelText(settings.welcomeSubtitle) || defaults.welcomeSubtitle,
    welcomeMessage: normalizeWelcomeMessage(settings.welcomeMessage) || defaults.welcomeMessage,
    welcomeRulesTitle: normalizeWelcomeRulesTitle(settings.welcomeRulesTitle) || defaults.welcomeRulesTitle,
    welcomeRules: normalizeWelcomeRules(settings.welcomeRules) || defaults.welcomeRules,
    welcomeSections: normalizeMemberPanelSections(settings.welcomeSections, defaults.welcomeSections),
    welcomeChannelLabel: normalizeWelcomeChannelLabel(settings.welcomeChannelLabel) || defaults.welcomeChannelLabel,
    welcomeFooterText: normalizeWelcomeFooterText(settings.welcomeFooterText) || defaults.welcomeFooterText,
    welcomeColor: normalizeMemberPanelColor(settings.welcomeColor),
    leaveEnabled: settings.leaveEnabled ?? defaults.leaveEnabled,
    leaveChannelId: settings.leaveChannelId ?? defaults.leaveChannelId,
    leaveDisplayChannelId: settings.leaveDisplayChannelId ?? defaults.leaveDisplayChannelId,
    leaveImageUrl: normalizeWelcomeImageUrl(settings.leaveImageUrl ?? defaults.leaveImageUrl),
    leaveTitle: normalizePanelText(settings.leaveTitle) || defaults.leaveTitle,
    leaveSubtitle: normalizePanelText(settings.leaveSubtitle) || defaults.leaveSubtitle,
    leaveMessage: normalizePanelMessage(settings.leaveMessage) || defaults.leaveMessage,
    leaveRulesTitle: normalizePanelText(settings.leaveRulesTitle) || defaults.leaveRulesTitle,
    leaveRules: normalizePanelText(settings.leaveRules) || defaults.leaveRules,
    leaveSections: normalizeMemberPanelSections(settings.leaveSections, defaults.leaveSections),
    leaveChannelLabel: normalizePanelText(settings.leaveChannelLabel) || defaults.leaveChannelLabel,
    leaveFooterText: normalizePanelText(settings.leaveFooterText) || defaults.leaveFooterText,
    leaveColor: normalizeMemberPanelColor(settings.leaveColor),
    autoRoleEnabled: settings.autoRoleEnabled,
    autoRoleIds: normalizeRoleIds(settings.autoRoleIds ?? []).slice(0, MAX_AUTOMATIC_ROLES),
    twitchRoleId: settings.twitchRoleId,
    boosterRoleId: settings.boosterRoleId,
    ticketEnabled: settings.ticketEnabled,
    ticketCategoryId: settings.ticketCategoryId,
    ticketPanelChannelId: normalizeSnowflake(settings.ticketPanelChannelId),
    ticketPanelMessageId: normalizeSnowflake(settings.ticketPanelMessageId),
    ticketPanelImage: null,
    ticketPanelLogoImage: null,
    ticketPanelBannerImage: null,
    ticketPanelSecondaryBannerImage: null,
    ticketPanelFooterImage: null,
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
    globalLogConfig: normalizeGlobalLogConfig(settings.globalLogConfig, defaults.globalLogConfig),
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
    rulesSubtitle: normalizePanelText(settings.rulesSubtitle) || DEFAULT_RULES_SUBTITLE,
    rulesMessage: normalizePanelText(settings.rulesMessage) || DEFAULT_RULES_MESSAGE,
    rulesButtonLabel: normalizePanelText(settings.rulesButtonLabel) || DEFAULT_RULES_BUTTON_LABEL,
    rulesColor: normalizePanelColor(settings.rulesColor),
    rulesFooterText: normalizePanelText(settings.rulesFooterText) || DEFAULT_RULES_FOOTER_TEXT,
    rulesImageFormat: normalizeRulesImageFormat(settings.rulesImageFormat),
    rulesImageUrl: normalizeOptionalUrl(settings.rulesImageUrl),
    rulesPanelImage: null,
    rulesButtons: normalizeRulesButtons(settings.rulesButtons),
    rulesCategories: normalizeRulesCategories(settings.rulesCategories, settings.rulesMessage),
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
      ticketPanelLogoImage: null,
      ticketPanelBannerImage: null,
      ticketPanelSecondaryBannerImage: null,
      ticketPanelFooterImage: null,
      rulesPanelImage: null,
      welcomePanelImage: null
    };
  }

  try {
    const [
      welcomePanelImage,
      leavePanelImage,
      ticketPanelImage,
      ticketPanelLogoImage,
      ticketPanelBannerImage,
      ticketPanelSecondaryBannerImage,
      ticketPanelFooterImage,
      rulesPanelImage
    ] = await Promise.all([
      getPanelImageSettings(settings.guildId, settings.botId, "welcome"),
      getPanelImageSettings(settings.guildId, settings.botId, "leave"),
      getPanelImageSettings(settings.guildId, settings.botId, "ticket"),
      getPanelImageSettings(settings.guildId, settings.botId, "ticket-logo"),
      getPanelImageSettings(settings.guildId, settings.botId, "ticket-banner"),
      getPanelImageSettings(settings.guildId, settings.botId, "ticket-banner-secondary"),
      getPanelImageSettings(settings.guildId, settings.botId, "ticket-footer"),
      getPanelImageSettings(settings.guildId, settings.botId, "rules")
    ]);

    return {
      ...settings,
      leavePanelImage: leavePanelImage.imageEnabled ? leavePanelImage : null,
      ticketPanelImage: ticketPanelImage.imageEnabled ? ticketPanelImage : null,
      ticketPanelLogoImage: ticketPanelLogoImage.imageEnabled ? ticketPanelLogoImage : null,
      ticketPanelBannerImage: ticketPanelBannerImage.imageEnabled ? ticketPanelBannerImage : null,
      ticketPanelSecondaryBannerImage: ticketPanelSecondaryBannerImage.imageEnabled ? ticketPanelSecondaryBannerImage : null,
      ticketPanelFooterImage: ticketPanelFooterImage.imageEnabled ? ticketPanelFooterImage : null,
      rulesPanelImage: rulesPanelImage.imageEnabled ? rulesPanelImage : null,
      welcomePanelImage: welcomePanelImage.imageEnabled ? welcomePanelImage : null
    };
  } catch (error) {
    console.warn("[settings] não foi possível carregar imagens dos paineis:", error instanceof Error ? error.message : error);
    return {
      ...settings,
      leavePanelImage: null,
      ticketPanelImage: null,
      ticketPanelLogoImage: null,
      ticketPanelBannerImage: null,
      ticketPanelSecondaryBannerImage: null,
      ticketPanelFooterImage: null,
      rulesPanelImage: null,
      welcomePanelImage: null
    };
  }
}

async function withResolvedMemberPanelAssets(settings: GuildSettingsDto): Promise<GuildSettingsDto> {
  const [welcomeImageUrl, leaveImageUrl] = await Promise.all([
    resolveMemberPanelAssetUrl({
      botId: settings.botId,
      guildId: settings.guildId,
      mode: "welcome",
      url: settings.welcomeImageUrl
    }),
    resolveMemberPanelAssetUrl({
      botId: settings.botId,
      guildId: settings.guildId,
      mode: "leave",
      url: settings.leaveImageUrl
    })
  ]);

  const next = {
    ...settings,
    leaveImageUrl,
    welcomeImageUrl
  };

  if (welcomeImageUrl !== settings.welcomeImageUrl || leaveImageUrl !== settings.leaveImageUrl) {
    await persistResolvedMemberPanelAssets(next).catch((error) => {
      console.warn("[settings] nao foi possivel persistir assets restaurados:", error instanceof Error ? error.message : error);
    });
  }

  return next;
}

async function persistResolvedMemberPanelAssets(settings: GuildSettingsDto) {
  const { guildSettings } = await getMongoCollections();
  await guildSettings.updateOne(settingsQuery(settings.guildId, settings.botId), {
    $set: {
      leaveImageUrl: settings.leaveImageUrl,
      welcomeImageUrl: settings.welcomeImageUrl
    }
  });

  memorySettings.set(settingsKey(settings.guildId, settings.botId), settings);
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

async function getGlobalDashboardUserPermissions(guildId: string) {
  const { guildSettings } = await getMongoCollections();
  const settings = await guildSettings.find(
    {
      guildId,
      verificationEnabled: true
    },
    {
      projection: {
        dashboardUserPermissions: 1
      }
    }
  ).toArray();

  return mergeDashboardUserPermissionMaps(
    settings.map((item) => normalizeUserPermissionMap(item.dashboardUserPermissions ?? {}))
  );
}

function withGlobalDashboardUserPermissions(
  access: PersistedDashboardAccess,
  globalUserPermissions: Record<string, DashboardAccessLevel>
): PersistedDashboardAccess {
  if (!Object.keys(globalUserPermissions).length) {
    return access;
  }

  return {
    ...access,
    enabled: true,
    userPermissions: mergeDashboardUserPermissionMaps([access.userPermissions, globalUserPermissions])
  };
}

function mergeDashboardUserPermissionMaps(permissionMaps: Array<Record<string, DashboardAccessLevel>>) {
  const permissions: Record<string, DashboardAccessLevel> = {};

  for (const permissionMap of permissionMaps) {
    for (const [userId, level] of Object.entries(permissionMap)) {
      permissions[userId] = highestDashboardAccessLevel([permissions[userId], level]) ?? level;
    }
  }

  return permissions;
}

async function syncDashboardUserPermissionsAcrossGuild(
  guildId: string,
  botId: string | null,
  userPermissions: Record<string, DashboardAccessLevel>
) {
  const { guildSettings } = await getMongoCollections();
  await guildSettings.updateMany(
    { guildId },
    {
      $set: {
        dashboardUserPermissions: userPermissions,
        updatedAt: new Date()
      }
    }
  );

  for (const [key, settings] of memorySettings.entries()) {
    if (settings.guildId === guildId && key !== settingsKey(guildId, botId)) {
      memorySettings.set(key, {
        ...settings,
        dashboardUserPermissions: userPermissions
      });
    }
  }
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

function normalizeGlobalLogConfig(value: unknown, fallback: GlobalLogConfigDto = DEFAULT_GLOBAL_LOG_CONFIG): GlobalLogConfigDto {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const expirationRaw = Number(record.transcriptExpirationDays ?? fallback.transcriptExpirationDays);
  const transcriptExpirationDays = Number.isFinite(expirationRaw)
    ? Math.min(3650, Math.max(1, Math.trunc(expirationRaw)))
    : null;

  return {
    transcriptChannelId: normalizeSnowflake(String(record.transcriptChannelId ?? fallback.transcriptChannelId ?? "")),
    logViewRoleId: normalizeSnowflake(String(record.logViewRoleId ?? fallback.logViewRoleId ?? "")),
    transcriptViewRoleId: normalizeSnowflake(String(record.transcriptViewRoleId ?? fallback.transcriptViewRoleId ?? "")),
    transcriptRequired: record.transcriptRequired ?? fallback.transcriptRequired ? true : false,
    transcriptWebsiteEnabled: record.transcriptWebsiteEnabled ?? fallback.transcriptWebsiteEnabled ? true : false,
    transcriptTextEnabled: record.transcriptTextEnabled ?? fallback.transcriptTextEnabled ? true : false,
    transcriptExpirationDays,
    panelBannerUrl: normalizeUrl(record.panelBannerUrl) ?? fallback.panelBannerUrl,
    panelFooterText: normalizeNullableText(record.panelFooterText, 180) ?? fallback.panelFooterText,
    panelColor: normalizePanelColor(String(record.panelColor ?? fallback.panelColor)),
    moduleEmoji: normalizeNullableText(record.moduleEmoji, 80) ?? fallback.moduleEmoji,
    moduleName: normalizeNullableText(record.moduleName, 80),
    showAnonymousAuthorToRoleIds: normalizeSnowflakes(asArray(record.showAnonymousAuthorToRoleIds))
  };
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
  return Object.assign(new Error("Não foi possível salvar a configuração no banco de dados. Tente novamente."), {
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

function normalizeWelcomeTitle(value: string | null | undefined) {
  const normalized = normalizePanelText(value);
  return normalized === "NexTech" ? DEFAULT_WELCOME_TITLE : normalized;
}

function normalizeWelcomeMessage(value: string | null | undefined) {
  const normalized = normalizePanelMessage(value);
  return normalized === PREVIOUS_WELCOME_MESSAGE || /comunidade\s+de\s+lives/i.test(normalized)
    ? DEFAULT_WELCOME_MESSAGE
    : normalized;
}

function normalizeWelcomeRules(value: string | null | undefined) {
  const normalized = normalizePanelText(value);
  return normalized === PREVIOUS_WELCOME_RULES || /lives?|transmiss[oõ]es|streamers?|espectadores/i.test(normalized)
    ? DEFAULT_WELCOME_RULES
    : normalized;
}

function normalizeWelcomeRulesTitle(value: string | null | undefined) {
  const normalized = normalizePanelText(value);
  return /^algumas\s+dicas:?$/i.test(normalized) ? DEFAULT_WELCOME_RULES_TITLE : normalized;
}

function normalizeWelcomeChannelLabel(value: string | null | undefined) {
  const normalized = normalizePanelText(value);
  return /^acesse\s+o\s+canal:?$/i.test(normalized) ? DEFAULT_WELCOME_CHANNEL_LABEL : normalized;
}

function normalizeWelcomeFooterText(value: string | null | undefined) {
  const normalized = normalizePanelText(value);
  return normalized === PREVIOUS_WELCOME_FOOTER_TEXT || /comunidade\s+de\s+lives/i.test(normalized)
    ? DEFAULT_WELCOME_FOOTER_TEXT
    : normalized;
}

function normalizePanelColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : DEFAULT_PANEL_COLOR;
}

function normalizeMemberPanelColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : DEFAULT_MEMBER_PANEL_COLOR;
}

function normalizeTicketPanelColor(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#FFD500";
}

function normalizeMemberPanelSections(value: unknown, fallback: MemberPanelSectionDto[]): MemberPanelSectionDto[] {
  const source = Array.isArray(value) && value.length ? value : fallback;
  const seen = new Set<string>();
  const sections = source
    .map((item, index): MemberPanelSectionDto | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = normalizeNullableText(record.title, 120);
      const description = normalizeNullableText(record.description, 900);
      const fallbackId = title ? slug(title) : `secao-${index + 1}`;
      const id = normalizeNullableText(record.id, 80) ?? fallbackId;

      if (!title || !description || seen.has(id)) {
        return null;
      }

      seen.add(id);
      return {
        description,
        emoji: normalizeNullableSystemEmojiText(record.emoji),
        enabled: record.enabled !== false,
        id,
        order: clampInteger(Number(record.order ?? index + 1), 1, 1000, index + 1),
        title
      };
    })
    .filter((item): item is MemberPanelSectionDto => Boolean(item))
    .slice(0, 8)
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({
      ...section,
      order: index + 1
    }));

  return sections.length ? sections : fallback.map((section) => ({ ...section }));
}

function normalizeRulesImageFormat(value: unknown): RulesPanelImageFormat {
  return typeof value === "string" && RULES_IMAGE_FORMATS.has(value as RulesPanelImageFormat)
    ? value as RulesPanelImageFormat
    : "none";
}

function normalizeOptionalUrl(value: unknown) {
  const normalized = normalizeNullableText(value, 2048);
  return normalized && /^https?:\/\//i.test(normalized) ? normalized : null;
}

function normalizeRulesCategories(value: unknown, legacyMessage?: string | null): RulesPanelCategoryDto[] {
  const source = Array.isArray(value) && value.length ? value : rulesCategoriesFromLegacyMessage(legacyMessage);
  const seen = new Set<string>();
  const categories = source
    .map((item, index): RulesPanelCategoryDto | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = normalizeNullableText(record.name, 100);
      if (!name) return null;

      const fallbackId = slug(name) || `categoria-${index + 1}`;
      const id = normalizeNullableText(record.id, 80) ?? fallbackId;
      if (seen.has(id)) return null;
      seen.add(id);

      const rules = asArray(record.rules)
        .map((rule) => cleanRuleText(rule).slice(0, 300))
        .filter(Boolean)
        .slice(0, 40);

      if (!rules.length) return null;

      return {
        description: normalizeNullableText(record.description, 500),
        emoji: normalizeNullableSystemEmojiText(record.emoji),
        enabled: record.enabled !== false,
        id,
        name,
        order: clampInteger(Number(record.order ?? index + 1), 1, 1000, index + 1),
        rules
      };
    })
    .filter((item): item is RulesPanelCategoryDto => Boolean(item))
    .slice(0, 12)
    .sort((left, right) => left.order - right.order)
    .map((category, index) => ({
      ...category,
      order: index + 1
    }));

  return categories.length
    ? categories
    : DEFAULT_RULES_CATEGORIES.map((category) => ({ ...category, rules: [...category.rules] }));
}

function rulesCategoriesFromLegacyMessage(message?: string | null): RulesPanelCategoryDto[] {
  const rules = (message || DEFAULT_RULES_MESSAGE)
    .split(/\r?\n/)
    .map(cleanRuleText)
    .filter(Boolean)
    .slice(0, 40);

  return [
    {
      description: "Leia com atenção antes de participar.",
      emoji: "📜",
      enabled: true,
      id: "regras-gerais",
      name: "Regras gerais",
      order: 1,
      rules: rules.length ? rules : [...(DEFAULT_RULES_CATEGORIES[0]?.rules ?? ["Respeite as regras do servidor."])]
    }
  ];
}

function normalizeRulesButtons(value: unknown): RulesPanelButtonDto[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_RULES_BUTTONS;
  const seen = new Set<string>();
  const buttons = source
    .map((item, index): RulesPanelButtonDto | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const action = normalizeRulesButtonAction(record.action);
      const label = normalizeNullableText(record.label, 80) ?? (action === "accept" ? DEFAULT_RULES_BUTTON_LABEL : "Abrir");
      const fallbackId = slug(label) || `botao-${index + 1}`;
      const id = normalizeNullableText(record.id, 80) ?? fallbackId;
      if (seen.has(id)) return null;
      seen.add(id);

      return {
        action,
        command: normalizeNullableText(record.command, 120),
        emoji: normalizeNullableSystemEmojiText(record.emoji),
        enabled: record.enabled !== false,
        id,
        label,
        message: normalizeNullableText(record.message, 500),
        order: clampInteger(Number(record.order ?? index + 1), 1, 1000, index + 1),
        style: normalizeRulesButtonStyle(record.style),
        url: normalizeOptionalUrl(record.url)
      };
    })
    .filter((item): item is RulesPanelButtonDto => Boolean(item))
    .filter((button) => button.action !== "url" || Boolean(button.url))
    .slice(0, 5)
    .sort((left, right) => left.order - right.order)
    .map((button, index) => ({
      ...button,
      order: index + 1
    }));

  return buttons.length ? buttons : DEFAULT_RULES_BUTTONS.map((button) => ({ ...button }));
}

function normalizeRulesButtonAction(value: unknown): RulesPanelButtonAction {
  return typeof value === "string" && RULES_BUTTON_ACTIONS.has(value as RulesPanelButtonAction)
    ? value as RulesPanelButtonAction
    : "accept";
}

function normalizeRulesButtonStyle(value: unknown): RulesPanelButtonStyle {
  return typeof value === "string" && RULES_BUTTON_STYLES.has(value as RulesPanelButtonStyle)
    ? value as RulesPanelButtonStyle
    : "primary";
}

function cleanRuleText(value: string) {
  return value
    .replace(/^\s*(?:[-•*]|\d+[.)-])\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
        categoryId: normalizeSnowflake(String(record.categoryId ?? "")),
        description: normalizeNullableText(record.description, 100),
        emoji: normalizeNullableSystemEmojiText(record.emoji),
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
    anonymousInvestigatorName: "Equipe Corregedoria",
    anonymousReporterName: "Denunciante Anonimo",
    auditChannelId: null,
    buttonText: "Abrir denúncia",
    buttons: Object.fromEntries(REPORT_BUTTON_KEYS.map((key) => [key, true])) as Record<ReportSystemButtonKey, boolean>,
    categories: DEFAULT_REPORT_CATEGORIES.map((item) => ({ ...item })),
    categoryId: null,
    closeRoleIds: [],
    comissarioCategoryId: null,
    comissarioLogChannelId: null,
    comissarioRoleIds: [],
    competenceCommandRoleIds: [],
    conselhoCategoryId: null,
    conselhoLogChannelId: null,
    conselhoRoleIds: [],
    createRoleIds: [],
    defaultDeadline: "24 horas",
    dmBannerUrl: null,
    enabled: true,
    footerText: "Corregedoria • Sigilo institucional • Auditoria autorizada",
    finishedCategoryId: null,
    hcmdCategoryId: null,
    hcmdLogChannelId: null,
    hcmdRoleIds: [],
    iabCategoryId: null,
    iabLogChannelId: null,
    iabRoleIds: [],
    imageUrl: null,
    infoMessage: "Este sistema garante total confidencialidade aos denunciantes. Caso escolha o modo anonimo, sua identidade permanecera oculta para todos os participantes do atendimento. As denuncias serão analisadas exclusivamente pela equipe autorizada.",
    logChannelId: null,
    logs: Object.fromEntries(REPORT_LOG_KEYS.map((key) => [key, true])) as Record<ReportSystemLogKey, boolean>,
    mentionRoleIds: [],
    name: "Corregedoria",
    openMessage: "Sua denúncia foi aberta. Envie as informações, provas e aguarde a equipe autorizada.",
    panelChannelId: null,
    panelColor: "#F8C537",
    panelDescription: "Selecione o órgão competente para abrir uma denúncia ou intimação com segurança. Denúncias anônimas preservam a identidade no canal operacional; logs autorizados mantêm auditoria real.",
    panelEmoji: fixedSystemEmojiText("alerta"),
    panelPlaceholder: "Selecione o órgão competente",
    panelTitle: "Corregedoria",
    subpoenaCategoryId: null,
    subpoenaDmText: "Você recebeu uma intimacao institucional. Acesse o canal indicado e responda dentro do prazo.",
    subpoenaPanelBannerUrl: null,
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
    comissarioCategoryId: normalizeSnowflake(String(record.comissarioCategoryId ?? "")),
    comissarioLogChannelId: normalizeSnowflake(String(record.comissarioLogChannelId ?? "")),
    comissarioRoleIds: normalizeSnowflakes(asArray(record.comissarioRoleIds)),
    competenceCommandRoleIds: normalizeSnowflakes(asArray(record.competenceCommandRoleIds)),
    conselhoCategoryId: normalizeSnowflake(String(record.conselhoCategoryId ?? "")),
    conselhoLogChannelId: normalizeSnowflake(String(record.conselhoLogChannelId ?? "")),
    conselhoRoleIds: normalizeSnowflakes(asArray(record.conselhoRoleIds)),
    createRoleIds: normalizeSnowflakes(asArray(record.createRoleIds)),
    defaultDeadline: normalizeNullableText(record.defaultDeadline, 120) ?? fallback.defaultDeadline,
    dmBannerUrl: normalizeUrl(record.dmBannerUrl),
    enabled: record.enabled !== false,
    footerText: normalizeNullableText(record.footerText, 180),
    finishedCategoryId: normalizeSnowflake(String(record.finishedCategoryId ?? "")),
    hcmdCategoryId: normalizeSnowflake(String(record.hcmdCategoryId ?? "")),
    hcmdLogChannelId: normalizeSnowflake(String(record.hcmdLogChannelId ?? "")),
    hcmdRoleIds: normalizeSnowflakes(asArray(record.hcmdRoleIds)),
    iabCategoryId: normalizeSnowflake(String(record.iabCategoryId ?? "")),
    iabLogChannelId: normalizeSnowflake(String(record.iabLogChannelId ?? "")),
    iabRoleIds: normalizeSnowflakes(asArray(record.iabRoleIds)),
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
    panelEmoji: normalizeNullableSystemEmojiText(record.panelEmoji),
    panelPlaceholder: normalizeNullableText(record.panelPlaceholder, 120) ?? fallback.panelPlaceholder,
    panelTitle: normalizeNullableText(record.panelTitle, 120) ?? fallback.panelTitle,
    subpoenaCategoryId: normalizeSnowflake(String(record.subpoenaCategoryId ?? "")),
    subpoenaDmText: normalizeNullableText(record.subpoenaDmText, 1000) ?? fallback.subpoenaDmText,
    subpoenaPanelBannerUrl: normalizeUrl(record.subpoenaPanelBannerUrl),
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
      emoji: normalizeNullableSystemEmojiText(record.emoji),
      enabled: record.enabled !== false,
      escalateToCategoryId: normalizeNullableText(record.escalateToCategoryId, 80),
      id,
      judgeLabel: normalizeNullableText(record.judgeLabel, 100),
      logChannelId: normalizeSnowflake(String(record.logChannelId ?? "")),
      name,
      order: clampInteger(Number(record.order ?? index + 1), 1, 1000, index + 1),
      responsibleRoleIds: normalizeSnowflakes(asArray(record.responsibleRoleIds))
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

function normalizeNullableSystemEmojiText(value: unknown) {
  const normalized = normalizeNullableText(value, 80);
  return normalized ? normalizeFixedSystemEmojiText(normalized) : null;
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
