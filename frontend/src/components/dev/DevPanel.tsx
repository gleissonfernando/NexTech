import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Hash,
  LayoutDashboard,
  Loader2,
  Power,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Unplug,
  Users
} from "lucide-react";
import {
  createDevBot,
  deleteDevBot,
  getDevBots,
  getDevModules,
  restartDevBot,
  updateDevBotModules
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import { dashboardUrl } from "../../lib/urls";
import type {
  AuthUser,
  CreateDevBotPayload,
  DashboardBot,
  DashboardMeGuild,
  DevBot,
  DevBotStatus,
  DevModuleDefinition
} from "../../types";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

const fallbackModules: DevModuleDefinition[] = [
  { id: "live", label: "Sistema de Live" },
  { id: "clips", label: "Sistema de Clips" },
  { id: "network", label: "Rede Social dos Membros" },
  { id: "x-monitor", label: "X Monitor" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "avisos", label: "Mensagens e Personalizacao" }
];

const emptyForm: CreateDevBotPayload = {
  token: "",
  mainGuildId: ""
};

type DevPanelProps = {
  guilds?: DashboardMeGuild[];
  onBotCreated?: (bot: DashboardBot) => void;
  onBotDeleted?: (botId: string) => void;
  onBotUpdated?: (bot: DashboardBot) => void;
  selectedBotId?: string | null;
  selectedGuildId?: string | null;
  onSelectBot?: (botId: string | null) => void;
  onOpenView?: (view: "overview" | "settings" | "logs", bot?: DevBot) => void;
  user?: AuthUser;
};

export function DevPanel({
  guilds = [],
  onBotCreated,
  onBotDeleted,
  onBotUpdated,
  onOpenView,
  onSelectBot,
  selectedBotId: controlledSelectedBotId,
  selectedGuildId,
  user
}: DevPanelProps) {
  const [bots, setBots] = useState<DevBot[]>([]);
  const [modules, setModules] = useState<DevModuleDefinition[]>(fallbackModules);
  const [internalSelectedBotId, setInternalSelectedBotId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateDevBotPayload>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restartingBotId, setRestartingBotId] = useState<string | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedBotId = controlledSelectedBotId ?? internalSelectedBotId;
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;
  const guildNameById = useMemo(() => new Map(guilds.map((guild) => [guild.id, guild.name])), [guilds]);
  const stats = useMemo(
    () => ({
      total: bots.length,
      online: bots.filter((bot) => bot.status === "online").length,
      offline: bots.filter((bot) => bot.status === "offline").length,
      errors: bots.filter((bot) => bot.status === "error" || bot.status === "invalid_token").length
    }),
    [bots]
  );

  useEffect(() => {
    let mounted = true;

    Promise.all([getDevModules(), getDevBots()])
      .then(([moduleData, botData]) => {
        if (!mounted) return;
        setModules(moduleData.length ? moduleData : fallbackModules);
        setBots(botData);
        setInternalSelectedBotId((current) => current ?? controlledSelectedBotId ?? botData[0]?.id ?? null);
      })
      .catch(() => {
        if (mounted) setMessage("Nao foi possivel carregar a area de bots.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      mainGuildId: current.mainGuildId || selectedGuildId || guilds[0]?.id || ""
    }));
  }, [guilds, selectedGuildId]);

  useEffect(() => {
    const socket = createDashboardSocket();

    socket.on("dev:bot_updated", (updatedBot: DashboardBot) => {
      setBots((current) => current.map((bot) => (
        bot.id === updatedBot.id
          ? {
              ...bot,
              ...updatedBot
            }
          : bot
      )));
    });
    socket.on("dev:bot_deleted", (deletedBot: DashboardBot) => {
      setBots((current) => current.filter((bot) => bot.id !== deletedBot.id));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  function updateForm<K extends keyof CreateDevBotPayload>(key: K, value: CreateDevBotPayload[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function handleSelectBotId(botId: string | null) {
    setInternalSelectedBotId(botId);
    onSelectBot?.(botId);
  }

  async function handleCreateBot() {
    const token = form.token.trim();
    const mainGuildId = form.mainGuildId.trim();

    if (token.length < 10) {
      setMessage("Informe um token de bot valido.");
      return;
    }

    if (!/^\d{5,32}$/.test(mainGuildId)) {
      setMessage("Informe um Guild ID valido.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const bot = await createDevBot({
        token,
        mainGuildId
      });
      setBots((current) => [bot, ...current.filter((item) => item.id !== bot.id)]);
      onBotCreated?.(bot);
      handleSelectBotId(bot.id);
      setForm({
        token: "",
        mainGuildId: selectedGuildId || ""
      });
      setMessage(`${bot.name} foi conectado e validado no Discord.`);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel conectar o bot. Confira o token e o Guild ID.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleModule(bot: DevBot, moduleId: string, checked: boolean) {
    const nextModules = checked
      ? [...new Set([...bot.enabledModules, moduleId])]
      : bot.enabledModules.filter((item) => item !== moduleId);

    setBots((current) => current.map((item) => (item.id === bot.id ? { ...item, enabledModules: nextModules } : item)));

    try {
      const updated = await updateDevBotModules(bot.id, nextModules);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage("Modulos atualizados.");
    } catch {
      setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)));
      setMessage("Nao foi possivel atualizar os modulos.");
    }
  }

  async function handleRestart(bot: DevBot) {
    setRestartingBotId(bot.id);
    setMessage(null);

    try {
      const updated = await restartDevBot(bot.id);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage(updated.statusMessage ?? "Bot sincronizado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel reiniciar esse bot.");
    } finally {
      setRestartingBotId(null);
    }
  }

  async function handleDelete(bot: DevBot) {
    if (!window.confirm(`Desconectar ${bot.name}?`)) {
      return;
    }

    setDeletingBotId(bot.id);
    setMessage(null);

    try {
      await deleteDevBot(bot.id);
      const remainingBots = bots.filter((item) => item.id !== bot.id);
      setBots(remainingBots);
      onBotDeleted?.(bot.id);
      if (selectedBot?.id === bot.id) {
        handleSelectBotId(remainingBots[0]?.id ?? null);
      }
      setMessage("Bot desconectado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel desconectar o bot.");
    } finally {
      setDeletingBotId(null);
    }
  }

  function openSelectedBotView(view: "overview" | "settings" | "logs") {
    if (!selectedBot) return;
    handleSelectBotId(selectedBot.id);
    onOpenView?.(view, selectedBot);
  }

  function openModuleSettings() {
    document.getElementById("dev-bot-module-settings")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center p-6">
          <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-7">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DevStatCard
          icon={Bot}
          iconClassName="border-purple-500/25 bg-purple-500/10 text-purple-200"
          label="Bots cadastrados"
          value={String(stats.total)}
        />
        <DevStatCard
          icon={CheckCircle2}
          iconClassName="border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          label="Bots online"
          value={String(stats.online)}
        />
        <DevStatCard
          icon={Unplug}
          iconClassName="border-zinc-700 bg-zinc-900 text-zinc-300"
          label="Bots offline"
          value={String(stats.offline)}
        />
        <DevStatCard
          icon={Circle}
          iconClassName="border-red-500/25 bg-red-500/10 text-red-300"
          label="Com erro"
          value={String(stats.errors)}
        />
      </section>

      {message ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-950/85 px-4 py-3 text-sm text-zinc-100 shadow-lg">
          {message}
        </div>
      ) : null}

      <section className="grid items-stretch gap-6 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.05fr)]">
        <Card className="flex h-full flex-col border-[#5865f2]/30 bg-black/70 backdrop-blur-xl hover:translate-y-0">
          <CardHeader className="border-b border-zinc-900/80 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#5865f2] text-white shadow-[0_12px_30px_rgba(88,101,242,0.3)]">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Conectar Bot</CardTitle>
                <CardDescription>Token e servidor. O Discord fornece o restante.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5 p-5 pt-5 sm:p-6 sm:pt-6">
            <DevInput
              autoComplete="off"
              label="Token do Bot"
              onChange={(value) => updateForm("token", value)}
              placeholder="••••••••••••••••••••••••"
              type="password"
              value={form.token}
            />
            <DevInput
              inputMode="numeric"
              label="Servidor (Guild ID)"
              onChange={(value) => updateForm("mainGuildId", value.replace(/\D/g, ""))}
              placeholder="123456789012345678"
              value={form.mainGuildId}
            />

            <div className="flex flex-col gap-3 rounded-lg border border-zinc-900 bg-zinc-950/65 p-4 sm:flex-row sm:items-center">
              <Avatar
                className="h-10 w-10 rounded-full border border-zinc-800"
                fallback={user?.globalName || user?.username || "Discord"}
                src={user?.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {user?.globalName || user?.username || "Usuario Discord autenticado"}
                </p>
                <p className="truncate text-xs text-zinc-500">Responsavel via Discord OAuth2</p>
              </div>
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
            </div>

            <Button
              className="h-12 w-full bg-[#5865f2] text-white shadow-[0_14px_34px_rgba(88,101,242,0.28)] hover:bg-[#4752c4]"
              disabled={saving || form.token.trim().length < 10 || !/^\d{5,32}$/.test(form.mainGuildId)}
              onClick={handleCreateBot}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {saving ? "Validando no Discord..." : "Conectar Bot"}
            </Button>

            <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
              <AutomaticField label="Nome e avatar" />
              <AutomaticField label="Application ID" />
              <AutomaticField label="Data de criacao" />
              <AutomaticField label="Dados do servidor" />
            </div>
          </CardContent>
        </Card>

        {selectedBot ? (
          <ConnectedBotPanel
            bot={selectedBot}
            deleting={deletingBotId === selectedBot.id}
            guildName={selectedBot.mainGuildName || guildNameById.get(selectedBot.mainGuildId) || "Servidor Discord"}
            onDelete={() => void handleDelete(selectedBot)}
            onOpenDashboard={() => openSelectedBotView("overview")}
            onOpenLogs={() => openSelectedBotView("logs")}
            onOpenSettings={openModuleSettings}
            onRestart={() => void handleRestart(selectedBot)}
            restarting={restartingBotId === selectedBot.id}
          />
        ) : (
          <Card className="flex h-full min-h-[420px] border-dashed border-zinc-800 bg-zinc-950/45 hover:translate-y-0">
            <CardContent className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-zinc-800 bg-black">
                <Bot className="h-7 w-7 text-zinc-500" />
              </div>
              <p className="text-sm font-semibold text-zinc-200">Nenhum bot selecionado</p>
              <p className="mt-1 text-sm text-zinc-500">Conecte um bot ou selecione um da lista.</p>
            </CardContent>
          </Card>
        )}
      </section>

      <Card className="border-zinc-800/80 bg-zinc-950/75">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle>Bots conectados</CardTitle>
          <CardDescription>{bots.length} bot{bots.length === 1 ? "" : "s"} nesta hospedagem.</CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
          {bots.length ? (
            <div className="grid gap-3">
              {bots.map((bot) => (
                <div
                  className={`flex flex-col gap-3 rounded-lg border p-3.5 transition duration-200 sm:flex-row sm:items-center sm:justify-between ${
                    selectedBot?.id === bot.id
                      ? "border-[#5865f2]/55 bg-[#5865f2]/10 shadow-[0_0_0_1px_rgba(88,101,242,0.16)]"
                      : "border-zinc-900 bg-black/35 hover:border-zinc-700 hover:bg-zinc-950/70"
                  }`}
                  key={bot.id}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => handleSelectBotId(bot.id)}
                    type="button"
                  >
                    <Avatar className="h-12 w-12 shrink-0 rounded-full border border-zinc-800" fallback={bot.name} src={bot.avatarUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">{bot.name}</span>
                        <StatusDot status={bot.status} />
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {bot.mainGuildName || guildNameById.get(bot.mainGuildId) || bot.mainGuildId}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-zinc-600">{bot.clientId}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                    <Button
                      disabled={restartingBotId === bot.id}
                      onClick={() => void handleRestart(bot)}
                      size="icon"
                      title="Reiniciar bot"
                      variant="outline"
                    >
                      {restartingBotId === bot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                    </Button>
                    <Button
                      disabled={deletingBotId === bot.id}
                      onClick={() => void handleDelete(bot)}
                      size="icon"
                      title="Desconectar bot"
                      variant="destructive"
                    >
                      {deletingBotId === bot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-black/25 text-sm text-zinc-500">
              Nenhum bot conectado.
            </div>
          )}
        </CardContent>
      </Card>

      {selectedBot ? (
        <Card className="border-zinc-800/80 bg-zinc-950/75" id="dev-bot-module-settings">
          <CardHeader className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Configuracoes de bot</CardTitle>
                <CardDescription>Modulos visiveis na dashboard de {selectedBot.name}.</CardDescription>
              </div>
              <Badge variant="muted">{selectedBot.enabledModules.length}/{modules.length} ativos</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-0 sm:p-6 sm:pt-0">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-zinc-100">Acesso protegido</p>
                <p className="text-xs text-zinc-500">Login Discord e cargo autorizado para este bot.</p>
              </div>
            </div>
            <ModuleSwitchGrid
              enabledModules={selectedBot.enabledModules}
              modules={modules}
              onToggle={(moduleId, checked) => void handleToggleModule(selectedBot, moduleId, checked)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ConnectedBotPanel({
  bot,
  deleting,
  guildName,
  onDelete,
  onOpenDashboard,
  onOpenLogs,
  onOpenSettings,
  onRestart,
  restarting
}: {
  bot: DevBot;
  deleting: boolean;
  guildName: string;
  onDelete: () => void;
  onOpenDashboard: () => void;
  onOpenLogs: () => void;
  onOpenSettings: () => void;
  onRestart: () => void;
  restarting: boolean;
}) {
  const [copiedDashboardUrl, setCopiedDashboardUrl] = useState(false);
  const botDashboardUrl = bot.dashboardUrl || dashboardUrl(bot.slug);

  useEffect(() => {
    setCopiedDashboardUrl(false);
  }, [bot.id]);

  async function handleCopyDashboardUrl() {
    await copyToClipboard(botDashboardUrl);
    setCopiedDashboardUrl(true);
    window.setTimeout(() => setCopiedDashboardUrl(false), 2200);
  }

  function handleOpenDashboardUrl() {
    window.open(botDashboardUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Card className="flex h-full min-h-[420px] flex-col overflow-hidden border-zinc-800 bg-zinc-950/75 backdrop-blur-xl hover:translate-y-0">
      <div className="h-20 shrink-0 border-b border-[#5865f2]/25 bg-[linear-gradient(135deg,rgba(88,101,242,0.32),rgba(16,185,129,0.08),rgba(9,9,11,0.15))]" />
      <CardContent className="-mt-8 flex flex-1 flex-col gap-5 p-5 pt-0 sm:p-6 sm:pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-end gap-3">
            <Avatar
              className="h-16 w-16 rounded-full border-4 border-zinc-950 bg-zinc-900"
              fallback={bot.name}
              src={bot.avatarUrl}
            />
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-semibold text-white">{bot.name}</h3>
                <StatusBadge status={bot.status} />
              </div>
              <p className="truncate text-sm text-zinc-500">{guildName}</p>
            </div>
          </div>
          <Badge variant="muted">{bot.guildIds.length} servidor{bot.guildIds.length === 1 ? "" : "es"}</Badge>
        </div>

        <div className="grid gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-2">
          <BotDetail icon={Hash} label="Client / Application ID" value={bot.clientId} />
          <BotDetail icon={CalendarDays} label="Criado em" value={bot.botCreatedAt ? formatDate(bot.botCreatedAt) : "Nao informado"} />
          <BotDetail icon={Server} label="Servidor" value={guildName} />
          <BotDetail icon={Users} label="Membros" value={bot.mainGuildMemberCount.toLocaleString("pt-BR")} />
        </div>

        {bot.statusMessage ? (
          <div className={`rounded-lg border px-3 py-2 text-sm ${
            bot.status === "online"
              ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200"
              : bot.status === "error" || bot.status === "invalid_token"
                ? "border-red-500/25 bg-red-500/[0.07] text-red-200"
                : "border-zinc-800 bg-black/30 text-zinc-400"
          }`}>
            {bot.statusMessage}
          </div>
        ) : null}

        <div className="rounded-lg border border-[#5865f2]/25 bg-[#5865f2]/[0.06] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-purple-200">URL da Dashboard</p>
              <p className="mt-1 break-all font-mono text-sm text-zinc-100">{botDashboardUrl}</p>
              <p className={`mt-2 text-xs text-emerald-300 transition duration-300 ${copiedDashboardUrl ? "opacity-100" : "opacity-0"}`}>
                URL copiada com sucesso.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void handleCopyDashboardUrl()} size="sm" variant="outline">
                {copiedDashboardUrl ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                Copiar URL
              </Button>
              <Button onClick={handleOpenDashboardUrl} size="sm" variant="outline">
                <ExternalLink className="h-4 w-4" />
                Abrir Dashboard
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-900 pt-4">
          <Button onClick={onOpenDashboard} size="sm">
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Button>
          <Button onClick={onOpenSettings} size="sm" variant="outline">
            <Settings className="h-4 w-4" />
            Configuracoes
          </Button>
          <Button onClick={onOpenLogs} size="sm" variant="outline">
            <ScrollText className="h-4 w-4" />
            Logs
          </Button>
          <Button disabled={restarting} onClick={onRestart} size="icon" title="Reiniciar bot" variant="outline">
            {restarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
          </Button>
          <Button disabled={deleting} onClick={onDelete} size="icon" title="Desconectar bot" variant="destructive">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BotDetail({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 bg-zinc-950 p-4">
      <p className="flex items-center gap-2 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-zinc-100" title={value}>{value}</p>
    </div>
  );
}

function AutomaticField({ label }: { label: string }) {
  return (
    <span className="flex min-h-10 items-center gap-2 rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      {label}
    </span>
  );
}

function DevStatCard({
  icon: Icon = Bot,
  iconClassName = "border-zinc-800 bg-black text-zinc-200",
  label,
  value
}: {
  icon?: typeof Bot;
  iconClassName?: string;
  label: string;
  value: string;
}) {
  return (
    <Card className="h-full border-zinc-800/80 bg-zinc-950/75 hover:translate-y-0">
      <CardContent className="flex min-h-[116px] items-center gap-4 p-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${iconClassName}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-400">{label}</p>
          <p className="mt-1 text-3xl font-semibold leading-none text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DevInput({
  autoComplete,
  inputMode,
  label,
  onChange,
  placeholder,
  type = "text",
  value
}: {
  autoComplete?: string;
  inputMode?: "numeric";
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input
        autoComplete={autoComplete}
        className="social-input h-12"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function ModuleSwitchGrid({
  enabledModules,
  modules,
  onToggle
}: {
  enabledModules: string[];
  modules: DevModuleDefinition[];
  onToggle: (moduleId: string, checked: boolean) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {modules.map((module) => {
        const enabled = enabledModules.includes(module.id);

        return (
          <div
            className="flex min-h-[74px] items-center gap-4 rounded-lg border border-zinc-900 bg-black/35 px-4 py-3 transition duration-200 hover:border-zinc-800 hover:bg-zinc-950/70"
            key={module.id}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{module.label}</p>
              <p className={enabled ? "text-xs text-emerald-300" : "text-xs text-zinc-500"}>
                {enabled ? "Ativado" : "Desativado"}
              </p>
            </div>
            <Switch checked={enabled} className="shrink-0" onCheckedChange={(checked) => onToggle(module.id, checked)} />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: DevBotStatus }) {
  const connected = status === "online";

  return (
    <Badge variant={connected ? "success" : status === "invalid_token" || status === "error" ? "danger" : "muted"}>
      {connected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Circle className="h-3.5 w-3.5" />}
      {statusLabel(status)}
    </Badge>
  );
}

function StatusDot({ status }: { status: DevBotStatus }) {
  return (
    <span
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
        status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-zinc-500" : "bg-red-400"
      }`}
      title={statusLabel(status)}
    />
  );
}

function statusLabel(status: DevBotStatus) {
  const labels: Record<DevBotStatus, string> = {
    online: "Online",
    offline: "Offline",
    invalid_token: "Token invalido",
    error: "Erro"
  };

  return labels[status];
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
