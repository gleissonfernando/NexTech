import { useCallback, useEffect, useMemo, useState, memo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AtSign,
  Bell,
  Bot,
  Boxes,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Film,
  Gift,
  Globe2,
  Hash,
  ImageIcon,
  ListChecks,
  Loader2,
  LockKeyhole,
  Mic2,
  PlayCircle,
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
  TicketIcon,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  XCircle
} from "lucide-react";
import { DashboardLayout } from "../components/layout/dashboard-layout";
import type { ViewId } from "../components/layout/sidebar";
import { ClipsPanel } from "../components/clips/ClipsPanel";
import { FacAbsencePanel } from "../components/fivem/FacAbsencePanel";
import { GiveawayPanel } from "../components/giveaway/GiveawayPanel";
import { LogsSettingsPanel } from "../components/LogsSettingsPanel";
import { MissionToolsPanel } from "../components/mission-tools/MissionToolsPanel";
import { SiteAccessPanel } from "../components/moderation/SiteAccessPanel";
import { PanelImageSettings } from "../components/panels/PanelImageSettings";
import { VoiceRecorderPanel } from "../components/moderation/VoiceRecorderPanel";
import { AccountAgeSecurityPanel } from "../components/security/AccountAgeSecurityPanel";
import { SelfBotProtectionPanel } from "../components/security/SelfBotProtectionPanel";
import { AutoRolesPanel } from "../components/roles/AutoRolesPanel";
import { KickIntegrationPanel } from "../components/social/KickIntegrationPanel";
import { LiveNotificationsPanel } from "../components/social/LiveNotificationsPanel";
import { MemberSocialNetworkPanel } from "../components/social/MemberSocialNetworkPanel";
import { XMonitorPanel } from "../components/social/XMonitorPanel";
import { WelcomePanel } from "../components/welcome/WelcomePanel";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { createDashboardSocket } from "../lib/socket";
import {
  applicationEmojiDownloadUrl,
  cloneEmojiToGuild,
  cloneSelectedEmojiCloneBotToken,
  emojiLibraryDownloadUrl,
  fetchEmojiCloneBotTokenEmojis,
  getAdvancedModuleConfig,
  getApplicationEmojiSettings,
  getApplicationEmojis,
  getClipsConfig,
  getDashboardBySlug,
  getDashboardMe,
  getBotGuildConfig,
  getFivemModules,
  getGuildLiveOptions,
  getGuildSettings,
  getEmojiLibrary,
  getKickNotifications,
  getLives,
  getLogs,
  getSelfBotProtection,
  getSocialNotifications,
  getTickets,
  getXMonitor,
  patchGuildSettings,
  publishRulesPanel,
  refreshApplicationEmojis,
  removeAllApplicationEmojis,
  resendEmojiFromLibrary,
  saveAdvancedModuleConfig,
  syncApplicationEmojis,
  updateSelectedDashboardGuild,
  updateApplicationEmojiSettings,
  updateBotGuildConfig,
  validateEmojiCloneBotToken
} from "../lib/api";
import type {
  ApplicationEmojiItem,
  ApplicationEmojiPage,
  ApplicationEmojiSettings,
  AuthResponse,
  BotStatus,
  ClipSent,
  ClipsConfig,
  DashboardBot,
  DashboardGuild,
  DashboardMeGuild,
  DashboardMeResponse,
  FivemModuleDefinition,
  GuildChannelOption,
  GuildSettings,
  EmojiCloneRemoteEmoji,
  EmojiLibraryItem,
  KickNotification,
  LiveEvent,
  LogEntry,
  LogCategory,
  SelfBotProtectionSettings,
  SocialNotification,
  Ticket,
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
    title: "Sistema de Lives",
    description: "Detecta transmissoes na Twitch e envia alertas no Discord.",
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
    description: "Publica um painel de regras com botao para liberar cargo aos membros.",
    icon: ScrollText,
    view: "rules"
  },
  {
    id: "mission-tools",
    title: "Mission Tools",
    description: "Libera o Control Center com Mission, Clean, Voice, Rich Presence e Username Checker.",
    icon: ListChecks,
    view: "mission-tools"
  },
  {
    id: "voice-recorder",
    title: "Voice Recorder",
    description: "Grava canais de voz, salva arquivos MP3 e organiza historico na dashboard.",
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
    description: "Centraliza protecao anti-spam, punicoes e logs do SelfBot.",
    icon: ShieldCheck,
    view: "self-bot-protection"
  },
  {
    id: "account-age-security",
    title: "Seguranca de Entrada",
    description: "Remove contas Discord mais novas que o minimo permitido.",
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
    description: "Prepara backup manual, automatico, exportacao e restauracao seletiva.",
    icon: Server,
    view: "server-backup"
  },
  {
    id: "vanity-url-protection",
    title: "Protecao da URL Personalizada",
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
    id: "auto-unmute",
    title: "Auto Desmutar",
    description: "Desmuta automaticamente membros no canal configurado.",
    icon: Mic2,
    view: "auto-unmute"
  },
  {
    id: "temporary-voice",
    title: "Chamadas Temporarias",
    description: "Cria salas temporárias com dono, limite, bloqueio e exclusão automática.",
    icon: Users,
    view: "temporary-voice"
  },
  {
    id: "tag-verification",
    title: "Verificacao de Tag",
    description: "Entrega ou remove cargo conforme tag personalizada do Discord.",
    icon: Hash,
    view: "tag-verification"
  },
  {
    id: "bio-url-verification",
    title: "Verificacao de URL na Bio",
    description: "Entrega ou remove cargo conforme URL permitida na bio do membro.",
    icon: AtSign,
    view: "bio-url-verification"
  },
  {
    id: "first-lady",
    title: "Sistema Primeira Dama",
    description: "Gerencia damas, limites por cargo, historico e relacionamentos.",
    icon: Users,
    view: "first-lady"
  },
  {
    id: "fivem-absences",
    title: "Ausencias FiveM",
    description: "Gerencia solicitacoes de ausencia para faccoes, corporacoes e organizacoes.",
    icon: Building2,
    view: "fivem"
  },
  {
    id: "verification",
    title: "Usuarios",
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
    title: "Saida",
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
  "voice-recorder": "voice-recorder",
  "self-bot-protection": "safe-bot",
  security: "account-age-security",
  "anti-ban": "anti-ban",
  "suspicious-servers": "suspicious-servers",
  "global-blacklist": "global-blacklist",
  "advanced-permissions": "advanced-permissions",
  "invite-cleanup": "invite-cleanup",
  "server-backup": "server-backup",
  "vanity-url-protection": "vanity-url-protection",
  "hide-empty-voice": "hide-empty-voice",
  "auto-unmute": "auto-unmute",
  "temporary-voice": "temporary-voice",
  "tag-verification": "tag-verification",
  "bio-url-verification": "bio-url-verification",
  "first-lady": "first-lady",
  moderation: "moderation",
  rules: "rules",
  "application-emojis": "emoji-cloner"
};

const settingsModuleIds = new Set(["tickets", "avisos", "network", "server-generator"]);

export function Dashboard({ auth, initialBotSlug = null, onLogout }: DashboardProps) {
  const [dashboardProfile, setDashboardProfile] = useState<DashboardMeResponse | null>(null);
  const [dashboardProfileLoading, setDashboardProfileLoading] = useState(true);
  const [dashboardRouteError, setDashboardRouteError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    auth.user.selectedGuildId ?? auth.guilds[0]?.id ?? CONFIGURED_GUILD_ID
  );
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lives, setLives] = useState<LiveEvent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [clipsRefreshSignal, setClipsRefreshSignal] = useState(0);
  const [botStatus, setBotStatus] = useState<BotStatus>(initialBotStatus);
  const [savingKey, setSavingKey] = useState<BooleanSettingKey | null>(null);
  const [overviewDetails, setOverviewDetails] = useState<OverviewDetails>(emptyOverviewDetails);
  const [fivemModules, setFivemModules] = useState<FivemModuleDefinition[]>([]);

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
  const enabledModules = selectedBot?.enabledModules ?? emptyEnabledModules;
  const enabledModulesKey = enabledModules.join("|");
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
    selectedBot ? selectedBot.enabledModules.includes(moduleId) : canManageDashboard
  );
  const availableModules = useMemo(
    () => moduleCatalog.filter((module) => enabledModules.includes(module.id)),
    [enabledModulesKey]
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
        setDashboardRouteError("Nenhuma dashboard liberada para este usuário.");
        return;
      }

      if (!requestedSlug) {
        window.history.replaceState({}, "", `/${encodeURIComponent(targetBot.slug)}/dashboard`);
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

        if (readResponseStatus(error) === 401) {
          window.location.replace("/login");
          return;
        }

        setDashboardRouteError(readResponseMessage(error) ?? "Acesso negado. Você não tem permissão para acessar esta dashboard.");
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
    if (!isViewAllowed(activeView, enabledModules)) {
      setActiveView("overview");
    }
  }, [activeView, enabledModulesKey]);

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

    let mounted = true;

    setSettingsLoading(true);
    setSettings(null);

    Promise.allSettled([
      getGuildSettings(selectedGuildId, activeBotId),
      getLogs(selectedGuildId, activeBotId),
      getLives(selectedGuildId, activeBotId),
      getTickets(selectedGuildId, activeBotId),
      enabledModules.includes("live") ? getSocialNotifications(selectedGuildId, activeBotId) : Promise.resolve(null),
      liveModulesEnabled(enabledModules) ? getKickNotifications(selectedGuildId, activeBotId) : Promise.resolve(null),
      enabledModules.includes("clips") ? getClipsConfig(selectedGuildId, activeBotId) : Promise.resolve(null),
      enabledModules.includes("x-monitor") ? getXMonitor(selectedGuildId, activeBotId) : Promise.resolve(null),
      enabledModules.includes("safe-bot") && activeBotId
        ? getSelfBotProtection(selectedGuildId, activeBotId)
        : Promise.resolve(null)
    ])
      .then(([settingsResult, logsResult, livesResult, ticketsResult, liveResult, kickResult, clipsResult, xResult, selfBotResult]) => {
        if (!mounted) return;

        setSettings(settingsResult.status === "fulfilled" ? settingsResult.value : null);
        setLogs(logsResult.status === "fulfilled" ? userVisibleLogs(logsResult.value) : []);
        setLives(livesResult.status === "fulfilled" ? livesResult.value : []);
        setTickets(ticketsResult.status === "fulfilled" ? ticketsResult.value : []);
        setOverviewDetails({
          selfBotProtectionSettings: selfBotResult.status === "fulfilled" && selfBotResult.value
            ? selfBotResult.value.settings
            : null,
          kickClipsConfig: null,
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
  }, [activeBotId, dashboardProfileLoading, dashboardRouteError, enabledModulesKey, panelBots.length, selectedGuildId]);

  useEffect(() => {
    const socket = createDashboardSocket();

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
        void getLogs(selectedGuildId, activeBotId)
          .then((nextLogs) => setLogs(userVisibleLogs(nextLogs)))
          .catch(() => undefined);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [
    activeBotId,
    selectedGuildId,
    settings?.siteLogsEnabled,
    settings?.siteLogCategories.join("|")
  ]);

  async function handleLogsSettingsChange(nextSettings: GuildSettings) {
    setSettings(nextSettings);

    if (!selectedGuildId) {
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

  function handleSelectBot(botId: string) {
    const nextBot = panelBots.find((bot) => bot.id === botId);

    if (!nextBot) {
      return;
    }

    const nextGuildId = nextBot.mainGuildId || nextBot.guildIds[0] || null;

    setSelectedBotId(nextBot.id);
    storeSelectedBotId(nextBot.id);
    window.history.replaceState({}, "", `/${encodeURIComponent(nextBot.slug)}/dashboard`);

    if (nextGuildId) {
      setSelectedGuildId(nextGuildId);
      setDashboardProfile((current) => (current ? { ...current, selectedGuildId: nextGuildId } : current));
      void updateSelectedDashboardGuild(nextGuildId, nextBot.id).catch(() => undefined);
    }
  }

  if (dashboardRouteError) {
    return <DashboardRouteError message={dashboardRouteError} />;
  }

  return (
    <DashboardLayout
      activeView={activeView}
      bots={panelBots}
      dashboardUser={dashboardProfile?.user}
      enabledModules={enabledModules}
      guilds={scopedDashboardGuilds}
      onChangeView={setActiveView}
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
        <UserDashboardHeader
          bot={selectedBot}
          selectedGuild={selectedGuild}
          status={displayedBotStatus}
        />

        {activeView === "overview" ? (
          <OverviewView
            availableModules={availableModules}
            bot={selectedBot}
            details={overviewDetails}
            guild={selectedGuild}
            logs={logs}
            onConfigure={setActiveView}
            settings={settings}
            status={displayedBotStatus}
          />
        ) : null}

        {activeView === "lives" ? (
          <LiveView
            botId={activeBotId}
            canManageKick={canManageModule(selectedBot, "live", canManageDashboard) || canManageModule(selectedBot, "kick-integration", canManageDashboard)}
            canManageTwitch={canManageModule(selectedBot, "live", canManageDashboard)}
            guild={selectedGuild}
            lives={lives}
            showKick={liveModulesEnabled(enabledModules)}
            showTwitch={enabledModules.includes("live")}
          />
        ) : null}
        {activeView === "clips" ? (
          <ClipsPanel botId={activeBotId} canManage={canManageModule(selectedBot, "clips", canManageDashboard)} guild={selectedGuild} refreshSignal={clipsRefreshSignal} />
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
        {advancedSecurityModuleViews.includes(activeView) ? (
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
        {activeView === "fivem" ? (
          <FivemView
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "fivem-absences", canManageDashboard) || canManageModule(selectedBot, "fivem-fac", canManageDashboard)}
            enabledModules={enabledModules}
            fivemModules={fivemModules}
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
  "anti-ban",
  "suspicious-servers",
  "global-blacklist",
  "advanced-permissions",
  "invite-cleanup",
  "server-backup",
  "vanity-url-protection",
  "hide-empty-voice",
  "auto-unmute",
  "temporary-voice",
  "tag-verification",
  "bio-url-verification",
  "first-lady"
];

const advancedSecurityModuleDetails: Record<string, {
  title: string;
  description: string;
  icon: typeof Bot;
  items: string[];
}> = {
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
  "auto-unmute": {
    title: "Auto Desmutar",
    description: "Módulo isolado para remover mute manual ao entrar no canal configurado.",
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
  }
};

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
  const [roles, setRoles] = useState<Array<{ id: string; name: string; managed?: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild || !details) {
        setConfig({});
        setRoles([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);

      const [moduleResult, optionsResult] = await Promise.all([
        getAdvancedModuleConfig(botId, guild.id, moduleId),
        getGuildLiveOptions(guild.id, botId).catch(() => ({ roles: [] }))
      ]);

      if (!mounted) return;

      setConfig(defaultAdvancedModuleConfig(moduleId, moduleResult.config));
      setRoles(optionsResult.roles ?? []);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setConfig(defaultAdvancedModuleConfig(moduleId, {}));
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
      setMessage("Módulo salvo.");
    } catch (error) {
      setMessage(readResponseMessage(error) ?? "Não foi possível salvar este módulo.");
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
    const nextConfig = {
      ...config,
      enabled
    };

    setConfig(nextConfig);
    void saveConfig(nextConfig);
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

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-lg border border-purple-400/25 bg-purple-500/10 px-4 py-3 text-sm font-semibold text-white">
          {message}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-purple-500/25 bg-purple-500/10 text-purple-200">
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
            description="Ativa ou pausa este modulo para este bot neste servidor."
            disabled={disabled}
            icon={Icon}
            onChange={updateEnabled}
            title="Status do sistema"
          />
          <AdvancedModuleFields
            config={config}
            disabled={disabled}
            moduleId={moduleId}
            onChange={patchConfig}
            roles={roles.filter((role) => !role.managed)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={disabled} onClick={() => void saveConfig()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar
            </Button>
            <Badge variant="muted">Escopo: {guild.name}</Badge>
          </div>
          <div className="hidden">
            {details.items.map((item) => (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4" key={item}>
                <p className="text-sm font-semibold text-white">{item}</p>
                <p className="mt-1 text-xs font-medium text-zinc-500">Configuração dedicada deste módulo.</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.08] p-4 text-sm font-medium text-zinc-200">
            Este menu só aparece quando o módulo <span className="font-mono text-purple-200">{moduleId}</span> está liberado para o bot na dashboard DEV.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AdvancedModuleFields({
  config,
  disabled,
  moduleId,
  onChange,
  roles
}: {
  config: Record<string, unknown>;
  disabled: boolean;
  moduleId: string;
  onChange: (patch: Record<string, unknown>) => void;
  roles: Array<{ id: string; name: string }>;
}) {
  const roleOptions = roles.map((role) => ({ label: role.name, value: role.id }));

  if (moduleId === "tag-verification") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <AdvancedTextField disabled={disabled} label="Tag exigida" onChange={(value) => onChange({ requiredTag: value })} placeholder="Ex: VILAO" value={stringConfig(config.requiredTag)} />
        <AdvancedSelectField disabled={disabled} label="Cargo entregue" onChange={(value) => onChange({ roleId: value || null })} options={roleOptions} placeholder="Selecione um cargo" value={stringConfig(config.roleId)} />
        <AdvancedNumberField disabled={disabled} label="Tempo de atualização (minutos)" min={1} onChange={(value) => onChange({ intervalMinutes: value })} value={numberConfig(config.intervalMinutes, 10)} />
        <AdvancedToggleField checked={config.removeOnMismatch !== false} disabled={disabled} label="Remoção automática" onChange={(checked) => onChange({ removeOnMismatch: checked })} />
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
      <input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-purple-500/60" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </label>
  );
}

function AdvancedNumberField({ disabled, label, min, onChange, value }: { disabled: boolean; label: string; min: number; onChange: (value: number) => void; value: number }) {
  return (
    <label className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
      <span className="font-semibold text-white">{label}</span>
      <input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-purple-500/60" disabled={disabled} min={min} onChange={(event) => onChange(Number(event.target.value) || min)} type="number" value={value} />
    </label>
  );
}

function AdvancedSelectField({ disabled, label, onChange, options, placeholder, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; placeholder: string; value: string }) {
  return (
    <label className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
      <span className="font-semibold text-white">{label}</span>
      <select className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-purple-500/60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
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

function defaultAdvancedModuleConfig(moduleId: string, config: Record<string, unknown>) {
  if (moduleId === "tag-verification") {
    return { enabled: false, intervalMinutes: 10, removeOnMismatch: true, requiredTag: "", roleId: null, ...config };
  }

  if (moduleId === "bio-url-verification") {
    return { allowedDomains: "", enabled: false, intervalMinutes: 15, removeOnMismatch: true, roleId: null, ...config };
  }

  return { autoAction: false, enabled: false, intervalMinutes: 10, primaryConfig: "", roleId: null, ...config };
}

function stringConfig(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberConfig(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function FivemView({
  botId,
  canManage,
  enabledModules,
  fivemModules,
  guild
}: {
  botId?: string | null;
  canManage: boolean;
  enabledModules: string[];
  fivemModules: FivemModuleDefinition[];
  guild: DashboardGuild | null;
}) {
  const modules = fivemUserModules(enabledModules, fivemModules);

  if (!modules.length) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Nenhum módulo FiveM foi liberado para este usuário.
        </CardContent>
      </Card>
    );
  }
  const absencesEnabled = enabledModules.includes("fivem-absences") || enabledModules.includes("fivem-fac");

  return (
    <div className="space-y-5">
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
      {absencesEnabled ? <FacAbsencePanel botId={botId} canManage={canManage} guild={guild} /> : null}
    </div>
  );
}

function fivemUserModules(enabledModules: string[], fivemModules: FivemModuleDefinition[]) {
  const fallbackCatalog: FivemModuleDefinition[] = [
    { builtIn: true, description: "Controle de membros, cargos e operacao das faccoes.", id: "fivem-factions", permissions: "Admin FiveM", title: "Faccoes" },
    { builtIn: true, description: "Gestao operacional de corporacoes e equipes.", id: "fivem-corporations", permissions: "Admin FiveM", title: "Corporacoes" },
    { builtIn: true, description: "Solicitacoes e aprovacao de ausencias RP.", id: "fivem-absences", permissions: "Admin FiveM", title: "Ausencias" },
    { builtIn: true, description: "Pedidos, entregas e acompanhamento de encomendas.", id: "fivem-orders", permissions: "Admin FiveM", title: "Encomendas" },
    { builtIn: true, description: "Controle de municoes, estoque e distribuicao.", id: "fivem-ammo", permissions: "Admin FiveM", title: "Municoes" },
    { builtIn: true, description: "Fluxo financeiro, caixa e lancamentos RP.", id: "fivem-finance", permissions: "Admin FiveM", title: "Financeiro" }
  ];
  const catalog = fivemModules.length ? fivemModules : fallbackCatalog;
  const enabled = new Set(enabledModules.map((moduleId) => moduleId === "fivem-fac" ? "fivem-absences" : moduleId));

  return catalog
    .filter((module) => enabled.has(module.id))
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
    "fivem-orders": ListChecks
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
      <Card className="w-full max-w-md border-red-500/20 bg-zinc-950/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-red-300" />
            Dashboard indisponivel
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => window.history.back()}>
            Voltar
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
      "fivem",
      "fivem-factions",
      "fivem-corporations",
      "fivem-absences",
      "fivem-orders",
      "fivem-ammo",
      "fivem-finance",
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

  return released.has(moduleId);
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
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <Card className="border-purple-500/20 bg-[#0b0b0b]">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              className="h-12 w-12 rounded-lg border border-purple-500/45"
              fallback={bot?.name ?? "Bot"}
              src={bot?.avatarUrl ?? null}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-purple-300">Bot selecionado</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold text-white">{bot?.name ?? "Nenhum bot selecionado"}</h1>
                <Badge variant={status.online ? "success" : "muted"}>
                  {status.online ? "Online" : "Offline"}
                </Badge>
                {bot ? (
                  <Badge variant="muted">{bot.guildIds.length} servidor{bot.guildIds.length === 1 ? "" : "es"}</Badge>
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
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function OverviewView({
  availableModules,
  bot,
  details,
  guild,
  logs,
  onConfigure,
  settings,
  status
}: {
  availableModules: ModuleDefinition[];
  bot: DashboardBot | null;
  details: OverviewDetails;
  guild: DashboardGuild | null;
  logs: LogEntry[];
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
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={Bot} label="Bot" value={status.online ? "Online" : "Offline"} />
        <MetricCard icon={Server} label="Servidor" value={guild?.name ?? "Nenhum"} />
        <MetricCard icon={Users} label="Membros" value={formatNumber(guild?.memberCount ?? bot?.mainGuildMemberCount ?? 0)} />
        <MetricCard icon={Hash} label="Canais" value={formatNumber(guild?.channelCount ?? bot?.mainGuildChannelCount ?? 0)} />
        <MetricCard icon={CheckCircle2} label="Módulos ativos" value={`${activeModules}/${availableModules.length}`} />
        <MetricCard icon={CalendarClock} label="Atualizado" value={formatDate(status.updatedAt)} />
      </section>

      <IsolationStatusPanel
        availableModuleCount={availableModules.length}
        bot={bot}
        details={details}
        status={status}
        totalModuleCount={moduleCatalog.length}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Módulos disponíveis</h2>
          <p className="text-sm text-zinc-500">Apenas os módulos liberados para este bot neste servidor aparecem aqui.</p>
        </div>

        {moduleSummaries.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {moduleSummaries.map((module) => (
              <ModuleCard
                description={module.description}
                icon={module.icon}
                key={module.id}
                onConfigure={() => onConfigure(module.view)}
                state={module.state}
                title={module.title}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={Settings} title="Nenhum módulo liberado para este bot" />
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Logs recentes</CardTitle>
          <CardDescription>Eventos importantes traduzidos para o usuário.</CardDescription>
        </CardHeader>
        <CardContent>
          <FriendlyLogList compact logs={logs.slice(0, 5)} />
        </CardContent>
      </Card>
    </div>
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-purple-500/25 bg-purple-500/10 text-purple-200">
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
  guild,
  lives,
  showKick,
  showTwitch
}: {
  botId?: string | null;
  canManageKick: boolean;
  canManageTwitch: boolean;
  guild: DashboardGuild | null;
  lives: LiveEvent[];
  showKick: boolean;
  showTwitch: boolean;
}) {
  return (
    <div className="space-y-5">
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
        <div className="rounded-lg border border-purple-400/25 bg-purple-500/10 px-4 py-3 text-sm font-semibold text-white">
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
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-purple-500"
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
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-purple-500"
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
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-purple-500"
                disabled={!canManage}
                maxLength={120}
                onChange={(event) => setDraft((current) => ({ ...current, rulesTitle: event.target.value }))}
                value={draft.rulesTitle}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-100">Cor</span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-purple-500"
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
              className="min-h-44 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-purple-500"
              disabled={!canManage}
              maxLength={1800}
              onChange={(event) => setDraft((current) => ({ ...current, rulesMessage: event.target.value }))}
              placeholder="Uma regra por linha"
              value={draft.rulesMessage}
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-zinc-100">Texto do botao</span>
            <input
              className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none transition focus:border-purple-500"
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

  if (!blocks.length) {
    return <EmptyState icon={Settings} title="Nenhuma configuração simples liberada para este bot" />;
  }

  return <div className="space-y-5">{blocks}</div>;
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
      setMessage(`Concluido: ${data.job?.sent ?? 0} enviados, ${data.job?.updated ?? 0} atualizados, ${data.job?.skipped ?? 0} ignorados.`);
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
              <Button asChild disabled={!items.length} size="sm" variant="outline">
                <a href={applicationEmojiDownloadUrl(botId, sourceGuildId || null)} rel="noreferrer">
                  Exportar ZIP
                </a>
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
                <p className="text-xs text-zinc-500">Sincronizacao Automatica</p>
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
              <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-4">
              <span>Enviados: {progress.sent}</span>
              <span>Atualizados: {progress.updated}</span>
              <span>Ignorados: {progress.skipped}</span>
              <span>Erros: {progress.failed}</span>
            </div>
            {message ? <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{message}</p> : null}
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
          <h2 className="text-lg font-semibold text-white">Entrada e saida</h2>
          <p className="mt-1 text-sm text-zinc-500">Configure as mensagens automaticas dos membros em um so lugar.</p>
        </div>

        <div className="inline-flex w-full rounded-lg border border-zinc-800 bg-zinc-950 p-1 sm:w-auto">
          {availableModes.map((mode) => {
            const active = activeMode === mode;
            const Icon = mode === "welcome" ? UserPlus : UserMinus;
            const label = mode === "welcome" ? "Entrada" : "Saida";

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
        panelLabel={activeMode === "welcome" ? "Entrada" : "Saida"}
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

    getBotGuildConfig(botId, form.destinationGuildId)
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
      setMessage("Informe um ID valido para o servidor de destino.");
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
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-purple-400"
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Itens que serao clonados</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {serverClonePartOptions.map((part) => {
                  const active = form.cloneParts.includes(part.id);

                  return (
                    <button
                      className={[
                        "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                        active ? "border-purple-400/40 bg-purple-500/15 text-purple-100" : "border-zinc-800 bg-black/30 text-zinc-400 hover:text-white"
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
                className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-purple-400"
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
              <div className="mt-4 rounded-lg border border-purple-500/25 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-100">
                {message}
              </div>
            ) : null}
            <Button
              className="mt-4 w-full gap-2 bg-purple-600 text-white hover:bg-purple-500"
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
        className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-semibold text-white outline-none transition focus:border-purple-400"
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
        className="mt-2 min-h-[92px] w-full resize-y rounded-lg border border-zinc-800 bg-black/35 px-3 py-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-purple-400"
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
      ? { label: "Valido", tone: "success" as const }
      : selectedBot.status === "invalid_token"
        ? { label: "Invalido", tone: "danger" as const }
        : { label: "Validando", tone: "warning" as const }
    : { label: "Não configurado", tone: "muted" as const };
  const credentialStatus = credentialTestMode === "real"
    ? liveCredentialStatus
    : credentialTestMode === "valid"
      ? { label: "Falso valido", tone: "success" as const }
      : credentialTestMode === "invalid"
        ? { label: "Falso invalido", tone: "danger" as const }
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
      setCloneMessage("Selecione uma imagem/emoji e defina um nome valido.");
      return;
    }

    setCloneProgress(15);
    setCloneStatus("running");
    setCloneMessage("Validando imagem e permissoes do bot...");

    try {
      const emoji = await cloneEmojiToGuild(destinationGuildId, { image, name, sourceLabel }, botId);
      setCloneProgress(100);
      setCloneStatus("success");
      setCloneMessage(emoji.duplicate ? `Emoji ${emoji.name} ja existia no servidor. Biblioteca atualizada.` : `Emoji ${emoji.name} clonado e salvo na Biblioteca.`);
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
    setCloneMessage(`Concluido. ${success}/${pastedEmojiAssets.length} emoji(s) clonados${failed ? `, ${failed} falharam` : ""}.`);
    pushCloneLog(`[INFO] Processo concluido: ${success}/${pastedEmojiAssets.length} emoji(s) clonados`);
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
      setCloneMessage(emoji.duplicate ? `Emoji ${emoji.name} ja existia no destino.` : `Emoji ${emoji.name} reenviado para ${selectedDestination?.name ?? destinationGuildId}.`);
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
      const message = readDetailedRequestMessage(requestError, "Token invalido.");
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
      setCloneMessage(`Processo concluido. ${result.success}/${result.total} emojis clonados.`);
      pushCloneLog(`[INFO] Processo concluido: ${result.success}/${result.total} emojis clonados`);
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
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-purple-200">
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
              <StatusPill icon={ShieldCheck} label="Modulo" value={settings?.emojiCloneEnabled ? "Ativo" : "Pausado"} />
              <StatusPill icon={RefreshCw} label="Atualizacao" value="Automatica" />
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
                  <option value="valid">Falso valido</option>
                  <option value="invalid">Falso invalido</option>
                </select>
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
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
                      className={["flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition", emoji.selected ? "border-purple-500/50 bg-purple-500/10" : "border-zinc-800 bg-zinc-950"].join(" ")}
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
              {cloneStatus === "running" ? <Loader2 className="h-5 w-5 animate-spin text-purple-300" /> : cloneStatus === "success" ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : cloneStatus === "error" ? <XCircle className="h-5 w-5 text-red-300" /> : <Clock3 className="h-5 w-5 text-zinc-500" />}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
              <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${cloneProgress}%` }} />
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
              <p className="text-xs text-zinc-500">{destinationGuilds.length} servidores disponiveis para receber emojis.</p>
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
                className={["flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition", destinationGuildId === item.id ? "border-purple-500/50 bg-purple-500/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"].join(" ")}
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
                <Button asChild disabled={!library.length} size="sm" variant="outline">
                  <a href={emojiLibraryDownloadUrl(botId, destinationGuildId || guild?.id)} rel="noreferrer">
                    Baixar Todos
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
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
              <p className="text-xs text-zinc-500">Ultimas clonagens feitas por este painel nesta sessao.</p>
            </div>
            <div className="flex gap-2">
              <input
                className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setHistoryFilter(event.target.value)}
                placeholder="Filtrar historico"
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
            <span className="text-sm font-medium text-zinc-300">Prefixo padrao</span>
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
            <span className="text-sm font-medium text-zinc-300">Limite por execucao</span>
            <input
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
              disabled={disabled}
              max={100}
              min={1}
              onBlur={(event) => void savePatch({ emojiCloneMaxPerRun: Number(event.target.value) || 25 })}
              type="number"
              defaultValue={settings?.emojiCloneMaxPerRun ?? 25}
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
                    checked ? "border-purple-500/40 bg-purple-500/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
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
    label: "Canal de Saida",
    description: "Onde o bot envia a mensagem de saida."
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
          <h2 className="text-lg font-semibold text-white">Notificacoes</h2>
          <p className="mt-1 text-sm text-zinc-500">Configure os canais do bot selecionado. Cada alteracao salva automaticamente no banco.</p>
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
            <Card className="border-purple-500/10 bg-zinc-950/70" key={field.key}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white">{field.label}</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{field.description}</p>
                  </div>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin text-purple-300" /> : null}
                  {saved ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}
                </div>

                {loading || channelsLoading ? (
                  <div className="h-11 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/70" />
                ) : (
                  <select
                    className="h-11 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-purple-500/50 disabled:cursor-not-allowed disabled:opacity-60"
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
      configuredText: "Disponivel"
    };
  }

  if (moduleId === "voice-recorder") {
    return {
      active: true,
      configured: true,
      configuredText: "Disponivel"
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
    configuredText: "Disponivel"
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
    "x_monitor.api_error": { badge: "X Monitor", title: "X Monitor precisa de atencao" },
    "live:started": { badge: "Lives", title: "Live iniciada" },
    "live:ended": { badge: "Lives", title: "Live encerrada" },
    "ticket.created": { badge: "Tickets", title: "Ticket criado" },
    "audit.lives": { badge: "Lives", title: "Canal de lives atualizado" },
    "audit.kick": { badge: "Kick", title: "Kick Integration atualizado" },
    "social.kick.created": { badge: "Kick", title: "Canal Kick adicionado" },
    "social.kick.updated": { badge: "Kick", title: "Canal Kick atualizado" },
    "social.kick.deleted": { badge: "Kick", title: "Canal Kick removido" },
    "social.kick.tested": { badge: "Kick", title: "Teste Kick enviado" },
    "audit.dev_bot": { badge: "Sistema", title: "Configuracao do bot atualizada" },
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
    "security.account_age.blocked": { badge: "Seguranca", title: "Entrada bloqueada por idade da conta" },
    "security.self_bot.role_synced": { badge: "Self Bot", title: "Cargo Self Bot sincronizado" },
    "security.self_bot.role_assigned": { badge: "Self Bot", title: "Cargo Self Bot aplicado" },
    "security.self_bot.assignment_failed": { badge: "Self Bot", title: "Self Bot não conseguiu aplicar cargo" },
    "fivem.fac.settings_updated": { badge: "FiveM", title: "FAC atualizado" },
    "fivem.fac.request_created": { badge: "FiveM", title: "Solicitacao de ausencia criada" },
    "fivem.fac.request_approved": { badge: "FiveM", title: "Solicitacao de ausencia aprovada" },
    "fivem.fac.request_rejected": { badge: "FiveM", title: "Solicitacao de ausencia reprovada" },
    "fivem.fac.absence_started": { badge: "FiveM", title: "Ausencia iniciada" },
    "fivem.fac.absence_finished": { badge: "FiveM", title: "Ausencia finalizada" },
    "mission_tools.settings_updated": { badge: "Mission", title: "Mission Tools atualizado" },
    "mission_tools.panel_publish_requested": { badge: "Mission", title: "Publicacao do Control Center solicitada" }
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
    return { badge: "Mission", title: message || "Mission Tools atualizado", description: message };
  }

  if (log.type.includes("image_anti_spam")) {
    return { badge: "Anti-Spam", title: message || "Spam de imagens bloqueado", description: message };
  }

  return {
    badge: "Painel",
    title: message || "Configuracao atualizada",
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

function isViewAllowed(view: ViewId, enabledModules: string[]) {
  if (view === "overview" || view === "notifications") {
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
    return enabledModules.some((moduleId) => moduleId === "fivem" || moduleId.startsWith("fivem-"));
  }

  const requiredModule = viewModuleIds[view];
  return Boolean(requiredModule && enabledModules.includes(requiredModule));
}

function liveModulesEnabled(enabledModules: string[]) {
  return enabledModules.includes("live") || enabledModules.includes("kick-integration");
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}
