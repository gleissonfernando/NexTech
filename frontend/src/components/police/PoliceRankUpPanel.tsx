import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { getGuildLiveOptions, getPoliceRankUpDashboard, publishPoliceRankUpPanel, savePoliceRankUpSettings } from "../../lib/api";
import type { DashboardGuild, GuildCategoryOption, GuildChannelOption, GuildRoleOption, PoliceRankUpDashboard, PoliceRankUpRank, PoliceRankUpSettings } from "../../types";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

export function PoliceRankUpPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<PoliceRankUpDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const settingsRef = useRef<PoliceRankUpSettings | null>(null);

  const load = useCallback(async () => {
    if (!botId || !guild) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const [dashboard, options] = await Promise.all([getPoliceRankUpDashboard(guild.id, botId), getGuildLiveOptions(guild.id, botId)]);
      setData(dashboard);
      settingsRef.current = dashboard.settings;
      setChannels(options.channels ?? []);
      setCategories(options.categories ?? []);
      setRoles(options.roles ?? []);
      setDirty(false);
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => { void load(); }, [load]);

  const disabled = !canManage || saving || publishing;
  const channelOptions = useMemo(() => channels.map((channel) => ({ id: channel.id, name: channel.name })), [channels]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ id: category.id, name: category.name })), [categories]);
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, disabled: role.managed, id: role.id, name: role.name })), [roles]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar o Sistema de UP." />;
  if (loading || !data) return <Empty loading text="Carregando Sistema de UP..." />;

  function patch(next: Partial<PoliceRankUpSettings>) {
    const settings = { ...(settingsRef.current ?? data!.settings), ...next };
    settingsRef.current = settings;
    setData((current) => current ? { ...current, settings } : current);
    setDirty(true);
  }

  function patchRank(id: string, next: Partial<PoliceRankUpRank>) {
    const settings = settingsRef.current ?? data!.settings;
    patch({ ranks: settings.ranks.map((rank) => rank.id === id ? { ...rank, ...next, updatedAt: new Date().toISOString() } : rank) });
  }

  async function save() {
    if (!settingsRef.current || !canManage) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await savePoliceRankUpSettings(guild!.id, botId!, settingsRef.current);
      settingsRef.current = settings;
      setData((current) => current ? { ...current, settings } : current);
      setDirty(false);
      setMessage("Configurações do Sistema de UP salvas.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!settingsRef.current || !canManage) return;
    setPublishing(true);
    setSaving(true);
    setMessage(null);
    try {
      const saved = await savePoliceRankUpSettings(guild!.id, botId!, settingsRef.current);
      settingsRef.current = saved;
      const published = await publishPoliceRankUpPanel(guild!.id, botId!);
      settingsRef.current = published;
      setData((current) => current ? { ...current, settings: published } : current);
      setDirty(false);
      setMessage("Painel de UP publicado/atualizado no Discord.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setPublishing(false);
      setSaving(false);
    }
  }

  function addRank() {
    const rank: PoliceRankUpRank = {
      allowSkip: false,
      allowedPreviousRanks: [],
      createdAt: new Date().toISOString(),
      description: null,
      emoji: null,
      enabled: true,
      hierarchyPosition: data!.settings.ranks.length + 1,
      id: crypto.randomUUID(),
      name: "Nova patente",
      roleId: "",
      updatedAt: new Date().toISOString()
    };
    patch({ ranks: [...data!.settings.ranks, rank] });
  }

  function removeRank(id: string) {
    patch({ ranks: data!.settings.ranks.filter((rank) => rank.id !== id).map((rank, index) => ({ ...rank, hierarchyPosition: index + 1 })) });
  }

  function moveRank(id: string, direction: -1 | 1) {
    const ranks = [...data!.settings.ranks].sort((a, b) => a.hierarchyPosition - b.hierarchyPosition);
    const index = ranks.findIndex((rank) => rank.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ranks.length) return;
    const current = ranks[index];
    const next = ranks[target];
    if (!current || !next) return;
    ranks[index] = next;
    ranks[target] = current;
    patch({ ranks: ranks.map((rank, order) => ({ ...rank, hierarchyPosition: order + 1 })) });
  }

  const rankById = new Map(data.settings.ranks.map((rank) => [rank.id, rank.name]));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-yellow-300" />Sistema de UP</CardTitle>
              <CardDescription>Solicitação pública, aprovação manual, troca segura de patentes policiais e auditoria.</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={data.settings.enabled ? "success" : "muted"}>{data.settings.enabled ? "Ativo" : "Desativado"}</Badge>
              {dirty ? <Badge variant="warning">Alterações pendentes</Badge> : null}
              <Button disabled={disabled || !data.settings.enabled || !data.settings.panelChannelId} onClick={() => void publish()} size="sm" variant="secondary">{publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publicar painel</Button>
              <Button disabled={disabled} onClick={() => void save()} size="sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-5">
        <Metric label="Patentes" value={data.stats.ranks} />
        <Metric label="Pendentes" value={data.stats.pending} />
        <Metric label="Aprovadas" value={data.stats.approved} />
        <Metric label="Recusadas" value={data.stats.rejected} />
        <Metric label="Total" value={data.stats.total} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configurações Gerais</CardTitle>
          <CardDescription>Canais, responsáveis e regras de progressão.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <FivemResourceSelect disabled={disabled} label="Canal do painel público" options={channelOptions} prefix="#" value={data.settings.panelChannelId} onChange={(panelChannelId) => patch({ panelChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Categoria temporária" options={categoryOptions} value={data.settings.temporaryCategoryId} onChange={(temporaryCategoryId) => patch({ temporaryCategoryId })} />
          <FivemResourceSelect disabled={disabled} label="Canal de logs" options={channelOptions} prefix="#" value={data.settings.logChannelId} onChange={(logChannelId) => patch({ logChannelId })} />
          <FivemResourceSelect disabled={disabled} label="Canal administrativo" options={channelOptions} prefix="#" value={data.settings.adminChannelId} onChange={(adminChannelId) => patch({ adminChannelId })} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos responsáveis" options={roleOptions} values={data.settings.responsibleRoleIds} onChange={(responsibleRoleIds) => patch({ responsibleRoleIds })} />
          <FivemResourceMultiSelect disabled={disabled} label="Cargos administradores" options={roleOptions} values={data.settings.adminRoleIds} onChange={(adminRoleIds) => patch({ adminRoleIds })} />
          <TextField disabled={disabled} label="Mensagem do painel" value={data.settings.panelMessage} onChange={(panelMessage) => patch({ panelMessage })} />
          <TextField disabled={disabled} label="Nome dos canais temporários" value={data.settings.temporaryChannelName} onChange={(temporaryChannelName) => patch({ temporaryChannelName })} />
          <NumberField disabled={disabled} label="Excluir após aprovação (segundos)" value={data.settings.approvedDeleteSeconds} onChange={(approvedDeleteSeconds) => patch({ approvedDeleteSeconds })} />
          <NumberField disabled={disabled} label="Excluir após recusa (segundos)" value={data.settings.rejectedDeleteSeconds} onChange={(rejectedDeleteSeconds) => patch({ rejectedDeleteSeconds })} />
          <Toggle disabled={disabled} label="Módulo ativo" value={data.settings.enabled} onChange={(enabled) => patch({ enabled })} />
          <Toggle disabled={disabled} label="Somente próxima patente" value={data.settings.onlyNextRank} onChange={(onlyNextRank) => patch({ onlyNextRank })} />
          <Toggle disabled={disabled} label="Bloquear rebaixamentos" value={data.settings.blockDemotions} onChange={(blockDemotions) => patch({ blockDemotions })} />
          <Toggle disabled={disabled} label="Bloquear múltiplas patentes" value={data.settings.blockMultipleRanks} onChange={(blockMultipleRanks) => patch({ blockMultipleRanks })} />
          <Toggle disabled={disabled} label="Notificar por DM" value={data.settings.notifyByDm} onChange={(notifyByDm) => patch({ notifyByDm })} />
          <Toggle disabled={disabled} label="Mencionar responsáveis" value={data.settings.mentionResponsibles} onChange={(mentionResponsibles) => patch({ mentionResponsibles })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Patentes</CardTitle>
              <CardDescription>Ordem hierárquica, cargo vinculado e regras de salto.</CardDescription>
            </div>
            <Button disabled={disabled} onClick={addRank} size="sm" variant="secondary"><Plus className="h-4 w-4" />Adicionar patente</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...data.settings.ranks].sort((a, b) => a.hierarchyPosition - b.hierarchyPosition).map((rank) => (
            <div key={rank.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="grid gap-3 lg:grid-cols-[80px_1fr_1fr_120px_auto]">
                <NumberField disabled={disabled} label="Posição" value={rank.hierarchyPosition} onChange={(hierarchyPosition) => patchRank(rank.id, { hierarchyPosition })} />
                <TextField disabled={disabled} label="Nome" value={rank.name} onChange={(name) => patchRank(rank.id, { name })} />
                <FivemResourceSelect disabled={disabled} label="Cargo" options={roleOptions} value={rank.roleId || null} onChange={(roleId) => patchRank(rank.id, { roleId: roleId ?? "" })} />
                <TextField disabled={disabled} label="Emoji" value={rank.emoji ?? ""} onChange={(emoji) => patchRank(rank.id, { emoji: emoji || null })} />
                <div className="flex items-end gap-1">
                  <IconButton disabled={disabled} onClick={() => moveRank(rank.id, -1)} title="Subir"><ArrowUp className="h-4 w-4" /></IconButton>
                  <IconButton disabled={disabled} onClick={() => moveRank(rank.id, 1)} title="Descer"><ArrowDown className="h-4 w-4" /></IconButton>
                  <IconButton disabled={disabled} onClick={() => removeRank(rank.id)} title="Excluir"><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_180px_180px]">
                <TextField disabled={disabled} label="Descrição" value={rank.description ?? ""} onChange={(description) => patchRank(rank.id, { description: description || null })} />
                <Toggle disabled={disabled} label="Ativa" value={rank.enabled} onChange={(enabled) => patchRank(rank.id, { enabled })} />
                <Toggle disabled={disabled} label="Permitir pular" value={rank.allowSkip} onChange={(allowSkip) => patchRank(rank.id, { allowSkip })} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Solicitações</CardTitle>
          <CardDescription>Fila recente de análise e histórico operacional.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.requests.length ? data.requests.slice(0, 20).map((request) => (
            <div key={request.id} className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm md:grid-cols-[120px_1fr_1fr_140px]">
              <span className="font-mono text-zinc-300">{request.protocol}</span>
              <span>{request.userDisplayName} <span className="text-zinc-500">({request.userId})</span></span>
              <span>{request.currentRankId ? rankById.get(request.currentRankId) ?? request.currentRankId : "Sem patente"} → {rankById.get(request.requestedRankId) ?? request.requestedRankId}</span>
              <Badge variant={request.status === "pending" ? "warning" : request.status === "approved" ? "success" : "muted"}>{statusLabel(request.status)}</Badge>
            </div>
          )) : <p className="text-sm text-zinc-500">Nenhuma solicitação registrada.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-4"><p className="text-xs uppercase text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold text-white">{value}</p></CardContent></Card>;
}

function Toggle({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-200"><span>{label}</span><Switch checked={value} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function TextField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="space-y-1 text-sm text-zinc-300"><span>{label}</span><input className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-yellow-400" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function NumberField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: number) => void; value: number }) {
  return <label className="space-y-1 text-sm text-zinc-300"><span>{label}</span><input className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-yellow-400" disabled={disabled} min={0} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function IconButton({ children, disabled, onClick, title }: { children: React.ReactNode; disabled?: boolean; onClick: () => void; title: string }) {
  return <button className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-200 hover:border-yellow-400 disabled:opacity-50" disabled={disabled} onClick={onClick} title={title} type="button">{children}</button>;
}

function Empty({ loading = false, text }: { loading?: boolean; text: string }) {
  return <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-zinc-400">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{text}</CardContent></Card>;
}

function statusLabel(status: string) {
  return ({ approved: "Aprovada", cancelled: "Cancelada", error: "Erro", pending: "Pendente", rejected: "Recusada" } as Record<string, string>)[status] ?? status;
}

function readMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const data = (error as { response?: { data?: { message?: string } } }).response?.data;
    if (data?.message) return data.message;
  }
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}
