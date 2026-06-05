import { LogOut } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { AuthUser, DashboardGuild } from "../../types";

type TopbarProps = {
  user: AuthUser;
  guilds: DashboardGuild[];
  selectedGuildId: string | null;
  onSelectGuild: (guildId: string) => void;
  onLogout: () => void;
};

export function Topbar({ user, guilds, selectedGuildId, onSelectGuild, onLogout }: TopbarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-background/78 px-4 py-3 backdrop-blur lg:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-foreground">Painel do Bot</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="success">OAuth2 Discord</Badge>
            <Badge variant="muted">{guilds.length} servidores</Badge>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <select
            className="h-10 max-w-[46vw] rounded-lg border border-border bg-muted px-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring md:max-w-64"
            onChange={(event) => onSelectGuild(event.target.value)}
            value={selectedGuildId ?? ""}
          >
            {guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>

          <div className="hidden items-center gap-2 rounded-lg bg-muted px-2 py-1.5 md:flex">
            <Avatar fallback={user.username} src={user.avatar} />
            <div className="min-w-0 pr-1">
              <p className="max-w-36 truncate text-sm font-medium">{user.username}</p>
              <p className="truncate text-xs text-muted-foreground">Admin</p>
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
