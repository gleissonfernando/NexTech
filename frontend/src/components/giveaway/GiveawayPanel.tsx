import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Clock,
  ExternalLink,
  Gift,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Send,
  Square,
  Trophy,
  Users
} from "lucide-react";
import {
  createGiveaway,
  endGiveaway,
  getGiveaways,
  getGuildLiveOptions,
  publishGiveawayPanel,
  startGiveaway,
  syncGiveawayParticipants,
  updateGiveaway
} from "../../lib/api";
import type { DashboardGuild, Giveaway, GiveawayParticipantMode, GuildLiveOptions, SaveGiveawayPayload } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type GiveawayPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

type GiveawayForm = {
  allowRepeatWinners: boolean;
  customMessage: string;
  discordChannelId: string;
  endDelayMinutes: number;
  kickChannelInput: string;
  liveUrl: string;
  participantMode: GiveawayParticipantMode;
  prizeName: string;
  startDelayMinutes: number;
  title: string;
  winnerCount: number;
};

const emptyForm: GiveawayForm = {
  allowRepeatWinners: false,
  customMessage: "",
  discordChannelId: "",
  endDelayMinutes: 0,
  kickChannelInput: "",
  liveUrl: "",
  participantMode: "twitch_subs",
  prizeName: "",
  startDelayMinutes: 0,
  title: "",
  winnerCount: 1
};

export function GiveawayPanel({ botId, canManage, guild }: GiveawayPanelProps) {
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [options, setOptions] = useState<GuildLiveOptions | null>(null);
  const [form, setForm] = useState<GiveawayForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const editingGiveaway = useMemo(
    () => giveaways.find((giveaway) => giveaway.id === editingId) ?? null,
    [editingId, giveaways]
  );

  useEffect(() => {
    if (!guild) {
      setGiveaways([]);
      setOptions(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    setLoading(true);
    setMessage(null);

    Promise.all([
      getGiveaways(guild.id, botId),
      getGuildLiveOptions(guild.id, botId)
    ])
      .then(([nextGiveaways, nextOptions]) => {
        if (!mounted) return;
        setGiveaways(nextGiveaways);
        setOptions(nextOptions);
        if (canManage) {
          void syncGiveawayList(nextGiveaways);
        }
      })
      .catch((error) => {
        if (mounted) setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar os sorteios.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (!guild || !canManage) {
      return;
    }

    const interval = window.setInterval(() => {
      void syncGiveawayList(giveaways);
    }, 30 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [botId, canManage, giveaways, guild?.id]);

  function updateForm<K extends keyof GiveawayForm>(key: K, value: GiveawayForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function handleSyncOptions() {
    if (!guild) return;

    setActionId("sync-options");
    setMessage(null);

    try {
      setOptions(await getGuildLiveOptions(guild.id, botId));
      setMessage("Canais do Discord sincronizados.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel sincronizar canais.");
    } finally {
      setActionId(null);
    }
  }

  async function syncGiveawayList(items: Giveaway[]) {
    if (!guild || !canManage) {
      return;
    }

    const activeGiveaways = items.filter((giveaway) => giveaway.status !== "ended");

    for (const giveaway of activeGiveaways) {
      const syncedRecently = giveaway.lastSyncedAt && Date.now() - new Date(giveaway.lastSyncedAt).getTime() < 29 * 60 * 1000;

      if (syncedRecently) {
        continue;
      }

      try {
        const updated = await syncGiveawayParticipants(guild.id, giveaway.id, botId);
        setGiveaways((current) => upsertGiveaway(current, updated));
      } catch {
        // A sincronizacao manual mostra o erro; a automatica nao deve interromper o painel.
      }
    }
  }

  async function handleSubmit() {
    if (!guild || !canManage) {
      return;
    }

    const payload = toPayload(form);

    setSaving(true);
    setMessage(null);

    try {
      const saved = editingId
        ? await updateGiveaway(guild.id, editingId, payload, botId)
        : await createGiveaway(guild.id, payload, botId);

      setGiveaways((current) => upsertGiveaway(current, saved));
      setEditingId(saved.id);
      setMessage(editingId ? "Sorteio atualizado." : "Sorteio criado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o sorteio.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(giveaway: Giveaway, action: "panel" | "start" | "end" | "sync") {
    if (!guild || !canManage) {
      return;
    }

    setActionId(`${action}:${giveaway.id}`);
    setMessage(null);

    try {
      const updated = action === "panel"
        ? await publishGiveawayPanel(guild.id, giveaway.id, botId)
        : action === "start"
          ? await startGiveaway(guild.id, giveaway.id, botId)
          : action === "sync"
            ? await syncGiveawayParticipants(guild.id, giveaway.id, botId)
            : await endGiveaway(guild.id, giveaway.id, botId);

      setGiveaways((current) => upsertGiveaway(current, updated));
      setMessage(action === "panel" ? "Painel enviado para o Discord." : action === "start" ? "Sorteio iniciado." : action === "sync" ? "Participantes atualizados." : "Sorteio encerrado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel executar essa acao.");
    } finally {
      setActionId(null);
    }
  }

  function handleEdit(giveaway: Giveaway) {
    setEditingId(giveaway.id);
    setForm({
      allowRepeatWinners: giveaway.allowRepeatWinners,
      customMessage: giveaway.customMessage ?? "",
      discordChannelId: giveaway.discordChannelId ?? "",
      endDelayMinutes: giveaway.endDelayMinutes,
      kickChannelInput: giveaway.kickChannelName ? `https://kick.com/${giveaway.kickChannelName}` : "",
      liveUrl: giveaway.liveUrl,
      participantMode: giveaway.participantMode,
      prizeName: giveaway.prizeName,
      startDelayMinutes: giveaway.startDelayMinutes,
      title: giveaway.title,
      winnerCount: giveaway.winnerCount
    });
  }

  function handleNew() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage(null);
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="flex min-h-36 items-center justify-center p-6 text-sm text-zinc-500">
          Selecione um servidor para configurar sorteios.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center p-6">
          <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <Card className="border-zinc-800 bg-zinc-950/80">
        <CardHeader className="border-b border-zinc-900 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Sorteio</CardTitle>
              <CardDescription>{editingGiveaway ? "Editando painel e roleta." : "Crie um painel com roleta para subs."}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={actionId === "sync-options"} onClick={() => void handleSyncOptions()} size="sm" variant="outline">
                {actionId === "sync-options" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sincronizar canais
              </Button>
              <Button onClick={handleNew} size="sm" variant="outline">
                <Gift className="h-4 w-4" />
                Novo
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
          <FormField label="Nome do sorteio">
            <input
              className="social-input h-11"
              disabled={!canManage}
              onChange={(event) => updateForm("title", event.target.value)}
              placeholder="Sorteio da live"
              value={form.title}
            />
          </FormField>

          <FormField label="Premio">
            <input
              className="social-input h-11"
              disabled={!canManage}
              onChange={(event) => updateForm("prizeName", event.target.value)}
              placeholder="Produto, pix, skin, gift card"
              value={form.prizeName}
            />
          </FormField>

          <FormField label="URL da live ou canal">
            <input
              className="social-input h-11"
              disabled={!canManage}
              onChange={(event) => updateForm("liveUrl", event.target.value)}
              placeholder="https://www.twitch.tv/canal"
              value={form.liveUrl}
            />
          </FormField>

          <FormField label="Canal Kick">
            <input
              className="social-input h-11"
              disabled={!canManage}
              onChange={(event) => updateForm("kickChannelInput", event.target.value)}
              placeholder="https://kick.com/canal"
              value={form.kickChannelInput}
            />
          </FormField>

          <FormField label="Participantes">
            <select
              className="social-input h-11"
              disabled={!canManage}
              onChange={(event) => updateForm("participantMode", event.target.value as GiveawayParticipantMode)}
              value={form.participantMode}
            >
              <option value="twitch_subs">Apenas Subs Twitch</option>
              <option value="twitch_followers">Apenas Followers Twitch</option>
              <option value="twitch_subs_followers">Subs + Followers Twitch</option>
              <option value="kick_subs">Apenas Subs Kick</option>
              <option value="kick_followers">Apenas Followers Kick</option>
              <option value="twitch_kick">Twitch + Kick</option>
              <option value="all">Todos</option>
            </select>
          </FormField>

          <FormField label="Canal do Discord">
            <select
              className="social-input h-11"
              disabled={!canManage}
              onChange={(event) => updateForm("discordChannelId", event.target.value)}
              value={form.discordChannelId}
            >
              <option value="">Selecione um canal</option>
              {(options?.channels ?? []).map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
            <FormField label="Ganhadores">
              <input
                className="social-input h-11"
                disabled={!canManage}
                min={1}
                max={50}
                onChange={(event) => updateForm("winnerCount", Number(event.target.value))}
                type="number"
                value={form.winnerCount}
              />
            </FormField>

            <FormField label="Iniciar em minutos">
              <input
                className="social-input h-11"
                disabled={!canManage}
                min={0}
                onChange={(event) => updateForm("startDelayMinutes", Number(event.target.value))}
                type="number"
                value={form.startDelayMinutes}
              />
            </FormField>

            <FormField label="Encerrar em minutos">
              <input
                className="social-input h-11"
                disabled={!canManage}
                min={0}
                onChange={(event) => updateForm("endDelayMinutes", Number(event.target.value))}
                type="number"
                value={form.endDelayMinutes}
              />
            </FormField>
          </div>

          <FormField className="lg:col-span-2" label="Mensagem personalizada do painel">
            <textarea
              className="social-input min-h-24 resize-none py-3"
              disabled={!canManage}
              onChange={(event) => updateForm("customMessage", event.target.value)}
              placeholder="Mensagem opcional enviada dentro da embed."
              value={form.customMessage}
            />
          </FormField>

          <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-black/35 p-4 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Permitir ganhador repetido</p>
              <p className="mt-1 text-xs text-zinc-500">Desativado impede o mesmo sub de ganhar mais de uma vez neste sorteio.</p>
            </div>
            <Switch
              checked={form.allowRepeatWinners}
              disabled={!canManage}
              onCheckedChange={(checked) => updateForm("allowRepeatWinners", checked)}
            />
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-2">
            <Button disabled={!canManage || saving} onClick={() => void handleSubmit()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingId ? "Salvar alteracoes" : "Criar sorteio"}
            </Button>
            {editingGiveaway?.rouletteUrl ? (
              <Button onClick={() => window.open(editingGiveaway.rouletteUrl, "_blank", "noopener,noreferrer")} variant="outline">
                <ExternalLink className="h-4 w-4" />
                Abrir roleta
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3">
        {giveaways.length ? giveaways.map((giveaway) => (
          <GiveawayRow
            actionId={actionId}
            canManage={canManage}
            giveaway={giveaway}
            key={giveaway.id}
            onAction={handleAction}
            onEdit={handleEdit}
          />
        )) : (
          <Card>
            <CardContent className="flex min-h-36 items-center justify-center p-6 text-sm text-zinc-500">
              Nenhum sorteio criado ainda.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function GiveawayRow({
  actionId,
  canManage,
  giveaway,
  onAction,
  onEdit
}: {
  actionId: string | null;
  canManage: boolean;
  giveaway: Giveaway;
  onAction: (giveaway: Giveaway, action: "panel" | "start" | "end" | "sync") => void;
  onEdit: (giveaway: Giveaway) => void;
}) {
  const status = statusMeta(giveaway.status);
  const panelLoading = actionId === `panel:${giveaway.id}`;
  const syncLoading = actionId === `sync:${giveaway.id}`;
  const startLoading = actionId === `start:${giveaway.id}`;
  const endLoading = actionId === `end:${giveaway.id}`;
  const totalTickets = giveaway.participants.reduce((total, participant) => total + Math.max(1, participant.tickets ?? 1), 0);

  return (
    <Card className="border-zinc-800 bg-zinc-950/75">
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-white">{giveaway.title}</h3>
            <Badge className={status.className} variant="muted">{status.label}</Badge>
          </div>
          <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
            <InfoPill icon={Gift} label={giveaway.prizeName} />
            <InfoPill icon={Users} label={`${giveaway.participants.length} participante(s) / ${totalTickets} ticket(s)`} />
            <InfoPill icon={Trophy} label={`${giveaway.winners.length}/${giveaway.winnerCount} ganhador(es)`} />
            <InfoPill icon={Clock} label={giveaway.scheduledStartAt ? `Inicia ${formatDate(giveaway.scheduledStartAt)}` : giveaway.scheduledEndAt ? `Encerra ${formatDate(giveaway.scheduledEndAt)}` : formatDate(giveaway.createdAt)} />
          </div>
          {giveaway.schedulerError || giveaway.lastSyncError ? (
            <p className="mt-2 text-xs text-red-300">{giveaway.schedulerError ?? giveaway.lastSyncError}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button onClick={() => onEdit(giveaway)} size="sm" variant="outline">
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <Button disabled={!canManage || panelLoading} onClick={() => onAction(giveaway, "panel")} size="sm" variant="outline">
            {panelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Painel
          </Button>
          <Button disabled={!canManage || syncLoading || giveaway.status === "ended"} onClick={() => onAction(giveaway, "sync")} size="sm" variant="outline">
            {syncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
          <Button disabled={!canManage || giveaway.status !== "waiting" || startLoading} onClick={() => onAction(giveaway, "start")} size="sm">
            {startLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Iniciar
          </Button>
          <Button disabled={!canManage || giveaway.status === "ended" || endLoading} onClick={() => onAction(giveaway, "end")} size="sm" variant="destructive">
            {endLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Encerrar
          </Button>
          <Button onClick={() => window.open(giveaway.rouletteUrl, "_blank", "noopener,noreferrer")} size="icon" title="Abrir roleta" variant="outline">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoPill({ icon: Icon, label }: { icon: typeof Gift; label: string }) {
  return (
    <span className="flex min-h-8 items-center gap-2 rounded-md border border-zinc-900 bg-black/30 px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function FormField({
  children,
  className = "",
  label
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      {children}
    </label>
  );
}

function toPayload(form: GiveawayForm): SaveGiveawayPayload {
  return {
    allowRepeatWinners: form.allowRepeatWinners,
    customMessage: form.customMessage.trim() || null,
    discordChannelId: form.discordChannelId || null,
    endDelayMinutes: Math.max(0, Number(form.endDelayMinutes) || 0),
    kickChannelInput: form.kickChannelInput.trim() || null,
    liveUrl: form.liveUrl.trim(),
    participantMode: form.participantMode,
    prizeName: form.prizeName.trim(),
    startDelayMinutes: Math.max(0, Number(form.startDelayMinutes) || 0),
    title: form.title.trim(),
    winnerCount: Math.max(1, Math.min(50, Number(form.winnerCount) || 1))
  };
}

function upsertGiveaway(giveaways: Giveaway[], giveaway: Giveaway) {
  return [giveaway, ...giveaways.filter((item) => item.id !== giveaway.id)]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function statusMeta(status: Giveaway["status"]) {
  if (status === "running") {
    return {
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
      label: "Em andamento"
    };
  }

  if (status === "ended") {
    return {
      className: "border-red-500/25 bg-red-500/10 text-red-300",
      label: "Encerrado"
    };
  }

  return {
    className: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200",
    label: "Aguardando"
  };
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}
