import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AtSign,
  BadgeCheck,
  Bell,
  Bot,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  Edit3,
  EyeOff,
  Film,
  Gift,
  Globe2,
  Hash,
  Headphones,
  ImageIcon,
  ListChecks,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Mic2,
  Music2,
  PlayCircle,
  Plus,
  SmilePlus,
  Plug,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
  TicketIcon,
  Trophy,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  XCircle
} from "lucide-react";
import { DashboardLayout } from "../components/layout/dashboard-layout";
import { DashboardHome } from "../components/dashboard/DashboardHome";
import type { ViewId } from "../components/layout/sidebar";
import { ClipsPanel } from "../components/clips/ClipsPanel";
import { CoursesPanel } from "../components/courses/CoursesPanel";
import { FacAbsencePanel } from "../components/fivem/FacAbsencePanel";
import { FivemActionsPanel } from "../components/fivem/FivemActionsPanel";
import { PolicePatrolReportsPanel } from "../components/fivem/PolicePatrolReportsPanel";
import { PoliceQruPanel } from "../components/police/PoliceQruPanel";
import { PolicePromotionsPanel } from "../components/police/PolicePromotionsPanel";
import { VehicleAbandonmentPanel } from "../components/police/VehicleAbandonmentPanel";
import { PoliceHiddenChannelPanel } from "../components/fivem/PoliceHiddenChannelPanel";
import { VisibleMessagePanel } from "../components/fivem/VisibleMessagePanel";
import { DmBarPanel } from "../components/fivem/DmBarPanel";
import { OpenDutyNotificationsPanel } from "../components/police/OpenDutyNotificationsPanel";
import { FivemFinancePanel } from "../components/fivem/FivemFinancePanel";
import { FivemOrdersManager } from "../components/fivem/FivemOrdersPanel";
import { Pd7Panel } from "../components/fivem/Pd7Panel";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../components/fivem/FivemResourceSelect";
import { ZtkWebhookPanel } from "../components/fivem/ZtkWebhookPanel";
import { GiveawayPanel } from "../components/giveaway/GiveawayPanel";
import { LogsSettingsPanel } from "../components/LogsSettingsPanel";
import { TranscriptSettingsCard } from "../components/TranscriptSettingsCard";
import { MissionToolsPanel } from "../components/mission-tools/MissionToolsPanel";
import { MediaLibraryPanel } from "../components/media/MediaLibraryPanel";
import { SiteAccessPanel } from "../components/moderation/SiteAccessPanel";
import { PanelImageSettings } from "../components/panels/PanelImageSettings";
import { ManualPaymentsPanel } from "../components/manual-payments/ManualPaymentsPanel";
import { PaymentGatewayPanel } from "../components/payments/PaymentGatewayPanel";
import { PriceTablesPanel } from "../components/price-tables/PriceTablesPanel";
import { RhAdminPanel } from "../components/rh-admin/RhAdminPanel";
import { VoiceRecorderPanel } from "../components/moderation/VoiceRecorderPanel";
import { AccountAgeSecurityPanel } from "../components/security/AccountAgeSecurityPanel";
import { AntiBanPanel } from "../components/security/AntiBanPanel";
import { SelfBotProtectionPanel } from "../components/security/SelfBotProtectionPanel";
import { AutoRolesPanel } from "../components/roles/AutoRolesPanel";
import { KickIntegrationPanel } from "../components/social/KickIntegrationPanel";

const PANEL_EMOJIS = {
  alerta: "<:alerta:1525682173246574692>",
  caixa: "<:caixa:1525682180578214021>",
  homem: "<:homem:1525682211985035416>",
  prancheta: "<:prancheta:1525682244893544489>"
} as const;
const SUPPORT_URL = "https://discord.gg/KAGgfuTcDS";
const PANEL_MEDIA_ACCEPT = "image/png,image/apng,image/jpeg,image/jpg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,video/mpeg,video/mp2t,video/x-flv,video/x-ms-wmv,video/ogg,.png,.apng,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.m4v,.mpeg,.mpg,.flv,.wmv,.ts,.mts,.3gp,.ogv,.asf,.f4v,.vob,.rmvb,.mxf";
import { LiveNotificationsPanel } from "../components/social/LiveNotificationsPanel";
import { MemberSocialNetworkPanel } from "../components/social/MemberSocialNetworkPanel";
import { XMonitorPanel } from "../components/social/XMonitorPanel";
import { WelcomePanel } from "../components/welcome/WelcomePanel";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { hierarchyPanelDraftId, isLocalHierarchyPanelId } from "../lib/fivemHierarchy";
import { createDashboardSocket } from "../lib/socket";
import {
  downloadEmojiZip,
  cloneEmojiToGuild,
  cloneSelectedEmojiCloneBotToken,
  addMessageControlUser,
  clearMessageControlUsers,
  createFivemGoalConfig,
  createManualRegistrationSubmission,
  deleteManualRegistrationSubmission,
  deleteFivemGoalConfig,
  deleteGuildChannels,
  deleteFivemHierarchyPanel,
  deleteAutoActivityClockCity,
  deleteLiveDetectionSettings,
  fetchEmojiCloneBotTokenEmojis,
  getAdvancedModuleConfig,
  getApplicationEmojiSettings,
  getApplicationEmojis,
  getAutoActivityClockDashboard,
  getClipsConfig,
  getCustomerPlansDashboard,
  getDashboardBySlug,
  getDashboardBotGuildConfig,
  getDashboardMe,
  getDashboardMaintenanceState,
  getFivemModules,
  getFivemGoals,
  getFivemHierarchy,
  getGlobalBlacklistDashboard,
  getGuildLiveOptions,
  getGuildMemberOptions,
  getGuildSettings,
  getEmojiLibrary,
  getKickNotifications,
  getLiveDetectionSettings,
  getLives,
  getLogs,
  getManualRegistrationDashboard,
  getMessageControlDashboard,
  getPoliceTimeClockDashboard,
  getSelfBotProtection,
  getServerBackupDashboard,
  getSocialNotifications,
  getTickets,
  getXMonitor,
  patchGuildSettings,
  listPanelImageSettings,
  publishReportSystemPanel,
  publishFivemGoalPanel,
  publishManualRegistrationPanel,
  publishRulesPanel,
  publishTicketPanel,
  refreshFivemHierarchyOfficialMessage,
  refreshApplicationEmojis,
  removeAllApplicationEmojis,
  removePanelImage,
  releaseDashboardBotGuildModule,
  resendEmojiFromLibrary,
  saveAdvancedModuleConfig,
  saveAutoActivityClockCity,
  saveAutoActivityClockSettings,
  saveFivemGoalSettings,
  saveFivemHierarchyPanel,
  saveGlobalBlacklistSettings,
  saveLiveDetectionSettings,
  saveManualRegistrationSettings,
  saveMessageControlSettings,
  savePoliceTimeClockSettings,
  saveServerBackupSettings,
  syncApplicationEmojis,
  updateFivemGoalConfig,
  updateSelectedDashboardGuild,
  updateApplicationEmojiSettings,
  updateBotGuildConfig,
  removeMessageControlUser,
  setMessageControlUserStatus,
  uploadPanelImage,
  createServerBackup,
  deleteServerBackup,
  previewServerBackupRestore,
  restoreServerBackup,
  runTagVerificationNow,
  validateEmojiCloneBotToken
} from "../lib/api";
import type {
  ApplicationEmojiItem,
  ApplicationEmojiPage,
  ApplicationEmojiSettings,
  AutoActivityClockDashboard,
  AuthResponse,
  BotStatus,
  BotGuildConfig,
  ClipSent,
  ClipsConfig,
  CustomerPlansDashboard,
  DashboardBot,
  DashboardGuild,
  DashboardMeGuild,
  DashboardMeResponse,
  FivemModuleDefinition,
  FivemGoalConfig,
  FivemGoalEntry,
  FivemGoalField,
  FivemGoalItem,
  FivemGoalReport,
  FivemGoalSubmission,
  FivemHierarchyPanel as FivemHierarchyPanelType,
  FivemGoalSettings,
  GlobalBlacklistEntry,
  GlobalBlacklistHistory,
  GlobalBlacklistSafeBotSettings,
  GuildChannelOption,
  GuildCategoryOption,
  GuildMemberOption,
  GuildLiveOptions,
  GuildRoleOption,
  GuildSettings,
  GuildVoiceChannelOption,
  ReportSystemCategory,
  EmojiCloneRemoteEmoji,
  EmojiLibraryItem,
  KickNotification,
  LiveDetectionSettings,
  LiveEvent,
  LogEntry,
  LogCategory,
  ManualRegistrationField,
  ManualRegistrationLog,
  ManualRegistrationSettings,
  ManualRegistrationSetRole,
  ManualRegistrationSubmission,
  MaintenanceState,
  MessageControlDashboard,
  MessageControlStatus,
  MessageControlUser,
  PanelImageSettings as PanelImageSettingsType,
  PoliceTimeClockDashboard,
  SelfBotProtectionSettings,
  ServerBackupDashboard,
  ServerBackupRestoreMode,
  ServerBackupRestoreJob,
  ServerBackupRestorePart,
  ServerBackupRestorePreview,
  ServerBackupSettings,
  ServerBackupSnapshot,
  SocialNotification,
  Ticket,
  TicketPanelOption,
  XAccount
} from "../types";

type DashboardProps = {
  auth: AuthResponse;
  initialBotSlug?: string | null;
  onLogout: () => void;
};

type BooleanSettingKey =
  | "welcomeEnabled"
  | "leaveEnabled"
  | "autoRoleEnabled"
  | "ticketEnabled"
  | "moderationEnabled"
  | "rulesEnabled";

type OverviewDetails = {
  selfBotProtectionSettings: SelfBotProtectionSettings | null;
  clipsConfig: ClipsConfig | null;
  kickClipsConfig: ClipsConfig | null;
  kickNotifications: KickNotification[];
  liveNotifications: SocialNotification[];
  xAccounts: XAccount[];
};

type ModuleDefinition = {
  id: string;
  title: string;
  description: string;
  icon: typeof Bot;
  view: ViewId;
};

type EntryLeaveMode = "welcome" | "leave";

const CONFIGURED_GUILD_ID = "";
const CONFIGURED_GUILD_NAME = "Servidor configurado";
const LAST_BOT_STORAGE_KEY = "dashboard.last_selected_bot_id";

const initialBotStatus: BotStatus = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  botGuilds: [],
  updatedAt: new Date().toISOString()
};

const emptyOverviewDetails: OverviewDetails = {
  selfBotProtectionSettings: null,
  clipsConfig: null,
  kickClipsConfig: null,
  kickNotifications: [],
  liveNotifications: [],
  xAccounts: []
};
const emptyPanelBots: DashboardBot[] = [];
const emptyEnabledModules: string[] = [];

const moduleCatalog: ModuleDefinition[] = [
  {
    id: "live",
    title: "Sistema Detecta Lives",
    description: "Detecta transmissões pelo status do Discord e aplica cargo automaticamente.",
    icon: Radio,
    view: "lives"
  },
  {
    id: "kick-integration",
    title: "Kick Integration",
    description: "Detecta transmissoes na Kick e envia alertas no Discord.",
    icon: Plug,
    view: "lives"
  },
  {
    id: "clips",
    title: "Clips",
    description: "Detecta clips criados na Twitch e envia automaticamente no Discord.",
    icon: Film,
    view: "clips"
  },
  {
    id: "kick-clips",
    title: "Clipes Kick",
    description: "Monitora lives da Kick, ranking e recompensas por clipes.",
    icon: Film,
    view: "kick-clips"
  },
  {
    id: "giveaway",
    title: "Sorteio",
    description: "Cria roleta web para sortear apenas subs da live cadastrada.",
    icon: Gift,
    view: "giveaway"
  },
  {
    id: "x-monitor",
    title: "X Monitor",
    description: "Monitora perfis do X e publica novos posts no Discord.",
    icon: AtSign,
    view: "x-monitor"
  },
  {
    id: "moderation",
    title: "Moderação",
    description: "Centraliza ajustes básicos de segurança e moderação do servidor.",
    icon: Shield,
    view: "moderation"
  },
  {
    id: "rules",
    title: "Regras",
    description: "Publica um painel de regras com botão para liberar cargo aos membros.",
    icon: ScrollText,
    view: "rules"
  },
  {
    id: "payment-gateway",
    title: "Pagamento Automático",
    description: "Configura Mercado Pago do dono do bot para checkout e confirmação automática.",
    icon: CreditCard,
    view: "payment-gateway"
  },
  {
    id: "manual-payments",
    title: "Pagamento Manual",
    description: "Gerencia Pix manual, comprovantes, aprovação e atendimento por canais.",
    icon: CreditCard,
    view: "manual-payments"
  },
  {
    id: "price-tables",
    title: "Tabela de Precos",
    description: "Cria tabelas de preços com itens, valores, preview e publicação no Discord.",
    icon: TableProperties,
    view: "price-tables"
  },
  {
    id: "mission-tools",
    title: "Mission Tools",
    description: "Enable the Control Center with Mission, Clean, Voice, Rich Presence, and Username Checker.",
    icon: ListChecks,
    view: "mission-tools"
  },
  {
    id: "voice-recorder",
    title: "Voice Recorder",
    description: "Grava canais de voz, salva arquivos MP3 e organiza histórico na dashboard.",
    icon: Mic2,
    view: "voice-recorder"
  },
  {
    id: "emoji-cloner",
    title: "Clonagem de Emojis",
    description: "Sincroniza emojis para a aplicação do bot e clona emojis de servidores acessíveis.",
    icon: SmilePlus,
    view: "server-cloner"
  },
  {
    id: "server-cloner",
    title: "Clonagem de Servidor",
    description: "Clona somente a estrutura autorizada entre servidores onde o bot e o administrador estao presentes.",
    icon: Server,
    view: "server-cloner"
  },
  {
    id: "server-generator",
    title: "Gerador de Servidores",
    description: "Libera o comando /criar-server para criar estruturas inteligentes direto pelo bot.",
    icon: Server,
    view: "settings"
  },
  {
    id: "safe-bot",
    title: "SelfBot Protection",
    description: "Centraliza proteção anti-spam, punicoes e logs do SelfBot.",
    icon: ShieldCheck,
    view: "self-bot-protection"
  },
  {
    id: "account-age-security",
    title: "Segurança de Entrada",
    description: "Remove contas Discord mais novas que o mínimo permitido.",
    icon: ShieldAlert,
    view: "security"
  },
  {
    id: "anti-ban",
    title: "Sistema Anti Ban",
    description: "Protege cargos e usuários contra ban, kick, timeout e remoção de cargos.",
    icon: ShieldCheck,
    view: "anti-ban"
  },
  {
    id: "anti-abuse",
    title: "DEV Control Panel",
    description: "Controle central Anti Abuse para mute, deafen, move, disconnect e auto-correcao de call.",
    icon: ShieldAlert,
    view: "anti-abuse"
  },
  {
    id: "suspicious-servers",
    title: "Servidores Suspeitos",
    description: "Monitora entradas e identifica membros ligados a servidores suspeitos.",
    icon: Search,
    view: "suspicious-servers"
  },
  {
    id: "global-blacklist",
    title: "Blacklist Global",
    description: "Bloqueia usuários cadastrados por ID, usuário e motivo.",
    icon: LockKeyhole,
    view: "global-blacklist"
  },
  {
    id: "advanced-permissions",
    title: "Gerenciamento de Permissões",
    description: "Define permissões avançadas por cargo para ações sensíveis.",
    icon: SlidersHorizontal,
    view: "advanced-permissions"
  },
  {
    id: "invite-cleanup",
    title: "Limpeza de Convites",
    description: "Remove convites automaticamente com excecoes configuraveis.",
    icon: Trash2,
    view: "invite-cleanup"
  },
  {
    id: "server-backup",
    title: "Backup Completo",
    description: "Prepara backup manual, automático, exportacao e restauração seletiva.",
    icon: Server,
    view: "server-backup"
  },
  {
    id: "vanity-url-protection",
    title: "Proteção da URL Personalizada",
    description: "Monitora alterações da URL personalizada e prepara restauração automática.",
    icon: Globe2,
    view: "vanity-url-protection"
  },
  {
    id: "hide-empty-voice",
    title: "Esconder Chamadas Vazias",
    description: "Oculta canais de voz vazios e reexibe quando alguem entra.",
    icon: Mic2,
    view: "hide-empty-voice"
  },
  {
    id: "anti-disconnect",
    title: "Anti Disconnect",
    description: "Reconecta automaticamente membros removidos de calls por usuários sem autorizacao.",
    icon: ShieldAlert,
    view: "anti-disconnect"
  },
  {
    id: "auto-unmute",
    title: "Auto Desmutar",
    description: "Remove automaticamente o mute manual de usuários ao entrarem no canal de voz configurado.",
    icon: Mic2,
    view: "auto-unmute"
  },
  {
    id: "temporary-voice",
    title: "Chamadas Temporárias",
    description: "Cria salas temporárias com dono, limite, bloqueio e exclusão automática.",
    icon: Users,
    view: "temporary-voice"
  },
  {
    id: "tag-verification",
    title: "Verificação de Tag",
    description: "Entrega ou remove cargo conforme tag personalizada do Discord.",
    icon: Hash,
    view: "tag-verification"
  },
  {
    id: "bio-url-verification",
    title: "Verificação de URL na Bio",
    description: "Entrega ou remove cargo conforme URL permitida na bio do membro.",
    icon: AtSign,
    view: "bio-url-verification"
  },
  {
    id: "first-lady",
    title: "Sistema Primeira Dama",
    description: "Gerencia damas, limites por cargo, histórico e relacionamentos.",
    icon: Users,
    view: "first-lady"
  },
  {
    id: "fivem-absences",
    title: "Ausência",
    description: "Sistema isolado para solicitações, análise, cargo temporário e histórico de ausência.",
    icon: CalendarClock,
    view: "fivem-absence"
  },
  {
    id: "police-absences",
    title: "Ausência Policial",
    description: "Solicitacoes, analise, cargo temporário e histórico de ausência para oficiais.",
    icon: CalendarClock,
    view: "police-absence"
  },
  {
    id: "fivem-hierarchy",
    title: "Paineis de Hierarquia V2",
    description: "Mensagens oficiais de hierarquia V2 sincronizadas pelos cargos do servidor.",
    icon: Users,
    view: "fivem-hierarchy"
  },
  {
    id: "police-actions",
    title: "Ações Políciais",
    description: "Operações policiais com painel, participantes e relatórios separados.",
    icon: ShieldCheck,
    view: "police-actions"
  },
  {
    id: "police-patrol-reports",
    title: "Relatórios Políciais",
    description: "Relatórios de patrulhamento exclusivos para oficiais.",
    icon: ScrollText,
    view: "police-patrol-reports"
  },
  {
    id: "police-qru",
    title: "Registro de QRU",
    description: "Ocorrências com oficiais envolvidos, evidências e ranking automático.",
    icon: ShieldCheck,
    view: "police-qru"
  },
  {
    id: "police-promotions",
    title: "Promoções de Patente",
    description: "Solicitações com avaliação de instrutor, aprovação, cargos automáticos e histórico.",
    icon: BadgeCheck,
    view: "police-promotions"
  },
  {
    id: "vehicle-abandonment",
    title: "Abandono de Veículo",
    description: "Registra veículos abandonados por imagem com parser automático.",
    icon: Car,
    view: "vehicle-abandonment"
  },
  {
    id: "police-hidden-channel",
    title: "Canal Oculto",
    description: "Canal anonimo policial com retransmissao pelo bot e logs administrativos.",
    icon: EyeOff,
    view: "police-hidden-channel"
  },
  {
    id: "visible-message",
    title: "Mensagem Visível",
    description: "Usuários autorizados enviam mensagens com nome e avatar próprios via webhook.",
    icon: MessageCircle,
    view: "visible-message"
  },
  {
    id: "message-control",
    title: "Controle de Mensagem",
    description: "Controle individual para alternar mensagens entre modo oculto e pessoal.",
    icon: MessageCircle,
    view: "message-control"
  },
  {
    id: "police-dm",
    title: "Barra DM",
    description: "Envio de mensagens privadas com painel visual, permissões e logs.",
    icon: UserPlus,
    view: "police-dm"
  },
  {
    id: "police-open-duty",
    title: "Notificar / Ponto Aberto",
    description: "Notificações policiais por DM, canal mencionado, contador de avisos verbais e alertas administrativos.",
    icon: Bell,
    view: "police-open-duty"
  },
  {
    id: "police-time-clock",
    title: "Relógio de Ponto",
    description: "Controle de entrada, saída, histórico e relatórios de serviço policial.",
    icon: Clock3,
    view: "police-time-clock"
  },
  {
    id: "police-daf-roster",
    title: "Escala DAF",
    description: "Sistema de escala DAF por bot, com painel e cargos operados no Discord.",
    icon: CalendarClock,
    view: "police-daf-roster"
  },
  {
    id: "auto-activity-clock",
    title: "Ponto Automático",
    description: "Abre e fecha ponto automaticamente por atividade do Discord em cidades RP.",
    icon: Activity,
    view: "auto-activity-clock"
  },
  {
    id: "courses",
    title: "Cursos",
    description: "Cursos, instrutores, agendamentos, publicações e relatórios de instrução.",
    icon: BookOpen,
    view: "courses"
  },
  {
    id: "rh-admin",
    title: "RH Administrativo",
    description: "Solicitações de ausência, adornos, análise de RH, cargos temporários e logs policiais.",
    icon: ShieldCheck,
    view: "rh-admin"
  },
  {
    id: "police-iab",
    title: "Denuncias Corregedoria",
    description: "Painel IAB com denuncias anonimas, órgãos, logs e auditoria policial.",
    icon: ShieldAlert,
    view: "police-iab"
  },
  {
    id: "police-subpoenas",
    title: "Intimacao",
    description: "Configura intimações institucionais, competência dos órgãos, prazos, DMs e canais sigilosos.",
    icon: ScrollText,
    view: "police-subpoenas"
  },
  {
    id: "fivem-orders",
    title: "Encomendas FiveM",
    description: "Controle separado para pedidos, fila, produção, entrega e histórico de encomendas.",
    icon: Boxes,
    view: "fivem-orders"
  },
  {
    id: "fivem-washing",
    title: "Sistema de Lavagem",
    description: "Lavagem RP isolada com regras de porcentagem, cálculo automático, logs e histórico.",
    icon: CircleDollarSign,
    view: "fivem-washing"
  },
  {
    id: "fivem-drugs",
    title: "Sistema de Drogas",
    description: "Controle isolado de drogas, pedidos, produção, entrega, logs e histórico por servidor.",
    icon: Boxes,
    view: "fivem-drug"
  },
  {
    id: "fivem-goals",
    title: "Metas FiveM",
    description: "Controle separado de metas por membro, canais individuais, fotos e registros via Components V2.",
    icon: ListChecks,
    view: "fivem-goals"
  },
  {
    id: "ztk-webhook",
    title: "ZTK Webhook 🏆",
    description: "Webhooks FiveM por clã, ranking automático, tempo online e premiações.",
    icon: Trophy,
    view: "ztk-webhook"
  },
  {
    id: "fivem-captcha",
    title: "CAPTCHA FiveM",
    description: "Verificação inteligente integrada ao FiveM, isolada por bot, servidor e configuração.",
    icon: ShieldCheck,
    view: "fivem-captcha"
  },
  {
    id: "verification",
    title: "Usuários",
    description: "Define quais usuários podem entrar e configurar este painel.",
    icon: Users,
    view: "permissions"
  },
  {
    id: "logs",
    title: "Logs",
    description: "Mostra acontecimentos importantes do bot no servidor.",
    icon: ScrollText,
    view: "logs"
  },
  {
    id: "welcome",
    title: "Boas-vindas",
    description: "Envia mensagem e imagem quando um membro entra no servidor.",
    icon: UserPlus,
    view: "entry-leave"
  },
  {
    id: "leave",
    title: "Saída",
    description: "Envia mensagem quando um membro sai do servidor.",
    icon: UserMinus,
    view: "entry-leave"
  },
  {
    id: "roles",
    title: "Cargos automaticos",
    description: "Aplica cargos configurados para novos membros.",
    icon: Users,
    view: "auto-roles"
  },
  {
    id: "tickets",
    title: "Tickets",
    description: "Organiza atendimento em canais de suporte.",
    icon: TicketIcon,
    view: "settings"
  },
  {
    id: "network",
    title: "Rede Social dos Membros",
    description: "Centraliza links sociais dos membros em um painel publicado no Discord.",
    icon: Globe2,
    view: "settings"
  },
  {
    id: "avisos",
    title: "Configurações",
    description: "Mantem mensagens e ajustes simples do servidor.",
    icon: Settings,
    view: "settings"
  }
];

const viewModuleIds: Partial<Record<ViewId, string>> = {
  permissions: "verification",
  clips: "clips",
  "kick-clips": "kick-clips",
  giveaway: "giveaway",
  "x-monitor": "x-monitor",
  "mission-tools": "mission-tools",
  logs: "logs",
  fivem: "fivem",
  "fivem-absence": "fivem-absences",
  "fivem-hierarchy": "fivem-hierarchy",
  "fivem-actions": "fivem-actions",
  "police-absence": "police-absences",
  "police-actions": "police-actions",
  "police-patrol-reports": "police-patrol-reports",
  "police-qru": "police-qru",
  "police-promotions": "police-promotions",
  "vehicle-abandonment": "vehicle-abandonment",
  "police-hidden-channel": "police-hidden-channel",
  "visible-message": "visible-message",
  "message-control": "message-control",
  "police-dm": "police-dm",
  "police-open-duty": "police-open-duty",
  "police-time-clock": "police-time-clock",
  "police-daf-roster": "police-daf-roster",
  "auto-activity-clock": "auto-activity-clock",
  "police-subpoenas": "police-subpoenas",
  "rh-admin": "rh-admin",
  "police-iab": "police-iab",
  "fivem-orders": "fivem-orders",
  "fivem-families": "fivem-orders",
  "fivem-washing": "fivem-washing",
  "fivem-ammo": "fivem-orders",
  "fivem-drug": "fivem-drugs",
  "fivem-weapon": "fivem-orders",
  "fivem-custom": "fivem-orders",
  "fivem-finance": "fivem-finance",
  "fivem-goals": "fivem-goals",
  "fivem-captcha": "fivem-captcha",
  "ztk-webhook": "ztk-webhook",
  "manual-registration": "manual-registration",
  "voice-recorder": "voice-recorder",
  music: "music",
  "self-bot-protection": "safe-bot",
  security: "account-age-security",
  "anti-abuse": "anti-abuse",
  "anti-ban": "anti-ban",
  "suspicious-servers": "suspicious-servers",
  "global-blacklist": "global-blacklist",
  "advanced-permissions": "advanced-permissions",
  "invite-cleanup": "invite-cleanup",
  "server-backup": "server-backup",
  "vanity-url-protection": "vanity-url-protection",
  "hide-empty-voice": "hide-empty-voice",
  "anti-disconnect": "anti-disconnect",
  "auto-unmute": "auto-unmute",
  "temporary-voice": "temporary-voice",
  "tag-verification": "tag-verification",
  "bio-url-verification": "bio-url-verification",
  "first-lady": "first-lady",
  moderation: "moderation",
  rules: "rules",
  "payment-gateway": "payment-gateway",
  "manual-payments": "manual-payments",
  "price-tables": "price-tables",
  courses: "courses",
  "application-emojis": "emoji-cloner",
  "media-library": "emoji-cloner"
};

const settingsModuleIds = new Set(["tickets", "avisos", "network", "server-generator"]);
const policeTranscriptViews = new Set<ViewId>([
  "police-absence",
  "police-actions",
  "police-patrol-reports",
  "police-qru",
  "police-promotions",
  "police-hidden-channel",
  "visible-message",
  "police-dm",
  "police-open-duty",
  "rh-admin",
  "police-iab",
  "police-subpoenas"
]);
const moduleReleaseAliases: Record<string, string[]> = {
  courses: ["police-courses"],
  "police-courses": ["courses"],
  "rh-admin": ["police-hr"],
  "police-hr": ["rh-admin"]
};
function moduleReleaseIds(moduleId: string) {
  return [moduleId, ...(moduleReleaseAliases[moduleId] ?? [])];
}

function hasReleasedModule(enabledModules: string[], moduleId: string) {
  return moduleReleaseIds(moduleId).some((candidate) => enabledModules.includes(candidate));
}

function filterServerReleasedModules(enabledModules: string[], _config: BotGuildConfig | null) {
  return enabledModules;
}

export function Dashboard({ auth, initialBotSlug = null, onLogout }: DashboardProps) {
  const [dashboardProfile, setDashboardProfile] = useState<DashboardMeResponse | null>(null);
  const [dashboardProfileLoading, setDashboardProfileLoading] = useState(true);
  const [dashboardRouteError, setDashboardRouteError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(() => dashboardViewFromPath(window.location.pathname));
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    auth.user.selectedGuildId ?? auth.guilds[0]?.id ?? CONFIGURED_GUILD_ID
  );
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lives, setLives] = useState<LiveEvent[]>([]);
  const [liveDetectionRefresh, setLiveDetectionRefresh] = useState(0);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [clipsRefreshSignal, setClipsRefreshSignal] = useState(0);
  const [botStatus, setBotStatus] = useState<BotStatus>(initialBotStatus);
  const [customerPlans, setCustomerPlans] = useState<CustomerPlansDashboard | null>(null);
  const [maintenanceState, setMaintenanceState] = useState<MaintenanceState | null>(null);
  const [savingKey, setSavingKey] = useState<BooleanSettingKey | null>(null);
  const [overviewDetails, setOverviewDetails] = useState<OverviewDetails>(emptyOverviewDetails);
  const [fivemModules, setFivemModules] = useState<FivemModuleDefinition[]>([]);
  const [botGuildConfig, setBotGuildConfig] = useState<BotGuildConfig | null>(null);
  const [releasingServerModuleId, setReleasingServerModuleId] = useState<string | null>(null);

  const panelBots = dashboardProfile?.bots ?? emptyPanelBots;
  const dashboardProfileGuilds = dashboardProfile?.guilds ?? null;
  const dashboardGuilds = useMemo(
    () => ensureDashboardGuilds(dashboardProfileGuilds ? mergeDashboardGuilds(dashboardProfileGuilds, auth.guilds) : auth.guilds),
    [auth.guilds, dashboardProfileGuilds]
  );
  const selectedBot = useMemo(
    () => panelBots.find((bot) => bot.id === selectedBotId) ?? null,
    [panelBots, selectedBotId]
  );
  const activeBotId = selectedBot?.id ?? null;
  const releasedEnabledModules = selectedBot?.enabledModules ?? emptyEnabledModules;
  const releasedEnabledModulesKey = releasedEnabledModules.join("|");
  const enabledModules = useMemo(
    () => filterServerReleasedModules(releasedEnabledModules, botGuildConfig),
    [botGuildConfig, releasedEnabledModulesKey]
  );
  const enabledModulesKey = enabledModules.join("|");
  const logsModuleEnabled = hasReleasedModule(enabledModules, "logs");
  const ticketsModuleEnabled = hasReleasedModule(enabledModules, "tickets");
  const scopedDashboardGuilds = useMemo(
    () => selectedBot
      ? dashboardGuilds.filter((guild) => selectedBot.guildIds.includes(guild.id))
      : dashboardGuilds,
    [dashboardGuilds, selectedBot]
  );
  const selectedGuild = useMemo(
    () => scopedDashboardGuilds.find((guild) => guild.id === selectedGuildId) ?? scopedDashboardGuilds[0] ?? null,
    [scopedDashboardGuilds, selectedGuildId]
  );
  const displayedBotStatus = selectedBot
    ? {
        ...botStatus,
        botId: selectedBot.id,
        online: selectedBot.status === "online" || botStatus.online
      }
    : botStatus;
  const canManageDashboard = panelBots.length
    ? Boolean(selectedBot && (selectedBot.permissions.canManageDashboard || selectedBot.permissions.canManageOwnServices))
    : auth.permissions.canManageDashboard;
  const canManageOwnerDevSettings = selectedBot
    ? auth.permissions.canManageBots || selectedBot.ownerId === auth.user.discordId || selectedBot.createdBy === auth.user.discordId
    : auth.permissions.canManageBots || auth.permissions.canManageDashboard;
  const canManageOwnerDevModule = (moduleId: string) => canManageOwnerDevSettings && (
    selectedBot ? hasReleasedModule(selectedBot.enabledModules, moduleId) : canManageDashboard
  );
  const canReleaseServerModule = (moduleId: string) => canManageModule(selectedBot, moduleId, canManageDashboard);
  const isServerModuleReleased = (moduleId: string) => botGuildConfig?.modules?.[moduleId]?.enabled !== false;
  const availableModules = useMemo(
    () => moduleCatalog.filter((module) => hasReleasedModule(enabledModules, module.id)),
    [enabledModulesKey]
  );
  const selectedBotPlanNotice = useMemo(
    () => buildSelectedBotPlanNotice(customerPlans, selectedBot),
    [customerPlans, selectedBot?.id]
  );

  useEffect(() => {
    let mounted = true;
    const requestedSlug = initialBotSlug?.trim() || null;

    setDashboardProfileLoading(true);
    setDashboardRouteError(null);

    async function loadDashboardProfile() {
      const profile = requestedSlug
        ? await getDashboardBySlug(requestedSlug)
        : await getDashboardMe();

      if (!mounted) return;

      setDashboardProfile(profile);
      const storedBotId = readStoredBotId();
      const targetBot = profile.bots.find((bot) => bot.slug === requestedSlug)
        ?? profile.bots.find((bot) => bot.id === storedBotId)
        ?? profile.bots[0]
        ?? null;

      if (!targetBot) {
        setDashboardRouteError("Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte.");
        return;
      }

      if (!requestedSlug) {
        window.history.replaceState({}, "", dashboardPathForView(targetBot.slug, activeView));
      }

      setSelectedBotId(targetBot?.id ?? null);
      storeSelectedBotId(targetBot?.id ?? null);

      const nextGuildId = targetBot
        ? (targetBot.guildIds.includes(profile.selectedGuildId ?? "") ? profile.selectedGuildId : targetBot.guildIds[0])
        : profile.selectedGuildId ?? profile.guilds[0]?.id ?? null;

      if (nextGuildId) {
        setSelectedGuildId(nextGuildId);
      }
    }

    loadDashboardProfile()
      .catch((error) => {
        if (!mounted) return;

        setDashboardRouteError(readResponseMessage(error) ?? (
          readResponseStatus(error) === 401
            ? "Sua sessão não chegou ao backend. Saia e entre novamente pelo Discord."
            : "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte."
        ));
      })
      .finally(() => {
        if (mounted) {
          setDashboardProfileLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [initialBotSlug]);

  useEffect(() => {
    let mounted = true;

    getDashboardMaintenanceState()
      .then((maintenance) => {
        if (mounted) setMaintenanceState(maintenance);
      })
      .catch(() => {
        if (mounted) setMaintenanceState(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (dashboardProfileLoading || dashboardRouteError) {
      return;
    }

    let mounted = true;

    getCustomerPlansDashboard()
      .then((plansDashboard) => {
        if (mounted) setCustomerPlans(plansDashboard);
      })
      .catch(() => {
        if (mounted) setCustomerPlans(null);
      });

    return () => {
      mounted = false;
    };
  }, [dashboardProfileLoading, dashboardRouteError, selectedBot?.id]);

  useEffect(() => {
    setBotGuildConfig(null);

    if (!activeBotId || !selectedGuildId) {
      return;
    }

    let mounted = true;

    getDashboardBotGuildConfig(activeBotId, selectedGuildId)
      .then((config) => {
        if (mounted) setBotGuildConfig(config);
      })
      .catch(() => {
        if (mounted) setBotGuildConfig(null);
      });

    return () => {
      mounted = false;
    };
  }, [activeBotId, selectedGuildId]);

  useEffect(() => {
    if (dashboardProfileLoading || !selectedBot) return;
    if (!isViewAllowed(activeView, enabledModules)) {
      setActiveView("overview");
    }
  }, [activeView, dashboardProfileLoading, enabledModulesKey, selectedBot?.id]);

  useEffect(() => {
    if (!enabledModules.some((moduleId) => moduleId === "fivem" || moduleId.startsWith("fivem-"))) {
      setFivemModules([]);
      return;
    }

    let mounted = true;

    getFivemModules()
      .then((modules) => {
        if (mounted) setFivemModules(modules);
      })
      .catch(() => {
        if (mounted) setFivemModules([]);
      });

    return () => {
      mounted = false;
    };
  }, [enabledModulesKey]);

  useEffect(() => {
    const selectedGuildIsAvailable = selectedGuildId
      ? scopedDashboardGuilds.some((guild) => guild.id === selectedGuildId)
      : false;

    if (!selectedGuildIsAvailable && scopedDashboardGuilds[0]?.id) {
      setSelectedGuildId(scopedDashboardGuilds[0].id);
    }
  }, [scopedDashboardGuilds, selectedGuildId]);

  useEffect(() => {
    if (dashboardProfileLoading || dashboardRouteError) {
      return;
    }

    if (panelBots.length && !activeBotId) {
      setSettings(null);
      setLogs([]);
      setLives([]);
      setTickets([]);
      setOverviewDetails(emptyOverviewDetails);
      return;
    }

    if (!selectedGuildId) {
      setSettings(null);
      setOverviewDetails(emptyOverviewDetails);
      return;
    }

    if (maintenanceState?.active) {
      setSettings(null);
      setLogs([]);
      setLives([]);
      setTickets([]);
      setOverviewDetails(emptyOverviewDetails);
      setSettingsLoading(false);
      return;
    }

    let mounted = true;

    setSettingsLoading(true);
    setSettings(null);

    Promise.allSettled([
      getGuildSettings(selectedGuildId, activeBotId),
      activeBotId && logsModuleEnabled ? getLogs(selectedGuildId, activeBotId) : Promise.resolve([]),
      getLives(selectedGuildId, activeBotId),
      activeBotId && ticketsModuleEnabled ? getTickets(selectedGuildId, activeBotId) : Promise.resolve([]),
      enabledModules.includes("live") ? getSocialNotifications(selectedGuildId, activeBotId) : Promise.resolve(null),
      liveModulesEnabled(enabledModules) ? getKickNotifications(selectedGuildId, activeBotId) : Promise.resolve(null),
      enabledModules.includes("clips") ? getClipsConfig(selectedGuildId, activeBotId, "twitch") : Promise.resolve(null),
      enabledModules.includes("kick-clips") ? getClipsConfig(selectedGuildId, activeBotId, "kick") : Promise.resolve(null),
      enabledModules.includes("x-monitor") ? getXMonitor(selectedGuildId, activeBotId) : Promise.resolve(null),
      enabledModules.includes("safe-bot") && activeBotId
        ? getSelfBotProtection(selectedGuildId, activeBotId)
        : Promise.resolve(null)
    ])
      .then(([settingsResult, logsResult, livesResult, ticketsResult, liveResult, kickResult, clipsResult, kickClipsResult, xResult, selfBotResult]) => {
        if (!mounted) return;

        setSettings(settingsResult.status === "fulfilled" ? settingsResult.value : null);
        setLogs(logsResult.status === "fulfilled" ? userVisibleLogs(logsResult.value) : []);
        setLives(livesResult.status === "fulfilled" ? livesResult.value : []);
        setTickets(ticketsResult.status === "fulfilled" ? ticketsResult.value : []);
        setOverviewDetails({
          selfBotProtectionSettings: selfBotResult.status === "fulfilled" && selfBotResult.value
            ? selfBotResult.value.settings
            : null,
          kickClipsConfig: kickClipsResult.status === "fulfilled" ? kickClipsResult.value : null,
          liveNotifications: liveResult.status === "fulfilled" && liveResult.value ? liveResult.value.notifications : [],
          kickNotifications: kickResult.status === "fulfilled" && kickResult.value ? kickResult.value.notifications : [],
          clipsConfig: clipsResult.status === "fulfilled" ? clipsResult.value : null,
          xAccounts: xResult.status === "fulfilled" && xResult.value ? xResult.value.accounts : []
        });
      })
      .finally(() => {
        if (mounted) {
          setSettingsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [activeBotId, dashboardProfileLoading, dashboardRouteError, enabledModulesKey, logsModuleEnabled, maintenanceState?.active, panelBots.length, selectedGuildId, ticketsModuleEnabled]);

  useEffect(() => {
    const socket = createDashboardSocket();

    if (selectedGuildId && activeBotId && logsModuleEnabled) {
      socket.emit("logs:subscribe", {
        botId: activeBotId,
        guildId: selectedGuildId
      });
    }

    socket.on("bot:status", (status: BotStatus) => {
      if ((status.botId ?? null) === activeBotId) {
        setBotStatus(status);
      }
    });
    socket.on("dev:bot_updated", (updatedBot: DashboardBot) => {
      setDashboardProfile((current) => current ? {
        ...current,
        bots: current.bots.map((bot) => bot.id === updatedBot.id ? updatedBot : bot)
      } : current);
    });
    socket.on("maintenance:updated", (payload: { state?: MaintenanceState }) => {
      if (payload.state) {
        setMaintenanceState(payload.state);
      }
    });
    socket.on("logs:new", (log: LogEntry) => {
      if (
        log.guildId === selectedGuildId
        && (log.botId ?? null) === activeBotId
        && isUserVisibleLog(log)
        && isSiteLogEnabled(log, settings)
      ) {
        setLogs((current) => prependUniqueLog(current, log));
      }
    });
    socket.on("live:started", (event: LiveEvent) => {
      if (event.guildId === selectedGuildId && (event.botId ?? null) === activeBotId) {
        setLives((current) => [event, ...current].slice(0, 50));
      }
    });
    socket.on("live:ended", (event: LiveEvent) => {
      if (event.guildId === selectedGuildId && (event.botId ?? null) === activeBotId) {
        setLives((current) => [event, ...current].slice(0, 50));
      }
    });
    socket.on("live-detection:settings_updated", (event: LiveDetectionSettings) => {
      if (event.guildId === selectedGuildId && (event.botId ?? null) === activeBotId) {
        setLiveDetectionRefresh((current) => current + 1);
      }
    });
    socket.on("tickets:new", (ticket: Ticket) => {
      if (ticket.guildId === selectedGuildId && (ticket.botId ?? null) === activeBotId) {
        setTickets((current) => [ticket, ...current].slice(0, 50));
      }
    });
    socket.on("clips:new", (clip: ClipSent) => {
      if (clip.guildId === selectedGuildId && (clip.botId ?? null) === activeBotId) {
        setClipsRefreshSignal((current) => current + 1);
      }
    });
    socket.on("settings:updated", (nextSettings: GuildSettings) => {
      if (nextSettings.guildId === selectedGuildId && (nextSettings.botId ?? null) === activeBotId) {
        setSettings(nextSettings);
        if (selectedGuildId && activeBotId && logsModuleEnabled) {
          void getLogs(selectedGuildId, activeBotId)
            .then((nextLogs) => setLogs(userVisibleLogs(nextLogs)))
            .catch(() => undefined);
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [
    activeBotId,
    logsModuleEnabled,
    selectedGuildId,
    settings?.siteLogsEnabled,
    settings?.siteLogCategories.join("|")
  ]);

  async function handleLogsSettingsChange(nextSettings: GuildSettings) {
    setSettings(nextSettings);

    if (!selectedGuildId || !activeBotId || !logsModuleEnabled) {
      setLogs([]);
      return;
    }

    const nextLogs = await getLogs(selectedGuildId, activeBotId).catch(() => []);
    setLogs(userVisibleLogs(nextLogs));
  }

  async function updateSetting(key: BooleanSettingKey, checked: boolean) {
    if (!settings || !selectedGuildId || !canManageDashboard) {
      return;
    }

    const previous = settings;
    const next = {
      ...settings,
      [key]: checked
    };

    setSavingKey(key);
    setSettings(next);

    try {
      const saved = await patchGuildSettings(selectedGuildId, { [key]: checked }, activeBotId);
      setSettings(saved);
    } catch {
      setSettings(previous);
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSelectGuild(guildId: string) {
    const previousGuildId = selectedGuildId;

    setSelectedGuildId(guildId);
    setDashboardProfile((current) => (current ? { ...current, selectedGuildId: guildId } : current));

    try {
      await updateSelectedDashboardGuild(guildId, activeBotId);
    } catch {
      setSelectedGuildId(previousGuildId);
      setDashboardProfile((current) => (current ? { ...current, selectedGuildId: previousGuildId } : current));
    }
  }

  async function handleReleaseServerModule(moduleId: string) {
    if (!activeBotId || !selectedGuild) return;

    setReleasingServerModuleId(moduleId);
    try {
      const config = await releaseDashboardBotGuildModule(activeBotId, selectedGuild.id, moduleId, selectedGuild.name);
      setBotGuildConfig(config);
    } finally {
      setReleasingServerModuleId(null);
    }
  }

  function handleSelectBot(botId: string) {
    const nextBot = panelBots.find((bot) => bot.id === botId);

    if (!nextBot) {
      return;
    }

    const nextGuildId = nextBot.mainGuildId || nextBot.guildIds[0] || null;

    setSelectedBotId(nextBot.id);
    storeSelectedBotId(nextBot.id);
    window.history.replaceState({}, "", dashboardPathForView(nextBot.slug, activeView));

    if (nextGuildId) {
      setSelectedGuildId(nextGuildId);
      setDashboardProfile((current) => (current ? { ...current, selectedGuildId: nextGuildId } : current));
      void updateSelectedDashboardGuild(nextGuildId, nextBot.id).catch(() => undefined);
    }
  }

  function handleChangeView(view: ViewId) {
    setActiveView(view);
    if (selectedBot) {
      window.history.replaceState({}, "", dashboardPathForView(selectedBot.slug, view));
    }
  }

  if (dashboardRouteError) {
    return <DashboardRouteError message={dashboardRouteError} />;
  }

  if (maintenanceState?.active) {
    return <DashboardMaintenanceScreen maintenance={maintenanceState} />;
  }

  return (
    <DashboardLayout
      activeView={activeView}
      bots={panelBots}
      dashboardUser={dashboardProfile?.user}
      enabledModules={enabledModules}
      guilds={scopedDashboardGuilds}
      onChangeView={handleChangeView}
      onLogout={onLogout}
      onSelectBot={handleSelectBot}
      onSelectGuild={handleSelectGuild}
      selectedBot={selectedBot}
      selectedGuildId={selectedGuild?.id ?? null}
      status={displayedBotStatus}
      user={auth.user}
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <DashboardNoticeCenter
          activeView={activeView}
          bot={selectedBot}
          maintenance={maintenanceState}
          planNotice={selectedBotPlanNotice}
        />

        {activeView !== "overview" ? (
          <UserDashboardHeader
            bot={selectedBot}
            selectedGuild={selectedGuild}
            status={displayedBotStatus}
          />
        ) : null}

        {activeView !== "overview" && activeView !== "plans" && activeView !== "delete-channels" && activeView !== "fivem-hierarchy" && activeView !== "police-daf-roster" ? (
          <PanelImageSettings
            botId={activeBotId}
            canManage={canManageDashboard}
            guildId={selectedGuild?.id ?? null}
            panelId={policePanelImageSlotsForView(activeView) ? undefined : activeView === "settings" ? "global-default" : visualPanelIdForView(activeView)}
            panelLabel={policePanelImageSlotsForView(activeView) ? "Polícia" : activeView === "settings" ? "Padrão visual global" : `Configuração Visual do Painel — ${activeView}`}
            panelSlots={policePanelImageSlotsForView(activeView) ?? undefined}
          />
        ) : null}

        {activeView === "overview" ? (
          <OverviewView
            availableModules={availableModules}
            bot={selectedBot}
            details={overviewDetails}
            guild={selectedGuild}
            onConfigure={handleChangeView}
            settings={settings}
            status={displayedBotStatus}
          />
        ) : null}


        {activeView === "lives" ? (
          <LiveView
            botId={activeBotId}
            canManageKick={canManageModule(selectedBot, "live", canManageDashboard) || canManageModule(selectedBot, "kick-integration", canManageDashboard)}
            canManageTwitch={canManageModule(selectedBot, "live", canManageDashboard)}
            liveDetectionRefresh={liveDetectionRefresh}
            guild={selectedGuild}
            lives={lives}
            showKick={liveModulesEnabled(enabledModules)}
            showTwitch={enabledModules.includes("live")}
          />
        ) : null}
        {activeView === "clips" ? (
          <ClipsPanel botId={activeBotId} canManage={canManageModule(selectedBot, "clips", canManageDashboard)} guild={selectedGuild} platform="twitch" refreshSignal={clipsRefreshSignal} />
        ) : null}
        {activeView === "kick-clips" ? (
          <ClipsPanel botId={activeBotId} canManage={canManageModule(selectedBot, "kick-clips", canManageDashboard)} guild={selectedGuild} platform="kick" refreshSignal={clipsRefreshSignal} />
        ) : null}
        {activeView === "giveaway" ? (
          <div className="space-y-5">
            <PanelImageSettings
              botId={activeBotId}
              canManage={canManageModule(selectedBot, "giveaway", canManageDashboard)}
              guildId={selectedGuild?.id ?? null}
              panelId="giveaway"
              panelLabel="Sorteio"
            />
            <GiveawayPanel botId={activeBotId} canManage={canManageModule(selectedBot, "giveaway", canManageDashboard)} guild={selectedGuild} />
          </div>
        ) : null}
        {activeView === "x-monitor" ? (
          <XMonitorPanel botId={activeBotId} canManage={canManageModule(selectedBot, "x-monitor", canManageDashboard)} guild={selectedGuild} />
        ) : null}
        {activeView === "moderation" ? (
          <ModerationView
            canManage={canManageModule(selectedBot, "moderation", canManageDashboard)}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
          />
        ) : null}
        {activeView === "rules" ? (
          <RulesView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "rules", canManageDashboard)}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "payment-gateway" ? (
          <PaymentGatewayPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "payment-gateway", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "manual-payments" ? (
          <ManualPaymentsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "manual-payments", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "price-tables" ? (
          <PriceTablesPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "price-tables", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "courses" && selectedGuild && activeBotId ? (
          <CoursesPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "courses", canManageDashboard)}
            guildId={selectedGuild.id}
          />
        ) : null}
        {activeView === "mission-tools" ? (
          <div className="space-y-5">
            <PanelImageSettings
              botId={activeBotId}
              canManage={canManageModule(selectedBot, "mission-tools", canManageDashboard)}
              guildId={selectedGuild?.id ?? null}
              panelId="mission-tools"
              panelLabel="Mission Tools"
            />
            <MissionToolsPanel
              botId={activeBotId}
              canManage={canManageModule(selectedBot, "mission-tools", canManageDashboard)}
              guild={selectedGuild}
              user={auth.user}
            />
          </div>
        ) : null}
        {activeView === "voice-recorder" ? (
          <VoiceRecorderPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "voice-recorder", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "self-bot-protection" ? (
          <SelfBotProtectionPanel
            bot={selectedBot}
            botId={activeBotId}
            bots={panelBots}
            canManage={canManageModule(selectedBot, "safe-bot", canManageDashboard)}
            guild={selectedGuild}
            guilds={scopedDashboardGuilds}
            guildSettings={settings}
            onGuildSettingsChange={setSettings}
            onSelectBot={handleSelectBot}
            onSelectGuild={(guildId) => void handleSelectGuild(guildId)}
          />
        ) : null}
        {activeView === "security" ? (
          <AccountAgeSecurityPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "account-age-security", canManageDashboard)}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "anti-ban" ? (
          <AntiBanPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "anti-ban", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "global-blacklist" ? (
          <GlobalBlacklistPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "global-blacklist", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "server-backup" ? (
          <ServerBackupPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "server-backup", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {advancedSecurityModuleViews.includes(activeView) && activeView !== "anti-ban" && activeView !== "global-blacklist" && activeView !== "server-backup" ? (
          <AdvancedSecurityModulePanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, viewModuleIds[activeView] ?? "", canManageDashboard)}
            guild={selectedGuild}
            moduleId={viewModuleIds[activeView] ?? ""}
          />
        ) : null}
        {activeView === "permissions" ? (
          <SiteAccessPanel
            botId={activeBotId}
            botSlug={selectedBot?.slug ?? initialBotSlug}
            canManage={canManageOwnerDevModule("verification")}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "logs" ? (
          <LogsView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "logs", canManageDashboard)}
            guild={selectedGuild}
            loading={settingsLoading}
            logs={logs}
            onSettingsChange={(nextSettings) => void handleLogsSettingsChange(nextSettings)}
            settings={settings}
          />
        ) : null}
        {activeView === "notifications" ? (
          <NotificationsView
            botId={activeBotId}
            canManage={canManageDashboard}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "entry-leave" ? (
          <EntryLeaveManager
            availableModes={(["welcome", "leave"] as const).filter((mode) => enabledModules.includes(mode))}
            botId={activeBotId}
            canManageModule={(moduleId) => canManageModule(selectedBot, moduleId, canManageDashboard)}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
            viewerName={auth.user.username}
          />
        ) : null}
        {activeView === "auto-roles" ? (
          <AutoRolesPanel
            botId={activeBotId}
            canManage={canManageOwnerDevModule("roles")}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "server-cloner" ? (
          <CloningView
            botId={activeBotId}
            bots={panelBots}
            canManageEmoji={canManageModule(selectedBot, "emoji-cloner", canManageDashboard)}
            canManageServer={canManageModule(selectedBot, "server-cloner", canManageDashboard)}
            enabledModules={enabledModules}
            guild={selectedGuild}
            guilds={scopedDashboardGuilds}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "delete-channels" ? (
          <DeleteChannelsPanel botId={activeBotId} guild={selectedGuild} />
        ) : null}
        {activeView === "media-library" ? (
          <MediaLibraryPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "emoji-cloner", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "fivem" ? (
          <FivemView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem", canManageDashboard) || canManageModule(selectedBot, "fivem-factions", canManageDashboard)}
            enabledModules={enabledModules}
            fivemModules={fivemModules}
            guild={selectedGuild}
            mode="general"
          />
        ) : null}
        {activeView === "fivem-absence" ? (
          <FacAbsencePanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-absences", canManageDashboard) || canManageModule(selectedBot, "fivem-fac", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-absence" ? (
          <FacAbsencePanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-absences", canManageDashboard)}
            guild={selectedGuild}
            variant="police"
          />
        ) : null}
        {activeView === "fivem-hierarchy" ? (
          <FivemHierarchyPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-hierarchy", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "fivem-actions" ? (
          <FivemActionsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-actions", canManageDashboard)}
            fixedArchitecture="fac"
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-actions" ? (
          <FivemActionsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-actions", canManageDashboard)}
            fixedArchitecture="police"
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-patrol-reports" ? (
          <PolicePatrolReportsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-patrol-reports", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-qru" ? (
          <PoliceQruPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-qru", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-promotions" ? (
          <PolicePromotionsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-promotions", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "vehicle-abandonment" ? (
          <VehicleAbandonmentPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "vehicle-abandonment", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-hidden-channel" ? (
          <PoliceHiddenChannelPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-hidden-channel", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "visible-message" ? (
          isServerModuleReleased("visible-message") ? (
            <VisibleMessagePanel
              botId={activeBotId}
              canManage={canManageModule(selectedBot, "visible-message", canManageDashboard)}
              guild={selectedGuild}
            />
          ) : (
            <ServerModuleReleasePanel
              canRelease={canReleaseServerModule("visible-message")}
              moduleId="visible-message"
              onRelease={() => void handleReleaseServerModule("visible-message")}
              releasing={releasingServerModuleId === "visible-message"}
              title="Mensagem Visível"
            />
          )
        ) : null}
        {activeView === "message-control" ? (
          isServerModuleReleased("message-control") ? (
            <MessageControlPanel bot={selectedBot} canManage={canManageModule(selectedBot, "message-control", canManageDashboard)} guild={selectedGuild} serverReleased />
          ) : (
            <ServerModuleReleasePanel
              canRelease={canReleaseServerModule("message-control")}
              moduleId="message-control"
              onRelease={() => void handleReleaseServerModule("message-control")}
              releasing={releasingServerModuleId === "message-control"}
              title="Controle de Mensagem"
            />
          )
        ) : null}
        {activeView === "police-dm" ? (
          <DmBarPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-dm", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-open-duty" ? (
          <OpenDutyNotificationsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-open-duty", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-time-clock" ? (
          <PoliceTimeClockPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "police-time-clock", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "police-daf-roster" ? (
          <DafRosterPanel
            bot={selectedBot}
            canRelease={canReleaseServerModule("police-daf-roster")}
            guild={selectedGuild}
            onRelease={() => void handleReleaseServerModule("police-daf-roster")}
            releasing={releasingServerModuleId === "police-daf-roster"}
            serverReleased={isServerModuleReleased("police-daf-roster")}
          />
        ) : null}
        {activeView === "auto-activity-clock" ? (
          <AutoActivityClockPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "auto-activity-clock", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "rh-admin" && selectedGuild && activeBotId ? (
          <RhAdminPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "rh-admin", canManageDashboard)}
            guildId={selectedGuild.id}
          />
        ) : null}
        {activeView === "police-iab" || activeView === "police-subpoenas" ? (
          <PoliceIabPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, activeView === "police-subpoenas" ? "police-subpoenas" : "police-iab", canManageDashboard)}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {policeTranscriptViews.has(activeView) ? (
          <TranscriptSettingsCard
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "logs", canManageDashboard)}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "fivem-orders" ? (
          <FivemView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-orders", canManageDashboard)}
            enabledModules={enabledModules}
            fivemModules={fivemModules}
            guild={selectedGuild}
            mode="orders"
          />
        ) : null}
        {activeView === "fivem-families" ? (
          <FivemOrdersManager botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-orders", canManageDashboard) || canManageModule(selectedBot, "fivem-drugs", canManageDashboard) || canManageModule(selectedBot, "fivem-washing", canManageDashboard)} familyOnly guild={selectedGuild} initialTab="families" mode="orders" />
        ) : null}
        {activeView === "fivem-washing" ? (
          <FivemOrdersManager botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-washing", canManageDashboard)} guild={selectedGuild} mode="washing" />
        ) : null}
        {activeView === "fivem-ammo" ? (
          <FivemOrdersManager botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-orders", canManageDashboard)} guild={selectedGuild} mode="ammo" />
        ) : null}
        {activeView === "fivem-drug" ? (
          <FivemOrdersManager botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-drugs", canManageDashboard)} guild={selectedGuild} mode="drug" />
        ) : null}
        {activeView === "fivem-weapon" ? (
          <FivemOrdersManager botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-orders", canManageDashboard)} guild={selectedGuild} mode="weapon" />
        ) : null}
        {activeView === "fivem-custom" ? (
          <FivemOrdersManager botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-orders", canManageDashboard)} guild={selectedGuild} mode="custom" />
        ) : null}
        {activeView === "fivem-finance" ? (
          <FivemFinancePanel botId={activeBotId} canManage={canManageModule(selectedBot, "fivem-finance", canManageDashboard)} guild={selectedGuild} />
        ) : null}
        {activeView === "fivem-goals" ? (
          <FivemView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-goals", canManageDashboard)}
            enabledModules={enabledModules}
            fivemModules={fivemModules}
            guild={selectedGuild}
            mode="goals"
          />
        ) : null}
        {activeView === "fivem-captcha" ? (
          <FivemView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-captcha", canManageDashboard)}
            enabledModules={enabledModules}
            fivemModules={fivemModules}
            guild={selectedGuild}
            mode="general"
          />
        ) : null}
        {activeView === "ztk-webhook" ? (
          <ZtkWebhookPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "ztk-webhook", canManageDashboard)}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "manual-registration" ? (
          <ManualRegistrationPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "manual-registration", canManageDashboard)}
            goalsEnabled={enabledModules.includes("fivem-goals")}
            guild={selectedGuild}
          />
        ) : null}
        {activeView === "settings" ? (
          <SettingsView
            botId={activeBotId}
            bots={panelBots}
            canManage={canManageDashboard}
            canManageOwnerDevModule={canManageOwnerDevModule}
            canManageModule={(moduleId) => canManageModule(selectedBot, moduleId, canManageDashboard)}
            enabledModules={enabledModules}
            guild={selectedGuild}
            guilds={scopedDashboardGuilds}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
            tickets={tickets}
          />
        ) : null}
      </motion.div>
    </DashboardLayout>
  );
}

const advancedSecurityModuleViews: ViewId[] = [
  "anti-abuse",
  "anti-ban",
  "suspicious-servers",
  "global-blacklist",
  "advanced-permissions",
  "invite-cleanup",
  "server-backup",
  "vanity-url-protection",
  "hide-empty-voice",
  "anti-disconnect",
  "auto-unmute",
  "temporary-voice",
  "tag-verification",
  "bio-url-verification",
  "first-lady",
  "music"
];

const advancedSecurityModuleDetails: Record<string, {
  title: string;
  description: string;
  icon: typeof Bot;
  items: string[];
}> = {
  "anti-abuse": {
    title: "DEV Control Panel",
    description: "Central Anti Abuse para controlar mute, deafen, move, disconnect, auto-reconnect e auto-unmute.",
    icon: ShieldAlert,
    items: ["Master switch", "Modulos independentes", "Auto-reversao", "Logs de abuso"]
  },
  "anti-ban": {
    title: "Sistema Anti Ban",
    description: "Módulo isolado para proteger cargos e membros contra ações administrativas indevidas.",
    icon: ShieldCheck,
    items: ["Cargos protegidos", "Usuários protegidos", "Punição do executor", "Histórico de tentativas"]
  },
  "suspicious-servers": {
    title: "Servidores Suspeitos",
    description: "Módulo isolado para revisar membros que entram com vínculo a listas suspeitas.",
    icon: Search,
    items: ["Lista personalizada", "Ação automática", "Canal de revisão", "Histórico de detecções"]
  },
  "global-blacklist": {
    title: "Blacklist Global",
    description: "Módulo isolado para bloquear IDs cadastrados antes de liberarem entrada no servidor.",
    icon: LockKeyhole,
    items: ["Usuários bloqueados", "Motivos", "Importação", "Exportação"]
  },
  "advanced-permissions": {
    title: "Gerenciamento de Permissões",
    description: "Módulo isolado para permissão granular por cargo em ações sensíveis.",
    icon: SlidersHorizontal,
    items: ["Ban", "Kick", "Timeout", "Cargos e canais"]
  },
  "invite-cleanup": {
    title: "Limpeza Automática de Convites",
    description: "Módulo isolado para apagar convites em rotina configurável.",
    icon: Trash2,
    items: ["Intervalo", "Convites permanentes", "Whitelist", "Log de criadores"]
  },
  "server-backup": {
    title: "Backup Completo",
    description: "Módulo isolado para backup manual, automático e restauração seletiva.",
    icon: Server,
    items: ["Canais e cargos", "Emojis e stickers", "Webhooks", "Restauração seletiva"]
  },
  "vanity-url-protection": {
    title: "Proteção da URL Personalizada",
    description: "Módulo isolado para monitorar e restaurar vanity URL do servidor.",
    icon: Globe2,
    items: ["URL esperada", "Tempo de verificação", "Punição", "Logs"]
  },
  "hide-empty-voice": {
    title: "Esconder Chamadas Vazias",
    description: "Módulo isolado para ocultar canais de voz vazios e mostrar quando houver membro.",
    icon: Mic2,
    items: ["Delay", "Categorias", "Permissões", "Exceções"]
  },
  "anti-disconnect": {
    title: "Anti Disconnect",
    description: "Detecta desconexao indevida por audit log e reconecta automaticamente o membro na call original.",
    icon: ShieldAlert,
    items: ["Cargos autorizados", "Cargos protegidos", "Auto reconexao", "Logs de abuso"]
  },
  "auto-unmute": {
    title: "Auto Desmutar",
    description: "Remove automaticamente o mute manual de usuários ao entrarem no canal de voz configurado.",
    icon: Mic2,
    items: ["Canal gatilho", "Logs", "Exceções", "Eventos recentes"]
  },
  "temporary-voice": {
    title: "Chamadas Temporárias",
    description: "Módulo isolado para criar salas de voz temporárias com controle pelo dono.",
    icon: Users,
    items: ["Canal criador", "Limite", "Senha", "Transferencia de dono"]
  },
  "tag-verification": {
    title: "Verificação de Tag",
    description: "Módulo isolado para entregar cargo conforme tag personalizada.",
    icon: Hash,
    items: ["Tag exigida", "Cargo entregue", "Tempo de atualização", "Remoção automática"]
  },
  "bio-url-verification": {
    title: "Verificação de URL na Bio",
    description: "Módulo isolado para entregar cargo conforme domínios permitidos na bio.",
    icon: AtSign,
    items: ["Domínios permitidos", "Expressões", "Cargo entregue", "Atualização automática"]
  },
  "first-lady": {
    title: "Sistema Primeira Dama",
    description: "Módulo isolado para limites, relações e histórico de damas por cargo.",
    icon: Users,
    items: ["Cargos autorizados", "Limites", "Relacionamentos", "Histórico"]
  },
  music: {
    title: "Sistema de Música",
    description: "Player por prefixo com busca, repertório de artistas, filas e controles interativos.",
    icon: Music2,
    items: ["Comandos por prefixo", "Fila por servidor", "Permissões e limites", "Player em Componentes V2"]
  }
};

const safeBotBlacklistModules = [
  "safe-bot",
  "anti-abuse",
  "anti-bot",
  "anti-fake",
  "anti-link",
  "anti-spam",
  "anti-flood",
  "anti-raid",
  "anti-role",
  "anti-ban",
  "anti-kick",
  "anti-channel-delete",
  "anti-role-delete",
  "anti-permissions"
];

function GlobalBlacklistPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [settings, setSettings] = useState<GlobalBlacklistSafeBotSettings | null>(null);
  const [entries, setEntries] = useState<GlobalBlacklistEntry[]>([]);
  const [history, setHistory] = useState<GlobalBlacklistHistory[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guild || !botId) {
      setSettings(null);
      setEntries([]);
      setHistory([]);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getGlobalBlacklistDashboard(guild.id, botId), getGuildLiveOptions(guild.id, botId)])
      .then(([dashboard, options]) => {
        if (!active) return;
        setSettings(dashboard.settings);
        setEntries(dashboard.entries);
        setHistory(dashboard.history);
        setChannels(options.channels);
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar a Blacklist Global.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [botId, guild?.id]);

  function update(patch: Partial<GlobalBlacklistSafeBotSettings>) {
    setSettings((current) => current ? { ...current, ...patch } : current);
  }

  function toggleModule(moduleId: string) {
    if (!settings) return;
    const exists = settings.enabledSafeBotModules.includes(moduleId);
    update({
      enabledSafeBotModules: exists
        ? settings.enabledSafeBotModules.filter((item) => item !== moduleId)
        : [...settings.enabledSafeBotModules, moduleId]
    });
  }

  async function save() {
    if (!guild || !botId || !settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveGlobalBlacklistSettings(guild.id, settings, botId);
      setSettings(saved);
      setMessage("Integração SafeBot salva.");
    } catch {
      setError("Não foi possível salvar a integração SafeBot.");
    } finally {
      setSaving(false);
    }
  }

  if (!guild) return <EmptyState icon={LockKeyhole} title="Selecione um servidor para configurar a Blacklist Global" />;

  return (
    <Card className="border-red-500/10 bg-zinc-950/75">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-red-300" /> Blacklist Global</CardTitle>
            <CardDescription>Entrada automática somente por eventos do SafeBot ou por ação manual autorizada.</CardDescription>
          </div>
          <Button disabled={!canManage || !settings || saving || loading} onClick={() => void save()} size="sm" type="button">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
        {loading || !settings ? <div className="h-48 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/70" /> : (
          <>
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Integração SafeBot</h3>
                <p className="mt-1 text-xs text-zinc-500">Configure quais eventos do SafeBot podem gerar histórico e blacklist automática.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-xs font-medium text-zinc-400">Limite de infracoes
                  <input className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} min={1} onChange={(event) => update({ infractionLimit: Number(event.target.value) })} type="number" value={settings.infractionLimit} />
                </label>
                <label className="block text-xs font-medium text-zinc-400">Canal de logs
                  <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => update({ logChannelId: event.target.value || null })} value={settings.logChannelId ?? ""}>
                    <option value="">Sem canal</option>
                    {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                  </select>
                </label>
                <label className="flex h-11 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300">
                  <input checked={settings.autoBlacklistOnSafeBotBan} disabled={!canManage} onChange={(event) => update({ autoBlacklistOnSafeBotBan: event.target.checked })} type="checkbox" />
                  Ban automático do SafeBot envia para blacklist
                </label>
                <label className="flex h-11 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300">
                  <input checked={settings.requireApprovalAfterRemoval} disabled={!canManage} onChange={(event) => update({ requireApprovalAfterRemoval: event.target.checked })} type="checkbox" />
                  Removido da blacklist cai em aprovação pendente
                </label>
              </div>
              <label className="block text-xs font-medium text-zinc-400">Kick automático do SafeBot
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => update({ kickMode: event.target.value as GlobalBlacklistSafeBotSettings["kickMode"] })} value={settings.kickMode}>
                  <option value="history_only">Apenas registrar histórico</option>
                  <option value="alert">Registrar e gerar alerta</option>
                  <option value="blacklist">Enviar direto para blacklist</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {safeBotBlacklistModules.map((moduleId) => (
                  <button
                    className={`rounded-md border px-3 py-1.5 text-xs transition ${settings.enabledSafeBotModules.includes(moduleId) ? "border-red-400/40 bg-red-500/15 text-red-100" : "border-zinc-800 bg-zinc-950 text-zinc-500"}`}
                    disabled={!canManage}
                    key={moduleId}
                    onClick={() => toggleModule(moduleId)}
                    type="button"
                  >
                    {moduleId}
                  </button>
                ))}
              </div>
            </section>
            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard icon={LockKeyhole} label="Ativos" value={String(entries.filter((entry) => entry.active).length)} />
              <MetricCard icon={ShieldAlert} label="Histórico SafeBot" value={String(history.filter((item) => item.safeBotModule).length)} />
              <MetricCard icon={Users} label="Usuários" value={String(new Set(history.map((item) => item.userId)).size)} />
            </div>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-white">Ultimos registros</h3>
              {history.slice(0, 8).map((item) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-sm" key={item.id}>
                  <span className="min-w-0 truncate text-zinc-300">{item.action} - {item.infractionType} - {item.reason}</span>
                  <Badge variant={item.action === "blacklisted" ? "danger" : "muted"}>{item.safeBotModule ?? "manual"}</Badge>
                </div>
              ))}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const serverBackupParts: Array<{ id: ServerBackupRestorePart; label: string }> = [
  { id: "roles", label: "Cargos" },
  { id: "channels", label: "Canais" },
  { id: "permissions", label: "Permissões" },
  { id: "emojis", label: "Emojis" },
  { id: "stickers", label: "Stickers" },
  { id: "settings", label: "Configurações do bot" },
  { id: "panels", label: "Paineis do bot" }
];

function ServerBackupPanel({ botId, canManage, guild }: { botId: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [dashboard, setDashboard] = useState<ServerBackupDashboard | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workingBackupId, setWorkingBackupId] = useState<string | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<ServerBackupSnapshot | null>(null);
  const [selectedParts, setSelectedParts] = useState<ServerBackupRestorePart[]>(serverBackupParts.map((part) => part.id));
  const [restoreMode, setRestoreMode] = useState<ServerBackupRestoreMode>("merge");
  const [preview, setPreview] = useState<ServerBackupRestorePreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [sendBackupId, setSendBackupId] = useState("");
  const [targetGuildId, setTargetGuildId] = useState("");
  const [sendPreview, setSendPreview] = useState<ServerBackupRestorePreview | null>(null);
  const [sendConfirmation, setSendConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const settings = dashboard?.settings;
  const disabled = !canManage || saving || !botId || !guild;
  const logChannelOptions = channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }));

  const load = useCallback(async () => {
    if (!botId || !guild) {
      setDashboard(null);
      setRoles([]);
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const [page, options] = await Promise.all([
        getServerBackupDashboard(botId, guild.id),
        getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [], roles: [], voiceChannels: [] }))
      ]);
      setDashboard(page);
      setRoles(options.roles ?? []);
      setChannels(options.channels ?? []);
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível carregar o Backup Completo.");
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    socket.on("server-backup:restore_progress", (job: ServerBackupRestoreJob) => {
      const belongsToView = job.botId === botId
        && [job.guildId, job.sourceGuildId, job.targetGuildId].includes(guild.id);
      if (!belongsToView) return;
      setDashboard((current) => {
        if (!current) return current;
        const jobs = current.restoreJobs.filter((item) => item.id !== job.id);
        return { ...current, restoreJobs: [job, ...jobs].slice(0, 20) };
      });
    });
    socket.on("server-backup:snapshot_updated", (snapshot: ServerBackupSnapshot) => {
      if (snapshot.botId !== botId || snapshot.guildId !== guild.id) return;
      setDashboard((current) => {
        if (!current) return current;
        const backups = current.backups.filter((item) => item.id !== snapshot.id);
        return { ...current, backups: [snapshot, ...backups].slice(0, 50) };
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [botId, guild]);

  async function patchSettings(patch: Partial<ServerBackupSettings>) {
    if (!botId || !guild || !settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveServerBackupSettings(botId, guild.id, patch);
      setDashboard((current) => current ? { ...current, settings: saved } : current);
      setMessage("Configuração de backup salva.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  async function createNow() {
    if (!botId || !guild) return;
    setSaving(true);
    setMessage(null);
    try {
      const backup = await createServerBackup(botId, guild.id);
      setDashboard((current) => current ? { ...current, backups: [backup, ...current.backups] } : current);
      setMessage(backup.status === "completed" ? "Backup criado com sucesso." : backup.statusMessage ?? "Backup finalizado com avisos.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível criar o backup.");
    } finally {
      setSaving(false);
    }
  }

  async function removeBackup(backupId: string) {
    if (!botId || !guild || !window.confirm("Apagar este backup salvo?")) return;
    setWorkingBackupId(backupId);
    try {
      await deleteServerBackup(botId, guild.id, backupId);
      setDashboard((current) => current ? { ...current, backups: current.backups.filter((backup) => backup.id !== backupId) } : current);
      if (selectedBackup?.id === backupId) setSelectedBackup(null);
      setMessage("Backup apagado.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível apagar o backup.");
    } finally {
      setWorkingBackupId(null);
    }
  }

  async function previewRestore(backup: ServerBackupSnapshot) {
    if (!botId || !guild) return;
    setSelectedBackup(backup);
    setPreview(null);
    setConfirmation("");
    setWorkingBackupId(backup.id);
    try {
      setPreview(await previewServerBackupRestore(botId, guild.id, backup.id, selectedParts, null, restoreMode));
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível gerar a previa.");
    } finally {
      setWorkingBackupId(null);
    }
  }

  async function confirmRestore() {
    if (!botId || !guild || !selectedBackup || confirmation !== "CONFIRMAR") return;
    setWorkingBackupId(selectedBackup.id);
    setMessage(null);
    try {
      await restoreServerBackup(botId, guild.id, selectedBackup.id, selectedParts, confirmation, null, restoreMode);
      setMessage("Restauração iniciada e registrada no histórico.");
      setSelectedBackup(null);
      setPreview(null);
      setConfirmation("");
      await load();
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível restaurar o backup.");
    } finally {
      setWorkingBackupId(null);
    }
  }

  async function previewSendRestore() {
    if (!botId || !guild || !sendBackupId || !targetGuildId) return;
    setSendPreview(null);
    setSendConfirmation("");
    setWorkingBackupId(sendBackupId);
    setMessage(null);
    try {
      setSendPreview(await previewServerBackupRestore(botId, guild.id, sendBackupId, selectedParts, targetGuildId.trim(), restoreMode));
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível validar o servidor de destino.");
    } finally {
      setWorkingBackupId(null);
    }
  }

  async function confirmSendRestore() {
    if (!botId || !guild || !sendBackupId || !targetGuildId || sendConfirmation !== "CONFIRMAR") return;
    setWorkingBackupId(sendBackupId);
    setMessage(null);
    try {
      await restoreServerBackup(botId, guild.id, sendBackupId, selectedParts, sendConfirmation, targetGuildId.trim(), restoreMode);
      setMessage(`Backup enviado para restauração no servidor ${targetGuildId.trim()}.`);
      setSendPreview(null);
      setSendConfirmation("");
      await load();
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível restaurar no servidor de destino.");
    } finally {
      setWorkingBackupId(null);
    }
  }

  function togglePart(part: ServerBackupRestorePart, checked: boolean) {
    setSelectedParts((current) => checked ? [...new Set([...current, part])] : current.filter((item) => item !== part));
  }

  if (!botId || !guild) {
    return <Card><CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">Escolha um bot e um servidor para configurar o Backup Completo.</CardContent></Card>;
  }

  if (loading || !settings) {
    return <Card><CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm font-medium text-zinc-300"><Loader2 className="h-5 w-5 animate-spin" />Carregando backups...</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Server} label="Backups salvos" value={String(dashboard?.backups.length ?? 0)} />
        <MetricCard icon={Clock3} label="Automático" value={settings.autoEnabled ? "Ativo" : "Pausado"} />
        <MetricCard icon={CalendarClock} label="Frequencia" value={backupFrequencyLabel(settings.frequency)} />
        <MetricCard icon={ShieldCheck} label="Limite salvo" value={String(settings.limit)} />
        <MetricCard icon={ScrollText} label="Histórico" value={String(dashboard?.restoreJobs.length ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Backup Completo</CardTitle>
              <CardDescription>Isolado por bot e servidor, com criacao manual, automática e restauração seletiva.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={canManage ? "success" : "muted"}>{canManage ? "Liberado" : "Somente leitura"}</Badge>
              <Badge variant={settings.autoEnabled ? "success" : "muted"}>{settings.autoEnabled ? "Auto ativo" : "Auto pausado"}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AdvancedToggleField checked={settings.autoEnabled} disabled={disabled} label="Backup automático" onChange={(checked) => void patchSettings({ autoEnabled: checked })} />
            <AdvancedSelectField disabled={disabled} label="Frequencia do backup" onChange={(value) => void patchSettings({ frequency: value as ServerBackupSettings["frequency"] })} options={[{ label: "A cada 6 horas", value: "6h" }, { label: "A cada 12 horas", value: "12h" }, { label: "Diario", value: "daily" }, { label: "Semanal", value: "weekly" }, { label: "Mensal", value: "monthly" }]} placeholder="Selecione" value={settings.frequency} />
            <AdvancedNumberField disabled={disabled} label="Limite de backups salvos" max={100} min={1} onChange={(value) => void patchSettings({ limit: value })} value={settings.limit} />
            <AdvancedSelectField disabled={disabled} label="Canal de logs" onChange={(value) => void patchSettings({ logChannelId: value || null })} options={logChannelOptions} placeholder="Usar logs padrão" value={settings.logChannelId ?? ""} />
            <div className="sm:col-span-2">
              <MultiRoleSelect disabled={disabled} label="Cargos autorizados" onChange={(values) => void patchSettings({ authorizedRoleIds: values })} roles={roles.filter((role) => !role.managed)} values={settings.authorizedRoleIds} />
            </div>
          </div>
          <Button disabled={disabled || saving} onClick={() => void createNow()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Criar backup agora
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backups Salvos</CardTitle>
          <CardDescription>Data, origem, tipo, contagens e status de cada snapshot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(dashboard?.backups ?? []).length ? dashboard!.backups.map((backup) => (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4" key={backup.id}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-white">{backup.guildName}</p>
                    <Badge variant={backup.status === "completed" ? "success" : backup.status === "partial" || backup.status === "pending" ? "warning" : "danger"}>{backup.status}</Badge>
                    <Badge variant="muted">{backup.kind === "manual" ? "Manual" : "Automático"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{formatDate(backup.createdAt)} - criado por {backup.createdBy ?? "sistema"}</p>
                  <p className="mt-2 text-sm text-zinc-300">{backup.counts.roles} cargos, {backup.counts.categories} categorias, {backup.counts.channels} canais, {backup.counts.emojis} emojis, {backup.counts.stickers} stickers</p>
                  {backup.statusMessage ? <p className="mt-2 text-xs text-amber-300">{backup.statusMessage}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={workingBackupId === backup.id} onClick={() => void previewRestore(backup)} variant="secondary">{workingBackupId === backup.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Restaurar</Button>
                  <Button disabled={disabled || workingBackupId === backup.id} onClick={() => void removeBackup(backup.id)} variant="destructive"><Trash2 className="h-4 w-4" />Apagar</Button>
                </div>
              </div>
            </div>
          )) : <EmptyState icon={Server} title="Nenhum backup salvo" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enviar Backup para Outro Servidor</CardTitle>
          <CardDescription>Selecione um backup salvo, informe o ID do servidor de destino e confirme antes de alterar canais, cargos e permissões.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <label className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
              <span className="font-semibold text-white">Backup salvo</span>
              <select className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60" disabled={!canManage} onChange={(event) => { setSendBackupId(event.target.value); setSendPreview(null); setSendConfirmation(""); }} value={sendBackupId}>
                <option value="">Selecione um backup</option>
                {(dashboard?.backups ?? []).map((backup) => (
                  <option key={backup.id} value={backup.id}>{backup.guildName} - {formatDate(backup.createdAt)} - {backup.counts.roles} cargos / {backup.counts.channels} canais</option>
                ))}
              </select>
            </label>
            <AdvancedTextField disabled={!canManage} label="ID do servidor de destino" onChange={(value) => { setTargetGuildId(value); setSendPreview(null); setSendConfirmation(""); }} placeholder="Ex: 123456789012345678" value={targetGuildId} />
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
            Antes de restaurar, o sistema valida se o bot está no servidor destino, se este bot/cliente pode gerenciar esse servidor, se você tem permissão nele e se o bot possui permissões para criar cargos, canais, categorias e sobrescritas.
          </div>
          <AdvancedSelectField
            disabled={!canManage}
            label="Modo de restauração"
            onChange={(value) => { setRestoreMode(value as ServerBackupRestoreMode); setSendPreview(null); setSendConfirmation(""); }}
            options={[
              { label: "Mesclar e atualizar existentes", value: "merge" },
              { label: "Criar apenas itens ausentes", value: "missing" },
              { label: "Substituir itens com mesmo nome", value: "replace" },
              { label: "Limpar servidor antes de restaurar", value: "clear" }
            ]}
            placeholder="Selecione"
            value={restoreMode}
          />
          {restoreMode === "clear" ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm font-semibold text-red-100">Modo limpar ativo: canais e cargos que o bot conseguir gerenciar no servidor destino serão removidos antes da restauração.</div> : null}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {serverBackupParts.map((part) => <AdvancedToggleField checked={selectedParts.includes(part.id)} disabled={!canManage} key={`send-${part.id}`} label={part.label} onChange={(checked) => togglePart(part.id, checked)} />)}
          </div>
          <Button disabled={!canManage || !sendBackupId || !targetGuildId || workingBackupId === sendBackupId} onClick={() => void previewSendRestore()} variant="secondary">
            {workingBackupId === sendBackupId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Ver previa do destino
          </Button>
          {sendPreview ? (
            <div className="rounded-lg border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-300">
              <p className="font-semibold text-white">Origem {sendPreview.sourceGuildId} para destino {sendPreview.targetGuildId}</p>
              <p className="mt-2">Serão restaurados: {sendPreview.summary.roles} cargos, {sendPreview.summary.categories} categorias, {sendPreview.summary.channels} canais, {sendPreview.summary.emojis} emojis, {sendPreview.summary.stickers} stickers e {sendPreview.summary.settings} configurações.</p>
              {sendPreview.missingPermissions.length ? <p className="mt-2 text-red-300">Permissões faltando: {sendPreview.missingPermissions.join(", ")}</p> : <p className="mt-2 text-emerald-300">Destino validado para restauração.</p>}
              {sendPreview.warnings.map((warning) => <p className="mt-1 text-amber-300" key={warning}>{warning}</p>)}
            </div>
          ) : null}
          <AdvancedTextField disabled={!canManage || sendPreview?.canRestore === false} label="Confirmação para servidor destino" onChange={setSendConfirmation} placeholder="Digite CONFIRMAR" value={sendConfirmation} />
          <Button disabled={!canManage || !sendPreview?.canRestore || sendConfirmation !== "CONFIRMAR" || workingBackupId === sendBackupId} onClick={() => void confirmSendRestore()} variant="destructive">
            {workingBackupId === sendBackupId ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Confirmar envio/restauração
          </Button>
        </CardContent>
      </Card>

      {selectedBackup ? (
        <Card>
          <CardHeader>
            <CardTitle>Restauração seletiva</CardTitle>
            <CardDescription>Escolha as partes, gere a previa e digite CONFIRMAR para executar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AdvancedSelectField
              disabled={!canManage}
              label="Modo de restauração"
              onChange={(value) => { setRestoreMode(value as ServerBackupRestoreMode); setPreview(null); setConfirmation(""); }}
              options={[
                { label: "Mesclar e atualizar existentes", value: "merge" },
                { label: "Criar apenas itens ausentes", value: "missing" },
                { label: "Substituir itens com mesmo nome", value: "replace" },
                { label: "Limpar servidor antes de restaurar", value: "clear" }
              ]}
              placeholder="Selecione"
              value={restoreMode}
            />
            {restoreMode === "clear" ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm font-semibold text-red-100">Modo limpar ativo: canais e cargos que o bot conseguir gerenciar neste servidor serão removidos antes da restauração.</div> : null}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {serverBackupParts.map((part) => <AdvancedToggleField checked={selectedParts.includes(part.id)} disabled={!canManage} key={part.id} label={part.label} onChange={(checked) => togglePart(part.id, checked)} />)}
            </div>
            <Button disabled={workingBackupId === selectedBackup.id || !selectedParts.length} onClick={() => void previewRestore(selectedBackup)} variant="secondary">{workingBackupId === selectedBackup.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Atualizar previa</Button>
            {preview ? (
              <div className="rounded-lg border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-300">
                <p className="font-semibold text-white">Previa: {preview.summary.roles} cargos, {preview.summary.categories} categorias, {preview.summary.channels} canais, {preview.summary.emojis} emojis, {preview.summary.stickers} stickers e {preview.summary.settings} configurações.</p>
                {preview.missingPermissions.length ? <p className="mt-2 text-red-300">Permissões faltando: {preview.missingPermissions.join(", ")}</p> : <p className="mt-2 text-emerald-300">Permissões principais validadas.</p>}
                {preview.warnings.map((warning) => <p className="mt-1 text-amber-300" key={warning}>{warning}</p>)}
              </div>
            ) : null}
            <AdvancedTextField disabled={!canManage || preview?.canRestore === false} label="Confirmação" onChange={setConfirmation} placeholder="Digite CONFIRMAR" value={confirmation} />
            <Button disabled={!canManage || !preview?.canRestore || confirmation !== "CONFIRMAR" || workingBackupId === selectedBackup.id} onClick={() => void confirmRestore()} variant="destructive">{workingBackupId === selectedBackup.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}Confirmar restauração</Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Restauracoes e eventos recentes deste bot neste servidor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(dashboard?.restoreJobs ?? []).length ? dashboard!.restoreJobs.map((job) => {
            const result = job.result;
            return (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm" key={job.id}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-semibold text-white">{job.status}</span>
                  <span className="text-zinc-500">{formatDate(job.createdAt)} - {(job.sourceGuildId || job.guildId) === (job.targetGuildId || job.guildId) ? job.guildId : `${job.sourceGuildId || job.guildId} para ${job.targetGuildId || job.guildId}`} - {job.options.join(", ")}</span>
                </div>
                {result?.summary ? (
                  <p className="mt-2 text-zinc-300">
                    Restaurados: {result.summary.roles} cargos, {result.summary.categories} categorias, {result.summary.channels} canais, {result.summary.permissions} permissões, {result.summary.emojis ?? 0} emojis, {result.summary.stickers ?? 0} stickers, {result.summary.settings} configurações. Reutilizados: {result.summary.reused ?? 0}. Falhas: {result.summary.failed}.
                  </p>
                ) : null}
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800" aria-label={`Progresso ${job.progress ?? result?.progressPercent ?? 0}%`}>
                  <div className="h-full bg-[#FFD500] transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, job.progress ?? result?.progressPercent ?? 0))}%` }} />
                </div>
                <p className="mt-1 text-right text-xs text-zinc-500">{job.progress ?? result?.progressPercent ?? 0}%</p>
                {result?.progress?.length ? (
                  <div className="mt-2 grid gap-1 text-xs text-zinc-500">
                    {result.progress.slice(-5).map((item, index) => <span key={`${job.id}-progress-${index}`}>{item.status}: {item.message}</span>)}
                  </div>
                ) : null}
                {result?.errors?.length ? (
                  <div className="mt-2 grid gap-1 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-200">
                    {result.errors.slice(0, 4).map((item, index) => <span key={`${job.id}-error-${index}`}>{item.step}: {item.message}</span>)}
                    {result.errors.length > 4 ? <span>Mais {result.errors.length - 4} erro(s) registrados no relatório.</span> : null}
                  </div>
                ) : null}
              </div>
            );
          }) : <p className="text-sm text-zinc-500">Nenhuma restauração registrada.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function backupFrequencyLabel(value: ServerBackupSettings["frequency"]) {
  return ({ "6h": "6 horas", "12h": "12 horas", daily: "Diario", weekly: "Semanal", monthly: "Mensal" } as Record<ServerBackupSettings["frequency"], string>)[value];
}

function AdvancedSecurityModulePanel({
  botId,
  canManage,
  guild,
  moduleId
}: {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  moduleId: string;
}) {
  const details = advancedSecurityModuleDetails[moduleId];
  const Icon = details?.icon ?? Shield;
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<GuildVoiceChannelOption[]>([]);
  const [textChannels, setTextChannels] = useState<GuildChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild || !details) {
        setConfig({});
        setRoles([]);
        setVoiceChannels([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);

      const [moduleResult, optionsResult] = await Promise.all([
        getAdvancedModuleConfig(botId, guild.id, moduleId),
        getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [], roles: [], voiceChannels: [] }))
      ]);

      if (!mounted) return;

      setConfig(defaultAdvancedModuleConfig(moduleId, moduleResult.config));
      setRoles(optionsResult.roles ?? []);
      setVoiceChannels(optionsResult.voiceChannels ?? []);
      setTextChannels(optionsResult.channels ?? []);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setConfig(defaultAdvancedModuleConfig(moduleId, {}));
          setVoiceChannels([]);
          setMessage(readResponseMessage(error) ?? "Não foi possível carregar este módulo.");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, details, guild, moduleId]);

  useEffect(() => {
    if (moduleId !== "tag-verification" || !botId || !guild) return;
    let mounted = true;

    async function refreshStatus() {
      const module = await getAdvancedModuleConfig(botId!, guild!.id, moduleId).catch(() => null);
      if (!mounted || !module) return;
      setConfig((current) => ({ ...current, ...tagVerificationStatusFields(module.config) }));
    }

    const initialRefresh = window.setTimeout(() => void refreshStatus(), 3_000);
    const interval = window.setInterval(() => void refreshStatus(), 10_000);
    return () => {
      mounted = false;
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [botId, guild, moduleId]);

  async function saveConfig(nextConfig = config) {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveAdvancedModuleConfig(botId, guild.id, moduleId, {
        config: nextConfig,
        guildName: guild.name
      });
      setConfig(defaultAdvancedModuleConfig(moduleId, saved.config));
      if (moduleId === "tag-verification") {
        const roleName = roles.find((role) => role.id === saved.config.roleId)?.name ?? "selecionado";
        setMessage(`Configuração salva com sucesso. Verificação iniciada automaticamente. Cargo ${roleName} será entregue para membros com a tag ${String(saved.config.requiredTag ?? "")}.`);
      } else {
        setMessage("Módulo salvo.");
      }
      return true;
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar este módulo.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function patchConfig(patch: Record<string, unknown>) {
    setConfig((current) => ({
      ...current,
      ...patch
    }));
  }

  function updateEnabled(enabled: boolean) {
    if (moduleId === "tag-verification" && enabled && (!stringConfig(config.requiredTag).trim() || !stringConfig(config.roleId))) {
      setMessage("Informe a tag exigida e selecione o cargo antes de ativar o sistema.");
      return;
    }

    const nextConfig = {
      ...config,
      enabled
    };

    const previousConfig = config;
    setConfig(nextConfig);
    void saveConfig(nextConfig).then((saved) => {
      if (!saved) setConfig(previousConfig);
    });
  }

  async function verifyTagNow() {
    if (!botId || !guild) return;
    setRunningNow(true);
    setMessage(null);

    try {
      const result = await runTagVerificationNow(botId, guild.id);
      setConfig((current) => ({
        ...current,
        lastCheckAt: result.lastCheckAt,
        nextCheckAt: result.nextCheckAt,
        totalChecked: result.checked,
        totalAssigned: result.assigned,
        totalRemoved: result.removed,
        totalIgnored: result.ignored,
        totalUnavailable: result.unavailable,
        totalErrors: result.errors,
        lastError: result.lastError
      }));
      setMessage(result.lastError
        ? `Verificação concluída com erro: ${result.lastError}`
        : `Verificação concluída: ${result.checked} membros verificados, ${result.assigned} cargos entregues e ${result.removed} removidos.`);
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível executar a verificação agora.");
    } finally {
      setRunningNow(false);
    }
  }

  if (!details) {
    return <EmptyState icon={Shield} title="Módulo não encontrado" />;
  }

  if (!botId || !guild) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Escolha um bot e um servidor para configurar este módulo.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm font-medium text-zinc-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando módulo...
        </CardContent>
      </Card>
    );
  }

  const enabled = config.enabled === true;
  const disabled = !canManage || saving;
  const moduleFooter = moduleId === "auto-unmute"
    ? "Este menu só aparece quando o módulo Auto Desmutar está liberado para este bot na Dashboard DEV."
    : null;

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">
          {message}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle>{details.title}</CardTitle>
                <CardDescription>{details.description}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={canManage ? "success" : "muted"}>{canManage ? "Liberado" : "Somente leitura"}</Badge>
              <Badge variant={enabled ? "success" : "muted"}>{enabled ? "Ativo" : "Inativo"}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SimpleToggleCard
            checked={enabled}
            description="Ativa ou pausa este módulo para este bot neste servidor."
            disabled={disabled}
            icon={Icon}
            onChange={updateEnabled}
            title="Status do sistema"
          />
          <AdvancedModuleFields
            channels={textChannels}
            config={config}
            disabled={disabled}
            moduleId={moduleId}
            onChange={patchConfig}
            roles={roles.filter((role) => !role.managed && (moduleId !== "tag-verification" || role.assignable))}
            voiceChannels={voiceChannels}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={disabled} onClick={() => void saveConfig()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar
            </Button>
            {moduleId === "tag-verification" ? (
              <Button disabled={disabled || !enabled || runningNow} onClick={() => void verifyTagNow()} variant="outline">
                {runningNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Verificar agora
              </Button>
            ) : null}
            <Badge variant="muted">Escopo: bot {botId} / {guild.name}</Badge>
          </div>
          {moduleId === "tag-verification" ? <TagVerificationStatus config={config} /> : null}
          {moduleFooter ? (
            <p className="rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/[0.08] px-4 py-3 text-xs font-semibold text-zinc-300">
              {moduleFooter}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function AdvancedModuleFields({
  channels,
  config,
  disabled,
  moduleId,
  onChange,
  roles,
  voiceChannels
}: {
  channels: GuildChannelOption[];
  config: Record<string, unknown>;
  disabled: boolean;
  moduleId: string;
  onChange: (patch: Record<string, unknown>) => void;
  roles: Array<{ id: string; name: string }>;
  voiceChannels: GuildVoiceChannelOption[];
}) {
  const roleOptions = roles.map((role) => ({ label: role.name, value: role.id }));
  const voiceChannelOptions = voiceChannels.map((channel) => ({ label: channel.name, value: channel.id }));
  const textChannelOptions = channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }));

  if (moduleId === "temporary-voice") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AdvancedSelectField disabled={disabled} label="Canal do painel" onChange={(value) => onChange({ panelChannelId: value || null })} options={textChannelOptions} placeholder="Selecione um canal" value={stringConfig(config.panelChannelId)} />
        <AdvancedTextField disabled={disabled} label="ID da categoria de calls (opcional)" onChange={(value) => onChange({ categoryId: value || null })} placeholder="ID da categoria" value={stringConfig(config.categoryId)} />
        <AdvancedSelectField disabled={disabled} label="Canal de logs" onChange={(value) => onChange({ logChannelId: value || null })} options={textChannelOptions} placeholder="Sem logs" value={stringConfig(config.logChannelId)} />
        <AdvancedNumberField disabled={disabled} label="Limite padrão de usuários" max={99} min={1} onChange={(value) => onChange({ defaultUserLimit: value })} value={numberConfig(config.defaultUserLimit, 10)} />
        <AdvancedNumberField disabled={disabled} label="Excluir vazia após (minutos)" max={1440} min={1} onChange={(value) => onChange({ emptyDeleteMinutes: value })} value={numberConfig(config.emptyDeleteMinutes, 1)} />
        <AdvancedMultiSelectField disabled={disabled} label="Calls apagadas automaticamente" onChange={(values) => onChange({ autoDeleteChannelIds: values })} options={voiceChannelOptions} values={arrayValueConfig(config.autoDeleteChannelIds)} />
      </div>
    );
  }

  if (moduleId === "tag-verification") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <AdvancedTextField disabled={disabled} label="Tag exigida" onChange={(value) => onChange({ requiredTag: value })} placeholder="Ex: VILAO" value={stringConfig(config.requiredTag)} />
        <AdvancedSelectField disabled={disabled} label="Cargo entregue" onChange={(value) => onChange({ roleId: value || null })} options={roleOptions} placeholder="Selecione um cargo" value={stringConfig(config.roleId)} />
        <AdvancedNumberField disabled={disabled} label="Tempo de atualização (minutos)" max={1440} min={1} onChange={(value) => onChange({ updateIntervalMinutes: value })} value={numberConfig(config.updateIntervalMinutes, 10)} />
        <AdvancedToggleField checked={config.autoRemove !== false} disabled={disabled} label="Remoção automática" onChange={(checked) => onChange({ autoRemove: checked })} />
      </div>
    );
  }

  if (moduleId === "bio-url-verification") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <AdvancedTextField disabled={disabled} label="Domínios permitidos" onChange={(value) => onChange({ allowedDomains: value })} placeholder="site.com, link.bio" value={stringConfig(config.allowedDomains)} />
        <AdvancedSelectField disabled={disabled} label="Cargo entregue" onChange={(value) => onChange({ roleId: value || null })} options={roleOptions} placeholder="Selecione um cargo" value={stringConfig(config.roleId)} />
        <AdvancedNumberField disabled={disabled} label="Tempo de atualização (minutos)" min={1} onChange={(value) => onChange({ intervalMinutes: value })} value={numberConfig(config.intervalMinutes, 15)} />
        <AdvancedToggleField checked={config.removeOnMismatch !== false} disabled={disabled} label="Remoção automática" onChange={(checked) => onChange({ removeOnMismatch: checked })} />
      </div>
    );
  }

  if (moduleId === "auto-unmute") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <AdvancedSelectField disabled={disabled} label="Canal de voz monitorado (opcional)" onChange={(value) => onChange({ voiceChannelId: value || null })} options={voiceChannelOptions} placeholder="Todo o servidor" value={stringConfig(config.voiceChannelId)} />
        <AdvancedSelectField disabled={disabled} label="Cargo permitido (opcional)" onChange={(value) => onChange({ requiredRoleId: value || null })} options={roleOptions} placeholder="Todos os usuários" value={stringConfig(config.requiredRoleId)} />
        <AdvancedNumberField disabled={disabled} label="Delay para desmutar (segundos)" max={60} min={0} onChange={(value) => onChange({ delaySeconds: value })} value={numberConfig(config.delaySeconds, 0)} />
        <AdvancedNumberField disabled={disabled} label="Limite anti-spam (segundos)" max={300} min={1} onChange={(value) => onChange({ antiSpamSeconds: value })} value={numberConfig(config.antiSpamSeconds, 10)} />
      </div>
    );
  }

  if (moduleId === "anti-disconnect") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AdvancedTextField disabled={disabled} label="IDs dos cargos autorizados" onChange={(value) => onChange({ allowedRoleIds: splitIds(value) })} placeholder="Cargos que podem desconectar" value={arrayConfig(config.allowedRoleIds)} />
        <AdvancedTextField disabled={disabled} label="IDs dos cargos protegidos" onChange={(value) => onChange({ protectedRoleIds: splitIds(value) })} placeholder="Vazio protege todos" value={arrayConfig(config.protectedRoleIds)} />
        <AdvancedSelectField disabled={disabled} label="Canal de logs" onChange={(value) => onChange({ logChannelId: value || null })} options={textChannelOptions} placeholder="Sem logs dedicado" value={stringConfig(config.logChannelId)} />
        <AdvancedNumberField disabled={disabled} label="Delay da reconexao (ms)" max={5000} min={250} onChange={(value) => onChange({ reconnectDelayMs: value })} value={numberConfig(config.reconnectDelayMs, 800)} />
        <AdvancedNumberField disabled={disabled} label="Cooldown anti-loop (segundos)" max={60} min={1} onChange={(value) => onChange({ cooldownSeconds: value })} value={numberConfig(config.cooldownSeconds, 5)} />
      </div>
    );
  }

  if (moduleId === "anti-abuse") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AdvancedToggleField checked={config.masterEnabled !== false} disabled={disabled} label="Master Switch Anti Abuse" onChange={(checked) => onChange({ masterEnabled: checked })} />
        <AdvancedToggleField checked={config.antiDisconnectEnabled !== false} disabled={disabled} label="Anti Disconnect" onChange={(checked) => onChange({ antiDisconnectEnabled: checked })} />
        <AdvancedToggleField checked={config.autoReconnectEnabled !== false} disabled={disabled} label="Auto Reconnect" onChange={(checked) => onChange({ autoReconnectEnabled: checked })} />
        <AdvancedToggleField checked={config.antiMoveAbuseEnabled !== false} disabled={disabled} label="Anti Move Abuse" onChange={(checked) => onChange({ antiMoveAbuseEnabled: checked })} />
        <AdvancedToggleField checked={config.antiMuteAbuseEnabled !== false} disabled={disabled} label="Anti Mute Abuse" onChange={(checked) => onChange({ antiMuteAbuseEnabled: checked })} />
        <AdvancedToggleField checked={config.antiDeafenAbuseEnabled !== false} disabled={disabled} label="Anti Deafen Abuse" onChange={(checked) => onChange({ antiDeafenAbuseEnabled: checked })} />
        <AdvancedToggleField checked={config.antiKickVoiceEnabled !== false} disabled={disabled} label="Anti Kick Voice" onChange={(checked) => onChange({ antiKickVoiceEnabled: checked })} />
        <AdvancedToggleField checked={config.autoUnmuteEnabled !== false} disabled={disabled} label="Auto Unmute forcado" onChange={(checked) => onChange({ autoUnmuteEnabled: checked })} />
        <AdvancedToggleField checked={config.strictDevOverride !== false} disabled={disabled} label="DEV override estrito" onChange={(checked) => onChange({ strictDevOverride: checked })} />
        <AdvancedTextField disabled={disabled} label="IDs dos cargos autorizados" onChange={(value) => onChange({ allowedRoleIds: splitIds(value) })} placeholder="Cargos que podem executar ações de voz" value={arrayConfig(config.allowedRoleIds)} />
        <AdvancedTextField disabled={disabled} label="IDs dos cargos protegidos" onChange={(value) => onChange({ protectedRoleIds: splitIds(value) })} placeholder="Vazio protege todos" value={arrayConfig(config.protectedRoleIds)} />
        <AdvancedTextField disabled={disabled} label="IDs dos cargos imunes" onChange={(value) => onChange({ immuneRoleIds: splitIds(value) })} placeholder="Usado somente sem override estrito" value={arrayConfig(config.immuneRoleIds)} />
        <AdvancedSelectField disabled={disabled} label="Canal de logs" onChange={(value) => onChange({ logChannelId: value || null })} options={textChannelOptions} placeholder="Sem logs dedicado" value={stringConfig(config.logChannelId)} />
        <AdvancedNumberField disabled={disabled} label="Delay da reversao (ms)" max={5000} min={100} onChange={(value) => onChange({ revertDelayMs: value })} value={numberConfig(config.revertDelayMs, 600)} />
        <AdvancedNumberField disabled={disabled} label="Cooldown anti-loop (segundos)" max={60} min={1} onChange={(value) => onChange({ cooldownSeconds: value })} value={numberConfig(config.cooldownSeconds, 5)} />
      </div>
    );
  }

  if (moduleId === "music") {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AdvancedTextField disabled={disabled} label="Canal de comandos (ID, opcional)" onChange={(value) => onChange({ commandChannelId: value || null })} placeholder="ID do canal de texto" value={stringConfig(config.commandChannelId)} />
        <AdvancedTextField disabled={disabled} label="Canais permitidos (IDs)" onChange={(value) => onChange({ allowedChannelIds: splitIds(value) })} placeholder="ID, ID, ID" value={arrayConfig(config.allowedChannelIds)} />
        <AdvancedTextField disabled={disabled} label="Canais bloqueados (IDs)" onChange={(value) => onChange({ blockedChannelIds: splitIds(value) })} placeholder="ID, ID, ID" value={arrayConfig(config.blockedChannelIds)} />
        <AdvancedTextField disabled={disabled} label="Canal de logs (ID, opcional)" onChange={(value) => onChange({ logChannelId: value || null })} placeholder="ID do canal de texto" value={stringConfig(config.logChannelId)} />
        <AdvancedSelectField disabled={disabled} label="Cargo DJ (opcional)" onChange={(value) => onChange({ djRoleId: value || null })} options={roleOptions} placeholder="Sem cargo DJ" value={stringConfig(config.djRoleId)} />
        <AdvancedSelectField disabled={disabled} label="Quem pode usar" onChange={(value) => onChange({ permissionMode: value })} options={[{ label: "Todos", value: "everyone" }, { label: "Cargos específicos", value: "roles" }, { label: "Administradores", value: "administrators" }]} placeholder="Selecione" value={stringConfig(config.permissionMode) || "everyone"} />
        <AdvancedTextField disabled={disabled} label="IDs dos cargos permitidos" onChange={(value) => onChange({ allowedRoleIds: splitIds(value) })} placeholder="ID, ID, ID" value={arrayConfig(config.allowedRoleIds)} />
        <AdvancedTextField disabled={disabled} label="IDs dos usuários bloqueados" onChange={(value) => onChange({ blockedUserIds: splitIds(value) })} placeholder="ID, ID, ID" value={arrayConfig(config.blockedUserIds)} />
        <AdvancedNumberField disabled={disabled} label="Volume padrão (%)" max={100} min={10} onChange={(value) => onChange({ defaultVolume: value })} value={numberConfig(config.defaultVolume, 50)} />
        <AdvancedNumberField disabled={disabled} label="Limite da fila" max={500} min={1} onChange={(value) => onChange({ queueLimit: value })} value={numberConfig(config.queueLimit, 100)} />
        <AdvancedNumberField disabled={disabled} label="Limite por playlist" max={100} min={1} onChange={(value) => onChange({ playlistLimit: value })} value={numberConfig(config.playlistLimit, 50)} />
        <AdvancedNumberField disabled={disabled} label="Limite por artista" max={50} min={1} onChange={(value) => onChange({ artistLimit: value })} value={numberConfig(config.artistLimit, 25)} />
        <AdvancedNumberField disabled={disabled} label="Cooldown (segundos)" max={60} min={0} onChange={(value) => onChange({ cooldownSeconds: value })} value={numberConfig(config.cooldownSeconds, 5)} />
        <AdvancedNumberField disabled={disabled} label="Duração máxima (minutos)" max={180} min={1} onChange={(value) => onChange({ maxTrackMinutes: value })} value={numberConfig(config.maxTrackMinutes, 15)} />
        <AdvancedNumberField disabled={disabled} label="Sair com fila vazia (segundos)" max={600} min={5} onChange={(value) => onChange({ idleDisconnectSeconds: value })} value={numberConfig(config.idleDisconnectSeconds, 30)} />
        <AdvancedToggleField checked={config.allowPlaylists !== false} disabled={disabled} label="Permitir playlists" onChange={(checked) => onChange({ allowPlaylists: checked })} />
        <AdvancedToggleField checked={config.allowLinks !== false} disabled={disabled} label="Permitir links" onChange={(checked) => onChange({ allowLinks: checked })} />
        <AdvancedToggleField checked={config.allowArtistSearch !== false} disabled={disabled} label="Permitir busca de artistas" onChange={(checked) => onChange({ allowArtistSearch: checked })} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AdvancedTextField disabled={disabled} label="Configuração principal" onChange={(value) => onChange({ primaryConfig: value })} placeholder="Informe o valor principal do módulo" value={stringConfig(config.primaryConfig)} />
      <AdvancedSelectField disabled={disabled} label="Cargo relacionado" onChange={(value) => onChange({ roleId: value || null })} options={roleOptions} placeholder="Opcional" value={stringConfig(config.roleId)} />
      <AdvancedNumberField disabled={disabled} label="Intervalo / limite" min={0} onChange={(value) => onChange({ intervalMinutes: value })} value={numberConfig(config.intervalMinutes, 10)} />
      <AdvancedToggleField checked={config.autoAction === true} disabled={disabled} label="Ação automática" onChange={(checked) => onChange({ autoAction: checked })} />
    </div>
  );
}

function AdvancedTextField({ disabled, label, onChange, placeholder, value }: { disabled: boolean; label: string; onChange: (value: string) => void; placeholder: string; value: string }) {
  return (
    <label className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
      <span className="font-semibold text-white">{label}</span>
      <input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </label>
  );
}

function AdvancedNumberField({ disabled, label, max, min, onChange, value }: { disabled: boolean; label: string; max?: number; min: number; onChange: (value: number) => void; value: number }) {
  function handleChange(rawValue: string) {
    const parsed = Number(rawValue);
    const safeValue = Number.isFinite(parsed) ? parsed : min;
    onChange(Math.min(max ?? safeValue, Math.max(min, safeValue)));
  }

  return (
    <label className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
      <span className="font-semibold text-white">{label}</span>
      <input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60" disabled={disabled} max={max} min={min} onChange={(event) => handleChange(event.target.value)} type="number" value={value} />
    </label>
  );
}

function AdvancedSelectField({ disabled, label, onChange, options, placeholder, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; placeholder: string; value: string }) {
  return (
    <label className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
      <span className="font-semibold text-white">{label}</span>
      <select className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function AdvancedMultiSelectField({ disabled, label, onChange, options, values }: { disabled: boolean; label: string; onChange: (values: string[]) => void; options: Array<{ label: string; value: string }>; values: string[] }) {
  const selected = new Set(values);

  function toggle(value: string, checked: boolean) {
    const next = new Set(selected);

    if (checked) {
      next.add(value);
    } else {
      next.delete(value);
    }

    onChange([...next]);
  }

  return (
    <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm sm:col-span-2 xl:col-span-3">
      <span className="font-semibold text-white">{label}</span>
      <div className="grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {options.length ? options.map((option) => (
          <label className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-800 bg-black px-3 py-2 text-zinc-200" key={option.value}>
            <input checked={selected.has(option.value)} className="h-4 w-4 accent-[#FFD500]" disabled={disabled} onChange={(event) => toggle(option.value, event.target.checked)} type="checkbox" />
            <span className="truncate">{option.label}</span>
          </label>
        )) : (
          <span className="text-sm text-zinc-500">Nenhum canal de voz encontrado.</span>
        )}
      </div>
    </div>
  );
}

function AdvancedToggleField({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
      <span className="font-semibold text-white">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function TagVerificationStatus({ config }: { config: Record<string, unknown> }) {
  const metrics = [
    ["Última verificação", formatTagVerificationDate(config.lastCheckAt)],
    ["Próxima verificação", formatTagVerificationDate(config.nextCheckAt)],
    ["Membros verificados", String(numberConfig(config.totalChecked, 0))],
    ["Cargos entregues", String(numberConfig(config.totalAssigned, 0))],
    ["Cargos removidos", String(numberConfig(config.totalRemoved, 0))]
  ];

  return (
    <div className="border-t border-zinc-800 pt-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value]) => (
          <div className="min-w-0 border-l-2 border-[#FFD500]/40 px-3" key={label}>
            <span className="block text-xs font-medium text-zinc-500">{label}</span>
            <span className="mt-1 block break-words text-sm font-semibold text-zinc-100">{value}</span>
          </div>
        ))}
      </div>
      {stringConfig(config.lastError) ? <p className="mt-3 text-sm font-medium text-red-300">Último erro: {stringConfig(config.lastError)}</p> : null}
    </div>
  );
}

function formatTagVerificationDate(value: unknown) {
  if (typeof value !== "string" || !value) return "Ainda não executado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Indisponível" : date.toLocaleString("pt-BR");
}

function tagVerificationStatusFields(config: Record<string, unknown>) {
  return Object.fromEntries(
    ["lastCheckAt", "nextCheckAt", "totalChecked", "totalAssigned", "totalRemoved", "totalIgnored", "totalUnavailable", "totalErrors", "lastError"]
      .filter((key) => key in config)
      .map((key) => [key, config[key]])
  );
}

function defaultAdvancedModuleConfig(moduleId: string, config: Record<string, unknown>) {
  if (moduleId === "temporary-voice") {
    return { enabled: false, panelChannelId: null, panelMessageId: null, categoryId: null, defaultUserLimit: 10, emptyDeleteMinutes: 1, logChannelId: null, autoDeleteChannelIds: [], ...config };
  }
  if (moduleId === "tag-verification") {
    return {
      enabled: false,
      requiredTag: "",
      roleId: null,
      updateIntervalMinutes: numberConfig(config.updateIntervalMinutes ?? config.intervalMinutes, 10),
      autoRemove: config.autoRemove ?? config.removeOnMismatch ?? true,
      ...config,
      intervalMinutes: undefined,
      removeOnMismatch: undefined
    };
  }

  if (moduleId === "bio-url-verification") {
    return { allowedDomains: "", enabled: false, intervalMinutes: 15, removeOnMismatch: true, roleId: null, ...config };
  }

  if (moduleId === "auto-unmute") {
    return { antiSpamSeconds: 10, delaySeconds: 0, enabled: false, requiredRoleId: null, voiceChannelId: null, ...config };
  }

  if (moduleId === "anti-disconnect") {
    return { allowedRoleIds: [], cooldownSeconds: 5, enabled: false, logChannelId: null, protectedRoleIds: [], reconnectDelayMs: 800, ...config };
  }

  if (moduleId === "anti-abuse") {
    return {
      allowedRoleIds: [],
      antiDeafenAbuseEnabled: true,
      antiDisconnectEnabled: true,
      antiKickVoiceEnabled: true,
      antiMoveAbuseEnabled: true,
      antiMuteAbuseEnabled: true,
      autoReconnectEnabled: true,
      autoUnmuteEnabled: true,
      cooldownSeconds: 5,
      enabled: false,
      immuneRoleIds: [],
      logChannelId: null,
      masterEnabled: true,
      protectedRoleIds: [],
      revertDelayMs: 600,
      strictDevOverride: true,
      ...config
    };
  }

  if (moduleId === "music") {
    return { enabled: false, commandChannelId: null, allowedChannelIds: [], blockedChannelIds: [], djRoleId: null, permissionMode: "everyone", allowedRoleIds: [], blockedUserIds: [], defaultVolume: 50, queueLimit: 100, playlistLimit: 50, artistLimit: 25, cooldownSeconds: 5, maxTrackMinutes: 15, idleDisconnectSeconds: 30, allowPlaylists: true, allowLinks: true, allowArtistSearch: true, logChannelId: null, ...config };
  }

  return { autoAction: false, enabled: false, intervalMinutes: 10, primaryConfig: "", roleId: null, ...config };
}

function stringConfig(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberConfig(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayConfig(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
}

function arrayValueConfig(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function splitIds(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function FivemView({
  botId,
  canManage,
  enabledModules,
  fivemModules,
  guild,
  mode = "general"
}: {
  botId?: string | null;
  canManage: boolean;
  enabledModules: string[];
  fivemModules: FivemModuleDefinition[];
  guild: DashboardGuild | null;
  mode?: "general" | "orders" | "goals";
}) {
  const modules = fivemUserModules(enabledModules, fivemModules, mode);

  if (!modules.length) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Nenhum módulo FiveM foi liberado para este usuário.
        </CardContent>
      </Card>
    );
  }
  const goalsEnabled = enabledModules.includes("fivem-goals");
  const ordersEnabled = enabledModules.includes("fivem-orders");

  return (
    <div className="space-y-5">
      <Card className="border-emerald-500/10 bg-zinc-950/75">
        <CardHeader>
          <CardTitle>{mode === "goals" ? "Sistema de Metas FiveM" : mode === "orders" ? "Sistema de Encomendas FiveM" : "Central FiveM"}</CardTitle>
          <CardDescription>{fivemModeDescription(mode)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {fivemModeSteps(mode).map((step) => (
            <div className="rounded-lg border border-zinc-800 bg-black/40 p-3" key={step.title}>
              <p className="text-sm font-semibold text-white">{step.title}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{step.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => (
          <Card className="border-zinc-800 bg-zinc-950/75" key={module.id}>
            <CardContent className="flex min-h-28 items-center gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                <module.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{module.label}</p>
                <p className="mt-1 text-xs text-zinc-500">{module.description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {mode === "goals" && goalsEnabled ? <FivemGoalsPanel botId={botId} canManage={canManage} guild={guild} /> : null}
      {mode === "orders" && ordersEnabled ? <FivemOrdersManager botId={botId} canManage={canManage} guild={guild} /> : null}
      {mode === "general" && enabledModules.includes("fivem-factions") ? <Pd7Panel botId={botId} canManage={canManage} guild={guild} /> : null}
    </div>
  );
}

function FivemHierarchyPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [panels, setPanels] = useState<FivemHierarchyPanelType[]>([]);
  const [draft, setDraft] = useState<FivemHierarchyPanelType | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingOfficialMessage, setRefreshingOfficialMessage] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [syncRequested, setSyncRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const officialMessageRefreshRef = useRef(false);
  const scopeRequestRef = useRef(0);
  const panelRequestRef = useRef(0);
  const latestPanelsRef = useRef<FivemHierarchyPanelType[]>([]);
  const lastPanelStateAtRef = useRef(0);
  const scopeKey = `${botId ?? ""}:${guild?.id ?? ""}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const draftInScope = Boolean(
    draft
    && guild
    && draft.guildId === guild.id
    && (draft.botId ?? null) === (botId ?? null)
  );
  const busy = loading || saving || refreshingOfficialMessage;
  const draftIsNew = Boolean(draft && isLocalHierarchyPanelId(draft.id));
  const controlsDisabled = !canManage || busy || !draftInScope;

  function markDirty(next: boolean) {
    dirtyRef.current = next;
    setDirty(next);
    if (next) {
      setMessage(null);
      setSyncRequested(false);
    }
  }

  useEffect(() => {
    const scopeRequestId = ++scopeRequestRef.current;
    const panelRequestId = ++panelRequestRef.current;
    let active = true;
    dirtyRef.current = false;
    setDirty(false);
    setSyncRequested(false);
    lastPanelStateAtRef.current = 0;
    setPanels([]);
    latestPanelsRef.current = [];
    setDraft(null);
    setChannels([]);
    setRoles([]);
    setError(null);
    setMessage(null);

    if (!guild) {
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([getFivemHierarchy(guild.id, botId), getGuildLiveOptions(guild.id, botId)])
      .then(([dashboard, options]) => {
        if (!active || scopeRequestId !== scopeRequestRef.current || scopeKeyRef.current !== scopeKey) return;
        setChannels(options.channels);
        setRoles(options.roles);
        if (panelRequestId !== panelRequestRef.current) return;
        latestPanelsRef.current = dashboard.panels;
        setPanels(dashboard.panels);
        setDraft(dashboard.panels[0] ?? createEmptyHierarchyPanel(guild.id, botId));
      })
      .catch(() => {
        if (active && scopeRequestId === scopeRequestRef.current && scopeKeyRef.current === scopeKey) {
          setError("Não foi possível carregar os Paineis de Hierarquia V2.");
        }
      })
      .finally(() => {
        if (active && scopeRequestId === scopeRequestRef.current && scopeKeyRef.current === scopeKey) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!guild) return;
    let active = true;
    const socket = createDashboardSocket();
    const refresh = (payload: { action?: string; botId?: string | null; guildId: string }) => {
      if (payload.guildId !== guild.id) return;
      if ((payload.botId ?? null) !== (botId ?? null)) return;
      const panelRequestId = ++panelRequestRef.current;

      getFivemHierarchy(guild.id, botId)
        .then((dashboard) => {
          if (!active || panelRequestId !== panelRequestRef.current || scopeKeyRef.current !== scopeKey) return;
          latestPanelsRef.current = dashboard.panels;
          setPanels(dashboard.panels);
          setDraft((current) => {
            if (dirtyRef.current || (current && isLocalHierarchyPanelId(current.id))) return current;
            return (current?.id ? dashboard.panels.find((panel) => panel.id === current.id) : null)
              ?? dashboard.panels[0]
              ?? createEmptyHierarchyPanel(guild.id, botId);
          });
          if (payload.action === "panel.state_updated") {
            lastPanelStateAtRef.current = Date.now();
            setSyncRequested(false);
            if (!dirtyRef.current) setMessage("Painel de Hierarquia V2 sincronizado.");
          }
        })
        .catch(() => {
          if (active && scopeKeyRef.current === scopeKey) {
            setError("Não foi possível atualizar os Paineis de Hierarquia V2 em tempo real.");
          }
        });
    };

    socket.on("fivem:hierarchy:updated", refresh);

    return () => {
      active = false;
      socket.off("fivem:hierarchy:updated", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  function patchDraft(patch: Partial<FivemHierarchyPanelType>) {
    if (controlsDisabled) return;
    markDirty(true);
    setError(null);
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function patchHierarchy(index: number, patch: Partial<FivemHierarchyPanelType["hierarchies"][number]>) {
    if (controlsDisabled) return;
    markDirty(true);
    setError(null);
    setDraft((current) => current ? {
      ...current,
      hierarchies: current.hierarchies.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    } : current);
  }

  function addHierarchy() {
    if (controlsDisabled) return;
    markDirty(true);
    setError(null);
    setDraft((current) => current ? {
      ...current,
      hierarchies: [...current.hierarchies, { active: true, color: null, description: null, emoji: PANEL_EMOJIS.homem, id: `hierarquia-${Date.now()}`, limit: null, name: "", order: current.hierarchies.length + 1, roleId: "", roleName: null }]
    } : current);
  }

  function removeHierarchy(index: number) {
    if (controlsDisabled) return;
    markDirty(true);
    setError(null);
    setDraft((current) => current ? {
      ...current,
      hierarchies: current.hierarchies
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }))
    } : current);
  }

  function hierarchyValidationError(panel: FivemHierarchyPanelType) {
    const selectedRoleIds = panel.hierarchies.map((item) => item.roleId).filter(Boolean);
    if (!panel.hierarchies.length) return "Adicione pelo menos um cargo ao painel.";
    if (panel.hierarchies.some((item) => !item.roleId || !item.name.trim())) return "Escolha o cargo e informe o que ele representa em todas as linhas.";
    if (new Set(selectedRoleIds).size !== selectedRoleIds.length) return "O mesmo cargo não pode aparecer duas vezes no painel.";
    if (selectedRoleIds.some((roleId) => !roles.some((role) => role.id === roleId))) return "Um dos cargos selecionados não pertence mais a este servidor.";
    if (!panel.name.trim() || !panel.title.trim()) return "Informe o nome interno e o titulo do painel.";
    if (panel.enabled && !panel.panelChannelId) return "Escolha o canal do painel antes de ativa-lo.";
    if (panel.panelChannelId && !channels.some((channel) => channel.id === panel.panelChannelId)) return "O canal selecionado não pertence mais a este servidor.";
    return null;
  }

  function upsertPanelState(panel: FivemHierarchyPanelType) {
    setPanels((current) => {
      const next = [panel, ...current.filter((item) => item.id !== panel.id && item.id !== draft?.id)];
      latestPanelsRef.current = next;
      return next;
    });
    setDraft(panel);
  }

  async function publishPanel(panel: FivemHierarchyPanelType, requestScopeKey = scopeKey) {
    if (!guild || isLocalHierarchyPanelId(panel.id) || !panel.enabled || !panel.panelChannelId) return panel;
    const refreshed = await refreshFivemHierarchyOfficialMessage(guild.id, panel.id, botId);
    if (scopeKeyRef.current !== requestScopeKey) return refreshed;
    upsertPanelState(refreshed);
    setSyncRequested(false);
    setMessage(refreshed.panelMessageId
      ? `Hierarquia publicada e atualizada: ${refreshed.panelMessageId}.`
      : "Publicação da hierarquia concluída.");
    return refreshed;
  }

  async function savePanel(options: { publishAfterSave?: boolean } = {}) {
    if (!guild || !draft || !draftInScope || loading || savingRef.current || officialMessageRefreshRef.current) return;
    const validationError = hierarchyValidationError(draft);
    if (validationError) return setError(validationError);
    const requestedAt = Date.now();
    const requestScopeKey = scopeKey;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveFivemHierarchyPanel(guild.id, draft, botId);
      if (scopeKeyRef.current !== requestScopeKey) return;
      const synchronizedPanel = lastPanelStateAtRef.current >= requestedAt
        ? latestPanelsRef.current.find((panel) => panel.id === saved.id) ?? saved
        : saved;
      upsertPanelState(synchronizedPanel);
      markDirty(false);
      const pendingSync = lastPanelStateAtRef.current < requestedAt;
      setSyncRequested(pendingSync);
      setMessage(pendingSync
        ? "Configuração salva. Sincronização do painel V2 solicitada."
        : "Configuração salva e painel V2 sincronizado.");
      if (options.publishAfterSave && synchronizedPanel.enabled && synchronizedPanel.panelChannelId) {
        officialMessageRefreshRef.current = true;
        setRefreshingOfficialMessage(true);
        await publishPanel(synchronizedPanel, requestScopeKey);
      }
      return synchronizedPanel;
    } catch (error) {
      if (scopeKeyRef.current === requestScopeKey) {
        setError(readResponseMessage(error) ?? "Não foi possível salvar o painel de hierarquia.");
      }
    } finally {
      savingRef.current = false;
      officialMessageRefreshRef.current = false;
      setSaving(false);
      setRefreshingOfficialMessage(false);
    }
  }

  async function refreshOfficialMessage() {
    if (
      !guild
      || !draft
      || !draftInScope
      || isLocalHierarchyPanelId(draft.id)
      || dirtyRef.current
      || !draft.enabled
      || !draft.panelChannelId
      || savingRef.current
      || officialMessageRefreshRef.current
    ) return;

    const requestScopeKey = scopeKey;
    officialMessageRefreshRef.current = true;
    setRefreshingOfficialMessage(true);
    setError(null);
    setMessage(null);
    try {
      await publishPanel(draft, requestScopeKey);
    } catch (requestError) {
      if (scopeKeyRef.current === requestScopeKey) {
        setError(readResponseMessage(requestError) ?? "Não foi possível verificar ou atualizar a mensagem oficial.");
      }
    } finally {
      officialMessageRefreshRef.current = false;
      setRefreshingOfficialMessage(false);
    }
  }

  async function publishHierarchy() {
    if (!guild || !draft || !draftInScope || loading || savingRef.current || officialMessageRefreshRef.current) return;
    const validationError = hierarchyValidationError(draft);
    if (validationError) return setError(validationError);
    const requestScopeKey = scopeKey;
    setError(null);
    setMessage(null);

    if (dirtyRef.current || isLocalHierarchyPanelId(draft.id)) {
      await savePanel({ publishAfterSave: true });
      return;
    }

    officialMessageRefreshRef.current = true;
    setRefreshingOfficialMessage(true);
    try {
      await publishPanel(draft, requestScopeKey);
    } catch (requestError) {
      if (scopeKeyRef.current === requestScopeKey) {
        setError(readResponseMessage(requestError) ?? "Não foi possível publicar a hierarquia.");
      }
    } finally {
      officialMessageRefreshRef.current = false;
      setRefreshingOfficialMessage(false);
    }
  }

  function selectPanel(panel: FivemHierarchyPanelType) {
    if (busy || panel.id === draft?.id) return;
    if (dirtyRef.current && !window.confirm("Descartar as alterações não salvas deste painel V2?")) return;
    setDraft(panel);
    markDirty(false);
    setSyncRequested(false);
    setError(null);
    setMessage(null);
  }

  function createPanelDraft() {
    if (!guild || busy) return;
    if (dirtyRef.current && !window.confirm("Descartar as alterações não salvas deste painel V2?")) return;
    setDraft(createEmptyHierarchyPanel(guild.id, botId));
    markDirty(false);
    setSyncRequested(false);
    setError(null);
    setMessage(null);
  }

  async function removePanel() {
    if (!guild || !draft || isLocalHierarchyPanelId(draft.id) || busy || savingRef.current || officialMessageRefreshRef.current) return;
    if (!window.confirm("Excluir este Painel de Hierarquia V2?")) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await deleteFivemHierarchyPanel(guild.id, draft.id, botId);
      const next = panels.filter((panel) => panel.id !== draft.id);
      latestPanelsRef.current = next;
      setPanels(next);
      setDraft(next[0] ?? createEmptyHierarchyPanel(guild.id, botId));
      markDirty(false);
      setSyncRequested(false);
      setMessage("Painel de Hierarquia V2 excluido.");
    } catch {
      setError("Não foi possível excluir o painel.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Card className="border-emerald-500/10 bg-zinc-950/75">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-emerald-300" /> Paineis de Hierarquia V2</CardTitle>
            <CardDescription>Mensagens oficiais com membros agrupados por cargos e sincronização automática.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!canManage || !guild || busy} onClick={createPanelDraft} size="sm" type="button" variant="outline">Novo painel V2</Button>
            <Button disabled={controlsDisabled || !draft || (!dirty && !draftIsNew)} onClick={() => void savePanel()} size="sm" type="button">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {saving ? "Salvando e solicitando sincronização..." : "Salvar e atualizar painel V2"}
            </Button>
            <Button
              disabled={controlsDisabled || !draft || !draft.enabled || !draft.panelChannelId}
              onClick={() => void publishHierarchy()}
              size="sm"
              type="button"
            >
              {refreshingOfficialMessage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {refreshingOfficialMessage ? "Publicando hierarquia..." : "Publicar hierarquia"}
            </Button>
            <Button
              disabled={controlsDisabled || draftIsNew || dirty || !draft?.enabled || !draft.panelChannelId}
              onClick={() => void refreshOfficialMessage()}
              size="sm"
              type="button"
              variant="outline"
            >
              {refreshingOfficialMessage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {refreshingOfficialMessage ? "Verificando mensagem oficial..." : "Verificar/atualizar mensagem oficial"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
        {draftInScope && draft ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={draft.panelMessageId ? "success" : "warning"}>Mensagem oficial: {draft.panelMessageId ?? "aguardando primeira sincronização"}</Badge>
            <Badge>Versao do painel: V2</Badge>
            <Badge variant={draftIsNew || dirty ? "warning" : syncRequested ? "default" : "success"}>
              {draftIsNew ? "Novo painel não salvo" : dirty ? "Alterações não salvas" : syncRequested ? "Salvo · sincronização solicitada" : "Configuração salva"}
            </Badge>
          </div>
        ) : null}
        {loading || !draft || !draftInScope ? <div className="h-40 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60" /> : (
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-2">
              {panels.map((panel) => (
                <button className={`w-full rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${draft.id === panel.id ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-800 bg-black/30"}`} disabled={busy} key={panel.id} onClick={() => selectPanel(panel)} type="button">
                  <p className="text-sm font-semibold text-white">{panel.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{panel.hierarchies.length} hierarquias · {panel.enabled ? "ativo" : "desativado"}</p>
                </button>
              ))}
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <TicketField disabled={controlsDisabled} label="Nome interno" onChange={(value) => patchDraft({ name: value })} value={draft.name} />
                <TicketField disabled={controlsDisabled} label="Titulo do painel" onChange={(value) => patchDraft({ title: value })} value={draft.title} />
                <FivemChannelSelect channels={channels} disabled={controlsDisabled} label="Canal do painel" onChange={(value) => patchDraft({ panelChannelId: value })} placeholder="Selecione" value={draft.panelChannelId} />
                <FivemChannelSelect channels={channels} disabled={controlsDisabled} label="Canal de logs" onChange={(value) => patchDraft({ logChannelId: value })} placeholder="Sem logs" value={draft.logChannelId} />
                <TicketField disabled={controlsDisabled} label="Cor" onChange={(value) => patchDraft({ color: value })} type="color" value={draft.color} />
                <label className="flex h-10 items-center justify-between rounded-md border border-zinc-800 bg-[#09090b] px-3 text-xs font-medium text-zinc-300">
                  Painel ativo
                  <Switch checked={draft.enabled} disabled={controlsDisabled} onCheckedChange={(enabled) => patchDraft({ enabled })} />
                </label>
                <div className="md:col-span-2">
                  <TicketArea disabled={controlsDisabled} label="Descrição" onChange={(value) => patchDraft({ description: value })} value={draft.description ?? ""} />
                </div>
                <MultiRoleSelect disabled={controlsDisabled} label="Cargos gestores desta hierarquia" onChange={(values) => patchDraft({ managerRoleIds: values })} roles={roles} values={draft.managerRoleIds} />
                <MultiRoleSelect disabled={controlsDisabled} label="Cargos de comando desta hierarquia" onChange={(values) => patchDraft({ commandRoleIds: values })} roles={roles} values={draft.commandRoleIds} />
              </div>
              <div className="space-y-3">
                {!isLocalHierarchyPanelId(draft.id) ? (
                  <PanelImageSettings
                    botId={botId}
                    canManage={canManage && !busy}
                    componentsV2Only
                    guildId={guild?.id ?? null}
                    panelId={fivemHierarchyVisualPanelId(draft.id)}
                    panelLabel={`Imagem da hierarquia - ${draft.name || draft.title}`}
                  />
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-xs text-zinc-400">
                    Salve o painel V2 antes de configurar sua imagem oficial.
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Cargos exibidos no painel</p>
                    <p className="mt-1 text-xs text-zinc-500">Escolha um cargo do Discord e defina o nome da funcao que aparecera acima dos membros.</p>
                  </div>
                  <Button disabled={controlsDisabled} onClick={addHierarchy} size="sm" type="button" variant="outline">Adicionar cargo</Button>
                </div>
                {draft.hierarchies.map((item, index) => (
                  <div className="grid gap-3 rounded-lg border border-zinc-800 bg-black/30 p-3 md:grid-cols-[1.2fr_1fr_80px_90px_auto]" key={item.id}>
                    <RoleSelect disabled={controlsDisabled} label="Cargo do Discord" onChange={(value) => patchHierarchy(index, { roleId: value, roleName: roles.find((role) => role.id === value)?.name ?? null })} roles={roles} value={item.roleId} />
                    <TicketField disabled={controlsDisabled} label="Exibir como" onChange={(value) => patchHierarchy(index, { name: value })} value={item.name} />
                    <TicketField disabled={controlsDisabled} label="Emoji" onChange={(value) => patchHierarchy(index, { emoji: value })} value={item.emoji ?? ""} />
                    <TicketField disabled={controlsDisabled} label="Ordem" onChange={(value) => patchHierarchy(index, { order: Number(value) || index + 1 })} value={String(item.order)} />
                    <div className="flex items-end">
                      <Button disabled={controlsDisabled} onClick={() => removeHierarchy(index)} size="icon" title="Remover cargo" type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
                {!draft.hierarchies.length ? <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">Nenhum cargo configurado. Clique em Adicionar cargo para comecar.</div> : null}
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-100">
                  Ao salvar, uma única sincronização V2 e solicitada. A mensagem oficial existente será atualizada pelo bot.
                </div>
              </div>
              {!isLocalHierarchyPanelId(draft.id) ? <Button disabled={controlsDisabled} onClick={() => void removePanel()} size="sm" type="button" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir painel V2</Button> : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function createEmptyHierarchyPanel(guildId: string, botId?: string | null): FivemHierarchyPanelType {
  const now = new Date().toISOString();
  return {
    allowedRoleIds: [],
    botId: botId ?? null,
    color: "#22c55e",
    commandRoleIds: [],
    commandUserIds: [],
    configRevision: 1,
    contentHash: null,
    createdAt: now,
    createdBy: null,
    description: "Hierarquia atualizada automaticamente pelos cargos do servidor.",
    enabled: true,
    footerEnabled: true,
    footerIconUrl: null,
    footerText: "Atualizado automaticamente",
    guildId,
    hierarchies: [],
    id: hierarchyPanelDraftId(globalThis.crypto.randomUUID()),
    imagePosition: "none",
    imageUrl: null,
    linkedToFivem: true,
    logChannelId: null,
    managerRoleIds: [],
    managerUserIds: [],
    name: "Painel de Hierarquia V2",
    panelChannelId: null,
    panelMessageId: null,
    panelVersion: 2,
    publishedAt: null,
    status: "draft",
    title: "Hierarquia Policial",
    updatedAt: now
  };
}

function FivemGoalsPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [settings, setSettings] = useState<FivemGoalSettings | null>(null);
  const [entries, setEntries] = useState<FivemGoalEntry[]>([]);
  const [configs, setConfigs] = useState<FivemGoalConfig[]>([]);
  const [submissions, setSubmissions] = useState<FivemGoalSubmission[]>([]);
  const [report, setReport] = useState<FivemGoalReport | null>(null);
  const [draft, setDraft] = useState<FivemGoalConfig | null>(null);
  const [goalFilter, setGoalFilter] = useState("all");
  const [goalSearch, setGoalSearch] = useState("");
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!guild) return;
    let active = true;
    setLoading(true);
    Promise.all([getFivemGoals(guild.id, botId), getGuildLiveOptions(guild.id, botId)])
      .then(([dashboard, options]) => {
        if (!active) return;
        setSettings(dashboard.settings);
        setEntries(dashboard.entries);
        setConfigs(dashboard.configs ?? []);
        setSubmissions(dashboard.submissions ?? []);
        setReport(dashboard.report ?? null);
        setDraft((dashboard.configs ?? [])[0] ?? null);
        setChannels(options.channels);
        setCategories((options.categories ?? []).map((category) => ({ ...category, parentId: null, type: "text" as const })));
        setRoles(options.roles);
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar metas FiveM.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!guild) return;
    const socket = createDashboardSocket();
    const refreshReport = (payload: { botId?: string | null; guildId: string }) => {
      if (payload.guildId !== guild.id || (payload.botId ?? null) !== (botId ?? null)) return;
      void getFivemGoals(guild.id, botId).then((dashboard) => {
        setSettings(dashboard.settings);
        setEntries(dashboard.entries);
        setConfigs(dashboard.configs ?? []);
        setSubmissions(dashboard.submissions ?? []);
        setReport(dashboard.report ?? null);
        setDraft((current) => (dashboard.configs ?? []).find((config) => config.id === current?.id) ?? current);
      }).catch(() => null);
    };
    socket.on("fivem:goals:updated", refreshReport);
    return () => {
      socket.off("fivem:goals:updated", refreshReport);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  function patch(patchValue: Partial<FivemGoalSettings>) {
    setSettings((current) => current ? { ...current, ...patchValue } : current);
  }

  function patchDraft(patchValue: Partial<FivemGoalConfig>) {
    setDraft((current) => current ? { ...current, ...patchValue } : current);
  }

  function patchField(index: number, value: Partial<FivemGoalField>) {
    setSettings((current) => current ? { ...current, fields: current.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...value } : field) } : current);
  }

  function patchItem(index: number, value: Partial<FivemGoalItem>) {
    setSettings((current) => current ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) } : current);
  }

  function addItem() {
    setSettings((current) => current ? { ...current, items: [...current.items, { category: "Geral", color: "#FFD500", emoji: PANEL_EMOJIS.caixa, enabled: true, id: `item-${current.items.length + 1}`, name: `Item ${current.items.length + 1}`, order: current.items.length + 1 }] } : current);
  }

  async function save() {
    if (!guild || !settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveFivemGoalSettings(guild.id, settings, botId);
      setSettings(saved);
      setMessage("Metas FiveM salvas.");
    } catch {
      setError("Não foi possível salvar metas FiveM.");
    } finally {
      setSaving(false);
    }
  }

  function createDraft() {
    if (!guild) return;
    setDraft({
      approverRoleIds: [],
      botId: botId ?? null,
      createdAt: new Date().toISOString(),
      createdBy: null,
      currentValue: 0,
      deleteRoleIds: [],
      description: "",
      editRoleIds: [],
      fields: settings?.fields ?? [],
      guildId: guild.id,
      id: "new",
      logChannelId: settings?.logChannelId ?? null,
      managerRoleIds: settings?.managerRoleId ? [settings.managerRoleId] : [],
      name: "Nova Meta",
      panelChannelId: null,
      panelMessageId: null,
      participantRoleIds: settings?.viewRoleId ? [settings.viewRoleId] : [],
      period: "weekly",
      requiresApproval: false,
      requiresProof: true,
      resetConfig: { customDate: null, enabled: false, frequency: "none" },
      rules: "",
      status: "active",
      targetValue: 1,
      totalParticipants: 0,
      type: "personalizada",
      updatedAt: new Date().toISOString(),
      viewerRoleIds: []
    });
  }

  async function saveDraft() {
    if (!guild || !draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = draft.id === "new"
        ? await createFivemGoalConfig(guild.id, draft, botId)
        : await updateFivemGoalConfig(guild.id, draft.id, draft, botId);
      setConfigs((current) => [saved, ...current.filter((config) => config.id !== saved.id)]);
      setDraft(saved);
      setMessage("Meta salva.");
    } catch {
      setError("Não foi possível salvar a meta.");
    } finally {
      setSaving(false);
    }
  }

  async function publishRequestPanel() {
    if (!guild || !settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await publishFivemGoalPanel(guild.id, botId);
      setSettings(saved);
      setMessage("Painel de solicitação enviado para o bot atualizar no Discord.");
    } catch {
      setError("Não foi possível publicar o painel. Confira canal, permissão do bot e se o sistema está ativo.");
    } finally {
      setSaving(false);
    }
  }

  async function removeDraft(deleteHistory = false) {
    if (!guild || !draft || draft.id === "new") return;
    if (!window.confirm(deleteHistory ? "Excluir esta meta e todo o histórico vinculado?" : "Excluir esta meta sem apagar o histórico?")) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await deleteFivemGoalConfig(guild.id, draft.id, deleteHistory, botId);
      const next = configs.filter((config) => config.id !== draft.id);
      setConfigs(next);
      setDraft(next[0] ?? null);
      setMessage(deleteHistory ? "Meta e histórico excluidos." : "Meta excluida. Histórico preservado.");
    } catch {
      setError("Não foi possível excluir a meta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-emerald-500/10 bg-zinc-950/75">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-emerald-300" /> Gerenciamento de Metas FiveM</CardTitle>
            <CardDescription>Metas independentes com cargos, canais, comprovantes, aprovação e histórico.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!canManage || !settings || saving || loading} onClick={createDraft} size="sm" type="button" variant="outline">
              <ListChecks className="mr-2 h-4 w-4" />
              Criar Meta
            </Button>
            <Button disabled={!canManage || !settings || saving || loading} onClick={() => void save()} size="sm" type="button">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Salvar Geral
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
        {loading || !settings ? <div className="h-40 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60" /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <MetricCard icon={ListChecks} label="Metas criadas" value={String(configs.length)} />
              <MetricCard icon={Users} label="Participantes" value={String(new Set(submissions.map((entry) => entry.userId)).size || new Set(entries.map((entry) => entry.userId)).size)} />
              <MetricCard icon={Clock3} label="Pendentes" value={String(submissions.filter((entry) => entry.status === "pending").length)} />
              <MetricCard icon={CalendarClock} label="Hoje" value={String(entries.filter((entry) => new Date(entry.createdAt).toDateString() === new Date().toDateString()).length)} />
            </div>
            {report ? (
              <section className="border-y border-zinc-800 py-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Relatório automático da semana</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(report.periodStart).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} até {new Date(new Date(report.periodEnd).getTime() - 1).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      {` - ${report.totalRecords} registros`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">Total oficial aprovado</p>
                    <p className="text-xl font-semibold text-emerald-300">{formatGoalCurrency(report.totalApprovedValue)}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <MetricCard icon={Users} label="Pagadores" value={String(report.participantCount)} />
                  <MetricCard icon={CheckCircle2} label="Aprovadas" value={String(report.approvedCount)} />
                  <MetricCard icon={Clock3} label="Pendentes" value={`${report.pendingCount} (${formatGoalCurrency(report.totalPendingValue)})`} />
                  <MetricCard icon={XCircle} label="Reprovadas" value={String(report.refusedCount)} />
                </div>
                {report.types.length ? (
                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-zinc-900 pt-3 text-sm">
                    {report.types.map((type) => (
                      <div className="flex items-center gap-2" key={type.metaId}>
                        <span className="text-zinc-500">{type.name}</span>
                        <span className="font-semibold text-zinc-200">{formatGoalCurrency(type.totalApprovedValue)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {report.members.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="border-b border-zinc-800 text-xs text-zinc-500">
                        <tr><th className="pb-2 font-medium">Ranking</th><th className="pb-2 font-medium">Usuário</th><th className="pb-2 font-medium">Aprovadas</th><th className="pb-2 font-medium">Pendentes</th><th className="pb-2 text-right font-medium">Total aprovado</th></tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900">
                        {report.members.slice(0, 20).map((member, index) => (
                          <tr key={member.userId}>
                            <td className="py-2 text-zinc-500">{index + 1}o</td>
                            <td className="py-2 font-medium text-zinc-200">{member.userId}</td>
                            <td className="py-2 text-emerald-300">{member.approvedCount}</td>
                            <td className="py-2 text-amber-300">{member.pendingCount}</td>
                            <td className="py-2 text-right font-semibold text-white">{formatGoalCurrency(member.totalApprovedValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="mt-4 text-sm text-zinc-500">Nenhuma meta registrada nesta semana.</p>}
              </section>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                    <input className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] pl-9 pr-3 text-sm text-zinc-100" onChange={(event) => setGoalSearch(event.target.value)} placeholder="Buscar meta" value={goalSearch} />
                  </div>
                  <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setGoalFilter(event.target.value)} value={goalFilter}>
                    <option value="all">Todas</option>
                    <option value="active">Ativas</option>
                    <option value="paused">Pausadas</option>
                    <option value="finished">Finalizadas</option>
                    <option value="daily">Diarias</option>
                    <option value="weekly">Semanais</option>
                    <option value="monthly">Mensais</option>
                    <option value="custom">Personalizadas</option>
                  </select>
                </div>
                <div className="grid gap-3">
                  {configs
                    .filter((config) => goalFilter === "all" || config.status === goalFilter || config.period === goalFilter)
                    .filter((config) => `${config.name} ${config.type} ${config.description ?? ""}`.toLowerCase().includes(goalSearch.toLowerCase()))
                    .map((config) => {
                      const progress = Math.min(100, Math.round((config.currentValue / Math.max(1, config.targetValue)) * 100));
                      return (
                        <button className={`rounded-lg border p-3 text-left transition ${draft?.id === config.id ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"}`} key={config.id} onClick={() => setDraft(config)} type="button">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-white">{config.name}</p>
                              <p className="mt-1 text-xs text-zinc-400">{config.type} - {config.period} - {config.participantRoleIds.length} cargos</p>
                            </div>
                            <Badge variant={config.status === "active" ? "success" : config.status === "paused" ? "warning" : "muted"}>{config.status}</Badge>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} />
                          </div>
                          <div className="mt-2 flex justify-between text-xs text-zinc-500">
                            <span>{config.currentValue} / {config.targetValue}</span>
                            <span>{config.totalParticipants} participantes</span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
              {draft ? (
                <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{draft.id === "new" ? "Criar meta" : "Editar meta"}</p>
                    <Button disabled={!canManage || saving} onClick={() => void saveDraft()} size="sm" type="button">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Salvar</Button>
                  </div>
                  <TicketField disabled={!canManage} label="Nome" onChange={(value) => patchDraft({ name: value })} value={draft.name} />
                  <TicketField disabled={!canManage} label="Descrição" onChange={(value) => patchDraft({ description: value })} value={draft.description ?? ""} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TicketField disabled={!canManage} label="Tipo" onChange={(value) => patchDraft({ type: value })} value={draft.type} />
                    <TicketField disabled={!canManage} label="Valor necessário" onChange={(value) => patchDraft({ targetValue: Number(value) || 1 })} value={String(draft.targetValue)} />
                    <label className="block text-xs font-medium text-zinc-400">Status
                      <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchDraft({ status: event.target.value as FivemGoalConfig["status"] })} value={draft.status}>
                        <option value="active">Ativa</option>
                        <option value="paused">Pausada</option>
                        <option value="finished">Finalizada</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-zinc-400">Periodo
                      <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchDraft({ period: event.target.value as FivemGoalConfig["period"] })} value={draft.period}>
                        <option value="daily">Diaria</option>
                        <option value="weekly">Semanal</option>
                        <option value="monthly">Mensal</option>
                        <option value="custom">Personalizada</option>
                      </select>
                    </label>
                  </div>
                  <FivemChannelSelect channels={channels} disabled={!canManage} label="Canal do painel" onChange={(value) => patchDraft({ panelChannelId: value })} placeholder="Sem painel" value={draft.panelChannelId} />
                  <FivemChannelSelect channels={channels} disabled={!canManage} label="Canal de logs" onChange={(value) => patchDraft({ logChannelId: value })} placeholder="Sem logs" value={draft.logChannelId} />
                  <MultiRoleSelect disabled={!canManage} label="Cargos participantes" onChange={(value) => patchDraft({ participantRoleIds: value })} roles={roles} values={draft.participantRoleIds} />
                  <MultiRoleSelect disabled={!canManage} label="Cargos administradores" onChange={(value) => patchDraft({ managerRoleIds: value })} roles={roles} values={draft.managerRoleIds} />
                  <MultiRoleSelect disabled={!canManage} label="Cargos aprovadores" onChange={(value) => patchDraft({ approverRoleIds: value })} roles={roles} values={draft.approverRoleIds} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={draft.requiresProof} disabled={!canManage} onChange={(event) => patchDraft({ requiresProof: event.target.checked })} type="checkbox" /> Exigir comprovante</label>
                    <label className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={draft.requiresApproval} disabled={!canManage} onChange={(event) => patchDraft({ requiresApproval: event.target.checked })} type="checkbox" /> Aprovação manual</label>
                  </div>
                  <TicketField disabled={!canManage} label="Regras" onChange={(value) => patchDraft({ rules: value })} value={draft.rules ?? ""} />
                  {draft.id !== "new" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={!canManage || saving} onClick={() => void removeDraft(false)} size="sm" type="button" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir meta</Button>
                      <Button disabled={!canManage || saving} onClick={() => void removeDraft(true)} size="sm" type="button" variant="outline">Excluir com histórico</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-400">Status
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patch({ enabled: event.target.value === "true" })} value={String(settings.enabled)}>
                  <option value="true">Ativado</option>
                  <option value="false">Desativado</option>
                </select>
              </label>
              <TicketField disabled={!canManage} label="Modelo do nome do canal" onChange={(value) => patch({ channelNameTemplate: value })} value={settings.channelNameTemplate} />
              <FivemChannelSelect channels={categories} disabled={!canManage} label="Categoria dos canais" onChange={(value) => patch({ categoryId: value })} placeholder="Sem categoria" prefix="" value={settings.categoryId} />
              <FivemChannelSelect channels={channels} disabled={!canManage} label="Canal de logs" onChange={(value) => patch({ logChannelId: value })} placeholder="Sem logs" value={settings.logChannelId} />
              <RoleSelect disabled={!canManage} label="Cargo que pode visualizar" onChange={(value) => patch({ viewRoleId: value || null })} roles={roles} value={settings.viewRoleId ?? ""} />
              <RoleSelect disabled={!canManage} label="Cargo administrador" onChange={(value) => patch({ managerRoleId: value || null })} roles={roles} value={settings.managerRoleId ?? ""} />
            </div>
            <label className="flex items-center gap-3 border-y border-zinc-800 py-3 text-sm text-zinc-300">
              <input checked={settings.autoCreateWithManualRegistration} disabled={!canManage} onChange={(event) => patch({ autoCreateWithManualRegistration: event.target.checked })} type="checkbox" />
              <span><strong className="block text-white">Vincular Pedido de Set com Metas</strong><span className="text-xs text-zinc-500">Ao aprovar um set, cria ou localiza automaticamente o canal individual de meta do membro.</span></span>
            </label>
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Painel de Solicitação de Canal de Meta</p>
                  <p className="mt-1 text-sm text-zinc-400">Use quando o Pedido Set estiver desligado ou quando quiser permitir solicitação manual do canal individual.</p>
                </div>
                <Button disabled={!canManage || saving || !settings.enabled || !settings.requestPanelChannelId} onClick={() => void publishRequestPanel()} size="sm" type="button">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Enviar/Atualizar painel
                </Button>
              </div>
              {settings.enabled && settings.requestPanelEnabled && !settings.requestPanelChannelId ? (
                <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Configure o canal onde os membros vao solicitar o canal de meta.</div>
              ) : null}
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-xs font-medium text-zinc-400">Painel manual
                    <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patch({ requestPanelEnabled: event.target.value === "true" })} value={String(settings.requestPanelEnabled)}>
                      <option value="true">Ativado</option>
                      <option value="false">Desativado</option>
                    </select>
                  </label>
                  <FivemChannelSelect channels={channels} disabled={!canManage} label="Canal do painel" onChange={(value) => patch({ requestPanelChannelId: value })} placeholder="Selecione um canal" value={settings.requestPanelChannelId} />
                  <TicketField disabled={!canManage} label="Titulo do painel" onChange={(value) => patch({ requestPanelTitle: value })} value={settings.requestPanelTitle} />
                  <label className="flex items-end gap-2 text-xs text-zinc-300">
                    <span className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 px-3">
                      <input checked={settings.requestRequiresApproval} disabled={!canManage} onChange={(event) => patch({ requestRequiresApproval: event.target.checked })} type="checkbox" />
                      Exigir aprovação manual
                    </span>
                  </label>
                  <div className="md:col-span-2">
                    <TicketArea disabled={!canManage} label="Texto do painel" onChange={(value) => patch({ requestPanelDescription: value })} value={settings.requestPanelDescription} />
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Prévia Components V2</p>
                  <div className="mt-3 rounded-lg border-l-4 border-emerald-400 bg-[#101013] p-4">
                    <p className="text-base font-semibold text-white">{settings.requestPanelTitle}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{settings.requestPanelDescription}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-white">Solicitar canal de meta</span>
                      <span className="rounded-md bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200">Ajuda</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-white">Campos do modal</p>
              {settings.fields.map((field, index) => (
                <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-[1fr_1fr_120px]" key={`fivem-goal-field-${index}`}>
                  <TicketField disabled={!canManage} label="Label" onChange={(value) => patchField(index, { id: slugTicketOption(value, index), label: value })} value={field.label} />
                  <TicketField disabled={!canManage} label="Placeholder" onChange={(value) => patchField(index, { placeholder: value })} value={field.placeholder ?? ""} />
                  <label className="block text-xs font-medium text-zinc-400">Tipo
                    <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchField(index, { style: event.target.value as FivemGoalField["style"] })} value={field.style}>
                      <option value="short">Curto</option>
                      <option value="paragraph">Longo</option>
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Itens de meta</p>
                <Button disabled={!canManage} onClick={addItem} size="sm" type="button" variant="outline">Adicionar item</Button>
              </div>
              {settings.items.map((item, index) => (
                <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 lg:grid-cols-[90px_1fr_1fr_100px_90px]" key={`fivem-goal-item-${index}`}>
                  <TicketField disabled={!canManage} label="Emoji" onChange={(value) => patchItem(index, { emoji: value })} value={item.emoji ?? ""} />
                  <TicketField disabled={!canManage} label="Nome" onChange={(value) => patchItem(index, { id: slugTicketOption(value, index), name: value })} value={item.name} />
                  <TicketField disabled={!canManage} label="Categoria" onChange={(value) => patchItem(index, { category: value })} value={item.category ?? ""} />
                  <TicketField disabled={!canManage} label="Cor" onChange={(value) => patchItem(index, { color: value })} type="color" value={item.color ?? "#FFD500"} />
                  <label className="flex items-end gap-2 text-xs text-zinc-300"><span className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 px-3"><input checked={item.enabled} disabled={!canManage} onChange={(event) => patchItem(index, { enabled: event.target.checked })} type="checkbox" />Ativo</span></label>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard icon={ListChecks} label="Metas" value={String(entries.length)} />
              <MetricCard icon={Users} label="Usuários" value={String(new Set(entries.map((entry) => entry.userId)).size)} />
              <MetricCard icon={CalendarClock} label="Hoje" value={String(entries.filter((entry) => new Date(entry.createdAt).toDateString() === new Date().toDateString()).length)} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function fivemModeDescription(mode: "general" | "orders" | "goals") {
  if (mode === "goals") {
    return "Metas e registros por membro ficam em um fluxo próprio: cadastro aprovado cria canal individual, o membro envia foto/quantidade e a lideranca acompanha tudo por histórico.";
  }

  if (mode === "orders") {
    return "Encomendas ficam em um fluxo próprio: pedido, fila, produção, entrega, cancelamento e logs. Não mistura com metas, ausências ou financeiro.";
  }

  return "Central dos modulos FiveM liberados para este bot. Metas e Encomendas possuem menus próprios quando liberados; Hierarquia fica na área Polícia.";
}

function fivemModeSteps(mode: "general" | "orders" | "goals") {
  if (mode === "goals") {
    return [
      { title: "1. Cadastro aprovado", description: "O sistema usa o cadastro manual/FiveM para identificar o membro e criar ou localizar o canal individual." },
      { title: "2. Registro da meta", description: "O membro envia item, quantidade, foto e campos configurados no modal Components V2." },
      { title: "3. Acompanhamento", description: "A dashboard mostra registros, usuários, metas do dia e logs do servidor." }
    ];
  }

  if (mode === "orders") {
    return [
      { title: "1. Pedido", description: "O cliente escolhe o produto ou tipo de encomenda e envia quantidade, prioridade e observação." },
      { title: "2. Fila da equipe", description: "A staff acompanha pedidos pendentes, em produção, prontos, entregues e cancelados." },
      { title: "3. Logs e histórico", description: "Cada mudança de status deve gerar registro isolado para este bot e servidor." }
    ];
  }

  return [
    { title: "Modulos liberados", description: "Somente os sistemas autorizados na Dashboard DEV aparecem para o cliente." },
    { title: "Escopo isolado", description: "As configurações ficam vinculadas ao bot selecionado e ao servidor atual." },
    { title: "Menus dedicados", description: "Hierarquia, Metas e Encomendas aparecem separados para evitar confusao operacional." }
  ];
}

function fivemUserModules(enabledModules: string[], fivemModules: FivemModuleDefinition[], mode: "general" | "orders" | "goals" = "general") {
  const fallbackCatalog: FivemModuleDefinition[] = [
    { builtIn: true, description: "Controle de membros, cargos e operação das facções.", id: "fivem-factions", permissions: "Admin FiveM", title: "Facções" },
    { builtIn: true, description: "Gestao operacional de corporacoes e equipes.", id: "fivem-corporations", permissions: "Admin FiveM", title: "Corporacoes" },
    { builtIn: true, description: "Solicitacoes e aprovação de ausências RP.", id: "fivem-absences", permissions: "Admin FiveM", title: "Ausência" },
    { builtIn: true, description: "Pedidos, entregas e acompanhamento de encomendas.", id: "fivem-orders", permissions: "Admin FiveM", title: "Encomendas" },
    { builtIn: true, description: "Lavagem RP com regras de porcentagem, cálculo automático, logs e histórico.", id: "fivem-washing", permissions: "Admin FiveM", title: "Sistema de Lavagem" },
    { builtIn: true, description: "Drogas, famílias autorizadas, pedidos, produção, logs e histórico isolados.", id: "fivem-drugs", permissions: "Admin FiveM", title: "Sistema de Drogas" },
    { builtIn: true, description: "Pedidos, produção, entrega, logs e financeiro de munições.", id: "fivem-ammo", permissions: "Admin FiveM", title: "Municoes" },
    { builtIn: true, description: "Fluxo financeiro, caixa e lancamentos RP.", id: "fivem-finance", permissions: "Admin FiveM", title: "Financeiro" },
    { builtIn: true, description: "Metas por membro com fotos e registros via Components V2.", id: "fivem-goals", permissions: "Admin FiveM", title: "Metas" },
    { builtIn: true, description: "Verificação inteligente por CAPTCHA integrada ao fluxo FiveM.", id: "fivem-captcha", permissions: "Admin FiveM", title: "CAPTCHA FiveM" },
    { builtIn: true, description: "Paineis oficiais V2 sincronizados por cargos.", id: "fivem-hierarchy", permissions: "Admin Polícia", title: "Paineis de Hierarquia V2" },
    { builtIn: true, description: "Ações profissionais da FAC com painel, participantes e relatórios separados.", id: "fivem-actions", permissions: "Admin FiveM", title: "Ações FAC" },
    { builtIn: true, description: "Solicitacoes e aprovação de ausências para oficiais.", id: "police-absences", permissions: "Admin Polícia", title: "Ausência Policial" },
    { builtIn: true, description: "Operações policiais com painel, participantes e relatórios separados.", id: "police-actions", permissions: "Admin Polícia", title: "Ações Políciais" },
    { builtIn: true, description: "Relatórios de patrulhamento exclusivos para oficiais.", id: "police-patrol-reports", permissions: "Admin Polícia", title: "Relatórios Políciais" },
    { builtIn: true, description: "Registro de QRUs com evidências, oficiais envolvidos e ranking automático.", id: "police-qru", permissions: "Admin Polícia", title: "Registro de QRU" },
    { builtIn: true, description: "Solicitações de promoção com avaliação, aprovação, cargos e histórico.", id: "police-promotions", permissions: "Admin Polícia", title: "Promoções de Patente" },
    { builtIn: true, description: "Registros automáticos de veículos abandonados por imagem.", id: "vehicle-abandonment", permissions: "Admin Polícia", title: "Abandono de Veículo" },
    { builtIn: true, description: "Canal anonimo policial com logs administrativos.", id: "police-hidden-channel", permissions: "Admin Polícia", title: "Canal Oculto" },
    { builtIn: true, description: "Mensagens com nome e avatar do usuário autorizado via webhook.", id: "visible-message", permissions: "Admin Polícia", title: "Mensagem Visível" },
    { builtIn: true, description: "Envio de mensagens privadas com painel visual e logs.", id: "police-dm", permissions: "Admin Polícia", title: "Barra DM" },
    { builtIn: true, description: "Denuncias anonimas/identificadas com órgãos, logs e auditoria.", id: "police-iab", permissions: "Admin Polícia", title: "Denuncias Corregedoria" },
    { builtIn: true, description: "Intimacoes institucionais com DMs, prazos e competência por órgão.", id: "police-subpoenas", permissions: "Admin Polícia", title: "Intimacao" },
    { builtIn: true, description: "Notificações policiais por DM, canal mencionado, contador de avisos verbais e alertas administrativos.", id: "police-open-duty", permissions: "Admin Polícia", title: "Notificar / Ponto Aberto" }
  ];
  const catalog = fivemModules.length ? fivemModules : fallbackCatalog;
  const enabled = new Set(enabledModules.map((moduleId) => moduleId === "fivem-fac" ? "fivem-absences" : moduleId));

  return catalog
    .filter((module) => enabled.has(module.id))
    .filter((module) => {
      if (mode === "orders") return module.id === "fivem-orders";
      if (mode === "goals") return module.id === "fivem-goals";
      return module.id !== "fivem-orders" && module.id !== "fivem-goals" && module.id !== "fivem-hierarchy" && module.id !== "fivem-absences" && module.id !== "police-absences" && module.id !== "police-actions" && module.id !== "police-patrol-reports" && module.id !== "police-qru" && module.id !== "police-promotions" && module.id !== "vehicle-abandonment" && module.id !== "police-hidden-channel" && module.id !== "visible-message" && module.id !== "police-dm" && module.id !== "police-iab" && module.id !== "police-subpoenas" && module.id !== "police-open-duty";
    })
    .map((module) => ({
      description: module.description,
      icon: fivemIconForModule(module.id),
      id: module.id,
      label: userFivemModuleLabel(module)
    }));
}

function fivemIconForModule(moduleId: string) {
  const icons: Record<string, typeof Bot> = {
    "fivem-ammo": Shield,
    "fivem-absences": CalendarClock,
    "fivem-corporations": Server,
    "fivem-factions": Building2,
    "fivem-finance": Activity,
    "fivem-washing": CircleDollarSign,
    "fivem-goals": ListChecks,
    "fivem-captcha": ShieldCheck,
    "fivem-actions": Activity,
    "fivem-drugs": Boxes,
    "fivem-hierarchy": Users,
    "fivem-orders": ListChecks,
    "police-absences": CalendarClock,
    "police-actions": Activity,
    "police-qru": ShieldCheck,
    "police-promotions": BadgeCheck,
    "vehicle-abandonment": Car,
    "police-hidden-channel": EyeOff,
    "visible-message": MessageCircle,
    "police-dm": UserPlus,
    "police-iab": ShieldAlert,
    "police-subpoenas": ScrollText,
    "police-open-duty": Bell
  };

  return icons[moduleId] ?? Boxes;
}

function userFivemModuleLabel(module: FivemModuleDefinition) {
  return module.title
    .replace(/^Sistema\s+de\s+/i, "")
    .replace(/^Sistema\s+/i, "")
    .trim();
}

function DashboardRouteError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4">
      <Card className="w-full max-w-lg border-red-500/20 bg-zinc-950/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-red-300" />
            Acesso não liberado
          </CardTitle>
          <CardDescription>
            {message || "Você não possui acesso a esta dashboard. Verifique se o plano está em dia ou entre em contato com o suporte."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button className="flex-1" onClick={() => window.history.back()} variant="outline">
            Voltar
          </Button>
          <Button asChild className="flex-1">
            <a href={SUPPORT_URL} rel="noreferrer" target="_blank">
              <Headphones className="h-4 w-4" />
              Falar com suporte
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function canManageModule(bot: DashboardBot | null, moduleId: string, fallback: boolean) {
  if (!bot) {
    return fallback;
  }

  if (!isModuleReleasedForBot(bot, moduleId)) {
    return false;
  }

  if (bot.accessLevel === "admin") {
    return true;
  }

  if (bot.accessLevel === "moderator") {
    return moduleId !== "verification";
  }

  if (bot.accessLevel === "premium") {
    return [
      "live",
      "kick-integration",
      "clips",
      "giveaway",
      "payment-gateway",
      "manual-payments",
      "network",
      "x-monitor",
      "mission-tools",
      "voice-recorder",
      "emoji-cloner",
      "server-cloner",
      "server-generator",
      "rules",
      "account-age-security",
      "safe-bot",
      ...Object.keys(advancedSecurityModuleDetails),
      "courses",
      "fivem",
      "fivem-factions",
      "fivem-corporations",
      "fivem-absences",
      "fivem-orders",
      "fivem-washing",
      "fivem-drugs",
      "fivem-ammo",
      "fivem-finance",
      "fivem-goals",
      "fivem-captcha",
      "fivem-hierarchy",
      "fivem-actions",
      "police-absences",
      "police-actions",
      "police-iab",
      "police-hr",
      "police-daf-roster",
      "police-courses",
      "rh-admin",
      "police-subpoenas",
      "police-patrol-reports",
      "police-qru",
      "police-promotions",
      "vehicle-abandonment",
      "police-hidden-channel",
      "visible-message",
      "message-control",
      "police-dm",
      "police-open-duty",
      "fivem-fac"
    ].includes(moduleId);
  }

  return false;
}

function isModuleReleasedForBot(bot: DashboardBot, moduleId: string) {
  if (!moduleId) {
    return false;
  }

  const released = new Set(bot.enabledModules);

  if (moduleId === "fivem") {
    return [...released].some((enabledModule) => enabledModule === "fivem" || enabledModule.startsWith("fivem-"));
  }

  if (moduleId === "fivem-fac") {
    return released.has("fivem-fac") || released.has("fivem-absences");
  }

  if (moduleId === "police-absences") {
    return released.has("police-absences");
  }

  if (moduleId === "fivem-drugs") {
    return released.has("fivem-drugs") || released.has("fivem-orders");
  }

  if (moduleId === "fivem-washing") {
    return released.has("fivem-washing") || released.has("fivem-orders");
  }

  return moduleReleaseIds(moduleId).some((candidate) => released.has(candidate));
}

type SelectedBotPlanNotice = {
  botName: string | null;
  botUsageText: string | null;
  planName: string;
  renewalTone: "muted" | "warning";
  renewalText: string;
  workspaceName: string | null;
};

function DashboardNoticeCenter({
  activeView,
  bot,
  maintenance,
  planNotice
}: {
  activeView: ViewId;
  bot: DashboardBot | null;
  maintenance: MaintenanceState | null;
  planNotice: SelectedBotPlanNotice | null;
}) {
  const showMaintenance = Boolean(maintenance?.active);
  const showPlanNotice = Boolean(planNotice);

  if (!showMaintenance && !showPlanNotice) {
    return null;
  }

  return (
    <section className="grid gap-3">
      {showMaintenance ? (
        <Card className="border-amber-400/30 bg-amber-400/10">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-amber-100">Sistema em manutenção</p>
                <Badge variant="warning">Aviso geral</Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-amber-100/80">
                A dashboard está disponível somente para consulta enquanto a equipe finaliza a manutenção. A aba DEV não recebe este aviso.
              </p>
              <p className="mt-2 text-xs text-amber-100/60">
                Iniciada em {maintenance?.activatedAt ? formatFullDate(maintenance.activatedAt) : "horário não informado"}.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showPlanNotice && planNotice ? (
        <Card className="border-[#FFD500]/25 bg-[#FFD500]/[.06]">
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.65fr)]">
            <div className="flex min-w-0 gap-3">
              <Bell className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD500]" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#FFEA70]">Caixa de avisos da assinatura</p>
                <p className="mt-1 text-sm leading-6 text-zinc-300">
                  Obrigado pela confiança. Sua assinatura {planNotice.planName} está ativa{bot?.name ? ` para ${bot.name}` : ""} e os avisos importantes deste bot aparecem aqui.
                </p>
                {activeView !== "overview" ? (
                  <p className="mt-2 text-xs text-zinc-500">Aba atual: {labelForView(activeView)}.</p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-2 text-sm">
              <NoticeLine label="Renovação" tone={planNotice.renewalTone} value={planNotice.renewalText} />
              {planNotice.botUsageText ? <NoticeLine label="Bots" value={planNotice.botUsageText} /> : null}
              {planNotice.workspaceName ? <NoticeLine label="Workspace" value={planNotice.workspaceName} /> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function DashboardMaintenanceScreen({ maintenance }: { maintenance: MaintenanceState }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4 py-10 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,213,0,.12),transparent_34%),#050505]" />
      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-xl rounded-lg border border-[#FFD500]/25 bg-[#141414]/90 p-8 text-center shadow-glow backdrop-blur-2xl"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#FFD500]/30 bg-[#FFD500]/10">
          <ShieldAlert className="h-7 w-7 text-[#FFD500]" />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-normal text-white">Sistema em manutenção</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">
          A dashboard está temporariamente indisponível enquanto a equipe finaliza a manutenção.
        </p>
        <p className="mt-4 text-xs font-medium text-zinc-500">
          Iniciada em {maintenance.activatedAt ? formatFullDate(maintenance.activatedAt) : "horário não informado"}.
        </p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Verificar novamente
        </Button>
      </motion.section>
    </main>
  );
}

function NoticeLine({ label, tone = "muted", value }: { label: string; tone?: "muted" | "warning"; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/25 px-3 py-2">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <span className={tone === "warning" ? "text-right font-semibold text-amber-200" : "text-right font-semibold text-zinc-200"}>{value}</span>
    </div>
  );
}

function UserDashboardHeader({
  bot,
  selectedGuild,
  status
}: {
  bot: DashboardBot | null;
  selectedGuild: DashboardGuild | null;
  status: BotStatus;
}) {
  const selectedGuildShard = status.botGuilds.find((guild) => guild.id === selectedGuild?.id)?.shardId;

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <Card className="border-[#FFD500]/20 bg-[#0b0b0b]">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              className="h-12 w-12 rounded-lg border border-[#FFD500]/45"
              fallback={bot?.name ?? "Bot"}
              src={bot?.avatarUrl ?? null}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-[#FFEA70]">Bot selecionado</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold text-white">{bot?.name ?? "Nenhum bot selecionado"}</h1>
                <Badge variant={status.online ? "success" : "muted"}>
                  {status.online ? "Online" : "Offline"}
                </Badge>
                {bot ? (
                  <Badge variant="muted">{bot.guildIds.length} servidor{bot.guildIds.length === 1 ? "" : "es"}</Badge>
                ) : null}
                {(status.shardCount ?? 1) > 1 ? (
                  <Badge variant="muted">{status.shardIds?.length ?? 0}/{status.shardCount} shards</Badge>
                ) : null}
              </div>
              {bot?.slug ? (
                <p className="mt-1 truncate font-mono text-xs text-zinc-500">/{bot.slug}/dashboard</p>
              ) : null}
            </div>
          </div>

          <Badge className="shrink-0" variant="muted">Dashboard isolada</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Avatar
            className="h-11 w-11 rounded-lg border border-zinc-800"
            fallback={selectedGuild?.name ?? "Servidor"}
            src={selectedGuild?.iconUrl ?? null}
          />
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">Servidor atual</p>
            <p className="truncate text-sm font-semibold text-zinc-100">{selectedGuild?.name ?? "Servidor configurado"}</p>
            {selectedGuildShard !== undefined ? (
              <p className="mt-1 text-xs text-zinc-500">Shard {selectedGuildShard}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function DafRosterPanel({
  bot,
  canRelease,
  guild,
  onRelease,
  releasing,
  serverReleased
}: {
  bot: DashboardBot | null;
  canRelease: boolean;
  guild: DashboardGuild | null;
  onRelease: () => void;
  releasing: boolean;
  serverReleased: boolean;
}) {
  const commandItems = [
    { command: "/daf config", description: "Configurar cargos, canal e permissões da escala." },
    { command: "/daf painel", description: "Publicar ou atualizar o painel DAF no Discord." }
  ];

  return (
    <Card className="border-[#FFD500]/25 bg-[#0b0b0b]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#FFEA70]">
              <CalendarClock className="h-5 w-5" />
              <CardTitle>Escala DAF</CardTitle>
            </div>
            <CardDescription className="mt-2">
              {serverReleased
                ? "Sistema liberado para este bot e servidor. A configuração e publicação do painel continuam pelo Discord."
                : "Sistema liberado para o bot, mas ainda bloqueado neste servidor."}
            </CardDescription>
          </div>
          <Badge variant={serverReleased ? "success" : "warning"}>{serverReleased ? "Liberado" : "Bloqueado no servidor"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {commandItems.map((item) => (
            <div key={item.command} className="rounded-lg border border-zinc-800 bg-black/30 p-4">
              <code className="rounded-md border border-[#FFD500]/25 bg-[#FFD500]/10 px-2 py-1 text-sm font-semibold text-[#FFEA70]">
                {item.command}
              </code>
              <p className="mt-3 text-sm text-zinc-300">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/25 p-4">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">Bot</p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{bot?.name ?? "Bot selecionado"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">Servidor</p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{guild?.name ?? bot?.mainGuildName ?? "Servidor configurado"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">Módulo</p>
            <p className="mt-1 font-mono text-sm text-zinc-300">police-daf-roster</p>
          </div>
          {!serverReleased ? (
            <Button disabled={!canRelease || releasing} onClick={onRelease} type="button">
              {releasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Liberar neste servidor
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MessageControlPanel({ bot, canManage, guild, serverReleased }: { bot: DashboardBot | null; canManage: boolean; guild: DashboardGuild | null; serverReleased: boolean }) {
  const botId = bot?.id ?? null;
  const guildId = guild?.id ?? null;
  const [dashboard, setDashboard] = useState<MessageControlDashboard | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [members, setMembers] = useState<GuildMemberOption[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const commandItems = [
    { command: "/mensagem config", description: "Abrir o painel de usuários, permissões e modos individuais." },
    { command: "/mensagem ativar", description: "Reativar o modo oculto para as mensagens do usuário cadastrado." },
    { command: "/mensagem desativar", description: "Permitir que as mensagens passem pela própria conta Discord." }
  ];
  const memberOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const member of members) byId.set(member.id, { id: member.id, name: member.displayName || member.username || member.id });
    for (const user of dashboard?.users ?? []) byId.set(user.discordId, { id: user.discordId, name: user.username ?? user.discordId });
    for (const id of dashboard?.settings.managerUserIds ?? []) {
      if (!byId.has(id)) byId.set(id, { id, name: id });
    }
    return [...byId.values()];
  }, [dashboard?.settings.managerUserIds, dashboard?.users, members]);
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, disabled: role.managed, id: role.id, name: role.name })), [roles]);

  useEffect(() => {
    if (!botId || !guildId || !serverReleased) {
      setDashboard(null);
      return;
    }

    let mounted = true;
    setBusy("load");
    setMessage(null);

    Promise.all([
      getMessageControlDashboard(guildId, botId),
      getGuildLiveOptions(guildId, botId),
      getGuildMemberOptions(guildId, "", botId).catch(() => [])
    ])
      .then(([data, options, memberData]) => {
        if (!mounted) return;
        setDashboard(data);
        setRoles(options.roles ?? []);
        setMembers(memberData);
      })
      .catch((error) => {
        if (mounted) setMessage(readResponseMessage(error) ?? "Não foi possível carregar o Controle de Mensagem.");
      })
      .finally(() => {
        if (mounted) setBusy(null);
      });

    return () => {
      mounted = false;
    };
  }, [botId, guildId, serverReleased]);

  async function searchMembers() {
    if (!botId || !guildId) return;
    setBusy("search");
    setMessage(null);
    try {
      setMembers(await getGuildMemberOptions(guildId, memberQuery, botId));
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível buscar usuários.");
    } finally {
      setBusy(null);
    }
  }

  async function addMember(member: GuildMemberOption) {
    if (!botId || !guildId) return;
    setBusy(`add:${member.id}`);
    setMessage(null);
    try {
      const user = await addMessageControlUser(guildId, botId, {
        avatarUrl: member.avatarUrl,
        discordId: member.id,
        username: member.displayName || member.username
      });
      setDashboard((current) => current ? { ...current, users: upsertMessageControlUser(current.users, user) } : current);
      setMessage("Usuário cadastrado no /mensagem.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível cadastrar o usuário.");
    } finally {
      setBusy(null);
    }
  }

  async function addManualMember() {
    if (!botId || !guildId) return;
    const discordId = manualUserId.trim();
    if (!/^\d{5,32}$/.test(discordId)) {
      setMessage("Informe um Discord ID válido.");
      return;
    }

    setBusy("add-manual");
    setMessage(null);
    try {
      const user = await addMessageControlUser(guildId, botId, {
        discordId,
        username: manualUsername.trim() || null
      });
      setDashboard((current) => current ? { ...current, users: upsertMessageControlUser(current.users, user) } : current);
      setManualUserId("");
      setManualUsername("");
      setMessage("Usuário cadastrado no /mensagem.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível cadastrar o usuário.");
    } finally {
      setBusy(null);
    }
  }

  async function updateStatus(user: MessageControlUser, status: MessageControlStatus) {
    if (!botId || !guildId || user.status === status) return;
    setBusy(`status:${user.discordId}`);
    setMessage(null);
    try {
      const updated = await setMessageControlUserStatus(guildId, botId, user.discordId, status);
      setDashboard((current) => current ? { ...current, users: upsertMessageControlUser(current.users, updated) } : current);
      setMessage(status === "pessoal" ? "Modo pessoal ativado para o usuário." : "Modo oculto ativado para o usuário.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível alterar o modo do usuário.");
    } finally {
      setBusy(null);
    }
  }

  async function removeUser(user: MessageControlUser) {
    if (!botId || !guildId) return;
    setBusy(`remove:${user.discordId}`);
    setMessage(null);
    try {
      await removeMessageControlUser(guildId, botId, user.discordId);
      setDashboard((current) => current ? { ...current, users: current.users.filter((item) => item.discordId !== user.discordId) } : current);
      setMessage("Usuário removido do /mensagem.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível remover o usuário.");
    } finally {
      setBusy(null);
    }
  }

  async function clearUsers() {
    if (!botId || !guildId) return;
    setBusy("clear");
    setMessage(null);
    try {
      const users = await clearMessageControlUsers(guildId, botId);
      setDashboard((current) => current ? { ...current, users } : current);
      setMessage("Lista de usuários limpa.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível limpar os usuários.");
    } finally {
      setBusy(null);
    }
  }

  async function saveManagers(payload: Partial<MessageControlDashboard["settings"]>) {
    if (!botId || !guildId || !dashboard) return;
    const previous = dashboard.settings;
    const optimistic = { ...dashboard.settings, ...payload };
    setDashboard({ ...dashboard, settings: optimistic });
    setBusy("settings");
    setMessage(null);
    try {
      const settings = await saveMessageControlSettings(guildId, botId, payload);
      setDashboard((current) => current ? { ...current, settings } : current);
      setMessage("Permissões do /mensagem config salvas.");
    } catch (error) {
      setDashboard((current) => current ? { ...current, settings: previous } : current);
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar as permissões.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-[#FFD500]/25 bg-[#0b0b0b]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#FFEA70]">
              <MessageCircle className="h-5 w-5" />
              <CardTitle>Controle de Mensagem</CardTitle>
            </div>
            <CardDescription className="mt-2">
              {serverReleased
                ? "Sistema liberado para este bot e servidor. O gerenciamento operacional fica no painel do Discord."
                : "Sistema liberado para o bot, mas ainda bloqueado neste servidor."}
            </CardDescription>
          </div>
          <Badge variant={serverReleased ? "success" : "warning"}>{serverReleased ? "Liberado" : "Bloqueado no servidor"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {message ? <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 py-2 text-sm font-medium text-[#FFEA70]">{message}</div> : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-3 md:grid-cols-3">
            {commandItems.map((item) => (
              <div key={item.command} className="rounded-lg border border-zinc-800 bg-black/30 p-4">
                <code className="rounded-md border border-[#FFD500]/25 bg-[#FFD500]/10 px-2 py-1 text-sm font-semibold text-[#FFEA70]">
                  {item.command}
                </code>
                <p className="mt-3 text-sm text-zinc-300">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/25 p-4">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Bot</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{bot?.name ?? "Bot selecionado"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Servidor</p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{guild?.name ?? bot?.mainGuildName ?? "Servidor configurado"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Módulo</p>
              <p className="mt-1 font-mono text-sm text-zinc-300">message-control</p>
            </div>
          </div>
        </div>

        {serverReleased ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
              <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/25 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">Cadastrar usuário</p>
                    <p className="mt-1 text-xs text-zinc-500">Usuários cadastrados podem alternar entre modo oculto e pessoal.</p>
                  </div>
                  {busy === "load" ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : null}
                </div>
                <div className="flex gap-2">
                  <input className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFEA70]" disabled={!canManage || busy !== null} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Buscar membro por nome ou ID" value={memberQuery} />
                  <Button disabled={!canManage || busy !== null} onClick={() => void searchMembers()} type="button" variant="outline">
                    {busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="discord-scrollbar max-h-72 space-y-2 overflow-y-auto">
                  {members.map((member) => {
                    const registered = dashboard?.users.some((user) => user.discordId === member.id) ?? false;
                    return (
                      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3" key={member.id}>
                        <Avatar className="h-9 w-9 rounded-lg" fallback={member.displayName} src={member.avatarUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-100">{member.displayName}</p>
                          <p className="truncate font-mono text-xs text-zinc-500">{member.id}</p>
                        </div>
                        <Button disabled={!canManage || busy !== null || registered} onClick={() => void addMember(member)} size="sm" type="button">
                          {busy === `add:${member.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                          {registered ? "Cadastrado" : "Adicionar"}
                        </Button>
                      </div>
                    );
                  })}
                  {!members.length ? <p className="rounded-lg border border-zinc-800 bg-black/30 p-4 text-sm text-zinc-500">Nenhum usuário encontrado.</p> : null}
                </div>
                <div className="grid gap-2 border-t border-zinc-800 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFEA70]" disabled={!canManage || busy !== null} inputMode="numeric" onChange={(event) => setManualUserId(event.target.value.replace(/\D/g, ""))} placeholder="Discord ID" value={manualUserId} />
                  <input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFEA70]" disabled={!canManage || busy !== null} onChange={(event) => setManualUsername(event.target.value)} placeholder="Nome opcional" value={manualUsername} />
                  <Button disabled={!canManage || busy !== null} onClick={() => void addManualMember()} type="button">
                    {busy === "add-manual" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Adicionar
                  </Button>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/25 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">Usuários do /mensagem</p>
                    <p className="mt-1 text-xs text-zinc-500">{dashboard?.users.length ?? 0} usuário(s) cadastrado(s)</p>
                  </div>
                  <Button disabled={!canManage || busy !== null || !dashboard?.users.length} onClick={() => void clearUsers()} size="sm" type="button" variant="destructive">
                    {busy === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Limpar
                  </Button>
                </div>
                <div className="discord-scrollbar max-h-[30rem] space-y-2 overflow-y-auto">
                  {(dashboard?.users ?? []).map((user) => (
                    <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]" key={user.discordId}>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-10 w-10 rounded-lg" fallback={user.username ?? user.discordId} src={user.avatarUrl} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-zinc-100">{user.username ?? user.discordId}</p>
                            <Badge variant={user.status === "pessoal" ? "warning" : "success"}>{user.status === "pessoal" ? "Pessoal" : "Oculto"}</Badge>
                          </div>
                          <p className="mt-1 truncate font-mono text-xs text-zinc-500">{user.discordId}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        <Button disabled={!canManage || busy !== null || user.status === "equipe"} onClick={() => void updateStatus(user, "equipe")} size="sm" type="button" variant="outline">Oculto</Button>
                        <Button disabled={!canManage || busy !== null || user.status === "pessoal"} onClick={() => void updateStatus(user, "pessoal")} size="sm" type="button" variant="outline">Pessoal</Button>
                        <Button disabled={!canManage || busy !== null} onClick={() => void removeUser(user)} size="icon" type="button" variant="destructive">
                          {busy === `remove:${user.discordId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {dashboard && !dashboard.users.length ? <p className="rounded-lg border border-zinc-800 bg-black/30 p-4 text-sm text-zinc-500">Nenhum usuário cadastrado.</p> : null}
                </div>
              </div>
            </section>

            {dashboard ? (
              <section className="grid gap-4 rounded-lg border border-zinc-800 bg-black/25 p-4 lg:grid-cols-2">
                <FivemResourceMultiSelect disabled={!canManage || busy !== null} label="Cargos que podem abrir /mensagem config" onChange={(managerRoleIds) => void saveManagers({ managerRoleIds })} options={roleOptions} prefix="@" values={dashboard.settings.managerRoleIds} />
                <FivemResourceMultiSelect disabled={!canManage || busy !== null} label="Usuários que podem abrir /mensagem config" onChange={(managerUserIds) => void saveManagers({ managerUserIds })} options={memberOptions} prefix="@" values={dashboard.settings.managerUserIds} />
              </section>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function upsertMessageControlUser(users: MessageControlUser[], user: MessageControlUser) {
  const exists = users.some((item) => item.discordId === user.discordId);
  return exists
    ? users.map((item) => item.discordId === user.discordId ? user : item)
    : [user, ...users];
}

function ServerModuleReleasePanel({
  canRelease,
  moduleId,
  onRelease,
  releasing,
  title
}: {
  canRelease: boolean;
  moduleId: string;
  onRelease: () => void;
  releasing: boolean;
  title: string;
}) {
  return (
    <Card className="border-amber-500/30 bg-[#0b0b0b]">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-2">
              O módulo está liberado no bot, mas ainda não está ativado para este servidor.
            </CardDescription>
          </div>
          <Badge variant="warning">Bloqueado no servidor</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-black/25 p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">Módulo</p>
          <p className="mt-1 font-mono text-sm text-zinc-300">{moduleId}</p>
        </div>
        <Button disabled={!canRelease || releasing} onClick={onRelease} type="button">
          {releasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Liberar neste servidor
        </Button>
      </CardContent>
    </Card>
  );
}

function OverviewView({
  availableModules,
  bot,
  details,
  guild,
  onConfigure,
  settings,
  status
}: {
  availableModules: ModuleDefinition[];
  bot: DashboardBot | null;
  details: OverviewDetails;
  guild: DashboardGuild | null;
  onConfigure: (view: ViewId) => void;
  settings: GuildSettings | null;
  status: BotStatus;
}) {
  const moduleSummaries = availableModules.map((module) => ({
    ...module,
    state: moduleState(module.id, settings, details)
  }));
  const activeModules = moduleSummaries.filter((module) => module.state.active).length;

  return (
    <DashboardHome
      activeModules={activeModules}
      botOnline={status.online}
      channelCount={guild?.channelCount ?? bot?.mainGuildChannelCount ?? 0}
      guildName={guild?.name ?? "Servidor não selecionado"}
      memberCount={guild?.memberCount ?? bot?.mainGuildMemberCount ?? 0}
      modules={availableModules.map((module) => ({
        description: module.description,
        icon: module.icon,
        id: module.id,
        onOpen: () => onConfigure(module.view),
        title: module.title
      }))}
      totalModules={availableModules.length}
    />
  );
}

function IsolationStatusPanel({
  availableModuleCount,
  bot,
  details,
  status,
  totalModuleCount
}: {
  availableModuleCount: number;
  bot: DashboardBot | null;
  details: OverviewDetails;
  status: BotStatus;
  totalModuleCount: number;
}) {
  const selfBotSettings = details.selfBotProtectionSettings;
  const selfBotActive = Boolean(selfBotSettings?.enabled && bot?.enabledModules.includes("safe-bot"));
  const items = [
    {
      label: "Bot ID",
      value: bot?.id ?? "Não selecionado",
      active: Boolean(bot)
    },
    {
      label: "Bot",
      value: bot && status.online ? "Liberado" : "Bloqueado",
      active: Boolean(bot && status.online)
    },
    {
      label: "Módulos liberados",
      value: String(availableModuleCount),
      active: availableModuleCount > 0
    },
    {
      label: "Módulos bloqueados",
      value: String(Math.max(0, totalModuleCount - availableModuleCount)),
      active: totalModuleCount - availableModuleCount === 0
    },
    {
      label: "Validade da licenca",
      value: "Sem data cadastrada",
      active: false
    },
    {
      label: "SelfBot",
      value: selfBotActive ? "Ativo" : "Bloqueado",
      active: selfBotActive
    },
    {
      label: "Anti-Link",
      value: selfBotActive && selfBotSettings?.moduleToggles["anti-links"] ? "Ativo" : "Bloqueado",
      active: Boolean(selfBotActive && selfBotSettings?.moduleToggles["anti-links"])
    },
    {
      label: "Anti-Spam",
      value: selfBotActive && selfBotSettings?.moduleToggles["anti-spam"] ? "Ativo" : "Bloqueado",
      active: Boolean(selfBotActive && selfBotSettings?.moduleToggles["anti-spam"])
    },
    {
      label: "Anti-Flood",
      value: selfBotActive && selfBotSettings?.moduleToggles["anti-flood"] ? "Ativo" : "Bloqueado",
      active: Boolean(selfBotActive && selfBotSettings?.moduleToggles["anti-flood"])
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Isolamento por Bot ID</CardTitle>
        <CardDescription>Estado runtime do bot selecionado, sem herdar configuração de outro bot.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div className="min-w-0 rounded-lg border border-zinc-900 bg-zinc-950/70 p-3" key={item.label}>
              <p className="text-xs text-zinc-500">{item.label}</p>
              <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-white" title={item.value}>{item.value}</p>
                <Badge variant={item.active ? "success" : "muted"}>{item.active ? "OK" : "OFF"}</Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleCard({
  description,
  icon: Icon,
  onConfigure,
  state,
  title
}: {
  description: string;
  icon: typeof Bot;
  onConfigure: () => void;
  state: ReturnType<typeof moduleState>;
  title: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={state.active ? "success" : "muted"}>{state.active ? "Ativado" : "Desativado"}</Badge>
              <Badge variant={state.configured ? "success" : "danger"}>{state.configuredText}</Badge>
            </div>
          </div>
        </div>

        <Button className="h-9 shrink-0 px-3 text-xs" onClick={onConfigure} variant="outline">
          Configurar
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

function LiveView({
  botId,
  canManageKick,
  canManageTwitch,
  liveDetectionRefresh,
  guild,
  lives,
  showKick,
  showTwitch
}: {
  botId?: string | null;
  canManageKick: boolean;
  canManageTwitch: boolean;
  liveDetectionRefresh: number;
  guild: DashboardGuild | null;
  lives: LiveEvent[];
  showKick: boolean;
  showTwitch: boolean;
}) {
  return (
    <div className="space-y-5">
      {showTwitch ? (
        <LiveDetectionPanel botId={botId} canManage={canManageTwitch} guild={guild} refreshSignal={liveDetectionRefresh} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sistema Detecta Lives</CardTitle>
            <CardDescription>Este módulo ainda não foi liberado para este bot pelo painel DEV.</CardDescription>
          </CardHeader>
        </Card>
      )}
      {showTwitch ? (
        <LiveNotificationsPanel botId={botId} canManage={canManageTwitch} guild={guild} />
      ) : null}
      {showKick ? (
        <KickIntegrationPanel botId={botId} canManage={canManageKick} guild={guild} />
      ) : null}

      <PanelImageSettings
        botId={botId}
        canManage={canManageTwitch || canManageKick}
        guildId={guild?.id ?? null}
        panelId="live"
        panelLabel="Live"
      />

      <Card>
        <CardHeader>
          <CardTitle>Sistema de lives</CardTitle>
          <CardDescription>Eventos recentes detectados pelo bot.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {lives.length ? (
              lives.map((live) => (
                <EventRow
                  badge={live.type === "started" ? "Iniciada" : "Encerrada"}
                  icon={Radio}
                  key={live.id}
                  subtitle={live.title ?? live.url ?? "Sem titulo"}
                  title={live.streamer}
                  time={live.createdAt}
                />
              ))
            ) : (
              <EmptyState icon={Radio} title="Nenhuma live registrada" />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LiveDetectionPanel({
  botId,
  canManage,
  guild,
  refreshSignal
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  refreshSignal: number;
}) {
  const [settings, setSettings] = useState<LiveDetectionSettings | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    if (!guild) {
      setSettings(null);
      return;
    }

    setLoading(true);
    Promise.all([
      getLiveDetectionSettings(guild.id, botId),
      getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [], roles: [], voiceChannels: [], categories: [] }))
    ])
      .then(([nextSettings, options]) => {
        if (!mounted) return;
        setSettings(nextSettings);
        setRoles(options.roles);
        setChannels(options.channels);
      })
      .catch((error) => {
        if (mounted) setMessage(readResponseMessage(error) ?? "Não foi possível carregar o Sistema Detecta Lives.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild, refreshSignal]);

  async function savePatch(patch: Partial<Pick<LiveDetectionSettings, "enabled" | "liveRoleId" | "logChannelId">>) {
    if (!guild || !settings) return;

    const nextPayload = {
      enabled: patch.enabled ?? settings.enabled,
      liveRoleId: patch.liveRoleId !== undefined ? patch.liveRoleId : settings.liveRoleId,
      logChannelId: patch.logChannelId !== undefined ? patch.logChannelId : settings.logChannelId
    };

    setSaving(true);
    setMessage(null);

    try {
      const nextSettings = await saveLiveDetectionSettings(guild.id, nextPayload, botId);
      setSettings(nextSettings);
      setMessage("Configuração salva.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar o Sistema Detecta Lives.");
    } finally {
      setSaving(false);
    }
  }

  async function resetSettings() {
    if (!guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const nextSettings = await deleteLiveDetectionSettings(guild.id, botId);
      setSettings(nextSettings);
      setMessage("Configuração removida.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível remover a configuração.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = !guild || !settings || !canManage || saving;
  const configured = Boolean(settings?.liveRoleId);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Sistema Detecta Lives</CardTitle>
            <CardDescription>Aplica um cargo automaticamente quando o Discord detectar uma transmissão ativa.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : null}
            <span className="text-sm font-medium text-zinc-300">{settings?.enabled ? "Ativo" : "Desativado"}</span>
            <Switch checked={Boolean(settings?.enabled)} disabled={disabled || !configured} onCheckedChange={(checked) => void savePatch({ enabled: checked })} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? (
          <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <RoleSelect
            disabled={disabled}
            label="Cargo aplicado durante a live"
            onChange={(value) => void savePatch({ liveRoleId: value || null })}
            roles={roles.filter((role) => !role.managed)}
            value={settings?.liveRoleId ?? ""}
          />
          <FivemChannelSelect
            channels={channels}
            disabled={disabled}
            label="Canal de logs"
            onChange={(value) => void savePatch({ logChannelId: value || null })}
            placeholder="Sem logs"
            value={settings?.logChannelId ?? ""}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={settings?.enabled ? "success" : "muted"}>{settings?.enabled ? "Detecção ativa" : "Detecção pausada"}</Badge>
          <Badge variant={configured ? "success" : "danger"}>{configured ? "Cargo configurado" : "Cargo obrigatório"}</Badge>
          <Badge variant={settings?.logChannelId ? "success" : "muted"}>{settings?.logChannelId ? "Logs configurados" : "Logs opcionais"}</Badge>
        </div>

        <div className="flex justify-end gap-2">
          <Button disabled={!canManage || saving || !settings} onClick={() => void savePatch({ enabled: !settings?.enabled })} variant={settings?.enabled ? "outline" : "default"}>
            {settings?.enabled ? "Desativar" : "Ativar"}
          </Button>
          <Button disabled={!canManage || saving} onClick={() => void resetSettings()} variant="outline">
            Remover configuração
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PoliceTimeClockPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [dashboard, setDashboard] = useState<PoliceTimeClockDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!guild || !botId) return;
    Promise.all([getPoliceTimeClockDashboard(guild.id, botId), getGuildLiveOptions(guild.id, botId)])
      .then(([data, options]) => { if (mounted) { setDashboard(data); setChannels(options.channels); setRoles(options.roles); } })
      .catch((error) => { if (mounted) setMessage(readResponseMessage(error) ?? "Não foi possível carregar o Relógio de Ponto."); });
    return () => { mounted = false; };
  }, [botId, guild]);

  async function patch(payload: Partial<PoliceTimeClockDashboard["settings"]>) {
    if (!guild || !botId || !dashboard) return;
    setSaving(true); setMessage(null);
    try {
      const settings = await savePoliceTimeClockSettings(guild.id, botId, payload);
      setDashboard({ ...dashboard, settings });
      setMessage("Configuração salva.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (!dashboard) return <Card><CardContent className="flex min-h-32 items-center justify-center p-6 text-sm text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando Relógio de Ponto...</CardContent></Card>;
  const disabled = !canManage || saving;

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle>Relógio de Ponto</CardTitle><CardDescription>Controle policial de entrada, saída, histórico e relatórios.</CardDescription></div>
            <div className="flex items-center gap-3"><span className="text-sm text-zinc-300">{dashboard.settings.enabled ? "Ativo" : "Desativado"}</span><Switch checked={dashboard.settings.enabled} disabled={disabled} onCheckedChange={(checked) => void patch({ enabled: checked })} /></div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal do painel" onChange={(value) => void patch({ panelChannelId: value || null })} placeholder="Selecionar canal" value={dashboard.settings.panelChannelId ?? ""} />
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal de logs" onChange={(value) => void patch({ logChannelId: value || null })} placeholder="Sem logs" value={dashboard.settings.logChannelId ?? ""} />
            <RoleSelect disabled={disabled} label="Cargo que gerencia" onChange={(value) => void patch({ managerRoleId: value || null })} roles={roles} value={dashboard.settings.managerRoleId ?? ""} />
            <RoleSelect disabled={disabled} label="Cargo que fecha ponto" onChange={(value) => void patch({ closeRoleId: value || null })} roles={roles} value={dashboard.settings.closeRoleId ?? ""} />
            <RoleSelect disabled={disabled} label="Cargo de relatórios" onChange={(value) => void patch({ reportRoleId: value || null })} roles={roles} value={dashboard.settings.reportRoleId ?? ""} />
            <RoleSelect disabled={disabled} label="Administrador do sistema" onChange={(value) => void patch({ adminRoleId: value || null })} roles={roles} value={dashboard.settings.adminRoleId ?? ""} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SimpleCheck label="Entrada manual" checked={dashboard.settings.allowManualEntry} disabled={disabled} onChange={(checked) => void patch({ allowManualEntry: checked })} />
            <SimpleCheck label="Saída manual" checked={dashboard.settings.allowManualExit} disabled={disabled} onChange={(checked) => void patch({ allowManualExit: checked })} />
            <SimpleCheck label="Fechamento forçado" checked={dashboard.settings.allowForcedClose} disabled={disabled} onChange={(checked) => void patch({ allowForcedClose: checked })} />
            <SimpleCheck label="Histórico" checked={dashboard.settings.allowHistory} disabled={disabled} onChange={(checked) => void patch({ allowHistory: checked })} />
          </div>
        </CardContent>
      </Card>
      <ClockOverviewCard active={dashboard.active.map((item) => ({ id: item.id, label: item.username, meta: `Entrada ${new Date(item.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` }))} history={dashboard.history.map((item) => ({ id: item.id, label: item.username, meta: formatMs(item.durationMs ?? 0) }))} summary={dashboard.summary} />
    </div>
  );
}

function AutoActivityClockPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [dashboard, setDashboard] = useState<AutoActivityClockDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [imageBlocks, setImageBlocks] = useState<Array<{ index: number; settings: PanelImageSettingsType | null }>>([]);
  const [cityName, setCityName] = useState("");
  const [cityAliases, setCityAliases] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, disabled: role.managed, id: role.id, name: role.name })), [roles]);

  const reload = useCallback(async () => {
    if (!guild || !botId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [data, options, images] = await Promise.all([
        getAutoActivityClockDashboard(guild.id, botId),
        getGuildLiveOptions(guild.id, botId).catch(() => ({ channels: [], roles: [] })),
        loadAutoActivityImageBlocks(guild.id, botId).catch(() => [] as Array<{ index: number; settings: PanelImageSettingsType | null }>)
      ]);
      setDashboard(data);
      setChannels(options.channels);
      setRoles(options.roles);
      setImageBlocks(images);
    } catch (error) {
      const nextMessage = readResponseMessage(error) ?? "Não foi possível carregar o Ponto Automático.";
      setLoadError(nextMessage);
      setMessage(nextMessage);
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!guild || !botId) return;
    const socket = createDashboardSocket();
    const refresh = (event?: { botId?: string | null; guildId?: string | null }) => {
      if (event?.botId && event.botId !== botId) return;
      if (event?.guildId && event.guildId !== guild.id) return;
      void reload();
    };
    socket.on("auto-activity-clock:settings_updated", refresh);
    socket.on("auto-activity-clock:cities_updated", refresh);
    socket.on("auto-activity-clock:session_opened", refresh);
    socket.on("auto-activity-clock:session_closed", refresh);
    return () => {
      socket.off("auto-activity-clock:settings_updated", refresh);
      socket.off("auto-activity-clock:cities_updated", refresh);
      socket.off("auto-activity-clock:session_opened", refresh);
      socket.off("auto-activity-clock:session_closed", refresh);
      socket.disconnect();
    };
  }, [botId, guild, reload]);

  async function patch(payload: Partial<AutoActivityClockDashboard["settings"]>) {
    if (!guild || !botId || !dashboard) return;
    setSaving(true); setMessage(null);
    try {
      const settings = await saveAutoActivityClockSettings(guild.id, botId, payload);
      setDashboard((current) => current ? { ...current, settings } : current);
      setMessage("Configuração salva.");
    } catch (error) { setMessage(readResponseMessage(error) ?? "Não foi possível salvar."); }
    finally { setSaving(false); }
  }

  async function addCity() {
    if (!guild || !botId || !cityName.trim()) return;
    setSaving(true);
    try {
      await saveAutoActivityClockCity(guild.id, botId, { aliases: cityAliases.split(",").map((item) => item.trim()).filter(Boolean), name: cityName.trim() });
      setCityName(""); setCityAliases(""); await reload(); setMessage("Cidade salva.");
    } catch (error) { setMessage(readResponseMessage(error) ?? "Não foi possível salvar a cidade."); }
    finally { setSaving(false); }
  }

  async function removeCity(cityId: string) {
    if (!guild || !botId) return;
    setSaving(true);
    setMessage(null);
    try {
      await deleteAutoActivityClockCity(guild.id, botId, cityId);
      await reload();
      setMessage("Cidade removida.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível remover a cidade.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadImageBlock(index: number, file: File | null) {
    if (!guild || !botId || !file) return;
    setSaving(true);
    setMessage(null);
    try {
      await uploadPanelImage(guild.id, autoActivityImagePanelId(index), file, botId);
      setImageBlocks(await loadAutoActivityImageBlocks(guild.id, botId));
      setMessage("Mídia enviada.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível enviar a mídia.");
    } finally {
      setSaving(false);
    }
  }

  async function removeImageBlock(index: number) {
    if (!guild || !botId) return;
    setSaving(true);
    setMessage(null);
    try {
      await removePanelImage(guild.id, autoActivityImagePanelId(index), botId);
      setImageBlocks(await loadAutoActivityImageBlocks(guild.id, botId));
      setMessage("Imagem removida.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível remover a imagem.");
    } finally {
      setSaving(false);
    }
  }

  function addImageBlock() {
    setImageBlocks((current) => {
      const nextIndex = current.reduce((max, item) => Math.max(max, item.index), 0) + 1;
      return [...current, { index: nextIndex, settings: null }];
    });
  }

  if (!guild || !botId) {
    return <Card><CardContent className="p-6 text-sm text-zinc-400">Selecione um servidor e um bot para configurar o Ponto Automático.</CardContent></Card>;
  }

  if (loading && !dashboard) return <Card><CardContent className="flex min-h-32 items-center justify-center p-6 text-sm text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando Ponto Automático...</CardContent></Card>;

  if (!dashboard) {
    return (
      <Card>
        <CardContent className="flex min-h-32 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-300">
          <p>{loadError ?? "Não foi possível carregar o Ponto Automático."}</p>
          <Button disabled={loading} onClick={() => void reload()} variant="outline">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const disabled = !canManage || saving;

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle>Sistema de Ponto Automático</CardTitle><CardDescription>Detecta cidades RP pela atividade do Discord e abre/fecha ponto automaticamente.</CardDescription></div>
            <div className="flex items-center gap-3"><span className="text-sm text-zinc-300">{dashboard.settings.enabled ? "Ativo" : "Desativado"}</span><Switch checked={dashboard.settings.enabled} disabled={disabled} onCheckedChange={(checked) => void patch({ enabled: checked })} /></div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal do painel" onChange={(value) => void patch({ panelChannelId: value || null })} placeholder="Selecionar canal" value={dashboard.settings.panelChannelId ?? ""} />
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal de logs" onChange={(value) => void patch({ logChannelId: value || null })} placeholder="Sem logs" value={dashboard.settings.logChannelId ?? ""} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <MetricCard icon={CheckCircle2} label="Status" value={dashboard.settings.enabled ? "Ativado" : "Desativado"} />
            <MetricCard icon={Building2} label="Cidades" value={String(dashboard.cities.length)} />
            <MetricCard icon={Users} label="Em ponto" value={String(dashboard.active.length)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="grid gap-2 text-xs font-medium text-zinc-400">
              Confirmação de saída (10 a 20 segundos)
              <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} max={20} min={10} onBlur={(event) => void patch({ confirmMinutes: Math.max(10, Math.min(20, Number(event.target.value) || 15)) })} type="number" defaultValue={Math.max(10, Math.min(20, dashboard.settings.confirmMinutes || 15))} />
            </label>
            <label className="grid gap-2 text-xs font-medium text-zinc-400">
              Meta semanal (minutos)
              <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} min={0} onBlur={(event) => void patch({ weeklyGoalMinutes: Math.max(0, Number(event.target.value) || 0) })} type="number" defaultValue={dashboard.settings.weeklyGoalMinutes} />
            </label>
            <label className="grid gap-2 text-xs font-medium text-zinc-400">
              Tempo mínimo contabilizado (minutos)
              <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} min={0} onBlur={(event) => void patch({ minMinutes: Math.max(0, Number(event.target.value) || 0) })} type="number" defaultValue={dashboard.settings.minMinutes} />
            </label>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-xs font-medium text-zinc-400">
              Fechamento máximo (horas)
              <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} min={0} onBlur={(event) => void patch({ maxHours: event.target.value.trim() ? Math.max(0, Number(event.target.value) || 0) : null })} type="number" defaultValue={dashboard.settings.maxHours ?? ""} />
            </label>
            <label className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 text-sm text-zinc-200">
              Atualizar painel automaticamente
              <Switch checked={dashboard.settings.autoUpdatePanel} disabled={disabled} onCheckedChange={(checked) => void patch({ autoUpdatePanel: checked })} />
            </label>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} onChange={(event) => setCityName(event.target.value)} placeholder="Nome da cidade" value={cityName} />
            <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} onChange={(event) => setCityAliases(event.target.value)} placeholder="Aliases separados por vírgula" value={cityAliases} />
            <Button disabled={disabled || !cityName.trim()} onClick={() => void addCity()}>Adicionar cidade</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.cities.map((city) => <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3" key={city.id}><p className="font-semibold text-white">{city.name}</p><p className="text-xs text-zinc-500">{city.aliases.join(", ") || "Sem aliases"}</p><Button className="mt-3" disabled={disabled} onClick={() => void removeCity(city.id)} size="sm" variant="outline">Remover</Button></div>)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Imagens do Painel</CardTitle>
          <CardDescription>Envie arquivos para criar blocos visuais no painel Component V2. Não é necessário informar URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {imageBlocks.map((block) => (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3" key={block.index}>
                <p className="text-sm font-semibold text-white">Imagem {block.index}</p>
                {block.settings?.imageEnabled && block.settings.imageUrl ? <PanelMediaPreview imageUrl={block.settings.imageUrl} mimeType={block.settings.imageMimeType} /> : <div className="mt-3 flex h-28 items-center justify-center rounded-md bg-black text-zinc-600"><ImageIcon className="h-6 w-6" /></div>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input accept={PANEL_MEDIA_ACCEPT} className="max-w-full text-xs text-zinc-400" disabled={disabled} onChange={(event) => void uploadImageBlock(block.index, event.target.files?.[0] ?? null)} type="file" />
                  <Button disabled={disabled || !block.settings?.imageUrl} onClick={() => void removeImageBlock(block.index)} size="sm" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            <button className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-950 text-sm font-semibold text-zinc-300 transition hover:border-[#FFD500]/50 hover:text-white disabled:opacity-60" disabled={disabled} onClick={addImageBlock} type="button">
              <Plus className="mr-2 h-4 w-4" />Adicionar imagem
            </button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Permissões</CardTitle>
          <CardDescription>Controle quem pode visualizar, usar ações manuais e administrar o Ponto Automático pelo Discord.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <FivemResourceMultiSelect disabled={disabled} label="Cargos administradores" onChange={(values) => void patch({ adminRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.adminRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos que gerenciam cidades" onChange={(values) => void patch({ cityManagerRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.cityManagerRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos que visualizam o painel" onChange={(values) => void patch({ viewRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.viewRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos que atualizam o painel" onChange={(values) => void patch({ updatePanelRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.updatePanelRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos para entrada manual" onChange={(values) => void patch({ manualEntryRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.manualEntryRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos para saída manual" onChange={(values) => void patch({ manualExitRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.manualExitRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos para fechamento forçado" onChange={(values) => void patch({ closeRoleIds: values })} options={roleOptions} prefix="@" values={dashboard.settings.closeRoleIds} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos para histórico/exportação" onChange={(values) => void patch({ historyRoleIds: values, exportRoleIds: values })} options={roleOptions} prefix="@" values={[...new Set([...dashboard.settings.historyRoleIds, ...dashboard.settings.exportRoleIds])]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Usuários</CardTitle>
          <CardDescription>Deixe vazio para aceitar todos. Quando houver usuários liberados, apenas eles entram automaticamente.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <IdListTextarea disabled={disabled} label="Usuários liberados" onSave={(values) => void patch({ allowedUserIds: values })} values={dashboard.settings.allowedUserIds} />
          <IdListTextarea disabled={disabled} label="Usuários bloqueados" onSave={(values) => void patch({ blockedUserIds: values })} values={dashboard.settings.blockedUserIds} />
        </CardContent>
      </Card>
      <ClockOverviewCard active={dashboard.active.map((item) => ({ id: item.id, label: item.username, meta: item.cityName }))} history={dashboard.history.map((item) => ({ id: item.id, label: item.username, meta: `${item.cityName} • ${formatMs(item.durationMs ?? 0)}` }))} summary={dashboard.summary} />
      <AutoActivityReportsCard dashboard={dashboard} />
    </div>
  );
}

function autoActivityImagePanelId(index: number) {
  return index <= 1 ? "auto-activity-clock" : `auto-activity-clock-banner-${index}`;
}

function PanelMediaPreview({ imageUrl, mimeType }: { imageUrl: string; mimeType?: string | null }) {
  const isVideo = mimeType?.startsWith("video/") || /\.(3gp|asf|avi|f4v|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogv|rmvb|ts|vob|webm|wmv)(?:$|[?#])/i.test(imageUrl);
  if (isVideo) return <video className="mt-3 h-28 w-full rounded-md object-cover" controls muted playsInline src={imageUrl} />;
  return <img className="mt-3 h-28 w-full rounded-md object-cover" src={imageUrl} />;
}

async function loadAutoActivityImageBlocks(guildId: string, botId: string) {
  const settings = await listPanelImageSettings(guildId, botId).catch(() => [] as PanelImageSettingsType[]);
  const saved = settings
    .map((item) => ({ index: autoActivityImageIndex(item.panelId), settings: item }))
    .filter((item): item is { index: number; settings: PanelImageSettingsType } => item.index !== null)
    .sort((a, b) => a.index - b.index);
  const indexes = new Set(saved.map((item) => item.index));
  const placeholders = [1, 2, 3].filter((index) => !indexes.has(index)).map((index) => ({ index, settings: null }));

  return [...saved, ...placeholders].sort((a, b) => a.index - b.index);
}

function autoActivityImageIndex(panelId: string) {
  if (panelId === "auto-activity-clock") return 1;
  const match = /^auto-activity-clock-banner-(\d+)$/i.exec(panelId);
  return match ? Number(match[1]) : null;
}

function AutoActivityReportsCard({ dashboard }: { dashboard: AutoActivityClockDashboard }) {
  const weekly = dashboard.reports.weekly.slice(0, 5);
  const monthly = dashboard.reports.monthly.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatórios e Meta</CardTitle>
        <CardDescription>Ranking administrativo recente. A meta aparece apenas para consulta.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <ReportRanking title="Semanal" rows={weekly} />
        <ReportRanking title="Mensal" rows={monthly} />
      </CardContent>
    </Card>
  );
}

function ReportRanking({ rows, title }: { rows: AutoActivityClockDashboard["reports"]["weekly"]; title: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-3 text-sm font-semibold text-white">{title}</p>
      <div className="space-y-2">
        {rows.length ? rows.map((item, index) => (
          <div className="rounded-md bg-black/40 p-3 text-sm" key={item.userId}>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-semibold text-zinc-200">{index + 1}. {item.username}</span>
              <span className="shrink-0 text-zinc-400">{formatMs(item.totalDurationMs)}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Entradas: {item.entries} · Meta: {formatMs(item.weeklyGoalMs)} · {metaStatusLabel(item.metaStatus)} · Dias sem logar: {item.daysWithoutLogin ?? "-"}</p>
          </div>
        )) : <p className="text-sm text-zinc-500">Nenhum registro fechado.</p>}
      </div>
    </div>
  );
}

function metaStatusLabel(value: "above" | "below" | "met") {
  if (value === "above") return "Acima da meta";
  if (value === "met") return "Meta atingida";
  return "Abaixo da meta";
}

function IdListTextarea({ disabled, label, onSave, values }: { disabled: boolean; label: string; onSave: (values: string[]) => void; values: string[] }) {
  const [draft, setDraft] = useState(values.join(", "));

  useEffect(() => {
    setDraft(values.join(", "));
  }, [values]);

  return (
    <label className="grid gap-2 text-xs font-medium text-zinc-400">
      {label}
      <textarea
        className="min-h-24 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-500/60 disabled:opacity-60"
        disabled={disabled}
        onBlur={() => onSave(parseIdList(draft))}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="IDs separados por vírgula, espaço ou linha"
        value={draft}
      />
    </label>
  );
}

function parseIdList(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function SimpleCheck({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300"><input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />{label}</label>;
}

function ClockOverviewCard({ active, history, summary }: { active: Array<{ id: string; label: string; meta: string }>; history: Array<{ id: string; label: string; meta: string }>; summary: { activeCount: number; averageDurationMs: number; totalDurationMs: number; totalEntries: number } }) {
  return <Card><CardHeader><CardTitle>Resumo</CardTitle><CardDescription>Dados recentes persistidos no banco.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-3"><MetricCard icon={Users} label="Ativos" value={String(summary.activeCount)} /><MetricCard icon={Clock3} label="Tempo médio" value={formatMs(summary.averageDurationMs)} /><MetricCard icon={ScrollText} label="Histórico" value={String(summary.totalEntries)} /><div className="lg:col-span-3 grid gap-4 md:grid-cols-2"><MiniList items={active} title="Em serviço" /><MiniList items={history.slice(0, 8)} title="Histórico recente" /></div></CardContent></Card>;
}

function MiniList({ items, title }: { items: Array<{ id: string; label: string; meta: string }>; title: string }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"><p className="mb-3 text-sm font-semibold text-white">{title}</p><div className="space-y-2">{items.length ? items.map((item) => <div className="flex justify-between gap-3 text-sm" key={item.id}><span className="truncate text-zinc-200">{item.label}</span><span className="shrink-0 text-zinc-500">{item.meta}</span></div>) : <p className="text-sm text-zinc-500">Nenhum registro.</p>}</div></div>;
}

function formatMs(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

function ModerationView({
  canManage,
  onToggle,
  savingKey,
  settings
}: {
  canManage: boolean;
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
}) {
  return (
    <div className="space-y-4">
      <SimpleToggleCard
        checked={Boolean(settings?.moderationEnabled)}
        description="Ative ou pause os recursos básicos de moderação deste servidor."
        disabled={!settings || !canManage || savingKey === "moderationEnabled"}
        icon={Shield}
        onChange={(checked) => onToggle("moderationEnabled", checked)}
        title="Moderação"
      />
      <Card>
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
          <CardDescription>As regras globais do bot ficam no painel DEV. Aqui ficam apenas ajustes deste servidor.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function RulesView({
  botId,
  canManage,
  guild,
  loading,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  const [options, setOptions] = useState<{ channels: GuildChannelOption[]; roles: Array<{ id: string; name: string; assignable?: boolean }> }>({
    channels: [],
    roles: []
  });
  const [draft, setDraft] = useState({
    rulesButtonLabel: "",
    rulesChannelId: "",
    rulesColor: "#ef4444",
    rulesMessage: "",
    rulesRoleId: "",
    rulesTitle: ""
  });
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      rulesButtonLabel: settings?.rulesButtonLabel || "Li e aceito",
      rulesChannelId: settings?.rulesChannelId || "",
      rulesColor: settings?.rulesColor || "#ef4444",
      rulesMessage: settings?.rulesMessage || "",
      rulesRoleId: settings?.rulesRoleId || "",
      rulesTitle: settings?.rulesTitle || "Regras do servidor"
    });
  }, [settings]);

  useEffect(() => {
    let mounted = true;

    if (!guild) {
      return;
    }

    getGuildLiveOptions(guild.id, botId)
      .then((data) => {
        if (mounted) {
          setOptions({
            channels: data.channels,
            roles: data.roles
          });
        }
      })
      .catch(() => {
        if (mounted) setMessage("Não foi possível carregar canais e cargos.");
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild]);

  async function saveRules(nextEnabled = settings?.rulesEnabled ?? false) {
    if (!guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, {
        rulesButtonLabel: draft.rulesButtonLabel,
        rulesChannelId: draft.rulesChannelId || null,
        rulesColor: draft.rulesColor,
        rulesEnabled: nextEnabled,
        rulesMessage: draft.rulesMessage,
        rulesRoleId: draft.rulesRoleId || null,
        rulesTitle: draft.rulesTitle
      }, botId);
      onSettingsChange(nextSettings);
      setMessage("Sistema de regras salvo.");
      return nextSettings;
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar as regras.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publishPanel() {
    if (!guild) return;

    setPublishing(true);
    setMessage(null);

    try {
      const saved = await saveRules(true);

      if (!saved) return;

      const nextSettings = await publishRulesPanel(guild.id, botId);
      onSettingsChange(nextSettings);
      setMessage("Painel de regras publicado no Discord.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível publicar o painel de regras.");
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !settings) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm font-medium text-zinc-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando regras...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">
          {message}
        </div>
      ) : null}

      <SimpleToggleCard
        checked={Boolean(settings.rulesEnabled)}
        description="Ativa o aceite de regras e libera o painel para este servidor."
        disabled={!canManage || saving}
        icon={ScrollText}
        onChange={(checked) => void saveRules(checked)}
        title="Sistema de regras"
      />

      <PanelImageSettings
        botId={botId}
        canManage={canManage}
        guildId={guild?.id ?? null}
        panelId="rules"
        panelLabel="Regras"
      />

      <Card>
        <CardHeader>
          <CardTitle>Painel de regras</CardTitle>
          <CardDescription>Configure a mensagem, o canal e o cargo entregue ao membro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-100">Canal</span>
              <select
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-[#FFD500]"
                disabled={!canManage}
                onChange={(event) => setDraft((current) => ({ ...current, rulesChannelId: event.target.value }))}
                value={draft.rulesChannelId}
              >
                <option value="">Selecione um canal</option>
                {options.channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>#{channel.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-100">Cargo liberado</span>
              <select
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-[#FFD500]"
                disabled={!canManage}
                onChange={(event) => setDraft((current) => ({ ...current, rulesRoleId: event.target.value }))}
                value={draft.rulesRoleId}
              >
                <option value="">Sem cargo</option>
                {options.roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-100">Titulo</span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-[#FFD500]"
                disabled={!canManage}
                maxLength={120}
                onChange={(event) => setDraft((current) => ({ ...current, rulesTitle: event.target.value }))}
                value={draft.rulesTitle}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-100">Cor</span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-[#FFD500]"
                disabled={!canManage}
                onChange={(event) => setDraft((current) => ({ ...current, rulesColor: event.target.value }))}
                type="color"
                value={draft.rulesColor}
              />
            </label>
          </div>

          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-100">Regras</span>
            <textarea
              className="min-h-44 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFD500]"
              disabled={!canManage}
              maxLength={1800}
              onChange={(event) => setDraft((current) => ({ ...current, rulesMessage: event.target.value }))}
              placeholder="Uma regra por linha"
              value={draft.rulesMessage}
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-100">Texto do botão</span>
            <input
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-[#FFD500]"
              disabled={!canManage}
              maxLength={80}
              onChange={(event) => setDraft((current) => ({ ...current, rulesButtonLabel: event.target.value }))}
              value={draft.rulesButtonLabel}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!canManage || saving || publishing} onClick={() => void saveRules()} variant="secondary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar
            </Button>
            <Button disabled={!canManage || saving || publishing || !draft.rulesChannelId} onClick={() => void publishPanel()}>
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Publicar painel
            </Button>
            {settings.rulesPanelMessageId ? (
              <Badge variant="muted">Mensagem: {settings.rulesPanelMessageId}</Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeleteChannelsPanel({
  botId,
  guild
}: {
  botId?: string | null;
  guild: DashboardGuild | null;
}) {
  const [options, setOptions] = useState<{
    categories: Array<{ id: string; name: string }>;
    channels: GuildChannelOption[];
    roles: GuildRoleOption[];
    voiceChannels: GuildVoiceChannelOption[];
  }>({ categories: [], channels: [], roles: [], voiceChannels: [] });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    if (!guild) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await getGuildLiveOptions(guild.id, botId, true);
      setOptions({
        categories: result.categories ?? [],
        channels: result.channels,
        roles: result.roles,
        voiceChannels: result.voiceChannels ?? []
      });
      setSelectedIds([]);
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível carregar os canais e cargos.");
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  function toggleChannel(channelId: string) {
    setSelectedIds((current) => current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId]);
  }

  function toggleGroup(channelIds: string[]) {
    const allSelected = channelIds.length > 0 && channelIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !channelIds.includes(id))
      : [...new Set([...current, ...channelIds])]);
  }

  async function handleDelete() {
    if (!guild || !selectedIds.length) return;
    const selectedRoleIds = selectedIds.filter((id) => options.roles.some((role) => role.id === id));
    const selectedChannelIds = selectedIds.filter((id) => !selectedRoleIds.includes(id));
    const confirmed = window.confirm(`Apagar permanentemente ${selectedChannelIds.length} canal(is) e ${selectedRoleIds.length} cargo(s)? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;

    setDeleting(true);
    setMessage(null);
    try {
      const result = await deleteGuildChannels(guild.id, selectedChannelIds, selectedRoleIds, botId);
      setMessage(result.failed.length
        ? `${result.deleted.length} removido(s). ${result.failed.length} falharam por permissão ou limite do Discord.`
        : `${result.deleted.length} item(ns) removido(s) com sucesso.`);
      await loadChannels();
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível apagar os itens selecionados.");
    } finally {
      setDeleting(false);
    }
  }

  if (!guild) {
    return <EmptyState icon={Trash2} title="Selecione um servidor para gerenciar os canais" />;
  }

  const categoryIds = options.categories.map((channel) => channel.id);
  const textIds = options.channels.map((channel) => channel.id);
  const voiceIds = options.voiceChannels.map((channel) => channel.id);
  const deletableRoles = options.roles.filter((role) => role.id !== guild.id);
  const roleIds = deletableRoles.filter((role) => role.assignable).map((role) => role.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-red-300" />Selecionar e apagar estrutura</CardTitle>
        <CardDescription>Selecione quantos canais, calls, categorias e cargos quiser remover do servidor {guild.name}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          A exclusão e permanente. O bot precisa de Gerenciar Canais e Gerenciar Cargos. Cargos acima do bot ficam bloqueados para seleção.
        </div>

        <div className="flex flex-wrap gap-3">
          <Button disabled={loading || deleting} onClick={() => void loadChannels()} variant="secondary">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Atualizar lista
          </Button>
          <Button disabled={loading || deleting || !selectedIds.length} onClick={() => void handleDelete()} variant="destructive">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Apagar selecionados ({selectedIds.length})
          </Button>
        </div>

        {message ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">{message}</p> : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <ChannelDeleteGroup
            channelIds={textIds}
            emptyLabel="Nenhum canal de texto encontrado."
            items={options.channels.map((channel) => ({ id: channel.id, label: channel.name, detail: channel.type === "announcement" ? "Anuncios" : "Texto" }))}
            onToggle={toggleChannel}
            onToggleAll={() => toggleGroup(textIds)}
            selectedIds={selectedIds}
            title="Canais de texto"
          />
          <ChannelDeleteGroup
            channelIds={voiceIds}
            emptyLabel="Nenhuma call encontrada."
            items={options.voiceChannels.map((channel) => ({ id: channel.id, label: channel.name, detail: channel.type === "stage" ? "Palco" : "Call" }))}
            onToggle={toggleChannel}
            onToggleAll={() => toggleGroup(voiceIds)}
            selectedIds={selectedIds}
            title="Calls e palcos"
          />
          <ChannelDeleteGroup
            channelIds={categoryIds}
            emptyLabel="Nenhuma categoria encontrada."
            items={options.categories.map((channel) => ({ id: channel.id, label: channel.name, detail: "Categoria" }))}
            onToggle={toggleChannel}
            onToggleAll={() => toggleGroup(categoryIds)}
            selectedIds={selectedIds}
            title="Categorias"
          />
          <ChannelDeleteGroup
            channelIds={roleIds}
            emptyLabel="Nenhum cargo encontrado."
            items={deletableRoles.map((role) => ({
              disabled: !role.assignable,
              id: role.id,
              label: role.name,
              detail: role.assignable ? "Cargo" : "Acima do bot"
            }))}
            onToggle={toggleChannel}
            onToggleAll={() => toggleGroup(roleIds)}
            selectedIds={selectedIds}
            title="Cargos"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelDeleteGroup({
  channelIds,
  emptyLabel,
  items,
  onToggle,
  onToggleAll,
  selectedIds,
  title
}: {
  channelIds: string[];
  emptyLabel: string;
  items: Array<{ id: string; label: string; detail: string; disabled?: boolean }>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  selectedIds: string[];
  title: string;
}) {
  const allSelected = channelIds.length > 0 && channelIds.every((id) => selectedIds.includes(id));
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-medium text-white">{title} ({items.length})</h3>
        <Button disabled={!items.length} onClick={onToggleAll} size="sm" variant="ghost">{allSelected ? "Desmarcar todas" : "Selecionar todas"}</Button>
      </div>
      <div className="discord-scrollbar max-h-96 space-y-2 overflow-y-auto pr-1">
        {items.length ? items.map((item) => (
          <label className={`flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2 transition ${item.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:border-zinc-700 hover:bg-zinc-900"}`} key={item.id}>
            <input checked={selectedIds.includes(item.id)} className="h-4 w-4 accent-red-500" disabled={item.disabled} onChange={() => onToggle(item.id)} type="checkbox" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{item.label}</span>
            <span className="text-xs text-zinc-500">{item.detail}</span>
          </label>
        )) : <p className="py-6 text-center text-sm text-zinc-500">{emptyLabel}</p>}
      </div>
    </section>
  );
}

function SettingsView({
  botId,
  bots,
  canManage,
  canManageOwnerDevModule,
  canManageModule,
  enabledModules,
  guild,
  guilds,
  loading,
  onSettingsChange,
  onToggle,
  savingKey,
  settings,
  tickets
}: {
  botId?: string | null;
  bots: DashboardBot[];
  canManage: boolean;
  canManageOwnerDevModule: (moduleId: string) => boolean;
  canManageModule: (moduleId: string) => boolean;
  enabledModules: string[];
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  tickets: Ticket[];
}) {
  const blocks: JSX.Element[] = [];

  if (enabledModules.includes("tickets")) {
    blocks.push(
      <div className="space-y-4" key="tickets">
        <SimpleToggleCard
          checked={Boolean(settings?.ticketEnabled)}
          description={`${tickets.length} ticket(s) registrados neste servidor.`}
          disabled={!settings || !canManageModule("tickets") || savingKey === "ticketEnabled"}
          icon={TicketIcon}
          onChange={(checked) => onToggle("ticketEnabled", checked)}
          title="Tickets"
        />
        <PanelImageSettings
          botId={botId}
          canManage={canManageModule("tickets")}
          guildId={guild?.id ?? null}
          panelId="ticket"
          panelLabel="Ticket"
        />
        <TicketPanelConfigurator
          botId={botId}
          canManage={canManageModule("tickets")}
          guild={guild}
          onSettingsChange={onSettingsChange}
          settings={settings}
        />
      </div>
    );
  }

  if (enabledModules.includes("network")) {
    blocks.push(
      <div className="space-y-4" key="network">
        <PanelImageSettings
          botId={botId}
          canManage={canManageModule("network")}
          guildId={guild?.id ?? null}
          panelId="social-network"
          panelLabel="Redes sociais"
        />
        <MemberSocialNetworkPanel
          botId={botId}
          canManage={canManageModule("network")}
          guild={guild}
        />
      </div>
    );
  }

  if (enabledModules.includes("server-generator")) {
    blocks.push(
      <Card key="server-generator">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5 text-red-300" />Apagar canais e cargos</CardTitle>
          <CardDescription>Ferramenta de limpeza total disponibilizada pelo comando /delete-serve.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            Este comando apaga todos os canais e cargos editaveis. Por segurança, somente o dono do servidor pode executar.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-xs text-zinc-500">Comando</p>
              <p className="mt-1 font-mono text-sm text-white">/delete-serve</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
              <p className="text-xs text-zinc-500">Confirmação obrigatória</p>
              <p className="mt-1 font-mono text-sm text-white">APAGAR TUDO</p>
            </div>
          </div>
          <p className="text-xs text-zinc-500">O bot precisa das permissões Gerenciar Canais e Gerenciar Cargos e ignora itens acima do cargo dele.</p>
        </CardContent>
      </Card>
    );
  }

  if (!blocks.length) {
    return <EmptyState icon={Settings} title="Nenhuma configuração simples liberada para este bot" />;
  }

  return <div className="space-y-5">{blocks}</div>;
}

function ManualRegistrationPanel({
  botId,
  canManage,
  goalsEnabled,
  guild
}: {
  botId?: string | null;
  canManage: boolean;
  goalsEnabled: boolean;
  guild: DashboardGuild | null;
}) {
  const [settings, setSettings] = useState<ManualRegistrationSettings | null>(null);
  const [submissions, setSubmissions] = useState<ManualRegistrationSubmission[]>([]);
  const [registrationLogs, setRegistrationLogs] = useState<ManualRegistrationLog[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [applicationEmojis, setApplicationEmojis] = useState<ApplicationEmojiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberOptions, setMemberOptions] = useState<GuildMemberOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [manualRoleId, setManualRoleId] = useState("");
  const [goalCategoryId, setGoalCategoryId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [gameId, setGameId] = useState("");

  useEffect(() => {
    if (!guild) {
      setSettings(null);
      setSubmissions([]);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      getManualRegistrationDashboard(guild.id, botId),
      getGuildLiveOptions(guild.id, botId),
      getGuildMemberOptions(guild.id, "", botId),
      botId ? getApplicationEmojis(botId, { sort: "name" }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] })
    ])
      .then(([dashboard, options, members, emojis]) => {
        if (!active) return;
        setSettings(dashboard.settings);
        setSubmissions(dashboard.submissions);
        setRegistrationLogs(dashboard.logs ?? []);
        setChannels(options.channels);
        setCategories(options.categories ?? []);
        setRoles(options.roles);
        setApplicationEmojis(emojis.items);
        setMemberOptions(members.filter((member) => !member.bot));
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar o cadastro manual.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!guild) return;
    const socket = createDashboardSocket();
    const refresh = (payload: { botId?: string | null; guildId: string }) => {
      if (payload.guildId !== guild.id || (payload.botId ?? null) !== (botId ?? null)) return;
      void getManualRegistrationDashboard(guild.id, botId).then((dashboard) => {
        setSettings(dashboard.settings);
        setSubmissions(dashboard.submissions);
        setRegistrationLogs(dashboard.logs ?? []);
      }).catch(() => null);
    };
    socket.on("manual-registration:updated", refresh);
    return () => {
      socket.off("manual-registration:updated", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  function patchSettings(patch: Partial<ManualRegistrationSettings>) {
    setSettings((current) => current ? { ...current, ...patch } : current);
  }

  function patchField(index: number, patch: Partial<ManualRegistrationField>) {
    setSettings((current) => current ? {
      ...current,
      fields: current.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field)
    } : current);
  }

  function addField() {
    setSettings((current) => current ? {
      ...current,
      fields: [
        ...current.fields,
        {
          enabled: true,
          id: `campo-${current.fields.length + 1}`,
          label: `Campo ${current.fields.length + 1}`,
          maxLength: 120,
          minLength: null,
          name: `campo_${current.fields.length + 1}`,
          placeholder: "",
          required: true,
          style: "short"
        }
      ]
    } : current);
  }

  function removeField(index: number) {
    setSettings((current) => current ? {
      ...current,
      fields: current.fields.filter((_, fieldIndex) => fieldIndex !== index)
    } : current);
  }

  function patchSetRole(index: number, patch: Partial<ManualRegistrationSetRole>) {
    setSettings((current) => current ? { ...current, setRoles: current.setRoles.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : current);
  }

  function addSetRole() {
    setSettings((current) => current ? { ...current, setRoles: [...current.setRoles, { description: "", emoji: "", enabled: true, id: `set-${current.setRoles.length + 1}`, name: `Set ${current.setRoles.length + 1}`, order: current.setRoles.length + 1, requestable: true, roleId: "" }] } : current);
  }

  function removeSetRole(index: number) {
    setSettings((current) => current ? { ...current, setRoles: current.setRoles.filter((_, itemIndex) => itemIndex !== index) } : current);
  }

  async function save() {
    if (!guild || !settings || !canManage) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const saved = await saveManualRegistrationSettings(guild.id, settings, botId);
      setSettings(saved);
      setMessage("Pedido de Set salvo.");
    } catch {
      setError("Não foi possível salvar o Pedido de Set.");
    } finally {
      setSaving(false);
    }
  }

  async function publishSetPanel() {
    if (!guild || !settings || !canManage) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await saveManualRegistrationSettings(guild.id, settings, botId);
      setSettings(await publishManualRegistrationPanel(guild.id, botId));
      setMessage(`Painel solicitado para o bot${saved.panelChannelId ? ` em <#${saved.panelChannelId}>` : ""}.`);
    } catch {
      setError("Não foi possível publicar o painel. Confira o canal, o módulo e se o bot está online.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSubmission(submission: ManualRegistrationSubmission) {
    if (!guild || !canManage || submission.status !== "approved") return;
    const reason = window.prompt(`Motivo para remover o cadastro de ${submission.requestedName}?`);
    if (!reason?.trim()) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await deleteManualRegistrationSubmission(guild.id, submission.id, reason.trim(), botId);
      setMessage("Remoção solicitada ao bot. O resultado será sincronizado em tempo real.");
    } catch {
      setError("Não foi possível excluir o cadastro.");
    } finally {
      setSaving(false);
    }
  }

  async function registerMember() {
    if (!guild || !selectedMemberId || !manualRoleId || !goalCategoryId || !characterName.trim() || !gameId.trim()) return;
    const member = memberOptions.find((item) => item.id === selectedMemberId);
    if (!member) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const submission = await createManualRegistrationSubmission(guild.id, {
        characterName: characterName.trim(), gameId: gameId.trim(), goalCategoryId, requestedRoleId: manualRoleId,
        userAvatar: member.avatarUrl, userId: member.id, username: member.displayName || member.username
      }, botId);
      setSubmissions((current) => [submission, ...current]);
      setSelectedMemberId(""); setManualRoleId(""); setGoalCategoryId(""); setCharacterName(""); setGameId("");
      setMessage("Cadastro enviado ao bot. O cargo e o canal de meta serão preparados automaticamente.");
    } catch {
      setError("Não foi possível cadastrar o membro.");
    } finally {
      setSaving(false);
    }
  }

  if (!guild) {
    return <EmptyState icon={ListChecks} title="Selecione um servidor para configurar o Pedido de Set" />;
  }

  return (
    <Card className="border-[#FFD500]/10 bg-zinc-950/70">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-[#FFEA70]" /> Sistema de Pedido de Set</CardTitle>
            <CardDescription>Painel, sets solicitaveis, modal, aprovação, cargos e logs em Components V2.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!canManage || !settings?.enabled || !settings.panelChannelId || !settings.requestCategoryId || !settings.approvedRoleId || !settings.approverRoleIds.length || saving || loading} onClick={() => void publishSetPanel()} size="sm" type="button" variant="outline"><Upload className="mr-2 h-4 w-4" />Enviar painel</Button>
            <Button disabled={!canManage || !settings || saving || loading} onClick={() => void save()} size="sm" type="button">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Salvar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
        <div className={`border-l-2 px-3 py-2 text-sm ${goalsEnabled ? "border-emerald-400 bg-emerald-500/[0.05] text-emerald-100" : "border-amber-400 bg-amber-500/[0.06] text-amber-100"}`}>
          {goalsEnabled ? "Integração com Metas disponível. O vínculo automático é controlado no menu Metas." : "O Pedido de Set funciona normalmente, mas o módulo Metas precisa ser liberado na Build DEV para criar canais de meta após a aprovação."}
        </div>
        {loading || !settings ? <div className="h-40 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60" /> : (
          <>
            <div className="space-y-3 rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/[0.04] p-4">
              <div><p className="text-sm font-semibold text-white">Cadastrar membro</p><p className="text-xs text-zinc-500">Os usuários do Discord são carregados automaticamente. Selecione o membro e o cargo para criar o canal privado de meta.</p></div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <label className="block text-xs font-medium text-zinc-400">Usuário
                  <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage || !memberOptions.length} onChange={(event) => { const member = memberOptions.find((item) => item.id === event.target.value); setSelectedMemberId(event.target.value); if (member) setCharacterName(member.displayName); }} value={selectedMemberId}>
                    <option value="">Selecionar usuário</option>
                    {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.displayName} ({member.id})</option>)}
                  </select>
                </label>
                <RoleSelect disabled={!canManage} label="Cargo / Set" onChange={setManualRoleId} roles={roles.filter((role) => role.assignable)} value={manualRoleId} />
                <label className="block text-xs font-medium text-zinc-400">Categoria do canal de meta
                  <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => setGoalCategoryId(event.target.value)} value={goalCategoryId}>
                    <option value="">Selecionar categoria</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                <TicketField disabled={!canManage} label="Nome do personagem" onChange={setCharacterName} value={characterName} />
                <TicketField disabled={!canManage} label="ID in-game" onChange={setGameId} value={gameId} />
              </div>
              <Button disabled={!canManage || saving || !selectedMemberId || !manualRoleId || !goalCategoryId || !characterName.trim() || !gameId.trim()} onClick={() => void registerMember()} type="button"><UserPlus className="mr-2 h-4 w-4" />Cadastrar e criar canal</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <MetricCard icon={ListChecks} label="Pedidos" value={String(submissions.length)} />
              <MetricCard icon={Clock3} label="Pendentes" value={String(submissions.filter((item) => item.status === "pending").length)} />
              <MetricCard icon={CheckCircle2} label="Aprovados" value={String(submissions.filter((item) => item.status === "approved").length)} />
              <MetricCard icon={XCircle} label="Recusados" value={String(submissions.filter((item) => item.status === "rejected").length)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-xs font-medium text-zinc-400">Ativo
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchSettings({ enabled: event.target.value === "true" })} value={String(settings.enabled)}>
                  <option value="true">Ativado</option>
                  <option value="false">Desativado</option>
                </select>
              </label>
              <TicketField disabled={!canManage} label="Nome" onChange={(value) => patchSettings({ name: value })} value={settings.name} />
              <TicketField disabled={!canManage} label="Titulo do painel" onChange={(value) => patchSettings({ title: value })} value={settings.title} />
              <EmojiField
                applicationEmojis={applicationEmojis}
                disabled={!canManage}
                label="Emoji do painel"
                onChange={(value) => patchSettings({ emoji: value })}
                value={settings.emoji ?? ""}
              />
              <TicketField disabled={!canManage} label="Cor" onChange={(value) => patchSettings({ color: value })} type="color" value={settings.color} />
              <TicketField disabled={!canManage} label="Thumbnail URL" onChange={(value) => patchSettings({ thumbnailUrl: value })} value={settings.thumbnailUrl ?? ""} />
              <label className="block text-xs font-medium text-zinc-400">Canal do painel
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchSettings({ panelChannelId: event.target.value || null })} value={settings.panelChannelId ?? ""}>
                  <option value="">Selecionar canal</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-zinc-400">Categoria dos canais privados
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchSettings({ requestCategoryId: event.target.value || null })} value={settings.requestCategoryId ?? ""}>
                  <option value="">Selecionar categoria</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-zinc-400">Canal de aprovação
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchSettings({ approvalChannelId: event.target.value || null })} value={settings.approvalChannelId ?? ""}>
                  <option value="">Selecionar canal</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-zinc-400">Canal de logs
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchSettings({ logChannelId: event.target.value || null })} value={settings.logChannelId ?? ""}>
                  <option value="">Sem canal de logs</option>
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                </select>
              </label>
              <TicketField disabled={!canManage} label="Cooldown em minutos" onChange={(value) => patchSettings({ cooldownMinutes: Math.max(0, Number(value) || 0) })} value={String(settings.cooldownMinutes)} />
              <label className="block text-xs font-medium text-zinc-400">Banner
                <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchSettings({ bannerPosition: event.target.value as ManualRegistrationSettings["bannerPosition"] })} value={settings.bannerPosition}>
                  <option value="top">Superior</option>
                  <option value="bottom">Inferior</option>
                  <option value="none">Sem banner</option>
                </select>
              </label>
            </div>
            <TicketArea disabled={!canManage} label="Descrição" onChange={(value) => patchSettings({ description: value })} value={settings.description ?? ""} />
            <TicketArea disabled={!canManage} label="Tutorial - Como funciona" onChange={(value) => patchSettings({ tutorial: value })} value={settings.tutorial} />
            <TicketField disabled={!canManage} label="Rodapé" onChange={(value) => patchSettings({ footerText: value })} value={settings.footerText ?? ""} />

            <div className="grid gap-3 md:grid-cols-2">
              <RoleSelect disabled={!canManage} label="Cargo atribuido ao aprovar" onChange={(approvedRoleId) => patchSettings({ approvedRoleId })} roles={roles.filter((role) => role.assignable)} value={settings.approvedRoleId ?? ""} />
              <MultiRoleSelect disabled={!canManage} label="Cargos para remover" onChange={(values) => patchSettings({ removeRoleIds: values })} roles={roles} values={settings.removeRoleIds} />
              <MultiRoleSelect disabled={!canManage} label="Cargos aprovadores" onChange={(values) => patchSettings({ approverRoleIds: values })} roles={roles} values={settings.approverRoleIds} />
              <MultiRoleSelect disabled={!canManage} label="Cargos para cadastro manual" onChange={(values) => patchSettings({ manualRegistrationRoleIds: values })} roles={roles} values={settings.manualRegistrationRoleIds} />
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <label className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={settings.allowOnlyOneRequest} disabled={!canManage} onChange={(event) => patchSettings({ allowOnlyOneRequest: event.target.checked })} type="checkbox" />Somente um set aprovado</label>
              <label className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={settings.allowResubmit} disabled={!canManage} onChange={(event) => patchSettings({ allowResubmit: event.target.checked })} type="checkbox" />Permitir após recusa</label>
              <label className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={settings.dmNotifications} disabled={!canManage} onChange={(event) => patchSettings({ dmNotifications: event.target.checked })} type="checkbox" />Notificar por DM</label>
              <label className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300"><input checked={settings.automaticApproval} disabled={!canManage} onChange={(event) => patchSettings({ automaticApproval: event.target.checked })} type="checkbox" />Aprovação automática</label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <TicketArea disabled={!canManage} label="Mensagem de pedido enviado" onChange={(value) => patchSettings({ successMessage: value })} value={settings.successMessage} />
              <TicketArea disabled={!canManage} label="Mensagem de aprovação" onChange={(value) => patchSettings({ approvalMessage: value })} value={settings.approvalMessage} />
              <TicketArea disabled={!canManage} label="Mensagem de recusa" onChange={(value) => patchSettings({ rejectionMessage: value })} value={settings.rejectionMessage} />
            </div>

            <PanelImageSettings botId={botId} canManage={canManage} guildId={guild.id} panelId="manual-registration" panelLabel="Pedido de Set" />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-semibold text-white">Cargos e sets disponíveis</p><p className="text-xs text-zinc-500">Cada opção vincula o pedido a um cargo real do Discord.</p></div>
                <Button disabled={!canManage || settings.setRoles.length >= 25} onClick={addSetRole} size="sm" type="button" variant="outline">Adicionar set</Button>
              </div>
              {settings.setRoles.map((item, index) => (
                <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 lg:grid-cols-[180px_1fr_1fr_1fr_110px_90px_auto]" key={`${item.id}-${index}`}>
                  <EmojiField applicationEmojis={applicationEmojis} disabled={!canManage} label="Emoji" onChange={(value) => patchSetRole(index, { emoji: value })} value={item.emoji ?? ""} />
                  <TicketField disabled={!canManage} label="Nome" onChange={(value) => patchSetRole(index, { id: slugTicketOption(value, index), name: value })} value={item.name} />
                  <RoleSelect disabled={!canManage} label="Cargo vinculado" onChange={(value) => patchSetRole(index, { roleId: value })} roles={roles} value={item.roleId} />
                  <TicketField disabled={!canManage} label="Descrição" onChange={(value) => patchSetRole(index, { description: value })} value={item.description ?? ""} />
                  <div className="flex flex-col justify-end text-xs text-zinc-500"><span>Entregues</span><span className="mt-2 text-sm font-semibold text-zinc-200">{submissions.filter((submission) => submission.status === "approved" && submission.requestedRoleId === item.roleId).length}</span></div>
                  <label className="flex flex-col justify-end gap-1 text-xs text-zinc-300"><span className="flex items-center gap-2"><input checked={item.enabled} disabled={!canManage} onChange={(event) => patchSetRole(index, { enabled: event.target.checked })} type="checkbox" />Ativo</span><span className="flex items-center gap-2"><input checked={item.requestable} disabled={!canManage} onChange={(event) => patchSetRole(index, { requestable: event.target.checked })} type="checkbox" />Solicitavel</span></label>
                  <div className="flex items-end"><Button disabled={!canManage} onClick={() => removeSetRole(index)} size="icon" title="Remover set" type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button></div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Campos do modal</p>
                  <p className="text-xs text-zinc-500">O sistema divide automaticamente as perguntas em etapas de até 5 campos por modal.</p>
                </div>
                <Button disabled={!canManage || settings.fields.length >= 100} onClick={addField} size="sm" type="button" variant="outline">Adicionar campo</Button>
              </div>
              {settings.fields.map((field, index) => (
                <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 lg:grid-cols-[1fr_1fr_120px_180px_auto]" key={`${field.id}-${index}`}>
                  <TicketField disabled={!canManage} label="Label" onChange={(value) => patchField(index, { label: value, id: slugTicketOption(value, index), name: slugTicketOption(value, index).replace(/-/g, "_") })} value={field.label} />
                  <TicketField disabled={!canManage} label="Placeholder" onChange={(value) => patchField(index, { placeholder: value })} value={field.placeholder ?? ""} />
                  <label className="block text-xs font-medium text-zinc-400">Tipo
                    <select className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => patchField(index, { style: event.target.value as ManualRegistrationField["style"] })} value={field.style}>
                      <option value="short">Curto</option>
                      <option value="paragraph">Longo</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-2 text-xs text-zinc-300">
                    <span className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 px-3">
                      <input checked={field.enabled !== false} disabled={!canManage} onChange={(event) => patchField(index, { enabled: event.target.checked })} type="checkbox" />
                      Ativo
                    </span>
                    <span className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 px-3">
                      <input checked={field.required} disabled={!canManage} onChange={(event) => patchField(index, { required: event.target.checked })} type="checkbox" />
                      Obrig.
                    </span>
                  </label>
                  <div className="flex items-end">
                    <Button disabled={!canManage || settings.fields.length <= 1} onClick={() => removeField(index)} size="icon" title="Remover campo" type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Cadastros recebidos</p>
              {submissions.map((submission) => (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-3 text-sm" key={submission.id}>
                  <div className="min-w-0">
                    <p className="truncate text-zinc-200">{submission.username} ({submission.userId})</p>
                    <p className="mt-1 text-xs text-zinc-500">{submission.fields.map((field) => `${field.label}: ${field.value}`).join(" | ")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={submission.status === "approved" ? "success" : submission.status === "rejected" ? "danger" : "muted"}>{submission.status}</Badge>
                    <Button disabled={!canManage || saving} onClick={() => void removeSubmission(submission)} size="icon" title="Excluir cadastro" type="button" variant="outline"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              {!submissions.length ? <p className="text-sm text-zinc-500">Nenhum cadastro recebido.</p> : null}
            </div>
            <div className="space-y-2 border-t border-zinc-800 pt-4">
              <p className="text-sm font-semibold text-white">Logs recentes</p>
              {registrationLogs.slice(0, 8).map((log) => (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs" key={log.id}><span className="text-zinc-300">{log.action}</span><span className="text-zinc-500">{new Date(log.createdAt).toLocaleString("pt-BR")}</span></div>
              ))}
              {!registrationLogs.length ? <p className="text-sm text-zinc-500">Nenhuma ação registrada.</p> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TicketPanelConfigurator({
  botId,
  canManage,
  guild,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  const [draft, setDraft] = useState(() => ticketPanelDraft(settings));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildLiveOptions["channels"]>([]);
  const [applicationEmojis, setApplicationEmojis] = useState<ApplicationEmojiItem[]>([]);
  const disabled = !guild || !settings || !canManage || saving || publishing;

  useEffect(() => {
    setDraft(ticketPanelDraft(settings));
  }, [
    settings?.guildId,
    settings?.ticketPanelChannelId,
    settings?.ticketPanelMessageId,
    settings?.ticketPanelTitle,
    settings?.ticketPanelDescription,
    settings?.ticketPanelInfoText,
    settings?.ticketPanelFooterText,
    settings?.ticketPanelColor,
    settings?.ticketPanelPlaceholder,
    JSON.stringify(settings?.ticketPanelOptions ?? [])
  ]);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      return;
    }

    let active = true;
    getGuildLiveOptions(guild.id, botId)
      .then((data) => {
        if (active) setChannels(data.channels ?? []);
      })
      .catch(() => {
        if (active) setChannels([]);
      });

    return () => {
      active = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!botId) {
      setApplicationEmojis([]);
      return;
    }

    let active = true;
    getApplicationEmojis(botId, { sort: "name" })
      .then((page) => {
        if (active) setApplicationEmojis(page.items);
      })
      .catch(() => {
        if (active) setApplicationEmojis([]);
      });

    return () => {
      active = false;
    };
  }, [botId]);

  function updateOption(index: number, patch: Partial<TicketPanelOption>) {
    setDraft((current) => ({
      ...current,
      ticketPanelOptions: current.ticketPanelOptions.map((option, optionIndex) => (
        optionIndex === index ? normalizeTicketOptionDraft({ ...option, ...patch }, index) : option
      ))
    }));
  }

  function addOption() {
    setDraft((current) => ({
      ...current,
      ticketPanelOptions: [
        ...current.ticketPanelOptions,
        {
          description: "Descreva este atendimento.",
          emoji: PANEL_EMOJIS.prancheta,
          enabled: true,
          label: `Atendimento ${current.ticketPanelOptions.length + 1}`,
          value: `atendimento-${current.ticketPanelOptions.length + 1}`
        }
      ].slice(0, 25)
    }));
  }

  function removeOption(index: number) {
    setDraft((current) => {
      const nextOptions = current.ticketPanelOptions.filter((_, optionIndex) => optionIndex !== index);
      return {
        ...current,
        ticketPanelOptions: nextOptions.length ? nextOptions : ticketPanelDraft(null).ticketPanelOptions
      };
    });
  }

  function buildPayload() {
    return {
      ...draft,
      ticketPanelOptions: draft.ticketPanelOptions.map(normalizeTicketOptionDraft)
    };
  }

  async function save() {
    if (!guild || !settings || disabled) return;

    const previous = settings;
    const payload = buildPayload();

    setSaving(true);
    setStatus(null);
    setError(null);
    onSettingsChange({ ...settings, ...payload });

    try {
      const saved = await patchGuildSettings(guild.id, payload, botId);
      onSettingsChange(saved);
      setStatus("Painel de ticket salvo.");
    } catch {
      onSettingsChange(previous);
      setError("Não foi possível salvar o painel de ticket.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!guild || !settings || disabled || !draft.ticketPanelChannelId) return;

    const previous = settings;
    const payload = buildPayload();

    setPublishing(true);
    setStatus(null);
    setError(null);
    onSettingsChange({ ...settings, ...payload });

    try {
      const saved = await patchGuildSettings(guild.id, payload, botId);
      onSettingsChange(saved);
      const published = await publishTicketPanel(guild.id, botId);
      onSettingsChange(published);
      setStatus("Publicação do painel solicitada ao bot.");
    } catch {
      onSettingsChange(previous);
      setError("Não foi possível publicar o painel de ticket.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Card className="border-[#FFD500]/10 bg-zinc-950/70">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><TicketIcon className="h-5 w-5 text-[#FFEA70]" /> Painel visual do ticket</CardTitle>
            <CardDescription>Texto, cor, menu e emojis que aparecem no painel publicado pelo bot.</CardDescription>
          </div>
          <Button disabled={disabled} onClick={() => void save()} size="sm" type="button">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
          <Button disabled={disabled || !settings?.ticketEnabled || !draft.ticketPanelChannelId} onClick={() => void publish()} size="sm" type="button" variant="outline">
            {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Publicar/Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {status ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{status}</div> : null}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-medium text-zinc-400">
            Canal do painel
            <select
              className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none disabled:opacity-60"
              disabled={disabled}
              onChange={(event) => setDraft((current) => ({ ...current, ticketPanelChannelId: event.target.value || null }))}
              value={draft.ticketPanelChannelId ?? ""}
            >
              <option value="">Selecione um canal</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
          </label>
          <TicketField disabled={disabled} label="Titulo" onChange={(value) => setDraft((current) => ({ ...current, ticketPanelTitle: value }))} value={draft.ticketPanelTitle ?? ""} />
          <TicketField disabled={disabled} label="Placeholder do menu" onChange={(value) => setDraft((current) => ({ ...current, ticketPanelPlaceholder: value }))} value={draft.ticketPanelPlaceholder ?? ""} />
          <TicketField disabled={disabled} label="Cor neon" onChange={(value) => setDraft((current) => ({ ...current, ticketPanelColor: value }))} type="color" value={draft.ticketPanelColor} />
          <TicketField disabled={disabled} label="Rodapé" onChange={(value) => setDraft((current) => ({ ...current, ticketPanelFooterText: value }))} value={draft.ticketPanelFooterText ?? ""} />
        </div>

        <div className="rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/5 px-3 py-2 text-xs text-zinc-300">
          Mensagem oficial: {settings?.ticketPanelMessageId ? settings.ticketPanelMessageId : "não publicada"}
        </div>

        <TicketArea disabled={disabled} label="Descrição principal" onChange={(value) => setDraft((current) => ({ ...current, ticketPanelDescription: value }))} value={draft.ticketPanelDescription ?? ""} />
        <TicketArea disabled={disabled} label="Informações abaixo da descrição" onChange={(value) => setDraft((current) => ({ ...current, ticketPanelInfoText: value }))} value={draft.ticketPanelInfoText ?? ""} />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Opções do menu</p>
              <p className="text-xs text-zinc-500">Use emoji comum ou escolha um emoji da aplicacao do bot.</p>
            </div>
            <Button disabled={disabled || draft.ticketPanelOptions.length >= 25} onClick={addOption} size="sm" type="button" variant="outline">Adicionar</Button>
          </div>

          {draft.ticketPanelOptions.map((option, index) => (
            <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 lg:grid-cols-[1fr_1fr_120px_160px_auto]" key={`${option.value}-${index}`}>
              <TicketField disabled={disabled} label="Nome" onChange={(value) => updateOption(index, { label: value, value: slugTicketOption(value, index) })} value={option.label} />
              <TicketField disabled={disabled} label="Descrição" onChange={(value) => updateOption(index, { description: value })} value={option.description ?? ""} />
              <TicketField disabled={disabled} label="Emoji" onChange={(value) => updateOption(index, { emoji: value })} value={option.emoji ?? ""} />
              <label className="block text-xs font-medium text-zinc-400">
                Emoji da Dashboard
                <select
                  className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none disabled:opacity-60"
                  disabled={disabled || !applicationEmojis.length}
                  onChange={(event) => event.target.value && updateOption(index, { emoji: event.target.value })}
                  value=""
                >
                  <option value="">Selecionar</option>
                  {applicationEmojis.map((emoji) => (
                    <option key={emoji.id} value={`<${emoji.animated ? "a" : ""}:${emoji.originalName}:${emoji.applicationEmojiId}>`}>
                      {emoji.originalName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300">
                  <input checked={option.enabled} disabled={disabled} onChange={(event) => updateOption(index, { enabled: event.target.checked })} type="checkbox" />
                  Ativa
                </label>
                <Button disabled={disabled || draft.ticketPanelOptions.length <= 1} onClick={() => removeOption(index)} size="icon" title="Remover opção" type="button" variant="outline">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PoliceIabPanel({
  botId,
  canManage,
  guild,
  loading,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  const [draft, setDraft] = useState<GuildSettings["reportSystem"] | null>(settings?.reportSystem ?? null);
  const [options, setOptions] = useState<GuildLiveOptions>({ categories: [], channels: [], roles: [], voiceChannels: [] });
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(settings?.reportSystem?.categories[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const disabled = !guild || !settings || !draft || !canManage || saving || publishing;

  useEffect(() => {
    setDraft(settings?.reportSystem ?? null);
  }, [settings?.guildId, JSON.stringify(settings?.reportSystem ?? null)]);

  useEffect(() => {
    if (!draft?.categories.length) {
      setSelectedOrgId(null);
      return;
    }
    setSelectedOrgId((current) => current && draft.categories.some((category) => category.id === current) ? current : draft.categories[0]?.id ?? null);
  }, [draft?.categories.map((category) => category.id).join("|")]);

  useEffect(() => {
    let mounted = true;

    if (!guild) {
      setOptions({ categories: [], channels: [], roles: [], voiceChannels: [] });
      return;
    }

    getGuildLiveOptions(guild.id, botId)
      .then((data) => {
        if (mounted) setOptions({ ...data, categories: data.categories ?? [], voiceChannels: data.voiceChannels ?? [] });
      })
      .catch(() => {
        if (mounted) setMessage("Não foi possível carregar canais e cargos do servidor.");
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild]);

  function patch(patchValue: Partial<GuildSettings["reportSystem"]>) {
    setDraft((current) => current ? { ...current, ...patchValue } : current);
  }

  function patchCategory(index: number, patchValue: Partial<ReportSystemCategory>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        categories: current.categories.map((category, categoryIndex) => (
          categoryIndex === index ? normalizeReportCategory({ ...category, ...patchValue }, index) : category
        ))
      };
    });
  }

  function addCategory() {
    let nextId: string | null = null;
    setDraft((current) => {
      if (!current) return current;
      const index = current.categories.length;
      const categoryId = `orgao-${index + 1}`;
      nextId = categoryId;
      return {
        ...current,
        categories: [
          ...current.categories,
          normalizeReportCategory({
            channelOrCategoryId: null,
            color: "#dc2626",
            description: "Novo órgão de atendimento.",
            emoji: PANEL_EMOJIS.alerta,
            enabled: true,
            escalateToCategoryId: null,
            id: categoryId,
            judgeLabel: "Denuncias contra este órgão",
            logChannelId: null,
            name: `Órgão ${index + 1}`,
            order: index + 1,
            responsibleRoleIds: []
          }, index)
        ].slice(0, 25)
      };
    });
    if (nextId) setSelectedOrgId(nextId);
  }

  function removeCategory(index: number) {
    const removedId = draft?.categories[index]?.id ?? null;
    const nextSelectedId = draft?.categories[index + 1]?.id ?? draft?.categories[index - 1]?.id ?? null;
    setDraft((current) => {
      if (!current) return current;
      const nextCategories = current.categories.filter((_, categoryIndex) => categoryIndex !== index);
      return { ...current, categories: nextCategories.length ? nextCategories.map(normalizeReportCategory) : current.categories };
    });
    if (removedId && selectedOrgId === removedId) setSelectedOrgId(nextSelectedId);
  }

  async function save(nextEnabled?: boolean) {
    if (!guild || !settings || !draft || disabled && nextEnabled === undefined) return;

    const previous = settings;
    const payload = {
      ...draft,
      enabled: nextEnabled ?? draft.enabled,
      categories: draft.categories.map(normalizeReportCategory)
    };

    setSaving(true);
    setMessage(null);
    onSettingsChange({ ...settings, reportSystem: payload });

    try {
      const saved = await patchGuildSettings(guild.id, { reportSystem: payload }, botId);
      onSettingsChange(saved);
      setMessage("Denuncias Corregedoria salvas.");
    } catch (error) {
      onSettingsChange(previous);
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar Denuncias Corregedoria.");
    } finally {
      setSaving(false);
    }
  }

  async function publishPanel() {
    if (!guild || !settings || !draft || disabled) return;

    setPublishing(true);
    setMessage(null);

    try {
      const payload = {
        ...draft,
        categories: draft.categories.map(normalizeReportCategory)
      };
      const saved = await patchGuildSettings(guild.id, { reportSystem: payload }, botId);
      onSettingsChange(saved);
      const published = await publishReportSystemPanel(guild.id, botId);
      onSettingsChange(published);
      setMessage("Painel Denuncias Corregedoria publicado no Discord.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível publicar o painel. Confira canal e permissões do bot.");
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !draft) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm font-medium text-zinc-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando Denuncias Corregedoria...
        </CardContent>
      </Card>
    );
  }

  const channels = options.channels;
  const categories = options.categories ?? [];
  const reportCategoryOptions = draft.categories.map((category) => ({ id: category.id, name: category.name }));
  const categoryDestinationOptions = categories.map((category) => ({ id: category.id, name: category.name }));
  const selectedOrgIndex = Math.max(0, draft.categories.findIndex((category) => category.id === selectedOrgId));
  const selectedOrg = draft.categories[selectedOrgIndex] ?? draft.categories[0] ?? null;

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">
          {message}
        </div>
      ) : null}

      <Card className="border-red-500/10 bg-zinc-950/70">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-red-300" /> Denuncias Corregedoria</CardTitle>
              <CardDescription>Configura o painel IAB, órgãos, anonimato, logs e cargos autorizados.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300">
                <Switch checked={draft.enabled} disabled={!canManage || saving || !guild || !settings} onCheckedChange={(checked) => void save(checked)} />
                {draft.enabled ? "Ativo" : "Inativo"}
              </label>
              <Button disabled={disabled} onClick={() => void save()} size="sm" type="button">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
              <Button disabled={disabled || !draft.enabled || !draft.panelChannelId} onClick={() => void publishPanel()} size="sm" type="button" variant="outline">
                {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Salvar e publicar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <TicketField disabled={disabled} label="Nome interno" onChange={(value) => patch({ name: value })} value={draft.name} />
            <TicketField disabled={disabled} label="Titulo público" onChange={(value) => patch({ panelTitle: value })} value={draft.panelTitle} />
            <TicketField disabled={disabled} label="Placeholder do menu" onChange={(value) => patch({ panelPlaceholder: value })} value={draft.panelPlaceholder} />
            <TicketField disabled={disabled} label="Cor do painel" onChange={(value) => patch({ panelColor: value })} type="color" value={draft.panelColor} />
            <TicketField disabled={disabled} label="Botão de abertura" onChange={(value) => patch({ buttonText: value })} value={draft.buttonText} />
            <TicketField disabled={disabled} label="Rodapé" onChange={(value) => patch({ footerText: value })} value={draft.footerText ?? ""} />
          </div>

          <TicketArea disabled={disabled} label="Descrição do painel" onChange={(value) => patch({ panelDescription: value })} value={draft.panelDescription} />
          <TicketArea disabled={disabled} label="Mensagem após abrir denúncia" onChange={(value) => patch({ openMessage: value })} value={draft.openMessage} />

          <div className="grid gap-3 md:grid-cols-2">
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal do painel" onChange={(value) => patch({ panelChannelId: value })} placeholder="Selecionar canal" value={draft.panelChannelId} />
            <FivemResourceSelect disabled={disabled} label="Categoria temporaria dos tickets" onChange={(value) => patch({ categoryId: value })} options={categories.map((category) => ({ id: category.id, name: category.name }))} placeholder="Selecionar categoria" prefix="📁" value={draft.categoryId} />
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal de logs" onChange={(value) => patch({ logChannelId: value })} placeholder="Selecionar canal" value={draft.logChannelId} />
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal de transcripts" onChange={(value) => patch({ transcriptChannelId: value })} placeholder="Selecionar canal" value={draft.transcriptChannelId} />
            <FivemChannelSelect channels={channels} disabled={disabled} label="Canal de auditoria" onChange={(value) => patch({ auditChannelId: value })} placeholder="Selecionar canal" value={draft.auditChannelId} />
            <FivemResourceSelect disabled={disabled} label="Categoria fixa de arquivamento" onChange={(value) => patch({ finishedCategoryId: value })} options={categories.map((category) => ({ id: category.id, name: category.name }))} placeholder="Selecionar categoria" prefix="📁" value={draft.finishedCategoryId} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <MultiRoleSelect disabled={disabled} label="Cargos administradores" onChange={(values) => patch({ adminRoleIds: values })} roles={options.roles} values={draft.adminRoleIds} />
            <MultiRoleSelect disabled={disabled} label="Cargos que visualizam tickets" onChange={(values) => patch({ viewRoleIds: values })} roles={options.roles} values={draft.viewRoleIds} />
            <MultiRoleSelect disabled={disabled} label="Cargos que respondem" onChange={(values) => patch({ replyRoleIds: values })} roles={options.roles} values={draft.replyRoleIds} />
            <MultiRoleSelect disabled={disabled} label="Cargos mencionados" onChange={(values) => patch({ mentionRoleIds: values })} roles={options.roles} values={draft.mentionRoleIds} />
          </div>

          <div className="rounded-lg border border-red-500/10 bg-black/30 p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Intimacoes e mensagens institucionais</h3>
              <p className="mt-1 text-xs text-zinc-500">Configurações globais usadas pelos fluxos internos de intimacao e comunicacao.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <MultiRoleSelect disabled={disabled} label="Quem pode usar /intimacao" onChange={(values) => patch({ competenceCommandRoleIds: values })} roles={options.roles} values={draft.competenceCommandRoleIds} />
              <FivemResourceSelect disabled={disabled} label="Categoria das Intimações" onChange={(value) => patch({ subpoenaCategoryId: value })} options={categories.map((category) => ({ id: category.id, name: category.name }))} placeholder="Selecionar categoria" prefix="📁" value={draft.subpoenaCategoryId} />
              <TicketField disabled={disabled} label="Prazo padrão" onChange={(value) => patch({ defaultDeadline: value })} value={draft.defaultDeadline} />
              <TicketField disabled={disabled} label="Banner da DM" onChange={(value) => patch({ dmBannerUrl: value || null })} value={draft.dmBannerUrl ?? ""} />
              <TicketField disabled={disabled} label="Banner do painel interno" onChange={(value) => patch({ subpoenaPanelBannerUrl: value || null })} value={draft.subpoenaPanelBannerUrl ?? ""} />
              <TicketArea disabled={disabled} label="Texto padrão da DM" onChange={(value) => patch({ subpoenaDmText: value })} value={draft.subpoenaDmText} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
              Permitir denúncia anonima
              <Switch checked={draft.allowAnonymousReports} disabled={disabled} onCheckedChange={(checked) => patch({ allowAnonymousReports: checked })} />
            </label>
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
              Resposta anonima da equipe
              <Switch checked={draft.allowAnonymousStaffReplies} disabled={disabled} onCheckedChange={(checked) => patch({ allowAnonymousStaffReplies: checked })} />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-500/10 bg-zinc-950/70">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Configuração dos Órgãos Responsáveis</CardTitle>
              <CardDescription>Escolha um órgão para configurar cargos, destino do canal, logs e escalonamento sem procurar campos espalhados.</CardDescription>
            </div>
            <Button disabled={disabled || draft.categories.length >= 25} onClick={addCategory} size="sm" type="button" variant="outline">Adicionar órgão</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {draft.categories.map((category, index) => (
              <OrgaoSummaryCard
                category={category}
                channels={channels}
                index={index}
                isSelected={selectedOrg?.id === category.id}
                key={`${category.id}-${index}`}
                onConfigure={() => setSelectedOrgId(category.id)}
                onRemove={() => removeCategory(index)}
                removeDisabled={disabled || draft.categories.length <= 1}
                roles={options.roles}
                ticketDestinations={categoryDestinationOptions}
              />
            ))}
          </div>

          {selectedOrg ? (
            <OrgaoConfigPanel
              category={selectedOrg}
              channels={channels}
              disabled={disabled}
              escalationOptions={reportCategoryOptions.filter((option) => option.id !== selectedOrg.id)}
              index={selectedOrgIndex}
              onPatch={(patchValue) => patchCategory(selectedOrgIndex, patchValue)}
              onRemove={() => removeCategory(selectedOrgIndex)}
              onSave={() => void save()}
              removeDisabled={disabled || draft.categories.length <= 1}
              roles={options.roles}
              saving={saving}
              ticketDestinations={categoryDestinationOptions}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function OrgaoSummaryCard({
  category,
  channels,
  index,
  isSelected,
  onConfigure,
  onRemove,
  removeDisabled,
  roles,
  ticketDestinations
}: {
  category: ReportSystemCategory;
  channels: GuildLiveOptions["channels"];
  index: number;
  isSelected: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  removeDisabled: boolean;
  roles: GuildLiveOptions["roles"];
  ticketDestinations: Array<{ id: string; name: string }>;
}) {
  const status = reportOrgStatus(category);
  const responsibleNames = reportOrgResponsibleNames(category, roles);
  const categoryName = resourceName(ticketDestinations, category.channelOrCategoryId);
  const logName = resourceName(channels, category.logChannelId, "Logs padrão");

  return (
    <div className={`flex min-h-[230px] flex-col justify-between rounded-lg border p-4 ${isSelected ? "border-[#FFD500]/45 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950"}`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">{index + 1}. {category.name}</p>
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{category.judgeLabel || "Rotulo público não configurado"}</p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <div className="space-y-2 text-xs text-zinc-300">
          <p><span className="text-zinc-500">Cargo:</span> {responsibleNames.length ? responsibleNames.slice(0, 2).join(", ") : "Não configurado"}</p>
          <p><span className="text-zinc-500">Recebe:</span> {category.judgeLabel || "Não configurado"}</p>
          <p><span className="text-zinc-500">Categoria:</span> {categoryName}</p>
          <p><span className="text-zinc-500">Logs:</span> {logName}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <Button className="w-full" onClick={onConfigure} size="sm" type="button" variant={isSelected ? "default" : "outline"}>
          <Edit3 className="mr-2 h-4 w-4" />
          Configurar
        </Button>
        <Button disabled={removeDisabled} onClick={onRemove} size="icon" title="Apagar órgão" type="button" variant="outline">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function OrgaoConfigPanel({
  category,
  channels,
  disabled,
  escalationOptions,
  index,
  onPatch,
  onRemove,
  onSave,
  removeDisabled,
  roles,
  saving,
  ticketDestinations
}: {
  category: ReportSystemCategory;
  channels: GuildLiveOptions["channels"];
  disabled: boolean;
  escalationOptions: Array<{ id: string; name: string }>;
  index: number;
  onPatch: (patchValue: Partial<ReportSystemCategory>) => void;
  onRemove: () => void;
  onSave: () => void;
  removeDisabled: boolean;
  roles: GuildLiveOptions["roles"];
  saving: boolean;
  ticketDestinations: Array<{ id: string; name: string }>;
}) {
  const escalationTarget = escalationOptions.find((option) => option.id === category.escalateToCategoryId);
  const responsibleNames = (category.responsibleRoleIds ?? []).map((roleId) => roles.find((role) => role.id === roleId)?.name ?? roleId);
  const responsibleSummary = responsibleNames.length
    ? responsibleNames.slice(0, 3).join(", ") + (responsibleNames.length > 3 ? ` +${responsibleNames.length - 3}` : "")
    : "Sem cargos responsáveis";
  const status = reportOrgStatus(category);

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Configuração de {category.name}</p>
          <p className="mt-1 text-xs text-zinc-500">{category.judgeLabel || "Rotulo público não configurado"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          <Badge variant={category.enabled ? "success" : "muted"}>{category.enabled ? "Ativo" : "Inativo"}</Badge>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2">
          <p className="text-[11px] uppercase text-zinc-500">Cargos responsáveis</p>
          <p className="mt-1 truncate text-xs text-zinc-300">{responsibleSummary}</p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2">
          <p className="text-[11px] uppercase text-zinc-500">Escalonamento</p>
          <p className="mt-1 truncate text-xs text-zinc-300">{category.name} -&gt; {escalationTarget?.name ?? "Sem escalonamento"}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <TicketField disabled={disabled} label="Nome do órgão" onChange={(value) => onPatch({ name: value })} value={category.name} />
        <TicketField disabled={disabled} label="Quais denuncias vao para este órgão" onChange={(value) => onPatch({ judgeLabel: value })} value={category.judgeLabel ?? ""} />
        <TicketField disabled={disabled} label="Descrição" onChange={(value) => onPatch({ description: value })} value={category.description ?? ""} />
        <TicketField disabled={disabled} label="Emoji" onChange={(value) => onPatch({ emoji: value })} value={category.emoji ?? ""} />
        <FivemResourceSelect disabled={disabled} label="Categoria onde o canal será criado" onChange={(value) => onPatch({ channelOrCategoryId: value })} options={ticketDestinations} placeholder="Categoria padrão do sistema" value={category.channelOrCategoryId} />
        <FivemChannelSelect channels={channels} disabled={disabled} label="Canal de logs" onChange={(value) => onPatch({ logChannelId: value })} placeholder="Canal padrão de logs" value={category.logChannelId} />
        <MultiRoleSelect disabled={disabled} label="Cargos responsáveis" onChange={(values) => onPatch({ responsibleRoleIds: values })} roles={roles} values={category.responsibleRoleIds ?? []} />
        <FivemResourceSelect disabled={disabled} label="Escalar denúncia contra este órgão para" onChange={(value) => onPatch({ escalateToCategoryId: value })} options={escalationOptions} placeholder="Sem escalonamento" value={category.escalateToCategoryId} />
        <TicketField disabled={disabled} label="Cor" onChange={(value) => onPatch({ color: value })} type="color" value={category.color} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300">
          <input checked={category.enabled} disabled={disabled} onChange={(event) => onPatch({ enabled: event.target.checked })} type="checkbox" />
          Ativo
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={disabled || saving} onClick={onSave} size="sm" type="button">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Salvar alterações
          </Button>
          <Button disabled={removeDisabled} onClick={onRemove} size="sm" title="Apagar órgão" type="button" variant="outline">
            <Trash2 className="mr-2 h-4 w-4" />
            Apagar órgão
          </Button>
        </div>
      </div>
    </div>
  );
}

function reportOrgStatus(category: ReportSystemCategory): { label: string; variant: "success" | "warning" | "danger" | "muted" } {
  if (!category.enabled) return { label: "Inativo", variant: "muted" };
  const hasResponsible = Boolean(category.responsibleRoleIds?.length);
  const hasDestination = Boolean(category.channelOrCategoryId);
  const hasPublicLabel = Boolean(category.judgeLabel?.trim());
  const hasLogs = Boolean(category.logChannelId);

  if (hasResponsible && hasDestination && hasPublicLabel && hasLogs) return { label: "Configurado", variant: "success" };
  if (hasResponsible || hasDestination || hasPublicLabel || hasLogs) return { label: "Incompleto", variant: "warning" };
  return { label: "Não configurado", variant: "danger" };
}

function reportOrgResponsibleNames(category: ReportSystemCategory, roles: GuildLiveOptions["roles"]) {
  return (category.responsibleRoleIds ?? []).map((roleId) => roles.find((role) => role.id === roleId)?.name ?? roleId);
}

function resourceName(resources: Array<{ id: string; name: string }>, resourceId: string | null | undefined, fallback = "Não configurado") {
  if (!resourceId) return fallback;
  return resources.find((resource) => resource.id === resourceId)?.name ?? resourceId;
}

function normalizeReportCategory(category: ReportSystemCategory, index: number): ReportSystemCategory {
  const name = category.name.trim() || `Órgão ${index + 1}`;
  return {
    channelOrCategoryId: category.channelOrCategoryId || null,
    color: category.color || "#dc2626",
    description: category.description?.trim() || null,
    emoji: category.emoji?.trim() || null,
    enabled: category.enabled !== false,
    escalateToCategoryId: category.escalateToCategoryId || null,
    id: category.id?.trim() || slugTicketOption(name, index),
    judgeLabel: category.judgeLabel?.trim() || null,
    logChannelId: category.logChannelId || null,
    name,
    order: Number(category.order) || index + 1,
    responsibleRoleIds: category.responsibleRoleIds ?? []
  };
}

type TicketPanelDraft = Pick<
  GuildSettings,
  | "ticketPanelChannelId"
  | "ticketPanelTitle"
  | "ticketPanelDescription"
  | "ticketPanelInfoText"
  | "ticketPanelFooterText"
  | "ticketPanelColor"
  | "ticketPanelPlaceholder"
  | "ticketPanelOptions"
>;

function ticketPanelDraft(settings: GuildSettings | null): TicketPanelDraft {
  return {
    ticketPanelChannelId: settings?.ticketPanelChannelId ?? null,
    ticketPanelTitle: settings?.ticketPanelTitle ?? "Central de Suporte",
    ticketPanelDescription: settings?.ticketPanelDescription ?? "Precisa de ajuda? Abra um ticket e nossa equipe ira atende-lo em breve.",
    ticketPanelInfoText: settings?.ticketPanelInfoText ?? "Horario de atendimento: Seg-Sex, 9h-18h\nDescreva seu problema com detalhes para um atendimento mais rapido.",
    ticketPanelFooterText: settings?.ticketPanelFooterText ?? "",
    ticketPanelColor: settings?.ticketPanelColor ?? "#FFD500",
    ticketPanelPlaceholder: settings?.ticketPanelPlaceholder ?? "Selecione o tipo de atendimento",
    ticketPanelOptions: (settings?.ticketPanelOptions?.length ? settings.ticketPanelOptions : [{
      description: "Abrir um atendimento com a equipe.",
      emoji: PANEL_EMOJIS.prancheta,
      enabled: true,
      label: "Suporte",
      value: "suporte"
    }]).map(normalizeTicketOptionDraft)
  };
}

function normalizeTicketOptionDraft(option: TicketPanelOption, index: number): TicketPanelOption {
  const label = option.label.trim() || `Atendimento ${index + 1}`;
  return {
    description: option.description?.trim() || null,
    emoji: option.emoji?.trim() || null,
    enabled: option.enabled !== false,
    label,
    value: option.value?.trim() || slugTicketOption(label, index)
  };
}

function slugTicketOption(value: string, index: number) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || `opcao-${index + 1}`;
}

function TicketField({
  disabled,
  label,
  onChange,
  type = "text",
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  type?: "color" | "text";
  value: string;
}) {
  return (
    <label className="block text-xs font-medium text-zinc-400">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/50 disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function EmojiField({
  applicationEmojis,
  disabled,
  label,
  onChange,
  value
}: {
  applicationEmojis: ApplicationEmojiItem[];
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-xs font-medium text-zinc-400">
      {label}
      <div className="mt-1 grid gap-2">
        <input
          className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/50 disabled:opacity-60"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Emoji"
          value={value}
        />
        <select
          className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/50 disabled:opacity-60"
          disabled={disabled || !applicationEmojis.length}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          value=""
        >
          <option value="">Emojis do bot</option>
          {applicationEmojis.map((emoji) => (
            <option key={emoji.id} value={applicationEmojiMarkdown(emoji)}>
              {emoji.applicationName || emoji.originalName}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function applicationEmojiMarkdown(emoji: ApplicationEmojiItem) {
  const name = (emoji.applicationName || emoji.originalName || "emoji").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32) || "emoji";
  return `<${emoji.animated ? "a" : ""}:${name}:${emoji.applicationEmojiId}>`;
}

function TicketArea({
  disabled,
  label,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-xs font-medium text-zinc-400">
      {label}
      <textarea
        className="mt-1 min-h-24 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/50 disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function MultiRoleSelect({
  disabled,
  label,
  onChange,
  roles,
  values
}: {
  disabled: boolean;
  label: string;
  onChange: (values: string[]) => void;
  roles: GuildRoleOption[];
  values: string[];
}) {
  return <FivemResourceMultiSelect disabled={disabled} label={label} onChange={onChange} options={roles.map((role) => ({ color: role.color, disabled: role.managed, id: role.id, name: role.name }))} prefix="@" values={values} />;
}

function RoleSelect({
  disabled,
  label,
  onChange,
  roles,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  roles: GuildRoleOption[];
  value: string;
}) {
  return <FivemResourceSelect disabled={disabled} label={label} onChange={(nextValue) => onChange(nextValue ?? "")} options={roles.map((role) => ({ color: role.color, disabled: role.managed, id: role.id, name: role.name }))} placeholder="Nenhum" prefix="@" value={value || null} />;
}

function FivemChannelSelect({ channels, disabled, label, onChange, placeholder, prefix = "#", value }: {
  channels: GuildChannelOption[];
  disabled: boolean;
  label: string;
  onChange: (value: string | null) => void;
  placeholder: string;
  prefix?: string;
  value: string | null;
}) {
  return <FivemResourceSelect disabled={disabled} label={label} onChange={onChange} options={channels.map((channel) => ({ id: channel.id, name: channel.name }))} placeholder={placeholder} prefix={prefix} value={value} />;
}

function CloningView({
  botId,
  bots,
  canManageEmoji,
  canManageServer,
  enabledModules,
  guild,
  guilds,
  loading,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  bots: DashboardBot[];
  canManageEmoji: boolean;
  canManageServer: boolean;
  enabledModules: string[];
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  const sections = [
    enabledModules.includes("emoji-cloner") ? "emoji-cloner" : null,
    enabledModules.includes("server-cloner") ? "server-cloner" : null
  ].filter((section): section is "emoji-cloner" | "server-cloner" => Boolean(section));
  const [activeSection, setActiveSection] = useState<"emoji-cloner" | "server-cloner">(sections[0] ?? "emoji-cloner");
  const sectionsKey = sections.join("|");

  useEffect(() => {
    const firstSection = sections[0];

    if (firstSection && !sections.includes(activeSection)) {
      setActiveSection(firstSection);
    }
  }, [activeSection, sections, sectionsKey]);

  if (!sections.length) {
    return <EmptyState icon={SmilePlus} title="Nenhum módulo de clonagem liberado para este bot" />;
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h2 className="text-lg font-semibold text-white">Clonagem</h2>
          <p className="mt-1 text-sm text-zinc-500">Emojis, biblioteca, sincronização da aplicação e estrutura de servidor em um só lugar.</p>
        </div>
        <div className="inline-flex w-full rounded-lg border border-zinc-800 bg-zinc-950 p-1 sm:w-auto">
          {sections.includes("emoji-cloner") ? (
            <button
              className={[
                "flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition sm:flex-none",
                activeSection === "emoji-cloner" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
              ].join(" ")}
              onClick={() => setActiveSection("emoji-cloner")}
              type="button"
            >
              <SmilePlus className="h-4 w-4" />
              Emojis
            </button>
          ) : null}
          {sections.includes("server-cloner") ? (
            <button
              className={[
                "flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition sm:flex-none",
                activeSection === "server-cloner" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
              ].join(" ")}
              onClick={() => setActiveSection("server-cloner")}
              type="button"
            >
              <Server className="h-4 w-4" />
              Servidor
            </button>
          ) : null}
        </div>
      </section>

      {activeSection === "emoji-cloner" ? (
        <div className="space-y-5">
          <EmojiCloneSettingsPanel
            botId={botId}
            bots={bots}
            canManage={canManageEmoji}
            guild={guild}
            guilds={guilds}
            loading={loading}
            onSettingsChange={onSettingsChange}
            settings={settings}
          />
          <ApplicationEmojisView
            botId={botId}
            canManage={canManageEmoji}
            guild={guild}
            guilds={guilds}
          />
        </div>
      ) : null}

      {activeSection === "server-cloner" ? (
        <ServerClonerView
          botId={botId}
          bots={bots}
          canManage={canManageServer}
          guild={guild}
          guilds={guilds}
        />
      ) : null}
    </div>
  );
}

function ApplicationEmojisView({
  botId,
  canManage,
  guild,
  guilds
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
}) {
  const [page, setPage] = useState<ApplicationEmojiPage | null>(null);
  const [settings, setSettings] = useState<ApplicationEmojiSettings | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "true" | "false">("all");
  const [sort, setSort] = useState<"date" | "name" | "size">("date");
  const [sourceGuildId, setSourceGuildId] = useState(guild?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState({
    current: 0,
    failed: 0,
    sent: 0,
    skipped: 0,
    total: 0,
    updated: 0
  });

  useEffect(() => {
    setSourceGuildId((current) => current || guild?.id || "");
  }, [guild?.id]);

  useEffect(() => {
    if (!botId) {
      setPage(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    getApplicationEmojis(botId, { animated: type, q: query, sort })
      .then((data) => {
        if (mounted) setPage(data);
      })
      .catch((error) => {
        if (mounted) setMessage(readErrorMessage(error, "Não foi possível carregar emojis da aplicação."));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, query, sort, type]);

  useEffect(() => {
    if (!botId || !sourceGuildId) {
      setSettings(null);
      return;
    }

    let mounted = true;
    getApplicationEmojiSettings(botId, sourceGuildId)
      .then((data) => {
        if (mounted) setSettings(data);
      })
      .catch(() => {
        if (mounted) setSettings(null);
      });

    return () => {
      mounted = false;
    };
  }, [botId, sourceGuildId]);

  useEffect(() => {
    if (!botId) return;

    const socket = createDashboardSocket();
    socket.on("application-emojis:progress", (payload: {
      botId: string;
      current: number;
      failed: number;
      guildId: string;
      message: string;
      sent: number;
      skipped: number;
      total: number;
      updated: number;
    }) => {
      if (payload.botId !== botId) return;
      if (sourceGuildId && payload.guildId !== sourceGuildId) return;
      setProgress({
        current: payload.current,
        failed: payload.failed,
        sent: payload.sent,
        skipped: payload.skipped,
        total: payload.total,
        updated: payload.updated
      });
      setMessage(payload.message);
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, sourceGuildId]);

  const items = page?.items ?? [];
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : syncing ? 8 : 0;
  const selectedGuild = guilds.find((item) => item.id === sourceGuildId) ?? guild ?? null;

  async function refreshList() {
    if (!botId) return;

    setLoading(true);
    setMessage(null);

    try {
      const data = await getApplicationEmojis(botId, { animated: type, q: query, sort });
      setPage(data);
    } catch (error) {
      setMessage(readErrorMessage(error, "Não foi possível atualizar a lista."));
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!botId || !sourceGuildId || !canManage) return;

    setSyncing(true);
    setProgress({ current: 0, failed: 0, sent: 0, skipped: 0, total: 0, updated: 0 });
    setMessage("Iniciando sincronização...");

    try {
      const data = await syncApplicationEmojis(botId, sourceGuildId);
      setPage(data);
      setMessage(`Concluído: ${data.job?.sent ?? 0} enviados, ${data.job?.updated ?? 0} atualizados, ${data.job?.skipped ?? 0} ignorados.`);
    } catch (error) {
      setMessage(readErrorMessage(error, "Não foi possível sincronizar emojis."));
    } finally {
      setSyncing(false);
    }
  }

  async function handleRefreshRemote() {
    if (!botId) return;

    setLoading(true);
    setMessage("Atualizando lista pelo Developer Portal...");

    try {
      setPage(await refreshApplicationEmojis(botId));
      setMessage("Lista atualizada.");
    } catch (error) {
      setMessage(readErrorMessage(error, "Não foi possível atualizar emojis da aplicação."));
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveAll() {
    if (!botId || !canManage) return;
    const confirmed = window.confirm("Remover todos os emojis da aplicação deste bot?");

    if (!confirmed) return;

    setLoading(true);
    setMessage("Removendo emojis da aplicação...");

    try {
      const data = await removeAllApplicationEmojis(botId);
      setPage(data);
      setMessage(`${data.removed} emoji(s) removidos.`);
    } catch (error) {
      setMessage(readErrorMessage(error, "Não foi possível remover emojis."));
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!botId) return;

    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
      return;
    }

    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadProgress(0);
    setMessage("Preparando o arquivo ZIP...");

    try {
      const result = await downloadEmojiZip("application", botId, sourceGuildId || null, {
        onProgress: setDownloadProgress,
        signal: controller.signal
      });
      saveBrowserDownload(result.blob, "emojis.zip");
      setMessage(`Download concluído: ${result.count} emoji(s) baixado(s), ${result.failed} falha(s).`);
    } catch (error) {
      setMessage(controller.signal.aborted
        ? "Download cancelado."
        : readErrorMessage(error, "Não foi possível baixar os emojis. Tente novamente."));
    } finally {
      downloadAbortRef.current = null;
      setDownloadProgress(null);
    }
  }

  async function handleToggleAutoSync(checked: boolean) {
    if (!botId || !sourceGuildId || !canManage) return;

    const previous = settings;
    setSettings((current) => current ? { ...current, autoSync: checked } : current);

    try {
      setSettings(await updateApplicationEmojiSettings(botId, sourceGuildId, { autoSync: checked }));
      setMessage(checked ? "Sincronização automática ativada para este servidor." : "Sincronização automática desativada.");
    } catch (error) {
      setSettings(previous);
      setMessage(readErrorMessage(error, "Não foi possível salvar sincronização automática."));
    }
  }

  if (!botId) {
    return <EmptyState icon={SmilePlus} title="Selecione um bot para gerenciar emojis da aplicação" />;
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={SmilePlus} label="Armazenados" value={formatNumber(page?.total ?? 0)} />
        <MetricCard icon={Boxes} label="Restantes" value={formatNumber(page?.remaining ?? 2000)} />
        <MetricCard icon={Upload} label="Limite" value={`${page?.limit ?? 2000}`} />
        <MetricCard icon={RefreshCw} label="Auto-sync" value={settings?.autoSync ? "Ativo" : "Desligado"} />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Emojis da Aplicacao</CardTitle>
              <CardDescription>Sincroniza emojis do servidor para a aba Emojis da aplicação no Developer Portal.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canManage || syncing || !sourceGuildId} onClick={() => void handleSync()} size="sm" type="button">
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Sincronizar Emojis
              </Button>
              <Button disabled={loading || syncing} onClick={() => void handleRefreshRemote()} size="sm" type="button" variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar Emojis
              </Button>
              <Button disabled={loading || syncing} onClick={() => void refreshList()} size="sm" type="button" variant="outline">
                Atualizar Lista
              </Button>
              <Button disabled={!items.length} onClick={() => void handleDownload()} size="sm" type="button" variant="outline">
                {downloadProgress !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {downloadProgress !== null ? `Cancelar (${downloadProgress || "..."}%)` : "Baixar Emojis"}
              </Button>
              <Button disabled={!canManage || loading || syncing || !items.length} onClick={() => void handleRemoveAll()} size="sm" type="button" variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Remover Todos
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr_auto]">
            <label className="space-y-2">
              <span className="text-xs font-medium text-zinc-400">Servidor origem</span>
              <select
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
                disabled={syncing}
                onChange={(event) => setSourceGuildId(event.target.value)}
                value={sourceGuildId}
              >
                <option value="">Selecione um servidor</option>
                {guilds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-500">Sincronização Automática</p>
                <p className="truncate text-sm font-medium text-white">{selectedGuild?.name ?? "Servidor não selecionado"}</p>
              </div>
              <Switch
                checked={Boolean(settings?.autoSync)}
                disabled={!canManage || !sourceGuildId}
                onCheckedChange={(checked) => void handleToggleAutoSync(checked)}
              />
            </div>
            <Badge className="self-end" variant={canManage ? "success" : "muted"}>
              {canManage ? "Liberado" : "Somente leitura"}
            </Badge>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Progresso</p>
              <p className="text-xs text-zinc-500">{progress.current} / {progress.total || 0} Emojis</p>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-900">
              <div className="h-full rounded-full bg-[#FFD500] transition-all" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-4">
              <span>Enviados: {progress.sent}</span>
              <span>Atualizados: {progress.updated}</span>
              <span>Ignorados: {progress.skipped}</span>
              <span>Erros: {progress.failed}</span>
            </div>
            {message ? <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{message}</p> : null}
            {downloadProgress !== null ? (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-900" aria-label="Progresso do download">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${downloadProgress || 5}%` }} />
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 lg:flex-row">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome"
                value={query}
              />
            </label>
            <select className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none" onChange={(event) => setType(event.target.value as typeof type)} value={type}>
              <option value="all">Todos</option>
              <option value="false">Estaticos</option>
              <option value="true">Animados</option>
            </select>
            <select className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none" onChange={(event) => setSort(event.target.value as typeof sort)} value={sort}>
              <option value="date">Data</option>
              <option value="name">Nome</option>
              <option value="size">Tamanho</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <div className="grid grid-cols-[56px_1fr_150px_160px_120px] gap-3 border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold uppercase text-zinc-500">
              <span>Emoji</span>
              <span>Nome</span>
              <span>Tipo</span>
              <span>Sincronizado</span>
              <span>Tamanho</span>
            </div>
            <div className="max-h-[520px] overflow-auto">
              {items.length ? items.map((item) => (
                <ApplicationEmojiRow item={item} key={item.id} />
              )) : (
                <p className="px-3 py-8 text-center text-sm text-zinc-500">
                  {loading ? "Carregando emojis..." : "Nenhum emoji salvo na aplicação ainda."}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ApplicationEmojiRow({ item }: { item: ApplicationEmojiItem }) {
  return (
    <div className="grid grid-cols-[56px_1fr_150px_160px_120px] items-center gap-3 border-b border-zinc-900 px-3 py-2 last:border-b-0">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
        <img alt="" className="max-h-full max-w-full object-contain" src={item.url} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{item.applicationName}</p>
        <p className="truncate text-xs text-zinc-500">ID {item.applicationEmojiId}</p>
      </div>
      <Badge variant={item.animated ? "warning" : "muted"}>{item.type}</Badge>
      <span className="truncate text-xs text-zinc-400">{new Date(item.syncedAt).toLocaleString("pt-BR")}</span>
      <span className="text-xs text-zinc-400">{item.size ? formatBytes(item.size) : "Remoto"}</span>
    </div>
  );
}

function saveBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function EntryLeaveManager({
  availableModes,
  botId,
  canManageModule,
  guild,
  loading,
  onSettingsChange,
  settings,
  viewerName
}: {
  availableModes: EntryLeaveMode[];
  botId?: string | null;
  canManageModule: (moduleId: string) => boolean;
  guild: DashboardGuild | null;
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
  viewerName: string;
}) {
  const [activeMode, setActiveMode] = useState<EntryLeaveMode>(availableModes[0] ?? "welcome");
  const modesKey = availableModes.join("|");

  useEffect(() => {
    if (!availableModes.includes(activeMode)) {
      setActiveMode(availableModes[0] ?? "welcome");
    }
  }, [activeMode, availableModes, modesKey]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Entrada e saída</h2>
          <p className="mt-1 text-sm text-zinc-500">Configure as mensagens automaticas dos membros em um so lugar.</p>
        </div>

        <div className="inline-flex w-full rounded-lg border border-zinc-800 bg-zinc-950 p-1 sm:w-auto">
          {availableModes.map((mode) => {
            const active = activeMode === mode;
            const Icon = mode === "welcome" ? UserPlus : UserMinus;
            const label = mode === "welcome" ? "Entrada" : "Saída";

            return (
              <button
                className={[
                  "flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition sm:flex-none",
                  active
                    ? "bg-white text-black"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                ].join(" ")}
                key={mode}
                onClick={() => setActiveMode(mode)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <PanelImageSettings
        botId={botId}
        canManage={canManageModule(activeMode)}
        guildId={guild?.id ?? null}
        panelId={activeMode}
        panelLabel={activeMode === "welcome" ? "Entrada" : "Saída"}
      />

      <WelcomePanel
        botId={botId}
        canManage={canManageModule(activeMode)}
        guild={guild}
        loading={loading}
        mode={activeMode}
        onSettingsChange={onSettingsChange}
        settings={settings}
        viewerName={viewerName}
      />
    </section>
  );
}

type ServerClonePlanForm = {
  categoryRenames: string;
  channelRenames: string;
  cloneParts: string[];
  destinationGuildId: string;
  destinationGuildInput: string;
  extraCategories: string;
  extraRoles: string;
  extraTextChannels: string;
  extraVoiceChannels: string;
  notes: string;
  renameServer: string;
  roleRenames: string;
  sourceGuildId: string;
};

const serverClonePartOptions = [
  { id: "roles", label: "Cargos" },
  { id: "categories", label: "Categorias" },
  { id: "text", label: "Canais de texto" },
  { id: "voice", label: "Canais de voz" }
];

function ServerClonerView({
  botId,
  bots,
  canManage,
  guild,
  guilds
}: {
  botId?: string | null;
  bots: DashboardBot[];
  canManage: boolean;
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
}) {
  const selectedBot = botId ? bots.find((bot) => bot.id === botId) ?? null : null;
  const guildOptions = useMemo(() => buildServerCloneGuildOptions(selectedBot, guilds, guild), [selectedBot, guilds, guild]);
  const defaultSourceId = guild?.id ?? selectedBot?.mainGuildId ?? guildOptions[0]?.id ?? "";
  const defaultDestinationId = guildOptions.find((item) => item.id !== defaultSourceId)?.id ?? defaultSourceId;
  const [form, setForm] = useState<ServerClonePlanForm>(() => ({
    categoryRenames: "",
    channelRenames: "",
    cloneParts: serverClonePartOptions.map((part) => part.id),
    destinationGuildId: defaultDestinationId,
    destinationGuildInput: "",
    extraCategories: "",
    extraRoles: "",
    extraTextChannels: "",
    extraVoiceChannels: "",
    notes: "",
    renameServer: "",
    roleRenames: "",
    sourceGuildId: defaultSourceId
  }));
  const [currentModules, setCurrentModules] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const sourceGuildId = guild?.id ?? selectedBot?.mainGuildId ?? guildOptions[0]?.id ?? "";
    const destinationGuildId = guildOptions.find((item) => item.id !== sourceGuildId)?.id ?? sourceGuildId;

    setForm({
      categoryRenames: "",
      channelRenames: "",
      cloneParts: serverClonePartOptions.map((part) => part.id),
      destinationGuildId,
      destinationGuildInput: "",
      extraCategories: "",
      extraRoles: "",
      extraTextChannels: "",
      extraVoiceChannels: "",
      notes: "",
      renameServer: "",
      roleRenames: "",
      sourceGuildId
    });
    setCurrentModules({});
    setMessage(null);
  }, [botId, guild?.id, selectedBot?.mainGuildId, guildOptions]);

  useEffect(() => {
    if (!botId || !form.destinationGuildId) return;

    let mounted = true;
    setLoading(true);

    getDashboardBotGuildConfig(botId, form.destinationGuildId)
      .then((config) => {
        if (!mounted) return;

        setCurrentModules(config.modules ?? {});
        const plan = normalizeServerClonePlan(config.modules?.["server-cloner"]);

        if (plan) {
          setForm((current) => ({
            ...current,
            categoryRenames: plan.categoryRenames.join("\n"),
            channelRenames: plan.channelRenames.join("\n"),
            cloneParts: plan.cloneParts.length ? plan.cloneParts : current.cloneParts,
            destinationGuildId: plan.destinationGuildId || current.destinationGuildId,
            destinationGuildInput: "",
            extraCategories: plan.extraCategories.join("\n"),
            extraRoles: plan.extraRoles.join("\n"),
            extraTextChannels: plan.extraTextChannels.join("\n"),
            extraVoiceChannels: plan.extraVoiceChannels.join("\n"),
            notes: plan.notes,
            renameServer: plan.renameServer,
            roleRenames: plan.roleRenames.join("\n"),
            sourceGuildId: plan.sourceGuildId || current.sourceGuildId
          }));
        }
      })
      .catch((error) => {
        if (mounted) {
          setMessage(readErrorMessage(error, "Não foi possível carregar o plano de clonagem."));
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, form.destinationGuildId]);

  function updateForm<K extends keyof ServerClonePlanForm>(key: K, value: ServerClonePlanForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePart(partId: string) {
    setForm((current) => {
      const next = current.cloneParts.includes(partId)
        ? current.cloneParts.filter((item) => item !== partId)
        : [...current.cloneParts, partId];

      return {
        ...current,
        cloneParts: next.length ? next : current.cloneParts
      };
    });
  }

  function applyManualDestination() {
    const guildId = form.destinationGuildInput.trim();

    if (!/^\d{5,32}$/.test(guildId)) {
      setMessage("Informe um ID válido para o servidor de destino.");
      return;
    }

    updateForm("destinationGuildId", guildId);
    updateForm("destinationGuildInput", "");
    setMessage("Destino manual adicionado ao plano.");
  }

  async function savePlan() {
    if (!botId || !canManage) {
      setMessage("Você não tem permissão para configurar esta clonagem.");
      return;
    }

    if (!form.sourceGuildId || !form.destinationGuildId) {
      setMessage("Selecione origem e destino da clonagem.");
      return;
    }

    if (form.sourceGuildId === form.destinationGuildId) {
      setMessage("O destino precisa ser diferente da origem.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const destination = guildOptions.find((item) => item.id === form.destinationGuildId);
      const modules = {
        ...currentModules,
        "server-cloner": {
          cloneParts: form.cloneParts,
          configuredFrom: "dashboard-cloning-menu",
          categoryRenames: splitTextareaLines(form.categoryRenames),
          channelRenames: splitTextareaLines(form.channelRenames),
          destinationGuildId: form.destinationGuildId,
          extraCategories: splitTextareaLines(form.extraCategories),
          extraRoles: splitTextareaLines(form.extraRoles),
          extraTextChannels: splitTextareaLines(form.extraTextChannels),
          extraVoiceChannels: splitTextareaLines(form.extraVoiceChannels),
          notes: form.notes.trim(),
          renameServer: form.renameServer.trim(),
          roleRenames: splitTextareaLines(form.roleRenames),
          sourceGuildId: form.sourceGuildId,
          updatedAt: new Date().toISOString()
        }
      };

      const saved = await updateBotGuildConfig(botId, form.destinationGuildId, {
        guildName: destination?.name ?? `Servidor ${form.destinationGuildId}`,
        modules
      });

      setCurrentModules(saved.modules ?? modules);
      setMessage("Plano salvo. Abra /clonar-servidor no destino para executar com esses dados.");
    } catch (error) {
      setMessage(readErrorMessage(error, "Não foi possível salvar o plano de clonagem."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-zinc-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>Clonagem de Servidor</CardTitle>
              <CardDescription className="mt-1">
                Configure origem, destino e adicionais. O bot executa pelo comando /clonar-servidor com esse plano salvo.
              </CardDescription>
            </div>
          </div>
          <Badge variant={canManage ? "success" : "muted"}>
            {canManage ? "Liberado" : "Bloqueado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <ServerCloneSelect
                label="Servidor de origem"
                onChange={(value) => updateForm("sourceGuildId", value)}
                options={guildOptions}
                value={form.sourceGuildId}
              />
              <ServerCloneSelect
                label="Servidor de destino"
                onChange={(value) => updateForm("destinationGuildId", value)}
                options={guildOptions}
                value={form.destinationGuildId}
              />
            </div>

            <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Adicionar destino por ID</span>
                <input
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70]"
                  disabled={!canManage}
                  onChange={(event) => updateForm("destinationGuildInput", event.target.value)}
                  placeholder="Cole o ID do servidor que vai receber a clonagem"
                  value={form.destinationGuildInput}
                />
              </label>
              <Button className="h-11" disabled={!canManage} onClick={applyManualDestination} variant="outline">
                Adicionar destino
              </Button>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Itens que serão clonados</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {serverClonePartOptions.map((part) => {
                  const active = form.cloneParts.includes(part.id);

                  return (
                    <button
                      className={[
                        "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                        active ? "border-[#FFEA70]/40 bg-[#FFD500]/15 text-[#FFEA70]" : "border-zinc-800 bg-black/30 text-zinc-400 hover:text-white"
                      ].join(" ")}
                      key={part.id}
                      onClick={() => togglePart(part.id)}
                      type="button"
                    >
                      {part.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Renomear destino depois da clonagem</span>
              <input
                className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70]"
                disabled={!canManage}
                onChange={(event) => updateForm("renameServer", event.target.value)}
                placeholder="Opcional"
                value={form.renameServer}
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <ServerCloneTextarea label="Adicionar categorias" onChange={(value) => updateForm("extraCategories", value)} value={form.extraCategories} />
              <ServerCloneTextarea label="Adicionar canais de texto" onChange={(value) => updateForm("extraTextChannels", value)} value={form.extraTextChannels} />
              <ServerCloneTextarea label="Adicionar canais de voz" onChange={(value) => updateForm("extraVoiceChannels", value)} value={form.extraVoiceChannels} />
              <ServerCloneTextarea label="Adicionar cargos" onChange={(value) => updateForm("extraRoles", value)} value={form.extraRoles} />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ServerCloneTextarea label="Renomear canais clonados" onChange={(value) => updateForm("channelRenames", value)} placeholder="geral => chat-geral" value={form.channelRenames} />
              <ServerCloneTextarea label="Renomear categorias clonadas" onChange={(value) => updateForm("categoryRenames", value)} placeholder="Suporte => Atendimento" value={form.categoryRenames} />
              <ServerCloneTextarea label="Renomear cargos clonados" onChange={(value) => updateForm("roleRenames", value)} placeholder="Membro => Cliente" value={form.roleRenames} />
            </div>

            <ServerCloneTextarea label="Notas internas" onChange={(value) => updateForm("notes", value)} placeholder="Observações do plano" value={form.notes} />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
            <p className="text-sm font-semibold text-white">Plano direcionado</p>
            <div className="mt-4 space-y-2 text-xs font-medium text-zinc-400">
              <p className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">Origem: {serverCloneGuildLabel(guildOptions, form.sourceGuildId)}</p>
              <p className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">Destino: {serverCloneGuildLabel(guildOptions, form.destinationGuildId)}</p>
              <p className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">Extras: {countServerCloneExtras(form)} item(ns)</p>
            </div>
            {loading ? (
              <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando plano salvo...
              </p>
            ) : null}
            {message ? (
              <div className="mt-4 rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 py-2 text-xs font-semibold text-[#FFEA70]">
                {message}
              </div>
            ) : null}
            <Button
              className="mt-4 w-full gap-2 bg-[#E5C000] text-white hover:bg-[#FFD500]"
              disabled={!canManage || saving || loading}
              onClick={() => void savePlan()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar plano
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ServerCloneSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  value: string;
}) {
  const visibleOptions = value && !options.some((option) => option.id === value)
    ? [{ id: value, name: `Servidor ${value}` }, ...options]
    : options;

  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <select
        className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-semibold text-white outline-none transition focus:border-[#FFEA70]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {visibleOptions.map((option) => (
          <option className="bg-zinc-950 text-white" key={option.id} value={option.id}>
            {option.name} - {option.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function ServerCloneTextarea({
  label,
  onChange,
  placeholder = "Um por linha",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <textarea
        className="mt-2 min-h-[92px] w-full resize-y rounded-lg border border-zinc-800 bg-black/35 px-3 py-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function buildServerCloneGuildOptions(bot: DashboardBot | null, guilds: DashboardGuild[], currentGuild: DashboardGuild | null) {
  const guildMap = new Map(guilds.map((item) => [item.id, item.name]));
  const isStringId = (value: string | null | undefined): value is string => Boolean(value);
  const ids = bot
    ? [...new Set([bot.mainGuildId, ...bot.guildIds, currentGuild?.id].filter(isStringId))]
    : [...new Set([currentGuild?.id, ...guilds.map((item) => item.id)].filter(isStringId))];

  return ids.map((id) => ({
    id,
    name: guildMap.get(id) ?? (currentGuild && id === currentGuild.id ? currentGuild.name : null) ?? (bot && id === bot.mainGuildId ? bot.mainGuildName : null) ?? `Servidor ${id}`
  }));
}

function serverCloneGuildLabel(options: Array<{ id: string; name: string }>, guildId: string) {
  return options.find((item) => item.id === guildId)?.name ?? guildId ?? "Não definido";
}

function splitTextareaLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function countServerCloneExtras(form: ServerClonePlanForm) {
  return splitTextareaLines(form.extraCategories).length
    + splitTextareaLines(form.extraRoles).length
    + splitTextareaLines(form.extraTextChannels).length
    + splitTextareaLines(form.extraVoiceChannels).length
    + splitTextareaLines(form.categoryRenames).length
    + splitTextareaLines(form.channelRenames).length
    + splitTextareaLines(form.roleRenames).length
    + (form.renameServer.trim() ? 1 : 0);
}

function normalizeServerClonePlan(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const plan = value as Record<string, unknown>;
  const readArray = (key: string) => Array.isArray(plan[key])
    ? (plan[key] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  return {
    categoryRenames: readArray("categoryRenames"),
    channelRenames: readArray("channelRenames"),
    cloneParts: readArray("cloneParts"),
    destinationGuildId: typeof plan.destinationGuildId === "string" ? plan.destinationGuildId : "",
    extraCategories: readArray("extraCategories"),
    extraRoles: readArray("extraRoles"),
    extraTextChannels: readArray("extraTextChannels"),
    extraVoiceChannels: readArray("extraVoiceChannels"),
    notes: typeof plan.notes === "string" ? plan.notes : "",
    renameServer: typeof plan.renameServer === "string" ? plan.renameServer : "",
    roleRenames: readArray("roleRenames"),
    sourceGuildId: typeof plan.sourceGuildId === "string" ? plan.sourceGuildId : ""
  };
}

function EmojiCloneSettingsPanel({
  botId,
  bots,
  canManage,
  guild,
  guilds,
  loading,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  bots: DashboardBot[];
  canManage: boolean;
  guild: DashboardGuild | null;
  guilds: DashboardGuild[];
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [emojiName, setEmojiName] = useState("");
  const [destinationGuildId, setDestinationGuildId] = useState(guild?.id ?? "");
  const [serverSearch, setServerSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [cloneProgress, setCloneProgress] = useState(0);
  const [cloneStatus, setCloneStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [cloneMessage, setCloneMessage] = useState<string | null>(null);
  const [credentialTestMode, setCredentialTestMode] = useState<"real" | "validating" | "valid" | "invalid">("real");
  const [fakeToken, setFakeToken] = useState("");
  const [fakeSourceGuildId, setFakeSourceGuildId] = useState("");
  const [fakeTokenMasked, setFakeTokenMasked] = useState<string | null>(null);
  const [fakeTokenAccepted, setFakeTokenAccepted] = useState(false);
  const [fakeTokenMessage, setFakeTokenMessage] = useState<string | null>(null);
  const [fakeEmojis, setFakeEmojis] = useState<EmojiCloneRemoteEmoji[]>([]);
  const [bulkLoading, setBulkLoading] = useState<"idle" | "validating" | "fetching" | "cloning">("idle");
  const [cloneLogs, setCloneLogs] = useState<string[]>([]);
  const [historyFilter, setHistoryFilter] = useState("");
  const [history, setHistory] = useState<Array<{
    createdAt: string;
    emojiUrl: string | null;
    guildName: string;
    name: string;
    status: "success" | "failed";
  }>>([]);
  const [library, setLibrary] = useState<EmojiLibraryItem[]>([]);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [libraryType, setLibraryType] = useState<"all" | "true" | "false">("all");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [libraryDownloadProgress, setLibraryDownloadProgress] = useState<number | null>(null);
  const libraryDownloadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      setRoles([]);
      return;
    }

    let mounted = true;
    getGuildLiveOptions(guild.id, botId)
      .then((options) => {
        if (!mounted) return;
        setChannels(options.channels);
        setRoles(options.roles.map((role) => ({ id: role.id, name: role.name })));
      })
      .catch(() => {
        if (!mounted) return;
        setChannels([]);
        setRoles([]);
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    setDestinationGuildId((current) => current || guild?.id || "");
  }, [guild?.id]);

  useEffect(() => {
    if (!botId || !settings?.emojiCloneEnabled) {
      setLibrary([]);
      return;
    }

    let mounted = true;
    setLibraryLoading(true);
    getEmojiLibrary(botId, {
      animated: libraryType,
      q: libraryFilter
    })
      .then((items) => {
        if (mounted) setLibrary(items);
      })
      .catch(() => {
        if (mounted) setLibrary([]);
      })
      .finally(() => {
        if (mounted) setLibraryLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, settings?.emojiCloneEnabled, libraryFilter, libraryType]);

  useEffect(() => {
    if (!selectedFile) {
      setFilePreview(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setFilePreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    if (!guild) {
      return;
    }

    const socket = createDashboardSocket();
    socket.on("emoji-cloner:progress", (payload: {
      botId: string | null;
      current: number;
      failed: number;
      guildId: string;
      success: number;
      total: number;
    }) => {
      const targetGuildId = destinationGuildId || guild.id;

      if (payload.guildId !== targetGuildId) {
        return;
      }

      if (payload.botId && botId && payload.botId !== botId) {
        return;
      }

      const percent = payload.total > 0 ? Math.round((payload.current / payload.total) * 24) + 75 : 75;
      setCloneProgress(Math.min(99, Math.max(75, percent)));
      setCloneMessage(`Clonando emojis... ${payload.current}/${payload.total} (${payload.success} sucesso, ${payload.failed} falha)`);
      pushCloneLog(`[INFO] Clonando emojis: ${payload.current}/${payload.total}`);
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, destinationGuildId, guild?.id]);

  async function savePatch(patch: Partial<GuildSettings>) {
    if (!guild || !settings || !canManage) return;

    const previous = settings;
    const optimistic = { ...settings, ...patch };

    setError(null);
    setSaving(true);
    onSettingsChange(optimistic);

    try {
      const saved = await patchGuildSettings(guild.id, patch, botId);
      onSettingsChange(saved);
    } catch {
      onSettingsChange(previous);
      setError("Não foi possível salvar a clonagem de emojis. Confira as permissões do bot.");
    } finally {
      setSaving(false);
    }
  }

  function toggleValue(values: string[], id: string) {
    return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  }

  const selectedBot = botId ? bots.find((bot) => bot.id === botId) ?? null : null;
  const destinationGuilds = (selectedBot ? guilds.filter((item) => selectedBot.guildIds.includes(item.id)) : guilds)
    .filter((item) => item.name.toLowerCase().includes(serverSearch.trim().toLowerCase()) || item.id.includes(serverSearch.trim()));
  const selectedDestination = guilds.find((item) => item.id === destinationGuildId) ?? guild ?? null;
  const parsedEmoji = parseEmojiAsset(sourceInput);
  const pastedEmojiAssets = useMemo(() => parseEmojiAssets(sourceInput), [sourceInput]);
  const previewUrl = filePreview ?? parsedEmoji?.url ?? (isHttpImageUrl(sourceInput) ? sourceInput.trim() : null);
  const sourceLabel = selectedFile?.name ?? parsedEmoji?.name ?? (sourceInput.trim() || null);
  const sourceType = selectedFile
    ? selectedFile.type.includes("gif") ? "Animado" : "Imagem"
    : parsedEmoji
      ? parsedEmoji.animated ? "Emoji animado" : "Emoji estatico"
      : sourceInput.trim()
        ? "URL"
        : "Aguardando";
  const sourceSize = selectedFile ? formatBytes(selectedFile.size) : previewUrl ? "Remoto" : "Não carregado";
  const filteredHistory = history.filter((item) => {
    const query = historyFilter.trim().toLowerCase();
    return !query || item.name.toLowerCase().includes(query) || item.guildName.toLowerCase().includes(query);
  });
  const liveCredentialStatus = selectedBot
    ? selectedBot.status === "online"
      ? { label: "Válido", tone: "success" as const }
      : selectedBot.status === "invalid_token"
        ? { label: "Inválido", tone: "danger" as const }
        : { label: "Validando", tone: "warning" as const }
    : { label: "Não configurado", tone: "muted" as const };
  const credentialStatus = credentialTestMode === "real"
    ? liveCredentialStatus
    : credentialTestMode === "valid"
      ? { label: "Falso válido", tone: "success" as const }
      : credentialTestMode === "invalid"
        ? { label: "Falso inválido", tone: "danger" as const }
        : { label: "Falso validando", tone: "warning" as const };

  function pushCloneLog(message: string) {
    setCloneLogs((current) => [message, ...current].slice(0, 80));
  }

  function resetTokenValidation() {
    setFakeTokenAccepted(false);
    setFakeTokenMasked(null);
    setFakeEmojis([]);
  }

  async function handleCloneEmoji() {
    if (!canManage || !settings?.emojiCloneEnabled || !destinationGuildId) return;

    const image = filePreview ?? sourceInput.trim();
    const name = sanitizeEmojiName(emojiName || parsedEmoji?.name || selectedFile?.name.replace(/\.[^.]+$/, "") || "");

    if (!image || !name) {
      setCloneStatus("error");
      setCloneMessage("Selecione uma imagem/emoji e defina um nome válido.");
      return;
    }

    setCloneProgress(15);
    setCloneStatus("running");
    setCloneMessage("Validando imagem e permissões do bot...");

    try {
      const emoji = await cloneEmojiToGuild(destinationGuildId, { image, name, sourceLabel }, botId);
      setCloneProgress(100);
      setCloneStatus("success");
      setCloneMessage(emoji.duplicate ? `Emoji ${emoji.name} já existia no servidor. Biblioteca atualizada.` : `Emoji ${emoji.name} clonado e salvo na Biblioteca.`);
      setHistory((current) => [{
        createdAt: new Date().toISOString(),
        emojiUrl: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=64`,
        guildName: selectedDestination?.name ?? destinationGuildId,
        name: emoji.name,
        status: "success" as const
      }, ...current].slice(0, 20));
      await refreshEmojiLibrary();
    } catch (requestError) {
      setCloneProgress(100);
      setCloneStatus("error");
      setCloneMessage(readErrorMessage(requestError, "Não foi possível clonar o emoji."));
      setHistory((current) => [{
        createdAt: new Date().toISOString(),
        emojiUrl: previewUrl,
        guildName: selectedDestination?.name ?? destinationGuildId,
        name,
        status: "failed" as const
      }, ...current].slice(0, 20));
    }
  }

  async function handleClonePastedEmojis() {
    if (!canManage || !settings?.emojiCloneEnabled || !destinationGuildId || !pastedEmojiAssets.length) return;

    setCloneProgress(0);
    setCloneStatus("running");
    setCloneMessage("Preparando clonagem por lista colada...");
    pushCloneLog(`[INFO] Iniciando clonagem sem servidor de origem: ${pastedEmojiAssets.length} emoji(s)`);

    let success = 0;
    let failed = 0;

    for (const [index, asset] of pastedEmojiAssets.entries()) {
      const name = sanitizeEmojiName(`${settings.emojiCloneDefaultPrefix ?? ""}${asset.name}`) || `emoji_${index + 1}`;

      try {
        setCloneMessage(`Clonando emojis... ${index + 1}/${pastedEmojiAssets.length}`);
        setCloneProgress(Math.max(10, Math.round((index / pastedEmojiAssets.length) * 90)));
        pushCloneLog(`[INFO] Clonando emoji: ${name}`);
        const emoji = await cloneEmojiToGuild(destinationGuildId, {
          image: asset.url,
          name,
          sourceLabel: asset.name
        }, botId);
        success += 1;
        pushCloneLog(`[SUCCESS] Emoji clonado: ${emoji.name}`);
        setHistory((current) => [{
          createdAt: new Date().toISOString(),
          emojiUrl: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=64`,
          guildName: selectedDestination?.name ?? destinationGuildId,
          name: emoji.name,
          status: "success" as const
        }, ...current].slice(0, 20));
      } catch (requestError) {
        failed += 1;
        const message = readErrorMessage(requestError, "Falha ao clonar emoji.");
        pushCloneLog(`[ERROR] Falha ao criar emoji ${name}: ${message}`);
        setHistory((current) => [{
          createdAt: new Date().toISOString(),
          emojiUrl: asset.url,
          guildName: selectedDestination?.name ?? destinationGuildId,
          name,
          status: "failed" as const
        }, ...current].slice(0, 20));
      }

      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }

    setCloneProgress(100);
    setCloneStatus(failed ? "error" : "success");
    setCloneMessage(`Concluído. ${success}/${pastedEmojiAssets.length} emoji(s) clonados${failed ? `, ${failed} falharam` : ""}.`);
    pushCloneLog(`[INFO] Processo concluído: ${success}/${pastedEmojiAssets.length} emoji(s) clonados`);
    await refreshEmojiLibrary();
  }

  async function refreshEmojiLibrary() {
    if (!botId || !settings?.emojiCloneEnabled) return;

    const items = await getEmojiLibrary(botId, {
      animated: libraryType,
      q: libraryFilter
    }).catch(() => null);

    if (items) {
      setLibrary(items);
    }
  }

  async function handleLibraryDownload() {
    if (!botId) return;

    if (libraryDownloadAbortRef.current) {
      libraryDownloadAbortRef.current.abort();
      return;
    }

    const controller = new AbortController();
    libraryDownloadAbortRef.current = controller;
    setLibraryDownloadProgress(0);
    setCloneMessage("Preparando o arquivo ZIP...");

    try {
      const result = await downloadEmojiZip("library", botId, destinationGuildId || guild?.id, {
        onProgress: setLibraryDownloadProgress,
        signal: controller.signal
      });
      saveBrowserDownload(result.blob, "emojis.zip");
      setCloneMessage(`Download concluído: ${result.count} emoji(s) baixado(s), ${result.failed} falha(s).`);
    } catch (error) {
      setCloneMessage(controller.signal.aborted
        ? "Download cancelado."
        : readErrorMessage(error, "Não foi possível baixar os emojis. Tente novamente."));
    } finally {
      libraryDownloadAbortRef.current = null;
      setLibraryDownloadProgress(null);
    }
  }

  async function handleResendLibraryEmoji(item: EmojiLibraryItem) {
    if (!botId || !destinationGuildId || !canManage) return;

    setResendingId(item.id);
    setCloneStatus("running");
    setCloneProgress(35);
    setCloneMessage(`Reenviando ${item.name}...`);

    try {
      const emoji = await resendEmojiFromLibrary(botId, item.id, {
        guildId: destinationGuildId,
        name: item.name
      });
      setCloneProgress(100);
      setCloneStatus("success");
      setCloneMessage(emoji.duplicate ? `Emoji ${emoji.name} já existia no destino.` : `Emoji ${emoji.name} reenviado para ${selectedDestination?.name ?? destinationGuildId}.`);
      await refreshEmojiLibrary();
    } catch (requestError) {
      setCloneProgress(100);
      setCloneStatus("error");
      setCloneMessage(readErrorMessage(requestError, "Não foi possível reenviar o emoji."));
    } finally {
      setResendingId(null);
    }
  }

  async function handleValidateFakeToken() {
    const sourceGuildId = fakeSourceGuildId.trim();
    const targetGuildId = destinationGuildId || guild?.id || "";

    setFakeTokenAccepted(false);
    setFakeTokenMessage(null);
    setFakeTokenMasked(null);
    setFakeEmojis([]);
    setBulkLoading("validating");
    setCloneStatus("running");
    setCloneProgress(0);
    setCloneMessage("Validando token...");
    pushCloneLog("[INFO] Iniciando validação");
    pushCloneLog("[INFO] Conectando ao Discord");

    if (!/^\d{5,32}$/.test(sourceGuildId) || !/^\d{5,32}$/.test(targetGuildId)) {
      setFakeTokenMessage("Informe IDs validos de origem e destino.");
      setCloneStatus("error");
      setCloneProgress(100);
      setCloneMessage("Informe IDs validos de origem e destino.");
      setBulkLoading("idle");
      return;
    }

    try {
      const result = await validateEmojiCloneBotToken({
        sourceGuildId,
        targetGuildId,
        token: fakeToken
      });

      setFakeTokenAccepted(result.accepted);
      setFakeTokenMasked(`Bot ${result.bot.username} (${result.bot.id})`);
      setFakeTokenMessage(result.message);
      setCredentialTestMode("valid");
      setCloneProgress(25);
      setCloneMessage("Token validado. Buscando emojis...");
      pushCloneLog("[INFO] Token validado com sucesso");
      await loadTokenEmojis(sourceGuildId, targetGuildId, fakeToken);
    } catch (requestError) {
      setFakeTokenAccepted(false);
      setCredentialTestMode("invalid");
      const message = readDetailedRequestMessage(requestError, "Token inválido.");
      setFakeTokenMessage(message);
      setCloneStatus("error");
      setCloneProgress(100);
      setCloneMessage(message);
      pushCloneLog(`[ERROR] ${message}`);
    } finally {
      setBulkLoading("idle");
    }
  }

  async function loadTokenEmojis(sourceGuildId: string, targetGuildId: string, token: string) {
    setBulkLoading("fetching");
    setCloneStatus("running");
    setCloneProgress(35);
    setCloneMessage("Buscando emojis...");
    pushCloneLog("[INFO] Buscando emojis");
    pushCloneLog(`[INFO] Buscando emojis do servidor ${sourceGuildId}`);

    try {
      const emojis = await fetchEmojiCloneBotTokenEmojis({
        sourceGuildId,
        targetGuildId,
        token
      });
      setFakeEmojis(emojis.map((emoji) => ({ ...emoji, selected: true, status: "ready" as const })));
      setFakeTokenMessage(`${emojis.length} emoji(s) encontrados.`);
      setCloneStatus("success");
      setCloneProgress(50);
      setCloneMessage(`${emojis.length} emoji(s) encontrados. Selecione e inicie a clonagem.`);
      pushCloneLog(`[INFO] ${emojis.length} emojis encontrados`);
    } catch (requestError) {
      const message = readDetailedRequestMessage(requestError, "Erro ao conectar com a API do Discord.");
      setFakeTokenMessage(message);
      setCloneStatus("error");
      setCloneProgress(100);
      setCloneMessage(message);
      pushCloneLog(`[ERROR] ${message}`);
    } finally {
      setBulkLoading("idle");
    }
  }

  async function handleFetchFakeEmojis() {
    if (!fakeTokenAccepted) {
      setFakeTokenMessage("Valide o token antes de buscar emojis.");
      return;
    }

    await loadTokenEmojis(fakeSourceGuildId.trim(), destinationGuildId || guild?.id || "", fakeToken);
  }

  async function handleCloneFakeSelected() {
    if (!fakeTokenAccepted || !fakeEmojis.some((emoji) => emoji.selected)) {
      setFakeTokenMessage("Selecione emojis para clonar.");
      return;
    }

    const selected = fakeEmojis.filter((emoji) => emoji.selected);
    const sourceGuildId = fakeSourceGuildId.trim();
    const targetGuildId = destinationGuildId || guild?.id || "";
    setCloneStatus("running");
    setCloneProgress(75);
    setBulkLoading("cloning");
    setCloneMessage("Preparando clonagem...");
    pushCloneLog("[INFO] Preparando clonagem");
    pushCloneLog(`[INFO] Iniciando clonagem de ${selected.length} emoji(s)`);

    try {
      const result = await cloneSelectedEmojiCloneBotToken(botId, {
        emojis: selected,
        prefix: settings?.emojiCloneDefaultPrefix ?? null,
        sourceGuildId,
        targetGuildId,
        token: fakeToken
      });
      const failedIds = new Set(result.items.filter((item) => item.status === "failed").map((item) => item.originalEmojiId));
      setFakeEmojis((current) => current.map((emoji) => {
        if (!emoji.selected) return { ...emoji, status: "ignored" };
        return { ...emoji, status: failedIds.has(emoji.id) ? "failed" : "cloned" };
      }));
      setCloneProgress(100);
      setCloneStatus(result.failed ? "error" : "success");
      setCloneMessage(`Processo concluído. ${result.success}/${result.total} emojis clonados.`);
      pushCloneLog(`[INFO] Processo concluído: ${result.success}/${result.total} emojis clonados`);
      setHistory((current) => [
        ...selected.map((emoji) => ({
          createdAt: new Date().toISOString(),
          emojiUrl: emoji.url,
          guildName: selectedDestination?.name ?? destinationGuildId,
          name: emoji.name,
          status: failedIds.has(emoji.id) ? "failed" as const : "success" as const
        })),
        ...current
      ].slice(0, 20));
      await refreshEmojiLibrary();
    } catch (requestError) {
      const message = readDetailedRequestMessage(requestError, "Não foi possível clonar emojis selecionados.");
      setCloneProgress(100);
      setCloneStatus("error");
      setCloneMessage(message);
      pushCloneLog(`[ERROR] ${message}`);
    } finally {
      setBulkLoading("idle");
    }
  }

  function handleClearFakeTest() {
    setFakeToken("");
    setFakeSourceGuildId("");
    setFakeTokenMasked(null);
    setFakeTokenAccepted(false);
    setFakeTokenMessage(null);
    setFakeEmojis([]);
    setCloneLogs([]);
    setBulkLoading("idle");
    setCredentialTestMode("real");
  }

  if (!guild) {
    return <EmptyState icon={SmilePlus} title="Selecione um servidor para configurar a clonagem de emojis" />;
  }

  const disabled = !settings || !canManage || loading || saving;
  const selectedBotIds = settings?.emojiCloneAllowedBotIds ?? [];
  const allowedBots = bots.filter((bot) => !guild || bot.guildIds.includes(guild.id));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Clonagem de Emojis</CardTitle>
            <CardDescription>Controle quem usa, onde registrar logs e quais bots podem executar o clone.</CardDescription>
          </div>
          <Switch
            checked={Boolean(settings?.emojiCloneEnabled)}
            disabled={disabled}
            onCheckedChange={(checked) => void savePatch({ emojiCloneEnabled: checked })}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-[#FFEA70]">
                  <LockKeyhole className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Credencial segura do bot</p>
                  <p className="text-xs text-zinc-500">Usa somente o bot conectado ao painel. Credenciais de usuário não são aceitas.</p>
                </div>
              </div>
              <Badge variant={credentialStatus.tone === "success" ? "success" : credentialStatus.tone === "danger" ? "danger" : "muted"}>
                {credentialStatus.label}
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <StatusPill icon={Server} label="Servidores encontrados" value={String(destinationGuilds.length)} />
              <StatusPill icon={ShieldCheck} label="Módulo" value={settings?.emojiCloneEnabled ? "Ativo" : "Pausado"} />
              <StatusPill icon={RefreshCw} label="Atualização" value="Automática" />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Modo de teste</p>
                  <p className="text-xs text-zinc-500">Simula credenciais falsas sem receber ou salvar nenhum token.</p>
                </div>
                <select
                  className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
                  disabled={disabled || cloneStatus === "running"}
                  onChange={(event) => setCredentialTestMode(event.target.value as typeof credentialTestMode)}
                  value={credentialTestMode}
                >
                  <option value="real">Usar bot real</option>
                  <option value="validating">Falso validando</option>
                  <option value="valid">Falso válido</option>
                  <option value="invalid">Falso inválido</option>
                </select>
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/5 p-3">
              <div>
                <p className="text-sm font-semibold text-white">Clonagem por Token de Bot</p>
                <p className="text-xs text-zinc-500">Valida o bot, busca emojis reais e processa a clonagem em fila com limite gradual.</p>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-zinc-400">Token do bot</span>
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                    disabled={disabled || cloneStatus === "running"}
                    onChange={(event) => {
                      setFakeToken(event.target.value);
                      resetTokenValidation();
                    }}
                    placeholder="Cole o token do bot"
                    type="password"
                    value={fakeToken}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-medium text-zinc-400">Servidor origem ID</span>
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                    disabled={disabled || cloneStatus === "running"}
                    onChange={(event) => {
                      setFakeSourceGuildId(event.target.value);
                      resetTokenValidation();
                    }}
                    placeholder="ID do servidor origem"
                    value={fakeSourceGuildId}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-medium text-zinc-400">Servidor destino ID</span>
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
                    disabled
                    value={destinationGuildId || guild.id}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={disabled || bulkLoading !== "idle"} onClick={() => void handleValidateFakeToken()} size="sm" type="button">
                  {bulkLoading === "validating" ? "Validando..." : "Validar token"}
                </Button>
                <Button disabled={disabled || bulkLoading !== "idle" || !fakeTokenAccepted} onClick={() => void handleFetchFakeEmojis()} size="sm" type="button" variant="outline">
                  {bulkLoading === "fetching" ? "Buscando..." : "Buscar Emojis"}
                </Button>
                <Button disabled={disabled || bulkLoading !== "idle" || !fakeTokenAccepted || !fakeEmojis.some((emoji) => emoji.selected)} onClick={() => void handleCloneFakeSelected()} size="sm" type="button" variant="outline">
                  {bulkLoading === "cloning" ? "Clonando..." : "Clonar Emojis Selecionados"}
                </Button>
                <Button onClick={handleClearFakeTest} size="sm" type="button" variant="outline">
                  Limpar teste
                </Button>
              </div>
              {fakeTokenMasked || fakeTokenMessage ? (
                <p className={["rounded-lg border px-3 py-2 text-sm", fakeTokenAccepted ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 bg-zinc-950 text-zinc-300"].join(" ")}>
                  {fakeTokenMessage}{fakeTokenMasked ? ` Token: ${fakeTokenMasked}` : ""}
                </p>
              ) : null}
              {fakeEmojis.length ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {fakeEmojis.map((emoji) => (
                    <button
                      className={["flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition", emoji.selected ? "border-[#FFD500]/50 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950"].join(" ")}
                      key={emoji.id}
                      onClick={() => setFakeEmojis((current) => current.map((item) => item.id === emoji.id ? { ...item, selected: !item.selected } : item))}
                      type="button"
                    >
                      <img alt="" className="h-9 w-9 shrink-0 rounded-md object-contain" src={emoji.url} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">{emoji.name}</span>
                        <span className="mt-1 block text-xs text-zinc-500">{emoji.status === "cloned" ? "Clonado" : emoji.status === "failed" ? "Falhou" : emoji.status === "ignored" ? "Ignorado" : emoji.selected ? "Selecionado" : "Não selecionado"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Progresso</p>
                <p className="text-xs text-zinc-500">Validação, criação e retorno do Discord.</p>
              </div>
              {cloneStatus === "running" ? <Loader2 className="h-5 w-5 animate-spin text-[#FFEA70]" /> : cloneStatus === "success" ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : cloneStatus === "error" ? <XCircle className="h-5 w-5 text-red-300" /> : <Clock3 className="h-5 w-5 text-zinc-500" />}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
              <div className="h-full rounded-full bg-[#FFD500] transition-all" style={{ width: `${cloneProgress}%` }} />
            </div>
            <p className="text-right text-xs font-medium text-zinc-400">{cloneProgress}%</p>
            {cloneMessage ? <p className={["rounded-lg border px-3 py-2 text-sm", cloneStatus === "error" ? "border-red-500/20 bg-red-500/10 text-red-200" : cloneStatus === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 bg-zinc-900 text-zinc-300"].join(" ")}>{cloneMessage}</p> : null}
            <div className="max-h-44 overflow-y-auto rounded-lg border border-zinc-800 bg-black p-3">
              {cloneLogs.length ? cloneLogs.map((log, index) => (
                <p className="font-mono text-xs text-zinc-300" key={`${log}-${index}`}>{log}</p>
              )) : (
                <p className="text-xs text-zinc-600">Logs da clonagem aparecem aqui.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Destino</p>
              <p className="text-xs text-zinc-500">{destinationGuilds.length} servidores disponíveis para receber emojis.</p>
            </div>
            <Badge variant="muted">{selectedDestination ? "Slots validos no Discord" : "Selecione"}</Badge>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600"
              disabled={disabled}
              onChange={(event) => setServerSearch(event.target.value)}
              placeholder="Pesquisar servidor"
              value={serverSearch}
            />
          </label>
          <div className="grid max-h-72 gap-2 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {destinationGuilds.map((item) => (
              <button
                className={["flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition", destinationGuildId === item.id ? "border-[#FFD500]/50 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"].join(" ")}
                disabled={disabled}
                key={item.id}
                onClick={() => setDestinationGuildId(item.id)}
                type="button"
              >
                <Avatar className="h-9 w-9 rounded-lg" fallback={item.name} src={item.iconUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{item.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{item.id}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Biblioteca de Emojis</p>
              <p className="text-xs text-zinc-500">Emojis importados pelo seu usuário neste bot do Portal do Desenvolvedor.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 sm:w-56"
                  onChange={(event) => setLibraryFilter(event.target.value)}
                  placeholder="Buscar emoji"
                  value={libraryFilter}
                />
              </label>
              <select
                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
                onChange={(event) => setLibraryType(event.target.value as typeof libraryType)}
                value={libraryType}
              >
                <option value="all">Todos</option>
                <option value="false">Estaticos</option>
                <option value="true">Animados</option>
              </select>
              <Button disabled={libraryLoading} onClick={() => void refreshEmojiLibrary()} size="sm" type="button" variant="outline">
                {libraryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              {botId ? (
                <Button disabled={!library.length} onClick={() => void handleLibraryDownload()} size="sm" type="button" variant="outline">
                  {libraryDownloadProgress !== null ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {libraryDownloadProgress !== null ? `Cancelar (${libraryDownloadProgress || "..."}%)` : "Baixar Emojis"}
                </Button>
              ) : null}
            </div>
          </div>
          {libraryDownloadProgress !== null ? (
            <div className="h-2 overflow-hidden rounded-full bg-zinc-900" aria-label="Progresso do download">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${libraryDownloadProgress || 5}%` }} />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {library.length ? library.map((item) => {
              const sourceGuild = guilds.find((entry) => entry.id === item.sourceGuildId);
              const targetGuild = guilds.find((entry) => entry.id === item.destinationGuildId);

              return (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3" key={item.id}>
                  <div className="flex aspect-square items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60">
                    <img alt={item.name} className="max-h-full max-w-full object-contain" src={item.url} />
                  </div>
                  <div className="mt-3 min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {item.animated ? "Animado" : "Estatico"} - {item.category} - {new Date(item.importedAt).toLocaleString("pt-BR")}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-600">
                      {sourceGuild?.name ?? item.sourceGuildId ?? "Origem externa"} {"->"} {targetGuild?.name ?? item.destinationGuildId}
                    </p>
                  </div>
                  <Button
                    className="mt-3 w-full"
                    disabled={disabled || !destinationGuildId || resendingId === item.id}
                    onClick={() => void handleResendLibraryEmoji(item)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {resendingId === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Reenviar
                  </Button>
                </div>
              );
            }) : (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500 sm:col-span-2 lg:col-span-3 xl:col-span-4">
                {libraryLoading ? "Carregando Biblioteca..." : "Nenhum emoji importado na sua Biblioteca."}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Histórico</p>
              <p className="text-xs text-zinc-500">Últimas clonagens feitas por este painel nesta sessão.</p>
            </div>
            <div className="flex gap-2">
              <input
                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setHistoryFilter(event.target.value)}
                placeholder="Filtrar histórico"
                value={historyFilter}
              />
              <Button onClick={() => setHistory([])} size="sm" type="button" variant="outline">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {filteredHistory.length ? filteredHistory.map((item) => (
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2" key={`${item.createdAt}-${item.name}`}>
                {item.emojiUrl ? <img alt="" className="h-9 w-9 rounded-lg object-contain" src={item.emojiUrl} /> : <ImageIcon className="h-9 w-9 rounded-lg border border-zinc-800 p-2 text-zinc-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{item.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{item.guildName} • {new Date(item.createdAt).toLocaleString("pt-BR")}</span>
                </span>
                <Badge variant={item.status === "success" ? "success" : "danger"}>{item.status === "success" ? "Sucesso" : "Erro"}</Badge>
              </div>
            )) : (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">Nenhuma clonagem registrada ainda.</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-300">Canal de logs</span>
            <select
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
              disabled={disabled}
              onChange={(event) => void savePatch({ emojiCloneLogChannelId: event.target.value || null })}
              value={settings?.emojiCloneLogChannelId ?? ""}
            >
              <option value="">Sem canal</option>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-300">Prefixo padrão</span>
            <input
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
              disabled={disabled}
              maxLength={24}
              onBlur={(event) => void savePatch({ emojiCloneDefaultPrefix: event.target.value || null })}
              placeholder="vortex_"
              defaultValue={settings?.emojiCloneDefaultPrefix ?? ""}
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-300">Limite por execução</span>
            <input
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
              disabled={disabled}
              max={1000}
              min={1}
              onBlur={(event) => void savePatch({ emojiCloneMaxPerRun: Number(event.target.value) || 1000 })}
              type="number"
              defaultValue={settings?.emojiCloneMaxPerRun ?? 1000}
            />
          </label>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-zinc-200">Permitir emojis animados</p>
              <p className="text-xs text-zinc-500">Bloqueia GIFs quando desligado.</p>
            </div>
            <Switch
              checked={settings?.emojiCloneAllowAnimated ?? true}
              disabled={disabled}
              onCheckedChange={(checked) => void savePatch({ emojiCloneAllowAnimated: checked })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Bots autorizados</p>
            <p className="mt-1 text-xs text-zinc-500">Se nenhum bot for marcado, qualquer bot com o módulo liberado pode executar.</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {allowedBots.map((bot) => {
              const checked = selectedBotIds.includes(bot.clientId) || selectedBotIds.includes(bot.id);

              return (
                <button
                  className={[
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition",
                    checked ? "border-[#FFD500]/40 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                  ].join(" ")}
                  disabled={disabled}
                  key={bot.id}
                  onClick={() => void savePatch({ emojiCloneAllowedBotIds: toggleValue(selectedBotIds, bot.clientId) })}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">{bot.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{bot.clientId}</span>
                  </span>
                  <Badge variant={checked ? "success" : "muted"}>{checked ? "Liberado" : "Bloqueado"}</Badge>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-white">Cargos permitidos</p>
          <div className="grid gap-2 md:grid-cols-2">
            {roles.slice(0, 40).map((role) => {
              const checked = settings?.emojiCloneAllowedRoleIds.includes(role.id) ?? false;

              return (
                <button
                  className={[
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition",
                    checked ? "border-emerald-500/40 bg-emerald-500/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                  ].join(" ")}
                  disabled={disabled}
                  key={role.id}
                  onClick={() => void savePatch({ emojiCloneAllowedRoleIds: toggleValue(settings?.emojiCloneAllowedRoleIds ?? [], role.id) })}
                  type="button"
                >
                  <span className="truncate text-sm text-zinc-200">@{role.name}</span>
                  <Badge variant={checked ? "success" : "muted"}>{checked ? "Permitido" : "Sem acesso"}</Badge>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LogsView({
  botId,
  canManage,
  guild,
  loading,
  logs,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading: boolean;
  logs: LogEntry[];
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  return (
    <div className="space-y-5">
      <LogsSettingsPanel
        botId={botId}
        canManage={canManage}
        guild={guild}
        loading={loading}
        onSettingsChange={onSettingsChange}
        settings={settings}
      />

      <NotificationsView
        botId={botId}
        canManage={canManage}
        guild={guild}
        loading={loading}
        onSettingsChange={onSettingsChange}
        settings={settings}
      />

      <Card>
        <CardHeader>
          <CardTitle>Histórico do site</CardTitle>
          <CardDescription>Eventos das categorias selecionadas para a dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <FriendlyLogList logs={logs} />
        </CardContent>
      </Card>
    </div>
  );
}

type NotificationChannelKey =
  | "logChannelId"
  | "welcomeDisplayChannelId"
  | "safeBotLogChannelId"
  | "ticketCategoryId"
  | "welcomeChannelId"
  | "leaveChannelId"
  | "leaveDisplayChannelId";

const notificationChannelFields: Array<{
  description: string;
  key: NotificationChannelKey;
  label: string;
}> = [
  {
    key: "logChannelId",
    label: "Canal de Logs",
    description: "Eventos gerais do bot, dashboard e automacoes."
  },
  {
    key: "welcomeDisplayChannelId",
    label: "Canal de Avisos",
    description: "Canal usado como referência para avisos exibidos nos painéis."
  },
  {
    key: "safeBotLogChannelId",
    label: "Canal de Moderação",
    description: "Alertas de filtros, punições e ações de segurança."
  },
  {
    key: "ticketCategoryId",
    label: "Categoria de Tickets",
    description: "Destino usado pelo sistema atual de tickets."
  },
  {
    key: "welcomeChannelId",
    label: "Canal de Boas-vindas",
    description: "Onde o bot envia a mensagem de entrada."
  },
  {
    key: "leaveChannelId",
    label: "Canal de Saída",
    description: "Onde o bot envia a mensagem de saída."
  },
  {
    key: "leaveDisplayChannelId",
    label: "Canal de Anuncios",
    description: "Canal de referencia para comunicados e anuncios."
  }
];

function NotificationsView({
  botId,
  canManage,
  guild,
  loading,
  onSettingsChange,
  settings
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
}) {
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildChannelOption[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [savingField, setSavingField] = useState<NotificationChannelKey | null>(null);
  const [savedField, setSavedField] = useState<NotificationChannelKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guild) {
      setChannels([]);
      return;
    }

    let mounted = true;
    setChannelsLoading(true);

    getGuildLiveOptions(guild.id, botId)
      .then((options) => {
        if (mounted) {
          setChannels(options.channels);
          setCategories((options.categories ?? []).map((category) => ({
            ...category,
            parentId: null,
            type: "text" as const
          })));
        }
      })
      .catch(() => {
        if (mounted) {
          setChannels([]);
          setCategories([]);
        }
      })
      .finally(() => {
        if (mounted) setChannelsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  async function handleChannelChange(key: NotificationChannelKey, value: string) {
    if (!guild || !settings || !canManage) return;

    const nextValue = value || null;
    const previous = settings;
    const optimistic = {
      ...settings,
      [key]: nextValue
    };

    setError(null);
    setSavingField(key);
    setSavedField(null);
    onSettingsChange(optimistic);

    try {
      const saved = await patchGuildSettings(guild.id, { [key]: nextValue }, botId);
      onSettingsChange(saved);
      setSavedField(key);
      window.setTimeout(() => setSavedField((current) => current === key ? null : current), 1800);
    } catch {
      onSettingsChange(previous);
      setError("Não foi possível salvar este canal. Verifique as permissões do bot e tente novamente.");
    } finally {
      setSavingField(null);
    }
  }

  if (!guild) {
    return <EmptyState icon={Bell} title="Selecione um servidor para configurar notificações" />;
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Notificações</h2>
          <p className="mt-1 text-sm text-zinc-500">Configure os canais do bot selecionado. Cada alteração salva automaticamente no banco.</p>
        </div>
        <Badge variant={canManage ? "success" : "muted"}>{canManage ? "Auto-save ativo" : "Somente leitura"}</Badge>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {notificationChannelFields.map((field) => {
          const value = settings?.[field.key] ?? "";
          const saving = savingField === field.key;
          const saved = savedField === field.key;
          const options = field.key === "ticketCategoryId" ? categories : channels;

          return (
            <Card className="border-[#FFD500]/10 bg-zinc-950/70" key={field.key}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white">{field.label}</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{field.description}</p>
                  </div>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin text-[#FFEA70]" /> : null}
                  {saved ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}
                </div>

                {loading || channelsLoading ? (
                  <div className="h-11 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/70" />
                ) : (
                  <select
                    className="h-11 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-[#FFD500]/50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!settings || !canManage || saving}
                    onChange={(event) => void handleChannelChange(field.key, event.target.value)}
                    value={value}
                  >
                    <option value="">Selecionar Canal</option>
                    {value && !options.some((channel) => channel.id === value) ? (
                      <option value={value}>Canal atual ({value})</option>
                    ) : null}
                    {options.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {field.key === "ticketCategoryId" ? channel.name : `#${channel.name}`}
                      </option>
                    ))}
                  </select>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function SimpleToggleCard({
  checked,
  description,
  disabled,
  icon: Icon,
  onChange,
  title
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  icon: typeof Bot;
  onChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
          </div>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex h-full min-h-24 items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-zinc-500">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({
  badge,
  icon: Icon,
  subtitle,
  title,
  time
}: {
  badge: string;
  icon: typeof Bot;
  subtitle: string;
  title: string;
  time: string;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-zinc-950/70 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
          <Icon className="h-4 w-4 text-zinc-300" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{title}</p>
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-xs text-zinc-500 sm:inline">{formatDate(time)}</span>
        <Badge variant="muted">{badge}</Badge>
      </div>
    </div>
  );
}

function StatusPill({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-900 pb-2 last:border-0 last:pb-0">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right text-zinc-200">{value}</span>
    </div>
  );
}

function parseEmojiAsset(value: string) {
  const custom = value.trim().match(/<(?<animated>a?):(?<name>[a-zA-Z0-9_]{2,32}):(?<id>\d{5,32})>/);

  if (custom?.groups) {
    const animated = custom.groups.animated === "a";
    const id = custom.groups.id;

    return {
      animated,
      name: custom.groups.name,
      url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=128&quality=lossless`
    };
  }

  const url = value.trim().match(/https:\/\/cdn\.discordapp\.com\/emojis\/(?<id>\d{5,32})\.(?<ext>png|gif|webp|jpg|jpeg)(?:\?[^\s<>\]]*)?/i);

  if (url?.groups) {
    const extension = url.groups.ext ?? "png";

    return {
      animated: extension.toLowerCase() === "gif",
      name: `emoji_${url.groups.id}`,
      url: url[0]
    };
  }

  return null;
}

function parseEmojiAssets(value: string) {
  const candidates = new Map<string, { animated: boolean; id: string; name: string; url: string }>();
  const customPattern = /<(?<animated>a?):(?<name>[a-zA-Z0-9_]{2,32}):(?<id>\d{5,32})>/g;
  const cdnPattern = /https:\/\/cdn\.discordapp\.com\/emojis\/(?<id>\d{5,32})\.(?<ext>png|gif|webp|jpg|jpeg)(?:\?[^\s<>\]]*)?/gi;

  for (const match of value.matchAll(customPattern)) {
    if (!match.groups) continue;
    const animated = match.groups.animated === "a";
    const id = match.groups.id;
    const name = match.groups.name;

    if (!id || !name) continue;

    candidates.set(id, {
      animated,
      id,
      name,
      url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=128&quality=lossless`
    });
  }

  for (const match of value.matchAll(cdnPattern)) {
    if (!match.groups) continue;
    const id = match.groups.id;
    const ext = match.groups.ext;

    if (!id || !ext) continue;

    const extension = ext.toLowerCase();

    candidates.set(id, {
      animated: extension === "gif",
      id,
      name: `emoji_${id}`,
      url: match[0]
    });
  }

  return [...candidates.values()];
}

function isHttpImageUrl(value: string) {
  return /^https?:\/\/\S+\.(?:png|gif|webp|jpe?g)(?:\?\S*)?$/i.test(value.trim());
}

function sanitizeEmojiName(value: string) {
  return value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function readDetailedRequestMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string }; status?: number } }).response;
    const message = response?.data?.message ?? fallback;
    return response?.status ? `${message} HTTP ${response.status}.` : message;
  }

  return error instanceof Error ? error.message : fallback;
}

function FriendlyLogList({ compact = false, logs }: { compact?: boolean; logs: LogEntry[] }) {
  if (!logs.length) {
    return <EmptyState icon={ScrollText} title="Nenhum log registrado" />;
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => {
        const friendly = friendlyLog(log);

        return (
          <EventRow
            badge={friendly.badge}
            icon={ScrollText}
            key={log.id}
            subtitle={compact ? formatDate(log.createdAt) : friendly.description}
            title={friendly.title}
            time={log.createdAt}
          />
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title }: { icon: typeof Bot; title: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
      <Icon className="mb-3 h-7 w-7 text-zinc-500" />
      <p className="text-sm font-medium text-zinc-500">{title}</p>
    </div>
  );
}

function moduleState(moduleId: string, settings: GuildSettings | null, details: OverviewDetails) {
  if (moduleId === "live") {
    const active = details.liveNotifications.some((notification) => notification.enabled);
    return {
      active,
      configured: details.liveNotifications.length > 0,
      configuredText: details.liveNotifications.length ? `${details.liveNotifications.length} alerta(s)` : "Falta configurar"
    };
  }

  if (moduleId === "kick-integration") {
    const active = details.kickNotifications.some((notification) => notification.enabled);
    return {
      active,
      configured: details.kickNotifications.length > 0,
      configuredText: details.kickNotifications.length ? `${details.kickNotifications.length} canal(is)` : "Falta configurar"
    };
  }

  if (moduleId === "clips") {
    return {
      active: Boolean(details.clipsConfig?.enabled),
      configured: Boolean(details.clipsConfig?.discordChannelId),
      configuredText: details.clipsConfig?.discordChannelId ? "Canal configurado" : "Falta canal"
    };
  }

  if (moduleId === "kick-clips") {
    return {
      active: Boolean(details.kickClipsConfig?.enabled),
      configured: Boolean(details.kickClipsConfig?.discordChannelId),
      configuredText: details.kickClipsConfig?.discordChannelId ? "Canal configurado" : "Falta canal"
    };
  }

  if (moduleId === "x-monitor") {
    const activeAccounts = details.xAccounts.filter((account) => account.active).length;
    return {
      active: activeAccounts > 0,
      configured: details.xAccounts.length > 0,
      configuredText: details.xAccounts.length ? `${details.xAccounts.length} conta(s)` : "Falta conta"
    };
  }

  if (moduleId === "moderation") {
    return {
      active: Boolean(settings?.moderationEnabled),
      configured: Boolean(settings?.moderationEnabled),
      configuredText: settings?.moderationEnabled ? "Configurado" : "Falta ativar"
    };
  }

  if (moduleId === "mission-tools") {
    return {
      active: true,
      configured: true,
      configuredText: "Available"
    };
  }

  if (moduleId === "voice-recorder") {
    return {
      active: true,
      configured: true,
      configuredText: "Disponível"
    };
  }

  if (moduleId === "safe-bot") {
    const activeModules = details.selfBotProtectionSettings
      ? Object.values(details.selfBotProtectionSettings.moduleToggles).filter(Boolean).length
      : 0;

    return {
      active: Boolean(details.selfBotProtectionSettings?.enabled),
      configured: Boolean(details.selfBotProtectionSettings?.logChannelId),
      configuredText: activeModules ? `${activeModules} módulo(s)` : "Falta módulo"
    };
  }

  if (moduleId === "account-age-security") {
    return {
      active: Boolean(settings?.accountAgeSecurityEnabled),
      configured: Boolean(settings?.accountAgeLogChannelId || settings?.logChannelId),
      configuredText: settings?.accountAgeSecurityEnabled
        ? `${settings.accountAgeMinDays} dia(s)`
        : "Falta ativar"
    };
  }

  if (moduleId === "verification") {
    const userCount = Object.keys(settings?.dashboardUserPermissions ?? {}).length;
    return {
      active: Boolean(settings?.verificationEnabled),
      configured: userCount > 0,
      configuredText: userCount ? `${userCount} usuário(s)` : "Falta usuário"
    };
  }

  if (moduleId === "logs") {
    const discordActive = Boolean(settings?.discordLogsEnabled && settings.logChannelId);
    const siteActive = Boolean(settings?.siteLogsEnabled);

    return {
      active: discordActive || siteActive,
      configured: discordActive || siteActive,
      configuredText: discordActive && siteActive
        ? "Discord e site"
        : discordActive
          ? "Discord"
          : siteActive
            ? "Site"
            : "Falta configurar"
    };
  }

  if (moduleId === "welcome") {
    return {
      active: Boolean(settings?.welcomeEnabled),
      configured: Boolean(settings?.welcomeChannelId),
      configuredText: settings?.welcomeChannelId ? "Canal configurado" : "Falta canal"
    };
  }

  if (moduleId === "leave") {
    return {
      active: Boolean(settings?.leaveEnabled),
      configured: Boolean(settings?.leaveChannelId),
      configuredText: settings?.leaveChannelId ? "Canal configurado" : "Falta canal"
    };
  }

  if (moduleId === "roles") {
    const count = settings?.autoRoleIds.length ?? 0;
    return {
      active: Boolean(settings?.autoRoleEnabled),
      configured: count > 0,
      configuredText: count ? `${count} cargo(s)` : "Falta cargo"
    };
  }

  if (moduleId === "tickets") {
    return {
      active: Boolean(settings?.ticketEnabled),
      configured: Boolean(settings?.ticketCategoryId),
      configuredText: settings?.ticketCategoryId ? "Categoria configurada" : "Falta categoria"
    };
  }

  return {
    active: true,
    configured: true,
    configuredText: "Disponível"
  };
}

function friendlyLog(log: LogEntry) {
  const lowerMessage = log.message.toLowerCase();
  const message = log.message.replace(/^Usuario\s+/i, "").replace(/\.$/, "");
  const byType: Record<string, { badge: string; title: string }> = {
    "x_monitor.account_added": { badge: "X Monitor", title: "Conta do X adicionada com sucesso" },
    "x_monitor.account_updated": { badge: "X Monitor", title: "Conta do X atualizada" },
    "x_monitor.account_removed": { badge: "X Monitor", title: "Conta do X removida" },
    "x_monitor.post_detected": { badge: "X Monitor", title: "Post do X detectado" },
    "x_monitor.post_sent": { badge: "X Monitor", title: "Post do X enviado ao Discord" },
    "x_monitor.webhook_post": { badge: "X Monitor", title: "Post recebido pelo webhook do X" },
    "x_monitor.discord_error": { badge: "X Monitor", title: "Não foi possível enviar post do X" },
    "x_monitor.api_error": { badge: "X Monitor", title: "X Monitor precisa de atenção" },
    "live:started": { badge: "Lives", title: "Live iniciada" },
    "live:ended": { badge: "Lives", title: "Live encerrada" },
    "ticket.created": { badge: "Tickets", title: "Ticket criado" },
    "audit.lives": { badge: "Lives", title: "Canal de lives atualizado" },
    "audit.kick": { badge: "Kick", title: "Kick Integration atualizado" },
    "social.kick.created": { badge: "Kick", title: "Canal Kick adicionado" },
    "social.kick.updated": { badge: "Kick", title: "Canal Kick atualizado" },
    "social.kick.deleted": { badge: "Kick", title: "Canal Kick removido" },
    "social.kick.tested": { badge: "Kick", title: "Teste Kick enviado" },
    "audit.dev_bot": { badge: "Sistema", title: "Configuração do bot atualizada" },
    "clips.config_saved": { badge: "Clips", title: "Sistema de clips atualizado" },
    "clips.enabled": { badge: "Clips", title: "Sistema de clips ativado" },
    "clips.disabled": { badge: "Clips", title: "Sistema de clips desativado" },
    "giveaway.created": { badge: "Sorteio", title: "Sorteio criado" },
    "giveaway.updated": { badge: "Sorteio", title: "Sorteio atualizado" },
    "giveaway.panel_requested": { badge: "Sorteio", title: "Painel do sorteio solicitado" },
    "giveaway.started": { badge: "Sorteio", title: "Sorteio iniciado" },
    "giveaway.ended": { badge: "Sorteio", title: "Sorteio encerrado" },
    "giveaway.winner": { badge: "Sorteio", title: "Ganhador sorteado" },
    "image_anti_spam.settings_updated": { badge: "Anti-Spam", title: "Anti-Spam de Imagens atualizado" },
    "image_anti_spam.incident": { badge: "Anti-Spam", title: "Spam de midias bloqueado" },
    "image_anti_spam.member_kicked": { badge: "Anti-Spam", title: "Membro expulso por spam de imagens" },
    "moderation.link_anti_spam": { badge: "Moderação", title: "Link bloqueado por anti-flood" },
    "security.account_age.blocked": { badge: "Segurança", title: "Entrada bloqueada por idade da conta" },
    "security.self_bot.role_synced": { badge: "Self Bot", title: "Cargo Self Bot sincronizado" },
    "security.self_bot.role_assigned": { badge: "Self Bot", title: "Cargo Self Bot aplicado" },
    "security.self_bot.assignment_failed": { badge: "Self Bot", title: "Self Bot não conseguiu aplicar cargo" },
    "fivem.fac.settings_updated": { badge: "FiveM", title: "FAC atualizado" },
    "fivem.fac.request_created": { badge: "FiveM", title: "Solicitação de ausência criada" },
    "fivem.fac.request_approved": { badge: "FiveM", title: "Solicitação de ausência aprovada" },
    "fivem.fac.request_rejected": { badge: "FiveM", title: "Solicitação de ausência reprovada" },
    "fivem.fac.absence_started": { badge: "FiveM", title: "Ausência iniciada" },
    "fivem.fac.absence_finished": { badge: "FiveM", title: "Ausência finalizada" },
    "mission_tools.settings_updated": { badge: "Mission", title: "Mission Tools updated" },
    "mission_tools.panel_publish_requested": { badge: "Mission", title: "Control Center publication requested" },
    "mission_tools.fake_token_detected": { badge: "Mission", title: "Fake token detected" }
  };
  const mapped = byType[log.type];

  if (mapped) {
    return {
      ...mapped,
      description: message || mapped.title
    };
  }

  if (log.type.includes("clip") || lowerMessage.includes("clip")) {
    return { badge: "Clips", title: message || "Sistema de clips atualizado", description: message };
  }

  if (log.type.includes("giveaway") || lowerMessage.includes("sorteio")) {
    return { badge: "Sorteio", title: message || "Sorteio atualizado", description: message };
  }

  if (log.type.includes("live") || lowerMessage.includes("twitch")) {
    return { badge: "Lives", title: message || "Sistema de lives atualizado", description: message };
  }

  if (log.type.includes("kick") || lowerMessage.includes("kick")) {
    return { badge: "Kick", title: message || "Kick Integration atualizado", description: message };
  }

  if (log.type.includes("ticket")) {
    return { badge: "Tickets", title: message || "Ticket atualizado", description: message };
  }

  if (log.type.includes("fivem.fac")) {
    return { badge: "FiveM", title: message || "FAC atualizado", description: message };
  }

  if (log.type.includes("mission_tools")) {
    return { badge: "Mission", title: message || "Mission Tools updated", description: message };
  }

  if (log.type.includes("image_anti_spam")) {
    return { badge: "Anti-Spam", title: message || "Spam de imagens bloqueado", description: message };
  }

  return {
    badge: "Painel",
    title: message || "Configuração atualizada",
    description: "Evento registrado no servidor."
  };
}

function userVisibleLogs(logs: LogEntry[]) {
  return uniqueLogs(logs.filter(isUserVisibleLog));
}

function prependUniqueLog(current: LogEntry[], log: LogEntry) {
  return uniqueLogs([log, ...current]).slice(0, 50);
}

function uniqueLogs(logs: LogEntry[]) {
  const seenIds = new Set<string>();
  const seenRecentSignatures = new Set<string>();
  const result: LogEntry[] = [];

  for (const log of logs) {
    if (seenIds.has(log.id)) {
      continue;
    }

    const signature = recentLogSignature(log);
    if (seenRecentSignatures.has(signature)) {
      continue;
    }

    seenIds.add(log.id);
    seenRecentSignatures.add(signature);
    result.push(log);
  }

  return result;
}

function recentLogSignature(log: LogEntry) {
  const createdAt = new Date(log.createdAt).getTime();
  const bucket = Number.isFinite(createdAt) ? Math.floor(createdAt / 10_000) : 0;

  return [
    log.botId ?? "",
    log.guildId,
    log.userId ?? "",
    log.type,
    log.message,
    bucket
  ].join("|");
}

function isUserVisibleLog(log: LogEntry) {
  return log.type !== "audit.dev_bot";
}

function isSiteLogEnabled(log: LogEntry, settings: GuildSettings | null) {
  return Boolean(
    settings?.siteLogsEnabled
    && settings.siteLogCategories.includes(logCategoryForType(log.type))
  );
}

function logCategoryForType(type: string): LogCategory {
  const normalized = type.trim().toLowerCase();

  if (normalized.startsWith("member.")) return "members";
  if (normalized.startsWith("message.")) return "messages";
  if (normalized.startsWith("roles.")) return "roles";
  if (
    normalized.startsWith("moderation.")
    || normalized.startsWith("security.")
    || normalized.startsWith("image_anti_spam.")
    || normalized.startsWith("self_bot_protection.")
  ) {
    return "moderation";
  }
  if (
    normalized.startsWith("dashboard.")
    || normalized.startsWith("audit.")
    || normalized.startsWith("access.")
  ) {
    return "dashboard";
  }

  return "automation";
}

function readResponseStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : null;
}

function readResponseMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

function visualPanelIdForView(view: ViewId) {
  const aliases: Partial<Record<ViewId, string>> = {
    "self-bot-protection": "safe-bot",
    "entry-leave": "welcome",
    "fivem-absence": "fivem-absence",
    "fivem": "fivem-general",
    "fivem-captcha": "fivem-captcha",
    "fivem-washing": "fivem-washing",
    "manual-registration": "manual-registration",
    "server-cloner": "server-cloner"
  };
  return aliases[view] ?? view;
}

function fivemHierarchyVisualPanelId(panelId: string) {
  const normalized = panelId
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 55);
  return `fivem-hierarchy-${normalized || "panel"}`;
}

function policePanelImageSlotsForView(view: ViewId) {
  void view;
  return null;
}

function dashboardViewFromPath(path: string): ViewId {
  if (path === "/dashboard/ponto-automatico" || /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/dashboard\/ponto-automatico(?:\/|$)/i.test(path)) {
    return "auto-activity-clock";
  }

  if (path === "/dashboard/relogio-de-ponto" || /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/dashboard\/relogio-de-ponto(?:\/|$)/i.test(path)) {
    return "police-time-clock";
  }

  if (path === "/dashboard/hierarquia" || /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/dashboard\/hierarquia(?:\/|$)/i.test(path)) {
    return "fivem-hierarchy";
  }

  if (path === "/dashboard/ztk-webhook" || /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/dashboard\/ztk-webhook(?:\/|$)/i.test(path)) {
    return "ztk-webhook";
  }

  if (path === "/dashboard/fivem-captcha" || /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/dashboard\/fivem-captcha(?:\/|$)/i.test(path)) {
    return "fivem-captcha";
  }

  return "overview";
}

function dashboardPathForView(slug: string, view: ViewId) {
  const base = `/${encodeURIComponent(slug)}/dashboard`;
  if (view === "auto-activity-clock") return `${base}/ponto-automatico`;
  if (view === "police-time-clock") return `${base}/relogio-de-ponto`;
  if (view === "fivem-hierarchy") return `${base}/hierarquia`;
  if (view === "ztk-webhook") return `${base}/ztk-webhook`;
  if (view === "fivem-captcha") return `${base}/fivem-captcha`;
  return base;
}

function isViewAllowed(view: ViewId, enabledModules: string[]) {
  if (view === "overview" || view === "plans" || view === "notifications" || view === "delete-channels") {
    return true;
  }

  if (view === "settings") {
    return enabledModules.some((moduleId) => settingsModuleIds.has(moduleId));
  }

  if (view === "entry-leave") {
    return enabledModules.includes("welcome") || enabledModules.includes("leave");
  }

  if (view === "auto-roles") {
    return enabledModules.includes("roles");
  }

  if (view === "server-cloner") {
    return enabledModules.includes("server-cloner") || enabledModules.includes("emoji-cloner");
  }

  if (view === "lives") {
    return liveModulesEnabled(enabledModules);
  }

  if (view === "moderation") {
    return enabledModules.includes("moderation");
  }

  if (view === "fivem") {
    return enabledModules.some((moduleId) => [
      "fivem",
      "fivem-factions",
      "fivem-corporations",
      "fivem-ammo",
      "fivem-finance"
    ].includes(moduleId));
  }

  if (view === "fivem-absence") {
    return enabledModules.includes("fivem-absences") || enabledModules.includes("fivem-fac");
  }

  if (view === "police-absence") {
    return hasReleasedModule(enabledModules, "police-absences");
  }

  if (view === "fivem-families") {
    return enabledModules.includes("fivem-orders") || enabledModules.includes("fivem-drugs") || enabledModules.includes("fivem-washing");
  }

  const requiredModule = viewModuleIds[view];
  return Boolean(requiredModule && hasReleasedModule(enabledModules, requiredModule));
}

function liveModulesEnabled(enabledModules: string[]) {
  return enabledModules.includes("live") || enabledModules.includes("kick-integration");
}

function buildSelectedBotPlanNotice(dashboard: CustomerPlansDashboard | null, bot: DashboardBot | null): SelectedBotPlanNotice | null {
  if (!dashboard) {
    return null;
  }

  const activeSubscriptions = dashboard.subscriptions.filter((subscription) => subscription.status === "active");
  const workspace = bot
    ? dashboard.workspaces.find((item) => item.botIds.includes(bot.id) || item.bots?.some((workspaceBot) => workspaceBot.id === bot.id))
    : dashboard.workspaces[0] ?? null;
  const subscription = workspace
    ? activeSubscriptions.find((item) => item.workspaceId === workspace.id) ?? null
    : activeSubscriptions[0] ?? null;

  if (!subscription) {
    return null;
  }

  const plan = dashboard.plans.find((item) => item.id === subscription.planId) ?? null;
  const renewal = renewalTextForSubscription(subscription, plan?.billingCycle ?? null);
  const botLimit = subscription.botLimit || plan?.botLimit || 0;
  const botCount = workspace?.botCount ?? workspace?.bots?.length ?? null;

  return {
    botName: bot?.name ?? null,
    botUsageText: botCount !== null && botLimit ? `${botCount}/${botLimit} cadastrados` : null,
    planName: subscription.plan?.name ?? plan?.name ?? subscription.planSlug,
    renewalTone: renewal.tone,
    renewalText: renewal.text,
    workspaceName: workspace?.name ?? subscription.workspace?.name ?? null
  };
}

function renewalTextForSubscription(subscription: CustomerPlansDashboard["subscriptions"][number], billingCycle: string | null) {
  const hostingDueAt = readNestedString(subscription.metadata, ["hosting", "nextDueAt"]);
  const dueAt = subscription.endsAt ?? hostingDueAt;

  if (!dueAt) {
    return {
      text: billingCycle === "lifetime" ? "Licença vitalícia ativa" : "Sem vencimento cadastrado",
      tone: "muted" as const
    };
  }

  const dueDate = new Date(dueAt);
  const dueMs = dueDate.getTime();
  if (!Number.isFinite(dueMs)) {
    return { text: "Vencimento pendente de atualização", tone: "warning" as const };
  }

  const days = Math.ceil((dueMs - Date.now()) / 86_400_000);
  const date = dueDate.toLocaleDateString("pt-BR");

  if (days < 0) {
    return { text: `Venceu em ${date}`, tone: "warning" as const };
  }

  if (days <= 7) {
    return { text: `Renovar até ${date}`, tone: "warning" as const };
  }

  return { text: `Próxima renovação em ${date}`, tone: "muted" as const };
}

function readNestedString(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function labelForView(view: ViewId) {
  return moduleCatalog.find((item) => item.view === view)?.title ?? view;
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function ensureDashboardGuilds(guilds: DashboardGuild[]) {
  if (guilds.length > 0) {
    return guilds;
  }

  return [
    {
      id: CONFIGURED_GUILD_ID,
      name: CONFIGURED_GUILD_NAME,
      iconUrl: null,
      owner: false,
      isAdmin: true,
      botEnabled: true,
      memberCount: 0,
      channelCount: 0
    }
  ];
}

function readStoredBotId() {
  try {
    return window.localStorage.getItem(LAST_BOT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSelectedBotId(botId: string | null) {
  try {
    if (botId) {
      window.localStorage.setItem(LAST_BOT_STORAGE_KEY, botId);
    } else {
      window.localStorage.removeItem(LAST_BOT_STORAGE_KEY);
    }
  } catch {
    // Local storage is only a convenience for restoring the last bot.
  }
}

function mergeDashboardGuilds(guilds: DashboardMeGuild[], fallbackGuilds: DashboardGuild[]) {
  const fallbackById = new Map(fallbackGuilds.map((guild) => [guild.id, guild]));

  return guilds.map((guild) => {
    const fallback = fallbackById.get(guild.id);

    return {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconUrl,
      owner: guild.owner,
      isAdmin: guild.owner || guild.permissions === "ADMINISTRATOR",
      botEnabled: guild.botInGuild,
      memberCount: fallback?.memberCount ?? 0,
      channelCount: fallback?.channelCount ?? 0
    };
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatGoalCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}
