import { Bot, LogOut, Menu } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { AuthUser, DashboardGuild } from "../../types";

type TopbarProps = {
  user: AuthUser;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  onOpenMenu: () => void;
  onSelectGuild: (guildId: string) => void;
  onLogout: () => void;
};

export function Topbar({ user, guilds, selectedGuildId, onOpenMenu, onSelectGuild, onLogout }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-900 bg-[#050505]/90 px-4 py-3 backdrop-blur lg:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            aria-label="Abrir menu"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200 transition duration-300 hover:bg-zinc-900 hover:text-white lg:hidden"
            onClick={onOpenMenu}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-white sm:flex lg:hidden">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-white">Discord Control</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="muted">OAuth2</Badge>
              <Badge variant="muted">{guilds.length} servidores</Badge>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <select
            className="h-10 max-w-[46vw] rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition duration-300 focus:border-zinc-600 md:max-w-64"
            onChange={(event) => onSelectGuild(event.target.value)}
            value={selectedGuildId ?? ""}
          >
            {guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>

          <div className="hidden items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 md:flex">
            <Avatar fallback={user.username} src={user.avatar} />
            <div className="min-w-0 pr-1">
              <p className="max-w-36 truncate text-sm font-medium text-zinc-100">{user.username}</p>
              <p className="truncate text-xs text-zinc-500">{user.discordId}</p>
              <p className="truncate text-[11px] text-zinc-600">{formatDateTime(user.lastLoginAt)}</p>
            </div>
          </div>

          <Button aria-label="Sair" onClick={onLogout} size="icon" title="Sair" variant="ghost">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
