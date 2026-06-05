import type { LucideIcon } from "lucide-react";
import { Activity, Bot, Radio, ScrollText, Settings, Shield, Ticket, Users } from "lucide-react";
import { cn } from "../../lib/utils";

export type ViewId = "overview" | "lives" | "roles" | "welcome" | "tickets" | "logs" | "moderation" | "settings";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { id: "overview", label: "Dashboard", icon: Activity },
  { id: "lives", label: "Lives", icon: Radio },
  { id: "roles", label: "Cargos", icon: Users },
  { id: "welcome", label: "Boas-vindas", icon: Bot },
  { id: "tickets", label: "Tickets", icon: Ticket },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "moderation", label: "Moderacao", icon: Shield },
  { id: "settings", label: "Settings", icon: Settings }
];

type SidebarProps = {
  activeView: ViewId;
  onChangeView: (view: ViewId) => void;
};

export function Sidebar({ activeView, onChangeView }: SidebarProps) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 bg-[#1e1f22]/95 px-3 py-4 backdrop-blur lg:block">
        <div className="mb-6 flex h-12 items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Discord Control</p>
            <p className="truncate text-xs text-muted-foreground">Dashboard</p>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition",
                activeView === item.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => onChangeView(item.id)}
              type="button"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-[#1e1f22]/95 p-2 backdrop-blur lg:hidden">
        {navItems.slice(0, 8).map((item) => (
          <button
            key={item.id}
            className={cn(
              "flex h-12 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition",
              activeView === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            onClick={() => onChangeView(item.id)}
            type="button"
          >
            <item.icon className="h-4 w-4" />
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
