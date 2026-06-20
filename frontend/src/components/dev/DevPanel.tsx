import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Gamepad2,
  Hash,
  LayoutDashboard,
  Link2,
  Loader2,
  MessageSquare,
  Power,
  Search,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Ticket,
  Trash2,
  Unplug,
  UserCheck,
  Users
} from "lucide-react";
import {
  createDevBot,
  deleteDevBot,
  getDevBots,
  getDevModules,
  restartDevBot,
  stopDevBot,
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
  { id: "kick-integration", label: "Kick Integration" },
  { id: "clips", label: "Sistema de Clips" },
  { id: "kick-clips", label: "Clipes Kick" },
  { id: "giveaway", label: "Sistema de Sorteio" },
  { id: "network", label: "Rede Social dos Membros" },
  { id: "x-monitor", label: "X Monitor" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "mission-tools", label: "Mission Tools" },
  { id: "voice-recorder", label: "Voice Recorder" },
  { id: "safe-bot", label: "SelfBot Protection" },
  { id: "account-age-security", label: "Seguranca por Idade da Conta" },
  { id: "fivem", label: "FiveM" },
  { id: "fivem-factions", label: "FiveM - Sistema de Faccao" },
  { id: "fivem-corporations", label: "FiveM - Sistema de Corporacoes" },
  { id: "fivem-absences", label: "FiveM - Sistema de Ausencias" },
  { id: "fivem-orders", label: "FiveM - Sistema de Encomendas" },
  { id: "fivem-ammo", label: "FiveM - Sistema de Municoes" },
  { id: "fivem-finance", label: "FiveM - Sistema Financeiro" },
  { id: "fivem-fac", label: "FiveM - FAC Ausencia" },
  { id: "avisos", label: "Mensagens e Personalizacao" }
];

const emptyForm: CreateDevBotPayload = {
  token: "",
  mainGuildId: ""
};

type BotMenuId =
  | "overview"
  | "settings"
  | "moderation"
  | "tickets"
  | "verification"
  | "logs"
  | "economy"
  | "discord"
  | "fivem"
  | "fivem-factions"
  | "fivem-ammo"
  | "fivem-orders"
  | "fivem-finance"
  | "fivem-production"
  | "integrations";

type BotMenuItem = {
  id: BotMenuId;
  label: string;
  description: string;
  icon: typeof Bot;
  moduleIds: string[];
  children?: BotMenuItem[];
};

const botMenuItems: BotMenuItem[] = [
  {
    id: "overview",
    label: "Visao Geral",
    description: "Resumo do bot selecionado",
    icon: LayoutDashboard,
    moduleIds: []
  },
  {
    id: "settings",
    label: "Configuracoes",
    description: "Ajustes gerais do bot",
    icon: Settings,
    moduleIds: ["avisos", "mission-tools", "voice-recorder"]
  },
  {
    id: "moderation",
    label: "Moderacao",
    description: "Ban, kick, warn e protecoes",
    icon: ShieldCheck,
    moduleIds: ["moderation", "safe-bot", "account-age-security"]
  },
  {
    id: "tickets",
    label: "Tickets",
    description: "Atendimento e suporte",
    icon: Ticket,
    moduleIds: ["tickets"]
  },
  {
    id: "verification",
    label: "Verificacao",
    description: "Entrada segura no servidor",
    icon: UserCheck,
    moduleIds: ["verification"]
  },
  {
    id: "logs",
    label: "Logs",
    description: "Eventos e auditoria",
    icon: ScrollText,
    moduleIds: ["logs"]
  },
  {
    id: "economy",
    label: "Economia",
    description: "Sistemas economicos",
    icon: Hash,
    moduleIds: []
  },
  {
    id: "discord",
    label: "Discord",
    description: "Cargos, boas-vindas e mensagens",
    icon: MessageSquare,
    moduleIds: ["roles", "welcome", "leave", "avisos"]
  },
  {
    id: "fivem",
    label: "FiveM",
    description: "Modulos de RP e gestao",
    icon: Gamepad2,
    moduleIds: ["fivem"],
    children: [
      {
        id: "fivem-factions",
        label: "Faccoes",
        description: "Faccoes e ausencias",
        icon: Users,
        moduleIds: ["fivem-factions", "fivem-absences", "fivem-fac"]
      },
      {
        id: "fivem-ammo",
        label: "Municoes",
        description: "Controle de municoes",
        icon: Hash,
        moduleIds: ["fivem-ammo"]
      },
      {
        id: "fivem-orders",
        label: "Encomendas",
        description: "Pedidos e entregas",
        icon: Ticket,
        moduleIds: ["fivem-orders"]
      },
      {
        id: "fivem-finance",
        label: "Financeiro",
        description: "Caixa e financeiro",
        icon: ScrollText,
        moduleIds: ["fivem-finance"]
      },
      {
        id: "fivem-production",
        label: "Producao",
        description: "Producao e corporacoes",
        icon: Settings,
        moduleIds: ["fivem-corporations"]
      }
    ]
  },
  {
    id: "integrations",
    label: "Integracoes",
    description: "Lives, clips e redes",
    icon: Link2,
    moduleIds: ["live", "kick-integration", "clips", "kick-clips", "network", "x-monitor", "giveaway"]
  }
];

type DevPanelProps = {
  activeDashboardSection?: DevDashboardSection;
  guilds?: DashboardMeGuild[];
  onBotCreated?: (bot: DashboardBot) => void;
  onBotDeleted?: (botId: string) => void;
  onBotUpdated?: (bot: DashboardBot) => void;
  onDashboardSectionChange?: (section: DevDashboardSection) => void;
  selectedBotId?: string | null;
  selectedGuildId?: string | null;
  onSelectBot?: (botId: string | null) => void;
  onOpenView?: (view: "overview" | "settings" | "logs", bot?: DevBot) => void;
  user?: AuthUser;
};

export type DevDashboardSection = "connected" | "bot-menu";

export function DevPanel({
  activeDashboardSection = "connected",
  guilds = [],
  onBotCreated,
  onBotDeleted,
  onBotUpdated,
  onDashboardSectionChange,
  onOpenView,
  onSelectBot,
  selectedBotId: controlledSelectedBotId,
  selectedGuildId,
  user
}: DevPanelProps) {
  const [bots, setBots] = useState<DevBot[]>([]);
  const [modules, setModules] = useState<DevModuleDefinition[]>(fallbackModules);
  const [internalSelectedBotId, setInternalSelectedBotId] = useState<string | null>(null);
  const [activeBotMenuId, setActiveBotMenuId] = useState<BotMenuId>("overview");
  const [form, setForm] = useState<CreateDevBotPayload>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [poweringBotId, setPoweringBotId] = useState<string | null>(null);
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
  const visibleStats = selectedBot
    ? [
        {
          icon: Bot,
          iconClassName: "border-purple-500/25 bg-purple-500/10 text-purple-200",
          label: "Bot selecionado",
          value: selectedBot.name
        },
        {
          icon: CheckCircle2,
          iconClassName: selectedBot.status === "online"
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
            : "border-zinc-700 bg-zinc-900 text-zinc-300",
          label: "Status",
          value: statusLabel(selectedBot.status)
        },
        {
          icon: LayoutDashboard,
          iconClassName: "border-[#5865f2]/25 bg-[#5865f2]/10 text-[#c7d2fe]",
          label: "Modulos ativos",
          value: `${selectedBot.enabledModules.length}/${modules.length}`
        },
        {
          icon: Server,
          iconClassName: "border-zinc-700 bg-zinc-900 text-zinc-300",
          label: "Servidores",
          value: String(selectedBot.guildIds.length)
        }
      ]
    : [
        {
          icon: Bot,
          iconClassName: "border-purple-500/25 bg-purple-500/10 text-purple-200",
          label: "Bots cadastrados",
          value: String(stats.total)
        },
        {
          icon: CheckCircle2,
          iconClassName: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
          label: "Bots online",
          value: String(stats.online)
        },
        {
          icon: Unplug,
          iconClassName: "border-zinc-700 bg-zinc-900 text-zinc-300",
          label: "Bots offline",
          value: String(stats.offline)
        },
        {
          icon: Circle,
          iconClassName: "border-red-500/25 bg-red-500/10 text-red-300",
          label: "Com erro",
          value: String(stats.errors)
        }
      ];

  useEffect(() => {
    let mounted = true;

    Promise.all([getDevModules(), getDevBots()])
      .then(([moduleData, botData]) => {
        if (!mounted) return;
        setModules(mergeDevModules(moduleData));
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
    if (!selectedBot) {
      return;
    }

    const visibleMenuIds = new Set(flattenBotMenuItems(visibleBotMenuItems(botMenuItems, modules, selectedBot.enabledModules)).map((item) => item.id));

    if (!visibleMenuIds.has(activeBotMenuId)) {
      setActiveBotMenuId("overview");
    }
  }, [activeBotMenuId, modules, selectedBot]);

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
    setActiveBotMenuId("overview");
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
      ? [...new Set([...bot.enabledModules, ...(isFiveMModule(moduleId) && moduleId !== "fivem" ? ["fivem"] : []), moduleId])]
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

  async function handlePower(bot: DevBot) {
    const shouldStop = bot.status === "online";

    setPoweringBotId(bot.id);
    setMessage(null);

    if (shouldStop) {
      setBots((current) => current.map((item) => (
        item.id === bot.id
          ? {
              ...item,
              status: "offline",
              statusMessage: "Desligando bot pelo painel DEV."
            }
          : item
      )));
    }

    try {
      const updated = shouldStop ? await stopDevBot(bot.id) : await restartDevBot(bot.id);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage(updated.statusMessage ?? (shouldStop ? "Bot desligado." : "Bot sincronizado."));
    } catch (error) {
      if (shouldStop) {
        setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)));
      }

      setMessage(readRequestMessage(error) ?? (shouldStop ? "Nao foi possivel desligar esse bot." : "Nao foi possivel ligar esse bot."));
    } finally {
      setPoweringBotId(null);
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
    onDashboardSectionChange?.("bot-menu");
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
      <BotGlobalSelect bots={bots} selectedBotId={selectedBotId} onSelectBot={handleSelectBotId} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visibleStats.map((stat) => (
          <DevStatCard
            icon={stat.icon}
            iconClassName={stat.iconClassName}
            key={stat.label}
            label={stat.label}
            value={stat.value}
          />
        ))}
      </section>

      {message ? (
        <div className="rounded-lg border border-purple-400/25 bg-purple-500/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(124,58,237,0.12)]">
          {message}
        </div>
      ) : null}

      <section className="grid items-stretch gap-6 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.05fr)]">
        <Card className="flex h-full flex-col border-purple-500/25 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(7,7,10,0.96))] shadow-[0_0_42px_rgba(124,58,237,0.10)] backdrop-blur-xl hover:translate-y-0">
          <CardHeader className="border-b border-purple-500/15 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-purple-600 text-white shadow-[0_12px_30px_rgba(124,58,237,0.34)]">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-white">Conectar Bot</CardTitle>
                <CardDescription className="font-medium text-zinc-300">Token e servidor. O Discord fornece o restante.</CardDescription>
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

            <div className="flex flex-col gap-3 rounded-lg border border-purple-500/15 bg-white/[0.05] p-4 sm:flex-row sm:items-center">
              <Avatar
                className="h-10 w-10 rounded-full border border-zinc-800"
                fallback={user?.globalName || user?.username || "Discord"}
                src={user?.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {user?.globalName || user?.username || "Usuario Discord autenticado"}
                </p>
                <p className="truncate text-xs font-medium text-zinc-300">Responsavel via Discord OAuth2</p>
              </div>
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
            </div>

            <Button
              className="h-12 w-full bg-purple-600 text-white shadow-[0_14px_34px_rgba(124,58,237,0.30)] hover:bg-purple-500"
              disabled={saving || form.token.trim().length < 10 || !/^\d{5,32}$/.test(form.mainGuildId)}
              onClick={handleCreateBot}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {saving ? "Validando no Discord..." : "Conectar Bot"}
            </Button>

            <div className="grid gap-2 text-xs font-semibold text-zinc-300 sm:grid-cols-2">
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
            onPower={() => void handlePower(selectedBot)}
            powering={poweringBotId === selectedBot.id}
          />
        ) : (
          <Card className="flex h-full min-h-[420px] border-dashed border-purple-500/20 bg-zinc-950/60 hover:translate-y-0">
            <CardContent className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-zinc-800 bg-black">
                <Bot className="h-7 w-7 text-zinc-500" />
              </div>
              <p className="text-sm font-semibold text-zinc-200">Nenhum bot selecionado</p>
              <p className="mt-1 text-sm font-medium text-zinc-300">Conecte um bot ou selecione um da lista.</p>
            </CardContent>
          </Card>
        )}
      </section>

      <div className="min-w-0">
        {activeDashboardSection === "connected" ? (
            <Card className="border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(124,58,237,0.08)]">
              <CardHeader className="p-5 sm:p-6">
                <CardTitle className="text-white">Bots conectados</CardTitle>
                <CardDescription className="font-medium text-zinc-300">{bots.length} bot{bots.length === 1 ? "" : "s"} nesta hospedagem.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
                {bots.length ? (
                  <div className="grid gap-3">
                    {bots.map((bot) => (
                      <div
                        className={`flex flex-col gap-3 rounded-lg border p-3.5 transition duration-200 sm:flex-row sm:items-center sm:justify-between ${
                          selectedBot?.id === bot.id
                            ? "border-purple-400/50 bg-purple-500/10 shadow-[0_0_24px_rgba(124,58,237,0.16)]"
                            : "border-zinc-800 bg-black/35 hover:border-purple-500/25 hover:bg-zinc-950/80 hover:shadow-[0_0_24px_rgba(124,58,237,0.10)]"
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
                            <span className="block truncate text-xs font-medium text-zinc-300">
                              {bot.mainGuildName || guildNameById.get(bot.mainGuildId) || bot.mainGuildId}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-zinc-400">{bot.clientId}</span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                          <Button
                            disabled={poweringBotId === bot.id}
                            onClick={() => void handlePower(bot)}
                            size="icon"
                            title={bot.status === "online" ? "Desligar bot" : "Ligar bot"}
                            variant="outline"
                          >
                            {poweringBotId === bot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
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
                  <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-black/25 text-sm font-medium text-zinc-300">
                    Nenhum bot conectado.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : selectedBot ? (
            <BotModuleWorkspace
              activeMenuId={activeBotMenuId}
              bot={selectedBot}
              modules={modules}
              onSelectMenu={setActiveBotMenuId}
              onToggle={(moduleId, checked) => void handleToggleModule(selectedBot, moduleId, checked)}
            />
          ) : (
            <Card className="border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(124,58,237,0.08)]">
              <CardContent className="flex min-h-40 items-center justify-center p-6 text-center text-sm font-medium text-zinc-300">
                Selecione um bot para abrir o Menu do Bot.
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  );
}

function mergeDevModules(modules: DevModuleDefinition[]) {
  const apiModules = new Map(modules.map((module) => [module.id, module]));

  return [
    ...fallbackModules.map((module) => apiModules.get(module.id) ?? module),
    ...modules.filter((module) => !fallbackModules.some((fallback) => fallback.id === module.id))
  ];
}

function ConnectedBotPanel({
  bot,
  deleting,
  guildName,
  onDelete,
  onOpenDashboard,
  onOpenLogs,
  onOpenSettings,
  onPower,
  powering
}: {
  bot: DevBot;
  deleting: boolean;
  guildName: string;
  onDelete: () => void;
  onOpenDashboard: () => void;
  onOpenLogs: () => void;
  onOpenSettings: () => void;
  onPower: () => void;
  powering: boolean;
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
    <Card className="flex h-full min-h-[420px] flex-col overflow-hidden border-purple-500/25 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(7,7,10,0.96))] shadow-[0_0_44px_rgba(124,58,237,0.10)] backdrop-blur-xl hover:translate-y-0">
      <div className="h-20 shrink-0 border-b border-purple-500/25 bg-[linear-gradient(135deg,rgba(124,58,237,0.36),rgba(16,185,129,0.08),rgba(9,9,11,0.15))]" />
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
              <p className="truncate text-sm font-medium text-zinc-300">{guildName}</p>
            </div>
          </div>
          <Badge variant="muted">{bot.guildIds.length} servidor{bot.guildIds.length === 1 ? "" : "es"}</Badge>
        </div>

        <div className="grid gap-px overflow-hidden rounded-lg border border-purple-500/15 bg-purple-500/15 sm:grid-cols-2">
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
                : "border-zinc-700 bg-black/35 text-zinc-200"
          }`}>
            {bot.statusMessage}
          </div>
        ) : null}

        <div className="rounded-lg border border-purple-500/25 bg-purple-500/[0.08] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-purple-100">URL da Dashboard</p>
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

        <div className="mt-auto flex flex-wrap gap-2 border-t border-purple-500/15 pt-4">
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
          <Button disabled={powering} onClick={onPower} size="icon" title={bot.status === "online" ? "Desligar bot" : "Ligar bot"} variant="outline">
            {powering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
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
    <div className="min-w-0 bg-zinc-950/90 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-white" title={value}>{value}</p>
    </div>
  );
}

function AutomaticField({ label }: { label: string }) {
  return (
    <span className="flex min-h-10 items-center gap-2 rounded-md border border-purple-500/15 bg-white/[0.04] px-3 py-2">
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
    <Card className="h-full border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.88),rgba(9,9,11,0.96))] shadow-[0_0_36px_rgba(124,58,237,0.07)] hover:translate-y-0">
      <CardContent className="flex min-h-[116px] items-center gap-4 p-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ${iconClassName}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-200">{label}</p>
          <p className="mt-1 text-3xl font-bold leading-none text-white">{value}</p>
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
      <span className="text-sm font-semibold text-white">{label}</span>
      <input
        autoComplete={autoComplete}
        className="social-input h-12 border-purple-500/20 bg-black/55 font-medium text-white placeholder:text-zinc-500 focus:border-purple-400/70"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function BotGlobalSelect({
  bots,
  onSelectBot,
  selectedBotId
}: {
  bots: DevBot[];
  onSelectBot: (botId: string | null) => void;
  selectedBotId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;
  const filteredBots = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) return bots;

    return bots.filter((bot) => (
      bot.name.toLowerCase().includes(normalized)
      || bot.clientId.toLowerCase().includes(normalized)
      || bot.id.toLowerCase().includes(normalized)
      || bot.mainGuildName?.toLowerCase().includes(normalized)
    ));
  }, [bots, query]);

  return (
    <Card className="border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(124,58,237,0.08)] hover:translate-y-0">
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Selecionar Bot</p>
          <p className="mt-1 text-xs font-medium text-zinc-300">Tudo nesta aba DEV carrega e salva apenas para o bot selecionado.</p>
        </div>
        <div className="relative w-full lg:w-[420px]">
          <button
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-purple-500/20 bg-black/55 px-3 py-2 text-left shadow-inner transition duration-300 hover:border-purple-400/40 hover:bg-purple-500/10"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Avatar className="h-10 w-10 rounded-xl border border-zinc-700" fallback={selectedBot?.name ?? "Bot"} src={selectedBot?.avatarUrl} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-white">{selectedBot?.name ?? "Selecione um bot"}</span>
                <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-300">
                  {selectedBot ? <StatusDot status={selectedBot.status} /> : null}
                  <span className="truncate">{selectedBot ? selectedBot.clientId : "Busque por nome, ID ou servidor"}</span>
                </span>
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-300 transition ${open ? "rotate-180" : ""}`} />
          </button>

          {open ? (
            <div className="absolute right-0 top-16 z-30 w-full overflow-hidden rounded-xl border border-purple-500/25 bg-[#101014] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <Search className="h-4 w-4 text-purple-200" />
                <input
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-zinc-500"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar bot..."
                  value={query}
                />
              </div>
              <div className="discord-scrollbar max-h-80 overflow-y-auto p-2">
                <button
                  className="mb-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
                  onClick={() => {
                    onSelectBot(null);
                    setOpen(false);
                    setQuery("");
                  }}
                  type="button"
                >
                  Selecionar Bot
                </button>
                {filteredBots.map((bot) => (
                  <button
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition duration-200 ${
                      selectedBotId === bot.id
                        ? "bg-purple-500/15 ring-1 ring-purple-400/25"
                        : "hover:bg-zinc-900/85"
                    }`}
                    key={bot.id}
                    onClick={() => {
                      onSelectBot(bot.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    type="button"
                  >
                    <Avatar className="h-11 w-11 rounded-xl border border-zinc-700" fallback={bot.name} src={bot.avatarUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">{bot.name}</span>
                      <span className="block truncate text-xs font-medium text-zinc-300">{bot.mainGuildName || bot.mainGuildId}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-400">ID: {bot.clientId}</span>
                    </span>
                    <Badge variant={bot.status === "online" ? "success" : bot.status === "error" || bot.status === "invalid_token" ? "danger" : "muted"}>
                      {statusLabel(bot.status)}
                    </Badge>
                  </button>
                ))}
                {!filteredBots.length ? (
                  <p className="px-3 py-6 text-center text-sm font-medium text-zinc-400">Nenhum bot encontrado.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function BotModuleWorkspace({
  activeMenuId,
  bot,
  modules,
  onSelectMenu,
  onToggle
}: {
  activeMenuId: BotMenuId;
  bot: DevBot;
  modules: DevModuleDefinition[];
  onSelectMenu: (menuId: BotMenuId) => void;
  onToggle: (moduleId: string, checked: boolean) => void;
}) {
  const visibleMenuItems = visibleBotMenuItems(botMenuItems, modules, bot.enabledModules);
  const allMenuItems = flattenBotMenuItems(visibleMenuItems);
  const activeMenu = allMenuItems.find((item) => item.id === activeMenuId) ?? visibleMenuItems[0] ?? botMenuItems[0];
  const activeModules = activeMenu && activeMenuId !== "settings"
    ? modulesForMenu(activeMenu, modules).filter((module) => bot.enabledModules.includes(module.id))
    : [];
  const headerCount = activeMenuId === "settings" ? bot.enabledModules.length : activeModules.length;
  const headerTotal = activeMenuId === "settings" ? modules.length : activeModules.length;

  return (
    <Card className="border-purple-500/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(124,58,237,0.08)]" id="dev-bot-module-settings">
      <CardHeader className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-white">Menu do Bot</CardTitle>
            <CardDescription className="font-medium text-zinc-300">Organize os sistemas de {bot.name} por area.</CardDescription>
          </div>
          <Badge variant="muted">{bot.enabledModules.length}/{modules.length} ativos</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
        <div className="grid gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-purple-500/15 bg-black/40 p-2">
            <div className="mb-2 flex items-center gap-3 border-b border-purple-500/15 px-2 pb-3">
              <Avatar className="h-9 w-9 rounded-full border border-zinc-800" fallback={bot.name} src={bot.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{bot.name}</p>
                <p className="truncate text-xs font-medium text-zinc-300">{bot.mainGuildName || bot.mainGuildId}</p>
              </div>
            </div>
            <nav className="space-y-1">
              {visibleMenuItems.map((item) => (
                <BotMenuButton
                  activeMenuId={activeMenuId}
                  item={item}
                  key={item.id}
                  modules={modules}
                  onSelectMenu={onSelectMenu}
                  selectedModules={bot.enabledModules}
                />
              ))}
            </nav>
          </aside>

          <section className="min-w-0 rounded-lg border border-purple-500/15 bg-black/25 p-4 sm:p-5">
            {activeMenu ? (
              <div className="mb-4 flex flex-col gap-3 border-b border-purple-500/15 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300">
                    <activeMenu.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{activeMenu.label}</h3>
                    <p className="text-sm font-medium text-zinc-300">{activeMenu.description}</p>
                  </div>
                </div>
                <Badge variant="muted">{headerCount}/{headerTotal} ativos</Badge>
              </div>
            ) : null}

            {activeMenuId === "overview" ? (
              <BotOverview bot={bot} modules={modules} />
            ) : activeMenuId === "settings" ? (
              <ModuleManager
                enabledModules={bot.enabledModules}
                modules={modules}
                onToggle={onToggle}
              />
            ) : activeModules.length ? (
              <ModuleSwitchSection
                enabledModules={bot.enabledModules}
                modules={activeModules}
                onToggle={onToggle}
                title={activeMenu?.label ?? "Sistemas"}
              />
            ) : (
              <EmptyBotMenuCategory label={activeMenu?.label ?? "Categoria"} />
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function BotMenuButton({
  activeMenuId,
  item,
  modules,
  onSelectMenu,
  selectedModules
}: {
  activeMenuId: BotMenuId;
  item: BotMenuItem;
  modules: DevModuleDefinition[];
  onSelectMenu: (menuId: BotMenuId) => void;
  selectedModules: string[];
}) {
  const active = activeMenuId === item.id || Boolean(item.children?.some((child) => child.id === activeMenuId));
  const count = item.id === "settings" ? selectedModules.length : countEnabledMenuModules(item, modules, selectedModules);
  const total = item.id === "settings" ? modules.length : modulesForMenu(item, modules, true).length;

  return (
    <div>
      <button
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition duration-300 ${
          active
            ? "bg-purple-500/20 text-white ring-1 ring-purple-400/25 shadow-[0_0_20px_rgba(124,58,237,0.12)]"
            : "text-zinc-300 hover:bg-purple-500/10 hover:text-white hover:shadow-[0_0_18px_rgba(124,58,237,0.10)]"
        }`}
        onClick={() => onSelectMenu(item.id)}
        type="button"
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {total ? <span className="text-xs font-semibold text-zinc-300">{count}/{total}</span> : null}
      </button>
      {item.children && active ? (
        <div className="ml-5 mt-1 space-y-1 border-l border-purple-500/15 pl-2">
          {item.children.map((child) => {
            const childActive = activeMenuId === child.id;
            const childModules = modulesForMenu(child, modules);
            const childCount = childModules.filter((module) => selectedModules.includes(module.id)).length;

            return (
              <button
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                  childActive ? "bg-purple-500/15 text-white" : "text-zinc-300 hover:bg-zinc-900/80 hover:text-white"
                }`}
                key={child.id}
                onClick={() => onSelectMenu(child.id)}
                type="button"
              >
                <child.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{child.label}</span>
                {childModules.length ? <span>{childCount}/{childModules.length}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function BotOverview({ bot, modules }: { bot: DevBot; modules: DevModuleDefinition[] }) {
  const activeModules = modules.filter((module) => bot.enabledModules.includes(module.id));

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <OverviewMetric label="Status" value={statusLabel(bot.status)} />
      <OverviewMetric label="Modulos ativos" value={`${activeModules.length}/${modules.length}`} />
      <OverviewMetric label="Servidor" value={bot.mainGuildName || bot.mainGuildId} />
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] p-4 sm:col-span-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-sm font-bold text-white">Acesso protegido</p>
            <p className="text-xs font-medium text-zinc-300">Login Discord e usuario autorizado para este bot.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleManager({
  enabledModules,
  modules,
  onToggle
}: {
  enabledModules: string[];
  modules: DevModuleDefinition[];
  onToggle: (moduleId: string, checked: boolean) => void;
}) {
  const groups = moduleManagerGroups(modules);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-purple-500/25 bg-purple-500/[0.08] p-4">
        <p className="text-sm font-bold text-white">Gerenciador de modulos por bot</p>
        <p className="mt-1 text-xs font-medium text-zinc-300">
          Ativar aqui libera o modulo somente para o bot selecionado e faz a area aparecer no menu lateral dele.
        </p>
      </div>
      {groups.map((group) => (
        <ModuleSwitchSection
          enabledModules={enabledModules}
          key={group.title}
          modules={group.modules}
          onToggle={onToggle}
          title={group.title}
        />
      ))}
    </div>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-purple-500/15 bg-zinc-950/80 p-4">
      <p className="text-xs font-bold uppercase text-zinc-300">{label}</p>
      <p className="mt-2 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function EmptyBotMenuCategory({ label }: { label: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-black/30 p-6 text-center">
      <div>
        <p className="text-sm font-bold text-white">{label} ainda nao tem modulos cadastrados</p>
        <p className="mt-1 text-sm font-medium text-zinc-300">Quando um sistema dessa area existir, ele aparece aqui.</p>
      </div>
    </div>
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
  const standardModules = modules.filter((module) => !isFiveMModule(module.id));
  const fiveMModules = modules.filter((module) => isFiveMModule(module.id));

  return (
    <div className="space-y-5">
      <ModuleSwitchSection enabledModules={enabledModules} modules={standardModules} onToggle={onToggle} title="Sistemas do bot" />
      <ModuleSwitchSection enabledModules={enabledModules} modules={fiveMModules} onToggle={onToggle} title="Sistemas FiveM" />
    </div>
  );
}

function ModuleSwitchSection({
  enabledModules,
  modules,
  onToggle,
  title
}: {
  enabledModules: string[];
  modules: DevModuleDefinition[];
  onToggle: (moduleId: string, checked: boolean) => void;
  title: string;
}) {
  if (!modules.length) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <Badge variant="muted">{modules.filter((module) => enabledModules.includes(module.id)).length}/{modules.length}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {modules.map((module) => {
          const enabled = enabledModules.includes(module.id);

          return (
            <div
              className="flex min-h-[74px] items-center gap-4 rounded-lg border border-zinc-800 bg-black/40 px-4 py-3 transition duration-200 hover:border-purple-500/25 hover:bg-zinc-950/80 hover:shadow-[0_0_20px_rgba(124,58,237,0.08)]"
              key={module.id}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{module.label}</p>
                <p className={enabled ? "text-xs font-semibold text-emerald-300" : "text-xs font-medium text-zinc-300"}>
                  {enabled ? "Ativado" : "Desativado"}
                </p>
              </div>
              <Switch checked={enabled} className="shrink-0" onCheckedChange={(checked) => onToggle(module.id, checked)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function flattenBotMenuItems(items: BotMenuItem[]): BotMenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenBotMenuItems(item.children) : [])]);
}

function modulesForMenu(item: BotMenuItem, modules: DevModuleDefinition[], includeChildren = false) {
  const moduleIds = new Set([
    ...item.moduleIds,
    ...(includeChildren ? item.children?.flatMap((child) => child.moduleIds) ?? [] : [])
  ]);

  return modules.filter((module) => moduleIds.has(module.id));
}

function visibleBotMenuItems(items: BotMenuItem[], modules: DevModuleDefinition[], enabledModules: string[]): BotMenuItem[] {
  return items.flatMap((item) => {
    if (item.id === "overview" || item.id === "settings") {
      return [item];
    }

    const children = item.children ? visibleBotMenuItems(item.children, modules, enabledModules) : undefined;
    const ownEnabled = modulesForMenu(item, modules).some((module) => enabledModules.includes(module.id));

    if (!ownEnabled && !children?.length) {
      return [];
    }

    return [{
      ...item,
      children
    }];
  });
}

function moduleManagerGroups(modules: DevModuleDefinition[]) {
  const usedModuleIds = new Set<string>();
  const groups: Array<{ title: string; modules: DevModuleDefinition[] }> = [];

  for (const item of botMenuItems) {
    if (item.id === "overview") {
      continue;
    }

    if (item.id === "settings") {
      const settingsModules = modulesForIds(modules, item.moduleIds, usedModuleIds);

      if (settingsModules.length) {
        groups.push({
          title: "Configuracoes",
          modules: settingsModules
        });
      }
      continue;
    }

    if (item.children?.length) {
      const parentModules = modulesForIds(modules, item.moduleIds, usedModuleIds);

      if (parentModules.length) {
        groups.push({
          title: `${item.label} geral`,
          modules: parentModules
        });
      }

      for (const child of item.children) {
        const childModules = modulesForIds(modules, child.moduleIds, usedModuleIds);

        if (childModules.length) {
          groups.push({
            title: child.label,
            modules: childModules
          });
        }
      }
      continue;
    }

    const itemModules = modulesForIds(modules, item.moduleIds, usedModuleIds);

    if (itemModules.length) {
      groups.push({
        title: item.label,
        modules: itemModules
      });
    }
  }

  const remainingModules = modules.filter((module) => !usedModuleIds.has(module.id));

  if (remainingModules.length) {
    groups.push({
      title: "Outros modulos",
      modules: remainingModules
    });
  }

  return groups;
}

function modulesForIds(modules: DevModuleDefinition[], moduleIds: string[], usedModuleIds: Set<string>) {
  const wanted = new Set(moduleIds);
  const found = modules.filter((module) => wanted.has(module.id) && !usedModuleIds.has(module.id));

  found.forEach((module) => usedModuleIds.add(module.id));
  return found;
}

function countEnabledMenuModules(item: BotMenuItem, modules: DevModuleDefinition[], selectedModules: string[]) {
  return modulesForMenu(item, modules, true).filter((module) => selectedModules.includes(module.id)).length;
}

function isFiveMModule(moduleId: string) {
  return moduleId === "fivem" || moduleId.startsWith("fivem-");
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
