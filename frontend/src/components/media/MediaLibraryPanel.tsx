import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, Download, FileAudio, Image, Loader2, Search, Settings, Trash2, Upload, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Tab = "library" | "imports" | "settings";
type MediaItem = { id: string; type: "emoji" | "sound"; name: string; fileUrl: string; animated?: boolean | null; category?: string | null; format: string; size?: number | null; source: string; createdAt: string };
type JobItem = { id: string; type: "emoji" | "sound"; name: string; originalName: string; size: number; animated: boolean | null; status: "pending" | "success" | "error" | "duplicate" | "ignored"; errorMessage?: string | null };
type ImportJob = { id: string; zipFileName: string; status: string; totalFiles: number; totalEmojis: number; totalSounds: number; successCount: number; errorCount: number; duplicateCount: number; createdAt: string; logs?: string[]; items?: JobItem[] };
type MediaSettings = { enabled: boolean; allowAuthorizedUsers: boolean; devOnly: boolean; duplicateMode: "ignore" | "rename" | "replace"; soundsLocalOnly: boolean; maxZipSizeMb: number; maxFilesPerZip: number };

const defaultSettings: MediaSettings = { enabled: false, allowAuthorizedUsers: true, devOnly: false, duplicateMode: "ignore", soundsLocalOnly: true, maxZipSizeMb: 50, maxFilesPerZip: 300 };

export function MediaLibraryPanel({ botId, guild, canManage }: { botId: string | null; guild: DashboardGuild | null; canManage: boolean }) {
  const [tab, setTab] = useState<Tab>("library");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [settings, setSettings] = useState<MediaSettings>(defaultSettings);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualUpload, setManualUpload] = useState<{ file: File; type: "emoji" | "sound" } | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState("Geral");
  const zipInput = useRef<HTMLInputElement>(null);
  const emojiInput = useRef<HTMLInputElement>(null);
  const soundInput = useRef<HTMLInputElement>(null);
  const params = useMemo(() => ({ botId: botId || undefined, guildId: guild?.id }), [botId, guild?.id]);

  const load = useCallback(async () => {
    if (!botId || !guild) return;
    try {
      const [library, history, config] = await Promise.all([
        api.get<{ items: MediaItem[] }>("/media/library", { params: { ...params, type, q: query || undefined } }),
        api.get<{ jobs: ImportJob[] }>("/media/import-jobs", { params }),
        api.get<{ settings: MediaSettings }>("/media/settings", { params })
      ]);
      setItems(library.data.items); setJobs(history.data.jobs); setSettings(config.data.settings);
    } catch (error) { setMessage(apiMessage(error)); }
  }, [botId, guild, params, query, type]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const onProgress = (event: { botId: string; guildId: string; jobId: string; current?: number; total?: number; name?: string }) => {
      if (event.botId !== botId || event.guildId !== guild.id) return;
      setMessage(event.current ? `Enviando ${event.current} de ${event.total}: ${event.name || "item"}...` : "Importação finalizada.");
      void refreshJob(event.jobId);
    };
    socket.on("media:job-progress", onProgress);
    return () => { socket.off("media:job-progress", onProgress); socket.disconnect(); };
  }, [botId, guild?.id]);

  async function refreshJob(jobId: string) {
    try { const { data } = await api.get<{ job: ImportJob }>(`/media/import-jobs/${jobId}`, { params }); setSelectedJob(data.job); setJobs((current) => [data.job, ...current.filter((job) => job.id !== jobId)]); if (["completed", "failed"].includes(data.job.status)) await load(); }
    catch { /* polling opportunistic */ }
  }

  async function uploadZip(file?: File) {
    if (!file) return;
    setBusy("zip"); setMessage(null);
    try {
      const form = new FormData(); form.append("file", file); form.append("duplicateMode", settings.duplicateMode);
      const { data } = await api.post<{ job: ImportJob }>("/media/upload-zip", form, { params, timeout: 120000 });
      setSelectedJob(data.job); setTab("imports"); setMessage("ZIP validado. Confira a prévia antes de confirmar."); await load();
    } catch (error) { setMessage(apiMessage(error)); } finally { setBusy(null); if (zipInput.current) zipInput.current.value = ""; }
  }

  async function confirmJob(job: ImportJob) {
    setBusy(job.id);
    try { const { data } = await api.post<{ job: ImportJob }>(`/media/import-jobs/${job.id}/confirm`, { duplicateMode: settings.duplicateMode }, { params }); setSelectedJob(data.job); setMessage("Importação iniciada. O progresso será atualizado em tempo real."); }
    catch (error) { setMessage(apiMessage(error)); } finally { setBusy(null); }
  }

  async function cancelJob(job: ImportJob) {
    setBusy(job.id); try { await api.post(`/media/import-jobs/${job.id}/cancel`, undefined, { params }); setSelectedJob(null); await load(); }
    catch (error) { setMessage(apiMessage(error)); } finally { setBusy(null); }
  }

  function beginManualUpload(file: File | undefined, mediaType: "emoji" | "sound") {
    if (!file) return;
    setManualName(file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_"));
    setManualCategory("Geral");
    setManualUpload({ file, type: mediaType });
  }

  async function uploadSingle() {
    if (!manualUpload || !manualName.trim()) return;
    const { file, type: mediaType } = manualUpload;
    setBusy(mediaType);
    try { const form = new FormData(); form.append("file", file); form.append("name", manualName.trim()); if (mediaType === "sound") form.append("category", manualCategory.trim() || "Geral"); await api.post(`/media/${mediaType}`, form, { params, timeout: 60000 }); setMessage(`${mediaType === "emoji" ? "Emoji" : "Som"} adicionado com sucesso.`); setManualUpload(null); await load(); }
    catch (error) { setMessage(apiMessage(error)); } finally { setBusy(null); if (emojiInput.current) emojiInput.current.value = ""; if (soundInput.current) soundInput.current.value = ""; }
  }

  async function downloadZip(filter = "all") {
    setBusy("download");
    try { const response = await api.get<Blob>("/media/export.zip", { params: { ...params, type: filter }, responseType: "blob", timeout: 120000 }); const url = URL.createObjectURL(response.data); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "emojis-exportados.zip"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (error) { setMessage(apiMessage(error)); } finally { setBusy(null); }
  }

  async function removeItem(item: MediaItem) {
    if (!window.confirm(`Remover ${item.name} da biblioteca?`)) return;
    try { await api.delete(`/media/${encodeURIComponent(item.id)}`, { params }); await load(); }
    catch (error) { setMessage(apiMessage(error)); }
  }

  async function saveSettingsNow() {
    setBusy("settings"); try { const { data } = await api.patch<{ settings: MediaSettings }>("/media/settings", settings, { params }); setSettings(data.settings); setMessage("Configurações salvas."); }
    catch (error) { setMessage(apiMessage(error)); } finally { setBusy(null); }
  }

  if (!botId || !guild) return <Card><CardHeader><CardTitle>Biblioteca de Mídia</CardTitle><CardDescription>Selecione um bot e um servidor para continuar.</CardDescription></CardHeader></Card>;

  return <div className="space-y-5">
    <Card className="border-zinc-800 bg-zinc-950/70"><CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Archive className="h-5 w-5" /> Biblioteca de Mídia</CardTitle><CardDescription>Emojis clonados, pacotes ZIP e efeitos sonoros de {guild.name}.</CardDescription></div><Badge variant={settings.enabled ? "success" : "muted"}>{settings.enabled ? "Sistema ativo" : "Sistema desativado"}</Badge></div></CardHeader><CardContent>
      <div className="flex flex-wrap gap-2">{(["library", "imports", "settings"] as Tab[]).map((value) => <Button key={value} variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)}>{value === "library" ? "Biblioteca" : value === "imports" ? "Importações" : "Configurações"}</Button>)}</div>
      {message ? <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-200">{message}</div> : null}
    </CardContent></Card>

    {tab === "library" ? <>
      <Card><CardContent className="pt-6"><div className="flex flex-wrap gap-2">
        <input ref={zipInput} className="hidden" type="file" accept=".zip,application/zip" onChange={(event) => void uploadZip(event.target.files?.[0])} /><Button disabled={!settings.enabled || busy === "zip" || !canManage} onClick={() => zipInput.current?.click()}>{busy === "zip" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Enviar ZIP</Button>
        <input ref={emojiInput} className="hidden" type="file" accept=".png,.jpg,.jpeg,.webp,.gif" onChange={(event) => beginManualUpload(event.target.files?.[0], "emoji")} /><Button variant="outline" disabled={!settings.enabled || !canManage} onClick={() => emojiInput.current?.click()}><Image className="mr-2 h-4 w-4" />Adicionar Emoji</Button>
        <input ref={soundInput} className="hidden" type="file" accept=".mp3,.ogg,.wav" onChange={(event) => beginManualUpload(event.target.files?.[0], "sound")} /><Button variant="outline" disabled={!settings.enabled || !canManage} onClick={() => soundInput.current?.click()}><FileAudio className="mr-2 h-4 w-4" />Adicionar Som</Button>
        <Button variant="outline" disabled={busy === "download"} onClick={() => void downloadZip()}><Download className="mr-2 h-4 w-4" />Baixar ZIP dos Emojis</Button>
      </div><div className="mt-4 flex flex-wrap gap-2"><div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome" className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm" /></div><select value={type} onChange={(event) => setType(event.target.value)} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm"><option value="all">Todos</option><option value="emoji">Emojis</option><option value="sound">Sons</option></select><select onChange={(event) => event.target.value && void downloadZip(event.target.value)} defaultValue="" className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm"><option value="" disabled>Exportar filtro...</option><option value="static">Só estáticos</option><option value="animated">Só animados</option><option value="sounds">Só sons</option></select></div></CardContent></Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <Card key={item.id}><CardContent className="flex items-center gap-3 pt-5">{item.type === "emoji" ? <img src={item.fileUrl} alt="" className="h-12 w-12 rounded-lg bg-zinc-900 object-contain" /> : <FileAudio className="h-10 w-10 text-violet-400" />}<div className="min-w-0 flex-1"><p className="truncate font-medium">{item.name}</p><p className="text-xs text-zinc-500">{item.type === "emoji" ? item.animated ? "Animado" : "Estático" : item.category || "Som"} · {item.source}</p></div>{!item.id.startsWith("clone:") ? <Button size="icon" variant="ghost" onClick={() => void removeItem(item)}><Trash2 className="h-4 w-4" /></Button> : null}</CardContent></Card>)}</div>
      {!items.length ? <Card><CardContent className="py-10 text-center text-sm text-zinc-500">Nenhum item encontrado nesta biblioteca.</CardContent></Card> : null}
    </> : null}

    {tab === "imports" ? <div className="grid gap-4 lg:grid-cols-[0.9fr_1.4fr]"><Card><CardHeader><CardTitle>Histórico</CardTitle></CardHeader><CardContent className="space-y-2">{jobs.map((job) => <button key={job.id} onClick={() => void refreshJob(job.id)} className="w-full rounded-lg border border-zinc-800 p-3 text-left hover:bg-zinc-900"><div className="flex justify-between gap-2"><span className="truncate font-medium">{job.zipFileName}</span><Status value={job.status} /></div><p className="mt-1 text-xs text-zinc-500">{job.totalFiles} arquivos · {new Date(job.createdAt).toLocaleString("pt-BR")}</p></button>)}</CardContent></Card><JobPreview job={selectedJob} busy={busy} onConfirm={confirmJob} onCancel={cancelJob} /></div> : null}

    {tab === "settings" ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Configurações</CardTitle><CardDescription>Somente o Dev pode liberar e alterar os limites deste sistema.</CardDescription></CardHeader><CardContent className="space-y-4"><Toggle label="Ativar sistema" checked={settings.enabled} onChange={(enabled) => setSettings({ ...settings, enabled })} /><Toggle label="Permitir upload por usuários autorizados" checked={settings.allowAuthorizedUsers} onChange={(allowAuthorizedUsers) => setSettings({ ...settings, allowAuthorizedUsers })} /><Toggle label="Permitir apenas Dev" checked={settings.devOnly} onChange={(devOnly) => setSettings({ ...settings, devOnly })} /><Toggle label="Salvar sons apenas no sistema" checked={settings.soundsLocalOnly} onChange={(soundsLocalOnly) => setSettings({ ...settings, soundsLocalOnly })} /><label className="block text-sm">Duplicados<select value={settings.duplicateMode} onChange={(event) => setSettings({ ...settings, duplicateMode: event.target.value as MediaSettings["duplicateMode"] })} className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3"><option value="ignore">Ignorar</option><option value="rename">Renomear automaticamente</option><option value="replace">Substituir</option></select></label><div className="grid gap-3 sm:grid-cols-2"><NumberField label="Limite do ZIP (MB)" value={settings.maxZipSizeMb} max={50} onChange={(maxZipSizeMb) => setSettings({ ...settings, maxZipSizeMb })} /><NumberField label="Máximo de arquivos" value={settings.maxFilesPerZip} max={300} onChange={(maxFilesPerZip) => setSettings({ ...settings, maxFilesPerZip })} /></div><Button disabled={busy === "settings" || !canManage} onClick={() => void saveSettingsNow()}>{busy === "settings" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar configurações</Button></CardContent></Card> : null}
    {manualUpload ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><Card className="w-full max-w-md"><CardHeader><CardTitle>{manualUpload.type === "emoji" ? "Adicionar Emoji" : "Adicionar Som"}</CardTitle><CardDescription>{manualUpload.file.name} · {formatBytes(manualUpload.file.size)}</CardDescription></CardHeader><CardContent className="space-y-4"><label className="block text-sm">Nome<input autoFocus value={manualName} onChange={(event) => setManualName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3" /></label>{manualUpload.type === "sound" ? <label className="block text-sm">Categoria<input value={manualCategory} onChange={(event) => setManualCategory(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3" /></label> : <p className="text-xs text-zinc-500">O tipo estático ou animado será validado pelo conteúdo do arquivo.</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setManualUpload(null)}>Cancelar</Button><Button disabled={!manualName.trim() || busy === manualUpload.type} onClick={() => void uploadSingle()}>{busy === manualUpload.type && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Adicionar</Button></div></CardContent></Card></div> : null}
  </div>;
}

function JobPreview({ job, busy, onConfirm, onCancel }: { job: ImportJob | null; busy: string | null; onConfirm: (job: ImportJob) => void; onCancel: (job: ImportJob) => void }) {
  if (!job) return <Card><CardContent className="py-12 text-center text-sm text-zinc-500">Selecione uma importação para ver a prévia e o relatório.</CardContent></Card>;
  return <Card><CardHeader><CardTitle>{job.zipFileName}</CardTitle><CardDescription>{job.totalEmojis} emojis · {job.totalSounds} sons · {job.errorCount} inválidos/erros</CardDescription></CardHeader><CardContent><div className="mb-4 flex flex-wrap gap-2"><Status value={job.status} />{job.status === "waiting_confirmation" ? <><Button disabled={busy === job.id} onClick={() => onConfirm(job)}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar Importação</Button><Button variant="outline" onClick={() => onCancel(job)}><XCircle className="mr-2 h-4 w-4" />Cancelar</Button></> : null}</div><div className="max-h-96 space-y-2 overflow-auto">{job.items?.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 p-2 text-sm"><span className="truncate">{item.name} <span className="text-zinc-500">({formatBytes(item.size)})</span></span><Status value={item.status} /></div>)}</div>{job.status === "completed" ? <div className="mt-4 rounded-lg bg-zinc-900 p-4 text-sm"><p className="font-medium">Importação concluída.</p><p className="mt-2 text-zinc-400">Emojis/sons adicionados: {job.successCount}<br />Duplicados ignorados: {job.duplicateCount}<br />Erros: {job.errorCount}</p></div> : null}</CardContent></Card>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800 p-3"><span className="text-sm">{label}</span><Switch checked={checked} onCheckedChange={onChange} /></div>; }
function NumberField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) { return <label className="text-sm">{label}<input type="number" min={1} max={max} value={value} onChange={(event) => onChange(Math.max(1, Math.min(max, Number(event.target.value))))} className="mt-1 h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3" /></label>; }
function Status({ value }: { value: string }) { const positive = ["completed", "success", "active"].includes(value); const negative = ["failed", "error", "cancelled"].includes(value); return <Badge variant={negative ? "danger" : positive ? "success" : "muted"}>{statusLabel(value)}</Badge>; }
function statusLabel(value: string) { return ({ waiting_confirmation: "Aguardando confirmação", importing: "Importando", completed: "Concluída", failed: "Falhou", cancelled: "Cancelada", pending: "Aguardando", success: "Enviado", error: "Erro", duplicate: "Duplicado", ignored: "Ignorado", extracting: "Extraindo" } as Record<string, string>)[value] || value; }
function formatBytes(value: number) { return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`; }
function apiMessage(error: unknown) { const candidate = error as { response?: { data?: { message?: string } }; message?: string }; return candidate.response?.data?.message || candidate.message || "Não foi possível concluir a operação."; }
