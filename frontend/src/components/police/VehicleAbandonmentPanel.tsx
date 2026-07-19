import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Car, Clock3, Loader2, Save, ShieldCheck } from "lucide-react";
import { getGuildLiveOptions, getVehicleAbandonmentDashboard, saveVehicleAbandonmentSettings } from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, GuildRoleOption, VehicleAbandonmentDashboard, VehicleAbandonmentSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";

export function VehicleAbandonmentPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<VehicleAbandonmentDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const settingsRef = useRef<VehicleAbandonmentSettings | null>(null);
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
        getVehicleAbandonmentDashboard(guild.id, botId),
        getGuildLiveOptions(guild.id, botId)
      ]);
      setData(dashboard);
      settingsRef.current = dashboard.settings;
      setChannels(options.channels ?? []);
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

  const stats = useMemo(() => {
    const records = data?.records ?? [];
    return {
      images: records.reduce((total, record) => total + record.imageUrls.length, 0),
      last: records[0]?.createdAt ?? null,
      plates: new Set(records.map((record) => record.plate)).size,
      total: records.length
    };
  }, [data]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar Abandono de Veículo." />;
  if (loading || !data) return <Empty loading text="Carregando Abandono de Veículo..." />;

  const disabled = !canManage || saving;
  function patch(next: Partial<VehicleAbandonmentSettings>) {
    const settingsForSave = { ...(settingsRef.current ?? data!.settings), ...next };
    settingsRef.current = settingsForSave;
    setData((current) => current ? { ...current, settings: settingsForSave } : current);
    if (!canManage || !guild || !botId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setMessage(null);
      try {
        const settings = await saveVehicleAbandonmentSettings(guild.id, botId, settingsForSave);
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
              <CardTitle className="flex items-center gap-2"><Car className="h-5 w-5 text-blue-300" />Abandono de Veículo</CardTitle>
              <CardDescription>Registro automático por imagem, parser inteligente e envio em Components V2.</CardDescription>
            </div>
            <Badge variant={data.settings.enabled ? "success" : "muted"}>{data.settings.enabled ? "Ativo" : "Desativado"}</Badge>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Registros" value={stats.total} />
        <Metric label="Placas únicas" value={stats.plates} />
        <Metric label="Imagens" value={stats.images} />
        <Metric label="Último" value={stats.last ? new Date(stats.last).toLocaleDateString("pt-BR") : "-"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operação</CardTitle>
          <CardDescription>Canais, permissões e comportamento automático do sistema.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <FivemResourceSelect disabled={disabled} label="Canal do Sistema" options={channels} prefix="#" value={data.settings.systemChannelId} onChange={(systemChannelId) => patch({ systemChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Canal de Registro" options={channels} prefix="#" value={data.settings.recordChannelId} onChange={(recordChannelId) => patch({ recordChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Canal de Logs" options={channels} prefix="#" value={data.settings.logChannelId} onChange={(logChannelId) => patch({ logChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Cargo mencionado" options={roles} prefix="@" value={data.settings.mentionRoleId} onChange={(mentionRoleId) => patch({ mentionRoleId })} />
          <div className="lg:col-span-2">
            <FivemResourceMultiSelect disabled={disabled} label="Cargos permitidos" options={roles} prefix="@" values={data.settings.allowedRoleIds} onChange={(allowedRoleIds) => patch({ allowedRoleIds })} />
          </div>
          <Toggle disabled={disabled} label="Ativar sistema" value={data.settings.enabled} onChange={(enabled) => patch({ enabled })} />
          <Toggle disabled={disabled} label="Apagar mensagem original" value={data.settings.deleteOriginalMessage} onChange={(deleteOriginalMessage) => patch({ deleteOriginalMessage })} />
          <Toggle disabled={disabled} label="Registrar logs" value={data.settings.logsEnabled} onChange={(logsEnabled) => patch({ logsEnabled })} />
          <Toggle disabled={disabled} label="Permitir anexos múltiplos" value={data.settings.allowMultipleAttachments} onChange={(allowMultipleAttachments) => patch({ allowMultipleAttachments })} />
          <Toggle disabled={disabled} label="Permitir editar registros" value={data.settings.allowRecordEditing} onChange={(allowRecordEditing) => patch({ allowRecordEditing })} />
          <Toggle disabled={disabled} label="Confirmar antes do envio" value={data.settings.confirmationBeforeSend} onChange={(confirmationBeforeSend) => patch({ confirmationBeforeSend })} />
          <Field disabled={disabled} label="Limite máximo de imagens" type="number" value={String(data.settings.maxImages)} onChange={(maxImages) => patch({ maxImages: Number(maxImages) })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aparência e textos</CardTitle>
          <CardDescription>Textos aceitam {"{emoji}"}, {"{user}"}, {"{userId}"}, {"{date}"} e {"{time}"}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Field disabled={disabled} label="Cor da Embed" type="color" value={data.settings.color} onChange={(color) => patch({ color })} />
          <Field disabled={disabled} label="Emoji" value={data.settings.emoji} onChange={(emoji) => patch({ emoji })} />
          <Field disabled={disabled} label="Nome do Sistema" value={data.settings.systemName} onChange={(systemName) => patch({ systemName })} />
          <Field disabled={disabled} label="Título" value={data.settings.embedTitle} onChange={(embedTitle) => patch({ embedTitle })} />
          <Field disabled={disabled} label="Thumbnail" value={data.settings.thumbnailUrl ?? ""} onChange={(thumbnailUrl) => patch({ thumbnailUrl: thumbnailUrl || null })} />
          <Field disabled={disabled} label="Imagem padrão" value={data.settings.defaultImageUrl ?? ""} onChange={(defaultImageUrl) => patch({ defaultImageUrl: defaultImageUrl || null })} />
          <Field disabled={disabled} label="Mensagem de sucesso" value={data.settings.successMessage} onChange={(successMessage) => patch({ successMessage })} />
          <Field disabled={disabled} label="Mensagem de erro" value={data.settings.errorMessage} onChange={(errorMessage) => patch({ errorMessage })} />
          <div className="lg:col-span-2">
            <Field disabled={disabled} label="Rodapé" value={data.settings.footerText} onChange={(footerText) => patch({ footerText })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-300" />Painel Explicativo</CardTitle>
          <CardDescription>Configuração do comando /painel-explicativo e do painel de instruções em Components V2.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Toggle disabled={disabled} label="Ativar comando /painel-explicativo" value={data.settings.explanatoryPanelCommandEnabled} onChange={(explanatoryPanelCommandEnabled) => patch({ explanatoryPanelCommandEnabled })} />
          <Toggle disabled={disabled} label="Exibir botão Ver Exemplo Completo" value={data.settings.explanatoryPanelButtonEnabled} onChange={(explanatoryPanelButtonEnabled) => patch({ explanatoryPanelButtonEnabled })} />
          <FivemResourceSelect disabled={disabled} label="Canal onde o painel será enviado" options={channels} prefix="#" value={data.settings.explanatoryPanelChannelId} onChange={(explanatoryPanelChannelId) => patch({ explanatoryPanelChannelId })} />
          <Field disabled={disabled} label="Cor do painel" type="color" value={data.settings.explanatoryPanelColor} onChange={(explanatoryPanelColor) => patch({ explanatoryPanelColor })} />
          <div className="lg:col-span-2">
            <FivemResourceMultiSelect disabled={disabled} label="Cargos que podem usar o comando" options={roles} prefix="@" values={data.settings.explanatoryPanelAllowedRoleIds} onChange={(explanatoryPanelAllowedRoleIds) => patch({ explanatoryPanelAllowedRoleIds })} />
          </div>
          <Field disabled={disabled} label="Emoji principal" value={data.settings.explanatoryPanelEmoji} onChange={(explanatoryPanelEmoji) => patch({ explanatoryPanelEmoji })} />
          <Field disabled={disabled} label="Título do painel" value={data.settings.explanatoryPanelTitle} onChange={(explanatoryPanelTitle) => patch({ explanatoryPanelTitle })} />
          <Field disabled={disabled} label="Thumbnail" value={data.settings.explanatoryPanelThumbnailUrl ?? ""} onChange={(explanatoryPanelThumbnailUrl) => patch({ explanatoryPanelThumbnailUrl: explanatoryPanelThumbnailUrl || null })} />
          <Field disabled={disabled} label="Imagem de destaque" value={data.settings.explanatoryPanelImageUrl ?? ""} onChange={(explanatoryPanelImageUrl) => patch({ explanatoryPanelImageUrl: explanatoryPanelImageUrl || null })} />
          <div className="lg:col-span-2">
            <TextArea disabled={disabled} label="Descrição" value={data.settings.explanatoryPanelDescription} onChange={(explanatoryPanelDescription) => patch({ explanatoryPanelDescription })} />
          </div>
          <TextArea disabled={disabled} label="Como funciona" value={data.settings.explanatoryPanelHowItWorksText} onChange={(explanatoryPanelHowItWorksText) => patch({ explanatoryPanelHowItWorksText })} />
          <TextArea disabled={disabled} label="Campos obrigatórios" value={data.settings.explanatoryPanelRequiredFieldsText} onChange={(explanatoryPanelRequiredFieldsText) => patch({ explanatoryPanelRequiredFieldsText })} />
          <TextArea disabled={disabled} label="Exemplo correto" value={data.settings.explanatoryPanelExampleText} onChange={(explanatoryPanelExampleText) => patch({ explanatoryPanelExampleText })} />
          <TextArea disabled={disabled} label="Observações" value={data.settings.explanatoryPanelNotesText} onChange={(explanatoryPanelNotesText) => patch({ explanatoryPanelNotesText })} />
          <TextArea disabled={disabled} label="Erros comuns" value={data.settings.explanatoryPanelCommonErrorsText} onChange={(explanatoryPanelCommonErrorsText) => patch({ explanatoryPanelCommonErrorsText })} />
          <TextArea disabled={disabled} label="Mensagem final" value={data.settings.explanatoryPanelFinalText} onChange={(explanatoryPanelFinalText) => patch({ explanatoryPanelFinalText })} />
          <Field disabled={disabled} label="Título do modal" value={data.settings.explanatoryPanelModalTitle} onChange={(explanatoryPanelModalTitle) => patch({ explanatoryPanelModalTitle })} />
          <TextArea disabled={disabled} label="Conteúdo do modal" value={data.settings.explanatoryPanelModalContent} onChange={(explanatoryPanelModalContent) => patch({ explanatoryPanelModalContent })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Últimos registros enviados pelo bot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.records.map((record) => (
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between" key={record.id}>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{record.model} · {record.plate}</p>
                <p className="text-xs text-zinc-500">por {record.authorName} · {new Date(record.createdAt).toLocaleString("pt-BR")} · {record.imageUrls.length} imagem(ns)</p>
              </div>
              <Badge variant={record.status === "registered" ? "success" : "danger"}>{record.status === "registered" ? "Registrado" : "Falhou"}</Badge>
            </div>
          ))}
          {!data.records.length ? <p className="py-8 text-center text-zinc-500">Nenhum veículo registrado.</p> : null}
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
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<input className="h-11 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} min={1} max={10} onChange={(event) => onChange(event.target.value)} type={type} value={value} /></label>;
}

function TextArea({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<textarea className="min-h-36 w-full resize-y rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
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
