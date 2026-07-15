import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, Plus, Save, Send, Shield, Trash2 } from "lucide-react";
import { createFivemAction, deleteFivemAction, getFivemActions, getGuildLiveOptions, publishFivemActionsPanel, saveFivemActionSettings, updateFivemAction, uploadPanelImage } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild, FivemActionArchitecture, FivemActionDashboard, FivemActionDefinition, GuildCategoryOption, GuildChannelOption } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceSelect } from "./FivemResourceSelect";

type FivemActionsPanelProps = {
  botId?: string | null;
  canManage: boolean;
  fixedArchitecture?: FivemActionArchitecture;
  guild: DashboardGuild | null;
};

export function FivemActionsPanel({ botId, canManage, fixedArchitecture, guild }: FivemActionsPanelProps) {
  const [architecture, setArchitecture] = useState<FivemActionArchitecture>(fixedArchitecture ?? "fac");
  const [dashboard, setDashboard] = useState<FivemActionDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (fixedArchitecture) {
      setArchitecture(fixedArchitecture);
    }
  }, [fixedArchitecture]);

  const reloadDashboard = useCallback(async () => {
    if (!botId || !guild) return;
    const [data, options] = await Promise.all([getFivemActions(guild.id, architecture, botId), getGuildLiveOptions(guild.id, botId)]);
    setDashboard(data);
    setChannels(options.channels);
    setCategories(options.categories ?? []);
  }, [architecture, botId, guild]);

  useEffect(() => { if (!botId || !guild) { setLoading(false); return; } let active = true; setLoading(true); reloadDashboard().catch((error) => active && setMessage(readMessage(error))).finally(() => active && setLoading(false)); return () => { active = false; }; }, [botId, guild?.id, reloadDashboard]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const refresh = (payload: { architecture?: FivemActionArchitecture; botId?: string | null; guildId?: string }) => {
      if (payload.guildId === guild.id && payload.botId === botId && payload.architecture === architecture) {
        void reloadDashboard().catch((error) => setMessage(readMessage(error)));
      }
    };
    socket.on("fivem:actions:updated", refresh);
    return () => { socket.off("fivem:actions:updated", refresh); socket.disconnect(); };
  }, [architecture, botId, guild, reloadDashboard]);

  if (!botId || !guild) return <Empty text="Selecione um bot e um servidor para configurar o Sistema de Ações." />;
  if (loading || !dashboard) return <Empty loading text="Carregando Sistema de Ações..." />;
  const settings = dashboard.settings;
  const scopedTitle = architecture === "police" ? "Acoes Policiais" : "Acoes FAC";
  const scopedDescription = architecture === "police" ? "Sistema policial separado, com painel, acoes e relatorios proprios." : "Sistema FAC separado, com painel, acoes e relatorios proprios.";
  const HeaderIcon = architecture === "police" ? Shield : Activity;
  const patchSettings = (patch: Partial<typeof settings>) => setDashboard((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);

  async function saveSettings() { setBusy("settings"); setMessage(null); try { const saved = await saveFivemActionSettings(guild!.id, architecture, botId!, settings); patchSettings(saved); setMessage("Configurações salvas."); } catch (error) { setMessage(readMessage(error)); } finally { setBusy(null); } }
  async function publish() { setBusy("publish"); setMessage(null); try { const saved = await publishFivemActionsPanel(guild!.id, architecture, botId!); patchSettings(saved); setMessage("Publicação solicitada ao bot."); } catch (error) { setMessage(readMessage(error)); } finally { setBusy(null); } }
  async function uploadImage(file: File) { setBusy("image"); try { const image = await uploadPanelImage(guild!.id, `fivem-actions-${architecture}`, file, botId); patchSettings({ imageUrl: image.imageUrl, imagePosition: settings.imagePosition === "none" ? "top" : settings.imagePosition }); setMessage("Imagem enviada. Salve as configurações para aplicar."); } catch (error) { setMessage(readMessage(error)); } finally { setBusy(null); } }
  async function addAction() { setBusy("create"); try { const action = await createFivemAction(guild!.id, architecture, botId!, { name: "Nova ação", description: "Descrição da ação", maxParticipants: 6, color: "#FFD500", enabled: true, order: dashboard!.actions.length }); setDashboard((current) => current ? { ...current, actions: [...current.actions, action] } : current); } catch (error) { setMessage(readMessage(error)); } finally { setBusy(null); } }
  async function saveAction(action: FivemActionDefinition) { setBusy(action.id); try { const saved = await updateFivemAction(guild!.id, architecture, botId!, action.id, action); setDashboard((current) => current ? { ...current, actions: current.actions.map((item) => item.id === saved.id ? saved : item) } : current); setMessage(`${saved.name} salva.`); } catch (error) { setMessage(readMessage(error)); } finally { setBusy(null); } }
  async function removeAction(action: FivemActionDefinition) { if (!confirm(`Excluir ${action.name}?`)) return; setBusy(action.id); try { await deleteFivemAction(guild!.id, architecture, botId!, action.id); setDashboard((current) => current ? { ...current, actions: current.actions.filter((item) => item.id !== action.id) } : current); } catch (error) { setMessage(readMessage(error)); } finally { setBusy(null); } }
  const updateAction = (id: string, patch: Partial<FivemActionDefinition>) => setDashboard((current) => current ? { ...current, actions: current.actions.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);

  return <div className="space-y-5">
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><HeaderIcon className="h-5 w-5 text-[#FFEA70]" />{scopedTitle}</CardTitle><CardDescription>{scopedDescription}</CardDescription></div>{fixedArchitecture ? null : <div className="flex gap-2"><Button variant={architecture === "fac" ? "default" : "outline"} onClick={() => setArchitecture("fac")}><Activity className="h-4 w-4" />FAC</Button><Button variant={architecture === "police" ? "default" : "outline"} onClick={() => setArchitecture("police")}><Shield className="h-4 w-4" />Polícia</Button></div>}</div></CardHeader></Card>
    {message ? <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 p-3 text-sm text-white">{message}</div> : null}
    <Card><CardHeader><CardTitle>Configuração {architecture === "fac" ? "FAC" : "Polícia"}</CardTitle><CardDescription>Painel principal, painel da ação e relatórios.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
      <label className="text-sm text-zinc-300">Título<input className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black px-3" value={settings.panelTitle} disabled={!canManage} onChange={(e) => patchSettings({ panelTitle: e.target.value })} /></label>
      <label className="text-sm text-zinc-300">Cor<input className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black px-3" type="color" value={settings.color} disabled={!canManage} onChange={(e) => patchSettings({ color: e.target.value })} /></label>
      <label className="md:col-span-2 text-sm text-zinc-300">Descrição<textarea className="mt-2 min-h-24 w-full rounded-lg border border-zinc-800 bg-black p-3" value={settings.panelDescription} disabled={!canManage} onChange={(e) => patchSettings({ panelDescription: e.target.value })} /></label>
      <FivemResourceSelect disabled={!canManage} label="Canal do painel principal" options={channels} value={settings.panelChannelId} onChange={(panelChannelId) => patchSettings({ panelChannelId })} />
      <FivemResourceSelect disabled={!canManage} label="Canal dos painéis de ação" options={channels} value={settings.actionChannelId} onChange={(actionChannelId) => patchSettings({ actionChannelId })} />
      <FivemResourceSelect disabled={!canManage} label="Canal de relatórios (opcional)" options={channels} value={settings.reportChannelId} onChange={(reportChannelId) => patchSettings({ reportChannelId })} />
      <FivemResourceSelect disabled={!canManage} label="Categoria para relatórios automáticos" options={categories} value={settings.categoryId} onChange={(categoryId) => patchSettings({ categoryId })} />
      <label className="text-sm text-zinc-300">Imagem URL<input className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black px-3" value={settings.imageUrl ?? ""} disabled={!canManage} onChange={(e) => patchSettings({ imageUrl: e.target.value || null })} /></label>
      <label className="text-sm text-zinc-300">Posição da imagem<select className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-black px-3" value={settings.imagePosition} disabled={!canManage} onChange={(e) => patchSettings({ imagePosition: e.target.value as typeof settings.imagePosition })}><option value="top">Topo</option><option value="center">Centro</option><option value="bottom">Rodapé</option><option value="none">Sem imagem</option></select></label>
      <label className="md:col-span-2 text-sm text-zinc-300">Enviar imagem<input className="mt-2 block w-full rounded-lg border border-zinc-800 bg-black p-2" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!canManage || busy !== null} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadImage(file); }} /></label>
      <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><Switch checked={settings.enabled} disabled={!canManage} onCheckedChange={(enabled) => patchSettings({ enabled })} />Sistema ativo</label><div className="flex gap-2"><Button disabled={!canManage || busy !== null} onClick={() => void saveSettings()}>{busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar</Button><Button disabled={!canManage || busy !== null || !settings.panelChannelId || !settings.actionChannelId || !dashboard.actions.length} onClick={() => void publish()}>{busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publicar painel</Button></div></div>
    </CardContent></Card>
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Ações cadastradas</CardTitle><CardDescription>Sem ações fixas: o menu do Discord é gerado deste cadastro.</CardDescription></div><Button disabled={!canManage || busy !== null} onClick={() => void addAction()}><Plus className="h-4 w-4" />Nova ação</Button></div></CardHeader><CardContent className="space-y-3">{dashboard.actions.map((action) => <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 md:grid-cols-[90px_minmax(0,1fr)_160px_auto]" key={action.id}><div className="space-y-2"><input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3" value={action.emoji ?? ""} placeholder="Emoji" disabled={!canManage} onChange={(e) => updateAction(action.id, { emoji: e.target.value || null })} /><input className="h-10 w-full rounded-lg border border-zinc-800 bg-black p-1" type="color" value={action.color} disabled={!canManage} onChange={(e) => updateAction(action.id, { color: e.target.value })} /></div><div className="space-y-2"><input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 font-semibold" value={action.name} disabled={!canManage} onChange={(e) => updateAction(action.id, { name: e.target.value })} /><textarea className="min-h-16 w-full rounded-lg border border-zinc-800 bg-black p-3 text-sm" value={action.description} disabled={!canManage} onChange={(e) => updateAction(action.id, { description: e.target.value })} /><input className="h-10 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm" value={action.imageUrl ?? ""} placeholder="URL da imagem da ação" disabled={!canManage} onChange={(e) => updateAction(action.id, { imageUrl: e.target.value || null })} /></div><div className="space-y-3"><label className="block text-xs text-zinc-400">Limite<input className="mt-2 h-10 w-full rounded-lg border border-zinc-800 bg-black px-3" type="number" min={1} max={100} value={action.maxParticipants} disabled={!canManage} onChange={(e) => updateAction(action.id, { maxParticipants: Number(e.target.value) })} /></label><label className="block text-xs text-zinc-400">Ordem<input className="mt-2 h-10 w-full rounded-lg border border-zinc-800 bg-black px-3" type="number" min={0} value={action.order} disabled={!canManage} onChange={(e) => updateAction(action.id, { order: Number(e.target.value) })} /></label><label className="flex items-center gap-2 text-xs text-zinc-300"><Switch checked={action.enabled} disabled={!canManage} onCheckedChange={(enabled) => updateAction(action.id, { enabled })} />Ativa</label></div><div className="flex items-start gap-2"><Button size="icon" disabled={!canManage || busy !== null} onClick={() => void saveAction(action)}>{busy === action.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</Button><Button size="icon" variant="destructive" disabled={!canManage || busy !== null} onClick={() => void removeAction(action)}><Trash2 className="h-4 w-4" /></Button></div></div>)}{!dashboard.actions.length ? <p className="py-8 text-center text-sm text-zinc-500">Nenhuma ação cadastrada nesta arquitetura.</p> : null}</CardContent></Card>
    <Card><CardHeader><CardTitle>Histórico</CardTitle><CardDescription>Últimas 100 ações persistidas.</CardDescription></CardHeader><CardContent className="space-y-2">{dashboard.history.map((session) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3" key={session.id}><div><p className="font-semibold text-white">{session.actionName}</p><p className="text-xs text-zinc-500">{new Date(session.startedAt).toLocaleString("pt-BR")} · {session.openerName} · {actionModeLabel(session.mode)}</p></div><Badge variant={session.status === "victory" ? "success" : session.status === "defeat" ? "danger" : "muted"}>{session.status === "active" ? "Em andamento" : session.status === "victory" ? "Vitória" : "Derrota"}</Badge></div>)}</CardContent></Card>
  </div>;
}

function Empty({ text, loading = false }: { text: string; loading?: boolean }) { return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 p-6 text-zinc-400">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>; }
function actionModeLabel(mode: FivemActionDashboard["history"][number]["mode"]) { return mode === "shootout" ? "No tiro" : mode === "escape" ? "Na fuga" : "Sem modo"; }
function readMessage(error: unknown) { return (error as any)?.response?.data?.message ?? "Não foi possível concluir a operação."; }
