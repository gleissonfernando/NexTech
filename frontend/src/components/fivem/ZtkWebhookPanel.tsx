import { useEffect, useMemo, useState } from "react";
import { Award, BarChart3, CalendarClock, Clipboard, Clock3, Crown, Gift, Link2, Loader2, Megaphone, RefreshCw, Save, Search, Settings, Sparkles, Trophy, Trash2, UserPlus, Users, X } from "lucide-react";
import {
  createZtkReward,
  createZtkWebhookClan,
  getGuildLiveOptions,
  getZtkWebhookDashboard,
  saveZtkWebhookClan,
  updateZtkWebhookState
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild, GuildChannelOption, SaveZtkRewardPayload, SaveZtkWebhookClanPayload, ZtkRankingType, ZtkWebhookClan, ZtkWebhookDashboard } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

type TabId = "ranking" | "topDominations" | "recruitment" | "webhook" | "rewards" | "channels" | "stats" | "settings";

const tabs: Array<{ id: TabId; icon: typeof Trophy; label: string }> = [
  { id: "ranking", icon: Trophy, label: "Ranking" },
  { id: "topDominations", icon: Trophy, label: "Top Dominações" },
  { id: "recruitment", icon: UserPlus, label: "Recrutamento" },
  { id: "webhook", icon: Link2, label: "Webhook" },
  { id: "rewards", icon: Gift, label: "Premiação" },
  { id: "channels", icon: Megaphone, label: "Canais" },
  { id: "stats", icon: BarChart3, label: "Estatísticas" },
  { id: "settings", icon: Settings, label: "Configurações" }
];

const rankingLabels: Record<ZtkRankingType, string> = {
  domination: "Dominação",
  online: "Online",
  recruitment: "Recrutamento"
};
const ZTK_RANKING_LIMIT = 10;
type ZtkRecruiterRankingItem = ZtkWebhookDashboard["recruitmentRankings"]["recruiters"][number];

export function ZtkWebhookPanel({ botId, canManage, guild }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("ranking");
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [clanDraft, setClanDraft] = useState("Cortez");
  const [dashboard, setDashboard] = useState<ZtkWebhookDashboard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedClanId, setSelectedClanId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rewardDraft, setRewardDraft] = useState<SaveZtkRewardPayload>({
    name: "Premiação Mensal",
    rankingType: "domination",
    rewardDate: new Date().toISOString().slice(0, 10),
    winners: [
      { place: 1, value: "R$100" },
      { place: 2, value: "R$50" },
      { place: 3, value: "R$25" }
    ]
  });

  const selectedClan = useMemo(() => (
    dashboard?.clans.find((clan) => clan.id === selectedClanId) ?? dashboard?.selectedClan ?? dashboard?.clans[0] ?? null
  ), [dashboard, selectedClanId]);
  const stats = useMemo(() => buildStats(dashboard), [dashboard]);

  useEffect(() => {
    if (!botId || !guild) return;
    let active = true;
    setMessage(null);
    setSavingKey("loading");
    Promise.all([getZtkWebhookDashboard(botId, guild.id), getGuildLiveOptions(guild.id, botId)])
      .then(([data, options]) => {
        if (!active) return;
        setDashboard(data);
        setSelectedClanId(data.selectedClan?.id ?? data.clans[0]?.id ?? null);
        setChannels(options.channels ?? []);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(errorMessage(error, "Não foi possível carregar o ZTK Webhook."));
      })
      .finally(() => {
        if (active) setSavingKey(null);
      });
    return () => {
      active = false;
    };
  }, [botId, guild]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const reload = (payload: { botId?: string | null; guildId?: string | null }) => {
      if (payload.botId && payload.botId !== botId) return;
      if (payload.guildId !== guild.id) return;
      void refresh();
    };
    socket.on("ztk-webhook:event_received", reload);
    socket.on("ztk-webhook:reward_updated", reload);
    return () => {
      socket.disconnect();
    };
  }, [botId, guild, selectedClanId]);

  async function refresh() {
    if (!botId || !guild) return;
    const data = await getZtkWebhookDashboard(botId, guild.id, selectedClanId);
    setDashboard(data);
    setSelectedClanId((current) => current ?? data.selectedClan?.id ?? data.clans[0]?.id ?? null);
  }

  async function selectClan(clanId: string) {
    if (!botId || !guild) return;
    setSelectedClanId(clanId);
    setSavingKey("loading");
    try {
      setDashboard(await getZtkWebhookDashboard(botId, guild.id, clanId));
    } catch (error) {
      setMessage(errorMessage(error, "Não foi possível carregar o clã selecionado."));
    } finally {
      setSavingKey(null);
    }
  }

  async function run<T>(key: string, action: () => Promise<T>, success: string) {
    setSavingKey(key);
    setMessage(null);
    try {
      const result = await action();
      setMessage(success);
      await refresh();
      return result;
    } catch (error) {
      setMessage(errorMessage(error, "Falha ao executar a ação."));
      return null;
    } finally {
      setSavingKey(null);
    }
  }

  async function createClan() {
    if (!botId || !guild) return;
    const created = await run("create-clan", () => createZtkWebhookClan(botId, guild.id, { clanName: clanDraft }), "Clã ZTK criado.");
    if (created) setSelectedClanId(created.id);
  }

  async function saveClanPatch(patch: SaveZtkWebhookClanPayload, key = "save-clan") {
    if (!botId || !guild || !selectedClan) return;
    await run(key, () => saveZtkWebhookClan(botId, guild.id, selectedClan.id, patch), "Configuração salva.");
  }

  async function changeWebhook(action: "create" | "delete" | "disable" | "regenerate") {
    if (!botId || !guild || !selectedClan) return;
    await run(`webhook-${action}`, () => updateZtkWebhookState(botId, guild.id, selectedClan.id, action), "Webhook atualizada.");
  }

  async function saveReward() {
    if (!botId || !guild || !selectedClan) return;
    await run("reward", () => createZtkReward(botId, guild.id, selectedClan.id, rewardDraft), "Premiação criada.");
  }

  if (!botId || !guild) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ZTK Webhook 🏆</CardTitle>
          <CardDescription>Selecione um bot e um servidor para configurar o módulo FiveM.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>ZTK Webhook 🏆</CardTitle>
              <CardDescription>Ranking automático, logs FiveM e premiações por clã.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={selectedClan?.active && isDiscordWebhookUrl(selectedClan.webhookUrl) ? "success" : "muted"}>{selectedClan?.active && isDiscordWebhookUrl(selectedClan.webhookUrl) ? "Monitorando" : "Inativo"}</Badge>
              <Button disabled={savingKey !== null} onClick={() => void refresh()} size="sm" variant="secondary">
                {savingKey === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Atualizar
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <select
              className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={!dashboard?.clans.length}
              onChange={(event) => void selectClan(event.target.value)}
              value={selectedClan?.id ?? ""}
            >
              {dashboard?.clans.map((clan) => <option key={clan.id} value={clan.id}>{clan.clanName}</option>)}
              {!dashboard?.clans.length ? <option value="">Nenhum clã criado</option> : null}
            </select>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {tabs.map((tab) => (
                <button
                  className={`flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${activeTab === tab.id ? "border-[#FFD500]/45 bg-[#FFD500]/15 text-[#FFEA70]" : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100"}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-md border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-3 text-sm text-[#FFEA70]">{message}</div> : null}

      {!selectedClan ? (
        <Card>
          <CardHeader>
            <CardTitle>Criar clã</CardTitle>
            <CardDescription>Cada usuário ou clã recebe uma webhook individual e isolada.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setClanDraft(event.target.value)} value={clanDraft} />
            <Button disabled={!canManage && Boolean(dashboard?.clans.length) || savingKey !== null || !clanDraft.trim()} onClick={() => void createClan()}>
              {savingKey === "create-clan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Criar webhook
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {selectedClan && activeTab === "ranking" ? <RankingView dashboard={dashboard} selectedClan={selectedClan} stats={stats} /> : null}
      {selectedClan && activeTab === "topDominations" ? <TopDominationsView dashboard={dashboard} selectedClan={selectedClan} /> : null}
      {selectedClan && activeTab === "recruitment" ? <RecruitmentView dashboard={dashboard} selectedClan={selectedClan} /> : null}
      {selectedClan && activeTab === "webhook" ? (
        <WebhookView
          canManage={canManage}
          clan={selectedClan}
          onCopy={() => {
            if (selectedClan.webhookUrl) void navigator.clipboard.writeText(selectedClan.webhookUrl);
            setMessage("Webhook copiada.");
          }}
          onRegisterManual={(url) => saveClanPatch({ discordWebhookUrl: url }, "manual-webhook")}
          onWebhookAction={changeWebhook}
          savingKey={savingKey}
        />
      ) : null}
      {selectedClan && activeTab === "channels" ? <ChannelsView canManage={canManage} channels={channels} clan={selectedClan} onSave={saveClanPatch} savingKey={savingKey} /> : null}
      {selectedClan && activeTab === "rewards" ? <RewardsView canManage={canManage} dashboard={dashboard} draft={rewardDraft} onDraft={setRewardDraft} onSave={saveReward} saving={savingKey === "reward"} /> : null}
      {selectedClan && activeTab === "stats" ? <StatsView dashboard={dashboard} stats={stats} /> : null}
      {selectedClan && activeTab === "settings" ? (
        <SettingsView
          canManage={canManage}
          clan={selectedClan}
          onSave={saveClanPatch}
          savingKey={savingKey}
        />
      ) : null}
    </div>
  );
}

function RankingView({ dashboard, selectedClan, stats }: { dashboard: ZtkWebhookDashboard | null; selectedClan: ZtkWebhookClan; stats: ReturnType<typeof buildStats> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>🏆 Ranking {selectedClan.clanName}</CardTitle>
            <CardDescription>Top 10 de dominações atualizado pelas logs recebidas do FiveM.</CardDescription>
          </CardHeader>
          <CardContent>
            <GangRankingList values={dashboard?.dominationRankings.gangs ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resumo Atual</CardTitle>
            <CardDescription>Totais do clã selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Metric label="Clã" value={selectedClan.clanName} />
            <Metric label="Dominações" value={String(stats.dominations)} />
            <Metric label="Recrutamentos" value={String(stats.recruitments)} />
            <Metric label="Online" value={`${Math.floor(stats.onlineSeconds / 3600)} horas`} />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>⏱ Online — Todos</CardTitle>
            <CardDescription>Painel separado para tempo online do clã.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankingList title="⏱ Online — Todos" valueLabel="horas" values={dashboard?.rankings.online ?? []} valueOf={(item) => Math.floor(item.onlineSeconds / 3600)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TopDominationsView({ dashboard, selectedClan }: { dashboard: ZtkWebhookDashboard | null; selectedClan: ZtkWebhookClan }) {
  const [playerQuery, setPlayerQuery] = useState("");
  const [clanFilter, setClanFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState<"today" | "week" | "month" | "total">("total");
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const ranking = dashboard?.dominationRankings.participants ?? [];
  const dominationStats = dashboard?.dominationRankings.stats;
  const clanOptions = useMemo(() => [...new Set(ranking.map((item) => item.gangName).filter((value): value is string => Boolean(value)))], [ranking]);
  const filtered = useMemo(() => ranking.filter((item) => {
    const playerOk = !playerQuery.trim() || normalizeSearch(item.playerName).includes(normalizeSearch(playerQuery));
    const clanOk = !clanFilter || item.gangName === clanFilter;
    return playerOk && clanOk;
  }).sort((a, b) => rankingPeriodValue(b, periodFilter) - rankingPeriodValue(a, periodFilter) || a.playerName.localeCompare(b.playerName)).slice(0, ZTK_RANKING_LIMIT), [clanFilter, periodFilter, playerQuery, ranking]);
  const activePlayer = filtered.find((item) => item.normalizedPlayerName === selectedPlayer || item.playerId === selectedPlayer) ?? filtered[0] ?? null;
  const playerLogs = (dashboard?.logs ?? []).filter((log) => (
    log.eventType === "domination"
    && log.participants?.some((participant) => participant.normalizedName === activePlayer?.normalizedPlayerName || participant.id === activePlayer?.playerId)
    && periodAllows(log.eventTimestamp, periodFilter)
  ));

  useEffect(() => {
    if (!activePlayer) {
      setSelectedPlayer(null);
      return;
    }
    const key = activePlayer.playerId ?? activePlayer.normalizedPlayerName;
    setSelectedPlayer((current) => current && filtered.some((item) => (item.playerId ?? item.normalizedPlayerName) === current) ? current : key);
  }, [activePlayer?.normalizedPlayerName, activePlayer?.playerId, filtered]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader>
          <CardTitle>Ranking de Dominações</CardTitle>
          <CardDescription>Competição interna do clã {selectedClan.clanName}, usando apenas logs recebidas nesta webhook.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Hoje" value={String(dominationStats?.todayTotal ?? 0)} />
            <Metric label="Semana" value={String(dominationStats?.weekTotal ?? 0)} />
            <Metric label="Mês" value={String(dominationStats?.monthTotal ?? 0)} />
            <Metric label="Total geral" value={String(dominationStats?.total ?? 0)} />
            <Metric label="Membro líder" value={dominationStats?.leaderName ?? "Sem dados"} />
            <Metric label="Média diária" value={String(dominationStats?.averageDaily ?? 0)} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Pesquisar jogador" value={playerQuery} />
            <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setClanFilter(event.target.value)} value={clanFilter}>
              <option value="">Todos os registros do clã</option>
              {clanOptions.map((clan) => <option key={clan} value={clan}>{clan}</option>)}
            </select>
            <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setPeriodFilter(event.target.value as typeof periodFilter)} value={periodFilter}>
              <option value="total">Total</option>
              <option value="today">Hoje</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
            </select>
          </div>
          <ParticipantRankingList onSelect={(item) => setSelectedPlayer(item.playerId ?? item.normalizedPlayerName)} period={periodFilter} selectedKey={activePlayer?.playerId ?? activePlayer?.normalizedPlayerName ?? null} values={filtered} />
          <DailyDominationsChart values={dominationStats?.dailySeries ?? []} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Histórico Individual</CardTitle>
          <CardDescription>Últimas dominações do membro selecionado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {activePlayer ? (
            <>
              <Metric label="Jogador" value={activePlayer.playerName} />
              <Metric label="Clã atual" value={activePlayer.gangName ?? selectedClan.clanName} />
              <Metric label="Total de dominações" value={String(activePlayer.participations)} />
              <Metric label="Primeira dominação" value={activePlayer.firstDominatedAt ? formatDateTime(activePlayer.firstDominatedAt) : "Sem registro"} />
              <Metric label="Última dominação" value={activePlayer.lastDominatedAt ? `${activePlayer.lastZone ?? "Local não informado"} • ${formatDateTime(activePlayer.lastDominatedAt)}` : "Sem registro"} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="No filtro" value={String(rankingPeriodValue(activePlayer, periodFilter))} />
                <Metric label="Semana" value={String(activePlayer.weeklyDominations)} />
                <Metric label="Mês" value={String(activePlayer.monthlyDominations)} />
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                <p className="mb-3 text-sm font-semibold text-zinc-100">Histórico</p>
                <div className="discord-scrollbar max-h-[24rem] space-y-3 overflow-y-auto pr-1">
                  {playerLogs.map((log) => (
                    <div className="text-sm text-zinc-300" key={log.id}>
                      <p className="font-semibold text-zinc-100">{log.location ?? "Local não informado"}</p>
                      <p className="text-zinc-500">{formatDateTime(log.eventTimestamp)}</p>
                    </div>
                  ))}
                  {!playerLogs.length ? <p className="text-sm text-zinc-500">Nenhuma dominação encontrada no período selecionado.</p> : null}
                </div>
              </div>
            </>
          ) : <p className="text-sm text-zinc-500">Nenhum membro encontrado.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function RecruitmentView({ dashboard, selectedClan }: { dashboard: ZtkWebhookDashboard | null; selectedClan: ZtkWebhookClan }) {
  const [recruiterQuery, setRecruiterQuery] = useState("");
  const [recruitedQuery, setRecruitedQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedRecruiter, setSelectedRecruiter] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<"today" | "week" | "month" | "total">("total");

  const recruiters = dashboard?.recruitmentRankings.recruiters ?? [];
  const recruitmentLogs = (dashboard?.logs ?? []).filter((log) => log.eventType === "recruitment" && log.recruiterName && log.playerName);
  const stats = dashboard?.recruitmentRankings.stats ?? emptyRecruitmentStats();
  const filtered = useMemo(() => recruiters.filter((item) => {
    const recruiterOk = !recruiterQuery.trim() || normalizeSearch(item.recruiterName).includes(normalizeSearch(recruiterQuery));
    const recruitedOk = !recruitedQuery.trim() || item.recentRecruits.some((recruit) => normalizeSearch(recruit.recruitedName).includes(normalizeSearch(recruitedQuery)));
    const dateOk = !dateFilter || item.recentRecruits.some((recruit) => recruit.recruitedAt.slice(0, 10) === dateFilter);
    return recruiterOk && recruitedOk && dateOk;
  }).sort((a, b) => recruitmentPeriodValue(b, periodFilter) - recruitmentPeriodValue(a, periodFilter) || a.recruiterName.localeCompare(b.recruiterName)), [dateFilter, periodFilter, recruitedQuery, recruiterQuery, recruiters]);
  const leader = recruiters[0] ?? null;
  const selectedRecruiterData = recruiters.find((item) => item.normalizedRecruiterName === selectedRecruiter) ?? null;
  const maxRecruitments = Math.max(1, ...filtered.map((item) => recruitmentPeriodValue(item, periodFilter)), leader ? recruitmentPeriodValue(leader, periodFilter) : 0);
  const profileHistory = selectedRecruiterData ? recruiterHistory(selectedRecruiterData, recruitmentLogs, periodFilter, recruitedQuery, dateFilter) : [];
  const timeline = recruitmentLogs
    .filter((log) => periodAllows(log.eventTimestamp, periodFilter))
    .sort((a, b) => new Date(b.eventTimestamp).getTime() - new Date(a.eventTimestamp).getTime())
    .slice(0, 12);
  const averageDaily = stats.dailySeries.length ? Math.round((stats.total / stats.dailySeries.length) * 10) / 10 : stats.total;

  useEffect(() => {
    if (!selectedRecruiter) return;
    if (!recruiters.some((item) => item.normalizedRecruiterName === selectedRecruiter)) {
      setSelectedRecruiter(null);
    }
  }, [recruiters, selectedRecruiter]);

  if (!dashboard) return <RecruitmentSkeleton />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-md border border-[#FFD500]/35 bg-[linear-gradient(135deg,rgba(255,213,0,0.26),rgba(24,24,27,0.92)_42%,rgba(59,130,246,0.18))] p-5 shadow-[0_0_38px_rgba(255,213,0,0.14)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <RecruiterAvatar item={leader} size="lg" />
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[#FFD500]/30 bg-black/30 px-2 py-1 text-xs font-semibold uppercase text-[#FFEA70]">
                  <Crown className="h-3.5 w-3.5" />
                  Melhor Recrutador
                </div>
                <h3 className="truncate text-2xl font-bold text-white">{leader?.recruiterName ?? "Sem líder definido"}</h3>
                <p className="mt-1 flex items-center gap-2 text-sm text-zinc-300"><Award className="h-4 w-4 text-[#FFEA70]" />{leader?.roleName ?? "Cargo não informado"}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[26rem]">
              <div className="rounded-md border border-white/10 bg-black/35 p-3">
                <p className="text-xs uppercase text-zinc-400">Total</p>
                <p className="mt-1 text-3xl font-bold text-[#FFEA70]">{leader?.totalRecruitments ?? 0}</p>
                <p className="text-xs text-zinc-400">recrutamentos</p>
              </div>
              <div className="rounded-md border border-white/10 bg-black/35 p-3">
                <p className="flex items-center gap-1 text-xs uppercase text-zinc-400"><CalendarClock className="h-3.5 w-3.5" />Último</p>
                <p className="mt-1 truncate text-lg font-semibold text-white">{leader?.recentRecruits[0]?.recruitedName ?? "Sem registro"}</p>
                <p className="text-xs text-zinc-400">{leader?.lastRecruitmentAt ? formatRelativeDateTime(leader.lastRecruitmentAt) : "Sem data"}</p>
              </div>
              <div className="rounded-md border border-white/10 bg-black/35 p-3">
                <p className="text-xs uppercase text-zinc-400">Posição</p>
                <p className="mt-1 text-2xl font-bold text-[#FFEA70]">1º</p>
                <p className="text-xs text-zinc-400">🥇 Lugar</p>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Metric label="Total de recrutamentos" value={String(stats.total)} />
          <Metric label="Hoje" value={String(stats.todayTotal)} />
          <Metric label="Semana" value={String(stats.weekTotal)} />
          <Metric label="Mês" value={String(stats.monthTotal)} />
          <Metric label="Média diária" value={String(averageDaily)} />
          <Metric label="Recrutadores ativos" value={String(recruiters.length)} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ranking de Recrutadores</CardTitle>
          <CardDescription>Clã {selectedClan.clanName}. Os cards atualizam pelo WebSocket quando uma nova log de recrutamento é recebida.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_160px_160px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
              <input className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] pl-9 pr-3 text-sm text-zinc-100" onChange={(event) => setRecruiterQuery(event.target.value)} placeholder="Buscar recrutador" value={recruiterQuery} />
            </label>
            <label className="relative">
              <Users className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
              <input className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] pl-9 pr-3 text-sm text-zinc-100" onChange={(event) => setRecruitedQuery(event.target.value)} placeholder="Buscar recrutado" value={recruitedQuery} />
            </label>
            <input className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setDateFilter(event.target.value)} type="date" value={dateFilter} />
            <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setPeriodFilter(event.target.value as typeof periodFilter)} value={periodFilter}>
              <option value="total">Todo período</option>
              <option value="today">Hoje</option>
              <option value="week">7 dias</option>
              <option value="month">Mês</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportRecruitments("csv", recruitmentLogs)} size="sm" variant="secondary">Exportar CSV</Button>
            <Button onClick={() => exportRecruitments("xls", recruitmentLogs)} size="sm" variant="secondary">Exportar Excel</Button>
            <Button onClick={() => exportRecruitments("json", recruitmentLogs)} size="sm" variant="secondary">Exportar JSON</Button>
            <Button onClick={() => window.print()} size="sm" variant="secondary">Exportar PDF</Button>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {filtered.map((item, index) => (
              <RecruiterCard
                active={selectedRecruiter === item.normalizedRecruiterName}
                index={index}
                item={item}
                key={item.recruiterId ?? item.normalizedRecruiterName}
                maxRecruitments={maxRecruitments}
                onClick={() => setSelectedRecruiter(item.normalizedRecruiterName)}
                period={periodFilter}
              />
            ))}
            {!filtered.length ? <p className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">Nenhum recrutador encontrado.</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <CardTitle>Tabela Geral</CardTitle>
            <CardDescription>Ordenação automática por total no período selecionado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-zinc-800">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-zinc-950 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-3">Posição</th>
                    <th className="px-3 py-3">Avatar</th>
                    <th className="px-3 py-3">Nome do Recrutador</th>
                    <th className="px-3 py-3">Cargo</th>
                    <th className="px-3 py-3">Total</th>
                    <th className="px-3 py-3">Último Recrutado</th>
                    <th className="px-3 py-3">Último Recrutamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-black/30">
                  {filtered.map((item, index) => (
                    <tr className="cursor-pointer transition hover:bg-white/[0.03]" key={item.normalizedRecruiterName} onClick={() => setSelectedRecruiter(item.normalizedRecruiterName)}>
                      <td className="px-3 py-3 font-semibold text-[#FFEA70]">{medalText(index + 1)}</td>
                      <td className="px-3 py-3"><RecruiterAvatar item={item} size="sm" /></td>
                      <td className="px-3 py-3 font-semibold text-zinc-100">{item.recruiterName}</td>
                      <td className="px-3 py-3 text-zinc-400">{item.roleName ?? "Cargo não informado"}</td>
                      <td className="px-3 py-3 text-lg font-bold text-[#FFEA70]">{recruitmentPeriodValue(item, periodFilter)}</td>
                      <td className="px-3 py-3 text-zinc-300">{item.recentRecruits[0]?.recruitedName ?? "Sem registro"}</td>
                      <td className="px-3 py-3 text-zinc-400">{item.lastRecruitmentAt ? formatDateTime(item.lastRecruitmentAt) : "Sem data"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Histórico em Tempo Real</CardTitle>
            <CardDescription>Últimos recrutamentos recebidos pela webhook.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="discord-scrollbar max-h-[36rem] space-y-3 overflow-y-auto pr-1">
              {timeline.map((log) => {
                const recruiter = recruiters.find((item) => item.recruiterName === log.recruiterName) ?? null;
                return (
                  <div className="grid grid-cols-[44px_1fr] gap-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-3" key={log.id}>
                    <RecruiterAvatar item={recruiter} size="sm" name={log.recruiterName ?? "?"} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-xs font-semibold text-[#FFEA70]"><Clock3 className="h-3.5 w-3.5" />{formatTime(log.eventTimestamp)}</p>
                      <p className="mt-1 text-sm text-zinc-200"><span className="font-semibold text-white">{log.recruiterName}</span> recrutou <span className="font-semibold text-white">{log.playerName}</span></p>
                      <p className="text-xs text-zinc-500">{formatDate(log.eventTimestamp)}</p>
                    </div>
                  </div>
                );
              })}
              {!timeline.length ? <p className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">Nenhum evento recebido ainda.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <DailyRecruitmentChart values={stats.dailySeries} />
      {selectedRecruiterData ? <RecruiterProfileModal history={profileHistory} item={selectedRecruiterData} onClose={() => setSelectedRecruiter(null)} stats={stats} /> : null}
    </div>
  );
}

function RecruitmentSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-40 animate-pulse rounded-md border border-zinc-800 bg-zinc-950/70" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => <div className="h-36 animate-pulse rounded-md border border-zinc-800 bg-zinc-950/70" key={index} />)}
      </div>
    </div>
  );
}

function RecruiterCard({ active, index, item, maxRecruitments, onClick, period }: {
  active: boolean;
  index: number;
  item: ZtkRecruiterRankingItem;
  maxRecruitments: number;
  onClick: () => void;
  period: "today" | "week" | "month" | "total";
}) {
  const value = recruitmentPeriodValue(item, period);
  const percent = Math.max(4, Math.round((value / maxRecruitments) * 100));
  const lastRecruit = item.recentRecruits[0];
  return (
    <button
      className={`group w-full rounded-md border p-4 text-left transition duration-300 ${active ? "border-[#FFD500]/50 bg-[#FFD500]/10 shadow-[0_0_24px_rgba(255,213,0,0.10)]" : "border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 hover:bg-zinc-950"}`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RecruiterAvatar item={item} size="md" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-zinc-100">{medalText(index + 1)} {item.recruiterName}</p>
            <p className="mt-1 truncate text-xs text-zinc-500">{item.roleName ?? "Cargo não informado"}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-black text-[#FFEA70] transition group-hover:scale-[1.03]">{value}</p>
          <p className="text-xs uppercase text-zinc-500">Recrutamentos</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="text-xs uppercase text-zinc-500">Último</p>
          <p className="truncate text-sm font-semibold text-zinc-200">{lastRecruit?.recruitedName ?? "Sem registro"}</p>
          <p className="text-xs text-zinc-500">{lastRecruit ? formatRelativeDateTime(lastRecruit.recruitedAt) : "Sem data"}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Sparkles className="h-4 w-4 text-[#FFEA70]" />
          {percent}%
        </div>
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#FFD500,#3DDC84,#3B82F6)] transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>
    </button>
  );
}

function RecruiterAvatar({ item, name, size }: { item?: ZtkRecruiterRankingItem | null; name?: string | null; size: "sm" | "md" | "lg" }) {
  const classes = {
    sm: "h-10 w-10 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-20 w-20 text-xl"
  };
  const label = item?.recruiterName ?? name ?? "?";
  return (
    <div className={`${classes[size]} flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-zinc-900 font-bold text-zinc-300 shadow-inner`}>
      {item?.avatarUrl ? <img alt="" className="h-full w-full object-cover" src={item.avatarUrl} /> : label.slice(0, 2).toUpperCase()}
    </div>
  );
}

function RecruiterProfileModal({ history, item, onClose, stats }: {
  history: Array<{ recruitedAt: string; recruitedName: string; recruitedPlayerId: string | null }>;
  item: ZtkRecruiterRankingItem;
  onClose: () => void;
  stats: ZtkWebhookDashboard["recruitmentRankings"]["stats"];
}) {
  const averageDaily = stats.dailySeries.length ? Math.round((item.totalRecruitments / stats.dailySeries.length) * 10) / 10 : item.totalRecruitments;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-md border border-zinc-800 bg-[#09090b] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <RecruiterAvatar item={item} size="lg" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-[#FFEA70]">Perfil do Recrutador</p>
              <h3 className="truncate text-2xl font-bold text-white">{item.recruiterName}</h3>
              <p className="text-sm text-zinc-500">{item.roleName ?? "Cargo não informado"}{item.recruiterId ? ` • ${item.recruiterId}` : ""}</p>
            </div>
          </div>
          <button className="rounded-md border border-zinc-800 p-2 text-zinc-400 transition hover:text-white" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="discord-scrollbar max-h-[calc(92vh-7rem)] overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Total" value={String(item.totalRecruitments)} />
            <Metric label="Primeiro" value={item.firstRecruitmentAt ? formatDate(item.firstRecruitmentAt) : "Sem registro"} />
            <Metric label="Último" value={item.lastRecruitmentAt ? formatDateTime(item.lastRecruitmentAt) : "Sem registro"} />
            <Metric label="Média diária" value={String(averageDaily)} />
          </div>
          <div className="mt-4">
            <DailyRecruitmentChart values={stats.dailySeries} />
          </div>
          <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="mb-3 text-sm font-semibold text-zinc-100">Membros recrutados</p>
            <div className="discord-scrollbar max-h-80 space-y-2 overflow-y-auto pr-1">
              {history.map((recruit, index) => (
                <div className="grid gap-1 rounded-md border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300 sm:grid-cols-[40px_1fr_120px_90px]" key={`${recruit.recruitedName}-${recruit.recruitedAt}-${index}`}>
                  <span className="font-semibold text-[#FFEA70]">{index + 1}.</span>
                  <span className="font-semibold text-zinc-100">{recruit.recruitedName}</span>
                  <span className="text-zinc-500">{formatDate(recruit.recruitedAt)}</span>
                  <span className="text-zinc-500">{formatTime(recruit.recruitedAt)}</span>
                </div>
              ))}
              {!history.length ? <p className="text-sm text-zinc-500">Nenhum recrutamento encontrado nos filtros atuais.</p> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function recruiterHistory(
  item: ZtkRecruiterRankingItem,
  logs: ZtkWebhookDashboard["logs"],
  period: "today" | "week" | "month" | "total",
  recruitedQuery: string,
  dateFilter: string
) {
  const fromLogs = logs
    .filter((log) => normalizeSearch(log.recruiterName ?? "") === normalizeSearch(item.recruiterName))
    .map((log) => ({
      recruitedAt: log.eventTimestamp,
      recruitedName: log.playerName ?? "Não identificado",
      recruitedPlayerId: log.playerId
    }));
  const source = fromLogs.length ? fromLogs : item.recentRecruits;
  return source
    .filter((recruit) => {
      const recruitedOk = !recruitedQuery.trim() || normalizeSearch(recruit.recruitedName).includes(normalizeSearch(recruitedQuery));
      const dateOk = !dateFilter || recruit.recruitedAt.slice(0, 10) === dateFilter;
      return recruitedOk && dateOk && periodAllows(recruit.recruitedAt, period);
    })
    .sort((a, b) => new Date(b.recruitedAt).getTime() - new Date(a.recruitedAt).getTime());
}

function emptyRecruitmentStats(): ZtkWebhookDashboard["recruitmentRankings"]["stats"] {
  return { dailySeries: [], lastRecruitmentAt: null, lastRecruiterName: null, monthTotal: 0, todayTotal: 0, topRecruiterName: null, total: 0, weekTotal: 0 };
}

function medalText(place: number) {
  if (place === 1) return "🥇";
  if (place === 2) return "🥈";
  if (place === 3) return "🥉";
  return `${place}º`;
}

function WebhookView({ canManage, clan, onCopy, onRegisterManual, onWebhookAction, savingKey }: { canManage: boolean; clan: ZtkWebhookClan; onCopy: () => void; onRegisterManual: (url: string) => Promise<void>; onWebhookAction: (action: "create" | "delete" | "disable" | "regenerate") => Promise<void>; savingKey: string | null }) {
  const [manualUrl, setManualUrl] = useState(clan.webhookUrl ?? "");
  useEffect(() => setManualUrl(clan.webhookUrl ?? ""), [clan.id, clan.webhookUrl]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>🔗 Webhook individual</CardTitle>
        <CardDescription>A URL é uma webhook Discord real e pertence somente ao clã {clan.clanName}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <Metric label="Status" value={isDiscordWebhookUrl(clan.webhookUrl) && clan.webhookEnabled ? "Gerada e ativa" : "Não gerada"} />
          <Metric label="Última log recebida" value={clan.lastEventAt ? formatDateTime(clan.lastEventAt) : "Nenhuma"} />
          <Metric label="Criada em" value={clan.webhookCreatedAt ? formatDateTime(clan.webhookCreatedAt) : "Pendente"} />
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">Webhook</p>
          <p className="break-all text-sm text-zinc-200">{clan.webhookUrl ?? "Configure um canal e clique em Criar webhook para gerar a URL aceita pelo FiveM."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canManage || savingKey !== null} onClick={() => void onWebhookAction(isDiscordWebhookUrl(clan.webhookUrl) ? "regenerate" : "create")}>
            {savingKey?.startsWith("webhook") ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isDiscordWebhookUrl(clan.webhookUrl) ? "Regenerar" : "Criar webhook"}
          </Button>
          <Button disabled={!isDiscordWebhookUrl(clan.webhookUrl)} onClick={onCopy} variant="secondary"><Clipboard className="h-4 w-4" />Copiar URL</Button>
          <Button disabled={!canManage || savingKey !== null || !isDiscordWebhookUrl(clan.webhookUrl)} onClick={() => void onWebhookAction("disable")} variant="secondary">Desativar</Button>
          <Button disabled={!canManage || savingKey !== null || !isDiscordWebhookUrl(clan.webhookUrl)} onClick={() => void onWebhookAction("delete")} variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button>
        </div>
        <div className="grid gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-[1fr_auto]">
          <input
            className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
            disabled={!canManage || savingKey !== null}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            value={manualUrl}
          />
          <Button disabled={!canManage || savingKey !== null || !manualUrl.trim()} onClick={() => void onRegisterManual(manualUrl.trim())} variant="secondary">
            {savingKey === "manual-webhook" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Cadastrar webhook
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelsView({ canManage, channels, clan, onSave, savingKey }: { canManage: boolean; channels: GuildChannelOption[]; clan: ZtkWebhookClan; onSave: (patch: SaveZtkWebhookClanPayload, key?: string) => Promise<void>; savingKey: string | null }) {
  const [draft, setDraft] = useState<SaveZtkWebhookClanPayload>(clan);
  useEffect(() => setDraft(clan), [clan]);
  const fields: Array<{ key: keyof SaveZtkWebhookClanPayload; label: string }> = [
    { key: "rankingChannelId", label: "Canal Ranking" },
    { key: "recruitmentChannelId", label: "Canal Recrutamento" },
    { key: "onlineChannelId", label: "Canal Online" },
    { key: "dominationChannelId", label: "Canal Dominação" },
    { key: "rewardChannelId", label: "Canal Premiação" },
    { key: "settingsChannelId", label: "Canal Entrada Webhook FiveM" }
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>📢 Canais separados</CardTitle>
        <CardDescription>Defina onde ranking, logs e premiações serão enviados.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((field) => (
            <label className="space-y-1 text-sm text-zinc-300" key={field.key}>
              {field.label}
              <select
                className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
                disabled={!canManage}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value || null }))}
                value={(draft[field.key] as string | null) ?? ""}
              >
                <option value="">Não configurado</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <Button className="w-fit" disabled={!canManage || savingKey !== null} onClick={() => void onSave(draft, "channels")}>
          {savingKey === "channels" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar canais
        </Button>
      </CardContent>
    </Card>
  );
}

function RewardsView({ canManage, dashboard, draft, onDraft, onSave, saving }: { canManage: boolean; dashboard: ZtkWebhookDashboard | null; draft: SaveZtkRewardPayload; onDraft: (value: SaveZtkRewardPayload) => void; onSave: () => Promise<void>; saving: boolean }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle>🎁 Premiação</CardTitle>
          <CardDescription>Configure vencedores e valores por ranking.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <input className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => onDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />
          <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => onDraft({ ...draft, rankingType: event.target.value as ZtkRankingType })} value={draft.rankingType ?? "domination"}>
            <option value="domination">Top Dominação</option>
            <option value="recruitment">Top Recrutamento</option>
            <option value="online">Top Online</option>
          </select>
          <input className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => onDraft({ ...draft, rewardDate: event.target.value })} type="date" value={(draft.rewardDate ?? "").slice(0, 10)} />
          {(draft.winners ?? []).map((winner, index) => (
            <input
              className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={!canManage}
              key={winner.place}
              onChange={(event) => onDraft({ ...draft, winners: (draft.winners ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })}
              value={winner.value}
            />
          ))}
          <Button disabled={!canManage || saving} onClick={() => void onSave()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            Criar premiação
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Histórico de premiações</CardTitle>
          <CardDescription>Registros persistidos no banco.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(dashboard?.rewards ?? []).map((reward) => (
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3" key={reward.id}>
              <p className="font-semibold text-zinc-100">{reward.name}</p>
              <p className="text-sm text-zinc-500">{rankingLabels[reward.rankingType]} • {reward.rewardDate ? formatDate(reward.rewardDate) : "Sem data"}</p>
              <p className="mt-2 text-sm text-zinc-300">{reward.winners.map((winner) => `${winner.place}º ${winner.value}`).join(" • ")}</p>
            </div>
          ))}
          {!dashboard?.rewards.length ? <p className="text-sm text-zinc-500">Nenhuma premiação cadastrada.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StatsView({ dashboard, stats }: { dashboard: ZtkWebhookDashboard | null; stats: ReturnType<typeof buildStats> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>📈 Estatísticas</CardTitle>
          <CardDescription>Totais calculados a partir das logs recebidas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Metric label="Total de membros recrutados" value={String(stats.recruitments)} />
          <Metric label="Total de dominações" value={String(stats.dominations)} />
          <Metric label="Jogador mais ativo" value={stats.mostOnline?.playerName ?? "Sem dados"} />
          <Metric label="Destaque do mês" value={stats.highlight?.playerName ?? "Sem dados"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Histórico recente</CardTitle>
          <CardDescription>Últimas logs FiveM persistidas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(dashboard?.logs ?? []).slice(0, 8).map((log) => (
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3" key={log.id}>
              <p className="font-semibold text-zinc-100">{eventLabel(log.eventType)}</p>
              <p className="text-sm text-zinc-500">{log.playerName ?? log.recruiterName ?? "Jogador não identificado"} • {formatDateTime(log.eventTimestamp)}</p>
              {log.eventType === "domination" ? (
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  Gang: {log.clanName} • Zona: {log.location ?? "Não informada"} • Participantes: {log.participantCount ?? log.participants?.length ?? 0}
                  {log.rivalGangs?.length ? ` • Rivais: ${log.rivalGangs.map((gang) => `${gang.name} (${gang.players})`).join(", ")}` : ""}
                </p>
              ) : null}
            </div>
          ))}
          {!dashboard?.logs.length ? <p className="text-sm text-zinc-500">Nenhuma log recebida.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsView({ canManage, clan, onSave, savingKey }: { canManage: boolean; clan: ZtkWebhookClan; onSave: (patch: SaveZtkWebhookClanPayload, key?: string) => Promise<void>; savingKey: string | null }) {
  const [name, setName] = useState(clan.clanName);
  const [active, setActive] = useState(clan.active);
  useEffect(() => {
    setName(clan.clanName);
    setActive(clan.active);
  }, [clan]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>⚙️ Configurações</CardTitle>
        <CardDescription>Controle básico do módulo para o clã selecionado.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="space-y-1 text-sm text-zinc-300">
          Nome do clã
          <input className="h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={!canManage} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300">
          Módulo ativo para este clã
          <Switch checked={active} disabled={!canManage} onCheckedChange={setActive} />
        </label>
        <Button className="w-fit" disabled={!canManage || savingKey !== null} onClick={() => void onSave({ active, clanName: name }, "settings")}>
          {savingKey === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configurações
        </Button>
      </CardContent>
    </Card>
  );
}

function RankingList({ title, valueLabel, values, valueOf }: { title: string; valueLabel: string; values: ZtkWebhookDashboard["rankings"]["domination"]; valueOf: (item: ZtkWebhookDashboard["rankings"]["domination"][number]) => number }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-3 font-semibold text-zinc-100">{title}</p>
      <div className="discord-scrollbar max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {values.slice(0, ZTK_RANKING_LIMIT).map((item, index) => (
          <div className="flex items-center justify-between gap-3 text-sm" key={item.id}>
            <span className="min-w-0 truncate text-zinc-200">{medals[index] ?? `${index + 1}º`} {item.playerName}</span>
            <span className="shrink-0 text-zinc-500">{valueOf(item)} {valueLabel}</span>
          </div>
        ))}
        {!values.length ? <p className="text-sm text-zinc-500">Sem registros.</p> : null}
      </div>
    </div>
  );
}

function GangRankingList({ values }: { values: ZtkWebhookDashboard["dominationRankings"]["gangs"] }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-3 font-semibold text-zinc-100">🏆 Top 10 Dominações</p>
      <div className="discord-scrollbar max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {values.slice(0, ZTK_RANKING_LIMIT).map((item, index) => (
          <div className="text-sm" key={item.normalizedGangName}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-zinc-200">{medals[index] ?? `${index + 1}º`} {item.gangName}</span>
              <span className="shrink-0 text-zinc-500">{item.dominations} dominações</span>
            </div>
            <p className="text-xs text-zinc-500">{item.lastZone ?? "Sem zona"}{item.lastDominatedAt ? ` • ${formatDateTime(item.lastDominatedAt)}` : ""}</p>
          </div>
        ))}
        {!values.length ? <p className="text-sm text-zinc-500">Sem registros.</p> : null}
      </div>
    </div>
  );
}

function ParticipantRankingList({ onSelect, period = "total", selectedKey, values }: { onSelect?: (item: ZtkWebhookDashboard["dominationRankings"]["participants"][number]) => void; period?: "today" | "week" | "month" | "total"; selectedKey?: string | null; values: ZtkWebhookDashboard["dominationRankings"]["participants"] }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-3 font-semibold text-zinc-100">🎯 Top 10 Dominações por Membro</p>
      <div className="discord-scrollbar max-h-[36rem] space-y-2 overflow-y-auto pr-1">
        {values.slice(0, ZTK_RANKING_LIMIT).map((item, index) => (
          <button
            className={`grid w-full gap-3 rounded-md border p-3 text-left text-sm transition md:grid-cols-[minmax(0,1fr)_130px_120px] ${selectedKey === (item.playerId ?? item.normalizedPlayerName) ? "border-[#FFD500]/45 bg-[#FFD500]/10" : "border-zinc-800 bg-black/30 hover:border-zinc-700"}`}
            key={item.playerId ?? item.normalizedPlayerName}
            onClick={() => onSelect?.(item)}
            type="button"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-xs font-bold text-zinc-300">
                {item.avatarUrl ? <img alt="" className="h-full w-full rounded-md object-cover" src={item.avatarUrl} /> : item.playerName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-zinc-100">{medals[index] ?? `#${index + 1}`} #{index + 1} {item.playerName}</p>
                <p className="truncate text-xs text-zinc-500">Clã: {item.gangName ?? "Não informado"} • {trendLabel(item.positionChange)}</p>
              </div>
            </div>
            <div className="text-zinc-300">
              <p className="font-semibold">{rankingPeriodValue(item, period)} dominações</p>
              <p className="text-xs text-zinc-500">Total acumulado</p>
            </div>
            <div className="text-zinc-500">
              <p className="truncate text-xs">{item.lastZone ?? "Sem local"}</p>
              <p className="text-xs">{item.lastDominatedAt ? formatDateTime(item.lastDominatedAt) : "Sem data"}</p>
            </div>
          </button>
        ))}
        {!values.length ? <p className="text-sm text-zinc-500">Sem registros.</p> : null}
      </div>
    </div>
  );
}

function DailyDominationsChart({ values }: { values: ZtkWebhookDashboard["dominationRankings"]["stats"]["dailySeries"] }) {
  const max = Math.max(1, ...values.map((item) => item.total));
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-3 text-sm font-semibold text-zinc-100">Dominações por dia</p>
      <div className="flex h-28 items-end gap-1">
        {values.slice(-14).map((item) => (
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={item.date}>
            <div className="w-full rounded-sm bg-[#FFD500]" style={{ height: `${Math.max(8, (item.total / max) * 96)}px` }} title={`${item.date}: ${item.total}`} />
            <span className="w-full truncate text-center text-[10px] text-zinc-500">{item.date.slice(5)}</span>
          </div>
        ))}
        {!values.length ? <p className="self-center text-sm text-zinc-500">Sem dados para o gráfico.</p> : null}
      </div>
    </div>
  );
}

function DailyRecruitmentChart({ values }: { values: ZtkWebhookDashboard["recruitmentRankings"]["stats"]["dailySeries"] }) {
  const max = Math.max(1, ...values.map((item) => item.total));
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="mb-3 text-sm font-semibold text-zinc-100">Recrutamentos por dia</p>
      <div className="flex h-24 items-end gap-1">
        {values.slice(-14).map((item) => (
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={item.date}>
            <div className="w-full rounded-sm bg-[#3b82f6]" style={{ height: `${Math.max(8, (item.total / max) * 80)}px` }} title={`${item.date}: ${item.total}`} />
            <span className="w-full truncate text-center text-[10px] text-zinc-500">{item.date.slice(5)}</span>
          </div>
        ))}
        {!values.length ? <p className="self-center text-sm text-zinc-500">Sem dados para o gráfico.</p> : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function buildStats(dashboard: ZtkWebhookDashboard | null) {
  const players = Object.values(dashboard?.rankings ?? {}).flat();
  const byId = new Map(players.map((item) => [item.id, item]));
  const uniquePlayers = [...byId.values()];
  const mostOnline = [...uniquePlayers].sort((a, b) => b.onlineSeconds - a.onlineSeconds)[0] ?? null;
  const highlight = [...uniquePlayers].sort((a, b) => (b.dominations + b.recruitments + Math.floor(b.onlineSeconds / 3600)) - (a.dominations + a.recruitments + Math.floor(a.onlineSeconds / 3600)))[0] ?? null;
  return {
    dominations: uniquePlayers.reduce((total, item) => total + item.dominations, 0),
    highlight,
    mostOnline,
    onlineSeconds: uniquePlayers.reduce((total, item) => total + item.onlineSeconds, 0),
    recruitments: uniquePlayers.reduce((total, item) => total + item.recruitments, 0)
  };
}

function eventLabel(value: string) {
  if (value === "recruitment") return "NOVO MEMBRO";
  if (value === "domination") return "DOMINAÇÃO CONCLUÍDA";
  if (value === "player_connected") return "PLAYER CONNECTED";
  if (value === "player_disconnected") return "PLAYER DISCONNECTED";
  return "EVENTO RECEBIDO";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatRelativeDateTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = sameDay(date, today) ? "Hoje" : sameDay(date, yesterday) ? "Ontem" : formatDate(value);
  return `${day} • ${formatTime(value)}`;
}

function periodAllows(value: string, period: "today" | "week" | "month" | "total") {
  if (period === "total") return true;
  const date = new Date(value);
  const now = new Date();
  const start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return date >= start;
}

function rankingPeriodValue(item: ZtkWebhookDashboard["dominationRankings"]["participants"][number], period: "today" | "week" | "month" | "total") {
  if (period === "today") return item.todayDominations;
  if (period === "week") return item.weeklyDominations;
  if (period === "month") return item.monthlyDominations;
  return item.participations;
}

function recruitmentPeriodValue(item: ZtkWebhookDashboard["recruitmentRankings"]["recruiters"][number], period: "today" | "week" | "month" | "total") {
  if (period === "today") return item.todayRecruitments;
  if (period === "week") return item.weeklyRecruitments;
  if (period === "month") return item.monthlyRecruitments;
  return item.totalRecruitments;
}

function exportRecruitments(format: "csv" | "json" | "xls", logs: ZtkWebhookDashboard["logs"]) {
  const rows = logs.map((log) => ({
    canal: log.channelId ?? "",
    data: formatDate(log.eventTimestamp),
    hora: formatTime(log.eventTimestamp),
    recrutado: log.playerName ?? "",
    recrutador: log.recruiterName ?? "",
    webhook: log.webhookId ?? ""
  }));
  const filename = `ztk-recrutamentos.${format}`;
  if (format === "json") {
    downloadText(filename, "application/json", JSON.stringify(rows, null, 2));
    return;
  }
  const delimiter = format === "xls" ? "\t" : ",";
  const header = ["recrutador", "recrutado", "data", "hora", "canal", "webhook"];
  const body = rows.map((row) => header.map((key) => csvCell(String(row[key as keyof typeof row] ?? ""), delimiter)).join(delimiter)).join("\n");
  downloadText(filename, format === "xls" ? "application/vnd.ms-excel" : "text/csv", `${header.join(delimiter)}\n${body}`);
}

function csvCell(value: string, delimiter: string) {
  return value.includes(delimiter) || value.includes("\n") || value.includes("\"") ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

function downloadText(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function trendLabel(value: "down" | "same" | "up") {
  if (value === "up") return "Subiu";
  if (value === "down") return "Desceu";
  return "Permaneceu";
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === "string") return response.data.message;
  }
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ECONNABORTED") {
    return "Tempo esgotado ao criar a webhook. Verifique se o bot está online e tem permissão Gerenciar Webhooks no canal escolhido.";
  }
  return fallback;
}

function isDiscordWebhookUrl(value: string | null | undefined) {
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,32}\/[-_.a-zA-Z0-9]+/i.test(value ?? "");
}
