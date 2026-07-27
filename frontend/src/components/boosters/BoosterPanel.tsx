import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Heart, ImageIcon, Loader2, Rocket, Save, Search, Trash2, Trophy, Upload, Users } from "lucide-react";
import { getBoosterDashboard, getGuildLiveOptions, saveBoosterSettings, uploadPanelImage } from "../../lib/api";
import type { BoosterDashboard, BoosterHistory, BoosterSettings, DashboardGuild, GuildChannelOption, GuildRoleOption } from "../../types";
import { FivemResourceSelect } from "../fivem/FivemResourceSelect";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

const BOOSTER_BANNER_PANEL_ID = "boosters";
const BOOSTER_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";
const BOOSTER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_BANNER_URL = "";

export function BoosterPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<BoosterDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BoosterHistory["status"]>("all");
  const settingsRef = useRef<BoosterSettings | null>(null);
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
        getBoosterDashboard(botId, guild.id),
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

  const filteredHistory = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.history ?? []).filter((item) => {
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesQuery = !normalized || [item.username, item.userId, item.messageId ?? "", item.error ?? ""].some((value) => value.toLowerCase().includes(normalized));
      return matchesStatus && matchesQuery;
    });
  }, [data?.history, query, statusFilter]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar o Sistema Booster." />;
  if (loading || !data) return <Empty loading text="Carregando Sistema Booster..." />;

  const disabled = !canManage || saving || uploading;
  const dashboard = data;
  const currentGuild = guild;

  function patch(next: Partial<BoosterSettings>) {
    const settingsForSave = { ...(settingsRef.current ?? data!.settings), ...next };
    settingsRef.current = settingsForSave;
    setData((current) => current ? { ...current, settings: settingsForSave } : current);
    if (!canManage || !botId || !guild) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(settingsForSave, "Configurações salvas."), 500);
  }

  async function saveNow(settings: BoosterSettings = settingsRef.current ?? data!.settings, success = "Configurações salvas.") {
    if (!canManage || !botId || !guild) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveBoosterSettings(botId, guild.id, settings);
      settingsRef.current = saved;
      setData((current) => current ? { ...current, settings: saved } : current);
      setMessage(success);
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function uploadBanner(file: File | null) {
    if (!file || disabled || !botId || !guild) return;
    if (!isAllowedImage(file)) {
      setMessage("Formato inválido. Envie PNG, JPG, JPEG, WEBP ou GIF.");
      return;
    }
    if (file.size > BOOSTER_IMAGE_MAX_BYTES) {
      setMessage("Imagem muito grande. Envie até 10MB.");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const image = await uploadPanelImage(currentGuild.id, BOOSTER_BANNER_PANEL_ID, file, botId);
      const next = { ...(settingsRef.current ?? dashboard.settings), bannerUrl: image.imageUrl, bannerEnabled: true };
      settingsRef.current = next;
      setData((current) => current ? { ...current, settings: next } : current);
      await saveNow(next, "Banner do Sistema Booster enviado.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setUploading(false);
    }
  }

  function exportHistory(format: "csv" | "json") {
    const filename = `booster-history-${currentGuild.id}.${format}`;
    const content = format === "json" ? JSON.stringify(filteredHistory, null, 2) : toCsv(filteredHistory);
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-[#FFD500]" />Sistema Booster</CardTitle>
              <CardDescription>Detecta boosts automaticamente, entrega cargo, publica agradecimento em Components V2 e salva histórico por bot e servidor.</CardDescription>
            </div>
            <Badge variant={data.settings.enabled ? "success" : "muted"}>{data.settings.enabled ? "Ativo" : "Desativado"}</Badge>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 p-3 text-sm text-zinc-100">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="Hoje" value={data.stats.today} />
        <Metric label="Semana" value={data.stats.week} />
        <Metric label="Mês" value={data.stats.month} />
        <Metric label="Total" value={data.stats.total} />
        <Metric label="Ativos" value={data.stats.activeBoosters} />
        <Metric label="Último Booster" value={data.stats.lastBooster?.username ?? "-"} compact />
        <Metric label="Maior Booster" value={data.stats.topBooster?.username ?? "-"} compact />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Configurações</CardTitle>
            <CardDescription>Cada bot e servidor usam uma configuração isolada.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <FivemResourceSelect disabled={disabled} label="Cargo Booster" options={roles} prefix="@" value={data.settings.boosterRoleId} onChange={(boosterRoleId) => patch({ boosterRoleId })} />
            <FivemResourceSelect disabled={disabled} label="Canal de Agradecimento" options={channels} prefix="#" value={data.settings.announcementChannelId} onChange={(announcementChannelId) => patch({ announcementChannelId })} />
            <FivemResourceSelect disabled={disabled} label="Canal de Logs" options={channels} prefix="#" value={data.settings.logChannelId} onChange={(logChannelId) => patch({ logChannelId })} />
            <Field disabled={disabled} label="Cor do painel" type="color" value={data.settings.embedColor} onChange={(embedColor) => patch({ embedColor })} />
            <Toggle disabled={disabled} label="Sistema Ativado" value={data.settings.enabled} onChange={(enabled) => patch({ enabled })} />
            <Toggle disabled={disabled} label="Gerar Banner" value={data.settings.bannerEnabled} onChange={(bannerEnabled) => patch({ bannerEnabled })} />
            <Toggle disabled={disabled} label="Enviar Mensagem" value={data.settings.messageEnabled} onChange={(messageEnabled) => patch({ messageEnabled })} />
            <Toggle disabled={disabled} label="Mostrar Avatar" value={data.settings.showAvatar} onChange={(showAvatar) => patch({ showAvatar })} />
            <Toggle disabled={disabled} label="Mostrar Data" value={data.settings.showTimestamp} onChange={(showTimestamp) => patch({ showTimestamp })} />
            <div className="lg:col-span-2">
              <TextArea disabled={disabled} label="Mensagem personalizada" value={data.settings.message} onChange={(messageValue) => patch({ message: messageValue })} />
              <p className="mt-1 text-xs text-zinc-500">Variáveis: {"{usuario} {servidor} {boosts} {nivel} {cargo} {data} {mencao}"}</p>
            </div>
            <div className="lg:col-span-2">
              <TextArea disabled={disabled} label="Mensagem de benefícios por DM" value={data.settings.benefitsMessage} onChange={(benefitsMessage) => patch({ benefitsMessage })} />
            </div>
            <div className="space-y-3 lg:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <Field disabled={disabled} label="URL do banner" value={data.settings.bannerUrl ?? ""} onChange={(bannerUrl) => patch({ bannerUrl: bannerUrl || null })} />
                <div className="flex flex-wrap gap-2">
                  <label className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#FFD500]/25 px-3 text-sm font-semibold text-zinc-100 ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-[#FFD500]/10"}`}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Enviar banner
                    <input accept={BOOSTER_IMAGE_ACCEPT} className="hidden" disabled={disabled} type="file" onChange={(event) => void uploadBanner(event.target.files?.[0] ?? null)} />
                  </label>
                  <Button disabled={disabled || !data.settings.bannerUrl} type="button" variant="outline" onClick={() => patch({ bannerUrl: null })}><Trash2 className="h-4 w-4" />Remover</Button>
                  <Button disabled={disabled} type="button" variant="ghost" onClick={() => patch({ bannerUrl: DEFAULT_BANNER_URL || null })}>Restaurar padrão</Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black/40">
                {data.settings.bannerUrl ? <img alt="Banner Booster" className="max-h-72 w-full object-contain" src={data.settings.bannerUrl} /> : <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-zinc-500"><ImageIcon className="h-5 w-5" />Nenhum banner configurado</div>}
              </div>
            </div>
            <div className="flex justify-end lg:col-span-2">
              <Button disabled={disabled} onClick={() => void saveNow()}><Save className="h-4 w-4" />Salvar</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pré-visualização</CardTitle>
            <CardDescription>Representação do painel enviado no Discord.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-zinc-800 bg-[#313338] p-4 text-sm text-white shadow-inner">
              <div className="rounded-md border-l-4 p-3" style={{ borderLeftColor: data.settings.embedColor }}>
                <h3 className="text-lg font-bold">Nova melhoria no servidor</h3>
                <p className="mt-2 whitespace-pre-line text-zinc-100">{previewText(data.settings.message, guild.name)}</p>
                {data.settings.bannerEnabled && data.settings.bannerUrl ? <img alt="" className="mt-3 max-h-48 w-full rounded-md object-cover" src={data.settings.bannerUrl} /> : null}
                <div className="mt-3 grid gap-2 text-xs text-zinc-200">
                  <span>Cliente: @Usuario</span>
                  <span>Boosts: 152</span>
                  <span>Nível: 3</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold"><Heart className="h-3 w-3" />Agradecer</span>
                  <span className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-semibold"><Rocket className="h-3 w-3" />Ver Benefícios</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-[#FFD500]" />Histórico de Boosts</CardTitle>
              <CardDescription>Pesquisar, filtrar, ordenar e exportar registros processados pelo bot.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => exportHistory("csv")}><Download className="h-4 w-4" />CSV</Button>
              <Button size="sm" variant="outline" onClick={() => exportHistory("json")}><Download className="h-4 w-4" />JSON</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input className="h-10 w-full rounded-lg border border-zinc-800 bg-black pl-9 pr-3 text-sm outline-none focus:border-[#FFD500]/60" placeholder="Pesquisar usuário, ID ou erro" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <select className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">Todos os status</option>
              <option value="processed">Processados</option>
              <option value="failed">Falhas</option>
              <option value="skipped">Ignorados</option>
            </select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-black/40 text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Usuário</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Boosts</th>
                  <th className="px-3 py-2">Nível</th>
                  <th className="px-3 py-2">Cargo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {filteredHistory.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {item.avatarUrl ? <img alt="" className="h-7 w-7 rounded-full" src={item.avatarUrl} /> : <div className="h-7 w-7 rounded-full bg-zinc-800" />}
                        <span className="font-medium text-zinc-100">{item.username}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{formatDate(item.createdAt)}</td>
                    <td className="px-3 py-2"><Badge variant={item.status === "processed" ? "success" : item.status === "failed" ? "danger" : "muted"}>{statusLabel(item.status)}</Badge></td>
                    <td className="px-3 py-2 text-zinc-300">{item.boostCount}</td>
                    <td className="px-3 py-2 text-zinc-300">{item.boostLevel}</td>
                    <td className="px-3 py-2 text-zinc-300">{item.roleGiven ? "Entregue" : "Não"}</td>
                  </tr>
                ))}
                {!filteredHistory.length ? <tr><td className="px-3 py-10 text-center text-zinc-500" colSpan={6}>Nenhum boost encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ compact, label, value }: { compact?: boolean; label: string; value: number | string }) {
  return <Card><CardContent className="p-4"><p className="text-xs font-medium text-zinc-500">{label}</p><p className={`mt-1 truncate font-bold text-white ${compact ? "text-lg" : "text-2xl"}`}>{value}</p></CardContent></Card>;
}

function Toggle({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/30 px-3 text-sm text-zinc-200"><span>{label}</span><Switch checked={value} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled?: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="grid min-w-64 flex-1 gap-2 text-xs font-medium text-zinc-400">{label}<input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60 disabled:opacity-60" disabled={disabled} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextArea({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<textarea className="min-h-32 w-full resize-y rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60 disabled:opacity-60" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Empty({ loading, text }: { loading?: boolean; text: string }) {
  return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-zinc-500">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>;
}

function previewText(template: string, guildName: string) {
  return template.replaceAll("{usuario}", "Usuario").replaceAll("{servidor}", guildName).replaceAll("{boosts}", "152").replaceAll("{nivel}", "3").replaceAll("{cargo}", "@Booster").replaceAll("{data}", "26/07/2026").replaceAll("{mencao}", "@Usuario");
}

function isAllowedImage(file: File) {
  const name = file.name.toLowerCase();
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || /\.(png|jpe?g|webp|gif)$/.test(name);
}

function readMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function statusLabel(status: BoosterHistory["status"]) {
  if (status === "processed") return "Processado";
  if (status === "failed") return "Falha";
  return "Ignorado";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

function toCsv(rows: BoosterHistory[]) {
  const header = ["id", "userId", "username", "createdAt", "status", "boostCount", "boostLevel", "roleGiven", "messageSent", "bannerSent", "error"];
  const body = rows.map((row) => header.map((key) => csvCell((row as unknown as Record<string, unknown>)[key])).join(","));
  return [header.join(","), ...body].join("\n");
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
}
