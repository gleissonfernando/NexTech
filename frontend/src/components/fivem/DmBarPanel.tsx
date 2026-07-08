import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Loader2, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { getDmBarDashboard, getGuildLiveOptions, removeDmBarImage, resetDmBarConfig, saveDmBarConfig, uploadDmBarImage } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild, DmBarConfig, DmBarDashboard, GuildChannelOption, GuildRoleOption } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceMultiSelect, FivemResourceSelect } from "./FivemResourceSelect";

export function DmBarPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<DmBarDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestConfig = useRef<DmBarConfig | null>(null);

  async function load() {
    if (!botId || !guild) return;
    const [dashboard, options] = await Promise.all([getDmBarDashboard(guild.id, botId), getGuildLiveOptions(guild.id, botId)]);
    setData(dashboard);
    setChannels(options.channels);
    setRoles(options.roles);
  }

  useEffect(() => {
    if (!botId || !guild) { setLoading(false); return; }
    let mounted = true;
    setLoading(true);
    load().catch((error) => mounted && setMessage(readMessage(error))).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const refresh = () => void getDmBarDashboard(guild.id, botId).then(setData).catch(() => undefined);
    socket.on("dm-bar:settings_updated", refresh);
    socket.on("dm-bar:log_created", refresh);
    return () => { socket.off("dm-bar:settings_updated", refresh); socket.off("dm-bar:log_created", refresh); socket.disconnect(); };
  }, [botId, guild?.id]);

  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);

  useEffect(() => {
    latestConfig.current = data?.config ?? null;
  }, [data?.config]);

  const lastLog = useMemo(() => data?.logs.find((log) => log.status === "sent" || log.status === "test") ?? null, [data]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar a Barra DM." />;
  if (loading || !data) return <Empty loading text="Carregando Barra DM..." />;

  const config = data.config;
  const patch = (next: Partial<DmBarConfig>) => {
    const nextConfig = { ...(latestConfig.current ?? config), ...next };
    latestConfig.current = nextConfig;
    setDirty(true);
    setData((current) => current ? { ...current, config: nextConfig } : current);
    scheduleAutosave(nextConfig);
  };

  function scheduleAutosave(nextConfig: DmBarConfig) {
    if (!canManage || !botId || !guild) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setSaving(true);
      void saveDmBarConfig(guild.id, botId, nextConfig)
        .then((saved) => {
          latestConfig.current = saved;
          setData((current) => current ? { ...current, config: saved } : current);
          setDirty(false);
          setMessage("Configurações salvas automaticamente.");
        })
        .catch((error) => setMessage(readMessage(error)))
        .finally(() => setSaving(false));
    }, 900);
  }

  async function save() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSaving(true); setMessage(null);
    try { const next = await saveDmBarConfig(guild!.id, botId!, latestConfig.current ?? config); latestConfig.current = next; setData((current) => current ? { ...current, config: next } : current); setDirty(false); setMessage("Configurações salvas com sucesso."); }
    catch (error) { setMessage(readMessage(error)); }
    finally { setSaving(false); }
  }
  async function reset() {
    if (!confirm("Restaurar padrão da Barra DM?")) return;
    setSaving(true);
    try { const next = await resetDmBarConfig(guild!.id, botId!); latestConfig.current = next; setData((current) => current ? { ...current, config: next } : current); setDirty(false); }
    catch (error) { setMessage(readMessage(error)); }
    finally { setSaving(false); }
  }
  async function upload(kind: "main" | "footer", file: File | null) {
    if (!file) return;
    setSaving(true); setMessage(null);
    try { const next = await uploadDmBarImage(guild!.id, botId!, kind, file); latestConfig.current = next; setData((current) => current ? { ...current, config: next } : current); setDirty(false); setMessage("Imagem enviada."); }
    catch (error) { setMessage(readMessage(error)); }
    finally { setSaving(false); }
  }
  async function removeImage(kind: "main" | "footer") {
    setSaving(true);
    try { const next = await removeDmBarImage(guild!.id, botId!, kind); latestConfig.current = next; setData((current) => current ? { ...current, config: next } : current); setDirty(false); }
    catch (error) { setMessage(readMessage(error)); }
    finally { setSaving(false); }
  }

  return <div className="space-y-5">
    <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-emerald-300" />Barra DM</CardTitle><CardDescription>Envio de mensagens privadas com painel visual, permissões, imagens e logs.</CardDescription></div><Button disabled={!canManage || saving || !dirty} onClick={() => void save()} size="sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar alterações</Button></div></CardHeader></Card>
    {message ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-white">{message}</div> : null}
    {dirty ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">Salvando alterações automaticamente. O botão Salvar alterações também aplica agora.</div> : null}
    <div className="grid gap-3 sm:grid-cols-5">
      <Metric label="Status" value={config.enabled ? "Ativo" : "Desativado"} />
      <Metric label="Servidor" value={guild.name} />
      <Metric label="DMs enviadas" value={data.stats.sentCount} />
      <Metric label="Última DM" value={lastLog ? new Date(lastLog.sentAt).toLocaleString("pt-BR") : "Nunca"} />
      <Metric label="Último usuário" value={data.stats.lastSenderId ?? "Nenhum"} />
    </div>
    <Card><CardHeader><CardTitle>Status e permissões</CardTitle></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Módulo ativo<Switch checked={config.enabled} disabled={!canManage} onCheckedChange={(enabled) => patch({ enabled })} /></label>
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Admins sempre podem usar<Switch checked={config.allowAdmins} disabled={!canManage} onCheckedChange={(allowAdmins) => patch({ allowAdmins })} /></label>
      <FivemResourceMultiSelect disabled={!canManage} label="Cargos autorizados a usar o /dm" options={roles} values={config.allowedRoleIds} onChange={(allowedRoleIds) => patch({ allowedRoleIds })} />
      <label className="grid gap-2 text-xs font-medium text-zinc-400">Usuários autorizados por ID<input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" disabled={!canManage} value={config.allowedUserIds.join(", ")} onChange={(event) => patch({ allowedUserIds: event.target.value.split(/[,\s]+/).filter(Boolean) })} /></label>
      <FivemResourceSelect disabled={!canManage} label="Canal de logs" options={channels} value={config.logChannelId} onChange={(logChannelId) => patch({ logChannelId })} />
      <label className="grid gap-2 text-xs font-medium text-zinc-400">Cooldown por usuário (segundos)<input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" disabled={!canManage} min={0} max={3600} type="number" value={config.cooldownSeconds} onChange={(event) => patch({ cooldownSeconds: Number(event.target.value) })} /></label>
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Logs ativos<Switch checked={config.logsEnabled} disabled={!canManage} onCheckedChange={(logsEnabled) => patch({ logsEnabled })} /></label>
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Permitir menções<Switch checked={config.allowMentions} disabled={!canManage} onCheckedChange={(allowMentions) => patch({ allowMentions })} /></label>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Mensagem da DM</CardTitle><CardDescription>Variáveis: {"{usuario}"}, {"{usuario_nome}"}, {"{servidor}"}, {"{data}"}, {"{hora}"}, {"{mensagem}"}.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">
      <Input disabled={!canManage} label="Título" value={config.titleTemplate} onChange={(titleTemplate) => patch({ titleTemplate })} />
      <Input disabled={!canManage} label="Emoji" value={config.emoji} onChange={(emoji) => patch({ emoji })} />
      <Textarea disabled={!canManage} label="Descrição principal" value={config.descriptionTemplate} onChange={(descriptionTemplate) => patch({ descriptionTemplate })} />
      <Textarea disabled={!canManage} label="Assinatura automática" value={config.signature} onChange={(signature) => patch({ signature })} />
      <Input disabled={!canManage} label="Cor/acento" type="color" value={config.accentColor} onChange={(accentColor) => patch({ accentColor })} />
      <label className="grid gap-2 text-xs font-medium text-zinc-400">Posição da imagem<select className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" disabled={!canManage} value={config.imagePosition} onChange={(event) => patch({ imagePosition: event.target.value as DmBarConfig["imagePosition"] })}><option value="top">Topo</option><option value="middle">Meio</option><option value="bottom">Final</option><option value="gallery">Galeria</option><option value="thumbnail">Miniatura lateral</option><option value="none">Sem imagem</option></select></label>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Imagens e rodapé</CardTitle></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">
      <ImageUpload disabled={!canManage || saving} label="Imagem principal" url={config.mainImageUrl} onUpload={(file) => void upload("main", file)} onRemove={() => void removeImage("main")} />
      <ImageUpload disabled={!canManage || saving} label="Imagem pequena do rodapé" url={config.footerIconUrl} onUpload={(file) => void upload("footer", file)} onRemove={() => void removeImage("footer")} />
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Rodapé ativo<Switch checked={config.footerEnabled} disabled={!canManage} onCheckedChange={(footerEnabled) => patch({ footerEnabled })} /></label>
      <Textarea disabled={!canManage} label="Texto do rodapé" value={config.footerText} onChange={(footerText) => patch({ footerText })} />
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Mostrar servidor<Switch checked={config.showServer} disabled={!canManage} onCheckedChange={(showServer) => patch({ showServer })} /></label>
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Mostrar data/hora<Switch checked={config.showDate} disabled={!canManage} onCheckedChange={(showDate) => patch({ showDate })} /></label>
      <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3 text-sm text-white">Mostrar ID do usuário<Switch checked={config.showTargetId} disabled={!canManage} onCheckedChange={(showTargetId) => patch({ showTargetId })} /></label>
    </CardContent></Card>
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <Card><CardHeader><CardTitle>Histórico</CardTitle></CardHeader><CardContent className="space-y-2">{data.logs.map((log) => <div className="rounded-lg border border-zinc-800 p-3" key={log.id}><p className="text-sm font-semibold text-white">{log.title} · {log.status}</p><p className="mt-1 truncate text-xs text-zinc-500">Autor {log.senderId} → {log.targetId ?? "sem alvo"} · {new Date(log.sentAt).toLocaleString("pt-BR")}</p></div>)}{!data.logs.length ? <p className="py-8 text-center text-zinc-500">Nenhum log da Barra DM.</p> : null}</CardContent></Card>
      <Card><CardHeader><CardTitle>Pré-visualização</CardTitle></CardHeader><CardContent><Preview config={config} guildName={guild.name} /><div className="mt-4 flex flex-col gap-2"><Button disabled={!canManage || saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar alterações</Button><Button disabled={!canManage || saving} onClick={() => void reset()} variant="outline"><RefreshCw className="h-4 w-4" />Restaurar padrão</Button></div></CardContent></Card>
    </div>
  </div>;
}

function Empty({ text, loading = false }: { text: string; loading?: boolean }) { return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-zinc-400">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 truncate text-lg font-bold text-white">{value}</p></CardContent></Card>; }
function Input({ disabled, label, onChange, type = "text", value }: { disabled: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) { return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white" disabled={disabled} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Textarea({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) { return <label className="grid gap-2 text-xs font-medium text-zinc-400">{label}<textarea className="min-h-32 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-white" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function ImageUpload({ disabled, label, onRemove, onUpload, url }: { disabled: boolean; label: string; onRemove: () => void; onUpload: (file: File | null) => void; url: string | null }) { return <div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs font-medium text-zinc-400">{label}</p>{url ? <img className="mt-3 max-h-40 rounded-lg object-contain" src={url} /> : <div className="mt-3 flex h-28 items-center justify-center rounded-lg bg-black text-zinc-600"><ImageIcon className="h-6 w-6" /></div>}<div className="mt-3 flex gap-2"><input accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" disabled={disabled} onChange={(event) => onUpload(event.target.files?.[0] ?? null)} type="file" /><Button disabled={disabled || !url} onClick={onRemove} size="sm" variant="destructive"><Trash2 className="h-4 w-4" /></Button></div></div>; }
function Preview({ config, guildName }: { config: DmBarConfig; guildName: string }) { const text = applyVars(stripSenderLines(config.descriptionTemplate), guildName); return <div className="rounded-lg border border-zinc-800 bg-[#101114] p-4"><p className="text-lg font-bold text-white">{applyVars(config.titleTemplate, guildName)}</p>{config.mainImageUrl ? <img className="my-3 max-h-40 rounded-md object-cover" src={config.mainImageUrl} /> : null}<p className="whitespace-pre-wrap text-sm text-zinc-300">{text}</p>{config.footerEnabled ? <div className="mt-4 border-t border-zinc-700 pt-3 text-xs text-zinc-500">{config.emoji} {applyVars(stripSenderLines(config.footerText), guildName)}</div> : null}</div>; }
function stripSenderLines(value: string) { return value.split(/\r?\n/).filter((line) => !/\{autor(?:_nome)?\}|\{id_autor\}|enviado\s+por/i.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim(); }
function applyVars(value: string, guildName: string) { return value.replaceAll("{usuario}", "@Usuario").replaceAll("{usuario_nome}", "Usuario").replaceAll("{usuario_nick}", "Usuario").replaceAll("{autor}", "").replaceAll("{autor_nome}", "").replaceAll("{servidor}", guildName).replaceAll("{data}", new Date().toLocaleDateString("pt-BR")).replaceAll("{hora}", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })).replaceAll("{mensagem}", "Mensagem de exemplo da Barra DM.").replaceAll("{id_usuario}", "123456789").replaceAll("{id_autor}", ""); }
function readMessage(error: unknown) { return (error as any)?.response?.data?.message ?? "Não foi possível concluir a operação."; }
