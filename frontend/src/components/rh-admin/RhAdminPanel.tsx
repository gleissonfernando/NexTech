import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, ImageIcon, Loader2, ScrollText, ShieldCheck, Upload, Users } from "lucide-react";
import { getGuildLiveOptions, getRhAdminDashboard, saveRhAdminSettings } from "../../lib/api";
import type { GuildLiveOptions, RhAdminDashboard, SaveRhAdminSettingsPayload } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";

type RhAdminPanelProps = {
  botId: string;
  canManage: boolean;
  guildId: string;
};

const tabs = ["Visão Geral", "Painel Principal", "Ausências", "Adornos", "Permissões", "Logs"] as const;
type Tab = typeof tabs[number];

export function RhAdminPanel({ botId, canManage, guildId }: RhAdminPanelProps) {
  const [dashboard, setDashboard] = useState<RhAdminDashboard | null>(null);
  const [options, setOptions] = useState<GuildLiveOptions | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Visão Geral");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const textChannels = useMemo(() => options?.channels.filter((channel) => ["text", "announcement"].includes(channel.type)) ?? [], [options]);

  useEffect(() => {
    void load();
  }, [botId, guildId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextDashboard, nextOptions] = await Promise.all([
        getRhAdminDashboard(botId, guildId),
        getGuildLiveOptions(guildId, botId).catch(() => ({ channels: [], roles: [], voiceChannels: [] }))
      ]);
      setDashboard(nextDashboard);
      setOptions(nextOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o RH Administrativo.");
    } finally {
      setLoading(false);
    }
  }

  async function save(patch: SaveRhAdminSettingsPayload) {
    if (!dashboard) return;
    setError("");
    try {
      const settings = await saveRhAdminSettings(botId, guildId, patch);
      setDashboard({ ...dashboard, settings });
      setMessage("Configuração salva com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }

  if (loading || !dashboard) {
    return <Card><CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" />Carregando RH Administrativo...</CardContent></Card>;
  }

  const settings = dashboard.settings;

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-sky-300" /> RH Administrativo</CardTitle>
          <Badge variant={settings.enabled ? "success" : "muted"}>{settings.enabled ? "Ativo" : "Bloqueado"}</Badge>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {tabs.map((tab) => <Button key={tab} onClick={() => setActiveTab(tab)} size="sm" type="button" variant={activeTab === tab ? "default" : "outline"}>{tab}</Button>)}
        </CardContent>
      </Card>

      {activeTab === "Visão Geral" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Metric icon={CalendarClock} label="Ausências pendentes" value={dashboard.stats.pendingAbsences} />
          <Metric icon={ShieldCheck} label="Ausências aprovadas" value={dashboard.stats.approvedAbsences} />
          <Metric icon={ImageIcon} label="Adornos enviados" value={dashboard.stats.sentAdornments} />
        </div>
      ) : null}

      {activeTab === "Painel Principal" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-sky-300" /> Painel Principal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input disabled={!canManage} label="Nome visual" onChange={(systemName) => void save({ systemName })} value={settings.systemName} />
              <Input disabled={!canManage} label="Cor padrão" onChange={(color) => void save({ color })} value={settings.color} />
              <Select disabled={!canManage} label="Canal de publicação" onChange={(panelChannelId) => void save({ panelChannelId })} options={textChannels} value={settings.panelChannelId ?? ""} />
              <Input disabled={!canManage} label="Banner do painel" onChange={(panelBannerUrl) => void save({ panelBannerUrl })} value={settings.panelBannerUrl ?? ""} />
            </div>
            <TextArea disabled={!canManage} label="Texto do painel" onChange={(panelDescription) => void save({ panelDescription })} value={settings.panelDescription} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "Ausências" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-sky-300" /> Ausências</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Select disabled={!canManage} label="Canal de análise" onChange={(absenceReviewChannelId) => void save({ absenceReviewChannelId })} options={textChannels} value={settings.absenceReviewChannelId ?? ""} />
              <Select disabled={!canManage} label="Canal de logs" onChange={(absenceLogChannelId) => void save({ absenceLogChannelId })} options={textChannels} value={settings.absenceLogChannelId ?? ""} />
              <SelectRole disabled={!canManage} label="Cargo de ausência" onChange={(absenceRoleId) => void save({ absenceRoleId })} options={options?.roles ?? []} value={settings.absenceRoleId ?? ""} />
              <Input disabled={!canManage} label="Intervalo de verificação (min)" onChange={(value) => void save({ checkIntervalMinutes: Number(value) || 30 })} value={String(settings.checkIntervalMinutes)} />
              <Input disabled={!canManage} label="Banner DM aprovada" onChange={(approvalDmBannerUrl) => void save({ approvalDmBannerUrl })} value={settings.approvalDmBannerUrl ?? ""} />
              <Input disabled={!canManage} label="Banner DM recusada" onChange={(rejectionDmBannerUrl) => void save({ rejectionDmBannerUrl })} value={settings.rejectionDmBannerUrl ?? ""} />
            </div>
            <HistoryAbsences absences={dashboard.absences} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "Adornos" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5 text-sky-300" /> Adornos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Select disabled={!canManage} label="Canal de envio" onChange={(adornmentReviewChannelId) => void save({ adornmentReviewChannelId })} options={textChannels} value={settings.adornmentReviewChannelId ?? ""} />
              <Select disabled={!canManage} label="Canal de logs" onChange={(adornmentLogChannelId) => void save({ adornmentLogChannelId })} options={textChannels} value={settings.adornmentLogChannelId ?? ""} />
              <Input disabled={!canManage} label="Banner de adorno" onChange={(adornmentBannerUrl) => void save({ adornmentBannerUrl })} value={settings.adornmentBannerUrl ?? ""} />
              <Toggle disabled={!canManage} label="Mencionar usuário" onChange={(mentionAdornmentUser) => void save({ mentionAdornmentUser })} value={settings.mentionAdornmentUser} />
            </div>
            <TextArea disabled={!canManage} label="Texto explicativo" onChange={(adornmentDescription) => void save({ adornmentDescription })} value={settings.adornmentDescription} />
            <HistoryAdornments adornments={dashboard.adornments} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "Permissões" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-sky-300" /> Permissões</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <MultiRole disabled={!canManage} label="Cargos que configuram" onChange={(configRoleIds) => void save({ configRoleIds })} options={options?.roles ?? []} value={settings.configRoleIds} />
            <MultiRole disabled={!canManage} label="Cargos que aprovam ausência" onChange={(approverRoleIds) => void save({ approverRoleIds })} options={options?.roles ?? []} value={settings.approverRoleIds} />
            <Input disabled={!canManage} label="Usuários que configuram (IDs)" onChange={(value) => void save({ configUserIds: csv(value) })} value={settings.configUserIds.join(",")} />
            <Input disabled={!canManage} label="Usuários que aprovam (IDs)" onChange={(value) => void save({ approverUserIds: csv(value) })} value={settings.approverUserIds.join(",")} />
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "Logs" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-sky-300" /> Logs</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {dashboard.logs.map((log) => <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm" key={log.id}><p className="font-semibold text-white">{log.description}</p><p className="mt-1 text-xs text-zinc-500">{log.action} • {new Date(log.createdAt).toLocaleString("pt-BR")}</p></div>)}
            {!dashboard.logs.length ? <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">Nenhum log registrado.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><Icon className="h-5 w-5 text-sky-300" /><div><p className="text-xs text-zinc-500">{label}</p><p className="text-2xl font-semibold text-white">{value}</p></div></CardContent></Card>;
}

function HistoryAbsences({ absences }: { absences: RhAdminDashboard["absences"] }) {
  return <div className="space-y-2">{absences.slice(0, 8).map((absence) => <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm" key={absence.id}><p className="font-semibold text-white">{absence.serverName}</p><p className="text-xs text-zinc-500">{absence.startDate} até {absence.returnDate} • {absence.status}</p></div>)}</div>;
}

function HistoryAdornments({ adornments }: { adornments: RhAdminDashboard["adornments"] }) {
  return <div className="space-y-2">{adornments.slice(0, 8).map((adornment) => <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm" key={adornment.id}><p className="font-semibold text-white">{adornment.serverName} • {adornment.number}</p><p className="truncate text-xs text-zinc-500">{adornment.imageUrl}</p></div>)}</div>;
}

function Input({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100" disabled={disabled} onBlur={(event) => onChange(event.target.value)} defaultValue={value} /></label>;
}

function TextArea({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><textarea className="min-h-28 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100" disabled={disabled} onBlur={(event) => onChange(event.target.value)} defaultValue={value} /></label>;
}

function Select({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string | null) => void; options: Array<{ id: string; name: string }>; value: string }) {
  return <FivemResourceSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} placeholder="Não configurado" prefix="#" value={value || null} />;
}

function SelectRole(props: Parameters<typeof Select>[0]) {
  return <FivemResourceSelect disabled={Boolean(props.disabled)} label={props.label} onChange={props.onChange} options={props.options.map((option) => ({ id: option.id, name: option.name }))} placeholder="Não configurado" prefix="@" value={props.value || null} />;
}

function MultiRole({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string[]) => void; options: Array<{ id: string; name: string }>; value: string[] }) {
  return <FivemResourceMultiSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} prefix="@" values={value} />;
}

function Toggle({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex h-10 items-center justify-between rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-200">{label}<input checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /></label>;
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
