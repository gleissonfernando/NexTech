import { Bot, Menu } from "lucide-react";
import { UserProfile } from "../UserProfile";
import { Badge } from "../ui/badge";
import type { AuthUser, DashboardGuild, DashboardMeUser } from "../../types";

type TopbarProps = {
  user: AuthUser;
  dashboardUser?: DashboardMeUser | null;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  onOpenMenu: () => void;
  onSelectGuild: (guildId: string) => void;
  onLogout: () => void;
};

export function Topbar({ dashboardUser, user, guilds, selectedGuildId, onOpenMenu, onSelectGuild, onLogout }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-[#FFD500]/15 bg-[#050505]/90 px-4 py-3 backdrop-blur lg:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            aria-label="Abrir menu"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/20 bg-zinc-950 text-zinc-200 transition duration-300 hover:bg-[#FFD500]/10 hover:text-[#FFEA70] lg:hidden"
            onClick={onOpenMenu}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/20 bg-zinc-950 text-[#FFEA70] sm:flex lg:hidden">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-white">Dashboard do servidor</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="muted">{guilds.length === 1 ? "1 servidor" : `${guilds.length} servidores`}</Badge>
            </div>
          </div>
        </div>

        <div className="flex w-full min-w-0 items-center gap-3 md:w-auto">
          {guilds.length > 1 ? (
            <select
              className="h-10 min-w-0 flex-1 rounded-lg border border-[#FFD500]/20 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition duration-300 focus:border-[#FFD500]/60 md:max-w-64"
              onChange={(event) => onSelectGuild(event.target.value)}
              value={selectedGuildId ?? ""}
            >
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {guild.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="hidden h-10 min-w-0 max-w-full items-center rounded-lg border border-[#FFD500]/20 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 md:flex md:max-w-64">
              <span className="truncate">{guilds[0]?.name ?? "Servidor configurado"}</span>
            </div>
          )}

          <div className="hidden md:block">
            <UserProfile dashboardUser={dashboardUser} onLogout={onLogout} user={user} />
          </div>
          <div className="md:hidden">
            <UserProfile compact dashboardUser={dashboardUser} onLogout={onLogout} user={user} />
          </div>
        </div>
      </div>
    </header>
  );
}
