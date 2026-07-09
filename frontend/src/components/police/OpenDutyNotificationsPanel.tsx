import { useEffect, useMemo, useState } from "react";
import { BellRing, Loader2, RotateCcw, Save, Search } from "lucide-react";
import { getGuildLiveOptions, getGuildMemberOptions, getGuildRoleOptions, getOpenDutyDashboard, resetOpenDutyCounter, saveOpenDutySettings } from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, GuildMemberOption, GuildRoleOption, OpenDutyDashboard, OpenDutySettings } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

export function OpenDutyNotificationsPanel({ botId, canManage, guild }: Props) {
  const [dashboard, setDashboard] = useState<OpenDutyDashboard | null>(null);
  const [settings, setSettings] = useState<OpenDutySettings | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<GuildMemberOption[]>([]);
  const [counterUserId, setCounterUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guild || !botId) {
      setDashboard(null);
      setSettings(null);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([getOpenDutyDashboard(guild.id, botId), getGuildLiveOptions(guild.id, botId), getGuildRoleOptions(guild.id, botId)])
      .then(([nextDashboard, channelOptions, roleOptions]) => {
        setDashboard(nextDashboard);
        setSettings(nextDashboard.settings);
        setChannels(channelOptions.channels);
        setRoles(roleOptions.filter((role) => role.id !== guild.id));
      })
      .catch((requestError) => setError(readError(requestError, "Nao foi possivel carregar o sistema de ponto aberto.")))
      .finally(() => setLoading(false));
  }, [botId, guild]);

  useEffect(() => {
    if (!guild || !botId || memberQuery.trim().length < 2) {
      setMembers([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void getGuildMemberOptions(guild.id, memberQuery, botId).then(setMembers).catch(() => setMembers([]));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [botId, guild, memberQuery]);

  const selectedCounter = useMemo(() => dashboard?.counters.find((counter) => counter.userId === counterUserId) ?? null, [counterUserId, dashboard?.counters]);
  const disabled = !settings || !guild || !botId || !canManage || loading || saving;

  function patch<K extends keyof OpenDutySettings>(key: K, value: OpenDutySettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!guild || !botId || !settings) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await saveOpenDutySettings(guild.id, botId, settings);
      setSettings(saved);
      setDashboard((current) => current ? { ...current, settings: saved } : current);
      setStatus("Configuracao salva.");
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel salvar a configuracao."));
    } finally {
      setSaving(false);
    }
  }

  async function resetCounter() {
    if (!guild || !botId || !counterUserId) return;
    setError(null);
    setStatus(null);
    try {
      await resetOpenDutyCounter(guild.id, botId, counterUserId);
      setDashboard((current) => current ? {
        ...current,
        counters: [...current.counters.filter((counter) => counter.userId !== counterUserId), { userId: counterUserId, total: 0, lastNotifiedAt: null }]
      } : current);
      setStatus("Contador resetado.");
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel resetar o contador."));
    }
  }

  if (!guild || !botId) {
    return <Card><CardContent className="p-6 text-sm text-zinc-500">Selecione um bot e servidor para configurar Ponto Aberto.</CardContent></Card>;
  }

  if (loading || !settings || !dashboard) {
    return <Card><CardContent className="flex min-h-56 items-center justify-center p-6 text-zinc-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando Ponto Aberto...</CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5 text-blue-300" />Notificacoes / Ponto Aberto</CardTitle>
            <CardDescription>Configura a DM anonima, logs, alertas de 3 avisos e permissao do comando /notificar.</CardDescription>
          </div>
          <Button disabled={disabled} onClick={() => void save()} size="sm" type="button">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
          {status ? <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{status}</p> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <SelectField disabled={disabled} label="Canal de logs" onChange={(value) => patch("logChannelId", value || null)} options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))} value={settings.logChannelId ?? ""} />
            <SelectField disabled={disabled} label="Canal de multas (2/3 e 3/3)" onChange={(value) => patch("alertChannelId", value || null)} options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))} value={settings.alertChannelId ?? ""} />
            <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-300">
              <p className="font-medium text-zinc-100">Regra de contagem</p>
              <p className="mt-1">O canal de multas recebe logs em 2/3 e 3/3. Ao chegar em 3/3, o contador zera e inicia uma nova contagem.</p>
            </div>
            <label className="text-sm font-medium text-zinc-200">
              Cor do painel
              <input className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => patch("panelColor", event.target.value)} type="color" value={settings.panelColor} />
            </label>
          </div>

          <label className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200">
            Sistema ativo
            <Switch checked={settings.enabled} disabled={disabled} onCheckedChange={(checked) => patch("enabled", checked)} />
          </label>

          <MultiRoleSelect disabled={disabled} label="Cargos autorizados" onChange={(ids) => patch("allowedRoleIds", ids)} roles={roles} values={settings.allowedRoleIds} />
          <label className="block text-sm font-medium text-zinc-200">
            Usuarios autorizados por ID
            <input
              className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100"
              disabled={disabled}
              onChange={(event) => patch("allowedUserIds", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
              placeholder="123, 456, 789"
              value={settings.allowedUserIds.join(", ")}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <TextField disabled={disabled} label="Banner da DM URL" onChange={(value) => patch("dmBannerUrl", value || null)} value={settings.dmBannerUrl ?? ""} />
            <TextField disabled={disabled} label="Banner do painel URL" onChange={(value) => patch("panelBannerUrl", value || null)} value={settings.panelBannerUrl ?? ""} />
            <TextField disabled={disabled} label="Imagem pequena do rodape URL" onChange={(value) => patch("footerImageUrl", value || null)} value={settings.footerImageUrl ?? ""} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TextArea disabled={disabled} label="Mensagem padrao da DM" onChange={(value) => patch("defaultMessage", value)} value={settings.defaultMessage} />
            <TextArea disabled={disabled} label="Texto do alerta de multa em 3/3" onChange={(value) => patch("alertMessage", value)} value={settings.alertMessage} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Consultar e resetar avisos</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <input className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setMemberQuery(event.target.value)} placeholder="Buscar usuario por nome ou ID" value={memberQuery} />
            <select className="h-10 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" onChange={(event) => setCounterUserId(event.target.value)} value={counterUserId}>
              <option value="">Selecionar usuario</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.displayName ?? member.username} ({member.id})</option>)}
              {dashboard.counters.map((counter) => <option key={`counter-${counter.userId}`} value={counter.userId}>{counter.userId}</option>)}
            </select>
            <Button disabled={!counterUserId || disabled} onClick={() => void resetCounter()} type="button" variant="outline"><RotateCcw className="mr-2 h-4 w-4" />Resetar</Button>
          </div>
          <p className="text-sm text-zinc-400"><Search className="mr-2 inline h-4 w-4" />Total atual: {selectedCounter?.total ?? 0}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Historico recente</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {dashboard.history.slice(0, 15).map((item) => (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-300" key={item.id}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{new Date(item.createdAt).toLocaleString("pt-BR")}</span>
                <span>Status: {item.status}</span>
                <span>Avisos: {item.counterTotal}</span>
                {item.alertTriggered ? <span className="text-amber-300">log de multa emitido</span> : null}
              </div>
              <p className="mt-1">Executor: <span className="text-zinc-100">{item.executorId}</span> | Usuario: <span className="text-zinc-100">{item.targetId}</span></p>
            </div>
          ))}
          {!dashboard.history.length ? <p className="text-sm text-zinc-500">Nenhuma notificacao registrada.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SelectField({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return <label className="text-sm font-medium text-zinc-200">{label}<select className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}><option value="">Nao definido</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function TextField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="text-sm font-medium text-zinc-200">{label}<input className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}
function TextArea({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="text-sm font-medium text-zinc-200">{label}<textarea className="mt-2 min-h-52 w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}
function MultiRoleSelect({ disabled, label, onChange, roles, values }: { disabled: boolean; label: string; onChange: (values: string[]) => void; roles: GuildRoleOption[]; values: string[] }) {
  return <div><p className="mb-2 text-sm font-medium text-zinc-200">{label}</p><div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border border-zinc-800 p-3 md:grid-cols-2">{roles.map((role) => <label className="flex items-center gap-2 text-sm text-zinc-300" key={role.id}><input checked={values.includes(role.id)} disabled={disabled} onChange={() => onChange(values.includes(role.id) ? values.filter((id) => id !== role.id) : [...values, role.id])} type="checkbox" />@{role.name}</label>)}</div></div>;
}
function readError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
