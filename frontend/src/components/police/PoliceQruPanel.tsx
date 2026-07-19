import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Clock3, Loader2, Save, ShieldCheck, Trophy } from "lucide-react";
import { getGuildLiveOptions, getPoliceQruDashboard, savePoliceQruSettings } from "../../lib/api";
import type { DashboardGuild, GuildCategoryOption, GuildChannelOption, GuildRoleOption, PoliceQruDashboard, PoliceQruSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";

export function PoliceQruPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<PoliceQruDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const settingsRef = useRef<PoliceQruSettings | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!botId || !guild) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const [dashboard, options] = await Promise.all([
        getPoliceQruDashboard(guild.id, botId),
        getGuildLiveOptions(guild.id, botId)
      ]);
      setData(dashboard);
      settingsRef.current = dashboard.settings;
      setChannels(options.channels ?? []);
      setCategories(options.categories ?? []);
      setRoles(options.roles ?? []);
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => {
    void load();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [load]);

  const chartBars = useMemo(() => {
    const max = Math.max(1, ...((data?.ranking ?? []).slice(0, 8).map((item) => item.total)));
    return (data?.ranking ?? []).slice(0, 8).map((item) => ({ ...item, height: Math.max(12, Math.round((item.total / max) * 100)) }));
  }, [data?.ranking]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar QRU." />;
  if (loading || !data) return <Empty loading text="Carregando QRU..." />;

  const disabled = !canManage || saving;
  function patch(next: Partial<PoliceQruSettings>) {
    const settingsForSave = { ...(settingsRef.current ?? data!.settings), ...next };
    settingsRef.current = settingsForSave;
    setData((current) => current ? { ...current, settings: settingsForSave } : current);
    if (!canManage || !guild || !botId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setMessage(null);
      try {
        const settings = await savePoliceQruSettings(guild.id, botId, settingsForSave);
        settingsRef.current = settings;
        setData((current) => current ? { ...current, settings } : current);
        setMessage("Configurações salvas.");
      } catch (error) {
        setMessage(readMessage(error));
      } finally {
        setSaving(false);
      }
    }, 500);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-300" />Registro de QRU</CardTitle>
              <CardDescription>Ocorrências policiais, evidências, auditoria e ranking automático em Components V2.</CardDescription>
            </div>
            <Badge variant={data.settings.enabled ? "success" : "muted"}>{data.settings.enabled ? "Ativo" : "Desativado"}</Badge>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-5">
        <Metric label="QRUs" value={data.stats.total} />
        <Metric label="Hoje" value={data.stats.qrusToday} />
        <Metric label="Semana" value={data.stats.qrusWeek} />
        <Metric label="Mês" value={data.stats.qrusMonth} />
        <Metric label="Oficiais" value={data.stats.officers} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração Geral</CardTitle>
          <CardDescription>Canais, cargos e comportamento do fluxo temporário.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <FivemResourceSelect disabled={disabled} label="Canal de Registros" options={channels} prefix="#" value={data.settings.recordChannelId} onChange={(recordChannelId) => patch({ recordChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Canal de Logs" options={channels} prefix="#" value={data.settings.logChannelId} onChange={(logChannelId) => patch({ logChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Categoria dos canais temporários" options={categories} value={data.settings.temporaryCategoryId} onChange={(temporaryCategoryId) => patch({ temporaryCategoryId })} />
          <FivemResourceSelect disabled={disabled} label="Cargo da equipe" options={roles} prefix="@" value={data.settings.teamRoleId} onChange={(teamRoleId) => patch({ teamRoleId })} />
          <div className="lg:col-span-2">
            <FivemResourceMultiSelect disabled={disabled} label="Cargos permitidos usar /qru" options={roles} prefix="@" values={data.settings.allowedRoleIds} onChange={(allowedRoleIds) => patch({ allowedRoleIds })} />
          </div>
          <div className="lg:col-span-2">
            <FivemResourceMultiSelect disabled={disabled} label="Cargos supervisores (pesquisa/ranking completo)" options={roles} prefix="@" values={data.settings.supervisorRoleIds} onChange={(supervisorRoleIds) => patch({ supervisorRoleIds })} />
          </div>
          <Toggle disabled={disabled} label="Ativar sistema QRU" value={data.settings.enabled} onChange={(enabled) => patch({ enabled })} />
          <Field disabled={disabled} label="Tempo para excluir canal (segundos)" type="number" value={String(data.settings.deleteChannelSeconds)} onChange={(value) => patch({ deleteChannelSeconds: Number(value) })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Painel Discord</CardTitle>
          <CardDescription>Texto publicado pelo comando /qru.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Field disabled={disabled} label="Cor" type="color" value={data.settings.color} onChange={(color) => patch({ color })} />
          <Field disabled={disabled} label="Imagem do painel" value={data.settings.panelImageUrl ?? ""} onChange={(panelImageUrl) => patch({ panelImageUrl: panelImageUrl || null })} />
          <Field disabled={disabled} label="Título" value={data.settings.panelTitle} onChange={(panelTitle) => patch({ panelTitle })} />
          <Field disabled={disabled} label="Descrição" value={data.settings.panelDescription} onChange={(panelDescription) => patch({ panelDescription })} />
          <div className="lg:col-span-2">
            <TextArea disabled={disabled} label="Mensagem" value={data.settings.panelMessage} onChange={(panelMessage) => patch({ panelMessage })} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-300" />Ranking</CardTitle>
            <CardDescription>Top oficiais com mais participações em QRU.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.ranking.map((entry) => (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3" key={entry.officerId}>
                <span className="truncate text-sm font-semibold text-white">{entry.position <= 3 ? ["🥇", "🥈", "🥉"][entry.position - 1] : `${entry.position}º`} {entry.officerName}</span>
                <Badge variant="muted">{entry.total} QRUs</Badge>
              </div>
            ))}
            {!data.ranking.length ? <p className="py-8 text-center text-zinc-500">Sem ranking ainda.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-blue-300" />Crescimento</CardTitle>
            <CardDescription>Distribuição visual dos principais oficiais.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-44 items-end gap-2">
              {chartBars.map((entry) => (
                <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={entry.officerId}>
                  <div className="w-full rounded-t bg-blue-500/70" style={{ height: `${entry.height}%` }} />
                  <span className="max-w-full truncate text-[11px] text-zinc-500">{entry.officerName}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimos Registros</CardTitle>
          <CardDescription>Ocorrências mais recentes salvas no banco.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.records.map((record) => (
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between" key={record.id}>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{record.boNumber} · {record.qruType}</p>
                <p className="text-xs text-zinc-500">{record.occurrenceDate} · {record.officers.length} oficial(is) · por {record.authorName}</p>
              </div>
              <Badge variant="success">Registrado</Badge>
            </div>
          ))}
          {!data.records.length ? <p className="py-8 text-center text-zinc-500">Nenhuma QRU registrada.</p> : null}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Alterações são salvas automaticamente.
      </div>
    </div>
  );
}

function Empty({ text, loading = false }: { text: string; loading?: boolean }) {
  return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-zinc-400">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>;
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<input className="h-11 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} min={0} max={3600} onChange={(event) => onChange(event.target.value)} type={type} value={value} /></label>;
}

function TextArea({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<textarea className="min-h-28 w-full resize-y rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function Toggle({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-zinc-500" />{label}</span><Switch checked={value} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-xs text-zinc-500"><Clock3 className="h-3.5 w-3.5" />{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></CardContent></Card>;
}

function readMessage(error: unknown) {
  return (error as any)?.response?.data?.message ?? "Não foi possível concluir a operação.";
}
