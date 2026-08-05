import { useEffect, useMemo, useState } from "react";
import { PackageCheck, Plus, Save, Send } from "lucide-react";
import { createDashboardSocket } from "../../lib/socket";
import { getAmmunition, getGuildLiveOptions, publishAmmunitionPanel, saveAmmunitionConfig } from "../../lib/api";
import type { AmmunitionConfig, AmmunitionDashboard, AmmunitionOrder, AmmunitionPermissionType, AmmunitionType, DashboardGuild, GuildCategoryOption, GuildChannelOption, GuildRoleOption } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FivemResourceMultiSelect, FivemResourceSelect } from "./FivemResourceSelect";

const permissionLabels: Record<AmmunitionPermissionType, string> = {
  CANCEL_ORDER: "Cancelar venda",
  COMPLETE_ORDER: "Concluir entrega",
  CREATE_ORDER: "Criar venda",
  MANAGE_CONFIG: "Configurar modulo",
  VIEW_CHANNEL: "Ver canais temporarios",
  VIEW_REPORT: "Ver resumo semanal"
};

export function AmmunitionPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [dashboard, setDashboard] = useState<AmmunitionDashboard | null>(null);
  const [draft, setDraft] = useState<Partial<AmmunitionConfig>>({});
  const [typeDrafts, setTypeDrafts] = useState<Array<Partial<AmmunitionType> & { name: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    if (!guild) return Promise.resolve();
    return Promise.all([getAmmunition(guild.id, botId), getGuildLiveOptions(guild.id, botId)]).then(([data, live]) => {
      setDashboard(data);
      setDraft(data.config);
      setTypeDrafts(data.ammunitionTypes.map((type) => ({ ...type })));
      setCategories(live.categories ?? []);
      setChannels(live.channels);
      setRoles(live.roles);
    });
  }

  useEffect(() => { void load(); }, [botId, guild?.id]);
  useEffect(() => {
    if (!guild) return;
    const socket = createDashboardSocket();
    const refresh = (payload: { botId?: string | null; guildId: string }) => {
      if (payload.guildId === guild.id && (payload.botId ?? null) === (botId ?? null)) void load();
    };
    socket.on("fivem:ammunition:updated", refresh);
    return () => { socket.off("fivem:ammunition:updated", refresh); socket.disconnect(); };
  }, [botId, guild?.id]);

  const channelOptions = useMemo(() => channels.map((channel) => ({ id: channel.id, name: channel.name })), [channels]);
  const categoryOptions = useMemo(() => categories.map((category) => ({ id: category.id, name: category.name })), [categories]);
  const roleOptions = useMemo(() => roles.map((role) => ({ color: role.color, id: role.id, name: role.name })), [roles]);
  const factions = dashboard?.factions ?? [];
  const config = dashboard?.config;
  const orders = dashboard?.orders ?? [];

  if (!guild) return <Card><CardContent className="p-6 text-sm text-zinc-400">Selecione um servidor para configurar o Sistema de Munição.</CardContent></Card>;
  if (!dashboard || !config) return <Card><CardContent className="p-6 text-sm text-zinc-400">Carregando vendas de munição...</CardContent></Card>;
  const activeConfig = config;

  function patch(value: Partial<AmmunitionConfig>) {
    setDraft((current) => ({ ...current, ...value }));
  }

  function patchRole(permission: AmmunitionPermissionType, values: string[]) {
    patch({ roles: { ...activeConfig.roles, ...(draft.roles ?? {}), [permission]: values } });
  }

  function updateTypeDraft(index: number, value: Partial<AmmunitionType>) {
    setTypeDrafts((current) => current.map((type, currentIndex) => currentIndex === index ? { ...type, ...value } : type));
  }

  async function save() {
    if (!guild) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveAmmunitionConfig(guild.id, { ...draft, ammunitionTypes: typeDrafts.filter((type) => type.name.trim()) }, botId);
      setDraft(saved);
      await load();
      setMessage("Configuracao salva.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!guild) return;
    const saved = await publishAmmunitionPanel(guild.id, botId);
    setDashboard((current) => current ? { ...current, config: saved } : current);
    setDraft(saved);
    setMessage("Publicacao enviada ao bot.");
  }

  const sellerReady = factions.some((faction) => faction.id === (draft.sellerFactionId ?? config.sellerFactionId));

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <StatusCard label="Status" value={draft.enabled ? "Ativo" : "Inativo"} />
        <StatusCard label="Valor unitario" value={money(draft.unitPriceInCents ?? 0)} />
        <StatusCard label="Entregues na semana" value={String(dashboard.weeklySummary.orderCount)} />
        <StatusCard label="Total semanal" value={money(dashboard.weeklySummary.totalValueInCents)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4" /> Sistema de Venda de Munição</CardTitle>
          <div className="flex gap-2">
            <Button disabled={!canManage || saving} onClick={() => void save()} size="sm"><Save className="mr-2 h-4 w-4" />Salvar</Button>
            <Button disabled={!canManage || !draft.panelChannelId || !draft.temporaryCategoryId || !draft.logChannelId || !sellerReady} onClick={() => void publish()} size="sm" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar painel</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={draft.enabled === true} disabled={!canManage} onChange={(event) => patch({ enabled: event.target.checked })} type="checkbox" /> Ativar modulo</label>
          <label className="grid gap-1 text-sm text-zinc-300">Valor por unidade
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} min="0" onChange={(event) => patch({ unitPriceInCents: Math.round(Number(event.target.value || 0) * 100) })} type="number" value={((draft.unitPriceInCents ?? 0) / 100).toString()} />
          </label>
          <FivemResourceSelect disabled={!canManage} label="FAC vendedora integrada ao caixa" onChange={(value) => patch({ sellerFactionId: value })} options={factions.map((faction) => ({ id: faction.id, name: faction.name }))} value={draft.sellerFactionId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Canal do painel" onChange={(value) => patch({ panelChannelId: value })} options={channelOptions} value={draft.panelChannelId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Categoria temporaria" onChange={(value) => patch({ temporaryCategoryId: value })} options={categoryOptions} value={draft.temporaryCategoryId ?? null} />
          <FivemResourceSelect disabled={!canManage} label="Canal de logs" onChange={(value) => patch({ logChannelId: value })} options={channelOptions} value={draft.logChannelId ?? null} />
          <label className="grid gap-1 text-sm text-zinc-300">Excluir canal entregue em segundos
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} min="0" onChange={(event) => patch({ completedChannelDeleteDelaySeconds: Number(event.target.value || 0) })} type="number" value={draft.completedChannelDeleteDelaySeconds ?? 300} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">Excluir canal cancelado em segundos
            <input className="rounded-md border border-zinc-800 bg-black px-3 py-2" disabled={!canManage} min="0" onChange={(event) => patch({ cancelledChannelDeleteDelaySeconds: Number(event.target.value || 0) })} type="number" value={draft.cancelledChannelDeleteDelaySeconds ?? 300} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Munições cadastradas</CardTitle>
          <Button disabled={!canManage} onClick={() => setTypeDrafts((current) => [...current, { active: true, aliases: [], name: "", unitPriceInCents: null }])} size="sm" variant="secondary"><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {typeDrafts.length ? typeDrafts.map((type, index) => (
            <div className="grid gap-2 rounded-md border border-zinc-800 bg-black/30 p-3 md:grid-cols-[1fr_1fr_140px_auto]" key={type.id ?? index}>
              <input className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm" disabled={!canManage} onChange={(event) => updateTypeDraft(index, { name: event.target.value })} placeholder="Nome da munição" value={type.name} />
              <input className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm" disabled={!canManage} onChange={(event) => updateTypeDraft(index, { aliases: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Aliases separados por vírgula" value={(type.aliases ?? []).join(", ")} />
              <input className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm" disabled={!canManage} min="0" onChange={(event) => updateTypeDraft(index, { unitPriceInCents: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} placeholder="Valor opcional" type="number" value={type.unitPriceInCents ? String(type.unitPriceInCents / 100) : ""} />
              <label className="flex items-center gap-2 text-sm text-zinc-300"><input checked={type.active !== false} disabled={!canManage} onChange={(event) => updateTypeDraft(index, { active: event.target.checked })} type="checkbox" /> Ativa</label>
            </div>
          )) : <p className="text-sm text-zinc-500">Cadastre ao menos uma munição ativa para o bot reconhecer mensagens nos canais temporários.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Permissões por cargo</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {(Object.keys(permissionLabels) as AmmunitionPermissionType[]).map((permission) => (
            <FivemResourceMultiSelect disabled={!canManage} key={permission} label={permissionLabels[permission]} onChange={(values) => patchRole(permission, values)} options={roleOptions} values={(draft.roles?.[permission] ?? activeConfig.roles[permission]) || []} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Vendas recentes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {orders.length ? orders.map((order) => <OrderRow key={order.id} order={order} />) : <p className="text-sm text-zinc-500">Nenhuma venda registrada.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function OrderRow({ order }: { order: AmmunitionOrder }) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-800 bg-black/30 p-3 md:grid-cols-[1fr_auto_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">#{order.orderNumber} <Badge variant={order.status === "DELIVERED" ? "success" : order.status === "CANCELLED" ? "danger" : "muted"}>{order.status}</Badge></div>
        <p className="truncate text-xs text-zinc-500">{order.sellerFactionName} para {order.buyerFactionName} • {date(order.createdAt)}</p>
      </div>
      <span className="text-sm text-zinc-300">{order.quantity.toLocaleString("pt-BR")} un.</span>
      <span className="text-sm font-medium text-zinc-100">{money(order.totalValueInCents)}</span>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 truncate text-lg font-semibold text-zinc-100">{value}</p></CardContent></Card>;
}

function money(cents: number) {
  return (Math.max(0, cents) / 100).toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function date(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}
