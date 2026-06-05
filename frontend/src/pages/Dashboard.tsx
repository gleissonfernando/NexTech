import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Ban,
  Bell,
  Bot,
  Brush,
  CheckCircle2,
  ChevronRight,
  FileText,
  Hash,
  LockKeyhole,
  MessageSquare,
  Radio,
  ScrollText,
  Settings,
  Shield,
  TicketIcon,
  UserPlus,
  Users
} from "lucide-react";
import { DashboardLayout } from "../components/layout/dashboard-layout";
import type { ViewId } from "../components/layout/sidebar";
import { SocialNotificationsPage } from "./SocialNotificationsPage";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
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

type DashboardCardConfig = {
  id: string;
  category: "settings" | "permissions" | "modules" | "logs" | "personalization";
  title: string;
  description: string;
  icon: typeof Bot;
  key?: BooleanSettingKey;
  badge?: string;
  action?: string;
};

const initialBotStatus: BotStatus = {
  online: false,
  latency: 0,
  guilds: 0,
  users: 0,
  updatedAt: new Date().toISOString()
};

const dashboardCards: DashboardCardConfig[] = [
  {
    id: "general-settings",
    category: "settings",
    title: "Configurações gerais",
    description: "Defina canais, comportamento do bot e parâmetros globais do servidor.",
    icon: Settings,
    action: "Abrir"
  },
  {
    id: "welcome",
    category: "settings",
    title: "Boas-vindas",
    description: "Mensagens automáticas para entrada de novos membros.",
    icon: UserPlus,
    key: "welcomeEnabled",
    action: "Editar"
  },
  {
    id: "admin-permissions",
    category: "permissions",
    title: "Permissões administrativas",
    description: "Base preparada para validar administradores e donos do servidor.",
    icon: LockKeyhole,
    badge: "Novo",
    action: "Ver"
  },
  {
    id: "role-validation",
    category: "permissions",
    title: "Cargo configurado no painel",
    description: "Estrutura pronta para liberar acesso por cargo definido futuramente.",
    icon: Shield,
    key: "verificationEnabled",
    action: "Preparar"
  },
  {
    id: "lives",
    category: "modules",
    title: "Sistema de lives",
    description: "Detecte transmissões, envie alertas e atualize o painel em tempo real.",
    icon: Radio,
    action: "Gerenciar"
  },
  {
    id: "roles",
    category: "modules",
    title: "Cargos automáticos",
    description: "Controle cargos de entrada, booster, subscriber e perfis customizados.",
    icon: Users,
    key: "autoRoleEnabled",
    action: "Configurar"
  },
  {
    id: "tickets",
    category: "modules",
    title: "Tickets",
    description: "Organize atendimentos, canais temporários e histórico de suporte.",
    icon: TicketIcon,
    key: "ticketEnabled",
    action: "Abrir"
  },
  {
    id: "moderation",
    category: "modules",
    title: "Moderação",
    description: "Ações de ban, kick, timeout e warn com registros centralizados.",
    icon: Ban,
    key: "moderationEnabled",
    action: "Gerenciar"
  },
  {
    id: "audit-logs",
    category: "logs",
    title: "Logs do servidor",
    description: "Eventos de mensagens, membros, cargos, tickets e moderação.",
    icon: ScrollText,
    badge: "3",
    action: "Ver logs"
  },
  {
    id: "notifications",
    category: "logs",
    title: "Notificações internas",
    description: "Área reservada para alertas operacionais do painel.",
    icon: Bell,
    action: "Em breve"
  },
  {
    id: "messages",
    category: "personalization",
    title: "Mensagens personalizadas",
    description: "Crie textos reutilizáveis para boas-vindas, tickets e avisos.",
    icon: MessageSquare,
    action: "Editar"
  },
  {
    id: "appearance",
    category: "personalization",
    title: "Aparência do servidor",
    description: "Espaço preparado para identidade visual, embeds e modelos futuros.",
    icon: Brush,
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
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {activeView !== "socialNotifications" ? (
          <PageHeader
            activeView={activeView}
            botStatus={botStatus}
            guildName={selectedGuild?.name ?? "Servidor"}
          />
        ) : null}

        {activeView === "overview" ? (
          <OverviewView
            botStatus={botStatus}
            logs={logs}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
            totals={totals}
          />
        ) : null}

        {activeView === "settings" || activeView === "permissions" || activeView === "modules" || activeView === "personalization" ? (
          <CategoryView
            category={activeView}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
          />
        ) : null}

        {activeView === "socialNotifications" ? <SocialNotificationsPage guild={selectedGuild} /> : null}

        {activeView === "lives" ? <LiveView lives={lives} /> : null}
        {activeView === "tickets" ? <TicketView tickets={tickets} /> : null}
        {activeView === "logs" ? <LogsView logs={logs} /> : null}

        {["roles", "welcome", "moderation"].includes(activeView) ? (
          <FocusedModuleView
            activeView={activeView}
            onToggle={updateSetting}
            savingKey={savingKey}
            settings={settings}
          />
        ) : null}
      </motion.div>
    </DashboardLayout>
  );
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

function OverviewView({
  botStatus,
  logs,
  onToggle,
  savingKey,
  settings,
  totals
}: {
  botStatus: BotStatus;
  logs: LogEntry[];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
  totals: { members: number; channels: number; guilds: number; onlineGuilds: number };
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Bot} label="Status" value={botStatus.online ? "Online" : "Offline"} />
        <MetricCard icon={Users} label="Membros" value={formatNumber(totals.members)} />
        <MetricCard icon={Hash} label="Canais" value={formatNumber(totals.channels)} />
        <MetricCard icon={Activity} label="Servidores" value={`${totals.onlineGuilds}/${totals.guilds}`} />
      </section>

      <CategorySection
        category="settings"
        onToggle={onToggle}
        savingKey={savingKey}
        settings={settings}
      />
      <CategorySection
        category="permissions"
        onToggle={onToggle}
        savingKey={savingKey}
        settings={settings}
      />
      <CategorySection
        category="modules"
        onToggle={onToggle}
        savingKey={savingKey}
        settings={settings}
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

function CategoryView({
  category,
  onToggle,
  savingKey,
  settings
}: {
  category: DashboardCardConfig["category"];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
}) {
  return (
    <CategorySection
      category={category}
      onToggle={onToggle}
      savingKey={savingKey}
      settings={settings}
    />
  );
}

function FocusedModuleView({
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
  const ids =
    activeView === "roles"
      ? ["roles"]
      : activeView === "welcome"
        ? ["welcome", "role-validation"]
        : ["moderation"];

  return (
    <div className="space-y-4">
      {dashboardCards
        .filter((card) => ids.includes(card.id))
        .map((card) => (
          <ConfigCard
            card={card}
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
  category,
  onToggle,
  savingKey,
  settings
}: {
  category: DashboardCardConfig["category"];
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
}) {
  const meta = categoryMeta[category];
  const cards = dashboardCards.filter((card) => card.category === category);

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
  onToggle,
  savingKey,
  settings
}: {
  card: DashboardCardConfig;
  onToggle: (key: BooleanSettingKey, checked: boolean) => void;
  savingKey: BooleanSettingKey | null;
  settings: GuildSettings | null;
}) {
  const checked = card.key ? Boolean(settings?.[card.key]) : false;
  const disabled = Boolean(card.key && (!settings || savingKey === card.key));

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
          <Button className="h-9 px-3 text-xs" variant="outline">
            {card.action ?? "Abrir"}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveView({ lives }: { lives: LiveEvent[] }) {
  return (
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
