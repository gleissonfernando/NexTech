import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Send, WalletCards } from "lucide-react";
import { createDashboardSocket } from "../../lib/socket";
import {
  getFivemExpenses,
  getGuildLiveOptions,
  publishFivemExpensePanel,
  saveFivemExpenseConfig,
  saveFivemExpenseItem,
  updateFivemExpenseItem,
} from "../../lib/api";
import type {
  DashboardGuild,
  FivemExpenseDashboard,
  FivemExpenseItem,
  GuildChannelOption,
  GuildRoleOption,
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FivemResourceMultiSelect, FivemResourceSelect } from "./FivemResourceSelect";

export function FivemExpensesPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [dashboard, setDashboard] = useState<FivemExpenseDashboard | null>(null);
  const [draft, setDraft] = useState<Partial<FivemExpenseDashboard["config"]>>({});
  const [itemDraft, setItemDraft] = useState<Partial<FivemExpenseItem> & { name: string }>({ name: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    if (!guild) return Promise.resolve();
    return Promise.all([getFivemExpenses(guild.id, botId), getGuildLiveOptions(guild.id, botId)]).then(([data, live]) => {
      setDashboard(data);
      setDraft(data.config);
      setChannels(live.channels);
      setRoles(live.roles);
    });
  }

  useEffect(() => { void load(); }, [botId, guild?.id]);
  useEffect(() => {
    if (!guild || !dashboard) return;
    const socket = createDashboardSocket();
    const refresh = (payload: { botId?: string | null; guildId: string }) => {
      if (payload.guildId === guild.id && (payload.botId ?? null) === (botId ?? null)) void load();
    };
    socket.on("fivem:expenses:updated", refresh);
    return () => { socket.off("fivem:expenses:updated", refresh); socket.disconnect(); };
  }, [botId, guild?.id]);

  const config = dashboard?.config;
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, id: role.id, name: role.name })), [roles]);
  const channelOptions = useMemo(() => channels.map((channel) => ({ id: channel.id, name: channel.name })), [channels]);

  if (!guild) return <Card><CardContent className="p-6 text-sm text-zinc-400">Selecione um servidor para configurar o Sistema de Gastos.</CardContent></Card>;
  if (!dashboard || !config) return <Card><CardContent className="p-6 text-sm text-zinc-400">Carregando gastos da FAC...</CardContent></Card>;
  if (config.releaseStatus !== "active") {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm text-zinc-400">
          <p className="font-medium text-zinc-100">Sistema de Gastos não liberado para esta organização.</p>
          <p>Peça para o desenvolvedor liberar o módulo em DEV &gt; Gastos FAC informando o bot, servidor e ID da organização.</p>
        </CardContent>
      </Card>
    );
  }

  async function saveConfig() {
    if (!guild) return;
    setSaving(true);
    try {
      const config = await saveFivemExpenseConfig(guild.id, draft, botId);
      setDashboard((current) => current ? { ...current, config } : current);
      setMessage("Configuração salva.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!guild || !dashboard) return;
    const config = await publishFivemExpensePanel(guild.id, dashboard.config.organizationId, botId);
    setDashboard((current) => current ? { ...current, config } : current);
    setMessage("Publicação enviada ao bot.");
  }

  async function saveItem(item?: FivemExpenseItem) {
    if (!guild || !config) return;
    const payload = item ? { ...item } : { ...itemDraft, organizationId: config.organizationId };
    if (!payload.name?.trim()) return;
    const saved = item
      ? await updateFivemExpenseItem(guild.id, item.id, payload as FivemExpenseItem & { name: string }, botId)
      : await saveFivemExpenseItem(guild.id, payload as Partial<FivemExpenseItem> & { name: string }, botId);
    setDashboard((current) => current ? { ...current, items: current.items.some((entry) => entry.id === saved.id) ? current.items.map((entry) => entry.id === saved.id ? saved : entry) : [...current.items, saved] } : current);
    setItemDraft({ name: "" });
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <StatusCard label="Status" value={config.enabled ? "Ativo" : "Desativado"} />
        <StatusCard label="Caixa" value={money(dashboard.report.balanceCents)} />
        <StatusCard label="Itens" value={String(dashboard.items.filter((item) => item.enabled).length)} />
        <StatusCard label="Registros" value={String(dashboard.report.count)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><WalletCards className="h-4 w-4" /> Sistema de Gastos</CardTitle>
          <div className="flex gap-2">
            <Button disabled={!canManage || saving} onClick={saveConfig} size="sm"><Save className="mr-2 h-4 w-4" />Salvar</Button>
            <Button disabled={!canManage || !config.panelChannelId || !config.logsChannelId} onClick={publish} size="sm" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar painel</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-1 text-sm text-zinc-300">Organização
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} value={draft.organizationName ?? ""} onChange={(event) => setDraft({ ...draft, organizationName: event.target.value, panelName: draft.panelName || `Painel de Gastos ${event.target.value}` })} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">Nome do painel
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} value={draft.panelName ?? ""} onChange={(event) => setDraft({ ...draft, panelName: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">Título
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} value={draft.panelTitle ?? ""} onChange={(event) => setDraft({ ...draft, panelTitle: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">Cor lateral
            <input className="h-10 rounded-md border border-zinc-800 bg-black px-3" disabled={!canManage} type="color" value={draft.color ?? "#ef4444"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} />
          </label>
          <FivemResourceSelect disabled={!canManage} label="Canal do painel principal" onChange={(value) => setDraft({ ...draft, panelChannelId: value })} options={channelOptions} value={draft.panelChannelId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Canal de logs" onChange={(value) => setDraft({ ...draft, logsChannelId: value })} options={channelOptions} value={draft.logsChannelId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Canal opcional de resumo" onChange={(value) => setDraft({ ...draft, summaryChannelId: value })} options={channelOptions} value={draft.summaryChannelId ?? null} />
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={draft.enabled === true} disabled={!canManage} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} type="checkbox" /> Ativar módulo</label>
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={draft.allowAdministrators === true} disabled={!canManage} onChange={(event) => setDraft({ ...draft, allowAdministrators: event.target.checked })} type="checkbox" /> Permitir administradores</label>
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={draft.allowNegativeBalance === true} disabled={!canManage} onChange={(event) => setDraft({ ...draft, allowNegativeBalance: event.target.checked })} type="checkbox" /> Permitir saldo negativo</label>
          </div>
          <FivemResourceMultiSelect disabled={!canManage} label="Cargos autorizados" onChange={(values) => setDraft({ ...draft, authorizedRoleIds: values })} options={roleOptions} values={draft.authorizedRoleIds ?? []} />
          <FivemResourceMultiSelect disabled={!canManage} label="Cargos administrativos" onChange={(values) => setDraft({ ...draft, adminRoleIds: values })} options={roleOptions} values={draft.adminRoleIds ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Itens de gasto</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[80px_1fr_1fr_120px]">
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} placeholder="Emoji" value={itemDraft.emoji ?? ""} onChange={(event) => setItemDraft({ ...itemDraft, emoji: event.target.value })} />
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} placeholder="Nome" value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} />
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} placeholder="Descrição" value={itemDraft.description ?? ""} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} />
            <Button disabled={!canManage || !itemDraft.name.trim()} onClick={() => void saveItem()} size="sm"><Plus className="mr-2 h-4 w-4" />Criar</Button>
          </div>
          <div className="grid gap-2">
            {dashboard.items.map((item) => (
              <div className="grid gap-2 rounded-md border border-zinc-800 bg-black/30 p-3 md:grid-cols-[1fr_auto_auto_auto]" key={item.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-100"><span>{item.emoji}</span>{item.name}<Badge variant={item.enabled ? "default" : "muted"}>{item.enabled ? "Ativo" : "Inativo"}</Badge></div>
                <p className="truncate text-xs text-zinc-500">{item.description || "Sem descrição"} • Saída do caixa</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-300"><input checked={item.requiresQuantity} disabled={!canManage} onChange={(event) => void saveItem({ ...item, requiresQuantity: event.target.checked })} type="checkbox" />Quantidade</label>
                <span className="flex items-center text-xs text-zinc-400">Debita o caixa</span>
                <Button disabled={!canManage} onClick={() => void saveItem({ ...item, enabled: !item.enabled })} size="sm" variant="secondary">{item.enabled ? "Desativar" : "Reativar"}</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 truncate text-lg font-semibold text-zinc-100">{value}</p></CardContent></Card>;
}

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}
