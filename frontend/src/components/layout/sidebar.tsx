import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AtSign,
  Bot,
  Building2,
  Film,
  Gift,
  ImageOff,
  LockKeyhole,
  Radio,
  ScrollText,
  Settings,
  Shield,
  X
} from "lucide-react";
import { cn } from "../../lib/utils";

export type ViewId =
  | "overview"
  | "lives"
  | "clips"
  | "kick-clips"
  | "giveaway"
  | "x-monitor"
  | "moderation"
  | "image-anti-spam"
  | "permissions"
  | "logs"
  | "fivem"
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
  { id: "moderation", label: "Moderacao", icon: Shield, moduleId: "moderation" },
  { id: "image-anti-spam", label: "Anti-Spam de Imagens", icon: ImageOff, moduleId: "image-anti-spam" },
  { id: "permissions", label: "Permissoes", icon: LockKeyhole, moduleId: "verification" },
  { id: "logs", label: "Logs", icon: ScrollText, moduleId: "logs" },
  { id: "fivem", label: "FiveM", icon: Building2, moduleIds: ["fivem", "fivem-fac"] },
  { id: "settings", label: "Configuracoes", icon: Settings, moduleIds: ["welcome", "leave", "roles", "tickets", "avisos", "network"] }
];

type SidebarProps = {
  activeView: ViewId;
  enabledModules: string[];
  isOpen: boolean;
  onChangeView: (view: ViewId) => void;
  onClose: () => void;
};

export function Sidebar({
  activeView,
  enabledModules,
  isOpen,
  onChangeView,
  onClose
}: SidebarProps) {
  const enabledModuleSet = new Set(enabledModules);
  const visibleItems = navItems.filter((item) => {
    if (item.id === "overview") {
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
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-zinc-900 bg-[#090909] px-4 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.58)] transition duration-300 lg:z-30 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="mb-5 flex h-12 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-100">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Painel do bot</p>
              <p className="truncate text-xs text-zinc-500">Configuracoes do servidor</p>
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

        <nav className="discord-scrollbar flex-1 space-y-1 overflow-y-auto pb-4">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              className={cn(
                "group flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition duration-300",
                activeView === item.id
                  ? "bg-purple-500/15 text-white ring-1 ring-purple-500/25"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
              )}
              onClick={() => handleChangeView(item.id)}
              type="button"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}
