import { ShieldCheck } from "lucide-react";
import { BotProfile } from "./BotProfile";
import { ServerSelector } from "./ServerSelector";
import { Badge } from "./ui/badge";
import type { DashboardMeBot, DashboardMeGuild, DashboardMeUser } from "../types";

type DashboardHeaderProps = {
  bot?: DashboardMeBot | null;
  guilds: DashboardMeGuild[];
  loading?: boolean;
  selectedGuildId: string | null;
  user?: DashboardMeUser | null;
  onSelectGuild: (guildId: string) => void;
};

export function DashboardHeader({ bot, guilds, loading = false, onSelectGuild, selectedGuildId, user }: DashboardHeaderProps) {
  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId) ?? guilds[0] ?? null;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <BotProfile bot={bot} loading={loading} selectedGuild={selectedGuild} />
        <div className="space-y-3 rounded-lg border border-zinc-900 bg-[#0b0b0b]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-zinc-600">OAuth2</p>
              <p className="truncate text-sm font-semibold text-zinc-100">{user?.globalName ?? user?.username ?? "Carregando usuario"}</p>
            </div>
            <Badge variant="muted">
              <ShieldCheck className="h-3.5 w-3.5" />
              Verificado
            </Badge>
          </div>
          <ServerSelector guilds={guilds} loading={loading} onSelectGuild={onSelectGuild} selectedGuildId={selectedGuildId} />
        </div>
      </div>

      {bot && !bot.connected ? (
        <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          Bot nao conectado. Verifique o token ou instalacao no servidor.
        </div>
      ) : null}
    </section>
  );
}
