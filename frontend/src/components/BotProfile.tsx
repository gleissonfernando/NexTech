import { Bot, CheckCircle2, XCircle } from "lucide-react";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import type { DashboardMeBot, DashboardMeGuild } from "../types";

type BotProfileProps = {
  bot?: DashboardMeBot | null;
  selectedGuild?: DashboardMeGuild | null;
  loading?: boolean;
};

export function BotProfile({ bot, loading = false, selectedGuild }: BotProfileProps) {
  if (loading) {
    return (
      <Card className="border-purple-500/20">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="h-14 w-14 animate-pulse rounded-full bg-zinc-800" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-52 animate-pulse rounded bg-zinc-900" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const connected = bot?.connected === true;
  const botName = bot?.username ?? "Bot Discord";

  return (
    <Card className="border-purple-500/20 bg-zinc-950/75">
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar
            className="h-14 w-14 rounded-full border border-red-500/70 shadow-[0_0_22px_rgba(239,68,68,0.35)]"
            fallback={botName}
            src={bot?.avatarUrl}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-white">{botName}</h3>
              <Badge variant={connected ? "success" : "danger"}>
                {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {connected ? "Bot conectado" : "Bot nao conectado"}
              </Badge>
            </div>
            <p className="mt-1 truncate text-sm text-zinc-500">{bot?.id ? `ID ${bot.id}` : "Verifique o token ou instalacao no servidor."}</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-800 bg-black/35 px-3 py-2">
          {selectedGuild ? (
            <Avatar className="h-9 w-9 rounded-lg border border-zinc-800" fallback={selectedGuild.name} src={selectedGuild.iconUrl} />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300">
              <Bot className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">Servidor atual</p>
            <p className="truncate text-sm font-medium text-zinc-100">{selectedGuild?.name ?? "Nenhum servidor selecionado"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const BotProfileCard = BotProfile;
export const BotHeaderCard = BotProfile;
