import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  Bell,
  AtSign,
  Bot,
  Building2,
  ChevronLeft,
  ChevronRight,
  Film,
  Gift,
  Hash,
  ListChecks,
  LockKeyhole,
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
  Search,
  Server,
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
  | "lives"
  | "clips"
  | "kick-clips"
  | "giveaway"
  | "x-monitor"
  | "moderation"
  | "rules"
  | "mission-tools"
  | "voice-recorder"
  | "music"
  | "self-bot-protection"
  | "security"
  | "anti-ban"
  | "suspicious-servers"
  | "global-blacklist"
  | "advanced-permissions"
  | "invite-cleanup"
  | "server-backup"
  | "vanity-url-protection"
  | "hide-empty-voice"
  | "auto-unmute"
  | "temporary-voice"
  | "tag-verification"
  | "bio-url-verification"
  | "first-lady"
  | "permissions"
  | "logs"
  | "fivem"
  | "notifications"
  | "entry-leave"
  | "auto-roles"
  | "application-emojis"
  | "media-library"
  | "server-cloner"
  | "settings";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  moduleId?: string;
  moduleIds?: string[];
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
  { id: "mission-tools", label: "Mission Tools", icon: ListChecks, moduleId: "mission-tools" },
  { id: "voice-recorder", label: "Voice Recorder", icon: Mic2, moduleId: "voice-recorder" },
  { id: "music", label: "Música", icon: Music2, moduleId: "music" },
  { id: "self-bot-protection", label: "SelfBot Protection", icon: ShieldCheck, moduleId: "safe-bot" },
  { id: "security", label: "Seguranca", icon: ShieldAlert, moduleId: "account-age-security" },
  { id: "anti-ban", label: "Anti Ban", icon: ShieldCheck, moduleId: "anti-ban" },
  { id: "suspicious-servers", label: "Servidores Suspeitos", icon: Search, moduleId: "suspicious-servers" },
  { id: "global-blacklist", label: "Blacklist Global", icon: LockKeyhole, moduleId: "global-blacklist" },
  { id: "advanced-permissions", label: "Permissões Avançadas", icon: SlidersHorizontal, moduleId: "advanced-permissions" },
  { id: "invite-cleanup", label: "Limpeza de Convites", icon: UserMinus, moduleId: "invite-cleanup" },
  { id: "server-backup", label: "Backup", icon: Server, moduleId: "server-backup" },
  { id: "vanity-url-protection", label: "URL Personalizada", icon: ChevronRight, moduleId: "vanity-url-protection" },
  { id: "hide-empty-voice", label: "Chamadas Vazias", icon: Mic2, moduleId: "hide-empty-voice" },
  { id: "auto-unmute", label: "Auto Desmutar", icon: Mic2, moduleId: "auto-unmute" },
  { id: "temporary-voice", label: "Chamadas Temporarias", icon: Users, moduleId: "temporary-voice" },
  { id: "tag-verification", label: "Verificação de Tag", icon: Hash, moduleId: "tag-verification" },
  { id: "bio-url-verification", label: "URL na Bio", icon: AtSign, moduleId: "bio-url-verification" },
  { id: "first-lady", label: "Primeira Dama", icon: UserPlus, moduleId: "first-lady" },
  { id: "permissions", label: "Usuarios", icon: Users, moduleId: "verification" },
  { id: "logs", label: "Logs", icon: ScrollText, moduleId: "logs" },
  { id: "fivem", label: "FiveM", icon: Building2, moduleIds: ["fivem", "fivem-factions", "fivem-corporations", "fivem-absences", "fivem-orders", "fivem-ammo", "fivem-finance", "fivem-fac"] },
  { id: "notifications", label: "Notificações", icon: Bell },
  { id: "entry-leave", label: "Entrada/Saida", icon: UserPlus, moduleIds: ["welcome", "leave"] },
  { id: "auto-roles", label: "Cargos automaticos", icon: Users, moduleId: "roles" },
  { id: "media-library", label: "Emojis & Sons", icon: Archive, moduleId: "emoji-cloner" },
  { id: "server-cloner", label: "Clonagem", icon: SmilePlus, moduleIds: ["emoji-cloner", "server-cloner"] },
  { id: "settings", label: "Configurações", icon: Settings, moduleIds: ["tickets", "avisos", "network", "server-generator"] }
];

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
    if (item.id === "overview" || item.id === "notifications") {
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
          "fixed inset-y-0 left-0 z-50 flex w-20 flex-col border-r border-zinc-900 bg-[#070708] px-3 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.58)] transition duration-300 lg:z-30 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="mb-5 flex h-12 items-center justify-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/15 text-purple-100 shadow-[0_0_30px_rgba(168,85,247,0.18)]">
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
              "group flex h-12 w-12 items-center justify-center rounded-2xl text-zinc-400 transition duration-300 hover:rounded-xl hover:bg-purple-500/15 hover:text-white",
              selectedBot ? "bg-purple-500/20 text-white ring-1 ring-purple-500/25" : "bg-zinc-900/70"
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
                  ? "bg-purple-500/20 text-white ring-1 ring-purple-500/25"
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
    if (item.id === "overview" || item.id === "notifications") return true;
    if (item.moduleId) return enabledModuleSet.has(item.moduleId);
    return Boolean(item.moduleIds?.some((moduleId) => enabledModuleSet.has(moduleId)));
  });

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
        "fixed inset-y-0 left-20 z-40 flex w-80 flex-col border-r border-purple-500/15 bg-[#0b0b0e]/95 px-4 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.45)] backdrop-blur-xl transition duration-300 lg:z-30",
        isMainOpen ? "translate-x-0" : "-translate-x-[26rem] lg:translate-x-0"
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            <Avatar className="h-12 w-12 rounded-2xl border border-purple-500/30" fallback={selectedBot?.name ?? "Bot"} src={selectedBot?.avatarUrl} />
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
          className="flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-left transition hover:border-purple-500/30"
          onClick={() => setSelectOpen((current) => !current)}
          type="button"
        >
          <span className="min-w-0 truncate text-sm text-zinc-200">{selectedBot?.name ?? "Selecione um bot"}</span>
          <ChevronRight className={cn("h-4 w-4 text-zinc-500 transition", selectOpen ? "rotate-90" : "")} />
        </button>

        {selectOpen ? (
          <div className="absolute left-0 right-0 top-14 z-50 overflow-hidden rounded-lg border border-purple-500/20 bg-[#101013] shadow-2xl">
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
                    selectedBot?.id === bot.id ? "bg-purple-500/15 ring-1 ring-purple-500/20" : ""
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

      <nav className="discord-scrollbar mt-3 flex-1 space-y-1 overflow-y-auto pb-4">
        {botNavItems.map((item) => (
          <button
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition",
              activeView === item.id
                ? "bg-purple-500/15 text-white ring-1 ring-purple-500/25"
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
      </nav>
    </aside>
  );
}
