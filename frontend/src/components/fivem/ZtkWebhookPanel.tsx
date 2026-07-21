import { useEffect, useMemo, useState } from "react";
import { BarChart3, Clipboard, Gift, Link2, Loader2, Megaphone, RefreshCw, Save, Settings, Trophy, Trash2 } from "lucide-react";
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

type TabId = "ranking" | "webhook" | "rewards" | "channels" | "stats" | "settings";

const tabs: Array<{ id: TabId; icon: typeof Trophy; label: string }> = [
  { id: "ranking", icon: Trophy, label: "Ranking" },
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
      {selectedClan && activeTab === "webhook" ? (
        <WebhookView
          canManage={canManage}
          clan={selectedClan}
          onCopy={() => {
            if (selectedClan.webhookUrl) void navigator.clipboard.writeText(selectedClan.webhookUrl);
            setMessage("Webhook copiada.");
          }}
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
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader>
          <CardTitle>🏆 Ranking {selectedClan.clanName}</CardTitle>
          <CardDescription>Ordenado automaticamente pelas logs recebidas do FiveM.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <RankingList title="🔥 Dominações — Todos" valueLabel="dominações" values={dashboard?.rankings.domination ?? []} valueOf={(item) => item.dominations} />
          <RankingList title="👥 Recrutamento — Todos" valueLabel="recrutamentos" values={dashboard?.rankings.recruitment ?? []} valueOf={(item) => item.recruitments} />
          <RankingList title="⏱ Online — Todos" valueLabel="horas" values={dashboard?.rankings.online ?? []} valueOf={(item) => Math.floor(item.onlineSeconds / 3600)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ranking Atual</CardTitle>
          <CardDescription>Resumo geral do clã selecionado.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Metric label="Clã" value={selectedClan.clanName} />
          <Metric label="Dominações" value={String(stats.dominations)} />
          <Metric label="Recrutamentos" value={String(stats.recruitments)} />
          <Metric label="Online" value={`${Math.floor(stats.onlineSeconds / 3600)} horas`} />
        </CardContent>
      </Card>
    </div>
  );
}

function WebhookView({ canManage, clan, onCopy, onWebhookAction, savingKey }: { canManage: boolean; clan: ZtkWebhookClan; onCopy: () => void; onWebhookAction: (action: "create" | "delete" | "disable" | "regenerate") => Promise<void>; savingKey: string | null }) {
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
        {values.map((item, index) => (
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,32}\/[-_a-zA-Z0-9]+/i.test(value ?? "");
}
