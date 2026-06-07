import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AtSign,
  Bell,
  Bot,
  Brush,
  Code2,
  Film,
  Globe2,
  LockKeyhole,
  Radio,
  ScrollText,
  Settings,
  Shield,
  Ticket,
  UserMinus,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Avatar } from "../ui/avatar";
import type { DashboardBot, DashboardGuild } from "../../types";

export type ViewId =
  | "overview"
  | "settings"
  | "permissions"
  | "modules"
  | "lives"
  | "clips"
  | "network"
  | "x-monitor"
  | "roles"
  | "welcome"
  | "leave"
  | "tickets"
  | "logs"
  | "moderation"
  | "personalization"
  | "dev";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  badge?: string;
  moduleId?: string;
  moduleIds?: string[];
};

export const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Principal",
    items: [{ id: "overview", label: "Visao geral", icon: Activity }]
  },
  {
    label: "Configuracoes",
    items: [
      { id: "settings", label: "Configuracoes", icon: Settings, moduleIds: ["welcome", "leave"] },
      { id: "permissions", label: "Permissoes", icon: LockKeyhole, badge: "2", moduleId: "verification" }
    ]
  },
  {
    label: "Modulos",
    items: [
      { id: "modules", label: "Modulos liberados", icon: Bot, moduleIds: ["live", "clips", "network", "x-monitor", "roles", "tickets", "moderation"] },
      { id: "welcome", label: "Entrada", icon: UserPlus, moduleId: "welcome" },
      { id: "leave", label: "Saida", icon: UserMinus, moduleId: "leave" },
      { id: "lives", label: "Lives", icon: Radio, moduleId: "live" },
      { id: "clips", label: "Clips", icon: Film, moduleId: "clips" },
      { id: "x-monitor", label: "X Monitor", icon: AtSign, moduleId: "x-monitor" },
      { id: "roles", label: "Cargos", icon: Users, moduleId: "roles" },
      { id: "tickets", label: "Tickets", icon: Ticket, moduleId: "tickets" },
      { id: "moderation", label: "Moderacao", icon: Shield, moduleId: "moderation" }
    ]
  },
  {
    label: "Comunidade",
    items: [
      { id: "network", label: "Rede Social", icon: Globe2, moduleId: "network" }
    ]
  },
  {
    label: "Sistema",
    items: [
      { id: "logs", label: "Logs", icon: ScrollText, badge: "!", moduleId: "logs" },
      { id: "personalization", label: "Personalizacao", icon: Brush, moduleId: "avisos" }
    ]
  }
];

const devSection: { label: string; items: NavItem[] } = {
  label: "Bots Devs",
  items: [{ id: "dev", label: "Gerenciar Bots", icon: Code2 }]
};

type SidebarProps = {
  activeView: ViewId;
  bots: DashboardBot[];
  isOpen: boolean;
  server: DashboardGuild | null;
  selectedBotId: string | null;
  showDev: boolean;
  enabledModules: string[];
  showAllModules: boolean;
  onChangeView: (view: ViewId) => void;
  onClose: () => void;
  onSelectBot: (botId: string | null) => void;
};

export function Sidebar({
  activeView,
  bots,
  enabledModules,
  isOpen,
  onChangeView,
  onClose,
  onSelectBot,
  selectedBotId,
  server,
  showAllModules,
  showDev
}: SidebarProps) {
  const enabledModuleSet = new Set(enabledModules);
  const baseSections = showDev ? [...navSections, devSection] : navSections;
  const sections = baseSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (showAllModules || item.id === "overview" || item.id === "dev") {
          return true;
        }

        if (item.moduleId) {
          return enabledModuleSet.has(item.moduleId);
        }

        return Boolean(item.moduleIds?.some((moduleId) => enabledModuleSet.has(moduleId)));
      })
    }))
    .filter((section) => section.items.length > 0);
  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? null;

  function handleChangeView(view: ViewId) {
    onChangeView(view);
    onClose();
  }

  function handleSelectBot(value: string) {
    onSelectBot(value || null);
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
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-zinc-900 bg-[#090909] px-4 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.58)] transition duration-300 lg:z-30 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="mb-5 flex h-12 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Painel de Orviteck Bots</p>
              <p className="truncate text-xs text-zinc-500">Painel administrativo</p>
            </div>
          </div>

          <button
            aria-label="Fechar menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition duration-300 hover:bg-zinc-900 hover:text-white lg:hidden"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-10 w-10 rounded-lg border border-zinc-800" fallback={selectedBot?.name ?? "Bot"} src={selectedBot?.avatarUrl ?? null} />
            <div className="min-w-0">
              <p className="text-xs text-zinc-500">Bot para configurar</p>
              <p className="mt-1 truncate text-sm font-medium text-zinc-100">{selectedBot?.name ?? "Selecione um bot"}</p>
            </div>
          </div>
          <select
            className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
            onChange={(event) => handleSelectBot(event.target.value)}
            value={selectedBot?.id ?? ""}
          >
            <option value="">{bots.length ? "Selecione o bot" : "Nenhum bot cadastrado"}</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
          <p className="truncate text-xs text-zinc-600">
            Servidor: {server?.name ?? "Servidor configurado"}
          </p>
        </div>

        <nav className="discord-scrollbar flex-1 space-y-5 overflow-y-auto pb-4">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase text-zinc-600">{section.label}</p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    className={cn(
                      "group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition duration-300",
                      activeView === item.id
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    )}
                    onClick={() => handleChangeView(item.id)}
                    type="button"
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-700 px-1.5 text-[10px] font-semibold text-white">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="rounded-lg border border-zinc-900 bg-zinc-950 p-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Bell className="h-3.5 w-3.5" />
            <span>3 ajustes pendentes</span>
          </div>
        </div>
      </aside>
    </>
  );
}
