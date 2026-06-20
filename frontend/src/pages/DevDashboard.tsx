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
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DevPanel } from "../components/dev/DevPanel";
import { UserProfile } from "../components/UserProfile";
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
  getLogs,
  updateDevBotModules,
  updateDevFivemModule
} from "../lib/api";
import { dashboardUrl } from "../lib/urls";
import type { AuthResponse, DashboardBot, DashboardMeResponse, FivemModuleDefinition, LogEntry } from "../types";

type DevDashboardProps = {
  auth: AuthResponse;
  initialView?: DevView;
  onLogout: () => void;
};

type DevView = "bots" | "fivem" | "logs";

type FiveMModuleView = FivemModuleDefinition & {
  icon: LucideIcon;
};

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
    <main className="min-h-screen bg-[#050505] lg:pl-72">
      <DevSidebar activeView={activeView} onChangeView={handleChangeView} />
      <header className="sticky top-0 z-20 border-b border-zinc-900/80 bg-[#050505]/95 px-4 py-4 backdrop-blur-xl lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-purple-500/35 bg-purple-500/10 text-purple-100 shadow-[0_0_28px_rgba(124,58,237,0.18)]">
              <Code2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-white">Painel DEV</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className="border-purple-500/30 bg-purple-500/10 text-purple-100" variant="muted">Bots</Badge>
                <Badge variant="muted">FiveM</Badge>
                <Badge variant="muted">Modulos globais</Badge>
                <Badge variant="muted">Logs tecnicos</Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
            <Button className="shrink-0" onClick={() => window.location.replace("/dashboard")} variant="outline">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
            <UserProfile dashboardUser={profile.user} onLogout={onLogout} user={auth.user} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 lg:px-8">
        <div className="flex gap-2 overflow-x-auto lg:hidden">
          {[
            { id: "bots" as const, label: "Dashboard" },
            { id: "fivem" as const, label: "FiveM" },
            { id: "logs" as const, label: "Logs" }
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
            guilds={profile.guilds}
            onBotCreated={handleBotCreated}
            onBotDeleted={handleBotDeleted}
            onBotUpdated={handleBotUpdated}
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
      </div>
    </main>
  );
}

function devPathForView(view: DevView) {
  if (view === "fivem") return "/dev/fivem";
  if (view === "logs") return "/dev/logs";
  return "/dev";
}

function DevSidebar({ activeView, onChangeView }: { activeView: DevView; onChangeView: (view: DevView) => void }) {
  const items: Array<{ icon: LucideIcon; id: DevView; label: string }> = [
    { icon: LayoutDashboard, id: "bots", label: "Dashboard" },
    { icon: Building2, id: "fivem", label: "FiveM" },
    { icon: ScrollText, id: "logs", label: "Logs" }
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-zinc-900 bg-[#090909] px-4 py-4 lg:flex">
      <div className="mb-5 flex h-12 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-100">
          <Code2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Painel DEV</p>
          <p className="truncate text-xs text-zinc-500">Menu principal</p>
        </div>
      </div>
      <nav className="space-y-1">
        {items.map((item) => (
          <button
            className={[
              "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition",
              activeView === item.id ? "bg-purple-500/15 text-white ring-1 ring-purple-500/25" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            ].join(" ")}
            key={item.id}
            onClick={() => onChangeView(item.id)}
            type="button"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
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
