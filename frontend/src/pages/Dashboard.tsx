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
  cloneEmojiToGuild,
  getClipsConfig,
  getDashboardBySlug,
  getDashboardMe,
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
  resendEmojiFromLibrary,
  updateSelectedDashboardGuild,
  validateFakeEmojiCloneToken
} from "../lib/api";
import type {
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
    title: "Moderacao",
    description: "Centraliza ajustes basicos de seguranca e moderacao do servidor.",
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
    description: "Clona emojis de servidores acessiveis pelo bot com permissoes por cargo e bot autorizado.",
    icon: SmilePlus,
    view: "settings"
  },
  {
    id: "server-cloner",
    title: "Clonagem de Servidor",
    description: "Clona somente a estrutura autorizada entre servidores onde o bot e o administrador estao presentes.",
    icon: Server,
    view: "server-cloner"
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
    id: "fivem-absences",
    title: "Ausencias FiveM",
    description: "Gerencia solicitacoes de ausencia para faccoes, corporacoes e organizacoes.",
    icon: Building2,
    view: "fivem"
  },
  {
    id: "verification",
    title: "Permissoes",
    description: "Define quais usuarios podem entrar e configurar este painel.",
    icon: LockKeyhole,
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
    title: "Configuracoes",
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
  moderation: "moderation",
  rules: "rules"
};

const settingsModuleIds = new Set(["tickets", "avisos", "network", "emoji-cloner"]);

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
        setDashboardRouteError("Nenhuma dashboard liberada para este usuario.");
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

        setDashboardRouteError(readResponseMessage(error) ?? "Acesso negado. Voce nao tem permissao para acessar esta dashboard.");
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
          <GiveawayPanel botId={activeBotId} canManage={canManageModule(selectedBot, "giveaway", canManageDashboard)} guild={selectedGuild} />
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
          <MissionToolsPanel
            botId={activeBotId}
            canManage={canManageModule(selectedBot, "mission-tools", canManageDashboard)}
            guild={selectedGuild}
            user={auth.user}
          />
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
          <ServerClonerView canManage={canManageModule(selectedBot, "server-cloner", canManageDashboard)} />
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
          Nenhum modulo FiveM foi liberado para este usuario.
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

  if (bot.accessLevel === "admin") {
    return true;
  }

  if (bot.accessLevel === "moderator") {
    return moduleId !== "verification";
  }

  if (bot.accessLevel === "premium") {
    return ["live", "kick-integration", "clips", "giveaway", "network", "x-monitor", "mission-tools", "voice-recorder", "emoji-cloner", "server-cloner", "rules", "account-age-security", "safe-bot", "fivem", "fivem-factions", "fivem-corporations", "fivem-absences", "fivem-orders", "fivem-ammo", "fivem-finance", "fivem-fac"].includes(moduleId);
  }

  return false;
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
        <MetricCard icon={CheckCircle2} label="Modulos ativos" value={`${activeModules}/${availableModules.length}`} />
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
          <h2 className="text-lg font-semibold text-white">Modulos disponiveis</h2>
          <p className="text-sm text-zinc-500">Apenas os modulos liberados para este bot neste servidor aparecem aqui.</p>
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
          <EmptyState icon={Settings} title="Nenhum modulo liberado para este bot" />
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Logs recentes</CardTitle>
          <CardDescription>Eventos importantes traduzidos para o usuario.</CardDescription>
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
      value: bot?.id ?? "Nao selecionado",
      active: Boolean(bot)
    },
    {
      label: "Bot",
      value: bot && status.online ? "Liberado" : "Bloqueado",
      active: Boolean(bot && status.online)
    },
    {
      label: "Modulos liberados",
      value: String(availableModuleCount),
      active: availableModuleCount > 0
    },
    {
      label: "Modulos bloqueados",
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
        <CardDescription>Estado runtime do bot selecionado, sem herdar configuracao de outro bot.</CardDescription>
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
        description="Ative ou pause os recursos basicos de moderacao deste servidor."
        disabled={!settings || !canManage || savingKey === "moderationEnabled"}
        icon={Shield}
        onChange={(checked) => onToggle("moderationEnabled", checked)}
        title="Moderacao"
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
        if (mounted) setMessage("Nao foi possivel carregar canais e cargos.");
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
      setMessage(readResponseMessage(error) ?? "Nao foi possivel salvar as regras.");
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
      setMessage(readResponseMessage(error) ?? "Nao foi possivel publicar o painel de regras.");
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
      <SimpleToggleCard
        checked={Boolean(settings?.ticketEnabled)}
        description={`${tickets.length} ticket(s) registrados neste servidor.`}
        disabled={!settings || !canManageModule("tickets") || savingKey === "ticketEnabled"}
        icon={TicketIcon}
        key="tickets"
        onChange={(checked) => onToggle("ticketEnabled", checked)}
        title="Tickets"
      />
    );
  }

  if (enabledModules.includes("network")) {
    blocks.push(
      <MemberSocialNetworkPanel
        botId={botId}
        canManage={canManageModule("network")}
        guild={guild}
        key="network"
      />
    );
  }

  if (enabledModules.includes("emoji-cloner")) {
    blocks.push(
      <EmojiCloneSettingsPanel
        botId={botId}
        bots={bots}
        canManage={canManageModule("emoji-cloner")}
        guild={guild}
        guilds={guilds}
        key="emoji-cloner"
        loading={loading}
        onSettingsChange={onSettingsChange}
        settings={settings}
      />
    );
  }

  if (!blocks.length) {
    return <EmptyState icon={Settings} title="Nenhuma configuracao simples liberada para este bot" />;
  }

  return <div className="space-y-5">{blocks}</div>;
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

function ServerClonerView({ canManage }: { canManage: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>Clonagem de Servidor</CardTitle>
              <CardDescription className="mt-1">
                Use /clonar-servidor no Discord. O relatorio sera enviado no canal geral de logs configurado neste servidor.
              </CardDescription>
            </div>
          </div>
          <Badge variant={canManage ? "success" : "muted"}>
            {canManage ? "Liberado" : "Bloqueado"}
          </Badge>
        </div>
      </CardHeader>
    </Card>
  );
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
  const [fakeEmojis, setFakeEmojis] = useState<Array<{ id: string; name: string; selected: boolean; status: "ready" | "cloned" | "failed" | "ignored" }>>([]);
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
      setError("Nao foi possivel salvar a clonagem de emojis. Confira as permissoes do bot.");
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
  const previewUrl = filePreview ?? parsedEmoji?.url ?? (isHttpImageUrl(sourceInput) ? sourceInput.trim() : null);
  const sourceLabel = selectedFile?.name ?? parsedEmoji?.name ?? (sourceInput.trim() || null);
  const sourceType = selectedFile
    ? selectedFile.type.includes("gif") ? "Animado" : "Imagem"
    : parsedEmoji
      ? parsedEmoji.animated ? "Emoji animado" : "Emoji estatico"
      : sourceInput.trim()
        ? "URL"
        : "Aguardando";
  const sourceSize = selectedFile ? formatBytes(selectedFile.size) : previewUrl ? "Remoto" : "Nao carregado";
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
    : { label: "Nao configurado", tone: "muted" as const };
  const credentialStatus = credentialTestMode === "real"
    ? liveCredentialStatus
    : credentialTestMode === "valid"
      ? { label: "Falso valido", tone: "success" as const }
      : credentialTestMode === "invalid"
        ? { label: "Falso invalido", tone: "danger" as const }
        : { label: "Falso validando", tone: "warning" as const };

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
      if (credentialTestMode !== "real") {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setCloneProgress(70);

        if (credentialTestMode === "invalid") {
          throw new Error("Credencial falsa invalida para teste.");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 450));
        setCloneProgress(100);
        setCloneStatus("success");
        setCloneMessage(`Teste concluido: emoji ${name} seria clonado com sucesso.`);
        setHistory((current) => [{
          createdAt: new Date().toISOString(),
          emojiUrl: previewUrl,
          guildName: selectedDestination?.name ?? destinationGuildId,
          name,
          status: "success" as const
        }, ...current].slice(0, 20));
        return;
      }

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
      setCloneMessage(readErrorMessage(requestError, "Nao foi possivel clonar o emoji."));
      setHistory((current) => [{
        createdAt: new Date().toISOString(),
        emojiUrl: previewUrl,
        guildName: selectedDestination?.name ?? destinationGuildId,
        name,
        status: "failed" as const
      }, ...current].slice(0, 20));
    }
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
      setCloneMessage(readErrorMessage(requestError, "Nao foi possivel reenviar o emoji."));
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

    if (!/^\d{5,32}$/.test(sourceGuildId) || !/^\d{5,32}$/.test(targetGuildId)) {
      setFakeTokenMessage("Informe IDs validos de origem e destino.");
      return;
    }

    try {
      const result = await validateFakeEmojiCloneToken({
        sourceGuildId,
        targetGuildId,
        token: fakeToken
      });

      setFakeTokenAccepted(result.accepted);
      setFakeTokenMasked(result.tokenMasked);
      setFakeTokenMessage(result.message);
      setCredentialTestMode("valid");
    } catch (requestError) {
      setFakeTokenAccepted(false);
      setCredentialTestMode("invalid");
      setFakeTokenMessage(readErrorMessage(requestError, "Token do usuario invalido"));
    }
  }

  function handleFetchFakeEmojis() {
    if (!fakeTokenAccepted) {
      setFakeTokenMessage("Valide o token  antes de buscar emojis.");
      return;
    }

    const seed = fakeSourceGuildId.trim().slice(-4) || "0000";
    setFakeEmojis([
      { id: `${seed}-1`, name: `teste_${seed}_star`, selected: true, status: "ready" },
      { id: `${seed}-2`, name: `teste_${seed}_fire`, selected: true, status: "ready" },
      { id: `${seed}-3`, name: `teste_${seed}_boost`, selected: false, status: "ready" }
    ]);
    setFakeTokenMessage("Emojis simulados carregados para o teste.");
  }

  async function handleCloneFakeSelected() {
    if (!fakeTokenAccepted || !fakeEmojis.some((emoji) => emoji.selected)) {
      setFakeTokenMessage("Selecione emojis simulados para clonar.");
      return;
    }

    setCloneStatus("running");
    setCloneProgress(25);
    setCloneMessage("[TESTE] Clonando emojis selecionados com token...");
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    setCloneProgress(100);
    setCloneStatus("success");
    setCloneMessage("[TESTE] Clonagem simulada concluida.");
    setFakeEmojis((current) => current.map((emoji) => emoji.selected ? { ...emoji, status: "cloned" } : { ...emoji, status: "ignored" }));
    setHistory((current) => [
      ...fakeEmojis
        .filter((emoji) => emoji.selected)
        .map((emoji) => ({
          createdAt: new Date().toISOString(),
          emojiUrl: null,
          guildName: selectedDestination?.name ?? destinationGuildId,
          name: `[TESTE] ${emoji.name}`,
          status: "success" as const
        })),
      ...current
    ].slice(0, 20));
  }

  function handleClearFakeTest() {
    setFakeToken("");
    setFakeSourceGuildId("");
    setFakeTokenMasked(null);
    setFakeTokenAccepted(false);
    setFakeTokenMessage(null);
    setFakeEmojis([]);
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
                  <p className="text-xs text-zinc-500">Usa somente o bot conectado ao painel. Credenciais de usuario nao sao aceitas.</p>
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
                <p className="text-sm font-semibold text-white">Modo de Teste com Token Falso</p>
                <p className="text-xs text-zinc-500">Aceita somente prefixo fake configurado no backend e nunca envia token para o Discord.</p>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-zinc-400">Token falso</span>
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                    disabled={disabled || cloneStatus === "running"}
                    onChange={(event) => setFakeToken(event.target.value)}
                    placeholder="adicionar token do usuario.."
                    type="password"
                    value={fakeToken}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-medium text-zinc-400">Servidor origem ID</span>
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                    disabled={disabled || cloneStatus === "running"}
                    onChange={(event) => setFakeSourceGuildId(event.target.value)}
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
                <Button disabled={disabled || cloneStatus === "running"} onClick={() => void handleValidateFakeToken()} size="sm" type="button">
                  Validar token 
                </Button>
                <Button disabled={disabled || !fakeTokenAccepted} onClick={handleFetchFakeEmojis} size="sm" type="button" variant="outline">
                  Buscar emojis
                </Button>
                <Button disabled={disabled || !fakeTokenAccepted || !fakeEmojis.some((emoji) => emoji.selected)} onClick={() => void handleCloneFakeSelected()} size="sm" type="button" variant="outline">
                  Clonar emojis selecionados
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
                      className={["rounded-lg border px-3 py-2 text-left transition", emoji.selected ? "border-purple-500/50 bg-purple-500/10" : "border-zinc-800 bg-zinc-950"].join(" ")}
                      key={emoji.id}
                      onClick={() => setFakeEmojis((current) => current.map((item) => item.id === emoji.id ? { ...item, selected: !item.selected } : item))}
                      type="button"
                    >
                      <span className="block truncate text-sm font-medium text-white">{emoji.name}</span>
                      <span className="mt-1 block text-xs text-zinc-500">{emoji.status === "cloned" ? "Clonado em teste" : emoji.status === "ignored" ? "Ignorado" : emoji.selected ? "Selecionado" : "Nao selecionado"}</span>
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
                <p className="text-xs text-zinc-500">Validacao, criacao e retorno do Discord.</p>
              </div>
              {cloneStatus === "running" ? <Loader2 className="h-5 w-5 animate-spin text-purple-300" /> : cloneStatus === "success" ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : cloneStatus === "error" ? <XCircle className="h-5 w-5 text-red-300" /> : <Clock3 className="h-5 w-5 text-zinc-500" />}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
              <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${cloneProgress}%` }} />
            </div>
            {cloneMessage ? <p className={["rounded-lg border px-3 py-2 text-sm", cloneStatus === "error" ? "border-red-500/20 bg-red-500/10 text-red-200" : cloneStatus === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 bg-zinc-900 text-zinc-300"].join(" ")}>{cloneMessage}</p> : null}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-purple-200" />
              <p className="text-sm font-semibold text-white">Origem</p>
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-950 px-3 py-4 text-sm text-zinc-300 transition hover:border-purple-500/60">
              <Upload className="h-4 w-4" />
              {selectedFile ? selectedFile.name : "Enviar imagem do emoji"}
              <input
                accept="image/png,image/gif,image/webp,image/jpeg"
                className="hidden"
                disabled={disabled}
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">URL ou emoji personalizado</span>
              <textarea
                className="min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600"
                disabled={disabled}
                onChange={(event) => setSourceInput(event.target.value)}
                placeholder="Cole https://cdn.discordapp.com/emojis/... ou <:nome:id>"
                value={sourceInput}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-300">Nome final</span>
              <input
                className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none placeholder:text-zinc-600"
                disabled={disabled}
                maxLength={32}
                onChange={(event) => setEmojiName(event.target.value)}
                placeholder="nome_do_emoji"
                value={emojiName}
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-sm font-semibold text-white">Informacoes</p>
              <div className="mt-4 flex aspect-square items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                {previewUrl ? <img alt="" className="max-h-full max-w-full object-contain" src={previewUrl} /> : <ImageIcon className="h-10 w-10 text-zinc-700" />}
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <InfoRow label="Nome atual" value={parsedEmoji?.name ?? selectedFile?.name ?? "Nao definido"} />
                <InfoRow label="Tipo" value={sourceType} />
                <InfoRow label="Tamanho" value={sourceSize} />
                <InfoRow label="Status" value={previewUrl ? "Imagem pronta" : "Aguardando imagem"} />
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Destino</p>
                  <p className="text-xs text-zinc-500">{destinationGuilds.length} servidores disponiveis</p>
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
              <div className="max-h-52 space-y-2 overflow-auto pr-1">
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
              <Button disabled={disabled || cloneStatus === "running" || !previewUrl || !destinationGuildId} onClick={() => void handleCloneEmoji()}>
                {cloneStatus === "running" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                Iniciar clonagem
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Biblioteca de Emojis</p>
              <p className="text-xs text-zinc-500">Emojis importados pelo seu usuario neste bot do Portal do Desenvolvedor.</p>
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
                      {item.animated ? "Animado" : "Estatico"} • {new Date(item.importedAt).toLocaleString("pt-BR")}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-600">
                      {sourceGuild?.name ?? item.sourceGuildId ?? "Origem externa"} → {targetGuild?.name ?? item.destinationGuildId}
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
              <p className="text-sm font-semibold text-white">Historico</p>
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
            <p className="mt-1 text-xs text-zinc-500">Se nenhum bot for marcado, qualquer bot com o modulo liberado pode executar.</p>
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
          <CardTitle>Historico do site</CardTitle>
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
    description: "Canal usado como referencia para avisos exibidos nos paineis."
  },
  {
    key: "safeBotLogChannelId",
    label: "Canal de Moderacao",
    description: "Alertas de filtros, punicoes e acoes de seguranca."
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
      setError("Nao foi possivel salvar este canal. Verifique as permissoes do bot e tente novamente.");
    } finally {
      setSavingField(null);
    }
  }

  if (!guild) {
    return <EmptyState icon={Bell} title="Selecione um servidor para configurar notificacoes" />;
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
      configuredText: activeModules ? `${activeModules} modulo(s)` : "Falta modulo"
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
      configuredText: userCount ? `${userCount} usuario(s)` : "Falta usuario"
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
    "x_monitor.discord_error": { badge: "X Monitor", title: "Nao foi possivel enviar post do X" },
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
    "moderation.link_anti_spam": { badge: "Moderacao", title: "Link bloqueado por anti-flood" },
    "security.account_age.blocked": { badge: "Seguranca", title: "Entrada bloqueada por idade da conta" },
    "security.self_bot.role_synced": { badge: "Self Bot", title: "Cargo Self Bot sincronizado" },
    "security.self_bot.role_assigned": { badge: "Self Bot", title: "Cargo Self Bot aplicado" },
    "security.self_bot.assignment_failed": { badge: "Self Bot", title: "Self Bot nao conseguiu aplicar cargo" },
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
    return enabledModules.includes("server-cloner");
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
