import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Code2,
  Copy,
  LayoutDashboard,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
  UserCog,
  Bell,
  CreditCard
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
  deleteDevAccessEntry,
  getDashboardMe,
  getDevAccessEntries,
  getDevBots,
  getDevFivemModules,
  getMaintenanceState,
  getLogs,
  sendMaintenanceAlert,
  saveDevAccessEntry,
  setMaintenanceMode,
  updateDevBotModules,
  updateDevFivemModule
} from "../lib/api";
import { createDashboardSocket } from "../lib/socket";
import { dashboardUrl } from "../lib/urls";
import type { AuthResponse, DashboardBot, DashboardMeResponse, DevAccessEntry, DevAccessRole, DevBot, FivemModuleDefinition, LogEntry, MaintenanceState } from "../types";

type DevDashboardProps = {
  auth: AuthResponse;
  initialView?: DevView;
  onLogout: () => void;
};

type DevView = "bots" | "connected" | "bot-menu" | "cloning" | "sales" | "fivem" | "police" | "logs" | "access" | "maintenance";

type FiveMModuleView = FivemModuleDefinition & {
  icon: LucideIcon;
};

const MAINTENANCE_GIF_URL = "/maintenance/nft-coding.gif";

export function DevDashboard({ auth, initialView = "bots", onLogout }: DevDashboardProps) {
  const [profile, setProfile] = useState<DashboardMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DevView>(initialView);

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.14),transparent_34%),linear-gradient(180deg,#050506,#08080b_48%,#050505)] text-white lg:pl-72">
      <DevSidebar
        activeView={activeView}
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
                <Badge className="text-zinc-100" variant="muted">Policia</Badge>
                <Badge className="text-zinc-100" variant="muted">Módulos globais</Badge>
                <Badge className="text-zinc-100" variant="muted">Logs técnicos</Badge>
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
        {!isBotManagerView(activeView) ? <DevUserCard user={auth.user} canViewDev={profile.canViewDev} /> : null}

        <div className="flex gap-2 overflow-x-auto lg:hidden">
          {[
            { id: "bots" as const, label: "Dashboard" },
            { id: "connected" as const, label: "Bots conectados" },
            { id: "bot-menu" as const, label: "Menu do Bot" },
            { id: "cloning" as const, label: "Clonagem" },
            { id: "sales" as const, label: "Vendas" },
            { id: "fivem" as const, label: "FiveM" },
            { id: "police" as const, label: "Policia" },
            { id: "logs" as const, label: "Logs" },
            { id: "access" as const, label: "Acessos" },
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

        {activeView === "logs" ? <TechnicalLogsPanel botId={selectedBotId} guildId={selectedGuildId} /> : null}
        {activeView === "access" ? <DevAccessPanel /> : null}
        {activeView === "maintenance" ? <MaintenancePanel /> : null}
      </div>
    </main>
  );
}

function devPathForView(view: DevView) {
  if (view === "connected") return "/dev/bots-conectados";
  if (view === "bot-menu") return "/dev/menu-do-bot";
  if (view === "cloning") return "/dev/clonagem";
  if (view === "sales") return "/dev/vendas-orvitech";
  if (view === "fivem") return "/dev/fivem";
  if (view === "police") return "/dev/policia";
  if (view === "logs") return "/dev/logs";
  if (view === "access") return "/dev/acessos";
  if (view === "maintenance") return "/dev/maintenance";
  return "/dev";
}

function isBotManagerView(view: DevView) {
  return view === "bots" || view === "connected" || view === "bot-menu" || view === "cloning" || view === "sales";
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
  const items: Array<{ icon: LucideIcon; id: DevView; label: string }> = [
    { icon: LayoutDashboard, id: "bots", label: "Dashboard" },
    { icon: Boxes, id: "connected", label: "Bots conectados" },
    { icon: Settings, id: "bot-menu", label: "Menu do Bot" },
    { icon: Copy, id: "cloning", label: "Clonagem" },
    { icon: CreditCard, id: "sales", label: "Vendas OrviTech" },
    { icon: Building2, id: "fivem", label: "FiveM" },
    { icon: ShieldCheck, id: "police", label: "Policia" },
    { icon: ScrollText, id: "logs", label: "Logs" },
    { icon: UserCog, id: "access", label: "Acessos DEV" },
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
        if (mounted) setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar os acessos DEV.");
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
      setMessage("Informe um Discord ID valido.");
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
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o acesso DEV.");
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
      setMessage(readRequestMessage(error) ?? "Nao foi possivel remover o acesso DEV.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-purple-500/20 bg-[#0b0b10]/90">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="h-5 w-5 text-purple-200" />
          Acessos DEV
        </CardTitle>
        <CardDescription>Cadastre contas Discord autorizadas a entrar no painel DEV.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">{message}</div> : null}

        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]" onSubmit={(event) => void handleSubmit(event)}>
          <input
            className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none transition focus:border-purple-400"
            onChange={(event) => setUserId(event.target.value)}
            placeholder="Discord ID do usuario"
            value={userId}
          />
          <select
            className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none transition focus:border-purple-400"
            onChange={(event) => setRole(event.target.value as DevAccessRole)}
            value={role}
          >
            <option value="dev">Dev</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <Button disabled={saving} type="submit">
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
  const activeModuleCount = viewModules.filter((module) => enabled.has(module.id)).length;
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
      title: "Policia Manager",
      description: "Gerencie sistemas policiais separados dos modulos FiveM.",
      cardTitle: "Modulos de Policia",
      cardDescription: "Sistemas policiais independentes das configuracoes gerais de RP.",
      loading: "Carregando modulos de Policia...",
      createPrompt: "Nome do novo modulo de Policia",
      descriptionPrompt: "Descricao do modulo de Policia",
      defaultDescription: "Modulo policial personalizado criado pelo desenvolvedor.",
      permissionsPrompt: "Permissoes do modulo de Policia",
      defaultPermissions: "Admin Policia",
      created: "Modulo de Policia criado.",
      createError: "Nao foi possivel criar o modulo de Policia.",
      removeConfirm: "Remover este modulo de Policia?",
      removed: "Modulo de Policia removido.",
      removeError: "Nao foi possivel remover o modulo de Policia.",
      editNamePrompt: "Nome do modulo de Policia",
      editDescriptionPrompt: "Descricao do modulo de Policia",
      editPermissionsPrompt: "Permissoes do modulo de Policia",
      updated: "Modulo de Policia atualizado.",
      updateError: "Nao foi possivel editar o modulo de Policia."
    }
    : {
      title: "FiveM Manager",
      description: "Gerencie todos os modulos, sistemas e recursos do FiveM.",
      cardTitle: "Modulos FiveM",
      cardDescription: "Sistemas RP independentes das configuracoes do bot Discord.",
      loading: "Carregando modulos FiveM...",
      createPrompt: "Nome do novo modulo FiveM",
      descriptionPrompt: "Descricao do modulo FiveM",
      defaultDescription: "Modulo personalizado criado pelo desenvolvedor.",
      permissionsPrompt: "Permissoes do modulo FiveM",
      defaultPermissions: "Admin FiveM",
      created: "Modulo FiveM criado.",
      createError: "Nao foi possivel criar o modulo FiveM.",
      removeConfirm: "Remover este modulo FiveM?",
      removed: "Modulo FiveM removido.",
      removeError: "Nao foi possivel remover o modulo FiveM.",
      editNamePrompt: "Nome do modulo FiveM",
      editDescriptionPrompt: "Descricao do modulo FiveM",
      editPermissionsPrompt: "Permissoes do modulo FiveM",
      updated: "Modulo FiveM atualizado.",
      updateError: "Nao foi possivel editar o modulo FiveM."
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
        if (mounted) setMessage(scope === "police" ? "Nao foi possivel carregar os modulos de Policia." : "Nao foi possivel carregar os modulos FiveM.");
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
    const nextModules = scope === "police"
      ? checked
        ? [...new Set([...normalizedModules, moduleId])]
        : normalizedModules.filter((currentModuleId) => currentModuleId !== moduleId)
      : checked
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
      const nextBotModules = selectedBot && enabled.has(moduleId)
        ? scope === "police"
          ? normalizeFiveMModules(selectedBot.enabledModules).filter((currentModuleId) => currentModuleId !== moduleId)
          : nextFiveMModulesAfterDisable(normalizeFiveMModules(selectedBot.enabledModules), moduleId)
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
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">{copy.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{copy.description}</p>
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
        <FiveMStat icon={Users} label="Usuarios com acesso" value={String(stats.users)} />
        <FiveMStat icon={Building2} label="Faccoes cadastradas" value={String(stats.factions)} />
        <FiveMStat icon={BriefcaseBusiness} label="Corporacoes" value={String(stats.corporations)} />
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
                      <p className="mt-2 truncate text-xs text-zinc-400">Permissões: {module.permissions}</p>
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
    "police-actions": Activity,
    "police-patrol-reports": ShieldCheck
  };

  return icons[moduleId] ?? Boxes;
}

function isPoliceModule(moduleId: string) {
  return moduleId === "fivem-hierarchy" || moduleId === "police-actions" || moduleId === "police-patrol-reports";
}

function isFiveMManagerModule(moduleId: string) {
  return !isPoliceModule(moduleId) && (moduleId === "fivem" || moduleId.startsWith("fivem-"));
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

function readRequestMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}
