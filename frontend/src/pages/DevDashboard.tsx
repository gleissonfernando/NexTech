import { useEffect, useState } from "react";
import {
  Activity,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Code2,
  LayoutDashboard,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Trash2,
  Users,
  Wrench,
  Bell
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DevPanel, type DevDashboardSection } from "../components/dev/DevPanel";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import {
  createDevFivemModule,
  deleteDevFivemModule,
  getDashboardMe,
  getDevBots,
  getDevFivemModules,
  getMaintenanceState,
  getLogs,
  sendMaintenanceAlert,
  setMaintenanceMode,
  updateDevBotModules,
  updateDevFivemModule
} from "../lib/api";
import { createDashboardSocket } from "../lib/socket";
import { dashboardUrl } from "../lib/urls";
import type { AuthResponse, DashboardBot, DashboardMeResponse, DevBot, FivemModuleDefinition, LogEntry, MaintenanceState } from "../types";

type DevDashboardProps = {
  auth: AuthResponse;
  initialView?: DevView;
  onLogout: () => void;
};

type DevView = "bots" | "fivem" | "logs" | "maintenance";

type FiveMModuleView = FivemModuleDefinition & {
  icon: LucideIcon;
};

export function DevDashboard({ auth, initialView = "bots", onLogout }: DevDashboardProps) {
  const [profile, setProfile] = useState<DashboardMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DevView>(initialView);
  const [activeDashboardSection, setActiveDashboardSection] = useState<DevDashboardSection>("connected");

  useEffect(() => {
    let mounted = true;

    getDashboardMe()
      .then((nextProfile) => {
        if (!mounted) return;

        setProfile(nextProfile);
        const firstBot = nextProfile.bots[0] ?? null;
        setSelectedBotId((current) => current ?? firstBot?.id ?? null);
        setSelectedGuildId((current) => current ?? nextProfile.selectedGuildId ?? firstBot?.guildIds[0] ?? nextProfile.guilds[0]?.id ?? null);
      })
      .catch(() => {
        if (mounted) {
          window.location.replace("/dashboard");
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

  if (!profile?.canViewDev) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-300" />
              Acesso restrito
            </CardTitle>
            <CardDescription>Esta area e exclusiva do desenvolvedor.</CardDescription>
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.14),transparent_34%),linear-gradient(180deg,#050506,#08080b_48%,#050505)] text-white lg:pl-72">
      <DevSidebar
        activeDashboardSection={activeDashboardSection}
        activeView={activeView}
        onChangeDashboardSection={setActiveDashboardSection}
        onChangeView={handleChangeView}
      />
      <header className="sticky top-0 z-20 border-b border-purple-500/15 bg-[#050505]/88 px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-purple-400/45 bg-purple-500/15 text-purple-100 shadow-[0_0_34px_rgba(124,58,237,0.28)]">
              <Code2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-white">Painel DEV</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className="border-purple-500/30 bg-purple-500/10 text-purple-100" variant="muted">Bots</Badge>
                <Badge className="text-zinc-100" variant="muted">FiveM</Badge>
                <Badge className="text-zinc-100" variant="muted">Modulos globais</Badge>
                <Badge className="text-zinc-100" variant="muted">Logs tecnicos</Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
            <Button className="shrink-0" onClick={() => window.location.replace("/dashboard")} variant="outline">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
            <DevHeaderUser user={auth.user} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 lg:px-8">
        {activeView !== "bots" ? <DevUserCard user={auth.user} canViewDev={profile.canViewDev} /> : null}

        <div className="flex gap-2 overflow-x-auto lg:hidden">
          {[
            { id: "bots" as const, label: "Dashboard" },
            { id: "fivem" as const, label: "FiveM" },
            { id: "logs" as const, label: "Logs" },
            { id: "maintenance" as const, label: "Manutenção" }
          ].map((item) => (
            <Button
              key={item.id}
              onClick={() => handleChangeView(item.id)}
              size="sm"
              variant={activeView === item.id ? "default" : "outline"}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {activeView === "bots" ? (
          <DevPanel
            activeDashboardSection={activeDashboardSection}
            guilds={profile.guilds}
            onBotCreated={handleBotCreated}
            onBotDeleted={handleBotDeleted}
            onBotUpdated={handleBotUpdated}
            onDashboardSectionChange={setActiveDashboardSection}
            onOpenView={(view, bot) => {
              if (view === "overview") window.location.replace(dashboardUrl(bot?.slug));
            }}
            onSelectBot={setSelectedBotId}
            selectedBotId={selectedBotId}
            selectedGuildId={selectedGuildId}
            user={auth.user}
          />
        ) : null}

        {activeView === "fivem" ? (
          <DevFiveMManager
            bots={profile.bots}
            onBotUpdated={handleBotUpdated}
            selectedBotId={selectedBotId}
            onSelectBot={setSelectedBotId}
          />
        ) : null}

        {activeView === "logs" ? <TechnicalLogsPanel botId={selectedBotId} guildId={selectedGuildId} /> : null}
        {activeView === "maintenance" ? <MaintenancePanel /> : null}
      </div>
    </main>
  );
}

function devPathForView(view: DevView) {
  if (view === "fivem") return "/dev/fivem";
  if (view === "logs") return "/dev/logs";
  if (view === "maintenance") return "/dev/maintenance";
  return "/dev";
}

function DevSidebar({
  activeDashboardSection,
  activeView,
  onChangeDashboardSection,
  onChangeView
}: {
  activeDashboardSection: DevDashboardSection;
  activeView: DevView;
  onChangeDashboardSection: (section: DevDashboardSection) => void;
  onChangeView: (view: DevView) => void;
}) {
  const items: Array<{ icon: LucideIcon; id: DevView; label: string }> = [
    { icon: LayoutDashboard, id: "bots", label: "Dashboard" },
    { icon: Building2, id: "fivem", label: "FiveM" },
    { icon: ScrollText, id: "logs", label: "Logs" },
    { icon: Wrench, id: "maintenance", label: "Manutenção" }
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-purple-500/15 bg-[#08080b]/96 px-4 py-4 shadow-[22px_0_70px_rgba(0,0,0,0.48)] backdrop-blur-xl lg:flex">
      <div className="mb-5 flex h-12 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-purple-400/40 bg-purple-500/15 text-purple-100 shadow-[0_0_30px_rgba(124,58,237,0.24)]">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">Painel DEV</p>
          <p className="truncate text-xs font-medium text-zinc-300">Menu principal</p>
        </div>
      </div>
      <nav className="space-y-1">
        {items.map((item) => (
          <div key={item.id}>
            <button
              className={[
                "group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition duration-300",
                activeView === item.id
                  ? "bg-purple-500/20 text-white ring-1 ring-purple-400/35 shadow-[0_0_24px_rgba(124,58,237,0.16)]"
                  : "text-zinc-300 hover:bg-purple-500/10 hover:text-white hover:shadow-[0_0_22px_rgba(124,58,237,0.12)]"
              ].join(" ")}
              onClick={() => onChangeView(item.id)}
              type="button"
            >
              <item.icon className="h-4 w-4 text-purple-200 transition group-hover:text-white" />
              {item.label}
            </button>

            {item.id === "bots" && activeView === "bots" ? (
              <div className="mt-2 space-y-1 pl-5">
                <button
                  className={[
                    "group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-xs font-semibold transition duration-300",
                    activeDashboardSection === "connected"
                      ? "bg-purple-500/15 text-white ring-1 ring-purple-400/25"
                      : "text-zinc-400 hover:bg-purple-500/10 hover:text-white"
                  ].join(" ")}
                  onClick={() => {
                    onChangeView("bots");
                    onChangeDashboardSection("connected");
                  }}
                  type="button"
                >
                  <Boxes className="h-3.5 w-3.5 text-purple-200 transition group-hover:text-white" />
                  Bots conectados
                </button>
                <button
                  className={[
                    "group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-xs font-semibold transition duration-300",
                    activeDashboardSection === "bot-menu"
                      ? "bg-purple-500/15 text-white ring-1 ring-purple-400/25"
                      : "text-zinc-400 hover:bg-purple-500/10 hover:text-white"
                  ].join(" ")}
                  onClick={() => {
                    onChangeView("bots");
                    onChangeDashboardSection("bot-menu");
                  }}
                  type="button"
                >
                  <Settings className="h-3.5 w-3.5 text-purple-200 transition group-hover:text-white" />
                  Menu do Bot
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function DevHeaderUser({ onLogout, user }: { onLogout: () => void; user: AuthResponse["user"] }) {
  return (
    <button
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left shadow-[0_16px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 hover:border-purple-400/35 hover:bg-purple-500/10 hover:shadow-[0_0_34px_rgba(124,58,237,0.18)]"
      onClick={onLogout}
      title="Sair"
      type="button"
    >
      <div className="relative shrink-0">
        <Avatar className="h-10 w-10 rounded-full border border-purple-300/40 sm:h-11 sm:w-11" fallback={user.globalName || user.username} src={user.avatarUrl ?? user.avatar} />
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#111114] bg-emerald-400" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-white">{user.globalName || user.username}</p>
        <p className="hidden truncate text-xs font-medium text-zinc-300 sm:block">@{user.username}</p>
      </div>
    </button>
  );
}

function DevUserCard({ canViewDev, user }: { canViewDev: boolean; user: AuthResponse["user"] }) {
  const banner = (user as AuthResponse["user"] & { bannerUrl?: string | null }).bannerUrl;

  return (
    <Card className="overflow-hidden border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(12,12,16,0.96))] shadow-[0_0_45px_rgba(124,58,237,0.10)] hover:translate-y-0">
      <div
        className="h-16 border-b border-purple-500/15 bg-[radial-gradient(circle_at_20%_10%,rgba(124,58,237,0.42),transparent_34%),linear-gradient(135deg,rgba(88,101,242,0.38),rgba(9,9,11,0.2))]"
        style={banner ? { backgroundImage: `url(${banner})` } : undefined}
      />
      <CardContent className="-mt-8 flex flex-col gap-4 p-4 pt-0 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-end gap-3">
          <Avatar className="h-16 w-16 rounded-2xl border-4 border-[#111114] bg-zinc-900 text-base" fallback={user.globalName || user.username} src={user.avatarUrl ?? user.avatar} />
          <div className="min-w-0 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-white">{user.globalName || user.username}</h2>
              {canViewDev ? <Badge className="border-purple-400/40 bg-purple-500/15 text-purple-100" variant="muted">Administrador DEV</Badge> : null}
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

function MaintenancePanel() {
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [bots, setBots] = useState<DevBot[]>([]);
  const [now, setNow] = useState(() => Date.now());

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
    setSaving(true);
    try {
      setMaintenance(await setMaintenanceMode(active));
    } finally {
      setSaving(false);
    }
  }

  async function handleAlert() {
    setAlerting(true);
    try {
      setMaintenance(await sendMaintenanceAlert());
    } finally {
      setAlerting(false);
    }
  }

  const active = Boolean(maintenance?.active);
  const since = maintenance?.activatedAt ? new Date(maintenance.activatedAt).getTime() : null;
  const elapsed = active && since ? formatDuration(Math.max(0, now - since)) : "00:00:00";

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(8,8,12,0.96))] shadow-[0_0_48px_rgba(124,58,237,0.12)] hover:translate-y-0">
        <CardHeader className="border-b border-purple-500/15 p-5 sm:p-6">
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
                {active ? "🔴 Em manutenção" : "🟢 Online"}
              </Badge>
              <Switch checked={active} disabled={loading || saving} onCheckedChange={(checked) => void handleToggle(checked)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <MaintenanceMetric label="Status do sistema" value={active ? "Ativo" : "Inativo"} />
          <MaintenanceMetric label="Bots afetados" value={String(maintenance?.affectedBots ?? 0)} />
          <MaintenanceMetric label="Tempo em manutenção" value={elapsed} />
          <MaintenanceMetric label="Última ativação" value={maintenance?.activatedAt ? formatDate(maintenance.activatedAt) : "Nunca"} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="border-purple-500/20 bg-zinc-950/80 hover:translate-y-0">
          <CardHeader>
            <CardTitle className="text-white">Controle e alerta</CardTitle>
            <CardDescription className="font-medium text-zinc-300">Envie novamente o aviso para os canais configurados pelos bots.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="h-11 w-full bg-purple-600 text-white hover:bg-purple-500" disabled={alerting} onClick={() => void handleAlert()}>
              {alerting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Enviar alerta manual
            </Button>
            <div className="rounded-lg border border-zinc-800 bg-black/35 p-4">
              <p className="text-sm font-bold text-white">Quem ativou</p>
              <p className="mt-1 text-sm font-medium text-zinc-300">{maintenance?.updatedByName ?? "Nenhum registro"}</p>
              <p className="mt-1 font-mono text-xs text-zinc-400">{maintenance?.updatedById ?? "sem-id"}</p>
            </div>
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.07] p-4 text-sm font-semibold leading-6 text-zinc-100">
              ❌ Sistema em manutenção<br />
              Os bots estão em manutenção no momento.<br />
              Aguarde a nossa equipe finalizar a manutenção para realizar novamente.
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-zinc-950/80 hover:translate-y-0">
          <CardHeader>
            <CardTitle className="text-white">Logs de manutenção</CardTitle>
            <CardDescription className="font-medium text-zinc-300">Histórico de ativações, desativações e alertas manuais.</CardDescription>
          </CardHeader>
          <CardContent>
            {maintenance?.logs.length ? (
              <div className="space-y-3">
                {maintenance.logs.map((log) => (
                  <div className="rounded-lg border border-zinc-800 bg-black/35 p-3" key={log.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={log.action === "enabled" ? "danger" : log.action === "disabled" ? "success" : "muted"}>
                        {maintenanceActionLabel(log.action)}
                      </Badge>
                      <span className="text-xs font-medium text-zinc-400">{formatDate(log.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">{log.message}</p>
                    <p className="mt-1 text-xs font-medium text-zinc-300">{log.actorName ?? "Sistema"} · {log.actorId ?? "sem-id"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-sm font-medium text-zinc-300">
                Nenhum log de manutenção registrado.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-purple-500/20 bg-zinc-950/80 hover:translate-y-0">
        <CardHeader>
          <CardTitle className="text-white">Status em tempo real dos bots</CardTitle>
          <CardDescription className="font-medium text-zinc-300">Bots afetados pelo modo de manutenção global.</CardDescription>
        </CardHeader>
        <CardContent>
          {bots.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {bots.map((bot) => (
                <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black/35 p-3" key={bot.id}>
                  <Avatar className="h-10 w-10 rounded-xl border border-zinc-700" fallback={bot.name} src={bot.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{bot.name}</p>
                    <p className="truncate text-xs font-medium text-zinc-300">{bot.mainGuildName || bot.mainGuildId}</p>
                  </div>
                  <Badge variant={bot.status === "online" ? "success" : bot.status === "error" || bot.status === "invalid_token" ? "danger" : "muted"}>
                    {bot.status === "online" ? "Online" : bot.status === "offline" ? "Offline" : "Erro"}
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
    <div className="rounded-lg border border-purple-500/15 bg-black/35 p-4">
      <p className="text-xs font-bold uppercase text-zinc-300">{label}</p>
      <p className="mt-2 truncate text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function maintenanceActionLabel(action: MaintenanceState["logs"][number]["action"]) {
  if (action === "enabled") return "Ativação";
  if (action === "disabled") return "Desativação";
  return "Alerta manual";
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function DevFiveMManager({
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
  const [modules, setModules] = useState<FivemModuleDefinition[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const selectedBot = botList.find((bot) => bot.id === selectedBotId) ?? botList[0] ?? null;
  const viewModules = modules.map(toFiveMModuleView);
  const enabled = new Set((selectedBot?.enabledModules ?? []).map((moduleId) => moduleId === "fivem-fac" ? "fivem-absences" : moduleId));
  const activeModuleCount = viewModules.filter((module) => enabled.has(module.id)).length;
  const stats = {
    active: activeModuleCount,
    corporations: enabled.has("fivem-corporations") ? 1 : 0,
    disabled: viewModules.length - activeModuleCount,
    factions: enabled.has("fivem-factions") ? 1 : 0,
    total: viewModules.length,
    users: botList.reduce((total, bot) => total + (bot.enabledModules.some((moduleId) => moduleId === "fivem" || moduleId.startsWith("fivem-")) ? 1 : 0), 0)
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
        if (mounted) setMessage("Nao foi possivel carregar os modulos FiveM.");
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

    const normalizedModules = normalizeFiveMModules(selectedBot.enabledModules);
    const nextModules = checked
      ? [...new Set([...normalizedModules, "fivem", moduleId])]
      : nextFiveMModulesAfterDisable(normalizedModules, moduleId);

    setSavingModuleId(moduleId);
    try {
      const updated = await updateDevBotModules(selectedBot.id, nextModules);
      setBotList((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
      onBotUpdated(updated);
    } finally {
      setSavingModuleId(null);
    }
  }

  async function handleCreateModule() {
    const name = window.prompt("Nome do novo modulo FiveM");
    if (!name?.trim()) return;

    const description = window.prompt("Descricao do modulo FiveM", "Modulo personalizado criado pelo desenvolvedor.")?.trim()
      || "Modulo personalizado criado pelo desenvolvedor.";
    const permissions = window.prompt("Permissoes do modulo FiveM", "Admin FiveM")?.trim() || "Admin FiveM";

    setMessage(null);
    try {
      const created = await createDevFivemModule({
        description,
        permissions,
        title: name.trim()
      });
      setModules((current) => [created, ...current]);
      setMessage("Modulo FiveM criado.");
    } catch {
      setMessage("Nao foi possivel criar o modulo FiveM.");
    }
  }

  async function handleRemoveCustom(moduleId: string) {
    if (!window.confirm("Remover este modulo FiveM?")) return;

    setSavingModuleId(moduleId);
    setMessage(null);
    try {
      const nextBotModules = selectedBot && enabled.has(moduleId)
        ? nextFiveMModulesAfterDisable(normalizeFiveMModules(selectedBot.enabledModules), moduleId)
        : null;
      await deleteDevFivemModule(moduleId);
      if (selectedBot && nextBotModules) {
        const updated = await updateDevBotModules(selectedBot.id, nextBotModules);
        setBotList((current) => current.map((bot) => bot.id === updated.id ? updated : bot));
        onBotUpdated(updated);
      }
      setModules((current) => current.filter((module) => module.id !== moduleId));
      setMessage("Modulo FiveM removido.");
    } catch {
      setMessage("Nao foi possivel remover o modulo FiveM.");
    } finally {
      setSavingModuleId(null);
    }
  }

  async function handleEditCustom(moduleId: string) {
    const current = modules.find((module) => module.id === moduleId);
    if (!current) return;

    const name = window.prompt("Nome do modulo FiveM", current.title);
    if (!name?.trim()) return;
    const description = window.prompt("Descricao do modulo FiveM", current.description)?.trim() || current.description;
    const permissions = window.prompt("Permissoes do modulo FiveM", current.permissions)?.trim() || current.permissions;

    setSavingModuleId(moduleId);
    setMessage(null);
    try {
      const updated = await updateDevFivemModule(moduleId, {
        description,
        permissions,
        title: name.trim()
      });
      setModules((currentModules) => currentModules.map((module) => module.id === moduleId ? updated : module));
      setMessage("Modulo FiveM atualizado.");
    } catch {
      setMessage("Nao foi possivel editar o modulo FiveM.");
    } finally {
      setSavingModuleId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">FiveM Manager</h2>
          <p className="mt-1 text-sm text-zinc-500">Gerencie todos os modulos, sistemas e recursos do FiveM.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none"
            onChange={(event) => onSelectBot(event.target.value || null)}
            value={selectedBot?.id ?? ""}
          >
            {botList.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
          <Button onClick={handleCreateModule}>
            <Plus className="h-4 w-4" />
            Novo Modulo
          </Button>
        </div>
      </section>

      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <FiveMStat icon={Boxes} label="Total de modulos" value={String(stats.total)} />
        <FiveMStat icon={Activity} label="Modulos ativos" value={String(stats.active)} />
        <FiveMStat icon={ShieldAlert} label="Desativados" value={String(stats.disabled)} />
        <FiveMStat icon={Users} label="Usuarios com acesso" value={String(stats.users)} />
        <FiveMStat icon={Building2} label="Faccoes cadastradas" value={String(stats.factions)} />
        <FiveMStat icon={BriefcaseBusiness} label="Corporacoes" value={String(stats.corporations)} />
      </section>

      <Card className="border-zinc-800/80 bg-zinc-950/75">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle>Modulos FiveM</CardTitle>
          <CardDescription>Sistemas RP independentes das configuracoes do bot Discord.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 sm:p-6 sm:pt-0 lg:grid-cols-2">
          {loadingModules ? (
            <div className="flex min-h-28 items-center justify-center rounded-lg border border-zinc-900 bg-black/35 text-sm text-zinc-500 lg:col-span-2">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando modulos FiveM...
            </div>
          ) : viewModules.map((module) => {
            const active = enabled.has(module.id);
            const custom = !module.builtIn;

            return (
              <div className="flex min-h-[112px] gap-4 rounded-lg border border-zinc-900 bg-black/35 p-4" key={module.id}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                  <module.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{module.title}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{module.description}</p>
                      <p className="mt-2 truncate text-xs text-zinc-400">Permissoes: {module.permissions}</p>
                    </div>
                    <Switch checked={active} disabled={!selectedBot || savingModuleId === module.id} onCheckedChange={(checked) => void handleToggle(module.id, checked)} />
                  </div>
                  {custom ? (
                    <div className="mt-3 flex gap-2">
                      <Button disabled={savingModuleId === module.id} onClick={() => void handleEditCustom(module.id)} size="sm" variant="outline"><Pencil className="h-4 w-4" />Editar</Button>
                      <Button disabled={savingModuleId === module.id} onClick={() => void handleRemoveCustom(module.id)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Remover</Button>
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
  return moduleIds.map((moduleId) => moduleId === "fivem-fac" ? "fivem-absences" : moduleId);
}

function nextFiveMModulesAfterDisable(moduleIds: string[], disabledModuleId: string) {
  const withoutModule = moduleIds.filter((moduleId) => moduleId !== disabledModuleId);
  const hasOtherFiveMModule = withoutModule.some((moduleId) => moduleId.startsWith("fivem-"));

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
    "fivem-orders": PackagePlus
  };

  return icons[moduleId] ?? Boxes;
}

function TechnicalLogsPanel({ botId, guildId }: { botId: string | null; guildId: string | null }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!guildId) {
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
          Logs tecnicos
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
            Nenhum log tecnico encontrado.
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
