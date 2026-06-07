import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Ban,
  Bell,
  Bot,
  Brush,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Film,
  FileText,
  Hash,
  IdCard,
  LockKeyhole,
  MessageSquare,
  Radio,
  ScrollText,
  Settings,
  Shield,
  TicketIcon,
  UserCheck,
  UserMinus,
  UserPlus,
  Users
} from "lucide-react";
import { DashboardLayout } from "../components/layout/dashboard-layout";
import type { ViewId } from "../components/layout/sidebar";
import { DashboardHeader } from "../components/DashboardHeader";
import { ClipsPanel } from "../components/clips/ClipsPanel";
import { DevPanel } from "../components/dev/DevPanel";
import { SiteAccessPanel } from "../components/moderation/SiteAccessPanel";
import { LiveNotificationsPanel } from "../components/social/LiveNotificationsPanel";
import { WelcomePanel } from "../components/welcome/WelcomePanel";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { createDashboardSocket } from "../lib/socket";
import {
  getDashboardMe,
  getGuildSettings,
  getLives,
  getLogs,
  getTickets,
  patchGuildSettings,
  updateSelectedDashboardGuild
} from "../lib/api";
import type {
  AuthResponse,
  BotStatus,
  ClipSent,
  DashboardGuild,
  DashboardBot,
  DashboardMeGuild,
  DashboardMeResponse,
  DashboardViewMode,
  GuildSettings,
  LiveEvent,
  LogEntry,
  Ticket
} from "../types";

type DashboardProps = {
  auth: AuthResponse;
  onLogout: () => void;
};

const CONFIGURED_GUILD_ID = "1213384118356803594";
const CONFIGURED_GUILD_NAME = "Servidor configurado";
const DASHBOARD_VIEW_MODE_KEY = "dashboard.dev_view_mode";
type BooleanSettingKey =
  | "welcomeEnabled"
  | "leaveEnabled"
  | "autoRoleEnabled"
  | "ticketEnabled"
  | "moderationEnabled"
  | "verificationEnabled";

type DashboardCardConfig = {
  id: string;
  category: "settings" | "permissions" | "modules" | "logs" | "personalization";
  title: string;
  description: string;
  icon: typeof Bot;
  key?: BooleanSettingKey;
  badge?: string;
  action?: string;
  moduleId?: string;
  devOnly?: boolean;
};

const initialBotStatus: BotStatus = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  botGuilds: [],
  updatedAt: new Date().toISOString()
};

const dashboardCards: DashboardCardConfig[] = [
  {
    id: "general-settings",
    category: "settings",
    title: "Configurações gerais",
    description: "Defina canais, comportamento do bot e parâmetros globais do servidor.",
    icon: Settings,
    devOnly: true,
    action: "Abrir"
  },
  {
    id: "welcome",
    category: "settings",
    title: "Entrada",
    description: "Painel automatico para entrada de novos membros.",
    icon: UserPlus,
    moduleId: "welcome",
    key: "welcomeEnabled",
    action: "Abrir"
  },
  {
    id: "leave",
    category: "settings",
    title: "Saida",
    description: "Painel automatico para saida de membros.",
    icon: UserMinus,
    moduleId: "leave",
    key: "leaveEnabled",
    action: "Abrir"
  },
  {
    id: "admin-permissions",
    category: "permissions",
    title: "Permissões administrativas",
    description: "Base preparada para validar administradores e donos do servidor.",
    icon: LockKeyhole,
    devOnly: true,
    badge: "Novo",
    action: "Ver"
  },
  {
    id: "role-validation",
    category: "permissions",
    title: "Cargo configurado no painel",
    description: "Estrutura pronta para liberar acesso por cargo definido futuramente.",
    icon: Shield,
    moduleId: "verification",
    key: "verificationEnabled",
    action: "Preparar"
  },
  {
    id: "lives",
    category: "modules",
    title: "Sistema de lives",
    description: "Detecte transmissões, envie alertas e atualize o painel em tempo real.",
    icon: Radio,
    moduleId: "live",
    action: "Gerenciar"
  },
  {
    id: "clips",
    category: "modules",
    title: "Clips",
    description: "Detecte cortes criados na Twitch e envie no Discord automaticamente.",
    icon: Film,
    moduleId: "clips",
    action: "Configurar"
  },
  {
    id: "roles",
    category: "modules",
    title: "Cargos automáticos",
    description: "Controle cargos de entrada, booster, subscriber e perfis customizados.",
    icon: Users,
    moduleId: "roles",
    key: "autoRoleEnabled",
    action: "Configurar"
  },
  {
    id: "tickets",
    category: "modules",
    title: "Tickets",
    description: "Organize atendimentos, canais temporários e histórico de suporte.",
    icon: TicketIcon,
    moduleId: "tickets",
    key: "ticketEnabled",
    action: "Abrir"
  },
  {
    id: "moderation",
    category: "modules",
    title: "Moderação",
    description: "Ações de ban, kick, timeout e warn com registros centralizados.",
    icon: Ban,
    moduleId: "moderation",
    key: "moderationEnabled",
    action: "Gerenciar"
  },
  {
    id: "audit-logs",
    category: "logs",
    title: "Logs do servidor",
    description: "Eventos de mensagens, membros, cargos, tickets e moderação.",
    icon: ScrollText,
    moduleId: "logs",
    badge: "3",
    action: "Ver logs"
  },
  {
    id: "notifications",
    category: "logs",
    title: "Notificações internas",
    description: "Área reservada para alertas operacionais do painel.",
    icon: Bell,
    moduleId: "logs",
    action: "Em breve"
  },
  {
    id: "messages",
    category: "personalization",
    title: "Mensagens personalizadas",
    description: "Crie textos reutilizáveis para boas-vindas, tickets e avisos.",
    icon: MessageSquare,
    moduleId: "avisos",
    action: "Editar"
  },
  {
    id: "appearance",
    category: "personalization",
    title: "Aparência do servidor",
    description: "Espaço preparado para identidade visual, embeds e modelos futuros.",
    icon: Brush,
    moduleId: "avisos",
    action: "Em breve"
  }
];

const categoryMeta = {
  settings: {
    title: "Configurações",
    description: "Base operacional do servidor e do bot."
  },
  permissions: {
    title: "Permissões",
    description: "Regras de acesso e validação administrativa."
  },
  modules: {
    title: "Módulos",
    description: "Funções principais do bot Discord."
  },
  logs: {
    title: "Logs",
    description: "Auditoria e eventos em tempo real."
  },
  personalization: {
    title: "Personalização",
    description: "Mensagens e espaços para futuras customizações."
  }
};

const viewModuleIds: Partial<Record<ViewId, string>> = {
  permissions: "verification",
  lives: "live",
  clips: "clips",
  roles: "roles",
  welcome: "welcome",
  leave: "leave",
  tickets: "tickets",
  logs: "logs",
  moderation: "moderation",
  personalization: "avisos"
};

export function Dashboard({ auth, onLogout }: DashboardProps) {
  const [dashboardProfile, setDashboardProfile] = useState<DashboardMeResponse | null>(null);
  const [dashboardProfileLoading, setDashboardProfileLoading] = useState(true);
  const panelBots = dashboardProfile?.bots ?? [];
  const dashboardGuilds = useMemo(
    () => ensureDashboardGuilds(dashboardProfile ? mergeDashboardGuilds(dashboardProfile.guilds, auth.guilds) : auth.guilds),
    [auth.guilds, dashboardProfile]
  );
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [dashboardViewMode, setDashboardViewMode] = useState<DashboardViewMode>(readDashboardViewMode);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    auth.user.selectedGuildId ?? dashboardGuilds[0]?.id ?? CONFIGURED_GUILD_ID
  );
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lives, setLives] = useState<LiveEvent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [clipsRefreshSignal, setClipsRefreshSignal] = useState(0);
  const [botStatus, setBotStatus] = useState<BotStatus>(initialBotStatus);
  const [savingKey, setSavingKey] = useState<BooleanSettingKey | null>(null);
  const selectedPanelBot = useMemo(
    () => panelBots.find((bot) => bot.id === selectedBotId) ?? null,
    [panelBots, selectedBotId]
  );
  const activeBotId = selectedPanelBot?.id ?? null;
  const canManageDashboard = panelBots.length ? Boolean(selectedPanelBot) : auth.permissions.canManageDashboard;
  const canViewDev = dashboardProfile?.canViewDev ?? false;
  const developerView = canViewDev && dashboardViewMode === "developer";
  const enabledModules = selectedPanelBot?.enabledModules ?? [];
  const showAllModules = developerView;
  const showDevOnlyCards = developerView;
  const displayedBotStatus = selectedPanelBot
    ? {
        ...botStatus,
        botId: selectedPanelBot.id,
        online: selectedPanelBot.status === "online"
      }
    : botStatus;
  const scopedDashboardGuilds = useMemo(
    () => selectedPanelBot
      ? dashboardGuilds.filter((guild) => selectedPanelBot.guildIds.includes(guild.id))
      : dashboardGuilds,
    [dashboardGuilds, selectedPanelBot]
  );
  const allDashboardHeaderGuilds = useMemo(
    () => (dashboardProfile?.guilds.length ? dashboardProfile.guilds : toDashboardMeGuilds(dashboardGuilds)),
    [dashboardGuilds, dashboardProfile]
  );
  const dashboardHeaderGuilds = useMemo(
    () => selectedPanelBot
      ? allDashboardHeaderGuilds.filter((guild) => selectedPanelBot.guildIds.includes(guild.id))
      : allDashboardHeaderGuilds,
    [allDashboardHeaderGuilds, selectedPanelBot]
  );

  useEffect(() => {
    let mounted = true;

    setDashboardProfileLoading(true);
    getDashboardMe()
      .then((profile) => {
        if (!mounted) {
          return;
        }

        setDashboardProfile(profile);
        const firstPanelBot = profile.bots[0] ?? null;

        setSelectedBotId((current) => current ?? firstPanelBot?.id ?? null);
        const nextGuildId = firstPanelBot?.guildIds[0] ?? profile.selectedGuildId ?? profile.guilds[0]?.id ?? null;

        if (nextGuildId) {
          setSelectedGuildId((current) => (current && profile.guilds.some((guild) => guild.id === current) ? current : nextGuildId));
        }
      })
      .catch(() => {
        if (mounted) {
          window.location.replace("/login");
        }
      })
      .finally(() => {
        if (mounted) {
          setDashboardProfileLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeView === "dev" && !developerView) {
      setActiveView("overview");
    }
  }, [activeView, developerView]);

  useEffect(() => {
    if (!isViewAllowed(activeView, enabledModules, developerView, showAllModules)) {
      setActiveView("overview");
    }
  }, [activeView, developerView, enabledModules, showAllModules]);

  useEffect(() => {
    const selectedGuildIsAvailable = selectedGuildId
      ? scopedDashboardGuilds.some((guild) => guild.id === selectedGuildId)
      : false;

    if (!selectedGuildIsAvailable && scopedDashboardGuilds[0]?.id) {
      setSelectedGuildId(scopedDashboardGuilds[0].id);
    }
  }, [scopedDashboardGuilds, selectedGuildId]);

  const selectedGuild = useMemo(
    () => scopedDashboardGuilds.find((guild) => guild.id === selectedGuildId) ?? scopedDashboardGuilds[0] ?? null,
    [scopedDashboardGuilds, selectedGuildId]
  );

  const totals = useMemo(
    () => ({
      members: scopedDashboardGuilds.reduce((sum, guild) => sum + guild.memberCount, 0),
      channels: scopedDashboardGuilds.reduce((sum, guild) => sum + guild.channelCount, 0),
      guilds: scopedDashboardGuilds.length,
      onlineGuilds: scopedDashboardGuilds.filter((guild) => guild.botEnabled || botStatus.online).length
    }),
    [scopedDashboardGuilds, botStatus.online]
  );

  useEffect(() => {
    if (panelBots.length && !activeBotId) {
      setSettings(null);
      setLogs([]);
      setLives([]);
      setTickets([]);
      return;
    }

    if (!selectedGuildId) {
      setSettings(null);
      return;
    }

    let mounted = true;

    setSettingsLoading(true);
    setSettings(null);

    Promise.allSettled([
      getGuildSettings(selectedGuildId, activeBotId),
      getLogs(selectedGuildId, activeBotId),
      getLives(selectedGuildId, activeBotId),
      getTickets(selectedGuildId, activeBotId)
    ])
      .then(([settingsResult, logsResult, livesResult, ticketsResult]) => {
        if (!mounted) {
          return;
        }

        setSettings(settingsResult.status === "fulfilled" ? settingsResult.value : null);
        setLogs(logsResult.status === "fulfilled" ? logsResult.value : []);
        setLives(livesResult.status === "fulfilled" ? livesResult.value : []);
        setTickets(ticketsResult.status === "fulfilled" ? ticketsResult.value : []);
      })
      .finally(() => {
        if (mounted) {
          setSettingsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [activeBotId, panelBots.length, selectedGuildId]);

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
    socket.on("dev:bot_created", (createdBot: DashboardBot) => {
      setDashboardProfile((current) => current ? {
        ...current,
        bots: current.bots.some((bot) => bot.id === createdBot.id)
          ? current.bots.map((bot) => bot.id === createdBot.id ? createdBot : bot)
          : [createdBot, ...current.bots]
      } : current);
    });
    socket.on("dev:bot_deleted", (deletedBot: DashboardBot) => {
      setDashboardProfile((current) => current ? {
        ...current,
        bots: current.bots.filter((bot) => bot.id !== deletedBot.id)
      } : current);
      setSelectedBotId((current) => current === deletedBot.id ? null : current);
    });
    socket.on("logs:new", (log: LogEntry) => {
      if (log.guildId === selectedGuildId && (log.botId ?? null) === activeBotId) {
        setLogs((current) => [log, ...current].slice(0, 50));
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
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [activeBotId, selectedGuildId]);

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

  async function handleSelectBot(botId: string | null) {
    setSelectedBotId(botId);

    const bot = panelBots.find((item) => item.id === botId) ?? null;

    const nextGuildId = bot
      ? bot.guildIds.includes(selectedGuildId ?? "") ? selectedGuildId : bot.guildIds[0]
      : selectedGuildId;

    if (bot && nextGuildId) {
      setSelectedGuildId(nextGuildId);
      await updateSelectedDashboardGuild(nextGuildId, bot.id).catch(() => undefined);
    }
  }

  function upsertDashboardBot(bot: DashboardBot) {
    setDashboardProfile((current) => current ? {
      ...current,
      bots: current.bots.some((item) => item.id === bot.id)
        ? current.bots.map((item) => item.id === bot.id ? bot : item)
        : [bot, ...current.bots]
    } : current);
  }

  function removeDashboardBot(botId: string) {
    setDashboardProfile((current) => current ? {
      ...current,
      bots: current.bots.filter((bot) => bot.id !== botId)
    } : current);
    setSelectedBotId((current) => current === botId ? null : current);
  }

  function handleDashboardViewMode(mode: DashboardViewMode) {
    if (!canViewDev) {
      return;
    }

    setDashboardViewMode(mode);
    writeDashboardViewMode(mode);

    if (mode === "user" && activeView === "dev") {
      setActiveView("overview");
    }
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
      selectedBotId={activeBotId}
      selectedGuildId={selectedGuild?.id ?? null}
      showDev={developerView}
      showAllModules={showAllModules}
      user={auth.user}
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <PageHeader
          activeView={activeView}
          botStatus={displayedBotStatus}
          guildName={selectedGuild?.name ?? "Servidor"}
        />
        <DashboardHeader
          bot={selectedPanelBot ? {
            id: selectedPanelBot.clientId,
            username: selectedPanelBot.name,
            avatarUrl: selectedPanelBot.avatarUrl,
            connected: selectedPanelBot.status === "online"
          } : dashboardProfile?.bot}
          bots={panelBots}
          canSwitchDashboardMode={canViewDev}
          dashboardMode={developerView ? "developer" : "user"}
          guilds={dashboardHeaderGuilds}
          loading={dashboardProfileLoading}
          onChangeDashboardMode={handleDashboardViewMode}
          onSelectBot={handleSelectBot}
          onSelectGuild={handleSelectGuild}
          selectedBotId={activeBotId}
          selectedGuildId={selectedGuild?.id ?? null}
          user={dashboardProfile?.user}
        />
        {activeView !== "dev" ? (
          <BotConfigScopeCard
            bots={panelBots}
            enabledModules={enabledModules}
            loading={dashboardProfileLoading}
            onSelectBot={handleSelectBot}
            selectedBot={selectedPanelBot}
            selectedGuild={selectedGuild}
          />
        ) : null}

        {activeView === "overview" ? (
          <OverviewView
            auth={auth}
            botStatus={displayedBotStatus}
            canManageDashboard={canManageDashboard}
            enabledModules={enabledModules}
            logs={logs}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
            showAllModules={showAllModules}
            showDevOnlyCards={showDevOnlyCards}
            totals={totals}
          />
        ) : null}

        {activeView === "settings" || activeView === "permissions" || activeView === "modules" || activeView === "personalization" ? (
          <CategoryView
            canManageDashboard={canManageDashboard}
            category={activeView}
            enabledModules={enabledModules}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
            showAllModules={showAllModules}
            showDevOnlyCards={showDevOnlyCards}
          />
        ) : null}

        {activeView === "lives" ? (
          <LiveView botId={activeBotId} canManageDashboard={canManageDashboard} guild={selectedGuild} lives={lives} />
        ) : null}
        {activeView === "clips" ? (
          <ClipsPanel botId={activeBotId} canManage={canManageDashboard} guild={selectedGuild} refreshSignal={clipsRefreshSignal} />
        ) : null}
        {activeView === "welcome" ? (
          <WelcomePanel
            canManage={canManageDashboard}
            botId={activeBotId}
            guild={selectedGuild}
            loading={settingsLoading}
            mode="welcome"
            onSettingsChange={setSettings}
            settings={settings}
            viewerName={auth.user.username}
          />
        ) : null}
        {activeView === "leave" ? (
          <WelcomePanel
            canManage={canManageDashboard}
            botId={activeBotId}
            guild={selectedGuild}
            loading={settingsLoading}
            mode="leave"
            onSettingsChange={setSettings}
            settings={settings}
            viewerName={auth.user.username}
          />
        ) : null}
        {activeView === "tickets" ? <TicketView tickets={tickets} /> : null}
        {activeView === "logs" ? <LogsView logs={logs} /> : null}
        {activeView === "dev" && developerView ? (
          <DevPanel
            guilds={allDashboardHeaderGuilds}
            onBotCreated={(bot) => {
              upsertDashboardBot(bot);
              setSelectedBotId(bot.id);
              setSelectedGuildId(bot.guildIds[0] ?? bot.mainGuildId);
            }}
            onBotDeleted={removeDashboardBot}
            onBotUpdated={upsertDashboardBot}
            onSelectBot={handleSelectBot}
            selectedBotId={activeBotId}
            selectedGuildId={selectedGuild?.id ?? null}
            user={auth.user}
          />
        ) : null}

        {["roles", "moderation"].includes(activeView) ? (
          <>
            <FocusedModuleView
              activeView={activeView}
              canManageDashboard={canManageDashboard}
              enabledModules={enabledModules}
              onToggle={updateSetting}
              savingKey={savingKey}
              settings={settings}
              showAllModules={showAllModules}
              showDevOnlyCards={showDevOnlyCards}
            />
            {activeView === "moderation" ? (
              <SiteAccessPanel
                botId={activeBotId}
                canManage={canManageDashboard}
                guild={selectedGuild}
                loading={settingsLoading}
                onSettingsChange={setSettings}
                settings={settings}
              />
            ) : null}
          </>
        ) : null}
      </motion.div>
    </DashboardLayout>
  );
}

function readDashboardViewMode(): DashboardViewMode {
  try {
    return window.sessionStorage.getItem(DASHBOARD_VIEW_MODE_KEY) === "user" ? "user" : "developer";
  } catch {
    return "developer";
  }
}

function writeDashboardViewMode(mode: DashboardViewMode) {
  try {
    window.sessionStorage.setItem(DASHBOARD_VIEW_MODE_KEY, mode);
  } catch {
    // The mode falls back to developer when session storage is unavailable.
  }
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

function viewModuleId(view: ViewId) {
  return viewModuleIds[view] ?? null;
}

function isViewAllowed(view: ViewId, enabledModules: string[], developerView: boolean, showAllModules: boolean) {
  if (view === "overview" || showAllModules) {
    return true;
  }

  if (view === "dev") {
    return developerView;
  }

  if (view === "settings") {
    return ["welcome", "leave"].some((moduleId) => enabledModules.includes(moduleId));
  }

  if (view === "modules") {
    return ["live", "roles", "tickets", "moderation"].some((moduleId) => enabledModules.includes(moduleId));
  }

  const requiredModule = viewModuleId(view);
  return Boolean(requiredModule && enabledModules.includes(requiredModule));
}

function isCardVisible(
  card: DashboardCardConfig,
  enabledModules: string[],
  showAllModules: boolean,
  showDevOnlyCards: boolean
) {
  if (card.devOnly) {
    return showDevOnlyCards;
  }

  return showAllModules || !card.moduleId || enabledModules.includes(card.moduleId);
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

function toDashboardMeGuilds(guilds: DashboardGuild[]): DashboardMeGuild[] {
  return guilds.map((guild) => ({
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    owner: guild.owner,
    permissions: guild.isAdmin ? "ADMINISTRATOR" : "0",
    botInGuild: guild.botEnabled
  }));
}

function PageHeader({
  activeView,
  botStatus,
  guildName
}: {
  activeView: ViewId;
  botStatus: BotStatus;
  guildName: string;
}) {
  const title =
    activeView === "overview"
      ? "Painel Administrativo"
      : activeView === "personalization"
        ? "Personalização"
        : activeView === "permissions"
          ? "Permissões"
          : activeView === "modules"
            ? "Módulos"
            : activeView === "settings"
              ? "Configurações"
              : activeView === "welcome"
                ? "Entrada"
                : activeView === "leave"
                  ? "Saida"
                  : activeView === "dev"
                    ? "Gerenciar Bots"
                    : activeView.charAt(0).toUpperCase() + activeView.slice(1);

  return (
    <section className="rounded-lg border border-zinc-900 bg-[#0b0b0b] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.38)] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500">{guildName}</p>
          <h2 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">{title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
            Gerencie configurações, módulos, permissões e logs do bot em uma interface pronta para crescer.
          </p>
        </div>
        <Badge variant="muted">{botStatus.online ? "Bot online" : "Bot offline"}</Badge>
      </div>
    </section>
  );
}

function BotConfigScopeCard({
  bots,
  enabledModules,
  loading,
  onSelectBot,
  selectedBot,
  selectedGuild
}: {
  bots: DashboardBot[];
  enabledModules: string[];
  loading: boolean;
  onSelectBot: (botId: string | null) => void;
  selectedBot: DashboardBot | null;
  selectedGuild: DashboardGuild | null;
}) {
  if (!bots.length) {
    return null;
  }

  return (
    <Card className="border-purple-500/25 bg-purple-500/[0.06]">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              className="h-12 w-12 rounded-full border border-purple-500/40"
              fallback={selectedBot?.name ?? "Bot"}
              src={selectedBot?.avatarUrl ?? null}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-purple-200">Bots cadastrados</p>
              <h3 className="mt-1 truncate text-lg font-semibold text-white">
                {selectedBot?.name ?? "Nenhum bot selecionado"}
              </h3>
              <p className="truncate text-xs text-zinc-500">
                Servidor: {selectedGuild?.name ?? selectedBot?.mainGuildName ?? "selecione um servidor"}
              </p>
            </div>
          </div>

          <label className="block w-full space-y-2 lg:max-w-sm">
            <span className="text-xs font-medium uppercase text-zinc-500">Bot das configuracoes</span>
            <select
              className="h-11 w-full rounded-lg border border-purple-500/30 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 outline-none transition duration-300 focus:border-purple-400 disabled:opacity-60"
              disabled={loading}
              onChange={(event) => onSelectBot(event.target.value || null)}
              value={selectedBot?.id ?? ""}
            >
              <option value="">Selecione um bot cadastrado</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} - {bot.mainGuildName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-900 bg-black/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-400">
            {selectedBot
              ? "As abas, botoes e configuracoes abaixo pertencem somente ao bot selecionado."
              : "Escolha um bot cadastrado para mudar o que o usuario pode ver na dashboard."}
          </p>
          <Badge variant="muted">{enabledModules.length} configs liberadas</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewView({
  auth,
  botStatus,
  canManageDashboard,
  enabledModules,
  logs,
  onToggle,
  savingKey,
  settings,
  showAllModules,
  showDevOnlyCards,
  totals
}: {
  auth: AuthResponse;
  botStatus: BotStatus;
  canManageDashboard: boolean;
  enabledModules: string[];
  logs: LogEntry[];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  showAllModules: boolean;
  showDevOnlyCards: boolean;
  totals: { members: number; channels: number; guilds: number; onlineGuilds: number };
}) {
  return (
    <div className="space-y-6">
      <ProfileSummaryCard auth={auth} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Bot} label="Status" value={botStatus.online ? "Online" : "Offline"} />
        <MetricCard icon={Users} label="Membros" value={formatNumber(totals.members)} />
        <MetricCard icon={Hash} label="Canais" value={formatNumber(totals.channels)} />
        <MetricCard icon={Activity} label="Servidores" value={`${totals.onlineGuilds}/${totals.guilds}`} />
      </section>

      <CategorySection
        canManageDashboard={canManageDashboard}
        category="settings"
        enabledModules={enabledModules}
        onToggle={onToggle}
        savingKey={savingKey}
        settings={settings}
        showAllModules={showAllModules}
        showDevOnlyCards={showDevOnlyCards}
      />
      <CategorySection
        canManageDashboard={canManageDashboard}
        category="permissions"
        enabledModules={enabledModules}
        onToggle={onToggle}
        savingKey={savingKey}
        settings={settings}
        showAllModules={showAllModules}
        showDevOnlyCards={showDevOnlyCards}
      />
      <CategorySection
        canManageDashboard={canManageDashboard}
        category="modules"
        enabledModules={enabledModules}
        onToggle={onToggle}
        savingKey={savingKey}
        settings={settings}
        showAllModules={showAllModules}
        showDevOnlyCards={showDevOnlyCards}
      />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Estatísticas em tempo real</CardTitle>
            <CardDescription>Latência, servidores e usuários sincronizados pelo backend.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <RealtimeStat label="Latência" value={`${botStatus.latency}ms`} />
              <RealtimeStat label="Guilds no bot" value={formatNumber(botStatus.guilds)} />
              <RealtimeStat label="Usuários" value={formatNumber(botStatus.users)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logs recentes</CardTitle>
            <CardDescription>Últimos eventos recebidos pelo painel.</CardDescription>
          </CardHeader>
          <CardContent>
            <LogList logs={logs.slice(0, 4)} compact />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ProfileSummaryCard({ auth }: { auth: AuthResponse }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="h-16 w-16 rounded-lg text-base" fallback={auth.user.username} src={auth.user.avatarUrl ?? auth.user.avatar} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-xl font-semibold text-white">{auth.user.username}</h3>
              <Badge variant="muted">{auth.access.level === "admin" ? "Admin" : "Viewer"}</Badge>
              {auth.user.authorized ? <Badge variant="muted">Autorizado</Badge> : null}
            </div>
            <p className="mt-1 truncate text-sm text-zinc-500">{auth.user.tag}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
          <ProfileFact icon={IdCard} label="Discord ID" value={auth.user.discordId} />
          <ProfileFact icon={CalendarClock} label="Ultimo login" value={formatDateTime(auth.user.lastLoginAt)} />
          <ProfileFact icon={UserCheck} label="Acesso" value={auth.permissions.canManageDashboard ? "Total" : "Basico"} />
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileFact({ icon: Icon, label, value }: { icon: typeof IdCard; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-zinc-100">{value}</p>
    </div>
  );
}

function CategoryView({
  canManageDashboard,
  category,
  enabledModules,
  onToggle,
  savingKey,
  settings,
  showAllModules,
  showDevOnlyCards
}: {
  canManageDashboard: boolean;
  category: DashboardCardConfig["category"];
  enabledModules: string[];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  showAllModules: boolean;
  showDevOnlyCards: boolean;
}) {
  return (
    <CategorySection
      canManageDashboard={canManageDashboard}
      category={category}
      enabledModules={enabledModules}
      onToggle={onToggle}
      savingKey={savingKey}
      settings={settings}
      showAllModules={showAllModules}
      showDevOnlyCards={showDevOnlyCards}
    />
  );
}

function FocusedModuleView({
  activeView,
  canManageDashboard,
  enabledModules,
  onToggle,
  savingKey,
  settings,
  showAllModules,
  showDevOnlyCards
}: {
  activeView: ViewId;
  canManageDashboard: boolean;
  enabledModules: string[];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  showAllModules: boolean;
  showDevOnlyCards: boolean;
}) {
  const ids =
    activeView === "roles"
      ? ["roles"]
      : activeView === "welcome"
        ? ["welcome", "role-validation"]
        : ["moderation"];

  return (
    <div className="space-y-4">
      {dashboardCards
        .filter((card) => ids.includes(card.id) && isCardVisible(card, enabledModules, showAllModules, showDevOnlyCards))
        .map((card) => (
          <ConfigCard
            card={card}
            canManageDashboard={canManageDashboard}
            key={card.id}
            onToggle={onToggle}
            savingKey={savingKey}
            settings={settings}
          />
        ))}
    </div>
  );
}

function CategorySection({
  canManageDashboard,
  category,
  enabledModules,
  onToggle,
  savingKey,
  settings,
  showAllModules,
  showDevOnlyCards
}: {
  canManageDashboard: boolean;
  category: DashboardCardConfig["category"];
  enabledModules: string[];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  showAllModules: boolean;
  showDevOnlyCards: boolean;
}) {
  const meta = categoryMeta[category];
  const cards = dashboardCards.filter(
    (card) => card.category === category && isCardVisible(card, enabledModules, showAllModules, showDevOnlyCards)
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">{meta.title}</h3>
          <p className="text-sm text-zinc-500">{meta.description}</p>
        </div>
      </div>

      <div className="space-y-3">
        {cards.map((card) => (
          <ConfigCard
            card={card}
            canManageDashboard={canManageDashboard}
            key={card.id}
            onToggle={onToggle}
            savingKey={savingKey}
            settings={settings}
          />
        ))}
      </div>
    </section>
  );
}

function ConfigCard({
  card,
  canManageDashboard,
  onToggle,
  savingKey,
  settings
}: {
  card: DashboardCardConfig;
  canManageDashboard: boolean;
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
}) {
  const checked = card.key ? Boolean(settings?.[card.key]) : false;
  const disabled = Boolean(card.key && (!settings || savingKey === card.key || !canManageDashboard));

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
            <card.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="truncate text-base font-semibold text-white">{card.title}</h4>
              {card.badge ? <Badge variant="muted">{card.badge}</Badge> : null}
              {card.key ? <span className="h-2 w-2 rounded-full bg-zinc-500" /> : null}
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">{card.description}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3">
          {card.key ? <Switch checked={checked} disabled={disabled} onCheckedChange={(value) => onToggle(card.key!, value)} /> : null}
          <Button className="h-9 px-3 text-xs" disabled={!canManageDashboard} variant="outline">
            {card.action ?? "Abrir"}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveView({
  botId,
  canManageDashboard,
  guild,
  lives
}: {
  botId?: string | null;
  canManageDashboard: boolean;
  guild: DashboardGuild | null;
  lives: LiveEvent[];
}) {
  return (
    <div className="space-y-6">
      <LiveNotificationsPanel botId={botId} canManage={canManageDashboard} guild={guild} />

      <Card>
        <CardHeader>
          <CardTitle>Sistema de lives</CardTitle>
          <CardDescription>Eventos de início e encerramento recebidos do bot.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {lives.length ? (
              lives.map((live) => (
                <EventRow
                  badge={live.type === "started" ? "Iniciada" : "Encerrada"}
                  icon={Radio}
                  key={live.id}
                  subtitle={live.title ?? live.url ?? "Sem título"}
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

function TicketView({ tickets }: { tickets: Ticket[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sistema de tickets</CardTitle>
        <CardDescription>Atendimentos criados pelo bot e sincronizados pela API.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {tickets.length ? (
            tickets.map((ticket) => (
              <EventRow
                badge={ticket.status}
                icon={TicketIcon}
                key={ticket.id}
                subtitle={`Aberto por ${ticket.openerId}`}
                title={ticket.subject}
                time={ticket.createdAt}
              />
            ))
          ) : (
            <EmptyState icon={TicketIcon} title="Nenhum ticket aberto" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sistema de logs</CardTitle>
        <CardDescription>Mensagens apagadas, edições, membros, cargos e moderação.</CardDescription>
      </CardHeader>
      <CardContent>
        <LogList logs={logs} />
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-500">{label}</p>
          <p className="truncate text-2xl font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RealtimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
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
    <div className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 px-4 py-3 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-900 hover:shadow-[0_18px_45px_rgba(0,0,0,0.42)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
          <Icon className="h-5 w-5 text-zinc-300" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{title}</p>
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs text-zinc-500 sm:inline">{formatDate(time)}</span>
        <Badge variant="muted">{badge}</Badge>
      </div>
    </div>
  );
}

function LogList({ compact = false, logs }: { compact?: boolean; logs: LogEntry[] }) {
  if (!logs.length) {
    return <EmptyState icon={ScrollText} title="Nenhum log registrado" />;
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <EventRow
          badge={log.type}
          icon={ScrollText}
          key={log.id}
          subtitle={compact ? formatDate(log.createdAt) : log.guildId}
          title={log.message}
          time={log.createdAt}
        />
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title }: { icon: typeof Bot; title: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
      <Icon className="mb-3 h-7 w-7 text-zinc-500" />
      <p className="text-sm font-medium text-zinc-500">{title}</p>
    </div>
  );
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
