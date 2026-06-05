import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  Bot,
  CheckCircle2,
  Hash,
  Radio,
  ScrollText,
  Shield,
  ShieldCheck,
  TicketIcon,
  UserPlus,
  Users,
  Zap
} from "lucide-react";
import { DashboardLayout } from "../components/layout/dashboard-layout";
import type { ViewId } from "../components/layout/sidebar";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { createDashboardSocket } from "../lib/socket";
import { getGuildSettings, getLives, getLogs, getTickets, patchGuildSettings } from "../lib/api";
import type { AuthResponse, BotStatus, GuildSettings, LiveEvent, LogEntry, Ticket } from "../types";

type DashboardProps = {
  auth: AuthResponse;
  onLogout: () => void;
};

type BooleanSettingKey =
  | "welcomeEnabled"
  | "autoRoleEnabled"
  | "ticketEnabled"
  | "moderationEnabled"
  | "verificationEnabled";

const initialBotStatus: BotStatus = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  updatedAt: new Date().toISOString()
};

const modules: Array<{
  key: BooleanSettingKey;
  title: string;
  description: string;
  icon: typeof Bot;
  tone: "cyan" | "green" | "amber" | "red" | "blue";
}> = [
  {
    key: "welcomeEnabled",
    title: "Boas-vindas",
    description: "Mensagens personalizadas para novos membros.",
    icon: UserPlus,
    tone: "green"
  },
  {
    key: "autoRoleEnabled",
    title: "Cargos automaticos",
    description: "Twitch Subscriber, Booster e cargos customizados.",
    icon: Users,
    tone: "cyan"
  },
  {
    key: "ticketEnabled",
    title: "Tickets",
    description: "Abertura e acompanhamento de atendimentos.",
    icon: TicketIcon,
    tone: "amber"
  },
  {
    key: "moderationEnabled",
    title: "Moderacao",
    description: "Ban, kick, timeout e warn centralizados.",
    icon: Ban,
    tone: "red"
  },
  {
    key: "verificationEnabled",
    title: "Verificacao",
    description: "Entrada segura com cargo de verificado.",
    icon: ShieldCheck,
    tone: "blue"
  }
];

export function Dashboard({ auth, onLogout }: DashboardProps) {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(auth.guilds[0]?.id ?? null);
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lives, setLives] = useState<LiveEvent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatus>(initialBotStatus);
  const [savingKey, setSavingKey] = useState<BooleanSettingKey | null>(null);

  const selectedGuild = useMemo(
    () => auth.guilds.find((guild) => guild.id === selectedGuildId) ?? auth.guilds[0] ?? null,
    [auth.guilds, selectedGuildId]
  );

  const totals = useMemo(
    () => ({
      members: auth.guilds.reduce((sum, guild) => sum + guild.memberCount, 0),
      channels: auth.guilds.reduce((sum, guild) => sum + guild.channelCount, 0),
      guilds: auth.guilds.length,
      onlineGuilds: auth.guilds.filter((guild) => guild.botEnabled || botStatus.online).length
    }),
    [auth.guilds, botStatus.online]
  );

  useEffect(() => {
    if (!selectedGuildId) {
      return;
    }

    let mounted = true;

    Promise.all([getGuildSettings(selectedGuildId), getLogs(selectedGuildId), getLives(selectedGuildId), getTickets(selectedGuildId)])
      .then(([settingsData, logsData, livesData, ticketsData]) => {
        if (!mounted) {
          return;
        }

        setSettings(settingsData);
        setLogs(logsData);
        setLives(livesData);
        setTickets(ticketsData);
      })
      .catch(() => {
        if (mounted) {
          setSettings(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [selectedGuildId]);

  useEffect(() => {
    const socket = createDashboardSocket();

    socket.on("bot:status", (status: BotStatus) => setBotStatus(status));
    socket.on("logs:new", (log: LogEntry) => setLogs((current) => [log, ...current].slice(0, 50)));
    socket.on("live:started", (event: LiveEvent) => setLives((current) => [event, ...current].slice(0, 50)));
    socket.on("live:ended", (event: LiveEvent) => setLives((current) => [event, ...current].slice(0, 50)));
    socket.on("tickets:new", (ticket: Ticket) => setTickets((current) => [ticket, ...current].slice(0, 50)));
    socket.on("settings:updated", (nextSettings: GuildSettings) => {
      if (nextSettings.guildId === selectedGuildId) {
        setSettings(nextSettings);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedGuildId]);

  async function updateSetting(key: BooleanSettingKey, checked: boolean) {
    if (!settings || !selectedGuildId) {
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
      const saved = await patchGuildSettings(selectedGuildId, { [key]: checked });
      setSettings(saved);
    } catch {
      setSettings(previous);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <DashboardLayout
      activeView={activeView}
      guilds={auth.guilds}
      onChangeView={setActiveView}
      onLogout={onLogout}
      onSelectGuild={setSelectedGuildId}
      selectedGuildId={selectedGuild?.id ?? null}
      user={auth.user}
    >
      {activeView === "overview" ? (
        <OverviewView
          botStatus={botStatus}
          guildName={selectedGuild?.name ?? "Servidor"}
          logs={logs}
          totals={totals}
        />
      ) : null}

      {activeView === "lives" ? <LiveView lives={lives} /> : null}
      {activeView === "tickets" ? <TicketView tickets={tickets} /> : null}
      {activeView === "logs" ? <LogsView logs={logs} /> : null}

      {["roles", "welcome", "moderation", "settings"].includes(activeView) ? (
        <ManagementView
          activeView={activeView}
          onToggle={updateSetting}
          savingKey={savingKey}
          settings={settings}
        />
      ) : null}
    </DashboardLayout>
  );
}

function OverviewView({
  botStatus,
  guildName,
  logs,
  totals
}: {
  botStatus: BotStatus;
  guildName: string;
  logs: LogEntry[];
  totals: { members: number; channels: number; guilds: number; onlineGuilds: number };
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-white/10 bg-[#2b2d31]/70 p-5 shadow-glow backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{guildName}</p>
            <h2 className="mt-2 text-3xl font-semibold">Dashboard</h2>
          </div>
          <Badge variant={botStatus.online ? "success" : "warning"}>
            {botStatus.online ? "Bot online" : "Bot offline"}
          </Badge>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Bot} label="Status" value={botStatus.online ? "Online" : "Offline"} />
        <MetricCard icon={Users} label="Membros" value={formatNumber(totals.members)} />
        <MetricCard icon={Hash} label="Canais" value={formatNumber(totals.channels)} />
        <MetricCard icon={Activity} label="Servidores" value={`${totals.onlineGuilds}/${totals.guilds}`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Estatisticas em tempo real</CardTitle>
            <CardDescription>Latencia, cobertura do bot e atividade recente.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <RealtimeStat label="Latencia" value={`${botStatus.latency}ms`} />
              <RealtimeStat label="Guilds no bot" value={formatNumber(botStatus.guilds)} />
              <RealtimeStat label="Usuarios" value={formatNumber(botStatus.users)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logs recentes</CardTitle>
            <CardDescription>Eventos enviados pelo bot para a API.</CardDescription>
          </CardHeader>
          <CardContent>
            <LogList logs={logs.slice(0, 5)} compact />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ManagementView({
  activeView,
  onToggle,
  savingKey,
  settings
}: {
  activeView: ViewId;
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
}) {
  const filteredModules =
    activeView === "roles"
      ? modules.filter((module) => module.key === "autoRoleEnabled")
      : activeView === "welcome"
        ? modules.filter((module) => module.key === "welcomeEnabled" || module.key === "verificationEnabled")
        : activeView === "moderation"
          ? modules.filter((module) => module.key === "moderationEnabled")
          : modules;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredModules.map((module) => (
          <ModuleCard
            checked={Boolean(settings?.[module.key])}
            description={module.description}
            disabled={!settings || savingKey === module.key}
            icon={module.icon}
            key={module.key}
            onCheckedChange={(checked) => onToggle(module.key, checked)}
            title={module.title}
            tone={module.tone}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Parametros do servidor</CardTitle>
            <CardDescription>Configuracoes consumidas pelo bot via API.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingLine label="Canal de boas-vindas" value={settings?.welcomeChannelId ?? "Nao definido"} />
            <SettingLine label="Canal de logs" value={settings?.logChannelId ?? "Nao definido"} />
            <SettingLine label="Categoria de tickets" value={settings?.ticketCategoryId ?? "Nao definida"} />
            <SettingLine label="Cargo de verificacao" value={settings?.verificationRoleId ?? "Nao definido"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automacoes ativas</CardTitle>
            <CardDescription>Resumo operacional do servidor selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {modules.map((module) => (
              <SettingLine
                key={module.key}
                label={module.title}
                value={settings?.[module.key] ? "Ativo" : "Inativo"}
              />
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function LiveView({ lives }: { lives: LiveEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sistema de lives</CardTitle>
        <CardDescription>Eventos de inicio e encerramento recebidos do bot.</CardDescription>
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
                variant={live.type === "started" ? "success" : "muted"}
              />
            ))
          ) : (
            <EmptyState icon={Radio} title="Nenhuma live registrada" />
          )}
        </div>
      </CardContent>
    </Card>
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
                variant={ticket.status === "OPEN" ? "warning" : "muted"}
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
        <CardDescription>Mensagens apagadas, edicoes, membros, cargos e moderacao.</CardDescription>
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
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/[0.16] text-primary-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleCard({
  checked,
  description,
  disabled,
  icon: Icon,
  onCheckedChange,
  title,
  tone
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  icon: typeof Bot;
  onCheckedChange: (checked: boolean) => void;
  title: string;
  tone: "cyan" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass = {
    cyan: "bg-cyan-400/[0.14] text-cyan-200",
    green: "bg-emerald-400/[0.14] text-emerald-200",
    amber: "bg-amber-400/[0.14] text-amber-100",
    red: "bg-red-400/[0.14] text-red-100",
    blue: "bg-primary/[0.16] text-primary-foreground"
  }[tone];

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${toneClass}`}>
            <Icon className="h-5 w-5" />
          </div>
          <h3 className="truncate text-base font-semibold">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      </CardContent>
    </Card>
  );
}

function RealtimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-muted/[0.58] p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SettingLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-white/10 bg-muted/50 px-3">
      <span className="truncate text-sm text-muted-foreground">{label}</span>
      <span className="max-w-[52%] truncate text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function EventRow({
  badge,
  icon: Icon,
  subtitle,
  title,
  time,
  variant
}: {
  badge: string;
  icon: typeof Bot;
  subtitle: string;
  title: string;
  time: string;
  variant: "success" | "warning" | "muted";
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-white/10 bg-muted/50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#313338]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-xs text-muted-foreground sm:inline">{formatDate(time)}</span>
        <Badge variant={variant}>{badge}</Badge>
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
          variant="muted"
        />
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title }: { icon: typeof Bot; title: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.12] bg-muted/[0.30] p-6 text-center">
      <Icon className="mb-3 h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
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
