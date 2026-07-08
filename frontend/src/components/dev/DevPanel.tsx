import {
    Bot,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    Circle,
    Copy,
    CreditCard,
    Database,
    ExternalLink,
    Eye,
    EyeOff,
    Gamepad2,
    Hash,
    LayoutDashboard,
    ListChecks,
    Link2,
    Loader2,
    LockKeyhole,
    MessageSquare,
    MoreVertical,
    Power,
    Plus,
    ScrollText,
    Search,
    Server,
    Sparkles,
    Settings,
    ShieldCheck,
    SlidersHorizontal,
    Star,
    Ticket,
    Trash2,
    Unplug,
    UserCheck,
    Users
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
    createDevBot,
    createOrvitechProduct,
    createOrvitechSale,
    cleanupLegacyDatabaseMaintenance,
    createOrvitechSalesPlan,
    deleteDevBot,
    deleteDatabaseMaintenanceUserLinks,
    deleteOrvitechProduct,
    deleteOrvitechPaymentProvider,
    deleteOrvitechSalesPlan,
    getBotGuildConfig,
    getDatabaseMaintenanceModules,
    getDatabaseMaintenanceUserLinks,
    getDevBots,
    getDevModules,
    getGuildLiveOptions,
    getOrvitechSalesDashboard,
    resetDatabaseMaintenanceModule,
    resetDatabaseMaintenanceServer,
    duplicateOrvitechProduct,
    restartDevBot,
    saveOrvitechPaymentProvider,
    saveOrvitechSalesSettings,
    searchDatabaseMaintenanceUsers,
    startAllDevBots,
    stopAllDevBots,
    stopDevBot,
    updateBotGuildConfig,
    updateDevBotModules,
    updateDevBotToken,
    updateOrvitechProduct,
    updateOrvitechSaleStatus,
    updateOrvitechSalesPlan,
    uploadOrvitechProductBanner
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import { dashboardUrl } from "../../lib/urls";
import type {
    AuthUser,
    CreateDevBotPayload,
    DashboardBot,
    DashboardMeGuild,
    DatabaseMaintenanceActionResult,
    DatabaseMaintenanceLinksResult,
    DatabaseMaintenanceModuleOption,
    DatabaseMaintenanceUser,
    DevBot,
    DevBotStatus,
    DevModuleDefinition,
    GuildChannelOption,
    GuildVoiceChannelOption,
    OrvitechSaleStatus,
    OrvitechProduct,
    OrvitechProductFeatureKey,
    OrvitechSalesDashboard,
    OrvitechSalesPaymentProvider,
    OrvitechSalesPlan,
    SaveOrvitechPaymentProviderPayload,
    SaveOrvitechProductPayload,
    SaveOrvitechSalePayload,
    SaveOrvitechSalesPlanPayload,
    SaveOrvitechSalesSettingsPayload
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
  { id: "orvitech-sales", label: "OrviTech - Sistema de Vendas" },
  { id: "network", label: "Rede Social dos Membros" },
  { id: "x-monitor", label: "X Monitor" },
  { id: "verification", label: "Sistema de Verificação" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "manual-registration", label: "Pedido de Set" },
  { id: "moderation", label: "Sistema de Moderação" },
  { id: "rules", label: "Sistema de Regras" },
  { id: "mission-tools", label: "Mission Tools" },
  { id: "voice-recorder", label: "Voice Recorder" },
  { id: "music", label: "Sistema de Música" },
  { id: "emoji-cloner", label: "Clonagem de Emojis" },
  { id: "server-cloner", label: "Clonagem de Servidor" },
  { id: "server-generator", label: "Gerador Inteligente de Servidores" },
  { id: "safe-bot", label: "SelfBot Protection" },
  { id: "account-age-security", label: "Seguranca por Idade da Conta" },
  { id: "anti-ban", label: "Sistema Anti Ban" },
  { id: "anti-abuse", label: "DEV Control Panel - Anti Abuse" },
  { id: "suspicious-servers", label: "Servidores Suspeitos" },
  { id: "global-blacklist", label: "Blacklist Global" },
  { id: "advanced-permissions", label: "Gerenciamento de Permissões" },
  { id: "invite-cleanup", label: "Limpeza Automatica de Convites" },
  { id: "server-backup", label: "Backup Completo" },
  { id: "vanity-url-protection", label: "Protecao da URL Personalizada" },
  { id: "hide-empty-voice", label: "Esconder Chamadas Vazias" },
  { id: "anti-disconnect", label: "Anti Disconnect" },
  { id: "auto-unmute", label: "Auto Desmutar" },
  { id: "temporary-voice", label: "Chamadas Temporárias" },
  { id: "tag-verification", label: "Verificação de Tag" },
  { id: "bio-url-verification", label: "Verificação de URL na Bio" },
  { id: "first-lady", label: "Sistema Primeira Dama" },
  { id: "fivem", label: "FiveM" },
  { id: "fivem-factions", label: "FiveM - Sistema de Faccao" },
  { id: "fivem-corporations", label: "FiveM - Sistema de Corporações" },
  { id: "fivem-absences", label: "FiveM - Sistema de Ausencias" },
  { id: "fivem-orders", label: "Sistema de Encomendas RP" },
  { id: "fivem-washing", label: "FiveM - Sistema de Lavagem" },
  { id: "fivem-drugs", label: "FiveM - Sistema de Drogas" },
  { id: "fivem-ammo", label: "FiveM - Sistema de Municoes" },
  { id: "fivem-finance", label: "FiveM - Sistema Financeiro" },
  { id: "fivem-goals", label: "FiveM - Sistema de Metas" },
  { id: "fivem-hierarchy", label: "Policia - Hierarquia" },
  { id: "fivem-actions", label: "FiveM - Acoes FAC" },
  { id: "police-absences", label: "Policia - Sistema de Ausencias" },
  { id: "police-actions", label: "Policia - Acoes" },
  { id: "police-patrol-reports", label: "Polícia - Relatórios de Patrulhamento" },
  { id: "fivem-fac", label: "FiveM - FAC Ausencia" },
  { id: "avisos", label: "Mensagens e Personalização" }
];

const emptyForm: CreateDevBotPayload = {
  token: "",
  mainGuildId: ""
};

type BotMenuId =
  | "overview"
  | "favorites"
  | "database-maintenance"
  | "settings"
  | "moderation"
  | "tickets"
  | "manual-registration"
  | "verification"
  | "logs"
  | "anti-abuse"
  | "cloning"
  | "anti-ban"
  | "suspicious-servers"
  | "global-blacklist"
  | "advanced-permissions"
  | "invite-cleanup"
  | "server-backup"
  | "vanity-url-protection"
  | "hide-empty-voice"
  | "anti-disconnect"
  | "auto-unmute"
  | "temporary-voice"
  | "tag-verification"
  | "bio-url-verification"
  | "first-lady"
  | "economy"
  | "sales"
  | "discord"
  | "select-menu"
  | "fivem"
  | "fivem-factions"
  | "fivem-ammo"
  | "fivem-orders"
  | "fivem-washing"
  | "fivem-drugs"
  | "fivem-finance"
  | "fivem-goals"
  | "fivem-hierarchy"
  | "fivem-actions"
  | "police"
  | "police-absences"
  | "police-actions"
  | "police-patrol-reports"
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
    label: "Configurações",
    description: "Ajustes gerais do bot",
    icon: Settings,
    moduleIds: ["avisos", "mission-tools", "voice-recorder", "server-generator"]
  },
  {
    id: "moderation",
    label: "Moderação",
    description: "Ban, kick, warn e protecoes",
    icon: ShieldCheck,
    moduleIds: ["moderation", "rules", "safe-bot", "account-age-security"]
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
    label: "Verificação",
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
    id: "anti-abuse",
    label: "DEV Control Panel",
    description: "Controle global Anti Abuse por bot",
    icon: ShieldCheck,
    moduleIds: ["anti-abuse"]
  },
  {
    id: "cloning",
    label: "Clonagem",
    description: "Clonagem de emojis e estrutura de servidor",
    icon: Copy,
    moduleIds: ["emoji-cloner", "server-cloner"]
  },
  {
    id: "anti-ban",
    label: "Anti Ban",
    description: "Proteção contra ban, kick, timeout e remoção de cargos",
    icon: ShieldCheck,
    moduleIds: ["anti-ban"]
  },
  {
    id: "suspicious-servers",
    label: "Servidores Suspeitos",
    description: "Monitoramento de entrada e servidores blacklist",
    icon: Search,
    moduleIds: ["suspicious-servers"]
  },
  {
    id: "global-blacklist",
    label: "Blacklist Global",
    description: "Bloqueio de usuários por ID e motivo",
    icon: LockKeyhole,
    moduleIds: ["global-blacklist"]
  },
  {
    id: "advanced-permissions",
    label: "Permissões Avançadas",
    description: "Permissões específicas por cargo",
    icon: UserCheck,
    moduleIds: ["advanced-permissions"]
  },
  {
    id: "invite-cleanup",
    label: "Limpeza de Convites",
    description: "Rotina automática de remoção de convites",
    icon: Trash2,
    moduleIds: ["invite-cleanup"]
  },
  {
    id: "server-backup",
    label: "Backup",
    description: "Backup e restauração seletiva do servidor",
    icon: Server,
    moduleIds: ["server-backup"]
  },
  {
    id: "vanity-url-protection",
    label: "URL Personalizada",
    description: "Proteção e restauração da URL personalizada",
    icon: Link2,
    moduleIds: ["vanity-url-protection"]
  },
  {
    id: "hide-empty-voice",
    label: "Chamadas Vazias",
    description: "Oculta canais de voz vazios automaticamente",
    icon: EyeOff,
    moduleIds: ["hide-empty-voice"]
  },
  {
    id: "anti-disconnect",
    label: "Anti Disconnect",
    description: "Reconecta membros removidos de calls por usuarios sem autorizacao",
    icon: ShieldCheck,
    moduleIds: ["anti-disconnect"]
  },
  {
    id: "auto-unmute",
    label: "Auto Desmutar",
    description: "Desmuta membros ao entrar no canal configurado",
    icon: Power,
    moduleIds: ["auto-unmute"]
  },
  {
    id: "temporary-voice",
    label: "Chamadas Temporárias",
    description: "Criação e controle de salas temporárias",
    icon: Users,
    moduleIds: ["temporary-voice"]
  },
  {
    id: "tag-verification",
    label: "Verificação de Tag",
    description: "Cargo automatico por tag personalizada",
    icon: Hash,
    moduleIds: ["tag-verification"]
  },
  {
    id: "bio-url-verification",
    label: "URL na Bio",
    description: "Cargo automatico por URL na bio",
    icon: Link2,
    moduleIds: ["bio-url-verification"]
  },
  {
    id: "first-lady",
    label: "Primeira Dama",
    description: "Relacionamentos, limites e historico",
    icon: UserCheck,
    moduleIds: ["first-lady"]
  },
  {
    id: "economy",
    label: "Economia",
    description: "Sistemas economicos",
    icon: Hash,
    moduleIds: []
  },
  {
    id: "sales",
    label: "Vendas OrviTech",
    description: "Planos, pagamentos e liberacoes do bot OrviTech",
    icon: CreditCard,
    moduleIds: ["orvitech-sales"]
  },
  {
    id: "discord",
    label: "Discord",
    description: "Cargos, boas-vindas e mensagens",
    icon: MessageSquare,
    moduleIds: ["roles", "welcome", "leave", "avisos"]
  },
  {
    id: "select-menu",
    label: "Select Menu",
    description: "Gerenciamento de menus de selecao",
    icon: ChevronDown,
    moduleIds: []
  },
  {
    id: "fivem",
    label: "FiveM",
    description: "Módulos de RP e gestão",
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
        id: "fivem-washing",
        label: "Sistema de Lavagem",
        description: "Lavagem RP, porcentagens, repasses e historico",
        icon: ScrollText,
        moduleIds: ["fivem-washing"]
      },
      {
        id: "fivem-drugs",
        label: "Sistema de Drogas",
        description: "Drogas, pedidos, familias, logs e historico",
        icon: Hash,
        moduleIds: ["fivem-drugs"]
      },
      {
        id: "fivem-finance",
        label: "Financeiro",
        description: "Caixa e financeiro",
        icon: ScrollText,
        moduleIds: ["fivem-finance"]
      },
      {
        id: "fivem-goals",
        label: "Metas",
        description: "Metas e producao",
        icon: ListChecks,
        moduleIds: ["fivem-goals"]
      },
      {
        id: "fivem-actions",
        description: "Acoes profissionais para FAC",
        label: "Acoes FAC",
        icon: Gamepad2,
        moduleIds: ["fivem-actions"]
      },
      {
        id: "fivem-production",
        label: "Producao",
        description: "Produção e corporações",
        icon: Settings,
        moduleIds: ["fivem-corporations"]
      }
    ]
  },
  {
    id: "police",
    label: "Policia",
    description: "Hierarquia, acoes e relatorios policiais",
    icon: ShieldCheck,
    moduleIds: [],
    children: [
      {
        id: "fivem-hierarchy",
        label: "Hierarquia",
        description: "Painel de cargos e hierarquia policial",
        icon: Users,
        moduleIds: ["fivem-hierarchy"]
      },
      {
        id: "police-absences",
        label: "Ausencias Policiais",
        description: "Solicitacoes e aprovacao de ausencias para oficiais",
        icon: CalendarDays,
        moduleIds: ["police-absences"]
      },
      {
        id: "police-actions",
        label: "Acoes Policiais",
        description: "Operacoes policiais com participantes e relatorios",
        icon: ShieldCheck,
        moduleIds: ["police-actions"]
      },
      {
        id: "police-patrol-reports",
        label: "Relatorios Policiais",
        description: "Relatorios profissionais de patrulhamento",
        icon: ScrollText,
        moduleIds: ["police-patrol-reports"]
      }
    ]
  },
  {
    id: "integrations",
    label: "Integrações",
    description: "Lives, clips e redes",
    icon: Link2,
    moduleIds: ["live", "kick-integration", "clips", "kick-clips", "network", "x-monitor", "giveaway"]
  }
];

type DevPanelProps = {
  activeDashboardSection?: DevDashboardSection | null;
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

export type DevDashboardSection = "connected" | "bot-menu" | "cloning" | "sales";

export function DevPanel({
  activeDashboardSection = null,
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
  const [tokenVisible, setTokenVisible] = useState(false);
  const [bulkPowerAction, setBulkPowerAction] = useState<"start" | "stop" | null>(null);
  const [poweringBotId, setPoweringBotId] = useState<string | null>(null);
  const [updatingTokenBotId, setUpdatingTokenBotId] = useState<string | null>(null);
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
          iconClassName: "border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]",
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
          label: "Módulos ativos",
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
          iconClassName: "border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]",
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
        if (mounted) setMessage("Não foi possível carregar a área de bots.");
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

    const visibleMenuIds = new Set<BotMenuId>([
      "database-maintenance",
      "favorites",
      "overview",
      ...flattenBotMenuItems(moduleDashboardCategories(modules)).map((item) => item.id)
    ]);

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
      setTokenVisible(false);
      setMessage(`${bot.name} foi conectado e validado no Discord.`);
    } catch (error) {
      setMessage(maskSensitiveText(readRequestMessage(error) ?? "Não foi possível conectar o bot. Confira o token e o Guild ID."));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleModule(bot: DevBot, moduleId: string, checked: boolean) {
    const nextModules = checked
      ? [...new Set([...bot.enabledModules, ...(isFiveMModule(moduleId) && !isPoliceReleaseModule(moduleId) && moduleId !== "fivem" ? ["fivem"] : []), moduleId])]
      : bot.enabledModules.filter((item) => item !== moduleId);

    setBots((current) => current.map((item) => (item.id === bot.id ? { ...item, enabledModules: nextModules } : item)));

    try {
      const updated = await updateDevBotModules(bot.id, nextModules);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage("Módulos atualizados.");
    } catch {
      setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)));
      setMessage("Não foi possível atualizar os módulos.");
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

      setMessage(readRequestMessage(error) ?? (shouldStop ? "Não foi possível desligar esse bot." : "Não foi possível ligar esse bot."));
    } finally {
      setPoweringBotId(null);
    }
  }

  async function handleUpdateToken(bot: DevBot, token: string) {
    setUpdatingTokenBotId(bot.id);
    setMessage(null);

    try {
      const updated = await updateDevBotToken(bot.id, token.trim());
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      onBotUpdated?.(updated);
      setMessage(`Token de ${updated.name} atualizado e aplicado com sucesso.`);
    } catch (error) {
      setMessage(maskSensitiveText(readRequestMessage(error) ?? "Não foi possível atualizar o token do bot."));
      throw error;
    } finally {
      setUpdatingTokenBotId(null);
    }
  }

  async function handleStartAllBots() {
    setBulkPowerAction("start");
    setMessage(null);

    try {
      const result = await startAllDevBots();
      setBots(result.bots);
      const selectedUpdate = result.bots.find((bot) => bot.id === selectedBotId) ?? result.bots[0];

      if (selectedUpdate) {
        onBotUpdated?.(selectedUpdate);
      }
      setMessage(`${result.affected} bot${result.affected === 1 ? "" : "s"} enviado${result.affected === 1 ? "" : "s"} para ligar.`);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível ligar todos os bots.");
    } finally {
      setBulkPowerAction(null);
    }
  }

  async function handleStopAllBots() {
    setBulkPowerAction("stop");
    setMessage(null);
    setBots((current) => current.map((bot) => ({
      ...bot,
      status: "offline",
      statusMessage: "Desligando pelo controle geral DEV."
    })));

    try {
      const result = await stopAllDevBots();
      setBots(result.bots);
      const selectedUpdate = result.bots.find((bot) => bot.id === selectedBotId) ?? result.bots[0];

      if (selectedUpdate) {
        onBotUpdated?.(selectedUpdate);
      }
      setMessage(`${result.affected} bot${result.affected === 1 ? "" : "s"} desligado${result.affected === 1 ? "" : "s"} pelo controle geral DEV.`);
    } catch (error) {
      const latestBots = await getDevBots().catch(() => null);

      if (latestBots) {
        setBots(latestBots);
      }
      setMessage(readRequestMessage(error) ?? "Não foi possível desligar todos os bots.");
    } finally {
      setBulkPowerAction(null);
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
      setMessage(readRequestMessage(error) ?? "Não foi possível desconectar o bot.");
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

  if (activeDashboardSection === "bot-menu") {
    return (
      <div className="space-y-7">
        <BotGlobalSelect bots={bots} selectedBotId={selectedBotId} onSelectBot={handleSelectBotId} />
        {message ? (
          <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(255,213,0,0.12)]">
            {message}
          </div>
        ) : null}
        {selectedBot ? (
          <BotModuleWorkspace
            activeMenuId={activeBotMenuId}
            bot={selectedBot}
            guilds={guilds}
            modules={modules}
            onSelectMenu={setActiveBotMenuId}
            onToggle={(moduleId, checked) => void handleToggleModule(selectedBot, moduleId, checked)}
          />
        ) : (
          <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)]">
            <CardContent className="flex min-h-40 items-center justify-center p-6 text-center text-sm font-medium text-zinc-300">
              Selecione um bot para abrir o Menu do Bot.
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (activeDashboardSection === "cloning") {
    return (
      <div className="space-y-7">
        <BotGlobalSelect bots={bots} selectedBotId={selectedBotId} onSelectBot={handleSelectBotId} />
        {message ? (
          <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(255,213,0,0.12)]">
            {message}
          </div>
        ) : null}
        {selectedBot ? (
          <ServerCloneDevWorkspace
            bot={selectedBot}
            enabled={selectedBot.enabledModules.includes("server-cloner")}
            guilds={guilds}
            onEnable={() => void handleToggleModule(selectedBot, "server-cloner", true)}
          />
        ) : (
          <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)]">
            <CardContent className="flex min-h-40 items-center justify-center p-6 text-center text-sm font-medium text-zinc-300">
              Selecione um bot para abrir a Clonagem de Servidor.
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (activeDashboardSection === "sales") {
    return (
      <div className="space-y-7">
        <BotGlobalSelect bots={bots} selectedBotId={selectedBotId} onSelectBot={handleSelectBotId} />
        {message ? (
          <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(255,213,0,0.12)]">
            {message}
          </div>
        ) : null}
        {selectedBot ? (
          <OrvitechSalesWorkspace
            bot={selectedBot}
            enabled={selectedBot.enabledModules.includes("orvitech-sales")}
            guilds={guilds}
            onEnable={() => void handleToggleModule(selectedBot, "orvitech-sales", true)}
          />
        ) : (
          <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)]">
            <CardContent className="flex min-h-40 items-center justify-center p-6 text-center text-sm font-medium text-zinc-300">
              Selecione um bot para abrir as vendas OrviTech.
            </CardContent>
          </Card>
        )}
      </div>
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
        <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_28px_rgba(255,213,0,0.12)]">
          {message}
        </div>
      ) : null}

      <section className="grid items-stretch gap-6 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.05fr)]">
        <Card className="flex h-full flex-col border-[#FFD500]/25 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(7,7,10,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.10)] backdrop-blur-xl hover:translate-y-0">
          <CardHeader className="border-b border-[#FFD500]/15 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#E5C000] text-white shadow-[0_12px_30px_rgba(255,213,0,0.34)]">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-white">Conectar Bot</CardTitle>
                <CardDescription className="font-medium text-zinc-300">Token e servidor. O Discord fornece o restante.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-5 p-5 pt-5 sm:p-6 sm:pt-6">
            <ProtectedTokenInput
              hidden={!tokenVisible}
              label="Token do Bot"
              onChange={(value) => updateForm("token", value)}
              onToggle={() => setTokenVisible((current) => !current)}
              value={form.token}
            />
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 text-xs font-semibold text-emerald-100">
              <div className="flex items-center gap-2">
                <LockKeyhole className="h-4 w-4 shrink-0 text-emerald-300" />
                <span>Your token is protected and will not be displayed to other users.</span>
              </div>
            </div>
            <DevInput
              inputMode="numeric"
              label="Servidor (Guild ID)"
              onChange={(value) => updateForm("mainGuildId", value.replace(/\D/g, ""))}
              placeholder="123456789012345678"
              value={form.mainGuildId}
            />

            <div className="flex flex-col gap-3 rounded-lg border border-[#FFD500]/15 bg-white/[0.05] p-4 sm:flex-row sm:items-center">
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
              className="h-12 w-full bg-[#E5C000] text-white shadow-[0_14px_34px_rgba(255,213,0,0.30)] hover:bg-[#FFD500]"
              disabled={saving || form.token.trim().length < 10 || !/^\d{5,32}$/.test(form.mainGuildId)}
              onClick={handleCreateBot}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {saving ? "Validando no Discord..." : "Conectar Bot"}
            </Button>

            <div className="grid gap-2 text-xs font-semibold text-zinc-300 sm:grid-cols-2">
              <AutomaticField label="Nome e avatar" />
              <AutomaticField label="Application ID" />
              <AutomaticField label="Data de criação" />
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
            onUpdateToken={(token) => handleUpdateToken(selectedBot, token)}
            powering={poweringBotId === selectedBot.id}
            updatingToken={updatingTokenBotId === selectedBot.id}
          />
        ) : (
          <Card className="flex h-full min-h-[420px] border-dashed border-[#FFD500]/20 bg-zinc-950/60 hover:translate-y-0">
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

      {activeDashboardSection ? (
        <div className="min-w-0">
          {activeDashboardSection === "connected" ? (
            <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)]">
              <CardHeader className="p-5 sm:p-6">
                <CardTitle className="text-white">Bots conectados</CardTitle>
                <CardDescription className="font-medium text-zinc-300">{bots.length} bot{bots.length === 1 ? "" : "s"} nesta hospedagem.</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
                <BulkBotPowerPanel
                  action={bulkPowerAction}
                  disabled={!bots.length}
                  offlineCount={stats.offline}
                  onlineCount={stats.online}
                  onStartAll={() => void handleStartAllBots()}
                  onStopAll={() => void handleStopAllBots()}
                  total={stats.total}
                />
                {bots.length ? (
                  <div className="mt-4 grid gap-3">
                    {bots.map((bot) => (
                      <div
                        className={`flex flex-col gap-3 rounded-lg border p-3.5 transition duration-200 sm:flex-row sm:items-center sm:justify-between ${
                          selectedBot?.id === bot.id
                            ? "border-[#FFEA70]/50 bg-[#FFD500]/10 shadow-[0_0_24px_rgba(255,213,0,0.16)]"
                            : "border-zinc-800 bg-black/35 hover:border-[#FFD500]/25 hover:bg-zinc-950/80 hover:shadow-[0_0_24px_rgba(255,213,0,0.10)]"
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
                            variant={bot.status === "online" ? "destructive" : "outline"}
                          >
                            {poweringBotId === bot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : bot.status === "online" ? <Unplug className="h-4 w-4" /> : <Power className="h-4 w-4" />}
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
          ) : activeDashboardSection === "sales" && selectedBot ? (
            <OrvitechSalesWorkspace
              bot={selectedBot}
              enabled={selectedBot.enabledModules.includes("orvitech-sales")}
              guilds={guilds}
              onEnable={() => void handleToggleModule(selectedBot, "orvitech-sales", true)}
            />
          ) : selectedBot ? (
            <BotModuleWorkspace
              activeMenuId={activeBotMenuId}
              bot={selectedBot}
              guilds={guilds}
              modules={modules}
              onSelectMenu={setActiveBotMenuId}
              onToggle={(moduleId, checked) => void handleToggleModule(selectedBot, moduleId, checked)}
            />
          ) : (
            <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)]">
              <CardContent className="flex min-h-40 items-center justify-center p-6 text-center text-sm font-medium text-zinc-300">
                Selecione um bot para abrir o Menu do Bot.
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BulkBotPowerPanel({
  action,
  disabled,
  offlineCount,
  onlineCount,
  onStartAll,
  onStopAll,
  total
}: {
  action: "start" | "stop" | null;
  disabled: boolean;
  offlineCount: number;
  onlineCount: number;
  onStartAll: () => void;
  onStopAll: () => void;
  total: number;
}) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Controle geral dos bots</p>
          <p className="mt-1 text-xs font-medium text-zinc-300">
            {onlineCount} online, {offlineCount} offline, {total} no total.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={disabled || action !== null}
            onClick={onStartAll}
            size="sm"
            title="Ligar todos os bots gerenciaveis"
            variant="outline"
          >
            {action === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            Ligar todos
          </Button>
          <Button
            disabled={disabled || action !== null}
            onClick={onStopAll}
            size="sm"
            title="Desligar todos os bots conectados"
            variant="destructive"
          >
            {action === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
            Desligar todos
          </Button>
        </div>
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
  onUpdateToken,
  powering,
  updatingToken
}: {
  bot: DevBot;
  deleting: boolean;
  guildName: string;
  onDelete: () => void;
  onOpenDashboard: () => void;
  onOpenLogs: () => void;
  onOpenSettings: () => void;
  onPower: () => void;
  onUpdateToken: (token: string) => Promise<void>;
  powering: boolean;
  updatingToken: boolean;
}) {
  const [copiedDashboardUrl, setCopiedDashboardUrl] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [newTokenVisible, setNewTokenVisible] = useState(false);
  const [channels, setChannels] = useState<{
    error: string | null;
    loading: boolean;
    text: GuildChannelOption[];
    voice: GuildVoiceChannelOption[];
  }>({
    error: null,
    loading: true,
    text: [],
    voice: []
  });
  const botDashboardUrl = bot.dashboardUrl || dashboardUrl(bot.slug);

  useEffect(() => {
    setCopiedDashboardUrl(false);
    setEditingToken(false);
    setNewToken("");
    setNewTokenVisible(false);
  }, [bot.id]);

  async function handleSaveToken() {
    if (newToken.trim().length < 10) return;
    try {
      await onUpdateToken(newToken);
      setNewToken("");
      setNewTokenVisible(false);
      setEditingToken(false);
    } catch {
      // A mensagem de erro e tratada pelo painel principal.
    }
  }

  useEffect(() => {
    let active = true;

    setChannels({
      error: null,
      loading: true,
      text: [],
      voice: []
    });

    getGuildLiveOptions(bot.mainGuildId, bot.id)
      .then((options) => {
        if (!active) return;
        setChannels({
          error: null,
          loading: false,
          text: options.channels ?? [],
          voice: options.voiceChannels ?? []
        });
      })
      .catch(() => {
        if (!active) return;
        setChannels({
          error: "Não foi possível carregar os canais deste bot.",
          loading: false,
          text: [],
          voice: []
        });
      });

    return () => {
      active = false;
    };
  }, [bot.id, bot.mainGuildId]);

  async function handleCopyDashboardUrl() {
    await copyToClipboard(botDashboardUrl);
    setCopiedDashboardUrl(true);
    window.setTimeout(() => setCopiedDashboardUrl(false), 2200);
  }

  function handleOpenDashboardUrl() {
    window.open(botDashboardUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Card className="flex h-full min-h-[420px] flex-col overflow-hidden border-[#FFD500]/25 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(7,7,10,0.96))] shadow-[0_0_44px_rgba(255,213,0,0.10)] backdrop-blur-xl hover:translate-y-0">
      <div className="h-20 shrink-0 border-b border-[#FFD500]/25 bg-[linear-gradient(135deg,rgba(255,213,0,0.36),rgba(16,185,129,0.08),rgba(9,9,11,0.15))]" />
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

        <div className="grid gap-px overflow-hidden rounded-lg border border-[#FFD500]/15 bg-[#FFD500]/15 sm:grid-cols-2">
          <BotDetail icon={Hash} label="Client / Application ID" value={bot.clientId} />
          <BotDetail icon={CalendarDays} label="Criado em" value={bot.botCreatedAt ? formatDate(bot.botCreatedAt) : "Não informado"} />
          <BotDetail icon={Server} label="Servidor" value={guildName} />
          <BotDetail icon={Users} label="Membros" value={bot.mainGuildMemberCount.toLocaleString("pt-BR")} />
          <BotDetail icon={Hash} label="Canais" value={`${bot.mainGuildChannelCount.toLocaleString("pt-BR")} no Discord`} />
        </div>

        <BotChannelPreview
          error={channels.error}
          loading={channels.loading}
          textChannels={channels.text}
          voiceChannels={channels.voice}
        />

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

        <div className="rounded-lg border border-zinc-800 bg-black/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-white">Token do bot</p>
              <p className="mt-1 font-mono text-xs text-zinc-400">Atual: {bot.tokenMasked || "protegido"}</p>
            </div>
            <Button onClick={() => setEditingToken((current) => !current)} size="sm" variant="outline">
              <LockKeyhole className="h-4 w-4" />
              {editingToken ? "Cancelar" : "Editar token"}
            </Button>
          </div>
          {editingToken ? (
            <div className="mt-4 space-y-3">
              <ProtectedTokenInput
                hidden={!newTokenVisible}
                label="Novo token"
                onChange={setNewToken}
                onToggle={() => setNewTokenVisible((current) => !current)}
                value={newToken}
              />
              <Button disabled={updatingToken || newToken.trim().length < 10} onClick={() => void handleSaveToken()} size="sm">
                {updatingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {updatingToken ? "Validando..." : "Salvar novo token"}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/[0.08] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-[#FFEA70]">URL da Dashboard</p>
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

        <div className="mt-auto flex flex-wrap gap-2 border-t border-[#FFD500]/15 pt-4">
          <Button onClick={onOpenDashboard} size="sm">
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Button>
          <Button onClick={onOpenSettings} size="sm" variant="outline">
            <Settings className="h-4 w-4" />
            Configurações
          </Button>
          <Button onClick={onOpenLogs} size="sm" variant="outline">
            <ScrollText className="h-4 w-4" />
            Logs
          </Button>
          <Button
            disabled={powering}
            onClick={onPower}
            size="icon"
            title={bot.status === "online" ? "Desligar bot" : "Ligar bot"}
            variant={bot.status === "online" ? "destructive" : "outline"}
          >
            {powering ? <Loader2 className="h-4 w-4 animate-spin" /> : bot.status === "online" ? <Unplug className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          </Button>
          <Button disabled={deleting} onClick={onDelete} size="icon" title="Desconectar bot" variant="destructive">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BotChannelPreview({
  error,
  loading,
  textChannels,
  voiceChannels
}: {
  error: string | null;
  loading: boolean;
  textChannels: GuildChannelOption[];
  voiceChannels: GuildVoiceChannelOption[];
}) {
  const visibleTextChannels = textChannels.slice(0, 12);
  const visibleVoiceChannels = voiceChannels.slice(0, 8);
  const hiddenTextCount = Math.max(0, textChannels.length - visibleTextChannels.length);
  const hiddenVoiceCount = Math.max(0, voiceChannels.length - visibleVoiceChannels.length);

  return (
    <div className="rounded-lg border border-[#FFD500]/15 bg-black/30 p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-white">Canais do Discord</p>
          <p className="text-xs font-medium text-zinc-300">Carregado usando o token do bot selecionado.</p>
        </div>
        <Badge variant="muted">
          {loading ? "Carregando" : `${textChannels.length + voiceChannels.length} canais`}
        </Badge>
      </div>

      {loading ? (
        <div className="flex min-h-20 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/70 text-sm font-medium text-zinc-300">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Buscando canais...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-sm font-medium text-red-200">
          {error}
        </div>
      ) : textChannels.length || voiceChannels.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChannelGroup
            channels={visibleTextChannels.map((channel) => ({
              id: channel.id,
              label: `#${channel.name}`
            }))}
            hiddenCount={hiddenTextCount}
            title="Texto"
          />
          <ChannelGroup
            channels={visibleVoiceChannels.map((channel) => ({
              id: channel.id,
              label: channel.name
            }))}
            hiddenCount={hiddenVoiceCount}
            title="Voz"
          />
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-6 text-center text-sm font-medium text-zinc-300">
          Nenhum canal encontrado para esse bot.
        </div>
      )}
    </div>
  );
}

function ChannelGroup({
  channels,
  hiddenCount,
  title
}: {
  channels: Array<{ id: string; label: string }>;
  hiddenCount: number;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-bold uppercase text-zinc-300">{title}</p>
      {channels.length ? (
        <div className="flex flex-wrap gap-2">
          {channels.map((channel) => (
            <span
              className="max-w-full truncate rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-zinc-100"
              key={channel.id}
              title={channel.label}
            >
              {channel.label}
            </span>
          ))}
          {hiddenCount ? (
            <span className="rounded-md border border-[#FFD500]/20 bg-[#FFD500]/[0.08] px-2.5 py-1 text-xs font-semibold text-[#FFEA70]">
              +{hiddenCount}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-400">
          Nenhum canal.
        </p>
      )}
    </div>
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
    <span className="flex min-h-10 items-center gap-2 rounded-md border border-[#FFD500]/15 bg-white/[0.04] px-3 py-2">
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
    <Card className="h-full border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.88),rgba(9,9,11,0.96))] shadow-[0_0_36px_rgba(255,213,0,0.07)] hover:translate-y-0">
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
  readOnly = false,
  type = "text",
  value
}: {
  autoComplete?: string;
  inputMode?: "numeric";
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-white">{label}</span>
      <input
        autoComplete={autoComplete}
        className="social-input h-12 border-[#FFD500]/20 bg-black/55 font-medium text-white placeholder:text-zinc-500 focus:border-[#FFEA70]/70"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        type={type}
        value={value}
      />
    </label>
  );
}

function ProtectedTokenInput({
  hidden,
  label,
  onChange,
  onToggle,
  value
}: {
  hidden: boolean;
  label: string;
  onChange: (value: string) => void;
  onToggle: () => void;
  value: string;
}) {
  const tokenStatus = value.trim().length >= 10 ? "valid" : value.trim().length ? "invalid" : "empty";
  const statusLabel = tokenStatus === "valid" ? "Token com formato valido" : tokenStatus === "invalid" ? "Token muito curto" : "Aguardando token";
  const statusClassName = tokenStatus === "valid"
    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
    : tokenStatus === "invalid"
      ? "border-red-500/35 bg-red-500/10 text-red-200"
      : "border-zinc-700 bg-zinc-900/80 text-zinc-300";

  return (
    <label className="block space-y-2">
      <span className="flex items-center gap-2 text-sm font-semibold text-white">
        <LockKeyhole className="h-4 w-4 text-[#FFEA70]" />
        {label}
      </span>
      <div className="group relative">
        <input
          autoComplete="new-password"
          className="social-input h-12 border-[#FFD500]/20 bg-black/55 pr-14 font-mono font-semibold text-white placeholder:text-zinc-500 focus:border-[#FFEA70]/70"
          onChange={(event) => onChange(event.target.value)}
          placeholder="••••••••••••••••••••••••"
          spellCheck={false}
          type={hidden ? "password" : "text"}
          value={value}
        />
        <Button
          aria-label={hidden ? "Mostrar token" : "Ocultar token"}
          className="absolute right-1.5 top-1/2 h-9 w-9 -translate-y-1/2 rounded-md border-zinc-800 bg-zinc-950/80 text-zinc-300 transition hover:scale-105 hover:bg-zinc-900 hover:text-white"
          onClick={onToggle}
          size="icon"
          title={hidden ? "Mostrar token" : "Ocultar token"}
          type="button"
          variant="outline"
        >
          <span className="transition duration-200 ease-out group-focus-within:scale-105">
            {hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </span>
        </Button>
      </div>
      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition duration-200 ${statusClassName}`}>
        {tokenStatus === "valid" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
        {statusLabel}
      </div>
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
    <Card className={`relative overflow-visible border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)] hover:translate-y-0 ${open ? "z-[120]" : "z-0"}`}>
      <CardContent className="overflow-visible p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Selecionar Bot</p>
          <p className="mt-1 text-xs font-medium text-zinc-300">Tudo nesta aba DEV carrega e salva apenas para o bot selecionado.</p>
        </div>
        <div className="relative w-full lg:w-[420px]">
          <button
            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-[#FFD500]/20 bg-black/55 px-3 py-2 text-left shadow-inner transition duration-300 hover:border-[#FFEA70]/40 hover:bg-[#FFD500]/10"
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
            <div className="absolute right-0 top-16 z-[9999] w-full overflow-hidden rounded-xl border border-[#FFD500]/25 bg-[#101014] shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl">
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <Search className="h-4 w-4 text-[#FFEA70]" />
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
                        ? "bg-[#FFD500]/15 ring-1 ring-[#FFEA70]/25"
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
        </div>
      </CardContent>
    </Card>
  );
}

function BotModuleWorkspace({
  activeMenuId,
  bot,
  guilds,
  modules,
  onSelectMenu,
  onToggle
}: {
  activeMenuId: BotMenuId;
  bot: DevBot;
  guilds: DashboardMeGuild[];
  modules: DevModuleDefinition[];
  onSelectMenu: (menuId: BotMenuId) => void;
  onToggle: (moduleId: string, checked: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoriteModules(bot.id));
  const categories = moduleDashboardCategories(modules);
  const activeCategory = categories.find((item) => item.id === activeMenuId) ?? categories[0];
  const enabledSet = new Set(bot.enabledModules);
  const favoriteSet = new Set(favoriteIds);
  const normalizedQuery = query.trim().toLowerCase();
  const favoriteModules = modules.filter((module) => favoriteSet.has(module.id));
  const selectedModules = activeMenuId === "overview"
    ? modules
    : activeMenuId === "favorites"
      ? favoriteModules
      : activeMenuId === "database-maintenance"
        ? []
      : activeCategory
        ? modulesForMenu(activeCategory, modules, true)
        : modules;
  const filteredModules = (normalizedQuery ? modules : selectedModules).filter((module) => {
    if (!normalizedQuery) return true;

    return module.label.toLowerCase().includes(normalizedQuery) || module.id.toLowerCase().includes(normalizedQuery);
  });
  const activeModules = modules.filter((module) => enabledSet.has(module.id));
  const inactiveCount = Math.max(0, modules.length - activeModules.length);
  const securityModules = modulesForMenu({
    id: "moderation",
    label: "Seguranca",
    description: "",
    icon: ShieldCheck,
    moduleIds: [
      "moderation",
      "safe-bot",
      "account-age-security",
      "anti-ban",
      "suspicious-servers",
      "global-blacklist",
      "advanced-permissions",
      "invite-cleanup",
      "vanity-url-protection",
      "tag-verification",
      "bio-url-verification"
    ]
  }, modules, true);
  const activeSecurityCount = securityModules.filter((module) => enabledSet.has(module.id)).length;

  useEffect(() => {
    setFavoriteIds(readFavoriteModules(bot.id));
  }, [bot.id]);

  function toggleFavorite(moduleId: string) {
    setFavoriteIds((current) => {
      const next = current.includes(moduleId)
        ? current.filter((item) => item !== moduleId)
        : [...current, moduleId];

      writeFavoriteModules(bot.id, next);
      return next;
    });
  }

  return (
    <Card className="overflow-hidden border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(18,18,22,0.94),rgba(7,7,10,0.98))] shadow-[0_0_54px_rgba(255,213,0,0.12)] hover:translate-y-0" id="dev-bot-module-settings">
      <CardHeader className="border-b border-[#FFD500]/15 p-5 sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFEA70]" variant="muted">Bot Menu</Badge>
              <Badge variant={bot.status === "online" ? "success" : bot.status === "error" || bot.status === "invalid_token" ? "danger" : "muted"}>
                {statusLabel(bot.status)}
              </Badge>
            </div>
            <CardTitle className="mt-3 text-2xl font-bold text-white">Bot Menu</CardTitle>
            <CardDescription className="mt-2 font-medium text-zinc-300">
              Gerencie todos os módulos de {bot.name} em categorias, cards e ações rápidas.
            </CardDescription>
          </div>
          <div className="space-y-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="h-12 w-full rounded-lg border border-[#FFD500]/20 bg-black/45 pl-10 pr-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70] focus:shadow-[0_0_24px_rgba(255,213,0,0.18)]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar módulo..."
                value={query}
              />
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs font-medium text-zinc-400">
              <span className="truncate rounded-lg border border-zinc-800 bg-black/35 px-3 py-2">Servidor: {bot.mainGuildName || bot.mainGuildId}</span>
              <span className="truncate rounded-lg border border-zinc-800 bg-black/35 px-3 py-2">Bot: {bot.status === "online" ? "Online" : statusLabel(bot.status)}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <style>
          {`@keyframes bot-card-in { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }`}
        </style>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BotMenuStatCard icon={CheckCircle2} label="Módulos ativos" tone="success" value={`${activeModules.length}/${modules.length}`} />
          <BotMenuStatCard icon={ShieldCheck} label="Protecoes ativas" tone="purple" value={String(activeSecurityCount)} />
          <BotMenuStatCard icon={SlidersHorizontal} label="Precisam configuração" tone="warning" value={String(inactiveCount)} />
          <BotMenuStatCard icon={Power} label="Bot online" tone={bot.status === "online" ? "success" : "muted"} value={bot.status === "online" ? "100%" : "0%"} />
        </section>

        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-lg border border-[#FFD500]/15 bg-black/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur">
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <Avatar className="h-10 w-10 rounded-lg border border-[#FFD500]/25" fallback={bot.name} src={bot.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{bot.name}</p>
                <p className="truncate text-xs font-medium text-zinc-500">Dashboard DEV</p>
              </div>
            </div>
            <nav className="space-y-1">
              <BotMenuCategoryButton
                active={activeMenuId === "overview"}
                count={activeModules.length}
                icon={LayoutDashboard}
                label="Todos"
                onClick={() => onSelectMenu("overview")}
                total={modules.length}
              />
              <BotMenuCategoryButton
                active={activeMenuId === "favorites"}
                count={favoriteModules.filter((module) => enabledSet.has(module.id)).length}
                icon={Star}
                label="Favoritos"
                onClick={() => onSelectMenu("favorites")}
                total={favoriteModules.length}
              />
              <BotMenuCategoryButton
                active={activeMenuId === "database-maintenance"}
                count={0}
                icon={Database}
                label="Manutencao do Banco"
                onClick={() => onSelectMenu("database-maintenance")}
                total={0}
              />
              {categories.map((item) => (
                <BotMenuCategoryButton
                  active={activeMenuId === item.id}
                  count={countEnabledMenuModules(item, modules, bot.enabledModules)}
                  icon={item.icon}
                  key={item.id}
                  label={item.label}
                  onClick={() => onSelectMenu(item.id)}
                  total={modulesForMenu(item, modules, true).length}
                />
              ))}
            </nav>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="rounded-lg border border-[#FFD500]/15 bg-black/25 p-4 backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">
                    {normalizedQuery ? "Resultado da busca" : activeMenuId === "favorites" ? "Favoritos" : activeMenuId === "overview" ? "Todos os módulos" : activeCategory?.label ?? "Módulos"}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-zinc-400">
                    {normalizedQuery
                      ? `Filtrando por "${query.trim()}".`
                      : activeMenuId === "favorites"
                        ? "Módulos marcados com estrela ficam sempre a um clique."
                        : activeCategory?.description ?? "Controle rápido dos módulos deste bot."}
                  </p>
                </div>
                <Badge variant="muted">{filteredModules.filter((module) => enabledSet.has(module.id)).length}/{filteredModules.length} ativos</Badge>
              </div>
            </div>

            {activeMenuId === "cloning" && !normalizedQuery ? (
              <ServerCloneDevWorkspace
                bot={bot}
                enabled={enabledSet.has("server-cloner")}
                guilds={guilds}
                onEnable={() => onToggle("server-cloner", true)}
              />
            ) : null}

            {activeMenuId === "database-maintenance" && !normalizedQuery ? (
              <DatabaseMaintenancePanel bot={bot} guilds={guilds} />
            ) : null}

            {activeMenuId === "database-maintenance" && !normalizedQuery ? null : filteredModules.length ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {filteredModules.map((module, index) => (
                  <ModuleDashboardCard
                    enabled={enabledSet.has(module.id)}
                    favorite={favoriteSet.has(module.id)}
                    index={index}
                    key={module.id}
                    module={module}
                    onToggle={onToggle}
                    onToggleFavorite={toggleFavorite}
                    status={bot.status}
                  />
                ))}
              </div>
            ) : (
              <EmptyBotMenuCategory label={normalizedQuery ? "Busca" : activeMenuId === "favorites" ? "Favoritos" : activeCategory?.label ?? "Categoria"} />
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function DatabaseMaintenancePanel({ bot, guilds }: { bot: DevBot; guilds: DashboardMeGuild[] }) {
  const [guildId, setGuildId] = useState(bot.mainGuildId);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<DatabaseMaintenanceUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [links, setLinks] = useState<DatabaseMaintenanceLinksResult | null>(null);
  const [modules, setModules] = useState<DatabaseMaintenanceModuleOption[]>([]);
  const [selectedModule, setSelectedModule] = useState("manual-registration");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [moduleConfirmation, setModuleConfirmation] = useState("");
  const [serverConfirmation, setServerConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DatabaseMaintenanceActionResult | null>(null);
  const visibleGuilds = guilds.length ? guilds : [{ id: bot.mainGuildId, name: bot.mainGuildName || bot.mainGuildId } as DashboardMeGuild];

  useEffect(() => {
    let mounted = true;
    getDatabaseMaintenanceModules()
      .then((items) => {
        if (!mounted) return;
        setModules(items);
        setSelectedModule((current) => current || items[0]?.id || "manual-registration");
      })
      .catch(() => {
        if (mounted) setMessage("Nao foi possivel carregar os modulos de manutencao.");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setLinks(null);
    setUsers([]);
    setSelectedUserId("");
    setDeleteConfirmation("");
  }, [guildId, bot.id]);

  async function searchUsers() {
    setBusy("search");
    setMessage(null);
    setLastResult(null);
    try {
      const result = await searchDatabaseMaintenanceUsers(bot.id, guildId, query.trim());
      setUsers(result);
      if (!result.length) setMessage("Nenhum usuario encontrado nesse escopo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Falha ao buscar usuarios.");
    } finally {
      setBusy(null);
    }
  }

  async function inspectUser(userId: string) {
    setBusy(`inspect:${userId}`);
    setMessage(null);
    setLastResult(null);
    try {
      const result = await getDatabaseMaintenanceUserLinks(bot.id, guildId, userId);
      setSelectedUserId(userId);
      setLinks(result);
      setDeleteConfirmation("");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Falha ao buscar vinculos do usuario.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteUser() {
    if (!selectedUserId) return;
    setBusy("delete-user");
    setMessage(null);
    setLastResult(null);
    try {
      const result = await deleteDatabaseMaintenanceUserLinks(bot.id, guildId, selectedUserId, deleteConfirmation.trim());
      setLastResult(result);
      setMessage(`Usuario limpo: ${result.deletedTotal} registro(s) removido(s).`);
      await inspectUser(selectedUserId);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Falha ao excluir vinculos do usuario.");
    } finally {
      setBusy(null);
    }
  }

  async function cleanupLegacy() {
    setBusy("cleanup-legacy");
    setMessage(null);
    setLastResult(null);
    try {
      const result = await cleanupLegacyDatabaseMaintenance(bot.id, guildId);
      setLastResult(result);
      setMessage(`Limpeza antiga concluida: ${result.deletedTotal} registro(s) removido(s).`);
      if (selectedUserId) await inspectUser(selectedUserId);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Falha ao limpar sistema antigo.");
    } finally {
      setBusy(null);
    }
  }

  async function resetModule() {
    setBusy("reset-module");
    setMessage(null);
    setLastResult(null);
    try {
      const result = await resetDatabaseMaintenanceModule(bot.id, guildId, selectedModule, moduleConfirmation.trim());
      setLastResult(result);
      setMessage(`Modulo zerado: ${result.deletedTotal} registro(s) removido(s).`);
      setModuleConfirmation("");
      if (selectedUserId) await inspectUser(selectedUserId);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Falha ao zerar modulo.");
    } finally {
      setBusy(null);
    }
  }

  async function resetServer() {
    setBusy("reset-server");
    setMessage(null);
    setLastResult(null);
    try {
      const result = await resetDatabaseMaintenanceServer(bot.id, guildId, serverConfirmation.trim());
      setLastResult(result);
      setMessage(`Servidor limpo neste bot: ${result.deletedTotal} registro(s) removido(s).`);
      setServerConfirmation("");
      setLinks(null);
      setUsers([]);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Falha ao limpar servidor.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm font-medium text-red-100">
        Todas as acoes sao isoladas por <span className="font-mono">{guildId}</span> e bot <span className="font-mono">{bot.id}</span>. Use apenas depois de revisar os vinculos encontrados.
      </div>

      {message ? (
        <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="border-zinc-800 bg-black/35">
          <CardHeader className="p-4">
            <CardTitle className="flex items-center gap-2 text-white"><Search className="h-4 w-4" /> Buscar cadastro</CardTitle>
            <CardDescription>Busque por ID do Discord, nome ou liste recentes do servidor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <label className="block text-xs font-semibold uppercase text-zinc-400">Servidor</label>
            <select className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" onChange={(event) => setGuildId(event.target.value)} value={guildId}>
              {visibleGuilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name || guild.id}</option>)}
              {!visibleGuilds.some((guild) => guild.id === bot.mainGuildId) ? <option value={bot.mainGuildId}>{bot.mainGuildName || bot.mainGuildId}</option> : null}
            </select>
            <input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 font-mono text-sm text-white outline-none focus:border-[#FFEA70]" inputMode="numeric" onChange={(event) => setGuildId(event.target.value.replace(/\D/g, ""))} placeholder="Ou digite um Guild ID" value={guildId} />
            <label className="block text-xs font-semibold uppercase text-zinc-400">ID Discord ou nome</label>
            <div className="flex gap-2">
              <input className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-[#FFEA70]" onChange={(event) => setQuery(event.target.value)} placeholder="1234567890 ou nome" value={query} />
              <Button disabled={busy === "search"} onClick={() => void searchUsers()} size="sm">{busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar</Button>
            </div>
            <div className="space-y-2">
              {users.map((user) => (
                <button className={`w-full rounded-lg border p-3 text-left ${selectedUserId === user.userId ? "border-[#FFEA70] bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950/70"}`} key={user.userId} onClick={() => void inspectUser(user.userId)} type="button">
                  <span className="block text-sm font-semibold text-white">{user.username || "Usuario sem nome"}</span>
                  <span className="block font-mono text-xs text-zinc-400">{user.userId}</span>
                  <span className="mt-1 block text-xs text-zinc-500">{user.sources.join(", ")}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-black/35">
          <CardHeader className="p-4">
            <CardTitle className="flex items-center gap-2 text-white"><Database className="h-4 w-4" /> Vinculos encontrados</CardTitle>
            <CardDescription>Revise os documentos antes de confirmar a exclusao.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {links ? (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <OverviewMetric label="Usuario" value={links.userId} />
                  <OverviewMetric label="Registros" value={String(links.total)} />
                  <OverviewMetric label="Canais vinculados" value={String(new Set(links.links.flatMap((item) => item.channels)).size)} />
                </div>
                <div className="max-h-80 space-y-2 overflow-auto pr-1">
                  {links.links.map((link) => (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3" key={`${link.collection}-${link.module}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{link.module}</p>
                        <Badge variant="muted">{link.count}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-zinc-500">{link.collection}</p>
                      {link.channels.length ? <p className="mt-1 text-xs text-yellow-200">Canais: {link.channels.join(", ")}</p> : null}
                    </div>
                  ))}
                  {!links.links.length ? <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">Nenhum vinculo encontrado para este usuario.</p> : null}
                </div>
                <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3">
                  <label className="block text-xs font-semibold uppercase text-red-100">Confirmar exclusao digitando o ID do usuario</label>
                  <div className="mt-2 flex gap-2">
                    <input className="h-10 min-w-0 flex-1 rounded-lg border border-red-500/25 bg-black px-3 font-mono text-sm text-white" onChange={(event) => setDeleteConfirmation(event.target.value)} value={deleteConfirmation} />
                    <Button disabled={busy === "delete-user" || deleteConfirmation.trim() !== selectedUserId || !links.total} onClick={() => void deleteUser()} variant="destructive">
                      {busy === "delete-user" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Excluir vinculos
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-black/25 text-center text-sm text-zinc-400">
                Selecione um usuario para visualizar todos os vinculos.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-zinc-800 bg-black/35">
          <CardHeader className="p-4">
            <CardTitle className="text-white">Limpar sistema antigo</CardTitle>
            <CardDescription>Remove testes, duplicados e registros detectavelmente orfaos.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Button disabled={busy === "cleanup-legacy"} onClick={() => void cleanupLegacy()} variant="outline">
              {busy === "cleanup-legacy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Limpar sistema antigo
            </Button>
          </CardContent>
        </Card>

        <Card className="border-yellow-500/25 bg-yellow-500/5">
          <CardHeader className="p-4">
            <CardTitle className="text-white">Zerar modulo</CardTitle>
            <CardDescription>Digite CONFIRMAR antes de zerar o modulo selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <select className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" onChange={(event) => setSelectedModule(event.target.value)} value={selectedModule}>
              {modules.map((module) => <option key={module.id} value={module.id}>{module.label}</option>)}
            </select>
            <input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" onChange={(event) => setModuleConfirmation(event.target.value)} placeholder="CONFIRMAR" value={moduleConfirmation} />
            <Button disabled={busy === "reset-module" || moduleConfirmation.trim() !== "CONFIRMAR"} onClick={() => void resetModule()} variant="destructive">
              {busy === "reset-module" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Zerar modulo
            </Button>
          </CardContent>
        </Card>

        <Card className="border-red-500/25 bg-red-500/5">
          <CardHeader className="p-4">
            <CardTitle className="text-white">Zerar servidor inteiro</CardTitle>
            <CardDescription>Digite o ID do servidor para apagar todos os dados deste bot nesse servidor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <input className="h-10 w-full rounded-lg border border-red-500/25 bg-black px-3 font-mono text-sm text-white" onChange={(event) => setServerConfirmation(event.target.value)} placeholder={guildId} value={serverConfirmation} />
            <Button disabled={busy === "reset-server" || serverConfirmation.trim() !== guildId} onClick={() => void resetServer()} variant="destructive">
              {busy === "reset-server" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Zerar servidor
            </Button>
          </CardContent>
        </Card>
      </div>

      {lastResult ? (
        <Card className="border-zinc-800 bg-black/35">
          <CardHeader className="p-4">
            <CardTitle className="text-white">Ultimo resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            <p className="text-sm text-zinc-300">{lastResult.deletedTotal} registro(s) removido(s).</p>
            <div className="grid gap-2 md:grid-cols-2">
              {lastResult.modules.map((module, index) => (
                <div className="rounded border border-zinc-800 bg-zinc-950/70 p-2 text-xs text-zinc-300" key={`${module.collection}-${index}`}>
                  <span className="font-semibold text-white">{module.module}</span> - {module.collection}: {module.deleted}
                  {module.reason ? <span className="block text-zinc-500">{module.reason}</span> : null}
                </div>
              ))}
            </div>
            {lastResult.errors?.length ? <p className="text-sm text-red-200">Erros: {lastResult.errors.map((error) => `${error.collection}: ${error.message}`).join("; ")}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BotMenuStatCard({
  icon: Icon,
  label,
  tone,
  value
}: {
  icon: typeof Bot;
  label: string;
  tone: "success" | "purple" | "warning" | "muted";
  value: string;
}) {
  const toneClass = {
    muted: "border-zinc-700 bg-zinc-900 text-zinc-300",
    purple: "border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFEA70]",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warning: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
  }[tone];

  return (
    <div className="group rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-4 shadow-[0_16px_38px_rgba(0,0,0,0.22)] transition duration-300 hover:-translate-y-0.5 hover:border-[#FFD500]/35 hover:bg-zinc-950 hover:shadow-[0_0_28px_rgba(255,213,0,0.10)]">
      <div className="flex items-center justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="h-2 w-2 rounded-full bg-[#FFEA70] opacity-50 transition group-hover:opacity-100" />
      </div>
      <p className="mt-4 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
    </div>
  );
}

function BotMenuCategoryButton({
  active,
  count,
  icon: Icon,
  label,
  onClick,
  total
}: {
  active: boolean;
  count: number;
  icon: typeof Bot;
  label: string;
  onClick: () => void;
  total: number;
}) {
  return (
    <button
      className={[
        "group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition duration-300",
        active
          ? "bg-[#FFD500]/18 text-white ring-1 ring-[#FFEA70]/30 shadow-[0_0_22px_rgba(255,213,0,0.13)]"
          : "text-zinc-400 hover:bg-zinc-900/80 hover:text-white"
      ].join(" ")}
      onClick={onClick}
      title={`${label}: ${count}/${total} ativos`}
      type="button"
    >
      <span className={["flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition", active ? "border-[#FFEA70]/30 bg-[#FFD500]/15 text-[#FFEA70]" : "border-zinc-800 bg-black/30 text-zinc-500 group-hover:text-[#FFEA70]"].join(" ")}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="rounded-full border border-zinc-800 bg-black/35 px-2 py-0.5 text-xs text-zinc-300">{total ? count : 0}</span>
    </button>
  );
}

function ModuleDashboardCard({
  enabled,
  favorite,
  index,
  module,
  onToggle,
  onToggleFavorite,
  status
}: {
  enabled: boolean;
  favorite: boolean;
  index: number;
  module: DevModuleDefinition;
  onToggle: (moduleId: string, checked: boolean) => void;
  onToggleFavorite: (moduleId: string) => void;
  status: DevBotStatus;
}) {
  const Icon = iconForModule(module.id);
  const moduleStatus = moduleCardStatus(enabled, status);

  return (
    <div
      className="group relative min-h-[184px] overflow-hidden rounded-lg border border-zinc-800/95 bg-zinc-950/75 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.24)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:scale-[1.015] hover:border-[#FFD500]/45 hover:bg-zinc-950 hover:shadow-[0_0_34px_rgba(255,213,0,0.14)]"
      style={{ animation: `bot-card-in 280ms ease-out ${Math.min(index, 10) * 22}ms both` }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FFEA70]/50 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70] shadow-[0_0_24px_rgba(255,213,0,0.10)]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-white" title={module.label}>{module.label}</h3>
            <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-zinc-500">{moduleDescription(module.id)}</p>
          </div>
        </div>
        <button
          className={["flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition", favorite ? "border-yellow-400/40 bg-yellow-500/10 text-yellow-200" : "border-zinc-800 bg-black/20 text-zinc-500 hover:border-yellow-400/35 hover:text-yellow-200"].join(" ")}
          onClick={() => onToggleFavorite(module.id)}
          title={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          type="button"
        >
          <Star className={favorite ? "h-4 w-4 fill-current" : "h-4 w-4"} />
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-900 pt-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">Status</p>
          <p className={`mt-1 flex items-center gap-2 text-sm font-semibold ${moduleStatus.className}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${moduleStatus.dotClassName}`} />
            {moduleStatus.label}
          </p>
        </div>
        <Switch checked={enabled} className="shrink-0" onCheckedChange={(checked) => onToggle(module.id, checked)} title={enabled ? "Desativar módulo" : "Ativar módulo"} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          className="flex h-9 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 text-xs font-bold text-[#FFEA70] transition hover:border-[#FFEA70]/45 hover:bg-[#FFD500]/18"
          onClick={() => onToggle(module.id, !enabled)}
          title="Configurar rapidamente"
          type="button"
        >
          <Settings className="h-3.5 w-3.5" />
          Configurar
        </button>
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black/20 text-zinc-500 transition hover:border-[#FFD500]/35 hover:text-white"
          title={`Modulo: ${module.id}`}
          type="button"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const clonePartOptions = [
  { id: "roles", label: "Cargos" },
  { id: "categories", label: "Categorias" },
  { id: "text", label: "Canais de texto" },
  { id: "voice", label: "Canais de voz" }
];

const defaultSalesSettingsForm: SaveOrvitechSalesSettingsPayload = {
  currency: "BRL",
  customerRoleId: null,
  enabled: false,
  logChannelId: null,
  panelColor: "#FFD500",
  panelDescription: "Planos, liberacoes e pagamentos do bot OrviTech.",
  panelImageUrl: null,
  panelTitle: "OrviTech Bot",
  publicUrl: "/orvitech/1492325134550302952",
  saleChannelId: null,
  supportRoleIds: [],
  termsUrl: null,
  thumbnailUrl: null
};

const defaultProviderForm: SaveOrvitechPaymentProviderPayload = {
  enabled: true,
  instructions: "",
  label: "Pagamento manual",
  provider: "manual",
  publicKey: "",
  secret: "",
  webhookSecret: "",
  webhookUrl: ""
};

const defaultPlanForm: SaveOrvitechSalesPlanPayload = {
  checkoutMessage: "",
  description: "",
  durationDays: 30,
  enabled: true,
  imageUrl: "",
  moduleIds: ["orvitech-sales"],
  name: "Plano mensal OrviTech",
  priceCents: 0
};

const defaultSaleForm: SaveOrvitechSalePayload = {
  amountCents: null,
  buyerId: "",
  buyerName: "",
  externalReference: "",
  notes: "",
  paymentProviderId: null,
  planId: null,
  status: "pending"
};

const productFeatureLabels: Record<OrvitechProductFeatureKey, string> = {
  activationKey: "Chave de ativacao",
  automaticContract: "Contrato automatico",
  automaticLogin: "Login automatico",
  automaticPix: "Pix automatico",
  automaticRenewal: "Renovacao automatica",
  coupons: "Aceita cupom",
  hosting: "Hospedagem inclusa",
  passwordCreation: "Criacao de senha",
  releaseCode: "Codigo de liberacao",
  support: "Suporte",
  updates: "Atualizacoes"
};

const defaultProductForm: SaveOrvitechProductPayload = {
  active: true,
  additionalInfo: "",
  bannerUrl: "",
  category: "Bot Discord",
  fullDescription: "",
  howItWorks: "",
  layout: {
    accentColor: "#FFD500",
    glassEffect: true,
    theme: "dark"
  },
  name: "Produto Premium",
  observations: "",
  plans: {
    monthly: {
      benefits: ["Hospedagem inclusa", "Atualizacoes", "Suporte", "Liberacao automatica"],
      buttonColor: "#FFD500",
      buttonText: "Mensal",
      description: "Hospedagem inclusa. Pagamento recorrente.",
      enabled: true,
      name: "Plano Mensal",
      paymentProviderId: null,
      priceCents: 3000,
      priceText: "R$ 30,00/mes"
    },
    lifetime: {
      benefits: ["Acesso permanente", "Sem mensalidade", "Atualizacoes vitalicias", "Suporte"],
      buttonColor: "#9333ea",
      buttonText: "Vitalicio",
      description: "Acesso permanente sem mensalidade.",
      enabled: false,
      name: "Plano Vitalicio",
      paymentProviderId: null,
      priceCents: 12000,
      priceText: "R$ 120,00"
    }
  },
  seo: {
    description: "",
    title: ""
  },
  shortDescription: "Pagina de venda premium configuravel pela dashboard.",
  slug: "",
  toggles: {
    activationKey: false,
    automaticContract: true,
    automaticLogin: false,
    automaticPix: true,
    automaticRenewal: true,
    coupons: false,
    hosting: true,
    passwordCreation: true,
    releaseCode: true,
    support: true,
    updates: true
  },
  warnings: ""
};

function OrvitechSalesWorkspace({
  bot,
  enabled,
  guilds,
  onEnable
}: {
  bot: DevBot;
  enabled: boolean;
  guilds: DashboardMeGuild[];
  onEnable: () => void;
}) {
  const guildOptions = useMemo(() => buildBotGuildOptions(bot, guilds), [bot, guilds]);
  const [guildId, setGuildId] = useState(bot.mainGuildId || guildOptions[0]?.id || "");
  const [dashboard, setDashboard] = useState<OrvitechSalesDashboard | null>(null);
  const [settingsForm, setSettingsForm] = useState<SaveOrvitechSalesSettingsPayload>(defaultSalesSettingsForm);
  const [providerForm, setProviderForm] = useState<SaveOrvitechPaymentProviderPayload>(defaultProviderForm);
  const [planForm, setPlanForm] = useState<SaveOrvitechSalesPlanPayload>(defaultPlanForm);
  const [productForm, setProductForm] = useState<SaveOrvitechProductPayload>(defaultProductForm);
  const [saleForm, setSaleForm] = useState<SaveOrvitechSalePayload>(defaultSaleForm);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setGuildId(bot.mainGuildId || guildOptions[0]?.id || "");
  }, [bot.id, bot.mainGuildId, guildOptions]);

  useEffect(() => {
    if (!enabled || !guildId) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setMessage(null);

    getOrvitechSalesDashboard(bot.id, guildId)
      .then((data) => {
        if (cancelled) return;
        setDashboard(data);
        setSettingsForm(settingsToForm(data.settings));
        setSaleForm((current) => ({
          ...current,
          paymentProviderId: current.paymentProviderId ?? data.settings.paymentProviders[0]?.id ?? null,
          planId: current.planId ?? data.plans[0]?.id ?? null
        }));
      })
      .catch((error) => {
        if (!cancelled) setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar o sistema de vendas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bot.id, enabled, guildId]);

  async function refreshDashboard() {
    if (!guildId) return;
    const data = await getOrvitechSalesDashboard(bot.id, guildId);
    setDashboard(data);
    setSettingsForm(settingsToForm(data.settings));
  }

  async function handleSaveSettings() {
    if (!guildId) return;
    setSaving("settings");
    setMessage(null);
    try {
      const settings = await saveOrvitechSalesSettings(bot.id, guildId, sanitizeSalesSettingsForm(settingsForm));
      setDashboard((current) => current ? { ...current, settings } : current);
      setSettingsForm(settingsToForm(settings));
      setMessage("Configuracao de vendas salva.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar a configuracao.");
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveProvider() {
    if (!guildId || !providerForm.label.trim()) return;
    setSaving("provider");
    setMessage(null);
    try {
      const settings = await saveOrvitechPaymentProvider(bot.id, guildId, providerForm);
      setDashboard((current) => current ? { ...current, settings } : current);
      setProviderForm(defaultProviderForm);
      setMessage("Forma de pagamento salva.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o pagamento.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDeleteProvider(provider: OrvitechSalesPaymentProvider) {
    if (!guildId || !window.confirm(`Remover ${provider.label}?`)) return;
    setSaving(provider.id);
    try {
      const settings = await deleteOrvitechPaymentProvider(bot.id, guildId, provider.id);
      setDashboard((current) => current ? { ...current, settings } : current);
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveProduct() {
    if (!guildId || !productForm.name.trim()) return;

    setSaving("product");
    setMessage(null);
    try {
      if (editingProductId) {
        await updateOrvitechProduct(bot.id, guildId, editingProductId, productForm);
      } else {
        await createOrvitechProduct(bot.id, guildId, productForm);
      }
      setProductForm(defaultProductForm);
      setEditingProductId(null);
      await refreshDashboard();
      setMessage("Produto salvo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o produto.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDuplicateProduct(product: OrvitechProduct) {
    if (!guildId) return;
    setSaving(product.id);
    try {
      await duplicateOrvitechProduct(bot.id, guildId, product.id);
      await refreshDashboard();
      setMessage("Produto duplicado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel duplicar o produto.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDeleteProduct(product: OrvitechProduct) {
    if (!guildId || !window.confirm(`Excluir ${product.name}?`)) return;
    setSaving(product.id);
    try {
      await deleteOrvitechProduct(bot.id, guildId, product.id);
      if (editingProductId === product.id) {
        setEditingProductId(null);
        setProductForm(defaultProductForm);
      }
      await refreshDashboard();
      setMessage("Produto excluido.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel excluir o produto.");
    } finally {
      setSaving(null);
    }
  }

  async function handleUploadProductBanner(file: File | null) {
    if (!guildId || !editingProductId || !file) return;

    setSaving("product-banner");
    setMessage(null);
    try {
      const product = await uploadOrvitechProductBanner(bot.id, guildId, editingProductId, file);
      setProductForm(productToForm(product));
      await refreshDashboard();
      setMessage("Banner do produto atualizado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel enviar o banner.");
    } finally {
      setSaving(null);
    }
  }

  async function handleSavePlan() {
    if (!guildId || !planForm.name.trim()) return;
    setSaving("plan");
    setMessage(null);
    try {
      if (editingPlanId) {
        await updateOrvitechSalesPlan(bot.id, guildId, editingPlanId, planForm);
      } else {
        await createOrvitechSalesPlan(bot.id, guildId, planForm);
      }
      setPlanForm(defaultPlanForm);
      setEditingPlanId(null);
      await refreshDashboard();
      setMessage("Plano salvo.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o plano.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDeletePlan(plan: OrvitechSalesPlan) {
    if (!guildId || !window.confirm(`Remover o plano ${plan.name}?`)) return;
    setSaving(plan.id);
    try {
      await deleteOrvitechSalesPlan(bot.id, guildId, plan.id);
      await refreshDashboard();
    } finally {
      setSaving(null);
    }
  }

  async function handleCreateSale() {
    if (!guildId || !/^\d{5,32}$/.test(saleForm.buyerId)) {
      setMessage("Informe o ID Discord do comprador.");
      return;
    }

    setSaving("sale");
    setMessage(null);
    try {
      await createOrvitechSale(bot.id, guildId, saleForm);
      setSaleForm({
        ...defaultSaleForm,
        paymentProviderId: dashboard?.settings.paymentProviders[0]?.id ?? null,
        planId: dashboard?.plans[0]?.id ?? null
      });
      await refreshDashboard();
      setMessage("Venda registrada.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel registrar a venda.");
    } finally {
      setSaving(null);
    }
  }

  async function handleSaleStatus(saleId: string, status: OrvitechSaleStatus) {
    if (!guildId) return;
    setSaving(saleId);
    try {
      await updateOrvitechSaleStatus(bot.id, guildId, saleId, status);
      await refreshDashboard();
    } finally {
      setSaving(null);
    }
  }

  function editPlan(plan: OrvitechSalesPlan) {
    setEditingPlanId(plan.id);
    setPlanForm({
      checkoutMessage: plan.checkoutMessage ?? "",
      description: plan.description ?? "",
      durationDays: plan.durationDays,
      enabled: plan.enabled,
      imageUrl: plan.imageUrl ?? "",
      moduleIds: plan.moduleIds.length ? plan.moduleIds : ["orvitech-sales"],
      name: plan.name,
      priceCents: plan.priceCents
    });
  }

  function editProduct(product: OrvitechProduct) {
    setEditingProductId(product.id);
    setProductForm(productToForm(product));
  }

  const stats = dashboard?.stats;

  return (
    <div className="space-y-6">
      <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.92),rgba(8,8,12,0.96))] shadow-[0_0_44px_rgba(255,213,0,0.10)] hover:translate-y-0">
        <CardHeader className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-white">
                <CreditCard className="h-5 w-5 text-[#FFEA70]" />
                Vendas OrviTech
              </CardTitle>
              <CardDescription className="mt-2 font-medium text-zinc-300">
                Bot principal: 1492325134550302952. Planos, pagamentos, imagens e vendas por servidor.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm font-semibold text-zinc-100 outline-none"
                onChange={(event) => setGuildId(event.target.value)}
                value={guildId}
              >
                {guildOptions.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
              </select>
              {!enabled ? (
                <Button onClick={onEnable} variant="outline">
                  <Power className="h-4 w-4" />
                  Liberar modulo
                </Button>
              ) : (
                <Badge className="border-emerald-400/30 bg-emerald-500/15 text-emerald-100" variant="muted">Modulo liberado</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 sm:grid-cols-2 lg:grid-cols-6 sm:p-6 sm:pt-0">
          <SalesMetric label="Receita paga" value={formatMoney(stats?.revenueCents ?? 0, dashboard?.settings.currency ?? "BRL")} />
          <SalesMetric label="Clientes" value={String(stats?.customers ?? 0)} />
          <SalesMetric label="Pagas" value={String(stats?.paidSales ?? 0)} />
          <SalesMetric label="Pendentes" value={String(stats?.pendingSales ?? 0)} />
          <SalesMetric label="Planos ativos" value={String(stats?.activePlans ?? 0)} />
          <SalesMetric label="Assinaturas" value={String(stats?.subscriptions ?? 0)} />
        </CardContent>
      </Card>

      {message ? (
        <div className="rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">
          {message}
        </div>
      ) : null}

      {!enabled ? (
        <Card className="border-amber-400/25 bg-amber-500/[0.08] hover:translate-y-0">
          <CardContent className="flex min-h-44 flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-500/15 text-amber-100">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-bold text-white">Sistema de vendas bloqueado neste bot</p>
              <p className="mt-1 max-w-xl text-sm font-medium text-zinc-300">
                Libere o modulo OrviTech - Sistema de Vendas para o bot selecionado antes de configurar planos, pagamentos e vendas.
              </p>
            </div>
            <Button onClick={onEnable}>
              <Power className="h-4 w-4" />
              Liberar para este bot
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card className="border-zinc-800 bg-zinc-950/80 hover:translate-y-0">
          <CardContent className="flex min-h-48 items-center justify-center p-6">
            <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Card className="border-zinc-800/80 bg-zinc-950/80 hover:translate-y-0">
            <CardHeader>
              <CardTitle className="text-white">Configuracao publica</CardTitle>
              <CardDescription>Textos, canais, URL e imagens dos paineis de venda.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <DevInput label="Titulo do painel" onChange={(value) => setSettingsForm((current) => ({ ...current, panelTitle: value }))} value={settingsForm.panelTitle ?? ""} />
                <DevInput label="URL publica" onChange={(value) => setSettingsForm((current) => ({ ...current, publicUrl: value }))} value={settingsForm.publicUrl ?? ""} />
                <DevInput label="Store ID" onChange={() => undefined} readOnly value={dashboard?.settings.storeId ?? ""} />
                <DevInput label="Cor do painel" onChange={(value) => setSettingsForm((current) => ({ ...current, panelColor: value }))} value={settingsForm.panelColor ?? ""} />
                <DevInput label="Canal de vendas" onChange={(value) => setSettingsForm((current) => ({ ...current, saleChannelId: value.replace(/\D/g, "") || null }))} value={settingsForm.saleChannelId ?? ""} />
                <DevInput label="Canal de logs" onChange={(value) => setSettingsForm((current) => ({ ...current, logChannelId: value.replace(/\D/g, "") || null }))} value={settingsForm.logChannelId ?? ""} />
                <DevInput label="Cargo cliente" onChange={(value) => setSettingsForm((current) => ({ ...current, customerRoleId: value.replace(/\D/g, "") || null }))} value={settingsForm.customerRoleId ?? ""} />
                <DevInput label="Imagem do painel" onChange={(value) => setSettingsForm((current) => ({ ...current, panelImageUrl: value }))} value={settingsForm.panelImageUrl ?? ""} />
                <DevInput label="Thumbnail" onChange={(value) => setSettingsForm((current) => ({ ...current, thumbnailUrl: value }))} value={settingsForm.thumbnailUrl ?? ""} />
                <DevInput label="Termos de venda" onChange={(value) => setSettingsForm((current) => ({ ...current, termsUrl: value }))} value={settingsForm.termsUrl ?? ""} />
              </div>
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase text-zinc-400">Descricao</span>
                <textarea
                  className="min-h-24 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm font-medium text-white outline-none transition focus:border-[#FFEA70]/60"
                  onChange={(event) => setSettingsForm((current) => ({ ...current, panelDescription: event.target.value }))}
                  value={settingsForm.panelDescription ?? ""}
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/30 p-3">
                <label className="flex items-center gap-3 text-sm font-semibold text-white">
                  <Switch checked={Boolean(settingsForm.enabled)} onCheckedChange={(checked) => setSettingsForm((current) => ({ ...current, enabled: checked }))} />
                  Sistema de vendas ativo
                </label>
                <select
                  className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm font-semibold text-zinc-100 outline-none"
                  onChange={(event) => setSettingsForm((current) => ({ ...current, currency: event.target.value as "BRL" | "USD" | "EUR" }))}
                  value={settingsForm.currency ?? "BRL"}
                >
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
                <Button disabled={saving === "settings"} onClick={() => void handleSaveSettings()}>
                  {saving === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
                  Salvar configuracao
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-zinc-800/80 bg-zinc-950/80 hover:translate-y-0">
              <CardHeader>
                <CardTitle className="text-white">Pagamentos modulares</CardTitle>
                <CardDescription>Cada usuario pode cadastrar seu proprio metodo de pagamento.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DevInput label="Nome" onChange={(value) => setProviderForm((current) => ({ ...current, label: value }))} value={providerForm.label} />
                  <select
                    className="h-11 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none"
                    onChange={(event) => setProviderForm((current) => ({ ...current, provider: event.target.value as SaveOrvitechPaymentProviderPayload["provider"] }))}
                    value={providerForm.provider}
                  >
                    <option value="manual">Manual</option>
                    <option value="pix">Pix</option>
                    <option value="mercadopago">Mercado Pago</option>
                    <option value="stripe">Stripe</option>
                    <option value="paypal">PayPal</option>
                    <option value="custom">Custom</option>
                  </select>
                  <DevInput label="Chave publica" onChange={(value) => setProviderForm((current) => ({ ...current, publicKey: value }))} value={providerForm.publicKey ?? ""} />
                  <DevInput label="Segredo/API token" onChange={(value) => setProviderForm((current) => ({ ...current, secret: value }))} value={providerForm.secret ?? ""} />
                  <DevInput label="Webhook" onChange={(value) => setProviderForm((current) => ({ ...current, webhookUrl: value }))} value={providerForm.webhookUrl ?? ""} />
                  <DevInput label="Segredo webhook" onChange={(value) => setProviderForm((current) => ({ ...current, webhookSecret: value }))} value={providerForm.webhookSecret ?? ""} />
                  <DevInput label="Instrucoes" onChange={(value) => setProviderForm((current) => ({ ...current, instructions: value }))} value={providerForm.instructions ?? ""} />
                </div>
                <Button disabled={saving === "provider"} onClick={() => void handleSaveProvider()}>
                  {saving === "provider" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  Salvar pagamento
                </Button>
                <div className="grid gap-2">
                  {dashboard?.settings.paymentProviders.map((provider) => (
                    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black/35 p-3" key={provider.id}>
                      <CreditCard className="h-4 w-4 text-[#FFEA70]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{provider.label}</p>
                        <p className="truncate text-xs font-medium text-zinc-400">{provider.provider} · gateway {provider.gatewayId} {provider.secretConfigured ? "· segredo configurado" : ""}</p>
                      </div>
                      <Badge variant={provider.enabled ? "success" : "muted"}>{provider.enabled ? "Ativo" : "Off"}</Badge>
                      <Button disabled={saving === provider.id} onClick={() => void handleDeleteProvider(provider)} size="icon" variant="destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-[#FFD500]/20 bg-zinc-950/80 hover:translate-y-0 xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-white">Produtos</CardTitle>
              <CardDescription>Paginas de venda com banner, planos mensal/vitalicio, beneficios e checkout vinculado ao gateway da loja.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DevInput label="Nome do produto" onChange={(value) => setProductForm((current) => ({ ...current, name: value }))} value={productForm.name} />
                  <DevInput label="Slug da pagina" onChange={(value) => setProductForm((current) => ({ ...current, slug: value }))} value={productForm.slug} />
                  <DevInput label="Categoria" onChange={(value) => setProductForm((current) => ({ ...current, category: value }))} value={productForm.category} />
                  <DevInput label="Banner URL" onChange={(value) => setProductForm((current) => ({ ...current, bannerUrl: value }))} value={productForm.bannerUrl ?? ""} />
                  <DevInput label="Cor destaque" onChange={(value) => setProductForm((current) => ({ ...current, layout: { ...current.layout, accentColor: value } }))} value={productForm.layout.accentColor} />
                  <DevInput label="Descricao curta" onChange={(value) => setProductForm((current) => ({ ...current, shortDescription: value }))} value={productForm.shortDescription} />
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black/30 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-white">Upload de banner</p>
                      <p className="mt-1 text-xs font-medium text-zinc-400">Disponivel apos salvar/criar o produto.</p>
                    </div>
                    <input
                      accept="image/gif,image/jpeg,image/png,image/webp"
                      className="max-w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-[#E5C000] file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
                      disabled={!editingProductId || saving === "product-banner"}
                      onChange={(event) => void handleUploadProductBanner(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <ProductTextArea label="Descricao completa" onChange={(value) => setProductForm((current) => ({ ...current, fullDescription: value }))} value={productForm.fullDescription} />
                  <ProductTextArea label="Como funciona" onChange={(value) => setProductForm((current) => ({ ...current, howItWorks: value }))} value={productForm.howItWorks} />
                  <ProductTextArea label="Informacoes adicionais" onChange={(value) => setProductForm((current) => ({ ...current, additionalInfo: value }))} value={productForm.additionalInfo} />
                  <ProductTextArea label="Avisos" onChange={(value) => setProductForm((current) => ({ ...current, warnings: value }))} value={productForm.warnings} />
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <ProductPlanEditor
                    currency={dashboard?.settings.currency ?? "BRL"}
                    onChange={(plan) => setProductForm((current) => ({ ...current, plans: { ...current.plans, monthly: plan } }))}
                    paymentProviders={dashboard?.settings.paymentProviders ?? []}
                    plan={productForm.plans.monthly}
                    title="Plano Mensal"
                  />
                  <ProductPlanEditor
                    currency={dashboard?.settings.currency ?? "BRL"}
                    onChange={(plan) => setProductForm((current) => ({ ...current, plans: { ...current.plans, lifetime: plan } }))}
                    paymentProviders={dashboard?.settings.paymentProviders ?? []}
                    plan={productForm.plans.lifetime}
                    title="Plano Vitalicio"
                  />
                </div>

                <div className="rounded-lg border border-zinc-800 bg-black/30 p-4">
                  <p className="text-sm font-bold text-white">Recursos extras</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(Object.keys(productFeatureLabels) as OrvitechProductFeatureKey[]).map((key) => (
                      <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/30 p-2 text-xs font-semibold text-zinc-200" key={key}>
                        <Switch
                          checked={Boolean(productForm.toggles[key])}
                          onCheckedChange={(checked) => setProductForm((current) => ({
                            ...current,
                            toggles: {
                              ...current.toggles,
                              [key]: checked
                            }
                          }))}
                        />
                        {productFeatureLabels[key]}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/30 p-3">
                  <label className="flex items-center gap-3 text-sm font-semibold text-white">
                    <Switch checked={productForm.active} onCheckedChange={(checked) => setProductForm((current) => ({ ...current, active: checked }))} />
                    Produto ativo
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {editingProductId ? <Button onClick={() => { setEditingProductId(null); setProductForm(defaultProductForm); }} variant="outline">Cancelar</Button> : null}
                    <Button disabled={saving === "product"} onClick={() => void handleSaveProduct()}>
                      {saving === "product" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {editingProductId ? "Salvar alteracoes" : "Novo produto"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-[#FFD500]/20 bg-black/35">
                  <div className="aspect-[16/9] bg-zinc-900">
                    {productForm.bannerUrl ? <img alt="Preview" className="h-full w-full object-cover" src={productForm.bannerUrl} /> : null}
                  </div>
                  <div className="p-4">
                    <Badge variant={productForm.active ? "success" : "muted"}>{productForm.active ? "Ativo" : "Inativo"}</Badge>
                    <h3 className="mt-3 text-lg font-bold text-white">{productForm.name}</h3>
                    <p className="mt-1 text-sm font-medium text-zinc-400">{productForm.shortDescription}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {productForm.plans.monthly.enabled ? <Badge variant="muted">{productForm.plans.monthly.buttonText}</Badge> : null}
                      {productForm.plans.lifetime.enabled ? <Badge variant="muted">{productForm.plans.lifetime.buttonText}</Badge> : null}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  {dashboard?.products.map((product) => (
                    <div className="rounded-lg border border-zinc-800 bg-black/35 p-3" key={product.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">{product.name}</p>
                          <p className="truncate text-xs font-medium text-zinc-400">{product.publicUrl}</p>
                        </div>
                        <Badge variant={product.active ? "success" : "muted"}>{product.active ? "Ativo" : "Off"}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => editProduct(product)} size="sm" variant="outline"><Settings className="h-4 w-4" />Editar</Button>
                        <Button onClick={() => void handleDuplicateProduct(product)} size="sm" variant="outline"><Copy className="h-4 w-4" />Duplicar</Button>
                        <Button onClick={() => window.open(product.publicUrl, "_blank", "noopener,noreferrer")} size="sm" variant="outline"><ExternalLink className="h-4 w-4" />Ver</Button>
                        <Button disabled={saving === product.id} onClick={() => void handleDeleteProduct(product)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button>
                      </div>
                    </div>
                  ))}
                  {!dashboard?.products.length ? (
                    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-sm font-medium text-zinc-400">
                      Nenhum produto criado.
                    </div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800/80 bg-zinc-950/80 hover:translate-y-0">
            <CardHeader>
              <CardTitle className="text-white">Planos de venda</CardTitle>
              <CardDescription>Produtos vendidos pelo bot principal OrviTech.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <DevInput label="Nome do plano" onChange={(value) => setPlanForm((current) => ({ ...current, name: value }))} value={planForm.name} />
                <DevInput inputMode="numeric" label="Preco em centavos" onChange={(value) => setPlanForm((current) => ({ ...current, priceCents: Number(value.replace(/\D/g, "")) }))} value={String(planForm.priceCents)} />
                <DevInput inputMode="numeric" label="Duracao em dias" onChange={(value) => setPlanForm((current) => ({ ...current, durationDays: Number(value.replace(/\D/g, "")) || null }))} value={String(planForm.durationDays ?? "")} />
                <DevInput label="Imagem do plano" onChange={(value) => setPlanForm((current) => ({ ...current, imageUrl: value }))} value={planForm.imageUrl ?? ""} />
                <DevInput label="Descricao" onChange={(value) => setPlanForm((current) => ({ ...current, description: value }))} value={planForm.description ?? ""} />
                <DevInput label="Mensagem checkout" onChange={(value) => setPlanForm((current) => ({ ...current, checkoutMessage: value }))} value={planForm.checkoutMessage ?? ""} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm font-semibold text-white">
                  <Switch checked={planForm.enabled} onCheckedChange={(checked) => setPlanForm((current) => ({ ...current, enabled: checked }))} />
                  Plano ativo
                </label>
                <div className="flex gap-2">
                  {editingPlanId ? <Button onClick={() => { setEditingPlanId(null); setPlanForm(defaultPlanForm); }} variant="outline">Cancelar</Button> : null}
                  <Button disabled={saving === "plan"} onClick={() => void handleSavePlan()}>
                    {saving === "plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {editingPlanId ? "Atualizar plano" : "Criar plano"}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3">
                {dashboard?.plans.map((plan) => (
                  <div className="rounded-lg border border-zinc-800 bg-black/35 p-3" key={plan.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-white">{plan.name}</p>
                        <p className="text-xs font-medium text-zinc-400">{formatMoney(plan.priceCents, dashboard.settings.currency)} · {plan.durationDays ? `${plan.durationDays} dias` : "sem expirar"}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => editPlan(plan)} size="sm" variant="outline"><Settings className="h-4 w-4" />Editar</Button>
                        <Button disabled={saving === plan.id} onClick={() => void handleDeletePlan(plan)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Remover</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800/80 bg-zinc-950/80 hover:translate-y-0">
            <CardHeader>
              <CardTitle className="text-white">Vendas e liberacoes</CardTitle>
              <CardDescription>Registro manual ou confirmacao de pagamentos recebidos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <select className="h-11 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none" onChange={(event) => setSaleForm((current) => ({ ...current, planId: event.target.value || null }))} value={saleForm.planId ?? ""}>
                  <option value="">Venda avulsa</option>
                  {dashboard?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
                <select className="h-11 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none" onChange={(event) => setSaleForm((current) => ({ ...current, paymentProviderId: event.target.value || null }))} value={saleForm.paymentProviderId ?? ""}>
                  <option value="">Sem pagamento</option>
                  {dashboard?.settings.paymentProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                </select>
                <DevInput inputMode="numeric" label="ID comprador" onChange={(value) => setSaleForm((current) => ({ ...current, buyerId: value.replace(/\D/g, "") }))} value={saleForm.buyerId} />
                <DevInput label="Nome comprador" onChange={(value) => setSaleForm((current) => ({ ...current, buyerName: value }))} value={saleForm.buyerName ?? ""} />
                <DevInput inputMode="numeric" label="Valor em centavos" onChange={(value) => setSaleForm((current) => ({ ...current, amountCents: Number(value.replace(/\D/g, "")) || null }))} value={String(saleForm.amountCents ?? "")} />
                <DevInput label="Referencia externa" onChange={(value) => setSaleForm((current) => ({ ...current, externalReference: value }))} value={saleForm.externalReference ?? ""} />
              </div>
              <Button disabled={saving === "sale"} onClick={() => void handleCreateSale()}>
                {saving === "sale" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Registrar venda
              </Button>
              <div className="grid gap-3">
                {dashboard?.sales.map((sale) => (
                  <div className="rounded-lg border border-zinc-800 bg-black/35 p-3" key={sale.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{sale.planName} · {sale.buyerName || sale.buyerId}</p>
                        <p className="text-xs font-medium text-zinc-400">{formatMoney(sale.amountCents, sale.currency)} · {formatDate(sale.createdAt)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={sale.status === "paid" ? "success" : sale.status === "cancelled" || sale.status === "refunded" ? "danger" : "muted"}>{saleStatusLabel(sale.status)}</Badge>
                        {sale.status !== "paid" ? <Button disabled={saving === sale.id} onClick={() => void handleSaleStatus(sale.id, "paid")} size="sm" variant="outline">Marcar paga</Button> : null}
                        {sale.status === "pending" ? <Button disabled={saving === sale.id} onClick={() => void handleSaleStatus(sale.id, "cancelled")} size="sm" variant="destructive">Cancelar</Button> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function SalesMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#FFD500]/15 bg-black/35 p-4">
      <p className="truncate text-xs font-bold uppercase text-zinc-400">{label}</p>
      <p className="mt-2 truncate text-base font-bold text-white">{value}</p>
    </div>
  );
}

function ProductTextArea({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase text-zinc-400">{label}</span>
      <textarea
        className="min-h-28 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm font-medium text-white outline-none transition focus:border-[#FFEA70]/60"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function ProductPlanEditor({
  currency,
  onChange,
  paymentProviders,
  plan,
  title
}: {
  currency: "BRL" | "USD" | "EUR";
  onChange: (plan: SaveOrvitechProductPayload["plans"]["monthly"]) => void;
  paymentProviders: OrvitechSalesPaymentProvider[];
  plan: SaveOrvitechProductPayload["plans"]["monthly"];
  title: string;
}) {
  function updatePlan<K extends keyof typeof plan>(key: K, value: (typeof plan)[K]) {
    onChange({
      ...plan,
      [key]: value
    });
  }

  return (
    <div className="rounded-lg border border-[#FFD500]/15 bg-[#FFD500]/[0.06] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-white">{title}</p>
        <Switch checked={plan.enabled} onCheckedChange={(checked) => updatePlan("enabled", checked)} />
      </div>
      <div className="mt-3 grid gap-3">
        <DevInput label="Nome" onChange={(value) => updatePlan("name", value)} value={plan.name} />
        <DevInput inputMode="numeric" label={`Valor em centavos (${currency})`} onChange={(value) => updatePlan("priceCents", Number(value.replace(/\D/g, "")))} value={String(plan.priceCents)} />
        <DevInput label="Texto do valor" onChange={(value) => updatePlan("priceText", value)} value={plan.priceText} />
        <DevInput label="Texto do botao" onChange={(value) => updatePlan("buttonText", value)} value={plan.buttonText} />
        <DevInput label="Cor do botao" onChange={(value) => updatePlan("buttonColor", value)} value={plan.buttonColor} />
        <select
          className="h-11 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm font-semibold text-white outline-none"
          onChange={(event) => updatePlan("paymentProviderId", event.target.value || null)}
          value={plan.paymentProviderId ?? ""}
        >
          <option value="">Gateway padrao da loja</option>
          {paymentProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
        <ProductTextArea label="Descricao" onChange={(value) => updatePlan("description", value)} value={plan.description} />
        <ProductTextArea label="Beneficios (um por linha)" onChange={(value) => updatePlan("benefits", splitLines(value))} value={plan.benefits.join("\n")} />
      </div>
    </div>
  );
}

function settingsToForm(settings: OrvitechSalesDashboard["settings"]): SaveOrvitechSalesSettingsPayload {
  return {
    currency: settings.currency,
    customerRoleId: settings.customerRoleId,
    enabled: settings.enabled,
    logChannelId: settings.logChannelId,
    panelColor: settings.panelColor,
    panelDescription: settings.panelDescription,
    panelImageUrl: settings.panelImageUrl,
    panelTitle: settings.panelTitle,
    publicUrl: settings.publicUrl,
    saleChannelId: settings.saleChannelId,
    supportRoleIds: settings.supportRoleIds,
    termsUrl: settings.termsUrl,
    thumbnailUrl: settings.thumbnailUrl
  };
}

function productToForm(product: OrvitechProduct): SaveOrvitechProductPayload {
  return {
    active: product.active,
    additionalInfo: product.additionalInfo,
    bannerUrl: product.bannerUrl ?? "",
    category: product.category,
    fullDescription: product.fullDescription,
    howItWorks: product.howItWorks,
    layout: product.layout,
    name: product.name,
    observations: product.observations,
    plans: product.plans,
    seo: product.seo,
    shortDescription: product.shortDescription,
    slug: product.slug,
    toggles: product.toggles,
    warnings: product.warnings
  };
}

function sanitizeSalesSettingsForm(form: SaveOrvitechSalesSettingsPayload): SaveOrvitechSalesSettingsPayload {
  return {
    ...form,
    customerRoleId: form.customerRoleId || null,
    logChannelId: form.logChannelId || null,
    panelImageUrl: form.panelImageUrl || null,
    saleChannelId: form.saleChannelId || null,
    termsUrl: form.termsUrl || null,
    thumbnailUrl: form.thumbnailUrl || null
  };
}

function formatMoney(cents: number, currency: "BRL" | "USD" | "EUR") {
  return new Intl.NumberFormat("pt-BR", {
    currency,
    style: "currency"
  }).format(cents / 100);
}

function saleStatusLabel(status: OrvitechSaleStatus) {
  const labels: Record<OrvitechSaleStatus, string> = {
    cancelled: "Cancelada",
    paid: "Paga",
    pending: "Pendente",
    refunded: "Reembolsada"
  };

  return labels[status];
}

type ServerClonePlanForm = {
  categoryRenames: string;
  channelRenames: string;
  sourceGuildId: string;
  destinationGuildId: string;
  destinationGuildInput: string;
  renameServer: string;
  cloneParts: string[];
  extraCategories: string;
  extraTextChannels: string;
  extraVoiceChannels: string;
  extraRoles: string;
  notes: string;
  roleRenames: string;
};

function ServerCloneDevWorkspace({
  bot,
  enabled,
  guilds,
  onEnable
}: {
  bot: DevBot;
  enabled: boolean;
  guilds: DashboardMeGuild[];
  onEnable: () => void;
}) {
  const guildOptions = useMemo(() => buildBotGuildOptions(bot, guilds), [bot, guilds]);
  const firstSourceId = bot.mainGuildId || guildOptions[0]?.id || "";
  const firstDestinationId = guildOptions.find((guild) => guild.id !== firstSourceId)?.id ?? firstSourceId;
  const [form, setForm] = useState<ServerClonePlanForm>(() => ({
    categoryRenames: "",
    channelRenames: "",
    sourceGuildId: firstSourceId,
    destinationGuildId: firstDestinationId,
    destinationGuildInput: "",
    renameServer: "",
    cloneParts: clonePartOptions.map((part) => part.id),
    extraCategories: "",
    extraTextChannels: "",
    extraVoiceChannels: "",
    extraRoles: "",
    notes: "",
    roleRenames: ""
  }));
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentModules, setCurrentModules] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    const sourceGuildId = bot.mainGuildId || guildOptions[0]?.id || "";
    const destinationGuildId = guildOptions.find((guild) => guild.id !== sourceGuildId)?.id ?? sourceGuildId;

    setForm({
      categoryRenames: "",
      channelRenames: "",
      sourceGuildId,
      destinationGuildId,
      destinationGuildInput: "",
      renameServer: "",
      cloneParts: clonePartOptions.map((part) => part.id),
      extraCategories: "",
      extraTextChannels: "",
      extraVoiceChannels: "",
      extraRoles: "",
      notes: "",
      roleRenames: ""
    });
    setCurrentModules({});
    setMessage(null);
  }, [bot.id, bot.mainGuildId, guildOptions]);

  useEffect(() => {
    if (!form.destinationGuildId) return;

    let cancelled = false;
    setLoadingConfig(true);

    getBotGuildConfig(bot.id, form.destinationGuildId)
      .then((config) => {
        if (cancelled) return;

        setCurrentModules(config.modules ?? {});
        const plan = normalizeServerClonePlan(config.modules?.["server-cloner"]);

        if (plan) {
          setForm((current) => ({
            ...current,
            categoryRenames: plan.categoryRenames.join("\n"),
            channelRenames: plan.channelRenames.join("\n"),
            sourceGuildId: plan.sourceGuildId || current.sourceGuildId,
            destinationGuildId: plan.destinationGuildId || current.destinationGuildId,
            destinationGuildInput: "",
            renameServer: plan.renameServer,
            cloneParts: plan.cloneParts.length ? plan.cloneParts : current.cloneParts,
            extraCategories: plan.extraCategories.join("\n"),
            extraTextChannels: plan.extraTextChannels.join("\n"),
            extraVoiceChannels: plan.extraVoiceChannels.join("\n"),
            extraRoles: plan.extraRoles.join("\n"),
            notes: plan.notes,
            roleRenames: plan.roleRenames.join("\n")
          }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(readRequestMessage(error) ?? "Não foi possível carregar o plano deste servidor.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingConfig(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bot.id, form.destinationGuildId]);

  function updateForm<K extends keyof ServerClonePlanForm>(key: K, value: ServerClonePlanForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function toggleClonePart(partId: string) {
    setForm((current) => {
      const next = current.cloneParts.includes(partId)
        ? current.cloneParts.filter((part) => part !== partId)
        : [...current.cloneParts, partId];

      return {
        ...current,
        cloneParts: next.length ? next : current.cloneParts
      };
    });
  }

  function applyManualDestination() {
    const guildId = form.destinationGuildInput.trim();

    if (!/^\d{5,32}$/.test(guildId)) {
      setMessage("Informe um ID valido para o servidor de destino.");
      return;
    }

    updateForm("destinationGuildId", guildId);
    updateForm("destinationGuildInput", "");
    setMessage("Destino manual adicionado ao plano.");
  }

  async function handleSavePlan() {
    if (!enabled) {
      onEnable();
    }

    if (!form.sourceGuildId || !form.destinationGuildId) {
      setMessage("Selecione servidor de origem e destino.");
      return;
    }

    if (form.sourceGuildId === form.destinationGuildId) {
      setMessage("O destino precisa ser diferente da origem.");
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const destination = guildOptions.find((guild) => guild.id === form.destinationGuildId);
      const modules = {
        ...currentModules,
        "server-cloner": {
          sourceGuildId: form.sourceGuildId,
          destinationGuildId: form.destinationGuildId,
          cloneParts: form.cloneParts,
          categoryRenames: splitLines(form.categoryRenames),
          channelRenames: splitLines(form.channelRenames),
          renameServer: form.renameServer.trim(),
          extraCategories: splitLines(form.extraCategories),
          extraTextChannels: splitLines(form.extraTextChannels),
          extraVoiceChannels: splitLines(form.extraVoiceChannels),
          extraRoles: splitLines(form.extraRoles),
          notes: form.notes.trim(),
          roleRenames: splitLines(form.roleRenames),
          configuredFrom: "dev-dashboard",
          updatedAt: new Date().toISOString()
        }
      };

      const saved = await updateBotGuildConfig(bot.id, form.destinationGuildId, {
        guildName: destination?.name ?? `Servidor ${form.destinationGuildId}`,
        modules
      });

      setCurrentModules(saved.modules ?? modules);
      setMessage("Plano salvo. Use /clonar-servidor no destino para o bot executar com esses dados.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o plano de clonagem.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(255,213,0,0.12),rgba(9,9,11,0.92))] shadow-[0_0_30px_rgba(255,213,0,0.10)]">
      <div className="border-b border-[#FFD500]/15 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFEA70]" variant="muted">Clonagem DEV</Badge>
              <Badge variant={enabled ? "success" : "muted"}>{enabled ? "Modulo liberado" : "Modulo desativado"}</Badge>
            </div>
            <h3 className="mt-3 text-lg font-bold text-white">Direcionamento de servidor</h3>
            <p className="mt-1 text-sm font-medium text-zinc-300">
              Escolha origem, destino e os adicionais que o bot deve aplicar depois da clonagem.
            </p>
          </div>
          <button
            className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[#FFD500]/30 bg-[#E5C000] px-4 text-sm font-bold text-white shadow-[0_12px_28px_rgba(255,213,0,0.28)] transition hover:bg-[#FFD500] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving || loadingConfig}
            onClick={() => void handleSavePlan()}
            type="button"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Salvar plano
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <CloneSelect
              label="Servidor de origem"
              onChange={(value) => updateForm("sourceGuildId", value)}
              options={guildOptions}
              value={form.sourceGuildId}
            />
            <CloneSelect
              label="Servidor de destino"
              onChange={(value) => updateForm("destinationGuildId", value)}
              options={guildOptions}
              value={form.destinationGuildId}
            />
          </div>

          <div className="grid gap-3 rounded-lg border border-zinc-800 bg-black/25 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Adicionar destino por ID</span>
              <input
                className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70]"
                onChange={(event) => updateForm("destinationGuildInput", event.target.value)}
                placeholder="Cole o ID do servidor que vai receber a clonagem"
                value={form.destinationGuildInput}
              />
            </label>
            <button
              className="h-11 rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 text-sm font-bold text-[#FFEA70] transition hover:border-[#FFEA70]/45 hover:bg-[#FFD500]/18"
              onClick={applyManualDestination}
              type="button"
            >
              Adicionar destino
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-black/30 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Itens clonados</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {clonePartOptions.map((part) => {
                const active = form.cloneParts.includes(part.id);

                return (
                  <button
                    className={[
                      "rounded-lg border px-3 py-2 text-xs font-bold transition",
                      active
                        ? "border-[#FFEA70]/45 bg-[#FFD500]/15 text-[#FFEA70] shadow-[0_0_18px_rgba(255,213,0,0.12)]"
                        : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:border-[#FFD500]/30 hover:text-white"
                    ].join(" ")}
                    key={part.id}
                    onClick={() => toggleClonePart(part.id)}
                    type="button"
                  >
                    {part.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Renomear servidor clonado</span>
            <input
              className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70]"
              onChange={(event) => updateForm("renameServer", event.target.value)}
              placeholder="Opcional: novo nome do servidor de destino"
              value={form.renameServer}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <CloneTextarea label="Adicionar categorias" onChange={(value) => updateForm("extraCategories", value)} placeholder="Uma categoria por linha" value={form.extraCategories} />
            <CloneTextarea label="Adicionar canais de texto" onChange={(value) => updateForm("extraTextChannels", value)} placeholder="ex: anuncios&#10;staff-chat" value={form.extraTextChannels} />
            <CloneTextarea label="Adicionar canais de voz" onChange={(value) => updateForm("extraVoiceChannels", value)} placeholder="ex: Reuniao&#10;Suporte" value={form.extraVoiceChannels} />
            <CloneTextarea label="Adicionar cargos" onChange={(value) => updateForm("extraRoles", value)} placeholder="ex: Staff&#10;Membro VIP" value={form.extraRoles} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <CloneTextarea label="Renomear canais clonados" onChange={(value) => updateForm("channelRenames", value)} placeholder="geral => chat-geral" value={form.channelRenames} />
            <CloneTextarea label="Renomear categorias clonadas" onChange={(value) => updateForm("categoryRenames", value)} placeholder="Suporte => Atendimento" value={form.categoryRenames} />
            <CloneTextarea label="Renomear cargos clonados" onChange={(value) => updateForm("roleRenames", value)} placeholder="Membro => Cliente" value={form.roleRenames} />
          </div>

          <CloneTextarea label="Notas internas" onChange={(value) => updateForm("notes", value)} placeholder="Observações para o DEV sobre esse plano" value={form.notes} />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-bold text-white">Como o bot vai usar</p>
          <p className="mt-2 text-sm font-medium leading-6 text-zinc-300">
            O plano fica salvo no servidor de destino. Quando o comando /clonar-servidor for aberto nesse destino,
            o modal vem com origem e destino preenchidos e aplica os adicionais apos copiar a estrutura.
          </p>
          <div className="mt-4 space-y-2 text-xs font-semibold text-zinc-400">
            <p className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">Origem: {guildLabel(guildOptions, form.sourceGuildId)}</p>
            <p className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">Destino: {guildLabel(guildOptions, form.destinationGuildId)}</p>
            <p className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2">Extras: {countPlanExtras(form)} item(ns)</p>
          </div>
          {loadingConfig ? (
            <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando plano salvo...
            </p>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 py-2 text-xs font-semibold text-[#FFEA70]">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CloneSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  value: string;
}) {
  const visibleOptions = value && !options.some((guild) => guild.id === value)
    ? [{ id: value, name: `Servidor ${value}` }, ...options]
    : options;

  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <select
        className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black/35 px-3 text-sm font-semibold text-white outline-none transition focus:border-[#FFEA70]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {visibleOptions.map((guild) => (
          <option className="bg-zinc-950 text-white" key={guild.id} value={guild.id}>
            {guild.name} - {guild.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function CloneTextarea({
  label,
  onChange,
  placeholder,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <textarea
        className="mt-2 min-h-[94px] w-full resize-y rounded-lg border border-zinc-800 bg-black/35 px-3 py-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-[#FFEA70]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function buildBotGuildOptions(bot: DevBot, guilds: DashboardMeGuild[]) {
  const guildMap = new Map(guilds.map((guild) => [guild.id, guild.name]));
  const ids = [...new Set([bot.mainGuildId, ...bot.guildIds].filter(Boolean))];

  return ids.map((id) => ({
    id,
    name: guildMap.get(id) ?? (id === bot.mainGuildId ? bot.mainGuildName : null) ?? `Servidor ${id}`
  }));
}

function guildLabel(options: Array<{ id: string; name: string }>, guildId: string) {
  const guild = options.find((item) => item.id === guildId);
  return guild ? guild.name : guildId || "Não definido";
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function countPlanExtras(form: ServerClonePlanForm) {
  return splitLines(form.extraCategories).length
    + splitLines(form.extraTextChannels).length
    + splitLines(form.extraVoiceChannels).length
    + splitLines(form.extraRoles).length
    + splitLines(form.categoryRenames).length
    + splitLines(form.channelRenames).length
    + splitLines(form.roleRenames).length
    + (form.renameServer.trim() ? 1 : 0);
}

function normalizeServerClonePlan(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const plan = value as Record<string, unknown>;
  const readArray = (key: string) => Array.isArray(plan[key])
    ? (plan[key] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  return {
    categoryRenames: readArray("categoryRenames"),
    channelRenames: readArray("channelRenames"),
    sourceGuildId: typeof plan.sourceGuildId === "string" ? plan.sourceGuildId : "",
    destinationGuildId: typeof plan.destinationGuildId === "string" ? plan.destinationGuildId : "",
    renameServer: typeof plan.renameServer === "string" ? plan.renameServer : "",
    cloneParts: readArray("cloneParts"),
    extraCategories: readArray("extraCategories"),
    extraTextChannels: readArray("extraTextChannels"),
    extraVoiceChannels: readArray("extraVoiceChannels"),
    extraRoles: readArray("extraRoles"),
    notes: typeof plan.notes === "string" ? plan.notes : "",
    roleRenames: readArray("roleRenames")
  };
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
            ? "bg-[#FFD500]/20 text-white ring-1 ring-[#FFEA70]/25 shadow-[0_0_20px_rgba(255,213,0,0.12)]"
            : "text-zinc-300 hover:bg-[#FFD500]/10 hover:text-white hover:shadow-[0_0_18px_rgba(255,213,0,0.10)]"
        }`}
        onClick={() => onSelectMenu(item.id)}
        type="button"
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {total ? <span className="text-xs font-semibold text-zinc-300">{count}/{total}</span> : null}
      </button>
      {item.children && active ? (
        <div className="ml-5 mt-1 space-y-1 border-l border-[#FFD500]/15 pl-2">
          {item.children.map((child) => {
            const childActive = activeMenuId === child.id;
            const childModules = modulesForMenu(child, modules);
            const childCount = childModules.filter((module) => selectedModules.includes(module.id)).length;

            return (
              <button
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                  childActive ? "bg-[#FFD500]/15 text-white" : "text-zinc-300 hover:bg-zinc-900/80 hover:text-white"
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
      <OverviewMetric label="Módulos ativos" value={`${activeModules.length}/${modules.length}`} />
      <OverviewMetric label="Servidor" value={bot.mainGuildName || bot.mainGuildId} />
      <OverviewMetric label="Token protegido" value={bot.tokenMasked || "Protegido"} />
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] p-4 sm:col-span-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <div>
            <p className="text-sm font-bold text-white">Acesso protegido</p>
            <p className="text-xs font-medium text-zinc-300">Login Discord e usuário autorizado para este bot.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function maskSensitiveText(value: string) {
  return value.replace(/mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,}/gi, "[token-protegido]");
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
      <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/[0.08] p-4">
        <p className="text-sm font-bold text-white">Gerenciador de módulos por bot</p>
        <p className="mt-1 text-xs font-medium text-zinc-300">
          Ativar aqui libera o módulo somente para o bot selecionado e faz a área aparecer no menu lateral dele.
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
    <div className="rounded-lg border border-[#FFD500]/15 bg-zinc-950/80 p-4">
      <p className="text-xs font-bold uppercase text-zinc-300">{label}</p>
      <p className="mt-2 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function EmptyBotMenuCategory({ label }: { label: string }) {
  return (
    <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-black/30 p-6 text-center">
      <div>
        <p className="text-sm font-bold text-white">{label} ainda não tem módulos cadastrados</p>
        <p className="mt-1 text-sm font-medium text-zinc-300">Quando um sistema dessa área existir, ele aparece aqui.</p>
      </div>
    </div>
  );
}

function BotSelectMenuManager({ bot }: { bot: DevBot }) {
  return (
    <div className="space-y-4">
      <Card className="border-[#FFD500]/20 bg-[linear-gradient(135deg,rgba(24,24,27,0.90),rgba(9,9,11,0.96))] shadow-[0_0_42px_rgba(255,213,0,0.08)]">
        <CardHeader className="p-5 sm:p-6">
          <CardTitle className="text-white">Menus de Seleção</CardTitle>
          <CardDescription className="font-medium text-zinc-300">Gerenciamento de select menus do Discord para o bot {bot.name}.</CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-0 sm:p-6 sm:pt-0">
          <div className="min-h-44 rounded-lg border border-dashed border-zinc-700 bg-black/30 p-8 text-center">
            <ChevronDown className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
            <p className="text-sm font-bold text-white">Nenhum select menu configurado</p>
            <p className="mt-2 text-sm font-medium text-zinc-300">Os menus de seleção do seu bot aparecerão aqui quando forem criados.</p>
          </div>
        </CardContent>
      </Card>
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
  const policeModules = modules.filter((module) => isPoliceReleaseModule(module.id));
  const standardModules = modules.filter((module) => !isFiveMModule(module.id) && !isPoliceReleaseModule(module.id));
  const fiveMModules = modules.filter((module) => isFiveMModule(module.id) && !isPoliceReleaseModule(module.id));

  return (
    <div className="space-y-5">
      <ModuleSwitchSection enabledModules={enabledModules} modules={standardModules} onToggle={onToggle} title="Sistemas do bot" />
      <ModuleSwitchSection enabledModules={enabledModules} modules={policeModules} onToggle={onToggle} title="Sistemas Policia" />
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
              className="flex min-h-[74px] items-center gap-4 rounded-lg border border-zinc-800 bg-black/40 px-4 py-3 transition duration-200 hover:border-[#FFD500]/25 hover:bg-zinc-950/80 hover:shadow-[0_0_20px_rgba(255,213,0,0.08)]"
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

function moduleDashboardCategories(modules: DevModuleDefinition[]) {
  return botMenuItems
    .filter((item) => !["overview", "favorites", "economy", "select-menu"].includes(item.id))
    .map((item) => ({
      ...item,
      label: item.id === "settings" ? "Sistema" : item.label,
      description: item.id === "settings" ? "Configurações gerais, comandos e ferramentas administrativas" : item.description
    }))
    .filter((item) => modulesForMenu(item, modules, true).length > 0);
}

function iconForModule(moduleId: string) {
  if (moduleId.includes("anti") || moduleId.includes("security") || moduleId.includes("blacklist") || moduleId.includes("permission")) {
    return ShieldCheck;
  }

  if (moduleId.includes("police")) return ShieldCheck;
  if (moduleId.includes("fivem")) return Gamepad2;
  if (moduleId.includes("clip")) return Copy;
  if (moduleId.includes("emoji")) return Copy;
  if (moduleId.includes("server")) return Server;
  if (moduleId.includes("voice")) return Users;
  if (moduleId.includes("log")) return ScrollText;
  if (moduleId.includes("ticket")) return Ticket;
  if (moduleId.includes("welcome") || moduleId.includes("leave") || moduleId.includes("roles")) return Users;
  if (moduleId.includes("live") || moduleId.includes("kick") || moduleId.includes("x-monitor")) return Link2;

  return Bot;
}

function moduleDescription(moduleId: string) {
  const descriptions: Record<string, string> = {
    "anti-abuse": "Central Anti Abuse para mute, deafen, move, disconnect e auto-correcao de voz.",
    "account-age-security": "Bloqueia contas novas conforme a idade mínima configurada.",
    "advanced-permissions": "Controla permissões sensíveis por cargo e registra tentativas.",
    "anti-ban": "Protege membros e cargos contra ban, kick, timeout e remoção indevida.",
    "auto-unmute": "Remove mute manual automaticamente em canais configurados.",
    "bio-url-verification": "Entrega cargos conforme URLs permitidas na bio do membro.",
    "emoji-cloner": "Clona emojis, gerencia biblioteca e sincroniza emojis da aplicação.",
    "global-blacklist": "Impede entrada de usuários cadastrados em lista global.",
    "hide-empty-voice": "Oculta chamadas vazias e reexibe quando alguém entra.",
    "invite-cleanup": "Remove convites em intervalos configuráveis com whitelist.",
    "safe-bot": "Proteção contra spam, links, raids, bots e abuso automatizado.",
    "server-backup": "Prepara backup, exportação e restauração seletiva do servidor.",
    "server-cloner": "Clona estrutura autorizada de servidores com relatório.",
    "suspicious-servers": "Detecta membros ligados a servidores suspeitos ou blacklist.",
    "tag-verification": "Entrega cargos quando o usuário usa a tag definida.",
    "temporary-voice": "Cria salas temporárias com dono, limite e limpeza automática.",
    "vanity-url-protection": "Monitora e restaura a URL personalizada do servidor."
  };

  return descriptions[moduleId] ?? "Módulo isolado do bot com liberação individual pela dashboard DEV.";
}

function moduleCardStatus(enabled: boolean, botStatus: DevBotStatus) {
  if ((botStatus === "error" || botStatus === "invalid_token") && enabled) {
    return {
      className: "text-red-300",
      dotClassName: "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.55)]",
      label: "Erro"
    };
  }

  if (enabled) {
    return {
      className: "text-emerald-300",
      dotClassName: "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.55)]",
      label: "Ativo"
    };
  }

  return {
    className: "text-zinc-400",
    dotClassName: "bg-zinc-500",
    label: "Desativado"
  };
}

function favoriteStorageKey(botId: string) {
  return `dev.bot-menu.favorites.${botId}`;
}

function readFavoriteModules(botId: string) {
  try {
    const raw = window.localStorage.getItem(favoriteStorageKey(botId));
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeFavoriteModules(botId: string, moduleIds: string[]) {
  try {
    window.localStorage.setItem(favoriteStorageKey(botId), JSON.stringify([...new Set(moduleIds)]));
  } catch {
    // Favoritos sao apenas uma preferencia visual local.
  }
}

function flattenBotMenuItems(items: BotMenuItem[]): BotMenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenBotMenuItems(item.children) : [])]);
}

function modulesForMenu(item: BotMenuItem, modules: DevModuleDefinition[], includeChildren = false) {
  const moduleIds = new Set([
    ...item.moduleIds,
    ...(includeChildren ? item.children?.flatMap((child) => child.moduleIds) ?? [] : [])
  ]);

  if (item.id === "fivem") {
    moduleIds.delete("fivem-hierarchy");
    moduleIds.delete("police-absences");
    moduleIds.delete("police-actions");
    moduleIds.delete("police-patrol-reports");
  }

  return modules.filter((module) => moduleIds.has(module.id));
}

function visibleBotMenuItems(items: BotMenuItem[], modules: DevModuleDefinition[], enabledModules: string[]): BotMenuItem[] {
  return items.flatMap((item) => {
    if (item.id === "overview" || item.id === "settings") {
      return [item];
    }

    const children = item.children
      ? visibleBotMenuItems(item.children, modules, enabledModules).filter((child) => item.id !== "fivem" || !["fivem-hierarchy", "police-absences", "police-actions", "police-patrol-reports"].includes(child.id))
      : undefined;
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
          title: "Configurações",
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
        if (item.id === "fivem" && ["fivem-hierarchy", "police-absences", "police-actions", "police-patrol-reports"].includes(child.id)) {
          continue;
        }

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
      title: "Outros módulos",
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

function isPoliceReleaseModule(moduleId: string) {
  return moduleId === "fivem-hierarchy" || moduleId === "police-absences" || moduleId === "police-actions" || moduleId === "police-patrol-reports";
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
