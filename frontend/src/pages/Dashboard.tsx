import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AtSign,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Film,
  Hash,
  Loader2,
  LockKeyhole,
  Radio,
  ScrollText,
  Server,
  Settings,
  Shield,
  TicketIcon,
  UserMinus,
  UserPlus,
  Users
} from "lucide-react";
import { DashboardLayout } from "../components/layout/dashboard-layout";
import type { ViewId } from "../components/layout/sidebar";
import { ClipsPanel } from "../components/clips/ClipsPanel";
import { SiteAccessPanel } from "../components/moderation/SiteAccessPanel";
import { LiveNotificationsPanel } from "../components/social/LiveNotificationsPanel";
import { XMonitorPanel } from "../components/social/XMonitorPanel";
import { WelcomePanel } from "../components/welcome/WelcomePanel";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { createDashboardSocket } from "../lib/socket";
import {
  getClipsConfig,
  getDashboardBySlug,
  getDashboardMe,
  getGuildSettings,
  getLives,
  getLogs,
  getSocialNotifications,
  getTickets,
  getXMonitor,
  patchGuildSettings,
  updateSelectedDashboardGuild
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
  GuildSettings,
  LiveEvent,
  LogEntry,
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
  | "moderationEnabled";

type OverviewDetails = {
  clipsConfig: ClipsConfig | null;
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

const CONFIGURED_GUILD_ID = "";
const CONFIGURED_GUILD_NAME = "Servidor configurado";

const initialBotStatus: BotStatus = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  botGuilds: [],
  updatedAt: new Date().toISOString()
};

const emptyOverviewDetails: OverviewDetails = {
  clipsConfig: null,
  liveNotifications: [],
  xAccounts: []
};

const moduleCatalog: ModuleDefinition[] = [
  {
    id: "live",
    title: "Sistema de Lives",
    description: "Detecta transmissoes na Twitch e envia alertas no Discord.",
    icon: Radio,
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
    id: "verification",
    title: "Permissoes",
    description: "Define quais cargos podem entrar e configurar este painel.",
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
    view: "settings"
  },
  {
    id: "leave",
    title: "Saida",
    description: "Envia mensagem quando um membro sai do servidor.",
    icon: UserMinus,
    view: "settings"
  },
  {
    id: "roles",
    title: "Cargos automaticos",
    description: "Aplica cargos configurados para novos membros.",
    icon: Users,
    view: "settings"
  },
  {
    id: "tickets",
    title: "Tickets",
    description: "Organiza atendimento em canais de suporte.",
    icon: TicketIcon,
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
  lives: "live",
  clips: "clips",
  "x-monitor": "x-monitor",
  logs: "logs",
  moderation: "moderation"
};

const settingsModuleIds = new Set(["welcome", "leave", "roles", "tickets", "avisos", "network"]);

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

  const panelBots = dashboardProfile?.bots ?? [];
  const dashboardGuilds = useMemo(
    () => ensureDashboardGuilds(dashboardProfile ? mergeDashboardGuilds(dashboardProfile.guilds, auth.guilds) : auth.guilds),
    [auth.guilds, dashboardProfile]
  );
  const selectedBot = useMemo(
    () => panelBots.find((bot) => bot.id === selectedBotId) ?? null,
    [panelBots, selectedBotId]
  );
  const activeBotId = selectedBot?.id ?? null;
  const enabledModules = selectedBot?.enabledModules ?? [];
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
  const canManageDashboard = panelBots.length ? Boolean(selectedBot) : auth.permissions.canManageDashboard;
  const availableModules = useMemo(
    () => moduleCatalog.filter((module) => enabledModules.includes(module.id)),
    [enabledModules]
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
      const targetBot = profile.bots[0] ?? null;

      if (!targetBot) {
        setDashboardRouteError("Nenhuma dashboard liberada para este usuario.");
        return;
      }

      if (!requestedSlug) {
        window.history.replaceState({}, "", `/dashboard/${encodeURIComponent(targetBot.slug)}`);
      }

      setSelectedBotId(targetBot?.id ?? null);

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
  }, [activeView, enabledModules]);

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
      enabledModules.includes("clips") ? getClipsConfig(selectedGuildId, activeBotId) : Promise.resolve(null),
      enabledModules.includes("x-monitor") ? getXMonitor(selectedGuildId, activeBotId) : Promise.resolve(null)
    ])
      .then(([settingsResult, logsResult, livesResult, ticketsResult, liveResult, clipsResult, xResult]) => {
        if (!mounted) return;

        setSettings(settingsResult.status === "fulfilled" ? settingsResult.value : null);
        setLogs(logsResult.status === "fulfilled" ? userVisibleLogs(logsResult.value) : []);
        setLives(livesResult.status === "fulfilled" ? livesResult.value : []);
        setTickets(ticketsResult.status === "fulfilled" ? ticketsResult.value : []);
        setOverviewDetails({
          liveNotifications: liveResult.status === "fulfilled" && liveResult.value ? liveResult.value.notifications : [],
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
  }, [activeBotId, dashboardProfileLoading, dashboardRouteError, enabledModules, panelBots.length, selectedGuildId]);

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
      if (log.guildId === selectedGuildId && (log.botId ?? null) === activeBotId && isUserVisibleLog(log)) {
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

  if (dashboardRouteError) {
    return <DashboardRouteError message={dashboardRouteError} />;
  }

  return (
    <DashboardLayout
      activeView={activeView}
      dashboardUser={dashboardProfile?.user}
      enabledModules={enabledModules}
      guilds={scopedDashboardGuilds}
      onChangeView={setActiveView}
      onLogout={onLogout}
      onSelectGuild={handleSelectGuild}
      selectedGuildId={selectedGuild?.id ?? null}
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
          <LiveView botId={activeBotId} canManage={canManageDashboard} guild={selectedGuild} lives={lives} />
        ) : null}
        {activeView === "clips" ? (
          <ClipsPanel botId={activeBotId} canManage={canManageDashboard} guild={selectedGuild} refreshSignal={clipsRefreshSignal} />
        ) : null}
        {activeView === "x-monitor" ? (
          <XMonitorPanel botId={activeBotId} canManage={canManageDashboard} guild={selectedGuild} />
        ) : null}
        {activeView === "moderation" ? (
          <ModerationView
            canManage={canManageDashboard}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
          />
        ) : null}
        {activeView === "permissions" ? (
          <SiteAccessPanel
            botId={activeBotId}
            canManage={canManageDashboard}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            settings={settings}
          />
        ) : null}
        {activeView === "logs" ? <LogsView logs={logs} /> : null}
        {activeView === "settings" ? (
          <SettingsView
            botId={activeBotId}
            canManage={canManageDashboard}
            enabledModules={enabledModules}
            guild={selectedGuild}
            loading={settingsLoading}
            onSettingsChange={setSettings}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
            tickets={tickets}
            viewerName={auth.user.username}
          />
        ) : null}
      </motion.div>
    </DashboardLayout>
  );
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
                <p className="mt-1 truncate font-mono text-xs text-zinc-500">/dashboard/{bot.slug}</p>
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
  canManage,
  guild,
  lives
}: {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  lives: LiveEvent[];
}) {
  return (
    <div className="space-y-5">
      <LiveNotificationsPanel botId={botId} canManage={canManage} guild={guild} />

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

function SettingsView({
  botId,
  canManage,
  enabledModules,
  guild,
  loading,
  onSettingsChange,
  onToggle,
  savingKey,
  settings,
  tickets,
  viewerName
}: {
  botId?: string | null;
  canManage: boolean;
  enabledModules: string[];
  guild: DashboardGuild | null;
  loading: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  tickets: Ticket[];
  viewerName: string;
}) {
  const blocks: JSX.Element[] = [];

  if (enabledModules.includes("welcome")) {
    blocks.push(
      <WelcomePanel
        botId={botId}
        canManage={canManage}
        guild={guild}
        key="welcome"
        loading={loading}
        mode="welcome"
        onSettingsChange={onSettingsChange}
        settings={settings}
        viewerName={viewerName}
      />
    );
  }

  if (enabledModules.includes("leave")) {
    blocks.push(
      <WelcomePanel
        botId={botId}
        canManage={canManage}
        guild={guild}
        key="leave"
        loading={loading}
        mode="leave"
        onSettingsChange={onSettingsChange}
        settings={settings}
        viewerName={viewerName}
      />
    );
  }

  if (enabledModules.includes("tickets")) {
    blocks.push(
      <SimpleToggleCard
        checked={Boolean(settings?.ticketEnabled)}
        description={`${tickets.length} ticket(s) registrados neste servidor.`}
        disabled={!settings || !canManage || savingKey === "ticketEnabled"}
        icon={TicketIcon}
        key="tickets"
        onChange={(checked) => onToggle("ticketEnabled", checked)}
        title="Tickets"
      />
    );
  }

  if (enabledModules.includes("roles") && !enabledModules.includes("welcome")) {
    blocks.push(
      <SimpleToggleCard
        checked={Boolean(settings?.autoRoleEnabled)}
        description={`${settings?.autoRoleIds.length ?? 0} cargo(s) configurado(s) para entrada.`}
        disabled={!settings || !canManage || savingKey === "autoRoleEnabled"}
        icon={Users}
        key="roles"
        onChange={(checked) => onToggle("autoRoleEnabled", checked)}
        title="Cargos automaticos"
      />
    );
  }

  if (!blocks.length) {
    return <EmptyState icon={Settings} title="Nenhuma configuracao simples liberada para este bot" />;
  }

  return <div className="space-y-5">{blocks}</div>;
}

function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs do servidor</CardTitle>
        <CardDescription>Eventos importantes em linguagem simples.</CardDescription>
      </CardHeader>
      <CardContent>
        <FriendlyLogList logs={logs} />
      </CardContent>
    </Card>
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

  if (moduleId === "verification") {
    const roleCount = settings?.verificationRoleIds.length || (settings?.verificationRoleId ? 1 : 0);
    return {
      active: Boolean(settings?.verificationEnabled),
      configured: roleCount > 0,
      configuredText: roleCount ? `${roleCount} cargo(s)` : "Falta cargo"
    };
  }

  if (moduleId === "logs") {
    return {
      active: Boolean(settings?.logChannelId),
      configured: Boolean(settings?.logChannelId),
      configuredText: settings?.logChannelId ? "Canal configurado" : "Falta canal"
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
    "audit.dev_bot": { badge: "Sistema", title: "Configuracao do bot atualizada" },
    "clips.config_saved": { badge: "Clips", title: "Sistema de clips atualizado" },
    "clips.enabled": { badge: "Clips", title: "Sistema de clips ativado" },
    "clips.disabled": { badge: "Clips", title: "Sistema de clips desativado" }
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

  if (log.type.includes("live") || lowerMessage.includes("twitch")) {
    return { badge: "Lives", title: message || "Sistema de lives atualizado", description: message };
  }

  if (log.type.includes("ticket")) {
    return { badge: "Tickets", title: message || "Ticket atualizado", description: message };
  }

  return {
    badge: "Painel",
    title: message || "Configuracao atualizada",
    description: "Evento registrado no servidor."
  };
}

function userVisibleLogs(logs: LogEntry[]) {
  return logs.filter(isUserVisibleLog);
}

function isUserVisibleLog(log: LogEntry) {
  return log.type !== "audit.dev_bot";
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
  if (view === "overview") {
    return true;
  }

  if (view === "settings") {
    return enabledModules.some((moduleId) => settingsModuleIds.has(moduleId));
  }

  const requiredModule = viewModuleIds[view];
  return Boolean(requiredModule && enabledModules.includes(requiredModule));
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
