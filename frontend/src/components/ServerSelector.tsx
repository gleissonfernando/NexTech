import { ChevronDown, Server } from "lucide-react";
import { Avatar } from "./ui/avatar";
import type { DashboardMeGuild } from "../types";

type ServerSelectorProps = {
  guilds: DashboardMeGuild[];
  selectedGuildId: string | null;
  loading?: boolean;
  onSelectGuild: (guildId: string) => void;
};

export function ServerSelector({ guilds, loading = false, onSelectGuild, selectedGuildId }: ServerSelectorProps) {
  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId) ?? guilds[0] ?? null;

  if (loading) {
    return <div className="h-14 animate-pulse rounded-lg border border-zinc-900 bg-zinc-950/70" />;
  }

  if (guilds.length > 1) {
    return (
      <label className="relative block">
        <span className="sr-only">Selecionar servidor</span>
        <select
          className="h-14 w-full appearance-none rounded-lg border border-purple-500/25 bg-zinc-950 px-14 pr-10 text-sm font-medium text-zinc-100 outline-none transition duration-300 hover:border-purple-400/45 focus:border-purple-400"
          onChange={(event) => onSelectGuild(event.target.value)}
          value={selectedGuildId ?? ""}
        >
          {guilds.map((guild) => (
            <option key={guild.id} value={guild.id}>
              {guild.name}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
          <GuildAvatar guild={selectedGuild} />
        </div>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      </label>
    );
  }

  return (
    <div className="flex h-14 min-w-0 items-center gap-3 rounded-lg border border-purple-500/25 bg-zinc-950 px-3 transition duration-300 hover:border-purple-400/45">
      <GuildAvatar guild={selectedGuild} />
      <div className="min-w-0">
        <p className="text-xs text-zinc-500">Servidor</p>
        <p className="truncate text-sm font-medium text-zinc-100">{selectedGuild?.name ?? "Servidor configurado"}</p>
      </div>
    </div>
  );
}

function GuildAvatar({ guild }: { guild: DashboardMeGuild | null }) {
  if (!guild) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 bg-black text-zinc-400">
        <Server className="h-4 w-4" />
      </div>
    );
  }

  return (
    <Avatar
      className="h-9 w-9 rounded-full border border-purple-400/60 shadow-[0_0_16px_rgba(168,85,247,0.25)]"
      fallback={guild.name}
      src={guild.iconUrl}
    />
  );
}
