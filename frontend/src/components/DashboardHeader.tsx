import { ShieldCheck } from "lucide-react";
import { BotProfile } from "./BotProfile";
import { ServerSelector } from "./ServerSelector";
import { Badge } from "./ui/badge";
import type { DashboardBot, DashboardMeBot, DashboardMeGuild, DashboardMeUser, DashboardViewMode } from "../types";

type DashboardHeaderProps = {
  bot?: DashboardMeBot | null;
  bots?: DashboardBot[];
  guilds: DashboardMeGuild[];
  loading?: boolean;
  selectedBotId?: string | null;
  selectedGuildId: string | null;
  canSwitchDashboardMode?: boolean;
  dashboardMode?: DashboardViewMode;
  user?: DashboardMeUser | null;
  onChangeDashboardMode?: (mode: DashboardViewMode) => void;
  onSelectBot?: (botId: string | null) => void;
  onSelectGuild: (guildId: string) => void;
};

export function DashboardHeader({
  bot,
  bots = [],
  canSwitchDashboardMode = false,
  dashboardMode = "user",
  guilds,
  loading = false,
  onSelectBot,
  onChangeDashboardMode,
  onSelectGuild,
  selectedBotId,
  selectedGuildId,
  user
}: DashboardHeaderProps) {
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
          {canSwitchDashboardMode ? (
            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-600">Visualizacao exclusiva do Dev</span>
              <select
                className="h-11 w-full rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 text-sm font-medium text-purple-100 outline-none transition duration-300 focus:border-purple-400"
                disabled={loading}
                onChange={(event) => onChangeDashboardMode?.(event.target.value as DashboardViewMode)}
                value={dashboardMode}
              >
                <option value="developer">Dashboard de desenvolvimento</option>
                <option value="user">Dashboard do usuario do bot</option>
              </select>
            </label>
          ) : null}
          <ServerSelector guilds={guilds} loading={loading} onSelectGuild={onSelectGuild} selectedGuildId={selectedGuildId} />
          {bots.length ? (
            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-600">Painel do bot</span>
              <select
                className="h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm font-medium text-zinc-100 outline-none transition duration-300 focus:border-purple-400"
                disabled={loading}
                onChange={(event) => onSelectBot?.(event.target.value || null)}
                value={selectedBotId ?? ""}
              >
                <option value="">Selecione o bot</option>
                {bots.map((panelBot) => (
                  <option key={panelBot.id} value={panelBot.id}>
                    {panelBot.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
