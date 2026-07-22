import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  BadgeCheck,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Car,
  Code2,
  Copy,
  KeyRound,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  UserCog,
  Bell,
  CreditCard,
  Cpu,
  Download,
  EyeOff,
  HardDrive,
  Play,
  RefreshCw,
  Square,
  Wifi
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DevPanel, type DevDashboardSection } from "../components/dev/DevPanel";
import { DevPlansPanel } from "../components/plans/DevPlansPanel";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import {
  createNexTechInvite,
  createDevFivemModule,
  deleteNexTechInvite,
  deleteDevFivemModule,
  deleteDevAccessEntry,
  generateNexTechInviteCode,
  getDashboardMe,
  getDevAccessEntries,
  getDevBots,
  getDiscloudBotLogs,
  getDiscloudMonitoring,
  getDevFivemModules,
  getNexTechInviteDashboard,
  getMaintenanceState,
  getLogs,
  getSystemHealth,
  getSystemMetrics,
  publishNexTechInvitePanel,
  sendMaintenanceAlert,
  saveDevAccessEntry,
  setMaintenanceMode,
  runDiscloudBotAction,
  updateDevBotModules,
  updateDevFivemModule,
  updateNexTechInvite
} from "../lib/api";
import { createDashboardSocket } from "../lib/socket";
import { dashboardUrl } from "../lib/urls";
import type { AuthResponse, BotResponseTimeStats, DashboardBot, DashboardMeResponse, DevAccessEntry, DevAccessRole, DevBot, DevBotStatus, DiscloudBotSnapshot, DiscloudHistoryEvent, DiscloudLogsResponse, DiscloudMonitoringResponse, FivemModuleDefinition, LogEntry, MaintenanceState, NexTechInvite, NexTechInviteDashboard, NexTechInviteStatus, SaveNexTechInvitePayload, SystemHealthResponse, SystemMetricsResponse } from "../types";

type DevDashboardProps = {
  auth: AuthResponse;
  initialView?: DevView;
  onLogout: () => void;
};

type DevView = "bots" | "connected" | "bot-menu" | "cloning" | "nextech" | "nextech-invites" | "sales" | "plans" | "monitoring" | "discloud" | "fivem" | "police" | "logs" | "access" | "maintenance";

type FiveMModuleView = FivemModuleDefinition & {
  icon: LucideIcon;
};

const MAINTENANCE_GIF_URL = "/maintenance/nft-coding.gif";

type DevNavItem = { icon: LucideIcon; id: DevView; label: string };

const DEV_NAV_GROUPS: Array<{ items: DevNavItem[]; label: string }> = [
  {
    label: "Principal",
    items: [
      { icon: LayoutDashboard, id: "bots", label: "Dashboard" },
      { icon: Boxes, id: "connected", label: "Bots conectados" },
      { icon: Settings, id: "bot-menu", label: "Menu do Bot" },
      { icon: Copy, id: "cloning", label: "Clonagem" }
    ]
  },
  {
    label: "NexTech",
    items: [
      { icon: Sparkles, id: "nextech", label: "Menu NexTech" },
      { icon: CreditCard, id: "sales", label: "Sistema de Vendas" },
      { icon: KeyRound, id: "nextech-invites", label: "Sistema de Convites" },
      { icon: PackagePlus, id: "plans", label: "Planos" }
    ]
  },
  {
    label: "Operação",
    items: [
      { icon: Activity, id: "monitoring", label: "Monitoramento" },
      { icon: HardDrive, id: "discloud", label: "DisCloud" },
      { icon: Building2, id: "fivem", label: "FiveM" },
      { icon: ShieldCheck, id: "police", label: "Polícia" },
      { icon: ScrollText, id: "logs", label: "Logs" },
      { icon: UserCog, id: "access", label: "Acessos DEV" },
      { icon: Wrench, id: "maintenance", label: "Manutenção" }
    ]
  }
];

const DEV_NAV_ITEMS = DEV_NAV_GROUPS.flatMap((group) => group.items);

export function DevDashboard({ auth, initialView = "bots", onLogout }: DevDashboardProps) {
  const [profile, setProfile] = useState<DashboardMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DevView>(initialView);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getDashboardMe()
      .then((nextProfile) => {
        if (!mounted) return;

        setLoadError(null);
        setProfile(nextProfile);
        const firstBot = nextProfile.bots[0] ?? null;
        setSelectedBotId((current) => current ?? firstBot?.id ?? null);
        setSelectedGuildId((current) => current ?? nextProfile.selectedGuildId ?? firstBot?.guildIds[0] ?? nextProfile.guilds[0]?.id ?? null);
      })
      .catch((error) => {
        if (mounted) {
          setLoadError(readDevDashboardError(error));
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  function handleBotCreated(bot: DashboardBot) {
    setSelectedBotId(bot.id);
    setSelectedGuildId(bot.guildIds[0] ?? bot.mainGuildId);
    setProfile((current) => current ? {
      ...current,
      bots: [bot, ...current.bots.filter((item) => item.id !== bot.id)]
    } : current);
  }

  function handleBotDeleted(botId: string) {
    setSelectedBotId((current) => current === botId ? null : current);
    setProfile((current) => current ? {
      ...current,
      bots: current.bots.filter((bot) => bot.id !== botId)
    } : current);
  }

  function handleBotUpdated(bot: DashboardBot) {
    setSelectedBotId((current) => current ?? bot.id);
    setProfile((current) => current ? {
      ...current,
      bots: current.bots.map((item) => item.id === bot.id ? bot : item)
    } : current);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-300" />
              Não foi possível abrir o DEV
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button className="w-full" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
            <Button className="w-full" onClick={onLogout} variant="outline">
              Sair e entrar de novo
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!profile?.canViewDev) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-300" />
              Acesso restrito
            </CardTitle>
            <CardDescription>Esta área é exclusiva do desenvolvedor.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => window.location.replace("/dashboard")}>
              <LayoutDashboard className="h-4 w-4" />
              Voltar para dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  function handleChangeView(view: DevView) {
    setActiveView(view);
    window.history.replaceState(null, "", devPathForView(view));
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,213,0,0.14),transparent_34%),linear-gradient(180deg,#050506,#08080b_48%,#050505)] text-white lg:pl-72">
      <DevMobileHeader
        activeView={activeView}
        onChangeView={handleChangeView}
        onLogout={onLogout}
      />
      <DevSidebar
        activeView={activeView}
        onChangeView={handleChangeView}
      />

      <div className="mx-auto grid min-w-0 w-full max-w-7xl gap-5 px-3 pb-6 pt-4 sm:px-4 sm:py-6 lg:gap-6 lg:px-8">
        {!isBotManagerView(activeView) ? <DevUserCard user={auth.user} canViewDev={profile.canViewDev} /> : null}

        {isBotManagerView(activeView) ? (
          <DevPanel
            activeDashboardSection={dashboardSectionForView(activeView)}
            guilds={profile.guilds}
            onBotCreated={handleBotCreated}
            onBotDeleted={handleBotDeleted}
            onBotUpdated={handleBotUpdated}
            onDashboardSectionChange={(section) => handleChangeView(section)}
            onOpenView={(view, bot) => {
              if (view === "overview") window.location.replace(dashboardUrl(bot?.slug));
            }}
            onSelectBot={setSelectedBotId}
            selectedBotId={selectedBotId}
            selectedGuildId={selectedGuildId}
            user={auth.user}
          />
        ) : null}

        {activeView === "nextech" ? (
          <DevNexTechHub onChangeView={handleChangeView} />
        ) : null}

        {activeView === "nextech-invites" ? (
          <DevNexTechInvitesPanel
            bots={profile.bots}
            guilds={profile.guilds}
            onBotUpdated={handleBotUpdated}
            onSelectBot={setSelectedBotId}
            selectedBotId={selectedBotId}
            selectedGuildId={selectedGuildId}
            onSelectGuild={setSelectedGuildId}
          />
        ) : null}

        {activeView === "sales" ? (
          <DevSalesManager
            bots={profile.bots}
            onBotUpdated={handleBotUpdated}
            selectedBotId={selectedBotId}
            onSelectBot={setSelectedBotId}
          />
        ) : null}

        {activeView === "fivem" ? (
          <DevFiveMManager
            bots={profile.bots}
            onBotUpdated={handleBotUpdated}
            selectedBotId={selectedBotId}
            onSelectBot={setSelectedBotId}
            scope="fivem"
          />
        ) : null}

        {activeView === "police" ? (
          <DevFiveMManager
            bots={profile.bots}
            onBotUpdated={handleBotUpdated}
            selectedBotId={selectedBotId}
            onSelectBot={setSelectedBotId}
            scope="police"
          />
        ) : null}

        {activeView === "plans" ? <DevPlansPanel /> : null}
        {activeView === "monitoring" ? <RealtimeSystemMonitoringPanel /> : null}
        {activeView === "discloud" ? <DiscloudMonitoringPanel /> : null}
        {activeView === "logs" ? <TechnicalLogsPanel botId={selectedBotId} guildId={selectedGuildId} /> : null}
        {activeView === "access" ? <DevAccessPanel /> : null}
        {activeView === "maintenance" ? <MaintenancePanel /> : null}
      </div>
    </main>
  );
}

function readDevDashboardError(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { status?: unknown; data?: { message?: unknown } } }).response;
    const message = typeof response?.data?.message === "string" ? response.data.message : null;

    if (response?.status === 401) {
      return "Sua sessão não chegou ao backend. Clique em Sair e entrar de novo para renovar os cookies.";
    }

    if (response?.status === 403) {
      return message ?? "Sua conta autenticada não possui acesso DEV.";
    }

    if (message) {
      return message;
    }
  }

  return "A consulta do perfil DEV falhou. Tente novamente em alguns segundos.";
}

function devPathForView(view: DevView) {
  if (view === "connected") return "/dev/bots-conectados";
  if (view === "bot-menu") return "/dev/menu-do-bot";
  if (view === "cloning") return "/dev/clonagem";
  if (view === "nextech") return "/dev/nextech";
  if (view === "nextech-invites") return "/dev/nextech/convites";
  if (view === "sales") return "/dev/sistema-de-vendas";
  if (view === "plans") return "/dev/planos";
  if (view === "monitoring") return "/dev/monitoramento";
  if (view === "discloud") return "/dev/discloud";
  if (view === "fivem") return "/dev/fivem";
  if (view === "police") return "/dev/policia";
  if (view === "logs") return "/dev/logs";
  if (view === "access") return "/dev/acessos";
  if (view === "maintenance") return "/dev/maintenance";
  return "/dev";
}

function isBotManagerView(view: DevView) {
  return view === "bots" || view === "connected" || view === "bot-menu" || view === "cloning";
}

function dashboardSectionForView(view: DevView): DevDashboardSection | null {
  if (view === "connected" || view === "bot-menu" || view === "cloning" || view === "sales") {
    return view;
  }

  return null;
}

function DevSidebar({
  activeView,
  onChangeView
}: {
  activeView: DevView;
  onChangeView: (view: DevView) => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-[#FFD500]/15 bg-[#08080b]/96 px-4 py-4 shadow-[22px_0_70px_rgba(0,0,0,0.48)] backdrop-blur-xl lg:flex">
      <div className="mb-5 flex h-12 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#FFEA70]/40 bg-[#FFD500]/15 text-[#FFEA70] shadow-[0_0_30px_rgba(255,213,0,0.24)]">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">Painel DEV</p>
          <p className="truncate text-xs font-medium text-zinc-300">Menu principal</p>
        </div>
      </div>
      <nav className="discord-scrollbar flex-1 space-y-1 overflow-y-auto pb-2">
        {DEV_NAV_GROUPS.map((group) => (
          <div className="space-y-1" key={group.label}>
            <p className="px-3 pt-3 text-[11px] font-black uppercase tracking-[0.22em] text-[#FFEA70]/70">{group.label}</p>
            {group.items.map((item) => (
              <button
                className={[
                  "group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition duration-300",
                  activeView === item.id
                    ? "bg-[#FFD500]/20 text-white ring-1 ring-[#FFEA70]/35 shadow-[0_0_24px_rgba(255,213,0,0.16)]"
                    : "text-zinc-300 hover:bg-[#FFD500]/10 hover:text-white hover:shadow-[0_0_22px_rgba(255,213,0,0.12)]"
                ].join(" ")}
                key={item.id}
                onClick={() => onChangeView(item.id)}
                type="button"
              >
                <item.icon className="h-4 w-4 text-[#FFEA70] transition group-hover:text-white" />
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function DevMobileHeader({
  activeView,
  onChangeView,
  onLogout
}: {
  activeView: DevView;
  onChangeView: (view: DevView) => void;
  onLogout: () => void;
}) {
  const activeItem = DEV_NAV_ITEMS.find((item) => item.id === activeView) ?? DEV_NAV_ITEMS[0]!;

  return (
    <header className="sticky top-0 z-30 border-b border-[#FFD500]/15 bg-[#07070a]/95 px-3 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.36)] backdrop-blur-xl lg:hidden">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#FFEA70]/35 bg-[#FFD500]/15 text-[#FFEA70]">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">Painel DEV</p>
          <p className="truncate text-xs font-medium text-zinc-400">{activeItem.label}</p>
        </div>
        <Button aria-label="Sair" className="h-10 w-10 shrink-0 p-0" onClick={onLogout} type="button" variant="outline">
          <PowerOff className="h-4 w-4" />
        </Button>
      </div>
      <select
        aria-label="Selecionar seção DEV"
        className="mt-3 h-11 w-full rounded-lg border border-[#FFD500]/20 bg-zinc-950 px-3 text-sm font-semibold text-zinc-100 outline-none transition focus:border-[#FFEA70]/60"
        onChange={(event) => onChangeView(event.target.value as DevView)}
        value={activeView}
      >
        {DEV_NAV_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </header>
  );
}

function DevUserCard({ canViewDev, user }: { canViewDev: boolean; user: AuthResponse["user"] }) {
  const banner = (user as AuthResponse["user"] & { bannerUrl?: string | null }).bannerUrl;

  return (
    <Card className="overflow-hidden border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(12,12,16,0.96))] shadow-[0_0_45px_rgba(255,213,0,0.10)] hover:translate-y-0">
      <div
        className="h-16 border-b border-[#FFD500]/15 bg-[radial-gradient(circle_at_20%_10%,rgba(255,213,0,0.42),transparent_34%),linear-gradient(135deg,rgba(88,101,242,0.38),rgba(9,9,11,0.2))]"
        style={banner ? { backgroundImage: `url(${banner})` } : undefined}
      />
      <CardContent className="-mt-8 flex flex-col gap-4 p-4 pt-0 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-end gap-3">
          <Avatar className="h-16 w-16 rounded-2xl border-4 border-[#111114] bg-zinc-900 text-base" fallback={user.globalName || user.username} src={user.avatarUrl ?? user.avatar} />
          <div className="min-w-0 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-white">{user.globalName || user.username}</h2>
              {canViewDev ? <Badge className="border-[#FFEA70]/40 bg-[#FFD500]/15 text-[#FFEA70]" variant="muted">Administrador DEV</Badge> : null}
            </div>
            <p className="truncate text-sm font-semibold text-zinc-200">@{user.username}</p>
            <p className="truncate font-mono text-xs text-zinc-400">Discord ID: {user.discordId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          Online
        </div>
      </CardContent>
    </Card>
  );
}

function DevNexTechHub({ onChangeView }: { onChangeView: (view: DevView) => void }) {
  const items = [
    {
      description: "Produtos, planos, cobranças, gateways e pedidos da loja NexTech.",
      icon: CreditCard,
      label: "Sistema de Vendas",
      stats: "Produtos e pagamentos",
      view: "sales" as DevView
    },
    {
      description: "Convites oficiais para controlar quais clientes e servidores podem usar a NexTech.",
      icon: KeyRound,
      label: "Sistema de Convites",
      stats: "Autorização por código",
      view: "nextech-invites" as DevView
    },
    {
      description: "Criação e liberação dos planos comerciais usados pela plataforma.",
      icon: PackagePlus,
      label: "Planos NexTech",
      stats: "Assinaturas e limites",
      view: "plans" as DevView
    }
  ];

  return (
    <div className="min-w-0 space-y-6">
      <section className="rounded-2xl border border-[#FFD500]/20 bg-[radial-gradient(circle_at_top_left,rgba(255,213,0,0.18),transparent_36%),linear-gradient(135deg,rgba(24,24,27,0.92),rgba(8,8,10,0.98))] p-5 shadow-[0_0_50px_rgba(255,213,0,0.10)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.22em] text-[#FFEA70]">
              <Sparkles className="h-4 w-4" />
              NexTech
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">Menu próprio da NexTech</h2>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-zinc-300">
              Área DEV separada para criar e administrar sistemas internos da NexTech sem misturar com os módulos dos bots dos clientes.
            </p>
          </div>
          <Badge className="border-[#FFEA70]/40 bg-[#FFD500]/15 text-[#FFEA70]" variant="muted">Somente DEV</Badge>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <Card className="border-[#FFD500]/18 bg-zinc-950/80 shadow-[0_0_30px_rgba(255,213,0,0.06)]" key={item.label}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]">
                  <item.icon className="h-5 w-5" />
                </span>
                {item.label}
              </CardTitle>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-black/35 px-3 py-2 text-sm font-semibold text-zinc-200">{item.stats}</div>
              <Button className="w-full" onClick={() => onChangeView(item.view)} type="button">
                <Sparkles className="h-4 w-4" />
                Abrir
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

const emptyInviteForm = {
  adminChannelId: "",
  alertChannelId: "",
  bannerUrl: "",
  blockUnknownInvites: true,
  buttonEmoji: "🔗",
  buttonLabel: "Entrar no Servidor",
  channelId: "",
  clientName: "",
  code: "",
  description: "Entre utilizando nosso convite oficial.",
  discordInviteId: "",
  expiresAt: "",
  footerText: "NexTech",
  guildName: "",
  imageUrl: "",
  inviteUrl: "",
  logChannelId: "",
  maxUses: "",
  name: "",
  notes: "",
  panelChannelId: "",
  panelColor: "#FFD500",
  panelTitle: "NEXTTECH",
  statsChannelId: "",
  status: "active" as NexTechInviteStatus,
  videoUrl: ""
};

function DevNexTechInvitesPanel({
  bots,
  guilds,
  onBotUpdated,
  onSelectBot,
  onSelectGuild,
  selectedBotId,
  selectedGuildId
}: {
  bots: DashboardBot[];
  guilds: DashboardMeResponse["guilds"];
  onBotUpdated: (bot: DashboardBot) => void;
  onSelectBot: (botId: string | null) => void;
  onSelectGuild: (guildId: string | null) => void;
  selectedBotId: string | null;
  selectedGuildId: string | null;
}) {
  const [dashboard, setDashboard] = useState<NexTechInviteDashboard | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyInviteForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishingPanel, setPublishingPanel] = useState(false);
  const [togglingModule, setTogglingModule] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectedBot = useMemo(() => bots.find((bot) => bot.id === selectedBotId) ?? bots[0] ?? null, [bots, selectedBotId]);
  const guildOptions = useMemo(() => selectedBot
    ? [...new Set([selectedBot.mainGuildId, ...selectedBot.guildIds, ...guilds.map((guild) => guild.id)].filter(Boolean))]
      .map((id) => ({
        id,
        name: guilds.find((guild) => guild.id === id)?.name ?? (id === selectedBot.mainGuildId ? selectedBot.mainGuildName || id : id)
      }))
    : [], [guilds, selectedBot]);
  const selectedScopeGuildId = selectedGuildId && guildOptions.some((guild) => guild.id === selectedGuildId)
    ? selectedGuildId
    : guildOptions[0]?.id ?? null;
  const moduleEnabled = selectedBot?.enabledModules.includes("nextech-invites") ?? false;

  useEffect(() => {
    if (selectedBot && selectedBot.id !== selectedBotId) {
      onSelectBot(selectedBot.id);
    }
  }, [onSelectBot, selectedBot, selectedBotId]);

  useEffect(() => {
    if (selectedScopeGuildId && selectedScopeGuildId !== selectedGuildId) {
      onSelectGuild(selectedScopeGuildId);
    }
  }, [onSelectGuild, selectedGuildId, selectedScopeGuildId]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      clientName: current.clientName || selectedBot?.name || "",
      guildName: guildOptions.find((guild) => guild.id === selectedScopeGuildId)?.name ?? "",
      name: current.name || "Convite Oficial",
      panelTitle: current.panelTitle || "NEXTTECH"
    }));
  }, [guildOptions, selectedBot?.name, selectedScopeGuildId]);

  useEffect(() => {
    if (!selectedBot || !selectedScopeGuildId) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    getNexTechInviteDashboard(selectedBot.id, selectedScopeGuildId)
      .then((data) => {
        if (mounted) setDashboard(data);
      })
      .catch((error) => {
        if (mounted) setMessage(readRequestMessage(error) ?? "Não foi possível carregar os convites NexTech.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const socket = createDashboardSocket();
    socket.on("nextech-invites:updated", (data: NexTechInviteDashboard) => {
      const scoped = data.officialInvite?.botId === selectedBot.id && data.officialInvite?.guildId === selectedScopeGuildId;
      if (scoped) setDashboard(data);
    });

    return () => {
      mounted = false;
      socket.disconnect();
    };
  }, [selectedBot?.id, selectedScopeGuildId]);

  async function reload() {
    if (!selectedBot || !selectedScopeGuildId) return;
    setLoading(true);
    try {
      setDashboard(await getNexTechInviteDashboard(selectedBot.id, selectedScopeGuildId));
      setMessage(null);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível atualizar os convites.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateCode() {
    try {
      const code = await generateNexTechInviteCode();
      setForm((current) => ({ ...current, code }));
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível gerar o código.");
    }
  }

  function editInvite(invite: NexTechInvite) {
    setEditingId(invite.id);
    setForm({
      adminChannelId: invite.adminChannelId ?? "",
      alertChannelId: invite.alertChannelId ?? "",
      bannerUrl: invite.bannerUrl ?? "",
      blockUnknownInvites: invite.blockUnknownInvites ?? true,
      buttonEmoji: invite.buttonEmoji ?? "🔗",
      buttonLabel: invite.buttonLabel ?? "Entrar no Servidor",
      channelId: invite.channelId ?? "",
      clientName: invite.clientName,
      code: invite.code,
      description: invite.description ?? "",
      discordInviteId: invite.discordInviteId ?? "",
      expiresAt: toDatetimeLocal(invite.expiresAt),
      footerText: invite.footerText ?? "NexTech",
      guildName: invite.guildName ?? "",
      imageUrl: invite.imageUrl ?? "",
      inviteUrl: invite.inviteUrl ?? "",
      logChannelId: invite.logChannelId ?? "",
      maxUses: invite.maxUses === null ? "" : String(invite.maxUses),
      name: invite.name,
      notes: invite.notes ?? "",
      panelChannelId: invite.panelChannelId ?? "",
      panelColor: invite.panelColor ?? "#FFD500",
      panelTitle: invite.panelTitle ?? "NEXTTECH",
      statsChannelId: invite.statsChannelId ?? "",
      status: invite.status,
      videoUrl: invite.videoUrl ?? ""
    });
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyInviteForm);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedBot || !selectedScopeGuildId) {
      setMessage("Selecione um bot e um servidor antes de salvar o convite oficial.");
      return;
    }

    const payload: SaveNexTechInvitePayload = {
      adminChannelId: form.adminChannelId || null,
      alertChannelId: form.alertChannelId || null,
      bannerUrl: form.bannerUrl || null,
      blockUnknownInvites: form.blockUnknownInvites,
      botId: selectedBot.id,
      buttonEmoji: form.buttonEmoji || null,
      buttonLabel: form.buttonLabel || null,
      channelId: form.channelId || null,
      clientName: form.clientName,
      code: form.code || null,
      description: form.description || null,
      discordInviteId: form.discordInviteId || null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      footerText: form.footerText || null,
      guildId: selectedScopeGuildId,
      guildName: guildOptions.find((guild) => guild.id === selectedScopeGuildId)?.name ?? (form.guildName || null),
      imageUrl: form.imageUrl || null,
      inviteUrl: form.inviteUrl || null,
      logChannelId: form.logChannelId || null,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      name: form.name,
      notes: form.notes || null,
      panelChannelId: form.panelChannelId || null,
      panelColor: form.panelColor || null,
      panelTitle: form.panelTitle || null,
      statsChannelId: form.statsChannelId || null,
      status: form.status,
      videoUrl: form.videoUrl || null
    };

    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        await updateNexTechInvite(editingId, payload, selectedBot.id, selectedScopeGuildId);
        setMessage("Convite atualizado.");
      } else {
        await createNexTechInvite(payload, selectedBot.id, selectedScopeGuildId);
        setMessage("Convite criado.");
      }
      resetForm();
      await reload();
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o convite.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(invite: NexTechInvite, status: NexTechInviteStatus) {
    setMessage(null);
    try {
      await updateNexTechInvite(invite.id, { status }, selectedBot?.id, selectedScopeGuildId);
      await reload();
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível alterar o status.");
    }
  }

  async function handleDelete(invite: NexTechInvite) {
    if (!window.confirm(`Excluir o convite ${invite.code}?`)) return;
    setMessage(null);
    try {
      await deleteNexTechInvite(invite.id);
      await reload();
      setMessage("Convite excluído.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível excluir o convite.");
    }
  }

  async function handleToggleInviteModule(checked: boolean) {
    if (!selectedBot) return;
    const nextModules = checked
      ? [...new Set([...selectedBot.enabledModules, "nextech-invites"])]
      : selectedBot.enabledModules.filter((moduleId) => moduleId !== "nextech-invites");

    setTogglingModule(true);
    setMessage(null);
    try {
      const updated = await updateDevBotModules(selectedBot.id, nextModules);
      onBotUpdated(updated);
      setMessage(checked ? "Sistema de Convites liberado para este bot." : "Sistema de Convites bloqueado para este bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível alterar o módulo de convites.");
    } finally {
      setTogglingModule(false);
    }
  }

  async function handlePublishInvitePanel() {
    if (!selectedBot || !selectedScopeGuildId) {
      setMessage("Selecione um bot e um servidor antes de postar o painel.");
      return;
    }

    const invite = dashboard?.officialInvite ?? dashboard?.invites.find((item) => item.status === "active") ?? null;
    if (!invite || invite.status !== "active") {
      setMessage("Cadastre um convite oficial ativo antes de postar o painel.");
      return;
    }

    if (!invite.panelChannelId) {
      setMessage("Configure o canal do painel no convite oficial antes de postar.");
      return;
    }

    setPublishingPanel(true);
    setMessage(null);

    try {
      await publishNexTechInvitePanel(selectedBot.id, selectedScopeGuildId);
      await reload();
      setMessage("Painel do Sistema de Convites postado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível postar o painel de convites.");
    } finally {
      setPublishingPanel(false);
    }
  }

  const invites = dashboard?.invites ?? [];
  const logs = dashboard?.logs ?? [];
  const stats = dashboard?.stats ?? { active: 0, blockedInvites: 0, cancelled: 0, clicks: 0, conversions: 0, expired: 0, memberCount: 0, paused: 0, remainingUses: 0, totalUses: 0 };
  const officialInvite = dashboard?.officialInvite ?? invites.find((invite) => invite.status === "active") ?? null;

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.22em] text-[#FFEA70]">
            <KeyRound className="h-4 w-4" />
            NexTech
          </div>
          <h2 className="mt-2 text-2xl font-black text-white">Sistema de Convites</h2>
          <p className="mt-1 text-sm font-medium text-zinc-400">Convite oficial por bot e servidor, com bloqueio de convites não autorizados e logs em tempo real.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={publishingPanel || !moduleEnabled || !officialInvite?.panelChannelId} onClick={() => void handlePublishInvitePanel()} type="button" variant="outline">
            {publishingPanel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Postar painel
          </Button>
          <Button disabled={loading} onClick={() => void reload()} type="button" variant="outline">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Atualizar
          </Button>
        </div>
      </section>

      {message ? <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}

      <Card className="border-[#FFD500]/18 bg-zinc-950/80">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">Bot</label>
            <select
              className="h-10 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none focus:border-[#FFEA70]/60"
              onChange={(event) => onSelectBot(event.target.value || null)}
              value={selectedBot?.id ?? ""}
            >
              {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">Servidor</label>
            <select
              className="h-10 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none focus:border-[#FFEA70]/60"
              onChange={(event) => onSelectGuild(event.target.value || null)}
              value={selectedScopeGuildId ?? ""}
            >
              {guildOptions.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black/30 px-4 py-3">
            {togglingModule ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : <KeyRound className="h-4 w-4 text-[#FFEA70]" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Módulo do Bot</p>
              <p className="text-xs font-semibold text-zinc-400">{moduleEnabled ? "Liberado" : "Bloqueado"}</p>
            </div>
            <Switch checked={moduleEnabled} disabled={!selectedBot || togglingModule} onCheckedChange={(checked) => void handleToggleInviteModule(checked)} />
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <NexTechInviteStat label="Ativos" value={stats.active} tone="good" />
        <NexTechInviteStat label="Cliques" value={stats.clicks} tone="good" />
        <NexTechInviteStat label="Entradas" value={stats.memberCount || stats.totalUses} tone="good" />
        <NexTechInviteStat label="Bloqueados" value={stats.blockedInvites} tone="danger" />
        <NexTechInviteStat label="Utilizações" value={stats.totalUses} tone="good" />
        <NexTechInviteStat label="Restantes" value={stats.remainingUses} tone="warn" />
      </section>

      <Card className="border-[#FFD500]/18 bg-[linear-gradient(135deg,rgba(255,213,0,0.12),rgba(9,9,11,0.92))]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-[#FFEA70]" />Convite Oficial</CardTitle>
          <CardDescription>Somente esse link deve ser aceito quando o bloqueio de convites estiver ativo.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-4">
          <NexTechInviteDetail label="Status" value={officialInvite ? officialInvite.status : "Não cadastrado"} />
          <NexTechInviteDetail label="Código" value={officialInvite?.code ?? "Nenhum"} />
          <NexTechInviteDetail label="URL" value={officialInvite?.inviteUrl ?? "Configure abaixo"} />
          <NexTechInviteDetail label="Bloqueio" value={officialInvite?.blockUnknownInvites ? "Ativo" : "Inativo"} />
        </CardContent>
      </Card>

      <Card className="border-[#FFD500]/18 bg-zinc-950/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-[#FFEA70]" />{editingId ? "Editar convite oficial" : "Cadastrar Convite Oficial"}</CardTitle>
          <CardDescription>Cadastro único do convite aceito pelo bot, canais, visual do painel e regras de bloqueio.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 lg:grid-cols-2" onSubmit={handleSubmit}>
            <DevTextInput label="Nome do convite" required value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} />
            <DevTextInput label="Servidor / Cliente" required value={form.clientName} onChange={(clientName) => setForm((current) => ({ ...current, clientName }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">Código do convite</label>
              <div className="flex gap-2">
                <input className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 font-mono text-sm font-semibold text-white outline-none focus:border-[#FFEA70]/60" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="nextech ou abc123" />
                <Button onClick={() => void handleGenerateCode()} type="button" variant="outline">Gerar</Button>
              </div>
            </div>
            <DevTextInput label="Link completo" type="url" value={form.inviteUrl} onChange={(inviteUrl) => setForm((current) => ({ ...current, inviteUrl }))} />
            <DevTextInput label="Limite de usos" min={1} type="number" value={form.maxUses} onChange={(maxUses) => setForm((current) => ({ ...current, maxUses }))} />
            <DevTextInput label="Expiração" type="datetime-local" value={form.expiresAt} onChange={(expiresAt) => setForm((current) => ({ ...current, expiresAt }))} />
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">Status</label>
              <select className="h-10 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none focus:border-[#FFEA70]/60" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as NexTechInviteStatus }))}>
                <option value="active">Ativo</option>
                <option value="paused">Pausado</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/30 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-white">Bloquear outros convites</p>
                <p className="text-xs font-semibold text-zinc-500">Remove mensagens com discord.gg diferente do convite oficial.</p>
              </div>
              <Switch checked={form.blockUnknownInvites} onCheckedChange={(blockUnknownInvites) => setForm((current) => ({ ...current, blockUnknownInvites }))} />
            </div>
            <DevTextInput label="Canal do painel" value={form.panelChannelId} onChange={(panelChannelId) => setForm((current) => ({ ...current, panelChannelId: panelChannelId.replace(/\D/g, "") }))} />
            <DevTextInput label="Canal dos logs" value={form.logChannelId} onChange={(logChannelId) => setForm((current) => ({ ...current, logChannelId: logChannelId.replace(/\D/g, "") }))} />
            <DevTextInput label="Canal dos avisos" value={form.alertChannelId} onChange={(alertChannelId) => setForm((current) => ({ ...current, alertChannelId: alertChannelId.replace(/\D/g, "") }))} />
            <DevTextInput label="Canal das estatísticas" value={form.statsChannelId} onChange={(statsChannelId) => setForm((current) => ({ ...current, statsChannelId: statsChannelId.replace(/\D/g, "") }))} />
            <DevTextInput label="Canal administrativo" value={form.adminChannelId} onChange={(adminChannelId) => setForm((current) => ({ ...current, adminChannelId: adminChannelId.replace(/\D/g, "") }))} />
            <DevTextInput label="Canal permitido para divulgar" value={form.channelId} onChange={(channelId) => setForm((current) => ({ ...current, channelId: channelId.replace(/\D/g, "") }))} />
            <DevTextInput label="Título do painel" value={form.panelTitle} onChange={(panelTitle) => setForm((current) => ({ ...current, panelTitle }))} />
            <DevTextInput label="Descrição do painel" value={form.description} onChange={(description) => setForm((current) => ({ ...current, description }))} />
            <DevTextInput label="Cor do painel" value={form.panelColor} onChange={(panelColor) => setForm((current) => ({ ...current, panelColor }))} />
            <DevTextInput label="Banner / imagem / GIF" type="url" value={form.imageUrl} onChange={(imageUrl) => setForm((current) => ({ ...current, imageUrl }))} />
            <DevTextInput label="Vídeo" type="url" value={form.videoUrl} onChange={(videoUrl) => setForm((current) => ({ ...current, videoUrl }))} />
            <DevTextInput label="Texto do botão" value={form.buttonLabel} onChange={(buttonLabel) => setForm((current) => ({ ...current, buttonLabel }))} />
            <DevTextInput label="Emoji do botão" value={form.buttonEmoji} onChange={(buttonEmoji) => setForm((current) => ({ ...current, buttonEmoji }))} />
            <DevTextInput label="Rodapé" value={form.footerText} onChange={(footerText) => setForm((current) => ({ ...current, footerText }))} />
            <div className="space-y-1 lg:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">Observações</label>
              <textarea className="min-h-24 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-[#FFEA70]/60" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Detalhes internos do cliente, liberação ou restrição." />
            </div>
            <div className="flex flex-wrap gap-2 lg:col-span-2">
              <Button disabled={saving || !selectedBot || !selectedScopeGuildId} type="submit">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {editingId ? "Salvar alterações" : "Salvar convite oficial"}
              </Button>
              {editingId ? <Button onClick={resetForm} type="button" variant="outline">Cancelar edição</Button> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/80">
        <CardHeader>
          <CardTitle>Convites cadastrados</CardTitle>
          <CardDescription>Códigos únicos, cliente, limite de uso e status operacional.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Usos</th>
                <th className="px-3 py-2">Expiração</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr className="border-t border-zinc-900" key={invite.id}>
                  <td className="px-3 py-3 font-mono text-xs font-bold text-[#FFEA70]">{invite.code}</td>
                  <td className="px-3 py-3 font-semibold text-white">{invite.clientName}</td>
                  <td className="px-3 py-3 text-zinc-300">{invite.name}</td>
                  <td className="px-3 py-3 text-zinc-300">{invite.usedCount}/{invite.maxUses ?? "∞"}</td>
                  <td className="px-3 py-3 text-zinc-400">{invite.expiresAt ? formatDate(invite.expiresAt) : "Sem expiração"}</td>
                  <td className="px-3 py-3"><NexTechInviteStatusBadge status={invite.status} /></td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => editInvite(invite)} size="sm" type="button" variant="outline"><Pencil className="h-4 w-4" />Editar</Button>
                      <Button onClick={() => void handleStatus(invite, invite.status === "active" ? "paused" : "active")} size="sm" type="button" variant="outline">{invite.status === "active" ? "Pausar" : "Ativar"}</Button>
                      <Button onClick={() => void handleDelete(invite)} size="sm" type="button" variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!invites.length ? <p className="py-8 text-center text-sm font-medium text-zinc-500">Nenhum convite cadastrado ainda.</p> : null}
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/80">
        <CardHeader>
          <CardTitle>Logs do sistema de convites</CardTitle>
          <CardDescription>Auditoria das ações realizadas por desenvolvedores.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {logs.slice(0, 12).map((log) => (
            <div className="grid gap-2 rounded-lg border border-zinc-900 bg-black/35 p-3 text-sm md:grid-cols-[170px_1fr_180px]" key={log.id}>
              <span className="font-mono text-xs text-zinc-500">{formatDate(log.createdAt)}</span>
              <span className="font-semibold text-zinc-100">{inviteLogLabel(log.action)} {log.inviteCode ? <span className="text-[#FFEA70]">{log.inviteCode}</span> : null}</span>
              <span className="text-zinc-400">{log.actorName ?? log.actorId ?? "Sistema"}</span>
            </div>
          ))}
          {!logs.length ? <p className="py-6 text-center text-sm text-zinc-500">Nenhum log registrado.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function DevTextInput({
  label,
  min,
  onChange,
  required,
  type = "text",
  value
}: {
  label: string;
  min?: number;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</label>
      <input className="h-10 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none focus:border-[#FFEA70]/60" min={min} required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function NexTechInviteStat({ label, tone, value }: { label: string; tone: "good" | "warn" | "danger"; value: number }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass(tone)}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function NexTechInviteDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800/80 bg-black/35 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-white">{value}</p>
    </div>
  );
}

function NexTechInviteStatusBadge({ status }: { status: NexTechInviteStatus }) {
  const labels: Record<NexTechInviteStatus, string> = {
    active: "Ativo",
    cancelled: "Cancelado",
    expired: "Expirado",
    paused: "Pausado"
  };
  const tone: Record<NexTechInviteStatus, "success" | "warning" | "danger" | "muted"> = {
    active: "success",
    cancelled: "danger",
    expired: "danger",
    paused: "warning"
  };
  return <Badge variant={tone[status]}>{labels[status]}</Badge>;
}

function inviteLogLabel(action: string) {
  const labels: Record<string, string> = {
    "invite.created": "Convite criado",
    "invite.deleted": "Convite excluído",
    "invite.updated": "Convite atualizado"
  };
  return labels[action] ?? action;
}

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function RealtimeSystemMonitoringPanel() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [metrics, setMetrics] = useState<SystemMetricsResponse | null>(null);
  const [bots, setBots] = useState<DevBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [refreshNow, setRefreshNow] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = createDashboardSocket();

    socket.on("dev:bot_updated", (bot: DevBot) => {
      setBots((current) => current.map((item) => item.id === bot.id ? bot : item));
    });
    socket.on("dev:bot_created", (bot: DevBot) => {
      setBots((current) => [bot, ...current.filter((item) => item.id !== bot.id)]);
    });
    socket.on("dev:bot_deleted", (bot: DevBot) => {
      setBots((current) => current.filter((item) => item.id !== bot.id));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function loadBots() {
      try {
        const nextBots = await getDevBots();
        if (mounted) setBots(nextBots);
      } catch {
        if (mounted) setBots((current) => current);
      }
    }

    void loadBots();
    timer = window.setInterval(() => {
      if (!paused) void loadBots();
    }, 5000);

    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, [paused, refreshNow]);

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    let timer: number | undefined;

    async function load() {
      if (inFlight) return;
      inFlight = true;

      try {
        const [nextHealth, nextMetrics] = await Promise.all([
          getSystemHealth(),
          getSystemMetrics()
        ]);

        if (!mounted) return;
        setHealth(nextHealth);
        setMetrics(nextMetrics);
        setMessage(null);
      } catch (error) {
        if (mounted) setMessage(readRequestMessage(error) ?? "Não foi possível carregar o monitoramento em tempo real.");
      } finally {
        inFlight = false;
        if (mounted) setLoading(false);
      }
    }

    void load();
    timer = window.setInterval(() => {
      if (!paused) void load();
    }, 1000);

    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, [paused, refreshNow]);

  const bot = health?.bot ?? null;
  const jobs = health?.jobs ?? metrics?.jobs ?? null;
  const routes = metrics?.metrics.routes ?? [];
  const routeErrors = routes.reduce((total, route) => total + route.errors, 0);
  const heapUsed = metrics ? bytesToMb(metrics.metrics.memory.heapUsed) : null;
  const heapTotal = metrics ? bytesToMb(metrics.metrics.memory.heapTotal) : null;
  const rss = metrics ? bytesToMb(metrics.metrics.memory.rss) : null;
  const statusTone = health?.status === "ok" && metrics?.status === "ok" ? "good" : "warn";
  const botResponseTone = responseTimeTone(bot?.responseTime?.status ?? (bot?.online ? "good" : "offline"));
  const botTone = bot?.online ? botResponseTone : "danger";
  const dbTone = health?.database.ok ? "good" : "danger";
  const redisTone = health?.redis.ok || !health?.redis.configured ? "good" : "danger";
  const readyBots = bots.filter((item) => isDevBotReadyStatus(item.status)).length;
  const errorBots = bots.filter((item) => isDevBotErrorStatus(item.status)).length;
  const apiRequests = routes
    .filter((route) => route.route.startsWith("/api") || route.route.includes("/bot/"))
    .reduce((total, route) => total + route.requests, 0);

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Monitoramento em tempo real</h2>
          <p className="mt-1 text-sm text-zinc-400">Sistema, bot, banco, filas e rotas atualizados a cada 1 segundo.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button className="w-full sm:w-auto" onClick={() => setPaused((current) => !current)} variant="outline">
            {paused ? <Play className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {paused ? "Retomar" : "Pausar"}
          </Button>
          <Button className="w-full sm:w-auto" disabled={loading} onClick={() => setRefreshNow((current) => current + 1)} variant="outline">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Atualizar
          </Button>
        </div>
      </section>

      {message ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100">{message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <RealtimeStatCard icon={Activity} label="Sistema" tone={statusTone} value={health?.status ?? "-"} detail={metrics ? `Uptime ${formatUptime(metrics.metrics.uptimeSeconds)}` : "Aguardando leitura"} />
        <RealtimeStatCard icon={Wifi} label="Site/API" tone={statusTone} value={health?.status === "ok" ? "Online" : "Degradado"} detail={`${apiRequests} chamadas monitoradas`} />
        <RealtimeStatCard icon={Wifi} label="Bot principal" tone={botTone} value={bot?.online ? responseTimeLabel(bot?.responseTime?.status ?? "good") : "Offline"} detail={`Resposta ${msLabel(bot?.responseTime?.currentMs ?? bot?.latency ?? null)}`} />
        <RealtimeStatCard icon={Users} label="Bots cadastrados" tone={errorBots > 0 ? "warn" : "good"} value={`${readyBots}/${bots.length}`} detail={`${errorBots} com erro`} />
        <RealtimeStatCard icon={HardDrive} label="Banco" tone={dbTone} value={health?.database.status ?? "-"} detail={health?.database.latencyMs !== undefined ? `${health.database.latencyMs}ms` : health?.database.message ?? "Sem latência"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card className="border-zinc-800/80 bg-zinc-950/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Bot principal</CardTitle>
            <CardDescription>
              Última leitura {secondsSince(health?.timestamp ?? null, now)}s atrás {paused ? "(pausado)" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14 rounded-xl border border-zinc-700" fallback={bot?.botProfile?.username ?? "Bot"} src={bot?.botProfile?.avatarUrl ?? undefined} />
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-white">{bot?.botProfile?.username ?? "Bot não identificado"}</p>
                <p className="truncate font-mono text-xs text-zinc-500">{bot?.botId ?? bot?.botProfile?.id ?? "sem id"}</p>
              </div>
              <RealtimeStatusPill tone={botTone}>{bot?.online ? "Online" : "Offline"}</RealtimeStatusPill>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <RealtimeMiniMetric label="Servidores" value={String(bot?.guilds ?? 0)} />
              <RealtimeMiniMetric label="Usuários" value={String(bot?.users ?? 0)} />
              <RealtimeMiniMetric label="Shards" value={String(bot?.shardCount ?? bot?.shardIds?.length ?? 1)} />
              <RealtimeMiniMetric label="Memória do bot" value={`${mbLabel(bot?.memory?.heapUsedMb ?? null)} / ${mbLabel(bot?.memory?.rssMb ?? null)}`} />
            </div>

            <BotResponseTimePanel responseTime={bot?.responseTime ?? null} />

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Servidores recentes</p>
              {(bot?.botGuilds ?? []).slice(0, 6).map((guild) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-black/35 px-3 py-2" key={guild.id}>
                  <span className="truncate text-sm font-semibold text-zinc-100">{guild.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{guild.memberCount ?? 0} membros</span>
                </div>
              ))}
              {bot?.botGuilds.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-sm text-zinc-500">Nenhum servidor carregado.</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800/80 bg-zinc-950/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5" />Backend e infraestrutura</CardTitle>
            <CardDescription>{metrics ? `Processo iniciado em ${formatDate(metrics.metrics.startedAt)}` : "Aguardando métricas"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <RealtimeMiniMetric label="Heap" value={`${mbLabel(heapUsed)} / ${mbLabel(heapTotal)}`} />
              <RealtimeMiniMetric label="RSS" value={mbLabel(rss)} />
              <RealtimeMiniMetric label="Load 1m" value={metrics?.metrics.cpu.loadAverage[0]?.toFixed(2) ?? "-"} />
              <RealtimeMiniMetric label="Erros em rotas" value={String(routeErrors)} />
              <RealtimeMiniMetric label="Redis" value={health?.redis.configured ? health.redis.status : "não configurado"} tone={redisTone} />
              <RealtimeMiniMetric label="E-mail" value={health?.mail.configured ? health.mail.status : "não configurado"} tone={health?.mail.ok || !health?.mail.configured ? "good" : "danger"} />
              <RealtimeMiniMetric label="Workers ativos" value={String(jobs?.activeWorkers ?? 0)} />
              <RealtimeMiniMetric label="Falhas 24h" value={String(jobs?.failedLast24Hours ?? 0)} tone={(jobs?.failedLast24Hours ?? 0) > 0 ? "warn" : "good"} />
            </div>

            {jobs?.lastError ? (
              <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs font-semibold text-red-100">
                Último erro em jobs: {jobs.lastError}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="border-zinc-800/80 bg-zinc-950/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Bots cadastrados e uso da API</CardTitle>
          <CardDescription>Lista todos os bots da sua plataforma, incluindo os que conectam no backend usando a API da NexTech.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <RealtimeMiniMetric label="Registrados" value={String(bots.length)} />
            <RealtimeMiniMetric label="Online/prontos" value={String(readyBots)} />
            <RealtimeMiniMetric label="Com erro" value={String(errorBots)} tone={errorBots > 0 ? "warn" : "good"} />
            <RealtimeMiniMetric label="Chamadas API" value={String(apiRequests)} />
          </div>

          {bots.length ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {bots.map((registeredBot) => (
                <div className="flex items-center gap-3 rounded-lg border border-zinc-900 bg-black/35 p-3" key={registeredBot.id}>
                  <Avatar className="h-11 w-11 rounded-xl border border-zinc-700" fallback={registeredBot.name} src={registeredBot.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-white">{registeredBot.name}</p>
                      <Badge variant={isDevBotReadyStatus(registeredBot.status) ? "success" : isDevBotErrorStatus(registeredBot.status) ? "danger" : registeredBot.status === "degraded" ? "warning" : "muted"}>
                        {devBotStatusLabel(registeredBot.status)}
                      </Badge>
                    </div>
                    <p className="truncate text-xs font-medium text-zinc-300">{registeredBot.mainGuildName || registeredBot.mainGuildId}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-500">clientId={registeredBot.clientId} atualizado {secondsSince(registeredBot.updatedAt, now)}s atrás</p>
                  </div>
                  <div className="hidden shrink-0 text-right text-xs font-semibold text-zinc-400 sm:block">
                    <p>{registeredBot.guildIds.length} servidores</p>
                    <p>{registeredBot.enabledModules.length} módulos</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
              Nenhum bot cadastrado para monitorar.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800/80 bg-zinc-950/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" />Rotas do backend</CardTitle>
          <CardDescription>Top 12 rotas por requisições, com erros e tempo médio.</CardDescription>
        </CardHeader>
        <CardContent>
          {routes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr className="border-b border-zinc-900">
                    <th className="py-2 pr-3">Rota</th>
                    <th className="py-2 pr-3">Requisições</th>
                    <th className="py-2 pr-3">Erros</th>
                    <th className="py-2 pr-3">Tempo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.slice(0, 12).map((route) => (
                    <tr className="border-b border-zinc-900/70 text-zinc-200" key={route.route}>
                      <td className="max-w-[360px] truncate py-2 pr-3 font-mono text-xs text-zinc-300">{route.route}</td>
                      <td className="py-2 pr-3 font-semibold">{route.requests}</td>
                      <td className={route.errors > 0 ? "py-2 pr-3 font-semibold text-red-200" : "py-2 pr-3 font-semibold text-emerald-200"}>{route.errors}</td>
                      <td className="py-2 pr-3">{route.avgDurationMs.toFixed(1)}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
              Nenhuma métrica de rota registrada ainda.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RealtimeStatCard({
  detail,
  icon: Icon,
  label,
  tone,
  value
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone: "good" | "warn" | "danger";
  value: string;
}) {
  return (
    <Card className={`border-zinc-800/80 bg-zinc-950/80 ${tone === "danger" ? "ring-1 ring-red-500/25" : tone === "warn" ? "ring-1 ring-amber-400/20" : ""}`}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${toneClass(tone)}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
          <p className="truncate text-lg font-bold text-white">{value}</p>
          <p className="truncate text-xs text-zinc-400">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BotResponseTimePanel({ responseTime }: { responseTime: BotResponseTimeStats | null }) {
  const history = responseTime?.history.slice(-60) ?? [];
  const tone = responseTimeTone(responseTime?.status ?? "offline");

  return (
    <div className="rounded-lg border border-zinc-900 bg-black/35 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tempo de resposta do bot</p>
          <p className={`mt-1 text-lg font-black ${toneTextClass(tone)}`}>
            {msLabel(responseTime?.currentMs ?? null)}
          </p>
        </div>
        <RealtimeStatusPill tone={tone}>{responseTimeLabel(responseTime?.status ?? "offline")}</RealtimeStatusPill>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <RealtimeMiniMetric label="Média" value={msLabel(responseTime?.averageMs ?? null)} tone={tone} />
        <RealtimeMiniMetric label="Pico" value={msLabel(responseTime?.maxMs ?? null)} tone={responseTimeTone(latencyStatusFromMs(responseTime?.maxMs ?? null))} />
        <RealtimeMiniMetric label="Menor" value={msLabel(responseTime?.minMs ?? null)} />
      </div>

      <div className="mt-3 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(60,minmax(0,1fr))]">
        {history.length ? history.map((point) => (
          <span
            className={`h-7 rounded-sm ${responseTimeBarClass(point.status)}`}
            key={`${point.at}-${point.latencyMs ?? "off"}`}
            title={`${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(point.at))} - ${responseTimeLabel(point.status)} - ${msLabel(point.latencyMs)}`}
          />
        )) : Array.from({ length: 30 }, (_, index) => (
          <span className="h-7 rounded-sm bg-zinc-800" key={`empty-${index}`} />
        ))}
      </div>

      <p className="mt-2 text-[11px] font-medium text-zinc-500">
        Atualização a cada 5 segundos. Última leitura: {responseTime?.updatedAt ? `${secondsSince(responseTime.updatedAt, Date.now())}s atrás` : "-"}.
      </p>
    </div>
  );
}

function RealtimeMiniMetric({
  label,
  tone = "good",
  value
}: {
  label: string;
  tone?: "good" | "warn" | "danger";
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-black/35 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-bold ${toneTextClass(tone)}`}>{value}</p>
    </div>
  );
}

function RealtimeStatusPill({
  children,
  tone
}: {
  children: string;
  tone: "good" | "warn" | "danger";
}) {
  return (
    <span className={`ml-auto inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-bold ${toneClass(tone)}`}>
      {children}
    </span>
  );
}

function DiscloudMonitoringPanel() {
  const [data, setData] = useState<DiscloudMonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [logs, setLogs] = useState<DiscloudLogsResponse | null>(null);
  const [logsQuery, setLogsQuery] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedBot = data?.bots.find((bot) => bot.botId === selectedBotId) ?? data?.bots[0] ?? null;
  const totals = {
    apps: data?.bots.length ?? 0,
    alerts: data?.bots.reduce((total, bot) => total + bot.alerts.length, 0) ?? 0,
    offline: data?.bots.filter((bot) => bot.status === "offline").length ?? 0,
    online: data?.bots.filter((bot) => bot.status === "online").length ?? 0
  };

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function load(refresh = false) {
      try {
        const nextData = await getDiscloudMonitoring(refresh);
        if (!mounted) return;
        setData(nextData);
        setSelectedBotId((current) => current ?? nextData.bots[0]?.botId ?? null);
        setMessage(nextData.configured ? null : "DISCLOUD_TOKEN não configurado no backend.");
      } catch (error) {
        if (mounted) setMessage(readRequestMessage(error) ?? "Não foi possível consultar a DisCloud.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load(true);
    timer = window.setInterval(() => void load(), 5000);

    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  async function loadLogs(botId = selectedBot?.botId) {
    if (!botId) return;
    setBusyAction(`logs:${botId}`);
    setMessage(null);

    try {
      setLogs(await getDiscloudBotLogs(botId));
      setSelectedBotId(botId);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível carregar logs da DisCloud.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAction(bot: DiscloudBotSnapshot, action: "start" | "stop" | "restart" | "redeploy") {
    const labels = {
      redeploy: "fazer redeploy",
      restart: "reiniciar",
      start: "iniciar",
      stop: "parar"
    };

    if (!window.confirm(`Confirmar ${labels[action]} em ${bot.appName}?`)) {
      return;
    }

    setBusyAction(`${action}:${bot.botId}`);
    setMessage(null);

    try {
      const nextData = await runDiscloudBotAction(bot.botId, action);
      setData(nextData);
      setMessage(`Ação ${labels[action]} enviada.`);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "A ação não foi concluída.");
    } finally {
      setBusyAction(null);
    }
  }

  const filteredLogs = (logs?.full || logs?.small || "")
    .split(/\r?\n/)
    .filter((line) => !logsQuery.trim() || line.toLowerCase().includes(logsQuery.trim().toLowerCase()))
    .slice(-600)
    .join("\n");

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Monitoramento da DisCloud</h2>
          <p className="mt-1 text-sm text-zinc-400">Status, recursos, logs e controles das aplicacoes hospedadas.</p>
        </div>
        <Button className="w-full sm:w-auto" disabled={loading} onClick={() => void getDiscloudMonitoring(true).then(setData)} variant="outline">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </section>

      {message ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-semibold text-zinc-100">{message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DiscloudStat icon={Activity} label="Apps" value={String(totals.apps)} />
        <DiscloudStat icon={Play} label="Online" value={String(totals.online)} />
        <DiscloudStat icon={Square} label="Offline" value={String(totals.offline)} />
        <DiscloudStat icon={Bell} label="Alertas" value={String(totals.alerts)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <div className="h-72 animate-pulse rounded-lg border border-zinc-800 bg-zinc-950/70" key={index} />)
        ) : data?.bots.length ? data.bots.map((bot) => (
          <DiscloudBotCard
            bot={bot}
            busyAction={busyAction}
            key={bot.botId}
            onAction={handleAction}
            onLogs={loadLogs}
            onSelect={setSelectedBotId}
            selected={selectedBot?.botId === bot.botId}
          />
        )) : (
          <Card className="border-dashed border-zinc-800 bg-zinc-950/75 xl:col-span-2">
            <CardContent className="flex min-h-44 items-center justify-center p-8 text-sm font-semibold text-zinc-400">
              Nenhuma aplicacao DisCloud vinculada aos bots cadastrados.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <Card className="border-zinc-800/80 bg-zinc-950/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" />Logs</CardTitle>
            <CardDescription>{selectedBot ? `${selectedBot.appName} (${selectedBot.appId})` : "Selecione uma aplicacao"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none" onChange={(event) => setLogsQuery(event.target.value)} placeholder="Buscar nos logs" value={logsQuery} />
              <Button className="w-full sm:w-auto" disabled={!selectedBot || busyAction?.startsWith("logs:")} onClick={() => void loadLogs()} variant="outline"><RefreshCw className="h-4 w-4" />Logs</Button>
              <Button className="w-full sm:w-auto" disabled={!filteredLogs} onClick={() => downloadText("discloud-logs.txt", filteredLogs)} variant="outline"><Download className="h-4 w-4" />Baixar</Button>
            </div>
            <pre className="max-h-[420px] min-h-[220px] max-w-full overflow-auto rounded-lg border border-zinc-900 bg-black p-3 font-mono text-[11px] leading-5 text-emerald-100 sm:min-h-[260px] sm:p-4 sm:text-xs">{filteredLogs || "Sem logs carregados."}</pre>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!filteredLogs} onClick={() => void navigator.clipboard?.writeText(filteredLogs)} size="sm" variant="outline"><Copy className="h-4 w-4" />Copiar</Button>
              <Button disabled={!logs} onClick={() => setLogs(null)} size="sm" variant="outline">Limpar tela</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="border-zinc-800/80 bg-zinc-950/80">
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Eventos recentes persistidos no banco.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.history ?? []).map((event) => <DiscloudHistoryRow event={event} key={event.id} />)}
          {data?.history.length === 0 ? <p className="text-sm text-zinc-400">Sem eventos registrados.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function DiscloudBotCard({
  bot,
  busyAction,
  onAction,
  onLogs,
  onSelect,
  selected
}: {
  bot: DiscloudBotSnapshot;
  busyAction: string | null;
  onAction: (bot: DiscloudBotSnapshot, action: "start" | "stop" | "restart" | "redeploy") => void;
  onLogs: (botId: string) => void;
  onSelect: (botId: string) => void;
  selected: boolean;
}) {
  return (
    <Card className={`border-zinc-800/80 bg-zinc-950/80 transition duration-300 ${selected ? "ring-1 ring-[#FFEA70]/40" : ""}`}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 rounded-xl border border-zinc-700" fallback={bot.botName} src={bot.botAvatarUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-bold text-white">{bot.botName}</h3>
              <DiscloudStatusBadge status={bot.status} />
            </div>
            <p className="truncate text-xs font-semibold text-zinc-300">{bot.appName}</p>
            <p className="truncate font-mono text-[11px] text-zinc-500">App {bot.appId}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <DiscloudMetric icon={Cpu} label="CPU" value={percentLabel(bot.cpuUsagePercent)} />
          <DiscloudMetric icon={Activity} label="RAM" value={`${mbLabel(bot.memoryUsedMb)} / ${mbLabel(bot.memoryTotalMb)}`} percent={bot.memoryUsagePercent} />
          <DiscloudMetric icon={HardDrive} label="Disco" value={`${mbLabel(bot.diskUsedMb)} / ${mbLabel(bot.diskTotalMb)}`} percent={bot.diskUsagePercent} />
          <DiscloudMetric icon={Wifi} label="Rede" value={`${bot.networkDown ?? "0"} / ${bot.networkUp ?? "0"}`} />
        </div>

        <div className="grid gap-2 text-xs text-zinc-300 sm:grid-cols-2">
          <span>Uptime: {bot.uptime ?? "-"}</span>
          <span>Node: {bot.nodeVersion ?? "-"}</span>
          <span>API ping: {bot.apiPingMs ?? "-"}ms</span>
          <span>Deploy: {bot.lastDeployAt ? formatDate(bot.lastDeployAt) : "-"}</span>
        </div>

        {bot.alerts.length ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs font-semibold text-red-100">
            {bot.alerts.join(" ")}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button className="w-full sm:w-auto" disabled={Boolean(busyAction)} onClick={() => onAction(bot, "start")} size="sm"><Play className="h-4 w-4" />Iniciar</Button>
          <Button className="w-full sm:w-auto" disabled={Boolean(busyAction)} onClick={() => onAction(bot, "stop")} size="sm" variant="outline"><Square className="h-4 w-4" />Parar</Button>
          <Button className="w-full sm:w-auto" disabled={Boolean(busyAction)} onClick={() => onAction(bot, "restart")} size="sm" variant="outline"><RefreshCw className="h-4 w-4" />Reiniciar</Button>
          <Button className="w-full sm:w-auto" disabled={Boolean(busyAction)} onClick={() => onAction(bot, "redeploy")} size="sm" variant="outline">Redeploy</Button>
          <Button className="w-full sm:w-auto" disabled={Boolean(busyAction)} onClick={() => { onSelect(bot.botId); onLogs(bot.botId); }} size="sm" variant="outline"><ScrollText className="h-4 w-4" />Logs</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DiscloudMetric({ icon: Icon, label, percent, value }: { icon: LucideIcon; label: string; percent?: number | null; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-black/35 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#FFEA70]" />
        <span className="text-xs font-bold uppercase text-zinc-400">{label}</span>
      </div>
      <p className="mt-2 truncate text-sm font-bold text-white">{value}</p>
      {percent !== undefined ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-[#FFEA70]" style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function DiscloudStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card className="border-zinc-800/80 bg-zinc-950/75">
      <CardContent className="p-4">
        <Icon className="h-5 w-5 text-[#FFEA70]" />
        <p className="mt-3 text-xs font-bold uppercase text-zinc-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

function DiscloudStatusBadge({ status }: { status: DiscloudBotSnapshot["status"] }) {
  const config = {
    deploy: ["Deploy", "bg-blue-400"],
    maintenance: ["Manutenção", "bg-violet-400"],
    offline: ["Offline", "bg-red-400"],
    online: ["Online", "bg-emerald-400"],
    restarting: ["Reiniciando", "bg-yellow-400"],
    suspended: ["Suspenso", "bg-zinc-500"],
    unknown: ["Desconhecido", "bg-zinc-500"]
  }[status];

  return (
    <Badge variant={status === "online" ? "success" : status === "offline" ? "danger" : "muted"}>
      <span className={`h-2 w-2 rounded-full ${config[1]}`} />
      {config[0]}
    </Badge>
  );
}

function DiscloudHistoryRow({ event }: { event: DiscloudHistoryEvent }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-900 bg-black/35 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{event.message}</p>
        <p className="font-mono text-xs text-zinc-500">{event.event} · {event.appId}</p>
      </div>
      <span className="shrink-0 text-xs text-zinc-400">{formatDate(event.createdAt)}</span>
    </div>
  );
}

function DevAccessPanel() {
  const [entries, setEntries] = useState<DevAccessEntry[]>([]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<DevAccessRole>("dev");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getDevAccessEntries()
      .then((items) => {
        if (mounted) setEntries(items);
      })
      .catch((error) => {
        if (mounted) setMessage(readRequestMessage(error) ?? "Não foi possível carregar os acessos DEV.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUserId = userId.trim();

    if (!/^\d{5,32}$/.test(normalizedUserId)) {
      setMessage("Informe um Discord ID válido.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveDevAccessEntry({ role, userId: normalizedUserId });
      setEntries((current) => [saved, ...current.filter((item) => item.userId !== saved.userId)]);
      setUserId("");
      setMessage("Acesso DEV salvo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o acesso DEV.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: DevAccessEntry) {
    setSaving(true);
    setMessage(null);

    try {
      await deleteDevAccessEntry(entry.userId);
      setEntries((current) => current.filter((item) => item.userId !== entry.userId));
      setMessage("Acesso DEV removido.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível remover o acesso DEV.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-[#FFD500]/20 bg-[#0b0b10]/90">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="h-5 w-5 text-[#FFEA70]" />
          Acessos DEV
        </CardTitle>
        <CardDescription>Cadastre contas Discord autorizadas a entrar no painel DEV.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">{message}</div> : null}

        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]" onSubmit={(event) => void handleSubmit(event)}>
          <input
            className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none transition focus:border-[#FFEA70]"
            onChange={(event) => setUserId(event.target.value)}
            placeholder="Discord ID do usuário"
            value={userId}
          />
          <select
            className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none transition focus:border-[#FFEA70]"
            onChange={(event) => setRole(event.target.value as DevAccessRole)}
            value={role}
          >
            <option value="dev">Dev</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <Button className="w-full md:w-auto" disabled={saving} type="submit">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Salvar
          </Button>
        </form>

        <div className="grid gap-3">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/60">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : entries.length ? (
            entries.map((entry) => (
              <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 sm:flex-row sm:items-center sm:justify-between" key={entry.userId}>
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-white">{entry.userId}</p>
                  <p className="mt-1 text-xs text-zinc-500">Criado em {new Date(entry.createdAt).toLocaleString("pt-BR")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={entry.role === "owner" ? "success" : "muted"}>{entry.role}</Badge>
                  <Button disabled={saving} onClick={() => void handleDelete(entry)} size="sm" variant="outline">
                    <Trash2 className="h-4 w-4" />
                    Remover
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-sm text-zinc-500">
              Nenhum acesso adicional cadastrado.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MaintenancePanel() {
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [bots, setBots] = useState<DevBot[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;

    Promise.all([getMaintenanceState(), getDevBots().catch(() => [])])
      .then(([state, botItems]) => {
        if (!mounted) return;
        setMaintenance(state);
        setBots(botItems);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const socket = createDashboardSocket();
    socket.on("maintenance:updated", (payload: { state?: MaintenanceState; maintenance?: MaintenanceState }) => {
      const state = payload.state ?? payload.maintenance;
      if (state) setMaintenance(state);
    });
    socket.on("dev:bot_updated", (bot: DevBot) => {
      setBots((current) => current.map((item) => item.id === bot.id ? bot : item));
    });
    socket.on("dev:bot_created", (bot: DevBot) => {
      setBots((current) => [bot, ...current.filter((item) => item.id !== bot.id)]);
    });
    socket.on("dev:bot_deleted", (bot: DevBot) => {
      setBots((current) => current.filter((item) => item.id !== bot.id));
    });

    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      mounted = false;
      socket.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  async function handleToggle(active: boolean) {
    if (saving) return;
    const previous = maintenance;

    setMaintenance((current) => current ? {
      ...current,
      active,
      activatedAt: active ? current.activatedAt ?? new Date().toISOString() : current.activatedAt,
      deactivatedAt: active ? null : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } : current);
    setMessage({
      tone: "warning",
      text: active ? "Ativando manutenção global..." : "Desativando manutenção global..."
    });
    setSaving(true);
    try {
      setMaintenance(await setMaintenanceMode(active));
      setMessage({
        tone: "success",
        text: active ? "Manutenção global ativada." : "Manutenção global desativada."
      });
    } catch (error) {
      setMaintenance(previous);
      setMessage({
        tone: "danger",
        text: readRequestMessage(error) ?? "Não foi possível alterar o modo de manutenção."
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAlert() {
    setAlerting(true);
    try {
      setMaintenance(await sendMaintenanceAlert());
      setMessage({ tone: "success", text: "Alerta manual enviado para os bots." });
    } catch (error) {
      setMessage({ tone: "danger", text: readRequestMessage(error) ?? "Não foi possível enviar o alerta manual." });
    } finally {
      setAlerting(false);
    }
  }

  const active = Boolean(maintenance?.active);
  const since = maintenance?.activatedAt ? new Date(maintenance.activatedAt).getTime() : null;
  const elapsed = active && since ? formatDuration(Math.max(0, now - since)) : "00:00:00";

  return (
    <div className="min-w-0 space-y-6">
      <Card className="overflow-hidden border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(8,8,12,0.96))] shadow-[0_0_48px_rgba(255,213,0,0.12)] hover:translate-y-0">
        <CardHeader className="border-b border-[#FFD500]/15 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
                active
                  ? "border-red-400/35 bg-red-500/15 text-red-100 shadow-[0_0_34px_rgba(239,68,68,0.18)]"
                  : "border-emerald-400/35 bg-emerald-500/15 text-emerald-100 shadow-[0_0_34px_rgba(16,185,129,0.14)]"
              }`}>
                <Wrench className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-xl font-bold text-white">Modo de Manutenção Global</CardTitle>
                <CardDescription className="mt-1 font-medium text-zinc-300">
                  Bloqueia site, painel de usuários, APIs e eventos dos bots. O Painel DEV continua liberado.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={active ? "border-red-400/30 bg-red-500/15 text-red-100" : "border-emerald-400/30 bg-emerald-500/15 text-emerald-100"} variant="muted">
                {saving ? "Processando" : active ? "🔴 Em manutenção" : "🟢 Online"}
              </Badge>
              <Switch checked={active} disabled={loading || saving} onCheckedChange={(checked) => void handleToggle(checked)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          {message ? (
            <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              message.tone === "success"
                ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-100"
                : message.tone === "danger"
                  ? "border-red-500/25 bg-red-500/[0.08] text-red-100"
                  : "border-amber-500/25 bg-amber-500/[0.08] text-amber-100"
            }`}>
              {message.text}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MaintenanceMetric label="Status do sistema" value={active ? "Ativo" : "Inativo"} />
          <MaintenanceMetric label="Bots afetados" value={String(maintenance?.affectedBots ?? 0)} />
          <MaintenanceMetric label="Tempo em manutenção" value={elapsed} />
          <MaintenanceMetric label="Última ativação" value={maintenance?.activatedAt ? formatDate(maintenance.activatedAt) : "Nunca"} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        <Card className="border-[#FFD500]/20 bg-zinc-950/80 hover:translate-y-0">
          <CardHeader>
            <CardTitle className="text-white">Controle e alerta</CardTitle>
            <CardDescription className="font-medium text-zinc-300">Envie novamente o aviso para os canais configurados pelos bots.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="h-11 w-full bg-[#E5C000] text-white hover:bg-[#FFD500]" disabled={alerting} onClick={() => void handleAlert()}>
              {alerting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Enviar alerta manual
            </Button>
            <div className="rounded-lg border border-zinc-800 bg-black/35 p-4">
              <p className="text-sm font-bold text-white">Quem ativou</p>
              <p className="mt-1 text-sm font-medium text-zinc-300">{maintenance?.updatedByName ?? "Nenhum registro"}</p>
              <p className="mt-1 font-mono text-xs text-zinc-400">{maintenance?.updatedById ?? "sem-id"}</p>
            </div>
            <div className="rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/[0.07] p-4 text-sm font-semibold leading-6 text-zinc-100">
              ❌ Sistema em manutenção<br />
              Os bots estão em manutenção no momento.<br />
              Aguarde a nossa equipe finalizar a manutenção para realizar novamente.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-[#FFD500]/20 bg-zinc-950/80 hover:translate-y-0">
        <CardHeader>
          <CardTitle className="text-white">Status em tempo real dos bots</CardTitle>
          <CardDescription className="font-medium text-zinc-300">Bots afetados pelo modo de manutenção global.</CardDescription>
        </CardHeader>
        <CardContent>
          {active ? (
            <div className="mb-4 grid gap-4 rounded-lg border border-amber-400/25 bg-amber-500/[0.08] p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
              <img
                alt="Bot em manutenção"
                className="aspect-square w-full max-w-36 rounded-lg border border-amber-300/20 object-cover shadow-[0_0_28px_rgba(245,158,11,0.14)]"
                src={MAINTENANCE_GIF_URL}
              />
              <div className="min-w-0">
                <Badge className="border-amber-400/30 bg-amber-500/15 text-amber-100" variant="muted">
                  Atividade atual
                </Badge>
                <p className="mt-2 text-base font-bold text-white">Sistema em manutenção</p>
                <p className="mt-1 text-sm font-medium leading-6 text-zinc-300">
                  Os bots ficam com o aviso ativo enquanto o modo global estiver ligado.
                </p>
              </div>
            </div>
          ) : null}

          {bots.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {bots.map((bot) => (
                <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black/35 p-3" key={bot.id}>
                  <Avatar className="h-10 w-10 rounded-xl border border-zinc-700" fallback={bot.name} src={bot.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{bot.name}</p>
                    <p className="truncate text-xs font-medium text-zinc-300">{bot.mainGuildName || bot.mainGuildId}</p>
                  </div>
                  <Badge variant={isDevBotReadyStatus(bot.status) ? "success" : isDevBotErrorStatus(bot.status) ? "danger" : bot.status === "degraded" ? "warning" : "muted"}>
                    {devBotStatusLabel(bot.status)}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-sm font-medium text-zinc-300">
              Nenhum bot cadastrado para monitorar.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MaintenanceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#FFD500]/15 bg-black/35 p-4">
      <p className="text-xs font-bold uppercase text-zinc-300">{label}</p>
      <p className="mt-2 truncate text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function devBotStatusLabel(status: DevBotStatus) {
  const labels: Record<DevBotStatus, string> = {
    online: "Online",
    offline: "Offline",
    starting: "Iniciando",
    authenticating: "Autenticando",
    syncing_config: "Sincronizando",
    ready: "Pronto",
    degraded: "Degradado",
    stopping: "Desligando",
    invalid_token: "Token inválido",
    error: "Erro"
  };

  return labels[status];
}

function isDevBotReadyStatus(status: DevBotStatus) {
  return status === "online" || status === "ready";
}

function isDevBotErrorStatus(status: DevBotStatus) {
  return status === "error" || status === "invalid_token";
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

const SALES_MANAGER_MODULES: Array<{
  description: string;
  icon: LucideIcon;
  id: string;
  permissions: string;
  title: string;
}> = [
  {
    description: "Produtos, planos, checkout, tickets de compra, fila e histórico de vendas.",
    icon: CreditCard,
    id: "nex-tech-sales",
    permissions: "Dono do bot, Gerente de vendas",
    title: "Sistema de Vendas"
  },
  {
    description: "Mercado Pago isolado por bot, credenciais próprias, PIX, cartão e webhook automático.",
    icon: CreditCard,
    id: "payment-gateway",
    permissions: "Dono do bot, Financeiro",
    title: "Pagamento Automático"
  },
  {
    description: "Pix manual, envio de comprovantes, aprovação por equipe e atendimento por canais.",
    icon: BriefcaseBusiness,
    id: "manual-payments",
    permissions: "Dono do bot, Financeiro manual",
    title: "Pagamento Manual"
  },
  {
    description: "Tabelas de preços, itens, preview e publicação de painéis comerciais no Discord.",
    icon: ScrollText,
    id: "price-tables",
    permissions: "Dono do bot, Vendas",
    title: "Painel de Vendas"
  }
];

function DevSalesManager({
  bots,
  onBotUpdated,
  onSelectBot,
  selectedBotId
}: {
  bots: DashboardBot[];
  onBotUpdated: (bot: DashboardBot) => void;
  onSelectBot: (botId: string | null) => void;
  selectedBotId: string | null;
}) {
  const [savingModuleId, setSavingModuleId] = useState<string | null>(null);
  const [botList, setBotList] = useState<DashboardBot[]>(bots);
  const [message, setMessage] = useState<string | null>(null);
  const selectedBot = botList.find((bot) => bot.id === selectedBotId) ?? botList[0] ?? null;
  const enabled = new Set(selectedBot?.enabledModules ?? []);
  const activeModuleCount = SALES_MANAGER_MODULES.filter((module) => enabled.has(module.id)).length;
  const stats = {
    active: activeModuleCount,
    automatic: enabled.has("payment-gateway") ? 1 : 0,
    disabled: SALES_MANAGER_MODULES.length - activeModuleCount,
    manual: enabled.has("manual-payments") ? 1 : 0,
    total: SALES_MANAGER_MODULES.length,
    users: botList.reduce((total, bot) => total + (bot.enabledModules.some((moduleId) => SALES_MANAGER_MODULES.some((module) => module.id === moduleId)) ? 1 : 0), 0)
  };

  useEffect(() => {
    setBotList(bots);
    onSelectBot(selectedBotId ?? bots[0]?.id ?? null);
  }, [bots]);

  async function handleToggle(moduleId: string, checked: boolean) {
    if (!selectedBot) return;

    const previousBot = selectedBot;
    const nextModules = checked
      ? [...new Set([...selectedBot.enabledModules, moduleId])]
      : selectedBot.enabledModules.filter((currentModuleId) => currentModuleId !== moduleId);
    const optimisticBot = {
      ...selectedBot,
      enabledModules: nextModules
    };

    setSavingModuleId(moduleId);
    setMessage(null);
    setBotList((current) => current.map((bot) => bot.id === optimisticBot.id ? optimisticBot : bot));
    onBotUpdated(optimisticBot);

    try {
      const updated = await updateDevBotModules(selectedBot.id, nextModules);
      setBotList((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
      onBotUpdated(updated);
      setMessage(`${checked ? "Liberado" : "Desativado"}: ${SALES_MANAGER_MODULES.find((module) => module.id === moduleId)?.title ?? moduleId}.`);
    } catch {
      setBotList((current) => current.map((bot) => bot.id === previousBot.id ? previousBot : bot));
      onBotUpdated(previousBot);
      setMessage("Não foi possível salvar a ativacao do módulo.");
    } finally {
      setSavingModuleId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Sistema de Vendas Manager</h2>
          <p className="mt-1 text-sm text-zinc-500">Libere vendas, Mercado Pago e pagamentos por bot, separados igual aos módulos FiveM.</p>
        </div>
        <select
          className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none sm:w-auto"
          onChange={(event) => onSelectBot(event.target.value || null)}
          value={selectedBot?.id ?? ""}
        >
          {botList.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select>
      </section>

      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <FiveMStat icon={Boxes} label="Total de módulos" value={String(stats.total)} />
        <FiveMStat icon={Activity} label="Módulos ativos" value={String(stats.active)} />
        <FiveMStat icon={ShieldAlert} label="Desativados" value={String(stats.disabled)} />
        <FiveMStat icon={Users} label="Bots com acesso" value={String(stats.users)} />
        <FiveMStat icon={CreditCard} label="Automático" value={String(stats.automatic)} />
        <FiveMStat icon={BriefcaseBusiness} label="Manual" value={String(stats.manual)} />
      </section>

      <Card className="border-zinc-800/80 bg-zinc-950/75">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle>Módulos de Vendas e Pagamentos</CardTitle>
          <CardDescription>Sistemas comerciais independentes. Liberar Mercado Pago não libera automaticamente o Sistema de Vendas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 sm:p-6 sm:pt-0 lg:grid-cols-2">
          {SALES_MANAGER_MODULES.map((module) => {
            const active = enabled.has(module.id);

            return (
              <div className="flex min-h-[112px] flex-col gap-4 rounded-lg border border-zinc-900 bg-black/35 p-4 sm:flex-row" key={module.id}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                  <module.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{module.title}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{module.description}</p>
                      <p className="mt-2 truncate text-xs text-zinc-400">Permissões: {module.permissions}</p>
                    </div>
                    <ModuleActivationButton
                      active={active}
                      disabled={!selectedBot || savingModuleId === module.id}
                      loading={savingModuleId === module.id}
                      onToggle={(checked) => void handleToggle(module.id, checked)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function DevFiveMManager({
  bots,
  onBotUpdated,
  onSelectBot,
  scope,
  selectedBotId
}: {
  bots: DashboardBot[];
  onBotUpdated: (bot: DashboardBot) => void;
  onSelectBot: (botId: string | null) => void;
  scope: "fivem" | "police";
  selectedBotId: string | null;
}) {
  const [savingModuleId, setSavingModuleId] = useState<string | null>(null);
  const [botList, setBotList] = useState<DashboardBot[]>(bots);
  const [modules, setModules] = useState<FivemModuleDefinition[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const selectedBot = botList.find((bot) => bot.id === selectedBotId) ?? botList[0] ?? null;
  const viewModules = modules
    .filter((module) => scope === "police" ? isPoliceModule(module.id) : isFiveMManagerModule(module.id))
    .map(toFiveMModuleView);
  const enabled = new Set((selectedBot?.enabledModules ?? []).map((moduleId) => moduleId === "fivem-fac" ? "fivem-absences" : moduleId));
  const activeModuleCount = viewModules.filter((module) => enabled.has(normalizeFiveMModuleId(module.id))).length;
  const stats = {
    active: activeModuleCount,
    corporations: enabled.has("fivem-corporations") ? 1 : 0,
    disabled: viewModules.length - activeModuleCount,
    factions: enabled.has("fivem-factions") ? 1 : 0,
    total: viewModules.length,
    users: botList.reduce((total, bot) => total + (bot.enabledModules.some((moduleId) => scope === "police" ? isPoliceModule(moduleId) : isFiveMManagerModule(moduleId)) ? 1 : 0), 0)
  };
  const copy = scope === "police"
    ? {
      title: "Polícia",
      description: "Gerencie sistemas diretamente da Polícia, separados dos módulos FiveM.",
      cardTitle: "Modulos de Polícia",
      cardDescription: "Sistemas policiais independentes das configurações gerais de RP.",
      loading: "Carregando modulos de Polícia...",
      createPrompt: "Nome do novo módulo de Polícia",
      descriptionPrompt: "Descrição do módulo de Polícia",
      defaultDescription: "Módulo policial personalizado criado pelo desenvolvedor.",
      permissionsPrompt: "Permissões do módulo de Polícia",
      defaultPermissions: "Admin Polícia",
      created: "Módulo de Polícia criado.",
      createError: "Não foi possível criar o módulo de Polícia.",
      removeConfirm: "Remover este módulo de Polícia?",
      removed: "Módulo de Polícia removido.",
      removeError: "Não foi possível remover o módulo de Polícia.",
      editNamePrompt: "Nome do módulo de Polícia",
      editDescriptionPrompt: "Descrição do módulo de Polícia",
      editPermissionsPrompt: "Permissões do módulo de Polícia",
      updated: "Módulo de Polícia atualizado.",
      updateError: "Não foi possível editar o módulo de Polícia."
    }
    : {
      title: "FiveM Manager",
      description: "Gerencie todos os modulos, sistemas e recursos do FiveM.",
      cardTitle: "Modulos FiveM",
      cardDescription: "Sistemas RP independentes das configurações do bot Discord.",
      loading: "Carregando modulos FiveM...",
      createPrompt: "Nome do novo módulo FiveM",
      descriptionPrompt: "Descrição do módulo FiveM",
      defaultDescription: "Módulo personalizado criado pelo desenvolvedor.",
      permissionsPrompt: "Permissões do módulo FiveM",
      defaultPermissions: "Admin FiveM",
      created: "Módulo FiveM criado.",
      createError: "Não foi possível criar o módulo FiveM.",
      removeConfirm: "Remover este módulo FiveM?",
      removed: "Módulo FiveM removido.",
      removeError: "Não foi possível remover o módulo FiveM.",
      editNamePrompt: "Nome do módulo FiveM",
      editDescriptionPrompt: "Descrição do módulo FiveM",
      editPermissionsPrompt: "Permissões do módulo FiveM",
      updated: "Módulo FiveM atualizado.",
      updateError: "Não foi possível editar o módulo FiveM."
    };

  useEffect(() => {
    setBotList(bots);
  }, [bots]);

  useEffect(() => {
    let mounted = true;

    setLoadingModules(true);
    Promise.all([getDevFivemModules(), getDevBots()])
      .then(([nextModules, nextBots]) => {
        if (!mounted) return;

        setModules(nextModules);
        setBotList(nextBots);
        onSelectBot(selectedBotId ?? nextBots[0]?.id ?? null);
      })
      .catch(() => {
        if (mounted) setMessage(scope === "police" ? "Não foi possível carregar os modulos de Polícia." : "Não foi possível carregar os modulos FiveM.");
      })
      .finally(() => {
        if (mounted) setLoadingModules(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleToggle(moduleId: string, checked: boolean) {
    if (!selectedBot) return;

    const previousBot = selectedBot;
    const normalizedModules = normalizeFiveMModules(selectedBot.enabledModules);
    const canonicalModuleId = normalizeFiveMModuleId(moduleId);
    const nextModules = scope === "police"
      ? checked
        ? [...new Set([...normalizedModules, canonicalModuleId])]
        : normalizedModules.filter((currentModuleId) => currentModuleId !== canonicalModuleId)
      : checked
        ? [...new Set([...normalizedModules, "fivem", canonicalModuleId])]
        : nextFiveMModulesAfterDisable(normalizedModules, canonicalModuleId);
    const optimisticBot = {
      ...selectedBot,
      enabledModules: nextModules
    };

    setSavingModuleId(moduleId);
    setMessage(null);
    setBotList((current) => current.map((bot) => bot.id === optimisticBot.id ? optimisticBot : bot));
    onBotUpdated(optimisticBot);

    try {
      const updated = await updateDevBotModules(selectedBot.id, nextModules);
      setBotList((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
      onBotUpdated(updated);
    } catch {
      setBotList((current) => current.map((bot) => bot.id === previousBot.id ? previousBot : bot));
      onBotUpdated(previousBot);
      setMessage("Não foi possível salvar a ativacao do módulo.");
    } finally {
      setSavingModuleId(null);
    }
  }

  async function handleCreateModule() {
    const name = window.prompt(copy.createPrompt);
    if (!name?.trim()) return;

    const description = window.prompt(copy.descriptionPrompt, copy.defaultDescription)?.trim()
      || copy.defaultDescription;
    const permissions = window.prompt(copy.permissionsPrompt, copy.defaultPermissions)?.trim() || copy.defaultPermissions;

    setMessage(null);
    try {
      const created = await createDevFivemModule({
        description,
        permissions,
        title: name.trim()
      });
      setModules((current) => [created, ...current]);
      setMessage(copy.created);
    } catch {
      setMessage(copy.createError);
    }
  }

  async function handleRemoveCustom(moduleId: string) {
    if (!window.confirm(copy.removeConfirm)) return;

    setSavingModuleId(moduleId);
    setMessage(null);
    try {
      const canonicalModuleId = normalizeFiveMModuleId(moduleId);
      const nextBotModules = selectedBot && enabled.has(canonicalModuleId)
        ? scope === "police"
          ? normalizeFiveMModules(selectedBot.enabledModules).filter((currentModuleId) => currentModuleId !== canonicalModuleId)
          : nextFiveMModulesAfterDisable(normalizeFiveMModules(selectedBot.enabledModules), canonicalModuleId)
        : null;
      await deleteDevFivemModule(moduleId);
      if (selectedBot && nextBotModules) {
        const updated = await updateDevBotModules(selectedBot.id, nextBotModules);
        setBotList((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
        onBotUpdated(updated);
      }
      setModules((current) => current.filter((module) => module.id !== moduleId));
      setMessage(copy.removed);
    } catch {
      setMessage(copy.removeError);
    } finally {
      setSavingModuleId(null);
    }
  }

  async function handleEditCustom(moduleId: string) {
    const current = modules.find((module) => module.id === moduleId);
    if (!current) return;

    const name = window.prompt(copy.editNamePrompt, current.title);
    if (!name?.trim()) return;
    const description = window.prompt(copy.editDescriptionPrompt, current.description)?.trim() || current.description;
    const permissions = window.prompt(copy.editPermissionsPrompt, current.permissions)?.trim() || current.permissions;

    setSavingModuleId(moduleId);
    setMessage(null);
    try {
      const updated = await updateDevFivemModule(moduleId, {
        description,
        permissions,
        title: name.trim()
      });
      setModules((currentModules) => currentModules.map((module) => module.id === moduleId ? updated : module));
      setMessage(copy.updated);
    } catch {
      setMessage(copy.updateError);
    } finally {
      setSavingModuleId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{copy.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{copy.description}</p>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <select
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none sm:w-auto"
            onChange={(event) => onSelectBot(event.target.value || null)}
            value={selectedBot?.id ?? ""}
          >
            {botList.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
          <Button className="w-full sm:w-auto" onClick={handleCreateModule}>
            <Plus className="h-4 w-4" />
            Novo módulo
          </Button>
        </div>
      </section>

      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <FiveMStat icon={Boxes} label="Total de módulos" value={String(stats.total)} />
        <FiveMStat icon={Activity} label="Módulos ativos" value={String(stats.active)} />
        <FiveMStat icon={ShieldAlert} label="Desativados" value={String(stats.disabled)} />
        <FiveMStat icon={Users} label="Usuários com acesso" value={String(stats.users)} />
        {scope === "police" ? (
          <>
            <FiveMStat icon={ShieldCheck} label="Sistemas policiais" value={String(viewModules.filter((module) => module.id.startsWith("police-")).length)} />
            <FiveMStat icon={BadgeCheck} label="Promoções" value={enabled.has("police-promotions") ? "Ativo" : "Inativo"} />
          </>
        ) : (
          <>
            <FiveMStat icon={Building2} label="Facções cadastradas" value={String(stats.factions)} />
            <FiveMStat icon={BriefcaseBusiness} label="Corporacoes" value={String(stats.corporations)} />
          </>
        )}
      </section>

      <Card className="border-zinc-800/80 bg-zinc-950/75">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle>{copy.cardTitle}</CardTitle>
          <CardDescription>{copy.cardDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 sm:p-6 sm:pt-0 lg:grid-cols-2">
          {loadingModules ? (
            <div className="flex min-h-28 items-center justify-center rounded-lg border border-zinc-900 bg-black/35 text-sm text-zinc-500 lg:col-span-2">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {copy.loading}
            </div>
          ) : viewModules.map((module) => {
            const active = enabled.has(normalizeFiveMModuleId(module.id));
            const custom = !module.builtIn;

            return (
              <div className="flex min-h-[112px] flex-col gap-4 rounded-lg border border-zinc-900 bg-black/35 p-4 sm:flex-row" key={module.id}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                  <module.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{module.title}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{module.description}</p>
                      <p className="mt-2 truncate text-xs text-zinc-400">Permissões: {module.permissions}</p>
                    </div>
                    <ModuleActivationButton
                      active={active}
                      disabled={!selectedBot || savingModuleId === module.id}
                      loading={savingModuleId === module.id}
                      onToggle={(checked) => void handleToggle(module.id, checked)}
                    />
                  </div>
                  {custom ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button className="w-full sm:w-auto" disabled={savingModuleId === module.id} onClick={() => void handleEditCustom(module.id)} size="sm" variant="outline"><Pencil className="h-4 w-4" />Editar</Button>
                      <Button className="w-full sm:w-auto" disabled={savingModuleId === module.id} onClick={() => void handleRemoveCustom(module.id)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Remover</Button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleActivationButton({
  active,
  disabled,
  loading,
  onToggle
}: {
  active: boolean;
  disabled: boolean;
  loading: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const Icon = loading ? Loader2 : active ? PowerOff : Power;

  return (
    <Button
      aria-pressed={active}
      className={`min-h-11 w-full shrink-0 justify-between px-3 py-2 sm:w-36 sm:justify-center ${
        active
          ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/15 hover:text-emerald-50"
          : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-[#FFD500]/55 hover:bg-[#FFD500]/10 hover:text-[#FFEA70]"
      }`}
      disabled={disabled}
      onClick={() => onToggle(!active)}
      size="sm"
      type="button"
      variant="outline"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${loading ? "animate-spin" : ""}`} />
        <span className="truncate">{active ? "Desativar" : "Ativar"}</span>
      </span>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full sm:hidden ${active ? "bg-emerald-300" : "bg-zinc-500"}`} />
    </Button>
  );
}

function FiveMStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card className="border-zinc-800/80 bg-zinc-950/75">
      <CardContent className="p-4">
        <Icon className="h-5 w-5 text-zinc-400" />
        <p className="mt-3 truncate text-xs text-zinc-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

function normalizeFiveMModules(moduleIds: string[]) {
  return [...new Set(moduleIds.map(normalizeFiveMModuleId))];
}

function normalizeFiveMModuleId(moduleId: string) {
  return moduleId === "fivem-fac" ? "fivem-absences" : moduleId;
}

function nextFiveMModulesAfterDisable(moduleIds: string[], disabledModuleId: string) {
  const withoutModule = moduleIds.filter((moduleId) => moduleId !== disabledModuleId);
  const hasOtherFiveMModule = withoutModule.some((moduleId) => moduleId.startsWith("fivem-") && !isPoliceModule(moduleId));

  if (hasOtherFiveMModule) {
    return [...new Set([...withoutModule, "fivem"])];
  }

  return withoutModule.filter((moduleId) => moduleId !== "fivem");
}

function toFiveMModuleView(module: FivemModuleDefinition): FiveMModuleView {
  return {
    ...module,
    icon: fiveMModuleIcon(module.id)
  };
}

function fiveMModuleIcon(moduleId: string): LucideIcon {
  const icons: Record<string, LucideIcon> = {
    "fivem-ammo": Shield,
    "fivem-absences": CalendarClock,
    "fivem-corporations": BriefcaseBusiness,
    "fivem-factions": Building2,
    "fivem-finance": Activity,
    "fivem-washing": PackagePlus,
    "fivem-drugs": PackagePlus,
    "fivem-orders": PackagePlus,
    "fivem-hierarchy": Users,
    "police-absences": CalendarClock,
    "police-actions": Activity,
    "police-iab": ShieldAlert,
    "police-hr": UserCog,
    "police-daf-roster": CalendarClock,
    "police-courses": ScrollText,
    "police-patrol-reports": ShieldCheck,
    "police-promotions": BadgeCheck,
    "vehicle-abandonment": Car,
    "police-hidden-channel": EyeOff,
    "visible-message": MessageCircle,
    "message-control": MessageCircle,
    "police-dm": Bell,
    "rh-admin": ShieldCheck,
    "police-subpoenas": ScrollText,
    "police-open-duty": Activity
  };

  return icons[moduleId] ?? Boxes;
}

function isPoliceModule(moduleId: string) {
  return moduleId === "fivem-hierarchy" || moduleId === "rh-admin" || moduleId === "vehicle-abandonment" || moduleId.startsWith("police-");
}

function isFiveMManagerModule(moduleId: string) {
  return !isPoliceModule(moduleId) && (moduleId === "fivem" || moduleId.startsWith("fivem-"));
}

function TechnicalLogsPanel({ botId, guildId }: { botId: string | null; guildId: string | null }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!guildId || !botId) {
      setLogs([]);
      return;
    }

    let mounted = true;

    setLoading(true);
    getLogs(guildId, botId)
      .then((items) => {
        if (mounted) setLogs(items);
      })
      .catch(() => {
        if (mounted) setLogs([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, guildId]);

  return (
    <Card className="border-zinc-800/80 bg-zinc-950/75">
      <CardHeader className="p-5 sm:p-6">
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" />
          Logs técnicos
        </CardTitle>
        <CardDescription>Eventos brutos por botId e guildId para diagnostico do desenvolvedor.</CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
        {loading ? (
          <div className="flex min-h-28 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        ) : logs.length ? (
          <div className="space-y-3">
            {logs.map((log) => (
              <div className="rounded-lg border border-zinc-900 bg-black/35 p-3" key={log.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{log.type}</Badge>
                  <span className="text-xs text-zinc-500">{formatDate(log.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-100">{log.message}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">
                  botId={log.botId ?? "default"} guildId={log.guildId}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
            Nenhum log técnico encontrado.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function percentLabel(value: number | null) {
  return value === null ? "-" : `${Math.round(value)}%`;
}

function mbLabel(value: number | null) {
  return value === null ? "-" : `${Math.round(value)} MB`;
}

function msLabel(value: number | null) {
  return value === null ? "-" : `${Math.round(value)}ms`;
}

function bytesToMb(value: number | null) {
  return value === null ? null : value / 1024 / 1024;
}

function formatUptime(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function secondsSince(value: string | null, now: number) {
  if (!value) return "-";
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return "-";
  return String(Math.max(0, Math.floor((now - parsed) / 1000)));
}

function toneClass(tone: "good" | "warn" | "danger") {
  if (tone === "danger") return "border-red-400/30 bg-red-500/10 text-red-200";
  if (tone === "warn") return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
}

function toneTextClass(tone: "good" | "warn" | "danger") {
  if (tone === "danger") return "text-red-200";
  if (tone === "warn") return "text-amber-100";
  return "text-zinc-100";
}

function responseTimeTone(status: BotResponseTimeStats["status"]): "good" | "warn" | "danger" {
  if (status === "critical" || status === "offline") return "danger";
  if (status === "warn") return "warn";
  return "good";
}

function responseTimeLabel(status: BotResponseTimeStats["status"]) {
  if (status === "critical") return "Crítico";
  if (status === "warn") return "Degradado";
  if (status === "offline") return "Offline";
  return "Bom";
}

function latencyStatusFromMs(value: number | null): BotResponseTimeStats["status"] {
  if (value === null) return "offline";
  if (value >= 800) return "critical";
  if (value >= 250) return "warn";
  return "good";
}

function responseTimeBarClass(status: BotResponseTimeStats["status"]) {
  if (status === "critical" || status === "offline") return "bg-red-500";
  if (status === "warn") return "bg-amber-400";
  return "bg-emerald-400";
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function readRequestMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}
