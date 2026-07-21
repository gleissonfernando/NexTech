import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  AtSign,
  BadgeCheck,
  Bell,
  Bot,
  BookOpen,
  Building2,
  CalendarClock,
  Car,
  CircleDollarSign,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  EyeOff,
  Film,
  Gift,
  Hash,
  ListTree,
  ListChecks,
  LockKeyhole,
  MessageCircle,
  Mic2,
  Music2,
  Radio,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SmilePlus,
  SlidersHorizontal,
  Trash2,
  Search,
  Server,
  TableProperties,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import type { DashboardBot, BotStatus } from "../../types";

export type ViewId =
  | "overview"
  | "plans"
  | "lives"
  | "clips"
  | "kick-clips"
  | "giveaway"
  | "x-monitor"
  | "moderation"
  | "rules"
  | "payment-gateway"
  | "manual-payments"
  | "price-tables"
  | "courses"
  | "rh-admin"
  | "mission-tools"
  | "voice-recorder"
  | "music"
  | "self-bot-protection"
  | "security"
  | "anti-abuse"
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
  | "permissions"
  | "logs"
  | "fivem"
  | "fivem-absence"
  | "fivem-hierarchy"
  | "fivem-actions"
  | "police-absence"
  | "police-actions"
  | "police-iab"
  | "police-subpoenas"
  | "police-patrol-reports"
  | "police-qru"
  | "police-promotions"
  | "vehicle-abandonment"
  | "police-hidden-channel"
  | "visible-message"
  | "message-control"
  | "police-dm"
  | "police-open-duty"
  | "police-time-clock"
  | "police-daf-roster"
  | "auto-activity-clock"
  | "fivem-orders"
  | "fivem-families"
  | "fivem-washing"
  | "fivem-ammo"
  | "fivem-drug"
  | "fivem-weapon"
  | "fivem-custom"
  | "fivem-finance"
  | "fivem-goals"
  | "ztk-webhook"
  | "manual-registration"
  | "notifications"
  | "entry-leave"
  | "auto-roles"
  | "application-emojis"
  | "media-library"
  | "server-cloner"
  | "delete-channels"
  | "settings";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  moduleId?: string;
  moduleIds?: string[];
};

type NavSectionId = "user" | "security" | "police" | "fivem" | "server";

const navSectionLabels: Record<NavSectionId, string> = {
  user: "Usuário",
  security: "Segurança",
  police: "Polícia",
  fivem: "FiveM",
  server: "Servidor"
};

const navItems: NavItem[] = [
  { id: "overview", label: "Visao geral", icon: Activity },
  { id: "lives", label: "Lives", icon: Radio, moduleIds: ["live", "kick-integration"] },
  { id: "clips", label: "Clips", icon: Film, moduleId: "clips" },
  { id: "kick-clips", label: "Clipes Kick", icon: Film, moduleId: "kick-clips" },
  { id: "giveaway", label: "Sorteio", icon: Gift, moduleId: "giveaway" },
  { id: "x-monitor", label: "X Monitor", icon: AtSign, moduleId: "x-monitor" },
  { id: "moderation", label: "Moderação", icon: Shield, moduleId: "moderation" },
  { id: "rules", label: "Regras", icon: ScrollText, moduleId: "rules" },
  { id: "payment-gateway", label: "Pagamento Automático", icon: CreditCard, moduleId: "payment-gateway" },
  { id: "manual-payments", label: "Pagamento Manual", icon: CreditCard, moduleId: "manual-payments" },
  { id: "price-tables", label: "Painel de Vendas", icon: TableProperties, moduleId: "price-tables" },
  { id: "courses", label: "Cursos", icon: BookOpen, moduleIds: ["courses", "police-courses"] },
  { id: "rh-admin", label: "RH Administrativo", icon: ShieldCheck, moduleIds: ["rh-admin", "police-hr"] },
  { id: "mission-tools", label: "Mission Tools", icon: ListChecks, moduleId: "mission-tools" },
  { id: "voice-recorder", label: "Voice Recorder", icon: Mic2, moduleId: "voice-recorder" },
  { id: "music", label: "Música", icon: Music2, moduleId: "music" },
  { id: "self-bot-protection", label: "SelfBot Protection", icon: ShieldCheck, moduleId: "safe-bot" },
  { id: "security", label: "Segurança", icon: ShieldAlert, moduleId: "account-age-security" },
  { id: "anti-abuse", label: "DEV Control", icon: ShieldCheck, moduleId: "anti-abuse" },
  { id: "anti-ban", label: "Anti Ban", icon: ShieldCheck, moduleId: "anti-ban" },
  { id: "suspicious-servers", label: "Servidores Suspeitos", icon: Search, moduleId: "suspicious-servers" },
  { id: "global-blacklist", label: "Blacklist Global", icon: LockKeyhole, moduleId: "global-blacklist" },
  { id: "advanced-permissions", label: "Permissões Avançadas", icon: SlidersHorizontal, moduleId: "advanced-permissions" },
  { id: "invite-cleanup", label: "Limpeza de Convites", icon: UserMinus, moduleId: "invite-cleanup" },
  { id: "server-backup", label: "Backup", icon: Server, moduleId: "server-backup" },
  { id: "vanity-url-protection", label: "URL Personalizada", icon: ChevronRight, moduleId: "vanity-url-protection" },
  { id: "hide-empty-voice", label: "Chamadas Vazias", icon: Mic2, moduleId: "hide-empty-voice" },
  { id: "anti-disconnect", label: "Anti Disconnect", icon: ShieldAlert, moduleId: "anti-disconnect" },
  { id: "auto-unmute", label: "Auto Desmutar", icon: Mic2, moduleId: "auto-unmute" },
  { id: "temporary-voice", label: "Chamadas Temporárias", icon: Users, moduleId: "temporary-voice" },
  { id: "tag-verification", label: "Verificação de Tag", icon: Hash, moduleId: "tag-verification" },
  { id: "bio-url-verification", label: "URL na Bio", icon: AtSign, moduleId: "bio-url-verification" },
  { id: "first-lady", label: "Primeira Dama", icon: UserPlus, moduleId: "first-lady" },
  { id: "permissions", label: "Usuários", icon: Users, moduleId: "verification" },
  { id: "logs", label: "Logs e Notificações", icon: ScrollText, moduleId: "logs" },
  { id: "fivem", label: "FiveM Geral", icon: Building2, moduleIds: ["fivem", "fivem-factions", "fivem-corporations", "fivem-ammo", "fivem-finance"] },
  { id: "fivem-absence", label: "Ausência", icon: CalendarClock, moduleIds: ["fivem-absences", "fivem-fac"] },
  { id: "fivem-hierarchy", label: "Hierarquia V2", icon: ListTree, moduleId: "fivem-hierarchy" },
  { id: "fivem-actions", label: "Ações FAC", icon: Activity, moduleId: "fivem-actions" },
  { id: "police-absence", label: "Ausência Policial", icon: CalendarClock, moduleId: "police-absences" },
  { id: "police-actions", label: "Ações Políciais", icon: Activity, moduleId: "police-actions" },
  { id: "police-iab", label: "Denúncias Corregedoria", icon: ShieldAlert, moduleId: "police-iab" },
  { id: "police-subpoenas", label: "Intimação", icon: ScrollText, moduleId: "police-subpoenas" },
  { id: "police-patrol-reports", label: "Relatórios Políciais", icon: ShieldCheck, moduleId: "police-patrol-reports" },
  { id: "police-qru", label: "Registro de QRU", icon: ShieldCheck, moduleId: "police-qru" },
  { id: "police-promotions", label: "Promoções", icon: BadgeCheck, moduleId: "police-promotions" },
  { id: "vehicle-abandonment", label: "Abandono de Veículo", icon: Car, moduleId: "vehicle-abandonment" },
  { id: "police-hidden-channel", label: "Canal Oculto", icon: EyeOff, moduleId: "police-hidden-channel" },
  { id: "visible-message", label: "Mensagem Visível", icon: MessageCircle, moduleId: "visible-message" },
  { id: "message-control", label: "Controle de Mensagem", icon: MessageCircle, moduleId: "message-control" },
  { id: "police-dm", label: "Barra DM", icon: UserPlus, moduleId: "police-dm" },
  { id: "police-open-duty", label: "Notificar / Ponto", icon: Bell, moduleId: "police-open-duty" },
  { id: "police-time-clock", label: "Relógio de Ponto", icon: CalendarClock, moduleId: "police-time-clock" },
  { id: "police-daf-roster", label: "Escala DAF", icon: CalendarClock, moduleId: "police-daf-roster" },
  { id: "auto-activity-clock", label: "Ponto Automático", icon: Activity, moduleId: "auto-activity-clock" },
  { id: "fivem-orders", label: "Encomendas RP", icon: Archive, moduleId: "fivem-orders" },
  { id: "fivem-families", label: "Famílias", icon: Users, moduleIds: ["fivem-orders", "fivem-drugs", "fivem-washing"] },
  { id: "fivem-washing", label: "Sistema de Lavagem", icon: CircleDollarSign, moduleId: "fivem-washing" },
  { id: "fivem-ammo", label: "Munição", icon: Archive, moduleId: "fivem-orders" },
  { id: "fivem-drug", label: "Sistema de Drogas", icon: Archive, moduleId: "fivem-drugs" },
  { id: "fivem-weapon", label: "Armas", icon: Archive, moduleId: "fivem-orders" },
  { id: "fivem-custom", label: "Personalizados", icon: Archive, moduleId: "fivem-orders" },
  { id: "fivem-finance", label: "Financeiro", icon: CircleDollarSign, moduleId: "fivem-finance" },
  { id: "fivem-goals", label: "Metas", icon: ListChecks, moduleId: "fivem-goals" },
  { id: "ztk-webhook", label: "ZTK Webhook", icon: Trophy, moduleId: "ztk-webhook" },
  { id: "manual-registration", label: "Pedido de Set", icon: ListChecks, moduleId: "manual-registration" },
  { id: "entry-leave", label: "Entrada/Saída", icon: UserPlus, moduleIds: ["welcome", "leave"] },
  { id: "auto-roles", label: "Cargos automaticos", icon: Users, moduleId: "roles" },
  { id: "media-library", label: "Emojis & Sons", icon: Archive, moduleId: "emoji-cloner" },
  { id: "server-cloner", label: "Clonagem", icon: SmilePlus, moduleIds: ["emoji-cloner", "server-cloner"] },
  { id: "delete-channels", label: "Canais e cargos", icon: Trash2 },
  { id: "settings", label: "Configurações", icon: Settings, moduleIds: ["tickets", "avisos", "network", "server-generator"] }
];

function navSectionForItem(item: NavItem): NavSectionId {
  if (
    item.id === "fivem-hierarchy"
    || item.id === "police-absence"
    || item.id === "police-actions"
    || item.id === "police-iab"
    || item.id === "police-subpoenas"
    || item.id === "police-patrol-reports"
    || item.id === "police-qru"
    || item.id === "police-promotions"
    || item.id === "vehicle-abandonment"
    || item.id === "police-hidden-channel"
    || item.id === "visible-message"
    || item.id === "message-control"
    || item.id === "police-dm"
    || item.id === "police-open-duty"
    || item.id === "police-time-clock"
    || item.id === "police-daf-roster"
    || item.id === "auto-activity-clock"
    || item.id === "courses"
    || item.id === "rh-admin"
    || item.moduleId === "fivem-hierarchy"
    || item.moduleId === "police-absences"
    || item.moduleId === "police-actions"
    || item.moduleId === "police-iab"
    || item.moduleId === "police-subpoenas"
    || item.moduleId === "police-patrol-reports"
    || item.moduleId === "police-qru"
    || item.moduleId === "police-promotions"
    || item.moduleId === "vehicle-abandonment"
    || item.moduleId === "police-hidden-channel"
    || item.moduleId === "visible-message"
    || item.moduleId === "message-control"
    || item.moduleId === "police-dm"
    || item.moduleId === "police-open-duty"
    || item.moduleId === "police-time-clock"
    || item.moduleId === "police-daf-roster"
    || item.moduleId === "auto-activity-clock"
    || item.moduleId === "rh-admin"
  ) {
    return "police";
  }

  if (item.id.startsWith("fivem") || item.id === "ztk-webhook" || item.id === "manual-registration") {
    return "fivem";
  }

  if ([
    "moderation",
    "self-bot-protection",
    "security",
    "anti-abuse",
    "anti-ban",
    "suspicious-servers",
    "global-blacklist",
    "advanced-permissions",
    "invite-cleanup",
    "vanity-url-protection",
    "hide-empty-voice",
    "anti-disconnect",
    "auto-unmute",
    "temporary-voice",
    "tag-verification",
    "bio-url-verification"
  ].includes(item.id)) {
    return "security";
  }

  if (["media-library", "server-cloner", "delete-channels"].includes(item.id)) {
    return "server";
  }

  return "user";
}

function groupNavItems(items: NavItem[]) {
  const order: NavSectionId[] = ["user", "police", "fivem", "security", "server"];

  return order
    .map((id) => ({
      id,
      items: items.filter((item) => navSectionForItem(item) === id),
      label: navSectionLabels[id]
    }))
    .filter((section) => section.items.length > 0);
}

type SidebarProps = {
  activeView: ViewId;
  bots: DashboardBot[];
  enabledModules: string[];
  isOpen: boolean;
  isSecondaryCollapsed: boolean;
  selectedBot: DashboardBot | null;
  status: BotStatus;
  onChangeView: (view: ViewId) => void;
  onClose: () => void;
  onSelectBot: (botId: string) => void;
  onToggleSecondary: () => void;
};

export function Sidebar({
  activeView,
  bots,
  enabledModules,
  isOpen,
  isSecondaryCollapsed,
  selectedBot,
  status,
  onChangeView,
  onClose,
  onSelectBot,
  onToggleSecondary
}: SidebarProps) {
  const enabledModuleSet = new Set(enabledModules);
  const visibleItems = navItems.filter((item) => {
    if (item.id === "overview" || item.id === "plans" || item.id === "notifications" || item.id === "delete-channels") {
      return true;
    }

    if (item.moduleId) {
      return enabledModuleSet.has(item.moduleId);
    }

    return Boolean(item.moduleIds?.some((moduleId) => enabledModuleSet.has(moduleId)));
  });

  function handleChangeView(view: ViewId) {
    onChangeView(view);
    onClose();
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition duration-300 lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-16 flex-col border-r border-zinc-900 bg-[#070708] px-2 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.58)] transition duration-300 lg:z-30 lg:w-20 lg:translate-x-0 lg:px-3",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="mb-5 flex h-12 items-center justify-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#FFD500]/35 bg-[#FFD500]/10 text-[#FFEA70] shadow-[0_0_30px_rgba(255,213,0,0.2)]">
            <Bot className="h-6 w-6" />
          </div>

          <button
            aria-label="Fechar menu"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition duration-300 hover:bg-zinc-900 hover:text-white lg:hidden"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="discord-scrollbar flex-1 space-y-2 overflow-y-auto pb-4">
          <button
            className={cn(
              "group flex h-12 w-12 items-center justify-center rounded-2xl text-zinc-400 transition duration-300 hover:rounded-xl hover:bg-[#FFD500]/15 hover:text-[#FFEA70]",
              selectedBot ? "bg-[#FFD500]/20 text-[#FFEA70] ring-1 ring-[#FFD500]/30" : "bg-zinc-900/70"
            )}
            onClick={() => {
              if (isSecondaryCollapsed) {
                onToggleSecondary();
              }
              onClose();
            }}
            title="Bots"
            type="button"
          >
            <Bot className="h-5 w-5" />
          </button>

          {visibleItems.map((item) => (
            <button
              key={item.id}
              className={cn(
                "group flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-medium transition duration-300 hover:rounded-xl",
                activeView === item.id
                  ? "bg-[#FFD500]/20 text-[#FFEA70] ring-1 ring-[#FFD500]/30"
                  : "bg-zinc-900/60 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
              )}
              onClick={() => handleChangeView(item.id)}
              title={item.label}
              type="button"
            >
              <item.icon className="h-4 w-4 shrink-0" />
            </button>
          ))}
        </nav>
      </aside>

      <BotManagementSidebar
        activeView={activeView}
        bots={bots}
        enabledModules={enabledModules}
        isCollapsed={isSecondaryCollapsed}
        isMainOpen={isOpen}
        onChangeView={handleChangeView}
        onSelectBot={onSelectBot}
        onToggle={onToggleSecondary}
        selectedBot={selectedBot}
        status={status}
      />
    </>
  );
}

function BotManagementSidebar({
  activeView,
  bots,
  enabledModules,
  isCollapsed,
  isMainOpen,
  onChangeView,
  onSelectBot,
  onToggle,
  selectedBot,
  status
}: {
  activeView: ViewId;
  bots: DashboardBot[];
  enabledModules: string[];
  isCollapsed: boolean;
  isMainOpen: boolean;
  onChangeView: (view: ViewId) => void;
  onSelectBot: (botId: string) => void;
  onToggle: () => void;
  selectedBot: DashboardBot | null;
  status: BotStatus;
}) {
  const [query, setQuery] = useState("");
  const [selectOpen, setSelectOpen] = useState(false);
  const enabledModuleSet = new Set(enabledModules);
  const filteredBots = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) return bots;

    return bots.filter((bot) => (
      bot.name.toLowerCase().includes(normalized)
      || bot.id.toLowerCase().includes(normalized)
      || bot.clientId.toLowerCase().includes(normalized)
    ));
  }, [bots, query]);
  const botOnline = Boolean(selectedBot && (selectedBot.status === "online" || status.online));
  const botNavItems = navItems.filter((item) => {
    if (item.id === "overview" || item.id === "plans" || item.id === "notifications" || item.id === "delete-channels") return true;
    if (item.moduleId) return enabledModuleSet.has(item.moduleId);
    return Boolean(item.moduleIds?.some((moduleId) => enabledModuleSet.has(moduleId)));
  });
  const botNavSections = groupNavItems(botNavItems);

  if (isCollapsed) {
    return (
      <button
        className="fixed left-20 top-4 z-30 hidden h-10 w-10 items-center justify-center rounded-r-lg border border-l-0 border-zinc-800 bg-[#101013] text-zinc-400 transition hover:text-white lg:flex"
        onClick={onToggle}
        title="Expandir gerenciamento de bots"
        type="button"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside
      className={cn(
          "fixed inset-y-0 left-16 z-40 flex w-[calc(100vw-4rem)] max-w-80 flex-col border-r border-[#FFD500]/20 bg-[#0b0b0b]/95 px-3 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.45)] backdrop-blur-xl transition duration-300 sm:px-4 lg:left-20 lg:z-30 lg:w-80",
        isMainOpen ? "translate-x-0" : "-translate-x-[100vw] lg:translate-x-0"
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            <Avatar className="h-12 w-12 rounded-2xl border border-[#FFD500]/35" fallback={selectedBot?.name ?? "Bot"} src={selectedBot?.avatarUrl} />
            <span className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0b0b0e]", botOnline ? "bg-emerald-400" : "bg-zinc-600")} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{selectedBot?.name ?? "Selecione um bot"}</p>
            <p className={cn("mt-1 text-xs font-medium", botOnline ? "text-emerald-300" : "text-zinc-500")}>
              {botOnline ? "Online" : "Offline"}
            </p>
          </div>
        </div>
        <button
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-900 hover:text-white lg:flex"
          onClick={onToggle}
          title="Recolher"
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="relative">
        <button
          className="flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-[#FFD500]/20 bg-zinc-950/80 px-3 text-left transition hover:border-[#FFD500]/40"
          onClick={() => setSelectOpen((current) => !current)}
          type="button"
        >
          <span className="min-w-0 truncate text-sm text-zinc-200">{selectedBot?.name ?? "Selecione um bot"}</span>
          <ChevronRight className={cn("h-4 w-4 text-zinc-500 transition", selectOpen ? "rotate-90" : "")} />
        </button>

        {selectOpen ? (
          <div className="absolute left-0 right-0 top-14 z-50 overflow-hidden rounded-lg border border-[#FFD500]/25 bg-[#101013] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <Search className="h-4 w-4 text-zinc-500" />
              <input
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar bot..."
                value={query}
              />
            </div>
            <div className="discord-scrollbar max-h-72 overflow-y-auto p-2">
              {filteredBots.map((bot) => (
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-zinc-900",
                    selectedBot?.id === bot.id ? "bg-[#FFD500]/15 ring-1 ring-[#FFD500]/25" : ""
                  )}
                  key={bot.id}
                  onClick={() => {
                    onSelectBot(bot.id);
                    setSelectOpen(false);
                    setQuery("");
                  }}
                  type="button"
                >
                  <Avatar className="h-10 w-10 rounded-xl" fallback={bot.name} src={bot.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{bot.name}</p>
                    <p className="truncate text-xs text-zinc-500">ID: {bot.id}</p>
                  </div>
                  <Badge variant={bot.status === "online" ? "success" : "muted"}>{bot.status === "online" ? "Online" : "Offline"}</Badge>
                </button>
              ))}
              {!filteredBots.length ? (
                <p className="px-3 py-6 text-center text-sm text-zinc-500">Nenhum bot encontrado.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-zinc-900 pt-4 text-xs font-semibold uppercase text-zinc-600">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Configurações do bot
      </div>

      <nav className="discord-scrollbar mt-3 flex-1 space-y-4 overflow-y-auto pb-4">
        {botNavSections.map((section) => (
          <div key={section.id} className="space-y-1">
            <p className="px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-600">{section.label}</p>
            {section.items.map((item) => (
              <button
                className={cn(
                  "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition",
                  activeView === item.id
                    ? "bg-[#FFD500]/15 text-[#FFEA70] ring-1 ring-[#FFD500]/25"
                    : "text-zinc-500 hover:bg-zinc-900/80 hover:text-zinc-100"
                )}
                key={item.id}
                onClick={() => onChangeView(item.id)}
                type="button"
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
